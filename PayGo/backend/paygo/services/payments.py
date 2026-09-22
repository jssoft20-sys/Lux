"""Incoming payment confirmations: ingestion (idempotent), amount extraction,
matching to deposits and crediting."""
from __future__ import annotations

import logging
import re
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import transaction
from ..models import Deposit, PaymentEvent
from ..utils import as_utc, iso, money, stable_hash, utcnow
from . import settings_store
from .deposits import credit_deposit
from .logs import log_event

logger = logging.getLogger("paygo.payments")

# A number in a bank notification: «1 500,84», «1500.84», «12 345,67», «1,500.84», «900». Never a
# piece of a masked card («4***1234»), a phone («996555123456» — too many digits, scored below),
# a date («18.09.2026») or a time («12:01»).
_NUMBER = re.compile(
    r"(?<![\d*.,:])"
    r"(?P<int>\d{1,3}(?:[   ]\d{3})+|\d{1,3}(?:,\d{3})+(?=\.\d{2}(?!\d))|\d{1,3}(?:,\d{3})+(?![.,]?\d)|\d+)"
    r"(?:[.,](?P<frac>\d{2}))?"
    r"(?![\d*])(?![.,]\d)"
)
_CURRENCY_AFTER = re.compile(r"^\s{0,3}(?:kgs|kgz|som|сом\w*|с|c)(?![\w])", re.I)
_PERCENT_AFTER = re.compile(r"^\s{0,2}%")
_KEYWORD_BEFORE = re.compile(
    r"(?:зачисл\w*|поступ\w*|пополн\w*|перевод\w*|перевел\w*|оплат\w*|плат[её]ж\w*|сумм\w*|получен\w*|приход\w*|внес\w*|amount|credited|received|payment|deposit|transfer)\W*[^\d\n]{0,40}$",
    re.I,
)
_NOT_PAYMENT_BEFORE = re.compile(r"(?:баланс\w*|остат\w*|доступн\w*|комисси\w*|лимит\w*|итого|balance|available|fee|limit|cashback|кэшбэк\w*)\W*[^\d\n]{0,25}$", re.I)
MAX_INT_DIGITS = 8  # anything longer is an account / phone number, not soms


def amount_candidates(text: str) -> list[tuple[int, int, Decimal]]:
    """Every plausible amount in the text as ``(score, position, amount)``.

    Scoring: a currency right after the number +4, a payment keyword right before it +3,
    two decimals (tiyins) +2, a leading «+» +1; a balance / commission / limit keyword before
    it −3, a percent after it −3, more than 8 integer digits −5. Zero is never an amount."""
    out: list[tuple[int, int, Decimal]] = []
    for match in _NUMBER.finditer(text):
        whole = re.sub(r"[   ,]", "", match.group("int"))
        frac = match.group("frac")
        try:
            dec = money(whole + ("." + frac if frac else ""))
        except Exception:
            continue
        if dec <= 0:
            continue
        before = text[max(0, match.start() - 60):match.start()]
        after = text[match.end():match.end() + 16]
        score = 0
        if _CURRENCY_AFTER.search(after):
            score += 4
        if _KEYWORD_BEFORE.search(before):
            score += 3
        if frac:
            score += 2
        if before.rstrip().endswith("+"):
            score += 1
        if _NOT_PAYMENT_BEFORE.search(before):
            score -= 3
        if _PERCENT_AFTER.search(after):
            score -= 3
        if len(whole) > MAX_INT_DIGITS:
            score -= 5
        out.append((score, match.start(), dec))
    return out


def extract_amount(raw_text: str, parsed: Any = None) -> Decimal:
    """Find the payment amount in a bank notification (text / JSON).

    The amount the bank actually received — tiyins included — is what gets credited, so the
    parser must pick the payment figure and nothing else: not the balance after the operation,
    not the commission, not a card mask, a phone number, a date or a time."""
    if isinstance(parsed, dict):
        for key in ("amount", "sum", "summa", "value", "total", "amount_value"):
            value = parsed.get(key)
            if value not in (None, ""):
                try:
                    dec = money(str(value))
                    if dec > 0:
                        return dec
                except Exception:
                    pass
    candidates = amount_candidates(str(raw_text or ""))
    if candidates:
        # the best-scored figure; among equals the first in the text (the payment comes before the balance)
        best = max(candidates, key=lambda item: (item[0], -item[1]))
        if best[0] >= 2:
            return best[2]
    raise ValueError("Не удалось определить сумму платежа")


def ingest_event(
    db: Session,
    *,
    source: str,
    amount: Decimal,
    raw_text: str = "",
    raw_payload: dict[str, Any] | None = None,
    external_id: str = "",
    sender_ip: str = "",
    event_key: str = "",
) -> tuple[PaymentEvent, bool]:
    """Store a payment confirmation once. Returns ``(event, created)``."""
    amount = money(amount)
    if not event_key:
        canonical = raw_payload if raw_payload else re.sub(r"\s+", " ", str(raw_text or "")).strip()
        event_key = stable_hash({"source": source, "amount": str(amount), "external_id": external_id, "canonical": canonical})[:96]
    existing = db.execute(select(PaymentEvent).where(PaymentEvent.event_key == event_key)).scalar_one_or_none()
    if existing:
        return existing, False
    event = PaymentEvent(
        source=source,
        event_key=event_key,
        external_id=(external_id or "")[:160],
        amount=amount,
        raw_text=str(raw_text or "")[:5000],
        raw_payload=raw_payload or {},
        status="received",
        sender_ip=(sender_ip or "")[:64],
    )
    db.add(event)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        db.expunge(event)
        existing = db.execute(select(PaymentEvent).where(PaymentEvent.event_key == event_key)).scalar_one_or_none()
        if existing:
            return existing, False
        raise
    log_event(db, "Получено подтверждение платежа", f"{source} • {amount} • {str(raw_text or '')[:160]}", category="payments", entity_type="payment_event", entity_id=event.id)
    return event, True


def _payment_in_window(db: Session, deposit: Deposit, event_time: Any) -> bool:
    """Second safety check: the payment time must fall inside the request's own window.

    A payment cannot belong to a request created *after* it, nor to one that closed long before
    it — so a fresh, unrelated payment that happens to carry the same amount can never confirm the
    wrong request. ``event_time`` None (unknown) skips the check to preserve old behaviour."""
    if event_time is None:
        return True
    when = as_utc(event_time)
    skew = timedelta(minutes=settings_store.get_int(db, "deposit_match_time_skew_minutes", 3))
    grace = timedelta(minutes=settings_store.get_int(db, "payment_event_max_age_minutes", 15))
    created = as_utc(deposit.created_at) if deposit.created_at else None
    if created is not None and when < created - skew:
        return False  # money moved before the request even existed → not this request
    end = None
    if deposit.expires_at:
        end = as_utc(deposit.expires_at) + grace
    elif deposit.closed_at:
        end = as_utc(deposit.closed_at) + grace
    elif created is not None:
        end = created + grace
    if end is not None and when > end:
        return False  # arrived long after the request's window → not this request
    return True


def _find_deposit_for_amount(db: Session, amount: Decimal, event_time: Any = None) -> Deposit | None:
    now = utcnow()
    row = db.execute(
        select(Deposit).where(Deposit.status == "created", Deposit.pay_amount == amount).order_by(Deposit.id.asc())
    ).scalars().first()
    if row and _payment_in_window(db, row, event_time):
        return row
    grace = settings_store.get_int(db, "payment_event_max_age_minutes", 15)
    cutoff = now - timedelta(minutes=grace)
    # a late bank notification for a deposit that just expired is still a real payment
    row = db.execute(
        select(Deposit)
        .where(Deposit.status.in_(("expired", "failed")), Deposit.pay_amount == amount, Deposit.closed_at.is_not(None), Deposit.closed_at >= cutoff)
        .order_by(Deposit.id.desc())
    ).scalars().first()
    if row and _payment_in_window(db, row, event_time):
        return row
    # the client paid the whole soms but not the tiyins (or paid a little more): when exactly one
    # open request has the same whole amount, it is that request — it gets credited with what was paid
    whole = int(amount)
    candidates = [
        d for d in db.execute(select(Deposit).where(Deposit.status == "created")).scalars().all()
        if int(money(d.pay_amount)) == whole and abs(money(d.pay_amount) - amount) < Decimal("1") and _payment_in_window(db, d, event_time)
    ]
    if len(candidates) == 1:
        return candidates[0]
    return None


def process_event(event_id: int) -> dict[str, Any]:
    """Match one event to a deposit and credit it. Idempotent and safe to re-run."""
    with transaction() as db:
        event = db.get(PaymentEvent, event_id)
        if event is None:
            return {"processed": False, "message": "event not found"}
        if event.status in {"matched", "ignored"}:
            return {"processed": True, "already": True, "deposit_id": event.deposit_id}
        if event.status == "processing" and event.deposit_id:
            deposit_id = event.deposit_id
        else:
            deposit = _find_deposit_for_amount(db, money(event.amount), event_time=event.received_at)
            event.attempts = int(event.attempts or 0) + 1
            if deposit is None:
                max_age = settings_store.get_int(db, "payment_event_max_age_minutes", 15)
                if utcnow() - (event.received_at.replace(tzinfo=event.received_at.tzinfo or utcnow().tzinfo)) > timedelta(minutes=max_age):
                    event.status = "unmatched"
                    event.error = "transaction_not_found"
                    event.processed_at = utcnow()
                else:
                    event.status = "received"
                    event.error = "transaction_not_found"
                db.flush()
                return {"processed": False, "message": "transaction_not_found"}
            event.status = "processing"
            event.deposit_id = deposit.id
            event.error = ""
            deposit_id = deposit.id
            db.flush()
    result = credit_deposit(deposit_id, source=event.source if event else "webhook", event_id=event_id)
    if not result.get("ok") and "уже обрабатывается" in str(result.get("message") or ""):
        # another worker won the claim — leave the event linked; it will be finalised by the winner
        return {"processed": False, "message": result.get("message")}
    return {"processed": True, **result}


def pending_event_ids(db: Session, limit: int = 100) -> list[int]:
    rows = db.execute(
        select(PaymentEvent.id).where(PaymentEvent.status.in_(("received", "processing"))).order_by(PaymentEvent.id.asc()).limit(limit)
    ).all()
    return [int(r[0]) for r in rows]


def public_event(event: PaymentEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "source": event.source,
        "amount": str(money(event.amount)),
        "currency": event.currency,
        "status": event.status,
        "deposit_id": event.deposit_id,
        "external_id": event.external_id,
        "raw_text": event.raw_text[:500],
        "attempts": event.attempts,
        "error": event.error,
        "received_at": iso(event.received_at),
        "processed_at": iso(event.processed_at),
        "sender_ip": event.sender_ip,
    }


# ------------------------------------------------------------------ инбокс платежей без заявки

INBOX_STATUSES = ("unmatched", "received", "failed")


def _candidates(db: Session, event: PaymentEvent, limit: int = 3) -> list[dict[str, Any]]:
    """Заявки, на которые похож этот платёж: та же сумма, та же сумма без тыйынов, близкая сумма."""
    amount = money(event.amount)
    whole = int(amount)
    since = as_utc(event.received_at) - timedelta(hours=48) if event.received_at else utcnow() - timedelta(hours=48)
    rows = db.execute(
        select(Deposit).where(Deposit.status.in_(("created", "expired", "failed")), Deposit.created_at >= since).order_by(Deposit.id.desc()).limit(120)
    ).scalars().all()
    scored: list[tuple[int, str, Deposit]] = []
    for d in rows:
        pay = money(d.pay_amount)
        if pay == amount:
            scored.append((0, "сумма совпадает точно", d))
        elif int(pay) == whole and abs(pay - amount) < Decimal("1"):
            scored.append((1, "совпадают сомы, отличаются тыйыны", d))
        elif abs(pay - amount) <= Decimal("2"):
            scored.append((2, "сумма отличается на копейки", d))
    scored.sort(key=lambda x: (x[0], -x[2].id))
    out: list[dict[str, Any]] = []
    for _score, why, d in scored[:limit]:
        user = d.user
        out.append({
            "deposit_id": d.id,
            "public_id": d.public_id,
            "player_id": d.player_id,
            "amount": str(money(d.pay_amount)),
            "status": d.status,
            "created_at": iso(d.created_at),
            "client": (getattr(user, "first_name", "") or "").strip() or (getattr(user, "username", "") or "") or "Клиент",
            "why": why,
        })
    return out


def inbox(db: Session, limit: int = 50) -> list[dict[str, Any]]:
    """Поступления, которые система не смогла привязать к заявке (с подсказками, к чему они подходят)."""
    rows = db.execute(
        select(PaymentEvent).where(PaymentEvent.status.in_(INBOX_STATUSES), PaymentEvent.deposit_id.is_(None)).order_by(PaymentEvent.id.desc()).limit(limit)
    ).scalars().all()
    return [{**public_event(e), "candidates": _candidates(db, e)} for e in rows]


def inbox_count(db: Session) -> int:
    return int(db.execute(
        select(func.count(PaymentEvent.id)).where(PaymentEvent.status.in_(INBOX_STATUSES), PaymentEvent.deposit_id.is_(None))
    ).scalar() or 0)


def bind(event_id: int, deposit_id: int, actor: str = "operator") -> dict[str, Any]:
    """Привязать платёж к заявке и зачислить её (кнопка «Это она» в инбоксе)."""
    with transaction() as db:
        event = db.get(PaymentEvent, event_id)
        deposit = db.get(Deposit, deposit_id)
        if event is None or deposit is None:
            return {"ok": False, "message": "Платёж или заявка не найдены"}
        if event.deposit_id and event.deposit_id != deposit.id:
            return {"ok": False, "message": "Платёж уже привязан к другой заявке"}
        if deposit.status == "success":
            return {"ok": False, "message": "Заявка уже зачислена"}
        event.status = "processing"
        event.deposit_id = deposit.id
        event.error = ""
        log_event(db, "Платёж привязан вручную", f"{money(event.amount)} → {deposit.public_id} ({actor})", category="payments", entity_type="deposit", entity_id=deposit.public_id)
        source = event.source
    return credit_deposit(deposit_id, source=source, event_id=event_id, actor=actor)


def ignore(db: Session, event_id: int, actor: str = "operator") -> bool:
    """Платёж не относится к сервису (личный перевод) — убрать из инбокса."""
    event = db.get(PaymentEvent, event_id)
    if event is None or event.deposit_id:
        return False
    event.status = "ignored"
    event.processed_at = utcnow()
    event.error = f"скрыт оператором ({actor})"
    log_event(db, "Платёж помечен как не наш", f"{money(event.amount)} • {event.source}", category="payments")
    return True
