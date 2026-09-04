"""Incoming payment confirmations: ingestion (idempotent), amount extraction,
matching to deposits and crediting."""
from __future__ import annotations

import logging
import re
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import transaction
from ..models import Deposit, PaymentEvent
from ..utils import iso, money, stable_hash, utcnow
from . import settings_store
from .deposits import credit_deposit
from .logs import log_event

logger = logging.getLogger("onoipay.payments")

_AMOUNT_PATTERNS = [
    re.compile(r"(?:зачислен[оа]?|поступил[оа]?|пополнени[ея]|перевод|оплата|платеж|платёж|сумма|amount|credited|received|поступление|зачисление)[^\d\-]{0,40}?([\d][\d\s]*[.,]?\d{0,2})", re.I),
    re.compile(r"\+\s?([\d][\d\s]*[.,]?\d{0,2})\s*(?:kgs|сом|с\b|som|c\b)", re.I),
    re.compile(r"([\d][\d\s]*[.,]\d{2})\s*(?:kgs|сом|som|с\b|c\b)", re.I),
    re.compile(r"([\d][\d\s]*[.,]?\d{0,2})\s*(?:kgs|сом|som)", re.I),
]


def extract_amount(raw_text: str, parsed: Any = None) -> Decimal:
    """Find the payment amount in a bank notification (text / JSON)."""
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
    text = str(raw_text or "")
    for pattern in _AMOUNT_PATTERNS:
        for match in pattern.finditer(text):
            candidate = match.group(1).replace(" ", "").replace(",", ".")
            try:
                dec = money(candidate)
            except Exception:
                continue
            if dec > 0:
                return dec
    # last resort: any decimal with two digits after the separator
    match = re.search(r"(\d[\d ]*[.,]\d{2})", text)
    if match:
        try:
            dec = money(match.group(1).replace(" ", "").replace(",", "."))
            if dec > 0:
                return dec
        except Exception:
            pass
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


def _find_deposit_for_amount(db: Session, amount: Decimal) -> Deposit | None:
    now = utcnow()
    row = db.execute(
        select(Deposit).where(Deposit.status == "created", Deposit.pay_amount == amount).order_by(Deposit.id.asc())
    ).scalars().first()
    if row:
        return row
    grace = settings_store.get_int(db, "payment_event_max_age_minutes", 15)
    cutoff = now - timedelta(minutes=grace)
    # a late bank notification for a deposit that just expired is still a real payment
    return db.execute(
        select(Deposit)
        .where(Deposit.status.in_(("expired", "failed")), Deposit.pay_amount == amount, Deposit.closed_at.is_not(None), Deposit.closed_at >= cutoff)
        .order_by(Deposit.id.desc())
    ).scalars().first()


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
            deposit = _find_deposit_for_amount(db, money(event.amount))
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
