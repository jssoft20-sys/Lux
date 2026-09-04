"""Small shared helpers: time, ids, money, hashing, encryption."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings

UTC = UTC
_TZ_CACHE: dict[str, ZoneInfo] = {}

TWO_PLACES = Decimal("0.01")


def local_tz() -> ZoneInfo:
    name = get_settings().timezone
    tz = _TZ_CACHE.get(name)
    if tz is None:
        tz = ZoneInfo(name)
        _TZ_CACHE[name] = tz
    return tz


def utcnow() -> datetime:
    return datetime.now(UTC)


def now_local() -> datetime:
    return utcnow().astimezone(local_tz())


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def iso(value: datetime | None) -> str | None:
    value = as_utc(value)
    return value.isoformat(timespec="seconds") if value else None


def fmt_local(value: datetime | None, fmt: str = "%d.%m.%Y %H:%M") -> str:
    value = as_utc(value)
    return value.astimezone(local_tz()).strftime(fmt) if value else "—"


def minutes_from_now(minutes: float) -> datetime:
    return utcnow() + timedelta(minutes=minutes)


def seconds_from_now(seconds: float) -> datetime:
    return utcnow() + timedelta(seconds=seconds)


def money(value: Any) -> Decimal:
    """Parse any numeric input to a Decimal with two places (ROUND_HALF_UP)."""
    if value is None or value == "":
        raise InvalidOperation("empty amount")
    if isinstance(value, Decimal):
        dec = value
    else:
        text = str(value).strip().replace(" ", "").replace(",", ".")
        dec = Decimal(text)
    if not dec.is_finite():
        raise InvalidOperation("non finite amount")
    return dec.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def money_or_none(value: Any) -> Decimal | None:
    try:
        return money(value)
    except Exception:
        return None


def fmt_money(value: Any, currency: str = "") -> str:
    try:
        dec = money(value)
    except Exception:
        return str(value)
    text = f"{dec:,.2f}".replace(",", " ")
    if text.endswith(".00"):
        text = text[:-3]
    return f"{text} {currency}".strip()


def new_public_id(prefix: str) -> str:
    stamp = time.strftime("%y%m%d", time.gmtime())
    return f"{prefix}-{stamp}-{secrets.token_hex(3).upper()}"


def token_urlsafe(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def hmac_hex(key: str, value: str) -> str:
    return hmac.new(key.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(str(a or ""), str(b or ""))


def stable_hash(payload: Any) -> str:
    """Deterministic hash of a JSON-serialisable structure (for idempotency keys)."""
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return sha256_hex(canonical)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def json_loads(value: Any, default: Any = None) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


# --- symmetric encryption for stored credentials -------------------------------

def _aes_key() -> bytes:
    raw = get_settings().encryption_key or ""
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY is not configured")
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_text(plain: str) -> str:
    if plain is None:
        plain = ""
    nonce = os.urandom(12)
    cipher = AESGCM(_aes_key()).encrypt(nonce, plain.encode("utf-8"), b"onoipay")
    return "v1:" + base64.urlsafe_b64encode(nonce + cipher).decode("ascii")


def decrypt_text(blob: str) -> str:
    if not blob:
        return ""
    if not blob.startswith("v1:"):
        raise ValueError("unknown ciphertext version")
    raw = base64.urlsafe_b64decode(blob[3:].encode("ascii"))
    nonce, cipher = raw[:12], raw[12:]
    return AESGCM(_aes_key()).decrypt(nonce, cipher, b"onoipay").decode("utf-8")


def encrypt_json(value: dict[str, Any]) -> str:
    return encrypt_text(json_dumps(value or {}))


def decrypt_json(blob: str) -> dict[str, Any]:
    if not blob:
        return {}
    data = json_loads(decrypt_text(blob), {})
    return data if isinstance(data, dict) else {}


def mask_secret(value: str, keep: int = 3) -> str:
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= keep * 2:
        return "•" * len(value)
    return value[:keep] + "•" * min(8, len(value) - keep * 2) + value[-keep:]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
