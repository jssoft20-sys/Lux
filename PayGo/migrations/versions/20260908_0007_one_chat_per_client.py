"""One support dialog per client + fast broadcast counters.

Existing conversations of one client are merged into a single one (messages are
re-pointed, nothing is lost); a prefix index lets the worker count broadcast
notifications without scanning the whole table.

Revision ID: 0007
Revises: 0006
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

OPEN = ("waiting_operator", "operator", "auto")


def upgrade() -> None:
    conn = op.get_bind()
    conversations = sa.table(
        "support_conversations",
        sa.column("id", sa.Integer), sa.column("user_id", sa.Integer), sa.column("status", sa.String), sa.column("created_at", sa.DateTime),
        sa.column("last_message_at", sa.DateTime), sa.column("last_user_message_at", sa.DateTime), sa.column("unread_count", sa.Integer),
    )
    messages = sa.table("support_messages", sa.column("id", sa.Integer), sa.column("conversation_id", sa.Integer), sa.column("created_at", sa.DateTime), sa.column("direction", sa.String), sa.column("read_by_admin", sa.Boolean))
    dupes = conn.execute(sa.select(conversations.c.user_id).group_by(conversations.c.user_id).having(sa.func.count(conversations.c.id) > 1)).scalars().all()
    for user_id in dupes:
        rows = conn.execute(sa.select(conversations.c.id, conversations.c.status, conversations.c.created_at).where(conversations.c.user_id == user_id).order_by(conversations.c.id.desc())).all()
        open_ids = [r.id for r in rows if r.status in OPEN]
        keep = open_ids[0] if open_ids else rows[0].id
        others = [r.id for r in rows if r.id != keep]
        if not others:
            continue
        conn.execute(sa.update(messages).where(messages.c.conversation_id.in_(others)).values(conversation_id=keep))
        conn.execute(sa.delete(conversations).where(conversations.c.id.in_(others)))
        stats = conn.execute(
            sa.select(sa.func.max(messages.c.created_at), sa.func.max(sa.case((messages.c.direction == "in", messages.c.created_at), else_=None))).where(messages.c.conversation_id == keep)
        ).one()
        unread = 0
        if open_ids:
            unread = conn.execute(sa.select(sa.func.count(messages.c.id)).where(messages.c.conversation_id == keep, messages.c.direction == "in", messages.c.read_by_admin.is_(False))).scalar() or 0
        conn.execute(
            sa.update(conversations).where(conversations.c.id == keep).values(created_at=min(r.created_at for r in rows if r.created_at) if any(r.created_at for r in rows) else None, last_message_at=stats[0], last_user_message_at=stats[1], unread_count=int(unread))
        )
    op.create_index("ix_notifications_event_key_prefix", "notifications", ["event_key"], unique=False, postgresql_ops={"event_key": "text_pattern_ops"})


def downgrade() -> None:
    op.drop_index("ix_notifications_event_key_prefix", table_name="notifications")
