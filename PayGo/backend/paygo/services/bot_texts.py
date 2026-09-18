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
# one emoji: flags, symbols/pictographs with skin tones, variation selectors and ZWJ sequences
EMOJI_RE = re.compile(
    "(?:[\U0001F1E6-\U0001F1FF]{2}"
    "|(?:[\U0001F300-\U0001FAFF\U0001F170-\U0001F1E5\U0001F200-\U0001F2FF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u2139\u203C\u2049\u3030\u303D\u3297\u3299\u00A9\u00AE\u2122\u2194-\u21AA\u25AA-\u25FE\u2934\u2935\U0001F000-\U0001F02F]"
    "[\uFE0F\U0001F3FB-\U0001F3FF]*(?:\u200D[\U0001F300-\U0001FAFF\u2600-\u27BF][\uFE0F\U0001F3FB-\U0001F3FF]*)*))"
)
TG_EMOJI_TAG = re.compile(r"(<tg-emoji[^>]*>.*?</tg-emoji>)", re.S)
# premium (custom) emoji ids known from the PayGo sample — extended in Настройки → Бот → Premium-эмодзи
DEFAULT_EMOJI_MAP: dict[str, str] = {
    "👋": "5199885118214255386", "⚡": "5258203794772085854", "💰": "5278467510604160626", "👩‍💻": "5269617636001460986",
    "🔝": "5409015472517553802", "💬": "5443038326535759644", "👍": "5375410291184002717", "📌": "5397782960512444700",
    "💵": "5255981634527704754", "💸": "5255981634527704754", "⏰": "5370844655049008958", "⏳": "5370844655049008958",
    "❌": "5384234898494088007", "✖": "5384234898494088007", "⛔": "5384234898494088007", "ℹ": "5879785854284599288",
    "🛍": "5278702045883292456", "😎": "5240186449915039482", "🥇": "5247144889640056462", "🤩": "4949565894398314191",
}


def _norm_emoji(value: str) -> str:
    return str(value or "").replace("\ufe0f", "").strip()


def parse_emoji_map(raw: Any) -> dict[str, str]:
    """``emoji id`` per line (or a dict) → {emoji: custom_emoji_id}; merged over the built-in map."""
    out = dict(DEFAULT_EMOJI_MAP)
    if isinstance(raw, dict):
        items = raw.items()
    else:
        items = []
        for line in str(raw or "").splitlines():
            parts = line.replace("=", " ").replace(":", " ").split()
            if len(parts) >= 2:
                items.append((parts[0], parts[-1]))
    for emoji, ident in items:
        ident = str(ident or "").strip()
        key = _norm_emoji(emoji)
        if key and ident.isdigit():
            out[key] = ident
        elif key and ident in {"-", "0", "off"}:
            out.pop(key, None)
    return out


def premium_state(db: Session) -> dict[str, Any]:
    """What the client bot may do with emoji: premium on/off, strict (only premium), the id map."""
    return {
        "enabled": settings_store.get_bool(db, "premium_emoji_enabled"),
        "strict": settings_store.get_bool(db, "premium_only_emoji", True),
        "map": parse_emoji_map(settings_store.get(db, "premium_emoji_map")),
    }


def _lookup(state: dict[str, Any], emoji: str) -> str:
    table = state.get("map") or {}
    return str(table.get(emoji) or table.get(_norm_emoji(emoji)) or "")


def premiumize(text: str, state: dict[str, Any] | None) -> str:
    """Plain emoji → premium ``<tg-emoji>`` (by the map); in strict mode unmapped plain emoji are dropped.

    Text inside existing ``<tg-emoji>`` entities is left alone, so the call is idempotent."""
    if not state or not state.get("enabled") or not text:
        return text
    strict = bool(state.get("strict"))
    parts = TG_EMOJI_TAG.split(str(text))
    for i in range(0, len(parts), 2):  # even indexes are outside tg-emoji tags

        def _repl(m: re.Match) -> str:
            emoji = m.group(0)
            ident = _lookup(state, emoji)
            if ident:
                return f'<tg-emoji emoji-id="{ident}">{emoji}</tg-emoji>'
            return "" if strict else emoji

        seg = EMOJI_RE.sub(_repl, parts[i])
        if strict:  # tidy the gaps left by removed emoji (line starts only — never the space after an entity)
            seg = re.sub(r"[ \t]{2,}", " ", seg)
            seg = re.sub(r"\n[ \t]+", "\n", seg)
            if i == 0:
                seg = re.sub(r"^[ \t]+", "", seg)
            seg = re.sub(r"[ \t]+(?=\n)", "", seg)
        parts[i] = seg
    return "".join(parts)


def plain_label(text: str, state: dict[str, Any] | None) -> str:
    """Strip plain emoji from a label in strict mode (helper; the main menu keeps its plain emoji on purpose)."""
    if not state or not state.get("enabled") or not state.get("strict"):
        return text
    return re.sub(r"\s{2,}", " ", EMOJI_RE.sub("", str(text or ""))).strip() or text


def button_label(text: str, state: dict[str, Any] | None, icon: str = "") -> tuple[str, str]:
    """Inline button: a leading plain emoji becomes the button icon (premium) or is dropped (strict)."""
    text = str(text or "")
    if not state or not state.get("enabled"):
        return text, icon
    m = EMOJI_RE.match(text.lstrip())
    if not m:
        return text, icon
    rest = text.lstrip()[m.end():].strip()
    ident = icon or _lookup(state, m.group(0))
    if ident:
        return (rest or text), ident
    if state.get("strict"):
        return (rest or text), ""
    return text, icon


def premium_markup(markup: dict[str, Any] | None, state: dict[str, Any] | None) -> dict[str, Any] | None:
    """Inline keyboards: emoji in labels → premium icons (returns a new markup; the input is untouched)."""
    if not markup or not state or not state.get("enabled") or "inline_keyboard" not in markup:
        return markup
    rows = []
    for row in markup.get("inline_keyboard") or []:
        new_row = []
        for btn in row:
            b = dict(btn)
            label, ident = button_label(str(b.get("text") or ""), state, str(b.get("icon_custom_emoji_id") or ""))
            b["text"] = label
            if ident:
                b["icon_custom_emoji_id"] = ident
            new_row.append(b)
        rows.append(new_row)
    return {**markup, "inline_keyboard": rows}


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
