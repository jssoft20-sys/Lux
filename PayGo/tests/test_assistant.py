"""Claude first line: answers from client data, fixes payments through tools, escalates the rest."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from paygo.db import transaction
from paygo.models import Notification, SupportConversation, User
from paygo.services import assistant, settings_store, support, withdrawals
from paygo.services.cashes import get_cash


class FakeMessages:
    def __init__(self, turns):
        self.turns = list(turns)
        self.requests = []

    def create(self, **kw):
        self.requests.append({**kw, "messages": [dict(m) for m in kw["messages"]]})  # snapshot: the runner keeps appending to its list
        content = self.turns.pop(0)
        blocks = []
        for item in content:
            if item["type"] == "text":
                blocks.append(SimpleNamespace(type="text", text=item["text"]))
            else:
                blocks.append(SimpleNamespace(type="tool_use", id=item["id"], name=item["name"], input=item.get("input", {})))
        return SimpleNamespace(content=blocks, stop_reason="tool_use" if any(b.type == "tool_use" for b in blocks) else "end_turn", usage=None)


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    from paygo.config import reset_settings_cache

    reset_settings_cache()
    settings_store.invalidate()
    holder = {}

    def use(turns):
        fake = SimpleNamespace(messages=FakeMessages(turns))
        holder["client"] = fake
        monkeypatch.setattr(assistant, "_client", lambda: fake)
        return fake

    yield use
    reset_settings_cache()


def test_answers_from_client_requests(user, fake_provider, ai):
    with transaction() as db:
        cash_id = get_cash(db, "1xbet").id
    withdrawals.create_withdrawal(user_id=user, cash_id=cash_id, player_id="123456", code="OK1234", idempotency_key="a1")
    fake = ai([
        [{"type": "tool_use", "id": "t1", "name": "get_client_requests"}],
        [{"type": "text", "text": "Ваш вывод 5 300 KGS принят и ждёт оператора — уведомление придёт сюда."}],
    ])
    with transaction() as db:
        u = db.get(User, user)
        reply = support.respond(db, u, "когда придёт мой вывод?", telegram_message_id=1)
        assert reply.source == "ai" and reply.tools == ["get_client_requests"] and "5 300" in reply.text and not reply.escalate
        conv = support.client_conversation(db, u)
        assert conv.status == "auto"
    first, second = fake.messages.requests
    assert first["model"] and first["tools"][0]["name"] == "get_client_requests" and first["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert first["messages"][-1] == {"role": "user", "content": "когда придёт мой вывод?"}
    result = json.loads(second["messages"][-1]["content"][0]["content"])
    assert result["withdrawals"][0]["amount"] == "5300.00" and result["withdrawals"][0]["status"] == "created"
    assert second["messages"][-1]["content"][0]["tool_use_id"] == "t1"


def test_escalation_tool_hands_over_to_operator(user, fake_provider, ai):
    ai([
        [{"type": "tool_use", "id": "t9", "name": "escalate_to_operator", "input": {"summary": "Клиент требует вернуть деньги", "priority": "high"}}],
        [{"type": "text", "text": "Передал оператору, он ответит здесь."}],
    ])
    with transaction() as db:
        u = db.get(User, user)
        reply = support.respond(db, u, "верните мои деньги, мошенники", telegram_message_id=2)
        assert reply.escalate and "оператору" in reply.text.lower()
        conv = support.client_conversation(db, u)
        assert conv.status == "waiting_operator" and conv.subject == "Клиент требует вернуть деньги" and conv.priority == "high"
        assert db.query(Notification).filter_by(event="support_operator").count() == 1


def test_rules_when_the_api_fails_or_key_missing(user, fake_provider, ai, monkeypatch):
    import anthropic

    class Broken:
        class messages:
            @staticmethod
            def create(**kw):
                raise anthropic.APIConnectionError(request=None)

    monkeypatch.setattr(assistant, "_client", lambda: Broken())
    with transaction() as db:
        u = db.get(User, user)
        reply = support.respond(db, u, "какая комиссия?", telegram_message_id=3)
        assert reply.source == "rules" and "0%" in reply.text
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    from paygo.config import reset_settings_cache

    reset_settings_cache()
    with transaction() as db:
        assert not assistant.enabled(db)


def test_credit_found_payment_tool(user, fake_provider, ai):
    """An expired request whose bank payment arrived late is credited by the tool."""
    from decimal import Decimal

    from paygo.models import Deposit
    from paygo.services import deposits, payments

    with transaction() as db:
        u = db.get(User, user)
        cash = get_cash(db, "1xbet")
        dep, _ = deposits.create_deposit(db, user=u, cash=cash, player_id="654321", amount=Decimal("1000"), idempotency_key="k-ai")
        dep.status = "expired"
        pay_amount = dep.pay_amount
        public_id = dep.public_id
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=pay_amount, raw_text="late")
        event.status = "unmatched"
    with transaction() as db:
        u = db.get(User, user)
        data = assistant.tool_get_client_requests(db, u)
        assert data["deposits"][0]["bank_payment_found"] is True
    result = assistant.tool_credit_found_payment(user, public_id)
    assert result["ok"] and result["message"] == "зачислено"
    with transaction() as db:
        assert db.query(Deposit).one().status == "success"
        conv_count = db.query(SupportConversation).count()
        assert conv_count == 0
