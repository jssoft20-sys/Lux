"""A position below the exchange minimum cannot be sold: the engine tops it up once and closes it,
and never hammers the exchange every tick."""

import time

import pytest

from bot.config import Settings
from bot.events import EventBus
from bot.exchange.binance import BinanceError
from bot.exchange.broker import PaperBroker
from bot.news.book import SentimentBook
from bot.storage.db import Database
from bot.strategy.engine import TradingEngine
from bot.strategy.portfolio import Position
from bot.strategy.risk import RiskManager
from tests.test_trading import _state, rules


class DustyBroker(PaperBroker):
    """Refuses sells below the exchange minimum, like Binance's NOTIONAL filter."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.sell_attempts = 0

    async def sell(self, symbol, qty):
        self.sell_attempts += 1
        st = self.states[symbol]
        if self.rules[symbol].round_qty(qty) * st.bid < float(self.rules[symbol].min_notional):
            raise BinanceError(-1013, "Filter failure: NOTIONAL")
        return await super().sell(symbol, qty)


@pytest.mark.asyncio
async def test_dust_position_is_topped_up_and_closed(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="BTCUSDT", paper_start_balance=20, min_hold_seconds=0, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules(symbol="BTCUSDT", base="BTC", step="0.00001000")
    states = {"BTCUSDT": _state(symbol="BTCUSDT", price=80000)}
    broker = DustyBroker(states, {"BTCUSDT": r}, "USDT", 20, fee_rate=0.001, slippage_bps=0)
    db = Database(str(tmp_path / "t.db"))
    engine = TradingEngine(cfg, broker, states, {"BTCUSDT": r}, SentimentBook(["BTCUSDT"], {"BTCUSDT": "BTC"}), db, RiskManager(cfg), EventBus(db))
    engine.running = True
    # a 4.89 USDT position (0.00006 BTC) that Binance will not let us sell
    pos = Position("BTCUSDT", 0.00006, 81450.0, time.time() - 3600, 4.89, 0.005, 80798.0, 82427.0, 81450.0, mode="paper")
    pos.extra["max_hold_min"] = 12
    engine.portfolio.positions["BTCUSDT"] = pos
    broker._balances["BTC"] = 0.00006
    broker._balances["USDT"] = 6.80
    states["BTCUSDT"].on_book(81300.0, 81310.0, 10, 10)
    await engine.tick()  # time exit -> sell fails -> top-up -> full close
    assert "BTCUSDT" not in engine.portfolio.positions
    reasons = [t["reason"] for t in db.trades()]
    assert any("докупка" in x for x in reasons) and any("выход по времени" in x for x in reasons)
    assert broker.sell_attempts == 2


@pytest.mark.asyncio
async def test_dust_without_funds_is_not_retried_every_tick(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="BTCUSDT", paper_start_balance=1, min_hold_seconds=0, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules(symbol="BTCUSDT", base="BTC", step="0.00001000")
    states = {"BTCUSDT": _state(symbol="BTCUSDT", price=80000)}
    broker = DustyBroker(states, {"BTCUSDT": r}, "USDT", 1, fee_rate=0.001, slippage_bps=0)
    db = Database(str(tmp_path / "t.db"))
    engine = TradingEngine(cfg, broker, states, {"BTCUSDT": r}, SentimentBook(["BTCUSDT"], {"BTCUSDT": "BTC"}), db, RiskManager(cfg), EventBus(db))
    engine.running = True
    pos = Position("BTCUSDT", 0.00006, 81450.0, time.time() - 3600, 4.89, 0.005, 80798.0, 82427.0, 81450.0, mode="paper")
    pos.extra["max_hold_min"] = 12
    engine.portfolio.positions["BTCUSDT"] = pos
    broker._balances["BTC"] = 0.00006
    states["BTCUSDT"].on_book(81300.0, 81310.0, 10, 10)
    for _ in range(20):
        await engine.tick()
    assert "BTCUSDT" in engine.portfolio.positions
    assert broker.sell_attempts == 1  # one failed attempt, then a cool-down instead of a flood
    assert engine.portfolio.positions["BTCUSDT"].extra["unsellable"]
