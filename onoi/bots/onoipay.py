#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ONOI PAY — клиентский бот @OnoiPayBot (bots/onoipay.py), v12 «premium stable».

База — main_bot.py (LUXON): те же эндпоинты бэкенда, состояния, гарды, outbox. Поверх:
  • у клиента один экран-панель: приветствие → выбор БК → ID → сумма → заявка — всё это
    одно сообщение, которое редактируется (inline-кнопки). Ввод клиента убирается сразу.
  • самое первое приветствие никогда не удаляется (если экран уходит в фото-заявку,
    приветствие возвращает свой текст). Итоги заявок — постоянные сообщения.
  • тексты короткие; ошибка заменяет текст шага, а не плодит сообщения.
  • таймер 5:00 на заявке (обновление каждые 10 сек), загрузка ⚡ перед запросами.
  • premium-эмодзи (общий набор, логотипы БК и банков), цвета кнопок под бренд и под банки,
    авто-фолбэк без premium, ретраи на 429, дедупликация update_id, SIGTERM.
"""
import base64
import hashlib
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
import re
import signal
import sqlite3
import threading
import time
import traceback
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import cfg, api, tg, delete_many

try:
    import cv2  # basic face detection for identification if OpenCV is available
    import numpy as np
except Exception:
    cv2 = None
    np = None

try:
    # Общий реестр с main_bot.py: чьё уведомление outbox, когда оба бота работают на одном бэкенде.
    import outbox_owner as OWNER
except Exception:
    OWNER = None

BASE = Path(__file__).resolve().parents[1]
DB = BASE / "data" / "onoi.sqlite3"
DB.parent.mkdir(parents=True, exist_ok=True)
REF_IMAGE = BASE / "data" / "onoi_referral.png"
IDENT_IMAGE = BASE / "data" / "onoi_ident_instruction.png"

# ============================================================ бренд / окружение
BRAND = "Onoi Pay"
BOT_TOKEN = os.environ.get("ONOI_BOT_TOKEN", "8822484493:AAGOiTTnA3YTEb1zhlGKpPK_kZS-QZdSf2A").strip()
BOT_USERNAME = os.environ.get("ONOI_BOT_USERNAME", "OnoiPayBot").strip().lstrip("@")
REF_BONUS_PCT = float(os.environ.get("ONOI_REF_BONUS_PCT", "1.0") or 1.0)
REF_WITHDRAW_MIN = float(os.environ.get("ONOI_REF_WITHDRAW_MIN", "0") or 0)
SUPPORT = os.environ.get("ONOI_SUPPORT", "@OnoiHelpBot").strip()
if SUPPORT and not SUPPORT.startswith("@"):
    SUPPORT = "@" + SUPPORT
PRIVACY_URL = os.environ.get("ONOI_PRIVACY_URL", "https://wwweeewww.fit/privacy").strip() or "https://wwweeewww.fit/privacy"
OUTBOX_BOT = os.environ.get("ONOI_OUTBOX_BOT", "main").strip() or "main"
# Outbox бэкенда общий с LUXON. Уведомление для чата, который Onoi не знает (клиент LUXON),
# не трогаем столько секунд — его доставит main_bot.py. Если LUXON выключен и никто не забрал —
# доставляем сами (попытка отправки чужому чату упадёт и уведомление закроется как failed).
OUTBOX_TAKEOVER = float(os.environ.get("OUTBOX_TAKEOVER", "20") or 0)
CONTENT_PROTECTION_VERSION = "10"  # force protected-content migration for old chat panels

# ============================================================ premium-эмодзи
# Общий набор — порядок как в стикерпаке: ❌ ✅ 🛜 🗺 🔂 😈 💎 ☄️ 💭 📥 📤
CE = {
    "cross":    "5384234898494088007",  # ❌  отмена, ошибки
    "check":    "6116362711761687276",  # ✅  подтверждение, «операции защищены»
    "signal":   "5375410291184002717",  # 🛜  онлайн, 24/7, «заявка активна»
    "pay":      "5330320040883411678",  # 🗺  оплата, реквизиты, сумма, QR кошелька
    "menu":     "5395408436303258479",  # 🔂  главное меню, начать заново
    "mascot":   "5197645099495862838",  # 😈  маскот бренда — приветствие
    "gem":      "4999002445444023072",  # 💎  комиссия 0%
    "bolt":     "5224607267797606837",  # ☄️  загрузка, «моментально»
    "cloud":    "5467538555158943525",  # 💭  поддержка
    "deposit":  "5443127283898405358",  # 📥  (не используется: кнопки Пополнить/Вывести — signal)
    "withdraw": "5445355530111437729",  # 📤  (не используется)
    "on":       "6237651574588445185",  # ✅  ON — успех, доступно
    "off":      "6237790860377854962",  # ✅  OFF — букмекер отключён
    "plane":    "5201691993775818138",  # 🛫  вывод (история)
    "receipt":  "5444856076954520455",  # 🧾  история заявок
    "heart":    "5267102644886853973",  # ❤️  бонус
    "timer":    "5382194935057372936",  # ⏱  таймер, дата
    # premium set 01.09.2026
    "ui_slider": "6260264603171689263",   # 🎚  язык / настройки
    "ui_slider2":"6262360963823964921",   # 🎚  альтернативный
    "ui_check":  "6116362711761687276",   # ✅
    "ui_check2": "6269163801178804220",   # ✅ alt
    "ui_shield": "6174589325695521740",   # 🛡
    "ui_mail":   "6269255258212404947",   # ✉️
    "ui_calendar":"5274055917766202507",  # 🗓
    "ui_shop":   "5278702045883292456",   # 🛍
    "ui_coin":   "5264713049637409446",   # 🪙
    "ui_hundred":"5341498088408234504",   # 💯
    "ui_edit":   "5395444784611480792",   # ✏️
}

# Обычный эмодзи в тексте → premium. Клиент без premium видит сам обычный эмодзи.
EMOJI_MAP = {
    "❌": "cross",
    "✅": "ui_check", "🔐": "ui_shield", "🛡": "ui_shield",
    "🟢": "on", "🔴": "off",
    "🛜": "signal", "🕐": "signal", "🌐": "signal",
    "🗺": "pay", "💳": "pay", "💰": "pay",
    "🔂": "menu", "🔄": "menu",
    "😈": "mascot", "👋": "mascot", "😬": "mascot",
    "💎": "gem", "💸": "gem",
    "☄": "bolt", "⚡": "bolt",
    "⏳": "timer", "⏰": "timer", "⏱": "timer", "🕒": "timer",
    "🧾": "receipt", "🛫": "plane", "❤": "heart", "🎁": "heart",
    "❗": "cross", "⚠": "cross",
    "💭": "cloud", "💬": "cloud", "📞": "cloud",
    "📥": "signal",
    "📤": "signal",
    "🎚": "ui_slider",
    "✉": "ui_mail",
    "🗓": "ui_calendar",
    "🛍": "ui_shop",
    "🪙": "ui_coin",
    "💯": "ui_hundred",
    "✏": "ui_edit",
}

# Логотипы БК — порядок как в стикерпаке.
BOOKMAKERS = ["1XBET", "1WIN", "MELBET", "888STARZ", "MOSTBET", "WINWIN"]
BK_EMOJI = {
    "1XBET":    "5240186449915039482",
    "1WIN":     "5240296285113701836",
    "MELBET":   "5240122536506708778",
    "888STARZ": "5239981193427964383",
    "MOSTBET":  "5240222381611437182",
    "WINWIN":   "5242225318135090893",
}
BK_KEYS = {x.lower() for x in BOOKMAKERS}
BK_BASE = "😎"  # символ-подложка для логотипа БК в тексте
# Подложки для списка всех БК в одном тексте (у каждого логотипа свой символ-носитель).
BK_BASES = {"1XBET": "😎", "1WIN": "😏", "MELBET": "😉", "888STARZ": "🤩", "MOSTBET": "😁", "WINWIN": "😃"}

# Логотипы банков — порядок как в стикерпаке.
BANK_ORDER = ["bakai", "companion", "mbank", "odengi", "demir", "megapay", "optima"]
BANK_EMOJI = {
    "bakai":     "4947478299774289952",
    "companion": "4949471310628521778",
    "mbank":     "4949665490394940974",
    "odengi":    "4949675944345339585",
    "demir":     "4949744401829070437",
    "megapay":   "4949565894398314191",
    "optima":    "5035298415198602985",
}
BANK_ALIASES = {
    "bakai":     ("bakai", "бакай"),
    "companion": ("companion", "kompanion", "компаньон"),
    "mbank":     ("mbank", "мбанк"),
    "odengi":    ("odengi", "omoney", "oденьги", "оденьги", "o!деньги", "деньги"),
    "demir":     ("demir", "демир"),
    "megapay":   ("megapay", "мегапей", "мегапэй"),
    "optima":    ("optima", "оптима"),
}

# Строки, начинающиеся с "> ", уходят в Telegram как цитата (blockquote) — компактнее.
GREETING_TMPL = (
    "👋 Привет, {name}!\n\n"
    "> 💳 Пополнение и вывод средств\n"
    "> 💸 Комиссия — 0%\n"
    "> 🕐 Работаем 24/7\n"
    "> 🔐 Операции защищены\n\n"
    "💬 Поддержка: " + SUPPORT
)

FLOW_STATES = {
    "choose_bk", "choose_id", "wait_id", "wait_amount",
    "wait_qr", "wait_code", "wait_bank", "wait_receipt", "wait_ident_photo", "wait_phone",
}
PAYING_STATES = ("wait_bank", "wait_receipt")
# Живут весь диалог, не теряются между шагами.
PERSIST_KEYS = ("greeting_id", "first_name", "panel_id", "panel_kind", "panel_receipt", "kb_cleared", "protect_v")
# Ключи активной заявки — чистим при выходе в главное меню.
REQUEST_KEYS = ("request_id", "deadline", "methods", "qr_url", "payment_text", "qr_file_url", "view")

STOP = threading.Event()


# ============================================================ текст
def normalized_text(value):
    return " ".join(str(value or "").replace("❌", " ").strip().casefold().split())


def is_cancel(value):
    return normalized_text(value) in {
        "отмена", "отменить", "отменить пополнение", "назад", "cancel", "/cancel",
        "жокко чыгаруу", "артка", "толуктоону жокко чыгаруу",
    }


def is_support(value):
    t = normalized_text(value)
    return "поддержк" in t or "колдоо" in t


def detect_action(value):
    t = normalized_text(value)
    if "пополнить" in t or t == "пополнение" or "толуктоо" in t:
        return "deposit"
    if "вывести" in t or t == "вывод" or "чыгаруу" in t:
        return "withdraw"
    return None


def utf16_len(value):
    return len(str(value).encode("utf-16-le")) // 2


_VS16 = "\ufe0f"
_BASE_TABLE = None


def _base_table():
    global _BASE_TABLE
    if _BASE_TABLE is None:
        table = {}
        for sym, key in EMOJI_MAP.items():
            table[sym] = CE[key]
            table[sym + _VS16] = CE[key]
        _BASE_TABLE = table
    return _BASE_TABLE


def premium_entities(text, extra=None):
    """Entities premium-эмодзи для любого текста (наши экраны, тексты бэкенда, outbox).

    extra — дополнительные пары (символ, custom_emoji_id): логотипы БК/банков в тексте.
    """
    text = str(text or "")
    table = _base_table()
    if extra:
        table = dict(table)
        for sym, emoji_id in extra:
            if sym and emoji_id:
                table[sym] = emoji_id
                table[sym + _VS16] = emoji_id
    symbols = sorted(table.items(), key=lambda kv: -len(kv[0]))
    out = []
    i, off, n = 0, 0, len(text)
    while i < n:
        for sym, emoji_id in symbols:
            if text.startswith(sym, i):
                out.append({"type": "custom_emoji", "offset": off, "length": utf16_len(sym), "custom_emoji_id": emoji_id})
                off += utf16_len(sym)
                i += len(sym)
                break
        else:
            off += 2 if ord(text[i]) > 0xFFFF else 1
            i += 1
    if SUPPORT:
        pos = 0
        while True:
            idx = text.find(SUPPORT, pos)
            if idx < 0:
                break
            out.append({"type": "mention", "offset": utf16_len(text[:idx]), "length": utf16_len(SUPPORT)})
            pos = idx + len(SUPPORT)
    return sorted(out, key=lambda x: x["offset"])


# Всё, что похоже на эмодзи, но не имеет premium-версии, из текста убираем —
# в боте нет обычных смайлов (правило для наших текстов, текстов бэкенда и рассылок).
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2300-\u23FF\u2B00-\u2BFF\U0001F1E6-\U0001F1FF\uFE0F\u200D\u20E3]"
)


def clean_text(text, extra=None):
    text = str(text or "")
    table = dict(_base_table())
    for sym, emoji_id in (extra or []):
        if sym and emoji_id:
            table[sym] = emoji_id
            table[sym + _VS16] = emoji_id
    symbols = sorted(table, key=len, reverse=True)
    out = []
    i, n = 0, len(text)
    while i < n:
        for sym in symbols:
            if text.startswith(sym, i):
                out.append(sym)
                i += len(sym)
                break
        else:
            ch = text[i]
            if _EMOJI_RE.match(ch):
                i += 1
                if i < n and text[i] == " " and (not out or out[-1][-1:] in ("\n", " ")):
                    i += 1
                continue
            out.append(ch)
            i += 1
    cleaned = "".join(out)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def parse_quotes(text):
    """«> строка» → blockquote-entity. Возвращает (текст без маркеров, entities)."""
    out, ents = [], []
    off, start, end = 0, None, None
    for line in str(text or "").split("\n"):
        quoted = line.startswith("> ") or line == ">"
        body = line[2:] if line.startswith("> ") else ("" if line == ">" else line)
        if quoted:
            if start is None:
                start = off
            end = off + utf16_len(body)
        elif start is not None:
            ents.append({"type": "blockquote", "offset": start, "length": end - start})
            start = None
        out.append(body)
        off += utf16_len(body) + 1
    if start is not None:
        ents.append({"type": "blockquote", "offset": start, "length": end - start})
    return "\n".join(out), ents


def quote_rest(text):
    """Первая строка как есть, остальное — цитатой (для текстов бэкенда и уведомлений)."""
    lines = [ln for ln in str(text or "").strip().split("\n")]
    if len(lines) < 2:
        return text
    head, rest = lines[0], [ln for ln in lines[1:] if ln.strip()]
    return head + "\n\n" + "\n".join("> " + ln for ln in rest)


def _literal_entities(text, phrase, entity_type, all_matches=True):
    out = []
    start = 0
    phrase = str(phrase or "")
    if not phrase:
        return out
    while True:
        idx = text.find(phrase, start)
        if idx < 0:
            break
        out.append({"type": entity_type, "offset": utf16_len(text[:idx]), "length": utf16_len(phrase)})
        if not all_matches:
            break
        start = idx + len(phrase)
    return out


def style_entities(text):
    """Лёгкая типографика Telegram без Markdown: заголовки, важные подписи, акценты."""
    out = []
    headings = (
        "Профиль OnoiPay", "OnoiPay профили", "Идентификация", "Реферальная система", "Рефералдык система",
        "История заявок", "Өтүнмөлөр тарыхы", "Подтверждение номера", "Номерди ырастоо",
    )
    for h in headings:
        if h in text:
            out += _literal_entities(text, h, "bold", all_matches=False)
    labels = (
        "Telegram ID:", "Username:", "Номер:", "Пополнений:", "Выводов:", "Реферальный баланс:",
        "QR вывода:", "Статус идентификации:", "Язык:", "Телефон:",
        "Толуктоолор:", "Чыгаруулар:", "Рефералдык баланс:", "Чыгаруу QR'ы:", "Идентификация абалы:", "Тил:",
        "Статистика",
    )
    for label in labels:
        out += _literal_entities(text, label, "bold")
    italics = (
        "Данные и настройки аккаунта", "Аккаунт маалыматы жана жөндөөлөрү",
        "Пример на изображении — ориентир", "Сүрөттөгү мисал — үлгү",
    )
    for phrase in italics:
        out += _literal_entities(text, phrase, "italic")
    return out


def render(text, extra=None):
    """Полная подготовка текста: чистка эмодзи → цитаты → premium + rich entities."""
    text = clean_text(text, extra)
    text, quotes = parse_quotes(text)
    return text, sorted(quotes + style_entities(text) + premium_entities(text, extra), key=lambda x: x["offset"])


def bk_list_extra():
    return [(BK_BASES[n], BK_EMOJI[n]) for n in BOOKMAKERS]


def ico(emoji, text):
    """Эмодзи вне цитаты, текст — цитатой."""
    return f"{emoji}\n" + "\n".join("> " + ln for ln in str(text).split("\n"))


def err(text):
    return ico("❌", text)


def bk_extra(bk):
    return [(BK_BASE, BK_EMOJI.get(str(bk or "").upper(), ""))]




def greeting_text(name):
    return GREETING_TMPL.replace("{name}", str(name or "друг"))


def fmt_amount(value):
    return f"{int(value):,}".replace(",", " ")


def fmt_money(value):
    try:
        v = float(value)
    except Exception:
        return str(value)
    if abs(v - int(round(v))) < 1e-9:
        return fmt_amount(int(round(v)))
    s = f"{v:,.2f}".replace(",", " ")
    return s.rstrip("0").rstrip(".")


# ============================================================ БД
def conn():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=30000")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA temp_store=MEMORY")
    return c


with conn() as _c:
    _c.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS state(
      chat_id INTEGER PRIMARY KEY, state TEXT, data TEXT, last_bot_messages TEXT
    );
    CREATE TABLE IF NOT EXISTS saved(
      chat_id INTEGER, bk TEXT, player_id TEXT, updated_at INTEGER,
      UNIQUE(chat_id,bk,player_id)
    );
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT);
    CREATE TABLE IF NOT EXISTS history(
      chat_id INTEGER, request_id TEXT, kind TEXT, bk TEXT, player_id TEXT, amount REAL,
      status TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(chat_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS referrals(
      chat_id INTEGER PRIMARY KEY, code TEXT UNIQUE, invited_by INTEGER, invited_at INTEGER,
      reward_balance REAL DEFAULT 0, reward_total REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referral_rewards(
      request_id TEXT PRIMARY KEY, referrer_id INTEGER, invited_id INTEGER, amount REAL, reward REAL, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS saved_qr(
      chat_id INTEGER PRIMARY KEY, file_id TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identifications(
      chat_id INTEGER PRIMARY KEY, file_id TEXT, status TEXT NOT NULL DEFAULT 'none',
      face_count INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, note TEXT
    );
    CREATE TABLE IF NOT EXISTS user_info(
      chat_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS referral_payouts(
      id TEXT PRIMARY KEY, chat_id INTEGER NOT NULL, amount REAL NOT NULL, qr_file_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS final_notice_dedupe(
      chat_id INTEGER NOT NULL, request_id TEXT NOT NULL, final_key TEXT NOT NULL, sent_at INTEGER NOT NULL,
      PRIMARY KEY(chat_id, request_id, final_key)
    );
    CREATE INDEX IF NOT EXISTS idx_history_chat_kind_created ON history(chat_id, kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_chat_created ON history(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_referrals_invited_by ON referrals(invited_by);
    CREATE INDEX IF NOT EXISTS idx_ref_payouts_chat_status ON referral_payouts(chat_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_final_notice_sent_at ON final_notice_dedupe(sent_at);
    """)
    # Миграции без удаления старой базы.
    _cols = {str(r[1]) for r in _c.execute("PRAGMA table_info(user_info)").fetchall()}
    if "lang" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN lang TEXT NOT NULL DEFAULT 'ru'")
    if "phone" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN phone TEXT")
    if "phone_verified" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0")
    if "phone_verified_at" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN phone_verified_at INTEGER")
    if "privacy_accepted" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN privacy_accepted INTEGER NOT NULL DEFAULT 0")
    if "privacy_accepted_at" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN privacy_accepted_at INTEGER")
    if "ident_consent_at" not in _cols:
        _c.execute("ALTER TABLE user_info ADD COLUMN ident_consent_at INTEGER")


def get_state(cid):
    with conn() as c:
        r = c.execute("SELECT * FROM state WHERE chat_id=?", (cid,)).fetchone()
    if not r:
        return "idle", {}, []
    try:
        data = json.loads(r["data"] or "{}")
    except Exception:
        data = {}
    try:
        msgs = [int(x) for x in json.loads(r["last_bot_messages"] or "[]")]
    except Exception:
        msgs = []
    return r["state"] or "idle", data if isinstance(data, dict) else {}, msgs


def set_state(cid, state, data=None, msgs=None):
    old_state, old_data, old_msgs = get_state(cid)
    data = old_data if data is None else dict(data)
    for key in PERSIST_KEYS:
        if data.get(key) is None and old_data.get(key) is not None:
            data[key] = old_data.get(key)
    msgs = old_msgs if msgs is None else [int(x) for x in msgs]
    with conn() as c:
        c.execute(
            "INSERT INTO state(chat_id,state,data,last_bot_messages) VALUES(?,?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET state=excluded.state,data=excluded.data,last_bot_messages=excluded.last_bot_messages",
            (cid, state, json.dumps(data, ensure_ascii=False), json.dumps(msgs[-40:])),
        )






STATUS_LABEL = {
    "active": "⏱ Ожидает оплаты", "success": "🟢 Зачислено", "cancelled": "❌ Отменена", "expired": "❌ Истекла",
    "pending": "⏱ В обработке", "done": "🟢 Выполнен", "rejected": "❌ Отклонён",
}
STATUS_SHORT = {
    "active": "ожидает оплаты", "success": "зачислено", "cancelled": "отменена", "expired": "истекла",
    "pending": "в обработке", "done": "выполнен", "rejected": "отклонён",
}


def hist_add(cid, rid, kind, bk, pid, amount, status):
    try:
        now = int(time.time())
        with conn() as c:
            c.execute(
                "INSERT INTO history(chat_id,request_id,kind,bk,player_id,amount,status,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,request_id) DO UPDATE SET status=excluded.status,"
                "updated_at=excluded.updated_at",
                (int(cid), str(rid), kind, str(bk or "").lower(), str(pid or ""), amount, status, now, now))
    except Exception:
        traceback.print_exc()


def hist_set(cid, rid, status):
    if not rid:
        return
    try:
        with conn() as c:
            c.execute("UPDATE history SET status=?, updated_at=? WHERE chat_id=? AND request_id=?",
                      (status, int(time.time()), int(cid), str(rid)))
    except Exception:
        traceback.print_exc()


def hist_latest(cid, kind, statuses):
    """Последняя заявка данного вида в одном из статусов (для уведомлений без id)."""
    try:
        with conn() as c:
            marks = ",".join("?" * len(statuses))
            r = c.execute(f"SELECT request_id FROM history WHERE chat_id=? AND kind=? AND status IN ({marks}) "
                          "ORDER BY created_at DESC LIMIT 1", (int(cid), kind, *statuses)).fetchone()
        return r[0] if r else ""
    except Exception:
        return ""


def hist_list(cid, limit=10, kind=None, offset=0):
    try:
        limit = max(1, min(50, int(limit)))
        offset = max(0, int(offset))
        with conn() as c:
            if kind in ("deposit", "withdraw"):
                rows = c.execute(
                    "SELECT * FROM history WHERE chat_id=? AND kind=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (int(cid), kind, limit, offset),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT * FROM history WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (int(cid), limit, offset),
                ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def hist_total(cid, kind=None):
    try:
        with conn() as c:
            if kind in ("deposit", "withdraw"):
                r = c.execute("SELECT COUNT(1) FROM history WHERE chat_id=? AND kind=?", (int(cid), kind)).fetchone()
            else:
                r = c.execute("SELECT COUNT(1) FROM history WHERE chat_id=?", (int(cid),)).fetchone()
        return int(r[0] or 0) if r else 0
    except Exception:
        return 0


def hist_counts(cid):
    try:
        with conn() as c:
            rows = c.execute(
                "SELECT kind, COUNT(1) n FROM history WHERE chat_id=? GROUP BY kind", (int(cid),)
            ).fetchall()
        m = {str(r["kind"]): int(r["n"] or 0) for r in rows}
        return m.get("deposit", 0), m.get("withdraw", 0)
    except Exception:
        return 0, 0


def hist_get(cid, rid):
    try:
        with conn() as c:
            r = c.execute("SELECT * FROM history WHERE chat_id=? AND request_id=?", (int(cid), str(rid))).fetchone()
        return dict(r) if r else None
    except Exception:
        return None


def fmt_dt(ts):
    return time.strftime("%d.%m.%Y %H:%M", time.gmtime(int(ts or 0) + 6 * 3600))  # Бишкек, UTC+6


def save_id(cid, bk, pid):
    with conn() as c:
        c.execute(
            "INSERT INTO saved(chat_id,bk,player_id,updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(chat_id,bk,player_id) DO UPDATE SET updated_at=excluded.updated_at",
            (cid, bk, pid, int(time.time())),
        )


def saved_ids(cid, bk):
    with conn() as c:
        return [r[0] for r in c.execute(
            "SELECT player_id FROM saved WHERE chat_id=? AND bk=? ORDER BY updated_at DESC LIMIT 8", (cid, bk)
        ).fetchall()]


def forget_saved_id(cid, bk, pid):
    try:
        with conn() as c:
            c.execute("DELETE FROM saved WHERE chat_id=? AND bk=? AND player_id=?",
                      (int(cid), str(bk or "").strip().lower(), str(pid or "").strip()))
    except Exception:
        pass


def get_meta(key, default="0"):
    with conn() as c:
        r = c.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
    return r[0] if r else default


def set_meta(key, value):
    with conn() as c:
        c.execute("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (key, str(value)))


# ============================================================ профиль / постоянный QR
def remember_user(uid):
    uid = uid or {}
    cid = int(uid.get("id") or 0)
    if not cid:
        return
    username = str(uid.get("username") or "").strip()
    first_name = str(uid.get("first_name") or "").strip()
    now = int(time.time())
    try:
        with conn() as c:
            old = c.execute("SELECT created_at FROM user_info WHERE chat_id=?", (cid,)).fetchone()
            created = int(old[0]) if old and old[0] else now
            c.execute(
                "INSERT INTO user_info(chat_id,username,first_name,created_at,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,updated_at=excluded.updated_at",
                (cid, username, first_name, created, now),
            )
    except Exception:
        traceback.print_exc()


def get_user_info(cid):
    try:
        with conn() as c:
            r = c.execute("SELECT * FROM user_info WHERE chat_id=?", (int(cid),)).fetchone()
        return dict(r) if r else {}
    except Exception:
        return {}


def phone_verified(cid):
    info = get_user_info(cid)
    return bool(str(info.get("phone") or "").strip() and int(info.get("phone_verified") or 0) == 1)


def privacy_accepted(cid):
    info = get_user_info(cid)
    try:
        return int(info.get("privacy_accepted") or 0) == 1
    except Exception:
        return False


def save_privacy_consent(cid):
    now = int(time.time())
    with conn() as c:
        c.execute(
            "UPDATE user_info SET privacy_accepted=1, privacy_accepted_at=?, updated_at=? WHERE chat_id=?",
            (now, now, int(cid)),
        )

def save_ident_consent(cid):
    now = int(time.time())
    with conn() as c:
        c.execute("UPDATE user_info SET ident_consent_at=?, updated_at=? WHERE chat_id=?", (now, now, int(cid)))

def privacy_btn(text="Конфиденциальность"):
    # Web App button keeps the raw URL out of the message/button UI.
    # Telegram can still technically expose the web origin in its WebView/security UI.
    return ib(text, web_app=PRIVACY_URL, style=NEUTRAL, icon=CE["ui_shield"])

def show_privacy_gate(cid, name, d=None):
    d = dict(d or {})
    text = (
        "🔐 Политика конфиденциальности\n\n"
        "> Перед подтверждением номера ознакомьтесь с Политикой конфиденциальности\n"
        "> Продолжая, вы соглашаетесь с Политикой конфиденциальности"
    )
    ikb = kb(
        [privacy_btn("Открыть политику")],
        [ib("Согласен и продолжить", "privacy:accept", icon=CE["check"])],
    )
    panel(cid, text, ikb, state="idle", data={**_idle_data(d, name), "view": "privacy_gate"})

def show_ident_consent(cid, name, d=None):
    d = dict(d or {})
    text = (
        "🔐 Идентификация\n\n"
        "> Перед отправкой селфи подтвердите согласие на обработку данных идентификации\n"
        "> Фото используется для проверки личности и безопасности операций\n"
        "> Продолжая, вы соглашаетесь с Политикой конфиденциальности"
    )
    ikb = kb(
        [privacy_btn("Открыть политику")],
        [ib("Согласен и продолжить", "ident:consent", icon=CE["check"])],
        [ib("Назад", "profile", icon=CE["menu"])],
    )
    panel(cid, text, ikb, state="idle", data={**_idle_data(d, name), "view": "ident_consent"})


def normalize_phone(value):
    raw = re.sub(r"[^0-9+]", "", str(value or "").strip())
    if raw.startswith("00"):
        raw = "+" + raw[2:]
    elif raw and not raw.startswith("+"):
        raw = "+" + raw
    return raw[:32]


def save_phone(cid, phone):
    phone = normalize_phone(phone)
    now = int(time.time())
    with conn() as c:
        c.execute(
            "UPDATE user_info SET phone=?, phone_verified=1, phone_verified_at=?, updated_at=? WHERE chat_id=?",
            (phone, now, now, int(cid)),
        )
    return phone


def _phone_reply_markup(cid):
    label = "Номерди ырастоо" if get_lang(cid) == "kg" else "Подтвердить номер"
    return {
        "keyboard": [[{"text": label, "request_contact": True}]],
        "resize_keyboard": True, "one_time_keyboard": True, "is_persistent": False,
    }


def request_phone(cid, name, d=None, skip_privacy=False):
    """Запрашиваем только собственный Telegram contact. До подтверждения остальные функции закрыты."""
    d = dict(d or {})
    if not skip_privacy and not privacy_accepted(cid):
        show_privacy_gate(cid, name, d)
        return 0
    text = localize_text(cid,
        "📱 Подтверждение номера\n\n"
        "> Для безопасности подтвердите номер Telegram\n"
        "> Нажмите кнопку ниже и отправьте свой контакт\n"
        "> После подтверждения откроются все функции бота"
    )
    text, entities = render(text)
    try:
        m = tg(token(), "sendMessage", {
            "chat_id": int(cid), "text": text, "entities": entities,
            "reply_markup": _phone_reply_markup(cid), "protect_content": True,
        }, timeout=8)
        mid = int((m or {}).get("message_id") or 0)
    except Exception:
        traceback.print_exc()
        mid = 0
    nd = _idle_data(d, name)
    if mid:
        nd.update(panel_id=mid, panel_kind="text", panel_receipt=False, protect_v=CONTENT_PROTECTION_VERSION)
    set_state(cid, "wait_phone", nd)
    return mid


def get_lang(cid):
    try:
        with conn() as c:
            r = c.execute("SELECT lang FROM user_info WHERE chat_id=?", (int(cid),)).fetchone()
        value = str(r[0] or "ru").lower() if r else "ru"
        return value if value in ("ru", "kg") else "ru"
    except Exception:
        return "ru"


def set_lang(cid, lang):
    lang = "kg" if str(lang).lower() == "kg" else "ru"
    now = int(time.time())
    with conn() as c:
        c.execute(
            "INSERT INTO user_info(chat_id,username,first_name,created_at,updated_at,lang) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET lang=excluded.lang,updated_at=excluded.updated_at",
            (int(cid), "", "", now, now, lang),
        )
    return lang


# Кыргызская локализация выполняется в последнюю секунду перед отправкой.
# Поэтому бизнес-логика, callback_data и данные БД остаются едиными и не дублируются.
_KG_TEXT = [
    ("Привет,", "Салам,"),
    ("Пополнение и вывод средств", "Каражат толуктоо жана чыгаруу"),
    ("Пополнение счёта", "Эсепти толуктоо"),
    ("Комиссия — 0%", "Комиссия — 0%"),
    ("Работаем 24/7", "24/7 иштейбиз"),
    ("Операции защищены", "Операциялар корголгон"),
    ("Поддержка", "Колдоо"),
    ("Профиль OnoiPay", "OnoiPay профили"),
    ("Идентификация", "Идентификация"),
    ("Отправить селфи", "Селфи жөнөтүү"),
    ("Обновить селфи", "Селфини жаңыртуу"),
    ("Статус идентификации", "Идентификация абалы"),
    ("не пройдена", "өтүлө элек"),
    ("на проверке", "текшерүүдө"),
    ("проверена", "текшерилген"),
    ("отклонена", "четке кагылган"),
    ("Отправьте одно селфи, где хорошо видно лицо", "Жүзүңүз так көрүнгөн бир селфи жөнөтүңүз"),
    ("Держите в руке лист с сегодняшней датой и временем", "Колуңузга бүгүнкү дата жана убакыт жазылган баракты кармаңыз"),
    ("Фото пройдёт базовую автоматическую проверку лица и сохранится на проверку", "Сүрөт жүздү базалык автоматтык текшерүүдөн өтүп, текшерүүгө сакталат"),
    ("Пожалуйста, отправьте одну фотографию с одним лицом", "Сураныч, бир жүзү бар бир гана сүрөт жөнөтүңүз"),
    ("Лицо не найдено. Отправьте более чёткое селфи", "Жүз табылган жок. Такыраак селфи жөнөтүңүз"),
    ("Селфи сохранено и отправлено на проверку", "Селфи сакталды жана текшерүүгө жөнөтүлдү"),
    ("Базовая проверка лица пройдена", "Жүздүн базалык текшерүүсү өттү"),
    ("Автопроверка недоступна — заявка сохранена для ручной проверки", "Авто текшерүү жеткиликсиз — өтүнмө кол менен текшерүүгө сакталды"),
    ("Дата и время будут проверены оператором", "Дата жана убакыт оператор тарабынан текшерилет"),
    ("Нужно селфи, не текст", "Текст эмес, селфи керек"),
    ("Отправьте селфи как фотографию, не файлом", "Селфини файл эмес, сүрөт катары жөнөтүңүз"),
    ("Язык Бота", "Боттун тили"),
    ("Политика конфиденциальности", "Купуялуулук саясаты"),
    ("Политика", "Саясат"),
    ("принята", "кабыл алынды"),
    ("не подтверждена", "ырасталган эмес"),
    ("Политика конфиденциальности подтверждена", "Купуялуулук саясаты ырасталды"),
    ("Согласен и продолжить", "Макулмун жана улантуу"),
    ("Продолжая, вы соглашаетесь с Политикой конфиденциальности", "Улантуу менен сиз Купуялуулук саясатына макул болосуз"),
    ("Перед подтверждением номера ознакомьтесь с Политикой конфиденциальности", "Номерди ырастоодон мурун Купуялуулук саясаты менен таанышыңыз"),
    ("Перед отправкой селфи подтвердите согласие на обработку данных идентификации", "Селфи жөнөтүүдөн мурун идентификация маалыматтарын иштетүүгө макулдугуңузду ырастоо керек"),
    ("Подтверждение номера", "Номерди ырастоо"),
    ("Для безопасности подтвердите номер Telegram", "Коопсуздук үчүн Telegram номериңизди ырастаңыз"),
    ("Нажмите кнопку ниже и отправьте свой контакт", "Төмөнкү баскычты басып, өз контактыңызды жөнөтүңүз"),
    ("После подтверждения откроются все функции бота", "Ырасталгандан кийин боттун бардык функциялары ачылат"),
    ("Подтвердить номер", "Номерди ырастоо"),
    ("Номер подтверждён", "Номер ырасталды"),
    ("Отправьте именно свой контакт через кнопку ниже", "Төмөнкү баскыч аркылуу өзүңүздүн контактыңызды жөнөтүңүз"),
    ("Телефон", "Телефон"),
    ("Данные и настройки аккаунта", "Аккаунт маалыматы жана жөндөөлөрү"),
    ("Статистика", "Статистика"),
    ("Пример на изображении — ориентир", "Сүрөттөгү мисал — үлгү"),
    ("На листе укажите именно текущие дату и время", "Баракка дал азыркы дата менен убакытты жазыңыз"),
    ("Напишите на листе", "Баракка жазыңыз"),
    ("Дата и время для вашего фото", "Сүрөтүңүз үчүн дата жана убакыт"),
    ("Сделайте селфи — лицо должно быть хорошо видно", "Селфи жасаңыз — жүзүңүз так көрүнүшү керек"),
    ("Держите лист в руках рядом с лицом", "Баракты колуңузда жүзүңүздүн жанында кармаңыз"),
    ("Лицо и лист должны быть полностью видны в одном кадре", "Жүз жана барак бир кадрда толук көрүнүшү керек"),
    ("Без маски, очков и головного убора", "Маскасыз, көз айнексиз жана баш кийимсиз"),
    ("Хорошее освещение, без сильных теней", "Жарык жакшы болуп, катуу көлөкө болбошу керек"),
    ("Автоматически проверяется наличие одного лица; дата и время дополнительно проверяются оператором", "Бир жүздүн бар-жогу автоматтык текшерилет; дата жана убакыт оператор тарабынан кошумча текшерилет"),
    ("Язык интерфейса", "Интерфейс тили"),
    ("Выберите язык", "Тилди тандаңыз"),
    ("Язык", "Тил"),
    ("Всего", "Баары"),
    ("Профиль", "Профиль"),
    ("История заявок", "Өтүнмөлөр тарыхы"),
    ("Заявок пока нет", "Азырынча өтүнмөлөр жок"),
    ("Последние операции", "Акыркы операциялар"),
    ("Страница", "Барак"),
    ("Пополнений", "Толуктоолор"),
    ("Выводов", "Чыгаруулар"),
    ("Реферальный баланс", "Рефералдык баланс"),
    ("QR вывода", "Чыгаруу QR'ы"),
    ("сохранён", "сакталган"),
    ("не добавлен", "кошулган эмес"),
    ("не указан", "көрсөтүлгөн эмес"),
    ("QR для вывода", "Чыгаруу үчүн QR"),
    ("Отправьте фото QR-кода вашего кошелька", "Капчыгыңыздын QR-кодунун сүрөтүн жөнөтүңүз"),
    ("Он сохранится в профиле и будет доступен при каждом выводе", "Ал профилде сакталат жана ар бир чыгарууда жеткиликтүү болот"),
    ("Присоединяйся к OnoiPay", "OnoiPay'ге кошул"),
    ("Тебя приглашает", "Сени чакырган"),
    ("Ссылка для входа", "Кирүү шилтемеси"),
    ("Получайте", "Алыңыз"),
    ("от успешных пополнений приглашённых пользователей", "чакырылган колдонуучулардын ийгиликтүү толуктоолорунан"),
    ("Начисление автоматическое", "Бонус автоматтык түрдө эсептелет"),
    ("Приглашено", "Чакырылды"),
    ("Начислено всего", "Жалпы эсептелди"),
    ("Начислено", "Эсептелди"),
    ("Доступно", "Жеткиликтүү"),
    ("На выводе", "Чыгарууда"),
    ("Ваша ссылка", "Сиздин шилтеме"),
    ("Отправить приглашение", "Чакырууну жөнөтүү"),
    ("Поделиться ссылкой", "Шилтемени бөлүшүү"),
    ("Ссылка для приглашения", "Чакыруу шилтемеси"),
    ("Нажмите кнопку ниже, чтобы отправить приглашение", "Чакырууну жөнөтүү үчүн төмөнкү баскычты басыңыз"),
    ("Реферальная система", "Рефералдык система"),
    ("Пополнение реферала", "Рефералдын толуктоосу"),
    ("Пользователь", "Колдонуучу"),
    ("Нет доступного реферального баланса для вывода", "Чыгарууга жеткиликтүү рефералдык баланс жок"),
    ("Минимум для вывода реферального баланса", "Рефералдык балансты чыгаруунун минималдык суммасы"),
    ("Сначала добавьте QR для вывода", "Адегенде чыгаруу үчүн QR кошуңуз"),
    ("Заявка на вывод реферального баланса создана", "Рефералдык балансты чыгаруу өтүнмөсү түзүлдү"),
    ("Сумма", "Сумма"),
    ("Номер", "Номер"),
    ("QR: из профиля", "QR: профилден"),
    ("Если потребуется помощь — откройте поддержку", "Жардам керек болсо — колдоого кайрылыңыз"),
    ("Минимум", "Минимум"),
    ("Максимум", "Максимум"),
    ("Введите сумму пополнения", "Толуктоо суммасын киргизиңиз"),
    ("Создайте запрос на вывод в кассе букмекера и отправьте код", "Букмекердин кассасында чыгаруу өтүнмөсүн түзүп, кодду жөнөтүңүз"),
    ("Бот на паузе", "Бот убактылуу токтотулган"),
    ("Пополнение временно отключено", "Толуктоо убактылуу өчүрүлгөн"),
    ("Вывод временно отключен", "Чыгаруу убактылуу өчүрүлгөн"),
    ("временно отключено", "убактылуу өчүрүлгөн"),
    ("Пополнение", "Толуктоо"),
    ("Вывод", "Чыгаруу"),
    ("Ожидает оплаты", "Төлөм күтүлүүдө"),
    ("Зачислено", "Эсепке түштү"),
    ("Отменена", "Жокко чыгарылды"),
    ("Истекла", "Мөөнөтү бүттү"),
    ("В обработке", "Иштетилүүдө"),
    ("Выполнен", "Аткарылды"),
    ("Отклонён", "Четке кагылды"),
    ("ожидает оплаты", "төлөм күтүлүүдө"),
    ("зачислено", "эсепке түштү"),
    ("отменена", "жокко чыгарылды"),
    ("истекла", "мөөнөтү бүттү"),
    ("в обработке", "иштетилүүдө"),
    ("выполнен", "аткарылды"),
    ("отклонён", "четке кагылды"),
    ("Введите ID", "ID киргизиңиз"),
    ("Введите сумму", "Сумманы киргизиңиз"),
    ("Отправьте фото QR-кода вашего кошелька", "Капчыгыңыздын QR-кодунун сүрөтүн жөнөтүңүз"),
    ("Введите код вывода", "Чыгаруу кодун киргизиңиз"),
    ("Осталось", "Калды"),
    ("Пополнение успешно зачислено", "Толуктоо ийгиликтүү эсепке түштү"),
    ("Не переводите по старым реквизитам", "Эски реквизиттерге которбоңуз"),
    ("Вы присоединились по приглашению", "Сиз чакыруу аркылуу кошулдуңуз"),
    ("Подпишитесь на канал и нажмите «Проверить»", "Каналга жазылып, «Текшерүү» баскычын басыңыз"),
    ("Прошлая заявка отменена", "Мурунку өтүнмө жокко чыгарылды"),
    ("Аккаунт заблокирован — напишите в поддержку", "Аккаунт бөгөттөлгөн — колдоого жазыңыз"),
    ("Не удалось проверить ID, попробуйте ещё раз", "ID текшерилген жок, кайра аракет кылыңыз"),
    ("ID — только цифры", "ID — цифра менен гана"),
    ("Проверяем ID", "ID текшерилүүдө"),
    ("ID не найден. Проверьте номер и введите ID ещё раз", "ID табылган жок. Номерди текшерип, кайра киргизиңиз"),
    ("ID не сохранился, введите ещё раз", "ID сакталган жок, кайра киргизиңиз"),
    ("Введите сумму цифрами", "Сумманы цифра менен киргизиңиз"),
    ("Сумма от", "Сумма"),
    ("Сумма без тыйынов", "Сумманы тыйынсыз киргизиңиз"),
    ("Создаём заявку", "Өтүнмө түзүлүүдө"),
    ("Пополнение временно недоступно, попробуйте позже", "Толуктоо убактылуу жеткиликсиз, кийинчерээк аракет кылыңыз"),
    ("Пополнение временно недоступно", "Толуктоо убактылуу жеткиликсиз"),
    ("Отправляем заявку", "Өтүнмө жөнөтүлүүдө"),
    ("Сервис временно недоступен, попробуйте ещё раз", "Сервис убактылуу жеткиликсиз, кайра аракет кылыңыз"),
    ("Неверные данные для вывода", "Чыгаруу маалыматы туура эмес"),
    ("Заявка на вывод принята. Ожидайте обработки", "Чыгаруу өтүнмөсү кабыл алынды. Иштетүүнү күтүңүз"),
    ("Статус", "Статус"),
    ("Проблема с пополнением", "Толуктоо боюнча көйгөй"),
    ("Проблема с выводом", "Чыгаруу боюнча көйгөй"),
    ("Нужно фото, не текст", "Текст эмес, сүрөт керек"),
    ("Нужно фото QR, не текст", "Текст эмес, QR сүрөтү керек"),
    ("Не удалось сохранить QR — отправьте фото ещё раз", "QR сакталган жок — сүрөттү кайра жөнөтүңүз"),
    ("Не удалось получить фото, отправьте ещё раз", "Сүрөт алынган жок, кайра жөнөтүңүз"),
    ("Отправьте как фотографию, не файлом", "Файл эмес, сүрөт катары жөнөтүңүз"),
    ("Отправьте QR как фотографию, не файлом", "QR'ды файл эмес, сүрөт катары жөнөтүңүз"),
    ("Неактуально", "Актуалдуу эмес"),
    ("Вы ещё не подписаны", "Сиз дагы эле жазыла элексиз"),
    ("Сохранённый QR недоступен — отправьте новый", "Сакталган QR жеткиликсиз — жаңысын жөнөтүңүз"),
    ("Сейчас нет доступного реферального баланса для вывода", "Азыр чыгарууга жеткиликтүү баланс жок"),
    ("Что-то пошло не так, попробуйте ещё раз", "Ката кетти, кайра аракет кылыңыз"),
]

_KG_BUTTON = {
    "Пополнить": "Толуктоо", "Вывести": "Чыгаруу", "Профиль": "Профиль", "Реферальная система": "Рефералдык система",
    "Поддержка": "Колдоо", "Отмена": "Жокко чыгаруу", "Инструкция": "Нускама",
    "Отменить пополнение": "Толуктоону жокко чыгаруу", "Главное меню": "Башкы меню",
    "Назад": "Артка", "Подписаться": "Жазылуу", "Проверить": "Текшерүү", "Мой QR": "Менин QR",
    "Поделиться": "Бөлүшүү", "Отправить приглашение": "Чакырууну жөнөтүү", "Поделиться ссылкой": "Шилтемени бөлүшүү", "История заявок": "Өтүнмөлөр тарыхы", "Добавить QR": "QR кошуу",
    "Идентификация": "Идентификация", "Отправить селфи": "Селфи жөнөтүү", "Обновить селфи": "Селфини жаңыртуу", "Язык Бота": "Боттун тили", "Реф. система": "Реф. система",
    "Конфиденциальность": "Купуялуулук",
    "Политика": "Саясат", "Политика конфиденциальности": "Купуялуулук саясаты", "Согласен и продолжить": "Макулмун жана улантуу",
    "Подтвердить номер": "Номерди ырастоо",
    "Обновить QR": "QR жаңыртуу", "Язык": "Тил", "Русский": "Русский", "Кыргызча": "Кыргызча",
    "Проблема с пополнением": "Толуктоо боюнча көйгөй", "Проблема с выводом": "Чыгаруу боюнча көйгөй",
}

def localize_text(cid, text):
    text = str(text or "")
    if get_lang(cid) != "kg":
        return text
    # Более длинные фразы первыми, чтобы не ломать составные выражения.
    for ru, kg in sorted(_KG_TEXT, key=lambda x: len(x[0]), reverse=True):
        text = text.replace(ru, kg)
    return text


def localize_label(cid, text):
    text = str(text or "")
    if get_lang(cid) != "kg":
        return text
    if text in _KG_BUTTON:
        return _KG_BUTTON[text]
    for ru, kg in sorted(_KG_TEXT, key=lambda x: len(x[0]), reverse=True):
        text = text.replace(ru, kg)
    return text


def localize_kb(cid, inline_kb):
    if not inline_kb or get_lang(cid) != "kg":
        return inline_kb
    try:
        result = {"inline_keyboard": []}
        for row in inline_kb.get("inline_keyboard", []):
            nr = []
            for button in row:
                b = dict(button)
                if "text" in b:
                    b["text"] = localize_label(cid, b["text"])
                nr.append(b)
            result["inline_keyboard"].append(nr)
        return result
    except Exception:
        return inline_kb


def save_qr(cid, file_id):
    with conn() as c:
        c.execute(
            "INSERT INTO saved_qr(chat_id,file_id,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET file_id=excluded.file_id,updated_at=excluded.updated_at",
            (int(cid), str(file_id), int(time.time())),
        )


def get_saved_qr(cid):
    try:
        with conn() as c:
            r = c.execute("SELECT file_id,updated_at FROM saved_qr WHERE chat_id=?", (int(cid),)).fetchone()
        return dict(r) if r else None
    except Exception:
        return None


def get_ident(cid):
    try:
        with conn() as c:
            r = c.execute("SELECT * FROM identifications WHERE chat_id=?", (int(cid),)).fetchone()
        return dict(r) if r else None
    except Exception:
        return None


def save_ident(cid, file_id, status='pending', face_count=None, note=''):
    now = int(time.time())
    with conn() as c:
        c.execute(
            "INSERT INTO identifications(chat_id,file_id,status,face_count,created_at,updated_at,note) VALUES(?,?,?,?,?,?,?) "
            "ON CONFLICT(chat_id) DO UPDATE SET file_id=excluded.file_id,status=excluded.status,face_count=excluded.face_count,updated_at=excluded.updated_at,note=excluded.note",
            (int(cid), str(file_id or ''), str(status or 'pending'), face_count, now, now, str(note or ''))
        )


def ident_status_text(cid):
    row = get_ident(cid) or {}
    st = str(row.get('status') or 'none')
    mapping = {'none': 'не пройдена', 'pending': 'на проверке', 'verified': 'проверена', 'rejected': 'отклонена'}
    return localize_text(cid, mapping.get(st, mapping['none']))


def face_count_from_url(url):
    if not cv2 or not np or not url:
        return None
    try:
        req = urllib.request.Request(str(url), headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=12).read()
        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(72, 72))
        return int(len(faces))
    except Exception:
        return None


def _ident_now_text():
    return fmt_dt(int(time.time()))


def _ident_instruction_text(cid, status=None):
    now_text = _ident_now_text()
    lines = [
        'Идентификация',
        '',
    ]
    if status is not None:
        lines.append(f'> Статус идентификации: {status}')
        lines.append('')
    lines += [
        'Пример на изображении — ориентир',
        '',
        '> 1. Сделайте селфи — лицо должно быть хорошо видно',
        f'> 2. Напишите на листе: {now_text}',
        '> 3. Держите лист в руках рядом с лицом',
        '> 4. Лицо и лист должны быть полностью видны в одном кадре',
        '> 5. Без маски, очков и головного убора',
        '> 6. Хорошее освещение, без сильных теней',
        '',
        f'Дата и время для вашего фото: {now_text}',
        'Автоматически проверяется наличие одного лица; дата и время дополнительно проверяются оператором',
    ]
    return '\n'.join(lines)


def show_identification(cid, name, d):
    row = get_ident(cid) or {}
    status = ident_status_text(cid)
    text = _ident_instruction_text(cid, status)
    btn = 'Обновить селфи' if row and row.get('file_id') else 'Отправить селфи'
    ikb = kb(
        [ib(btn, 'ident:send', icon=CE['signal'])],
        [ib('Профиль', 'profile', icon=CE['receipt']), support_btn()],
        [ib('Главное меню', 'menu', icon=CE['menu'])],
    )
    panel(cid, text, ikb, str(IDENT_IMAGE) if IDENT_IMAGE.exists() else None, state='idle', data={**_idle_data(d, name), 'view': 'ident'})


def ask_ident_photo(cid, name, d):
    text = _ident_instruction_text(cid)
    panel(cid, text, kb([ib('Назад', 'profile', icon=CE['menu'])]), str(IDENT_IMAGE) if IDENT_IMAGE.exists() else None, state='wait_ident_photo', data={**_idle_data(d, name), 'view': 'ident'})


def telegram_file_url(file_id):
    if not file_id:
        return ""
    try:
        f = tg(token(), "getFile", {"file_id": str(file_id)})
        path = str((f or {}).get("file_path") or "")
        return f"https://api.telegram.org/file/bot{token()}/{path}" if path else ""
    except Exception:
        traceback.print_exc()
        return ""


def support_deep_link(payload):
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload or ""))[:60]
    return f"https://t.me/{SUPPORT.lstrip('@')}?start={safe}"


def profile_text(cid, name=""):
    info = get_user_info(cid)
    dep_count, wd_count = hist_counts(cid)
    qr = get_saved_qr(cid)
    ident = ident_status_text(cid)
    username = str(info.get("username") or "").strip()
    phone = str(info.get("phone") or "").strip()
    display = str(info.get("first_name") or name or "Пользователь").strip()
    lang_name = "Кыргызча" if get_lang(cid) == "kg" else "Русский"
    return (
        "Профиль OnoiPay\n"
        "Данные и настройки аккаунта\n\n"
        f"{display}\n"
        f"Telegram ID: {int(cid)}\n"
        f"Username: @{username if username else 'не указан'}\n"
        f"Телефон: {phone if phone else 'не указан'}\n\n"
        "> Статистика\n"
        f"> Пополнений: {dep_count} · Выводов: {wd_count}\n"
        f"> Реферальный баланс: {fmt_money(ref_available(cid))} KGS\n\n"
        f"QR вывода: {'сохранён' if qr else 'не добавлен'}\n"
        f"Статус идентификации: {ident}\n"
        f"Язык: {lang_name}"
    )


def profile_kb(cid):
    qr = get_saved_qr(cid)
    return kb(
        [ib("История заявок", "profile:history", icon=CE["ui_calendar"])],
        [ib("Идентификация", "profile:ident", icon=CE["ui_shield"]), ib("Обновить QR" if qr else "Добавить QR", "profile:qr", icon=CE["ui_edit"])],
        [privacy_btn("Конфиденциальность")],
        [ib("Главное меню", "menu", icon=CE["menu"])],
    )


def show_profile(cid, name, d):
    panel(cid, profile_text(cid, name), profile_kb(cid), state="idle", data={**_idle_data(d, name), "view": "profile"})


def language_kb(cid, return_to="profile"):
    current = get_lang(cid)
    ru = "Русский ✓" if current == "ru" else "Русский"
    kg = "Кыргызча ✓" if current == "kg" else "Кыргызча"
    back_cb = "menu" if return_to == "menu" else "profile"
    return kb(
        [ib(ru, "lang:ru", style=NEUTRAL), ib(kg, "lang:kg", style=NEUTRAL)],
        [ib("Назад", back_cb, icon=CE["menu"])],
    )


def show_language(cid, name, d, return_to="profile"):
    text = "Язык интерфейса\n\n> Выберите язык / Тилди тандаңыз"
    panel(
        cid, text, language_kb(cid, return_to), state="idle",
        data={**_idle_data(d, name), "view": "language", "lang_return": "menu" if return_to == "menu" else "profile"},
    )


def ask_profile_qr(cid, name, d, payout_after=False):
    nd = {**_idle_data(d, name), "view": "profile", "payout_after_qr": bool(payout_after)}
    panel(
        cid,
        "🗺 QR для вывода\n\n> Отправьте фото QR-кода вашего кошелька\n> Он сохранится в профиле и будет доступен при каждом выводе",
        kb([ib("Назад", "profile", icon=CE["menu"])]),
        state="wait_profile_qr",
        data=nd,
    )


def withdraw_qr_kb(cid):
    rows = []
    if get_saved_qr(cid):
        rows.append([ib("Мой QR", "my_qr", icon=CE["pay"])])
    rows.append([cancel_btn()])
    return kb(*rows)


# ============================================================ реферальная система
def _ref_code(cid):
    raw = hashlib.sha1(f"onoi-ref:{int(cid)}".encode("utf-8")).hexdigest().upper()
    return raw[:8]


def ensure_ref_user(cid):
    cid = int(cid)
    with conn() as c:
        row = c.execute("SELECT * FROM referrals WHERE chat_id=?", (cid,)).fetchone()
        if row:
            return dict(row)
        code = _ref_code(cid)
        while c.execute("SELECT 1 FROM referrals WHERE code=?", (code,)).fetchone():
            code = hashlib.sha1((code + 'X').encode('utf-8')).hexdigest().upper()[:8]
        c.execute(
            "INSERT INTO referrals(chat_id,code,invited_by,invited_at,reward_balance,reward_total) VALUES(?,?,?,?,0,0)",
            (cid, code, None, None),
        )
        row = c.execute("SELECT * FROM referrals WHERE chat_id=?", (cid,)).fetchone()
    return dict(row) if row else {"chat_id": cid, "code": code, "invited_by": None, "invited_at": None, "reward_balance": 0.0, "reward_total": 0.0}


def ref_profile(cid):
    ensure_ref_user(cid)
    with conn() as c:
        row = c.execute("SELECT * FROM referrals WHERE chat_id=?", (int(cid),)).fetchone()
    return dict(row) if row else None


def ref_link(cid):
    profile = ensure_ref_user(cid)
    return f"https://t.me/{BOT_USERNAME}?start=ref_{profile['code']}"


def bind_referral(cid, code):
    cid = int(cid)
    code = str(code or '').strip().upper()
    if not code:
        return ''
    ensure_ref_user(cid)
    with conn() as c:
        me = c.execute("SELECT * FROM referrals WHERE chat_id=?", (cid,)).fetchone()
        if not me:
            return ''
        owner = c.execute("SELECT chat_id FROM referrals WHERE code=?", (code,)).fetchone()
        if not owner:
            return 'invalid'
        referrer = int(owner[0])
        if referrer == cid:
            return 'self'
        if me['invited_by']:
            return 'exists'
        had_ops = c.execute("SELECT 1 FROM history WHERE chat_id=? LIMIT 1", (cid,)).fetchone()
        if had_ops:
            return 'exists'
        c.execute("UPDATE referrals SET invited_by=?, invited_at=? WHERE chat_id=?", (referrer, int(time.time()), cid))
    return 'ok'


def ref_stats(cid):
    profile = ensure_ref_user(cid)
    with conn() as c:
        invited = c.execute("SELECT COUNT(1) FROM referrals WHERE invited_by=?", (int(cid),)).fetchone()[0]
    return {
        'count': int(invited or 0),
        'balance': float(profile.get('reward_balance') or 0),
        'total': float(profile.get('reward_total') or 0),
        'link': ref_link(cid),
        'code': profile.get('code') or '',
    }


def ref_share_text(name, link):
    person = str(name or 'Ваш знакомый').strip()
    return (
        "🎁 Присоединяйся к OnoiPay\n\n"
        "💳 Пополнение и вывод средств 24/7\n"
        "💎 Комиссия — 0%\n\n"
        f"👋 Тебя приглашает: {person}\n"
        f"Ссылка для входа: {link}"
    )


def ref_share_url(cid, name):
    """Открывает Telegram share-sheet, чтобы выбрать пользователя/чат для отправки ссылки."""
    link = ref_link(cid)
    person = str(name or 'Ваш знакомый').strip()
    share_text = localize_text(
        cid,
        "🎁 Присоединяйся к OnoiPay\n\n"
        "💳 Пополнение и вывод средств 24/7\n"
        "💎 Комиссия — 0%\n\n"
        f"👋 Тебя приглашает: {person}",
    )
    return (
        "https://t.me/share/url?url=" + urllib.parse.quote(link, safe="")
        + "&text=" + urllib.parse.quote(share_text, safe="")
    )


def send_referral_card(cid, name):
    # Намеренно без protect_content: эту карточку пользователь должен пересылать друзьям.
    link = ref_link(cid)
    caption = localize_text(cid, ref_share_text(name, link))
    clean, entities = render(caption)
    data = b""
    try:
        if REF_IMAGE.exists():
            data = REF_IMAGE.read_bytes()
    except Exception:
        data = b""
    if data:
        try:
            return send_photo_bytes(cid, data, clean, None, entities, protect=False)
        except Exception as exc:
            print(f"[onoi] referral card premium send failed: {exc}", flush=True)
            try:
                return send_photo_bytes(cid, data, clean, None, _plain(entities), protect=False)
            except Exception:
                traceback.print_exc()
    return deliver(cid, caption, None)


def ref_pending_amount(cid):
    try:
        with conn() as c:
            r = c.execute(
                "SELECT COALESCE(SUM(amount),0) FROM referral_payouts WHERE chat_id=? AND status='pending'",
                (int(cid),),
            ).fetchone()
        return float(r[0] or 0) if r else 0.0
    except Exception:
        return 0.0


def ref_available(cid):
    s = ref_stats(cid)
    return max(0.0, float(s['balance']) - ref_pending_amount(cid))


def ref_kb(name, cid):
    return kb(
        [ib('Отправить приглашение', 'ref_share', style=NEUTRAL, icon=CE['heart'])],
        [ib('Поделиться ссылкой', url=ref_share_url(cid, name), style=NEUTRAL, icon=CE['signal'])],
        [ib('Вывести', 'ref_payout', icon=CE['plane']), ib('Профиль', 'profile', icon=CE['receipt'])],
        [ib('Главное меню', 'menu', icon=CE['menu'])],
    )


def referral_text(cid, name=''):
    s = ref_stats(cid)
    pending = ref_pending_amount(cid)
    available = max(0.0, float(s['balance']) - pending)
    lines = [
        '🎁 Реферальная система',
        '',
        f'> Получайте {str(REF_BONUS_PCT).rstrip("0").rstrip(".") or "1"}% от успешных пополнений приглашённых пользователей',
        '> Начисление автоматическое',
        '',
        f'> Приглашено: {s["count"]}',
        f'> Начислено всего: {fmt_money(s["total"])} KGS',
        f'> Доступно: {fmt_money(available)} KGS',
    ]
    if pending > 0:
        lines.append(f'> На выводе: {fmt_money(pending)} KGS')
    lines += [
        '',
        '> Ссылка для приглашения:',
        f'> Код: {s["code"]}',
        '> Нажмите кнопку ниже, чтобы отправить приглашение',
    ]
    return '\n'.join(lines)


def show_referrals(cid, name, d):
    panel(cid, referral_text(cid, name), ref_kb(name, cid), state='idle', data={**_idle_data(d, name), 'view': 'ref'})


def apply_ref_reward(invited_cid, request_id):
    request_id = str(request_id or '').strip()
    if not request_id:
        return None
    invited_cid = int(invited_cid)
    with conn() as c:
        profile = c.execute("SELECT invited_by FROM referrals WHERE chat_id=?", (invited_cid,)).fetchone()
        if not profile or not profile['invited_by']:
            return None
        if c.execute("SELECT 1 FROM referral_rewards WHERE request_id=?", (request_id,)).fetchone():
            return None
        row = c.execute("SELECT amount, kind FROM history WHERE chat_id=? AND request_id=?", (invited_cid, request_id)).fetchone()
        if not row or str(row['kind']) != 'deposit':
            return None
        try:
            amount = float(row['amount'] or 0)
        except Exception:
            amount = 0.0
        if amount <= 0:
            return None
        reward = round(amount * float(REF_BONUS_PCT) / 100.0, 2)
        if reward <= 0:
            return None
        referrer = int(profile['invited_by'])
        now = int(time.time())
        c.execute(
            "INSERT INTO referral_rewards(request_id,referrer_id,invited_id,amount,reward,created_at) VALUES(?,?,?,?,?,?)",
            (request_id, referrer, invited_cid, amount, reward, now),
        )
        c.execute(
            "UPDATE referrals SET reward_balance=COALESCE(reward_balance,0)+?, reward_total=COALESCE(reward_total,0)+? WHERE chat_id=?",
            (reward, reward, referrer),
        )
    return {'referrer_id': referrer, 'amount': amount, 'reward': reward}


def notify_ref_reward(invited_cid, request_id, name=''):
    try:
        info = apply_ref_reward(invited_cid, request_id)
        if not info:
            return
        amount = info['amount']
        reward = info['reward']
        amount_txt = fmt_money(amount)
        reward_txt = fmt_money(reward)
        inviter_name = str(name or get_user_info(invited_cid).get('first_name') or 'Ваш реферал').strip()
        text = (
            '🎁 Реферальная система\n\n'
            f'> Начислено: {reward_txt} KGS\n'
            f'> Пополнение реферала: {amount_txt} KGS\n'
            f'> Пользователь: {inviter_name}'
        )
        deliver(int(info['referrer_id']), text, None)
    except Exception:
        traceback.print_exc()


def create_ref_payout(cid, name=''):
    cid = int(cid)
    available = ref_available(cid)
    if available <= 0:
        return None, "Нет доступного реферального баланса для вывода"
    if REF_WITHDRAW_MIN > 0 and available < REF_WITHDRAW_MIN:
        return None, f"Минимум для вывода реферального баланса — {fmt_money(REF_WITHDRAW_MIN)} KGS"
    qr = get_saved_qr(cid)
    if not qr:
        return None, "Сначала добавьте QR для вывода"
    rid = "RF" + uuid.uuid4().hex[:10].upper()
    now = int(time.time())
    with conn() as c:
        c.execute(
            "INSERT INTO referral_payouts(id,chat_id,amount,qr_file_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (rid, cid, available, str(qr['file_id']), 'pending', now, now),
        )
    info = get_user_info(cid)
    submit_background(api, "/bot/events", "POST", {
        "event": "referral_withdrawal",
        "chat_id": cid,
        "request_id": rid,
        "amount": available,
        "qr_file_id": str(qr['file_id']),
        "username": info.get('username'),
        "first_name": info.get('first_name') or name,
    })
    return {"id": rid, "amount": available}, ""


def show_ref_payout_result(cid, name, d):
    item, error = create_ref_payout(cid, name)
    if not item:
        panel(cid, "❌ " + error, ref_kb(name, cid), state="idle", data={**_idle_data(d, name), "view": "ref"})
        return
    support_url = support_deep_link(f"refout_{item['id']}")
    text = (
        "✅ Заявка на вывод реферального баланса создана\n\n"
        f"> Сумма: {fmt_money(item['amount'])} KGS\n"
        f"> Номер: {item['id']}\n"
        "> QR: из профиля\n\n"
        "💭 Если потребуется помощь — откройте поддержку"
    )
    ikb = kb(
        [ib("Поддержка", url=support_url, icon=CE['cloud'])],
        [ib("Реферальная система", "ref", icon=CE['heart']), ib("Главное меню", "menu", icon=CE['menu'])],
    )
    panel(cid, text, ikb, state="idle", data={**_idle_data(d, name), "view": "ref"})


# ============================================================ runtime бэкенда
_RUNTIME = {"at": 0.0, "value": {}}
_RUNTIME_LOCK = threading.RLock()


def _runtime_fetch():
    try:
        r = api("/bot/runtime", timeout=8)
        value = r.get("config") if isinstance(r, dict) and r.get("ok") else None
    except Exception:
        value = None
    if value is None:
        try:
            value = cfg()
        except Exception:
            value = None
    with _RUNTIME_LOCK:
        if value:
            _RUNTIME["value"] = value
        _RUNTIME["at"] = time.monotonic()
        _RUNTIME["busy"] = False
    return _RUNTIME["value"]


def runtime(force=False):
    """Конфиг бэкенда: отдаём из кэша мгновенно, обновляем в фоне раз в 3 сек.
    Синхронно ждём только самый первый раз."""
    with _RUNTIME_LOCK:
        stale = force or time.monotonic() - _RUNTIME["at"] > 3.0
        empty = not _RUNTIME["value"]
        if stale and not _RUNTIME.get("busy"):
            _RUNTIME["busy"] = True
            if not empty:
                submit_background(_runtime_fetch)
        elif not stale:
            return _RUNTIME["value"]
        if not empty:
            return _RUNTIME["value"]
    return _runtime_fetch()


def token():
    if BOT_TOKEN and ":" in BOT_TOKEN:
        return BOT_TOKEN
    return str(runtime().get("main_bot", {}).get("token", ""))


def deposit_limits(bookmaker):
    key = str(bookmaker or "").strip().lower()
    row = (runtime().get("bookmakers") or {}).get(key) or {}
    try:
        minimum = max(1, int(float(row.get("deposit_min", 35))))
    except Exception:
        minimum = 35
    try:
        maximum = max(minimum, int(float(row.get("deposit_max", 500000))))
    except Exception:
        maximum = 500000
    return minimum, maximum


def amount_prompt(bookmaker):
    minimum, maximum = deposit_limits(bookmaker)
    return (
        "💰 Пополнение счёта\n\n"
        f"Минимум: {fmt_amount(minimum)} KGS\n"
        f"Максимум: {fmt_amount(maximum)} KGS\n\n"
        "Введите сумму пополнения:"
    )


def instruction_photo(bk, key):
    return (runtime().get("instructions", {}).get(bk, {}) or {}).get(key) or ""


def instruction_text(bk):
    return (runtime().get("instructions", {}).get(bk, {}) or {}).get(
        "text", "Создайте запрос на вывод в кассе букмекера и отправьте код."
    )


def user_blocked(cid):
    try:
        r = api(f"/bot/user-status/{cid}", timeout=6)
        return bool(isinstance(r, dict) and r.get("blocked"))
    except Exception:
        return False


def check_sub(cid):
    sub = runtime().get("main_bot", {}).get("subscription", {}) or {}
    if not sub.get("enabled"):
        return True
    channel = sub.get("channel_id") or sub.get("channel_username")
    if not channel:
        return True
    try:
        r = tg(token(), "getChatMember", {"chat_id": channel, "user_id": cid})
        return r.get("status") in ("member", "administrator", "creator")
    except Exception:
        return False


def paused_for(action, bk=None):
    c = runtime()
    if c.get("bot_paused"):
        return "Бот на паузе"
    if action == "deposit" and not c.get("deposits_enabled", True):
        return "Пополнение временно отключено"
    if action == "withdraw" and not c.get("withdrawals_enabled", True):
        return "Вывод временно отключен"
    if bk and not (c.get("bookmakers", {}) or {}).get(bk, {}).get(action, True):
        return f"{'Пополнение' if action == 'deposit' else 'Вывод'} для {bk.upper()} временно отключено"
    return ""


# ============================================================ пулы / фон
CHAT_LOCKS = {}
CHAT_LOCKS_GUARD = threading.Lock()
UPDATE_POOL = ThreadPoolExecutor(max_workers=64, thread_name_prefix="onoi-update")
BACKGROUND_POOL = ThreadPoolExecutor(max_workers=24, thread_name_prefix="onoi-bg")
ACK_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="onoi-ack")
API_POOL = ThreadPoolExecutor(max_workers=32, thread_name_prefix="onoi-api")
TIMER_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="onoi-timer")
OUTBOX_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="onoi-outbox")
BACKGROUND_SLOTS = threading.BoundedSemaphore(1500)
CHAT_QUEUES = {}
CHAT_QUEUE_ACTIVE = set()
CHAT_QUEUE_GUARD = threading.Lock()
CALLBACK_RECENT = {}
CALLBACK_RECENT_GUARD = threading.Lock()
CALLBACK_DEBOUNCE_SECONDS = 1.75
CALLBACK_PENDING = set()
CALLBACK_PENDING_GUARD = threading.Lock()
# One UI transition per chat at a time. Extra taps are ACKed and dropped instead of queued.
CALLBACK_CHAT_BUSY = set()
CALLBACK_CHAT_BUSY_GUARD = threading.Lock()
MAX_CHAT_QUEUE = 6


def submit_background(fn, *args, **kwargs):
    """Не даёт служебным событиям забить очередь обработки команд клиента."""
    if not BACKGROUND_SLOTS.acquire(blocking=False):
        return None

    def run():
        try:
            return fn(*args, **kwargs)
        except Exception:
            traceback.print_exc()
        finally:
            BACKGROUND_SLOTS.release()

    return BACKGROUND_POOL.submit(run)


def _chat_lock(cid):
    with CHAT_LOCKS_GUARD:
        return CHAT_LOCKS.setdefault(int(cid), threading.RLock())


def _delete_one(cid, mid):
    try:
        tg(token(), "deleteMessage", {"chat_id": int(cid), "message_id": int(mid)}, timeout=10)
    except Exception:
        try:
            delete_many(token(), cid, [int(mid)])
        except Exception:
            pass


def delete_now(cid, mid):
    """Ввод клиента убираем сразу, но не ждём Telegram — ответ клиенту не тормозит."""
    if mid:
        submit_background(_delete_one, cid, mid)


def delete_bg(cid, ids):
    """Удаление в фоне: интерфейс не ждёт Telegram. Состояние уже сохранено до вызова."""
    ids = sorted({int(x) for x in (ids or []) if x})
    if not ids:
        return
    if submit_background(delete_many, token(), cid, ids) is None:
        threading.Thread(target=delete_many, args=(token(), cid, ids), daemon=True).start()


# ============================================================ отправка (с фолбэками)
_RETRY_RE = re.compile(r"retry.?after\D{0,12}(\d+)", re.I)
# Если Telegram отверг premium-иконки кнопок или custom_emoji entities (400 Bad Request),
# запоминаем это на 10 минут и не тратим лишний запрос на каждое сообщение.
_PREMIUM_DISABLED_UNTIL = {"icons": 0.0, "entities": 0.0}
_PREMIUM_GUARD = threading.Lock()


def _retry_after(exc):
    m = _RETRY_RE.search(str(exc))
    return int(m.group(1)) if m else 0


def _fatal(exc):
    s = str(exc).lower()
    return any(x in s for x in ("blocked by the user", "chat not found", "user is deactivated", "bot was kicked"))


def _bad_request(exc):
    s = str(exc).lower()
    return "bad request" in s or "400" in s


def _premium_ok(feature):
    with _PREMIUM_GUARD:
        return time.monotonic() > _PREMIUM_DISABLED_UNTIL[feature]


def _premium_disable(feature, exc):
    with _PREMIUM_GUARD:
        _PREMIUM_DISABLED_UNTIL[feature] = time.monotonic() + 600
    print(f"[onoi] premium {feature} rejected by Telegram, disabled for 10 min: {str(exc)[:160]}", flush=True)


def _strip_premium(kb):
    """Клавиатура без premium-иконок и стилей — фолбэк, если Telegram их не принял."""
    if kb is None:
        return None

    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items() if k not in ("icon_custom_emoji_id", "style")}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(kb)


def _plain(entities):
    """Без premium-эмодзи, но цитаты и упоминания остаются."""
    return [e for e in (entities or []) if e.get("type") != "custom_emoji"]


def _stages(kb, entities, photo):
    """Порядок попыток: premium-иконки+entities → только entities → без premium → без фото."""
    stages = []
    stripped = _strip_premium(kb)
    if _premium_ok("icons"):
        stages.append(("icons", kb, entities if _premium_ok("entities") else _plain(entities), photo))
    if _premium_ok("entities"):
        stages.append(("entities", stripped, entities, photo))
    stages.append(("plain", stripped, _plain(entities), photo))
    if photo:
        stages.append(("nophoto", stripped, _plain(entities), None))
    return stages


def _note_feature_failure(stages, index, failures):
    """Стадия index прошла; если предыдущая упала с 400 — отключаем именно ту фичу."""
    if index == 0:
        return
    prev_name = stages[index - 1][0]
    name = stages[index][0]
    exc = failures.get(prev_name)
    if exc is None or not _bad_request(exc):
        return
    if prev_name == "icons" and name in ("entities", "plain"):
        _premium_disable("icons", exc)
    elif prev_name == "entities" and name == "plain":
        _premium_disable("entities", exc)


def _send_text(cid, text, kb, entities, protect):
    params = {"chat_id": int(cid), "text": text, "entities": entities or [],
              "link_preview_options": {"is_disabled": True}}
    if kb:
        params["reply_markup"] = kb
    if protect:
        params["protect_content"] = True
    return tg(token(), "sendMessage", params, timeout=15)


def _resolve_photo(photo):
    """Фото из конфига: http-ссылка, локальный файл (относительно проекта) или file_id."""
    if isinstance(photo, (bytes, bytearray)):
        return photo
    p = str(photo or "").strip()
    if not p or p.startswith("http://") or p.startswith("https://"):
        return p
    for cand in (Path(p), BASE / p.lstrip("/"), BASE / "static" / p.lstrip("/")):
        try:
            if cand.is_file():
                return cand.read_bytes()
        except Exception:
            pass
    return p  # file_id


def _send_photo_url(cid, photo, caption, kb, entities, protect):
    params = {"chat_id": int(cid), "photo": photo, "caption": caption or "", "caption_entities": entities or []}
    if kb:
        params["reply_markup"] = kb
    if protect:
        params["protect_content"] = True
    return tg(token(), "sendPhoto", params, timeout=20)


def deliver(cid, text, kb=None, photo=None, extra=None, protect=True):
    """Отправка с premium-эмодзи и авто-фолбэком. На 429 ждём retry_after и повторяем.
    protect=True — Telegram protected content: нельзя пересылать/сохранять штатными средствами.
    Исключения намеренные: QR-код пополнения должен сохраняться; реферальную карточку нужно пересылать."""
    text = localize_text(cid, text)
    kb = localize_kb(cid, kb)
    text, entities = render(text, extra)
    photo = _resolve_photo(photo) if photo else None
    stages = _stages(kb, entities, photo)
    failures = {}
    last = None
    for index, (name, k, e, p) in enumerate(stages):
        for attempt in range(2):
            try:
                if isinstance(p, (bytes, bytearray)):
                    m = send_photo_bytes(cid, p, text, k, e, protect)
                elif p:
                    m = _send_photo_url(cid, p, text, k, e, protect)
                else:
                    m = _send_text(cid, text, k, e, protect)
                if not isinstance(m, dict) or "message_id" not in m:
                    raise RuntimeError(f"send returned {m!r}")
                _note_feature_failure(stages, index, failures)
                return m
            except Exception as exc:
                last = exc
                if _fatal(exc):
                    raise
                ra = _retry_after(exc)
                if ra and attempt == 0:
                    time.sleep(min(ra, 5))
                    continue
                failures[name] = exc
                break
    raise last


def edit_message(cid, mid, kind, text, inline_kb=None, extra=None):
    """Правка экрана на месте: текст (editMessageText) или подпись фото (editMessageCaption).
    kb=None — кнопки снимаются. False — сообщение не найдено / не редактируется."""
    text = localize_text(cid, text)
    inline_kb = localize_kb(cid, inline_kb)
    text, entities = render(text, extra)
    caption = kind == "photo"
    if caption and len(text) > 1024:
        text = text[:1021] + "…"
        entities = [e for e in entities if e["offset"] + e["length"] <= utf16_len(text)]
    kb = inline_kb if inline_kb is not None else {"inline_keyboard": []}
    variants = []
    if _premium_ok("icons"):
        variants.append(("icons", entities if _premium_ok("entities") else _plain(entities), kb))
    if _premium_ok("entities"):
        variants.append(("entities", entities, _strip_premium(kb)))
    variants.append(("plain", _plain(entities), _strip_premium(kb)))
    failures = {}
    for index, (name, ents, k) in enumerate(variants):
        params = {"chat_id": int(cid), "message_id": int(mid), "reply_markup": k}
        if caption:
            params["caption"] = text
            params["caption_entities"] = ents
        else:
            params["text"] = text
            params["entities"] = ents
        for attempt in range(2):
            try:
                r = tg(token(), "editMessageCaption" if caption else "editMessageText", params, timeout=7)
                if r is None or r is False:
                    raise RuntimeError(f"edit returned {r!r}")
                if index > 0:
                    prev = variants[index - 1][0]
                    exc = failures.get(prev)
                    if exc is not None and _bad_request(exc):
                        _premium_disable("icons" if prev == "icons" else "entities", exc)
                return True
            except Exception as exc:
                s = str(exc).lower()
                if "not modified" in s:
                    return True
                if "message to edit not found" in s or "can't be edited" in s or "message_id_invalid" in s \
                        or "there is no text in the message" in s or "no caption" in s:
                    return False
                ra = _retry_after(exc)
                if ra and attempt == 0:
                    time.sleep(min(ra, 3))
                    continue
                failures[name] = exc
                break
    return False


def edit_markup(cid, mid, inline_kb=None):
    """Только кнопки: снять (None) или заменить."""
    inline_kb = localize_kb(cid, inline_kb)
    kb = inline_kb if inline_kb is not None else {"inline_keyboard": []}
    for k in ((kb,) if not _premium_ok("icons") else (kb, _strip_premium(kb))):
        try:
            tg(token(), "editMessageReplyMarkup", {"chat_id": int(cid), "message_id": int(mid), "reply_markup": k}, timeout=6)
            return True
        except Exception as exc:
            if "not modified" in str(exc).lower():
                return True
    return False


def toast(q, text="", alert=False):
    try:
        params = {"callback_query_id": q["id"]}
        if text:
            text = localize_text(int((q.get("from") or {}).get("id") or 0), text)
            params["text"] = text
            params["show_alert"] = bool(alert)
        tg(token(), "answerCallbackQuery", params, timeout=2.2)
    except Exception:
        pass


def fast_ack(q):
    """Ultra-light answerCallbackQuery.

    It deliberately bypasses common.tg so an idle/stale shared HTTP connection or another
    Telegram request cannot keep the iOS/Android button spinner alive. No user data is sent.
    """
    try:
        qid = str((q or {}).get("id") or "")
        if not qid:
            return
        body = urllib.parse.urlencode({"callback_query_id": qid}).encode("ascii")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token()}/answerCallbackQuery",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Connection": "close"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.8) as r:
            r.read(64)
    except Exception:
        # Best-effort fallback, still isolated in ACK_POOL.
        try:
            toast(q)
        except Exception:
            pass


# ============================================================ брендовый QR
# QR от бэкенда перекрашиваем: модули — розовые, в центре — логотип OnoiPay.
# Нужен Pillow (venv: pip install pillow). Если его нет или картинка не скачалась — шлём исходный QR.
QR_PINK = (232, 24, 122)
_LOGO_B64 = (
    "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"
)
_LOGO = {"img": None}
_QR_CACHE = {}
_QR_LOCK = threading.Lock()


def _logo():
    if _LOGO["img"] is None:
        from PIL import Image
        _LOGO["img"] = Image.open(io.BytesIO(base64.b64decode(_LOGO_B64))).convert("RGBA")
    return _LOGO["img"]


def brand_qr(url):
    """PNG-байты розового QR с логотипом или None."""
    url = str(url or "")
    if not url:
        return None
    with _QR_LOCK:
        if url in _QR_CACHE:
            return _QR_CACHE[url]
    try:
        from PIL import Image, ImageDraw
        raw = urllib.request.urlopen(url, timeout=6).read()
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = im.size
        dark = im.convert("L").point(lambda v: 255 if v < 128 else 0)
        out = Image.composite(Image.new("RGB", im.size, QR_PINK), Image.new("RGB", im.size, (255, 255, 255)), dark)
        side = int(min(w, h) * 0.26)
        x, y = (w - side) // 2, (h - side) // 2
        pad = max(4, int(side * 0.08))
        ImageDraw.Draw(out).ellipse([x - pad, y - pad, x + side + pad, y + side + pad], fill=(255, 255, 255))
        logo = _logo().resize((side, side), Image.LANCZOS)
        out.paste(logo, (x, y), logo)
        buf = io.BytesIO()
        out.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
    except Exception as exc:
        print(f"[onoi] brand_qr failed ({str(exc)[:120]}), sending original QR", flush=True)
        return None
    with _QR_LOCK:
        if len(_QR_CACHE) > 200:
            _QR_CACHE.clear()
        _QR_CACHE[url] = data
    return data


def send_photo_bytes(cid, data, caption, kb, entities, protect=True):
    """sendPhoto с загрузкой файла (multipart) — без зависимостей."""
    boundary = "----onoi" + uuid.uuid4().hex
    fields = {"chat_id": str(int(cid)), "caption": caption or "",
              "caption_entities": json.dumps(entities or []), "reply_markup": json.dumps(kb) if kb else "",
              "protect_content": "true" if protect else ""}
    body = bytearray()
    for k, v in fields.items():
        if v:
            body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode("utf-8")
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"qr.png\"\r\n"
             f"Content-Type: image/png\r\n\r\n").encode("utf-8") + bytes(data) + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(f"https://api.telegram.org/bot{token()}/sendPhoto", data=bytes(body),
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=25).read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            desc = json.loads(exc.read().decode("utf-8")).get("description", "")
        except Exception:
            desc = ""
        raise RuntimeError(f"sendPhoto {exc.code} Bad Request: {desc}")
    if not r.get("ok"):
        raise RuntimeError(f"sendPhoto: {r.get('description')}")
    return r["result"]


# ============================================================ клавиатуры (inline)
# Цвета: Telegram даёт только danger (красный) / success (зелёный) / primary (синий).
# Бренд OnoiPay — пурпур на чёрном, ближе всего danger: им красим действия.
# Отмена и служебные кнопки — без цвета (чёрные/белые по теме клиента).
BRAND_STYLE = None   # все кнопки чёрные/белый текст (стандартные), без цветных стилей
NEUTRAL = None
# Кнопки банков — без цвета, только логотип.
BANK_STYLE = {}


def ib(text, cb=None, url=None, style=None, icon=None, web_app=None):
    b = {"text": text}
    if cb:
        b["callback_data"] = cb
    if url:
        b["url"] = url
    if web_app:
        b["web_app"] = {"url": str(web_app)}
    if style:
        b["style"] = style
    if icon:
        b["icon_custom_emoji_id"] = icon
    return b


def kb(*rows):
    return {"inline_keyboard": [list(r) for r in rows if r]}


def cancel_btn(text="Отмена"):
    return ib(text, "cancel", style=NEUTRAL, icon=CE["cross"])


def support_btn():
    return ib("Поддержка", url=support_deep_link('main'), style=NEUTRAL, icon=CE["ui_mail"])


def menu_kb():
    # Главный экран: только ключевые действия. Никаких дублирующих кнопок и Privacy здесь.
    return kb(
        [ib("Пополнить", "act:deposit", icon=CE["signal"]), ib("Вывести", "act:withdraw", icon=CE["signal"])],
        [ib("Язык Бота", "menu:lang", style=NEUTRAL, icon=CE["ui_slider"]), ib("Реф. система", "ref", icon=CE["ui_hundred"])],
        [ib("Профиль", "profile", icon=CE["receipt"])],
        [support_btn()],
    )


def bk_kb(action="deposit"):
    """Отключённый букмекер остаётся на месте, но с OFF-эмодзи и ничего не делает."""
    rows = []
    for i in range(0, len(BOOKMAKERS), 2):
        row = []
        for n in BOOKMAKERS[i:i + 2]:
            # У кнопки один значок: включённый БК — логотип, отключённый — OFF.
            if paused_for(action, n.lower()):
                row.append(ib(n, f"off:{n.lower()}", icon=CE["off"]))
            else:
                row.append(ib(n, f"bk:{n.lower()}", icon=BK_EMOJI[n]))
        rows.append(row)
    rows.append([cancel_btn()])
    return kb(*rows)


def cancel_kb():
    return kb([cancel_btn()])


def id_kb(ids):
    rows = [[ib(x, f"id:{x}", style=NEUTRAL) for x in ids[i:i + 2]] for i in range(0, len(ids), 2)]
    rows.append([cancel_btn()])
    return kb(*rows)


def amount_kb(bookmaker=None):
    minimum, maximum = deposit_limits(bookmaker) if bookmaker else (35, 500000)
    candidates = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
    values = [x for x in candidates if minimum <= x <= maximum]
    if minimum not in values:
        values.insert(0, minimum)
    values = sorted(set(values))[:6]
    rows = [[ib(fmt_amount(x), f"amt:{x}", style=NEUTRAL) for x in values[i:i + 3]] for i in range(0, len(values), 3)]
    rows.append([cancel_btn()])
    return kb(*rows)


def code_kb():
    return kb([ib("Инструкция", "instr", style=NEUTRAL), cancel_btn()])


def bank_key(item):
    raw = " ".join(str(item.get(k) or "") for k in ("id", "code", "key", "name", "title")).lower()
    raw = re.sub(r"[\s!\-_.]", "", raw)
    for key in BANK_ORDER:
        if any(needle in raw for needle in BANK_ALIASES[key]):
            return key
    return ""


def bank_kb(methods, request_id=""):
    """Банки — в порядке набора логотипов; логотип и цвет каждого банка на кнопке."""
    items = [x for x in (methods or []) if isinstance(x, dict) and x.get("url")]
    items.sort(key=lambda x: BANK_ORDER.index(bank_key(x)) if bank_key(x) in BANK_ORDER else 99)
    buttons = []
    for item in items:
        key = bank_key(item)
        buttons.append(ib(str(item.get("name") or item.get("id") or "Банк"), url=item["url"],
                          style=BANK_STYLE.get(key), icon=BANK_EMOJI.get(key)))
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    rows.append([ib("Отменить пополнение", f"cancel_deposit:{request_id}", style=NEUTRAL, icon=CE["cross"])])
    return kb(*rows)


def menu_btn_kb():
    return kb([ib("Главное меню", "menu", icon=CE["menu"])])


def back_kb():
    return kb([ib("Назад", "back")])


def back_menu_kb():
    return kb([ib("Назад", "back"), ib("Главное меню", "menu", icon=CE["menu"])])


def sub_kb():
    sub = runtime().get("main_bot", {}).get("subscription", {}) or {}
    uname = str(sub.get("channel_username") or "").lstrip("@")
    return kb(
        [ib("Подписаться", url=f"https://t.me/{uname}" if uname else "https://t.me/")],
        [ib("Проверить", "check_sub", style=NEUTRAL, icon=CE["check"])],
    )


# ============================================================ экран-панель
# У клиента один экран. Текст правим на месте, фото — новое сообщение (старое уходит).
# Самое первое приветствие (greeting_id) не удаляется никогда: если экран ушёл в фото,
# приветствие возвращает свой текст. Чек (receipt) — постоянное сообщение: не правим,
# не удаляем, только снимаем кнопки, когда появляется новый экран.


def _retire(cid, d, keep=0):
    pid = int(d.get("panel_id") or 0)
    if not pid or pid == keep:
        return
    gid = int(d.get("greeting_id") or 0)
    old_unprotected = str(d.get("protect_v") or "") != CONTENT_PROTECTION_VERSION
    if d.get("panel_receipt"):
        # Финальные старые чеки не удаляем: их нельзя retroactively защитить, только снять кнопки.
        submit_background(edit_markup, cid, pid, None)
    elif old_unprotected:
        # Обычные старые панели удаляем и заменяем новым protected-content сообщением.
        delete_bg(cid, [pid])
    elif pid == gid and d.get("panel_kind") == "text":
        submit_background(edit_message, cid, pid, "text", greeting_text(d.get("first_name")), None)
    else:
        delete_bg(cid, [pid])


def panel(cid, text, ikb=None, photo=None, extra=None, state=None, data=None, receipt=False, keep_photo=False, protect=True):
    """Показать экран. Текстовая панель правится на месте; фото-панель — тоже, если keep_photo
    (подпись под фото), иначе новое сообщение. Возвращает message_id панели."""
    st, d, _ = get_state(cid)
    nd = dict(d if data is None else data)
    for key in PERSIST_KEYS:
        nd.setdefault(key, d.get(key))
    pid = int(d.get("panel_id") or 0)
    kind = "photo" if photo else "text"
    cur = d.get("panel_kind") or "text"
    # Telegram не позволяет добавить protect_content к уже отправленному сообщению через edit.
    # Поэтому панели из старых версий один раз пересоздаём как новое защищённое сообщение.
    protection_current = str(d.get("protect_v") or "") == CONTENT_PROTECTION_VERSION
    editable = pid and not photo and not d.get("panel_receipt") and (cur == "text" or (keep_photo and cur == "photo"))
    if protect and not protection_current:
        editable = False
    if editable and edit_message(cid, pid, cur, text, ikb, extra):
        nd.update(panel_id=pid, panel_kind=cur, panel_receipt=bool(receipt), protect_v=CONTENT_PROTECTION_VERSION)
        set_state(cid, state or st, nd)
        return pid
    m = deliver(cid, text, ikb, photo, extra, protect=protect)
    mid = int(m["message_id"])
    nd.update(panel_id=mid, panel_kind=kind, panel_receipt=bool(receipt), protect_v=CONTENT_PROTECTION_VERSION)
    set_state(cid, state or st, nd)
    _retire(cid, d, keep=mid)
    return mid


def receipt(cid, text, photo=None, data=None, extra=None, keep_photo=True):
    """Постоянный итог (зачислено / вывод принят): заявка превращается в чек, кнопка «Главное меню»."""
    return panel(cid, text, menu_btn_kb(), photo, extra=extra, state="idle", data=data, receipt=True, keep_photo=keep_photo)


def _idle_data(d, name=None):
    fresh = {k: v for k, v in (d or {}).items() if k not in REQUEST_KEYS}
    for k in ("action", "bk", "player_id", "player_verified"):
        fresh.pop(k, None)
    if name:
        fresh["first_name"] = name
    return fresh


class Loading:
    """Ненавязчивое ожидание сетевой операции.

    В старых версиях индикатор заменял текущую панель на «Загрузка…» и снимал кнопки.
    При двойном нажатии второй callback приходил уже от устаревшего экрана, из-за чего меню
    могло пересоздаваться/удаляться. Теперь интерфейс во время запроса не трогаем: callback
    подтверждается мгновенно отдельным ACK-пулом, а панель меняется только на конечный результат.
    """

    def __init__(self, cid, text, min_seconds=0.18, extra=None):
        self.cid, self.text, self.extra = int(cid), str(text), extra
        self.min_seconds = max(0.0, float(min_seconds))
        self.started = time.monotonic()

    def wait(self, future=None, hard_limit=20.0):
        if future is None:
            return
        # Ничего не редактируем и не меняем state. Просто даём future завершиться;
        # _result() ниже получает итог/таймаут. Это устраняет скачки экранов.
        while not future.done() and time.monotonic() - self.started <= hard_limit:
            time.sleep(0.03)


def _result(future, default):
    try:
        res = future.result(timeout=30)
    except Exception as exc:
        print(f"[onoi] backend call failed: {exc}", flush=True)
        return dict(default)
    return res if isinstance(res, dict) else dict(default)


# ============================================================ тексты шагов
def bk_name(bk):
    return str(bk or "").upper()


def id_prompt(bk):
    return ico(BK_BASE, f"Введите ID {bk_name(bk)}")


def amount_text(bk, pid, verified_name=""):
    minimum, maximum = deposit_limits(bk)
    lines = [f"{BK_BASE} {bk_name(bk)} · ID {pid}"]
    if verified_name:
        lines.append(f"✅ {verified_name}")
    lines += ["", "💰 Введите сумму:", f"от {fmt_amount(minimum)} до {fmt_amount(maximum)}"]
    return "\n".join("> " + ln for ln in lines)


QR_PROMPT = ico("🗺", "Отправьте фото QR-кода вашего кошелька")


def code_prompt(bk):
    return ico(BK_BASE, f"Введите код вывода {bk_name(bk)}")


def bk_list_text(action):
    return "📥 Пополнение" if action == "deposit" else "📤 Вывод"


def timer_line(deadline):
    left = max(0, int(deadline - time.time()))
    return f"⏳ Осталось {left // 60}:{left % 60:02d}"


def payment_lines(text):
    """Текст заявки от бэкенда без строки про «5 минут» — внизу живой таймер."""
    lines = [ln for ln in str(text or "").splitlines() if "минут" not in ln.lower()]
    return "\n".join(lines).strip()


def card_text(d):
    quoted = "\n".join("> " + ln for ln in payment_lines(d.get("payment_text")).split("\n") if ln.strip())
    return f"{quoted}\n\n{timer_line(float(d.get('deadline') or 0))}"


_AMOUNT_RE = re.compile(r"(?:Зачислено|Сумма к оплате|Сумма)\s*:?\s*([\d][\d\s]*(?:[.,]\d+)?)", re.I)


def success_text(d, backend_text):
    """✅ чек по нашему шаблону: БК с логотипом, ID, сумма. Данные — из состояния,
    чего нет — из текста бэкенда."""
    bk = str(d.get("bk") or "")
    pid = str(d.get("player_id") or "")
    if not bk:
        m = re.search(r"БК\s*:\s*([A-Za-z0-9]+)", backend_text)
        bk = m.group(1) if m else ""
    if not pid:
        m = re.search(r"ID\s*:\s*(\d+)", backend_text)
        pid = m.group(1) if m else ""
    m = _AMOUNT_RE.search(backend_text) or _AMOUNT_RE.search(str(d.get("payment_text") or ""))
    amount = m.group(1).strip().replace(",", ".") if m else ""
    lines = ["✅ Пополнение успешно зачислено!", ""]
    if pid:
        lines.append(f"> {BK_BASE}: {pid}" if bk else f"> ID: {pid}")
    if amount:
        lines.append(f"> 💰 Зачислено: {amount} сом")
    return "\n".join(lines)


# ============================================================ отмена / таймер
def _cancel_remote(cid, request_id, reason):
    request_id = str(request_id or "").strip()
    if not request_id:
        return True
    last = {}
    for attempt in range(4):
        try:
            last = api("/bot/deposit/cancel", "POST",
                       {"chat_id": cid, "request_id": request_id, "reason": reason}, timeout=2.5)
            if isinstance(last, dict) and last.get("ok"):
                return True
        except Exception as exc:
            last = {"error": str(exc)[:160]}
        time.sleep(0.25 * (attempt + 1))
    print(f"[onoi] cancel backend failed request={request_id}: {last}", flush=True)
    return False




# Таймеры заявок: один планировщик на всех клиентов (не занимает потоки пула на 5 минут).
_TIMERS = {}
_TIMERS_LOCK = threading.Lock()
TIMER_STEP = 10.0


def _timer_add(cid, rid, deadline):
    with _TIMERS_LOCK:
        _TIMERS[int(cid)] = {"rid": str(rid), "deadline": float(deadline), "next": time.time() + TIMER_STEP}


def _timer_tick(cid, rid, deadline):
    """Одно обновление таймера. False — заявка уже не активна, таймер снимаем."""
    try:
        with _chat_lock(cid):
            st, d, _ = get_state(cid)
            if st not in PAYING_STATES or str(d.get("request_id") or "") != str(rid):
                return False
            pid = int(d.get("panel_id") or 0)
            if not pid:
                return False
            edit_message(cid, pid, d.get("panel_kind") or "text", card_text(d), bank_kb(d.get("methods"), rid))
        return deadline - time.time() > 0
    except Exception:
        traceback.print_exc()
        return True


def _timer_run(cid, t):
    alive = _timer_tick(cid, t["rid"], t["deadline"])
    with _TIMERS_LOCK:
        cur = _TIMERS.get(cid)
        if cur is not None and cur["rid"] == t["rid"]:
            if alive:
                cur["next"] = time.time() + TIMER_STEP
                cur["busy"] = False
            else:
                _TIMERS.pop(cid, None)


def _timer_loop():
    while not STOP.is_set():
        try:
            now = time.time()
            due = []
            with _TIMERS_LOCK:
                for cid, t in _TIMERS.items():
                    if not t.get("busy") and now >= t["next"]:
                        t["busy"] = True
                        due.append((cid, dict(t)))
            for cid, t in due:
                TIMER_POOL.submit(_timer_run, cid, t)
        except Exception:
            traceback.print_exc()
        time.sleep(0.5)


def cancel_flow(cid, name, st, d, reason="user_cancelled"):
    """Отмена любого шага → сразу приветствие. Заявка с QR удаляется (старые реквизиты не висят)."""
    active = st in PAYING_STATES and bool(d.get("request_id"))
    if active:
        submit_background(_cancel_remote, cid, d.get("request_id"), reason)
        hist_set(cid, d.get("request_id"), "cancelled")
        panel(cid, "❌ Пополнение отменено\n\n> Не переводите по старым реквизитам", menu_kb(),
              state="idle", data=_idle_data(d, name))
        return
    panel(cid, greeting_text(name), menu_kb(), state="idle", data=_idle_data(d, name))


# ============================================================ сценарии
def show_menu(cid, name, d=None, note=""):
    """Главное меню без создания нового сообщения.

    /start по-прежнему создаёт новый экран, но обычные кнопки «Главное меню», «Назад» и
    переключение языка редактируют текущую protected-панель на месте.
    """
    d = dict(d or {})
    text = greeting_text(name)
    if note:
        text += "\n\n> " + str(note).strip()
    return panel(cid, text, menu_kb(), state="idle", data=_idle_data(d, name))


def _clear_reply_kb(cid):
    """Один раз на чат: убираем reply-клавиатуру, если она осталась от старой версии.
    Сообщение с reply_markup нельзя редактировать, поэтому шлём служебное и сразу удаляем."""
    try:
        m = tg(token(), "sendMessage", {"chat_id": int(cid), "text": "⌛", "reply_markup": {"remove_keyboard": True}, "protect_content": True})
        if isinstance(m, dict) and m.get("message_id"):
            delete_bg(cid, [m["message_id"]])
    except Exception:
        pass


def start(cid, name, st, d, start_arg=""):
    """/start всегда присылает новое приветствие — клиент видит его даже после удаления чата.
    Прошлый экран уходит (первое приветствие не удаляется, только возвращает текст).
    Незавершённая заявка закрывается."""
    had_request = st in PAYING_STATES and bool(d.get("request_id"))
    if had_request:
        submit_background(_cancel_remote, cid, d.get("request_id"), "restart")
        hist_set(cid, d.get("request_id"), "cancelled")
    ensure_ref_user(cid)
    ref_note = ""
    arg = str(start_arg or "").strip()
    if arg.startswith("ref_"):
        status = bind_referral(cid, arg.split("ref_", 1)[1])
        if status == "ok":
            ref_note = "\n\n> 🎁 Вы присоединились по приглашению"
    nd = _idle_data(d, name)
    if not privacy_accepted(cid):
        show_privacy_gate(cid, name, nd)
        return
    if not phone_verified(cid):
        request_phone(cid, name, nd, skip_privacy=True)
        return
    if not d.get("kb_cleared"):
        _clear_reply_kb(cid)
        nd["kb_cleared"] = 1
    if not check_sub(cid):
        text, ikb = "🔐 Подпишитесь на канал и нажмите «Проверить»", sub_kb()
        text += ref_note
    else:
        text, ikb = greeting_text(name), menu_kb()
        if had_request:
            text += "\n\n> ❌ Прошлая заявка отменена — не переводите по старым реквизитам"
        text += ref_note
    m = deliver(cid, text, ikb)
    mid = int(m["message_id"])
    nd.update(panel_id=mid, panel_kind="text", panel_receipt=False, protect_v=CONTENT_PROTECTION_VERSION)
    if not nd.get("greeting_id"):
        nd["greeting_id"] = mid
    set_state(cid, "idle", nd)
    _retire(cid, d, keep=mid)


def _block_check(cid):
    """Проверка блокировки — в фоне, экран не ждёт бэкенд."""
    if user_blocked(cid):
        with _chat_lock(cid):
            st, d, _ = get_state(cid)
            if st != "idle":
                panel(cid, err("Аккаунт заблокирован — напишите в поддержку"), menu_kb(), state="idle", data=_idle_data(d))


def begin(cid, name, action, st, d):
    submit_background(_block_check, cid)
    error = paused_for(action)
    if error:
        panel(cid, err(error), menu_kb(), state="idle", data=_idle_data(d, name))
        return
    if st in PAYING_STATES and d.get("request_id"):
        submit_background(_cancel_remote, cid, d.get("request_id"), "restart")
        hist_set(cid, d.get("request_id"), "cancelled")
    nd = _idle_data(d, name)
    nd["action"] = action
    panel(cid, bk_list_text(action), bk_kb(action), extra=bk_list_extra(), state="choose_bk", data=nd)


def choose_bk(cid, name, bk, d):
    action = d.get("action", "deposit")
    err = paused_for(action, bk)
    if err:
        panel(cid, "❌ " + err, menu_kb(), state="idle", data=_idle_data(d, name))
        return
    nd = _idle_data(d, name)
    nd.update(action=action, bk=bk)
    ask_id(cid, nd)


def ask_id(cid, d, error=""):
    bk = d["bk"]
    ids = saved_ids(cid, bk)
    photo = instruction_photo(bk, "deposit_id_photo" if d["action"] == "deposit" else "withdraw_id_photo")
    text = id_prompt(bk) + (f"\n\n{error}" if error else "")
    panel(cid, text, id_kb(ids) if ids else cancel_kb(), photo or None, extra=bk_extra(bk),
          state="choose_id" if ids else "wait_id", data=d)


def _verify_player(cid, bk, pid):
    try:
        result = api("/bot/player/check", "POST",
                     {"chat_id": int(cid), "bookmaker": str(bk or "").strip().lower(), "player_id": str(pid or "").strip()},
                     timeout=12)
    except Exception as exc:
        return {"ok": False, "message": "Не удалось проверить ID, попробуйте ещё раз", "error": str(exc)[:160]}
    return result if isinstance(result, dict) else {"ok": False, "message": "Не удалось проверить ID, попробуйте ещё раз"}


def handle_id(cid, name, text, d):
    bk = d.get("bk", "")
    text = str(text or "").strip()
    if not text.isdigit() or int(text) <= 0:
        ask_id(cid, d, err("ID — только цифры"))
        return
    loading = Loading(cid, "⚡ Проверяем ID", min_seconds=0.3)
    future = API_POOL.submit(_verify_player, cid, bk, text)
    loading.wait(future)
    check = _result(future, {"ok": False, "message": "Не удалось проверить ID, попробуйте ещё раз"})
    if not check.get("ok"):
        forget_saved_id(cid, bk, text)
        ask_id(cid, d, err(str(check.get("message") or "ID не найден. Проверьте номер и введите ID ещё раз")))
        return
    pid = str(check.get("player_id") or text)
    d["player_id"] = pid
    d["player_verified"] = bool(check.get("verified"))
    save_id(cid, bk, pid)
    if d["action"] == "deposit":
        fio = str(check.get("name") or "").strip() if check.get("verified") else ""
        panel(cid, amount_text(bk, pid, fio), amount_kb(bk), extra=bk_extra(bk), state="wait_amount", data=d)
    else:
        panel(cid, QR_PROMPT, withdraw_qr_kb(cid), state="wait_qr", data=d)


def handle_amount(cid, uid, name, text, d):
    bk = d.get("bk", "")
    pid = str(d.get("player_id") or "").strip()
    if not pid.isdigit():
        d.pop("player_id", None)
        ask_id(cid, d, err("ID не сохранился, введите ещё раз"))
        return
    fio = ""
    try:
        amount = float(str(text).replace(" ", "").replace(",", "."))
    except Exception:
        panel(cid, amount_text(bk, pid) + "\n\n" + err("Введите сумму цифрами"), amount_kb(bk), extra=bk_extra(bk))
        return
    minimum, maximum = deposit_limits(bk)
    if amount < minimum or amount > maximum:
        panel(cid, amount_text(bk, pid) + "\n\n" + err(f"Сумма от {fmt_amount(minimum)} до {fmt_amount(maximum)} KGS"),
              amount_kb(bk), extra=bk_extra(bk))
        return
    if abs(amount - round(amount)) > 0.000001:
        panel(cid, amount_text(bk, pid) + "\n\n" + err("Сумма без тыйынов"), amount_kb(bk), extra=bk_extra(bk))
        return
    amount = float(int(round(amount)))

    loading = Loading(cid, "⚡ Создаём заявку", min_seconds=0.3)
    future = API_POOL.submit(api, "/bot/deposit", "POST", {
        "chat_id": cid, "telegram_id": uid.get("id"), "username": uid.get("username"),
        "first_name": name, "bookmaker": bk, "player_id": pid, "amount": amount,
    })
    loading.wait(future)
    res = _result(future, {"ok": False, "message": "Пополнение временно недоступно, попробуйте позже"})
    if not res.get("ok") or not res.get("request_id"):
        panel(cid, "❌ " + str(res.get("message") or "Пополнение временно недоступно"), menu_kb(),
              state="idle", data=_idle_data(d, name))
        return

    base = str(runtime().get("public_url", "https://wwweeewww.fit")).rstrip("/")
    qr_path = str(res.get("qr_photo_url") or "").strip()
    qr = qr_path if qr_path.startswith("http") else (base + qr_path if qr_path else "")
    methods = res.get("payment_methods") or []
    rid = str(res.get("request_id"))
    deadline = time.time() + int(res.get("timeout_seconds") or 300)
    if OWNER:
        OWNER.register("onoi", cid, rid, "deposit")
    hist_add(cid, rid, "deposit", bk, pid, amount, "active")
    nd = {**d, "request_id": rid, "deadline": deadline, "methods": methods, "qr_url": qr,
          "payment_text": str(res.get("payment_text") or ""), "first_name": name}
    photo = (brand_qr(qr) or qr) if qr else None
    # QR для пополнения — намеренное исключение: клиент должен иметь возможность сохранить QR в галерею.
    panel(cid, card_text(nd), bank_kb(methods, rid), photo, state="wait_bank", data=nd, protect=False if photo else True)
    _timer_add(cid, rid, deadline)


def handle_code(cid, uid, name, text, d):
    bk = d.get("bk", "")
    loading = Loading(cid, "⚡ Отправляем заявку", min_seconds=0.3)
    future = API_POOL.submit(api, "/bot/withdraw", "POST", {
        "chat_id": cid, "telegram_id": uid.get("id"), "username": uid.get("username"),
        "first_name": name, "bookmaker": bk, "player_id": d.get("player_id"),
        "withdraw_code": text, "qr_file_url": d.get("qr_file_url"),
    })
    loading.wait(future)
    res = _result(future, {"ok": False, "message": "Сервис временно недоступен, попробуйте ещё раз"})
    if not res.get("ok"):
        panel(cid, code_prompt(bk) + "\n\n" + err(str(res.get("message") or "Неверные данные для вывода")), code_kb(),
              extra=bk_extra(bk), state="wait_code", data=d)
        return
    wrid = str(res.get("request_id") or f"w{int(time.time())}")
    if OWNER:
        OWNER.register("onoi", cid, res.get("request_id"), "withdraw")
    amt = res.get("amount")
    try:
        amt = float(amt) if amt is not None else None
    except Exception:
        amt = None
    hist_add(cid, wrid, "withdraw", bk, d.get("player_id"), amt, "pending")
    receipt(cid, quote_rest(res.get("message") or "✅ Заявка на вывод принята. Ожидайте обработки."),
            data=_idle_data(d, name), keep_photo=False)


# ============================================================ история заявок
def _hist_row_label(r):
    amount = fmt_money(r.get("amount") or 0) if r.get("amount") else ""
    sign = "+" if r.get("kind") == "deposit" else "−"
    when = fmt_dt(r.get("created_at")).replace(".20", ".")
    status = STATUS_SHORT.get(r.get("status"), r.get("status"))
    middle = f"{sign}{amount} KGS" if amount else bk_name(r.get("bk"))
    return f"{when} · {middle} · {bk_name(r.get('bk'))} · {status}"


def show_history(cid, d, page=0):
    page = max(0, int(page or 0))
    per_page = 10
    total = hist_total(cid)
    pages = max(1, (total + per_page - 1) // per_page)
    if page >= pages:
        page = pages - 1
    rows = hist_list(cid, per_page, offset=page * per_page)
    if not rows:
        panel(
            cid, "🧾 История заявок\n\n> Заявок пока нет",
            kb([ib("Профиль", "profile", icon=CE["receipt"]), ib("Главное меню", "menu", icon=CE["menu"])]),
            state="idle", data={**d, "view": "history", "history_page": 0}
        )
        return
    buttons = []
    for r in rows:
        buttons.append([ib(
            _hist_row_label(r), f"hist:{r['request_id']}:{page}",
            icon=CE["signal"] if r["kind"] == "deposit" else CE["plane"],
        )])
    nav = []
    if page > 0:
        nav.append(ib("‹", f"histpage:{page-1}", style=NEUTRAL))
    nav.append(ib(f"{page+1}/{pages}", "histnoop", style=NEUTRAL))
    if page + 1 < pages:
        nav.append(ib("›", f"histpage:{page+1}", style=NEUTRAL))
    if nav:
        buttons.append(nav)
    buttons.append([ib("Профиль", "profile", icon=CE["receipt"]), ib("Главное меню", "menu", icon=CE["menu"])])
    panel(
        cid, f"🧾 История заявок\n\n> Последние операции · Страница {page+1}/{pages}\n> Всего: {total}",
        kb(*buttons), state="idle", data={**d, "view": "history", "history_page": page},
    )


def show_history_item(cid, d, rid, page=None):
    r = hist_get(cid, rid)
    page = int(d.get("history_page", 0) if page is None else page)
    if not r:
        show_history(cid, d, page=page)
        return
    head = "🧾 Пополнение" if r["kind"] == "deposit" else "🛫 Вывод"
    lines = [head, "", f"> {BK_BASE} {bk_name(r['bk'])} · ID {r['player_id']}"]
    if r.get("amount"):
        lines.append(f"> 💰 Сумма: {fmt_money(r['amount'])} KGS")
    lines.append(f"> Статус: {STATUS_LABEL.get(r['status'], r['status'])}")
    lines.append(f"> ⏱ {fmt_dt(r['created_at'])}")
    lines.append(f"> № {r['request_id']}")
    problem_title = "Проблема с пополнением" if r["kind"] == "deposit" else "Проблема с выводом"
    problem_url = support_deep_link(f"problem_{'dep' if r['kind']=='deposit' else 'wd'}_{r['request_id']}")
    ikb = kb(
        [ib(problem_title, url=problem_url, icon=CE["cloud"])],
        [ib("Назад", f"histpage:{page}"), ib("Профиль", "profile", icon=CE["receipt"])],
    )
    panel(
        cid, "\n".join(lines), ikb, extra=bk_extra(r["bk"]), state="idle",
        data={**d, "view": "detail", "history_page": page},
    )


def _recent_history_match(cid, text, kind="deposit"):
    """Find the request behind a repeated/final backend notice even after the live state is already idle.
    This prevents the same successful deposit from being shown twice when the backend emits two final outbox events."""
    raw = str(text or "")
    low = raw.lower()
    m_req = re.search(r"#\s*([A-Za-z0-9_-]{3,})", raw)
    if m_req:
        rid = m_req.group(1)
        r = hist_get(cid, rid)
        if r and str(r.get("kind")) == str(kind):
            return rid

    m_id = re.search(r"(?:^|\n|\s)ID\s*:?\s*(\d{3,})", raw, re.I)
    player_id = m_id.group(1) if m_id else ""
    m_bk = re.search(r"(?:БК|BK)\s*:?\s*([A-Za-z0-9]+)", raw, re.I)
    bk = (m_bk.group(1).lower() if m_bk else "")
    m_amt = _AMOUNT_RE.search(raw)
    amount = None
    if m_amt:
        try:
            amount = float(m_amt.group(1).replace(" ", "").replace(",", "."))
        except Exception:
            amount = None

    try:
        cutoff = int(time.time()) - 15 * 60
        sql = "SELECT * FROM history WHERE chat_id=? AND kind=? AND created_at>=?"
        args = [int(cid), str(kind), cutoff]
        if player_id:
            sql += " AND player_id=?"
            args.append(player_id)
        if bk:
            sql += " AND lower(bk)=?"
            args.append(bk)
        sql += " ORDER BY created_at DESC LIMIT 20"
        with conn() as c:
            rows = [dict(r) for r in c.execute(sql, tuple(args)).fetchall()]
        if amount is not None:
            for r in rows:
                try:
                    if abs(float(r.get("amount") or 0) - amount) < 0.011:
                        return str(r.get("request_id") or "")
                except Exception:
                    pass
        if player_id or bk:
            return str(rows[0].get("request_id") or "") if rows else ""
        # Last-resort only for a very recent completed notice, to avoid attaching an old payment.
        for r in rows:
            if int(r.get("updated_at") or r.get("created_at") or 0) >= int(time.time()) - 90:
                return str(r.get("request_id") or "")
    except Exception:
        traceback.print_exc()
    return ""


def _final_notice_claim(cid, rid, final_key):
    """Atomic one-time claim for a final notification. False means it was already shown."""
    rid = str(rid or "").strip()
    if not rid:
        return True
    key = str(final_key or "final").strip().lower()[:32]
    try:
        now = int(time.time())
        with conn() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO final_notice_dedupe(chat_id,request_id,final_key,sent_at) VALUES(?,?,?,?)",
                (int(cid), rid, key, now),
            )
            # Cheap housekeeping; old rows serve no purpose after a week.
            if now % 97 == 0:
                c.execute("DELETE FROM final_notice_dedupe WHERE sent_at<?", (now - 7 * 86400,))
            return int(cur.rowcount or 0) > 0
    except Exception:
        traceback.print_exc()
        return True


def _hist_apply_outbox(cid, d, text, success):
    """Обновить статус заявки и вернуть request_id, к которому относится уведомление."""
    low = str(text).lower()
    m = re.search(r"#\s*([A-Za-z0-9_-]{3,})", str(text))
    if "вывод" in low:
        rid = (m.group(1) if m else "") or hist_latest(cid, "withdraw", ["pending"]) or _recent_history_match(cid, text, "withdraw")
        if rid:
            if any(x in low for x in ("выполнен", "отправлен", "зачислен", "успешн")):
                hist_set(cid, rid, "done")
            elif any(x in low for x in ("отклон", "отмен")):
                hist_set(cid, rid, "rejected")
        return rid or ""
    rid = str(d.get("request_id") or "") or (m.group(1) if m else "") or hist_latest(cid, "deposit", ["active"]) or _recent_history_match(cid, text, "deposit")
    if not rid:
        return ""
    if success:
        hist_set(cid, rid, "success")
    elif any(x in low for x in ("истек", "время оплаты", "время вышло")):
        hist_set(cid, rid, "expired")
    elif "отмен" in low:
        hist_set(cid, rid, "cancelled")
    return rid


# ============================================================ обработчики апдейтов
def _user(msg):
    uid = msg.get("from", {}) or {}
    return uid, (uid.get("first_name") or "пользователь")


def handle_text(msg):
    cid = int(msg["chat"]["id"])
    uid, name = _user(msg)
    remember_user(uid)
    text = (msg.get("text") or "").strip()
    incoming = msg.get("message_id")
    st, d, _ = get_state(cid)

    contact = msg.get("contact") or {}
    if contact:
        delete_now(cid, incoming)
        contact_uid = int(contact.get("user_id") or 0)
        if contact_uid != cid:
            request_phone(cid, name, d)
            try:
                deliver(cid, "❌ Отправьте именно свой контакт через кнопку ниже", None)
            except Exception:
                pass
            return
        phone = save_phone(cid, contact.get("phone_number") or "")
        _clear_reply_kb(cid)
        submit_background(api, "/bot/events", "POST", {"event": "phone_verified", "chat_id": cid, "user": uid, "phone": phone})
        try:
            deliver(cid, "✅ Номер подтверждён", None)
        except Exception:
            pass
        start(cid, name, "idle", d)
        return

    submit_background(api, "/bot/events", "POST", {"event": "message", "chat_id": cid, "user": uid, "message": msg})
    # Ввод клиента убираем сразу — на экране остаётся только панель.
    delete_now(cid, incoming)

    if text.startswith("/start"):
        start_arg = text.split(maxsplit=1)[1] if len(text.split(maxsplit=1)) > 1 else ""
        start(cid, name, st, d, start_arg)
    elif not phone_verified(cid):
        request_phone(cid, name, d)
    elif is_cancel(text):
        cancel_flow(cid, name, st, d)
    elif detect_action(text):
        begin(cid, name, detect_action(text), st, d)
    elif st in ("choose_id", "wait_id"):
        handle_id(cid, name, text, d)
    elif st == "wait_amount":
        handle_amount(cid, uid, name, text, d)
    elif st == "wait_code":
        if normalized_text(text) == "инструкция":
            panel(cid, ico(BK_BASE, instruction_text(d.get("bk"))), back_kb(), extra=bk_extra(d.get("bk")))
        else:
            handle_code(cid, uid, name, text, d)
    elif st == "wait_qr":
        panel(cid, QR_PROMPT + "\n\n" + err("Нужно фото, не текст"), withdraw_qr_kb(cid))
    elif st == "wait_profile_qr":
        panel(cid, "🗺 QR для вывода\n\n" + err("Нужно фото QR, не текст"), kb([ib("Назад", "profile")]))
    elif st == "wait_ident_photo":
        panel(cid, "Идентификация\n\n" + err("Нужно селфи, не текст"), kb([ib("Назад", "profile")]))
    elif st == "wait_phone":
        request_phone(cid, name, d)
    elif st == "choose_bk":
        bk = text.lower().replace(" ", "")
        if bk in BK_KEYS:
            choose_bk(cid, name, bk, d)
    elif st == "idle":
        # Текст без сценария — показываем свежее приветствие (старый экран мог быть удалён клиентом).
        start(cid, name, st, d)
    # во время оплаты лишний текст просто убран.


def handle_photo(msg):
    cid = int(msg["chat"]["id"])
    uid, name = _user(msg)
    remember_user(uid)
    incoming = msg.get("message_id")
    st, d, _ = get_state(cid)
    photos = msg.get("photo") or []
    delete_now(cid, incoming)
    if not phone_verified(cid):
        request_phone(cid, name, d)
        return
    if not photos:
        return
    url = ""
    try:
        f = tg(token(), "getFile", {"file_id": photos[-1]["file_id"]})
        url = f"https://api.telegram.org/file/bot{token()}/{f['file_path']}"
    except Exception:
        traceback.print_exc()
    submit_background(api, "/bot/events", "POST", {"event": "photo", "chat_id": cid, "user": uid, "message": msg, "file_url": url})

    if st == "wait_profile_qr":
        file_id = str(photos[-1].get("file_id") or "")
        if not file_id:
            panel(cid, "❌ Не удалось сохранить QR — отправьте фото ещё раз", kb([ib("Назад", "profile")]), state="wait_profile_qr", data=d)
            return
        save_qr(cid, file_id)
        if d.get("payout_after_qr"):
            show_ref_payout_result(cid, name, d)
        else:
            show_profile(cid, name, d)
        return

    if st == "wait_ident_photo":
        file_id = str(photos[-1].get("file_id") or "")
        if not file_id:
            panel(cid, "❌ Не удалось получить фото, отправьте ещё раз", kb([ib("Назад", "profile")]), state="wait_ident_photo", data=d)
            return
        faces = face_count_from_url(url)
        if faces == 0:
            panel(cid, "Идентификация\n\n" + err("Лицо не найдено. Отправьте более чёткое селфи"), kb([ib("Назад", "profile")]), state="wait_ident_photo", data=d)
            return
        if faces and faces > 1:
            panel(cid, "Идентификация\n\n" + err("Пожалуйста, отправьте одну фотографию с одним лицом"), kb([ib("Назад", "profile")]), state="wait_ident_photo", data=d)
            return
        note = 'single_face_detected' if faces == 1 else 'manual_review'
        save_ident(cid, file_id, 'pending', faces, note)
        submit_background(api, '/bot/events', 'POST', {'event': 'identification', 'chat_id': cid, 'user': uid, 'file_url': url, 'face_count': faces, 'status': 'pending'})
        extra = '\n> Базовая проверка лица пройдена\n> Дата и время будут проверены оператором' if faces == 1 else '\n> Автопроверка недоступна — заявка сохранена для ручной проверки'
        panel(cid, '✅ Селфи сохранено и отправлено на проверку' + extra, kb([ib('Идентификация', 'profile:ident', icon=CE['signal']), ib('Профиль', 'profile', icon=CE['receipt'])], [ib('Главное меню', 'menu', icon=CE['menu'])]), state='idle', data={**_idle_data(d, name), 'view': 'ident'})
        return

    if st != "wait_qr":
        if st == "idle":
            start(cid, name, st, d)
        return
    if not url:
        panel(cid, QR_PROMPT + "\n\n" + err("Не удалось получить фото, отправьте ещё раз"), cancel_kb())
        return
    d["qr_file_url"] = url
    submit_background(api, "/bot/qr/prefetch", "POST", {"url": url, "chat_id": cid}, timeout=20)
    bk = d.get("bk", "")
    photo = instruction_photo(bk, "withdraw_code_photo")
    panel(cid, code_prompt(bk), code_kb(), photo or None, extra=bk_extra(bk), state="wait_code", data=d)


def handle_other_media(msg):
    cid = int(msg["chat"]["id"])
    uid, name = _user(msg)
    remember_user(uid)
    st, d, _ = get_state(cid)
    delete_now(cid, msg.get("message_id"))
    if not phone_verified(cid):
        request_phone(cid, name, d)
        return
    if st == "wait_qr":
        panel(cid, QR_PROMPT + "\n\n" + err("Отправьте как фотографию, не файлом"), withdraw_qr_kb(cid))
    elif st == "wait_profile_qr":
        panel(cid, "🗺 QR для вывода\n\n" + err("Отправьте QR как фотографию, не файлом"), kb([ib("Назад", "profile")]))
    elif st == "wait_ident_photo":
        panel(cid, "Идентификация\n\n" + err("Отправьте селфи как фотографию, не файлом"), kb([ib("Назад", "profile")]))


def callbacks(q):
    cid = int(q["from"]["id"])
    data = q.get("data", "") or ""
    uid, name = _user(q)
    remember_user(uid)
    pressed = int(((q.get("message") or {}).get("message_id")) or 0)
    st, d, _ = get_state(cid)
    pid = int(d.get("panel_id") or 0)
    # Старые сообщения нельзя превратить в protected-content редактированием.
    # Первый клик по старой неактивной панели мягко создаёт новое защищённое меню.
    if str(d.get("protect_v") or "") != CONTENT_PROTECTION_VERSION and not (st in PAYING_STATES and d.get("request_id")):
        if not q.get("_preacked"):
            toast(q)
        # Старую незашищённую панель Telegram не умеет сделать protected через edit.
        # Пересоздаём ровно один раз; после этого все навигационные кнопки работают на месте.
        start(cid, name, st, d)
        return
    # Кнопка перестаёт «крутиться» сразу: отвечаем на callback до любой работы.
    if data.startswith("off:"):
        bk = data.split(":", 1)[1]
        toast(q, paused_for(d.get("action", "deposit"), bk) or f"{bk_name(bk)} временно недоступен", alert=True)
        return
    if data == "instr":
        instruction = clean_text(instruction_text(d.get("bk")))
        if st != "wait_code":
            toast(q, "Неактуально")
        elif len(instruction) <= 200:
            toast(q, instruction, alert=True)          # модальное окно Telegram (лимит 200 символов)
        else:
            toast(q)
            panel(cid, ico(BK_BASE, instruction), back_kb(), extra=bk_extra(d.get("bk")))
        return
    if data == "check_sub":
        if check_sub(cid):
            toast(q)
            show_menu(cid, name, d)
        else:
            toast(q, "Вы ещё не подписаны", alert=True)
        return
    if not q.get("_preacked"):
        toast(q)
    if data == "privacy:accept":
        save_privacy_consent(cid)
        if phone_verified(cid):
            show_menu(cid, name, d, note="Политика конфиденциальности подтверждена")
        else:
            request_phone(cid, name, d, skip_privacy=True)
        return
    if not phone_verified(cid):
        request_phone(cid, name, d)
        return
    if pressed and pid and pressed != pid:
        # Двойной клик часто приходит уже после того, как первый клик обновил panel_id.
        # Никогда не выполняем callback со старой панели повторно — только гасим старые кнопки.
        if data.startswith("cancel_deposit"):
            delete_bg(cid, [pressed])
        else:
            submit_background(edit_markup, cid, pressed, None)
        return

    if data.startswith("act:"):
        begin(cid, name, data.split(":", 1)[1], st, d)
    elif data == "cancel":
        cancel_flow(cid, name, st, d)
    elif data.startswith("cancel_deposit"):
        rid = data.split(":", 1)[1] if ":" in data else ""
        if st in PAYING_STATES and d.get("request_id") == rid:
            cancel_flow(cid, name, st, d)
    elif data.startswith("bk:"):
        bk = data.split(":", 1)[1]
        if st == "choose_bk" and bk in BK_KEYS:
            choose_bk(cid, name, bk, d)
        # callback уже неактуален — молча игнорируем; текущий экран не трогаем.
    elif data.startswith("id:"):
        if st in ("choose_id", "wait_id"):
            handle_id(cid, name, data.split(":", 1)[1], d)
    elif data.startswith("amt:"):
        if st == "wait_amount":
            handle_amount(cid, uid, name, data.split(":", 1)[1], d)
    elif data == "back":
        if st == "wait_code":
            panel(cid, code_prompt(d.get("bk")), code_kb(), extra=bk_extra(d.get("bk")))
        elif d.get("view") == "detail":
            show_history(cid, _idle_data(d, name), page=d.get("history_page", 0))
        elif st in ("wait_profile_qr", "wait_ident_photo"):
            show_profile(cid, name, d)
        else:
            show_menu(cid, name, d)
    elif data == "menu":
        show_menu(cid, name, d)
    elif data == "profile":
        if not (st in PAYING_STATES and d.get("request_id")):
            show_profile(cid, name, d)
    elif data == "profile:ident":
        show_identification(cid, name, d)
    elif data == "ident:send":
        show_ident_consent(cid, name, d)
    elif data == "ident:consent":
        save_ident_consent(cid)
        ask_ident_photo(cid, name, d)
    elif data in ("profile:history", "profile:deposits", "profile:withdrawals"):
        show_history(cid, _idle_data(d, name), page=0)
    elif data == "profile:lang":
        show_language(cid, name, d, return_to="profile")
    elif data == "menu:lang":
        show_language(cid, name, d, return_to="menu")
    elif data.startswith("lang:"):
        return_to = str(d.get("lang_return") or "profile")
        set_lang(cid, data.split(":", 1)[1])
        if return_to == "menu":
            show_menu(cid, name, d)
        else:
            show_profile(cid, name, d)
    elif data == "profile:qr":
        ask_profile_qr(cid, name, d)
    elif data == "my_qr":
        if st == "wait_qr":
            qr = get_saved_qr(cid)
            url = telegram_file_url((qr or {}).get("file_id")) if qr else ""
            if not url:
                panel(cid, QR_PROMPT + "\n\n" + err("Сохранённый QR недоступен — отправьте новый"), withdraw_qr_kb(cid))
            else:
                d["qr_file_url"] = url
                submit_background(api, "/bot/qr/prefetch", "POST", {"url": url, "chat_id": cid}, timeout=20)
                bk = d.get("bk", "")
                photo = instruction_photo(bk, "withdraw_code_photo")
                panel(cid, code_prompt(bk), code_kb(), photo or None, extra=bk_extra(bk), state="wait_code", data=d)
        # если состояние уже сменилось, старый callback «Мой QR» просто игнорируется.
    elif data == "ref":
        if not (st in PAYING_STATES and d.get("request_id")):
            show_referrals(cid, name, d)
    elif data == "ref_share":
        send_referral_card(cid, name)
    elif data == "ref_payout":
        if ref_available(cid) <= 0:
            panel(cid, "🎁 Реферальная система\n\n> Сейчас нет доступного реферального баланса для вывода", ref_kb(name, cid), state="idle", data={**_idle_data(d, name), "view": "ref"})
        elif not get_saved_qr(cid):
            ask_profile_qr(cid, name, d, payout_after=True)
        else:
            show_ref_payout_result(cid, name, d)
    elif data == "hist":
        if not (st in PAYING_STATES and d.get("request_id")):
            show_history(cid, _idle_data(d, name), page=0)
    elif data == "histnoop":
        pass
    elif data.startswith("histpage:"):
        try:
            page = int(data.split(":", 1)[1])
        except Exception:
            page = 0
        show_history(cid, _idle_data(d, name), page=page)
    elif data.startswith("hist:"):
        parts = data.split(":")
        rid = parts[1] if len(parts) > 1 else ""
        try:
            page = int(parts[2]) if len(parts) > 2 else int(d.get("history_page", 0) or 0)
        except Exception:
            page = 0
        show_history_item(cid, _idle_data(d, name), rid, page=page)
    else:
        # Неизвестный/устаревший callback не должен удалять экран или запускать /start.
        return


def _ref_payout_apply_outbox(cid, text, meta=None):
    """Если бэкенд/оператор прислал финал по RF-заявке — синхронизируем бонусный баланс."""
    meta = meta if isinstance(meta, dict) else {}
    raw_id = str(meta.get("request_id") or meta.get("referral_request_id") or "")
    m = re.search(r"\b(RF[A-Z0-9]{6,20})\b", str(text or ""), re.I)
    rid = (raw_id or (m.group(1) if m else "")).upper()
    if not rid.startswith("RF"):
        return
    low = str(text or "").lower()
    final = str(meta.get("final_status") or "").lower()
    done = final in ("success", "done", "paid") or any(x in low for x in ("выполнен", "выплач", "успешн"))
    rejected = final in ("rejected", "cancelled", "canceled", "failed") or any(x in low for x in ("отклон", "отмен", "ошибка"))
    if not (done or rejected):
        return
    try:
        with conn() as c:
            row = c.execute("SELECT amount,status FROM referral_payouts WHERE id=? AND chat_id=?", (rid, int(cid))).fetchone()
            if not row or str(row["status"]) != "pending":
                return
            now = int(time.time())
            if done:
                amount = float(row["amount"] or 0)
                c.execute("UPDATE referral_payouts SET status='done',updated_at=? WHERE id=?", (now, rid))
                c.execute(
                    "UPDATE referrals SET reward_balance=MAX(0,COALESCE(reward_balance,0)-?) WHERE chat_id=?",
                    (amount, int(cid)),
                )
            else:
                c.execute("UPDATE referral_payouts SET status='rejected',updated_at=? WHERE id=?", (now, rid))
    except Exception:
        traceback.print_exc()


# ============================================================ outbox (уведомления бэкенда)
def deliver_outbox(item):
    cid = int(item["chat_id"])
    kind = item.get("kind")
    with _chat_lock(cid):
        st, d, _ = get_state(cid)
        photo = item.get("photo_url") or None
        text = item.get("caption", "") if photo else item.get("text", "")
        meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
        low = str(text).lower()
        final = str(meta.get("final_status") or "").lower()
        _ref_payout_apply_outbox(cid, text, meta)
        success = final == "success" or ("зачислен" in low and "не зачислен" not in low)
        closes = kind == "replace_pending" or bool(final) or success or any(
            x in low for x in ("отменен", "отменён", "истек", "время оплаты", "не переводите"))
        print(f"[onoi] outbox {item.get('id')} chat={cid} kind={kind} final={final or '-'} state={st}", flush=True)

        rid = _hist_apply_outbox(cid, d if st in PAYING_STATES else {}, text, success)

        # Backend may produce two different final events for the same payment. Show only one user-facing final.
        final_key = "success" if success else (final or ("cancelled" if "отмен" in low else "expired" if "истек" in low else "final"))
        if closes and rid and not _final_notice_claim(cid, rid, final_key):
            print(f"[onoi] duplicate final suppressed chat={cid} request={rid} final={final_key}", flush=True)
            return

        if success and 'вывод' not in low:
            reward_rid = rid or _recent_history_match(cid, text, "deposit")
            notify_ref_reward(cid, reward_rid, d.get("first_name") or "")

        if st in PAYING_STATES and closes:
            # One final receipt replaces the active payment card.
            if success:
                receipt(cid, success_text(d, text), data=_idle_data(d), extra=bk_extra(d.get("bk")), keep_photo=False)
            else:
                panel(cid, quote_rest(text), menu_kb(), photo, state="idle", data=_idle_data(d))
            return

        if closes and rid:
            # Final state already processed while the panel is idle: do not create a second raw notification.
            # If this is the first final we got after a restart, show one compact receipt instead.
            if success:
                r = hist_get(cid, rid) or {}
                pseudo = {"bk": r.get("bk"), "player_id": r.get("player_id"), "payment_text": text}
                receipt(cid, success_text(pseudo, text), data=_idle_data(d), extra=bk_extra(r.get("bk")), keep_photo=False)
            else:
                deliver(cid, quote_rest(text), None, photo)
            return

        # Broadcast/operator/non-final notification.
        deliver(cid, quote_rest(text), None, photo)


_FOREIGN_SEEN = {}
_FOREIGN_LOCK = threading.Lock()


def _known_chat(cid):
    try:
        with conn() as c:
            return c.execute("SELECT 1 FROM state WHERE chat_id=?", (int(cid),)).fetchone() is not None
    except Exception:
        return True


def _mine(item):
    """Доставлять ли уведомление нам. Чужой чат ждём OUTBOX_TAKEOVER сек — вдруг LUXON заберёт."""
    if OWNER:
        return OWNER.should_deliver("onoi", item)
    if OUTBOX_TAKEOVER <= 0 or _known_chat(item.get("chat_id") or 0):
        return True
    key = str(item.get("id") or "")
    now = time.monotonic()
    with _FOREIGN_LOCK:
        first = _FOREIGN_SEEN.setdefault(key, now)
        if len(_FOREIGN_SEEN) > 5000:
            for k in [k for k, t in _FOREIGN_SEEN.items() if now - t > 3600][:2500]:
                _FOREIGN_SEEN.pop(k, None)
    return now - first >= OUTBOX_TAKEOVER


_INFLIGHT = set()      # id уведомлений в доставке
_INFLIGHT_CHATS = set()  # чаты, у которых уведомление в доставке (порядок внутри чата сохраняем)
_INFLIGHT_LOCK = threading.Lock()


def _outbox_deliver(item):
    key = str(item.get("id") or "")
    cid = int(item.get("chat_id") or 0)
    try:
        try:
            deliver_outbox(item)
            api(f"/bot/outbox/{item['id']}/sent", "POST", {}, timeout=4)
        except Exception as exc:
            api(f"/bot/outbox/{item['id']}/failed", "POST", {"error": str(exc)[:300]}, timeout=4)
        if OWNER:
            OWNER.forget(item.get("id"))
        with _FOREIGN_LOCK:
            _FOREIGN_SEEN.pop(key, None)
    except Exception:
        traceback.print_exc()
    finally:
        with _INFLIGHT_LOCK:
            _INFLIGHT.discard(key)
            _INFLIGHT_CHATS.discard(cid)


def outbox_loop():
    """Outbox общий с LUXON (bot=main): берём уведомления только для своих чатов.
    Доставка параллельная (пул), чтобы один медленный чат не задерживал остальных."""
    while not STOP.is_set():
        try:
            r = api(f"/bot/outbox?after_id=0&bot={OUTBOX_BOT}", timeout=4)
            items = r.get("items", []) if isinstance(r, dict) else []
            started = 0
            for item in items:
                key = str(item.get("id") or "")
                cid = int(item.get("chat_id") or 0)
                with _INFLIGHT_LOCK:
                    if key in _INFLIGHT or cid in _INFLIGHT_CHATS:
                        continue
                if not _mine(item):
                    continue
                with _INFLIGHT_LOCK:
                    _INFLIGHT.add(key)
                    _INFLIGHT_CHATS.add(cid)
                OUTBOX_POOL.submit(_outbox_deliver, item)
                started += 1
            time.sleep(0.15 if started else 0.25)
        except Exception:
            traceback.print_exc()
            time.sleep(1)


# ============================================================ диспетчер
SEEN_UPDATES = deque(maxlen=4000)
SEEN_SET = set()
SEEN_GUARD = threading.Lock()


def _seen(update_id):
    with SEEN_GUARD:
        if update_id in SEEN_SET:
            return True
        if len(SEEN_UPDATES) == SEEN_UPDATES.maxlen:
            SEEN_SET.discard(SEEN_UPDATES[0])
        SEEN_UPDATES.append(update_id)
        SEEN_SET.add(update_id)
        return False


def update_chat_id(update):
    if "callback_query" in update:
        return int((update.get("callback_query", {}).get("from") or {}).get("id") or 0)
    return int(((update.get("message") or {}).get("chat") or {}).get("id") or 0)


def process_update(u):
    pending_key = u.get("_callback_pending_key")
    try:
        if "callback_query" in u:
            q = u["callback_query"]
            cid = int(q["from"]["id"])
            data = str(q.get("data") or "")
            # ACK до chat-lock: Telegram мгновенно убирает «Загрузка…», даже если предыдущая
            # операция этого чата ещё заканчивает сетевой запрос. Для alert-кнопок ACK оставляем обработчику.
            if not q.get("_preacked") and not (data.startswith("off:") or data in ("instr", "check_sub")):
                q["_preacked"] = True
                ACK_POOL.submit(fast_ack, q)
            fn = lambda: callbacks(q)
        else:
            m = u.get("message") or {}
            cid = int((m.get("chat") or {}).get("id") or 0)
            if (m.get("chat") or {}).get("type") not in (None, "private"):
                return
            if m.get("photo"):
                fn = lambda: handle_photo(m)
            elif m.get("document") or m.get("video") or m.get("audio") or m.get("voice") or m.get("animation") \
                    or m.get("video_note") or m.get("sticker"):
                fn = lambda: handle_other_media(m)
            else:
                fn = lambda: handle_text(m)
        if not cid:
            return
        if OWNER:
            OWNER.touch("onoi", cid)
        with _chat_lock(cid):
            try:
                fn()
            except Exception:
                traceback.print_exc()
                try:
                    st, d, _ = get_state(cid)
                    panel(cid, "❌ Что-то пошло не так, попробуйте ещё раз", menu_kb(), state="idle", data=_idle_data(d))
                except Exception:
                    traceback.print_exc()
    except Exception:
        traceback.print_exc()
    finally:
        if pending_key is not None:
            with CALLBACK_PENDING_GUARD:
                CALLBACK_PENDING.discard(pending_key)
        busy_cid = u.get("_callback_busy_cid")
        if busy_cid is not None:
            with CALLBACK_CHAT_BUSY_GUARD:
                CALLBACK_CHAT_BUSY.discard(int(busy_cid))


def _drain_chat_queue(cid):
    while True:
        with CHAT_QUEUE_GUARD:
            queue = CHAT_QUEUES.get(cid)
            if not queue:
                CHAT_QUEUE_ACTIVE.discard(cid)
                CHAT_QUEUES.pop(cid, None)
                return
            update = queue.popleft()
        process_update(update)


def _callback_duplicate(cid, q):
    """True для повторного нажатия той же кнопки на том же сообщении за ~1 секунду."""
    data = str(q.get("data") or "")
    mid = int(((q.get("message") or {}).get("message_id")) or 0)
    key = (int(cid), mid, data)
    now = time.monotonic()
    with CALLBACK_RECENT_GUARD:
        prev = CALLBACK_RECENT.get(key, 0.0)
        CALLBACK_RECENT[key] = now
        # Периодическая дешёвая очистка, чтобы словарь не рос бесконечно.
        if len(CALLBACK_RECENT) > 5000:
            cutoff = now - 10.0
            for k, ts in list(CALLBACK_RECENT.items())[:2500]:
                if ts < cutoff:
                    CALLBACK_RECENT.pop(k, None)
        return prev > 0 and now - prev < CALLBACK_DEBOUNCE_SECONDS


def _callback_pending_key(cid, q):
    return (int(cid), int(((q.get("message") or {}).get("message_id")) or 0), str(q.get("data") or ""))


def dispatch_update(update):
    """FIFO на клиента + мгновенный ACK + защита от повторного запуска одной кнопки."""
    cid = update_chat_id(update)
    if not cid:
        return

    is_callback = "callback_query" in update
    if is_callback:
        q = update.get("callback_query") or {}
        data = str(q.get("data") or "")
        alert_managed = data.startswith("off:") or data in ("instr", "check_sub")
        # Every tap is acknowledged immediately, before any DB/chat-lock/backend work.
        if not alert_managed:
            q["_preacked"] = True
            ACK_POOL.submit(fast_ack, q)
        if _callback_duplicate(cid, q):
            if alert_managed:
                ACK_POOL.submit(fast_ack, q)
            return

        # Critical UX rule: never queue multiple UI transitions from frantic taps.
        # The first transition wins; every later tap is ACKed and silently discarded until it finishes.
        with CALLBACK_CHAT_BUSY_GUARD:
            if int(cid) in CALLBACK_CHAT_BUSY:
                if alert_managed:
                    ACK_POOL.submit(fast_ack, q)
                return
            CALLBACK_CHAT_BUSY.add(int(cid))
        update["_callback_busy_cid"] = int(cid)

        pending_key = _callback_pending_key(cid, q)
        with CALLBACK_PENDING_GUARD:
            if pending_key in CALLBACK_PENDING:
                with CALLBACK_CHAT_BUSY_GUARD:
                    CALLBACK_CHAT_BUSY.discard(int(cid))
                if alert_managed:
                    ACK_POOL.submit(fast_ack, q)
                return
            CALLBACK_PENDING.add(pending_key)
        update["_callback_pending_key"] = pending_key

    should_start = False
    with CHAT_QUEUE_GUARD:
        queue = CHAT_QUEUES.setdefault(cid, deque())
        # Не позволяем серии случайных тапов накопить десятки старых действий.
        if len(queue) >= MAX_CHAT_QUEUE:
            if is_callback:
                q = update.get("callback_query") or {}
                if not q.get("_preacked"):
                    ACK_POOL.submit(toast, q)
                pending_key = update.get("_callback_pending_key")
                if pending_key is not None:
                    with CALLBACK_PENDING_GUARD:
                        CALLBACK_PENDING.discard(pending_key)
                busy_cid = update.get("_callback_busy_cid")
                if busy_cid is not None:
                    with CALLBACK_CHAT_BUSY_GUARD:
                        CALLBACK_CHAT_BUSY.discard(int(busy_cid))
                return
            # Текст/контакт важнее старого callback: удаляем самый старый callback, если есть.
            for i, item in enumerate(queue):
                if "callback_query" in item:
                    del queue[i]
                    break
        queue.append(update)
        if cid not in CHAT_QUEUE_ACTIVE:
            CHAT_QUEUE_ACTIVE.add(cid)
            should_start = True
    if should_start:
        UPDATE_POOL.submit(_drain_chat_queue, cid)


def _activate_token(current):
    try:
        tg(current, "deleteWebhook", {"drop_pending_updates": False})
    except Exception:
        traceback.print_exc()
    try:
        tg(current, "setMyCommands", {"commands": [{"command": "start", "description": "Главное меню"}]})
    except Exception:
        pass
    try:
        me = tg(current, "getMe", {})
        print(f"[onoi] polling as @{(me or {}).get('username', '?')}", flush=True)
    except Exception:
        print("[onoi] polling started", flush=True)


def main():
    threading.Thread(target=outbox_loop, daemon=True, name="onoi-outbox").start()
    threading.Thread(target=_timer_loop, daemon=True, name="onoi-timers").start()
    offset = int(get_meta("telegram_offset", "0") or 0)
    stored_fingerprint = get_meta("telegram_token_fingerprint", "")
    active_token = ""
    retry_delay = 1.0

    while not STOP.is_set():
        try:
            current = token().strip()
            if not current or ":" not in current:
                time.sleep(1.0)
                continue
            fingerprint = hashlib.sha256(current.encode("utf-8")).hexdigest()[:20]
            if current != active_token:
                if fingerprint != stored_fingerprint:
                    offset = 0
                    set_meta("telegram_offset", 0)
                    set_meta("telegram_token_fingerprint", fingerprint)
                    stored_fingerprint = fingerprint
                _activate_token(current)
                active_token = current

            updates = tg(current, "getUpdates", {
                "offset": offset, "timeout": 30, "limit": 100,
                "allowed_updates": ["message", "callback_query"],
            }, timeout=38)
            retry_delay = 1.0
            for update in updates or []:
                update_id = int(update["update_id"])
                offset = update_id + 1
                set_meta("telegram_offset", offset)
                if _seen(update_id):
                    continue
                dispatch_update(update)
        except Exception:
            if STOP.is_set():
                break
            traceback.print_exc()
            time.sleep(retry_delay)
            retry_delay = min(8.0, retry_delay * 1.6)

    print("[onoi] stopping, waiting for in-flight updates…", flush=True)
    UPDATE_POOL.shutdown(wait=True, cancel_futures=False)
    ACK_POOL.shutdown(wait=False, cancel_futures=True)
    BACKGROUND_POOL.shutdown(wait=True, cancel_futures=False)


def _on_signal(signum, frame):
    STOP.set()


if __name__ == "__main__":
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _on_signal)
        except Exception:
            pass
    main()
