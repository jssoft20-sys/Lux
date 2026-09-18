"""Support messages: reply-to, edit/delete marks, file names, carrier bot.

Revision ID: 0004
Revises: 0003
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("support_messages") as batch:
        batch.add_column(sa.Column("file_name", sa.String(200), nullable=False, server_default=""))
        batch.add_column(sa.Column("via", sa.String(8), nullable=False, server_default="support"))
        batch.add_column(sa.Column("reply_to_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key("fk_support_messages_reply_to", "support_messages", ["reply_to_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("support_messages") as batch:
        batch.drop_constraint("fk_support_messages_reply_to", type_="foreignkey")
        batch.drop_column("deleted_at")
        batch.drop_column("edited_at")
        batch.drop_column("reply_to_id")
        batch.drop_column("via")
        batch.drop_column("file_name")
