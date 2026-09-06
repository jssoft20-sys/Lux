"""PayGo client bot (@PayGoXBot).

UX follows the reference screenshots: a persistent reply keyboard
(Пополнить / Вывести / Помощь), inline steps for site → ID → amount → QR card,
withdrawal QR → ID → code with per-cash instruction photos, texts editable in the
admin panel. Every screen of a flow is one editable message; final results stay
in the chat; an expired request has its QR removed and replaced by the
«Пополнение отменено» notice. All state is persisted in the database, every
button press is acknowledged immediately and processed once.
"""
from __future__ import annotations

import html
import logging
import secrets
import signal
import threading
import time
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from paygo.config import get_settings
from paygo.db import transaction
from paygo.models import BotSession, Deposit, Notification, PaymentCash, QrRecord, User
from paygo.services import bot_state, bot_texts, elqr, settings_store
from paygo.services import cashes as cash_service
from paygo.services import deposits as deposit_service
from paygo.services import users as user_service
from paygo.services import withdrawals as withdrawal_service
from paygo.services.logs import log_event
from paygo.services.notifications import admin_event
from paygo.services.qr import render_pay_card
from paygo.services.qr_decode import decode_bytes
from paygo.utils import as_utc, fmt_local, money, sha256_hex, utcnow
from sqlalchemy import select

from .dispatcher import Dispatcher
from .telegram import TelegramClient, TelegramError, button, inline_keyboard, reply_keyboard, strip_button_extras
from .texts import t

logger = logging.getLogger("paygobot.main")
BOT = "main"
STOP = threading.Event()
FLOW_STATES = {"choose_cash", "choose_id", "wait_id", "wait_amount", "wait_qr_choice", "wait_qr", "wait_code", "wait_phone"}
PERSIST_KEYS = ("name", "panel_kind")
DEPOSIT_KEYS = ("request_id", "deposit_id", "deadline", "cash_id", "cash_name", "cash_emoji", "player_id", "pay_amount", "currency", "minutes", "methods", "receipt_prompt_id", "receipt_note_id")


def esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=False)


class Ctx:
    """Per-update context: chat, user snapshot, persisted state and screen helpers."""

    def __init__(self, bot: MainBot, chat_id: int, tg_user: dict[str, Any]):
        self.bot = bot
        self.client = bot.client
        self.chat_id = chat_id
        self.tg_user = tg_user or {}
        self.state = "idle"
        self.data: dict[str, Any] = {}
        self.panel_id = 0
        self.user_id = 0
        self.lang = "ru"
        self.name = ""
        self.blocked = False

    # --------------------------------------------------------- persistence
    def load(self) -> None:
        with transaction() as db:
            user = user_service.get_or_create(db, {**self.tg_user, "id": self.chat_id})
            self.user_id = user.id
            self.name = user_service.display_name(user)
            self.blocked = user.is_blocked
            self.state, self.data, self.panel_id = bot_state.get_state(db, BOT, self.chat_id)

    def save(self, state: str | None = None, data: dict[str, Any] | None = None, panel_id: int | None = None) -> None:
        if state is not None:
            self.state = state
        if data is not None:
            self.data = dict(data)
        if panel_id is not None:
            self.panel_id = panel_id
        with transaction() as db:
            bot_state.set_state(db, BOT, self.chat_id, self.state, self.data, self.panel_id)

    def T(self, key: str, **kwargs: Any) -> str:
        return t(self.lang, key, **kwargs)

    def idle_data(self) -> dict[str, Any]:
        return {k: v for k, v in self.data.items() if k in PERSIST_KEYS}

    # --------------------------------------------------------- screens
    def panel(self, text: str, markup: dict | None = None, *, photo: bytes | Path | None = None, state: str | None = None, data: dict[str, Any] | None = None, protect: bool = True, keep_previous: bool = False) -> int:
        """Show a flow screen: edit the current screen in place, or replace it when its kind changes."""
        current_kind = str(self.data.get("panel_kind") or "text")
        new_data = dict(self.data if data is None else data)
        message_id = self.panel_id
        if photo is None and message_id and current_kind == "text":
            try:
                self.bot.safe_edit(self.chat_id, message_id, text, markup)
                new_data["panel_kind"] = "text"
                self.save(state, new_data, message_id)
                return message_id
            except TelegramError as exc:
                if exc.not_modified:
                    self.save(state, new_data, message_id)
                    return message_id
                if exc.fatal_for_chat:
                    raise
        old = message_id
        if photo is not None:
            sent = self.bot.safe_send(self.chat_id, text, markup, photo=photo, protect=protect)
            new_data["panel_kind"] = "photo"
        else:
            sent = self.bot.safe_send(self.chat_id, text, markup, protect=protect)
            new_data["panel_kind"] = "text"
        new_id = int(sent.get("message_id") or 0)
        self.save(state, new_data, new_id)
        if old and old != new_id and not keep_previous:
            self.bot.delete_later(self.chat_id, old)
        return new_id

    def receipt(self, text: str, markup: dict | None = None, *, keep_data: dict[str, Any] | None = None) -> int:
        """Final result that stays in the chat; the flow screen (QR card etc.) is removed."""
        old = self.panel_id
        old_kind = str(self.data.get("panel_kind") or "text")
        prompt = int(self.data.get("receipt_prompt_id") or 0)
        note = int(self.data.get("receipt_note_id") or 0)
        sent = self.bot.safe_send(self.chat_id, text, markup, protect=True)
        data = self.idle_data()
        if keep_data:
            data.update(keep_data)
        data["panel_kind"] = "receipt"
        self.save("idle", data, 0)
        if old:
            if old_kind == "photo":
                self.bot.delete_later(self.chat_id, old)
            else:
                self.bot.strip_buttons_later(self.chat_id, old)
        for extra in (prompt, note):
            if extra:
                self.bot.delete_later(self.chat_id, extra)
        return int(sent.get("message_id") or 0)


class MainBot:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.main_bot_token:
            raise SystemExit("MAIN_BOT_TOKEN is not configured")
        self.settings = settings
        self.client = TelegramClient(settings.main_bot_token, settings.telegram_api_base)
        self.username = settings.main_bot_username
        self._locks: dict[int, threading.RLock] = {}
        self._locks_guard = threading.Lock()
        self.premium_blocked = False  # set when Telegram rejects custom emoji for this bot (no Fragment username)
        self.dispatcher = Dispatcher(self.client, self.handle_update, name="main", workers=48, offset_store=self._offset_store)

    # ------------------------------------------------------------ infra
    def chat_lock(self, chat_id: int) -> threading.RLock:
        with self._locks_guard:
            lock = self._locks.get(chat_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[chat_id] = lock
                if len(self._locks) > 20000:
                    self._locks.clear()
                    self._locks[chat_id] = lock
            return lock

    def _offset_store(self, value: int | None) -> int | None:
        with transaction() as db:
            row = db.execute(select(BotSession).where(BotSession.bot == "main:offset", BotSession.telegram_id == 0)).scalar_one_or_none()
            if value is None:
                return int((row.data or {}).get("offset") or 0) if row else 0
            if row is None:
                db.add(BotSession(bot="main:offset", telegram_id=0, state="offset", data={"offset": int(value)}))
            else:
                row.data = {"offset": int(value)}
        return value

    def delete_later(self, chat_id: int, message_id: int) -> None:
        threading.Thread(target=self.client.delete_message, args=(chat_id, message_id), daemon=True).start()

    def strip_buttons_later(self, chat_id: int, message_id: int) -> None:
        def _run():
            try:
                self.client.edit_markup(chat_id, message_id, None)
            except TelegramError:
                pass

        threading.Thread(target=_run, daemon=True).start()

    def local_file(self, rel: str) -> Path | None:
        """Photo stored by the admin panel (relative to DATA_DIR)."""
        rel = str(rel or "").strip().lstrip("/")
        if not rel:
            return None
        path = Path(self.settings.data_dir) / rel
        return path if path.exists() else None

    # ------------------------------------------------------------ sending with graceful fallback
    def safe_send(self, chat_id: int, text: str, markup: dict | None = None, *, photo: bytes | Path | None = None, protect: bool = True) -> dict[str, Any]:
        """HTML + button icons/styles first; on a markup rejection resend plain text and plain buttons."""
        try:
            if photo is not None:
                return self.client.send_photo(chat_id, photo, caption=text, markup=markup, protect=protect, parse_mode="HTML")
            return self.client.send_message(chat_id, text, markup=markup, protect=protect, parse_mode="HTML")
        except TelegramError as exc:
            if not exc.parse_error:
                raise
            logger.info("markup rejected (%s) — sending plain", exc.description)
            if "custom emoji" in exc.description.lower() or "custom_emoji" in exc.description.lower():
                self.premium_blocked = True
            plain, plain_markup = bot_texts.strip_html(text), strip_button_extras(markup)
            if photo is not None:
                return self.client.send_photo(chat_id, photo, caption=plain, markup=plain_markup, protect=protect)
            return self.client.send_message(chat_id, plain, markup=plain_markup, protect=protect)

    def safe_edit(self, chat_id: int, message_id: int, text: str, markup: dict | None = None) -> Any:
        try:
            return self.client.edit_text(chat_id, message_id, text, markup=markup, parse_mode="HTML")
        except TelegramError as exc:
            if not exc.parse_error:
                raise
            return self.client.edit_text(chat_id, message_id, bot_texts.strip_html(text), markup=strip_button_extras(markup))

    def safe_edit_caption(self, chat_id: int, message_id: int, caption: str, markup: dict | None = None) -> Any:
        try:
            return self.client.edit_caption(chat_id, message_id, caption, markup=markup, parse_mode="HTML")
        except TelegramError as exc:
            if not exc.parse_error:
                raise
            return self.client.edit_caption(chat_id, message_id, bot_texts.strip_html(caption), markup=strip_button_extras(markup))

    # ------------------------------------------------------------ keyboards & texts
    def menu_kb(self) -> dict:
        with transaction() as db:
            labels = bot_texts.menu_labels(db)
            styled = settings_store.get_bool(db, "button_styles_enabled", True)
        return reply_keyboard(
            [button(labels["deposit"], style="primary" if styled else ""), button(labels["withdraw"], style="primary" if styled else "")],
            [button(labels["help"])],
        )

    def text(self, key: str, **values: Any) -> str:
        with transaction() as db:
            return bot_texts.render(db, key, **values)

    def greeting(self, ctx: Ctx, note: str = "") -> str:
        text = self.text("greeting_text", name=ctx.name or "друг")
        return text + ("\n\n" + note if note else "")

    def site_button(self, cash: dict[str, Any], premium: bool) -> dict[str, Any]:
        label = f"{cash.get('emoji') or ''} {cash['name']}".strip()
        icon = str(cash.get("custom_emoji_id") or "") if premium else ""
        return button(label, f"cash:{cash['id']}", icon=icon)

    # ------------------------------------------------------------ update entry
    def handle_update(self, update: dict[str, Any]) -> None:
        chat_id = Dispatcher.chat_id_of(update)
        with self.chat_lock(chat_id):
            if "callback_query" in update:
                self._safe(self.on_callback, update["callback_query"])
            elif "message" in update:
                self._safe(self.on_message, update["message"])

    def _safe(self, fn, payload: dict[str, Any]) -> None:
        try:
            fn(payload)
        except TelegramError as exc:
            if exc.fatal_for_chat:
                logger.info("chat unavailable: %s", exc)
                return
            logger.warning("telegram error: %s", exc)
        except Exception:
            logger.exception("handler failed")
            try:
                chat_id = int(((payload.get("message") or payload).get("chat") or {}).get("id") or (payload.get("from") or {}).get("id") or 0)
                ctx = Ctx(self, chat_id, payload.get("from") or {})
                ctx.load()
                ctx.panel(ctx.T("error_generic"), None, state="idle", data=ctx.idle_data())
            except Exception:
                pass

    # ------------------------------------------------------------ messages
    def on_message(self, message: dict[str, Any]) -> None:
        chat_id = int(message["chat"]["id"])
        ctx = Ctx(self, chat_id, message.get("from") or {})
        ctx.load()
        text = str(message.get("text") or message.get("caption") or "").strip()
        message_id = int(message.get("message_id") or 0)
        if text.startswith("/start"):
            parts = text.split(maxsplit=1)
            self.start(ctx, parts[1] if len(parts) > 1 else "")
            return
        if message.get("contact"):
            self.on_contact(ctx, message)
            return
        with transaction() as db:
            action = bot_texts.match_menu(db, text) if text else ""
        if action:
            self.delete_later(chat_id, message_id)
            if action == "help":
                self.show_help(ctx)
            else:
                self.begin(ctx, action)
            return
        if message.get("photo"):
            self.on_photo(ctx, message)
            return
        if ctx.state in FLOW_STATES:
            self.delete_later(chat_id, message_id)
        if text.startswith("/"):
            command = text.split()[0].lower().split("@")[0]
            if command == "/help":
                self.show_help(ctx)
            else:
                self.show_menu(ctx)
            return
        if not text:
            if ctx.state == "wait_qr":
                ctx.panel(self.text("text_send_qr") + "\n\n❌ " + ctx.T("qr_photo_only"), self.cancel_kb(ctx))
            return
        handlers = {
            "choose_id": self.on_id,
            "wait_id": self.on_id,
            "wait_amount": self.on_amount,
            "wait_code": self.on_code,
        }
        handler = handlers.get(ctx.state)
        if handler:
            handler(ctx, text)
        elif ctx.state == "wait_qr":
            ctx.panel(self.text("text_send_qr") + "\n\n❌ " + ctx.T("qr_photo_only"), self.cancel_kb(ctx))
        elif ctx.state == "wait_payment":
            self.delete_later(chat_id, message_id)  # the card stays; stray text is removed
        else:
            self.show_menu(ctx)

    # ------------------------------------------------------------ callbacks
    def on_callback(self, query: dict[str, Any]) -> None:
        chat_id = int(((query.get("message") or {}).get("chat") or {}).get("id") or query["from"]["id"])
        ctx = Ctx(self, chat_id, query.get("from") or {})
        ctx.load()
        data = str(query.get("data") or "")
        pressed = int(((query.get("message") or {}).get("message_id")) or 0)
        callback_id = str(query.get("id") or "")
        if pressed and ctx.panel_id and pressed != ctx.panel_id and not data.startswith(("noop", "instr", "menu", "act:", "open_active", "help")):
            self.strip_buttons_later(chat_id, pressed)  # button on an old screen
            return
        if data == "noop":
            return
        if data == "instr":
            self.show_instruction(ctx, callback_id)
            return
        if data == "check_sub":
            if self.subscribed(ctx):
                self.show_menu(ctx)
            else:
                self.client.answer_callback(callback_id, ctx.T("not_subscribed"), alert=True)
            return
        if data.startswith("act:"):
            self.begin(ctx, data.split(":", 1)[1])
        elif data == "menu" or data == "cancel":
            self.cancel_flow(ctx)
        elif data.startswith("cancel:"):
            self.cancel_deposit(ctx, data.split(":", 1)[1])
        elif data.startswith("cash:"):
            if ctx.state == "choose_cash":
                self.choose_cash(ctx, int(data.split(":", 1)[1]))
        elif data.startswith("id:"):
            if ctx.state in {"choose_id", "wait_id"}:
                self.on_id(ctx, data.split(":", 1)[1])
        elif data.startswith("amt:"):
            if ctx.state == "wait_amount":
                self.on_amount(ctx, data.split(":", 1)[1])
        elif data == "qr:last":
            if ctx.state == "wait_qr_choice":
                self.use_last_qr(ctx)
        elif data == "qr:new":
            if ctx.state == "wait_qr_choice":
                ctx.panel(self.text("text_send_qr"), self.cancel_kb(ctx), state="wait_qr")
        elif data == "open_active":
            self.show_active_deposit(ctx)
        elif data == "help":
            self.show_help(ctx)
        elif data == "back_code":
            if ctx.state == "wait_code":
                self.ask_code(ctx, ctx.data)
        else:
            logger.debug("unknown callback %s", data)

    # ------------------------------------------------------------ start / menu / help
    def start(self, ctx: Ctx, arg: str = "") -> None:
        note = ""
        if arg.startswith("ref_"):
            with transaction() as db:
                user = db.get(User, ctx.user_id)
                status = user_service.bind_referral(db, user, arg[4:])
            if status == "ok":
                note = "🎁 Вы присоединились по приглашению"
        if not self.subscribed(ctx):
            self.show_subscribe(ctx)
            return
        with transaction() as db:
            if settings_store.get_bool(db, "phone_required") and not db.get(User, ctx.user_id).phone_verified_at:
                self.request_phone(ctx)
                return
        self.show_menu(ctx, note)

    def show_menu(self, ctx: Ctx, note: str = "") -> None:
        """Greeting + persistent reply keyboard. An active payment card stays on screen."""
        active = self.active_deposit_id(ctx)
        old, old_kind = ctx.panel_id, str(ctx.data.get("panel_kind") or "text")
        self.send_greeting_sticker(ctx)
        self.safe_send(ctx.chat_id, self.greeting(ctx, note), self.menu_kb(), protect=True)
        if active:
            data = {**ctx.idle_data(), **{k: ctx.data[k] for k in DEPOSIT_KEYS if k in ctx.data}}
            data["panel_kind"] = old_kind
            ctx.save("wait_payment", data, old)
            return
        ctx.save("idle", ctx.idle_data(), 0)
        if old and old_kind != "receipt":
            self.delete_later(ctx.chat_id, old)

    def send_greeting_sticker(self, ctx: Ctx) -> None:
        """One big premium emoji before the greeting (only when the bot may use custom emoji)."""
        with transaction() as db:
            premium = settings_store.get_bool(db, "premium_emoji_enabled")
            token = str(settings_store.get(db, "greeting_sticker") or "").strip()
        if not premium or not token or self.premium_blocked:
            return
        text = bot_texts.render_template(token, premium=True)
        if "<tg-emoji" not in text:
            return
        try:
            self.client.send_message(ctx.chat_id, text, parse_mode="HTML")
        except TelegramError as exc:
            if exc.parse_error:
                self.premium_blocked = True
                logger.warning("premium emoji are not available for this bot: %s", exc.description)
            elif exc.fatal_for_chat:
                raise

    def show_help(self, ctx: Ctx) -> None:
        """«Помощь» = только контакт оператора (как в образце)."""
        self.safe_send(ctx.chat_id, self.text("text_help"), None, protect=False)

    def cancel_flow(self, ctx: Ctx) -> None:
        if ctx.state == "wait_payment":
            self.show_active_deposit(ctx)
            return
        self.show_menu(ctx)

    def cancel_kb(self, ctx: Ctx) -> dict:
        return inline_keyboard([button(ctx.T("cancel"), "cancel")])

    def active_deposit_id(self, ctx: Ctx) -> int:
        deposit_id = int(ctx.data.get("deposit_id") or 0)
        if not deposit_id:
            return 0
        with transaction() as db:
            deposit = db.get(Deposit, deposit_id)
            return deposit.id if deposit and deposit.status == "created" else 0

    def subscribed(self, ctx: Ctx) -> bool:
        with transaction() as db:
            enabled = settings_store.get_bool(db, "subscription_enabled")
            channel = str(settings_store.get(db, "subscription_channel") or "")
        if not enabled or not channel:
            return True
        try:
            member = self.client.call("getChatMember", {"chat_id": channel, "user_id": ctx.chat_id}, retries=0, timeout=8)
            return str((member or {}).get("status")) in {"member", "administrator", "creator"}
        except TelegramError:
            return True

    def show_subscribe(self, ctx: Ctx) -> None:
        with transaction() as db:
            channel = str(settings_store.get(db, "subscription_channel") or "")
        url = f"https://t.me/{channel.lstrip('@')}" if channel.startswith("@") else ""
        rows = []
        if url:
            rows.append([button("📢 " + channel, url=url)])
        rows.append([button(ctx.T("check"), "check_sub")])
        ctx.panel(ctx.T("subscribe"), inline_keyboard(*rows), state="idle", data=ctx.idle_data())

    def request_phone(self, ctx: Ctx) -> None:
        sent = self.client.call("sendMessage", {"chat_id": ctx.chat_id, "text": "📱 Подтвердите номер телефона кнопкой ниже", "reply_markup": {"keyboard": [[{"text": "Подтвердить номер", "request_contact": True}]], "resize_keyboard": True, "one_time_keyboard": True}})
        ctx.save("wait_phone", ctx.idle_data(), int(sent.get("message_id") or 0))

    def on_contact(self, ctx: Ctx, message: dict[str, Any]) -> None:
        contact = message.get("contact") or {}
        if int(contact.get("user_id") or 0) != ctx.chat_id:
            self.client.send_message(ctx.chat_id, "❌ Отправьте именно свой контакт")
            return
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            user.phone = str(contact.get("phone_number") or "")[:32]
            user.phone_verified_at = utcnow()
        self.delete_later(ctx.chat_id, int(message.get("message_id") or 0))
        self.start(ctx)

    # ------------------------------------------------------------ deposit / withdraw common
    def enabled_cashes(self, action: str) -> list[dict[str, Any]]:
        with transaction() as db:
            rows = cash_service.list_cashes(db, enabled_only=True)
            out = []
            for cash in rows:
                reason = cash_service.deposit_available(db, cash) if action == "deposit" else cash_service.withdraw_available(db, cash)
                out.append({"id": cash.id, "key": cash.key, "name": cash.name, "emoji": cash.emoji, "custom_emoji_id": cash.custom_emoji_id, "emoji_token": bot_texts.cash_emoji(cash), "currency": cash.currency, "reason": reason})
            return out

    def begin(self, ctx: Ctx, action: str) -> None:
        if action not in {"deposit", "withdraw"}:
            return
        with transaction() as db:
            paused = settings_store.get_bool(db, "bot_paused")
            premium = settings_store.get_bool(db, "premium_emoji_enabled")
        if paused:
            self.client.send_message(ctx.chat_id, bot_texts.strip_html(self.text("text_paused")))
            return
        if ctx.blocked:
            self.safe_send(ctx.chat_id, self.text("text_blocked"), None)
            return
        if action == "deposit" and self.active_deposit_id(ctx):
            self.show_active_deposit(ctx)
            return
        all_cashes = self.enabled_cashes(action)
        cashes = [c for c in all_cashes if not c["reason"]]
        if not cashes:
            reason = all_cashes[0]["reason"] if all_cashes else ctx.T("cashes_unavailable")
            ctx.panel("❌ " + esc(reason), None, state="idle", data=ctx.idle_data())
            return
        data = {**ctx.idle_data(), "action": action, "nonce": secrets.token_hex(6)}
        if len(cashes) == 1:
            ctx.data = data
            ctx.state = "choose_cash"
            self.choose_cash(ctx, cashes[0]["id"])
            return
        rows = [[self.site_button(c, premium)] for c in cashes]
        rows.append([button(ctx.T("cancel"), "cancel")])
        ctx.panel(self.text("text_choose_site_deposit" if action == "deposit" else "text_choose_site_withdraw"), inline_keyboard(*rows), state="choose_cash", data=data)

    def _cash_info(self, cash: PaymentCash) -> dict[str, Any]:
        return {
            "cash_id": cash.id, "cash_key": cash.key, "cash_name": cash.name, "cash_emoji": bot_texts.cash_emoji(cash), "currency": cash.currency,
            "dep_min": str(money(cash.deposit_min)), "dep_max": str(money(cash.deposit_max)),
            "deposit_photo": cash.deposit_photo, "deposit_photo_text": cash.deposit_photo_text,
            "withdraw_photo": cash.withdraw_photo, "withdraw_photo_text": cash.withdraw_photo_text,
            "code_photo": cash.code_photo, "code_photo_text": cash.code_photo_text,
        }

    def choose_cash(self, ctx: Ctx, cash_id: int) -> None:
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if cash is None or not cash.enabled:
                self.show_menu(ctx)
                return
            info = self._cash_info(cash)
        data = {**ctx.data, **info}
        if data.get("action") == "deposit":
            self.ask_id(ctx, data)
        else:
            self.ask_qr(ctx, data)

    def _step_text(self, data: dict[str, Any], custom_key: str, setting_key: str, **values: Any) -> str:
        custom = str(data.get(custom_key) or "").strip()
        with transaction() as db:
            if custom:
                return bot_texts.render_template(custom, premium=settings_store.get_bool(db, "premium_emoji_enabled"), **{**bot_texts.common_values(db), **values})
            return bot_texts.render(db, setting_key, **values)

    def ask_id(self, ctx: Ctx, data: dict[str, Any], saved: list[tuple[str, str]] | None = None, error: str = "") -> None:
        if saved is None:
            with transaction() as db:
                user = db.get(User, ctx.user_id)
                cash = db.get(PaymentCash, int(data["cash_id"]))
                saved = [(s.player_id, s.player_name) for s in user_service.saved_ids(db, user, cash)]
        deposit = data.get("action") == "deposit"
        rows = [[button(f"🆔 {pid}" + (f" · {name[:18]}" if name else ""), f"id:{pid}")] for pid, name in saved[:5]]
        rows.append([button(ctx.T("cancel"), "cancel")])
        values = {"cash": data.get("cash_name", ""), "emoji": data.get("cash_emoji", "")}
        text = self._step_text(data, "deposit_photo_text" if deposit else "withdraw_photo_text", "text_enter_id_deposit" if deposit else "text_enter_id_withdraw", **values)
        if saved:
            text += "\n\nВыберите сохранённый ID или введите новый"
        if error:
            text += "\n\n❌ " + esc(error)
        photo = self.local_file(str(data.get("deposit_photo" if deposit else "withdraw_photo") or ""))
        ctx.panel(text, inline_keyboard(*rows), photo=photo if str(ctx.data.get("panel_kind")) != "photo" or error == "" else None, state="choose_id" if saved else "wait_id", data=data)

    def on_id(self, ctx: Ctx, text: str) -> None:
        pid = "".join(ch for ch in str(text) if ch.isdigit())
        if not pid or len(pid) > 20:
            self.ask_id(ctx, ctx.data, error=ctx.T("id_digits"))
            return
        cash_id = int(ctx.data.get("cash_id") or 0)
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if cash is None:
                self.show_menu(ctx)
                return
            adapter = cash_service.adapter(cash)
        if str(ctx.data.get("panel_kind")) != "photo":
            ctx.panel(ctx.T("checking_id"), self.cancel_kb(ctx))
        try:
            result = adapter.lookup_player(pid)
        except Exception as exc:
            logger.warning("lookup failed: %s", exc)
            result = None
        if result is None or (not result.ok and (result.extra or {}).get("code") != "PLAYER_NOT_FOUND" and result.status == 599):
            self.ask_id(ctx, ctx.data, error=ctx.T("id_check_failed"))
            return
        if not result.ok:
            with transaction() as db:
                user_service.forget_player_id(db, db.get(User, ctx.user_id), db.get(PaymentCash, cash_id), pid)
            self.ask_id(ctx, ctx.data, error=result.message or bot_texts.strip_html(self.text("text_id_not_found")))
            return
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if not cash_service.currency_matches(cash, result.currency):
                self.ask_id(ctx, {**ctx.data, "player_id": ""}, error=bot_texts.strip_html(self.text("text_currency_mismatch", have=result.currency or "?", need=cash.currency)))
                return
            user_service.remember_player_id(db, db.get(User, ctx.user_id), cash, pid, result.player_name, result.currency)
        data = {**ctx.data, "player_id": pid, "player_name": result.player_name or "", "player_currency": result.currency or ""}
        if data.get("action") == "deposit":
            self.ask_amount(ctx, data)
        else:
            self.ask_code(ctx, data)

    # ------------------------------------------------------------ deposit
    def amount_kb(self, ctx: Ctx, data: dict[str, Any]) -> dict:
        low, high = Decimal(str(data.get("dep_min") or 100)), Decimal(str(data.get("dep_max") or 100000))
        with transaction() as db:
            raw = str(settings_store.get(db, "deposit_presets") or "")
        presets = []
        for part in raw.replace(";", ",").split(","):
            part = part.strip()
            if part.isdigit() and low <= int(part) <= high:
                presets.append(int(part))
        rows = []
        for i in range(0, len(presets[:6]), 3):
            rows.append([button(f"{x:,}".replace(",", " "), f"amt:{x}") for x in presets[i : i + 3]])
        rows.append([button(ctx.T("cancel"), "cancel")])
        return inline_keyboard(*rows)

    def ask_amount(self, ctx: Ctx, data: dict[str, Any], error: str = "") -> None:
        low = Decimal(str(data.get("dep_min") or 0)).quantize(Decimal(1))
        high = Decimal(str(data.get("dep_max") or 0)).quantize(Decimal(1))
        text = self.text("text_enter_amount", min=f"{low:,}".replace(",", " "), max=f"{high:,}".replace(",", " "), cur=data.get("currency", "KGS"), cash=data.get("cash_name", ""), emoji=data.get("cash_emoji", ""), player=data.get("player_id", ""))
        if error:
            text += "\n\n❌ " + esc(error)
        ctx.panel(text, self.amount_kb(ctx, data), state="wait_amount", data=data)

    def on_amount(self, ctx: Ctx, text: str) -> None:
        raw = str(text).replace(" ", "").replace(",", ".")
        try:
            amount = money(raw)
        except Exception:
            self.ask_amount(ctx, ctx.data, error=ctx.T("amount_digits"))
            return
        if amount != amount.to_integral_value():
            self.ask_amount(ctx, ctx.data, error=ctx.T("amount_digits"))
            return
        ctx.panel(ctx.T("creating"), None)
        nonce = str(ctx.data.get("nonce") or secrets.token_hex(6))
        key = sha256_hex(f"deposit:{ctx.chat_id}:{nonce}:{ctx.data.get('cash_id')}:{ctx.data.get('player_id')}:{amount}")[:96]
        try:
            with transaction() as db:
                user = db.get(User, ctx.user_id)
                cash = db.get(PaymentCash, int(ctx.data["cash_id"]))
                deposit, _created = deposit_service.create_deposit(db, user=user, cash=cash, player_id=str(ctx.data["player_id"]), amount=amount, idempotency_key=key, player_name=str(ctx.data.get("player_name") or ""))
                info = self._deposit_info(db, deposit)
        except deposit_service.DepositError as exc:
            if exc.code == "AMOUNT_LIMITS":
                self.ask_amount(ctx, ctx.data, error=exc.message)
            elif exc.code == "ACTIVE_EXISTS":
                self.show_active_deposit(ctx)
            else:
                ctx.panel("❌ " + esc(exc.message), None, state="idle", data=ctx.idle_data())
            return
        self.show_deposit_card(ctx, info, fresh=True)
        self.send_receipt_prompt(ctx)

    def _deposit_info(self, db, deposit: Deposit) -> dict[str, Any]:
        created, expires = as_utc(deposit.created_at), as_utc(deposit.expires_at)
        minutes = max(1, int(round(((expires - created).total_seconds() if created and expires else settings_store.get_int(db, "payment_timeout_seconds", 300)) / 60)))
        return {
            "deposit_id": deposit.id,
            "request_id": deposit.public_id,
            "pay_amount": str(money(deposit.pay_amount)),
            "currency": deposit.currency,
            "player_id": deposit.player_id,
            "cash_id": deposit.cash_id,
            "cash_name": deposit.cash.name if deposit.cash else "",
            "cash_emoji": bot_texts.cash_emoji(deposit.cash) if deposit.cash else "",
            "deadline": expires.timestamp() if expires else time.time() + 300,
            "minutes": minutes,
            "qr_payload": deposit.qr_payload,
            "methods": deposit_service.payment_methods(db, deposit),
            "qr_enabled": deposit_service.qr_enabled(db),
            "status": deposit.status,
        }

    def _left(self, deadline: float) -> str:
        left = max(0, int(float(deadline) - time.time()))
        return f"{left // 60}:{left % 60:02d}"

    def card_text(self, ctx: Ctx, info: dict[str, Any]) -> str:
        return self.text("text_pay_card", player=info.get("player_id"), cash=info.get("cash_name"), emoji=info.get("cash_emoji"), amount=info.get("pay_amount"), cur=info.get("currency"), minutes=info.get("minutes") or 5, left=self._left(info.get("deadline") or 0))

    def card_kb(self, ctx: Ctx, info: dict[str, Any]) -> dict:
        rows = []
        methods = list(info.get("methods") or [])
        with transaction() as db:
            premium = settings_store.get_bool(db, "premium_emoji_enabled")
        for i in range(0, len(methods), 2):
            rows.append([button((m.get("emoji") + " " if m.get("emoji") and not (premium and m.get("custom_emoji_id")) else "") + m["name"] + " ↗", url=m["url"], icon=str(m.get("custom_emoji_id") or "") if premium else "") for m in methods[i : i + 2]])
        rows.append([button(ctx.T("cancel_deposit"), f"cancel:{info.get('request_id')}")])
        return inline_keyboard(*rows)

    def card_photo(self, payload: str) -> bytes | None:
        with transaction() as db:
            opts = {k: str(settings_store.get(db, "qr_" + k) or "") for k in ("card_title", "card_subtitle", "overlay_text", "watermark_text")}
        try:
            return render_pay_card(elqr.qr_image_value(payload), title=opts["card_title"], subtitle=opts["card_subtitle"], overlay=opts["overlay_text"], watermark=opts["watermark_text"])
        except Exception as exc:
            logger.warning("qr render failed: %s", exc)
            return None

    def show_deposit_card(self, ctx: Ctx, info: dict[str, Any], fresh: bool = False) -> None:
        data = {**ctx.idle_data(), **{k: info[k] for k in ("deposit_id", "request_id", "pay_amount", "currency", "player_id", "cash_id", "cash_name", "cash_emoji", "deadline", "minutes")}, "methods": info.get("methods") or [], "action": "deposit"}
        if not fresh and ctx.data.get("receipt_prompt_id"):
            data["receipt_prompt_id"] = ctx.data["receipt_prompt_id"]
        photo = self.card_photo(info["qr_payload"]) if info.get("qr_enabled") and info.get("qr_payload") else None
        ctx.panel(self.card_text(ctx, info), self.card_kb(ctx, info), photo=photo, state="wait_payment", data=data, protect=False)

    def send_receipt_prompt(self, ctx: Ctx) -> None:
        with transaction() as db:
            enabled = settings_store.get_bool(db, "receipt_request_enabled", True)
        if not enabled or ctx.state != "wait_payment":
            return
        try:
            sent = self.safe_send(ctx.chat_id, self.text("text_send_receipt"), None, protect=False)
        except TelegramError as exc:
            logger.info("receipt prompt failed: %s", exc)
            return
        ctx.save(data={**ctx.data, "receipt_prompt_id": int(sent.get("message_id") or 0)})

    def show_active_deposit(self, ctx: Ctx) -> None:
        deposit_id = int(ctx.data.get("deposit_id") or 0)
        if not deposit_id:
            self.show_menu(ctx)
            return
        with transaction() as db:
            deposit = db.get(Deposit, deposit_id)
            if deposit is None or deposit.status != "created":
                ctx.data = ctx.idle_data()
                self.show_menu(ctx)
                return
            info = self._deposit_info(db, deposit)
        self.show_deposit_card(ctx, info)

    def cancel_deposit(self, ctx: Ctx, public_id: str) -> None:
        with transaction() as db:
            deposit = db.execute(select(Deposit).where(Deposit.public_id == public_id, Deposit.user_id == ctx.user_id)).scalar_one_or_none()
            if deposit and deposit.status == "created":
                deposit_service.cancel_deposit(db, deposit, reason="user_cancelled", actor="user")
        ctx.receipt(self.text("text_deposit_cancelled"))
        self.show_menu(ctx)

    def save_receipt(self, ctx: Ctx, message: dict[str, Any]) -> None:
        """Client sent a payment screenshot for the active request."""
        deposit_id = int(ctx.data.get("deposit_id") or 0)
        photos = message.get("photo") or []
        file_id = str(photos[-1].get("file_id") or "") if photos else ""
        if not deposit_id or not file_id:
            return
        rel = ""
        try:
            url = self.client.get_file_url(file_id)
            raw = self.client.download(url) if url else b""
            if raw:
                folder = Path(self.settings.data_dir) / "uploads" / "receipts"
                folder.mkdir(parents=True, exist_ok=True)
                name = f"{ctx.data.get('request_id') or deposit_id}-{sha256_hex(raw)[:10]}.jpg"
                (folder / name).write_bytes(raw)
                rel = f"uploads/receipts/{name}"
        except Exception as exc:
            logger.info("receipt download failed: %s", exc)
        with transaction() as db:
            deposit = db.get(Deposit, deposit_id)
            if deposit is None:
                return
            deposit.receipt_file = rel or deposit.receipt_file or f"tg:{file_id}"
            deposit.receipt_at = utcnow()
            log_event(db, "Клиент прислал чек", f"{deposit.public_id} • {money(deposit.pay_amount)} {deposit.currency}", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
            admin_event(db, "deposit_receipt", f"deposit_receipt:{deposit.id}:{int(time.time())}", "🧾 Чек к пополнению", f"{deposit.public_id} • {money(deposit.pay_amount)} {deposit.currency} • ID {deposit.player_id} • {ctx.name}", {"deposit_id": deposit.id, "url": f"#/deposits/{deposit.id}"})
        prompt = int(ctx.data.get("receipt_prompt_id") or 0)
        if prompt:
            self.delete_later(ctx.chat_id, prompt)
        old_note = int(ctx.data.get("receipt_note_id") or 0)
        if old_note:
            self.delete_later(ctx.chat_id, old_note)
        sent = self.safe_send(ctx.chat_id, self.text("text_receipt_ok"), None, protect=False)
        ctx.save(data={**ctx.data, "receipt_prompt_id": 0, "receipt_note_id": int(sent.get("message_id") or 0)})

    def tick_timers(self) -> None:
        """Refresh the countdown on active payment cards when the template shows one ({left})."""
        with transaction() as db:
            template = str(settings_store.get(db, "text_pay_card") or "")
            if "{left}" not in template:
                return
            rows = db.execute(select(BotSession).where(BotSession.bot == BOT, BotSession.state == "wait_payment")).scalars().all()
            items = [(r.telegram_id, dict(r.data or {}), int(r.panel_message_id or 0)) for r in rows]
        now = time.time()
        for chat_id, data, panel_id in items:
            deadline = float(data.get("deadline") or 0)
            if not panel_id or not deadline or deadline < now - 5 or str(data.get("panel_kind")) != "photo":
                continue
            if now - float(data.get("timer_at") or 0) < 30:
                continue
            with self.chat_lock(chat_id):
                ctx = Ctx(self, chat_id, {"id": chat_id})
                try:
                    ctx.load()
                except Exception:
                    continue
                if ctx.state != "wait_payment" or ctx.panel_id != panel_id:
                    continue
                info = {**ctx.data}
                try:
                    self.safe_edit_caption(chat_id, panel_id, self.card_text(ctx, info), self.card_kb(ctx, info))
                except TelegramError as exc:
                    if exc.fatal_for_chat or exc.cant_edit:
                        ctx.save(data={**ctx.data, "timer_at": now + 3600})
                        continue
                ctx.save(data={**ctx.data, "timer_at": now})

    # ------------------------------------------------------------ withdrawal
    def ask_qr(self, ctx: Ctx, data: dict[str, Any]) -> None:
        with transaction() as db:
            qr = user_service.last_qr(db, db.get(User, ctx.user_id))
            last = {"id": qr.id, "bank": qr.bank_name, "at": fmt_local(qr.last_used_at)} if qr else None
        if last:
            text = self.text("text_send_qr") + f"\n\n🗺 {esc(ctx.T('use_last_qr_q'))}\n{esc(last['bank'] or 'QR банка')} · {esc(last['at'])}"
            ctx.panel(text, inline_keyboard([button(ctx.T("use_last_qr"), "qr:last")], [button(ctx.T("new_qr"), "qr:new")], [button(ctx.T("cancel"), "cancel")]), state="wait_qr_choice", data={**data, "last_qr_id": last["id"]})
        else:
            ctx.panel(self.text("text_send_qr"), self.cancel_kb(ctx), state="wait_qr", data=data)

    def use_last_qr(self, ctx: Ctx) -> None:
        qr_id = int(ctx.data.get("last_qr_id") or 0)
        with transaction() as db:
            qr = db.get(QrRecord, qr_id)
            if qr is None or qr.user_id != ctx.user_id:
                ctx.panel(self.text("text_send_qr"), self.cancel_kb(ctx), state="wait_qr")
                return
            data = {**ctx.data, "qr_record_id": qr.id, "qr_file_url": qr.file_url}
        self.ask_id(ctx, data)

    def on_photo(self, ctx: Ctx, message: dict[str, Any]) -> None:
        message_id = int(message.get("message_id") or 0)
        if ctx.state == "wait_payment":
            self.save_receipt(ctx, message)
            self.delete_later(ctx.chat_id, message_id)
            return
        if ctx.state != "wait_qr":
            return
        photos = message.get("photo") or []
        file_id = str(photos[-1].get("file_id") or "") if photos else ""
        if not file_id:
            return
        try:
            url = self.client.get_file_url(file_id)
        except TelegramError:
            url = ""
        payload, bank = "", ""
        if url:
            try:
                raw = self.client.download(url)
                decoded = decode_bytes(raw)
                if decoded:
                    meta = elqr.bank_meta(decoded)
                    payload, bank = meta["payload"], meta["bank_name"]
            except Exception as exc:
                logger.info("qr decode skipped: %s", exc)
        with transaction() as db:
            qr = user_service.save_qr(db, db.get(User, ctx.user_id), file_id=file_id, file_url=url, payload=payload, bank_name=bank)
            qr_id, qr_url = qr.id, qr.file_url
        self.delete_later(ctx.chat_id, message_id)  # the chat keeps only the current step
        self.ask_id(ctx, {**ctx.data, "qr_record_id": qr_id, "qr_file_url": qr_url})

    def ask_code(self, ctx: Ctx, data: dict[str, Any], error: str = "") -> None:
        text = self._step_text(data, "code_photo_text", "text_enter_code", cash=data.get("cash_name", ""), emoji=data.get("cash_emoji", ""), player=data.get("player_id", ""))
        if error:
            text += "\n\n" + error
        with transaction() as db:
            global_photo = str(settings_store.get(db, "instruction_photo") or "")
        photo = self.local_file(str(data.get("code_photo") or "")) or self.local_file(global_photo)
        markup = inline_keyboard([button(ctx.T("instruction"), "instr")], [button(ctx.T("cancel"), "cancel")])
        ctx.panel(text, markup, photo=photo if str(ctx.data.get("panel_kind")) != "photo" or not error else None, state="wait_code", data=data)

    def show_instruction(self, ctx: Ctx, callback_id: str) -> None:
        with transaction() as db:
            cash = db.get(PaymentCash, int(ctx.data.get("cash_id") or 0)) if ctx.data.get("cash_id") else None
            text = bot_texts.instruction(db, cash)
            global_photo = str(settings_store.get(db, "instruction_photo") or "")
        if ctx.state == "wait_code":
            plain = bot_texts.strip_html(text)
            if len(plain) <= 190:
                self.client.answer_callback(callback_id, plain, alert=True)
            else:
                ctx.panel(text, inline_keyboard([button(ctx.T("back"), "back_code")]), state="wait_code")
            return
        photo = self.local_file(global_photo)
        self.safe_send(ctx.chat_id, text, None, photo=photo, protect=False)

    def on_code(self, ctx: Ctx, text: str) -> None:
        code = str(text).strip()
        if len(code) < 3:
            self.ask_code(ctx, ctx.data, error="❌ " + ctx.T("code_short"))
            return
        if str(ctx.data.get("panel_kind")) != "photo":
            ctx.panel(ctx.T("checking_code"), None)
        nonce = str(ctx.data.get("nonce") or secrets.token_hex(6))
        key = sha256_hex(f"withdraw:{ctx.chat_id}:{nonce}:{ctx.data.get('cash_id')}:{ctx.data.get('player_id')}:{code}")[:96]
        try:
            result = withdrawal_service.create_withdrawal(
                user_id=ctx.user_id,
                cash_id=int(ctx.data["cash_id"]),
                player_id=str(ctx.data.get("player_id")),
                code=code,
                idempotency_key=key,
                qr_record_id=int(ctx.data.get("qr_record_id") or 0) or None,
                qr_file_url=str(ctx.data.get("qr_file_url") or ""),
                player_name=str(ctx.data.get("player_name") or ""),
            )
        except withdrawal_service.WithdrawalError as exc:
            if exc.code in {"BAD_CODE", "BAD_PLAYER_ID"}:
                self.ask_code(ctx, ctx.data, error=self.text("text_bad_withdraw"))
            else:
                ctx.receipt("❌ " + esc(exc.message))
            return
        if not result.get("ok"):
            self.ask_code(ctx, ctx.data, error=self.text("text_bad_withdraw"))
            return
        ctx.receipt(str(result.get("message") or self.text("text_withdraw_accepted", player=ctx.data.get("player_id"), amount="", cur="")))

    # ------------------------------------------------------------ outbox (messages created by the backend / worker)
    def deliver_outbox(self) -> None:
        with transaction() as db:
            rows = db.execute(
                select(Notification).where(Notification.channel == "telegram_user", Notification.bot == BOT, Notification.status == "pending", (Notification.next_attempt_at.is_(None)) | (Notification.next_attempt_at <= utcnow())).order_by(Notification.id.asc()).limit(40)
            ).scalars().all()
            items = [(r.id, r.target_telegram_id, r.event, r.body, dict(r.data or {}), r.attempts) for r in rows]
        for note_id, chat_id, event, body, data, attempts in items:
            with self.chat_lock(chat_id):
                try:
                    self._deliver_one(chat_id, event, body, data)
                    self._mark(note_id, "sent")
                except TelegramError as exc:
                    if exc.fatal_for_chat or attempts >= 4:
                        self._mark(note_id, "failed", exc.description)
                    else:
                        self._mark(note_id, "pending", exc.description, retry_in=15 * (attempts + 1))
                except Exception as exc:
                    logger.exception("outbox delivery failed")
                    self._mark(note_id, "failed" if attempts >= 4 else "pending", str(exc)[:300], retry_in=30)

    def _mark(self, note_id: int, status: str, error: str = "", retry_in: int = 0) -> None:
        with transaction() as db:
            row = db.get(Notification, note_id)
            if row is None:
                return
            row.attempts += 1
            row.status = status
            row.error = error[:400]
            row.processed_at = utcnow() if status != "pending" else None
            if retry_in:
                row.next_attempt_at = utcnow() + timedelta(seconds=retry_in)

    def _deliver_one(self, chat_id: int, event: str, body: str, data: dict[str, Any]) -> None:
        ctx = Ctx(self, chat_id, {"id": chat_id})
        ctx.load()
        request_id = str(data.get("request_id") or "")
        same_request = bool(request_id) and str(ctx.data.get("request_id") or "") == request_id
        if data.get("refresh_card") and ctx.state == "wait_payment" and same_request:
            self.show_active_deposit(ctx)
            if body:
                self.safe_send(chat_id, body, None, protect=False)
            return
        if bool(data.get("replace")) and ctx.state == "wait_payment" and same_request:
            ctx.receipt(body)
            return
        if data.get("final") in {"expired", "cancelled", "success"} and same_request:
            for extra in (int(ctx.data.get("receipt_prompt_id") or 0), int(ctx.data.get("receipt_note_id") or 0)):
                if extra:
                    self.delete_later(chat_id, extra)
            ctx.save("idle", ctx.idle_data())
        photo = data.get("photo_url")
        if photo:
            path = Path(get_settings().data_dir) / str(photo).lstrip("/") if str(photo).startswith("/") else None
            self.client.send_photo(chat_id, path if path and path.exists() else str(photo), caption=body)
        else:
            self.safe_send(chat_id, body, None, protect=False)

    # ------------------------------------------------------------ run
    def run(self) -> None:
        me = self.client.get_me()
        if me.get("username"):
            self.username = str(me["username"])
        self.client.delete_webhook()
        self.client.set_commands([("start", "Главное меню"), ("help", "Оператор")])
        logger.info("main bot @%s started", self.username)
        threading.Thread(target=self._loop, args=(self.deliver_outbox, 0.4, "outbox"), daemon=True).start()
        threading.Thread(target=self._loop, args=(self.tick_timers, 10.0, "timers"), daemon=True).start()
        self.dispatcher.run_polling()

    def _loop(self, fn, interval: float, name: str) -> None:
        while not STOP.is_set():
            try:
                fn()
            except Exception:
                logger.exception("%s loop failed", name)
            STOP.wait(interval)


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    bot = MainBot()

    def _stop(signum, frame):  # pragma: no cover
        STOP.set()
        bot.dispatcher.stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _stop)
    bot.run()


if __name__ == "__main__":
    main()
