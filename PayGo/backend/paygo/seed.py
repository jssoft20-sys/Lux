"""Idempotent seed data: cash desks (1xBet and 1win enabled), bank links, defaults."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import BankLink, PaymentCash

DEFAULT_CASHES: list[dict[str, Any]] = [
    {
        "key": "1xbet", "name": "1xbet", "provider_type": "servcul", "enabled": True, "priority": 10, "currency": "KGS", "emoji": "😎", "custom_emoji_id": "5240186449915039482",
        "base_url": "https://partners.servcul.com/CashdeskBotAPI", "deposit_min": Decimal("100"), "deposit_max": Decimal("100000"),
        "low_balance_threshold": Decimal("20000"), "critical_balance_threshold": Decimal("1000"), "auto_enable_threshold": Decimal("5000"),
    },
    {
        "key": "1win", "name": "1win", "provider_type": "xapi", "enabled": True, "priority": 20, "currency": "KGS", "emoji": "🥇", "custom_emoji_id": "5247144889640056462",
        "base_url": "https://api.1win.win", "deposit_min": Decimal("100"), "deposit_max": Decimal("100000"),
        "low_balance_threshold": Decimal("20000"), "critical_balance_threshold": Decimal("1000"), "auto_enable_threshold": Decimal("5000"),
    },
]

DEFAULT_BANK_LINKS: list[dict[str, Any]] = [
    {"key": "qr", "name": "QR-код", "prefix": "", "kind": "qr", "priority": 0},
    {"key": "mbank", "name": "MBank", "prefix": "https://app.mbank.kg/qr/#", "kind": "link", "priority": 10, "emoji": "🤩", "custom_emoji_id": "4949565894398314191"},
    {"key": "odengi", "name": "О!Деньги", "prefix": "https://api.dengi.o.kg/#", "kind": "link", "priority": 20, "encode_payload": True, "emoji": "🤩", "custom_emoji_id": "4949675944345339585"},
    {"key": "megapay", "name": "MegaPay", "prefix": "https://megapay.kg/get#", "kind": "link", "priority": 30, "emoji": "🤩", "custom_emoji_id": "4949665490394940974"},
    {"key": "balance", "name": "Balance", "prefix": "https://balance.kg/#", "kind": "link", "priority": 40},
    {"key": "bakai", "name": "Bakai Bank", "prefix": "https://bakai.app/#", "kind": "link", "priority": 50},
    {"key": "optima", "name": "Optima Bank", "prefix": "https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=", "kind": "link", "priority": 60, "encode_payload": True},
]


def seed_defaults(db: Session) -> dict[str, Any]:
    created: dict[str, list[str]] = {"cashes": [], "bank_links": []}
    for spec in DEFAULT_CASHES:
        row = db.execute(select(PaymentCash).where(PaymentCash.key == spec["key"])).scalar_one_or_none()
        if row is None:
            db.add(PaymentCash(**spec, instructions_text=""))
            created["cashes"].append(spec["key"])
        else:  # presentation defaults are filled in only when empty — operator edits win
            for field in ("emoji", "custom_emoji_id"):
                if not getattr(row, field) and spec.get(field):
                    setattr(row, field, spec[field])
    for spec in DEFAULT_BANK_LINKS:
        row = db.execute(select(BankLink).where(BankLink.key == spec["key"])).scalar_one_or_none()
        if row is None:
            db.add(BankLink(**spec))
            created["bank_links"].append(spec["key"])
        else:
            for field in ("emoji", "custom_emoji_id"):
                if not getattr(row, field) and spec.get(field):
                    setattr(row, field, spec[field])
    db.flush()
    return created
