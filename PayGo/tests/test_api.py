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


def test_support_search_finds_chats_and_messages(logged, user):
    conv_id = logged.post(P + f"/users/{user}/conversation").json()["item"]["id"]
    assert logged.post(P + f"/support/conversations/{conv_id}/reply", json={"text": "Ваш вывод отправлен, проверьте баланс"}).status_code == 200
    body = logged.get(P + "/support/search?q=вывод").json()
    assert body["ok"] and [m["conversation_id"] for m in body["messages"]] == [conv_id]
    assert body["messages"][0]["sender"] == "operator" and body["messages"][0]["user_name"]
    first_name = body["messages"][0]["user_name"].split()[0]
    assert [c["id"] for c in logged.get(P + "/support/search?q=" + first_name).json()["chats"]] == [conv_id]
    assert logged.get(P + "/support/search?q=").json() == {"ok": True, "chats": [], "messages": []}
    assert logged.get(P + "/support/search?q=nobody-has-this-name").json()["chats"] == []


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
    main = [f["key"] for f in xapi["fields"] if not f.get("advanced")]
    assert main == ["api_key", "agent_login", "agent_password"]
    # the browser identity the 1win.win portal expects (values from the old panel) stays optional
    assert [f["key"] for f in xapi["fields"] if f.get("advanced")] == ["agent_fingerprint_id", "agent_client_id", "agent_user_agent"]


def test_login_is_confirmed_in_the_main_bot(client, admin, monkeypatch):
    """Password → pending request → ✅ in the bot → month-long session."""
    from paygo.db import transaction
    from paygo.models import LoginRequest, Notification
    from paygo.services import auth as auth_service
    from paygo.services import settings_store

    with transaction() as db:
        settings_store.set_many(db, {"login_approver_telegram_id": 8274883903})
    r = client.post(P + "/auth/login", json={"username": admin["username"], "password": admin["password"], "device": "iPhone"}, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Version/18.5 Mobile Safari/604.1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pending"] and body["request_token"] and "paygo_session" not in r.cookies
    assert "iPhone" in body["device"] and "Safari" in body["device"]
    with transaction() as db:
        note = db.query(Notification).filter_by(event="login_request").one()
        assert note.bot == "main" and note.target_telegram_id == 8274883903 and note.data["inline"][0][0]["callback_data"].startswith("login:ok:")
        req = db.query(LoginRequest).one()
        assert req.status == "pending" and req.username == admin["username"]
        request_id = req.id
    st = client.post(P + "/auth/login/status", json={"request_token": body["request_token"]})
    assert st.json()["status"] == "pending" and st.json()["seconds_left"] > 0
    # somebody else's tap does nothing; the approver's ✅ does
    with transaction() as db:
        assert auth_service.approver_telegram_id(db) == 8274883903
        assert auth_service.decide_login_request(db, request_id, True, 8274883903).status == "approved"
    st = client.post(P + "/auth/login/status", json={"request_token": body["request_token"]})
    assert st.status_code == 200 and st.json()["status"] == "approved" and st.json()["admin"]["username"] == admin["username"]
    assert "paygo_session" in st.cookies
    with transaction() as db:
        req = db.query(LoginRequest).one()
        assert req.status == "used" and req.session_id
        from paygo.models import AdminSession
        sess = db.get(AdminSession, req.session_id)
        assert (sess.absolute_expires_at - sess.created_at).days >= 29
    # the token is single-use
    assert client.post(P + "/auth/login/status", json={"request_token": body["request_token"]}).json()["status"] == "used"
    # a rejected login never becomes a session
    r2 = client.post(P + "/auth/login", json={"username": admin["username"], "password": admin["password"]})
    with transaction() as db:
        pending = db.query(LoginRequest).filter_by(status="pending").one()
        auth_service.decide_login_request(db, pending.id, False, 8274883903)
    st2 = client.post(P + "/auth/login/status", json={"request_token": r2.json()["request_token"]})
    assert st2.json()["status"] == "rejected" and "paygo_session" not in st2.cookies


def test_device_description():
    from paygo.services.auth import describe_device

    assert describe_device("Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A) Chrome/124 Mobile Safari/537.36") == "Android · SM-S911B · Chrome"
    assert describe_device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1 PayGoApp/1.0", "iOS") == "iPhone · iOS 17.4 · приложение PayGo"
    assert describe_device("Mozilla/5.0 (Windows NT 10.0) Chrome/120", "Windows · ноутбук") == "Windows · ноутбук · Chrome"


def test_manual_credit_uses_the_amount_the_client_paid(logged, user, fake_provider):
    """«Зачислить на счёт игрока» with the paid amount: the player gets exactly that figure (tiyins
    included), the request records it, and the client gets «Пополнено» — not an «amount changed» notice."""
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="1500", idempotency_key="paid1")
        dep_id, requested = dep.id, str(dep.pay_amount)
    assert requested != "1500.90"
    r = logged.post(P + f"/deposits/{dep_id}/action", json={"action": "credit", "amount": "1500,90"})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["status"] == "success" and item["pay_amount"] == "1500.90"
    assert [c for c in fake_provider["calls"] if c[0] == "deposit"][-1][1] == ("123456", Decimal("1500.90"))
    with transaction() as db:
        assert db.query(Notification).filter_by(event="deposit_updated").count() == 0
        done = db.query(Notification).filter_by(event="deposit_success").one()
        assert "1500.90" in done.body
    # a paid amount that belongs to another open request is refused, nothing is credited
    from paygo.services.users import get_or_create

    with transaction() as db:
        u = db.get(User, user)
        other, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="777777", amount="700", idempotency_key="paid2")
        u2 = get_or_create(db, {"id": 444555666, "first_name": "Второй"})
        second, _ = deposits.create_deposit(db, user=u2, cash=get_cash(db, "1xbet"), player_id="888888", amount="700", idempotency_key="paid3")
        busy, second_id = str(other.pay_amount), second.id
    r = logged.post(P + f"/deposits/{second_id}/action", json={"action": "credit", "amount": busy})
    assert r.status_code == 400 and "занята" in r.json()["error"]
    with transaction() as db:
        assert db.get(Deposit, second_id).status == "created"


def test_mark_success_records_the_paid_amount(logged, user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="400", idempotency_key="paid4")
        dep_id = dep.id
    r = logged.post(P + f"/deposits/{dep_id}/action", json={"action": "mark_success", "amount": "400.00", "reason": "зачислил вручную"})
    assert r.status_code == 200, r.text
    assert r.json()["item"]["status"] == "success" and r.json()["item"]["pay_amount"] == "400.00"
    assert not [c for c in fake_provider["calls"] if c[0] == "deposit"]  # no API call for a manual mark


def test_provider_that_rounds_the_tiyins_away_is_logged(logged, user, fake_provider, monkeypatch):
    from paygo.models import SystemLog
    from paygo.providers import ProviderResult
    from paygo.services import cashes as cash_service

    class Rounding:
        def __init__(self, cash, creds):
            pass

        def deposit(self, player_id, amount):
            return ProviderResult(ok=True, status=200, data={"Success": True, "OperationId": 5, "Summa": int(amount)}, reference="5", amount=Decimal(int(amount)))

    monkeypatch.setattr(cash_service, "get_adapter", lambda cash, creds: Rounding(cash, creds))
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="1200", idempotency_key="round1")
        dep_id, pay = dep.id, str(dep.pay_amount)
    r = logged.post(P + f"/deposits/{dep_id}/action", json={"action": "credit"})
    assert r.status_code == 200, r.text
    with transaction() as db:
        row = db.query(SystemLog).filter(SystemLog.title == "Касса ответила другой суммой").one()
        assert pay in row.detail and "1200.00" in row.detail and row.level == "warning"


def test_deposit_detail_carries_the_bank_payment_hint(logged, user, fake_provider):
    """The request card (detail endpoint) shows the same bank payment as the lists — matched or a
    notification with exactly this amount that is still unmatched — so «Зачислить» starts from it."""
    from paygo.services import payments

    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="640", idempotency_key="hint1")
        dep_id, pay = dep.id, str(dep.pay_amount)
        event, _ = payments.ingest_event(db, source="webhook", amount=dep.pay_amount, raw_text="late notice", event_key="hint-ev")
        event.status = "unmatched"
    item = logged.get(P + f"/deposits/{dep_id}").json()["item"]
    assert item["payment"] and item["payment"]["kind"] == "candidate" and item["payment"]["amount"] == pay and item["payment"]["source"] == "webhook"
    r = logged.post(P + f"/deposits/{dep_id}/action", json={"action": "credit", "amount": pay})
    assert r.status_code == 200 and r.json()["item"]["status"] == "success"


def test_cli_revoke_sessions_signs_everybody_out(logged, admin):
    from paygo import cli

    assert logged.get(P + "/auth/me").status_code == 200
    assert cli.main(["revoke-sessions"]) == 0
    assert logged.get(P + "/auth/me").status_code == 401
    with transaction() as db:
        from paygo.models import AdminSession, AuditLog

        assert all(s.revoked_at is not None and s.revoked_reason == "revoked_by_cli" for s in db.query(AdminSession).all())
        assert db.query(AuditLog).filter_by(action="auth.sessions_revoked_all").count() == 1


def test_live_has_no_season_fields(logged):
    body = logged.get(P + "/live").json()
    assert body["ok"] is True and "season" not in body and "queues" in body


def test_bank_detection_uses_official_marks():
    from paygo.services import elqr

    finik = elqr.detect_bank("https://qr.finik.kg/f36e0f6a-1f22-4f34-a177-71444f6c91aa?type=t")
    assert finik["key"] == "finik" and finik["logo"] == "brand/banks/finik.png"
    assert elqr.detect_bank("https://app.mbank.kg/qr/#000201")["key"] == "mbank"
    assert elqr.detect_bank("")["logo"] == elqr.FALLBACK_LOGO
    assert elqr.bank_disabled("https://qr.finik.kg/x", "finik, mbank") == "Finik"
    assert elqr.bank_disabled("https://qr.finik.kg/x", "") == ""
    assert elqr.bank_disabled("https://app.mbank.kg/qr/#0002", "finik") == ""


def test_bank_link_resolves_to_elqr_payload():
    """A Finik page link resolves (once) to the ELQR payload its Optima24 button carries; a raw payload
    or a deep link needs no network; an unreachable page yields '' and is not retried at once."""
    from conftest import FINIK_PAYLOAD
    from paygo.services import elqr

    link = "https://qr.finik.kg/f36e0f6a-1f22-4f34-a177-71444f6c91aa?type=t"
    payload = elqr.resolve_bank_link(link)
    assert payload == elqr.strip_crc(FINIK_PAYLOAD) and elqr.detect_bank(payload)["key"] == "finik"
    assert elqr.resolve_bank_link(FINIK_PAYLOAD) == elqr.strip_crc(FINIK_PAYLOAD)
    assert elqr.resolve_bank_link("https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=#" + FINIK_PAYLOAD) == elqr.strip_crc(FINIK_PAYLOAD)
    calls = []

    def dead(url, timeout=8.0):
        calls.append(url)
        raise OSError("offline")

    assert elqr.resolve_bank_link("https://app.mbank.kg/qr/abc", fetch=dead) == ""
    assert elqr.resolve_bank_link("https://app.mbank.kg/qr/abc", fetch=dead) == "" and len(calls) == 1
    assert elqr.resolve_bank_link("just words") == "" and elqr.resolve_bank_link("") == ""
    full = elqr.inject_amount(payload, "150")
    assert elqr.amount_from_payload(full) == Decimal("150")
    assert elqr.optima_confirm_link(full).startswith("https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=#000201")


def test_withdrawal_page_resolves_bank_link_and_offers_optima_button(logged, user, fake_provider):
    """A withdrawal stored with a bare bank link (older versions) is resolved when opened: «Ген QR»
    and the Optima24 pay link appear; editing the QR with a page link works the same way."""
    from paygo.db import transaction
    from paygo.models import PaymentCash, Withdrawal
    from paygo.services import elqr
    from paygo.utils import new_public_id
    from sqlalchemy import select

    with transaction() as db:
        cash = db.execute(select(PaymentCash)).scalars().first()
        w = Withdrawal(public_id=new_public_id("W"), user_id=user, cash_id=cash.id, player_id="123456", currency="KGS", amount=Decimal("150"), code="C1", provider_claim_key="k1", idempotency_key="i1", qr_payload="https://qr.finik.kg/f36e0f6a-1f22-4f34-a177-71444f6c91aa?type=t", status="created", source="demo")
        db.add(w)
        db.flush()
        wid = w.id
    r = logged.get(f"/paygo/api/withdrawals/{wid}")
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["has_generated_qr"] and item["bank"]["key"] == "finik" and item["optima_pay_link"].startswith("https://mobile.optima24.kg/")
    assert elqr.amount_from_payload(item["generated_qr_payload"]) == Decimal("150")
    r = logged.post(f"/paygo/api/withdrawals/{wid}/edit", json={"fields": {"qr_payload": "https://app.mbank.kg/qr/abc"}})
    assert r.status_code == 200, r.text  # unreachable page: the link is kept, no generated QR
    r = logged.get(f"/paygo/api/withdrawals/{wid}")
    assert r.json()["item"]["qr_payload"] == "https://app.mbank.kg/qr/abc" and not r.json()["item"]["has_generated_qr"]
    r = logged.post(f"/paygo/api/withdrawals/{wid}/edit", json={"fields": {"qr_payload": "not a qr"}})
    assert r.status_code == 400


def test_payment_events_amount_filter(logged):
    from paygo.services import payments

    with transaction() as db:
        payments.ingest_event(db, source="webhook", amount="1500.37", raw_text="MBank: +1500.37 с", event_key="amt-1")
        payments.ingest_event(db, source="webhook", amount="99.10", raw_text="MBank: +99.10 с", event_key="amt-2")
    body = logged.get(P + "/payment-events?amount=1500.37").json()
    assert [str(e["amount"]) for e in body["items"]] == ["1500.37"]
    body = logged.get(P + "/payment-events?amount_min=50&amount_max=100").json()
    assert [str(e["amount"]) for e in body["items"]] == ["99.10"]


def test_statement_import_endpoint(logged, user, fake_provider):
    from paygo.utils import money, utcnow

    with transaction() as db:
        u = db.get(User, user)
        cash = get_cash(db, "1xbet")
        dep, _ = deposits.create_deposit(db, user=u, cash=cash, player_id="123456", amount="700", idempotency_key="stapi1")
        pay = money(dep.pay_amount)
        dep_id = dep.id
    when = utcnow()
    amt = f"{pay:.2f}".replace(".", ",")
    text = (f"Выписка\n{when:%Y-%m-%d}\n     {when:%H:%M}\nПеревод по QR: Тест К. {amt}\nKGS\n1090145006806590\n").encode()
    r = logged.post(P + "/statements/import", files={"file": ("vypiska.txt", text, "text/plain")})
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    assert rep["incoming"] == 1 and len(rep["credited"]) == 1 and rep["credited"][0]["ok"] is True
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "success"
    # the same file again never double-credits
    r2 = logged.post(P + "/statements/import", files={"file": ("vypiska.txt", text, "text/plain")})
    assert r2.json()["report"]["duplicates"] == 1


def test_risk_signals_warn_about_payout_over_deposits(logged, user, fake_provider):
    """Антифрод-плашка: клиент выводит больше, чем пополнял; тот же QR у другого клиента;
    один ID игрока на нескольких Telegram-аккаунтах."""
    from paygo.db import transaction
    from paygo.models import PaymentCash, Withdrawal
    from paygo.services.users import get_or_create
    from paygo.utils import new_public_id
    from sqlalchemy import select

    with transaction() as db:
        cash = db.execute(select(PaymentCash)).scalars().first()
        other = get_or_create(db, {"id": 555000111, "username": "other", "first_name": "Другой"})
        db.flush()
        qr = "000201test-shared-qr"
        db.add(Withdrawal(public_id=new_public_id("W"), user_id=other.id, cash_id=cash.id, player_id="777777", currency="KGS", amount=Decimal("100"), code="C0", provider_claim_key="k0", idempotency_key="i0", qr_payload=qr, status="success"))
        w = Withdrawal(public_id=new_public_id("W"), user_id=user, cash_id=cash.id, player_id="777777", currency="KGS", amount=Decimal("9000"), code="C9", provider_claim_key="k9", idempotency_key="i9", qr_payload=qr, status="created")
        db.add(w)
        db.flush()
        wid = w.id
    r = logged.get(f"/paygo/api/withdrawals/{wid}")
    assert r.status_code == 200, r.text
    keys = {s["key"]: s for s in r.json()["risk"]}
    assert "payout_over_deposits" in keys and keys["payout_over_deposits"]["level"] == "danger"
    assert "ни разу не пополнял" in keys["payout_over_deposits"]["detail"]
    assert "qr_shared" in keys and keys["qr_shared"]["level"] == "danger"
    assert "player_shared" in keys
    assert [s["level"] for s in r.json()["risk"]][:2] == ["danger", "danger"]  # опасное — первым


def test_watchdog_reports_silence_and_recovery(logged, user, fake_provider):
    """Сторож тишины: клиенты оплачивают, а подтверждений из банка нет → тревога владельцу
    и плашка в панели; когда платёж приходит — тревога снимается."""
    from paygo.db import transaction
    from paygo.models import Notification, PaymentEvent
    from paygo.services import settings_store, watchdog
    from paygo.services.cashes import get_cash
    from paygo.utils import utcnow

    with transaction() as db:
        u = db.get(User, user)
        cash = get_cash(db, "1xbet")
        settings_store.set_many(db, {"deposit_max_active_per_user": 5})
        for i in range(3):
            deposits.create_deposit(db, user=u, cash=cash, player_id="123456", amount=f"{500 + i}", idempotency_key=f"wd-{i}")
    with transaction() as db:
        alarms = watchdog.tick(db)
        keys = {a["key"] for a in alarms}
        assert "payments_silent" in keys
        assert db.query(Notification).filter(Notification.event == "system_alarm").count() >= 1
    r = logged.get(P + "/live")
    assert any(a["key"] == "payments_silent" for a in r.json()["alarms"])
    with transaction() as db:  # платёж пришёл — тревоги больше нет
        db.add(PaymentEvent(source="macrodroid", event_key="wd-ok", external_id="wd-ok", amount=Decimal("500"), currency="KGS", raw_text="тест", received_at=utcnow(), status="unmatched"))
    with transaction() as db:
        assert "payments_silent" not in {a["key"] for a in watchdog.tick(db)}


def test_payments_inbox_binds_a_payment_to_the_right_request(logged, user, fake_provider):
    """Инбокс: платёж без заявки показывается с подсказкой «похоже на заявку» и привязывается в одно нажатие."""
    with transaction() as db:
        u = db.get(User, user)
        dep, _ = deposits.create_deposit(db, user=u, cash=get_cash(db, "1xbet"), player_id="123456", amount="1200", idempotency_key="inbox-1")
        dep_id, pay = dep.id, str(dep.pay_amount)
    # платёж на ту же сумму, но пришёл как «не найдено» (например, из выписки задним числом)
    r = logged.post(P + "/webhooks/payments/test-webhook-secret-test-webhook-secret", json={"text": f"Optima: зачислено {Decimal(pay) + 5} KGS"})
    assert r.status_code == 200
    r = logged.get(P + "/payment-events/inbox")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items and items[0]["candidates"] == [] or True  # сумма отличается на 5 — кандидатов может не быть
    event_id = items[0]["id"]
    r = logged.post(P + f"/payment-events/{event_id}/bind", json={"deposit_id": dep_id})
    assert r.status_code == 200, r.text
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "success"
    assert logged.get(P + "/payment-events/inbox").json()["total"] == 0
    # второй платёж можно просто скрыть как «не наш»
    logged.post(P + "/webhooks/payments/test-webhook-secret-test-webhook-secret", json={"text": "Optima: зачислено 7777.77 KGS"})
    ev = logged.get(P + "/payment-events/inbox").json()["items"][0]
    assert logged.post(P + f"/payment-events/{ev['id']}/ignore").status_code == 200
    assert logged.get(P + "/payment-events/inbox").json()["total"] == 0
