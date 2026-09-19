"""Optima OTP e-mail reader: code extraction, sender/age filters, and the provider hook."""
from __future__ import annotations

from datetime import timedelta
from email.message import EmailMessage
from email.utils import format_datetime

import pytest
from paygo.payouts.otp_email import OtpEmailConfig, OtpEmailReader, extract_code
from paygo.utils import utcnow

SENDER = "Optima Bank <no-reply@optima24.kg>"


def code_mail(code="481920", *, sender=SENDER, subject="Код подтверждения", sent_at=None, body=None) -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "codes@wwweeewww.fit"
    msg["Subject"] = subject
    msg["Date"] = format_datetime(sent_at or utcnow())
    msg.set_content(body if body is not None else f"Ваш код для подтверждения перевода: {code}. Никому не сообщайте.")
    return msg.as_bytes()


def _cfg(**kw):
    base = dict(host="imap.x", user="u", password="p", sender="optima24.kg")
    base.update(kw)
    return OtpEmailConfig(**base)


class FakeImap:
    """Minimal IMAP surface the OTP reader uses: login/select/uid(SEARCH|FETCH)/logout."""

    def __init__(self, messages: dict[int, bytes]):
        self.messages = messages
        self.logged_in = False
        self.selected = None

    def login(self, user, password):
        self.logged_in = True
        return ("OK", [b""])

    def select(self, folder, readonly=False):
        self.selected = (folder, readonly)
        return ("OK", [b"1"])

    def uid(self, command, *args):
        if command == "SEARCH":
            return ("OK", [" ".join(str(u) for u in self.messages).encode()])
        if command == "FETCH":
            uid = int(args[0])
            raw = self.messages.get(uid)
            return ("OK", [(b"%d (RFC822 {})" % uid, raw)] if raw is not None else [None])
        return ("NO", [b""])

    def logout(self):
        return ("BYE", [b""])


# --------------------------------------------------------------------------- extraction

def test_extract_code_reads_the_number():
    assert extract_code(code_mail("481920"), _cfg()) == "481920"


def test_extract_code_rejects_wrong_sender():
    assert extract_code(code_mail(sender="Somebody <spam@evil.kg>"), _cfg()) is None


def test_extract_code_respects_subject_filter():
    cfg = _cfg(subject="подтвержд")
    assert extract_code(code_mail(subject="Код подтверждения перевода"), cfg) == "481920"
    assert extract_code(code_mail(subject="Реклама"), cfg) is None


def test_extract_code_rejects_old_mail():
    old = utcnow() - timedelta(minutes=10)
    assert extract_code(code_mail(sent_at=old), _cfg(), since=utcnow()) is None
    assert extract_code(code_mail(sent_at=utcnow()), _cfg(), since=utcnow() - timedelta(minutes=1)) == "481920"


def test_extract_code_custom_regex():
    cfg = _cfg(code_regex=r"код[:\s]+(\d{4,8})")
    body = "Перевод 5300 KGS. код: 774411"
    assert extract_code(code_mail(body=body), cfg) == "774411"


# --------------------------------------------------------------------------- reader

def test_reader_returns_newest_code():
    now = utcnow()
    reader = OtpEmailReader(_cfg(), connect=lambda: FakeImap({
        1: code_mail("111111", sent_at=now - timedelta(minutes=5)),
        2: code_mail("222222", sent_at=now),
    }))
    assert reader.latest_code(since=now - timedelta(minutes=1)) == "222222"


def test_reader_none_when_unconfigured():
    reader = OtpEmailReader(OtpEmailConfig())
    assert reader.latest_code() is None


def test_wait_for_code_found_immediately():
    reader = OtpEmailReader(_cfg(), connect=lambda: FakeImap({1: code_mail("909090")}))
    assert reader.wait_for_code(since=utcnow() - timedelta(minutes=1), timeout=5) == "909090"


# --------------------------------------------------------------------------- provider hook

def test_optima_pay_reads_code_then_needs_confirm_capture():
    from paygo.payouts.base import PayoutError, PayoutTarget
    from paygo.payouts.optima24 import Optima24Provider

    class StubReader:
        def wait_for_code(self, *, since, timeout=None, stop=None):
            return "555000"

    p = Optima24Provider(base_url="https://telebank3.optima24.kg:3080", login="x", password="y", otp_reader=StubReader())
    p._token = "session"  # skip the login capture for this unit test
    target = PayoutTarget(amount=1, card="4177...", reference="W1")
    with pytest.raises(PayoutError) as exc:
        p.pay(target)
    assert "pay-init/pay-confirm" in str(exc.value)  # got past the code step to the confirm capture


def test_optima_pay_without_mailbox_is_loud():
    from paygo.payouts.base import PayoutError, PayoutTarget
    from paygo.payouts.optima24 import Optima24Provider

    p = Optima24Provider(base_url="https://telebank3.optima24.kg:3080", login="x", password="y", otp_reader=None)
    p._token = "session"
    with pytest.raises(PayoutError) as exc:
        p.pay(PayoutTarget(amount=1, card="4177", reference="W1"))
    assert "почт" in str(exc.value).lower()
