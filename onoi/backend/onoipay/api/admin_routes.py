"""Admin panel API: dashboard, operations, users, cash desks, support, settings, logs, notifications."""
from __future__ import annotations

import io
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    AuditLog,
    BankLink,
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
    PushSubscribeBody,
    RequisiteBody,
    SettingsBody,
    SupportReplyBody,
    SupportStatusBody,
    UserUpdateBody,
)

router = APIRouter(prefix="/api", tags=["admin"])


def _page(page: int, size: int, db: Session | None = None) -> tuple[int, int]:
    default = settings_store.get_int(db, "ui_page_size", 30) if db else 30
    size = max(5, min(200, size or default))
    return max(1, page), size


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
    data = stats.dashboard(db)["queues"]
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
    return {"ok": True, "items": [deposit_service.public_deposit(db, d) for d in rows], "total": int(total), "page": page, "size": size}


@router.get("/deposits/{deposit_id}")
def get_deposit(deposit_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    deposit = db.get(Deposit, deposit_id)
    if deposit is None:
        raise HTTPException(404, "NOT_FOUND")
    events = support_service.recent_events(db, "deposit", deposit.public_id, limit=30)
    payment_event = db.get(PaymentEvent, deposit.payment_event_id) if deposit.payment_event_id else None
    return {
        "ok": True,
        "item": deposit_service.public_deposit(db, deposit, full=True),
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
        "item": withdrawal_service.public_withdrawal(w, full=True),
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


@router.post("/users/{user_id}/message")
def message_user(user_id: int, body: SupportReplyBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "NOT_FOUND")
    notify_user(db, user, event="admin_message", event_key=f"admin_message:{user.id}:{int(utcnow().timestamp()*1000)}", text=body.text, photo_url=body.photo_url)
    audit(db, "user.message", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="user", entity_id=user.id)
    return {"ok": True}


@router.post("/broadcast")
def broadcast(body: BroadcastBody, request: Request, principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    stmt = select(User).where(User.is_blocked.is_(False))
    if body.only_active_days > 0:
        stmt = stmt.where(User.last_seen_at >= utcnow() - timedelta(days=body.only_active_days))
    users = db.execute(stmt).scalars().all()
    stamp = int(utcnow().timestamp())
    for user in users:
        notify_user(db, user, event="broadcast", event_key=f"broadcast:{stamp}:{user.id}", text=body.text, photo_url=body.photo_url, data={"broadcast": True})
    audit(db, "broadcast.sent", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"recipients": len(users)})
    return {"ok": True, "recipients": len(users)}


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
    row = PaymentRequisite(name=(body.name or meta["bank_name"])[:64], bank_type=meta["bank_name"].lower().split()[0], bank_name=meta["bank_name"], enabled=body.enabled if body.enabled is not None else True, priority=body.priority or 100, payload=meta["payload"], account=meta["account"][:64], holder=meta["holder"][:128], cash_id=body.cash_id, notes=body.notes or "")
    db.add(row)
    db.flush()
    audit(db, "requisite.create", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="requisite", entity_id=row.id)
    return {"ok": True, "item": _public_requisite(row)}


@router.post("/requisites/upload")
async def upload_requisite(request: Request, file: UploadFile = File(...), principal: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    from ..services.qr_decode import decode_bytes

    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "Файл слишком большой")
    text = decode_bytes(raw)
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
    for field in ("name", "prefix", "kind", "enabled", "priority", "encode_payload"):
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
def list_conversations(status: str = "open", q: str = "", page: int = 1, size: int = 0, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    page, size = _page(page, size, db)
    stmt = select(SupportConversation)
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
    return {"ok": True, "items": [support_service.public_conversation(c) for c in rows], "total": int(total), "page": page, "size": size}


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
    return {
        "ok": True,
        "item": support_service.public_conversation(conv, with_context=True),
        "messages": [support_service.public_message(m) for m in messages],
        "user": public_user(conv.user, user_summary(db, conv.user)),
    }


@router.post("/support/conversations/{conv_id}/reply")
def reply_conversation(conv_id: int, body: SupportReplyBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    conv = db.get(SupportConversation, conv_id)
    if conv is None:
        raise HTTPException(404, "NOT_FOUND")
    msg = support_service.operator_reply(db, conv, principal.id, principal.name, body.text, photo_url=body.photo_url)
    audit(db, "support.reply", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=conv.id)
    return {"ok": True, "message": support_service.public_message(msg), "item": support_service.public_conversation(conv)}


@router.post("/support/conversations/{conv_id}/status")
def set_conversation_status(conv_id: int, body: SupportStatusBody, request: Request, principal: Principal = Depends(require("support")), db: Session = Depends(get_db)):
    conv = db.get(SupportConversation, conv_id)
    if conv is None:
        raise HTTPException(404, "NOT_FOUND")
    if body.status == "resolved":
        support_service.resolve_conversation(db, conv, principal.id, note=body.note)
    elif body.status == "operator":
        conv.status = "operator"
        conv.assigned_admin_id = principal.id
        conv.unread_count = 0
    elif body.status == "auto":
        conv.status = "auto"
    else:
        raise HTTPException(400, "Неизвестный статус")
    db.flush()
    audit(db, "support.status", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="support", entity_id=conv.id, details={"status": body.status})
    return {"ok": True, "item": support_service.public_conversation(conv)}


@router.post("/support/upload")
async def support_upload(request: Request, file: UploadFile = File(...), principal: Principal = Depends(require("support"))):
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Файл слишком большой")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        raise HTTPException(400, "Только изображения")
    settings = get_settings()
    folder = settings.uploads_dir() / "support"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{sha256_hex(raw)[:24]}.{ext}"
    (folder / name).write_bytes(raw)
    return {"ok": True, "url": f"/uploads/support/{name}"}


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
