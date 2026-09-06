from paygo.db import transaction
from paygo.models import Notification, User
from paygo.services import email, notifications
from paygo.services.users import get_or_create
from paygo.utils import decrypt_json, encrypt_json, money


def test_encryption_roundtrip():
    blob = encrypt_json({"login": "a", "hash": "b"})
    assert blob.startswith("v1:") and "login" not in blob
    assert decrypt_json(blob) == {"login": "a", "hash": "b"}


def test_money_parsing():
    assert str(money("1 500,37")) == "1500.37"
    assert str(money(10)) == "10.00"


def test_notification_dedupe_and_expiry(user):
    with transaction() as db:
        u = db.get(User, user)
        assert notifications.notify_user(db, u, event="x", event_key="k1", text="hi") is not None
        assert notifications.notify_user(db, u, event="x", event_key="k1", text="hi") is None
        rows = notifications.notify_admins(db, event="cash_critical", event_key="c1", title="t", body="b")
        assert rows and rows[0].level == "critical"
        assert notifications.notify_admins(db, event="cash_critical", event_key="c1", title="t", body="b") == []
        assert notifications.expire_stale(db, max_age_seconds=-1) == 2
        assert db.query(Notification).filter_by(status="expired").count() == 2


def test_email_verification_no_duplicates(user, monkeypatch):
    sent = []
    monkeypatch.setattr(email, "send_mail", lambda to, subject, body: sent.append((to, body)))
    monkeypatch.setattr(email, "smtp_configured", lambda: True)
    with transaction() as db:
        u = db.get(User, user)
        result = email.start_verification(db, u, "Test@Example.com")
        assert result["sent"] and sent[0][0] == "test@example.com"
        code = sent[0][1].split(": ")[1].split("\n")[0]
        # resend is throttled
        assert email.start_verification(db, u, "test@example.com").get("retry_in")
        try:
            email.confirm_verification(db, u, "000000")
            raise AssertionError("bad code accepted")
        except email.EmailError:
            pass
        assert email.confirm_verification(db, u, code)["email"] == "test@example.com"
        assert u.email_verified_at is not None
        other = get_or_create(db, {"id": 999, "first_name": "Other"})
        try:
            email.start_verification(db, other, "test@example.com")
            raise AssertionError("duplicate e-mail accepted")
        except email.EmailError:
            pass


def test_user_upsert_idempotent(seeded):
    with transaction() as db:
        a = get_or_create(db, {"id": 5, "username": "u1", "first_name": "A"})
        b = get_or_create(db, {"id": 5, "username": "u2", "first_name": "A"})
        assert a.id == b.id and b.username == "u2" and len(b.referral_code) == 8



def test_bot_texts_premium_tokens_and_escaping(seeded):
    from paygo.db import transaction
    from paygo.services import bot_texts, settings_store
    from paygo.services.cashes import get_cash

    tpl = "[emoji:5199885118214255386:👋] Привет {name} в PayGo! [emoji:5375410291184002717:👍] {emoji} {cash}"
    with transaction() as db:
        cash = get_cash(db, "1win")
        assert cash.custom_emoji_id == "5247144889640056462"
        html = bot_texts.render_template(tpl, premium=True, name="<b>Али</b>", emoji=bot_texts.cash_emoji(cash), cash=cash.name)
        plain = bot_texts.render_template(tpl, premium=False, name="Али", emoji=bot_texts.cash_emoji(cash), cash=cash.name)
        assert '<tg-emoji emoji-id="5199885118214255386">👋</tg-emoji>' in html and '<tg-emoji emoji-id="5247144889640056462">🥇</tg-emoji>' in html
        assert "&lt;b&gt;Али&lt;/b&gt;" in html  # user data is escaped, template markup is not
        assert plain == "👋 Привет Али в PayGo! 👍 🥇 1win"
        assert settings_store.get_bool(db, "premium_emoji_enabled")
        greeting = bot_texts.render(db, "greeting_text", name="Али")
        assert greeting.count("<tg-emoji") == 6 and "@PayOperator_bot" in greeting
        assert bot_texts.strip_html(greeting).startswith("👋 Привет Али в PayGo!")


def test_seed_fills_missing_emoji_on_existing_rows(seeded):
    from paygo.db import transaction
    from paygo.models import BankLink, PaymentCash
    from paygo.seed import seed_defaults

    with transaction() as db:
        cash = db.query(PaymentCash).filter_by(key="1xbet").one()
        cash.custom_emoji_id = ""
        link = db.query(BankLink).filter_by(key="mbank").one()
        link.custom_emoji_id = ""
        other = db.query(BankLink).filter_by(key="odengi").one()
        other.custom_emoji_id = "1"  # operator's own value must survive
    with transaction() as db:
        seed_defaults(db)
    with transaction() as db:
        assert db.query(PaymentCash).filter_by(key="1xbet").one().custom_emoji_id == "5240186449915039482"
        assert db.query(BankLink).filter_by(key="mbank").one().custom_emoji_id == "4949565894398314191"
        assert db.query(BankLink).filter_by(key="odengi").one().custom_emoji_id == "1"
