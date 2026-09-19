"""Optima24 payout provider — drives the same mobile-bank API the Optima24 app uses.

The Optima24 phone app talks to a private REST backend at
``https://telebank3.optima24.kg:3080/api/v1/…`` (seen in the app's own error text:
``GET /api/v1/accounts/GetDefaultAccount?needFullUpdate=true``). That is the exact
channel an operator uses by hand to pay a client, so it is what we automate.

WHAT IS WIRED AND WHAT IS NOT
-----------------------------
* ``get_balance`` calls the real, known, read-only endpoint (``GetDefaultAccount``)
  and reads the balance out of the reply. This works as soon as a session token is
  available.
* ``login`` and ``pay`` need two request shapes that are NOT public. They are captured
  once from the owner's own authenticated app session (or handed over by Optima's tech
  team). Until then both raise :class:`PayoutError` with a clear message — they never
  guess a transfer payload, because a wrong guess could move money to the wrong place.

Filling the two gaps is a small, well-isolated job: search for ``CAPTURE_REQUIRED`` in
this file. Each spot documents exactly which request to paste in (method, path, JSON
body, and which field carries the session token and the transaction id).
"""
from __future__ import annotations

import logging
import ssl
import threading
from decimal import Decimal
from typing import Any

import httpx

from ..utils import money_or_none, utcnow
from .base import PayoutError, PayoutProvider, PayoutResult, PayoutTarget, register

logger = logging.getLogger("paygo.payouts.optima24")

# The two request shapes still to be captured from the app's authenticated session.
CAPTURE_REQUIRED = (
    "Запрос к Optima24 не настроен. Снимите его из приложения Optima24 (вход/перевод) "
    "или запросите у техподдержки Optima и впишите в payouts/optima24.py (метка CAPTURE_REQUIRED)."
)

# Known, read-only endpoint straight from the app's error message.
DEFAULT_ACCOUNT_PATH = "/api/v1/accounts/GetDefaultAccount"


def _clean_base(url: str) -> str:
    return (url or "").strip().rstrip("/")


def build_ssl_context(ca_bundle: str, tls_verify: bool) -> ssl.SSLContext:
    """TLS trust for the Optima24 client (and the payout-check probe).

    telebank3 serves a self-signed cert (CN=telebank3.optima24.kg) with a weak SHA-1 signature
    and no SAN, so standard verification rejects it. Pinning that cert as the trust anchor keeps
    MITM protection while tolerating those two quirks:

    * ``OPTIMA24_TLS_VERIFY=false`` — a hard override: encrypt but do not verify authenticity.
    * else with ``OPTIMA24_CA_BUNDLE`` — verify the chain against the pinned cert, with the
      security level lowered to accept the SHA-1 signature and hostname checking off (the cert
      has no SAN; the pinned CA is what proves it is really Optima).
    * else — ordinary public-CA verification.
    """
    if not tls_verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    ca = (ca_bundle or "").strip()
    if ca:
        ctx = ssl.create_default_context(cafile=ca)
        ctx.check_hostname = False
        try:
            ctx.set_ciphers("DEFAULT@SECLEVEL=1")  # allow the cert's weak (SHA-1) signature digest
        except ssl.SSLError:  # pragma: no cover - platform dependent
            pass
        return ctx
    return ssl.create_default_context()


class Optima24Provider(PayoutProvider):
    name = "optima24"
    label = "Optima24"

    def __init__(
        self,
        *,
        base_url: str = "",
        login: str = "",
        password: str = "",
        device_id: str = "",
        device_token: str = "",
        source_account: str = "",
        timeout: float = 30.0,
        otp_reader: Any = None,
        ca_bundle: str = "",
        tls_verify: bool = True,
        **_: Any,
    ):
        self.base_url = _clean_base(base_url)
        self._login = login
        self._password = password
        self._device_id = device_id
        self._device_token = device_token
        self._source_account = source_account
        self._timeout = float(timeout or 30.0)
        self._otp_reader = otp_reader  # reads the emailed confirmation code (may be None)
        self._token: str = ""
        self._lock = threading.Lock()
        # The app waits ~30s per call; a generous read timeout with a short connect timeout
        # matches it. Financial calls are never retried at the transport layer.
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(connect=6.0, read=self._timeout, write=15.0, pool=6.0),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4, keepalive_expiry=60.0),
            headers={"Accept": "application/json", "User-Agent": "PayGo-Payout/1.0"},
            follow_redirects=False,
            verify=build_ssl_context(ca_bundle, tls_verify),  # telebank3 self-signed cert
        )

    # ---------------------------------------------------------------- transport

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self._token:
            # CAPTURE_REQUIRED: confirm how the app carries the session token. Most likely
            # "Authorization: Bearer <token>". If it uses a cookie or a custom header
            # (e.g. "X-Auth-Token"), set it here to match the captured request.
            headers["Authorization"] = f"Bearer {self._token}"
        if self._device_id:
            headers["X-Device-Id"] = self._device_id
        return headers

    def _request(self, method: str, path: str, *, json: Any = None, params: Any = None) -> tuple[int, Any]:
        try:
            resp = self._client.request(method, path, json=json, params=params, headers=self._headers())
        except Exception as exc:  # connect/read timeout, TLS, DNS…
            logger.warning("optima24 %s %s failed: %s", method, path, type(exc).__name__)
            raise PayoutError(f"Optima24 недоступен: {type(exc).__name__}") from exc
        raw = resp.text.strip()
        try:
            data: Any = resp.json() if raw else {}
        except Exception:
            data = {"message": raw[:1000]}
        logger.info("optima24 %s %s -> %s", method, path.split("?")[0], resp.status_code)
        return int(resp.status_code), data

    # ---------------------------------------------------------------- session

    def login(self) -> None:
        if not (self.base_url and self._login and self._password):
            raise PayoutError("Optima24 не настроен: заполните OPTIMA24_* в .env")
        with self._lock:
            if self._token:
                return
            # CAPTURE_REQUIRED — the sign-in request.
            # Capture the login call the Optima24 app makes (POST .../auth or /login) and
            # replace the body below with the real one, then read the token out of the reply:
            #
            #   status, data = self._request("POST", "/api/v1/auth/login", json={
            #       "login": self._login, "password": self._password,
            #       "deviceId": self._device_id, "deviceToken": self._device_token,
            #   })
            #   token = (data or {}).get("token") or (data or {}).get("accessToken")
            #   if status >= 400 or not token:
            #       raise PayoutError(f"Optima24 вход не выполнен: HTTP {status}")
            #   self._token = str(token)
            raise PayoutError(CAPTURE_REQUIRED + " [login]")

    def _ensure_session(self) -> None:
        if not self._token:
            self.login()

    # ---------------------------------------------------------------- balance (known)

    def get_balance(self) -> Decimal | None:
        """Read the default account balance via the known GetDefaultAccount endpoint."""
        self._ensure_session()
        status, data = self._request("GET", DEFAULT_ACCOUNT_PATH, params={"needFullUpdate": "true"})
        if status >= 400:
            raise PayoutError(f"Optima24 баланс недоступен: HTTP {status}")
        return _extract_balance(data)

    # ---------------------------------------------------------------- pay

    def pay(self, target: PayoutTarget) -> PayoutResult:
        """Three steps: submit the transfer, read the e-mailed code, confirm the transfer."""
        self._ensure_session()
        if not target.card and not target.qr_payload:
            return PayoutResult(ok=False, status="failed", message="нет реквизитов получателя (карта/QR)")
        submitted_at = utcnow()

        # STEP 1 — CAPTURE_REQUIRED [pay-init]: submit the transfer; Optima e-mails a code.
        # Capture the card/QR transfer the app makes when an operator pays a client, then
        # build and send it here. Pass target.reference as the idempotency key so a repeat
        # never double-pays, and keep the pending operation id from the reply for STEP 3:
        #
        #   status, data = self._request("POST", "/api/v1/transfers/Card2Card", json={
        #       "fromAccount": self._source_account,
        #       "toCard": target.card,             # or "qr": target.qr_payload
        #       "amount": str(target.amount),
        #       "currency": target.currency,
        #       "note": target.note(),
        #       "externalId": target.reference,    # idempotency key
        #   })
        #   if status >= 400:
        #       return _interpret_transfer(status, data, target)
        #   operation_id = str((data or {}).get("operationId") or (data or {}).get("id") or "")

        # STEP 2 — read the confirmation code from e-mail (wired and working).
        code = self._await_code(submitted_at)
        if code is None:
            return PayoutResult(ok=False, status="failed", acknowledged=True,
                                message="Код подтверждения не пришёл на почту за отведённое время — проверьте перевод в Optima24 вручную.")

        # STEP 3 — CAPTURE_REQUIRED [pay-confirm]: confirm the transfer with the code.
        #   status, data = self._request("POST", "/api/v1/transfers/Confirm", json={
        #       "operationId": operation_id, "code": code, "externalId": target.reference,
        #   })
        #   return _interpret_transfer(status, data, target)
        raise PayoutError(CAPTURE_REQUIRED + " [pay-init/pay-confirm]")

    def _await_code(self, submitted_at: Any) -> str | None:
        """Fetch the e-mailed confirmation code that arrived after the transfer was submitted."""
        if self._otp_reader is None:
            raise PayoutError("Почта для кодов Optima не настроена (OPTIMA_OTP_IMAP_*).")
        return self._otp_reader.wait_for_code(since=submitted_at)

    def payment_status(self, reference: str) -> PayoutResult:
        self._ensure_session()
        # CAPTURE_REQUIRED — the transfer-status lookup (used to resolve an ambiguous
        # timeout without resending). Capture the app's "transfer by externalId/id" call.
        raise PayoutError(CAPTURE_REQUIRED + " [status]")


# --------------------------------------------------------------------------- parsing

_BALANCE_KEYS = (
    "availableBalance", "AvailableBalance", "available",
    "balance", "Balance", "amount", "Amount", "sum", "Sum",
)


def _extract_balance(data: Any) -> Decimal | None:
    """Pull a balance number out of the GetDefaultAccount reply, shape-tolerantly."""
    def walk(node: Any, depth: int = 0):
        if depth > 6:
            return None
        if isinstance(node, dict):
            for key in _BALANCE_KEYS:
                if key in node:
                    value = money_or_none(node[key])
                    if value is not None:
                        return value
            for value in node.values():
                found = walk(value, depth + 1)
                if found is not None:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item, depth + 1)
                if found is not None:
                    return found
        return None

    return walk(data)


def _interpret_transfer(status: int, data: Any, target: PayoutTarget) -> PayoutResult:
    """Turn a transfer reply into a PayoutResult. Used once the pay request is captured.

    Kept here (rather than inline) so the capture step is a one-line call and the
    success/ambiguous/failed logic is tested independently.
    """
    root = data if isinstance(data, dict) else {}
    ref = str(root.get("transactionId") or root.get("id") or root.get("documentId") or target.reference)
    message = str(root.get("message") or root.get("Message") or root.get("error") or "")
    low = message.lower()
    if 200 <= status < 300 and not root.get("error"):
        state = str(root.get("status") or root.get("state") or "").lower()
        if state in {"pending", "inprogress", "processing", "new"}:
            return PayoutResult(ok=True, status="pending", reference=ref, message=message or "в обработке", raw=data)
        return PayoutResult(ok=True, status="sent", reference=ref, message=message or "отправлено", raw=data)
    if "already" in low or "уже" in low or status == 409:
        return PayoutResult(ok=True, status="duplicate", duplicate=True, reference=ref, message=message or "уже отправлено", raw=data)
    # 5xx / timeouts are ambiguous: the transfer may have reached the bank — do not resend.
    acknowledged = status >= 500 or status == 0
    return PayoutResult(ok=False, status="failed", acknowledged=acknowledged, reference=ref,
                        message=message or f"HTTP {status}", raw=data)


register(Optima24Provider)
