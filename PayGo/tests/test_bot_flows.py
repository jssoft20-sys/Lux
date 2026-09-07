"""End-to-end client bot flows with a fake Telegram client (no network)."""
from __future__ import annotations

import pytest
from paygo.db import transaction
from paygo.models import Deposit, Notification, Withdrawal


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

    def edit_text(self, chat_id, message_id, text, markup=None, **kw):
        self.calls.append(("edit", text, markup))
        return True

    def edit_caption(self, chat_id, message_id, caption, markup=None, **kw):
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
        return {"username": "PayGoXBot"}

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

    def last_of(self, kind):
        for k, text, markup in reversed(self.calls):
            if k == kind:
                return text, markup
        return "", None

    def deleted(self):
        return [text for k, text, _ in self.calls if k == "delete"]


@pytest.fixture
def bot(seeded, fake_provider, monkeypatch):
    monkeypatch.setenv("MAIN_BOT_TOKEN", "123:abc")
    from paygo.config import reset_settings_cache

    reset_settings_cache()
    from paygobot import main_bot

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
    from paygo.db import transaction as tr
    from paygo.services import bot_state

    with tr() as db:
        _, _, panel = bot_state.get_state(db, "main", CHAT)
    bot.handle_update({"update_id": 2, "callback_query": {"id": "cb", "data": data, "from": FROM, "message": {"message_id": panel, "chat": {"id": CHAT}}}})


def photo(bot):
    bot.handle_update({"update_id": 3, "message": {"message_id": 9, "chat": {"id": CHAT, "type": "private"}, "from": FROM, "photo": [{"file_id": "small"}, {"file_id": "big"}]}})


def pick_cash(bot, key="1xbet"):
    from paygo.services.cashes import get_cash

    with transaction() as db:
        cash_id = get_cash(db, key).id
    tap(bot, f"cash:{cash_id}")


def state_of():
    from paygo.services import bot_state

    with transaction() as db:
        return bot_state.get_state(db, "main", CHAT)


def test_start_shows_greeting_with_reply_keyboard(bot):
    text(bot, "/start")
    kind, body, markup = bot.client.last
    assert kind == "send" and "Али" in body and "PayGo" in body
    labels = [b["text"] for row in markup["keyboard"] for b in row]
    assert labels == ["Пополнить", "Вывести", "Помощь"] and "inline_keyboard" not in markup  # premium-only: no plain emoji
    assert state_of()[0] == "idle"


def test_deposit_flow_with_currency_mismatch_then_success(bot, fake_provider):
    text(bot, "/start")
    text(bot, "Пополнить")  # reply keyboard press → site selection (two enabled cashes)
    assert "Выберите сайт для пополнения" in bot.client.last[1]
    assert len([b for b in bot.client.buttons() if b.startswith("cash:")]) == 2
    pick_cash(bot)
    assert "Введите ваш ID" in bot.client.last[1] and "1xbet" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "USD"
    text(bot, "123456")
    assert "Валюта аккаунта (USD)" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "KGS"
    text(bot, "654321")  # new ID continues automatically
    assert "Введите сумму пополнения" in bot.client.last[1] and "Минимум: 100" in bot.client.last[1]
    text(bot, "1000")
    caption, markup = bot.client.last_of("photo")
    assert "Ваш ID: 654321" in caption and "Сумма к оплате: 1000." in caption and "5 минут" in caption
    assert any("cancel:" in b.get("callback_data", "") for row in markup["inline_keyboard"] for b in row)
    assert "скриншот чека" in bot.client.last[1]  # receipt prompt follows the card
    with transaction() as db:
        dep = db.query(Deposit).one()
        assert dep.player_id == "654321" and dep.status == "created"
    state, data, panel = state_of()
    assert state == "wait_payment" and data["request_id"] == dep.public_id and data["receipt_prompt_id"] and panel
    # payment confirmation → success message replaces the card, prompt is removed
    from paygo.services import payments

    with transaction() as db:
        dep = db.query(Deposit).one()
        event, _ = payments.ingest_event(db, source="webhook", amount=dep.pay_amount, raw_text=f"+{dep.pay_amount} сом")
        event_id = event.id
    assert payments.process_event(event_id)["ok"]
    bot.deliver_outbox()
    kind, body, _ = bot.client.last
    assert kind == "send" and "Пополнено" in body and "654321" in body
    assert str(panel) in bot.client.deleted() and str(data["receipt_prompt_id"]) in bot.client.deleted()
    assert state_of()[0] == "idle"
    with transaction() as db:
        assert db.query(Notification).filter_by(event="deposit_success").one().status == "sent"


def test_expired_deposit_card_is_replaced_by_cancel_notice(bot, fake_provider):
    from datetime import timedelta

    from paygo.services import deposits as deposit_service
    from paygo.utils import utcnow

    text(bot, "/start")
    text(bot, "Пополнить")
    pick_cash(bot)
    text(bot, "123456")
    text(bot, "500")
    _, _, panel = state_of()
    with transaction() as db:
        dep = db.query(Deposit).one()
        dep.expires_at = utcnow() - timedelta(seconds=1)
    with transaction() as db:
        assert len(deposit_service.expire_deposits(db)) == 1
    bot.deliver_outbox()
    kind, body, _ = bot.client.last
    assert kind == "send" and "Пополнение отменено" in body and "Не переводите по старым реквизитам" in body
    assert str(panel) in bot.client.deleted()
    assert state_of()[0] == "idle"


def test_receipt_photo_is_stored_for_active_deposit(bot, fake_provider):
    text(bot, "/start")
    text(bot, "Пополнить")
    pick_cash(bot)
    text(bot, "123456")
    text(bot, "700")
    photo(bot)
    assert "Чек получен" in bot.client.last[1]
    with transaction() as db:
        dep = db.query(Deposit).one()
        assert dep.receipt_file.startswith("uploads/receipts/") and dep.receipt_at is not None
        assert db.query(Notification).filter_by(event="deposit_receipt").count() == 1
    assert state_of()[0] == "wait_payment"


def test_withdraw_flow_qr_then_id_then_code(bot, fake_provider):
    text(bot, "/start")
    text(bot, "Вывести")
    assert "Выберите сайт для вывода" in bot.client.last[1]
    pick_cash(bot)
    assert "Отправьте QR код" in bot.client.last[1] and "qr:last" not in bot.client.buttons()
    photo(bot)
    assert "Введите ваш ID для вывода" in bot.client.last[1]
    text(bot, "123456")
    assert "Введите код для вывода" in bot.client.last[1] and "instr" in bot.client.buttons()
    text(bot, "CODE1234")
    body = bot.client.last[1]
    assert "Заявка на вывод принята" in body and "5300.00" in body and "123456" in body
    with transaction() as db:
        w = db.query(Withdrawal).one()
        assert str(w.amount) == "5300.00" and w.qr_file_url.endswith("/big")
    # second withdrawal offers the last QR
    text(bot, "Вывести")
    pick_cash(bot)
    assert "Использовать последний QR" in bot.client.last[1] and "qr:last" in bot.client.buttons()
    tap(bot, "qr:last")
    assert "Введите ваш ID для вывода" in bot.client.last[1]
    text(bot, "123456")
    fake_provider["behaviour"]["withdraw_ok"] = False
    text(bot, "WRONG123")
    assert "Введены неверные данные для вывода" in bot.client.last[1]
    assert state_of()[0] == "wait_code"
    with transaction() as db:
        assert db.query(Withdrawal).count() == 1


def test_help_shows_only_the_operator(bot):
    text(bot, "/start")
    text(bot, "Помощь")
    kind, body, markup = bot.client.last
    assert kind == "send" and "Оператор" in body and "@PayOperator_bot" in body
    assert not markup  # no profile / referral buttons
    assert state_of()[0] == "idle"


def test_instruction_at_code_step_uses_city_and_address(bot, fake_provider):
    text(bot, "/start")
    text(bot, "Вывести")
    pick_cash(bot)
    photo(bot)
    assert "9" in bot.client.deleted()  # client's QR photo is removed once processed
    text(bot, "123456")
    tap(bot, "instr")
    assert "Город: Бишкек" in bot.client.last[1] and "ул. PayGo Online" in bot.client.last[1] and "back_code" in bot.client.buttons()
    tap(bot, "back_code")
    assert "Введите код для вывода" in bot.client.last[1]


def test_paused_bot_answers_with_paused_text(bot):
    from paygo.services import settings_store

    with transaction() as db:
        settings_store.set_many(db, {"bot_paused": True}, "test")
    text(bot, "/start")
    text(bot, "Пополнить")
    assert bot.client.last[1] == "Бот временно выключен"


def test_stale_button_is_ignored(bot):
    text(bot, "/start")
    text(bot, "Пополнить")
    before = len(bot.client.calls)
    bot.handle_update({"update_id": 7, "callback_query": {"id": "old", "data": "cash:1", "from": FROM, "message": {"message_id": 1, "chat": {"id": CHAT}}}})
    assert len(bot.client.calls) == before  # no screen change


def media(bot, kind="voice", mid=44, **extra):
    obj = {"file_id": "f-" + kind, "file_size": 1000, **extra}
    bot.handle_update({"update_id": 7, "message": {"message_id": mid, "chat": {"id": CHAT, "type": "private"}, "from": FROM, kind: obj}})


def test_voice_during_flow_is_removed(bot):
    text(bot, "/start")
    text(bot, "Пополнить")
    pick_cash(bot)
    assert state_of()[0] == "wait_id"
    media(bot, "voice", mid=44)
    assert "44" in bot.client.deleted() and state_of()[0] == "wait_id"


def test_voice_when_idle_opens_operator_dialog(bot):
    from paygo.models import SupportConversation, SupportMessage

    text(bot, "/start")
    media(bot, "voice", mid=45, mime_type="audio/ogg")
    assert "45" not in bot.client.deleted()
    with transaction() as db:
        conv = db.query(SupportConversation).one()
        assert conv.status == "waiting_operator" and conv.context["channel"] == "main"
        msg = db.query(SupportMessage).one()
        assert msg.kind == "voice" and msg.file_url.startswith("/uploads/support/") and msg.file_url.endswith(".ogg") and msg.via == "main"
    text(bot, "это по поводу вывода", mid=46)  # a reply inside the operator dialog stays in the chat
    assert "46" not in bot.client.deleted()
    with transaction() as db:
        assert db.query(SupportMessage).count() == 2


def test_outbox_url_buttons_edit_and_delete(bot):
    from paygo.models import SupportMessage, User
    from paygo.services import support as support_service
    from paygo.services.notifications import notify_user

    text(bot, "/start")
    with transaction() as db:
        u = db.query(User).filter_by(telegram_id=CHAT).one()
        notify_user(db, u, event="broadcast", event_key="b1", text="Новости", buttons=[{"text": "Сайт", "url": "https://paygo.kg"}])
    bot.deliver_outbox()
    kind, body, markup = bot.client.last
    assert body == "Новости" and markup["inline_keyboard"][0][0]["url"] == "https://paygo.kg"
    with transaction() as db:
        u = db.query(User).filter_by(telegram_id=CHAT).one()
        conv = support_service.open_operator_conversation(db, u, None)
        msg = support_service.operator_reply(db, conv, None, "admin", "Проверяю", reply_to=None)
        msg_id = msg.id
    bot.deliver_outbox()
    with transaction() as db:
        row = db.get(SupportMessage, msg_id)
        assert row.telegram_message_id > 0 and row.via == "main"
        support_service.edit_message(db, row, "Проверяю ещё раз")
        support_service.delete_message(db, row)
    bot.deliver_outbox()
    assert bot.client.last_of("edit")[0] == "Проверяю ещё раз"
    assert str(row.telegram_message_id) in bot.client.deleted()


def test_menu_presses_keep_the_open_deposit(bot, fake_provider):
    """/start, Пополнить, Вывести and Помощь never cancel an open payment request."""
    text(bot, "/start")
    text(bot, "Пополнить")
    pick_cash(bot)
    text(bot, "123456")
    text(bot, "700")
    assert state_of()[0] == "wait_payment"
    with transaction() as db:
        dep_id = db.query(Deposit).one().id
    text(bot, "/start")  # greeting again, card stays
    text(bot, "Помощь")
    text(bot, "Вывести")  # notice instead of a new flow
    kind, body, markup = bot.client.last
    assert "активная заявка" in body and "cancel:" in " ".join(bot.client.buttons()) and "dep:show" in bot.client.buttons()
    text(bot, "Пополнить")  # shows the card again
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        assert dep.status == "created" and db.query(Deposit).count() == 1
    assert state_of()[0] == "wait_payment" and int(state_of()[1]["deposit_id"]) == dep_id


def test_open_deposit_is_found_after_state_loss(bot, fake_provider):
    text(bot, "/start")
    text(bot, "Пополнить")
    pick_cash(bot)
    text(bot, "123456")
    text(bot, "700")
    from paygo.services import bot_state

    with transaction() as db:
        bot_state.set_state(db, "main", CHAT, "idle", {}, 0)  # e.g. after a restart
    text(bot, "Пополнить")
    assert state_of()[0] == "wait_payment"
    with transaction() as db:
        assert db.query(Deposit).filter_by(status="created").count() == 1



def test_site_buttons_are_premium_only(bot):
    text(bot, "/start")
    kind, body, markup = bot.client.last
    labels = [b["text"] for row in markup["keyboard"] for b in row]
    assert labels == ["Пополнить", "Вывести", "Помощь"]  # reply keyboards cannot carry premium emoji → no plain ones
    text(bot, "Пополнить")
    kind, body, markup = bot.client.last
    assert "<tg-emoji" in body and "👍" not in body.replace("</tg-emoji>", "").split("<tg-emoji")[0]
    sites = [b for row in markup["inline_keyboard"] for b in row if b.get("callback_data", "").startswith("cash:")]
    assert sites and all(b.get("icon_custom_emoji_id") and not bot_texts_emoji(b["text"]) for b in sites)
    cancel = [b for row in markup["inline_keyboard"] for b in row if b.get("callback_data") == "cancel"][0]
    assert cancel["text"] == "Отмена" and cancel["icon_custom_emoji_id"] == "5384234898494088007"


def bot_texts_emoji(label):
    from paygo.services.bot_texts import EMOJI_RE

    return EMOJI_RE.search(label) is not None
