"""Withdrawals: code validation in the cash desk, payout bookkeeping, operator actions."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import transaction
from ..models import PaymentCash, QrRecord, User, Withdrawal
from ..providers import ProviderResult
from ..utils import iso, money, new_public_id, utcnow
from . import cashes as cash_service
from . import elqr, settings_store
from .logs import log_event
from .notifications import admin_event, notify_user
from .users import display_name, touch_qr

logger = logging.getLogger("onoipay.withdrawals")


class WithdrawalError(Exception):
    def __init__(self, message: str, code: str = "WITHDRAWAL_ERROR", **extra: Any):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra


def _claim_key(cash: PaymentCash, player_id: str, code: str) -> str:
    return f"{cash.key}:{player_id}:{code}"[:160]


def find_duplicate(db: Session, cash: PaymentCash, player_id: str, code: str) -> Withdrawal | None:
    return db.execute(
        select(Withdrawal).where(
            Withdrawal.cash_id == cash.id,
            Withdrawal.player_id == player_id,
            Withdrawal.code == code,
            Withdrawal.status.in_(("created", "processing", "success")),
        ).order_by(Withdrawal.id.desc())
    ).scalars().first()


def create_withdrawal(
    *,
    user_id: int,
    cash_id: int,
    player_id: str,
    code: str,
    idempotency_key: str,
    qr_record_id: int | None = None,
    qr_file_url: str = "",
    player_name: str = "",
    source: str = "telegram",
) -> dict[str, Any]:
    """Validate the payout code in the cash desk and register the withdrawal.

    The row is inserted *before* the provider call under a unique claim key, so
    two concurrent submissions of the same code can never both reach the API.
    """
    with transaction() as db:
        user = db.get(User, user_id)
        cash = db.get(PaymentCash, cash_id)
        if user is None or cash is None:
            raise WithdrawalError("Пользователь или касса не найдены")
        existing = db.execute(select(Withdrawal).where(Withdrawal.idempotency_key == idempotency_key)).scalar_one_or_none()
        if existing:
            return {"ok": True, "duplicate": True, "withdrawal": public_withdrawal(existing), "message": "Заявка уже принята."}
        reason = cash_service.withdraw_available(db, cash)
        if reason:
            raise WithdrawalError(reason, "WITHDRAWALS_DISABLED")
        if user.is_blocked:
            raise WithdrawalError("Ваша учётная запись заблокирована. Если это ошибка, напишите в поддержку.", "USER_BLOCKED")
        player_id = "".join(ch for ch in str(player_id or "") if ch.isdigit())
        code = str(code or "").strip()
        min_len = settings_store.get_int(db, "withdraw_code_min_length", 4)
        if not player_id:
            raise WithdrawalError("Введите корректный ID счёта цифрами.", "BAD_PLAYER_ID")
        if len(code) < min_len or len(code) > 64:
            raise WithdrawalError("Введите корректный код вывода.", "BAD_CODE")
        dup = find_duplicate(db, cash, player_id, code)
        if dup:
            return {"ok": True, "duplicate": True, "withdrawal": public_withdrawal(dup), "message": "✅ Эта заявка на вывод уже принята. Повторно этот код отправлять не нужно."}
        qr = db.get(QrRecord, qr_record_id) if qr_record_id else None
        row = Withdrawal(
            public_id=new_public_id("W"),
            user_id=user.id,
            cash_id=cash.id,
            player_id=player_id,
            player_name=(player_name or "")[:160],
            currency=cash.currency,
            code=code,
            provider_claim_key=_claim_key(cash, player_id, code),
            qr_record_id=qr.id if qr else None,
            qr_file_url=(qr.file_url if qr else qr_file_url) or "",
            qr_payload=(qr.payload if qr else "") or "",
            status="created",
            idempotency_key=idempotency_key,
            source=source,
            needs_attention=False,
            error="",
        )
        db.add(row)
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            db.expunge(row)
            dup = find_duplicate(db, cash, player_id, code)
            if dup:
                return {"ok": True, "duplicate": True, "withdrawal": public_withdrawal(dup), "message": "✅ Эта заявка на вывод уже принята."}
            raise WithdrawalError("Заявка с таким кодом уже обрабатывается.", "DUPLICATE")
        withdrawal_id = row.id
        credentials = cash_service.credentials(cash)
        cash_snapshot = cash
        if qr:
            touch_qr(db, qr)
    # provider call outside the transaction
    try:
        result = cash_service.get_adapter(cash_snapshot, credentials).withdraw(player_id, code)
    except Exception as exc:
        logger.exception("provider withdraw failed")
        result = ProviderResult(ok=False, message=f"Ошибка кассы: {str(exc)[:200]}")
    with transaction() as db:
        row = db.get(Withdrawal, withdrawal_id)
        user = db.get(User, user_id)
        log_event(
            db,
            "API кассы • Вывод",
            f"{cash_snapshot.name} • HTTP {result.status or '—'} • {result.amount or 0} • ID {player_id} • {result.message}",
            level="info" if result.ok else "warning",
            category="provider",
            entity_type="withdrawal",
            entity_id=row.public_id,
        )
        if not result.ok and not result.acknowledged:
            # clean rejection: the code was not consumed — remove the placeholder row
            db.delete(row)
            db.flush()
            return {"ok": False, "message": result.message or "Вывод не найден или указан неверный код", "code": "PROVIDER_REJECTED"}
        row.provider_response = result.data if isinstance(result.data, dict) else {"data": result.data}
        row.provider_ref = (result.reference or code)[:128]
        row.amount = money(result.amount) if result.ok and result.amount else money(0)
        row.needs_attention = not result.ok
        row.error = "" if result.ok else (result.message or "Букмекер не вернул сумму вывода")[:600]
        if result.ok and row.qr_payload:
            try:
                row.generated_qr_payload = elqr.inject_amount(row.qr_payload, row.amount)
            except Exception:
                row.generated_qr_payload = ""
        user.withdrawals_count = int(user.withdrawals_count or 0) + 1
        db.flush()
        log_event(db, "Создан вывод", f"{cash_snapshot.name} • ID {player_id} • {row.amount} {row.currency} • {display_name(user)}", category="withdrawals", entity_type="withdrawal", entity_id=row.public_id)
        admin_event(
            db,
            "withdrawal_new",
            f"withdrawal_new:{row.id}",
            "💸 Новый вывод" if result.ok else "⚠️ Вывод требует внимания",
            f"{cash_snapshot.name} • {row.amount if result.ok else 'сумма не получена'} {row.currency} • ID {player_id} • {display_name(user)}",
            {"withdrawal_id": row.id, "url": f"#/withdrawals/{row.id}"},
            level="critical" if not result.ok else None,
        )
        if result.ok:
            message = (
                "✅ Заявка на вывод принята.\n\n"
                f"🎰 Касса: {cash_snapshot.name}\n"
                f"🆔 ID: {player_id}\n"
                f"💰 Сумма: {row.amount} {row.currency}\n\n"
                + str(settings_store.get(db, "withdraw_sla_text") or "")
            )
        else:
            message = (
                "⚠️ Код принят кассой, но сумма не получена. Заявка передана оператору — повторно код отправлять не нужно.\n\n"
                f"🎰 Касса: {cash_snapshot.name}\n🆔 ID: {player_id}"
            )
        return {"ok": True, "withdrawal": public_withdrawal(row), "message": message, "problem": not result.ok}


# ------------------------------------------------------------------- operator actions

def _final_notify(db: Session, w: Withdrawal, text: str, final: str) -> None:
    notify_user(db, db.get(User, w.user_id), event=f"withdrawal_{final}", event_key=f"withdrawal_{final}:{w.id}", text=text, data={"request_id": w.public_id, "final": final, "kind": "withdraw"})
    w.notified_final = True


def take(db: Session, w: Withdrawal, operator_id: int | None) -> bool:
    if w.status != "created":
        return False
    w.status = "processing"
    w.processing_started_at = utcnow()
    w.operator_id = operator_id
    db.flush()
    notify_user(db, db.get(User, w.user_id), event="withdrawal_processing", event_key=f"withdrawal_processing:{w.id}", text=f"⏳ Ваш вывод {w.amount} {w.currency} взят в обработку оператором.", data={"request_id": w.public_id, "kind": "withdraw"})
    log_event(db, "Вывод взят в обработку", w.public_id, category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
    return True


def complete(db: Session, w: Withdrawal, operator_id: int | None) -> bool:
    if w.status in {"success", "cancelled"}:
        return False
    if money(w.amount) <= 0:
        raise WithdrawalError("Нельзя завершить вывод без суммы. Сначала перепроверьте код в кассе.")
    w.status = "success"
    w.completed_at = utcnow()
    w.closed_at = utcnow()
    w.operator_id = operator_id
    w.needs_attention = False
    w.error = ""
    db.flush()
    cash = db.get(PaymentCash, w.cash_id)
    _final_notify(db, w, f"✅ Вывод выполнен!\n\n🎰 Касса: {cash.name if cash else ''}\n🆔 ID: {w.player_id}\n💰 Сумма: {money(w.amount)} {w.currency}\n\nДеньги отправлены на ваш банковский счёт.", "success")
    log_event(db, "Вывод выполнен", f"{w.public_id} • {money(w.amount)} {w.currency}", category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
    admin_event(db, "withdrawal_status", f"withdrawal_success:{w.id}", "✅ Вывод выполнен", f"{cash.name if cash else ''} • {money(w.amount)} {w.currency} • ID {w.player_id}", {"withdrawal_id": w.id, "url": f"#/withdrawals/{w.id}"})
    return True


def fail(db: Session, w: Withdrawal, operator_id: int | None, reason: str, *, cancel: bool = False) -> bool:
    if w.status in {"success", "cancelled"}:
        return False
    w.status = "cancelled" if cancel else "failed"
    w.error = (reason or ("Отменено" if cancel else "Ошибка"))[:600]
    w.closed_at = utcnow()
    w.operator_id = operator_id
    w.needs_attention = False
    w.deferred = False
    db.flush()
    _final_notify(db, w, "❌ Заявка на вывод отклонена." + (f"\nПричина: {reason}" if reason else " Если нужна проверка — напишите в поддержку."), "cancelled" if cancel else "failed")
    log_event(db, "Вывод отклонён" if cancel else "Ошибка вывода", f"{w.public_id} • {reason}", level="warning", category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
    admin_event(db, "withdrawal_status", f"withdrawal_{w.status}:{w.id}", "❌ Вывод отклонён", f"{w.public_id} • {reason}", {"withdrawal_id": w.id, "url": f"#/withdrawals/{w.id}"})
    return True


def defer(db: Session, w: Withdrawal, operator_id: int | None, deferred: bool) -> bool:
    if w.status not in {"created", "processing"}:
        return False
    w.deferred = deferred
    w.operator_id = operator_id
    db.flush()
    log_event(db, "Вывод отложен" if deferred else "Вывод возвращён в работу", w.public_id, category="withdrawals", entity_type="withdrawal", entity_id=w.public_id)
    return True


def retry_provider(withdrawal_id: int, operator_id: int | None) -> dict[str, Any]:
    """Re-validate the payout code for a withdrawal that has no amount yet."""
    with transaction() as db:
        w = db.get(Withdrawal, withdrawal_id)
        if w is None:
            raise WithdrawalError("Заявка не найдена")
        if w.status not in {"created", "processing", "failed"}:
            raise WithdrawalError("Перепроверка доступна только для незавершённого вывода")
        cash = db.get(PaymentCash, w.cash_id)
        credentials = cash_service.credentials(cash)
        player_id, code = w.player_id, w.code
    try:
        result = cash_service.get_adapter(cash, credentials).withdraw(player_id, code)
    except Exception as exc:
        result = ProviderResult(ok=False, message=f"Ошибка кассы: {str(exc)[:200]}")
    with transaction() as db:
        w = db.get(Withdrawal, withdrawal_id)
        w.provider_response = result.data if isinstance(result.data, dict) else {"data": result.data}
        w.operator_id = operator_id
        log_event(db, "API кассы • Перепроверка вывода", f"{cash.name} • HTTP {result.status or '—'} • {result.amount or 0} • {result.message}", level="info" if result.ok else "warning", category="provider", entity_type="withdrawal", entity_id=w.public_id)
        if result.ok and result.amount:
            w.amount = money(result.amount)
            w.provider_ref = (result.reference or code)[:128]
            w.needs_attention = False
            w.error = ""
            if w.status == "failed":
                w.status = "created"
                w.closed_at = None
            if w.qr_payload:
                try:
                    w.generated_qr_payload = elqr.inject_amount(w.qr_payload, w.amount)
                except Exception:
                    pass
            db.flush()
            return {"ok": True, "withdrawal": public_withdrawal(w)}
        if result.duplicate and money(w.amount) > 0:
            w.needs_attention = False
            db.flush()
            return {"ok": True, "withdrawal": public_withdrawal(w), "message": "Букмекер подтверждает, что вывод уже проведён."}
        w.error = (result.message or "Букмекер снова не вернул сумму вывода")[:600]
        w.needs_attention = True
        db.flush()
        return {"ok": False, "message": w.error, "withdrawal": public_withdrawal(w)}


def edit_fields(db: Session, w: Withdrawal, data: dict[str, Any], operator_id: int | None) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    if "amount" in data:
        new_amount = money(data["amount"])
        if new_amount < 0:
            raise WithdrawalError("Сумма не может быть отрицательной")
        changes["amount"] = [str(money(w.amount)), str(new_amount)]
        w.amount = new_amount
        if w.qr_payload and new_amount > 0:
            try:
                w.generated_qr_payload = elqr.inject_amount(w.qr_payload, new_amount)
            except Exception:
                pass
    if "player_id" in data:
        pid = "".join(ch for ch in str(data["player_id"]) if ch.isdigit())
        if not pid:
            raise WithdrawalError("Некорректный ID")
        changes["player_id"] = [w.player_id, pid]
        w.player_id = pid
    if "error" in data:
        changes["error"] = [w.error, str(data["error"])[:600]]
        w.error = str(data["error"])[:600]
    if "deferred" in data:
        w.deferred = bool(data["deferred"])
        changes["deferred"] = w.deferred
    if "needs_attention" in data:
        w.needs_attention = bool(data["needs_attention"])
        changes["needs_attention"] = w.needs_attention
    if "qr_payload" in data:
        payload = str(data["qr_payload"] or "").strip()
        if payload:
            _, clean = elqr.normalize(payload)
            w.qr_payload = clean
            if money(w.amount) > 0:
                w.generated_qr_payload = elqr.inject_amount(clean, w.amount)
            changes["qr_payload"] = "updated"
    w.operator_id = operator_id
    db.flush()
    return changes


STATUS_LABELS = {
    "created": "Ожидает",
    "processing": "В обработке",
    "success": "Выполнен",
    "failed": "Ошибка",
    "cancelled": "Отменён",
}


def public_withdrawal(w: Withdrawal, *, full: bool = False) -> dict[str, Any]:
    user = w.user
    cash = w.cash
    out = {
        "id": w.id,
        "public_id": w.public_id,
        "kind": "withdraw",
        "status": w.status,
        "status_label": STATUS_LABELS.get(w.status, w.status),
        "amount": str(money(w.amount)),
        "currency": w.currency,
        "player_id": w.player_id,
        "player_name": w.player_name,
        "cash_id": w.cash_id,
        "cash_key": cash.key if cash else "",
        "cash_name": cash.name if cash else "",
        "user_id": w.user_id,
        "telegram_id": user.telegram_id if user else 0,
        "user_name": display_name(user) if user else "",
        "username": user.username if user else "",
        "needs_attention": w.needs_attention,
        "deferred": w.deferred,
        "error": w.error,
        "provider_ref": w.provider_ref,
        "has_qr": bool(w.qr_file_url or w.qr_payload),
        "has_generated_qr": bool(w.generated_qr_payload),
        "created_at": iso(w.created_at),
        "updated_at": iso(w.updated_at),
        "processing_started_at": iso(w.processing_started_at),
        "completed_at": iso(w.completed_at),
        "closed_at": iso(w.closed_at),
        "operator_id": w.operator_id,
        "source": w.source,
    }
    if full:
        out.update({
            "code": w.code,
            "qr_file_url": w.qr_file_url,
            "qr_payload": w.qr_payload,
            "generated_qr_payload": w.generated_qr_payload,
            "provider_response": w.provider_response,
            "qr_record_id": w.qr_record_id,
        })
    return out
