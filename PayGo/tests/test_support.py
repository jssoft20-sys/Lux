from datetime import timedelta

from paygo.db import transaction
from paygo.models import Notification, SupportConversation, User
from paygo.services import support, withdrawals
from paygo.services.cashes import get_cash


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


def test_one_dialog_per_client_is_reused_after_closing(user, fake_provider, admin):
    """A closed dialog is reopened by the next message / «Написать клиенту» / main-bot file — never duplicated."""
    from paygo.models import SupportMessage

    with transaction() as db:
        u = db.get(User, user)
        support.respond(db, u, "оператор", telegram_message_id=1)
        conv = support.active_conversation(db, u)
        first_id = conv.id
        support.resolve_conversation(db, conv, admin["id"])
        assert conv.status == "resolved" and conv.resolved_at is not None
        support.apply_rating(db, u, 4)
        # the client writes again → the same dialog comes back to the automation
        reply = support.respond(db, u, "какая комиссия", telegram_message_id=2)
        assert reply and "0%" in reply.text
        assert db.query(SupportConversation).count() == 1
        again = support.client_conversation(db, u)
        assert again.id == first_id and again.status == "auto" and again.rating is None and again.resolved_at is None
        assert db.query(SupportMessage).filter_by(conversation_id=first_id).count() >= 4
        # operator closes, then opens the dialog from the panel → still the same row
        support.resolve_conversation(db, again, admin["id"], notify=False)
        opened = support.open_operator_conversation(db, u, admin["id"])
        assert opened.id == first_id and opened.status == "operator" and opened.assigned_admin_id == admin["id"]
        support.resolve_conversation(db, opened, admin["id"], notify=False)
        # a file sent in the main bot reopens it for the operator, carried by the main bot
        assert support.main_inbox(db, u, "", media_kind="photo", file_url="/uploads/support/x.jpg", telegram_message_id=77, create=True)
        third = support.client_conversation(db, u)
        assert third.id == first_id and third.status == "waiting_operator" and third.context["channel"] == "main"
        assert db.query(SupportConversation).count() == 1


def test_resolve_notice_goes_through_the_carrier_bot(user, fake_provider, admin):
    with transaction() as db:
        u = db.get(User, user)
        assert support.main_inbox(db, u, "вопрос", telegram_message_id=5, create=True)
        conv = support.client_conversation(db, u)
        support.resolve_conversation(db, conv, admin["id"])
        note = db.query(Notification).filter_by(event="support_resolved").one()
        assert note.bot == "main" and note.data["rating_prompt"] is True
