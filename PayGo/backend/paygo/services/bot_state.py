"""Persistent finite-state machine storage for Telegram chats."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BotSession


def get_state(db: Session, bot: str, telegram_id: int) -> tuple[str, dict[str, Any], int]:
    row = db.execute(select(BotSession).where(BotSession.bot == bot, BotSession.telegram_id == int(telegram_id))).scalar_one_or_none()
    if row is None:
        return "idle", {}, 0
    return row.state or "idle", dict(row.data or {}), int(row.panel_message_id or 0)


def set_state(db: Session, bot: str, telegram_id: int, state: str | None = None, data: dict[str, Any] | None = None, panel_message_id: int | None = None) -> BotSession:
    row = db.execute(select(BotSession).where(BotSession.bot == bot, BotSession.telegram_id == int(telegram_id))).scalar_one_or_none()
    if row is None:
        row = BotSession(bot=bot, telegram_id=int(telegram_id), state=state or "idle", data=dict(data or {}), panel_message_id=int(panel_message_id or 0))
        db.add(row)
    else:
        if state is not None:
            row.state = state
        if data is not None:
            row.data = dict(data)
        if panel_message_id is not None:
            row.panel_message_id = int(panel_message_id)
    db.flush()
    return row
