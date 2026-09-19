"""Read Optima's one-time transfer-confirmation code from a dedicated e-mail mailbox.

Optima confirms every transfer with a code sent to e-mail. A mailbox that receives *only*
these codes is polled over IMAP; the newest code that arrived after the transfer was
submitted is handed back to the Optima24 provider, which confirms the transfer. No phone,
no SMS.

Why this is safe to match blindly to a transfer: the payout engine sends one transfer at a
time, paced 15-20s apart, so at most one confirmation is ever outstanding. ``wait_for_code``
only accepts mail newer than the submit moment and from the trusted sender, so it cannot
pick up an old or unrelated code.

Read-only: the reader never deletes or marks mail, and it is a separate connection from the
deposit IMAP reader, so the two never interfere.
"""
from __future__ import annotations

import imaplib
import logging
import re
import ssl
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..config import Settings, get_settings
from ..utils import as_utc, utcnow
from ..workers.imap_source import _header, _imap_date, _sent_at

logger = logging.getLogger("paygo.payouts.otp")

CONNECT_TIMEOUT = 20.0
# tolerate a little clock skew between our server and the mail server when matching by date
SKEW = timedelta(seconds=60)
DEFAULT_CODE_RE = r"(\d{4,8})"
# a code sitting right after the word "код" / "code" / "otp" — used before any bare-number guess so
# footer numbers (short numbers, a year, a phone) can never be mistaken for the code
_CODE_NEAR_KEYWORD = re.compile(r"(?is)(?:код|code|otp)[^\d]{0,60}(\d{4,8})")


@dataclass
class OtpEmailConfig:
    host: str = ""
    port: int = 993
    user: str = ""
    password: str = ""
    folder: str = "INBOX"
    sender: str = ""
    subject: str = ""
    code_regex: str = r"(\d{4,8})"
    wait_seconds: float = 90.0
    poll_seconds: float = 3.0

    @classmethod
    def from_settings(cls, s: Settings | None = None) -> OtpEmailConfig:
        s = s or get_settings()
        return cls(
            host=s.optima_otp_imap_host,
            port=s.optima_otp_imap_port,
            user=s.optima_otp_imap_user,
            password=s.optima_otp_imap_password,
            folder=s.optima_otp_imap_folder or "INBOX",
            sender=s.optima_otp_sender,
            subject=s.optima_otp_subject,
            code_regex=s.optima_otp_code_regex or r"(\d{4,8})",
            wait_seconds=s.optima_otp_wait_seconds,
            poll_seconds=s.optima_otp_poll_seconds,
        )

    @property
    def configured(self) -> bool:
        return bool(self.host and self.user and self.password)


def _clean_body(msg: Any) -> str:
    """Readable message text from every text part combined (plain as-is, HTML with its style /
    script blocks and tags removed). Bank e-mails carry a big CSS block whose sizes and colours
    contain numbers — stripping it means those can never reach the code search."""
    parts: list[str] = []
    for part in (msg.walk() if msg.is_multipart() else [msg]):
        if part.get_content_maintype() != "text":
            continue
        try:
            text = (part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", "ignore")
        except Exception:
            continue
        if part.get_content_subtype() == "html":
            text = re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", text)  # drop CSS / JS blocks
            text = re.sub(r"<[^>]+>", " ", text)
        parts.append(text)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def extract_code(raw: bytes, cfg: OtpEmailConfig, *, since: datetime | None = None) -> str | None:
    """Return the confirmation code from one raw message, or None when it does not qualify."""
    import email as email_mod

    try:
        msg = email_mod.message_from_bytes(raw)
    except Exception:
        return None
    sender = _header(msg.get("From")).lower()
    if cfg.sender and cfg.sender.lower() not in sender:
        return None
    subject = _header(msg.get("Subject"))
    if cfg.subject and cfg.subject.lower() not in subject.lower():
        return None
    sent = _sent_at(msg)
    if since is not None and sent is not None and sent < as_utc(since) - SKEW:
        return None  # older than the transfer we are confirming
    text = f"{subject}\n{_clean_body(msg)}"
    # 1) a custom regex, if the operator set one, always wins
    if cfg.code_regex and cfg.code_regex.strip() not in ("", DEFAULT_CODE_RE):
        try:
            match = re.search(cfg.code_regex, text)
            if match:
                return match.group(match.lastindex or 0)
        except re.error:
            pass
    # 2) a code right after the word "код" / "code" / "otp"
    match = _CODE_NEAR_KEYWORD.search(text)
    if match:
        return match.group(1)
    # 3) fallback: the first 4-8 digit run
    match = re.search(r"\d{4,8}", text)
    return match.group(0) if match else None


class OtpEmailReader:
    """Poll a dedicated mailbox for the newest Optima confirmation code."""

    def __init__(self, cfg: OtpEmailConfig, *, connect: Callable[[], Any] | None = None):
        self.cfg = cfg
        self._connect = connect or self._open

    def _open(self) -> imaplib.IMAP4_SSL:
        return imaplib.IMAP4_SSL(self.cfg.host, self.cfg.port, timeout=CONNECT_TIMEOUT, ssl_context=ssl.create_default_context())

    def latest_code(self, *, since: datetime | None = None) -> str | None:
        """One pass: newest qualifying code in the mailbox, or None."""
        if not self.cfg.configured:
            return None
        conn = self._connect()
        try:
            conn.login(self.cfg.user, self.cfg.password)
            conn.select(self.cfg.folder, readonly=True)
            since_date = _imap_date((as_utc(since) if since else utcnow()) - timedelta(minutes=10))
            typ, data = conn.uid("SEARCH", None, f"(SINCE {since_date})")
            if typ != "OK":
                return None
            uids = sorted(int(x) for x in (data[0] or b"").split()) if data else []
            for uid in reversed(uids[-25:]):  # newest first
                raw = _fetch(conn, uid)
                if raw is None:
                    continue
                code = extract_code(raw, self.cfg, since=since)
                if code:
                    return code
            return None
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    def wait_for_code(self, *, since: datetime, timeout: float | None = None, stop: Callable[[], bool] | None = None) -> str | None:
        """Poll until a code arrives or the timeout elapses. ``since`` is the transfer submit time."""
        deadline = time.monotonic() + (self.cfg.wait_seconds if timeout is None else timeout)
        while time.monotonic() < deadline:
            if stop is not None and stop():
                return None
            try:
                code = self.latest_code(since=since)
            except Exception as exc:
                logger.warning("otp: mailbox read failed: %s", exc)
                code = None
            if code:
                return code
            time.sleep(max(0.5, self.cfg.poll_seconds))
        return None


def _fetch(conn: Any, uid: int) -> bytes | None:
    typ, parts = conn.uid("FETCH", str(uid), "(RFC822)")
    if typ != "OK":
        return None
    for part in parts or ():
        if isinstance(part, tuple) and len(part) > 1 and isinstance(part[1], (bytes, bytearray)):
            return bytes(part[1])
    return None


def reader_from_settings(s: Settings | None = None) -> OtpEmailReader | None:
    cfg = OtpEmailConfig.from_settings(s)
    return OtpEmailReader(cfg) if cfg.configured else None
