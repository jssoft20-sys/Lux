"""Automatic payouts: send validated client withdrawals from the owner banking account.

Today an operator reads the amount the bookmaker returned and pushes that money to the
client's Elcart card / bank QR by hand in Optima24. This engine does the same call through
the payout provider (:mod:`paygo.payouts`), so a withdrawal that is ready and within the
safety limits is paid without an operator.

Safety model (every guard is deliberate — this moves real money):

* **Off by default.** Runs only when ``PAYOUT_PROVIDER`` is set in the environment *and*
  ``autopay_enabled`` is on in the panel.
* **Dry-run by default.** With ``autopay_dry_run`` on, it records what it *would* send and
  moves nothing. Turn it off only after a real test transfer.
* **Idempotent.** A withdrawal is claimed (``created`` → ``processing``) in one transaction
  before the network call; the provider is asked to pay under a stable reference
  (``public_id``). A transfer that times out mid-flight is marked for a human, never resent.
* **Bounded.** Per-payout ceiling, per-day cap, a balance floor to never drain the account,
  and an age limit so a stale request goes to an operator instead.
* **Loud when empty.** Below the low-balance threshold the owner is told to top up Optima24;
  below the floor, sending pauses until it is topped up.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import transaction
from ..models import Withdrawal
from ..payouts import PayoutError, PayoutProvider, PayoutResult, PayoutTarget, provider_from_settings
from ..utils import iso, money, utcnow
from . import elqr, settings_store
from .logs import log_event
from .notifications import admin_event
from .withdrawals import complete as complete_withdrawal
from .withdrawals import public_withdrawal

logger = logging.getLogger("paygo.autopay")

# provider + balance caches (autopay runs on one worker thread; the manual API path may also
# call in, so every shared read/write is under this lock)
_LOCK = threading.Lock()
_PROVIDER: PayoutProvider | None = None
_PROVIDER_NAME: str = ""
_BALANCE: Decimal | None = None
_BALANCE_AT: float = 0.0
_BALANCE_TTL = 30.0
# monotonic time of the last real transfer attempt — the engine never sends faster than
# ``autopay_min_interval_seconds`` so it does not flood the bank (Optima asked for 15-20s)
_LAST_SENT_AT: float = 0.0

# autopay states stored under withdrawal.provider_response["autopay"]
_HANDLED_STATES = {"sending", "sent", "pending", "ambiguous", "duplicate"}


class Config:
    """A snapshot of the autopay knobs for one run."""

    def __init__(self, db: Session):
        s = get_settings()
        self.provider_name = s.payout_provider_name
        self.provider_configured = s.payout_configured
        self.enabled = settings_store.get_bool(db, "autopay_enabled", False)
        self.dry_run = settings_store.get_bool(db, "autopay_dry_run", True)
        self.max_amount = money(settings_store.get(db, "autopay_max_amount", 15000))
        self.daily_cap = money(settings_store.get(db, "autopay_daily_cap", 300000))
        self.min_reserve = money(settings_store.get(db, "autopay_min_reserve", 500))
        self.low_balance = money(settings_store.get(db, "autopay_low_balance", 20000))
        self.require_qr = settings_store.get_bool(db, "autopay_require_decoded_qr", True)
        self.max_age_minutes = settings_store.get_int(db, "autopay_max_age_minutes", 180)
        self.min_interval = settings_store.get_int(db, "autopay_min_interval_seconds", 18)

    @property
    def active(self) -> bool:
        return bool(self.enabled and self.provider_name and self.provider_configured)


# --------------------------------------------------------------------------- provider

def _provider() -> PayoutProvider | None:
    """Return the configured provider, rebuilding it when the channel changes."""
    global _PROVIDER, _PROVIDER_NAME
    settings = get_settings()
    name = settings.payout_provider_name
    with _LOCK:
        if not name:
            _PROVIDER, _PROVIDER_NAME = None, ""
            return None
        if _PROVIDER is None or _PROVIDER_NAME != name:
            _PROVIDER = provider_from_settings(settings)
            _PROVIDER_NAME = name
        return _PROVIDER


def reset_provider() -> None:
    """Drop the cached provider/session (after changing credentials or on a fresh login)."""
    global _PROVIDER, _PROVIDER_NAME, _BALANCE, _BALANCE_AT, _LAST_SENT_AT
    with _LOCK:
        _PROVIDER, _PROVIDER_NAME, _BALANCE, _BALANCE_AT, _LAST_SENT_AT = None, "", None, 0.0, 0.0


def _seconds_since_send() -> float:
    import time

    with _LOCK:
        last = _LAST_SENT_AT
    return time.monotonic() - last if last else 1e9


def _mark_sent() -> None:
    """Record that a transfer was just attempted, so the next one waits out the interval."""
    global _LAST_SENT_AT
    import time

    with _LOCK:
        _LAST_SENT_AT = time.monotonic()


def _cached_balance(provider: PayoutProvider, *, force: bool = False) -> Decimal | None:
    global _BALANCE, _BALANCE_AT
    import time

    now = time.monotonic()
    with _LOCK:
        if not force and _BALANCE is not None and now - _BALANCE_AT < _BALANCE_TTL:
            return _BALANCE
    try:
        value = provider.get_balance()
    except PayoutError as exc:
        logger.warning("autopay: balance unavailable: %s", exc)
        return None
    with _LOCK:
        _BALANCE, _BALANCE_AT = value, now
    return value


def _remember_balance(value: Decimal | None) -> None:
    global _BALANCE, _BALANCE_AT
    import time

    if value is None:
        return
    with _LOCK:
        _BALANCE, _BALANCE_AT = value, time.monotonic()


# --------------------------------------------------------------------------- targets

def build_target(w: Withdrawal) -> PayoutTarget:
    """Construct a payout target from a withdrawal, decoding the destination QR when present."""
    card = holder = bank = ""
    source = w.qr_payload or w.qr_file_url
    if source:
        try:
            meta = elqr.bank_meta(source)
            card, holder, bank = meta.get("account", ""), meta.get("holder", ""), meta.get("bank_name", "")
        except Exception:
            pass
    return PayoutTarget(
        amount=money(w.amount),
        currency=w.currency,
        reference=w.public_id,
        public_id=w.public_id,
        withdrawal_id=w.id,
        qr_payload=w.generated_qr_payload or w.qr_payload,
        card=card,
        holder=holder,
        bank=bank,
        player_id=w.player_id,
    )


def _autopay_state(w: Withdrawal) -> dict[str, Any]:
    data = w.provider_response if isinstance(w.provider_response, dict) else {}
    state = data.get("autopay")
    return state if isinstance(state, dict) else {}


def _set_autopay(w: Withdrawal, **fields: Any) -> None:
    data = dict(w.provider_response) if isinstance(w.provider_response, dict) else {}
    current = data.get("autopay") if isinstance(data.get("autopay"), dict) else {}
    current = {**current, **fields, "at": iso(utcnow())}
    data["autopay"] = current
    w.provider_response = data  # reassign so SQLAlchemy sees the JSON change


def _has_destination(w: Withdrawal) -> bool:
    if w.generated_qr_payload or w.qr_payload:
        return True
    try:
        return bool(elqr.bank_meta(w.qr_file_url).get("account")) if w.qr_file_url else False
    except Exception:
        return False


# --------------------------------------------------------------------------- daily cap

def _today_bounds() -> datetime:
    settings = get_settings()
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(settings.timezone)
    except Exception:  # pragma: no cover - tz db missing
        tz = timezone.utc
    now_local = utcnow().astimezone(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(timezone.utc)


def _today_autopay_total(db: Session) -> Decimal:
    start = _today_bounds()
    rows = db.execute(
        select(Withdrawal).where(Withdrawal.status == "success", Withdrawal.completed_at >= start)
    ).scalars().all()
    total = Decimal("0")
    for w in rows:
        if _autopay_state(w).get("state") in {"sent", "duplicate"}:
            total += money(w.amount)
    return total


# --------------------------------------------------------------------------- one payout

def _claim(db: Session, withdrawal_id: int, provider_name: str) -> Withdrawal | None:
    """Atomically move a ready withdrawal to ``processing`` so nothing else can pay it."""
    w = db.get(Withdrawal, withdrawal_id)
    if w is None or w.status != "created":
        return None
    if _autopay_state(w).get("state") in _HANDLED_STATES:
        return None
    w.status = "processing"
    w.processing_started_at = utcnow()
    _set_autopay(w, state="sending", provider=provider_name)
    db.flush()
    return w


def _settle(withdrawal_id: int, result: PayoutResult, operator_id: int | None) -> None:
    """Record a transfer outcome and complete / flag the withdrawal accordingly."""
    with transaction() as db:
        w = db.get(Withdrawal, withdrawal_id)
        if w is None:
            return
        cash_name = w.cash.name if w.cash else ""
        if result.status in {"sent", "duplicate"}:
            _set_autopay(w, state=result.status, reference=result.reference, message=result.message)
            db.flush()
            complete_withdrawal(db, w, operator_id, auto_ref=result.reference or w.public_id)
            log_event(db, "Автовыплата отправлена", f"{w.public_id} • {money(w.amount)} {w.currency} • {cash_name} • ref {result.reference or '—'}",
                      category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
        elif result.status == "pending":
            _set_autopay(w, state="pending", reference=result.reference, message=result.message)
            w.needs_attention = False
            db.flush()
            log_event(db, "Автовыплата в обработке банка", f"{w.public_id} • ref {result.reference or '—'}",
                      category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
        elif result.acknowledged:
            # ambiguous: the transfer may have gone through — never resend, ask a human
            _set_autopay(w, state="ambiguous", reference=result.reference, message=result.message)
            w.needs_attention = True
            w.error = "Автовыплата отправлена, но банк не подтвердил. Проверьте в Optima24 перед повторной отправкой."
            db.flush()
            admin_event(db, "autopay_failed", f"autopay_ambiguous:{w.id}", "⚠️ Автовыплата без подтверждения",
                        f"{w.public_id} • {money(w.amount)} {w.currency} • проверьте Optima24", {"withdrawal_id": w.id, "url": f"#/withdrawals/{w.id}"}, level="critical")
            log_event(db, "Автовыплата без подтверждения", f"{w.public_id} • {result.message}", level="error",
                      category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
        else:
            # clean failure: hand back to an operator
            _set_autopay(w, state="failed", message=result.message)
            w.status = "created"
            w.needs_attention = True
            w.error = (f"Автовыплата не удалась: {result.message}")[:600]
            db.flush()
            admin_event(db, "autopay_failed", f"autopay_failed:{w.id}:{int(utcnow().timestamp())//300}", "⚠️ Автовыплата не удалась",
                        f"{w.public_id} • {money(w.amount)} {w.currency} • {result.message}", {"withdrawal_id": w.id, "url": f"#/withdrawals/{w.id}"}, level="critical")
            log_event(db, "Автовыплата не удалась", f"{w.public_id} • {result.message}", level="warning",
                      category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
    _remember_balance(result.balance)


def pay_withdrawal(withdrawal_id: int, operator_id: int | None = None, *, force: bool = False, dry_run: bool | None = None) -> dict[str, Any]:
    """Pay one withdrawal now. Used by the worker loop and the operator's manual button.

    ``force`` skips the per-payout ceiling and age gate (an operator chose this one) but
    never skips the balance floor or the dry-run guard.
    """
    provider = _provider()
    if provider is None:
        return {"ok": False, "message": "Платёжный канал не настроен (PAYOUT_PROVIDER)."}
    with transaction() as db:
        cfg = Config(db)
        w = db.get(Withdrawal, withdrawal_id)
        if w is None:
            return {"ok": False, "message": "Заявка не найдена"}
        if w.status not in {"created", "processing"}:
            return {"ok": False, "message": f"Вывод в статусе «{w.status}» — автовыплата недоступна"}
        if money(w.amount) <= 0:
            return {"ok": False, "message": "У вывода нет суммы — сначала перепроверьте код"}
        if _autopay_state(w).get("state") in _HANDLED_STATES:
            return {"ok": False, "message": "Автовыплата по этой заявке уже выполняется/выполнена"}
        if not _has_destination(w):
            return {"ok": False, "message": "Нет реквизитов получателя (QR/карта)"}
        if not force and money(w.amount) > cfg.max_amount > 0:
            return {"ok": False, "message": f"Сумма больше лимита автовыплаты ({cfg.max_amount}). Отправьте вручную."}
        target = build_target(w)
        public = public_withdrawal(w)
    use_dry_run = cfg.dry_run if dry_run is None else dry_run

    # balance floor (never drain the account); dry-run still reports it
    balance = _cached_balance(provider)
    if balance is not None and cfg.min_reserve >= 0 and balance - money(w.amount) < cfg.min_reserve:
        with transaction() as db:
            _notify_low_balance(db, balance, cfg, blocking=True)
        return {"ok": False, "message": f"Недостаточно средств на Optima24 (баланс {balance}). Пополните счёт.", "withdrawal": public}

    if use_dry_run:
        with transaction() as db:
            w = db.get(Withdrawal, withdrawal_id)
            if w is not None and _autopay_state(w).get("state") != "dryrun":
                _set_autopay(w, state="dryrun", message=f"тест: отправили бы {money(w.amount)} {w.currency} → {target.card or 'QR'}")
                db.flush()
                log_event(db, "Автовыплата (тест)", f"{w.public_id} • отправили бы {money(w.amount)} {w.currency} → {target.card or 'QR'}",
                          category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
        return {"ok": True, "dry_run": True, "message": f"Тест: отправили бы {money(w.amount)} {target.currency} на {target.card or 'QR'}", "withdrawal": public}

    # claim, then pay outside the transaction
    with transaction() as db:
        claimed = _claim(db, withdrawal_id, provider.name)
        if claimed is None:
            return {"ok": False, "message": "Заявку не удалось взять в автовыплату (уже в работе)"}
    _mark_sent()  # count the bank-friendly interval from this attempt (success or not)
    try:
        result = provider.pay(target)
    except PayoutError as exc:
        result = PayoutResult(ok=False, status="failed", message=str(exc))
    except Exception as exc:  # unexpected — treat as ambiguous, never resend
        logger.exception("autopay pay() crashed")
        result = PayoutResult(ok=False, status="failed", acknowledged=True, message=f"{type(exc).__name__}: {exc}")
    _settle(withdrawal_id, result, operator_id)
    with transaction() as db:
        fresh = db.get(Withdrawal, withdrawal_id)
        return {"ok": result.ok, "status": result.status, "message": result.message,
                "withdrawal": public_withdrawal(fresh) if fresh else public}


# --------------------------------------------------------------------------- balance guard

def _notify_low_balance(db: Session, balance: Decimal, cfg: Config, *, blocking: bool) -> None:
    hour_key = int(utcnow().timestamp()) // 3600
    title = "🚫 Optima24: недостаточно средств" if blocking else "⚠️ Optima24: низкий баланс"
    body = f"Баланс {balance} — пополните Optima24 с Optima Business, иначе автовыплаты стоят."
    admin_event(db, "autopay_balance", f"autopay_balance:{hour_key}", title, body, {"url": "#/manage"}, level="critical")


# --------------------------------------------------------------------------- worker tick

def run_once() -> dict[str, Any]:
    """One scan: pay every ready withdrawal within the limits. Called by the worker loop."""
    provider = _provider()
    with transaction() as db:
        cfg = Config(db)
    if provider is None or not cfg.active:
        return {"active": False}

    # balance first: warn / pause on low funds
    balance = _cached_balance(provider, force=True)
    if balance is not None and balance < cfg.low_balance:
        with transaction() as db:
            _notify_low_balance(db, balance, cfg, blocking=balance < cfg.min_reserve)
    if balance is not None and balance < cfg.min_reserve:
        return {"active": True, "balance": str(balance), "paused": "low_balance"}

    with transaction() as db:
        spent_today = _today_autopay_total(db)
        ids = [c.id for c in _candidates(db, cfg)]

    bal = str(balance) if balance is not None else None
    if not ids:
        return {"active": True, "balance": bal, "sent": 0, "scanned": 0}

    # dry-run marks every candidate at once — nothing reaches the bank, so no pacing needed
    if cfg.dry_run:
        for wid in ids:
            pay_withdrawal(wid, operator_id=None)
        return {"active": True, "dry_run": True, "scanned": len(ids)}

    # live mode: never faster than the bank-friendly interval — at most one transfer per tick
    since = _seconds_since_send()
    if since < cfg.min_interval:
        return {"active": True, "balance": bal, "scanned": len(ids), "throttled_for": round(cfg.min_interval - since, 1)}

    for withdrawal_id in ids:
        with transaction() as db:
            w = db.get(Withdrawal, withdrawal_id)
            if w is None or w.status != "created":
                continue
            amount = money(w.amount)
        if cfg.daily_cap > 0 and spent_today + amount > cfg.daily_cap:
            continue  # over today's cap — no bank request, keep scanning for one that fits
        result = pay_withdrawal(withdrawal_id, operator_id=None)  # this attempt records the interval
        sent = 1 if (result.get("ok") and not result.get("dry_run")) else 0
        return {"active": True, "balance": bal, "sent": sent, "scanned": len(ids), "status": result.get("status")}
    return {"active": True, "balance": bal, "sent": 0, "scanned": len(ids), "skipped": "daily_cap"}


def _candidates(db: Session, cfg: Config) -> list[Withdrawal]:
    cutoff = utcnow() - timedelta(minutes=cfg.max_age_minutes) if cfg.max_age_minutes > 0 else None
    rows = db.execute(
        select(Withdrawal).where(
            Withdrawal.status == "created",
            Withdrawal.amount > 0,
            Withdrawal.needs_attention.is_(False),
            Withdrawal.deferred.is_(False),
        ).order_by(Withdrawal.id.asc()).limit(25)
    ).scalars().all()
    out: list[Withdrawal] = []
    for w in rows:
        if cutoff is not None and w.created_at and w.created_at.replace(tzinfo=w.created_at.tzinfo or timezone.utc) < cutoff:
            continue
        if _autopay_state(w).get("state") in _HANDLED_STATES:
            continue
        if cfg.max_amount > 0 and money(w.amount) > cfg.max_amount:
            continue
        if cfg.require_qr and not _has_destination(w):
            continue
        out.append(w)
    return out


# --------------------------------------------------------------------------- status (admin)

def is_active(db: Session) -> bool:
    """Cheap check (no network) — is the payout engine configured and switched on?"""
    return Config(db).active


def status(db: Session) -> dict[str, Any]:
    settings = get_settings()
    cfg = Config(db)
    provider = _provider()
    balance = None
    if provider is not None:
        balance = _cached_balance(provider)
    pending = len(_candidates(db, cfg)) if cfg.active else 0
    return {
        "provider": cfg.provider_name or "",
        "configured": cfg.provider_configured,
        "enabled": cfg.enabled,
        "active": cfg.active,
        "dry_run": cfg.dry_run,
        "base_url": settings.optima24_base_url if cfg.provider_name == "optima24" else "",
        "balance": str(balance) if balance is not None else None,
        "spent_today": str(_today_autopay_total(db)),
        "pending_candidates": pending,
        "limits": {
            "max_amount": str(cfg.max_amount),
            "daily_cap": str(cfg.daily_cap),
            "min_reserve": str(cfg.min_reserve),
            "low_balance": str(cfg.low_balance),
            "max_age_minutes": cfg.max_age_minutes,
            "min_interval_seconds": cfg.min_interval,
        },
        "next_send_in": max(0, round(cfg.min_interval - _seconds_since_send(), 1)) if cfg.active and not cfg.dry_run else 0,
    }
