"""End-to-end client bot flows with a fake Telegram client (no network)."""
from __future__ import annotations

import os

import pytest

from onoipay.db import transaction
from onoipay.models import Deposit, Notification, User, Withdrawal


class FakeTelegram:
    """Records outgoing calls; message ids are sequential."""

    def __init__(self):
        self.calls = []
        self.next_id = 100
        self.token = "x"

    def _msg(self):
        self.next_id += 1
        return {"message_id": self.next_id}

    def send_message(self, chat_id, text, **kw):
        self.calls.append(("send", text, kw.get("markup")))
        return self._msg()

    def send_photo(self, chat_id, photo, caption="", **kw):
        self.calls.append(("photo", caption, kw.get("markup")))
        return self._msg()

    def edit_text(self, chat_id, message_id, text, markup=None):
        self.calls.append(("edit", text, markup))
        return True

    def edit_caption(self, chat_id, message_id, caption, markup=None):
        self.calls.append(("edit_caption", caption, markup))
        return True

    def edit_markup(self, chat_id, message_id, markup):
        self.calls.append(("markup", "", markup))
        return True

    def delete_message(self, chat_id, message_id):
        self.calls.append(("delete", str(message_id), None))
        return True

    def answer_callback(self, callback_id, text="", alert=False):
        self.calls.append(("ack", text, alert))

    def get_file_url(self, file_id):
        return "https://files.example/" + file_id

    def download(self, url, max_bytes=0):
        return b"not-a-real-image"

    def call(self, method, payload=None, **kw):
        self.calls.append((method, str(payload), None))
        return {"message_id": 1}

    def get_me(self):
        return {"username": "OnoiPayBot"}

    def set_commands(self, commands):
        pass

    def delete_webhook(self):
        pass

    @property
    def last(self):
        for kind, text, markup in reversed(self.calls):
            if kind in {"send", "edit", "photo", "edit_caption"}:
                return kind, text, markup
        return None, "", None

    def buttons(self):
        markup = self.last[2] or {}
        return [b["callback_data"] for row in markup.get("inline_keyboard", []) for b in row if "callback_data" in b]


@pytest.fixture
def bot(seeded, fake_provider, monkeypatch):
    monkeypatch.setenv("MAIN_BOT_TOKEN", "123:abc")
    from onoipay.config import reset_settings_cache

    reset_settings_cache()
    from onoibot import main_bot

    monkeypatch.setattr(main_bot.MainBot, "delete_later", lambda self, c, m: self.client.delete_message(c, m))
    monkeypatch.setattr(main_bot.MainBot, "strip_buttons_later", lambda self, c, m: None)
    b = main_bot.MainBot()
    b.client = FakeTelegram()
    return b


CHAT = 5550001
FROM = {"id": CHAT, "first_name": "Али", "username": "ali"}


def text(bot, value, mid=None):
    bot.handle_update({"update_id": 1, "message": {"message_id": mid or 1, "chat": {"id": CHAT, "type": "private"}, "from": FROM, "text": value}})


def tap(bot, data):
    from onoipay.db import transaction as tr
    from onoipay.services import bot_state

    with tr() as db:
        _, _, panel = bot_state.get_state(db, "main", CHAT)
    bot.handle_update({"update_id": 2, "callback_query": {"id": "cb", "data": data, "from": FROM, "message": {"message_id": panel, "chat": {"id": CHAT}}}})


def photo(bot):
    bot.handle_update({"update_id": 3, "message": {"message_id": 9, "chat": {"id": CHAT, "type": "private"}, "from": FROM, "photo": [{"file_id": "small"}, {"file_id": "big"}]}})


def test_start_shows_inline_menu_only(bot):
    text(bot, "/start")
    kind, body, markup = bot.client.last
    assert kind == "send" and "Али" in body
    assert "keyboard" not in (markup or {}) and bot.client.buttons() == ["act:deposit", "act:withdraw", "profile", "ref"]


def test_deposit_flow_with_currency_mismatch_then_success(bot, fake_provider):
    text(bot, "/start")
    tap(bot, "act:deposit")  # single enabled cash → straight to ID
    assert "ID" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "USD"
    text(bot, "123456")
    assert "Валюта аккаунта (USD)" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "KGS"
    text(bot, "654321")  # new ID continues automatically
    assert "Введите сумму" in bot.client.last[1]
    text(bot, "1000")
    kind, caption, markup = bot.client.last
    assert kind == "photo" and "К оплате: 1000." in caption and any(b.startswith("cancel:") for b in bot.client.buttons())
    with transaction() as db:
        dep = db.query(Deposit).one()
        assert dep.player_id == "654321" and dep.status == "created"
        from onoipay.services import bot_state

        state, data, _ = bot_state.get_state(db, "main", CHAT)
        assert state == "wait_payment" and data["request_id"] == dep.public_id
    # payment confirmation → success message replaces the card
    from onoipay.services import payments

    with transaction() as db:
        dep = db.query(Deposit).one()
        event, _ = payments.ingest_event(db, source="webhook", amount=dep.pay_amount, raw_text=f"+{dep.pay_amount} сом")
        event_id = event.id
    assert payments.process_event(event_id)["ok"]
    bot.deliver_outbox()
    kind, body, _ = bot.client.last
    assert kind == "send" and "успешно зачислено" in body
    with transaction() as db:
        from onoipay.services import bot_state

        assert bot_state.get_state(db, "main", CHAT)[0] == "idle"
        assert db.query(Notification).filter_by(event="deposit_success").one().status == "sent"


def test_withdraw_flow_saves_and_reuses_last_qr(bot, fake_provider):
    text(bot, "/start")
    tap(bot, "act:withdraw")
    text(bot, "123456")
    assert "QR" in bot.client.last[1] and "qr:last" not in bot.client.buttons()
    photo(bot)
    assert "код вывода" in bot.client.last[1].lower()
    text(bot, "CODE1234")
    assert "принята" in bot.client.last[1]
    with transaction() as db:
        w = db.query(Withdrawal).one()
        assert str(w.amount) == "5300.00" and w.qr_file_url.endswith("/big")
    # second withdrawal offers the last QR
    tap(bot, "act:withdraw")
    text(bot, "123456")
    assert "Использовать последний QR" in bot.client.last[1] and "qr:last" in bot.client.buttons()
    tap(bot, "qr:last")
    assert "код вывода" in bot.client.last[1].lower()
    fake_provider["behaviour"]["withdraw_ok"] = False
    text(bot, "WRONG123")
    assert "Неверный код" in bot.client.last[1]
    with transaction() as db:
        assert db.query(Withdrawal).count() == 1


def test_profile_and_referral(bot):
    text(bot, "/start")
    tap(bot, "profile")
    assert "Профиль" in bot.client.last[1] and "profile:email" in bot.client.buttons()
    tap(bot, "ref")
    assert "start=ref_" in bot.client.last[1]
    tap(bot, "profile:lang")
    assert "профили" in bot.client.last[1]  # switched to Kyrgyz labels
    with transaction() as db:
        assert db.query(User).filter_by(telegram_id=CHAT).one().language == "kg"


def test_stale_button_is_ignored(bot):
    text(bot, "/start")
    before = len(bot.client.calls)
    bot.handle_update({"update_id": 7, "callback_query": {"id": "old", "data": "act:deposit", "from": FROM, "message": {"message_id": 1, "chat": {"id": CHAT}}}})
    assert len(bot.client.calls) == before  # no screen change
