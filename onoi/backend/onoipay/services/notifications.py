"""Idempotent notification creation for users (Telegram) and admins (push/Telegram/UI)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Notification, User
from ..utils import utcnow
from . import settings_store

CRITICAL_EVENTS = {"cash_critical", "cash_error", "deposit_failed", "withdrawal_failed", "support_operator", "system_error"}


def _exists(db: Session, event_key: str) -> Notification | None:
    return db.execute(select(Notification).where(Notification.event_key == event_key)).scalar_one_or_none()


def notify_user(
    db: Session,
    user: User | int,
    *,
    event: str,
    event_key: str,
    text: str,
    data: dict[str, Any] | None = None,
    bot: str = "main",
    photo_url: str = "",
    supersede_event_keys: list[str] | None = None,
) -> Notification | None:
    """Queue a Telegram message for a client. Returns None when the event was already queued."""
    telegram_id = user.telegram_id if isinstance(user, User) else int(user)
    if _exists(db, event_key):
        return None
    if supersede_event_keys:
        for key in supersede_event_keys:
            row = _exists(db, key)
            if row and row.status == "pending":
                row.status = "superseded"
                row.processed_at = utcnow()
    payload = dict(data or {})
    if photo_url:
        payload["photo_url"] = photo_url
    row = Notification(
        event_key=event_key,
        channel="telegram_user",
        bot=bot,
        level="normal",
        event=event,
        target_telegram_id=telegram_id,
        title="",
        body=text,
        data=payload,
        status="pending",
    )
    db.add(row)
    db.flush()
    return row


def notify_admins(
    db: Session,
    *,
    event: str,
    event_key: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    level: str | None = None,
    telegram: bool | None = None,
) -> list[Notification]:
    """Create admin-facing notifications (UI feed + web push + optional Telegram to admins)."""
    if _exists(db, event_key):
        return []
    level = level or ("critical" if event in CRITICAL_EVENTS else "normal")
    rows: list[Notification] = []
    ui = Notification(
        event_key=event_key,
        channel="admin_push",
        bot="",
        level=level,
        event=event,
        title=title[:200],
        body=body,
        data=data or {},
        status="pending",
    )
    db.add(ui)
    rows.append(ui)
    settings = get_settings()
    want_telegram = telegram if telegram is not None else (level == "critical")
    if want_telegram and settings.admin_chat_ids:
        for chat_id in settings.admin_chat_ids:
            tg = Notification(
                event_key=f"{event_key}:tg:{chat_id}",
                channel="admin_telegram",
                bot="support",
                level=level,
                event=event,
                target_telegram_id=chat_id,
                title=title[:200],
                body=f"{'🚨 ' if level == 'critical' else '🔔 '}{title}\n{body}",
                data=data or {},
                status="pending",
            )
            db.add(tg)
            rows.append(tg)
    db.flush()
    return rows


def event_enabled(db: Session, event: str) -> bool:
    mapping = {
        "deposit_new": "notify_new_deposit",
        "deposit_success": "notify_deposit_success",
        "deposit_failed": "notify_deposit_failed",
        "withdrawal_new": "notify_new_withdrawal",
        "withdrawal_status": "notify_withdrawal_status",
        "cash_critical": "notify_cash_critical",
        "cash_error": "notify_cash_critical",
        "support_operator": "notify_support_operator",
    }
    key = mapping.get(event)
    if not key:
        return True
    return settings_store.get_bool(db, key, True)


def admin_event(db: Session, event: str, event_key: str, title: str, body: str, data: dict[str, Any] | None = None, level: str | None = None) -> None:
    if event_enabled(db, event):
        notify_admins(db, event=event, event_key=event_key, title=title, body=body, data=data, level=level)


def acknowledge(db: Session, notification_id: int) -> bool:
    row = db.get(Notification, notification_id)
    if not row:
        return False
    row.acknowledged_at = utcnow()
    db.flush()
    return True


def expire_stale(db: Session, max_age_seconds: int) -> int:
    """Called on worker start: pending notifications older than max_age are never delivered."""
    from datetime import timedelta

    cutoff = utcnow() - timedelta(seconds=max_age_seconds)
    rows = db.execute(
        select(Notification).where(Notification.status == "pending", Notification.created_at < cutoff)
    ).scalars().all()
    for row in rows:
        row.status = "expired"
        row.processed_at = utcnow()
        row.error = "expired_on_restart"
    db.flush()
    return len(rows)
