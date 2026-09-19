"""Payout provider interface, result type, registry and the built-in simulator.

Design mirrors ``paygo.providers.base`` (the bookmaker side) so the two feel the same:

* :class:`PayoutTarget` — where the money must go and how much (built from a withdrawal).
* :class:`PayoutResult` — the outcome of one transfer attempt, with the same careful
  ``acknowledged`` flag the bookmaker side uses: a request that *may* have reached the
  bank is never silently retried.
* :class:`PayoutProvider` — ``login`` / ``get_balance`` / ``pay`` / ``payment_status``.
* :class:`FakePayoutProvider` — an in-memory channel for tests and a first dry run.

A real transfer is the one operation that must never be duplicated, so ``pay`` takes an
idempotency key and every provider is expected to pass it to the bank when the bank
supports it.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

logger = logging.getLogger("paygo.payouts")


class PayoutError(Exception):
    """A configuration or transport problem that stops a transfer from being attempted."""


@dataclass
class PayoutTarget:
    """Where a payout must go. Built from a withdrawal by the autopay engine."""

    amount: Decimal
    currency: str = "KGS"
    reference: str = ""          # idempotency key — unique per withdrawal, reused across retries
    public_id: str = ""          # human id (W…) for logs
    withdrawal_id: int = 0
    qr_payload: str = ""         # full ELQR with the amount injected (what the operator scans)
    card: str = ""               # destination card / account number parsed from the QR
    holder: str = ""             # destination holder name, when known
    bank: str = ""               # destination bank name, when known
    phone: str = ""              # destination phone, for wallet channels
    player_id: str = ""          # bookmaker id, for the transfer note

    def note(self) -> str:
        return f"PayGo {self.public_id}".strip()


@dataclass
class PayoutResult:
    """Outcome of one transfer attempt.

    ``status`` is one of: ``sent`` (money left the account), ``pending`` (accepted, still
    settling), ``duplicate`` (the bank says this reference was already paid), ``failed``
    (cleanly rejected — safe to retry or hand to an operator).

    ``acknowledged`` means the request may have reached the bank even though we did not get
    a clean confirmation (a timeout mid-flight). The engine then stops and asks a human:
    it must never resend such a transfer.
    """

    ok: bool
    status: str = "failed"
    message: str = ""
    reference: str = ""          # bank-side transaction id
    acknowledged: bool = False
    duplicate: bool = False
    balance: Decimal | None = None
    raw: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "status": self.status,
            "message": self.message,
            "reference": self.reference,
            "acknowledged": self.acknowledged,
            "duplicate": self.duplicate,
            "balance": str(self.balance) if self.balance is not None else None,
        }


class PayoutProvider:
    """Base class. Subclasses implement the four bank-facing methods."""

    name = "base"
    label = "Base"
    account_name = ""  # label of the specific account this instance drives (set by the pool)

    def key(self) -> str:
        """Stable identifier for this account (used to cache its balance)."""
        return self.account_name or self.name

    def login(self) -> None:
        """Establish or refresh a session. May be a no-op. Raises :class:`PayoutError`."""

    def get_balance(self) -> Decimal | None:
        """Available balance on the payout account, or ``None`` when it cannot be read."""
        raise NotImplementedError

    def pay(self, target: PayoutTarget) -> PayoutResult:  # pragma: no cover - interface
        """Send ``target.amount`` to ``target``. Must be idempotent on ``target.reference``."""
        raise NotImplementedError

    def payment_status(self, reference: str) -> PayoutResult:  # pragma: no cover - interface
        """Look up a previously submitted transfer by its idempotency reference."""
        raise NotImplementedError

    def healthcheck(self) -> PayoutResult:
        try:
            self.login()
            balance = self.get_balance()
            return PayoutResult(ok=balance is not None, status="sent" if balance is not None else "failed",
                                balance=balance, message="ok" if balance is not None else "нет ответа о балансе")
        except PayoutError as exc:
            return PayoutResult(ok=False, message=str(exc))


# --------------------------------------------------------------------------- simulator

class FakePayoutProvider(PayoutProvider):
    """In-memory payout channel: no network, deterministic, safe for tests and dry runs.

    Starts with a configurable balance, records every payment, refuses to pay the same
    reference twice, and fails when a payment would overdraw the account.
    """

    name = "fake"
    label = "Симулятор"

    def __init__(self, *, balance: Decimal | str | float = Decimal("1000000"), **_: Any):
        self._balance = Decimal(str(balance))
        self.paid: dict[str, PayoutTarget] = {}
        self.calls: list[str] = []
        self._lock = threading.Lock()

    def get_balance(self) -> Decimal | None:
        return self._balance

    def pay(self, target: PayoutTarget) -> PayoutResult:
        with self._lock:
            self.calls.append(target.reference)
            if target.reference in self.paid:
                return PayoutResult(ok=True, status="duplicate", duplicate=True, reference=target.reference,
                                    message="уже отправлено", balance=self._balance)
            amount = Decimal(str(target.amount))
            if amount <= 0:
                return PayoutResult(ok=False, status="failed", message="сумма должна быть больше нуля")
            if amount > self._balance:
                return PayoutResult(ok=False, status="failed", message="недостаточно средств на счёте", balance=self._balance)
            self._balance -= amount
            self.paid[target.reference] = target
            return PayoutResult(ok=True, status="sent", reference=f"FAKE-{target.reference}",
                                message="отправлено", balance=self._balance)

    def payment_status(self, reference: str) -> PayoutResult:
        if reference in self.paid:
            return PayoutResult(ok=True, status="sent", reference=f"FAKE-{reference}", balance=self._balance)
        return PayoutResult(ok=False, status="failed", message="не найдено")


# --------------------------------------------------------------------------- registry

_REGISTRY: dict[str, type[PayoutProvider]] = {}


def register(cls: type[PayoutProvider]) -> type[PayoutProvider]:
    _REGISTRY[cls.name] = cls
    return cls


register(FakePayoutProvider)


def build_provider(name: str, **kwargs: Any) -> PayoutProvider | None:
    """Instantiate a provider by name, or ``None`` when the name is empty/unknown."""
    key = (name or "").strip().lower()
    if not key:
        return None
    if key not in _REGISTRY:
        from . import optima24  # noqa: F401  (registers optima24 on demand)
    cls = _REGISTRY.get(key)
    if cls is None:
        logger.warning("unknown payout provider %r", name)
        return None
    return cls(**kwargs)


def providers_from_settings(settings: Any) -> list[PayoutProvider]:
    """Build every configured payout account as its own provider (a pool).

    One Optima24 account = one provider. All accounts share a single OTP mailbox: payouts
    are sent one at a time, so the emailed code always belongs to the current transfer,
    whichever account submitted it.
    """
    name = getattr(settings, "payout_provider_name", "") or ""
    if not name:
        return []
    if name == "fake":
        provider = build_provider("fake")
        return [provider] if provider else []
    if name == "optima24":
        from .otp_email import reader_from_settings

        reader = reader_from_settings(settings)  # shared mailbox for all accounts
        out: list[PayoutProvider] = []
        for account in settings.optima24_account_list:
            params = {k: v for k, v in account.items() if k != "name"}  # "name" is our label, not a ctor arg
            params["ca_bundle"] = settings.optima24_ca_bundle  # telebank3 uses a self-signed cert
            params["tls_verify"] = settings.optima24_tls_verify
            provider = build_provider("optima24", otp_reader=reader, **params)
            if provider is not None:
                provider.account_name = account.get("name") or "optima24"
                out.append(provider)
        return out
    provider = build_provider(name)
    return [provider] if provider else []


def provider_from_settings(settings: Any) -> PayoutProvider | None:
    """The first configured provider (for status / single-account callers), or ``None``."""
    pool = providers_from_settings(settings)
    return pool[0] if pool else None
