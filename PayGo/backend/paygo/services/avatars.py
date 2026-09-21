"""Client Telegram profile photos → a compressed copy under ``uploads/avatars`` for the admin panel.

Both bots call ``refresh_if_stale`` from ``users.get_or_create`` on every update. That call is
cheap (two timestamps and a set); the Bot API round trips run in a small background pool at most
once a day per client and never touch the handler's session. The picture is shrunk to 128 px JPEG
(a few kilobytes) so chats, profiles and request cards stay fast, and is served to signed-in staff
only through the ``/files`` endpoint. No photo, a closed profile or a Telegram error → ``avatar_url``
is emptied (the panel shows the initial) and the check is repeated the next day.
"""
from __future__ import annotations

import io
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import transaction
from ..models import User
from ..utils import as_utc, utcnow

logger = logging.getLogger("paygo.avatars")

REFRESH_AFTER = timedelta(hours=24)
MIN_SIDE = 96  # the smallest Telegram size (160/320/640 px) that still looks sharp at 128 px
THUMB = (128, 128)
JPEG_QUALITY = 72
MAX_BYTES = 4 * 1024 * 1024

_http = httpx.Client(
    timeout=httpx.Timeout(connect=6.0, read=20.0, write=8.0, pool=6.0),
    limits=httpx.Limits(max_connections=4, max_keepalive_connections=2, keepalive_expiry=60.0),
    headers={"User-Agent": "PayGo/1.0"},
    follow_redirects=False,
)
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="avatars")
_inflight: set[int] = set()
_lock = threading.Lock()


def _tokens() -> list[str]:
    """Main bot first, then the support bot: a client may have started only one of them."""
    settings = get_settings()
    return [t for t in (settings.main_bot_token, settings.support_bot_token) if t]


def enabled() -> bool:
    """A bot token is configured and this is not the test environment.

    Bot tests configure a fake token to build the bot; nothing here may reach the network from a test run."""
    settings = get_settings()
    return settings.app_env.strip().lower() != "test" and bool(_tokens())


def refresh_if_stale(db: Session, user: User) -> bool:
    """Queue a background refresh when the avatar was never checked or the check is a day old.

    Runs on every incoming update, so it only compares two timestamps and touches a set. The
    Telegram calls happen in the pool and the result is written in a transaction of its own, never
    through ``db``. Returns True when a job was queued."""
    if not enabled():
        return False
    checked = as_utc(user.avatar_checked_at)
    if checked is not None and utcnow() - checked < REFRESH_AFTER:
        return False
    telegram_id = int(user.telegram_id)
    with _lock:
        if telegram_id in _inflight:
            return False
        _inflight.add(telegram_id)
    try:
        _pool.submit(_job, telegram_id)
    except RuntimeError:  # interpreter shutting down: the pool no longer accepts work
        with _lock:
            _inflight.discard(telegram_id)
        return False
    return True


def _job(telegram_id: int) -> None:
    try:
        fetch_and_store(telegram_id)
    finally:
        with _lock:
            _inflight.discard(telegram_id)


def fetch_and_store(telegram_id: int, *, token: str = "") -> str:
    """Download, shrink and save the client's current profile photo; returns the new ``avatar_url``.

    Synchronous: the pool runs it in the background, tests and tools call it directly. Without
    ``token`` the main bot is tried first, then the support bot. Never raises — no photo or a
    Telegram error leaves ``avatar_url`` empty (an old file is removed) with ``avatar_checked_at``
    set, so the next attempt is a day later."""
    telegram_id = int(telegram_id)
    tokens = [token] if token else _tokens()
    if not tokens:
        return ""
    raw = b""
    for index, tok in enumerate(tokens, 1):
        try:
            raw = _fetch_photo(tok, telegram_id)
            break  # an answer (photo or none) is final: profile privacy applies to every bot alike
        except Exception as exc:  # this bot never met the client, or network trouble → the other bot
            logger.info("avatar of %s via bot %d/%d: %s", telegram_id, index, len(tokens), str(exc).replace(tok, "***"))
    url = ""
    if raw:
        try:
            url = _store(telegram_id, raw)
        except Exception as exc:  # not a picture Pillow can read
            logger.warning("avatar of %s could not be converted: %s", telegram_id, exc)
    if not url:
        _remove(telegram_id)
    try:
        _record(telegram_id, url)
    except Exception as exc:
        logger.warning("avatar of %s not recorded: %s", telegram_id, exc)
    return url


# ---------------------------------------------------------------- Telegram (tests monkeypatch these two)

def _tg_get(token: str, method: str, **params: Any) -> Any:
    """One Bot API call → its ``result``; raises on any error."""
    response = _http.get(f"{get_settings().telegram_api_base}/bot{token}/{method}", params=params)
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError(f"{method}: {body.get('description') or 'HTTP ' + str(response.status_code)}")
    return body.get("result")


def _download(url: str) -> bytes:
    """The file behind ``getFile`` (the url carries the bot token: it is never logged)."""
    response = _http.get(url)
    if response.status_code != 200:
        raise RuntimeError(f"download: HTTP {response.status_code}")
    if len(response.content) > MAX_BYTES:
        raise RuntimeError("download: file too large")
    return response.content


def _pick_size(sizes: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The smallest size still at least MIN_SIDE wide, else the largest one available."""
    sizes = [s for s in sizes if isinstance(s, dict) and s.get("file_id")]
    if not sizes:
        return None
    enough = [s for s in sizes if int(s.get("width") or 0) >= MIN_SIDE]
    return min(enough, key=lambda s: int(s.get("width") or 0)) if enough else max(sizes, key=lambda s: int(s.get("width") or 0))


def _fetch_photo(token: str, telegram_id: int) -> bytes:
    """Bytes of the client's current profile photo through one bot; b"" when the profile shows none."""
    result = _tg_get(token, "getUserProfilePhotos", user_id=telegram_id, limit=1) or {}
    photos = result.get("photos") or []
    size = _pick_size(photos[0] if photos else [])
    if size is None:
        return b""
    meta = _tg_get(token, "getFile", file_id=size["file_id"]) or {}
    file_path = str(meta.get("file_path") or "")
    if not file_path:
        raise RuntimeError("getFile: no file_path")
    return _download(f"{get_settings().telegram_api_base}/file/bot{token}/{file_path}")


# ---------------------------------------------------------------- storage

def _avatar_path(telegram_id: int) -> Path:
    return get_settings().uploads_dir() / "avatars" / f"{telegram_id}.jpg"


def _store(telegram_id: int, raw: bytes) -> str:
    """Shrink to THUMB, save as JPEG under uploads/avatars and return the relative url."""
    with Image.open(io.BytesIO(raw)) as src:
        img = src.convert("RGB")
    img.thumbnail(THUMB)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    path = _avatar_path(telegram_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(buf.getvalue())
    os.replace(tmp, path)  # the files endpoint never sees a half-written picture
    return f"/uploads/avatars/{telegram_id}.jpg"


def _remove(telegram_id: int) -> None:
    try:
        _avatar_path(telegram_id).unlink(missing_ok=True)
    except OSError:
        pass


def _record(telegram_id: int, url: str) -> None:
    """Write the result in a transaction of its own (the bot handler's session is never touched).

    A brand-new client may not be committed yet when the picture is ready: look again shortly."""
    for attempt in range(3):
        with transaction() as db:
            user = db.execute(select(User).where(User.telegram_id == telegram_id)).scalar_one_or_none()
            if user is not None:
                user.avatar_url = url
                user.avatar_checked_at = utcnow()
                return
        if attempt < 2:
            time.sleep(1.0)
    logger.info("avatar of %s: no such user", telegram_id)
