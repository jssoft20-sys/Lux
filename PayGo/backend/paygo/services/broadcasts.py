"""Mass messages: queued instantly from the panel, sent in the background.

The API only stores a ``Broadcast`` row. The worker expands it into per-user
notifications in chunks (so a long client list never blocks a request), and the
bots deliver those through their outboxes. Counters (sent / failed) are refreshed
from the notifications while the broadcast is running.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Broadcast, Deposit, Notification, User
from ..utils import iso, money, utcnow
from . import settings_store
from .notifications import notify_user

CHUNK = 400


def audience_query(db: Session, audience: str):
    stmt = select(User).where(User.is_blocked.is_(False))
    if audience == "new":
        days = max(1, settings_store.get_int(db, "broadcast_new_days", 7))
        stmt = stmt.where(User.created_at >= utcnow() - timedelta(days=days))
    elif audience == "big":
        minimum = money(settings_store.get(db, "broadcast_big_min", 20000) or 0)
        sums = select(Deposit.user_id, func.sum(Deposit.pay_amount).label("total")).where(Deposit.status == "success").group_by(Deposit.user_id).having(func.sum(Deposit.pay_amount) >= minimum).subquery()
        stmt = stmt.join(sums, sums.c.user_id == User.id)
    elif audience == "active":
        stmt = stmt.where(User.last_seen_at >= utcnow() - timedelta(days=7))
    return stmt


def audience_count(db: Session, audience: str) -> int:
    return int(db.execute(select(func.count()).select_from(audience_query(db, audience).subquery())).scalar() or 0)


def queue(db: Session, *, admin_id: int | None, admin_name: str, bot: str, audience: str, text: str, photo_url: str = "", video_url: str = "", buttons: list[dict[str, str]] | None = None) -> Broadcast:
    row = Broadcast(admin_id=admin_id, admin_name=admin_name[:128], bot=bot, audience=audience, text=text, photo_url=photo_url or "", video_url=video_url or "", buttons=list(buttons or []), status="queued", recipients=audience_count(db, audience))
    db.add(row)
    db.flush()
    return row


def expand(db: Session, row: Broadcast, limit: int = CHUNK) -> int:
    """Create notifications for the next ``limit`` recipients; returns how many were queued."""
    if row.status == "queued":
        row.status = "sending"
        row.started_at = utcnow()
    users = db.execute(audience_query(db, row.audience).where(User.id > row.last_user_id).order_by(User.id.asc()).limit(limit)).scalars().all()
    data: dict[str, Any] = {"broadcast": True, "broadcast_id": row.id}
    if row.video_url:
        data["video_url"] = row.video_url
    for user in users:
        notify_user(db, user, event="broadcast", event_key=f"broadcast:{row.id}:{user.id}", text=row.text, photo_url=row.photo_url, data=data, bot=row.bot, buttons=row.buttons or None)
        row.last_user_id = user.id
    if len(users) < limit:
        row.recipients = int(db.execute(select(func.count(Notification.id)).where(Notification.event == "broadcast", Notification.event_key.like(f"broadcast:{row.id}:%"))).scalar() or 0)
        row.status = "delivering"
    db.flush()
    return len(users)


def refresh_counts(db: Session, row: Broadcast) -> None:
    prefix = f"broadcast:{row.id}:%"
    counts = {st: int(n) for st, n in db.execute(select(Notification.status, func.count(Notification.id)).where(Notification.event == "broadcast", Notification.event_key.like(prefix)).group_by(Notification.status)).all()}
    row.sent = counts.get("sent", 0)
    row.failed = counts.get("failed", 0) + counts.get("expired", 0)
    pending = counts.get("pending", 0)
    if row.status == "delivering" and pending == 0:
        row.status = "done"
        row.finished_at = utcnow()
    db.flush()


def tick(db: Session) -> int:
    """Worker step: expand queued/sending broadcasts and refresh counters of running ones."""
    work = 0
    for row in db.execute(select(Broadcast).where(Broadcast.status.in_(("queued", "sending"))).order_by(Broadcast.id.asc()).limit(3)).scalars().all():
        try:
            work += expand(db, row)
        except Exception as exc:  # keep the loop alive, show the reason in the history
            row.status = "failed"
            row.error = str(exc)[:400]
            row.finished_at = utcnow()
            db.flush()
    for row in db.execute(select(Broadcast).where(Broadcast.status == "delivering").order_by(Broadcast.id.asc()).limit(20)).scalars().all():
        refresh_counts(db, row)
    return work


def errors(db: Session, row: Broadcast, limit: int = 5) -> list[dict[str, Any]]:
    rows = db.execute(select(Notification.error, func.count(Notification.id)).where(Notification.event == "broadcast", Notification.event_key.like(f"broadcast:{row.id}:%"), Notification.status.in_(("failed", "expired"))).group_by(Notification.error).order_by(func.count(Notification.id).desc()).limit(limit)).all()
    return [{"error": e or "неизвестная ошибка", "count": int(n)} for e, n in rows]


def public(row: Broadcast, with_errors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = {
        "id": row.id,
        "created_at": iso(row.created_at),
        "admin_name": row.admin_name,
        "bot": row.bot,
        "audience": row.audience,
        "text": row.text,
        "photo_url": row.photo_url,
        "video_url": row.video_url,
        "buttons": row.buttons or [],
        "status": row.status,
        "recipients": int(row.recipients or 0),
        "sent": int(row.sent or 0),
        "failed": int(row.failed or 0),
        "error": row.error,
        "started_at": iso(row.started_at),
        "finished_at": iso(row.finished_at),
    }
    if with_errors is not None:
        out["errors"] = with_errors
    return out
