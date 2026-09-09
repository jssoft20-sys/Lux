"""Admin panel API: dashboard, operations, users, cash desks, support, settings, logs, notifications."""
from __future__ import annotations

import io
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    AuditLog,
    BankLink,
    Broadcast,
    Deposit,
    Notification,
    PaymentCash,
    PaymentEvent,
    PaymentRequisite,
    PushSubscription,
    SupportConversation,
    SupportMessage,
    SystemLog,
    User,
    Withdrawal,
)
from ..providers import provider_types
from ..services import broadcasts as broadcast_service
from ..services import cashes as cash_service
from ..services import deposits as deposit_service
from ..services import elqr, payments, settings_store, stats
from ..services import support as support_service
from ..services import withdrawals as withdrawal_service
from ..services.logs import audit, log_event
from ..services.notifications import acknowledge, notify_user
from ..services.qr import render_qr_png
from ..services.users import public_user, user_summary
from ..utils import iso, local_tz, money, sha256_hex, utcnow
from .deps import Principal, client_ip, current_principal, get_db, require
from .schemas import (
    ActionBody,
    BankLinkBody,
    BroadcastBody,
    CashBody,
    EditBody,
    ManualPaymentBody,
    MessageEditBody,
    PremiumTestBody,
    PushSubscribeBody,
    RequisiteBody,
    SettingsBody,
    SettingsResetBody,
    SupportReplyBody,
    SupportStatusBody,
    UserUpdateBody,
)

router = APIRouter(prefix="/api", tags=["admin"])


def _page(page: int, size: int, db: Session | None = None) -> tuple[int, int]:
    default = settings_store.get_int(db, "ui_page_size", 30) if db else 30
    size = max(5, min(200, size or default))
    return max(1, page), size


def _operator_name(db: Session, operator_id: int | None) -> str:
    if not operator_id:
        return "Система"
    from ..models import Admin

    admin = db.get(Admin, operator_id)
    return (admin.name or admin.username) if admin else "Система"


def _parse_day(value: str, end: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        day = datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=local_tz())
    except ValueError:
        raise HTTPException(400, "Некорректная дата")
    return day + timedelta(days=1) if end else day


# ------------------------------------------------------------------- dashboard / live

@router.get("/dashboard")
def dashboard(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"ok": True, **stats.dashboard(db)}


@router.get("/stats")
def stats_endpoint(date_from: str = "", date_to: str = "", principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    start = _parse_day(date_from) or (utcnow().astimezone(local_tz()).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6))
    end = _parse_day(date_to, end=True) or (utcnow() + timedelta(seconds=1))
    return {"ok": True, "from": iso(start), "to": iso(end), **stats.stats_range(db, start, end)}


@router.get("/live")
def live(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    data = stats.queues(db)
    revision = stats.live_revision(db)
    latest = db.execute(
        select(Notification).where(Notification.channel == "admin_push", Notification.status != "expired").order_by(Notification.id.desc()).limit(15)
    ).scalars().all()
    return {
        "ok": True,
        "revision": revision,
        "queues": data,
        "notifications": [
            {"id": n.id, "event": n.event, "level": n.level, "title": n.title, "body": n.body, "data": n.data, "created_at": iso(n.created_at), "acknowledged": n.acknowledged_at is not None}
            for n in latest
        ],
        "server_time": iso(utcnow()),
    }


@router.post("/notifications/{notification_id}/ack")
def ack_notification(notification_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    acknowledge(db, notification_id)
    return {"ok": True}


@router.post("/notifications/ack-all")
def ack_all(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.execute(select(Notification).where(Notification.channel == "admin_push", Notification.acknowledged_at.is_(None))).scalars().all()
    for row in rows:
        row.acknowledged_at = utcnow()
    db.flush()
    return {"ok": True, "count": len(rows)}


# -------------------------------------------------------------------------- deposits

@router.get("/deposits")
def list_deposits(
    status: str = "",
    q: str = "",
    cash: str = "",
    date_from: str = "",
    date_to: str = "",
    user_id: int = 0,
    page: int = 1,
    size: int = 0,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    page, size = _page(page, size, db)
    stmt = select(Deposit)
    if status == "active":
        stmt = stmt.where(Deposit.status.in_(("created", "processing")))
    elif status == "problem":
        stmt = stmt.where(Deposit.status == "failed")
    elif status:
        stmt = stmt.where(Deposit.status.in_(status.split(",")))
    if cash:
        stmt = stmt.join(PaymentCash, PaymentCash.id == Deposit.cash_id).where(PaymentCash.key == cash)
    if user_id:
        stmt = stmt.where(Deposit.user_id == user_id)
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.join(User, User.id == Deposit.user_id).where(
            or_(Deposit.public_id.ilike(needle), Deposit.player_id.ilike(needle), User.username.ilike(needle), User.first_name.ilike(needle), func.cast(User.telegram_id, func.coalesce(User.username, "").type).ilike(needle) if False else Deposit.public_id.ilike(needle))
        )
        if q.strip().isdigit():
            stmt = select(Deposit).join(User, User.id == Deposit.user_id).where(or_(Deposit.player_id == q.strip(), User.telegram_id == int(q.strip()), Deposit.public_id.ilike(needle)))
    start, end = _parse_day(date_from), _parse_day(date_to, end=True)
    if start:
        stmt = stmt.where(Deposit.created_at >= start)
    if end:
        stmt = stmt.where(Deposit.created_at < end)
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar() or 0
    rows = db.execute(stmt.order_by(Deposit.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
    hints = deposit_service.payment_hints(db, rows)
    return {"ok": True, "items": [{**deposit_service.public_deposit(db, d), "payment": hints.get(d.id)} for d in rows], "total": int(total), "page": page, "size": size}


@router.get("/deposits/{deposit_id}")
def get_deposit(deposit_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    deposit = db.get(Deposit, deposit_id)
    if deposit is None:
        raise HTTPException(404, "NOT_FOUND")
    events = support_service.recent_events(db, "deposit", deposit.public_id, limit=30)
    payment_event = db.get(PaymentEvent, deposit.payment_event_id) if deposit.payment_event_id else None
    return {
        "ok": True,
        "item": {**deposit_service.public_deposit(db, deposit, full=True), "operator_name": _operator_name(db, deposit.operator_id)},
        "history": events,
        "payment_event": payments.public_event(payment_event) if payment_event else None,
        "user": public_user(deposit.user, user_summary(db, deposit.user)),
    }


@router.post("/deposits/{deposit_id}/action")
def deposit_action(deposit_id: int, body: ActionBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    deposit = db.get(Deposit, deposit_id)
    if deposit is None:
        raise HTTPException(404, "NOT_FOUND")
    ip = client_ip(request)
    result: dict[str, Any] = {"ok": True}
    if body.action == "credit":
        db.commit()
        result = deposit_service.credit_deposit(deposit.id, source="manual", operator_id=principal.id, actor=principal.admin.username)
        if not result.get("ok"):
            raise HTTPException(400, result.get("message") or "Не удалось зачислить")
        with_db = db
        audit(with_db, "deposit.credit", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="deposit", entity_id=deposit.public_id)
    elif body.action == "mark_success":
        if not deposit_service.mark_success_manual(db, deposit, principal.id, body.reason):
            raise HTTPException(400, "Заявка уже завершена")
        audit(db, "deposit.mark_success", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="deposit", entity_id=deposit.public_id, details={"reason": body.reason})
    elif body.action == "reject":
        if not deposit_service.reject_deposit(db, deposit, principal.id, body.reason):
            raise HTTPException(400, "Заявка уже завершена")
        audit(db, "deposit.reject", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="deposit", entity_id=deposit.public_id, details={"reason": body.reason})
    elif body.action == "cancel":
        if not deposit_service.cancel_deposit(db, deposit, reason=body.reason or "Отменено оператором", actor=principal.admin.username, operator_id=principal.id):
            raise HTTPException(400, "Отменить можно только ожидающую заявку")
        audit(db, "deposit.cancel", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="deposit", entity_id=deposit.public_id)
    else:
        raise HTTPException(400, "Неизвестное действие")
    db.commit()
    fresh = db.get(Deposit, deposit_id)
    return {"ok": True, "item": deposit_service.public_deposit(db, fresh, full=True), **{k: v for k, v in result.items() if k not in {"ok"}}}


@router.post("/deposits/{deposit_id}/edit")
def deposit_edit(deposit_id: int, body: EditBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    deposit = db.get(Deposit, deposit_id)
    if deposit is None:
        raise HTTPException(404, "NOT_FOUND")
    if deposit.status == "success":
        raise HTTPException(400, "Успешную заявку редактировать нельзя")
    changes: dict[str, Any] = {}
    fields = body.fields
    if "player_id" in fields:
        pid = "".join(ch for ch in str(fields["player_id"]) if ch.isdigit())
        if not pid:
            raise HTTPException(400, "Некорректный ID")
        changes["player_id"] = [deposit.player_id, pid]
        deposit.player_id = pid
    if "error" in fields:
        changes["error"] = [deposit.error, str(fields["error"])[:600]]
        deposit.error = str(fields["error"])[:600]
    if "player_name" in fields:
        deposit.player_name = str(fields["player_name"])[:160]
        changes["player_name"] = deposit.player_name
    if "amount" in fields or "pay_amount" in fields:
        try:
            changes.update(deposit_service.edit_amount(db, deposit, amount=fields.get("amount"), pay_amount=fields.get("pay_amount"), operator_id=principal.id))
        except deposit_service.DepositError as exc:
            raise HTTPException(400, exc.message)
        except Exception as exc:
            raise HTTPException(400, f"Некорректная сумма: {str(exc)[:80]}")
    if not changes:
        raise HTTPException(400, "Нет изменяемых полей")
    deposit.operator_id = principal.id
    db.flush()
    audit(db, "deposit.edit", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="deposit", entity_id=deposit.public_id, details=changes)
    return {"ok": True, "item": deposit_service.public_deposit(db, deposit, full=True)}


@router.get("/deposits/{deposit_id}/qr.png")
def deposit_qr(deposit_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    deposit = db.get(Deposit, deposit_id)
    if deposit is None or not deposit.qr_payload:
        raise HTTPException(404, "NOT_FOUND")
    png = render_qr_png(elqr.qr_image_value(deposit.qr_payload))
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


# ---------------------------------------------------------------------- withdrawals

@router.get("/withdrawals")
def list_withdrawals(
    status: str = "",
    q: str = "",
    cash: str = "",
    date_from: str = "",
    date_to: str = "",
    user_id: int = 0,
    page: int = 1,
    size: int = 0,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    page, size = _page(page, size, db)
    stmt = select(Withdrawal)
    if status == "active":
        stmt = stmt.where(Withdrawal.status.in_(("created", "processing")), Withdrawal.deferred.is_(False))
    elif status == "deferred":
        stmt = stmt.where(Withdrawal.status.in_(("created", "processing")), Withdrawal.deferred.is_(True))
    elif status == "problem":
        stmt = stmt.where(or_(Withdrawal.needs_attention.is_(True), Withdrawal.status == "failed"))
    elif status:
        stmt = stmt.where(Withdrawal.status.in_(status.split(",")))
    if cash:
        stmt = stmt.join(PaymentCash, PaymentCash.id == Withdrawal.cash_id).where(PaymentCash.key == cash)
    if user_id:
        stmt = stmt.where(Withdrawal.user_id == user_id)
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.join(User, User.id == Withdrawal.user_id)
        if q.strip().isdigit():
            stmt = stmt.where(or_(Withdrawal.player_id == q.strip(), User.telegram_id == int(q.strip()), Withdrawal.public_id.ilike(needle)))
        else:
            stmt = stmt.where(or_(Withdrawal.public_id.ilike(needle), User.username.ilike(needle), User.first_name.ilike(needle)))
    start, end = _parse_day(date_from), _parse_day(date_to, end=True)
    if start:
        stmt = stmt.where(Withdrawal.created_at >= start)
    if end:
        stmt = stmt.where(Withdrawal.created_at < end)
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar() or 0
    rows = db.execute(stmt.order_by(Withdrawal.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
    return {"ok": True, "items": [withdrawal_service.public_withdrawal(w) for w in rows], "total": int(total), "page": page, "size": size}


@router.get("/withdrawals/{withdrawal_id}")
def get_withdrawal(withdrawal_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    return {
        "ok": True,
        "item": {**withdrawal_service.public_withdrawal(w, full=True), "operator_name": _operator_name(db, w.operator_id), "receipt_required": withdrawal_service.receipt_required(db, w)},
        "history": support_service.recent_events(db, "withdrawal", w.public_id, limit=30),
        "user": public_user(w.user, user_summary(db, w.user)),
        "payment_links": elqr.bank_links(w.generated_qr_payload, deposit_service.bank_link_rows(db)) if w.generated_qr_payload else [],
    }


@router.post("/withdrawals/{withdrawal_id}/action")
def withdrawal_action(withdrawal_id: int, body: ActionBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    ip = client_ip(request)
    try:
        if body.action == "take":
            ok = withdrawal_service.take(db, w, principal.id)
        elif body.action == "complete":
            ok = withdrawal_service.complete(db, w, principal.id)
        elif body.action == "reject":
            ok = withdrawal_service.fail(db, w, principal.id, body.reason, cancel=True)
        elif body.action == "fail":
            ok = withdrawal_service.fail(db, w, principal.id, body.reason, cancel=False)
        elif body.action == "defer":
            ok = withdrawal_service.defer(db, w, principal.id, True)
        elif body.action == "resume":
            ok = withdrawal_service.defer(db, w, principal.id, False)
        elif body.action == "retry":
            db.commit()
            result = withdrawal_service.retry_provider(w.id, principal.id)
            audit(db, "withdrawal.retry", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="withdrawal", entity_id=w.public_id, details={"ok": result.get("ok")})
            db.commit()
            if not result.get("ok"):
                raise HTTPException(400, result.get("message") or "Не удалось перепроверить")
            fresh = db.get(Withdrawal, withdrawal_id)
            return {"ok": True, "item": withdrawal_service.public_withdrawal(fresh, full=True)}
        else:
            raise HTTPException(400, "Неизвестное действие")
    except withdrawal_service.WithdrawalError as exc:
        raise HTTPException(400, exc.message)
    if not ok:
        raise HTTPException(400, "Действие недоступно для текущего статуса")
    audit(db, f"withdrawal.{body.action}", admin_id=principal.id, actor=principal.admin.username, ip=ip, entity_type="withdrawal", entity_id=w.public_id, details={"reason": body.reason})
    return {"ok": True, "item": withdrawal_service.public_withdrawal(w, full=True)}


@router.post("/withdrawals/{withdrawal_id}/edit")
def withdrawal_edit(withdrawal_id: int, body: EditBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    if w.status == "success":
        raise HTTPException(400, "Выполненную заявку редактировать нельзя")
    try:
        changes = withdrawal_service.edit_fields(db, w, body.fields, principal.id)
    except (withdrawal_service.WithdrawalError, ValueError) as exc:
        raise HTTPException(400, getattr(exc, "message", str(exc)))
    if not changes:
        raise HTTPException(400, "Нет изменяемых полей")
    audit(db, "withdrawal.edit", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="withdrawal", entity_id=w.public_id, details=changes)
    return {"ok": True, "item": withdrawal_service.public_withdrawal(w, full=True)}


@router.get("/withdrawals/{withdrawal_id}/qr.png")
def withdrawal_qr(withdrawal_id: int, kind: str = "generated", principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    payload = w.generated_qr_payload if kind == "generated" else w.qr_payload
    if not payload:
        raise HTTPException(404, "QR не распознан")
    png = render_qr_png(payload, branded=False)
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.post("/withdrawals/{withdrawal_id}/decode-qr")
def withdrawal_decode_qr(withdrawal_id: int, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    """Read the client's QR photo again (stronger pipeline) and rebuild the QR with the amount."""
    from ..services.qr_decode import decode_offloaded

    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    raw = _withdrawal_photo_bytes(w)
    if not raw:
        raise HTTPException(400, "Фото QR не найдено")
    text = decode_offloaded(raw, budget=6.0)
    if not text:
        raise HTTPException(400, "QR не распознан. Попросите клиента прислать QR крупнее или введите текст QR вручную.")
    changes = withdrawal_service.edit_fields(db, w, {"qr_payload": text}, principal.id)
    audit(db, "withdrawal.decode_qr", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="withdrawal", entity_id=w.public_id, details=changes)
    return {"ok": True, "item": withdrawal_service.public_withdrawal(w, full=True), "decoded": text[:200]}


@router.post("/withdrawals/{withdrawal_id}/receipt")
async def upload_withdrawal_receipt(withdrawal_id: int, request: Request, file: UploadFile = File(...), principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    """Operator's transfer receipt (required for large payouts; sent to the client with «Вывод выполнен»)."""
    w = db.get(Withdrawal, withdrawal_id)
    if w is None:
        raise HTTPException(404, "NOT_FOUND")
    if w.status in {"success", "cancelled"}:
        raise HTTPException(400, "Заявка уже закрыта")
    raw = await file.read()
    rel = _store_image(raw, file.filename or "receipt.jpg", "receipts", f"W-{w.public_id}")
    withdrawal_service.attach_receipt(db, w, rel, principal.id)
    audit(db, "withdrawal.receipt", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="withdrawal", entity_id=w.public_id)
    return {"ok": True, "item": withdrawal_service.public_withdrawal(w, full=True)}


@router.get("/withdrawals/{withdrawal_id}/receipt")
def withdrawal_receipt(withdrawal_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    w = db.get(Withdrawal, withdrawal_id)
    if w is None or not w.receipt_file:
        raise HTTPException(404, "NOT_FOUND")
    path = (get_settings().data_dir / w.receipt_file.lstrip("/")).resolve()
    if not path.is_file():
        raise HTTPException(404, "NOT_FOUND")
    return Response(content=path.read_bytes(), media_type=IMAGE_TYPES.get(path.suffix.lstrip(".").lower(), "image/jpeg"), headers={"Cache-Control": "private, max-age=3600"})


def _withdrawal_photo_bytes(w: Withdrawal) -> bytes:
    """Bytes of the client's QR photo (local upload or Telegram file url)."""
    url = w.qr_file_url or ""
    if not url:
        return b""
    if url.startswith("/"):
        path = get_settings().data_dir / url.lstrip("/")
        return path.read_bytes() if path.exists() else b""
    try:
        import httpx

        with httpx.Client(timeout=20) as client:
            r = client.get(url)
            return r.content if r.status_code == 200 else b""
    except Exception:
        return b""


@router.get("/withdrawals/{withdrawal_id}/photo")
def withdrawal_photo(withdrawal_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Proxy the client's QR photo (never expose the bot token to the browser)."""
    import httpx

    w = db.get(Withdrawal, withdrawal_id)
    if w is None or not w.qr_file_url:
        raise HTTPException(404, "NOT_FOUND")
    url = w.qr_file_url
    if url.startswith("/"):
        path = get_settings().data_dir / url.lstrip("/")
        if not path.exists():
            raise HTTPException(404, "NOT_FOUND")
        return StreamingResponse(io.BytesIO(path.read_bytes()), media_type="image/jpeg")
    try:
        response = httpx.get(url, timeout=15)
        response.raise_for_status()
    except Exception:
        raise HTTPException(502, "Фото недоступно")
    return Response(content=response.content, media_type=response.headers.get("content-type", "image/jpeg"), headers={"Cache-Control": "private, max-age=600"})


# -------------------------------------------------------------------------- payments

@router.get("/payment-events")
def list_events(status: str = "", page: int = 1, size: int = 0, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    page, size = _page(page, size, db)
    stmt = select(PaymentEvent)
    if status:
        stmt = stmt.where(PaymentEvent.status.in_(status.split(",")))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
    rows = db.execute(stmt.order_by(PaymentEvent.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
    return {"ok": True, "items": [payments.public_event(e) for e in rows], "total": int(total), "page": page, "size": size}


@router.post("/payment-events/manual")
def manual_event(body: ManualPaymentBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    """Operator confirms a payment seen in the bank statement (matched by exact amount)."""
    try:
        amount = money(body.amount)
    except Exception:
        raise HTTPException(400, "Некорректная сумма")
    event, created = payments.ingest_event(db, source="manual", amount=amount, raw_text=body.note or f"manual by {principal.admin.username}", external_id=f"manual:{principal.id}:{int(utcnow().timestamp())}", sender_ip=client_ip(request))
    audit(db, "payment.manual_event", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="payment_event", entity_id=event.id, details={"amount": str(amount)})
    db.commit()
    result = payments.process_event(event.id)
    return {"ok": True, "event_id": event.id, "created": created, "result": result}


@router.post("/payment-events/{event_id}/retry")
def retry_event(event_id: int, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    event = db.get(PaymentEvent, event_id)
    if event is None:
        raise HTTPException(404, "NOT_FOUND")
    if event.status in {"unmatched", "failed", "received"}:
        event.status = "received"
        event.error = ""
        db.commit()
    result = payments.process_event(event_id)
    return {"ok": True, "result": result}


# ----------------------------------------------------------------------------- users

@router.get("/users")
def list_users(q: str = "", blocked: int = -1, page: int = 1, size: int = 0, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    page, size = _page(page, size, db)
    stmt = select(User)
    if q:
        needle = f"%{q.strip().lstrip('@')}%"
        if q.strip().isdigit():
            stmt = stmt.where(or_(User.telegram_id == int(q.strip()), User.username.ilike(needle)))
        else:
            stmt = stmt.where(or_(User.username.ilike(needle), User.first_name.ilike(needle), User.last_name.ilike(needle), User.email.ilike(needle)))
    if blocked in (0, 1):
        stmt = stmt.where(User.is_blocked.is_(bool(blocked)))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
    rows = db.execute(stmt.order_by(User.last_seen_at.desc().nullslast(), User.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
    return {"ok": True, "items": [public_user(u) for u in rows], "total": int(total), "page": page, "size": size}


@router.get("/users/{user_id}")
def get_user(user_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "NOT_FOUND")
    deposits = db.execute(select(Deposit).where(Deposit.user_id == user.id).order_by(Deposit.id.desc()).limit(20)).scalars().all()
    withdrawals = db.execute(select(Withdrawal).where(Withdrawal.user_id == user.id).order_by(Withdrawal.id.desc()).limit(20)).scalars().all()
    convs = db.execute(select(SupportConversation).where(SupportConversation.user_id == user.id).order_by(SupportConversation.id.desc()).limit(10)).scalars().all()
    inviter = db.get(User, user.referred_by_id) if user.referred_by_id else None
    return {
        "ok": True,
        "item": public_user(user, user_summary(db, user)),
        "inviter": public_user(inviter) if inviter else None,
        "deposits": [deposit_service.public_deposit(db, d) for d in deposits],
        "withdrawals": [withdrawal_service.public_withdrawal(w) for w in withdrawals],
        "conversations": [support_service.public_conversation(c) for c in convs],
    }


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdateBody, request: Request, principal: Principal = Depends(require("users")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "NOT_FOUND")
    changes: dict[str, Any] = {}
    if body.is_blocked is not None:
        user.is_blocked = body.is_blocked
        user.block_reason = (body.block_reason or "")[:300] if body.is_blocked else ""
        changes["is_blocked"] = body.is_blocked
        notify_user(db, user, event="user_block", event_key=f"user_block:{user.id}:{int(utcnow().timestamp())}", text=("⛔ Ваш аккаунт заблокирован. " + (user.block_reason or "Обратитесь в поддержку.")) if body.is_blocked else "✅ Ограничения с вашего аккаунта сняты.")
    if body.support_blocked is not None:
        user.support_blocked = body.support_blocked
        user.support_block_reason = (body.support_block_reason or "")[:300] if body.support_blocked else ""
        changes["support_blocked"] = body.support_blocked
    if body.note is not None:
        user.note = body.note[:4000]
        changes["note"] = "updated"
    if body.referral_balance is not None and principal.can("settings"):
        new_balance = money(body.referral_balance)
        changes["referral_balance"] = [str(money(user.referral_balance)), str(new_balance)]
        user.referral_balance = new_balance
    db.flush()
    audit(db, "user.update", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="user", entity_id=user.id, details=changes)
    return {"ok": True, "item": public_user(user, user_summary(db, user))}


@router.get("/users/{user_id}/referral-payouts")
def referral_payouts(user_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from ..models import ReferralPayout

    rows = db.execute(select(ReferralPayout).where(ReferralPayout.user_id == user_id).order_by(ReferralPayout.id.desc()).limit(50)).scalars().all()
    return {"ok": True, "items": [{"id": r.id, "public_id": r.public_id, "amount": str(money(r.amount)), "status": r.status, "error": r.error, "created_at": iso(r.created_at), "closed_at": iso(r.closed_at), "qr_record_id": r.qr_record_id} for r in rows]}


@router.post("/users/{user_id}/referral-payouts/{payout_id}/action")
def referral_payout_action(user_id: int, payout_id: int, body: ActionBody, request: Request, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    from ..models import ReferralPayout

    row = db.get(ReferralPayout, payout_id)
    user = db.get(User, user_id)
    if row is None or user is None or row.user_id != user.id:
        raise HTTPException(404, "NOT_FOUND")
    if row.status not in {"created", "processing"}:
        raise HTTPException(400, "Заявка уже закрыта")
    if body.action == "complete":
        row.status = "success"
        row.closed_at = utcnow()
        notify_user(db, user, event="referral_payout_done", event_key=f"referral_payout_done:{row.id}", text=f"✅ Реферальный бонус {money(row.amount)} KGS переведён на ваш QR.")
    elif body.action == "reject":
        row.status = "cancelled"
        row.error = (body.reason or "Отклонено оператором")[:300]
        row.closed_at = utcnow()
        user.referral_balance = money(user.referral_balance) + money(row.amount)
        notify_user(db, user, event="referral_payout_rejected", event_key=f"referral_payout_rejected:{row.id}", text=f"❌ Вывод реферального бонуса отклонён. {row.error} Баланс возвращён.")
    else:
        raise HTTPException(400, "Неизвестное действие")
    row.operator_id = principal.id
    db.flush()
    audit(db, f"referral_payout.{body.action}", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="referral_payout", entity_id=row.public_id, details={"amount": str(money(row.amount))})
    return {"ok": True}


@router.post("/users/{user_id}/conversation")
def open_user_conversation(user_id: int, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    """«Написать клиенту»: opens (or reuses) the operator dialog for this client in the Chat section."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "NOT_FOUND")
    conv = support_service.open_operator_conversation(db, user, principal.id)
    audit(db, "support.open", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=conv.id)
    return {"ok": True, "item": support_service.public_conversation(conv), "channel": str((conv.context or {}).get("channel") or "support")}


@router.post("/users/{user_id}/message")
def message_user(user_id: int, body: SupportReplyBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "NOT_FOUND")
    notify_user(db, user, event="admin_message", event_key=f"admin_message:{user.id}:{int(utcnow().timestamp()*1000)}", text=body.text, photo_url=body.photo_url)
    audit(db, "user.message", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="user", entity_id=user.id)
    return {"ok": True}


@router.get("/broadcast/audience")
def broadcast_audience(audience: str = "all", days: int = 0, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    if audience == "test":
        chat = int(principal.admin.telegram_id or 0) or (get_settings().admin_chat_ids[0] if get_settings().admin_chat_ids else 0)
        return {"ok": True, "count": 1 if chat else 0, "test_chat_id": chat}
    return {"ok": True, "count": broadcast_service.audience_count(db, audience if audience in {"all", "new", "big", "active"} else "all")}


@router.get("/broadcast/history")
def broadcast_history(limit: int = 30, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    rows = db.execute(select(Broadcast).order_by(Broadcast.id.desc()).limit(max(1, min(limit, 200)))).scalars().all()
    for row in rows:
        if row.status == "delivering":
            broadcast_service.refresh_counts(db, row)
    return {"ok": True, "items": [broadcast_service.public(r) for r in rows]}


@router.get("/broadcast/{broadcast_id}")
def broadcast_detail(broadcast_id: int, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    row = db.get(Broadcast, broadcast_id)
    if row is None:
        raise HTTPException(404, "NOT_FOUND")
    if row.status == "delivering":
        broadcast_service.refresh_counts(db, row)
    return {"ok": True, "item": broadcast_service.public(row, broadcast_service.errors(db, row))}


@router.post("/broadcast")
def broadcast(body: BroadcastBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    """Queues the mass message; the worker sends it in the background (see /broadcast/history)."""
    buttons = []
    for b in body.buttons[:6]:
        url = b.url.strip()
        if not (url.startswith("https://") or url.startswith("http://") or url.startswith("tg://")):
            raise HTTPException(400, f"Ссылка кнопки «{b.text}» должна начинаться с https://")
        buttons.append({"text": b.text.strip(), "url": url})
    bot = "support" if body.bot == "support" else "main"
    if body.audience == "test":
        chat = 0
        try:
            chat = int(str(body.test_chat_id or "").strip() or 0)
        except ValueError:
            raise HTTPException(400, "Telegram ID должен быть числом")
        chat = chat or int(principal.admin.telegram_id or 0) or (get_settings().admin_chat_ids[0] if get_settings().admin_chat_ids else 0)
        if not chat:
            raise HTTPException(400, "Укажите Telegram ID для теста")
        stamp = int(utcnow().timestamp())
        data = {"broadcast": True, "test": True}
        if body.video_url:
            data["video_url"] = body.video_url
        notify_user(db, chat, event="broadcast", event_key=f"broadcast_test:{stamp}:{chat}", text=body.text, photo_url=body.photo_url, data=data, bot=bot, buttons=buttons)
        return {"ok": True, "recipients": 1, "test": True}
    audience = body.audience if body.audience in {"all", "new", "big", "active"} else "all"
    row = broadcast_service.queue(db, admin_id=principal.id, admin_name=principal.admin.name or principal.admin.username, bot=bot, audience=audience, text=body.text, photo_url=body.photo_url, video_url=body.video_url, buttons=buttons)
    audit(db, "broadcast.queued", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"recipients": row.recipients, "audience": audience, "bot": bot, "buttons": len(buttons), "broadcast_id": row.id})
    return {"ok": True, "recipients": row.recipients, "item": broadcast_service.public(row)}


# ------------------------------------------------------------------------------ cashes

@router.get("/cashes")
def list_cashes(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = cash_service.list_cashes(db)
    return {"ok": True, "items": [cash_service.public_cash(c, include_secret_shape=principal.can("cashes")) for c in rows], "types": provider_types()}


@router.post("/cashes")
def create_cash(body: CashBody, request: Request, principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    try:
        cash = cash_service.create_cash(db, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit(db, "cash.create", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id, details={"key": cash.key})
    return {"ok": True, "item": cash_service.public_cash(cash)}


@router.patch("/cashes/{cash_id}")
def update_cash(cash_id: int, body: CashBody, request: Request, principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    cash = db.get(PaymentCash, cash_id)
    if cash is None:
        raise HTTPException(404, "NOT_FOUND")
    data = body.model_dump(exclude_none=True)
    data.pop("key", None)
    data.pop("provider_type", None)
    try:
        changed = cash_service.update_cash(db, cash, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    log_event(db, "Касса изменена", f"{cash.name} • {', '.join(changed) or 'без изменений'} • {principal.admin.username}", category="cashes", entity_type="cash", entity_id=cash.id)
    audit(db, "cash.update", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id, details={"fields": changed})
    return {"ok": True, "item": cash_service.public_cash(cash)}


@router.delete("/cashes/{cash_id}")
def delete_cash(cash_id: int, request: Request, principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    cash = db.get(PaymentCash, cash_id)
    if cash is None:
        raise HTTPException(404, "NOT_FOUND")
    used = db.execute(select(func.count(Deposit.id)).where(Deposit.cash_id == cash.id)).scalar() or 0
    used += db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.cash_id == cash.id)).scalar() or 0
    if used:
        cash.enabled = False
        cash.deposit_enabled = False
        cash.withdraw_enabled = False
        db.flush()
        audit(db, "cash.disable_instead_delete", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id)
        return {"ok": True, "disabled": True, "message": "У кассы есть операции — она отключена, а не удалена."}
    db.delete(cash)
    db.flush()
    audit(db, "cash.delete", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash_id)
    return {"ok": True, "deleted": True}


@router.post("/cashes/{cash_id}/check")
def check_cash(cash_id: int, request: Request, principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    cash = db.get(PaymentCash, cash_id)
    if cash is None:
        raise HTTPException(404, "NOT_FOUND")
    result = cash_service.check_cash(db, cash)
    cash_service.apply_thresholds(db, cash, result)
    audit(db, "cash.check", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id, details={"ok": result.ok, "message": result.message})
    return {"ok": True, "result": result.as_dict(), "item": cash_service.public_cash(cash)}


@router.get("/cashes/{cash_id}/lookup/{player_id}")
def lookup_player(cash_id: int, player_id: str, principal: Principal = Depends(require("operations")), db: Session = Depends(get_db)):
    cash = db.get(PaymentCash, cash_id)
    if cash is None:
        raise HTTPException(404, "NOT_FOUND")
    result = cash_service.adapter(cash).lookup_player(player_id)
    return {"ok": True, "result": result.as_dict()}


# -------------------------------------------------------------------------- requisites

def _public_requisite(r: PaymentRequisite) -> dict[str, Any]:
    return {"id": r.id, "name": r.name, "bank_type": r.bank_type, "bank_name": r.bank_name, "enabled": r.enabled, "priority": r.priority, "account": r.account, "holder": r.holder, "cash_id": r.cash_id, "notes": r.notes, "payload_preview": r.payload[:40] + "…", "created_at": iso(r.created_at)}


@router.get("/requisites")
def list_requisites(principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    rows = db.execute(select(PaymentRequisite).order_by(PaymentRequisite.priority, PaymentRequisite.id)).scalars().all()
    return {"ok": True, "items": [_public_requisite(r) for r in rows]}


@router.post("/requisites")
def create_requisite(body: RequisiteBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    if not body.source:
        raise HTTPException(400, "Укажите QR/ссылку банка")
    try:
        meta = elqr.bank_meta(body.source)
    except Exception as exc:
        raise HTTPException(400, f"QR не распознан: {exc}")
    row = PaymentRequisite(name=(body.name or meta["bank_name"])[:64], bank_type=(meta["bank_name"].lower().split() or ["bank"])[0], bank_name=meta["bank_name"], enabled=body.enabled if body.enabled is not None else True, priority=body.priority or 100, payload=meta["payload"], account=meta["account"][:64], holder=meta["holder"][:128], cash_id=body.cash_id or None, notes=body.notes or "")
    db.add(row)
    db.flush()
    audit(db, "requisite.create", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="requisite", entity_id=row.id)
    return {"ok": True, "item": _public_requisite(row)}


@router.post("/requisites/upload")
async def upload_requisite(request: Request, file: UploadFile = File(...), principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    from ..services.qr_decode import decode_offloaded

    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "Файл слишком большой")
    text = decode_offloaded(raw)
    if not text:
        raise HTTPException(400, "QR на изображении не распознан")
    try:
        meta = elqr.bank_meta(text)
    except Exception as exc:
        raise HTTPException(400, f"QR не похож на банковский: {exc}")
    return {"ok": True, "source": text, "meta": meta}


@router.patch("/requisites/{requisite_id}")
def update_requisite(requisite_id: int, body: RequisiteBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    row = db.get(PaymentRequisite, requisite_id)
    if row is None:
        raise HTTPException(404, "NOT_FOUND")
    if body.name is not None:
        row.name = body.name[:64]
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.priority is not None:
        row.priority = int(body.priority)
    if body.cash_id is not None:
        row.cash_id = body.cash_id or None
    if body.notes is not None:
        row.notes = body.notes
    if body.source:
        try:
            meta = elqr.bank_meta(body.source)
        except Exception as exc:
            raise HTTPException(400, f"QR не распознан: {exc}")
        row.payload, row.account, row.holder, row.bank_name = meta["payload"], meta["account"][:64], meta["holder"][:128], meta["bank_name"]
    db.flush()
    audit(db, "requisite.update", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="requisite", entity_id=row.id)
    return {"ok": True, "item": _public_requisite(row)}


@router.delete("/requisites/{requisite_id}")
def delete_requisite(requisite_id: int, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    row = db.get(PaymentRequisite, requisite_id)
    if row is None:
        raise HTTPException(404, "NOT_FOUND")
    db.delete(row)
    db.flush()
    audit(db, "requisite.delete", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="requisite", entity_id=requisite_id)
    return {"ok": True}


# -------------------------------------------------------------------------- bank links

@router.get("/bank-links")
def list_bank_links(principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    return {"ok": True, "items": deposit_service.bank_link_rows(db)}


@router.post("/bank-links")
def upsert_bank_link(body: BankLinkBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    if not body.key:
        raise HTTPException(400, "Укажите ключ")
    row = db.execute(select(BankLink).where(BankLink.key == body.key)).scalar_one_or_none()
    if row is None:
        row = BankLink(key=body.key[:24], name=body.name or body.key, prefix=body.prefix or "", kind=body.kind or "link")
        db.add(row)
    for field in ("name", "prefix", "kind", "enabled", "priority", "encode_payload", "emoji", "custom_emoji_id"):
        value = getattr(body, field)
        if value is not None:
            setattr(row, field, value)
    db.flush()
    audit(db, "bank_link.upsert", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="bank_link", entity_id=row.key)
    return {"ok": True, "items": deposit_service.bank_link_rows(db)}


@router.delete("/bank-links/{key}")
def delete_bank_link(key: str, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    row = db.execute(select(BankLink).where(BankLink.key == key)).scalar_one_or_none()
    if row:
        db.delete(row)
        db.flush()
    return {"ok": True, "items": deposit_service.bank_link_rows(db)}


# ------------------------------------------------------------------------------ support

@router.get("/support/conversations")
def list_conversations(status: str = "open", q: str = "", category: str = "", page: int = 1, size: int = 0, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    page, size = _page(page, size, db)
    stmt = select(SupportConversation)
    if category in {"deposit", "withdrawal"}:
        stmt = stmt.where(SupportConversation.category == category)
    if status == "open":
        stmt = stmt.where(SupportConversation.status.in_(("waiting_operator", "operator")))
    elif status == "waiting":
        stmt = stmt.where(SupportConversation.status == "waiting_operator")
    elif status == "auto":
        stmt = stmt.where(SupportConversation.status == "auto")
    elif status == "closed":
        stmt = stmt.where(SupportConversation.status.in_(("resolved", "closed")))
    if q:
        needle = f"%{q.strip().lstrip('@')}%"
        stmt = stmt.join(User, User.id == SupportConversation.user_id)
        if q.strip().isdigit():
            stmt = stmt.where(or_(User.telegram_id == int(q.strip()), SupportConversation.subject.ilike(needle)))
        else:
            stmt = stmt.where(or_(User.username.ilike(needle), User.first_name.ilike(needle), SupportConversation.subject.ilike(needle)))
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar() or 0
    order = [SupportConversation.status.desc(), SupportConversation.last_message_at.desc().nullslast()] if status == "open" else [SupportConversation.last_message_at.desc().nullslast()]
    rows = db.execute(stmt.order_by(*order).offset((page - 1) * size).limit(size)).scalars().all()
    queues = stats.queues(db, max_age=0)
    counts = {"open": queues["support_open"], "waiting": queues["support_waiting"], "closed": queues["support_closed"], "deposit": queues["support_deposit"], "withdrawal": queues["support_withdrawal"]}
    return {"ok": True, "items": [support_service.public_conversation(c) for c in rows], "total": int(total), "page": page, "size": size, "counts": counts}


@router.get("/support/conversations/{conv_id}")
def get_conversation(conv_id: int, after_id: int = 0, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    conv = db.get(SupportConversation, conv_id)
    if conv is None:
        raise HTTPException(404, "NOT_FOUND")
    stmt = select(SupportMessage).where(SupportMessage.conversation_id == conv.id)
    if after_id:
        stmt = stmt.where(SupportMessage.id > after_id)
    messages = db.execute(stmt.order_by(SupportMessage.id.asc()).limit(300)).scalars().all()
    if not after_id:
        conv.unread_count = 0
        for m in messages:
            m.read_by_admin = True
        db.flush()
    by_id = {m.id: m for m in messages}
    missing = [m.reply_to_id for m in messages if m.reply_to_id and m.reply_to_id not in by_id]
    if missing:
        for m in db.execute(select(SupportMessage).where(SupportMessage.id.in_(missing))).scalars().all():
            by_id[m.id] = m
    return {
        "ok": True,
        "item": support_service.public_conversation(conv, with_context=True),
        "messages": [support_service.public_message(m, by_id.get(m.reply_to_id) if m.reply_to_id else None) for m in messages if not m.deleted_at or after_id == 0],
        "user": public_user(conv.user, user_summary(db, conv.user)),
    }


@router.post("/support/conversations/{conv_id}/reply")
def reply_conversation(conv_id: int, body: SupportReplyBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    conv = db.get(SupportConversation, conv_id)
    if conv is None:
        raise HTTPException(404, "NOT_FOUND")
    quoted = db.get(SupportMessage, int(body.reply_to)) if body.reply_to else None
    if quoted is not None and quoted.conversation_id != conv.id:
        quoted = None
    try:
        msg = support_service.operator_reply(db, conv, principal.id, principal.name, body.text, photo_url=body.photo_url, video_url=body.video_url, reply_to=quoted)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit(db, "support.reply", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=conv.id)
    return {"ok": True, "message": support_service.public_message(msg, quoted), "item": support_service.public_conversation(conv)}


@router.patch("/support/messages/{message_id}")
def edit_support_message(message_id: int, body: MessageEditBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    msg = db.get(SupportMessage, message_id)
    if msg is None or msg.deleted_at:
        raise HTTPException(404, "NOT_FOUND")
    if msg.direction != "out" or msg.sender != "operator":
        raise HTTPException(400, "Изменить можно только своё сообщение")
    if msg.kind not in {"text", "photo", "video"}:
        raise HTTPException(400, "Это сообщение нельзя изменить")
    support_service.edit_message(db, msg, body.text)
    audit(db, "support.edit", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=msg.conversation_id, details={"message_id": msg.id})
    return {"ok": True, "message": support_service.public_message(msg)}


@router.delete("/support/messages/{message_id}")
def delete_support_message(message_id: int, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    msg = db.get(SupportMessage, message_id)
    if msg is None:
        raise HTTPException(404, "NOT_FOUND")
    if msg.deleted_at:
        return {"ok": True, "message": support_service.public_message(msg)}
    support_service.delete_message(db, msg)
    audit(db, "support.delete", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=msg.conversation_id, details={"message_id": msg.id})
    return {"ok": True, "message": support_service.public_message(msg)}


@router.post("/support/conversations/{conv_id}/status")
def set_conversation_status(conv_id: int, body: SupportStatusBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    conv = db.get(SupportConversation, conv_id)
    if conv is None:
        raise HTTPException(404, "NOT_FOUND")
    if body.status == "resolved":
        support_service.resolve_conversation(db, conv, principal.id, note=body.note)
    elif body.status == "operator":
        support_service.reopen(conv, "operator", category=conv.category, subject=conv.subject)
        conv.assigned_admin_id = principal.id
        conv.unread_count = 0
    elif body.status == "auto":
        support_service.reopen(conv, "auto", category=conv.category, subject=conv.subject)
    else:
        raise HTTPException(400, "Неизвестный статус")
    db.flush()
    audit(db, "support.status", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=conv.id, details={"status": body.status})
    return {"ok": True, "item": support_service.public_conversation(conv)}


@router.get("/quick-replies")
def quick_replies(principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    items = settings_store.get(db, "custom_quick_replies", []) or []
    return {"ok": True, "items": [x for x in items if isinstance(x, dict)]}


@router.post("/quick-replies")
def save_quick_replies(body: EditBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    """Replace the whole list: {fields: {items: [{id,title,text}, ...]}}."""
    raw = body.fields.get("items") if isinstance(body.fields, dict) else None
    if not isinstance(raw, list):
        raise HTTPException(400, "items must be a list")
    items = []
    for i, item in enumerate(raw[:100]):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:80]
        text = str(item.get("text") or "").strip()[:2000]
        if not text:
            continue
        items.append({"id": str(item.get("id") or f"q{i + 1}")[:24], "title": title or text[:30], "text": text})
    settings_store.set_many(db, {"custom_quick_replies": items}, principal.admin.username)
    audit(db, "quick_replies.update", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"count": len(items)})
    return {"ok": True, "items": items}


@router.post("/support/upload")
async def support_upload(request: Request, file: UploadFile = File(...), principal: Principal = Depends(require("support"))):
    """Photo or video the operator sends to a client (also used by the broadcast)."""
    raw = await file.read()
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "Файл слишком большой (до 25 МБ)")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    ctype = (file.content_type or "").lower()
    if ext in {"jpg", "jpeg", "png", "webp", "gif"} or ctype.startswith("image/"):
        kind = "image"
        ext = ext if ext in {"jpg", "jpeg", "png", "webp", "gif"} else ("png" if "png" in ctype else "jpg")
    elif ext in {"mp4", "mov", "webm", "m4v"} or ctype.startswith("video/"):
        kind = "video"
        ext = ext if ext in {"mp4", "mov", "webm", "m4v"} else "mp4"
    else:
        raise HTTPException(400, "Только фото или видео")
    settings = get_settings()
    folder = settings.uploads_dir() / "support"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{sha256_hex(raw)[:24]}.{ext}"
    (folder / name).write_bytes(raw)
    return {"ok": True, "url": f"/uploads/support/{name}", "kind": kind}


# ------------------------------------------------------------------------------ settings

@router.get("/settings")
def get_settings_endpoint(principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    settings = get_settings()
    values = settings_store.all_settings(db, fresh=True)
    return {
        "ok": True,
        "values": values,
        "defaults": settings_store.DEFAULTS,
        "env": {
            "public_url": settings.public_url,
            "base_path": settings.base_path,
            "smtp_configured": bool(settings.smtp_host and settings.smtp_user),
            "smtp_host": settings.smtp_host,
            "smtp_from": settings.smtp_from or settings.smtp_user,
            "imap_enabled": settings.imap_enabled,
            "webhook_url": f"{settings.public_url.rstrip('/')}{settings.base_path}/api/webhooks/payments/<WEBHOOK_SECRET>",
            "main_bot": settings.main_bot_username,
            "support_bot": settings.support_bot_username,
            "admin_chat_ids": settings.admin_chat_ids,
            "push_configured": bool(settings.vapid_public_key),
            "assistant_configured": bool(settings.anthropic_api_key),
            "assistant_model": settings.assistant_model,
            "login_approver": settings.login_approver_telegram_id,
            "timezone": settings.timezone,
            "database": settings.database_url.split("://")[0],
        },
    }


@router.post("/settings")
def save_settings(body: SettingsBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    try:
        changed = settings_store.set_many(db, body.values, principal.admin.username)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"Некорректное значение: {exc}")
    audit(db, "settings.update", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={k: v for k, v in changed.items()})
    return {"ok": True, "values": settings_store.all_settings(db, fresh=True)}


# ------------------------------------------------------------------------------ logs

@router.get("/logs")
def list_logs(kind: str = "system", level: str = "", category: str = "", q: str = "", page: int = 1, size: int = 0, principal: Principal = Depends(require("logs")), db: Session = Depends(get_db)):
    page, size = _page(page, size, db)
    if kind == "audit":
        stmt = select(AuditLog)
        if q:
            needle = f"%{q}%"
            stmt = stmt.where(or_(AuditLog.action.ilike(needle), AuditLog.actor.ilike(needle), AuditLog.entity_id.ilike(needle)))
        total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        rows = db.execute(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
        items = [{"id": r.id, "actor": r.actor, "admin_id": r.admin_id, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "ip": r.ip, "details": r.details, "created_at": iso(r.created_at)} for r in rows]
    else:
        stmt = select(SystemLog)
        if level:
            stmt = stmt.where(SystemLog.level.in_(level.split(",")))
        if category:
            stmt = stmt.where(SystemLog.category == category)
        if q:
            needle = f"%{q}%"
            stmt = stmt.where(or_(SystemLog.title.ilike(needle), SystemLog.detail.ilike(needle), SystemLog.entity_id.ilike(needle)))
        total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        rows = db.execute(stmt.order_by(SystemLog.id.desc()).offset((page - 1) * size).limit(size)).scalars().all()
        items = [{"id": r.id, "level": r.level, "category": r.category, "title": r.title, "detail": r.detail, "entity_type": r.entity_type, "entity_id": r.entity_id, "created_at": iso(r.created_at)} for r in rows]
    return {"ok": True, "items": items, "total": int(total), "page": page, "size": size}


# ------------------------------------------------------------------------------ push

@router.get("/push/config")
def push_config(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    settings = get_settings()
    count = db.execute(select(func.count(PushSubscription.id)).where(PushSubscription.enabled.is_(True))).scalar() or 0
    return {"ok": True, "public_key": settings.vapid_public_key, "enabled": bool(settings.vapid_public_key and settings.vapid_private_key), "subscriptions": int(count)}


@router.post("/push/subscribe")
def push_subscribe(body: PushSubscribeBody, request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    endpoint = body.endpoint.strip()
    if not endpoint.startswith("https://"):
        raise HTTPException(400, "Некорректная подписка")
    digest = sha256_hex(endpoint)
    row = db.execute(select(PushSubscription).where(PushSubscription.endpoint_hash == digest)).scalar_one_or_none()
    if row is None:
        row = PushSubscription(endpoint=endpoint, endpoint_hash=digest, p256dh="", auth="")
        db.add(row)
    row.admin_id = principal.id
    row.p256dh = body.keys.get("p256dh", "")[:200]
    row.auth = body.keys.get("auth", "")[:100]
    row.user_agent = request.headers.get("user-agent", "")[:300]
    row.enabled = True
    row.fail_count = 0
    db.flush()
    return {"ok": True, "id": row.id}


@router.post("/push/unsubscribe")
def push_unsubscribe(body: PushSubscribeBody, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    row = db.execute(select(PushSubscription).where(PushSubscription.endpoint_hash == sha256_hex(body.endpoint.strip()))).scalar_one_or_none()
    if row:
        row.enabled = False
        db.flush()
    return {"ok": True}


@router.post("/push/test")
def push_test(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from ..services.notifications import notify_admins

    rows = notify_admins(db, event="test", event_key=f"push_test:{principal.id}:{int(utcnow().timestamp())}", title="🔔 Тестовое уведомление", body=f"Push работает • {principal.name}", level="normal", telegram=False)
    return {"ok": True, "queued": len(rows)}


# ------------------------------------------------------------------------ files / photos

IMAGE_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
MEDIA_TYPES = {**IMAGE_TYPES, "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg", "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "wav": "audio/wav", "mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm", "pdf": "application/pdf", "txt": "text/plain; charset=utf-8"}


def _store_image(raw: bytes, filename: str, folder: str, stem: str) -> str:
    """Save an uploaded image under DATA_DIR/uploads/<folder>/ and return the relative path."""
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Файл слишком большой (до 10 МБ)")
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else "jpg"
    if ext not in IMAGE_TYPES:
        raise HTTPException(400, "Только изображения: jpg, png, webp")
    head = raw[:12]
    if not (head.startswith(b"\xff\xd8") or head.startswith(b"\x89PNG") or head[:4] == b"RIFF" or head.startswith(b"GIF8")):
        raise HTTPException(400, "Файл не похож на изображение")
    target = get_settings().uploads_dir() / folder
    target.mkdir(parents=True, exist_ok=True)
    name = f"{stem}-{sha256_hex(raw)[:10]}.{ext}"
    (target / name).write_bytes(raw)
    return f"uploads/{folder}/{name}"


def _remove_file(rel: str) -> None:
    rel = str(rel or "").lstrip("/")
    if not rel.startswith("uploads/"):
        return
    path = get_settings().data_dir / rel
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


@router.get("/files/{path:path}")
def serve_file(path: str, principal: Principal = Depends(current_principal)):
    """Uploads (support photos, receipts, cash desk instruction photos) — only for signed-in staff."""
    base = get_settings().uploads_dir().resolve()
    target = (base / path.lstrip("/")).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(404, "NOT_FOUND")
    ext = target.suffix.lstrip(".").lower()
    headers = {"Cache-Control": "private, max-age=3600"}
    if ext not in MEDIA_TYPES:
        headers["Content-Disposition"] = f"attachment; filename=\"{target.name}\""
    return Response(content=target.read_bytes(), media_type=MEDIA_TYPES.get(ext, "application/octet-stream"), headers=headers)


@router.post("/cashes/{cash_id}/photo")
async def upload_cash_photo(cash_id: int, request: Request, kind: str = Form(...), file: UploadFile = File(...), principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    """Step photo of a cash desk: kind = deposit (enter ID), withdraw (enter ID for payout), code (enter payout code), instruction."""
    cash = db.get(PaymentCash, cash_id)
    if cash is None:
        raise HTTPException(404, "NOT_FOUND")
    field = cash_service.PHOTO_FIELDS.get(kind)
    if not field:
        raise HTTPException(400, "kind: deposit | withdraw | code | instruction")
    raw = await file.read()
    rel = _store_image(raw, file.filename or "", "cash", f"{cash.key}-{kind}")
    _remove_file(getattr(cash, field))
    setattr(cash, field, rel)
    db.flush()
    audit(db, "cash.photo", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id, details={"kind": kind})
    return {"ok": True, "item": cash_service.public_cash(cash), "path": rel}


@router.delete("/cashes/{cash_id}/photo/{kind}")
def delete_cash_photo(cash_id: int, kind: str, request: Request, principal: Principal = Depends(require("cashes")), db: Session = Depends(get_db)):
    cash = db.get(PaymentCash, cash_id)
    field = cash_service.PHOTO_FIELDS.get(kind)
    if cash is None or not field:
        raise HTTPException(404, "NOT_FOUND")
    _remove_file(getattr(cash, field))
    setattr(cash, field, "")
    db.flush()
    audit(db, "cash.photo_delete", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="cash", entity_id=cash.id, details={"kind": kind})
    return {"ok": True, "item": cash_service.public_cash(cash)}


SETTING_PHOTOS = {"instruction_photo"}


@router.post("/settings/photo")
async def upload_setting_photo(request: Request, key: str = Form(...), file: UploadFile = File(...), principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    if key not in SETTING_PHOTOS:
        raise HTTPException(400, "Неизвестный ключ")
    raw = await file.read()
    rel = _store_image(raw, file.filename or "", "settings", key)
    _remove_file(str(settings_store.get(db, key) or ""))
    settings_store.set_many(db, {key: rel}, principal.admin.username)
    audit(db, "settings.photo", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"key": key})
    return {"ok": True, "path": rel}


@router.delete("/settings/photo/{key}")
def delete_setting_photo(key: str, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    if key not in SETTING_PHOTOS:
        raise HTTPException(400, "Неизвестный ключ")
    _remove_file(str(settings_store.get(db, key) or ""))
    settings_store.set_many(db, {key: ""}, principal.admin.username)
    return {"ok": True}


@router.get("/deposits/{deposit_id}/receipt")
def deposit_receipt(deposit_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """The client's payment screenshot (stored locally, or fetched through the bot API without exposing the token)."""
    import httpx

    deposit = db.get(Deposit, deposit_id)
    if deposit is None or not deposit.receipt_file:
        raise HTTPException(404, "NOT_FOUND")
    ref = deposit.receipt_file
    if ref.startswith("tg:"):
        settings = get_settings()
        try:
            meta = httpx.get(f"{settings.telegram_api_base}/bot{settings.main_bot_token}/getFile", params={"file_id": ref[3:]}, timeout=15).json()
            file_path = (meta.get("result") or {}).get("file_path")
            response = httpx.get(f"{settings.telegram_api_base}/file/bot{settings.main_bot_token}/{file_path}", timeout=20)
            response.raise_for_status()
        except Exception:
            raise HTTPException(502, "Фото недоступно")
        return Response(content=response.content, media_type=response.headers.get("content-type", "image/jpeg"), headers={"Cache-Control": "private, max-age=600"})
    path = get_settings().data_dir / ref.lstrip("/")
    if not path.is_file():
        raise HTTPException(404, "NOT_FOUND")
    return Response(content=path.read_bytes(), media_type=IMAGE_TYPES.get(path.suffix.lstrip(".").lower(), "image/jpeg"), headers={"Cache-Control": "private, max-age=3600"})


# ------------------------------------------------------------------------ webhook (MacroDroid) helper

@router.get("/webhook-info")
def webhook_info(principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    settings = get_settings()
    base = f"{settings.public_url.rstrip('/')}{settings.base_path}/api/webhooks/payments"
    rows = db.execute(select(PaymentEvent).order_by(PaymentEvent.id.desc()).limit(15)).scalars().all()
    since = utcnow() - timedelta(hours=24)
    counts = {status: int(db.execute(select(func.count(PaymentEvent.id)).where(PaymentEvent.received_at >= since, PaymentEvent.status == status)).scalar() or 0) for status in ("matched", "unmatched", "failed", "received", "processing")}
    return {
        "ok": True,
        "url": f"{base}/{settings.webhook_secret}",
        "url_masked": f"{base}/{settings.webhook_secret[:4]}…{settings.webhook_secret[-3:]}",
        "header_url": base,
        "header_name": "X-Webhook-Key",
        "ip_allowlist": str(settings_store.get(db, "webhook_ip_allowlist") or ""),
        "require_signature": settings_store.get_bool(db, "webhook_require_signature"),
        "requisite_mode": str(settings_store.get(db, "requisite_mode") or "random"),
        "recent": [payments.public_event(e) for e in rows],
        "counts_24h": counts,
        "sample_body": {"text": "{not_text}", "title": "{not_title}", "app": "{not_app}"},
    }


@router.post("/webhook-info/test")
def webhook_test(request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    """Push a synthetic confirmation through the same pipeline (never matches a real request)."""
    from decimal import Decimal

    event, created = payments.ingest_event(db, source="test", amount=Decimal("0.01"), raw_text=f"Тест из панели • {principal.admin.username} • {utcnow():%H:%M:%S}", sender_ip=client_ip(request), event_key=f"test:{principal.id}:{int(utcnow().timestamp())}")
    db.commit()
    result = payments.process_event(event.id)
    fresh = db.get(PaymentEvent, event.id)
    audit(db, "webhook.test", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"event_id": event.id})
    return {"ok": True, "event": payments.public_event(fresh), "result": result}


# ------------------------------------------------------------------------ texts reset / premium emoji check

@router.post("/settings/reset")
def reset_settings(body: SettingsResetBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    """Return the listed settings (or all bot texts when the list is ["texts"]) to their built-in defaults."""
    keys = settings_store.TEXT_KEYS if body.keys == ["texts"] else [k for k in body.keys if k in settings_store.DEFAULTS]
    removed = settings_store.reset_keys(db, keys)
    audit(db, "settings.reset", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"keys": removed})
    return {"ok": True, "reset": removed, "values": settings_store.all_settings(db, fresh=True)}


@router.post("/settings/premium-test")
def premium_emoji_test(body: PremiumTestBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    """Send one message with a custom emoji through the client bot and report whether Telegram accepted it.

    Custom (premium) emoji can only be used by bots that own a collectible username
    from Fragment; this check tells the operator plainly whether that is the case.
    """
    import httpx

    from ..services.bot_texts import render_template

    settings = get_settings()
    chat_id = body.chat_id or (settings.admin_chat_ids[0] if settings.admin_chat_ids else None)
    if not chat_id:
        raise HTTPException(400, "Укажите Telegram ID чата для теста (или заполните ADMIN_TELEGRAM_CHAT_IDS в .env)")
    if not settings.main_bot_token:
        raise HTTPException(400, "MAIN_BOT_TOKEN не задан")
    text = render_template("[emoji:5199885118214255386:👋] Проверка premium-эмодзи PayGo: если вы видите анимированную руку — всё работает.", premium=True)
    try:
        response = httpx.post(f"{settings.telegram_api_base}/bot{settings.main_bot_token}/sendMessage", json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"}, timeout=15)
        data = response.json()
    except Exception as exc:
        raise HTTPException(502, f"Telegram недоступен: {str(exc)[:120]}")
    ok = bool(data.get("ok"))
    description = str(data.get("description") or "")
    hint = ""
    if not ok and ("custom emoji" in description.lower() or "custom_emoji" in description.lower() or "entities" in description.lower()):
        hint = "Telegram не разрешает этому боту premium-эмодзи. Нужно купить коллекционный username для бота на fragment.com и назначить его боту в BotFather (Bot Settings → Usernames), после чего повторить тест."
    elif not ok and "chat not found" in description.lower():
        hint = "Чат не найден: сначала напишите боту /start с этого аккаунта."
    audit(db, "settings.premium_test", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"ok": ok, "description": description[:200]})
    return {"ok": True, "sent": ok, "description": description, "hint": hint}
