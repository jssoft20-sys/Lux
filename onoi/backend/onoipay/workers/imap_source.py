"""Optional payment source: bank e-mails polled from an IMAP mailbox (Timeweb).

Each new message from a configured sender becomes a ``payment_events`` row
(idempotent by Message-ID) and goes through the same matching pipeline as the
webhook. Disabled unless ``IMAP_ENABLED=true``.
"""
from __future__ import annotations

import email
import imaplib
import logging
from email.header import decode_header
from email.utils import parsedate_to_datetime

from ..config import get_settings
from ..db import transaction
from ..services import payments
from ..utils import utcnow

logger = logging.getLogger("onoipay.imap")
_LAST_UID: dict[str, int] = {}


def _header(value) -> str:
    if not value:
        return ""
    parts = []
    for chunk, enc in decode_header(str(value)):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(enc or "utf-8", "ignore"))
        else:
            parts.append(chunk)
    return "".join(parts)


def _body(msg) -> str:
    texts = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype in {"text/plain", "text/html"}:
                try:
                    texts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore"))
                except Exception:
                    pass
    else:
        try:
            texts.append(msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", "ignore"))
        except Exception:
            pass
    import re

    text = "\n".join(texts)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def poll_once() -> int:
    settings = get_settings()
    if not (settings.imap_host and settings.imap_user):
        return 0
    key = f"{settings.imap_host}:{settings.imap_user}:{settings.imap_folder}"
    conn = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, timeout=20)
    handled = 0
    try:
        conn.login(settings.imap_user, settings.imap_password)
        conn.select(settings.imap_folder, readonly=False)
        since = (utcnow()).strftime("%d-%b-%Y")
        status, data = conn.uid("SEARCH", None, f'(SINCE "{since}")')
        if status != "OK":
            return 0
        uids = [int(x) for x in (data[0] or b"").split()]
        last = _LAST_UID.get(key, 0)
        fresh = [u for u in uids if u > last]
        for uid in fresh[-50:]:
            status, parts = conn.uid("FETCH", str(uid), "(RFC822)")
            if status != "OK" or not parts or not isinstance(parts[0], tuple):
                continue
            msg = email.message_from_bytes(parts[0][1])
            sender = _header(msg.get("From")).lower()
            if settings.imap_sender_list and not any(s in sender for s in settings.imap_sender_list):
                continue
            subject = _header(msg.get("Subject"))
            text = f"{subject} {_body(msg)}"
            message_id = _header(msg.get("Message-ID")) or f"uid:{uid}"
            try:
                amount = payments.extract_amount(text)
            except ValueError:
                continue
            try:
                sent_at = parsedate_to_datetime(msg.get("Date"))
                if sent_at and (utcnow() - sent_at.astimezone(utcnow().tzinfo)).total_seconds() > 3600 * 6:
                    continue
            except Exception:
                pass
            with transaction() as db:
                event, created = payments.ingest_event(db, source="mail", amount=amount, raw_text=text[:2000], external_id=message_id[:160], event_key=f"mail:{message_id}"[:96])
                event_id = event.id
            if created:
                payments.process_event(event_id)
                handled += 1
            _LAST_UID[key] = max(_LAST_UID.get(key, 0), uid)
        if fresh:
            _LAST_UID[key] = max(_LAST_UID.get(key, 0), max(fresh))
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return handled
