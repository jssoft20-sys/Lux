"""Telegram users, saved player IDs, withdrawal QR records, referrals."""
from __future__ import annotations

import secrets
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Deposit, PaymentCash, QrRecord, ReferralPayout, ReferralReward, SavedPlayerId, User, Withdrawal
from ..utils import money, new_public_id, sha256_hex, utcnow
from . import settings_store
from .logs import log_event
from .notifications import notify_user

REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _new_ref_code() -> str:
    return "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


def get_by_telegram(db: Session, telegram_id: int) -> User | None:
    return db.execute(select(User).where(User.telegram_id == int(telegram_id))).scalar_one_or_none()


def get_or_create(db: Session, tg_user: dict[str, Any]) -> User:
    """Idempotent upsert from a Telegram ``from`` object."""
    telegram_id = int(tg_user.get("id") or 0)
    if not telegram_id:
        raise ValueError("telegram id required")
    user = get_by_telegram(db, telegram_id)
    username = str(tg_user.get("username") or "")[:64]
    first_name = str(tg_user.get("first_name") or "")[:128]
    last_name = str(tg_user.get("last_name") or "")[:128]
    if user is None:
        code = _new_ref_code()
        while db.execute(select(User.id).where(User.referral_code == code)).first():
            code = _new_ref_code()
        lang = str(tg_user.get("language_code") or "ru")[:2].lower()
        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            last_name=last_name,
            language="kg" if lang in {"ky", "kg"} else "ru",
            referral_code=code,
            last_seen_at=utcnow(),
        )
        db.add(user)
        db.flush()
        log_event(db, "Новый пользователь", f"{first_name} @{username} • {telegram_id}", category="users", entity_type="user", entity_id=user.id)
        return user
    changed = False
    if username != user.username:
        user.username = username
        changed = True
    if first_name and first_name != user.first_name:
        user.first_name = first_name
        changed = True
    if last_name != user.last_name:
        user.last_name = last_name
        changed = True
    user.last_seen_at = utcnow()
    if changed:
        db.flush()
    return user


def display_name(user: User) -> str:
    return user.first_name or (("@" + user.username) if user.username else f"ID {user.telegram_id}")


def bind_referral(db: Session, user: User, code: str) -> str:
    code = str(code or "").strip().upper()
    if not code or user.referred_by_id:
        return "already" if user.referred_by_id else "empty"
    inviter = db.execute(select(User).where(User.referral_code == code)).scalar_one_or_none()
    if not inviter or inviter.id == user.id:
        return "invalid"
    # a user with operations already done cannot be attributed later
    if user.deposits_count or user.withdrawals_count:
        return "late"
    user.referred_by_id = inviter.id
    db.flush()
    return "ok"


def referral_stats(db: Session, user: User) -> dict[str, Any]:
    invited = db.execute(select(func.count(User.id)).where(User.referred_by_id == user.id)).scalar() or 0
    active = db.execute(select(func.count(func.distinct(ReferralReward.invited_id))).where(ReferralReward.referrer_id == user.id)).scalar() or 0
    pending = db.execute(
        select(func.coalesce(func.sum(ReferralPayout.amount), 0)).where(ReferralPayout.user_id == user.id, ReferralPayout.status.in_(("created", "processing")))
    ).scalar() or 0
    return {
        "invited": int(invited),
        "active": int(active),
        "total": money(user.referral_total),
        "available": money(user.referral_balance),
        "pending": money(pending),
        "code": user.referral_code,
    }


def apply_referral_reward(db: Session, deposit: Deposit) -> ReferralReward | None:
    """Credit the inviter once per successful deposit (unique on deposit_id)."""
    user = db.get(User, deposit.user_id)
    if not user or not user.referred_by_id:
        return None
    if db.execute(select(ReferralReward.id).where(ReferralReward.deposit_id == deposit.id)).first():
        return None
    pct = Decimal(str(settings_store.get_float(db, "referral_bonus_pct", 1.0)))
    if pct <= 0:
        return None
    reward = money(money(deposit.pay_amount) * pct / Decimal(100))
    if reward <= 0:
        return None
    inviter = db.get(User, user.referred_by_id)
    if not inviter:
        return None
    row = ReferralReward(referrer_id=inviter.id, invited_id=user.id, deposit_id=deposit.id, amount=money(deposit.pay_amount), reward=reward)
    db.add(row)
    inviter.referral_balance = money(inviter.referral_balance) + reward
    inviter.referral_total = money(inviter.referral_total) + reward
    db.flush()
    notify_user(
        db,
        inviter,
        event="referral_reward",
        event_key=f"referral_reward:{deposit.id}",
        text=f"🎁 Реферальный бонус\n\nНачислено: {reward} KGS\nПополнение реферала: {money(deposit.pay_amount)} KGS\nПользователь: {display_name(user)}",
    )
    return row


def create_referral_payout(db: Session, user: User) -> tuple[ReferralPayout | None, str]:
    available = money(user.referral_balance)
    minimum = money(settings_store.get_float(db, "referral_withdraw_min", 0))
    if available <= 0:
        return None, "Нет доступного реферального баланса для вывода"
    if minimum > 0 and available < minimum:
        return None, f"Минимум для вывода реферального баланса — {minimum} KGS"
    qr = last_qr(db, user)
    if qr is None:
        return None, "Сначала добавьте QR для вывода в профиле"
    active = db.execute(
        select(ReferralPayout.id).where(ReferralPayout.user_id == user.id, ReferralPayout.status.in_(("created", "processing")))
    ).first()
    if active:
        return None, "Заявка на вывод реферального баланса уже в обработке"
    row = ReferralPayout(public_id=new_public_id("RF"), user_id=user.id, amount=available, qr_record_id=qr.id, status="created")
    user.referral_balance = Decimal("0")
    db.add(row)
    db.flush()
    log_event(db, "Заявка на вывод реферального баланса", f"{display_name(user)} • {available} KGS • {row.public_id}", category="referrals", entity_type="referral_payout", entity_id=row.id)
    return row, ""


# ---------------------------------------------------------------- saved ids / QR

def saved_ids(db: Session, user: User, cash: PaymentCash, limit: int = 6) -> list[SavedPlayerId]:
    rows = db.execute(
        select(SavedPlayerId)
        .where(SavedPlayerId.user_id == user.id, SavedPlayerId.cash_id == cash.id)
        .order_by(SavedPlayerId.last_used_at.desc())
        .limit(limit)
    ).scalars().all()
    return list(rows)


def remember_player_id(db: Session, user: User, cash: PaymentCash, player_id: str, name: str = "", currency: str = "") -> SavedPlayerId:
    row = db.execute(
        select(SavedPlayerId).where(SavedPlayerId.user_id == user.id, SavedPlayerId.cash_id == cash.id, SavedPlayerId.player_id == player_id)
    ).scalar_one_or_none()
    if row is None:
        row = SavedPlayerId(user_id=user.id, cash_id=cash.id, player_id=player_id)
        db.add(row)
    row.last_used_at = utcnow()
    if name:
        row.player_name = name[:160]
    if currency:
        row.currency = currency[:16]
    db.flush()
    return row


def forget_player_id(db: Session, user: User, cash: PaymentCash, player_id: str) -> None:
    row = db.execute(
        select(SavedPlayerId).where(SavedPlayerId.user_id == user.id, SavedPlayerId.cash_id == cash.id, SavedPlayerId.player_id == player_id)
    ).scalar_one_or_none()
    if row:
        db.delete(row)
        db.flush()


def last_qr(db: Session, user: User) -> QrRecord | None:
    return db.execute(
        select(QrRecord).where(QrRecord.user_id == user.id).order_by(QrRecord.last_used_at.desc(), QrRecord.id.desc()).limit(1)
    ).scalar_one_or_none()


def save_qr(db: Session, user: User, *, file_id: str = "", file_url: str = "", payload: str = "", bank_name: str = "", local_path: str = "") -> QrRecord:
    fingerprint = sha256_hex(payload or file_id or file_url)[:64]
    row = db.execute(select(QrRecord).where(QrRecord.user_id == user.id, QrRecord.fingerprint == fingerprint)).scalar_one_or_none()
    if row is None:
        row = QrRecord(user_id=user.id, fingerprint=fingerprint)
        db.add(row)
    row.telegram_file_id = file_id or row.telegram_file_id
    row.file_url = file_url or row.file_url
    row.payload = payload or row.payload
    row.bank_name = bank_name or row.bank_name
    row.local_path = local_path or row.local_path
    row.last_used_at = utcnow()
    row.uses = int(row.uses or 0) + 1
    db.flush()
    return row


def touch_qr(db: Session, qr: QrRecord) -> None:
    qr.last_used_at = utcnow()
    qr.uses = int(qr.uses or 0) + 1
    db.flush()


def user_summary(db: Session, user: User) -> dict[str, Any]:
    dep_count = db.execute(select(func.count(Deposit.id)).where(Deposit.user_id == user.id)).scalar() or 0
    dep_sum = db.execute(select(func.coalesce(func.sum(Deposit.pay_amount), 0)).where(Deposit.user_id == user.id, Deposit.status == "success")).scalar() or 0
    wd_count = db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.user_id == user.id)).scalar() or 0
    wd_sum = db.execute(select(func.coalesce(func.sum(Withdrawal.amount), 0)).where(Withdrawal.user_id == user.id, Withdrawal.status == "success")).scalar() or 0
    qr = last_qr(db, user)
    return {
        "deposits_count": int(dep_count),
        "deposits_sum": str(money(dep_sum)),
        "withdrawals_count": int(wd_count),
        "withdrawals_sum": str(money(wd_sum)),
        "has_qr": qr is not None,
        "qr_bank": qr.bank_name if qr else "",
    }


def public_user(user: User, summary: dict[str, Any] | None = None) -> dict[str, Any]:
    from ..utils import iso

    out = {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "name": display_name(user),
        "language": user.language,
        "phone": user.phone,
        "email": user.email,
        "email_verified": user.email_verified_at is not None,
        "is_blocked": user.is_blocked,
        "block_reason": user.block_reason,
        "support_blocked": user.support_blocked,
        "support_block_reason": user.support_block_reason,
        "note": user.note,
        "referral_code": user.referral_code,
        "referred_by_id": user.referred_by_id,
        "referral_balance": str(money(user.referral_balance)),
        "referral_total": str(money(user.referral_total)),
        "created_at": iso(user.created_at),
        "last_seen_at": iso(user.last_seen_at),
        "deposits_count": user.deposits_count,
        "withdrawals_count": user.withdrawals_count,
    }
    if summary:
        out.update(summary)
    return out
