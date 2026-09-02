import json
import mimetypes
import os
import threading
import time
from pathlib import Path

import httpx

BASE = Path(__file__).resolve().parents[1]
CONFIG = BASE / "config.json"
_CFG_LOCK = threading.RLock()
_CFG_CACHE = {}
_CFG_MTIME = 0.0

# Один пул соединений для локального API и Telegram — без нового TCP/TLS на каждый запрос.
_HTTP = httpx.Client(
    timeout=httpx.Timeout(35.0, connect=8.0),
    limits=httpx.Limits(max_connections=256, max_keepalive_connections=96, keepalive_expiry=45.0),
    headers={"User-Agent": "LuxonBot/10.44"},
)

# Кэш file_id для локальных картинок. Файл заливается в Telegram один раз,
# дальше рассылка идёт по file_id — без повторной загрузки мегабайт на каждого клиента.
_FILE_ID_LOCK = threading.Lock()
_FILE_ID_CACHE = {}


def cfg(force=False):
    global _CFG_CACHE, _CFG_MTIME
    with _CFG_LOCK:
        try:
            mt = CONFIG.stat().st_mtime
            if force or mt != _CFG_MTIME or not _CFG_CACHE:
                _CFG_CACHE = json.loads(CONFIG.read_text(encoding="utf-8"))
                _CFG_MTIME = mt
        except Exception:
            if not _CFG_CACHE:
                _CFG_CACHE = {}
        return _CFG_CACHE


def admin_key():
    return str(cfg().get("internal_api_key") or cfg().get("admin_password") or "")


def api(path, method="GET", data=None, params=None, timeout=35):
    base = os.environ.get("LUXON_API_BASE", "http://127.0.0.1:7070/api").rstrip("/")
    url = base + path
    try:
        r = _HTTP.request(
            method,
            url,
            json=data if data is not None else None,
            params=params,
            headers={"X-Admin-Key": admin_key()},
            timeout=timeout,
        )
        try:
            out = r.json() if r.content else {}
        except Exception:
            out = {"ok": False, "message": r.text[:1000], "status": r.status_code}
        if r.is_error and "ok" not in out:
            out["ok"] = False
        return out
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def tg(token, method, data=None, timeout=None):
    timeout = timeout or (40 if method == "getUpdates" else 25)
    r = _HTTP.post(
        f"https://api.telegram.org/bot{token}/{method}",
        json=data or {},
        timeout=timeout,
    )
    out = r.json()
    if not out.get("ok"):
        raise RuntimeError(out)
    return out.get("result")


def send(token, chat_id, text, reply_markup=None, entities=None):
    d = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if reply_markup:
        d["reply_markup"] = reply_markup
    if entities:
        d["entities"] = entities
    try:
        return tg(token, "sendMessage", d)
    except Exception:
        d.pop("entities", None)
        return tg(token, "sendMessage", d)


def _file_id_key(token, path):
    try:
        st = path.stat()
        return f"{token[:12]}:{path}:{int(st.st_mtime)}:{st.st_size}"
    except Exception:
        return ""


def _remember_file_id(key, result):
    if not key or not isinstance(result, dict):
        return
    try:
        fid = str((result.get("photo") or [])[-1].get("file_id") or "")
    except Exception:
        fid = ""
    if fid:
        with _FILE_ID_LOCK:
            if len(_FILE_ID_CACHE) > 512:
                _FILE_ID_CACHE.clear()
            _FILE_ID_CACHE[key] = fid


def _upload_photo(token, chat_id, local_path, caption, reply_markup, caption_entities):
    form = {"chat_id": str(chat_id), "caption": caption or ""}
    if reply_markup:
        form["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    if caption_entities:
        form["caption_entities"] = json.dumps(caption_entities, ensure_ascii=False)
    mime = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    with local_path.open("rb") as fh:
        r = _HTTP.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data=form,
            files={"photo": (local_path.name, fh, mime)},
            timeout=60,
        )
    out = r.json()
    if not out.get("ok") and caption_entities:
        form.pop("caption_entities", None)
        with local_path.open("rb") as fh:
            r = _HTTP.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data=form,
                files={"photo": (local_path.name, fh, mime)},
                timeout=60,
            )
        out = r.json()
    if not out.get("ok"):
        raise RuntimeError(out)
    return out.get("result")


def send_photo(token, chat_id, photo, caption="", reply_markup=None, caption_entities=None):
    photo_value = str(photo or "")
    local_path = None
    if photo_value.startswith("/uploads/"):
        candidate = BASE / photo_value.lstrip("/")
        if candidate.exists() and candidate.is_file():
            local_path = candidate
    elif photo_value and not photo_value.startswith(("http://", "https://")):
        candidate = Path(photo_value)
        if not candidate.is_absolute():
            candidate = BASE / candidate
        if candidate.exists() and candidate.is_file():
            local_path = candidate

    if local_path is not None:
        key = _file_id_key(token, local_path)
        with _FILE_ID_LOCK:
            cached = _FILE_ID_CACHE.get(key, "")
        if cached:
            d = {"chat_id": chat_id, "photo": cached, "caption": caption}
            if reply_markup:
                d["reply_markup"] = reply_markup
            if caption_entities:
                d["caption_entities"] = caption_entities
            try:
                return tg(token, "sendPhoto", d)
            except Exception as exc:
                text = str(exc)
                # Ошибки по самому чату (бот заблокирован и т.д.) — не повод перезаливать файл.
                if "blocked" in text or "chat not found" in text or "deactivated" in text or "Too Many Requests" in text:
                    raise
                d.pop("caption_entities", None)
                try:
                    return tg(token, "sendPhoto", d)
                except Exception:
                    with _FILE_ID_LOCK:
                        _FILE_ID_CACHE.pop(key, None)
        result = _upload_photo(token, chat_id, local_path, caption, reply_markup, caption_entities)
        _remember_file_id(key, result)
        return result

    # Для внешних URL Telegram скачивает изображение самостоятельно.
    if photo_value.startswith("/") and not local_path:
        public_url = str(cfg().get("public_url") or "").rstrip("/")
        if public_url:
            photo_value = public_url + photo_value
    d = {"chat_id": chat_id, "photo": photo_value, "caption": caption}
    if reply_markup:
        d["reply_markup"] = reply_markup
    if caption_entities:
        d["caption_entities"] = caption_entities
    try:
        return tg(token, "sendPhoto", d)
    except Exception:
        d.pop("caption_entities", None)
        return tg(token, "sendPhoto", d)


def delete(token, chat_id, message_id):
    try:
        tg(token, "deleteMessage", {"chat_id": chat_id, "message_id": int(message_id)})
    except Exception:
        pass


def delete_many(token, chat_id, message_ids):
    ids = sorted({int(x) for x in message_ids if x})
    if not ids:
        return
    try:
        tg(token, "deleteMessages", {"chat_id": chat_id, "message_ids": ids})
        return
    except Exception:
        pass
    # Fallback, если сервер Telegram ещё не поддерживает пакетное удаление.
    for mid in ids:
        delete(token, chat_id, mid)


def reply_keyboard(rows, placeholder="Сообщение"):
    normalized = []
    for row in rows:
        normalized.append([{"text": x} if isinstance(x, str) else dict(x) for x in row])
    return {
        "keyboard": normalized,
        "resize_keyboard": True,
        "one_time_keyboard": False,
        "input_field_placeholder": placeholder,
    }
