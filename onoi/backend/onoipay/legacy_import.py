"""Import cash desk credentials and bank requisites from the legacy ``config.json``.

Only business integration data is migrated (1xBet / 1win cash desks and bank
QR templates). Legacy admin passwords, bot tokens, API keys of the old panel
and SMTP credentials are intentionally ignored — new secrets live in ``.env``.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import PaymentCash, PaymentRequisite
from .seed import seed_defaults
from .services import elqr
from .services.cashes import update_cash

SUPPORTED = {"1xbet": "servcul", "1win": "xapi"}


def import_config(db: Session, cfg: dict[str, Any], *, enable_keys: set[str] | None = None) -> dict[str, Any]:
    enable_keys = enable_keys or {"1xbet"}
    seed_defaults(db)
    report: dict[str, Any] = {"cashes": [], "requisites": [], "skipped": []}
    providers = cfg.get("providers") or {}
    bookmakers = cfg.get("bookmakers") or {}
    for key, provider_type in SUPPORTED.items():
        profile = providers.get(key) or {}
        bset = bookmakers.get(key) or {}
        if not profile:
            report["skipped"].append(key)
            continue
        cash = db.execute(select(PaymentCash).where(PaymentCash.key == key)).scalar_one_or_none()
        if cash is None:
            cash = PaymentCash(key=key, name=key.upper(), provider_type=provider_type, enabled=False)
            db.add(cash)
            db.flush()
        creds: dict[str, Any]
        if provider_type == "servcul":
            creds = {k: str(profile.get(k) or "") for k in ("login", "cashierpass", "cashdeskid", "hash")}
        else:
            creds = {k: str(profile.get(k) or "") for k in ("api_key", "agent_login", "agent_password", "agent_cashdeskid", "agent_tenant_id", "agent_user_agent", "agent_fingerprint_id", "agent_client_id")}
            creds["code_as_number"] = "1" if profile.get("code_as_number") else "0"
        data: dict[str, Any] = {
            "credentials": creds,
            "base_url": str(profile.get("base_url") or ""),
            "enabled": key in enable_keys,
            "deposit_enabled": bool(bset.get("deposit", True)) if key in enable_keys else True,
            "withdraw_enabled": bool(bset.get("withdraw", True)) if key in enable_keys else True,
            "deposit_min": Decimal(str(bset.get("deposit_min") or 100)),
            "deposit_max": Decimal(str(bset.get("deposit_max") or 100000)),
            "deposit_fee_pct": Decimal(str(float(bset.get("deposit_rate") or 0) * 100)),
            "withdraw_fee_pct": Decimal(str(float(bset.get("withdraw_rate") or 0) * 100)),
            "name": str(profile.get("label") or bset.get("provider_label") or key.upper()).replace("Mobcash XBET", "1xBet"),
        }
        alerts = cfg.get("cashdesk_alerts") or {}
        if alerts:
            data["low_balance_threshold"] = Decimal(str(alerts.get("low") or 20000))
            data["critical_balance_threshold"] = Decimal(str(alerts.get("critical") or 1000))
        update_cash(db, cash, data)
        report["cashes"].append({"key": key, "enabled": cash.enabled})
    for row in (cfg.get("macro") or {}).get("requisites") or []:
        source = row.get("payload") or row.get("fragment") or row.get("qr_url") or row.get("source_url") or ""
        try:
            meta = elqr.bank_meta(source)
        except Exception:
            report["skipped"].append(f"requisite:{row.get('name')}")
            continue
        exists = db.execute(select(PaymentRequisite).where(PaymentRequisite.payload == meta["payload"])).scalar_one_or_none()
        if exists:
            continue
        db.add(PaymentRequisite(name=str(row.get("name") or meta["bank_name"])[:64], bank_type=str(row.get("bank_type") or "")[:32], bank_name=meta["bank_name"], enabled=bool(row.get("enabled", True)), priority=100, payload=meta["payload"], account=meta["account"][:64], holder=meta["holder"][:128]))
        report["requisites"].append(row.get("name"))
    db.flush()
    return report
