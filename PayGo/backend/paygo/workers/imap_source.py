"""Payment source: bank e-mails from an IMAP mailbox (Timeweb), push-style via IMAP IDLE.

``ImapIdleReader`` keeps one IMAP connection open and sits in ``IDLE`` (RFC 2177), so a
bank notification is fetched within milliseconds of arrival and becomes a
``payment_events`` row (idempotent by Message-ID) that goes through the same matching
pipeline as the webhook. When the server has no IDLE capability the reader degrades to
polling (``poll_once``) every ``IMAP_POLL_SECONDS``; with ``IMAP_IDLE=false`` the worker
runs ``poll_once`` in a plain loop instead. Disabled unless ``IMAP_ENABLED=true``.

The last processed UID of each mailbox is persisted in ``bot_sessions`` (a ``BotSession``
row with ``bot="imap:<host>:<user>:<folder>"`` trimmed to the column, ``telegram_id=0``,
``state="uid"``) together with the mailbox UIDVALIDITY, so restarts never re-read or miss mail.
"""
from __future__ import annotations

import email
import hashlib
import imaplib
import logging
import re
import select
import socket
import ssl
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from email.header import decode_header
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Any

from sqlalchemy import select as sa_select

from ..config import Settings, get_settings
from ..db import transaction
from ..models import BotSession
from ..services import payments
from ..utils import as_utc, iso, utcnow

logger = logging.getLogger("paygo.imap")

MAX_MESSAGE_AGE = timedelta(hours=6)  # older bank mail never becomes a payment event
FETCH_LIMIT = 50  # newest messages handled per catch-up pass
IDLE_TIMEOUT = 270.0  # re-issue IDLE every 4.5 min: servers drop sessions that idle longer (~5 min)
IDLE_WAKE = 15.0  # the IDLE wait wakes up this often to notice stop()
READ_TIMEOUT = 60.0  # socket timeout for every blocking read / command reply
CONNECT_TIMEOUT = 20.0
POLL_MIN_SECONDS = 1.0
BACKOFF_MIN = 2.0
BACKOFF_MAX = 60.0
HEALTHY_SESSION_SECONDS = 60.0  # a session that lived this long resets the reconnect backoff
HEARTBEAT_SECONDS = 1800.0
STATE_PREFIX = "imap:"
STATE_KEY_MAX = 64
STATE_NAME = "uid"
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_EXISTS = re.compile(rb"^\* (\d+) EXISTS\b", re.I)
_RECENT = re.compile(rb"^\* (\d+) RECENT\b", re.I)
_EXPUNGE = re.compile(rb"^\* (\d+) EXPUNGE\b", re.I)


# ------------------------------------------------------------------- message parsing

def _header(value: Any) -> str:
    if not value:
        return ""
    parts = []
    for chunk, enc in decode_header(str(value)):
        if isinstance(chunk, bytes):
            try:
                parts.append(chunk.decode(enc or "utf-8", "ignore"))
            except LookupError:
                parts.append(chunk.decode("utf-8", "ignore"))
        else:
            parts.append(chunk)
    return "".join(parts)


def _body(msg: Message) -> str:
    texts = []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() != "text":
            continue
        try:
            payload = part.get_payload(decode=True) or b""
            texts.append(payload.decode(part.get_content_charset() or "utf-8", "ignore"))
        except Exception:
            continue
    text = re.sub(r"<[^>]+>", " ", "\n".join(texts))
    return re.sub(r"\s+", " ", text).strip()


def _sent_at(msg: Message) -> datetime | None:
    try:
        return as_utc(parsedate_to_datetime(msg.get("Date")))
    except Exception:
        return None


def _imap_date(value: datetime) -> str:
    """``SINCE`` argument (``08-Sep-2026``), locale independent."""
    return f"{value.day:02d}-{_MONTHS[value.month - 1]}-{value.year}"


@dataclass(frozen=True)
class BankMail:
    """A bank notification parsed from one IMAP message."""

    uid: int
    message_id: str
    sender: str
    amount: Decimal
    text: str
    sent_at: datetime | None


def parse_bank_mail(raw: bytes, uid: int, *, senders: Iterable[str] = (), now: datetime | None = None) -> BankMail | None:
    """Parse one RFC822 message; None (reason logged) when it is not a fresh bank notification."""
    msg = email.message_from_bytes(raw)
    sender = _header(msg.get("From")).lower()
    message_id = _header(msg.get("Message-ID")).strip() or f"uid:{uid}"
    senders = [s for s in senders if s]
    if senders and not any(s in sender for s in senders):
        logger.debug("imap: uid %d from %r skipped: sender not in IMAP_SENDERS", uid, sender)
        return None
    text = f"{_header(msg.get('Subject'))} {_body(msg)}".strip()
    try:
        amount = payments.extract_amount(text)
    except ValueError:
        logger.info("imap: uid %d %s skipped: no amount found", uid, message_id)
        return None
    sent_at = _sent_at(msg)
    if sent_at is not None and (now or utcnow()) - sent_at > MAX_MESSAGE_AGE:
        logger.info("imap: uid %d %s skipped: sent %s, older than %s", uid, message_id, iso(sent_at), MAX_MESSAGE_AGE)
        return None
    return BankMail(uid=uid, message_id=message_id, sender=sender, amount=amount, text=text, sent_at=sent_at)


def ingest_bank_mail(mail: BankMail) -> bool:
    """Store the notification as a ``mail`` payment event and run matching. True when the event is new."""
    with transaction() as db:
        event, created = payments.ingest_event(
            db,
            source="mail",
            amount=mail.amount,
            raw_text=mail.text[:2000],
            external_id=mail.message_id[:160],
            event_key=f"mail:{mail.message_id}"[:96],
        )
        event_id = event.id
    if not created:
        logger.info("imap: %s (uid %d) already known as event %s", mail.message_id, mail.uid, event_id)
        return False
    logger.info("imap: payment %s from %s (uid %d) -> event %s", mail.amount, mail.message_id, mail.uid, event_id)
    try:
        payments.process_event(event_id)
    except Exception:
        logger.exception("imap: event %s could not be processed now; the payment_events loop retries", event_id)
    return True


# ------------------------------------------------------------------- UID cursor (bot_sessions)

def state_key(settings: Settings) -> str:
    """``bot`` value of the BotSession row that stores this mailbox's cursor (fits the column width)."""
    raw = f"{STATE_PREFIX}{settings.imap_host}:{settings.imap_user}:{settings.imap_folder}"[:STATE_KEY_MAX]
    limit = min(STATE_KEY_MAX, int(BotSession.__table__.c.bot.type.length or STATE_KEY_MAX))
    if len(raw) <= limit:
        return raw
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:6]  # keeps distinct mailboxes distinct once trimmed
    return f"{raw[: limit - len(digest) - 1]}:{digest}"


def _state_row(db, key: str) -> BotSession | None:
    return db.execute(sa_select(BotSession).where(BotSession.bot == key, BotSession.telegram_id == 0)).scalar_one_or_none()


def load_state(key: str) -> tuple[int, int]:
    """``(last_uid, uidvalidity)`` stored for the mailbox; zeros when unknown."""
    with transaction() as db:
        row = _state_row(db, key)
        data = dict(row.data or {}) if row is not None else {}
    return int(data.get("uid") or 0), int(data.get("uidvalidity") or 0)


def save_state(key: str, uid: int, uidvalidity: int) -> None:
    with transaction() as db:
        row = _state_row(db, key)
        if row is None:
            row = BotSession(bot=key, telegram_id=0, state=STATE_NAME, data={})
            db.add(row)
        row.state = STATE_NAME
        row.data = {"uid": int(uid), "uidvalidity": int(uidvalidity)}


# ------------------------------------------------------------------- protocol helpers

def _first_int(data: Any) -> int:
    for item in data or ():
        if item is None:
            continue
        match = re.search(r"\d+", item.decode("ascii", "replace") if isinstance(item, bytes) else str(item))
        if match:
            return int(match.group())
    return 0


def _response_int(conn: Any, code: str) -> int:
    try:
        _, data = conn.response(code)
    except Exception:
        return 0
    return _first_int(data)


def _supports_idle(conn: Any) -> bool:
    """IDLE capability: the greeting capabilities plus a fresh CAPABILITY after login (some servers differ)."""
    caps = {str(c).upper() for c in (getattr(conn, "capabilities", None) or ())}
    typ, data = conn.capability()
    if typ == "OK":
        for item in data or ():
            if isinstance(item, bytes):
                caps.update(item.decode("ascii", "replace").upper().split())
    return "IDLE" in caps


class IdleUnsupported(imaplib.IMAP4.error):
    """The server answered the IDLE command with NO/BAD."""


# ------------------------------------------------------------------- reader

class ImapIdleReader:
    """Push-style bank-mail reader: one connection, ``IDLE`` between deliveries, polling fallback.

    ``start()`` runs ``run()`` in a daemon thread and ``stop()`` ends it. Any failure closes the
    connection and reconnects with exponential backoff (2 s -> 60 s); a single unreadable message
    is skipped, never fatal. ``status()`` is a snapshot for logging.
    """

    def __init__(self, settings: Settings | None = None, *, connect: Callable[[], Any] | None = None, stop_event: threading.Event | None = None) -> None:
        self.settings = settings or get_settings()
        self._connect = connect or self._open_connection
        self._stop = stop_event or threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._conn: Any = None
        self._tagnum = 0
        self._exists = 0
        self._recent = 0
        self._found = 0
        self._idle_refused = False
        self._failures: dict[int, int] = {}
        self.key = state_key(self.settings)
        self.connected = False
        self.idle_supported: bool | None = None
        self.last_ok_at: datetime | None = None
        self.last_error = ""
        self.processed = 0
        self.reconnects = 0
        self.backoff = BACKOFF_MIN
        self.last_uid = 0
        self.uidvalidity = 0

    # --- lifecycle ------------------------------------------------------------------------------

    def start(self) -> threading.Thread:
        """Run the reader in a daemon thread (idempotent)."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self._thread
            self._stop.clear()
            self._thread = threading.Thread(target=self.run, name="imap-idle", daemon=True)
            self._thread.start()
            return self._thread

    def stop(self, timeout: float = 5.0) -> None:
        """Ask the loop to finish, wake it up if it is blocked in IDLE and wait for the thread."""
        self._stop.set()
        with self._lock:
            conn, thread = self._conn, self._thread
        sock = getattr(conn, "sock", None)
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout)

    def status(self) -> dict[str, Any]:
        """Snapshot for logging / diagnostics."""
        return {
            "mailbox": self.key,
            "connected": self.connected,
            "idle": self.idle_supported,
            "last_ok_at": iso(self.last_ok_at),
            "processed": self.processed,
            "reconnects": self.reconnects,
            "last_error": self.last_error,
            "last_uid": self.last_uid,
            "uidvalidity": self.uidvalidity,
        }

    def run(self) -> None:
        """Blocking main loop: connect, catch up, IDLE (or poll); reconnect with backoff on any failure."""
        s = self.settings
        if not (s.imap_host and s.imap_user):
            logger.error("imap reader not started: IMAP_HOST / IMAP_USER are not configured")
            return
        logger.info("imap reader starting: %s@%s:%s/%s", s.imap_user, s.imap_host, s.imap_port, s.imap_folder)
        while not self._stop.is_set():
            started = 0.0
            try:
                conn = self.connect()
                started = time.monotonic()
                try:
                    self.catch_up(conn)
                    if self.idle_supported:
                        self._idle_loop(conn)
                    else:
                        self._poll_loop(conn)
                finally:
                    self.disconnect(conn)
            except Exception as exc:
                if self._stop.is_set():
                    break
                if started and time.monotonic() - started >= HEALTHY_SESSION_SECONDS:
                    self.backoff = BACKOFF_MIN
                self.last_error = f"{type(exc).__name__}: {exc}"[:300]
                self.reconnects += 1
                logger.warning("imap: %s; reconnecting in %.0f s", self.last_error, self.backoff, exc_info=not isinstance(exc, (OSError, imaplib.IMAP4.error)))
                if self._stop.wait(self.backoff):
                    break
                self.backoff = min(BACKOFF_MAX, self.backoff * 2)
        self.disconnect()
        logger.info("imap reader stopped: %s", self.status())

    # --- connection -----------------------------------------------------------------------------

    def _open_connection(self) -> imaplib.IMAP4_SSL:
        s = self.settings
        return imaplib.IMAP4_SSL(s.imap_host, s.imap_port, timeout=CONNECT_TIMEOUT, ssl_context=ssl.create_default_context())

    def connect(self) -> Any:
        """Open the connection, log in, select the folder and load the UID cursor. Returns the connection."""
        s = self.settings
        if not (s.imap_host and s.imap_user):
            raise RuntimeError("IMAP_HOST / IMAP_USER are not configured")
        conn = self._connect()
        with self._lock:
            self._conn = conn
        try:
            self._set_timeout(conn, READ_TIMEOUT)
            conn.login(s.imap_user, s.imap_password)
            typ, data = conn.select(s.imap_folder, readonly=False)
            if typ != "OK":
                raise imaplib.IMAP4.error(f"SELECT {s.imap_folder}: {typ} {data}")
            self._exists = _first_int(data)
            self._recent = _response_int(conn, "RECENT")
            self.idle_supported = not self._idle_refused and _supports_idle(conn)
            self._load_cursor(conn)
        except BaseException:
            self.disconnect(conn)
            raise
        self.connected = True
        self._touch()
        logger.info(
            "imap: connected to %s/%s (idle=%s, %d messages, last uid %d, uidvalidity %d)",
            s.imap_host, s.imap_folder, self.idle_supported, self._exists, self.last_uid, self.uidvalidity,
        )
        return conn

    def disconnect(self, conn: Any = None) -> None:
        with self._lock:
            if conn is None:
                conn = self._conn
            if conn is self._conn:
                self._conn = None
        self.connected = False
        if conn is None:
            return
        self._set_timeout(conn, 5.0)  # a dead peer must not stall the reconnect
        try:
            conn.logout()
        except Exception:
            try:
                conn.shutdown()
            except Exception:
                pass

    def _load_cursor(self, conn: Any) -> None:
        uidvalidity = _response_int(conn, "UIDVALIDITY")
        uid, stored_validity = load_state(self.key)
        if uidvalidity and stored_validity and uidvalidity != stored_validity:
            logger.warning("imap: UIDVALIDITY of %s changed %d -> %d, starting over from uid 0", self.key, stored_validity, uidvalidity)
            uid = 0
        if uidvalidity and uidvalidity != stored_validity:
            save_state(self.key, uid, uidvalidity)
        self.last_uid = uid
        self.uidvalidity = uidvalidity or stored_validity

    # --- catching up ----------------------------------------------------------------------------

    def catch_up(self, conn: Any) -> int:
        """Process every message newer than the stored UID (newest ``FETCH_LIMIT``). Returns new events."""
        uids = self._search_new(conn)
        self._found = len(uids)
        if len(uids) > FETCH_LIMIT:
            logger.warning("imap: %d new messages, only the newest %d are read", len(uids), FETCH_LIMIT)
        handled = 0
        for uid in uids[-FETCH_LIMIT:]:
            if self._stop.is_set():
                break
            if self._handle(conn, uid):
                handled += 1
        self._touch()
        return handled

    def _search_new(self, conn: Any) -> list[int]:
        # SINCE is date-only and evaluated in the server's time zone, so start from yesterday;
        # the UID range and the 6-hour age cut-off do the precise work.
        since = _imap_date(utcnow() - timedelta(days=1))
        criteria = f"(UID {self.last_uid + 1}:* SINCE {since})" if self.last_uid else f"(SINCE {since})"
        typ, data = conn.uid("SEARCH", None, criteria)
        if typ != "OK":
            raise imaplib.IMAP4.error(f"UID SEARCH: {typ} {data}")
        found = (data[0] if data else b"") or b""
        return sorted(u for u in (int(x) for x in found.split()) if u > self.last_uid)

    @staticmethod
    def _fetch(conn: Any, uid: int) -> bytes | None:
        typ, parts = conn.uid("FETCH", str(uid), "(RFC822)")
        if typ != "OK":
            raise imaplib.IMAP4.error(f"UID FETCH {uid}: {typ} {parts}")
        for part in parts or ():
            if isinstance(part, tuple) and len(part) > 1 and isinstance(part[1], bytes):
                return part[1]
        return None  # expunged meanwhile

    def _handle(self, conn: Any, uid: int) -> bool:
        """Fetch, parse and ingest one message; problems with the message itself only skip it."""
        mail = None
        try:
            raw = self._fetch(conn, uid)
            if raw is not None:
                mail = parse_bank_mail(raw, uid, senders=self.settings.imap_sender_list)
        except (imaplib.IMAP4.abort, OSError):
            raise  # connection problem: reconnect and retry the same uid
        except Exception:
            logger.exception("imap: message uid %d cannot be read, skipped", uid)
        created = False
        if mail is not None:
            try:
                created = ingest_bank_mail(mail)
            except Exception:
                attempts = self._failures[uid] = self._failures.get(uid, 0) + 1
                if attempts < 3:
                    raise  # database hiccup: reconnect with backoff, the uid stays unprocessed
                logger.exception("imap: giving up on uid %d after %d attempts", uid, attempts)
        self._failures.pop(uid, None)
        self._advance(uid)
        if created:
            self.processed += 1
        return created

    def _advance(self, uid: int) -> None:
        if uid > self.last_uid:
            self.last_uid = uid
            save_state(self.key, uid, self.uidvalidity)

    # --- IDLE -----------------------------------------------------------------------------------

    def _idle_loop(self, conn: Any) -> None:
        heartbeat = time.monotonic()
        while not self._stop.is_set():
            try:
                announced = self._idle(conn)
            except IdleUnsupported as exc:
                self._idle_refused = True
                self.idle_supported = False
                logger.warning("imap: server refused IDLE (%s), falling back to polling", exc)
                self._poll_loop(conn)
                return
            handled = self.catch_up(conn)  # always re-check after DONE, so nothing is ever missed
            logger.debug("imap: IDLE cycle ended (announced=%s, new events=%d)", announced, handled)
            if announced and not self._found:
                self._stop.wait(1.0)  # a server that repeats EXISTS/RECENT must not spin us
            if time.monotonic() - heartbeat >= HEARTBEAT_SECONDS:
                heartbeat = time.monotonic()
                logger.info("imap: alive %s", self.status())

    def _idle(self, conn: Any) -> bool:
        """One IDLE cycle. Returns True as soon as the server announces new mail, False after IDLE_TIMEOUT."""
        tag = self._next_tag()
        self._set_timeout(conn, READ_TIMEOUT)
        conn.send(tag + b" IDLE\r\n")
        announced = False
        while True:  # continuation request "+ idling"; untagged responses may come first
            line = self._read_line(conn)
            if line.startswith(b"+"):
                break
            if line.startswith(tag + b" "):
                raise IdleUnsupported(line[len(tag) + 1:].decode("ascii", "replace").strip())
            announced |= self._untagged(line)
        deadline = time.monotonic() + IDLE_TIMEOUT
        while not announced and not self._stop.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            line = self._wait_line(conn, min(IDLE_WAKE, remaining))
            if line is not None:
                announced |= self._untagged(line)
        conn.send(b"DONE\r\n")
        self._set_timeout(conn, READ_TIMEOUT)
        while True:
            line = self._read_line(conn)
            if line.startswith(tag + b" "):
                status = line[len(tag) + 1:].split(None, 1)[0].upper()
                if status != b"OK":
                    raise imaplib.IMAP4.error(f"IDLE ended with {line.decode('ascii', 'replace').strip()}")
                break
            announced |= self._untagged(line)
        self._touch()
        return announced

    def _untagged(self, line: bytes) -> bool:
        """Interpret one untagged line received during IDLE; True when it means new mail."""
        if line.startswith(b"* BYE"):
            raise imaplib.IMAP4.abort(f"server closed the session: {line.decode('ascii', 'replace').strip()}")
        match = _EXISTS.match(line)
        if match:
            count = int(match.group(1))
            fresh = count > self._exists
            self._exists = count
            return fresh
        match = _RECENT.match(line)
        if match:
            count = int(match.group(1))
            fresh = count > self._recent
            self._recent = count
            return fresh
        if _EXPUNGE.match(line):
            self._exists = max(0, self._exists - 1)
        return False

    def _wait_line(self, conn: Any, timeout: float) -> bytes | None:
        """Wait up to ``timeout`` seconds for one line during IDLE; None when nothing arrived.

        Waiting uses ``select`` on the socket rather than a read timeout: a timed-out ``readline``
        poisons the socket's file object (``SocketIO`` refuses further reads), which would force a
        reconnect after every quiet IDLE cycle.
        """
        sock = getattr(conn, "sock", None)
        if sock is None:  # test doubles without a socket: a plain timed read
            try:
                return self._read_line(conn)
            except TimeoutError:
                return None
        if not self._buffered(conn):
            readable, _, _ = select.select([sock], [], [], timeout)
            if not readable:
                return None
        self._set_timeout(conn, READ_TIMEOUT)
        return self._read_line(conn)

    @staticmethod
    def _buffered(conn: Any) -> bool:
        """True when a line is already waiting in imaplib's read buffer (select() cannot see it)."""
        sock, file = getattr(conn, "sock", None), getattr(conn, "file", None)
        if sock is None or not hasattr(file, "peek"):
            return False
        sock.setblocking(False)
        try:
            return bool(file.peek(1))
        except (BlockingIOError, InterruptedError, ssl.SSLWantReadError, ssl.SSLWantWriteError):
            return False
        finally:
            sock.settimeout(READ_TIMEOUT)

    @staticmethod
    def _read_line(conn: Any) -> bytes:
        line = conn.readline()
        if not line:
            raise imaplib.IMAP4.abort("connection closed by the server")
        return line

    @staticmethod
    def _set_timeout(conn: Any, seconds: float) -> None:
        sock = getattr(conn, "sock", None)
        if sock is not None:
            sock.settimeout(seconds)

    def _next_tag(self) -> bytes:
        self._tagnum += 1
        return b"PGIDLE%d" % self._tagnum

    def _touch(self) -> None:
        self.last_ok_at = utcnow()

    # --- polling fallback -----------------------------------------------------------------------

    def _poll_loop(self, conn: Any) -> None:
        interval = max(POLL_MIN_SECONDS, float(self.settings.imap_poll_seconds))
        logger.warning("imap: IDLE unavailable, polling %s every %.1f s", self.settings.imap_folder, interval)
        while not self._stop.wait(interval):
            poll_once(conn, reader=self)


def poll_once(conn: Any = None, *, reader: ImapIdleReader | None = None) -> int:
    """One polling pass; returns the number of new payment events.

    Fallback when IDLE is unavailable: the worker calls it every ``IMAP_POLL_SECONDS`` on a fresh
    connection (``IMAP_IDLE=false``); ``ImapIdleReader`` calls it on its open connection when the
    server lacks the IDLE capability. The UID cursor is shared through the database.
    """
    settings = reader.settings if reader is not None else get_settings()
    if not (settings.imap_host and settings.imap_user):
        return 0
    reader = reader or ImapIdleReader(settings)
    if conn is not None:
        conn.noop()  # lets the server report messages delivered since the last command
        return reader.catch_up(conn)
    conn = reader.connect()
    try:
        return reader.catch_up(conn)
    finally:
        reader.disconnect(conn)
