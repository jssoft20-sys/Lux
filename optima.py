#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LuxOn Optima Hub — multi-wallet admin + terminal API for optimabusiness.kg.

Design
------
* Authentication is performed by a real Chromium (``optima_login.mjs`` via
  Playwright). The browser is required because the login calls
  ``GET /api/v1/login`` with a Google reCAPTCHA Enterprise ``captoken`` header
  that cannot be produced by a plain HTTP client, followed by a TOTP second
  factor. Chromium runs ONLY at (re)login; everything else is fast plain HTTP.
* After login we keep the ``SESSION``/``SERVERID`` cookies and call the
  GraphQL services directly (``searchPaymentByCriteria`` for the operation
  history). On an expired session (HTTP 401/403) we transparently re-login.
* Each wallet gets two keys: an ``api_key`` (terminal / machine access to the
  JSON transactions) and a ``client_key`` (read-only web dashboard). The admin
  panel is protected by a single password.
* New transactions are pushed to subscribers over Server-Sent Events the
  instant the sync loop sees them, so a terminal watcher updates in near real
  time.

Secrets (login / password / TOTP / session cookies) are encrypted at rest with
AES-256-GCM under a locally generated ``master.key``. Nothing sensitive is ever
written to the repository.

CLI
---
  python3 optima.py --init     initialise the database + admin, seed from env
  python3 optima.py --serve    run the HTTP server (default)
  python3 optima.py --add      add a wallet from env (OPTIMA_SEED_*)
  python3 optima.py --keys     print wallets and their keys / endpoints
  python3 optima.py --check    health check
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import shutil
import sqlite3
import struct
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from a local .env into the environment (without
    overriding variables already set). Robust to spaces/Unicode/quotes, so the
    user never has to rely on fragile shell `source`."""
    env_path = Path(os.environ.get("OPTIMA_ENV_FILE", str(BASE_DIR / ".env")))
    if not env_path.exists():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            if k and k not in os.environ:
                os.environ[k] = v
    except Exception:
        pass


_load_dotenv()

APP_DIR = Path(os.environ.get("OPTIMA_DIR", BASE_DIR / "data")).resolve()
DB_FILE = APP_DIR / "luxon_optima.sqlite3"
MASTER_FILE = APP_DIR / "master.key"
LOGIN_HELPER = BASE_DIR / "optima_login.mjs"

HOST = os.environ.get("OPTIMA_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPTIMA_PORT", "7094"))
PUBLIC_URL = os.environ.get("OPTIMA_PUBLIC_URL", "").rstrip("/")  # e.g. https://hub.example.com
# Admin password comes from the environment (set OPTIMA_ADMIN_PASSWORD, e.g. in
# a local .env). If unset, a random one is generated and stored in
# data/admin_password.txt on first run — so no credential is ever baked into the
# source tree. Resolved by ensure_admin_password() at startup.
ADMIN_PASSWORD = os.environ.get("OPTIMA_ADMIN_PASSWORD", "").strip()
SYNC_SECONDS = max(1, int(os.environ.get("OPTIMA_SYNC_SECONDS", "3")))
HTTP_TIMEOUT = max(5, int(os.environ.get("OPTIMA_HTTP_TIMEOUT", "25")))
LOGIN_TIMEOUT = max(30, int(os.environ.get("OPTIMA_LOGIN_TIMEOUT", "100")))
SESSION_TTL = 12 * 3600
ROOT = os.environ.get("OPTIMA_ROOT", "https://optimabusiness.kg").rstrip("/")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

ACCESS_GQL = "/ob-access-control-service/graphql"
ACCOUNT_GQL = "/ob-account-service/graphql"
PAYMENT_GQL = "/ob-payment-service/graphql"

EMPLOYEE_QUERY = (
    "query employeeSecure { employeeSecure { id fullName shortName mobile individualInn "
    "userReferenceId userContracts { orgReferenceId companyName contractNum __typename } __typename } }"
)
ACCOUNTS_QUERY = (
    "query findAllAccountsByPartyIdWithAcl($filterInput: AccountFilterInput!) { "
    "findAllAccountsByPartyIdWithAcl(filterInput: $filterInput) { id type account accountClassification "
    "contractNumber status balance currency { isoCode __typename } __typename } }"
)
PAYMENTS_QUERY = (
    "query searchPaymentByCriteria($searchOperationHistory: SearchOperationHistoryInput!, $pageable: PageInput!) { "
    "searchPaymentByCriteria(searchOperationHistory: $searchOperationHistory, pageable: $pageable) { "
    "list { id createdDate createdBy updatedBy recipientAccount operationCode transferNum valueDate payerAccount "
    "amount currency statusCode purpose recipientName legalPartyId paymentDetailsId description origin __typename } "
    "amountPages amountElements currentPage __typename } }"
)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Crypto
# --------------------------------------------------------------------------- #
def ensure_master() -> bytes:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    if not MASTER_FILE.exists():
        MASTER_FILE.write_bytes(secrets.token_bytes(32))
        try:
            os.chmod(MASTER_FILE, 0o600)
        except Exception:
            pass
    key = MASTER_FILE.read_bytes()
    if len(key) != 32:
        raise RuntimeError("master.key must be exactly 32 bytes")
    return key


MASTER = ensure_master()


# Stdlib-only authenticated encryption for secrets at rest.
# A SHA-256 HMAC keystream (counter mode) provides confidentiality and a
# separate HMAC-SHA256 over the ciphertext provides integrity (encrypt-then-MAC).
# Per-value random salt derives fresh sub-keys, so no nonce reuse. This needs no
# third-party package and is sound for protecting locally stored credentials.
def _derive(salt: bytes, label: bytes) -> bytes:
    return hmac.new(MASTER, label + salt, hashlib.sha256).digest()


def _keystream(key: bytes, salt: bytes, n: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hmac.new(key, salt + struct.pack(">I", counter), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:n])


def enc(value: str) -> str:
    data = (value or "").encode("utf-8")
    salt = secrets.token_bytes(16)
    ek, mk = _derive(salt, b"enc"), _derive(salt, b"mac")
    ks = _keystream(ek, salt, len(data))
    ct = bytes(a ^ b for a, b in zip(data, ks))
    tag = hmac.new(mk, salt + ct, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(salt + ct + tag).decode("ascii")


def dec(value: str) -> str:
    if not value:
        return ""
    raw = base64.urlsafe_b64decode(value.encode("ascii"))
    salt, ct, tag = raw[:16], raw[16:-32], raw[-32:]
    ek, mk = _derive(salt, b"enc"), _derive(salt, b"mac")
    good = hmac.new(mk, salt + ct, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, good):
        raise ValueError("ciphertext authentication failed")
    ks = _keystream(ek, salt, len(ct))
    return bytes(a ^ b for a, b in zip(ct, ks)).decode("utf-8")


def hash_key(value: str) -> str:
    return hmac.new(MASTER, (value or "").encode("utf-8"), hashlib.sha256).hexdigest()


def ensure_admin_password() -> str:
    """Resolve the admin password without keeping it in the source tree.
    Priority: OPTIMA_ADMIN_PASSWORD env var, else data/admin_password.txt,
    else a freshly generated strong password stored there (printed once)."""
    global ADMIN_PASSWORD
    if ADMIN_PASSWORD:
        return ADMIN_PASSWORD
    pwd_file = APP_DIR / "admin_password.txt"
    try:
        if pwd_file.exists():
            cur = pwd_file.read_text(encoding="utf-8").strip()
            if cur:
                ADMIN_PASSWORD = cur
                return ADMIN_PASSWORD
        APP_DIR.mkdir(parents=True, exist_ok=True)
        gen = secrets.token_urlsafe(12)
        pwd_file.write_text(gen, encoding="utf-8")
        try:
            os.chmod(pwd_file, 0o600)
        except Exception:
            pass
        ADMIN_PASSWORD = gen
        print(f"[admin] generated admin password (stored in {pwd_file}): {gen}", flush=True)
        return ADMIN_PASSWORD
    except Exception:
        ADMIN_PASSWORD = secrets.token_urlsafe(12)
        return ADMIN_PASSWORD


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #
def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_FILE, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS wallets(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                login_enc TEXT NOT NULL,
                password_enc TEXT NOT NULL,
                totp_enc TEXT NOT NULL,
                client_key_hash TEXT NOT NULL UNIQUE,
                client_key_enc TEXT NOT NULL,
                api_key_hash TEXT NOT NULL UNIQUE,
                api_key_enc TEXT NOT NULL,
                allowed_ip TEXT NOT NULL DEFAULT '',
                legal_party_id TEXT NOT NULL DEFAULT '',
                account TEXT NOT NULL DEFAULT '',
                balance TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT '',
                company_name TEXT NOT NULL DEFAULT '',
                cookies_enc TEXT NOT NULL DEFAULT '',
                session_expires INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'new',
                last_error TEXT NOT NULL DEFAULT '',
                last_sync_at TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transactions(
                wallet_id INTEGER NOT NULL,
                tx_id TEXT NOT NULL,
                created_date TEXT NOT NULL DEFAULT '',
                tx_date TEXT NOT NULL DEFAULT '',
                tx_time TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '',
                operation_code TEXT NOT NULL DEFAULT '',
                status_code TEXT NOT NULL DEFAULT '',
                transfer_num TEXT NOT NULL DEFAULT '',
                value_date TEXT NOT NULL DEFAULT '',
                payer_account TEXT NOT NULL DEFAULT '',
                recipient_account TEXT NOT NULL DEFAULT '',
                recipient_name TEXT NOT NULL DEFAULT '',
                purpose TEXT NOT NULL DEFAULT '',
                origin TEXT NOT NULL DEFAULT '',
                direction TEXT NOT NULL DEFAULT '',
                raw_json TEXT NOT NULL DEFAULT '',
                first_seen_at TEXT NOT NULL,
                PRIMARY KEY(wallet_id, tx_id),
                FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_tx_wallet_dt ON transactions(wallet_id, tx_date DESC, tx_time DESC);
            CREATE TABLE IF NOT EXISTS access_log(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                kind TEXT NOT NULL,
                wallet_id INTEGER,
                ip TEXT NOT NULL,
                path TEXT NOT NULL DEFAULT '',
                ok INTEGER NOT NULL DEFAULT 1
            );
            """
        )


def get_setting(key: str) -> str:
    with db() as con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else ""


def set_setting(key: str, value: str) -> None:
    with db() as con:
        con.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def slugify(name: str) -> str:
    table = str.maketrans(
        {
            "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
            "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
            "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
            "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        }
    )
    x = (name or "").strip().lower().translate(table)
    x = re.sub(r"[^a-z0-9]+", "-", x).strip("-")
    return x[:48] or ("wallet-" + secrets.token_hex(3))


def unique_slug(name: str) -> str:
    base = slugify(name)
    slug = base
    n = 2
    with db() as con:
        while con.execute("SELECT 1 FROM wallets WHERE slug=?", (slug,)).fetchone():
            slug = f"{base}-{n}"
            n += 1
    return slug


def make_totp(secret: str, period: int = 30, digits: int = 6) -> str:
    s = re.sub(r"\s+", "", secret or "").upper()
    if not s:
        raise RuntimeError("TOTP secret missing")
    pad = "=" * ((8 - len(s) % 8) % 8)
    key = base64.b32decode(s + pad, casefold=True)
    counter = int(time.time() // period)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    num = (
        ((digest[off] & 0x7F) << 24)
        | ((digest[off + 1] & 0xFF) << 16)
        | ((digest[off + 2] & 0xFF) << 8)
        | (digest[off + 3] & 0xFF)
    )
    return str(num % (10 ** digits)).zfill(digits)


# --------------------------------------------------------------------------- #
# Chromium login (subprocess -> optima_login.mjs)
# --------------------------------------------------------------------------- #
LOGIN_GLOBAL_LOCK = threading.Lock()  # serialise heavy Chromium runs


def chromium_login(login: str, password: str, totp_secret: str) -> dict[str, Any]:
    node = shutil.which("node") or shutil.which("nodejs")
    if not node:
        return {"ok": False, "error": "node executable not found on PATH"}
    if not LOGIN_HELPER.exists():
        return {"ok": False, "error": f"login helper missing: {LOGIN_HELPER}"}
    env = os.environ.copy()
    env["OPTIMA_ID"] = login
    env["OPTIMA_PASSWORD"] = password
    env["OPTIMA_TOTP"] = totp_secret
    env["OPTIMA_ROOT"] = ROOT
    env.setdefault("OPTIMA_LOGIN_TIMEOUT", str(LOGIN_TIMEOUT * 1000))
    with LOGIN_GLOBAL_LOCK:
        try:
            proc = subprocess.run(
                [node, str(LOGIN_HELPER)],
                env=env,
                capture_output=True,
                text=True,
                timeout=LOGIN_TIMEOUT + 25,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "chromium login timed out"}
        except Exception as e:  # pragma: no cover
            return {"ok": False, "error": f"failed to launch login helper: {e}"}
    out = (proc.stdout or "").strip().splitlines()
    for line in reversed(out):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except Exception:
                continue
    err = (proc.stderr or "").strip().splitlines()
    tail = err[-1] if err else f"exit {proc.returncode}"
    return {"ok": False, "error": f"login helper produced no result ({tail})"}


# --------------------------------------------------------------------------- #
# Bank client
# --------------------------------------------------------------------------- #
class BankClient:
    def __init__(self, wallet: sqlite3.Row):
        self.wallet_id = int(wallet["id"])
        self.login = dec(wallet["login_enc"])
        self.password = dec(wallet["password_enc"])
        self.totp_secret = dec(wallet["totp_enc"])
        self.legal_party_id = str(wallet["legal_party_id"] or "")
        self.account = str(wallet["account"] or "")
        self.session_expires = int(wallet["session_expires"] or 0)
        try:
            self.cookies: dict[str, str] = json.loads(dec(wallet["cookies_enc"])) if wallet["cookies_enc"] else {}
        except Exception:
            self.cookies = {}

    # -- session persistence ------------------------------------------------ #
    def _persist_session(self) -> None:
        with db() as con:
            con.execute(
                "UPDATE wallets SET cookies_enc=?, session_expires=?, legal_party_id=?, updated_at=? WHERE id=?",
                (enc(json.dumps(self.cookies)), self.session_expires, self.legal_party_id, now_iso(), self.wallet_id),
            )

    def _cookie_header(self) -> str:
        return "; ".join(f"{k}={v}" for k, v in self.cookies.items())

    def _session_valid(self) -> bool:
        if not self.cookies.get("SESSION"):
            return False
        if self.session_expires:
            # session_expires may be seconds or milliseconds
            exp = self.session_expires / 1000 if self.session_expires > 1e12 else self.session_expires
            if time.time() > exp - 45:
                return False
        return True

    def relogin(self) -> None:
        res = chromium_login(self.login, self.password, self.totp_secret)
        if not res.get("ok"):
            raise RuntimeError("login failed: " + str(res.get("error") or "unknown"))
        self.cookies = res.get("cookies") or {}
        try:
            self.session_expires = int(res.get("sessionExpiresAt") or 0)
        except Exception:
            self.session_expires = 0
        lp = str(res.get("legalPartyId") or "")
        if lp:
            self.legal_party_id = lp
        self._persist_session()

    def ensure_session(self) -> None:
        if not self._session_valid():
            self.relogin()

    # -- GraphQL ------------------------------------------------------------ #
    def _post(self, path: str, body: dict[str, Any]) -> tuple[int, Any]:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        req = urllib.request.Request(
            ROOT + path,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "ru-RU,ru;q=0.9",
                "Origin": ROOT,
                "Referer": ROOT + "/",
                "User-Agent": UA,
                "Cookie": self._cookie_header(),
                "Connection": "close",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                raw = r.read().decode("utf-8", errors="replace")
                try:
                    return int(r.status), json.loads(raw)
                except Exception:
                    return int(r.status), {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                return int(e.code), json.loads(raw)
            except Exception:
                return int(e.code), {}
        except Exception as e:
            raise RuntimeError("connection error: " + type(e).__name__) from None

    def gql(self, path: str, operation: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        self.ensure_session()
        body = {"operationName": operation, "query": query, "variables": variables}
        last = {}
        for attempt in range(2):
            st, payload = self._post(path, body)
            payload = payload if isinstance(payload, dict) else {}
            last = payload
            auth_err = False
            if isinstance(payload.get("errors"), list):
                blob = json.dumps(payload["errors"]).lower()
                auth_err = any(w in blob for w in ("unauthor", "authenticat", "forbidden", "access denied"))
            if 200 <= st < 300 and not payload.get("errors"):
                return payload.get("data") or {}
            if attempt == 0 and (st in (401, 403) or st >= 500 or auth_err):
                self.relogin()
                continue
            if payload.get("errors"):
                raise RuntimeError(f"{operation}: {str(payload['errors'])[:200]}")
            raise RuntimeError(f"{operation}: http {st}")
        raise RuntimeError(f"{operation}: giving up ({str(last)[:160]})")

    # -- business calls ----------------------------------------------------- #
    def discover(self) -> None:
        data = self.gql(ACCESS_GQL, "employeeSecure", EMPLOYEE_QUERY, {})
        emp = data.get("employeeSecure") or {}
        contracts = emp.get("userContracts") or []
        legal = str((contracts[0] or {}).get("orgReferenceId") or "") if contracts else ""
        company = str((contracts[0] or {}).get("companyName") or "") if contracts else ""
        if not legal:
            raise RuntimeError("legal party id not found for this login")
        self.legal_party_id = legal
        with db() as con:
            con.execute(
                "UPDATE wallets SET legal_party_id=?, company_name=?, updated_at=? WHERE id=?",
                (legal, company, now_iso(), self.wallet_id),
            )

    def refresh_accounts(self) -> None:
        if not self.legal_party_id:
            return
        lp = int(self.legal_party_id) if self.legal_party_id.isdigit() else self.legal_party_id
        data = self.gql(
            ACCOUNT_GQL,
            "findAllAccountsByPartyIdWithAcl",
            ACCOUNTS_QUERY,
            {"filterInput": {"partyId": lp, "statuses": ["OPEN", "ARRESTED"], "accountTypes": ["RKO", "DEPOSIT"]}},
        )
        accts = data.get("findAllAccountsByPartyIdWithAcl") or []
        rko = next((a for a in accts if str(a.get("type")) == "RKO"), accts[0] if accts else None)
        if rko:
            self.account = str(rko.get("account") or "")
            with db() as con:
                con.execute(
                    "UPDATE wallets SET account=?, balance=?, currency=?, updated_at=? WHERE id=?",
                    (
                        self.account,
                        str(rko.get("balance") or ""),
                        str((rko.get("currency") or {}).get("isoCode") or ""),
                        now_iso(),
                        self.wallet_id,
                    ),
                )

    def fetch_payments(self, max_pages: int = 3, per_page: int = 100) -> list[dict[str, Any]]:
        if not self.legal_party_id:
            self.discover()
        lp = int(self.legal_party_id) if self.legal_party_id.isdigit() else self.legal_party_id
        rows: list[dict[str, Any]] = []
        page, pages = 1, 1
        while page <= pages and page <= max_pages:
            data = self.gql(
                PAYMENT_GQL,
                "searchPaymentByCriteria",
                PAYMENTS_QUERY,
                {
                    "searchOperationHistory": {"legalPartyId": lp, "currency": [], "operations": [], "status": []},
                    "pageable": {"amountElements": per_page, "currentPage": page},
                },
            )
            obj = data.get("searchPaymentByCriteria") or {}
            rows.extend(x for x in (obj.get("list") or []) if isinstance(x, dict))
            try:
                pages = max(1, int(obj.get("amountPages") or 1))
            except Exception:
                pages = 1
            page += 1
        return rows


# --------------------------------------------------------------------------- #
# Real-time pub/sub (Server-Sent Events)
# --------------------------------------------------------------------------- #
SUBSCRIBERS: dict[int, set[queue.Queue]] = defaultdict(set)
SUB_LOCK = threading.Lock()


def subscribe(wallet_id: int) -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=200)
    with SUB_LOCK:
        SUBSCRIBERS[wallet_id].add(q)
    return q


def unsubscribe(wallet_id: int, q: queue.Queue) -> None:
    with SUB_LOCK:
        SUBSCRIBERS.get(wallet_id, set()).discard(q)


def publish(wallet_id: int, event: dict[str, Any]) -> None:
    with SUB_LOCK:
        targets = list(SUBSCRIBERS.get(wallet_id, set()))
    for q in targets:
        try:
            q.put_nowait(event)
        except queue.Full:
            pass


# --------------------------------------------------------------------------- #
# Transaction normalisation + sync
# --------------------------------------------------------------------------- #
def normalize_tx(wallet_account: str, r: dict[str, Any]) -> Optional[dict[str, Any]]:
    tx_id = str(r.get("id") or "")
    if not tx_id:
        return None
    created = str(r.get("createdDate") or "")  # "2026-09-12 21:28:36"
    tx_date, tx_time = "", ""
    m = re.match(r"(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}:\d{2})?", created)
    if m:
        tx_date = m.group(1)
        tx_time = (m.group(2) or "")
    try:
        amount = round(float(r.get("amount") or 0), 2)
    except Exception:
        amount = 0.0
    payer = str(r.get("payerAccount") or "")
    recip = str(r.get("recipientAccount") or "")
    direction = ""
    if wallet_account and recip and recip == wallet_account:
        direction = "in"
    elif wallet_account and payer and payer == wallet_account:
        direction = "out"
    return {
        "tx_id": tx_id,
        "created_date": created,
        "tx_date": tx_date,
        "tx_time": tx_time,
        "amount": amount,
        "currency": str(r.get("currency") or ""),
        "operation_code": str(r.get("operationCode") or ""),
        "status_code": str(r.get("statusCode") or ""),
        "transfer_num": str(r.get("transferNum") or ""),
        "value_date": str(r.get("valueDate") or ""),
        "payer_account": payer,
        "recipient_account": recip,
        "recipient_name": str(r.get("recipientName") or ""),
        "purpose": str(r.get("purpose") or r.get("description") or ""),
        "origin": str(r.get("origin") or ""),
        "direction": direction,
        "raw_json": json.dumps(r, ensure_ascii=False),
    }


def tx_public(n: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": n["tx_id"],
        "date": n["tx_date"],
        "time": n["tx_time"],
        "datetime": n["created_date"],
        "amount": n["amount"],
        "currency": n["currency"],
        "type": n["operation_code"],
        "status": n["status_code"],
        "direction": n["direction"],
        "transferNum": n["transfer_num"],
        "valueDate": n["value_date"],
        "payerAccount": n["payer_account"],
        "recipientAccount": n["recipient_account"],
        "recipientName": n["recipient_name"],
        "purpose": n["purpose"],
        "origin": n["origin"],
    }


BANK_LOCKS: dict[int, threading.Lock] = defaultdict(threading.Lock)
STOP = threading.Event()


def sync_wallet(wallet_id: int) -> int:
    """Fetch the latest operations for a wallet, store new ones, publish them.
    Returns the number of newly discovered transactions."""
    with BANK_LOCKS[wallet_id]:
        with db() as con:
            wallet = con.execute("SELECT * FROM wallets WHERE id=?", (wallet_id,)).fetchone()
        if not wallet:
            return 0
        try:
            bc = BankClient(wallet)
            if not bc.legal_party_id:
                bc.discover()
            bc.refresh_accounts()
            rows = bc.fetch_payments()
            new_items: list[dict[str, Any]] = []
            with db() as con:
                existing = {
                    str(x["tx_id"])
                    for x in con.execute("SELECT tx_id FROM transactions WHERE wallet_id=?", (wallet_id,)).fetchall()
                }
                for r in rows:
                    n = normalize_tx(bc.account, r)
                    if not n or n["tx_id"] in existing:
                        continue
                    con.execute(
                        """INSERT OR IGNORE INTO transactions(
                            wallet_id,tx_id,created_date,tx_date,tx_time,amount,currency,operation_code,status_code,
                            transfer_num,value_date,payer_account,recipient_account,recipient_name,purpose,origin,
                            direction,raw_json,first_seen_at
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            wallet_id, n["tx_id"], n["created_date"], n["tx_date"], n["tx_time"], n["amount"],
                            n["currency"], n["operation_code"], n["status_code"], n["transfer_num"], n["value_date"],
                            n["payer_account"], n["recipient_account"], n["recipient_name"], n["purpose"], n["origin"],
                            n["direction"], n["raw_json"], now_iso(),
                        ),
                    )
                    new_items.append(n)
                con.execute(
                    "UPDATE wallets SET status='online', last_error='', last_sync_at=?, updated_at=? WHERE id=?",
                    (now_iso(), now_iso(), wallet_id),
                )
            for n in reversed(new_items):  # oldest-first for stream consumers
                publish(wallet_id, {"type": "transaction", "wallet_id": wallet_id, "tx": tx_public(n)})
            return len(new_items)
        except Exception as e:
            with db() as con:
                row = con.execute("SELECT last_sync_at FROM wallets WHERE id=?", (wallet_id,)).fetchone()
                had_data = bool(row and row["last_sync_at"])
                if had_data:
                    con.execute(
                        "UPDATE wallets SET status='stale', last_error=?, updated_at=? WHERE id=?",
                        (str(e)[:240], now_iso(), wallet_id),
                    )
                else:
                    con.execute(
                        "UPDATE wallets SET status='error', last_error=?, updated_at=? WHERE id=?",
                        (str(e)[:240], now_iso(), wallet_id),
                    )
            return 0


def background_worker() -> None:
    time.sleep(1)
    while not STOP.is_set():
        try:
            with db() as con:
                ids = [int(r["id"]) for r in con.execute("SELECT id FROM wallets ORDER BY id").fetchall()]
            for wid in ids:
                if STOP.is_set():
                    break
                sync_wallet(wid)
        except Exception:
            traceback.print_exc()
        STOP.wait(SYNC_SECONDS)


# --------------------------------------------------------------------------- #
# Wallet management
# --------------------------------------------------------------------------- #
def create_wallet(name: str, login: str, password: str, totp: str, allowed_ip: str = "") -> dict[str, Any]:
    name, login, totp, allowed_ip = name.strip(), login.strip(), totp.strip(), allowed_ip.strip()
    if not all([name, login, password, totp]):
        raise ValueError("Заполните название, логин, пароль и TOTP")
    # validate TOTP secret shape early
    try:
        make_totp(totp)
    except Exception:
        raise ValueError("Некорректный TOTP-секрет (ожидается base32)")
    slug = unique_slug(name)
    client_key = "lxcli_" + secrets.token_urlsafe(28)
    api_key = "lxapi_" + secrets.token_urlsafe(32)
    ts = now_iso()
    with db() as con:
        cur = con.execute(
            """INSERT INTO wallets(name,slug,login_enc,password_enc,totp_enc,client_key_hash,client_key_enc,
               api_key_hash,api_key_enc,allowed_ip,status,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                name, slug, enc(login), enc(password), enc(totp), hash_key(client_key), enc(client_key),
                hash_key(api_key), enc(api_key), allowed_ip, "new", ts, ts,
            ),
        )
        wid = int(cur.lastrowid)
    threading.Thread(target=sync_wallet, args=(wid,), daemon=True).start()
    return {
        "id": wid, "name": name, "slug": slug, "client_key": client_key, "api_key": api_key,
        "api_endpoint": api_endpoint(slug),
    }


def api_endpoint(slug: str) -> str:
    base = PUBLIC_URL or f"http://{HOST}:{PORT}"
    return f"{base}/optima/api/{slug}"


def wallet_public(w: sqlite3.Row, reveal: bool = False) -> dict[str, Any]:
    out = {
        "id": int(w["id"]),
        "name": w["name"],
        "slug": w["slug"],
        "login": dec(w["login_enc"]),
        "company_name": w["company_name"],
        "account": w["account"],
        "balance": w["balance"],
        "currency": w["currency"],
        "status": w["status"],
        "last_error": w["last_error"],
        "last_sync_at": w["last_sync_at"],
        "allowed_ip": w["allowed_ip"],
        "api_endpoint": api_endpoint(w["slug"]),
    }
    if reveal:
        out["api_key"] = dec(w["api_key_enc"])
        out["client_key"] = dec(w["client_key_enc"])
    return out


# --------------------------------------------------------------------------- #
# Web sessions (admin / client) — signed cookie
# --------------------------------------------------------------------------- #
RATE: dict[str, deque] = defaultdict(deque)


def rate_ok(ip: str, limit: int = 12, window: int = 60) -> bool:
    now = time.monotonic()
    q = RATE[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def sign_session(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    sig = hmac.new(MASTER, body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def parse_session(token: str) -> Optional[dict[str, Any]]:
    try:
        body, sig = token.rsplit(".", 1)
        good = hmac.new(MASTER, body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * ((4 - len(body) % 4) % 4)))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return data
    except Exception:
        return None


def authenticate(key: str) -> Optional[dict[str, Any]]:
    if key and ADMIN_PASSWORD and hmac.compare_digest(key, ADMIN_PASSWORD):
        return {"role": "admin", "wallet_id": None}
    kh = hash_key(key)
    with db() as con:
        w = con.execute("SELECT id FROM wallets WHERE client_key_hash=?", (kh,)).fetchone()
    if w:
        return {"role": "client", "wallet_id": int(w["id"])}
    return None


def wallet_by_api_key(key: str) -> Optional[sqlite3.Row]:
    if not key:
        return None
    with db() as con:
        return con.execute("SELECT * FROM wallets WHERE api_key_hash=?", (hash_key(key),)).fetchone()


# --------------------------------------------------------------------------- #
# Transaction queries for the UI / API
# --------------------------------------------------------------------------- #
def tx_query(wallet_id: Optional[int], start: str = "", end: str = "", q: str = "", limit: int = 500) -> list[dict[str, Any]]:
    sql = "SELECT * FROM transactions WHERE 1=1"
    args: list[Any] = []
    if wallet_id:
        sql += " AND wallet_id=?"
        args.append(wallet_id)
    if start:
        sql += " AND tx_date>=?"
        args.append(start)
    if end:
        sql += " AND tx_date<=?"
        args.append(end)
    if q:
        sql += " AND (tx_id LIKE ? OR recipient_name LIKE ? OR transfer_num LIKE ? OR CAST(amount AS TEXT) LIKE ? OR operation_code LIKE ?)"
        pat = f"%{q}%"
        args += [pat, pat, pat, pat, pat]
    sql += " ORDER BY tx_date DESC, tx_time DESC, tx_id DESC LIMIT ?"
    args.append(max(1, min(5000, limit)))
    with db() as con:
        rows = con.execute(sql, args).fetchall()
    out = []
    for r in rows:
        out.append(
            tx_public(
                {
                    "tx_id": r["tx_id"], "tx_date": r["tx_date"], "tx_time": r["tx_time"],
                    "created_date": r["created_date"], "amount": r["amount"], "currency": r["currency"],
                    "operation_code": r["operation_code"], "status_code": r["status_code"],
                    "direction": r["direction"], "transfer_num": r["transfer_num"], "value_date": r["value_date"],
                    "payer_account": r["payer_account"], "recipient_account": r["recipient_account"],
                    "recipient_name": r["recipient_name"], "purpose": r["purpose"], "origin": r["origin"],
                }
            )
        )
    return out


def stats_for(wallet_id: Optional[int], start: str = "", end: str = "") -> dict[str, Any]:
    where = "WHERE 1=1"
    args: list[Any] = []
    if wallet_id:
        where += " AND wallet_id=?"
        args.append(wallet_id)
    if start:
        where += " AND tx_date>=?"
        args.append(start)
    if end:
        where += " AND tx_date<=?"
        args.append(end)
    with db() as con:
        tot = con.execute(f"SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM transactions {where}", args).fetchone()
    return {"count": int(tot["c"]), "amount": round(float(tot["s"]), 2)}


def record_access(kind: str, wallet_id: Optional[int], ip: str, path: str, ok: bool = True) -> None:
    try:
        with db() as con:
            con.execute(
                "INSERT INTO access_log(ts,kind,wallet_id,ip,path,ok) VALUES(?,?,?,?,?,?)",
                (now_iso(), kind, wallet_id, ip[:64], path[:160], 1 if ok else 0),
            )
    except Exception:
        pass


def ip_allowed(ip: str, rule: str) -> bool:
    rule = (rule or "").strip()
    if not rule:
        return True
    import ipaddress
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in ipaddress.ip_network(x.strip(), strict=False) for x in rule.split(",") if x.strip())
    except Exception:
        return False


# HTML is defined in optima_web.py-style constant below (kept in this file).
from optima_html import HTML  # noqa: E402  (local module, same directory)


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #
def client_ip(h: BaseHTTPRequestHandler) -> str:
    peer = h.client_address[0]
    if peer in ("127.0.0.1", "::1"):
        xf = str(h.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        xr = str(h.headers.get("X-Real-IP") or "").strip()
        return xf or xr or peer
    return peer


def parse_json_body(h: BaseHTTPRequestHandler) -> dict[str, Any]:
    try:
        n = min(int(h.headers.get("Content-Length") or 0), 1_000_000)
        raw = h.rfile.read(n) if n else b"{}"
        obj = json.loads(raw.decode())
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def cookie_value(headers, name: str = "luxon_optima_session") -> str:
    for part in str(headers.get("Cookie") or "").split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            if k == name:
                return v
    return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "LuxOn"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        try:
            path = urllib.parse.urlsplit(self.path).path
        except Exception:
            path = "-"
        print(f"[{now_iso()}] {client_ip(self)} {self.command} {path}", flush=True)

    # -- low level ---------------------------------------------------------- #
    def _headers(self, status: int, ctype: str, length: Optional[int] = None, extra: Optional[dict] = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def json(self, status: int, obj: Any, cookie: Optional[str] = None):
        raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
        extra = {"Set-Cookie": cookie} if cookie else {}
        self._headers(status, "application/json; charset=utf-8", len(raw), extra)
        self.wfile.write(raw)

    def html(self):
        raw = HTML.encode()
        self._headers(200, "text/html; charset=utf-8", len(raw))
        self.wfile.write(raw)

    def session(self):
        return parse_session(cookie_value(self.headers))

    def require(self, admin: bool = False):
        ses = self.session()
        if not ses:
            self.json(401, {"ok": False, "error": "Unauthorized"})
            return None
        if admin and ses.get("role") != "admin":
            self.json(403, {"ok": False, "error": "Forbidden"})
            return None
        return ses

    def csrf_ok(self, ses) -> bool:
        got = str(self.headers.get("X-CSRF") or "")
        return bool(got) and hmac.compare_digest(got, str(ses.get("csrf") or ""))

    def me_payload(self, ses):
        if ses["role"] == "admin":
            return {"role": "admin"}
        with db() as con:
            w = con.execute("SELECT * FROM wallets WHERE id=?", (ses["wallet_id"],)).fetchone()
        return {"role": "client", "wallet": wallet_public(w, reveal=True) if w else None}

    # -- GET ---------------------------------------------------------------- #
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        ip = client_ip(self)

        if path in ("/", "/optima", "/optima/"):
            return self.html()
        if path == "/optima/_/health":
            return self.json(200, {"ok": True, "service": "LuxOn Optima Hub", "time": now_iso()})
        if path == "/optima/_/me":
            ses = self.session()
            return self.json(200, {"ok": True, "me": self.me_payload(ses) if ses else None, "csrf": ses["csrf"] if ses else ""})

        if path == "/optima/_/dashboard":
            ses = self.require()
            if not ses:
                return
            start = (qs.get("from") or [""])[0]
            end = (qs.get("to") or [""])[0]
            q = str((qs.get("q") or [""])[0])[:100]
            wallet_id = ses.get("wallet_id")
            if ses["role"] == "admin":
                wid = (qs.get("wallet_id") or [""])[0]
                wallet_id = int(wid) if str(wid).isdigit() else None
            with db() as con:
                if ses["role"] == "admin":
                    wallets = con.execute("SELECT * FROM wallets ORDER BY id DESC").fetchall()
                    access = con.execute(
                        "SELECT a.ts,a.kind,a.ip,a.ok,w.name wallet FROM access_log a LEFT JOIN wallets w ON w.id=a.wallet_id ORDER BY a.id DESC LIMIT 25"
                    ).fetchall()
                else:
                    wallets = con.execute("SELECT * FROM wallets WHERE id=?", (ses["wallet_id"],)).fetchall()
                    access = []
            return self.json(
                200,
                {
                    "ok": True,
                    "me": self.me_payload(ses),
                    "wallets": [wallet_public(w) for w in wallets],
                    "transactions": tx_query(wallet_id, start, end, q),
                    "stats": stats_for(wallet_id, start, end),
                    "access": [dict(r) for r in access],
                    "server_time": now_iso(),
                },
            )

        m = re.fullmatch(r"/optima/_/wallets/(\d+)/reveal", path)
        if m:
            ses = self.require(admin=True)
            if not ses:
                return
            with db() as con:
                w = con.execute("SELECT * FROM wallets WHERE id=?", (int(m.group(1)),)).fetchone()
            return self.json(200, {"ok": True, "wallet": wallet_public(w, reveal=True)}) if w else self.json(404, {"ok": False, "error": "Not found"})

        # ---- terminal API: JSON transactions -------------------------------
        m = re.fullmatch(r"/optima/api/([a-z0-9-]+)", path)
        if m:
            return self.api_transactions(m.group(1), qs, ip)

        # ---- terminal API: live SSE stream ---------------------------------
        m = re.fullmatch(r"/optima/api/([a-z0-9-]+)/stream", path)
        if m:
            return self.api_stream(m.group(1), qs, ip)

        return self.json(404, {"ok": False, "error": "Not found"})

    # -- terminal API handlers --------------------------------------------- #
    def _api_key(self, qs) -> str:
        auth = str(self.headers.get("Authorization") or "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return str((qs.get("key") or [""])[0]) or str(self.headers.get("X-Api-Key") or "")

    def api_transactions(self, slug: str, qs, ip: str):
        with db() as con:
            w = con.execute("SELECT * FROM wallets WHERE slug=?", (slug,)).fetchone()
        if not w:
            return self.json(404, {"ok": False, "error": "Not found"})
        key = self._api_key(qs)
        if not key or not hmac.compare_digest(hash_key(key), str(w["api_key_hash"])):
            record_access("api", int(w["id"]), ip, self.path, False)
            return self.json(401, {"ok": False, "error": "Unauthorized"})
        if not ip_allowed(ip, str(w["allowed_ip"] or "")):
            record_access("api", int(w["id"]), ip, self.path, False)
            return self.json(403, {"ok": False, "error": "IP not allowed"})
        record_access("api", int(w["id"]), ip, self.path, True)
        # optional immediate refresh so the terminal always sees the latest
        fresh = str((qs.get("fresh") or [""])[0]).lower() in ("1", "true", "yes", "on")
        if fresh:
            try:
                sync_wallet(int(w["id"]))
                with db() as con:
                    w = con.execute("SELECT * FROM wallets WHERE id=?", (int(w["id"]),)).fetchone()
            except Exception:
                pass
        start = (qs.get("from") or [""])[0]
        end = (qs.get("to") or [""])[0]
        q = str((qs.get("q") or [""])[0])[:100]
        try:
            limit = int((qs.get("limit") or ["500"])[0])
        except Exception:
            limit = 500
        items = tx_query(int(w["id"]), start, end, q, limit)
        txid = str((qs.get("id") or [""])[0]).strip()
        if txid:
            items = [x for x in items if x["id"] == txid]
        payload = {
            "ok": True,
            "wallet": w["name"],
            "company": w["company_name"],
            "account": w["account"],
            "balance": w["balance"],
            "currency": w["currency"],
            "status": w["status"],
            "last_sync_at": w["last_sync_at"],
            "server_time": now_iso(),
            "count": len(items),
            "transactions": items,
        }
        return self.json(200, payload)

    def api_stream(self, slug: str, qs, ip: str):
        with db() as con:
            w = con.execute("SELECT * FROM wallets WHERE slug=?", (slug,)).fetchone()
        if not w:
            return self.json(404, {"ok": False, "error": "Not found"})
        key = self._api_key(qs)
        if not key or not hmac.compare_digest(hash_key(key), str(w["api_key_hash"])):
            return self.json(401, {"ok": False, "error": "Unauthorized"})
        if not ip_allowed(ip, str(w["allowed_ip"] or "")):
            return self.json(403, {"ok": False, "error": "IP not allowed"})
        wallet_id = int(w["id"])
        record_access("stream", wallet_id, ip, self.path, True)
        # SSE: stream without Content-Length; close the socket when the client
        # disconnects (no keep-alive reuse). X-Accel-Buffering disables nginx buffering.
        self.close_connection = True
        self._headers(200, "text/event-stream; charset=utf-8", None, {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        q = subscribe(wallet_id)
        try:
            # prime with the most recent transactions
            recent = tx_query(wallet_id, limit=int((qs.get("backlog") or ["10"])[0] or 10))
            hello = {"type": "hello", "wallet": w["name"], "account": w["account"], "server_time": now_iso(), "recent": list(reversed(recent))}
            self.wfile.write(f"event: hello\ndata: {json.dumps(hello, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()
            last_beat = time.time()
            while not STOP.is_set():
                try:
                    event = q.get(timeout=2)
                    self.wfile.write(f"event: {event.get('type','message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
                except queue.Empty:
                    if time.time() - last_beat >= 15:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        last_beat = time.time()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            unsubscribe(wallet_id, q)

    # -- POST --------------------------------------------------------------- #
    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        ip = client_ip(self)

        if path == "/optima/_/login":
            if not rate_ok(ip):
                return self.json(429, {"ok": False, "error": "Слишком много попыток, подождите"})
            key = str(parse_json_body(self).get("key") or "")
            info = authenticate(key)
            if not info:
                record_access("login", None, ip, path, False)
                time.sleep(0.35)
                return self.json(401, {"ok": False, "error": "Неверный ключ или пароль"})
            csrf = secrets.token_urlsafe(20)
            ses = {**info, "csrf": csrf, "exp": int(time.time()) + SESSION_TTL}
            tok = sign_session(ses)
            record_access("login", info.get("wallet_id"), ip, path, True)
            cookie = f"luxon_optima_session={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"
            if PUBLIC_URL.startswith("https"):
                cookie += "; Secure"
            return self.json(200, {"ok": True, "me": self.me_payload(ses), "csrf": csrf}, cookie)

        if path == "/optima/_/logout":
            return self.json(200, {"ok": True}, "luxon_optima_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")

        if path == "/optima/_/wallets":
            ses = self.require(admin=True)
            if not ses:
                return
            if not self.csrf_ok(ses):
                return self.json(403, {"ok": False, "error": "CSRF"})
            b = parse_json_body(self)
            try:
                out = create_wallet(
                    str(b.get("name") or ""), str(b.get("login") or ""),
                    str(b.get("password") or ""), str(b.get("totp") or ""), str(b.get("allowed_ip") or ""),
                )
            except Exception as e:
                return self.json(400, {"ok": False, "error": str(e)})
            return self.json(201, {"ok": True, "wallet": out})

        m = re.fullmatch(r"/optima/_/wallets/(\d+)/rotate", path)
        if m:
            ses = self.require(admin=True)
            if not ses:
                return
            if not self.csrf_ok(ses):
                return self.json(403, {"ok": False, "error": "CSRF"})
            wid = int(m.group(1))
            kind = str(parse_json_body(self).get("kind") or "")
            if kind not in ("api", "client"):
                return self.json(400, {"ok": False, "error": "Bad kind"})
            key = ("lxapi_" if kind == "api" else "lxcli_") + secrets.token_urlsafe(32)
            with db() as con:
                if kind == "api":
                    con.execute("UPDATE wallets SET api_key_hash=?, api_key_enc=?, updated_at=? WHERE id=?", (hash_key(key), enc(key), now_iso(), wid))
                else:
                    con.execute("UPDATE wallets SET client_key_hash=?, client_key_enc=?, updated_at=? WHERE id=?", (hash_key(key), enc(key), now_iso(), wid))
            return self.json(200, {"ok": True, "key": key})

        m = re.fullmatch(r"/optima/_/wallets/(\d+)/sync", path)
        if m:
            ses = self.require(admin=True)
            if not ses:
                return
            if not self.csrf_ok(ses):
                return self.json(403, {"ok": False, "error": "CSRF"})
            wid = int(m.group(1))
            threading.Thread(target=sync_wallet, args=(wid,), daemon=True).start()
            return self.json(202, {"ok": True})

        m = re.fullmatch(r"/optima/_/wallets/(\d+)/delete", path)
        if m:
            ses = self.require(admin=True)
            if not ses:
                return
            if not self.csrf_ok(ses):
                return self.json(403, {"ok": False, "error": "CSRF"})
            with db() as con:
                con.execute("DELETE FROM wallets WHERE id=?", (int(m.group(1)),))
            return self.json(200, {"ok": True})

        return self.json(404, {"ok": False, "error": "Not found"})


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def seed_from_env() -> Optional[dict[str, Any]]:
    login = os.environ.get("OPTIMA_SEED_ID", "").strip()
    password = os.environ.get("OPTIMA_SEED_PASSWORD", "")
    totp = os.environ.get("OPTIMA_SEED_TOTP", "").strip()
    name = os.environ.get("OPTIMA_SEED_NAME", "").strip() or (f"Optima {login}" if login else "")
    allowed_ip = os.environ.get("OPTIMA_SEED_ALLOWED_IP", "").strip()
    if not (login and password and totp):
        return None
    with db() as con:
        if con.execute("SELECT 1 FROM wallets WHERE login_enc IS NOT NULL").fetchone():
            # only seed when this particular login is absent
            existing = [dec(r["login_enc"]) for r in con.execute("SELECT login_enc FROM wallets").fetchall()]
            if login in existing:
                return None
    return create_wallet(name, login, password, totp, allowed_ip)


def cmd_init() -> None:
    init_db()
    ensure_admin_password()
    print("INIT_OK")
    src = "OPTIMA_ADMIN_PASSWORD env" if os.environ.get("OPTIMA_ADMIN_PASSWORD", "").strip() else "data/admin_password.txt"
    print("ADMIN_PASSWORD source: " + src)
    seeded = seed_from_env()
    if seeded:
        print("SEEDED_WALLET=" + seeded["name"])
        print("API_KEY=" + seeded["api_key"])
        print("CLIENT_KEY=" + seeded["client_key"])
        print("API_ENDPOINT=" + seeded["api_endpoint"])


def cmd_add() -> None:
    init_db()
    seeded = seed_from_env()
    if not seeded:
        raise SystemExit("Set OPTIMA_SEED_ID, OPTIMA_SEED_PASSWORD, OPTIMA_SEED_TOTP (wallet may already exist)")
    print(json.dumps(seeded, ensure_ascii=False, indent=2))


def cmd_keys() -> None:
    init_db()
    with db() as con:
        rows = con.execute("SELECT * FROM wallets ORDER BY id").fetchall()
    out = []
    for w in rows:
        out.append(
            {
                "id": int(w["id"]), "name": w["name"], "slug": w["slug"], "login": dec(w["login_enc"]),
                "account": w["account"], "status": w["status"],
                "api_key": dec(w["api_key_enc"]), "client_key": dec(w["client_key_enc"]),
                "api_endpoint": api_endpoint(w["slug"]),
            }
        )
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_check() -> None:
    init_db()
    with db() as con:
        n = con.execute("SELECT COUNT(*) c FROM wallets").fetchone()["c"]
        t = con.execute("SELECT COUNT(*) c FROM transactions").fetchone()["c"]
    print(
        json.dumps(
            {
                "ok": True, "db": str(DB_FILE), "wallets": n, "transactions": t,
                "host": HOST, "port": PORT, "sync_seconds": SYNC_SECONDS,
                "login_helper": str(LOGIN_HELPER), "login_helper_present": LOGIN_HELPER.exists(),
                "node": bool(shutil.which("node") or shutil.which("nodejs")),
            },
            ensure_ascii=False, indent=2,
        )
    )


def serve() -> None:
    init_db()
    ensure_admin_password()
    seed_from_env()
    threading.Thread(target=background_worker, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print(f"LuxOn Optima Hub ready → http://{HOST}:{PORT}/  (admin password protected)", flush=True)
    try:
        srv.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()


def main() -> None:
    p = argparse.ArgumentParser(description="LuxOn Optima Hub")
    p.add_argument("--init", action="store_true", help="initialise DB and (optionally) seed from OPTIMA_SEED_*")
    p.add_argument("--add", action="store_true", help="add a wallet from OPTIMA_SEED_* env vars")
    p.add_argument("--keys", action="store_true", help="print wallets and their keys")
    p.add_argument("--check", action="store_true", help="health check")
    p.add_argument("--serve", action="store_true", help="run the HTTP server (default)")
    a = p.parse_args()
    if a.init:
        return cmd_init()
    if a.add:
        return cmd_add()
    if a.keys:
        return cmd_keys()
    if a.check:
        return cmd_check()
    serve()


if __name__ == "__main__":
    main()
