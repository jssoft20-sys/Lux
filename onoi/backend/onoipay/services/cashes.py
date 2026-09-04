"""Cash desk management: credentials, adapters, health checks, auto-disable thresholds."""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import PaymentCash
from ..providers import ProviderResult, get_adapter, provider_types
from ..utils import decrypt_json, encrypt_json, iso, mask_secret, money, money_or_none, utcnow
from . import settings_store
from .logs import log_event
from .notifications import admin_event

EDITABLE_FIELDS = {
    "name", "enabled", "priority", "currency", "accepted_currency_ids", "ip_address", "base_url",
    "deposit_enabled", "withdraw_enabled", "deposit_min", "deposit_max", "withdraw_min", "withdraw_max",
    "deposit_fee_pct", "withdraw_fee_pct", "auto_disable_enabled", "low_balance_threshold",
    "critical_balance_threshold", "auto_enable_threshold", "max_daily_limit", "instructions_text", "notes",
}
MONEY_FIELDS = {
    "deposit_min", "deposit_max", "withdraw_min", "withdraw_max", "low_balance_threshold",
    "critical_balance_threshold", "auto_enable_threshold", "max_daily_limit",
}
BOOL_FIELDS = {"enabled", "deposit_enabled", "withdraw_enabled", "auto_disable_enabled"}


def credentials(cash: PaymentCash) -> dict[str, Any]:
    try:
        return decrypt_json(cash.credentials_enc)
    except Exception:
        return {}


def adapter(cash: PaymentCash):
    return get_adapter(cash, credentials(cash))


def list_cashes(db: Session, *, enabled_only: bool = False) -> list[PaymentCash]:
    stmt = select(PaymentCash).order_by(PaymentCash.priority.asc(), PaymentCash.id.asc())
    if enabled_only:
        stmt = stmt.where(PaymentCash.enabled.is_(True))
    return list(db.execute(stmt).scalars().all())


def get_cash(db: Session, key_or_id: str | int) -> PaymentCash | None:
    if isinstance(key_or_id, int) or str(key_or_id).isdigit():
        return db.get(PaymentCash, int(key_or_id))
    return db.execute(select(PaymentCash).where(PaymentCash.key == str(key_or_id).lower())).scalar_one_or_none()


def deposit_available(db: Session, cash: PaymentCash) -> str:
    """Empty string when deposits are possible, otherwise a human reason."""
    if settings_store.get_bool(db, "bot_paused"):
        return "Бот на паузе"
    if not settings_store.get_bool(db, "deposits_enabled", True):
        return "Пополнение временно отключено"
    if not cash.enabled:
        return f"Касса {cash.name} отключена"
    if not cash.deposit_enabled:
        return f"Пополнение {cash.name} временно отключено"
    if cash.auto_disabled:
        return f"Пополнение {cash.name} временно недоступно (касса пополняется)"
    return ""


def withdraw_available(db: Session, cash: PaymentCash) -> str:
    if settings_store.get_bool(db, "bot_paused"):
        return "Бот на паузе"
    if not settings_store.get_bool(db, "withdrawals_enabled", True):
        return "Вывод временно отключён"
    if not cash.enabled:
        return f"Касса {cash.name} отключена"
    if not cash.withdraw_enabled:
        return f"Вывод {cash.name} временно отключён"
    return ""


def currency_matches(cash: PaymentCash, provider_currency: str) -> bool:
    """True when the bookmaker account currency is acceptable for this cash desk.

    ``accepted_currency_ids`` is a comma separated list of provider identifiers
    (e.g. "KGS,417,12"). An empty list disables the check.
    """
    accepted = [x.strip().upper() for x in (cash.accepted_currency_ids or "").split(",") if x.strip()]
    if not accepted or not provider_currency:
        return True
    return str(provider_currency).strip().upper() in accepted


def public_cash(cash: PaymentCash, *, include_secret_shape: bool = True) -> dict[str, Any]:
    creds = credentials(cash) if include_secret_shape else {}
    fields = next((t["fields"] for t in provider_types() if t["type"] == cash.provider_type), [])
    shape = []
    for field in fields:
        value = str(creds.get(field["key"]) or "")
        shape.append({
            "key": field["key"],
            "label": field["label"],
            "required": bool(field.get("required")),
            "secret": bool(field.get("secret")),
            "set": bool(value),
            "masked": mask_secret(value) if field.get("secret") else value,
        })
    return {
        "id": cash.id,
        "key": cash.key,
        "name": cash.name,
        "provider_type": cash.provider_type,
        "enabled": cash.enabled,
        "priority": cash.priority,
        "currency": cash.currency,
        "accepted_currency_ids": cash.accepted_currency_ids,
        "ip_address": cash.ip_address,
        "base_url": cash.base_url,
        "deposit_enabled": cash.deposit_enabled,
        "withdraw_enabled": cash.withdraw_enabled,
        "deposit_min": str(money(cash.deposit_min)),
        "deposit_max": str(money(cash.deposit_max)),
        "withdraw_min": str(money(cash.withdraw_min)),
        "withdraw_max": str(money(cash.withdraw_max)),
        "deposit_fee_pct": str(cash.deposit_fee_pct or 0),
        "withdraw_fee_pct": str(cash.withdraw_fee_pct or 0),
        "auto_disable_enabled": cash.auto_disable_enabled,
        "low_balance_threshold": str(money(cash.low_balance_threshold)),
        "critical_balance_threshold": str(money(cash.critical_balance_threshold)),
        "auto_enable_threshold": str(money(cash.auto_enable_threshold)),
        "max_daily_limit": str(money(cash.max_daily_limit)),
        "auto_disabled": cash.auto_disabled,
        "auto_disabled_at": iso(cash.auto_disabled_at),
        "last_balance": str(money(cash.last_balance)) if cash.last_balance is not None else None,
        "last_limit": str(money(cash.last_limit)) if cash.last_limit is not None else None,
        "last_check_at": iso(cash.last_check_at),
        "last_check_ok": cash.last_check_ok,
        "last_check_message": cash.last_check_message,
        "status": status_of(cash),
        "instructions_text": cash.instructions_text,
        "instruction_photo": cash.instruction_photo,
        "notes": cash.notes,
        "credentials": shape,
        "created_at": iso(cash.created_at),
        "updated_at": iso(cash.updated_at),
    }


def status_of(cash: PaymentCash) -> str:
    if not cash.enabled:
        return "disabled"
    if cash.auto_disabled:
        return "auto_disabled"
    if cash.last_check_ok is False:
        return "error"
    if cash.last_check_ok is None:
        return "unknown"
    if cash.last_balance is not None and money(cash.last_balance) <= money(cash.low_balance_threshold):
        return "low"
    return "online"


def create_cash(db: Session, data: dict[str, Any]) -> PaymentCash:
    key = str(data.get("key") or "").strip().lower()
    provider_type = str(data.get("provider_type") or "").strip().lower()
    if not key or not key.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Ключ кассы: латинские буквы и цифры")
    if provider_type not in {t["type"] for t in provider_types()}:
        raise ValueError("Неизвестный тип кассы")
    if get_cash(db, key):
        raise ValueError("Касса с таким ключом уже существует")
    cash = PaymentCash(key=key, name=str(data.get("name") or key.upper())[:64], provider_type=provider_type, enabled=False)
    db.add(cash)
    db.flush()
    update_cash(db, cash, data)
    return cash


def update_cash(db: Session, cash: PaymentCash, data: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    for field in EDITABLE_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if field in MONEY_FIELDS:
            value = money(value if value not in (None, "") else 0)
        elif field in BOOL_FIELDS:
            value = bool(value) if not isinstance(value, str) else value.lower() in {"1", "true", "yes", "on"}
        elif field == "priority":
            value = int(value or 100)
        elif field in {"deposit_fee_pct", "withdraw_fee_pct"}:
            value = Decimal(str(value or 0))
        else:
            value = str(value or "")
        if getattr(cash, field) != value:
            setattr(cash, field, value)
            changed.append(field)
    if isinstance(data.get("credentials"), dict):
        current = credentials(cash)
        for key, value in data["credentials"].items():
            if value is None:
                continue
            value = str(value)
            if value == "":  # empty = keep existing secret
                continue
            current[str(key)] = value
        cash.credentials_enc = encrypt_json(current)
        changed.append("credentials")
    if data.get("enabled") is True or data.get("auto_disabled") is False:
        cash.auto_disabled = False
        cash.auto_disabled_at = None
    if money_or_none(cash.deposit_min) is not None and money(cash.deposit_max) < money(cash.deposit_min):
        raise ValueError("Максимум пополнения меньше минимума")
    db.flush()
    return changed


def check_cash(db: Session, cash: PaymentCash) -> ProviderResult:
    """Run a live balance check and update status fields."""
    try:
        result = adapter(cash).test_connection()
    except Exception as exc:
        result = ProviderResult(ok=False, message=f"Ошибка проверки: {str(exc)[:200]}")
    cash.last_check_at = utcnow()
    cash.last_check_ok = bool(result.ok)
    cash.last_check_message = (result.message or "")[:400]
    if result.balance is not None:
        cash.last_balance = money(result.balance)
    if result.limit is not None:
        cash.last_limit = money(result.limit)
    db.flush()
    return result


def apply_thresholds(db: Session, cash: PaymentCash, result: ProviderResult) -> None:
    """Auto-disable/enable deposits according to admin-configured thresholds."""
    if not settings_store.get_bool(db, "cash_monitor_enabled", True):
        return
    if not result.ok:
        admin_event(db, "cash_error", f"cash_error:{cash.id}:{utcnow():%Y%m%d%H}", f"{cash.name}: ошибка проверки кассы", result.message or "Нет ответа от API", {"cash_id": cash.id}, level="critical")
        return
    balance = result.balance if result.balance is not None else result.limit
    if balance is None or not cash.auto_disable_enabled:
        return
    balance = money(balance)
    critical = money(cash.critical_balance_threshold)
    low = money(cash.low_balance_threshold)
    resume = max(money(cash.auto_enable_threshold), critical)
    if balance <= critical and not cash.auto_disabled:
        cash.auto_disabled = True
        cash.auto_disabled_at = utcnow()
        log_event(db, "Пополнение выключено автоматически", f"{cash.name} • баланс {balance} ≤ {critical}", level="warning", category="cashes", entity_type="cash", entity_id=cash.id)
        admin_event(db, "cash_critical", f"cash_critical:{cash.id}:{cash.auto_disabled_at:%Y%m%d%H%M}", f"{cash.name}: касса пустая — {balance}", "Пополнение по этой кассе выключено автоматически. Пополните кассу.", {"cash_id": cash.id, "balance": str(balance)}, level="critical")
    elif cash.auto_disabled and balance > resume:
        cash.auto_disabled = False
        cash.auto_disabled_at = None
        log_event(db, "Пополнение включено автоматически", f"{cash.name} • баланс {balance} > {resume}", category="cashes", entity_type="cash", entity_id=cash.id)
        admin_event(db, "cash_recovered", f"cash_recovered:{cash.id}:{utcnow():%Y%m%d%H%M}", f"{cash.name}: касса пополнена — {balance}", "Пополнение по кассе включено автоматически.", {"cash_id": cash.id}, level="normal")
    elif balance <= low and not cash.auto_disabled:
        window = utcnow().strftime("%Y%m%d%H")
        admin_event(db, "cash_low", f"cash_low:{cash.id}:{window}", f"{cash.name}: в кассе мало — {balance}", f"Порог {low}. При {critical} пополнение отключится само.", {"cash_id": cash.id, "balance": str(balance)}, level="normal")
    db.flush()


def monitor_once(db: Session) -> list[dict[str, Any]]:
    out = []
    for cash in list_cashes(db, enabled_only=True):
        result = check_cash(db, cash)
        apply_thresholds(db, cash, result)
        out.append({"cash": cash.key, "ok": result.ok, "balance": str(result.balance) if result.balance is not None else None, "message": result.message})
    return out


def monitor_due(db: Session) -> bool:
    interval = settings_store.get_int(db, "cash_monitor_interval_seconds", 60)
    latest = None
    for cash in list_cashes(db, enabled_only=True):
        if cash.last_check_at and (latest is None or cash.last_check_at > latest):
            latest = cash.last_check_at
    if latest is None:
        return True
    return (utcnow() - latest.replace(tzinfo=latest.tzinfo or utcnow().tzinfo)) >= timedelta(seconds=max(15, interval))
