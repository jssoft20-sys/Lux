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
    "brand_name": "PayGo",
    "support_username": "@PayOperator_bot",
    # ---- bot texts (editable: Меню → Настройки → Тексты бота). Placeholders: {name} {support} {cash} {emoji}
    #      {player} {amount} {cur} {min} {max} {minutes} {reason} {sla} {city} {address} {have} {need}.
    #      HTML allowed (<b>, <i>, <blockquote>); premium emoji: [emoji:ID]😎
    "greeting_text": "[emoji:5199885118214255386:👋] Привет {name} в PayGo!\n\n[emoji:5258203794772085854:⚡️] Пополнение: 1-5 сек\n[emoji:5278467510604160626:💰] Быстрые выводы\n[emoji:5269617636001460986:👩‍💻] Работаем: 24/7\n\n<blockquote>[emoji:5409015472517553802:🔝] Лучший сервис для пополнений и выводов</blockquote>\n\n[emoji:5443038326535759644:💬] Оператор: {support}",
    "greeting_sticker": "[emoji:5278702045883292456:🛍]",
    "text_help": "[emoji:5443038326535759644:💬] Оператор: {support}\n\nИнструкция, профиль и реферальная программа — кнопки ниже.",
    "text_paused": "Бот временно выключен",
    "text_blocked": "⛔ Аккаунт заблокирован. Напишите оператору: {support}",
    "menu_deposit_label": "📥 Пополнить",
    "menu_withdraw_label": "📤 Вывести",
    "menu_help_label": "✉️ Помощь",
    "text_choose_site_deposit": "[emoji:5375410291184002717:👍] Выберите сайт для пополнения:",
    "text_choose_site_withdraw": "[emoji:5375410291184002717:👍] Выберите сайт для вывода:",
    "text_enter_id_deposit": "Введите ваш ID от {emoji} {cash}",
    "text_enter_amount": "Введите сумму пополнения:\nМинимум: {min} сом\nМаксимум: {max} сом",
    "text_pay_card": "[emoji:5397782960512444700:📌] Ваш ID: {player}\n[emoji:5255981634527704754:💵] Сумма к оплате: {amount}\n[emoji:5370844655049008958:⏰] Оплатите в течении {minutes} минут",
    "text_send_receipt": "Отправьте скриншот чека после оплаты 🖼",
    "text_receipt_ok": "✅ Чек получен. Зачисление произойдёт автоматически после поступления платежа.",
    "text_deposit_cancelled": "[emoji:5384234898494088007:❌] Пополнение отменено\n[emoji:5879785854284599288:ℹ️] Не переводите по старым реквизитам. Создайте новую заявку нажав на пополнить.",
    "text_deposit_success": "✅ Пополнено\n💸 {amount} {cur}\n🆔 {player}",
    "text_deposit_rejected": "❌ Заявка на пополнение отклонена.\n{reason}",
    "text_send_qr": "Отправьте QR код вашего кошелька",
    "text_enter_id_withdraw": "Введите ваш ID для вывода",
    "text_enter_code": "Введите код для вывода",
    "text_bad_withdraw": "💬 Введены неверные данные для вывода",
    "text_withdraw_accepted": "✅ Заявка на вывод принята\n💸 {amount} {cur}\n🆔 {player}\n\n{sla}",
    "text_withdraw_problem": "⚠️ Код принят кассой, но сумма не получена. Заявка передана оператору — повторно код отправлять не нужно.\n🆔 {player}",
    "text_withdraw_processing": "⏳ Ваш вывод {amount} {cur} взят в обработку оператором.",
    "text_withdraw_done": "✅ Вывод выполнен\n💸 {amount} {cur}\n🆔 {player}\n\nДеньги отправлены на ваш кошелёк.",
    "text_withdraw_failed": "❌ Заявка на вывод отклонена.\n{reason}",
    "text_id_not_found": "ID не найден. Проверьте номер и введите ещё раз",
    "text_currency_mismatch": "❌ Валюта аккаунта ({have}) не совпадает с валютой кассы ({need}).\nВведите другой ID — счёт в {need}.",
    "instruction_text": (
        "📌 Инструкция по выводу\n\n"
        "1. Откройте кассу букмекера и выберите «Вывести со счёта»\n"
        "2. Укажите сумму вывода\n"
        "3. Город: {city}\n"
        "4. Адрес: {address}\n"
        "5. Подтвердите операцию и получите код\n"
        "6. Отправьте код сюда\n\n"
        "⛔️ Код одноразовый — используйте только свежий."
    ),
    "instruction_photo": "",
    "withdraw_city": "Бишкек",
    "withdraw_address": "ул. PayGo Online",
    "withdraw_sla_text": "Вывод обычно занимает от 5 минут до 24 часов.",
    # bot behaviour
    "receipt_request_enabled": True,
    "premium_emoji_enabled": True,
    "button_styles_enabled": True,
    "deposit_presets": "500,1000,2000,3000,5000,10000",
    # QR card (photo sent to the client)
    "qr_card_title": "ОТСКАНИРУЙТЕ QR",
    "qr_card_subtitle": "В любом банке",
    "qr_overlay_text": "ПОПОЛНЕНИЯ ДЛЯ ОНЛАЙН КАЗИНО",
    "qr_watermark_text": "PAYGO",
    # requisites: random — случайный из включённых, priority — по приоритету (один основной)
    "requisite_mode": "random",
    # webhook protection (in addition to the secret in the URL)
    "webhook_ip_allowlist": "",
    "webhook_require_signature": False,
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
    "support_greeting": "Здравствуйте! Это поддержка PayGo. Опишите вопрос одним сообщением — большинство вопросов решаются автоматически.",
    "support_rate_limit_messages": 6,
    "support_rate_limit_window_seconds": 20,
    "support_cooldown_seconds": 45,
    "support_debounce_seconds": 1.5,
    "support_duplicate_window_seconds": 600,
    "support_escalation_cooldown_seconds": 300,
    "support_auto_resolve_hours": 48,
    # operator quick replies (editable in the admin panel: Меню → Быстрые ответы)
    "custom_quick_replies": [
        {"id": "q1", "title": "Проверяю", "text": "Здравствуйте, {name}! Проверяю вашу заявку, ответ будет в течение нескольких минут."},
        {"id": "q2", "title": "Зачислено", "text": "Средства зачислены на счёт ID {id}. Проверьте баланс в кассе. Спасибо, что вы с PayGo!"},
        {"id": "q3", "title": "Нужен чек", "text": "Пришлите, пожалуйста, скриншот чека об оплате (сумма, время и номер операции), чтобы мы нашли платёж."},
        {"id": "q4", "title": "Вывод в работе", "text": "Ваш вывод принят в обработку. Обычно это занимает от 5 минут до 24 часов — как только средства уйдут, придёт уведомление."},
        {"id": "q5", "title": "Код не подходит", "text": "Код вывода не найден или уже использован. Создайте новый код в кассе (Город: Бишкек, Адрес: ул. PayGo 24/7) и отправьте его боту."},
    ],
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


def reset_keys(db: Session, keys: list[str]) -> list[str]:
    """Drop stored overrides so the built-in defaults apply again."""
    global _CACHE_AT
    removed: list[str] = []
    for key in keys:
        row = db.get(SystemSetting, key)
        if row is not None:
            db.delete(row)
            removed.append(key)
    db.flush()
    with _LOCK:
        _CACHE_AT = 0.0
    return removed


TEXT_KEYS = [k for k in DEFAULTS if k.startswith("text_") or k in {"greeting_text", "greeting_sticker", "instruction_text", "menu_deposit_label", "menu_withdraw_label", "menu_help_label"}]
