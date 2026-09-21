import sqlite3
import time

from bot.storage.db import Database


def test_mode_filters_keep_paper_and_live_apart(tmp_path):
    db = Database(str(tmp_path / "t.db"))
    now = time.time()
    db.add_trade(ts=now - 10, mode="paper", symbol="ADAUSDT", side="SELL", qty=1, price=1, quote_qty=10, pnl=-0.5, pnl_pct=-5)
    db.add_trade(ts=now - 5, mode="live", symbol="ADAUSDT", side="SELL", qty=1, price=1, quote_qty=10, pnl=0.3, pnl_pct=3)
    db.add_equity(now - 10, 50.0, 50.0, 0.0, 0.0, mode="paper")
    db.add_equity(now - 5, 22.5, 22.5, 0.0, 0.0, mode="live")
    assert db.trade_stats(mode="live")["pnl"] == 0.3
    assert db.trade_stats(mode="paper")["pnl"] == -0.5
    assert [t["mode"] for t in db.trades(mode="live")] == ["live"]
    assert [r["equity"] for r in db.equity(mode="live")] == [22.5]
    assert len(db.equity()) == 2


def test_legacy_equity_rows_are_migrated(tmp_path):
    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE equity (ts REAL PRIMARY KEY, equity REAL NOT NULL, quote_balance REAL NOT NULL, unrealized REAL NOT NULL, realized_today REAL NOT NULL)")
    conn.execute("INSERT INTO equity VALUES (1.0, 50.0, 50.0, 0.0, 0.0)")
    conn.commit()
    conn.close()
    db = Database(path)
    rows = db.equity()
    assert rows[0]["mode"] == "paper"
    assert db.equity(mode="live") == []
