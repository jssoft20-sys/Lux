"""Shared fixtures: isolated SQLite database, seeded cash desks, API client, fake providers."""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "bot"))

os.environ.update({
    "APP_ENV": "test",
    "SECRET_KEY": "test-secret-key-test-secret-key-test-secret",
    "JWT_SECRET": "test-jwt-secret-test-jwt-secret-test-jwt",
    "SESSION_SECRET": "test-session-secret-test-session-secret",
    "WEBHOOK_SECRET": "test-webhook-secret-test-webhook-secret",
    "ENCRYPTION_KEY": "test-encryption-key-test-encryption-key",
    "COOKIE_SECURE": "false",
    "ADMIN_TELEGRAM_CHAT_IDS": "",
    "ONOI_ENV_FILE": "/nonexistent/.env",
})


@pytest.fixture(autouse=True)
def database(tmp_path, monkeypatch):
    """Fresh schema per test. Set TEST_DATABASE_URL=postgresql+psycopg://... to run against PostgreSQL."""
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.sqlite3'}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from onoipay.config import reset_settings_cache

    reset_settings_cache()
    from onoipay import db as dbmod
    from onoipay import models  # noqa: F401
    from onoipay.services import settings_store

    engine = dbmod.configure_engine(url)
    if not url.startswith("sqlite"):
        dbmod.Base.metadata.drop_all(engine)
    dbmod.create_all()
    settings_store.invalidate()
    yield dbmod
    if not url.startswith("sqlite"):
        dbmod.Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def seeded(database):
    from onoipay.db import transaction
    from onoipay.models import PaymentRequisite
    from onoipay.seed import seed_defaults
    from onoipay.services.cashes import get_cash, update_cash

    with transaction() as db:
        seed_defaults(db)
        cash = get_cash(db, "1xbet")
        update_cash(db, cash, {"enabled": True, "credentials": {"login": "l", "cashierpass": "p", "cashdeskid": "123", "hash": "h"}, "accepted_currency_ids": "KGS,417"})
        db.add(PaymentRequisite(name="Optima", bank_type="optima", bank_name="Optima Bank", enabled=True, priority=100, payload="00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR", account="1091821234350118", holder="2149664:1:1"))
    return database


@pytest.fixture
def user(seeded):
    from onoipay.db import transaction
    from onoipay.services.users import get_or_create

    with transaction() as db:
        u = get_or_create(db, {"id": 111222333, "username": "tester", "first_name": "Тест"})
        return u.id


@pytest.fixture
def fake_provider(monkeypatch):
    """Replace the network adapter with a controllable fake."""
    from onoipay.providers import ProviderResult
    from onoipay.services import cashes as cash_service

    calls: list[tuple[str, tuple]] = []
    behaviour = {"lookup_currency": "KGS", "withdraw_amount": Decimal("5300"), "deposit_ok": True, "withdraw_ok": True, "lookup_ok": True}

    class Fake:
        def __init__(self, cash, creds):
            self.cash = cash

        def lookup_player(self, player_id):
            calls.append(("lookup", (player_id,)))
            if not behaviour["lookup_ok"]:
                return ProviderResult(ok=False, message="ID не найден", extra={"code": "PLAYER_NOT_FOUND"})
            return ProviderResult(ok=True, player_name="Player", currency=behaviour["lookup_currency"])

        def deposit(self, player_id, amount):
            calls.append(("deposit", (player_id, amount)))
            if behaviour["deposit_ok"]:
                return ProviderResult(ok=True, status=200, data={"Success": True, "OperationId": 777}, reference="777")
            return ProviderResult(ok=False, status=400, data={"Message": "limit"}, message="Сумма превышает доступный лимит кассы.")

        def withdraw(self, player_id, code):
            calls.append(("withdraw", (player_id, code)))
            if behaviour["withdraw_ok"]:
                return ProviderResult(ok=True, status=200, amount=behaviour["withdraw_amount"], data={"Summa": -5300}, reference="pay1")
            return ProviderResult(ok=False, status=400, message="Неверный код вывода.")

        def balance(self):
            calls.append(("balance", ()))
            return ProviderResult(ok=True, status=200, balance=Decimal("50000"), limit=Decimal("100000"))

        def test_connection(self):
            return self.balance()

    monkeypatch.setattr(cash_service, "get_adapter", lambda cash, creds: Fake(cash, creds))
    monkeypatch.setattr(cash_service, "adapter", lambda cash: Fake(cash, {}))
    return {"calls": calls, "behaviour": behaviour}


@pytest.fixture
def client(seeded):
    from fastapi.testclient import TestClient

    from onoipay.app import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin(seeded):
    from onoipay.db import transaction
    from onoipay.services import auth

    with transaction() as db:
        a = auth.create_admin(db, "owner", "OwnerPass123", "owner", "Owner")
        return {"id": a.id, "username": "owner", "password": "OwnerPass123"}


@pytest.fixture
def logged(client, admin):
    r = client.post("/onoipay/api/auth/login", json={"username": admin["username"], "password": admin["password"]})
    assert r.status_code == 200, r.text
    csrf = r.json()["admin"]["csrf_token"]
    client.headers.update({"X-CSRF-Token": csrf})
    return client
