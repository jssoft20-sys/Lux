"""Bank statement import: read a statement file (PDF / CSV / XML / text), pull out the
incoming payments and auto-credit the matching deposits — a fallback for when the MacroDroid
webhook did not deliver.

Two safety checks decide a credit, so money never lands on the wrong request:
  1. the row amount equals a pending request's amount to the tiyin, and
  2. the row's own date/time falls inside that request's window (it cannot belong to a request
     that did not exist yet, or to one whose window it missed).
Only when exactly one request matches both is it credited. Outgoing rows (the desk's own
payouts) are ignored, re-uploading the same statement never double-credits (each row is stored
once under a stable key), and an already-successful request is never touched.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import transaction
from ..models import Deposit
from ..utils import money, stable_hash
from .deposits import credit_deposit
from .logs import log_event
from .payments import _payment_in_window, ingest_event

logger = logging.getLogger("paygo.statements")

_AMOUNT = re.compile(r"(-?\d[\d\s ]*,\d{2}|-?\d[\d\s ]*\.\d{2}|-?\d+)")
_DATE_TIME = re.compile(r"(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})")
_DATE_ONLY = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4})")


def parse_amount(raw: str) -> Decimal | None:
    s = str(raw or "").replace(" ", "").replace(" ", "").replace(" ", "").strip()
    if not s:
        return None
    neg = s.startswith("-")
    s = s.lstrip("+-").replace(",", ".")
    if s.count(".") > 1:  # thousands dots without decimals
        s = s.replace(".", "")
    try:
        value = money(Decimal(s))
    except Exception:
        return None
    return -value if neg else value


@dataclass
class StatementRow:
    dt: datetime | None
    amount: Decimal        # signed: >0 incoming (deposit), <0 outgoing (our payout)
    details: str = ""
    raw: str = ""

    @property
    def incoming(self) -> bool:
        return self.amount > 0

    @property
    def hash(self) -> str:
        stamp = self.dt.strftime("%Y-%m-%d %H:%M") if self.dt else ""
        return stable_hash({"dt": stamp, "amount": str(self.amount), "d": re.sub(r"\s+", " ", self.details)[:80]})[:40]


# --------------------------------------------------------------------------- parsing

def _parse_dt(date: str, time: str = "") -> datetime | None:
    date = date.replace("/", ".").replace(".", "-") if "-" not in date else date
    for fmt in ("%Y-%m-%d %H:%M", "%d-%m-%Y %H:%M", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(f"{date} {time}".strip(), fmt)
        except ValueError:
            continue
    return None


def parse_text_rows(text: str) -> list[StatementRow]:
    """Parse the Optima-style statement text (one block per transaction) and any similar layout."""
    rows: list[StatementRow] = []
    # each transaction block starts with «YYYY-MM-DD  HH:MM»
    blocks = re.split(r"(?=\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})", text)
    for block in blocks:
        m_dt = _DATE_TIME.search(block)
        if not m_dt:
            continue
        dt = _parse_dt(m_dt.group(1), m_dt.group(2))
        # the transaction amount is the signed number that sits right before «KGS»
        m_amt = re.search(r"(-?\d[\d\s ]*(?:[.,]\d{2})?)\s*\n?\s*KGS", block)
        amount = parse_amount(m_amt.group(1)) if m_amt else None
        if amount is None:
            continue
        details = re.sub(r"\s+", " ", block[m_dt.end():(m_amt.start() if m_amt else len(block))]).strip()
        rows.append(StatementRow(dt=dt, amount=amount, details=details[:300], raw=block[:400]))
    return rows


def parse_csv_rows(text: str) -> list[StatementRow]:
    rows: list[StatementRow] = []
    try:
        dialect = csv.Sniffer().sniff(text[:2000], delimiters=",;\t")
    except Exception:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    for cells in reader:
        joined = " ".join(cells)
        m_dt = _DATE_TIME.search(joined) or _DATE_ONLY.search(joined)
        time = ""
        m_time = re.search(r"\b(\d{1,2}:\d{2})\b", joined)
        if m_time:
            time = m_time.group(1)
        amount = None
        for cell in cells:
            amount = parse_amount(cell)
            if amount is not None and re.search(r"[.,]\d{2}", cell):
                break
            amount = None
        if amount is None or m_dt is None:
            continue
        dt = _parse_dt(m_dt.group(1), time)
        rows.append(StatementRow(dt=dt, amount=amount, details=joined[:300], raw=joined[:400]))
    return rows


def parse_statement(filename: str, data: bytes) -> list[StatementRow]:
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:4] == b"%PDF":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception as exc:
            raise ValueError(f"Не удалось прочитать PDF: {exc}") from exc
        return parse_text_rows(text)
    text = data.decode("utf-8", "ignore")
    if name.endswith(".csv") or ("," in text and "\n" in text and not text.lstrip().startswith("<")):
        rows = parse_csv_rows(text)
        if rows:
            return rows
    if name.endswith(".xml") or text.lstrip().startswith("<"):
        text = re.sub(r"<[^>]+>", " ", text)  # flatten XML, then use the generic text parser
    return parse_text_rows(text) or parse_csv_rows(text)


# --------------------------------------------------------------------------- matching + import

def _match_row(db: Session, amount: Decimal, dt: datetime | None) -> tuple[Deposit | None, list[Deposit]]:
    """Exactly one pending request with this exact amount whose window contains the row time."""
    candidates = [
        d for d in db.execute(
            select(Deposit).where(Deposit.pay_amount == amount, Deposit.status.in_(("created", "processing", "expired", "failed")))
        ).scalars().all()
        if _payment_in_window(db, d, dt)
    ]
    if len(candidates) == 1:
        return candidates[0], candidates
    return None, candidates


def import_statement(filename: str, data: bytes, *, auto_credit: bool = True, actor: str = "") -> dict[str, Any]:
    """Parse a statement and auto-credit the deposits it confirms. Returns a report."""
    rows = parse_statement(filename, data)
    report: dict[str, Any] = {
        "rows": len(rows), "incoming": 0, "outgoing": 0, "credited": [], "review": [],
        "unmatched": [], "duplicates": 0, "auto_credit": auto_credit,
    }
    to_credit: list[tuple[int, int, str]] = []  # (deposit_id, event_id, public_id)
    with transaction() as db:
        for row in rows:
            if not row.incoming:
                report["outgoing"] += 1
                continue
            report["incoming"] += 1
            event, created = ingest_event(db, source="statement", amount=row.amount, raw_text=row.details, event_key=f"statement:{row.hash}")
            if not created:
                report["duplicates"] += 1
                continue
            if row.dt is not None:
                event.received_at = row.dt
            match, candidates = _match_row(db, row.amount, row.dt)
            info = {"amount": str(row.amount), "dt": row.dt.strftime("%Y-%m-%d %H:%M") if row.dt else "", "details": row.details[:80]}
            if match is None:
                event.status = "unmatched"
                event.error = "ambiguous" if len(candidates) > 1 else "transaction_not_found"
                (report["review"] if len(candidates) > 1 else report["unmatched"]).append(info)
                continue
            event.status = "processing"
            event.deposit_id = match.id
            db.flush()
            to_credit.append((match.id, event.id, match.public_id))
        log_event(db, "Импорт выписки", f"{filename} • строк {len(rows)} • поступлений {report['incoming']} • к зачислению {len(to_credit)}", category="payments")
    if auto_credit:
        for deposit_id, event_id, public_id in to_credit:
            result = credit_deposit(deposit_id, source="statement", event_id=event_id, actor=actor or "statement")
            report["credited"].append({"request_id": public_id, "ok": bool(result.get("ok")), "message": result.get("message", "")})
    else:
        report["review"].extend({"request_id": p, "amount": None} for _, _, p in to_credit)
    return report
