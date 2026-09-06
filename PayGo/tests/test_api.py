from decimal import Decimal

from paygo.db import transaction
from paygo.models import Deposit, User
from paygo.services import deposits
from paygo.services.cashes import get_cash

P = "/paygo/api"


def test_health(client):
    r = client.get(P + "/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_login_csrf_and_rbac(client, admin):
    assert client.get(P + "/dashboard").status_code == 401
    r = client.post(P + "/auth/login", json={"username": "owner", "password": "wrong"})
    assert r.status_code == 401
    r = client.post(P + "/auth/login", json={"username": "owner", "password": admin["password"]})
    assert r.status_code == 200
    cookie = r.cookies.get("paygo_session")
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
        from paygo.services import auth

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
    assert items[0]["enabled"] and items[1]["enabled"]  # 1xbet and 1win are both enabled by default
    assert items[0]["emoji"] == "😎" and items[1]["emoji"] == "🥇"
    assert all(f["masked"] != "p" for f in items[0]["credentials"] if f["secret"])
    r = logged.patch(P + f"/cashes/{items[0]['id']}", json={"critical_balance_threshold": "2500", "low_balance_threshold": "30000", "ip_address": "1.2.3.4"})
    assert r.status_code == 200 and r.json()["item"]["critical_balance_threshold"] == "2500.00"
    r = logged.post(P + "/cashes", json={"key": "test", "name": "Test", "provider_type": "servcul"})
    assert r.status_code == 200
    new_id = r.json()["item"]["id"]
    assert logged.delete(P + f"/cashes/{new_id}").json()["deleted"] is True


def test_withdrawal_admin_actions(logged, user, fake_provider):
    from paygo.services import withdrawals

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
    r = client.get("/paygo/")
    assert r.status_code == 200 and "PayGo" in r.text
    assert r.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in r.headers
    r = client.get("/paygo/api/health")
    assert r.headers["cache-control"] == "no-store"


def _png_bytes():
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_cash_photo_upload_and_private_files(logged, client):
    r = logged.get(P + "/cashes")
    cash_id = r.json()["items"][0]["id"]
    r = logged.post(P + f"/cashes/{cash_id}/photo", data={"kind": "deposit"}, files={"file": ("id.png", _png_bytes(), "image/png")})
    assert r.status_code == 200, r.text
    rel = r.json()["path"]
    assert rel.startswith("uploads/cash/1xbet-deposit-") and r.json()["item"]["deposit_photo"] == rel
    # served only to signed-in staff
    r = logged.get(P + "/files/" + rel[len("uploads/"):])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    from fastapi.testclient import TestClient

    with TestClient(logged.app) as anon_client:
        anon = anon_client.get(P + "/files/" + rel[len("uploads/"):])
    assert anon.status_code in (401, 403)
    r = logged.get(P + "/files/%2e%2e/%2e%2e/.env")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
    r = logged.post(P + f"/cashes/{cash_id}/photo", data={"kind": "code"}, files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_deposit_amount_edit_regenerates_qr_and_notifies(logged, user, fake_provider):
    from paygo.db import transaction
    from paygo.models import Deposit, Notification, PaymentCash, User
    from paygo.services import deposits as deposit_service
    from paygo.services import elqr

    with transaction() as db:
        cash = db.query(PaymentCash).filter_by(key="1xbet").one()
        dep, _ = deposit_service.create_deposit(db, user=db.get(User, user), cash=cash, player_id="123456", amount="1000", idempotency_key="edit-1")
        dep_id, old_pay = dep.id, str(dep.pay_amount)
    r = logged.post(P + f"/deposits/{dep_id}/edit", json={"fields": {"pay_amount": "1000.00"}})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["pay_amount"] == "1000.00" and item["pay_amount"] != old_pay
    with transaction() as db:
        d = db.get(Deposit, dep_id)
        assert elqr.amount_from_payload(d.qr_payload) == d.pay_amount
        note = db.query(Notification).filter_by(event="deposit_updated").one()
        assert note.data["refresh_card"] and note.data["request_id"] == d.public_id
    # amount that another active request already uses is refused
    from paygo.services.users import get_or_create

    with transaction() as db:
        cash = db.query(PaymentCash).filter_by(key="1xbet").one()
        second = get_or_create(db, {"id": 999888777, "first_name": "Second"})
        other, _ = deposit_service.create_deposit(db, user=second, cash=cash, player_id="654321", amount="500", idempotency_key="edit-3")
        busy = str(other.pay_amount)
    r = logged.post(P + f"/deposits/{dep_id}/edit", json={"fields": {"pay_amount": busy}})
    assert r.status_code == 400 and "занята" in r.json()["error"]


def test_requisite_mode_random_rotates(logged, user):
    from paygo.db import transaction
    from paygo.models import PaymentCash, PaymentRequisite
    from paygo.services import deposits as deposit_service
    from paygo.services import settings_store

    with transaction() as db:
        db.add(PaymentRequisite(name="Second", bank_type="optima", bank_name="Optima Bank", enabled=True, priority=200, payload="00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR", account="2", holder="2"))
    seen = set()
    for _ in range(30):
        with transaction() as db:
            cash = db.query(PaymentCash).filter_by(key="1xbet").one()
            seen.add(deposit_service.choose_requisite(db, cash).name)
    assert seen == {"Optima", "Second"}  # random mode uses both
    with transaction() as db:
        settings_store.set_many(db, {"requisite_mode": "priority"}, "test")
    seen = set()
    for _ in range(10):
        with transaction() as db:
            cash = db.query(PaymentCash).filter_by(key="1xbet").one()
            seen.add(deposit_service.choose_requisite(db, cash).name)
    assert seen == {"Optima"}  # priority mode: lowest number only


def test_webhook_ip_allowlist_and_signature_policy(client, logged, user):
    import os

    from paygo.db import transaction
    from paygo.services import settings_store

    secret = os.environ["WEBHOOK_SECRET"]
    with transaction() as db:
        settings_store.set_many(db, {"webhook_ip_allowlist": "10.0.0.0/8, 203.0.113.7"}, "test")
    r = client.post(P + f"/webhooks/payments/{secret}", json={"text": "Пополнение 100.50 сом"})
    assert r.status_code == 403  # testclient address is not in the list
    with transaction() as db:
        settings_store.set_many(db, {"webhook_ip_allowlist": "", "webhook_require_signature": True}, "test")
    r = client.post(P + f"/webhooks/payments/{secret}", json={"text": "Пополнение 100.50 сом"})
    assert r.status_code == 401
    with transaction() as db:
        settings_store.set_many(db, {"webhook_require_signature": False}, "test")
    r = client.post(P + f"/webhooks/payments/{secret}", json={"text": "Пополнение 100.50 сом"})
    assert r.status_code == 200 and r.json()["accepted"]
    # admin helper page data + synthetic test event
    r = logged.get(P + "/webhook-info")
    assert r.status_code == 200 and r.json()["url"].endswith(secret) and r.json()["recent"]
    r = logged.post(P + "/webhook-info/test")
    assert r.status_code == 200 and r.json()["event"]["source"] == "test" and r.json()["event"]["status"] in {"unmatched", "received", "processing"}


def test_admin_ip_allowlist(client, admin, monkeypatch):
    from paygo.config import reset_settings_cache

    monkeypatch.setenv("ADMIN_IP_ALLOWLIST", "203.0.113.0/24")
    reset_settings_cache()
    try:
        r = client.post(P + "/auth/login", json={"username": admin["username"], "password": admin["password"]})
        assert r.status_code == 403 and r.json()["error"] == "IP_NOT_ALLOWED"
        r = client.get(P + "/live")
        assert r.status_code == 403
    finally:
        monkeypatch.delenv("ADMIN_IP_ALLOWLIST")
        reset_settings_cache()
    r = client.post(P + "/auth/login", json={"username": admin["username"], "password": admin["password"]})
    assert r.status_code == 200


def test_settings_reset_and_premium_test_validation(logged):
    r = logged.post(P + "/settings", json={"values": {"greeting_text": "custom", "text_help": "h"}})
    assert r.status_code == 200 and r.json()["values"]["greeting_text"] == "custom"
    r = logged.post(P + "/settings/reset", json={"keys": ["texts"]})
    assert r.status_code == 200 and set(r.json()["reset"]) == {"greeting_text", "text_help"}
    assert r.json()["values"]["greeting_text"].startswith("[emoji:")
    r = logged.post(P + "/settings/premium-test", json={})
    assert r.status_code == 400  # no chat id and no ADMIN_TELEGRAM_CHAT_IDS in tests
    r = logged.post(P + "/bank-links", json={"key": "mbank", "custom_emoji_id": "777"})
    assert r.status_code == 200 and next(x for x in r.json()["items"] if x["key"] == "mbank")["custom_emoji_id"] == "777"
