"""SQLite persistence: trades, open positions (for restart recovery), news, equity curve, events."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    mode TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    price REAL NOT NULL,
    quote_qty REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    pnl REAL,
    pnl_pct REAL,
    reason TEXT,
    order_id TEXT,
    signal REAL
);
CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts);

CREATE TABLE IF NOT EXISTS positions (
    symbol TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    ts REAL NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    tickers TEXT,
    score REAL,
    importance REAL,
    llm_score REAL,
    llm_reason TEXT,
    market_wide INTEGER DEFAULT 0,
    summary TEXT,
    source_weight REAL DEFAULT 0.8,
    llm_confidence REAL,
    llm_impact TEXT
);
CREATE INDEX IF NOT EXISTS news_ts ON news(ts);

CREATE TABLE IF NOT EXISTS equity (
    ts REAL PRIMARY KEY,
    equity REAL NOT NULL,
    quote_balance REAL NOT NULL,
    unrealized REAL NOT NULL,
    realized_today REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Add columns introduced after the first release to databases created earlier."""
        have = {r[1] for r in self._conn.execute("PRAGMA table_info(news)").fetchall()}
        for col, decl in (("summary", "TEXT"), ("source_weight", "REAL DEFAULT 0.8"), ("llm_confidence", "REAL"), ("llm_impact", "TEXT")):
            if col not in have:
                self._conn.execute(f"ALTER TABLE news ADD COLUMN {col} {decl}")

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _rows(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        with self._lock:
            cur = self._conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def _exec(self, sql: str, params: tuple = ()) -> None:
        with self._lock:
            self._conn.execute(sql, params)

    # ---- trades ----
    def add_trade(self, **t: Any) -> None:
        self._exec(
            "INSERT INTO trades (ts, mode, symbol, side, qty, price, quote_qty, fee, pnl, pnl_pct, reason, order_id, signal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                t.get("ts", time.time()), t["mode"], t["symbol"], t["side"], t["qty"], t["price"], t["quote_qty"], t.get("fee", 0.0),
                t.get("pnl"), t.get("pnl_pct"), t.get("reason"), t.get("order_id"), t.get("signal"),
            ),
        )

    def trades(self, limit: int = 200, since: float | None = None) -> list[dict[str, Any]]:
        if since is not None:
            return self._rows("SELECT * FROM trades WHERE ts >= ? ORDER BY ts DESC LIMIT ?", (since, limit))
        return self._rows("SELECT * FROM trades ORDER BY ts DESC LIMIT ?", (limit,))

    def trade_stats(self, since: float | None = None) -> dict[str, Any]:
        where = "WHERE side='SELL' AND pnl IS NOT NULL" + (" AND ts >= ?" if since is not None else "")
        params: tuple = (since,) if since is not None else ()
        rows = self._rows(
            f"SELECT COUNT(*) AS n, COALESCE(SUM(pnl),0) AS pnl, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) AS wins, "
            f"COALESCE(SUM(CASE WHEN pnl>0 THEN pnl ELSE 0 END),0) AS gross_win, COALESCE(SUM(CASE WHEN pnl<0 THEN pnl ELSE 0 END),0) AS gross_loss, "
            f"COALESCE(SUM(fee),0) AS fees FROM trades {where}",
            params,
        )
        r = rows[0] if rows else {}
        n = int(r.get("n") or 0)
        return {
            "closed": n,
            "pnl": float(r.get("pnl") or 0.0),
            "wins": int(r.get("wins") or 0),
            "win_rate": (int(r.get("wins") or 0) / n) if n else 0.0,
            "gross_win": float(r.get("gross_win") or 0.0),
            "gross_loss": float(r.get("gross_loss") or 0.0),
            "fees": float(r.get("fees") or 0.0),
        }

    # ---- positions ----
    def save_position(self, symbol: str, data: dict[str, Any]) -> None:
        self._exec("INSERT OR REPLACE INTO positions (symbol, data) VALUES (?, ?)", (symbol, json.dumps(data)))

    def delete_position(self, symbol: str) -> None:
        self._exec("DELETE FROM positions WHERE symbol = ?", (symbol,))

    def load_positions(self) -> dict[str, dict[str, Any]]:
        return {r["symbol"]: json.loads(r["data"]) for r in self._rows("SELECT * FROM positions")}

    # ---- news ----
    def add_news(self, item: dict[str, Any]) -> None:
        self._exec(
            "INSERT OR IGNORE INTO news (id, ts, source, title, url, tickers, score, importance, llm_score, llm_reason, market_wide, summary, source_weight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                item["id"], item["ts"], item["source"], item["title"], item.get("url"), ",".join(item.get("tickers", [])),
                item.get("score"), item.get("importance"), item.get("llm_score"), item.get("llm_reason"), 1 if item.get("market_wide") else 0,
                (item.get("summary") or "")[:400], item.get("source_weight", 0.8),
            ),
        )

    def update_news_llm(self, news_id: str, llm_score: float | None, confidence: float | None, reason: str | None, impact: str | None, tickers: list[str] | None = None) -> None:
        if tickers is not None:
            self._exec("UPDATE news SET llm_score=?, llm_confidence=?, llm_reason=?, llm_impact=?, tickers=? WHERE id=?", (llm_score, confidence, reason, impact, ",".join(tickers), news_id))
        else:
            self._exec("UPDATE news SET llm_score=?, llm_confidence=?, llm_reason=?, llm_impact=? WHERE id=?", (llm_score, confidence, reason, impact, news_id))

    @staticmethod
    def _split_tickers(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for r in rows:
            r["tickers"] = [t for t in (r.get("tickers") or "").split(",") if t]
        return rows

    def news(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._split_tickers(self._rows("SELECT * FROM news ORDER BY ts DESC LIMIT ?", (limit,)))

    def news_since(self, since: float, limit: int = 3000) -> list[dict[str, Any]]:
        """Oldest first — used to rebuild the sentiment book after a restart."""
        rows = self._rows("SELECT * FROM news WHERE ts >= ? ORDER BY ts DESC LIMIT ?", (since, limit))
        rows.reverse()
        return self._split_tickers(rows)

    def news_ids(self, since: float) -> set[str]:
        return {r["id"] for r in self._rows("SELECT id FROM news WHERE ts >= ?", (since,))}

    # ---- equity ----
    def add_equity(self, ts: float, equity: float, quote_balance: float, unrealized: float, realized_today: float) -> None:
        self._exec("INSERT OR REPLACE INTO equity (ts, equity, quote_balance, unrealized, realized_today) VALUES (?,?,?,?,?)", (ts, equity, quote_balance, unrealized, realized_today))

    def equity(self, since: float | None = None, limit: int = 5000) -> list[dict[str, Any]]:
        if since is not None:
            rows = self._rows("SELECT * FROM equity WHERE ts >= ? ORDER BY ts DESC LIMIT ?", (since, limit))
        else:
            rows = self._rows("SELECT * FROM equity ORDER BY ts DESC LIMIT ?", (limit,))
        rows.reverse()
        return rows

    # ---- events ----
    def add_event(self, level: str, message: str, ts: float | None = None) -> None:
        self._exec("INSERT INTO events (ts, level, message) VALUES (?,?,?)", (ts or time.time(), level, message))
        # keep the table bounded
        self._exec("DELETE FROM events WHERE id < (SELECT MAX(id) FROM events) - 2000")

    def events(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._rows("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
