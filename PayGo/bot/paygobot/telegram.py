"""Minimal, robust Telegram Bot API client (sync httpx, keep-alive, retries on 429/5xx).

Financial safety: ``call`` never retries on 4xx other than 429 and never retries
methods that must not be duplicated (``sendMessage`` is idempotent enough for UI;
the bot layer itself deduplicates updates and callbacks).
"""
from __future__ import annotations

import json
import logging
import mimetypes
import threading
import time
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("paygobot.telegram")


class TelegramError(Exception):
    def __init__(self, description: str, code: int = 0, retry_after: int = 0):
        super().__init__(description)
        self.description = description
        self.code = code
        self.retry_after = retry_after

    @property
    def fatal_for_chat(self) -> bool:
        low = self.description.lower()
        return any(x in low for x in ("bot was blocked", "chat not found", "user is deactivated", "bot can't initiate", "chat_write_forbidden"))

    @property
    def not_modified(self) -> bool:
        return "message is not modified" in self.description.lower()

    @property
    def parse_error(self) -> bool:
        """Markup rejected (bad HTML, custom emoji not allowed for this bot, button icon/style unsupported)."""
        low = self.description.lower()
        return self.code == 400 and any(x in low for x in ("can't parse", "cant parse", "entities", "custom emoji", "custom_emoji", "icon", "style", "button_text", "unsupported"))

    @property
    def cant_edit(self) -> bool:
        low = self.description.lower()
        return "message to edit not found" in low or "message can't be edited" in low or "there is no text in the message" in low or "message is too old" in low


class TelegramClient:
    def __init__(self, token: str, api_base: str = "https://api.telegram.org"):
        self.token = token
        self.api_base = api_base.rstrip("/")
        self._http = httpx.Client(
            timeout=httpx.Timeout(20.0, connect=6.0),
            limits=httpx.Limits(max_connections=128, max_keepalive_connections=48, keepalive_expiry=60.0),
            headers={"User-Agent": "PayGoXBot/1.0"},
        )
        self._file_ids: dict[str, str] = {}
        self._lock = threading.Lock()

    # -------------------------------------------------------------- low level
    def call(self, method: str, payload: dict[str, Any] | None = None, *, timeout: float | None = None, retries: int = 2, files: dict | None = None) -> Any:
        url = f"{self.api_base}/bot{self.token}/{method}"
        attempt = 0
        while True:
            attempt += 1
            try:
                if files:
                    data = {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)) for k, v in (payload or {}).items() if v is not None}
                    response = self._http.post(url, data=data, files=files, timeout=timeout or 60)
                else:
                    response = self._http.post(url, json=payload or {}, timeout=timeout or 20)
                body = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                if attempt <= retries:
                    time.sleep(min(5.0, 0.5 * attempt))
                    continue
                raise TelegramError(f"network: {exc}") from exc
            if body.get("ok"):
                return body.get("result")
            description = str(body.get("description") or "unknown error")
            code = int(body.get("error_code") or response.status_code or 0)
            retry_after = int((body.get("parameters") or {}).get("retry_after") or 0)
            if code == 429 and attempt <= retries + 2:
                time.sleep(min(20, retry_after or 1))
                continue
            if code >= 500 and attempt <= retries:
                time.sleep(min(5.0, 0.7 * attempt))
                continue
            raise TelegramError(description, code, retry_after)

    # -------------------------------------------------------------- helpers
    def get_updates(self, offset: int, timeout: int = 30, allowed: list[str] | None = None) -> list[dict[str, Any]]:
        return self.call("getUpdates", {"offset": offset, "timeout": timeout, "limit": 100, "allowed_updates": allowed or ["message", "callback_query"]}, timeout=timeout + 10, retries=0) or []

    def answer_callback(self, callback_id: str, text: str = "", alert: bool = False) -> None:
        try:
            self.call("answerCallbackQuery", {"callback_query_id": callback_id, "text": text[:190], "show_alert": bool(alert)}, timeout=8, retries=0)
        except TelegramError as exc:
            if "query is too old" not in exc.description.lower() and "query id is invalid" not in exc.description.lower():
                logger.debug("answerCallbackQuery failed: %s", exc)

    def send_message(self, chat_id: int, text: str, *, markup: dict | None = None, protect: bool = False, reply_to: int | None = None, parse_mode: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": int(chat_id), "text": text[:4096], "disable_web_page_preview": True}
        if markup is not None:
            payload["reply_markup"] = markup
        if protect:
            payload["protect_content"] = True
        if reply_to:
            payload["reply_parameters"] = {"message_id": int(reply_to), "allow_sending_without_reply": True}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        return self.call("sendMessage", payload)

    def edit_text(self, chat_id: int, message_id: int, text: str, *, markup: dict | None = None, parse_mode: str | None = None) -> dict[str, Any] | bool:
        payload: dict[str, Any] = {"chat_id": int(chat_id), "message_id": int(message_id), "text": text[:4096], "disable_web_page_preview": True}
        payload["reply_markup"] = markup if markup is not None else {"inline_keyboard": []}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        return self.call("editMessageText", payload, retries=0)

    def edit_caption(self, chat_id: int, message_id: int, caption: str, *, markup: dict | None = None, parse_mode: str | None = None) -> Any:
        payload: dict[str, Any] = {"chat_id": int(chat_id), "message_id": int(message_id), "caption": caption[:1024]}
        payload["reply_markup"] = markup if markup is not None else {"inline_keyboard": []}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        return self.call("editMessageCaption", payload, retries=0)

    def edit_media(self, chat_id: int, message_id: int, photo: bytes, *, caption: str = "", markup: dict | None = None, parse_mode: str | None = None, filename: str = "status.png") -> Any:
        """Replace the photo of a sent message (a paid/cancelled/expired request loses its QR and links)."""
        media: dict[str, Any] = {"type": "photo", "media": "attach://photo", "caption": caption[:1024]}
        if parse_mode:
            media["parse_mode"] = parse_mode
        payload: dict[str, Any] = {"chat_id": int(chat_id), "message_id": int(message_id), "media": media, "reply_markup": markup if markup is not None else {"inline_keyboard": []}}
        return self.call("editMessageMedia", payload, files={"photo": (filename, bytes(photo), "image/png")}, retries=0, timeout=30)

    def edit_markup(self, chat_id: int, message_id: int, markup: dict | None) -> Any:
        return self.call("editMessageReplyMarkup", {"chat_id": int(chat_id), "message_id": int(message_id), "reply_markup": markup or {"inline_keyboard": []}}, retries=0)

    def delete_message(self, chat_id: int, message_id: int) -> bool:
        try:
            self.call("deleteMessage", {"chat_id": int(chat_id), "message_id": int(message_id)}, retries=0, timeout=8)
            return True
        except TelegramError:
            return False

    def send_photo(self, chat_id: int, photo: str | bytes | Path, *, caption: str = "", markup: dict | None = None, protect: bool = False, filename: str = "photo.png", parse_mode: str | None = None, reply_to: int | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": int(chat_id), "caption": caption[:1024]}
        if markup is not None:
            payload["reply_markup"] = markup
        if protect:
            payload["protect_content"] = True
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_to:
            payload["reply_parameters"] = {"message_id": int(reply_to), "allow_sending_without_reply": True}
        if isinstance(photo, (bytes, bytearray)):
            return self.call("sendPhoto", payload, files={"photo": (filename, bytes(photo), "image/png")})
        if isinstance(photo, Path):
            key = f"{photo}:{photo.stat().st_mtime_ns}"
            with self._lock:
                cached = self._file_ids.get(key)
            if cached:
                try:
                    return self.call("sendPhoto", {**payload, "photo": cached})
                except TelegramError as exc:
                    if exc.fatal_for_chat:
                        raise
            mime = mimetypes.guess_type(photo.name)[0] or "application/octet-stream"
            result = self.call("sendPhoto", payload, files={"photo": (photo.name, photo.read_bytes(), mime)})
            try:
                file_id = str((result.get("photo") or [])[-1].get("file_id") or "")
                if file_id:
                    with self._lock:
                        self._file_ids[key] = file_id
            except Exception:
                pass
            return result
        return self.call("sendPhoto", {**payload, "photo": str(photo)})

    def send_video(self, chat_id: int, video: str | Path, *, caption: str = "", markup: dict | None = None, protect: bool = False, reply_to: int | None = None, parse_mode: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": int(chat_id), "caption": caption[:1024], "supports_streaming": True}
        if markup is not None:
            payload["reply_markup"] = markup
        if protect:
            payload["protect_content"] = True
        if reply_to:
            payload["reply_parameters"] = {"message_id": int(reply_to), "allow_sending_without_reply": True}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if isinstance(video, Path):
            key = f"{video}:{video.stat().st_mtime_ns}"
            with self._lock:
                cached = self._file_ids.get(key)
            if cached:
                try:
                    return self.call("sendVideo", {**payload, "video": cached}, timeout=60)
                except TelegramError as exc:
                    if exc.fatal_for_chat:
                        raise
            mime = mimetypes.guess_type(video.name)[0] or "video/mp4"
            result = self.call("sendVideo", payload, files={"video": (video.name, video.read_bytes(), mime)}, timeout=120)
            try:
                file_id = str(((result or {}).get("video") or {}).get("file_id") or "")
                if file_id:
                    with self._lock:
                        self._file_ids[key] = file_id
            except Exception:
                pass
            return result
        return self.call("sendVideo", {**payload, "video": str(video)}, timeout=60)

    def get_file_url(self, file_id: str) -> str:
        result = self.call("getFile", {"file_id": file_id}, timeout=15)
        path = str((result or {}).get("file_path") or "")
        return f"{self.api_base}/file/bot{self.token}/{path}" if path else ""

    def download(self, url: str, max_bytes: int = 12 * 1024 * 1024) -> bytes:
        with self._http.stream("GET", url, timeout=30) as response:
            response.raise_for_status()
            chunks = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise TelegramError("file too large")
                chunks.append(chunk)
        return b"".join(chunks)

    def set_commands(self, commands: list[tuple[str, str]]) -> None:
        try:
            self.call("setMyCommands", {"commands": [{"command": c, "description": d} for c, d in commands]}, retries=0)
        except TelegramError as exc:
            logger.warning("setMyCommands failed: %s", exc)

    def delete_webhook(self) -> None:
        try:
            self.call("deleteWebhook", {"drop_pending_updates": False}, retries=0)
        except TelegramError as exc:
            logger.warning("deleteWebhook failed: %s", exc)

    def get_me(self) -> dict[str, Any]:
        return self.call("getMe", {}, retries=1) or {}


def url_buttons(buttons: Any) -> dict[str, Any] | None:
    """Inline keyboard of URL buttons (one per row) from an outbox payload ``[{"text","url"}]``."""
    rows = []
    for b in buttons or []:
        if isinstance(b, dict) and b.get("text") and b.get("url"):
            rows.append([{"text": str(b["text"])[:64], "url": str(b["url"])}])
    return inline_keyboard(*rows) if rows else None


def callback_buttons(rows: Any) -> dict[str, Any] | None:
    """Inline keyboard with callback buttons from an outbox payload ``[[{"text","callback_data"}], ...]``."""
    out = []
    for row in rows or []:
        items = [{"text": str(b["text"])[:64], "callback_data": str(b["callback_data"])[:64]} for b in (row or []) if isinstance(b, dict) and b.get("text") and b.get("callback_data")]
        if items:
            out.append(items)
    return inline_keyboard(*out) if out else None


def inline_keyboard(*rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"inline_keyboard": [list(row) for row in rows if row]}


def rating_keyboard() -> dict[str, Any]:
    """⭐ 1…5 under «Обращение закрыто» (both bots handle ``rate:N``)."""
    return inline_keyboard([{"text": "⭐ " + str(i), "callback_data": f"rate:{i}"} for i in range(1, 6)])


def reply_keyboard(*rows: list[dict[str, Any] | str], placeholder: str = "", one_time: bool = False) -> dict[str, Any]:
    """Persistent bottom keyboard (Пополнить / Вывести / Помощь)."""
    keyboard = [[{"text": b} if isinstance(b, str) else b for b in row] for row in rows if row]
    markup: dict[str, Any] = {"keyboard": keyboard, "resize_keyboard": True, "is_persistent": True, "one_time_keyboard": bool(one_time)}
    if placeholder:
        markup["input_field_placeholder"] = placeholder[:64]
    return markup


def remove_keyboard() -> dict[str, Any]:
    return {"remove_keyboard": True}


def button(text: str, callback: str | None = None, *, url: str | None = None, icon: str = "", style: str = "") -> dict[str, Any]:
    """Inline or reply button. ``icon`` is a custom-emoji id, ``style`` one of primary/success/danger (Bot API 9.4+)."""
    item: dict[str, Any] = {"text": text}
    if url:
        item["url"] = url
    elif callback is not None:
        item["callback_data"] = (callback or "noop")[:64]
    if icon:
        item["icon_custom_emoji_id"] = str(icon)
    if style:
        item["style"] = style
    return item


def strip_button_extras(markup: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop icon/style fields (fallback when the Bot API rejects them)."""
    if not markup:
        return markup
    out = {k: v for k, v in markup.items() if k not in {"inline_keyboard", "keyboard"}}
    for key in ("inline_keyboard", "keyboard"):
        if key in markup:
            out[key] = [[{k: v for k, v in b.items() if k not in {"icon_custom_emoji_id", "style"}} for b in row] for row in markup[key]]
    return out
