"""Voice notes → text: the junk guard, the provider switch, and the bot answering a transcript like typed text."""
from __future__ import annotations

import threading

import pytest
from paygo.db import transaction
from paygo.models import Notification, SupportMessage, User
from paygo.services import stt, support
from paygo.services.users import get_or_create

TEXT = "Пополнил 1500 сом, деньги не пришли"
VOICE = "/uploads/support/x.ogg"


@pytest.fixture
def provider(monkeypatch):
    """Switch STT_PROVIDER for one test (settings are cached per process)."""
    from paygo.config import reset_settings_cache

    def use(name: str) -> None:
        monkeypatch.setenv("STT_PROVIDER", name)
        reset_settings_cache()

    yield use
    reset_settings_cache()


class FakeClient:
    def __init__(self):
        self.sent, self.typing = [], []

    def send_message(self, chat_id, text, *, markup=None, **kw):
        self.sent.append((chat_id, text, markup))
        return {"message_id": len(self.sent)}

    def send_chat_action(self, chat_id, action="typing"):
        self.typing.append(chat_id)
        return True


def bare_bot():
    """A SupportBot without Telegram / dispatcher wiring — enough for the voice-note hook."""
    from paygo.config import get_settings
    from paygobot.support_bot import SupportBot

    bot = SupportBot.__new__(SupportBot)
    bot.settings = get_settings()
    bot.client = FakeClient()
    bot._locks, bot._locks_guard = {}, threading.Lock()
    return bot


def test_junk_and_tiny_files_never_reach_a_model(tmp_path, provider, monkeypatch):
    assert stt.clean("Редактор субтитров А.Кулакова") == ""
    assert stt.clean("Субтитры сделал DimaTorzok") == ""
    assert stt.clean("Продолжение следует…") == ""
    assert stt.clean("Спасибо за просмотр!") == ""
    assert stt.clean("...") == ""
    assert stt.clean("  Какая   комиссия?  ") == "Какая комиссия?"
    assert stt.clean("Оплатил 1500 сом. Субтитры сделал DimaTorzok") == "Оплатил 1500 сом."  # only the junk sentence goes
    assert stt.language_code("kg") == "ky" and stt.language_code("ru") == "ru" and stt.language_code("") is None
    provider("local")
    monkeypatch.setattr(stt, "_model", lambda: pytest.fail("the model must not be loaded"))
    tiny = tmp_path / "tiny.ogg"
    tiny.write_bytes(b"\0" * 100)
    assert stt.transcribe(tiny) == ""
    assert stt.transcribe(tmp_path / "missing.ogg") == ""
    # a real-sized file reaches the backend: junk from it is still dropped, failures never escape
    note = tmp_path / "note.ogg"
    note.write_bytes(b"\0" * 4096)
    monkeypatch.setattr(stt, "_transcribe_local", lambda path, language: "Субтитры сделал DimaTorzok")
    assert stt.transcribe(note) == ""
    seen = {}
    monkeypatch.setattr(stt, "_transcribe_local", lambda path, language: seen.setdefault("language", language) and " Какая  комиссия? ")
    assert stt.transcribe(note, language_hint="kg") == "Какая комиссия?" and seen["language"] == "ky"

    def boom(path, language):
        raise RuntimeError("no model")

    monkeypatch.setattr(stt, "_transcribe_local", boom)
    assert stt.transcribe(note) == ""


def test_provider_off_is_a_no_op(user, monkeypatch, provider):
    assert stt.enabled() is False  # the default: STT_PROVIDER=off
    calls = []
    monkeypatch.setattr(stt, "transcribe", lambda path, *, language_hint="": calls.append(str(path)) or "")
    bot = bare_bot()
    assert bot._transcribe_later(1, user, 5, "voice", VOICE, "ru") is None
    assert bot.client.sent == [] and bot.client.typing == [] and calls == []
    provider("local")
    assert stt.enabled() is True
    assert bot._transcribe_later(1, user, 5, "photo", "/uploads/support/x.jpg", "ru") is None  # not speech
    assert bot._transcribe_later(1, user, 5, "voice", "", "ru") is None  # the download failed: no file
    # a note the flood guard dropped was never stored: the thread starts but Whisper is not run
    thread = bot._transcribe_later(1, user, 5, "voice", VOICE, "ru")
    thread.join(10)
    assert calls == [] and bot.client.typing == []
    provider("nope")
    assert stt.enabled() is False


def test_voice_note_is_answered_from_its_transcript(user, fake_provider, monkeypatch):
    monkeypatch.setattr(stt, "enabled", lambda: True)
    monkeypatch.setattr(stt, "transcribe", lambda path, *, language_hint="": TEXT)
    with transaction() as db:
        u = db.get(User, user)
        chat_id = u.telegram_id
        first = support.respond(db, u, "", media_kind="voice", file_url=VOICE, file_name="", telegram_message_id=101)
        assert first and "получен" in first.text.lower()
        # control: the same words typed by another client
        other = get_or_create(db, {"id": 444555666, "username": "typer", "first_name": "Т"})
        typed = support.respond(db, other, TEXT, telegram_message_id=1)
    bot = bare_bot()
    thread = bot._transcribe_later(chat_id, user, 101, "voice", VOICE, "ru")
    assert thread is not None
    thread.join(10)
    assert not thread.is_alive()
    with transaction() as db:
        conv = support.client_conversation(db, db.get(User, user))
        rows = db.query(SupportMessage).filter_by(conversation_id=conv.id).order_by(SupportMessage.id).all()
        assert [(m.direction, m.kind) for m in rows] == [("in", "voice"), ("out", "text"), ("out", "text")]  # one inbound, no duplicate
        voice, _received, answer = rows
        assert voice.transcript == TEXT and voice.text == "[голосовое]"
        intent = support.classify(TEXT)
        assert voice.intent == f"{intent.category}/{intent.name}" and float(voice.confidence) == intent.confidence
        assert support.public_message(voice)["transcript"] == TEXT
        assert support.public_message(_received)["transcript"] == ""
        assert answer.sender == "bot" and answer.text == typed.text
        answer_text = answer.text
    assert [(c, t) for c, t, _ in bot.client.sent] == [(chat_id, answer_text)]
    assert bot.client.typing == [chat_id]


def test_transcript_escalates_and_stays_silent_under_the_operator(user, fake_provider, admin):
    with transaction() as db:
        u = db.get(User, user)
        support.respond(db, u, "", media_kind="voice", file_url="/uploads/support/a.ogg", telegram_message_id=7)
        msg = support.find_inbound(db, u, telegram_message_id=7)
        assert msg is not None and msg.kind == "voice"
        assert support.find_inbound(db, u, file_url="/uploads/support/a.ogg").id == msg.id  # fallback by file
        assert support.find_inbound(db, u, telegram_message_id=999) is None
        reply = support.answer_transcript(db, u, msg, "позовите оператора")
        assert reply and reply.escalate
        conv = support.active_conversation(db, u)
        assert conv.status == "waiting_operator" and msg.transcript == "позовите оператора" and msg.intent == "operator/operator"
        assert db.query(Notification).filter_by(event="support_operator").count() == 1
        assert db.query(SupportMessage).filter_by(direction="in").count() == 1
        assert support.answer_transcript(db, u, msg, "   ") is None and msg.transcript == "позовите оператора"  # silence → untouched
        # the operator took the dialog: the words are kept for them, the bot stays quiet
        support.operator_reply(db, conv, admin["id"], "Admin", "Смотрю")
        assert support.respond(db, u, "", media_kind="voice", file_url="/uploads/support/b.ogg", telegram_message_id=8) is None
        second = support.find_inbound(db, u, telegram_message_id=8)
        outgoing = db.query(SupportMessage).filter_by(direction="out").count()
        assert support.answer_transcript(db, u, second, "когда будет вывод") is None
        assert second.transcript == "когда будет вывод" and db.query(SupportMessage).filter_by(direction="out").count() == outgoing
