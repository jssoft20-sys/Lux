"""OnoiPay client bot (@OnoiPayBot): inline-only UX, one editable panel per chat.

Flows: deposit (cash → ID → amount → QR card), withdrawal (cash → ID → last/new QR → code),
profile (history, e-mail, QR, language), referrals. All state is persisted in the
database, every button press is acknowledged immediately and processed once.
"""
from __future__ import annotations

import logging
import secrets
import signal
import threading
import time
from datetime import timedelta
from decimal import Decimal
from typing import Any

from onoipay.config import get_settings
from onoipay.db import transaction
from onoipay.models import BotSession, Deposit, Notification, PaymentCash, User, Withdrawal
from onoipay.services import bot_state, elqr, settings_store
from onoipay.services import cashes as cash_service
from onoipay.services import deposits as deposit_service
from onoipay.services import email as email_service
from onoipay.services import users as user_service
from onoipay.services import withdrawals as withdrawal_service
from onoipay.services.qr import render_qr_png
from onoipay.services.qr_decode import decode_bytes
from onoipay.utils import as_utc, fmt_local, money, sha256_hex, utcnow
from sqlalchemy import select

from .dispatcher import Dispatcher
from .telegram import TelegramClient, TelegramError, button, inline_keyboard
from .texts import t

logger = logging.getLogger("onoibot.main")
BOT = "main"
STOP = threading.Event()
FLOW_STATES = {"choose_cash", "choose_id", "wait_id", "wait_amount", "wait_qr_choice", "wait_qr", "wait_code", "wait_email", "wait_email_code", "wait_profile_qr", "wait_phone"}
PERSIST_KEYS = ("name", "lang", "panel_kind")


class Ctx:
    """Per-update context: chat, user row snapshot, state and helpers."""

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

    # --------------------------------------------------------- persistence
    def load(self) -> None:
        with transaction() as db:
            user = user_service.get_or_create(db, {**self.tg_user, "id": self.chat_id})
            self.user_id = user.id
            self.lang = user.language or "ru"
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

    # --------------------------------------------------------- panel
    def panel(self, text: str, markup: dict | None = None, *, photo: bytes | None = None, state: str | None = None, data: dict[str, Any] | None = None, protect: bool = True, keep_previous: bool = False) -> int:
        """Show a screen: edit the current panel in place, or replace it when the kind changes."""
        current_kind = str(self.data.get("panel_kind") or "text")
        new_data = dict(self.data if data is None else data)
        message_id = self.panel_id
        if photo is None and message_id and current_kind == "text":
            try:
                self.client.edit_text(self.chat_id, message_id, text, markup=markup)
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
            sent = self.client.send_photo(self.chat_id, photo, caption=text, markup=markup, protect=protect)
            new_data["panel_kind"] = "photo"
        else:
            sent = self.client.send_message(self.chat_id, text, markup=markup, protect=protect)
            new_data["panel_kind"] = "text"
        new_id = int(sent.get("message_id") or 0)
        self.save(state, new_data, new_id)
        if old and old != new_id and not keep_previous:
            self.bot.delete_later(self.chat_id, old)
        return new_id

    def receipt(self, text: str, markup: dict | None = None) -> None:
        """Persistent message that stays in the chat (final results)."""
        old = self.panel_id
        sent = self.client.send_message(self.chat_id, text, markup=markup, protect=True)
        data = self.idle_data()
        data["panel_kind"] = "text"
        self.save("idle", data, int(sent.get("message_id") or 0))
        if old and str(self.data.get("panel_kind")) == "photo":
            self.bot.delete_later(self.chat_id, old)
        elif old:
            self.bot.strip_buttons_later(self.chat_id, old)

    def idle_data(self) -> dict[str, Any]:
        return {k: v for k, v in self.data.items() if k in PERSIST_KEYS}


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
        self._bg = threading.Thread
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

    # ------------------------------------------------------------ keyboards
    def menu_kb(self, ctx: Ctx) -> dict:
        return inline_keyboard(
            [button(ctx.T("menu_deposit"), "act:deposit"), button(ctx.T("menu_withdraw"), "act:withdraw")],
            [button(ctx.T("menu_profile"), "profile"), button(ctx.T("menu_ref"), "ref")],
        )

    def greeting(self, ctx: Ctx, note: str = "") -> str:
        with transaction() as db:
            template = str(settings_store.get(db, "greeting_text") or "")
            support = str(settings_store.get(db, "support_username") or "")
        text = template.replace("{name}", ctx.name or "друг").replace("{support}", support)
        if ctx.lang == "kg":
            text = f"👋 Салам, {ctx.name}!\n\n💳 Толуктоо жана чыгаруу\n💸 Комиссия — 0%\n🕐 24/7 иштейбиз\n🔐 Операциялар корголгон\n\n💬 Колдоо: {support}"
        if note:
            text += "\n\n" + note
        return text

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
                ctx.panel(ctx.T("error_generic"), self.menu_kb(ctx), state="idle", data=ctx.idle_data())
            except Exception:
                pass

    # ------------------------------------------------------------ messages
    def on_message(self, message: dict[str, Any]) -> None:
        chat_id = int(message["chat"]["id"])
        ctx = Ctx(self, chat_id, message.get("from") or {})
        ctx.load()
        text = str(message.get("text") or "").strip()
        message_id = int(message.get("message_id") or 0)
        if text.startswith("/start"):
            arg = text.split(maxsplit=1)[1] if len(text.split(maxsplit=1)) > 1 else ""
            self.start(ctx, arg)
            return
        if message.get("contact"):
            self.on_contact(ctx, message)
            return
        if ctx.state in FLOW_STATES:
            self.delete_later(chat_id, message_id)
        if message.get("photo"):
            self.on_photo(ctx, message)
            return
        if text.startswith("/"):
            self.show_menu(ctx)
            return
        if not text:
            if ctx.state == "wait_qr":
                ctx.panel(ctx.T("send_qr") + "\n\n❌ " + ("Отправьте QR как фото, не файлом" if ctx.lang == "ru" else "QR'ды сүрөт катары жөнөтүңүз"), self.qr_kb(ctx))
            return
        handlers = {
            "choose_id": self.on_id,
            "wait_id": self.on_id,
            "wait_amount": self.on_amount,
            "wait_code": self.on_code,
            "wait_email": self.on_email,
            "wait_email_code": self.on_email_code,
        }
        handler = handlers.get(ctx.state)
        if handler:
            handler(ctx, text)
        elif ctx.state == "wait_qr":
            ctx.panel(ctx.T("send_qr") + "\n\n❌ " + ctx.T("qr_photo_only"), self.qr_kb(ctx))
        elif ctx.state == "wait_profile_qr":
            ctx.panel(ctx.T("profile_qr_prompt") + "\n\n❌ " + ctx.T("qr_photo_only"), inline_keyboard([button(ctx.T("back"), "profile")]))
        elif ctx.state == "wait_payment":
            pass  # the card stays; stray text is removed
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
        if pressed and ctx.panel_id and pressed != ctx.panel_id and not data.startswith(("hist", "noop")):
            # button on an old screen: remove its keyboard, do nothing else
            self.strip_buttons_later(chat_id, pressed)
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
        if ctx.blocked and data.startswith("act:"):
            ctx.panel(ctx.T("blocked"), self.menu_kb(ctx), state="idle", data=ctx.idle_data())
            return
        if data.startswith("act:"):
            self.begin(ctx, data.split(":", 1)[1])
        elif data == "menu" or data == "cancel":
            self.show_menu(ctx)
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
                ctx.panel(ctx.T("send_qr"), self.qr_kb(ctx), state="wait_qr")
        elif data == "open_active":
            self.show_active_deposit(ctx)
        elif data == "profile":
            self.show_profile(ctx)
        elif data == "profile:history":
            self.show_history(ctx, 0)
        elif data.startswith("hist:"):
            self.show_history(ctx, int(data.split(":", 1)[1] or 0))
        elif data.startswith("histitem:"):
            _, kind, item_id = data.split(":", 2)
            self.show_history_item(ctx, kind, int(item_id))
        elif data == "profile:email":
            ctx.panel(ctx.T("enter_email"), inline_keyboard([button(ctx.T("back"), "profile")]), state="wait_email")
        elif data == "profile:qr":
            ctx.panel(ctx.T("profile_qr_prompt"), inline_keyboard([button(ctx.T("back"), "profile")]), state="wait_profile_qr")
        elif data == "profile:lang":
            self.toggle_lang(ctx)
        elif data == "ref":
            self.show_referrals(ctx)
        elif data == "ref:payout":
            self.referral_payout(ctx)
        elif data == "email:resend":
            self.on_email(ctx, str(ctx.data.get("email") or ""))
        elif data == "back_code":
            if ctx.state == "wait_code":
                self.ask_code(ctx, ctx.data)
        else:
            logger.debug("unknown callback %s", data)

    # ------------------------------------------------------------ start / menu
    def start(self, ctx: Ctx, arg: str = "") -> None:
        note = ""
        if arg.startswith("ref_"):
            with transaction() as db:
                user = db.get(User, ctx.user_id)
                status = user_service.bind_referral(db, user, arg[4:])
            if status == "ok":
                note = "🎁 Вы присоединились по приглашению" if ctx.lang == "ru" else "🎁 Сиз чакыруу боюнча кошулдуңуз"
        if not self.subscribed(ctx):
            self.show_subscribe(ctx)
            return
        with transaction() as db:
            if settings_store.get_bool(db, "phone_required") and not db.get(User, ctx.user_id).phone_verified_at:
                self.request_phone(ctx)
                return
        # /start always produces a fresh screen (the client may have deleted the old one)
        old = ctx.panel_id
        markup = self.menu_kb(ctx)
        active = self.active_deposit_id(ctx)
        if active:
            markup = inline_keyboard([button(ctx.T("active_request"), "open_active")], *markup["inline_keyboard"])
        sent = self.client.send_message(ctx.chat_id, self.greeting(ctx, note), markup=markup, protect=True)
        data = ctx.idle_data()
        data["panel_kind"] = "text"
        ctx.save("idle" if not active else "wait_payment", {**data, **({k: ctx.data[k] for k in ("request_id", "deposit_id", "deadline", "cash_id", "cash_name", "player_id", "pay_amount", "currency") if k in ctx.data} if active else {})}, int(sent.get("message_id") or 0))
        if old:
            self.delete_later(ctx.chat_id, old)

    def show_menu(self, ctx: Ctx, note: str = "") -> None:
        active = self.active_deposit_id(ctx)
        markup = self.menu_kb(ctx)
        if active:
            markup = inline_keyboard([button(ctx.T("active_request"), "open_active")], *markup["inline_keyboard"])
        data = ctx.idle_data()
        if active:
            data.update({k: ctx.data[k] for k in ("request_id", "deposit_id", "deadline", "cash_id", "cash_name", "player_id", "pay_amount", "currency") if k in ctx.data})
        ctx.panel(self.greeting(ctx, note), markup, state="wait_payment" if active else "idle", data=data)

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
        label = "Подтвердить номер" if ctx.lang == "ru" else "Номерди ырастоо"
        sent = self.client.call("sendMessage", {"chat_id": ctx.chat_id, "text": "📱 " + ("Подтвердите номер телефона кнопкой ниже" if ctx.lang == "ru" else "Телефон номериңизди төмөнкү баскыч менен ырастаңыз"), "reply_markup": {"keyboard": [[{"text": label, "request_contact": True}]], "resize_keyboard": True, "one_time_keyboard": True}})
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
        sent = self.client.call("sendMessage", {"chat_id": ctx.chat_id, "text": "✅", "reply_markup": {"remove_keyboard": True}})
        self.delete_later(ctx.chat_id, int(sent.get("message_id") or 0))
        self.delete_later(ctx.chat_id, int(message.get("message_id") or 0))
        self.start(ctx)

    # ------------------------------------------------------------ deposit / withdraw common
    def enabled_cashes(self, action: str) -> list[dict[str, Any]]:
        with transaction() as db:
            rows = cash_service.list_cashes(db, enabled_only=True)
            out = []
            for cash in rows:
                reason = cash_service.deposit_available(db, cash) if action == "deposit" else cash_service.withdraw_available(db, cash)
                out.append({"id": cash.id, "key": cash.key, "name": cash.name, "currency": cash.currency, "reason": reason, "min": str(money(cash.deposit_min)), "max": str(money(cash.deposit_max))})
            return out

    def begin(self, ctx: Ctx, action: str) -> None:
        if action not in {"deposit", "withdraw"}:
            return
        with transaction() as db:
            if settings_store.get_bool(db, "bot_paused"):
                ctx.panel(ctx.T("paused"), self.menu_kb(ctx), state="idle", data=ctx.idle_data())
                return
        if action == "deposit" and self.active_deposit_id(ctx):
            self.show_active_deposit(ctx)
            return
        cashes = [c for c in self.enabled_cashes(action) if not c["reason"]]
        all_cashes = self.enabled_cashes(action)
        if not cashes:
            reason = all_cashes[0]["reason"] if all_cashes else ("Кассы временно недоступны" if ctx.lang == "ru" else "Кассалар убактылуу жеткиликсиз")
            ctx.panel("❌ " + reason, self.menu_kb(ctx), state="idle", data=ctx.idle_data())
            return
        data = {**ctx.idle_data(), "action": action, "nonce": secrets.token_hex(6)}
        if len(cashes) == 1:
            ctx.data = data
            ctx.state = "choose_cash"
            self.choose_cash(ctx, cashes[0]["id"])
            return
        rows = [[button(("🎰 " + c["name"]), f"cash:{c['id']}")] for c in cashes]
        rows.append([button(ctx.T("cancel"), "cancel")])
        ctx.panel(("📥 Пополнение" if action == "deposit" else "📤 Вывод") + "\n" + ctx.T("choose_cash"), inline_keyboard(*rows), state="choose_cash", data=data)

    def choose_cash(self, ctx: Ctx, cash_id: int) -> None:
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if cash is None or not cash.enabled:
                self.show_menu(ctx)
                return
            user = db.get(User, ctx.user_id)
            saved = [(s.player_id, s.player_name) for s in user_service.saved_ids(db, user, cash)]
            info = {"cash_id": cash.id, "cash_key": cash.key, "cash_name": cash.name, "currency": cash.currency, "dep_min": str(money(cash.deposit_min)), "dep_max": str(money(cash.deposit_max))}
        data = {**ctx.data, **info}
        self.ask_id(ctx, data, saved)

    def ask_id(self, ctx: Ctx, data: dict[str, Any], saved: list[tuple[str, str]] | None = None, error: str = "") -> None:
        if saved is None:
            with transaction() as db:
                user = db.get(User, ctx.user_id)
                cash = db.get(PaymentCash, int(data["cash_id"]))
                saved = [(s.player_id, s.player_name) for s in user_service.saved_ids(db, user, cash)]
        rows = [[button(f"🆔 {pid}" + (f" · {name[:18]}" if name else ""), f"id:{pid}")] for pid, name in saved[:5]]
        rows.append([button(ctx.T("cancel"), "cancel")])
        text = ctx.T("enter_id", cash=data.get("cash_name", ""))
        if saved:
            text += "\n\n" + ("Выберите сохранённый ID или введите новый" if ctx.lang == "ru" else "Сакталган ID тандаңыз же жаңысын жазыңыз")
        if error:
            text += "\n\n❌ " + error
        ctx.panel(text, inline_keyboard(*rows), state="choose_id" if saved else "wait_id", data=data)

    def on_id(self, ctx: Ctx, text: str) -> None:
        pid = "".join(ch for ch in str(text) if ch.isdigit())
        if not pid or len(pid) > 20:
            self.ask_id(ctx, ctx.data, error=ctx.T("id_digits"))
            return
        ctx.panel(ctx.T("checking_id"), inline_keyboard([button(ctx.T("cancel"), "cancel")]))
        cash_id = int(ctx.data.get("cash_id") or 0)
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if cash is None:
                self.show_menu(ctx)
                return
            adapter = cash_service.adapter(cash)
        try:
            result = adapter.lookup_player(pid)
        except Exception as exc:
            logger.warning("lookup failed: %s", exc)
            result = None
        if result is None or (not result.ok and (result.extra or {}).get("code") != "PLAYER_NOT_FOUND" and result.status == 599):
            self.ask_id(ctx, ctx.data, error=("Не удалось проверить ID у кассы, попробуйте ещё раз" if ctx.lang == "ru" else "ID текшерилген жок, кайра аракет кылыңыз"))
            return
        if not result.ok:
            with transaction() as db:
                user_service.forget_player_id(db, db.get(User, ctx.user_id), db.get(PaymentCash, cash_id), pid)
            self.ask_id(ctx, ctx.data, error=result.message or ctx.T("id_not_found"))
            return
        with transaction() as db:
            cash = db.get(PaymentCash, cash_id)
            if not cash_service.currency_matches(cash, result.currency):
                self.ask_id(ctx, {**ctx.data, "player_id": ""}, error=ctx.T("currency_mismatch", have=result.currency or "?", need=cash.currency))
                return
            user_service.remember_player_id(db, db.get(User, ctx.user_id), cash, pid, result.player_name, result.currency)
        data = {**ctx.data, "player_id": pid, "player_name": result.player_name or "", "player_currency": result.currency or ""}
        if data.get("action") == "deposit":
            self.ask_amount(ctx, data)
        else:
            self.ask_qr(ctx, data)

    # ------------------------------------------------------------ deposit
    def amount_kb(self, ctx: Ctx, data: dict[str, Any]) -> dict:
        low, high = Decimal(str(data.get("dep_min") or 100)), Decimal(str(data.get("dep_max") or 100000))
        presets = [x for x in (500, 1000, 2000, 3000, 5000, 10000) if low <= x <= high][:6]
        rows = []
        for i in range(0, len(presets), 3):
            rows.append([button(f"{x:,}".replace(",", " "), f"amt:{x}") for x in presets[i : i + 3]])
        rows.append([button(ctx.T("cancel"), "cancel")])
        return inline_keyboard(*rows)

    def ask_amount(self, ctx: Ctx, data: dict[str, Any], error: str = "") -> None:
        head = f"🆔 {data.get('cash_name')} · ID {data.get('player_id')}" + (f"\n✅ {data.get('player_name')}" if data.get("player_name") else "")
        text = head + "\n\n" + ctx.T("enter_amount", min=str(Decimal(str(data.get("dep_min") or 0)).quantize(Decimal(1))), max=str(Decimal(str(data.get("dep_max") or 0)).quantize(Decimal(1))), cur=data.get("currency", "KGS"))
        if error:
            text += "\n\n❌ " + error
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
                ctx.panel("❌ " + exc.message, self.menu_kb(ctx), state="idle", data=ctx.idle_data())
            return
        self.show_deposit_card(ctx, info, fresh=True)

    def _deposit_info(self, db, deposit: Deposit) -> dict[str, Any]:
        return {
            "deposit_id": deposit.id,
            "request_id": deposit.public_id,
            "pay_amount": str(money(deposit.pay_amount)),
            "currency": deposit.currency,
            "player_id": deposit.player_id,
            "cash_id": deposit.cash_id,
            "cash_name": deposit.cash.name if deposit.cash else "",
            "deadline": as_utc(deposit.expires_at).timestamp() if deposit.expires_at else time.time() + 300,
            "qr_payload": deposit.qr_payload,
            "methods": deposit_service.payment_methods(db, deposit),
            "qr_enabled": deposit_service.qr_enabled(db),
            "status": deposit.status,
        }

    def _left(self, deadline: float) -> str:
        left = max(0, int(float(deadline) - time.time()))
        return f"{left // 60}:{left % 60:02d}"

    def card_text(self, ctx: Ctx, info: dict[str, Any]) -> str:
        return ctx.T("pay_card", player=info.get("player_id"), cash=info.get("cash_name"), amount=info.get("pay_amount"), cur=info.get("currency"), left=self._left(info.get("deadline") or 0))

    def card_kb(self, ctx: Ctx, info: dict[str, Any]) -> dict:
        rows = []
        methods = list(info.get("methods") or [])
        for i in range(0, len(methods), 2):
            rows.append([button("🏦 " + m["name"], url=m["url"]) for m in methods[i : i + 2]])
        rows.append([button(ctx.T("cancel_deposit"), f"cancel:{info.get('request_id')}")])
        return inline_keyboard(*rows)

    def show_deposit_card(self, ctx: Ctx, info: dict[str, Any], fresh: bool = False) -> None:
        data = {**ctx.idle_data(), **{k: info[k] for k in ("deposit_id", "request_id", "pay_amount", "currency", "player_id", "cash_id", "cash_name", "deadline")}, "methods": info.get("methods") or [], "action": "deposit"}
        photo = None
        if info.get("qr_enabled") and info.get("qr_payload"):
            try:
                photo = render_qr_png(elqr.qr_image_value(info["qr_payload"]))
            except Exception as exc:
                logger.warning("qr render failed: %s", exc)
        ctx.panel(self.card_text(ctx, info), self.card_kb(ctx, info), photo=photo, state="wait_payment", data=data, protect=False)

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
        ctx.data = ctx.idle_data()
        ctx.state = "idle"
        self.show_menu(ctx, note=ctx.T("deposit_cancelled"))

    def tick_timers(self) -> None:
        """Refresh the countdown on active payment cards (every ~30 s per chat)."""
        with transaction() as db:
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
                    self.client.edit_caption(chat_id, panel_id, self.card_text(ctx, info), markup=self.card_kb(ctx, info))
                except TelegramError as exc:
                    if exc.fatal_for_chat or exc.cant_edit:
                        ctx.save(data={**ctx.data, "timer_at": now + 3600})
                        continue
                ctx.save(data={**ctx.data, "timer_at": now})

    # ------------------------------------------------------------ withdrawal
    def qr_kb(self, ctx: Ctx) -> dict:
        return inline_keyboard([button(ctx.T("cancel"), "cancel")])

    def ask_qr(self, ctx: Ctx, data: dict[str, Any]) -> None:
        with transaction() as db:
            qr = user_service.last_qr(db, db.get(User, ctx.user_id))
            last = {"id": qr.id, "bank": qr.bank_name, "at": fmt_local(qr.last_used_at)} if qr else None
        if last:
            text = f"🗺 {ctx.T('use_last_qr_q')}\n{last['bank'] or 'QR банка'} · {last['at']}"
            ctx.panel(text, inline_keyboard([button(ctx.T("use_last_qr"), "qr:last")], [button(ctx.T("new_qr"), "qr:new")], [button(ctx.T("cancel"), "cancel")]), state="wait_qr_choice", data={**data, "last_qr_id": last["id"]})
        else:
            ctx.panel(ctx.T("send_qr"), self.qr_kb(ctx), state="wait_qr", data=data)

    def use_last_qr(self, ctx: Ctx) -> None:
        qr_id = int(ctx.data.get("last_qr_id") or 0)
        with transaction() as db:
            from onoipay.models import QrRecord

            qr = db.get(QrRecord, qr_id)
            if qr is None or qr.user_id != ctx.user_id:
                ctx.panel(ctx.T("send_qr"), self.qr_kb(ctx), state="wait_qr")
                return
            data = {**ctx.data, "qr_record_id": qr.id, "qr_file_url": qr.file_url}
        self.ask_code(ctx, data)

    def on_photo(self, ctx: Ctx, message: dict[str, Any]) -> None:
        if ctx.state not in {"wait_qr", "wait_profile_qr"}:
            if ctx.state == "idle":
                self.show_menu(ctx)
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
        if ctx.state == "wait_profile_qr":
            self.show_profile(ctx, note="✅ " + ctx.T("qr_saved"))
            return
        self.ask_code(ctx, {**ctx.data, "qr_record_id": qr_id, "qr_file_url": qr_url})

    def ask_code(self, ctx: Ctx, data: dict[str, Any], error: str = "") -> None:
        text = ctx.T("enter_code", cash=data.get("cash_name", ""))
        if error:
            text += "\n\n❌ " + error
        ctx.panel(text, inline_keyboard([button(ctx.T("instruction"), "instr")], [button(ctx.T("cancel"), "cancel")]), state="wait_code", data=data)

    def show_instruction(self, ctx: Ctx, callback_id: str) -> None:
        with transaction() as db:
            cash = db.get(PaymentCash, int(ctx.data.get("cash_id") or 0)) if ctx.data.get("cash_id") else None
            text = (cash.instructions_text if cash and cash.instructions_text else "") or str(settings_store.get(db, "withdraw_instruction") or "")
        if ctx.state != "wait_code":
            self.client.answer_callback(callback_id, "Неактуально")
            return
        if len(text) <= 190:
            self.client.answer_callback(callback_id, text, alert=True)
        else:
            ctx.panel(text, inline_keyboard([button(ctx.T("back"), "back_code")]), state="wait_code")

    def on_code(self, ctx: Ctx, text: str) -> None:
        code = str(text).strip()
        if len(code) < 3:
            self.ask_code(ctx, ctx.data, error="Введите код вывода" if ctx.lang == "ru" else "Чыгаруу кодун жазыңыз")
            return
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
                self.ask_code(ctx, ctx.data, error=exc.message)
            else:
                ctx.panel("❌ " + exc.message, self.menu_kb(ctx), state="idle", data=ctx.idle_data())
            return
        if not result.get("ok"):
            self.ask_code(ctx, ctx.data, error=str(result.get("message") or "Неверный код"))
            return
        ctx.receipt(str(result.get("message") or "✅ Заявка на вывод принята."), inline_keyboard([button(ctx.T("menu"), "menu")]))

    # ------------------------------------------------------------ profile
    def show_profile(self, ctx: Ctx, note: str = "") -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            summary = user_service.user_summary(db, user)
            qr = user_service.last_qr(db, user)
            email = user.email + (" ✅" if user.email_verified_at else " (не подтверждён)") if user.email else ("не привязан" if ctx.lang == "ru" else "кошулган эмес")
            ref_balance = money(user.referral_balance)
        lines = [
            ctx.T("profile_title"),
            "",
            f"{ctx.name}",
            f"Telegram ID: {ctx.chat_id}",
            f"Username: @{ctx.tg_user.get('username') or '—'}",
            f"E-mail: {email}",
            "",
            (f"Пополнений: {summary['deposits_count']} · Выводов: {summary['withdrawals_count']}" if ctx.lang == "ru" else f"Толуктоолор: {summary['deposits_count']} · Чыгаруулар: {summary['withdrawals_count']}"),
            (f"Реферальный баланс: {ref_balance} KGS" if ctx.lang == "ru" else f"Рефералдык баланс: {ref_balance} KGS"),
            (f"QR вывода: {'сохранён' if qr else 'не добавлен'}" if ctx.lang == "ru" else f"Чыгаруу QR'ы: {'сакталган' if qr else 'кошулган эмес'}"),
        ]
        if note:
            lines += ["", note]
        markup = inline_keyboard(
            [button(ctx.T("history"), "profile:history")],
            [button(ctx.T("email_btn"), "profile:email"), button(ctx.T("qr_btn_update") if qr else ctx.T("qr_btn_add"), "profile:qr")],
            [button(ctx.T("lang_btn"), "profile:lang")],
            [button(ctx.T("menu"), "menu")],
        )
        ctx.panel("\n".join(lines), markup, state="idle", data=ctx.idle_data())

    def toggle_lang(self, ctx: Ctx) -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            user.language = "kg" if (user.language or "ru") == "ru" else "ru"
            ctx.lang = user.language
        self.show_profile(ctx)

    def on_email(self, ctx: Ctx, text: str) -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            try:
                result = email_service.start_verification(db, user, text)
            except email_service.EmailError as exc:
                ctx.panel(ctx.T("enter_email") + f"\n\n❌ {exc}", inline_keyboard([button(ctx.T("back"), "profile")]), state="wait_email")
                return
            email = email_service.normalize_email(text)
        if result.get("already_verified"):
            self.show_profile(ctx, note="✅ " + ctx.T("email_ok"))
            return
        hint = ""
        if result.get("delivery") == "log":
            hint = f"\n\n(тест: код {result.get('debug_code')})"
        elif result.get("retry_in"):
            hint = f"\n\n⏳ Повторная отправка через {result['retry_in']} с"
        ctx.panel(f"✉️ {email}\n\n" + ctx.T("enter_email_code") + hint, inline_keyboard([button("🔁 Отправить код ещё раз" if ctx.lang == "ru" else "🔁 Кодду кайра жөнөтүү", "email:resend")], [button(ctx.T("back"), "profile")]), state="wait_email_code", data={**ctx.data, "email": email})

    def on_email_code(self, ctx: Ctx, text: str) -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            try:
                email_service.confirm_verification(db, user, text)
            except email_service.EmailError as exc:
                ctx.panel(f"✉️ {ctx.data.get('email')}\n\n" + ctx.T("enter_email_code") + f"\n\n❌ {exc}", inline_keyboard([button("🔁 Отправить код ещё раз" if ctx.lang == "ru" else "🔁 Кодду кайра жөнөтүү", "email:resend")], [button(ctx.T("back"), "profile")]), state="wait_email_code")
                return
        self.show_profile(ctx, note="✅ " + ctx.T("email_ok"))

    def show_history(self, ctx: Ctx, page: int) -> None:
        size = 8
        with transaction() as db:
            deposits = db.execute(select(Deposit).where(Deposit.user_id == ctx.user_id).order_by(Deposit.id.desc()).limit(60)).scalars().all()
            withdrawals = db.execute(select(Withdrawal).where(Withdrawal.user_id == ctx.user_id).order_by(Withdrawal.id.desc()).limit(60)).scalars().all()
            items: list[tuple[Any, str]] = [(d, "d") for d in deposits] + [(w, "w") for w in withdrawals]
            items.sort(key=lambda x: as_utc(x[0].created_at) or utcnow(), reverse=True)
            total = len(items)
            page = max(0, min(page, max(0, (total - 1) // size)))
            chunk = items[page * size : (page + 1) * size]
            rows = []
            for obj, kind in chunk:
                amount = money(obj.pay_amount if kind == "d" else obj.amount)
                label = deposit_service.STATUS_LABELS.get(obj.status, obj.status) if kind == "d" else withdrawal_service.STATUS_LABELS.get(obj.status, obj.status)
                icon = "📥" if kind == "d" else "📤"
                rows.append([button(f"{icon} {fmt_local(obj.created_at, '%d.%m %H:%M')} · {amount} · {label}", f"histitem:{kind}:{obj.id}")])
        nav = []
        if page > 0:
            nav.append(button("◀️", f"hist:{page - 1}"))
        if (page + 1) * size < total:
            nav.append(button("▶️", f"hist:{page + 1}"))
        if nav:
            rows.append(nav)
        rows.append([button(ctx.T("back"), "profile")])
        text = ctx.T("history") + (f"\n{page + 1}/{max(1, (total + size - 1) // size)}" if total else "\n" + ctx.T("history_empty"))
        ctx.panel(text, inline_keyboard(*rows), state="idle", data={**ctx.idle_data(), "history_page": page})

    def show_history_item(self, ctx: Ctx, kind: str, item_id: int) -> None:
        with transaction() as db:
            if kind == "d":
                obj = db.get(Deposit, item_id)
                if obj is None or obj.user_id != ctx.user_id:
                    self.show_history(ctx, 0)
                    return
                text = f"📥 Пополнение {obj.public_id}\n\nКасса: {obj.cash.name if obj.cash else ''}\nID: {obj.player_id}\nСумма: {money(obj.pay_amount)} {obj.currency}\nСтатус: {deposit_service.STATUS_LABELS.get(obj.status, obj.status)}\nСоздана: {fmt_local(obj.created_at)}" + (f"\nЗачислено: {fmt_local(obj.credited_at)}" if obj.credited_at else "") + (f"\n\n{obj.error}" if obj.error and obj.status != "success" else "")
            else:
                obj = db.get(Withdrawal, item_id)
                if obj is None or obj.user_id != ctx.user_id:
                    self.show_history(ctx, 0)
                    return
                text = f"📤 Вывод {obj.public_id}\n\nКасса: {obj.cash.name if obj.cash else ''}\nID: {obj.player_id}\nСумма: {money(obj.amount)} {obj.currency}\nСтатус: {withdrawal_service.STATUS_LABELS.get(obj.status, obj.status)}\nСоздан: {fmt_local(obj.created_at)}" + (f"\nВыполнен: {fmt_local(obj.completed_at)}" if obj.completed_at else "") + (f"\n\n{obj.error}" if obj.error and obj.status != "success" else "")
        page = int(ctx.data.get("history_page") or 0)
        ctx.panel(text, inline_keyboard([button(ctx.T("back"), f"hist:{page}")], [button(ctx.T("menu"), "menu")]), state="idle")

    # ------------------------------------------------------------ referrals
    def ref_link(self, code: str) -> str:
        return f"https://t.me/{self.username}?start=ref_{code}"

    def show_referrals(self, ctx: Ctx, note: str = "") -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            stats = user_service.referral_stats(db, user)
            pct = settings_store.get_float(db, "referral_bonus_pct", 1.0)
        link = self.ref_link(stats["code"])
        if ctx.lang == "ru":
            text = f"{ctx.T('ref_title')}\n\nПриглашайте друзей и получайте {pct:g}% с каждого их пополнения.\n\n🔗 {link}\n\nПриглашено: {stats['invited']} · Активных: {stats['active']}\nНачислено всего: {stats['total']} KGS\nДоступно: {stats['available']} KGS" + (f"\nНа выводе: {stats['pending']} KGS" if stats["pending"] > 0 else "")
            share = f"https://t.me/share/url?url={link}&text=Пополняй и выводи через OnoiPay без комиссии"
        else:
            text = f"{ctx.T('ref_title')}\n\nДосторуңузду чакырып, ар бир толуктоосунан {pct:g}% алыңыз.\n\n🔗 {link}\n\nЧакырылды: {stats['invited']} · Активдүү: {stats['active']}\nБардыгы: {stats['total']} KGS\nЖеткиликтүү: {stats['available']} KGS"
            share = f"https://t.me/share/url?url={link}&text=OnoiPay аркылуу комиссиясыз толуктаңыз"
        if note:
            text += "\n\n" + note
        ctx.panel(text, inline_keyboard([button(ctx.T("ref_share"), url=share)], [button(ctx.T("ref_payout"), "ref:payout")], [button(ctx.T("menu"), "menu")]), state="idle", data=ctx.idle_data())

    def referral_payout(self, ctx: Ctx) -> None:
        with transaction() as db:
            user = db.get(User, ctx.user_id)
            row, error = user_service.create_referral_payout(db, user)
            if row:
                from onoipay.services.notifications import admin_event

                admin_event(db, "referral_payout", f"referral_payout:{row.id}", "🎁 Заявка на вывод реферального баланса", f"{ctx.name} • {money(row.amount)} KGS • {row.public_id}", {"user_id": user.id, "url": f"#/users/{user.id}"})
                note = f"✅ Заявка {row.public_id} на {money(row.amount)} KGS создана. Оператор переведёт бонус на ваш QR."
            else:
                note = "❌ " + error
        self.show_referrals(ctx, note=note)

    # ------------------------------------------------------------ outbox
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
        replace = bool(data.get("replace")) and ctx.state == "wait_payment" and str(ctx.data.get("request_id") or "") == request_id
        if replace:
            ctx.receipt(body, inline_keyboard([button(ctx.T("menu"), "menu")]))
            return
        if data.get("final") in {"expired", "cancelled", "success"} and request_id and str(ctx.data.get("request_id") or "") == request_id:
            # panel is text (menu) but the request is known: clean the state
            ctx.save("idle", ctx.idle_data())
        photo = data.get("photo_url")
        if photo:
            from pathlib import Path

            path = Path(get_settings().data_dir) / str(photo).lstrip("/") if str(photo).startswith("/") else None
            self.client.send_photo(chat_id, path if path and path.exists() else str(photo), caption=body)
        else:
            markup = inline_keyboard([button(ctx.T("menu"), "menu")]) if event in {"deposit_success", "withdrawal_success", "withdrawal_failed", "withdrawal_cancelled", "deposit_rejected", "deposit_expired"} else None
            self.client.send_message(chat_id, body, markup=markup)

    # ------------------------------------------------------------ run
    def run(self) -> None:
        me = self.client.get_me()
        if me.get("username"):
            self.username = str(me["username"])
        self.client.set_commands([("start", "Главное меню")])
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
