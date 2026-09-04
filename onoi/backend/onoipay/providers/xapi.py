"""1win cash adapter: financial operations through X-API-KEY, balance through the agent portal."""
from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
from decimal import Decimal
from typing import Any

from .base import (
    BaseAdapter,
    ProviderResult,
    extract_amount,
    extract_reference,
    http_json,
    human_error,
    mapping,
    register,
    success,
)

DEFAULT_BASE_URL = "https://api.1win.win"
DEFAULT_AGENT_URL = "https://1win.win/cash-service/api/v3/agent"

_TOKEN_CACHE: dict[str, dict[str, Any]] = {}
_TOKEN_LOCK = threading.RLock()


def _num(root: dict[str, Any], *keys: str) -> Decimal | None:
    for key in keys:
        value = root.get(key)
        if value in (None, ""):
            continue
        try:
            return Decimal(str(value).replace(" ", "").replace(",", "."))
        except Exception:
            continue
    return None


def _jwt_exp(token: str) -> float:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload.encode()).decode()).get("exp") or 0)
    except Exception:
        return 0.0


@register
class XapiAdapter(BaseAdapter):
    type_name = "xapi"
    label = "1WIN Cash (X-API-KEY)"
    credential_fields = [
        {"key": "api_key", "label": "X-API-KEY", "required": True, "secret": True},
        {"key": "agent_login", "label": "Логин агентской кассы (для баланса)", "required": False},
        {"key": "agent_password", "label": "Пароль агентской кассы", "required": False, "secret": True},
        {"key": "agent_cashdeskid", "label": "ID кассы 1win", "required": False},
        {"key": "agent_tenant_id", "label": "Tenant ID", "required": False},
        {"key": "agent_user_agent", "label": "User-Agent для агентского API", "required": False},
        {"key": "agent_fingerprint_id", "label": "Fingerprint ID", "required": False},
        {"key": "agent_client_id", "label": "Client ID", "required": False},
        {"key": "code_as_number", "label": "Код вывода отправлять числом (1/0)", "required": False},
    ]

    @property
    def base_url(self) -> str:
        return str(self.cash.base_url or self.creds.get("base_url") or DEFAULT_BASE_URL).rstrip("/")

    def _request(self, endpoint: str, payload: dict[str, Any]) -> tuple[int, Any]:
        key = str(self.creds.get("api_key") or "").strip()
        if not key:
            return 0, {"message": "X-API-KEY не настроен"}
        return http_json("POST", self.base_url + endpoint, json=payload, headers={"X-API-KEY": key, "accept": "application/json"}, label="xapi")

    def lookup_player(self, player_id: str) -> ProviderResult:
        pid = "".join(ch for ch in str(player_id) if ch.isdigit())
        if not pid:
            return ProviderResult(ok=False, message="Некорректный ID")
        # 1win has no documented non-financial lookup: accept the format only.
        return ProviderResult(ok=True, message="ID принят (формат проверен).", extra={"verified": False})

    def deposit(self, player_id: str, amount: Decimal) -> ProviderResult:
        value = float(amount)
        status, data = self._request("/v1/client/deposit", {"userId": int(str(player_id)), "amount": value})
        ok = success(status, data, require_reference=True)
        return ProviderResult(ok=ok, status=status, data=data, message="OK" if ok else human_error(status, data, "deposit"), reference=extract_reference(data))

    def withdraw(self, player_id: str, code: str) -> ProviderResult:
        code_value: Any = str(code).strip()
        if str(self.creds.get("code_as_number") or "").strip() in {"1", "true", "yes"} and code_value.isdigit():
            code_value = int(code_value)
        status, data = self._request("/v1/client/withdrawal", {"userId": int(str(player_id)), "code": code_value})
        amount = extract_amount(data)
        acknowledged = success(status, data)
        ok = success(status, data, require_amount=True)
        message = "OK" if ok else ("Букмекер подтвердил код, но не вернул сумму вывода." if acknowledged else human_error(status, data, "withdraw"))
        return ProviderResult(ok=ok, status=status, data=data, amount=amount if ok else None, reference=extract_reference(data), acknowledged=acknowledged, message=message)

    # --------------------------------------------------------------- agent portal
    def _agent_headers(self, token: str = "") -> dict[str, str]:
        headers = {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "origin": "https://1win.win",
            "referer": "https://1win.win/home" if token else "https://1win.win/login",
            "tenant-id": str(self.creds.get("agent_tenant_id") or "1"),
            "user-agent": str(self.creds.get("agent_user_agent") or "Mozilla/5.0"),
        }
        if token:
            headers["token"] = token
            headers["authorization"] = "Bearer " + token
        return headers

    def _agent_login(self, force: bool = False) -> dict[str, Any]:
        login = str(self.creds.get("agent_login") or "").strip()
        password = str(self.creds.get("agent_password") or "").strip()
        if not login or not password:
            return {"ok": False, "message": "1WIN: не указан логин или пароль агентской кассы."}
        base = str(self.creds.get("agent_base_url") or DEFAULT_AGENT_URL).rstrip("/")
        cache_key = hashlib.sha256(f"{base}|{login}".encode()).hexdigest()
        now = time.time()
        with _TOKEN_LOCK:
            cached = _TOKEN_CACHE.get(cache_key) or {}
            if not force and cached.get("token") and float(cached.get("expires_at") or 0) > now + 60:
                return {"ok": True, "token": cached["token"]}
        payload = {
            "login": login,
            "password": password,
            "userAgent": str(self.creds.get("agent_user_agent") or "Mozilla/5.0"),
            "timezone": str(self.creds.get("agent_timezone") or "Asia/Bishkek"),
        }
        if self.creds.get("agent_fingerprint_id"):
            payload["fingerprintId"] = str(self.creds["agent_fingerprint_id"])
        if self.creds.get("agent_client_id"):
            payload["clientId"] = str(self.creds["agent_client_id"])
        status, data = http_json("POST", base + "/login", json={"data": payload}, headers=self._agent_headers(), label="1win.login")
        token = ""
        if isinstance(data, str):
            token = data.strip().strip('"')
        elif isinstance(data, dict):
            nested = data.get("data") if isinstance(data.get("data"), dict) else {}
            token = str(data.get("token") or data.get("accessToken") or nested.get("token") or nested.get("accessToken") or "").strip()
        if not (200 <= status < 300 and token.count(".") == 2):
            msg = "1WIN: Unauthorized. Проверьте логин, пароль и IP сервера." if status in (401, 403) else f"1WIN: вход не выполнен (HTTP {status})."
            return {"ok": False, "message": msg, "status": status}
        exp = _jwt_exp(token) or now + 45 * 60
        with _TOKEN_LOCK:
            _TOKEN_CACHE[cache_key] = {"token": token, "expires_at": exp}
        return {"ok": True, "token": token}

    def balance(self) -> ProviderResult:
        base = str(self.creds.get("agent_base_url") or DEFAULT_AGENT_URL).rstrip("/")
        for attempt in range(2):
            auth = self._agent_login(force=bool(attempt))
            if not auth.get("ok"):
                return ProviderResult(ok=False, message=str(auth.get("message")), status=int(auth.get("status") or 0))
            status, data = http_json("GET", base + "/main", headers=self._agent_headers(str(auth["token"])), label="1win.main")
            if status in (401, 403) and attempt == 0:
                continue
            root = mapping(data)
            ok = 200 <= status < 300 and any(k in root for k in ("balance", "limitCurrent", "limit"))
            return ProviderResult(ok=ok, status=status, data=data, message="OK" if ok else human_error(status, data, "balance"), balance=_num(root, "balance"), limit=_num(root, "limitCurrent", "limit"))
        return ProviderResult(ok=False, status=403, message="1WIN: не удалось обновить сессию агентского API.")

    def test_connection(self) -> ProviderResult:
        missing = self.missing_credentials()
        if missing:
            return ProviderResult(ok=False, message="Не заполнены поля: " + ", ".join(missing))
        if self.creds.get("agent_login") and self.creds.get("agent_password"):
            return self.balance()
        return ProviderResult(ok=True, message="X-API-KEY сохранён. Баланс доступен после указания агентского логина.")
