"""Panel logins confirmed in the main bot.

Revision ID: 0008
Revises: 0007
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("username", sa.String(64), nullable=False, server_default=""),
        sa.Column("ip", sa.String(64), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(300), nullable=False, server_default=""),
        sa.Column("device", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("telegram_message_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_login_requests_admin_id", "login_requests", ["admin_id"])
    op.create_index("ix_login_requests_status", "login_requests", ["status"])
    op.create_index("ux_login_requests_token_hash", "login_requests", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_login_requests_token_hash", table_name="login_requests")
    op.drop_index("ix_login_requests_status", table_name="login_requests")
    op.drop_index("ix_login_requests_admin_id", table_name="login_requests")
    op.drop_table("login_requests")
