"""Client Telegram avatars (compressed copy under uploads) and voice-note transcripts.

Revision ID: 0009
Revises: 0008
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(300), nullable=False, server_default=""))
    op.add_column("users", sa.Column("avatar_checked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("support_messages", sa.Column("transcript", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("support_messages") as batch:
        batch.drop_column("transcript")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("avatar_checked_at")
        batch.drop_column("avatar_url")
