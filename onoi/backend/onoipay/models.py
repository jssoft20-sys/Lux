"""Database schema — the single source of truth for every entity.

Money is stored as NUMERIC(14,2) and handled as ``Decimal`` in Python.
Every table that can be written concurrently carries unique constraints and
idempotency keys so that a retried request or a replayed webhook can never
create a second financial effect.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

Money = Numeric(14, 2)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


# --------------------------------------------------------------------------- users

class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    first_name: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    last_name: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    language: Mapped[str] = mapped_column(String(8), default="ru", nullable=False)
    phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    email: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    block_reason: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    support_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    support_block_reason: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    referral_code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    referred_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    referral_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    referral_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deposits_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    withdrawals_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        # verified e-mails are unique; the empty string (no e-mail) is excluded from the index
        Index(
            "ux_users_email_nonempty",
            "email",
            unique=True,
            postgresql_where=text("email <> '' AND email_verified_at IS NOT NULL"),
            sqlite_where=text("email <> '' AND email_verified_at IS NOT NULL"),
        ),
        Index("ix_users_referred_by", "referred_by_id"),
    )


class BotSession(Base):
    """Persistent finite-state-machine state of a Telegram chat for one bot."""

    __tablename__ = "bot_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bot: Mapped[str] = mapped_column(String(16), nullable=False)  # main | support
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    state: Mapped[str] = mapped_column(String(48), default="idle", nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    panel_message_id: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("bot", "telegram_id", name="uq_bot_sessions_bot_chat"),)


class SavedPlayerId(Base):
    __tablename__ = "saved_player_ids"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    cash_id: Mapped[int] = mapped_column(ForeignKey("payment_cashes.id", ondelete="CASCADE"), nullable=False)
    player_id: Mapped[str] = mapped_column(String(32), nullable=False)
    player_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    currency: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "cash_id", "player_id", name="uq_saved_player"),
        Index("ix_saved_player_user_cash", "user_id", "cash_id"),
    )


class QrRecord(TimestampMixin, Base):
    """A bank QR the client sent for withdrawals. The newest one is the "last QR"."""

    __tablename__ = "qr_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    telegram_file_id: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    file_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    local_path: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    payload: Mapped[str] = mapped_column(Text, default="", nullable=False)  # decoded ELQR (optional)
    bank_name: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (Index("ix_qr_records_user_last", "user_id", "last_used_at"),)


# ---------------------------------------------------------------------- cash desks

class PaymentCash(TimestampMixin, Base):
    """A bookmaker cash desk integration (1xBet via Servcul, 1win via X-API-KEY)."""

    __tablename__ = "payment_cashes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # 1xbet, 1win
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(24), nullable=False)  # servcul | xapi
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="KGS", nullable=False)
    accepted_currency_ids: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    ip_address: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    base_url: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    credentials_enc: Mapped[str] = mapped_column(Text, default="", nullable=False)
    deposit_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    withdraw_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deposit_min: Mapped[Decimal] = mapped_column(Money, default=Decimal("100"), nullable=False)
    deposit_max: Mapped[Decimal] = mapped_column(Money, default=Decimal("100000"), nullable=False)
    withdraw_min: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    withdraw_max: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    deposit_fee_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=Decimal("0"), nullable=False)
    withdraw_fee_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=Decimal("0"), nullable=False)
    auto_disable_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    low_balance_threshold: Mapped[Decimal] = mapped_column(Money, default=Decimal("20000"), nullable=False)
    critical_balance_threshold: Mapped[Decimal] = mapped_column(Money, default=Decimal("1000"), nullable=False)
    auto_enable_threshold: Mapped[Decimal] = mapped_column(Money, default=Decimal("5000"), nullable=False)
    max_daily_limit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    auto_disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_balance: Mapped[Decimal | None] = mapped_column(Money)
    last_limit: Mapped[Decimal | None] = mapped_column(Money)
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_check_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_check_message: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    instructions_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    instruction_photo: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)


class PaymentRequisite(TimestampMixin, Base):
    """Bank QR template (ELQR) that receives client payments for deposits."""

    __tablename__ = "payment_requisites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    bank_type: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    bank_name: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # ELQR without amount/CRC
    account: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    holder: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    cash_id: Mapped[int | None] = mapped_column(ForeignKey("payment_cashes.id", ondelete="SET NULL"))
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)


# ------------------------------------------------------------------------ operations

DEPOSIT_STATUSES = ("created", "processing", "success", "failed", "cancelled", "expired")
WITHDRAWAL_STATUSES = ("created", "processing", "success", "failed", "cancelled")


class Deposit(TimestampMixin, Base):
    __tablename__ = "deposits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    cash_id: Mapped[int] = mapped_column(ForeignKey("payment_cashes.id", ondelete="RESTRICT"), nullable=False)
    requisite_id: Mapped[int | None] = mapped_column(ForeignKey("payment_requisites.id", ondelete="SET NULL"))
    player_id: Mapped[str] = mapped_column(String(32), nullable=False)
    player_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)  # requested by the client
    pay_amount: Mapped[Decimal] = mapped_column(Money, nullable=False)  # exact amount with tiyin
    currency: Mapped[str] = mapped_column(String(8), default="KGS", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="created", nullable=False, index=True)
    qr_payload: Mapped[str] = mapped_column(Text, default="", nullable=False)
    payment_event_id: Mapped[int | None] = mapped_column(ForeignKey("payment_events.id", ondelete="SET NULL"))
    payment_source: Mapped[str] = mapped_column(String(24), default="", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    credited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_ref: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    provider_response: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(16), default="telegram", nullable=False)
    notified_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship("User", lazy="joined")
    cash: Mapped[PaymentCash] = relationship("PaymentCash", lazy="joined")

    __table_args__ = (
        Index("ix_deposits_user_created", "user_id", "created_at"),
        Index("ix_deposits_status_created", "status", "created_at"),
        Index("ix_deposits_pay_amount_status", "pay_amount", "status"),
        Index("ix_deposits_expires", "expires_at"),
        # one active deposit per exact amount: the matching key must be unique while payment is awaited
        Index(
            "ux_deposits_active_pay_amount",
            "pay_amount",
            unique=True,
            postgresql_where=text("status IN ('created','processing')"),
            sqlite_where=text("status IN ('created','processing')"),
        ),
    )


class Withdrawal(TimestampMixin, Base):
    __tablename__ = "withdrawals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    cash_id: Mapped[int] = mapped_column(ForeignKey("payment_cashes.id", ondelete="RESTRICT"), nullable=False)
    player_id: Mapped[str] = mapped_column(String(32), nullable=False)
    player_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="KGS", nullable=False)
    code: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    provider_ref: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    provider_claim_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    provider_response: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    qr_record_id: Mapped[int | None] = mapped_column(ForeignKey("qr_records.id", ondelete="SET NULL"))
    qr_file_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    qr_payload: Mapped[str] = mapped_column(Text, default="", nullable=False)
    generated_qr_payload: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="created", nullable=False, index=True)
    needs_attention: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(16), default="telegram", nullable=False)
    notified_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship("User", lazy="joined")
    cash: Mapped[PaymentCash] = relationship("PaymentCash", lazy="joined")

    __table_args__ = (
        Index("ix_withdrawals_user_created", "user_id", "created_at"),
        Index("ix_withdrawals_status_created", "status", "created_at"),
        Index("ix_withdrawals_cash_player_code", "cash_id", "player_id", "code"),
    )


class PaymentEvent(Base):
    """An incoming payment confirmation (webhook / mail / manual)."""

    __tablename__ = "payment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    event_key: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    external_id: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="KGS", nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="received", nullable=False, index=True)
    deposit_id: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sender_ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)

    __table_args__ = (Index("ix_payment_events_status_received", "status", "received_at"),)


class ReferralReward(Base):
    __tablename__ = "referral_rewards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    referrer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invited_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    deposit_id: Mapped[int] = mapped_column(ForeignKey("deposits.id", ondelete="CASCADE"), unique=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    reward: Mapped[Decimal] = mapped_column(Money, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReferralPayout(TimestampMixin, Base):
    __tablename__ = "referral_payouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    qr_record_id: Mapped[int | None] = mapped_column(ForeignKey("qr_records.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="created", nullable=False)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    error: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(160), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# --------------------------------------------------------------------------- support

class SupportConversation(TimestampMixin, Base):
    __tablename__ = "support_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="auto", nullable=False, index=True)
    # auto | waiting_operator | operator | resolved | closed
    category: Mapped[str] = mapped_column(String(24), default="faq", nullable=False)
    subject: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    priority: Mapped[str] = mapped_column(String(12), default="normal", nullable=False)
    deposit_id: Mapped[int | None] = mapped_column(ForeignKey("deposits.id", ondelete="SET NULL"))
    withdrawal_id: Mapped[int | None] = mapped_column(ForeignKey("withdrawals.id", ondelete="SET NULL"))
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    assigned_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    unread_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_user_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rating: Mapped[int | None] = mapped_column(Integer)

    user: Mapped[User] = relationship("User", lazy="joined")

    __table_args__ = (Index("ix_support_conversations_user_status", "user_id", "status"),)


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("support_conversations.id", ondelete="CASCADE"), nullable=False
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)  # in | out
    sender: Mapped[str] = mapped_column(String(16), nullable=False)  # user | bot | operator | system
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    telegram_message_id: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="text", nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    intent: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    confidence: Mapped[float] = mapped_column(Numeric(4, 3), default=0, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(96), unique=True)
    read_by_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_support_messages_conv_created", "conversation_id", "created_at"),)


class SupportRateLimit(Base):
    """Anti-flood state per Telegram user (persisted so restarts keep the limits)."""

    __tablename__ = "support_rate_limits"

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_text_hash: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    last_text_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    repeats: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    warned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ----------------------------------------------------------------------- notifications

class Notification(Base):
    """Outgoing notification of any channel. ``event_key`` makes delivery idempotent."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    channel: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    # telegram_user | admin_push | admin_telegram | admin_ui
    bot: Mapped[str] = mapped_column(String(16), default="main", nullable=False)
    level: Mapped[str] = mapped_column(String(12), default="normal", nullable=False)  # normal | critical
    event: Mapped[str] = mapped_column(String(48), default="", nullable=False)
    target_telegram_id: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    # pending | sent | failed | expired | superseded
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    telegram_message_id: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    __table_args__ = (Index("ix_notifications_channel_status_id", "channel", "status", "id"),)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="CASCADE"))
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    endpoint_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    fail_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PushDelivery(Base):
    __tablename__ = "push_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("push_subscriptions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("notification_id", "subscription_id", name="uq_push_delivery"),
        Index("ix_push_deliveries_status_next", "status", "next_attempt_at"),
    )


# ------------------------------------------------------------------------------ admins

ROLES = ("owner", "admin", "operator", "viewer")


class Admin(TimestampMixin, Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=False)
    name: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="operator", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    telegram_id: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class AdminSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    previous_token_hash: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str] = mapped_column(String(64), default="", nullable=False)


class AuthThrottle(Base):
    __tablename__ = "auth_throttle"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    actor: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_audit_logs_created", "created_at"),)


class SystemLog(Base):
    """Operational log shown on the admin "Logs" page (events, provider calls, errors)."""

    __tablename__ = "system_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    level: Mapped[str] = mapped_column(String(12), default="info", nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(32), default="system", nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="", nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_system_logs_created", "created_at"),)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by: Mapped[str] = mapped_column(String(64), default="", nullable=False)


class Job(Base):
    """Lightweight persistent job queue for heavy/background work."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    last_error: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_jobs_status_run_at", "status", "run_at"),)


class BankLink(Base):
    """Payment deep-link buttons shown under a deposit QR (MBank, O!Dengi, ...)."""

    __tablename__ = "bank_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(48), nullable=False)
    prefix: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    kind: Mapped[str] = mapped_column(String(12), default="link", nullable=False)  # link | qr
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    encode_payload: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
