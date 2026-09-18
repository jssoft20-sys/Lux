"""Broadcast history and background sending.

Revision ID: 0006
Revises: 0005
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "broadcasts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True),
        sa.Column("admin_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("bot", sa.String(16), nullable=False, server_default="main"),
        sa.Column("audience", sa.String(16), nullable=False, server_default="all"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("photo_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("video_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("buttons", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("recipients", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(400), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_broadcasts_status", "broadcasts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_broadcasts_status", table_name="broadcasts")
    op.drop_table("broadcasts")
