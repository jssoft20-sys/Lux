from datetime import timedelta

from onoipay.db import transaction
from onoipay.models import Notification, SupportConversation, User
from onoipay.services import support, withdrawals
from onoipay.services.cashes import get_cash


def test_classifier():
    assert support.classify("когда будет вывод?").name == "withdrawal_delay"
    assert support.classify("оплатил, деньги не пришли").name == "deposit_delay"
    assert support.classify("какая комиссия?").name == "commission"
    assert support.classify("позовите оператора").category == "operator"
    assert support.classify("qr не читается").name == "qr_problem"
    assert support.classify("у меня аккаунт в usd").category == "currency"
    assert support.classify("минимальная сумма пополнения").name == "limits"
    intent = support.classify("акча качан келет? чыгаруу")
    assert intent.language == "kg" and intent.category == "withdrawal"


def test_auto_answer_withdrawal_status_and_escalation(user, fake_provider):
    with transaction() as db:
        cash_id = get_cash(db, "1xbet").id
    withdrawals.create_withdrawal(user_id=user, cash_id=cash_id, player_id="123456", code="OK1234", idempotency_key="s1")
    with transaction() as db:
        u = db.get(User, user)
        reply = support.respond(db, u, "когда будет вывод?", telegram_message_id=1)
        assert reply and "ожидает обработки" in reply.text.lower() and not reply.escalate
        conv = support.active_conversation(db, u)
        assert conv.status == "auto"
        # explicit operator request escalates with context
        reply = support.respond(db, u, "нужен оператор", telegram_message_id=2)
        assert reply.escalate
        conv = support.active_conversation(db, u)
        assert conv.status == "waiting_operator"
        assert conv.context["withdrawal"]["public_id"].startswith("W-")
        assert conv.context["telegram_id"] == 111222333
        assert db.query(Notification).filter_by(event="support_operator").count() == 1


def test_antiflood_and_duplicates(user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        first = support.respond(db, u, "какая комиссия", telegram_message_id=10)
        assert first and "0%" in first.text
        dup = support.respond(db, u, "какая комиссия", telegram_message_id=11)
        assert dup and "уже принят" in dup.text.lower()
        silent = support.respond(db, u, "какая комиссия", telegram_message_id=12)
        assert silent is None
        for i in range(10):
            r = support.respond(db, u, f"вопрос номер {i}", telegram_message_id=100 + i)
        # the burst hits the rate limit: one warning, then silence
        assert r is None or "слишком много" in r.text.lower()


def test_operator_reply_and_resolve(user, fake_provider, admin):
    with transaction() as db:
        u = db.get(User, user)
        support.respond(db, u, "оператор", telegram_message_id=1)
        conv = support.active_conversation(db, u)
        support.operator_reply(db, conv, admin["id"], "Admin", "Проверили, всё в порядке")
        assert conv.status == "operator"
        assert db.query(Notification).filter_by(event="support_reply", bot="support").count() == 1
        # while the operator owns the dialog automation stays silent
        assert support.respond(db, u, "спасибо", telegram_message_id=2) is None
        support.resolve_conversation(db, conv, admin["id"])
        assert conv.status == "resolved"
        assert support.apply_rating(db, u, 5)
        assert db.get(SupportConversation, conv.id).rating == 5


def test_escalation_cooldown(user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        assert support.escalation_allowed(db, u.telegram_id)
        assert not support.escalation_allowed(db, u.telegram_id)
        row = db.get(support.SupportRateLimit, u.telegram_id)
        row.last_escalation_at = row.last_escalation_at - timedelta(hours=1)
        db.flush()
        assert support.escalation_allowed(db, u.telegram_id)
