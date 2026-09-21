import asyncio
import time
from decimal import Decimal

import pytest

from bot.config import Settings
from bot.events import EventBus
from bot.exchange.binance import MarketState, SymbolRules
from bot.exchange.broker import PaperBroker
from bot.news.book import NewsItem, SentimentBook
from bot.storage.db import Database
from bot.strategy.engine import TradingEngine
from bot.strategy.risk import RiskManager
from bot.strategy.signals import Weights, compute_signal


def rules(symbol="ADAUSDT", base="ADA", step="0.10000000", min_notional="5"):
    return SymbolRules(symbol, base, "USDT", Decimal(step), Decimal(step), Decimal("0.0001"), Decimal(min_notional))


def test_round_qty_floors_to_step():
    r = rules()
    assert r.round_qty(12.3456) == 12.3
    assert r.round_qty(0.05) == 0.0
    assert rules(step="0.00001000").round_qty(0.000123456) == 0.00012
    assert r.fmt_qty(12.3) == "12.3"


def test_position_size_respects_min_notional_and_balance():
    cfg = Settings(position_size_usdt=10, max_position_pct=0.35, _env_file=None)
    rm = RiskManager(cfg)
    assert rm.position_size(50, rules(), 0) == 10.0
    assert rm.position_size(20, rules(), 0) == 7.0
    assert rm.position_size(6, rules(), 0) == 5.25  # below 35% but the exchange minimum still fits
    assert rm.position_size(4, rules(), 0) == 0.0


def test_daily_loss_halts():
    cfg = Settings(daily_loss_limit_usdt=8, _env_file=None)
    rm = RiskManager(cfg)
    assert not rm.check_daily_loss(-7.9)
    assert rm.check_daily_loss(-8.0)
    assert rm.halted


def _state(symbol="ADAUSDT", price=0.5, trend_pct=0.0):
    st = MarketState(symbol)
    now = time.time() * 1000
    for i in range(60):  # 15 min of samples, 15 s apart, linear trend
        ts = now - (60 - i) * 15000
        px = price * (1 + trend_pct / 100 * i / 59)
        st.prices.append((ts, px))
    st.on_book(price * (1 + trend_pct / 100) * 0.9999, price * (1 + trend_pct / 100) * 1.0001, 1000, 1000)
    return st


def test_signal_combines_news_and_momentum():
    w = Weights()
    flat = compute_signal(_state(), {"score": 0.0, "count": 0, "strength": 0, "top": []}, 0.0, w)
    assert abs(flat.composite) < 0.05
    bullish = compute_signal(_state(trend_pct=0.6), {"score": 0.8, "count": 3, "strength": 1, "top": []}, 0.2, w)
    assert bullish.composite > 0.5
    bearish = compute_signal(_state(trend_pct=-0.6), {"score": -0.8, "count": 3, "strength": 1, "top": []}, -0.2, w)
    assert bearish.composite < -0.5


@pytest.mark.asyncio
async def test_paper_round_trip(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="ADAUSDT", position_size_usdt=10, paper_start_balance=50, buy_threshold=0.3, take_profit_pct=1.0, stop_loss_pct=0.8, decision_interval_ms=50, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules()
    states = {"ADAUSDT": _state(trend_pct=0.6)}
    broker = PaperBroker(states, {"ADAUSDT": r}, "USDT", 50, fee_rate=0.001, slippage_bps=0)
    book = SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"})
    now = time.time()
    book.add(NewsItem(id="n1", ts=now, fetched=now, source="t", title="Binance will list ADA perpetual, Cardano surges", summary="", url="", tickers=["ADA"], market_wide=False, score=0.9, importance=1.0, confidence=1.0, source_weight=1.0))
    db = Database(str(tmp_path / "t.db"))
    engine = TradingEngine(cfg, broker, states, {"ADAUSDT": r}, book, db, RiskManager(cfg), EventBus(db))
    engine.running = True
    await engine.tick()
    assert "ADAUSDT" in engine.portfolio.positions, engine.decisions
    pos = engine.portfolio.positions["ADAUSDT"]
    assert abs(pos.quote_spent - 10.0) < 1e-9
    assert (await broker.free_balance("USDT")) == pytest.approx(40.0)
    # price jumps 1.5% -> take profit
    st = states["ADAUSDT"]
    st.on_book(pos.entry_price * 1.015, pos.entry_price * 1.0152, 1000, 1000)
    await engine.tick()
    assert "ADAUSDT" not in engine.portfolio.positions
    trades = db.trades()
    assert [t["side"] for t in trades] == ["SELL", "BUY"]
    assert trades[0]["pnl"] > 0
    assert engine.portfolio.realized_today == pytest.approx(trades[0]["pnl"])
    # cooldown prevents an immediate re-entry
    await engine.tick()
    assert "ADAUSDT" not in engine.portfolio.positions
    assert "пауза" in engine.decisions["ADAUSDT"]


@pytest.mark.asyncio
async def test_stop_loss_and_daily_halt(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="ADAUSDT", position_size_usdt=10, paper_start_balance=50, buy_threshold=0.3, stop_loss_pct=0.8, daily_loss_limit_usdt=0.05, symbol_cooldown_minutes=0, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules()
    states = {"ADAUSDT": _state(trend_pct=0.6)}
    broker = PaperBroker(states, {"ADAUSDT": r}, "USDT", 50, fee_rate=0.001, slippage_bps=0)
    book = SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"})
    now = time.time()
    book.add(NewsItem(id="n1", ts=now, fetched=now, source="t", title="good", summary="", url="", tickers=["ADA"], market_wide=False, score=0.9, importance=1.0, confidence=1.0))
    db = Database(str(tmp_path / "t.db"))
    engine = TradingEngine(cfg, broker, states, {"ADAUSDT": r}, book, db, RiskManager(cfg), EventBus(db))
    engine.running = True
    await engine.tick()
    pos = engine.portfolio.positions["ADAUSDT"]
    states["ADAUSDT"].on_book(pos.entry_price * 0.99, pos.entry_price * 0.9902, 1000, 1000)
    await engine.tick()
    assert "ADAUSDT" not in engine.portfolio.positions
    assert engine.portfolio.realized_today < 0
    assert engine.risk.halted  # loss exceeded the (tiny) daily limit
    await engine.tick()
    assert "ADAUSDT" not in engine.portfolio.positions


def test_paper_broker_rejects_overspend():
    st = _state()
    broker = PaperBroker({"ADAUSDT": st}, {"ADAUSDT": rules()}, "USDT", 8)
    with pytest.raises(Exception):
        asyncio.get_event_loop().run_until_complete(broker.buy("ADAUSDT", 10))
