"""System settings stored in the database (editable from the admin panel).

Defaults live here; the database only stores overrides. Values are cached for
a few seconds per process so hot paths do not query on every call.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SystemSetting

DEFAULTS: dict[str, Any] = {
    # bot / business
    "bot_paused": False,
    "deposits_enabled": True,
    "withdrawals_enabled": True,
    "brand_name": "OnoiPay",
    "support_username": "@OnoiHelpBot",
    "greeting_text": "👋 Привет, {name}!\n\n💳 Пополнение и вывод средств\n💸 Комиссия — 0%\n🕐 Работаем 24/7\n🔐 Операции защищены\n\n💬 Поддержка: {support}",
    "withdraw_instruction": (
        "📌 Инструкция по выводу\n\n"
        "1. Откройте кассу букмекера и выберите «Вывести со счёта»\n"
        "2. Укажите сумму вывода\n"
        "3. Город: Бишкек\n"
        "4. Адрес: ул. OnoiPay 24/7\n"
        "5. Подтвердите операцию и получите код\n"
        "6. Отправьте код сюда\n\n"
        "⛔️ Код одноразовый — используйте только свежий."
    ),
    "withdraw_city": "Бишкек",
    "withdraw_address": "ул. OnoiPay 24/7",
    "withdraw_sla_text": "Вывод обычно занимает от 5 минут до 24 часов.",
    # deposits
    "payment_timeout_seconds": 300,
    "random_tiyin": True,
    "tiyin_min": 1,
    "tiyin_max": 99,
    "amount_reuse_cooldown_seconds": 120,
    "payment_event_max_age_minutes": 15,
    "deposit_max_active_per_user": 1,
    # withdrawals
    "withdraw_code_min_length": 4,
    "withdraw_processing_timeout_minutes": 60,
    # referrals
    "referral_bonus_pct": 1.0,
    "referral_withdraw_min": 0,
    # cash monitor
    "cash_monitor_enabled": True,
    "cash_monitor_interval_seconds": 60,
    # support
    "support_greeting": "Здравствуйте! Это поддержка OnoiPay. Опишите вопрос одним сообщением — большинство вопросов решаются автоматически.",
    "support_rate_limit_messages": 6,
    "support_rate_limit_window_seconds": 20,
    "support_cooldown_seconds": 45,
    "support_debounce_seconds": 1.5,
    "support_duplicate_window_seconds": 600,
    "support_escalation_cooldown_seconds": 300,
    "support_auto_resolve_hours": 48,
    # notifications
    "notify_new_deposit": True,
    "notify_deposit_success": False,
    "notify_deposit_failed": True,
    "notify_new_withdrawal": True,
    "notify_withdrawal_status": True,
    "notify_cash_critical": True,
    "notify_support_operator": True,
    "notification_sound_critical": "critical",
    # ui
    "ui_poll_seconds": 3,
    "ui_page_size": 30,
    # subscription gate
    "subscription_enabled": False,
    "subscription_channel": "",
    "phone_required": False,
}

_CACHE: dict[str, Any] = {}
_CACHE_AT = 0.0
_CACHE_TTL = 3.0
_LOCK = threading.Lock()


def _load(db: Session) -> dict[str, Any]:
    rows = db.execute(select(SystemSetting)).scalars().all()
    data = dict(DEFAULTS)
    for row in rows:
        if row.key in DEFAULTS or row.key.startswith("custom_"):
            data[row.key] = row.value
    return data


def all_settings(db: Session, fresh: bool = False) -> dict[str, Any]:
    global _CACHE, _CACHE_AT
    now = time.monotonic()
    with _LOCK:
        if not fresh and _CACHE and now - _CACHE_AT < _CACHE_TTL:
            return dict(_CACHE)
    data = _load(db)
    with _LOCK:
        _CACHE = dict(data)
        _CACHE_AT = now
    return data


def get(db: Session, key: str, default: Any = None) -> Any:
    data = all_settings(db)
    if key in data:
        return data[key]
    return DEFAULTS.get(key, default)


def get_int(db: Session, key: str, default: int = 0) -> int:
    try:
        return int(get(db, key, default))
    except Exception:
        return default


def get_float(db: Session, key: str, default: float = 0.0) -> float:
    try:
        return float(get(db, key, default))
    except Exception:
        return default


def get_bool(db: Session, key: str, default: bool = False) -> bool:
    value = get(db, key, default)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def set_many(db: Session, values: dict[str, Any], actor: str = "") -> dict[str, Any]:
    global _CACHE_AT
    changed: dict[str, Any] = {}
    for key, value in values.items():
        if key not in DEFAULTS and not key.startswith("custom_"):
            continue
        default = DEFAULTS.get(key)
        if isinstance(default, bool):
            value = bool(value) if not isinstance(value, str) else value.lower() in {"1", "true", "yes", "on"}
        elif isinstance(default, int) and not isinstance(default, bool):
            value = int(float(value))
        elif isinstance(default, float):
            value = float(value)
        elif isinstance(default, str):
            value = str(value)
        row = db.get(SystemSetting, key)
        if row is None:
            row = SystemSetting(key=key, value=value, updated_by=actor)
            db.add(row)
        else:
            row.value = value
            row.updated_by = actor
        changed[key] = value
    db.flush()
    with _LOCK:
        _CACHE_AT = 0.0
    return changed


def invalidate() -> None:
    global _CACHE_AT
    with _LOCK:
        _CACHE_AT = 0.0
