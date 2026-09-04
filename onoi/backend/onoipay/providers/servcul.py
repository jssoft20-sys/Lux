"""Servcul CashdeskBotAPI adapter (1xBet Mobcash and compatible cash desks)."""
from __future__ import annotations

import base64
import hashlib
import urllib.parse
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from .base import (
    BaseAdapter,
    ProviderResult,
    extract_amount,
    extract_currency,
    extract_reference,
    http_json,
    human_error,
    is_duplicate_message,
    mapping,
    register,
    success,
)

DEFAULT_BASE_URL = "https://partners.servcul.com/CashdeskBotAPI"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()  # noqa: S324 - required by the provider protocol


def _amount_token(value: Decimal) -> tuple[Any, str]:
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Некорректная сумма") from exc
    if not dec.is_finite() or dec <= 0:
        raise ValueError("Сумма должна быть больше нуля")
    token = format(dec, "f")
    if "." in token:
        token = token.rstrip("0").rstrip(".")
    body: Any = int(dec) if dec == dec.to_integral_value() else float(dec)
    return body, token


@register
class ServculAdapter(BaseAdapter):
    type_name = "servcul"
    label = "Servcul Cashdesk (1xBet Mobcash)"
    credential_fields = [
        {"key": "login", "label": "Логин кассира", "required": True},
        {"key": "cashierpass", "label": "Пароль кассира", "required": True, "secret": True},
        {"key": "cashdeskid", "label": "Cashdesk ID / KRM", "required": True},
        {"key": "hash", "label": "Hash кассы", "required": True, "secret": True},
    ]

    # ------------------------------------------------------------------ helpers
    @property
    def base_url(self) -> str:
        base = str(self.cash.base_url or self.creds.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
        if "CashdeskBotAPI" not in base:
            base += "/CashdeskBotAPI"
        return base

    def _cashdesk_id(self) -> str:
        raw = str(self.creds.get("cashdeskid") or "").strip()
        if raw.isdigit():
            return raw
        digits = "".join(ch for ch in raw if ch.isdigit())
        return digits if digits and raw[:1].upper() in {"C", "K"} else ""

    def _credentials(self) -> tuple[str, str, str, str]:
        return (
            str(self.creds.get("hash") or "").strip(),
            str(self.creds.get("cashierpass") or "").strip(),
            self._cashdesk_id(),
            str(self.creds.get("login") or "").strip(),
        )

    def _headers(self, sign: str, *, basic: bool = True) -> dict[str, str]:
        hv, cp, cash, login = self._credentials()
        headers = {"sign": sign, "accept": "application/json", "content-type": "application/json"}
        if basic and login and cp:
            headers["Authorization"] = "Basic " + base64.b64encode(f"{login}:{cp}".encode()).decode("ascii")
        return headers

    def _check(self) -> str:
        hv, cp, cash, login = self._credentials()
        missing = [n for n, v in (("login", login), ("cashierpass", cp), ("cashdeskid", cash), ("hash", hv)) if not v]
        return ("Servcul: не заполнено " + ", ".join(missing)) if missing else ""

    # ------------------------------------------------------------------ API
    def lookup_player(self, player_id: str) -> ProviderResult:
        error = self._check()
        if error:
            return ProviderResult(ok=False, message=error)
        pid = "".join(ch for ch in str(player_id) if ch.isdigit())
        if not pid:
            return ProviderResult(ok=False, message="Некорректный ID")
        hv, cp, cash, _login = self._credentials()
        confirm = _md5(f"{pid}:{hv}")
        sign = _sha256(_sha256(f"hash={hv}&userid={pid}&cashdeskid={cash}") + _md5(f"userid={pid}&cashierpass={cp}&hash={hv}"))
        query = urllib.parse.urlencode({"confirm": confirm, "cashdeskId": int(cash)})
        status, data = http_json("GET", f"{self.base_url}/Users/{pid}?{query}", headers=self._headers(sign), label="servcul.lookup")
        root = mapping(data)
        returned = str(root.get("userId") or root.get("UserId") or root.get("userid") or "").strip()
        name = str(root.get("name") or root.get("Name") or "").strip()
        ok = 200 <= status < 300 and returned.isdigit() and returned == pid
        low = " ".join(str(root.get(k) or "") for k in ("message", "Message", "errorMessage", "detail")).lower()
        not_found = status == 404 or "not found" in low or "не найден" in low or (200 <= status < 300 and not returned)
        if ok:
            return ProviderResult(ok=True, status=status, data=data, message="OK", player_name=name, currency=extract_currency(data))
        if not_found:
            return ProviderResult(ok=False, status=status, data=data, message="ID не найден у букмекера. Проверьте номер и введите ID ещё раз.", extra={"code": "PLAYER_NOT_FOUND"})
        return ProviderResult(ok=False, status=status, data=data, message=human_error(status, data, "lookup"), extra={"code": "PLAYER_CHECK_TEMPORARY"})

    def deposit(self, player_id: str, amount: Decimal) -> ProviderResult:
        error = self._check()
        if error:
            return ProviderResult(ok=False, message=error)
        pid = str(player_id).strip()
        hv, cp, cash, _login = self._credentials()
        body_sum, token = _amount_token(amount)
        lng = "ru"
        sign = _sha256(_sha256(f"hash={hv}&lng={lng}&userid={pid}") + _md5(f"summa={token}&cashierpass={cp}&cashdeskid={cash}"))
        confirm = _md5(f"{pid}:{hv}")
        status, data = http_json(
            "POST",
            f"{self.base_url}/Deposit/{pid}/Add",
            json={"cashdeskId": int(cash), "lng": lng, "summa": body_sum, "confirm": confirm},
            headers=self._headers(sign),
            label="servcul.deposit",
        )
        ok = success(status, data)
        return ProviderResult(
            ok=ok,
            status=status,
            data=data,
            message="OK" if ok else human_error(status, data, "deposit"),
            reference=extract_reference(data),
            duplicate=(not ok) and is_duplicate_message(data),
        )

    def withdraw(self, player_id: str, code: str) -> ProviderResult:
        error = self._check()
        if error:
            return ProviderResult(ok=False, message=error)
        pid, code = str(player_id).strip(), str(code).strip()
        hv, cp, cash, _login = self._credentials()
        lng = "ru"
        sign = _sha256(_sha256(f"hash={hv}&lng={lng}&userid={pid}") + _md5(f"code={code}&cashierpass={cp}&cashdeskid={cash}"))
        confirm = _md5(f"{pid}:{hv}")
        # Payout authentication is sign + confirm only (no Basic header), as in the working integration.
        status, data = http_json(
            "POST",
            f"{self.base_url}/Deposit/{pid}/Payout",
            json={"cashdeskId": int(cash), "lng": lng, "code": code, "confirm": confirm},
            headers=self._headers(sign, basic=False),
            label="servcul.payout",
        )
        amount = extract_amount(data)
        acknowledged = success(status, data)
        ok = success(status, data, require_amount=True)
        message = "OK" if ok else ("Букмекер подтвердил код, но не вернул сумму вывода." if acknowledged else human_error(status, data, "withdraw"))
        return ProviderResult(
            ok=ok,
            status=status,
            data=data,
            amount=amount if ok else None,
            reference=extract_reference(data),
            acknowledged=acknowledged,
            duplicate=(not ok) and is_duplicate_message(data),
            message=message,
        )

    def balance(self) -> ProviderResult:
        error = self._check()
        if error:
            return ProviderResult(ok=False, message=error)
        hv, cp, cash, _login = self._credentials()
        dt = datetime.now(UTC).strftime("%Y.%m.%d %H:%M:%S")
        sign = _sha256(_sha256(f"hash={hv}&cashierpass={cp}&dt={dt}") + _md5(f"dt={dt}&cashierpass={cp}&cashdeskid={cash}"))
        confirm = _md5(f"{cash}:{hv}")
        query = urllib.parse.urlencode({"confirm": confirm, "dt": dt})
        status, data = http_json("GET", f"{self.base_url}/Cashdesk/{cash}/Balance?{query}", headers=self._headers(sign), label="servcul.balance")
        root = mapping(data)
        ok = 200 <= status < 300 and any(k in root for k in ("Balance", "balance", "Limit", "limit"))

        def num(*keys: str) -> Decimal | None:
            for key in keys:
                value = root.get(key)
                if value in (None, ""):
                    continue
                try:
                    return Decimal(str(value).replace(" ", "").replace(",", "."))
                except Exception:
                    continue
            return None

        return ProviderResult(
            ok=ok,
            status=status,
            data=data,
            message="OK" if ok else human_error(status, data, "balance"),
            balance=num("Balance", "balance"),
            limit=num("Limit", "limit"),
        )
