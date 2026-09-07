from decimal import Decimal

from paygo.db import transaction
from paygo.models import Deposit, Notification, User
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


def test_requisite_for_all_cashes_and_optima_c2c_link(logged):
    src = "https://optimabank.kg/index.php?lang=ru#00020101021132620013QR.Optima.C2C010310010129967070007271106emir%20a1202111302125204999953034175906emir%20a63047838"
    r = logged.post(P + "/requisites", json={"name": "Rus", "source": src, "priority": 100, "cash_id": 0, "notes": ""})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["cash_id"] is None and item["bank_name"] == "Optima Bank" and item["account"] == "996707000727"
    r = logged.patch(P + f"/requisites/{item['id']}", json={"cash_id": 0, "priority": 5})
    assert r.status_code == 200 and r.json()["item"]["cash_id"] is None and r.json()["item"]["priority"] == 5


def test_chat_open_from_profile_reply_edit_delete(logged, user):
    from paygo.models import Notification, SupportMessage

    r = logged.post(P + f"/users/{user}/conversation")
    assert r.status_code == 200, r.text
    conv_id = r.json()["item"]["id"]
    assert r.json()["channel"] == "main"  # the client never opened the support bot → main bot carries the dialog
    assert logged.post(P + f"/users/{user}/conversation").json()["item"]["id"] == conv_id
    r = logged.post(P + f"/support/conversations/{conv_id}/reply", json={"text": "Здравствуйте"})
    assert r.status_code == 200, r.text
    msg_id = r.json()["message"]["id"]
    with transaction() as db:
        note = db.query(Notification).filter_by(event="support_reply").one()
        assert note.bot == "main" and note.data["message_id"] == msg_id
        db.get(SupportMessage, msg_id).telegram_message_id = 777  # the bot writes it back after sending
    r = logged.post(P + f"/support/conversations/{conv_id}/reply", json={"text": "Уточнение", "reply_to": msg_id})
    assert r.json()["message"]["reply_to"]["id"] == msg_id
    with transaction() as db:
        quoted = db.query(Notification).filter_by(event="support_reply").order_by(Notification.id.desc()).first()
        assert quoted.data["reply_to"] == 777
    r = logged.patch(P + f"/support/messages/{msg_id}", json={"text": "Здравствуйте!"})
    assert r.status_code == 200 and r.json()["message"]["edited_at"]
    r = logged.delete(P + f"/support/messages/{msg_id}")
    assert r.status_code == 200 and r.json()["message"]["deleted_at"]
    with transaction() as db:
        events = [n.event for n in db.query(Notification).filter(Notification.event.in_(("support_edit", "support_delete"))).all()]
        assert sorted(events) == ["support_delete", "support_edit"]
        assert db.query(Notification).filter_by(event="support_edit").one().data["telegram_message_id"] == 777
    r = logged.get(P + f"/support/conversations/{conv_id}")
    msgs = {m["id"]: m for m in r.json()["messages"]}
    assert msgs[msg_id]["deleted_at"] and msgs[msg_id]["text"] == ""


def test_broadcast_audiences_buttons_and_test_send(logged, user):
    from paygo.models import Notification

    assert logged.get(P + "/broadcast/audience?audience=all").json()["count"] == 1
    assert logged.get(P + "/broadcast/audience?audience=new").json()["count"] == 1
    assert logged.get(P + "/broadcast/audience?audience=big").json()["count"] == 0
    bad = logged.post(P + "/broadcast", json={"text": "Привет", "buttons": [{"text": "Сайт", "url": "javascript:alert(1)"}]})
    assert bad.status_code == 400
    r = logged.post(P + "/broadcast", json={"text": "Привет", "audience": "all", "bot": "main", "buttons": [{"text": "Сайт", "url": "https://paygo.kg"}]})
    assert r.status_code == 200 and r.json()["recipients"] == 1 and r.json()["item"]["status"] == "queued"
    bid = r.json()["item"]["id"]
    from paygo.services import broadcasts

    with transaction() as db:
        broadcasts.tick(db)  # the worker expands the queue in the background
    r = logged.post(P + "/broadcast", json={"text": "Тест", "audience": "test", "test_chat_id": "700100200"})
    assert r.status_code == 200 and r.json()["test"] is True
    with transaction() as db:
        notes = db.query(Notification).filter_by(event="broadcast").order_by(Notification.id).all()
        assert notes[0].data["buttons"] == [{"text": "Сайт", "url": "https://paygo.kg"}] and notes[0].data["broadcast_id"] == bid
        assert notes[1].target_telegram_id == 700100200 and notes[1].data.get("test") is True
    hist = logged.get(P + "/broadcast/history").json()["items"]
    assert hist[0]["id"] == bid and hist[0]["status"] == "delivering" and hist[0]["recipients"] == 1 and hist[0]["sent"] == 0
    with transaction() as db:
        note = db.query(Notification).filter_by(event="broadcast").order_by(Notification.id).first()
        note.status = "failed"
        note.error = "Forbidden: bot was blocked by the user"
    detail = logged.get(P + f"/broadcast/{bid}").json()["item"]
    assert detail["status"] == "done" and detail["failed"] == 1 and detail["errors"][0]["error"].startswith("Forbidden")


def test_deposit_list_shows_payment_hint(logged, user, fake_provider):
    from paygo.models import PaymentEvent

    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="900", idempotency_key="hint1")
        dep_id, pay = dep.id, dep.pay_amount
        db.add(PaymentEvent(source="webhook", event_key="hint-evt-1", amount=pay, currency="KGS", status="failed", raw_text="MBank: зачисление", error="касса недоступна"))
    r = logged.get(P + "/deposits?status=created")
    item = next(x for x in r.json()["items"] if x["id"] == dep_id)
    assert item["payment"]["kind"] == "candidate" and item["payment"]["amount"] == str(pay)


def test_operator_sends_photo_and_video(logged, user):
    r = logged.post(P + f"/users/{user}/conversation")
    conv = r.json()["item"]["id"]
    up = logged.post(P + "/support/upload", files={"file": ("clip.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64, "video/mp4")})
    assert up.status_code == 200 and up.json()["kind"] == "video", up.text
    r = logged.post(P + f"/support/conversations/{conv}/reply", json={"text": "", "video_url": up.json()["url"]})
    assert r.status_code == 200 and r.json()["message"]["kind"] == "video"
    up2 = logged.post(P + "/support/upload", files={"file": ("shot.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png")})
    assert up2.json()["kind"] == "image"
    r = logged.post(P + f"/support/conversations/{conv}/reply", json={"text": "чек", "photo_url": up2.json()["url"]})
    assert r.json()["message"]["kind"] == "photo"
    with transaction() as db:
        notes = db.query(Notification).filter_by(event="support_reply").order_by(Notification.id).all()
        assert notes[0].data["video_url"].endswith(".mp4") and notes[1].data["photo_url"].endswith(".png")
    assert logged.post(P + f"/support/conversations/{conv}/reply", json={"text": ""}).status_code == 400


def _fresh_withdrawal(user, amount="12000", code="ABCD1234"):
    from paygo.models import Withdrawal
    from paygo.utils import new_public_id

    with transaction() as db:
        cash_id = get_cash(db, "1xbet").id
        row = Withdrawal(public_id=new_public_id("W"), user_id=user, cash_id=cash_id, player_id="77123456", amount=Decimal(amount), currency="KGS", code=code, status="created", provider_claim_key=f"test:{cash_id}:77123456:{code}", idempotency_key=f"idem-{code}")
        db.add(row)
        db.flush()
        return row.id


def test_large_payout_needs_receipt_and_client_gets_it(logged, user, fake_provider):
    wid = _fresh_withdrawal(user, "12000", "RCPT0001")
    r = logged.get(P + f"/withdrawals/{wid}")
    assert r.json()["item"]["receipt_required"] is True
    r = logged.post(P + f"/withdrawals/{wid}/action", json={"action": "complete"})
    assert r.status_code == 400 and "чек" in r.json()["error"].lower()
    up = logged.post(P + f"/withdrawals/{wid}/receipt", files={"file": ("receipt.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png")})
    assert up.status_code == 200 and up.json()["item"]["has_receipt"] is True
    assert logged.get(P + f"/withdrawals/{wid}/receipt").status_code == 200
    r = logged.post(P + f"/withdrawals/{wid}/action", json={"action": "complete"})
    assert r.status_code == 200 and r.json()["item"]["status"] == "success"
    with transaction() as db:
        note = db.query(Notification).filter_by(event="withdrawal_success").one()
        assert note.data["photo_url"].startswith("/uploads/receipts/")
    small = _fresh_withdrawal(user, "3000", "RCPT0002")
    assert logged.get(P + f"/withdrawals/{small}").json()["item"]["receipt_required"] is False
    assert logged.post(P + f"/withdrawals/{small}/action", json={"action": "complete"}).status_code == 200


def test_withdrawal_qr_decoded_again_from_photo(logged, user, fake_provider):
    from paygo.config import get_settings
    from paygo.services.qr import render_qr_png

    payload = "00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR"
    wid = _fresh_withdrawal(user, "4200", "QRDEC001")
    folder = get_settings().data_dir / "uploads" / "qr"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "client.png").write_bytes(render_qr_png(payload))
    from paygo.models import Withdrawal

    with transaction() as db:
        w = db.get(Withdrawal, wid)
        w.qr_file_url = "/uploads/qr/client.png"
        w.qr_payload = ""
        w.generated_qr_payload = ""
    item = logged.get(P + f"/withdrawals/{wid}").json()["item"]
    assert item["has_qr"] and not item["qr_decoded"] and not item["has_generated_qr"]
    r = logged.post(P + f"/withdrawals/{wid}/decode-qr")
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["qr_decoded"] and item["has_generated_qr"] and item["generated_qr_payload"].startswith("000201")
    assert "4200" in item["generated_qr_payload"].replace(".", "")


def test_payment_with_whole_soms_credits_what_was_paid(logged, user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="900", idempotency_key="whole1")
        dep_id, pay = dep.id, str(dep.pay_amount)
    assert pay != "900.00"
    r = logged.post(P + "/webhooks/payments/test-webhook-secret-test-webhook-secret", json={"text": "MBank: зачисление 900.00 KGS"})
    assert r.status_code == 200 and r.json()["accepted"]
    with transaction() as db:
        d = db.get(Deposit, dep_id)
        assert d.status == "success" and str(d.pay_amount) == "900.00"
    assert [c for c in fake_provider["calls"] if c[0] == "deposit"][-1][1][1] == Decimal("900.00")


def test_1win_provider_has_three_fields_only():
    from paygo.providers import provider_types

    xapi = next(t for t in provider_types() if t["type"] == "xapi")
    assert [f["key"] for f in xapi["fields"]] == ["api_key", "agent_login", "agent_password"]
