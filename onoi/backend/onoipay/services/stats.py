"""Dashboard numbers and the live revision counter used by the admin UI."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Deposit, Notification, PaymentCash, SupportConversation, User, Withdrawal
from ..utils import local_tz, money, utcnow
from .cashes import public_cash


def _day_bounds(day: datetime | None = None) -> tuple[datetime, datetime]:
    tz = local_tz()
    now = (day or utcnow()).astimezone(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _sum_count(db: Session, model, amount_col, *conditions) -> tuple[str, int]:
    row = db.execute(select(func.coalesce(func.sum(amount_col), 0), func.count(model.id)).where(*conditions)).one()
    return str(money(row[0] or 0)), int(row[1] or 0)


def dashboard(db: Session) -> dict[str, Any]:
    start, end = _day_bounds()
    dep_sum, dep_count = _sum_count(db, Deposit, Deposit.pay_amount, Deposit.status == "success", Deposit.credited_at >= start, Deposit.credited_at < end)
    wd_sum, wd_count = _sum_count(db, Withdrawal, Withdrawal.amount, Withdrawal.status == "success", Withdrawal.completed_at >= start, Withdrawal.completed_at < end)
    dep_pending = db.execute(select(func.count(Deposit.id)).where(Deposit.status.in_(("created", "processing")))).scalar() or 0
    dep_failed = db.execute(select(func.count(Deposit.id)).where(Deposit.status == "failed")).scalar() or 0
    wd_pending = db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.status.in_(("created", "processing")))).scalar() or 0
    wd_attention = db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.needs_attention.is_(True), Withdrawal.status.in_(("created", "processing", "failed")))).scalar() or 0
    support_waiting = db.execute(select(func.count(SupportConversation.id)).where(SupportConversation.status == "waiting_operator")).scalar() or 0
    support_open = db.execute(select(func.count(SupportConversation.id)).where(SupportConversation.status.in_(("waiting_operator", "operator")))).scalar() or 0
    users_total = db.execute(select(func.count(User.id))).scalar() or 0
    users_today = db.execute(select(func.count(User.id)).where(User.created_at >= start)).scalar() or 0
    unread = db.execute(select(func.count(Notification.id)).where(Notification.channel == "admin_push", Notification.acknowledged_at.is_(None), Notification.status != "expired")).scalar() or 0
    cashes = [public_cash(c, include_secret_shape=False) for c in db.execute(select(PaymentCash).order_by(PaymentCash.priority)).scalars().all()]
    all_dep_sum, all_dep_count = _sum_count(db, Deposit, Deposit.pay_amount, Deposit.status == "success")
    all_wd_sum, all_wd_count = _sum_count(db, Withdrawal, Withdrawal.amount, Withdrawal.status == "success")
    return {
        "today": {
            "deposits_sum": dep_sum, "deposits_count": dep_count,
            "withdrawals_sum": wd_sum, "withdrawals_count": wd_count,
            "users_new": int(users_today),
        },
        "total": {
            "deposits_sum": all_dep_sum, "deposits_count": all_dep_count,
            "withdrawals_sum": all_wd_sum, "withdrawals_count": all_wd_count,
            "users": int(users_total),
        },
        "queues": {
            "deposits_pending": int(dep_pending),
            "deposits_failed": int(dep_failed),
            "withdrawals_pending": int(wd_pending),
            "withdrawals_attention": int(wd_attention),
            "support_waiting": int(support_waiting),
            "support_open": int(support_open),
            "notifications_unread": int(unread),
        },
        "cashes": cashes,
    }


def stats_range(db: Session, date_from: datetime, date_to: datetime) -> dict[str, Any]:
    dep_sum, dep_count = _sum_count(db, Deposit, Deposit.pay_amount, Deposit.status == "success", Deposit.credited_at >= date_from, Deposit.credited_at < date_to)
    wd_sum, wd_count = _sum_count(db, Withdrawal, Withdrawal.amount, Withdrawal.status == "success", Withdrawal.completed_at >= date_from, Withdrawal.completed_at < date_to)
    by_cash = []
    for cash in db.execute(select(PaymentCash).order_by(PaymentCash.priority)).scalars().all():
        d_sum, d_count = _sum_count(db, Deposit, Deposit.pay_amount, Deposit.status == "success", Deposit.cash_id == cash.id, Deposit.credited_at >= date_from, Deposit.credited_at < date_to)
        w_sum, w_count = _sum_count(db, Withdrawal, Withdrawal.amount, Withdrawal.status == "success", Withdrawal.cash_id == cash.id, Withdrawal.completed_at >= date_from, Withdrawal.completed_at < date_to)
        by_cash.append({"cash": cash.key, "name": cash.name, "deposits_sum": d_sum, "deposits_count": d_count, "withdrawals_sum": w_sum, "withdrawals_count": w_count})
    return {"deposits_sum": dep_sum, "deposits_count": dep_count, "withdrawals_sum": wd_sum, "withdrawals_count": wd_count, "by_cash": by_cash}


def live_revision(db: Session) -> dict[str, Any]:
    """Cheap change indicator polled by the UI: max ids / max updated timestamps."""
    dep = db.execute(select(func.max(Deposit.id), func.max(Deposit.updated_at))).one()
    wd = db.execute(select(func.max(Withdrawal.id), func.max(Withdrawal.updated_at))).one()
    sup = db.execute(select(func.max(SupportConversation.id), func.max(SupportConversation.updated_at))).one()
    notif = db.execute(select(func.max(Notification.id)).where(Notification.channel == "admin_push")).scalar()
    return {
        "deposits": f"{dep[0] or 0}:{dep[1] or ''}",
        "withdrawals": f"{wd[0] or 0}:{wd[1] or ''}",
        "support": f"{sup[0] or 0}:{sup[1] or ''}",
        "notifications": int(notif or 0),
    }
