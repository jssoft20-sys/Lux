"""OnoiPay support bot (@OnoiHelpBot): automated first line + operator relay."""
from __future__ import annotations

import logging
import re
import signal
import threading
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

from onoipay.config import get_settings
from onoipay.db import transaction
from onoipay.models import BotSession, Notification, User
from onoipay.services import settings_store
from onoipay.services import support as support_service
from onoipay.services import users as user_service
from onoipay.utils import sha256_hex, utcnow
from sqlalchemy import select

from .dispatcher import Dispatcher
from .telegram import TelegramClient, TelegramError, inline_keyboard

logger = logging.getLogger("onoibot.support")
STOP = threading.Event()


class SupportBot:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.support_bot_token:
            raise SystemExit("SUPPORT_BOT_TOKEN is not configured")
        self.settings = settings
        self.client = TelegramClient(settings.support_bot_token, settings.telegram_api_base)
        self._locks: dict[int, threading.RLock] = {}
        self._locks_guard = threading.Lock()
        self.dispatcher = Dispatcher(self.client, self.handle_update, name="support", workers=32, offset_store=self._offset_store)
        self.uploads = Path(settings.data_dir) / "uploads" / "support"
        self.uploads.mkdir(parents=True, exist_ok=True)

    def chat_lock(self, chat_id: int) -> threading.RLock:
        with self._locks_guard:
            lock = self._locks.get(chat_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[chat_id] = lock
            return lock

    def _offset_store(self, value: int | None) -> int | None:
        with transaction() as db:
            row = db.execute(select(BotSession).where(BotSession.bot == "support:offset", BotSession.telegram_id == 0)).scalar_one_or_none()
            if value is None:
                return int((row.data or {}).get("offset") or 0) if row else 0
            if row is None:
                db.add(BotSession(bot="support:offset", telegram_id=0, state="offset", data={"offset": int(value)}))
            else:
                row.data = {"offset": int(value)}
        return value

    # ------------------------------------------------------------ helpers
    def _markup(self, buttons: list[list[dict[str, str]]] | None) -> dict | None:
        if not buttons:
            return None
        return inline_keyboard(*[[{"text": b["text"], "callback_data": b["callback_data"]} for b in row] for row in buttons])

    def _send(self, chat_id: int, text: str, buttons: list[list[dict[str, str]]] | None = None) -> None:
        for chunk in _chunks(text, 3900):
            self.client.send_message(chat_id, chunk, markup=self._markup(buttons) if chunk is text or len(text) <= 3900 else None)

    def _user(self, tg_user: dict[str, Any]) -> tuple[int, str]:
        with transaction() as db:
            user = user_service.get_or_create(db, tg_user)
            return user.id, user.language

    def greeting(self) -> tuple[str, list[list[dict[str, str]]]]:
        with transaction() as db:
            text = str(settings_store.get(db, "support_greeting") or "")
        return text, support_service._menu_buttons()

    # ------------------------------------------------------------ updates
    def handle_update(self, update: dict[str, Any]) -> None:
        chat_id = Dispatcher.chat_id_of(update)
        with self.chat_lock(chat_id):
            try:
                if "callback_query" in update:
                    self.on_callback(update["callback_query"])
                elif "message" in update:
                    self.on_message(update["message"])
            except TelegramError as exc:
                if not exc.fatal_for_chat:
                    logger.warning("telegram error: %s", exc)
            except Exception:
                logger.exception("support handler failed")

    def on_callback(self, query: dict[str, Any]) -> None:
        chat_id = int(((query.get("message") or {}).get("chat") or {}).get("id") or query["from"]["id"])
        data = str(query.get("data") or "")
        user_id, _lang = self._user({**(query.get("from") or {}), "id": chat_id})
        if data == "sup:home":
            text, buttons = self.greeting()
            self._send(chat_id, text, buttons)
            return
        with transaction() as db:
            user = db.get(User, user_id)
            reply = support_service.respond(db, user, "", callback=data, telegram_message_id=0)
        if reply:
            self._send(chat_id, reply.text, reply.buttons)

    def on_message(self, message: dict[str, Any]) -> None:
        chat_id = int(message["chat"]["id"])
        tg_user = message.get("from") or {}
        text = str(message.get("text") or message.get("caption") or "").strip()
        user_id, _lang = self._user({**tg_user, "id": chat_id})
        if text.startswith("/start") or text == "/menu":
            greeting, buttons = self.greeting()
            self._send(chat_id, greeting, buttons)
            return
        # rating "1".."5" right after a resolved conversation
        if re.fullmatch(r"[1-5]", text):
            with transaction() as db:
                user = db.get(User, user_id)
                if support_service.apply_rating(db, user, int(text)):
                    self._send(chat_id, "Спасибо за оценку! 🙏")
                    return
        media_kind, file_url = self._media(message)
        # debounce: merge a burst of short messages into one request
        with transaction() as db:
            debounce = float(settings_store.get(db, "support_debounce_seconds") or 1.5)
        if text and not media_kind and debounce > 0:
            time.sleep(min(3.0, debounce))
            extra = self.dispatcher.pop_pending_messages(chat_id)
            for item in extra:
                more = str((item.get("message") or {}).get("text") or "").strip()
                if more:
                    text = f"{text}\n{more}"
        with transaction() as db:
            user = db.get(User, user_id)
            reply = support_service.respond(db, user, text, media_kind=media_kind, file_url=file_url, telegram_message_id=int(message.get("message_id") or 0))
        if reply:
            self._send(chat_id, reply.text, reply.buttons)

    def _media(self, message: dict[str, Any]) -> tuple[str, str]:
        file_id, kind = "", ""
        if message.get("photo"):
            file_id, kind = message["photo"][-1]["file_id"], "photo"
        else:
            for key in ("document", "video", "voice", "video_note", "audio"):
                obj = message.get(key)
                if isinstance(obj, dict) and obj.get("file_id"):
                    file_id, kind = obj["file_id"], key
                    break
        if not file_id:
            return "", ""
        try:
            url = self.client.get_file_url(file_id)
            if kind == "photo" and url:
                raw = self.client.download(url)
                name = f"{sha256_hex(raw)[:24]}.jpg"
                (self.uploads / name).write_bytes(raw)
                return kind, f"/uploads/support/{name}"
            return kind, url
        except Exception as exc:
            logger.warning("media fetch failed: %s", exc)
            return kind, ""

    # ------------------------------------------------------------ outbox
    def deliver_outbox(self) -> None:
        with transaction() as db:
            rows = db.execute(
                select(Notification).where(Notification.channel.in_(("telegram_user", "admin_telegram")), Notification.bot == "support", Notification.status == "pending", (Notification.next_attempt_at.is_(None)) | (Notification.next_attempt_at <= utcnow())).order_by(Notification.id.asc()).limit(40)
            ).scalars().all()
            items = [(r.id, r.target_telegram_id, r.body, dict(r.data or {}), r.attempts, r.channel) for r in rows]
        for note_id, chat_id, body, data, attempts, _channel in items:
            try:
                photo = data.get("photo_url")
                if photo:
                    path = Path(self.settings.data_dir) / str(photo).lstrip("/") if str(photo).startswith("/") else None
                    self.client.send_photo(chat_id, path if path and path.exists() else str(photo), caption=body)
                else:
                    markup = None
                    if data.get("rating_prompt"):
                        markup = inline_keyboard([{"text": "⭐ " + str(i), "callback_data": f"rate:{i}"} for i in range(1, 6)])
                    self.client.send_message(chat_id, body, markup=markup)
                self._mark(note_id, "sent")
            except TelegramError as exc:
                self._mark(note_id, "failed" if exc.fatal_for_chat or attempts >= 4 else "pending", exc.description, retry_in=15 * (attempts + 1))
            except Exception as exc:
                logger.exception("support outbox failed")
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
            if retry_in and status == "pending":
                row.next_attempt_at = utcnow() + timedelta(seconds=retry_in)

    def _rating_callback(self, query: dict[str, Any]) -> bool:
        data = str(query.get("data") or "")
        if not data.startswith("rate:"):
            return False
        chat_id = int(((query.get("message") or {}).get("chat") or {}).get("id") or query["from"]["id"])
        user_id, _ = self._user({**(query.get("from") or {}), "id": chat_id})
        with transaction() as db:
            ok = support_service.apply_rating(db, db.get(User, user_id), int(data.split(":")[1]))
        if ok:
            try:
                self.client.edit_markup(chat_id, int((query.get("message") or {}).get("message_id") or 0), None)
            except TelegramError:
                pass
            self._send(chat_id, "Спасибо за оценку! 🙏")
        return True

    def run(self) -> None:
        original = self.on_callback

        def _cb(query: dict[str, Any]) -> None:
            if not self._rating_callback(query):
                original(query)

        self.on_callback = _cb  # type: ignore[method-assign]
        self.client.set_commands([("start", "Начать"), ("menu", "Меню поддержки")])
        logger.info("support bot started")
        threading.Thread(target=self._loop, args=(self.deliver_outbox, 0.5), daemon=True).start()
        self.dispatcher.run_polling()

    def _loop(self, fn, interval: float) -> None:
        while not STOP.is_set():
            try:
                fn()
            except Exception:
                logger.exception("support loop failed")
            STOP.wait(interval)


def _chunks(text: str, size: int) -> list[str]:
    if len(text) <= size:
        return [text]
    out, current = [], ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > size:
            out.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        out.append(current)
    return out


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    bot = SupportBot()

    def _stop(signum, frame):  # pragma: no cover
        STOP.set()
        bot.dispatcher.stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _stop)
    bot.run()


if __name__ == "__main__":
    main()
