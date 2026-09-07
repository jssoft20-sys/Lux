"""Incoming Telegram media (photo, voice, video, documents…) → private uploads for the admin chat.

Both bots use it: the support bot stores everything a client sends, the main bot stores
files that belong to an operator dialog carried by it. Files land under
``DATA_DIR/uploads/support/`` and are served to signed-in staff only.
"""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Any

from paygo.utils import sha256_hex

from .telegram import TelegramClient

logger = logging.getLogger("paygobot.media")

MEDIA_KEYS = ("photo", "document", "video", "voice", "video_note", "audio", "animation", "sticker")
MAX_BYTES = 20 * 1024 * 1024  # Bot API getFile limit
DEFAULT_EXT = {"photo": "jpg", "voice": "ogg", "audio": "mp3", "video": "mp4", "video_note": "mp4", "animation": "mp4", "sticker": "webp", "document": "bin"}
ALLOWED_EXT = {"jpg", "jpeg", "png", "webp", "gif", "ogg", "oga", "opus", "mp3", "m4a", "aac", "wav", "mp4", "mov", "webm", "pdf", "txt", "bin", "tgs", "doc", "docx", "xls", "xlsx", "zip"}


def describe(message: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Return (kind, telegram file object) for the media in a message, or ("", None)."""
    photos = message.get("photo")
    if photos:
        return "photo", photos[-1]
    for key in MEDIA_KEYS:
        obj = message.get(key)
        if isinstance(obj, dict) and obj.get("file_id"):
            return key, obj
    return "", None


def is_image_document(message: dict[str, Any]) -> bool:
    doc = message.get("document") or {}
    return isinstance(doc, dict) and str(doc.get("mime_type") or "").startswith("image/")


def _extension(kind: str, obj: dict[str, Any]) -> str:
    if kind == "voice":
        return "ogg"  # Telegram voice notes are always OGG/Opus
    name = str(obj.get("file_name") or "")
    if "." in name:
        ext = name.rsplit(".", 1)[-1].lower()
        if ext in ALLOWED_EXT:
            return ext
    mime = str(obj.get("mime_type") or "")
    if mime:
        guess = mimetypes.guess_extension(mime.split(";")[0].strip()) or ""
        guess = guess.lstrip(".").lower()
        if guess == "jpe":
            guess = "jpg"
        if guess in ALLOWED_EXT:
            return guess
    if kind == "sticker" and obj.get("is_video"):
        return "webm"
    if kind == "sticker" and obj.get("is_animated"):
        return "tgs"
    return DEFAULT_EXT.get(kind, "bin")


def fetch(client: TelegramClient, message: dict[str, Any], folder: Path) -> tuple[str, str, str]:
    """Download the media of ``message`` into ``folder``.

    Returns (kind, relative url like ``/uploads/support/<name>``, original file name).
    The url is empty when the file could not be fetched (too big, network)."""
    kind, obj = describe(message)
    if not kind or obj is None:
        return "", "", ""
    file_name = str(obj.get("file_name") or "")
    size = int(obj.get("file_size") or 0)
    if size > MAX_BYTES:
        return kind, "", file_name
    try:
        url = client.get_file_url(str(obj["file_id"]))
        if not url:
            return kind, "", file_name
        raw = client.download(url, max_bytes=MAX_BYTES)
    except Exception as exc:  # network / too large
        logger.info("media fetch failed (%s): %s", kind, exc)
        return kind, "", file_name
    ext = _extension(kind, obj)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{sha256_hex(raw)[:24]}.{ext}"
    path = folder / name
    if not path.exists():
        path.write_bytes(raw)
    return kind, f"/uploads/support/{name}", file_name
