"""IMAP bank-mail source: parsing, UID persistence, the IDLE loop and the polling fallback (no network)."""
from __future__ import annotations

import re
import socket
import threading
import time
from datetime import timedelta
from decimal import Decimal
from email.message import EmailMessage
from email.utils import format_datetime

import pytest
from paygo.db import transaction
from paygo.models import BotSession, PaymentEvent
from paygo.services import payments
from paygo.utils import utcnow
from paygo.workers import imap_source
from paygo.workers.imap_source import ImapIdleReader, load_state, parse_bank_mail, poll_once, save_state, state_key

SENDER = "DemirBank <noreply@demirbank.kg>"


def bank_mail(amount="1500.37", *, sender=SENDER, message_id="<abc123@demirbank.kg>", sent_at=None, body=None) -> bytes:
    """A realistic multipart/alternative bank notification (RFC 2047 subject, text + html parts)."""
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "pay@wwweeewww.fit"
    msg["Subject"] = "Поступление средств"
    if message_id:
        msg["Message-ID"] = message_id
    msg["Date"] = format_datetime(sent_at or utcnow())
    text = body if body is not None else f"Зачислено {amount} KGS от ***1234. Назначение: пополнение."
    msg.set_content(text)
    msg.add_alternative(f"<html><body><p>{text}</p></body></html>", subtype="html")
    return msg.as_bytes()


class FakeImap:
    """In-memory IMAP server with the surface the reader uses; the IDLE wire is a real socketpair."""

    def __init__(self, messages=None, *, idle=True, refuse_idle=False, uidvalidity=100):
        self.messages: dict[int, bytes] = dict(messages or {})
        self.idle = idle
        self.refuse_idle = refuse_idle
        self.uidvalidity = uidvalidity
        self.capabilities = ("IMAP4REV1", "IDLE") if idle else ("IMAP4REV1",)
        self.sent: list[bytes] = []
        self.commands: list[tuple] = []
        self.noops = 0
        self.logged_in = False
        self.selected = None
        self.closed = False
        self.idle_tag = None
        self._responses: dict[str, list] = {}
        self.sock, self._server = socket.socketpair()
        self.file = self.sock.makefile("rb")
        self._lock = threading.Lock()

    # --- imaplib surface
    def login(self, user, password):
        self.logged_in = True
        return "OK", [b"Logged in"]

    def select(self, folder, readonly=False):
        assert self.logged_in
        self.selected = folder
        self._responses["UIDVALIDITY"] = [str(self.uidvalidity).encode()]
        self._responses["RECENT"] = [b"0"]
        return "OK", [str(len(self.messages)).encode()]

    def response(self, code):
        return code, self._responses.pop(code, [None])

    def capability(self):
        return "OK", [" ".join(self.capabilities).encode()]

    def noop(self):
        self.noops += 1
        return "OK", [b"NOOP completed"]

    def uid(self, command, *args):
        assert self.selected, "mailbox not selected"
        self.commands.append((command, args))
        if command == "SEARCH":
            match = re.search(r"UID (\d+):\*", args[-1])
            low = int(match.group(1)) if match else 1
            uids = [u for u in sorted(self.messages) if u >= low]
            if not uids and self.messages:  # RFC 3501: "n:*" always includes the highest UID
                uids = [max(self.messages)]
            return "OK", [b" ".join(str(u).encode() for u in uids)]
        if command == "FETCH":
            uid = int(args[0])
            raw = self.messages.get(uid)
            if raw is None:
                return "OK", [None]
            return "OK", [(f"{uid} (UID {uid} RFC822 {{{len(raw)}}}".encode(), raw), b")"]
        raise AssertionError(f"unexpected command {command}")

    def readline(self):
        return self.file.readline()

    def send(self, data):
        self.sent.append(data)
        if data.endswith(b" IDLE\r\n"):
            self.idle_tag = data.split()[0]
            reply = self.idle_tag + b" BAD IDLE not supported\r\n" if self.refuse_idle else b"+ idling\r\n"
            self._server.sendall(reply)
        elif data == b"DONE\r\n":
            self._server.sendall(self.idle_tag + b" OK Idle completed\r\n")

    def logout(self):
        self.shutdown()
        return "BYE", [b"Logging out"]

    def shutdown(self):
        with self._lock:
            if self.closed:
                return
            self.closed = True
        for obj in (self.file, self.sock, self._server):
            try:
                obj.close()
            except OSError:
                pass

    # --- test helpers
    def deliver(self, uid, raw):
        """New mail arrives: the server pushes EXISTS/RECENT to the idling client."""
        self.messages[uid] = raw
        self._server.sendall(f"* {len(self.messages)} EXISTS\r\n* 1 RECENT\r\n".encode())

    def idle_count(self):
        return sum(1 for chunk in self.sent if chunk.endswith(b" IDLE\r\n"))

    def searches(self):
        return [args[-1] for command, args in self.commands if command == "SEARCH"]


def wait_for(condition, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        time.sleep(0.01)


@pytest.fixture
def imap_env(monkeypatch):
    monkeypatch.setenv("IMAP_ENABLED", "true")
    monkeypatch.setenv("IMAP_HOST", "imap.example.test")
    monkeypatch.setenv("IMAP_USER", "pay@wwweeewww.fit")
    monkeypatch.setenv("IMAP_PASSWORD", "secret")
    monkeypatch.setenv("IMAP_SENDERS", "demirbank.kg")
    monkeypatch.setenv("IMAP_POLL_SECONDS", "0.02")
    from paygo.config import get_settings, reset_settings_cache

    reset_settings_cache()
    yield get_settings()
    reset_settings_cache()


@pytest.fixture
def pipeline(monkeypatch):
    """Replace ingest/process with recorders (the IDLE tests check wiring, not matching)."""
    calls = []

    class Event:
        id = 555

    def fake_ingest(db, **kwargs):
        calls.append(("ingest", kwargs))
        return Event(), True

    def fake_process(event_id):
        calls.append(("process", event_id))
        return {"ok": True}

    monkeypatch.setattr(payments, "ingest_event", fake_ingest)
    monkeypatch.setattr(payments, "process_event", fake_process)
    return calls


# ------------------------------------------------------------------- parsing

def test_multipart_bank_mail_becomes_event_with_correct_amount(seeded, imap_env):
    mail = parse_bank_mail(bank_mail("1500.37"), 7, senders=["demirbank.kg"])
    assert mail is not None
    assert mail.amount == Decimal("1500.37")
    assert mail.message_id == "<abc123@demirbank.kg>"
    assert mail.sender == "demirbank <noreply@demirbank.kg>"
    assert mail.text.startswith("Поступление средств")  # RFC 2047 subject decoded
    assert "Зачислено 1500.37 KGS" in mail.text and "<p>" not in mail.text  # html part stripped to text
    assert mail.sent_at is not None and mail.sent_at.tzinfo is not None

    assert imap_source.ingest_bank_mail(mail) is True
    assert imap_source.ingest_bank_mail(mail) is False  # idempotent by Message-ID
    with transaction() as db:
        events = db.query(PaymentEvent).all()
        assert len(events) == 1
        event = events[0]
        assert event.source == "mail" and event.amount == Decimal("1500.37")
        assert event.external_id == "<abc123@demirbank.kg>" and event.event_key == "mail:<abc123@demirbank.kg>"
        assert "Зачислено 1500.37 KGS" in event.raw_text


def test_parse_filters_sender_amount_and_age(imap_env):
    senders = ["demirbank.kg"]
    assert parse_bank_mail(bank_mail(sender="Someone <x@example.com>"), 1, senders=senders) is None
    assert parse_bank_mail(bank_mail(body="Добрый день! Ваша выписка готова."), 2, senders=senders) is None
    assert parse_bank_mail(bank_mail(sent_at=utcnow() - timedelta(hours=7)), 3, senders=senders) is None
    fresh = parse_bank_mail(bank_mail(sent_at=utcnow() - timedelta(hours=5)), 4, senders=senders)
    assert fresh is not None and fresh.amount == Decimal("1500.37")
    # no sender filter accepts everything; a missing Message-ID falls back to the uid
    anonymous = parse_bank_mail(bank_mail(sender="x@example.com", message_id=""), 9)
    assert anonymous is not None and anonymous.message_id == "uid:9"


# ------------------------------------------------------------------- UID cursor persistence

def test_uid_cursor_persisted_in_bot_session(imap_env):
    key = state_key(imap_env)
    limit = BotSession.__table__.c.bot.type.length
    assert key.startswith("imap:") and len(key) <= limit
    assert state_key(imap_env.model_copy(update={"imap_folder": "Archive"})) != key
    assert load_state(key) == (0, 0)

    save_state(key, 42, 100)
    save_state(key, 43, 100)
    assert load_state(key) == (43, 100)
    with transaction() as db:
        rows = db.query(BotSession).filter_by(bot=key).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.telegram_id == 0 and row.state == "uid"
        assert row.data == {"uid": 43, "uidvalidity": 100}


def test_uidvalidity_change_resets_cursor(imap_env):
    key = state_key(imap_env)
    save_state(key, 42, 100)

    reader = ImapIdleReader(imap_env, connect=lambda: FakeImap(uidvalidity=100))
    conn = reader.connect()
    assert (reader.last_uid, reader.uidvalidity) == (42, 100)
    assert reader.connected and reader.idle_supported is True
    reader.disconnect(conn)
    assert not reader.connected and conn.closed

    fresh = ImapIdleReader(imap_env, connect=lambda: FakeImap(uidvalidity=200))
    fresh.disconnect(fresh.connect())
    assert (fresh.last_uid, fresh.uidvalidity) == (0, 200)
    assert load_state(key) == (0, 200)


def test_catch_up_skips_uids_already_processed(imap_env, pipeline):
    key = state_key(imap_env)
    save_state(key, 5, 100)
    fake = FakeImap({5: bank_mail(message_id="<old@demirbank.kg>"), 6: bank_mail("900.00", message_id="<new@demirbank.kg>")})
    reader = ImapIdleReader(imap_env, connect=lambda: fake)
    conn = reader.connect()
    assert reader.catch_up(conn) == 1
    reader.disconnect(conn)
    assert len(fake.searches()) == 1 and fake.searches()[0].startswith("(UID 6:* SINCE ")
    assert [c[0] for c in pipeline] == ["ingest", "process"]
    assert pipeline[0][1]["external_id"] == "<new@demirbank.kg>"
    assert load_state(key) == (6, 100)


# ------------------------------------------------------------------- IDLE

def test_idle_loop_fetches_new_mail_on_exists(imap_env, pipeline):
    fake = FakeImap()
    reader = ImapIdleReader(imap_env, connect=lambda: fake)
    reader.start()
    try:
        wait_for(lambda: fake.idle_tag is not None)  # the reader sits in IDLE
        assert reader.connected and reader.idle_supported is True
        assert fake.sent[-1] == fake.idle_tag + b" IDLE\r\n"

        fake.deliver(1, bank_mail("2500.00", message_id="<m1@demirbank.kg>"))
        wait_for(lambda: len(pipeline) == 2)
        kind, kwargs = pipeline[0]
        assert kind == "ingest"
        assert kwargs["source"] == "mail" and kwargs["amount"] == Decimal("2500.00")
        assert kwargs["external_id"] == "<m1@demirbank.kg>" and kwargs["event_key"] == "mail:<m1@demirbank.kg>"
        assert "Зачислено 2500.00 KGS" in kwargs["raw_text"]
        assert pipeline[1] == ("process", 555)

        wait_for(lambda: reader.last_uid == 1 and fake.idle_count() >= 2)  # DONE, fetched, back to IDLE
        assert b"DONE\r\n" in fake.sent
        assert load_state(reader.key) == (1, fake.uidvalidity)
        status = reader.status()
        assert status["processed"] == 1 and status["connected"] and status["idle"] and status["last_ok_at"]
        assert status["last_error"] == "" and status["reconnects"] == 0
    finally:
        reader.stop(timeout=5)
    assert not reader._thread.is_alive()
    assert fake.closed and not reader.connected


def test_idle_is_reissued_before_the_server_timeout(imap_env, monkeypatch, pipeline):
    monkeypatch.setattr(imap_source, "IDLE_TIMEOUT", 0.15)
    monkeypatch.setattr(imap_source, "IDLE_WAKE", 0.05)
    fake = FakeImap()
    reader = ImapIdleReader(imap_env, connect=lambda: fake)
    reader.start()
    try:
        wait_for(lambda: fake.idle_count() >= 3)
        assert fake.sent.count(b"DONE\r\n") >= 2
        assert len(fake.searches()) >= 3  # catch-up on connect, then a re-check after every DONE
        assert pipeline == [] and reader.reconnects == 0
    finally:
        reader.stop()


def test_idle_refused_by_server_falls_back_to_polling(imap_env, monkeypatch, pipeline):
    monkeypatch.setattr(imap_source, "POLL_MIN_SECONDS", 0.02)
    fake = FakeImap(refuse_idle=True)
    reader = ImapIdleReader(imap_env, connect=lambda: fake)
    reader.start()
    try:
        wait_for(lambda: fake.noops >= 2)
        assert reader.idle_supported is False and reader.reconnects == 0
        assert fake.idle_count() == 1
        fake.messages[1] = bank_mail("42.00", message_id="<poll@demirbank.kg>")
        wait_for(lambda: len(pipeline) == 2)
        assert pipeline[0][1]["amount"] == Decimal("42.00")
    finally:
        reader.stop()


def test_reader_reconnects_with_backoff(imap_env, monkeypatch, pipeline):
    monkeypatch.setattr(imap_source, "BACKOFF_MIN", 0.01)
    attempts = []
    fake = FakeImap()

    def connect():
        attempts.append(time.monotonic())
        if len(attempts) < 3:
            raise OSError("connection refused")
        return fake

    reader = ImapIdleReader(imap_env, connect=connect)
    reader.start()
    try:
        wait_for(lambda: fake.idle_tag is not None)
        assert len(attempts) == 3 and reader.reconnects == 2
        assert reader.status()["last_error"] == "OSError: connection refused"
        assert reader.backoff == pytest.approx(0.04)  # 0.01 -> 0.02 -> 0.04
    finally:
        reader.stop()


# ------------------------------------------------------------------- polling fallback

def test_poll_once_without_idle_capability(seeded, imap_env, monkeypatch):
    fake = FakeImap({5: bank_mail("777.00", message_id="<p5@demirbank.kg>")}, idle=False)
    monkeypatch.setattr(imap_source.imaplib, "IMAP4_SSL", lambda *args, **kwargs: fake)
    assert poll_once() == 1
    assert fake.closed  # its own connection is logged out
    with transaction() as db:
        event = db.query(PaymentEvent).one()
        assert event.source == "mail" and event.amount == Decimal("777.00")
        assert event.external_id == "<p5@demirbank.kg>"
    assert load_state(state_key(imap_env)) == (5, fake.uidvalidity)

    again = FakeImap({5: fake.messages[5], 6: bank_mail("10.00", message_id="<p6@demirbank.kg>")}, idle=False)
    monkeypatch.setattr(imap_source.imaplib, "IMAP4_SSL", lambda *args, **kwargs: again)
    assert poll_once() == 1
    assert again.searches()[0].startswith("(UID 6:* SINCE ")
    with transaction() as db:
        assert db.query(PaymentEvent).count() == 2
    assert load_state(state_key(imap_env)) == (6, again.uidvalidity)


def test_reader_polls_when_server_has_no_idle(imap_env, monkeypatch, pipeline):
    monkeypatch.setattr(imap_source, "POLL_MIN_SECONDS", 0.02)
    fake = FakeImap(idle=False)
    reader = ImapIdleReader(imap_env, connect=lambda: fake)
    reader.start()
    try:
        wait_for(lambda: len(fake.searches()) >= 3)
        assert reader.idle_supported is False and fake.idle_count() == 0
        assert fake.noops >= 2
        fake.messages[3] = bank_mail("15.00", message_id="<np3@demirbank.kg>")
        wait_for(lambda: len(pipeline) == 2)
        assert pipeline[0][1]["external_id"] == "<np3@demirbank.kg>"
        assert reader.status()["processed"] == 1
    finally:
        reader.stop()


def test_poll_once_disabled_without_host(monkeypatch):
    monkeypatch.delenv("IMAP_HOST", raising=False)
    from paygo.config import reset_settings_cache

    reset_settings_cache()
    assert poll_once() == 0
