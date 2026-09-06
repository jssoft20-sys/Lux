"""Client-facing bot texts.

Every text the client bot sends is a template stored in system settings
(``Меню → Настройки → Тексты бота``) with a built-in default. Templates may use
``{placeholders}``, Telegram HTML (``<b>``, ``<i>``, ``<blockquote>``) and premium
emoji tokens ``[emoji:5247144889640056462:😎]`` — the token becomes a
``<tg-emoji>`` entity when ``premium_emoji_enabled`` is on, otherwise the plain
emoji after the second colon is shown. Placeholder values are HTML-escaped, the
template itself is trusted (edited by administrators only).
"""
from __future__ import annotations

import html
import re
from typing import Any

from sqlalchemy.orm import Session

from . import settings_store

PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
EMOJI_TOKEN = re.compile(r"\[emoji:(\d{3,40}):([^\]]{1,16})\]")
TAG = re.compile(r"<[^>]+>")
NON_LETTERS = re.compile(r"[^0-9a-zа-яё]+", re.IGNORECASE)


def render_template(template: str, *, premium: bool = False, **values: Any) -> str:
    safe = {key: html.escape(str(value), quote=False) for key, value in values.items() if value is not None}

    def _sub(match: re.Match) -> str:
        key = match.group(1)
        return safe[key] if key in safe else match.group(0)

    text = PLACEHOLDER.sub(_sub, str(template or ""))
    text = EMOJI_TOKEN.sub(lambda m: f'<tg-emoji emoji-id="{m.group(1)}">{m.group(2)}</tg-emoji>' if premium else m.group(2), text)
    return text


def strip_html(text: str) -> str:
    """Fallback when Telegram refuses the markup: plain text without tags."""
    return html.unescape(TAG.sub("", str(text or "")))


def common_values(db: Session) -> dict[str, Any]:
    return {
        "support": str(settings_store.get(db, "support_username") or ""),
        "brand": str(settings_store.get(db, "brand_name") or "PayGo"),
        "city": str(settings_store.get(db, "withdraw_city") or ""),
        "address": str(settings_store.get(db, "withdraw_address") or ""),
        "sla": str(settings_store.get(db, "withdraw_sla_text") or ""),
    }


def render(db: Session, key: str, *, default: str = "", **values: Any) -> str:
    template = settings_store.get(db, key)
    if template in (None, ""):
        template = default or settings_store.DEFAULTS.get(key, "")
    merged = {**common_values(db), **values}
    return render_template(str(template), premium=settings_store.get_bool(db, "premium_emoji_enabled"), **merged)


def instruction(db: Session, cash: Any = None) -> str:
    """Withdrawal instruction: the cash desk's own text or the global one, with city/address substituted."""
    template = (getattr(cash, "instructions_text", "") or "").strip() or str(settings_store.get(db, "instruction_text") or "")
    values = common_values(db)
    if cash is not None:
        values["city"] = (getattr(cash, "withdraw_city", "") or "").strip() or values["city"]
        values["address"] = (getattr(cash, "withdraw_address", "") or "").strip() or values["address"]
        values["cash"] = getattr(cash, "name", "")
        values["emoji"] = getattr(cash, "emoji", "")
    return render_template(template, premium=settings_store.get_bool(db, "premium_emoji_enabled"), **values)


def label_key(text: str) -> str:
    """Normalise a menu label / user message for comparison: letters and digits only, lower-case."""
    return NON_LETTERS.sub("", str(text or "")).lower()


def menu_labels(db: Session) -> dict[str, str]:
    return {
        "deposit": str(settings_store.get(db, "menu_deposit_label") or "📥 Пополнить"),
        "withdraw": str(settings_store.get(db, "menu_withdraw_label") or "📤 Вывести"),
        "help": str(settings_store.get(db, "menu_help_label") or "✉️ Помощь"),
    }


def match_menu(db: Session, text: str) -> str:
    """Return the menu action for a reply-keyboard press (or a bare word like «пополнить»)."""
    key = label_key(text)
    if not key:
        return ""
    for action, label in menu_labels(db).items():
        if key == label_key(label):
            return action
    aliases = {"deposit": {"пополнить", "пополнение", "deposit", "толуктоо"}, "withdraw": {"вывести", "вывод", "withdraw", "чыгаруу"}, "help": {"помощь", "поддержка", "оператор", "help", "жардам"}}
    for action, words in aliases.items():
        if key in words:
            return action
    return ""


def emoji_token(emoji: str, custom_emoji_id: str = "") -> str:
    """Emoji for a template value: a premium token when the id is known (rendered by ``render``), else the plain emoji."""
    emoji = str(emoji or "").strip()
    custom_emoji_id = str(custom_emoji_id or "").strip()
    if emoji and custom_emoji_id.isdigit():
        return f"[emoji:{custom_emoji_id}:{emoji}]"
    return emoji


def cash_emoji(cash: Any) -> str:
    return emoji_token(getattr(cash, "emoji", ""), getattr(cash, "custom_emoji_id", ""))
