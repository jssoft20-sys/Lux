"""PayGo bot presentation: cash emoji/photos, deposit receipts.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

CASH_COLUMNS = [
    ("emoji", sa.String(16)),
    ("custom_emoji_id", sa.String(32)),
    ("deposit_photo", sa.String(300)),
    ("deposit_photo_text", sa.Text()),
    ("withdraw_photo", sa.String(300)),
    ("withdraw_photo_text", sa.Text()),
    ("code_photo", sa.String(300)),
    ("code_photo_text", sa.Text()),
    ("withdraw_city", sa.String(64)),
    ("withdraw_address", sa.String(128)),
]


def upgrade() -> None:
    with op.batch_alter_table("payment_cashes") as batch:
        for name, kind in CASH_COLUMNS:
            batch.add_column(sa.Column(name, kind, nullable=False, server_default=""))
    with op.batch_alter_table("deposits") as batch:
        batch.add_column(sa.Column("receipt_file", sa.String(300), nullable=False, server_default=""))
        batch.add_column(sa.Column("receipt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("deposits") as batch:
        batch.drop_column("receipt_at")
        batch.drop_column("receipt_file")
    with op.batch_alter_table("payment_cashes") as batch:
        for name, _kind in reversed(CASH_COLUMNS):
            batch.drop_column(name)
