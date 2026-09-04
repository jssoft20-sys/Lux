from decimal import Decimal

from onoipay.db import transaction
from onoipay.models import Deposit, User
from onoipay.services import deposits
from onoipay.services.cashes import get_cash

P = "/onoipay/api"


def test_health(client):
    r = client.get(P + "/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_login_csrf_and_rbac(client, admin):
    assert client.get(P + "/dashboard").status_code == 401
    r = client.post(P + "/auth/login", json={"username": "owner", "password": "wrong"})
    assert r.status_code == 401
    r = client.post(P + "/auth/login", json={"username": "owner", "password": admin["password"]})
    assert r.status_code == 200
    cookie = r.cookies.get("onoipay_session")
    assert cookie
    assert "HttpOnly" in r.headers.get("set-cookie", "")
    # state-changing request without CSRF header is rejected
    r = client.post(P + "/settings", json={"values": {"bot_paused": True}})
    assert r.status_code == 403 and r.json()["error"] == "CSRF_FAILED"
    csrf = client.get(P + "/auth/me").json()["admin"]["csrf_token"]
    r = client.post(P + "/settings", json={"values": {"bot_paused": True}}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200 and r.json()["values"]["bot_paused"] is True
    # viewer cannot change settings
    with transaction() as db:
        from onoipay.services import auth

        auth.create_admin(db, "viewer", "ViewerPass123", "viewer")
    c2 = client.__class__(client.app)
    r = c2.post(P + "/auth/login", json={"username": "viewer", "password": "ViewerPass123"})
    csrf2 = r.json()["admin"]["csrf_token"]
    assert c2.get(P + "/dashboard").status_code == 200
    assert c2.post(P + "/settings", json={"values": {}}, headers={"X-CSRF-Token": csrf2}).status_code == 403


def test_brute_force_lock(client, admin):
    for _ in range(5):
        client.post(P + "/auth/login", json={"username": "owner", "password": "bad"})
    r = client.post(P + "/auth/login", json={"username": "owner", "password": admin["password"]})
    assert r.status_code == 429


def test_sessions_revoke(logged):
    r = logged.get(P + "/auth/sessions")
    assert r.status_code == 200 and r.json()["items"][0]["current"]
    r = logged.post(P + "/auth/refresh")
    assert r.status_code == 200
    assert logged.get(P + "/auth/me").status_code == 200
    assert logged.post(P + "/auth/logout").status_code == 200
    assert logged.get(P + "/auth/me").status_code == 401


def test_webhook_flow(logged, user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        cash = get_cash(db, "1xbet")
        dep, _ = deposits.create_deposit(db, user=u, cash=cash, player_id="123456", amount="500", idempotency_key="api1")
        pay = str(dep.pay_amount)
        dep_id = dep.id
    assert logged.post(P + "/webhooks/payments/wrong", data="x").status_code == 401
    r = logged.post(P + "/webhooks/payments/test-webhook-secret-test-webhook-secret", json={"text": f"Optima: зачислено {pay} KGS"})
    assert r.status_code == 200 and r.json()["accepted"]
    r2 = logged.post(P + "/webhooks/payments/test-webhook-secret-test-webhook-secret", json={"text": f"Optima: зачислено {pay} KGS"})
    assert r2.json()["duplicate"] is True
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "success"
    assert len([c for c in fake_provider["calls"] if c[0] == "deposit"]) == 1
    r = logged.get(P + f"/deposits/{dep_id}")
    assert r.json()["item"]["status"] == "success"
    assert r.json()["payment_event"]["status"] == "matched"
    r = logged.get(P + "/live")
    assert r.status_code == 200 and any(n["event"] == "deposit_new" for n in r.json()["notifications"])


def test_cash_management(logged):
    r = logged.get(P + "/cashes")
    items = r.json()["items"]
    assert [c["key"] for c in items] == ["1xbet", "1win"]
    assert items[0]["enabled"] and not items[1]["enabled"]
    assert all(f["masked"] != "p" for f in items[0]["credentials"] if f["secret"])
    r = logged.patch(P + f"/cashes/{items[0]['id']}", json={"critical_balance_threshold": "2500", "low_balance_threshold": "30000", "ip_address": "1.2.3.4"})
    assert r.status_code == 200 and r.json()["item"]["critical_balance_threshold"] == "2500.00"
    r = logged.post(P + "/cashes", json={"key": "test", "name": "Test", "provider_type": "servcul"})
    assert r.status_code == 200
    new_id = r.json()["item"]["id"]
    assert logged.delete(P + f"/cashes/{new_id}").json()["deleted"] is True


def test_withdrawal_admin_actions(logged, user, fake_provider):
    from onoipay.services import withdrawals

    with transaction() as db:
        cash_id = get_cash(db, "1xbet").id
    wid = withdrawals.create_withdrawal(user_id=user, cash_id=cash_id, player_id="123456", code="ADM1234", idempotency_key="adm1")["withdrawal"]["id"]
    r = logged.get(P + "/withdrawals?status=active")
    assert r.json()["total"] == 1
    r = logged.post(P + f"/withdrawals/{wid}/edit", json={"fields": {"amount": "5400"}})
    assert r.status_code == 200 and r.json()["item"]["amount"] == "5400.00"
    r = logged.post(P + f"/withdrawals/{wid}/action", json={"action": "take"})
    assert r.json()["item"]["status"] == "processing"
    r = logged.post(P + f"/withdrawals/{wid}/action", json={"action": "complete"})
    assert r.json()["item"]["status"] == "success"
    r = logged.get(P + "/logs?kind=audit")
    assert any(x["action"] == "withdrawal.complete" for x in r.json()["items"])


def test_manual_payment_event(logged, user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="700", idempotency_key="m1")
        pay = str(Decimal(dep.pay_amount))
    r = logged.post(P + "/payment-events/manual", json={"amount": pay, "note": "видел в выписке"})
    assert r.status_code == 200 and r.json()["result"]["ok"] is True


def test_security_headers_and_spa(client):
    r = client.get("/onoipay/")
    assert r.status_code == 200 and "OnoiPay" in r.text
    assert r.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in r.headers
    r = client.get("/onoipay/api/health")
    assert r.headers["cache-control"] == "no-store"
