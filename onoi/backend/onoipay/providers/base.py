from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import httpx

logger = logging.getLogger("onoipay.providers")

_CLIENT = httpx.Client(
    timeout=httpx.Timeout(connect=4.0, read=20.0, write=8.0, pool=4.0),
    limits=httpx.Limits(max_connections=32, max_keepalive_connections=16, keepalive_expiry=90.0),
    headers={"User-Agent": "OnoiPay/1.0", "Accept": "application/json"},
    follow_redirects=False,
)


@dataclass
class ProviderResult:
    ok: bool
    message: str = ""
    status: int = 0
    data: Any = None
    amount: Decimal | None = None
    reference: str = ""
    acknowledged: bool = False  # provider accepted the request but the reply is incomplete
    duplicate: bool = False  # provider says the operation was already performed
    currency: str = ""
    player_name: str = ""
    balance: Decimal | None = None
    limit: Decimal | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "message": self.message,
            "status": self.status,
            "data": self.data,
            "amount": str(self.amount) if self.amount is not None else None,
            "reference": self.reference,
            "acknowledged": self.acknowledged,
            "duplicate": self.duplicate,
            "currency": self.currency,
            "player_name": self.player_name,
            "balance": str(self.balance) if self.balance is not None else None,
            "limit": str(self.limit) if self.limit is not None else None,
        }


def http_json(
    method: str,
    url: str,
    *,
    json: Any = None,
    headers: dict[str, str] | None = None,
    label: str = "provider",
    client: httpx.Client | None = None,
) -> tuple[int, Any]:
    """Single HTTP call — never retried automatically (financial calls must not be duplicated)."""
    started = time.monotonic()
    try:
        response = (client or _CLIENT).request(method, url, json=json, headers=headers or {})
        raw = response.text.strip()
        try:
            parsed: Any = response.json() if raw else {}
        except Exception:
            parsed = {"message": raw[:2000]}
        logger.info("[%s] %s %s -> %s in %.3fs", label, method, url.split("?")[0], response.status_code, time.monotonic() - started)
        return int(response.status_code), parsed
    except Exception as exc:
        logger.warning("[%s] %s %s failed: %s", label, method, url.split("?")[0], type(exc).__name__)
        return 599, {"message": str(exc)[:500]}


def mapping(data: Any) -> dict[str, Any]:
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                return item
    return {}


def _walk(value: Any, keys: set[str], depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z]", "", str(key).lower())
            if normalized in keys and item not in (None, "", 0, "0"):
                yield item
        for item in value.values():
            if isinstance(item, (dict, list)):
                yield from _walk(item, keys, depth + 1)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item, keys, depth + 1)


def extract_amount(data: Any) -> Decimal | None:
    keys = {"amount", "summa", "sum", "value", "withdrawamount", "payoutamount"}
    for item in _walk(data, keys):
        try:
            dec = Decimal(str(item).replace(" ", "").replace(",", "."))
        except Exception:
            continue
        if dec != 0:
            return abs(dec)
    return None


def extract_reference(data: Any) -> str:
    keys = {"id", "withdrawalid", "cashid", "messageid", "operationid", "transactionid", "payoutid"}
    for item in _walk(data, keys):
        return str(item)
    return ""


def extract_currency(data: Any) -> str:
    root = mapping(data)
    for key in ("CurrencyId", "currencyId", "currency_id", "Currency", "currency", "CurrencyCode", "currencyCode"):
        value = root.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def explicit_error(data: Any) -> bool:
    root = mapping(data)
    return bool(root.get("error") or root.get("errorMessage") or root.get("detail"))


def success(status: int, data: Any, *, require_amount: bool = False, require_reference: bool = False) -> bool:
    root = mapping(data)
    explicit = root.get("success", root.get("Success"))
    if not (200 <= int(status or 0) < 300) or explicit_error(data):
        return False
    if isinstance(explicit, str):
        if explicit.strip().lower() not in {"true", "1", "ok", "yes"}:
            return False
    elif explicit is not None and not bool(explicit):
        return False
    amount = extract_amount(data)
    if require_amount and (amount is None or amount <= 0):
        return False
    if require_reference and not (extract_reference(data) or (amount and amount > 0)):
        return False
    return True


def human_error(status: int, data: Any, action: str) -> str:
    root = mapping(data)
    raw = str(
        root.get("message") or root.get("Message") or root.get("errorMessage") or root.get("ErrorMessage")
        or root.get("error") or root.get("detail") or ("" if isinstance(data, dict) else data or "")
    )
    try:
        message_id = int(root.get("MessageId") or root.get("messageId") or root.get("message_id") or 0)
    except Exception:
        message_id = 0
    low = raw.lower()
    if action == "withdraw":
        if message_id == 100586:
            return "Неверный код вывода. Получите новый код в кассе букмекера."
        if message_id == 100406:
            return "У букмекера нет активного запроса на выплату для этого ID. Создайте вывод в кассе и отправьте код."
        if message_id == 100548:
            return "Запрос на выплату отклонён букмекером. Создайте новый запрос на вывод."
        if message_id == 164864:
            return "Этот вывод уже был проведён букмекером. Повторно этот код отправлять не нужно."
    if action == "deposit" and ("запросы на вывод" in low or ("вывод" in low and "пополнение невозможно" in low)):
        return "БК отклонил пополнение: у клиента есть подтверждённый запрос на вывод. Сначала завершите вывод."
    if status == 404 and ("user" in low or "пользоват" in low):
        return "Пользователь с таким ID не найден. Проверьте ID и попробуйте ещё раз."
    if status == 404 and action == "withdraw":
        return "Запрос на вывод для этого клиента не найден."
    if ("неверн" in low and "код" in low) or "invalid code" in low or "wrong code" in low:
        return "Неверный код вывода. Получите новый код в кассе букмекера."
    if "уже был провед" in low or ("already" in low and ("withdraw" in low or "process" in low)):
        return "Операция уже была проведена букмекером. Повторно отправлять не нужно."
    if "не найдено ни одного запроса" in low:
        return "У букмекера нет активного запроса на выплату для этого ID."
    if "отклон" in low:
        return "Запрос отклонён букмекером."
    if "обработ" in low or "process" in low:
        return "Предыдущая операция ещё обрабатывается. Дождитесь завершения."
    if "лимит" in low or "limit" in low:
        return "Сумма превышает доступный лимит кассы."
    if "баланс" in low or "balance" in low:
        return "Сумма превышает доступный баланс кассы."
    if status == 403:
        return "Операция временно недоступна (доступ запрещён). Проверьте IP и учётные данные кассы."
    if status == 599:
        return "Касса недоступна: нет соединения с API."
    if action == "withdraw":
        return raw[:300] or "Букмекер не подтвердил запрос на вывод."
    if action == "lookup":
        return raw[:300] or "Не удалось проверить ID у букмекера."
    return raw[:300] or "Не удалось выполнить операцию в кассе."


def is_duplicate_message(data: Any) -> bool:
    root = mapping(data)
    try:
        message_id = int(root.get("MessageId") or root.get("messageId") or 0)
    except Exception:
        message_id = 0
    if message_id == 164864:
        return True
    low = " ".join(str(root.get(k) or "") for k in ("message", "Message", "errorMessage")).lower()
    return "уже был провед" in low or "already" in low and ("perform" in low or "process" in low)


class BaseAdapter:
    type_name = "base"
    label = "Base"
    credential_fields: list[dict[str, Any]] = []

    def __init__(self, cash: Any, credentials: dict[str, Any]):
        self.cash = cash
        self.creds = credentials or {}

    def missing_credentials(self) -> list[str]:
        return [f["key"] for f in self.credential_fields if f.get("required") and not str(self.creds.get(f["key"]) or "").strip()]

    def lookup_player(self, player_id: str) -> ProviderResult:  # pragma: no cover - interface
        raise NotImplementedError

    def deposit(self, player_id: str, amount: Decimal) -> ProviderResult:  # pragma: no cover
        raise NotImplementedError

    def withdraw(self, player_id: str, code: str) -> ProviderResult:  # pragma: no cover
        raise NotImplementedError

    def balance(self) -> ProviderResult:  # pragma: no cover
        raise NotImplementedError

    def test_connection(self) -> ProviderResult:
        missing = self.missing_credentials()
        if missing:
            return ProviderResult(ok=False, message="Не заполнены поля: " + ", ".join(missing))
        return self.balance()


_REGISTRY: dict[str, type[BaseAdapter]] = {}


def register(adapter: type[BaseAdapter]) -> type[BaseAdapter]:
    _REGISTRY[adapter.type_name] = adapter
    return adapter


def get_adapter(cash: Any, credentials: dict[str, Any]) -> BaseAdapter:
    from . import servcul, xapi  # noqa: F401  (register adapters)

    cls = _REGISTRY.get(str(getattr(cash, "provider_type", "") or "").lower())
    if cls is None:
        raise ValueError(f"Неизвестный тип кассы: {getattr(cash, 'provider_type', '')}")
    return cls(cash, credentials)


def provider_types() -> list[dict[str, Any]]:
    from . import servcul, xapi  # noqa: F401

    return [
        {"type": cls.type_name, "label": cls.label, "fields": cls.credential_fields}
        for cls in _REGISTRY.values()
    ]
