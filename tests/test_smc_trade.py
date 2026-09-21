"""Engine management of an SMC trade: risk-based size, TP1 partial, break-even stop, TP2 exit."""

import time

import pytest

from bot.config import Settings
from bot.events import EventBus
from bot.exchange.broker import PaperBroker
from bot.news.book import SentimentBook
from bot.storage.db import Database
from bot.strategy.engine import TradingEngine
from bot.strategy.risk import RiskManager
from bot.strategy.signals import Weights, compute_signal
from bot.strategy.smc import Setup, Zone
from tests.test_trading import _state, rules


@pytest.mark.asyncio
async def test_smc_trade_lifecycle(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="ADAUSDT", strategy="hybrid", paper_start_balance=100, max_position_pct=0.5, position_size_usdt=40,
                   risk_per_trade_pct=1.0, partial_tp_pct=50, min_hold_seconds=0, symbol_cooldown_minutes=0, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules()
    states = {"ADAUSDT": _state(price=0.5)}
    broker = PaperBroker(states, {"ADAUSDT": r}, "USDT", 100, fee_rate=0.001, slippage_bps=0)
    db = Database(str(tmp_path / "t.db"))
    rm = RiskManager(cfg)
    engine = TradingEngine(cfg, broker, states, {"ADAUSDT": r}, SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"}), db, rm, EventBus(db))
    engine.running = True
    engine.last_equity = 100.0
    price = states["ADAUSDT"].ask
    setup = Setup("STB", price, price * 0.99, price * 1.03, price * 1.05, 3.0, Zone("FVG", "bull", price * 0.995, price * 1.001, 10), "тест", "EQH")
    sig = compute_signal(states["ADAUSDT"], {"score": 0.3, "count": 1, "strength": 1, "top": []}, 0.0, Weights())
    # 1 % risk with a 1 % stop -> 100 % of equity, capped by max_position_pct (50 %) -> 50 USDT
    size = rm.size_by_risk(100.0, 100.0, 1.0, r)
    assert size == pytest.approx(50.0)
    await engine._open(sig, size, setup)
    pos = engine.portfolio.positions["ADAUSDT"]
    assert pos.extra["strategy"] == "smc" and pos.extra["rr"] == pytest.approx(3.0, abs=0.2)
    qty0 = pos.qty
    # TP1 reached -> half sold, stop moved to break-even
    states["ADAUSDT"].on_book(price * 1.031, price * 1.0312, 1000, 1000)
    await engine.tick()
    pos = engine.portfolio.positions["ADAUSDT"]
    assert pos.extra["tp1_done"] and pos.extra["be_moved"]
    assert pos.qty == pytest.approx(qty0 / 2, rel=0.02)
    assert pos.stop_loss >= pos.entry_price
    assert engine.portfolio.realized_today > 0
    # TP2 reached -> the rest is closed
    states["ADAUSDT"].on_book(price * 1.051, price * 1.0512, 1000, 1000)
    await engine.tick()
    assert "ADAUSDT" not in engine.portfolio.positions
    reasons = [t["reason"] for t in db.trades()]
    assert "TP2" in reasons and any("TP1" in x for x in reasons)
    assert engine.portfolio.realized_today > 1.0


def test_size_by_risk_halves_after_loss():
    cfg = Settings(risk_per_trade_pct=1.0, risk_reduced_pct=0.5, max_position_pct=1.0, _env_file=None)
    rm = RiskManager(cfg)
    r = rules()
    assert rm.size_by_risk(1000.0, 1000.0, 2.0, r) == pytest.approx(500.0)  # 10 USDT risk / 2 % stop
    rm.record_close("ADAUSDT", -1.0)
    assert rm.after_loss and rm.risk_pct() == 0.5
    assert rm.size_by_risk(1000.0, 1000.0, 2.0, r) == pytest.approx(250.0)
    rm.record_close("ADAUSDT", +1.0)
    assert not rm.after_loss
