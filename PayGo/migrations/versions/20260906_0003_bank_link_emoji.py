"""Bank link buttons: emoji and premium emoji id.

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bank_links") as batch:
        batch.add_column(sa.Column("emoji", sa.String(16), nullable=False, server_default=""))
        batch.add_column(sa.Column("custom_emoji_id", sa.String(32), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("bank_links") as batch:
        batch.drop_column("custom_emoji_id")
        batch.drop_column("emoji")
