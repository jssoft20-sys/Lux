"""Withdrawals: operator transfer receipt.

Revision ID: 0005
Revises: 0004
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("withdrawals") as batch:
        batch.add_column(sa.Column("receipt_file", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("receipt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("withdrawals") as batch:
        batch.drop_column("receipt_at")
        batch.drop_column("receipt_file")
