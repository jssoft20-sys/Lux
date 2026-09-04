"""Deposits: creation with a unique exact amount, matching of payment events,
crediting through the cash desk API. Every state change is transactional and
idempotent; a payment confirmation can never be credited twice.
"""
from __future__ import annotations

import logging
import random
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import transaction
from ..models import BankLink, Deposit, PaymentCash, PaymentEvent, PaymentRequisite, User
from ..utils import as_utc, iso, money, new_public_id, utcnow
from . import cashes as cash_service
from . import elqr, settings_store
from .logs import log_event
from .notifications import admin_event, notify_user
from .users import apply_referral_reward, display_name

logger = logging.getLogger("onoipay.deposits")

ACTIVE = ("created", "processing")


class DepositError(Exception):
    def __init__(self, message: str, code: str = "DEPOSIT_ERROR", **extra: Any):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra


# ----------------------------------------------------------------------------- helpers

def choose_requisite(db: Session, cash: PaymentCash) -> PaymentRequisite | None:
    rows = db.execute(
        select(PaymentRequisite).where(PaymentRequisite.enabled.is_(True)).order_by(PaymentRequisite.priority.asc(), PaymentRequisite.id.asc())
    ).scalars().all()
    if not rows:
        return None
    pinned = [r for r in rows if r.cash_id == cash.id]
    pool = pinned or [r for r in rows if r.cash_id is None] or list(rows)
    top = pool[0].priority
    best = [r for r in pool if r.priority == top]
    return random.SystemRandom().choice(best)


def _used_amounts(db: Session, base: Decimal, cooldown_seconds: int) -> set[Decimal]:
    low, high = base, base + Decimal("0.99")
    cutoff = utcnow() - timedelta(seconds=cooldown_seconds)
    rows = db.execute(
        select(Deposit.pay_amount, Deposit.status, Deposit.updated_at).where(Deposit.pay_amount >= low, Deposit.pay_amount <= high)
    ).all()
    used: set[Decimal] = set()
    for amount, status, updated in rows:
        if status in ACTIVE or (as_utc(updated) or utcnow()) >= cutoff:
            used.add(money(amount))
    return used


def unique_pay_amount(db: Session, requested: Decimal) -> Decimal:
    base = money(requested)
    if not settings_store.get_bool(db, "random_tiyin", True):
        return base
    tmin = max(1, min(99, settings_store.get_int(db, "tiyin_min", 1)))
    tmax = max(tmin, min(99, settings_store.get_int(db, "tiyin_max", 99)))
    used = _used_amounts(db, base, settings_store.get_int(db, "amount_reuse_cooldown_seconds", 120))
    candidates = [base + Decimal(i) / 100 for i in range(tmin, tmax + 1)]
    random.SystemRandom().shuffle(candidates)
    for candidate in candidates:
        if money(candidate) not in used:
            return money(candidate)
    raise DepositError("Все свободные суммы заняты. Повторите через несколько минут.", "AMOUNT_BUSY")


def bank_link_rows(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(select(BankLink).order_by(BankLink.priority.asc())).scalars().all()
    return [
        {"key": r.key, "name": r.name, "prefix": r.prefix, "kind": r.kind, "enabled": r.enabled, "priority": r.priority, "encode_payload": r.encode_payload}
        for r in rows
    ]


def payment_methods(db: Session, deposit: Deposit) -> list[dict[str, Any]]:
    try:
        return elqr.bank_links(deposit.qr_payload, bank_link_rows(db))
    except Exception:
        return []


def qr_enabled(db: Session) -> bool:
    row = db.execute(select(BankLink).where(BankLink.key == "qr")).scalar_one_or_none()
    return bool(row is None or row.enabled)


# ----------------------------------------------------------------------------- creation

def create_deposit(
    db: Session,
    *,
    user: User,
    cash: PaymentCash,
    player_id: str,
    amount: Any,
    idempotency_key: str,
    player_name: str = "",
    source: str = "telegram",
) -> tuple[Deposit, bool]:
    """Create a deposit request. Returns ``(deposit, created)``; a repeated
    ``idempotency_key`` returns the existing row without side effects."""
    existing = db.execute(select(Deposit).where(Deposit.idempotency_key == idempotency_key)).scalar_one_or_none()
    if existing:
        return existing, False
    reason = cash_service.deposit_available(db, cash)
    if reason:
        raise DepositError(reason, "DEPOSITS_DISABLED")
    if user.is_blocked:
        raise DepositError("Ваша учётная запись заблокирована. Если это ошибка, напишите в поддержку.", "USER_BLOCKED")
    player_id = "".join(ch for ch in str(player_id or "") if ch.isdigit())
    if not player_id:
        raise DepositError("Введите корректный ID счёта цифрами.", "BAD_PLAYER_ID")
    try:
        requested = money(amount)
    except Exception:
        raise DepositError("Введите корректную сумму", "BAD_AMOUNT")
    if requested != requested.to_integral_value():
        raise DepositError("Введите сумму без тыйынов — точную сумму система сформирует сама.", "BAD_AMOUNT")
    minimum, maximum = money(cash.deposit_min), money(cash.deposit_max)
    if requested < minimum or requested > maximum:
        raise DepositError(
            f"Сумма пополнения для {cash.name}: от {minimum:.0f} до {maximum:.0f} {cash.currency}",
            "AMOUNT_LIMITS",
            min_amount=str(minimum),
            max_amount=str(maximum),
        )
    max_active = settings_store.get_int(db, "deposit_max_active_per_user", 1)
    if max_active > 0:
        active = db.execute(select(Deposit).where(Deposit.user_id == user.id, Deposit.status == "created")).scalars().all()
        if len(active) >= max_active:
            raise DepositError("У вас уже есть активная заявка на пополнение. Оплатите её или отмените.", "ACTIVE_EXISTS", request_id=active[0].public_id)
    requisite = choose_requisite(db, cash)
    if requisite is None:
        raise DepositError("Пополнение временно недоступно: нет активного реквизита", "NO_REQUISITE")
    timeout = max(60, settings_store.get_int(db, "payment_timeout_seconds", 300))
    last_error: Exception | None = None
    for _attempt in range(5):
        pay_amount = unique_pay_amount(db, requested)
        try:
            payload = elqr.inject_amount(requisite.payload, pay_amount)
        except Exception as exc:
            raise DepositError(f"Не удалось сформировать QR: {str(exc)[:160]}", "QR_ERROR")
        deposit = Deposit(
            public_id=new_public_id("D"),
            user_id=user.id,
            cash_id=cash.id,
            requisite_id=requisite.id,
            player_id=player_id,
            player_name=(player_name or "")[:160],
            amount=requested,
            pay_amount=pay_amount,
            currency=cash.currency,
            status="created",
            qr_payload=payload,
            idempotency_key=idempotency_key,
            expires_at=utcnow() + timedelta(seconds=timeout),
            source=source,
        )
        db.add(deposit)
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError as exc:
            last_error = exc
            db.expunge(deposit)
            existing = db.execute(select(Deposit).where(Deposit.idempotency_key == idempotency_key)).scalar_one_or_none()
            if existing:
                return existing, False
            continue  # amount collided with a concurrent request — pick another tiyin
        user.deposits_count = int(user.deposits_count or 0) + 1
        db.flush()
        log_event(db, "Создано пополнение", f"{cash.name} • ID {player_id} • {pay_amount} {cash.currency} • {display_name(user)}", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
        admin_event(
            db,
            "deposit_new",
            f"deposit_new:{deposit.id}",
            "💰 Новое пополнение",
            f"{cash.name} • {pay_amount} {cash.currency} • ID {player_id} • {display_name(user)}",
            {"deposit_id": deposit.id, "public_id": deposit.public_id, "url": f"#/deposits/{deposit.id}"},
        )
        return deposit, True
    raise DepositError("Не удалось подобрать уникальную сумму, попробуйте ещё раз.", "AMOUNT_BUSY") from last_error


def cancel_deposit(db: Session, deposit: Deposit, *, reason: str = "user_cancelled", actor: str = "user", operator_id: int | None = None) -> bool:
    if deposit.status != "created":
        return False
    deposit.status = "cancelled"
    deposit.error = reason[:600]
    deposit.closed_at = utcnow()
    deposit.operator_id = operator_id
    db.flush()
    log_event(db, "Пополнение отменено", f"{deposit.public_id} • {reason} • {actor}", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
    return True


def expire_deposits(db: Session) -> list[Deposit]:
    now = utcnow()
    rows = db.execute(select(Deposit).where(Deposit.status == "created", Deposit.expires_at.is_not(None), Deposit.expires_at <= now)).scalars().all()
    expired: list[Deposit] = []
    for deposit in rows:
        deposit.status = "expired"
        deposit.error = "Время оплаты истекло"
        deposit.closed_at = now
        expired.append(deposit)
        notify_user(
            db,
            deposit.user_id and db.get(User, deposit.user_id),
            event="deposit_expired",
            event_key=f"deposit_expired:{deposit.id}",
            text="⏰ Время оплаты истекло, заявка на пополнение закрыта.\n\n❌ Не переводите деньги по старым реквизитам.\nНажмите «Пополнить», чтобы создать новую заявку.",
            data={"request_id": deposit.public_id, "final": "expired", "replace": True},
        )
    db.flush()
    return expired


# -------------------------------------------------------------------------- crediting

def _claim_for_processing(db: Session, deposit: Deposit, source: str, event_id: int | None) -> bool:
    if deposit.status not in {"created", "expired", "failed"}:
        return False
    deposit.status = "processing"
    deposit.processing_started_at = utcnow()
    deposit.payment_source = source
    if event_id:
        deposit.payment_event_id = event_id
    deposit.error = ""
    db.flush()
    return True


def _finalize_success(db: Session, deposit_id: int, result_data: Any, reference: str, source: str) -> Deposit:
    deposit = db.get(Deposit, deposit_id)
    assert deposit is not None
    if deposit.status != "processing":
        return deposit
    now = utcnow()
    deposit.status = "success"
    deposit.paid_at = deposit.paid_at or now
    deposit.credited_at = now
    deposit.closed_at = now
    deposit.provider_ref = (reference or "")[:128]
    deposit.provider_response = result_data if isinstance(result_data, dict) else {"data": result_data}
    deposit.error = ""
    db.flush()
    seconds = max(1, int((now - as_utc(deposit.processing_started_at or now)).total_seconds()))
    user = db.get(User, deposit.user_id)
    cash = db.get(PaymentCash, deposit.cash_id)
    text = (
        "✅ Пополнение успешно зачислено!\n\n"
        f"🎰 Касса: {cash.name if cash else ''}\n"
        f"🆔 ID: {deposit.player_id}\n"
        f"💰 Зачислено: {money(deposit.pay_amount)} {deposit.currency}\n\n"
        f"⏱ Обработка: {seconds} сек"
    )
    notify_user(
        db,
        user,
        event="deposit_success",
        event_key=f"deposit_success:{deposit.id}",
        text=text,
        data={"request_id": deposit.public_id, "final": "success", "replace": True},
        supersede_event_keys=[f"deposit_expired:{deposit.id}"],
    )
    deposit.notified_final = True
    log_event(db, "Оплата подтверждена и зачислена", f"{deposit.public_id} • {source} • {money(deposit.pay_amount)} {deposit.currency} • {seconds} сек", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
    admin_event(db, "deposit_success", f"deposit_success:{deposit.id}", "✅ Пополнение зачислено", f"{cash.name if cash else ''} • {money(deposit.pay_amount)} {deposit.currency} • ID {deposit.player_id}", {"deposit_id": deposit.id, "url": f"#/deposits/{deposit.id}"})
    try:
        apply_referral_reward(db, deposit)
    except Exception as exc:  # never break a credit because of a bonus
        logger.warning("referral reward failed for %s: %s", deposit.public_id, exc)
    return deposit


def _finalize_failure(db: Session, deposit_id: int, message: str, result_data: Any) -> Deposit:
    deposit = db.get(Deposit, deposit_id)
    assert deposit is not None
    if deposit.status != "processing":
        return deposit
    deposit.status = "failed"
    deposit.error = (message or "provider_error")[:600]
    deposit.provider_response = result_data if isinstance(result_data, dict) else {"data": result_data}
    deposit.paid_at = deposit.paid_at or utcnow()
    db.flush()
    cash = db.get(PaymentCash, deposit.cash_id)
    log_event(db, "Ошибка зачисления", f"{deposit.public_id} • {message}", level="error", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
    admin_event(db, "deposit_failed", f"deposit_failed:{deposit.id}:{deposit.updated_at:%Y%m%d%H%M%S}", "⚠️ Ошибка зачисления", f"{cash.name if cash else ''} • {money(deposit.pay_amount)} • ID {deposit.player_id} • {message}", {"deposit_id": deposit.id, "url": f"#/deposits/{deposit.id}"}, level="critical")
    return deposit


def credit_deposit(deposit_id: int, *, source: str, event_id: int | None = None, operator_id: int | None = None, actor: str = "system") -> dict[str, Any]:
    """Credit a paid deposit in the cash desk. Safe to call concurrently: the
    state transition ``created/expired/failed -> processing`` is done in its own
    transaction and only one caller wins."""
    with transaction() as db:
        deposit = db.get(Deposit, deposit_id)
        if deposit is None:
            return {"ok": False, "message": "Заявка не найдена"}
        if deposit.status == "success":
            return {"ok": True, "already": True, "request_id": deposit.public_id}
        if not _claim_for_processing(db, deposit, source, event_id):
            return {"ok": False, "message": f"Заявка уже обрабатывается или закрыта ({deposit.status})", "status": deposit.status}
        if operator_id:
            deposit.operator_id = operator_id
        cash = db.get(PaymentCash, deposit.cash_id)
        credentials = cash_service.credentials(cash)
        player_id, amount = deposit.player_id, money(deposit.pay_amount)
        if event_id:
            event = db.get(PaymentEvent, event_id)
            if event and event.status != "matched":
                event.status = "processing"
                event.deposit_id = deposit.id
        cash_snapshot = cash
    # network call outside of any transaction
    try:
        adapter = cash_service.get_adapter(cash_snapshot, credentials)
        result = adapter.deposit(player_id, amount)
    except Exception as exc:
        logger.exception("provider deposit failed")
        from ..providers import ProviderResult

        result = ProviderResult(ok=False, message=f"Ошибка кассы: {str(exc)[:200]}")
    with transaction() as db:
        log_event(
            db,
            "API кассы • Пополнение",
            f"{cash_snapshot.name} • {'Принято' if result.ok or result.duplicate else 'Отклонено'} • HTTP {result.status or '—'} • {amount} • ID {player_id} • {result.message}",
            level="info" if (result.ok or result.duplicate) else "error",
            category="provider",
            entity_type="deposit",
            entity_id=deposit_id,
        )
        if result.ok or result.duplicate:
            deposit = _finalize_success(db, deposit_id, result.data, result.reference, source)
            if event_id:
                event = db.get(PaymentEvent, event_id)
                if event:
                    event.status = "matched"
                    event.processed_at = utcnow()
                    event.deposit_id = deposit.id
            return {"ok": True, "request_id": deposit.public_id, "duplicate": result.duplicate}
        deposit = _finalize_failure(db, deposit_id, result.message, result.data)
        if event_id:
            event = db.get(PaymentEvent, event_id)
            if event:
                event.status = "failed"
                event.error = (result.message or "")[:400]
                event.processed_at = utcnow()
                event.deposit_id = deposit.id
        return {"ok": False, "message": result.message, "request_id": deposit.public_id}


def mark_success_manual(db: Session, deposit: Deposit, operator_id: int | None, reason: str = "") -> bool:
    """Operator confirms the deposit was credited outside the API (no provider call)."""
    if deposit.status == "success":
        return False
    deposit.status = "success"
    deposit.paid_at = deposit.paid_at or utcnow()
    deposit.credited_at = utcnow()
    deposit.closed_at = utcnow()
    deposit.operator_id = operator_id
    deposit.error = ""
    deposit.payment_source = deposit.payment_source or "manual"
    db.flush()
    cash = db.get(PaymentCash, deposit.cash_id)
    notify_user(
        db,
        db.get(User, deposit.user_id),
        event="deposit_success",
        event_key=f"deposit_success:{deposit.id}",
        text=f"✅ Пополнение зачислено!\n\n🎰 Касса: {cash.name if cash else ''}\n🆔 ID: {deposit.player_id}\n💰 Зачислено: {money(deposit.pay_amount)} {deposit.currency}",
        data={"request_id": deposit.public_id, "final": "success", "replace": True},
    )
    log_event(db, "Пополнение подтверждено вручную", f"{deposit.public_id} • {reason}", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
    return True


def reject_deposit(db: Session, deposit: Deposit, operator_id: int | None, reason: str = "") -> bool:
    if deposit.status in {"success", "cancelled"}:
        return False
    deposit.status = "cancelled"
    deposit.error = (reason or "Отклонено оператором")[:600]
    deposit.closed_at = utcnow()
    deposit.operator_id = operator_id
    db.flush()
    notify_user(
        db,
        db.get(User, deposit.user_id),
        event="deposit_rejected",
        event_key=f"deposit_rejected:{deposit.id}",
        text="❌ Заявка на пополнение отклонена." + (f"\nПричина: {reason}" if reason else " Если нужна проверка — напишите в поддержку."),
        data={"request_id": deposit.public_id, "final": "cancelled", "replace": True},
    )
    log_event(db, "Пополнение отклонено", f"{deposit.public_id} • {reason}", level="warning", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
    return True


# ---------------------------------------------------------------------------- output

STATUS_LABELS = {
    "created": "Ожидает оплаты",
    "processing": "Зачисляется",
    "success": "Зачислено",
    "failed": "Ошибка",
    "cancelled": "Отменено",
    "expired": "Истекло",
}


def public_deposit(db: Session, deposit: Deposit, *, full: bool = False) -> dict[str, Any]:
    user = deposit.user
    cash = deposit.cash
    out = {
        "id": deposit.id,
        "public_id": deposit.public_id,
        "kind": "deposit",
        "status": deposit.status,
        "status_label": STATUS_LABELS.get(deposit.status, deposit.status),
        "amount": str(money(deposit.amount)),
        "pay_amount": str(money(deposit.pay_amount)),
        "currency": deposit.currency,
        "player_id": deposit.player_id,
        "player_name": deposit.player_name,
        "cash_id": deposit.cash_id,
        "cash_key": cash.key if cash else "",
        "cash_name": cash.name if cash else "",
        "user_id": deposit.user_id,
        "telegram_id": user.telegram_id if user else 0,
        "user_name": display_name(user) if user else "",
        "username": user.username if user else "",
        "payment_source": deposit.payment_source,
        "provider_ref": deposit.provider_ref,
        "error": deposit.error,
        "source": deposit.source,
        "created_at": iso(deposit.created_at),
        "updated_at": iso(deposit.updated_at),
        "expires_at": iso(deposit.expires_at),
        "paid_at": iso(deposit.paid_at),
        "credited_at": iso(deposit.credited_at),
        "closed_at": iso(deposit.closed_at),
        "operator_id": deposit.operator_id,
    }
    if full:
        out["qr_payload"] = deposit.qr_payload
        out["payment_methods"] = payment_methods(db, deposit)
        out["provider_response"] = deposit.provider_response
        out["payment_event_id"] = deposit.payment_event_id
        out["requisite_id"] = deposit.requisite_id
    return out
