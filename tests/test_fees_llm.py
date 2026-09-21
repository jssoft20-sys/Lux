import random
import time

import pytest

from bot.config import Settings
from bot.events import EventBus
from bot.exchange.binance import MarketState
from bot.exchange.broker import PaperBroker
from bot.news.book import NewsItem, SentimentBook
from bot.news.llm import merge_results
from bot.storage.db import Database
from bot.strategy.engine import TradingEngine
from bot.strategy.fees import FeeCalculator
from bot.strategy.risk import RiskManager
from tests.test_trading import rules


def test_fee_calculator_targets():
    f = FeeCalculator(0.001, 2.5)
    assert f.round_trip_pct == pytest.approx(0.2)
    assert f.target_pct(0) == pytest.approx(0.5)
    assert f.target_pct(10) == pytest.approx(0.6)  # 10 bps spread added
    assert f.stop_pct(0.5) == pytest.approx(0.4)
    assert f.trailing(0.5) == (pytest.approx(0.3), pytest.approx(0.2))
    assert f.net_pct(0.5) == pytest.approx(0.3)
    assert f.net_pnl(100.0, 100.5, 1.0) == pytest.approx(0.5 - 0.2005)
    assert f.min_volatility_bps(0.5, 0.5) == pytest.approx(25)


def test_merge_results_weights_by_confidence():
    a = [{"id": "x", "score": 0.8, "confidence": 0.9, "tickers": ["ADA"], "market_wide": False, "impact": "medium", "reason": "listing", "provider": "claude"}]
    b = [{"id": "x", "score": 0.2, "confidence": 0.3, "tickers": ["BTC"], "market_wide": True, "impact": "high", "reason": "meh", "provider": "gpt"},
         {"id": "y", "score": -0.5, "confidence": 0.5, "tickers": [], "market_wide": False, "impact": "low", "reason": "lawsuit", "provider": "gpt"}]
    out = {r["id"]: r for r in merge_results([a, b])}
    x = out["x"]
    assert x["score"] == pytest.approx((0.8 * 0.9 + 0.2 * 0.3) / 1.2, abs=1e-3)
    assert x["tickers"] == ["ADA", "BTC"] and x["market_wide"] and x["impact"] == "high"
    assert x["reason"] == "listing" and x["providers"] == ["claude", "gpt"]
    assert out["y"]["score"] == -0.5 and out["y"]["providers"] == ["gpt"]


def _noisy_state(symbol="ADAUSDT", price=0.5, vol=0.0018, seed=7):
    """15 minutes of samples with realistic noise so the 5-min volatility is non-zero."""
    rnd = random.Random(seed)
    st = MarketState(symbol)
    now = time.time() * 1000
    p = price
    for i in range(60):
        p *= 1 + rnd.gauss(0.0002, vol)
        st.prices.append((now - (60 - i) * 15000, p))
    st.on_book(p * 0.9999, p * 1.0001, 5000, 5000)
    return st


@pytest.mark.asyncio
async def test_scalp_targets_come_from_fees(tmp_path):
    cfg = Settings(trading_mode="paper", symbols="ADAUSDT", position_size_usdt=10, paper_start_balance=50, buy_threshold=0.25, strategy="scalp", scalp_mode=True, fee_multiple=2.5, fee_rate=0.001, db_path=str(tmp_path / "t.db"), _env_file=None)
    r = rules()
    states = {"ADAUSDT": _noisy_state()}
    rm = RiskManager(cfg)
    need = rm.fees.min_volatility_bps(rm.fees.target_pct(0), cfg.scalp_min_volatility_ratio)
    assert states["ADAUSDT"].volatility_bps(300) >= need, "fixture must be volatile enough for a scalp"
    broker = PaperBroker(states, {"ADAUSDT": r}, "USDT", 50, fee_rate=0.001, slippage_bps=0)
    book = SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"})
    now = time.time()
    book.add(NewsItem(id="n1", ts=now, fetched=now, source="t", title="Binance lists ADA perpetual, Cardano surges", summary="", url="", tickers=["ADA"], market_wide=False, score=0.9, importance=1.0, confidence=1.0))
    db = Database(str(tmp_path / "t.db"))
    engine = TradingEngine(cfg, broker, states, {"ADAUSDT": r}, book, db, rm, EventBus(db))
    engine.running = True
    await engine.tick()
    assert "ADAUSDT" in engine.portfolio.positions, engine.decisions
    pos = engine.portfolio.positions["ADAUSDT"]
    spread_pct = states["ADAUSDT"].spread_bps() / 100
    assert pos.extra["tp_pct"] == pytest.approx(0.5 + spread_pct, abs=0.01)
    assert pos.extra["sl_pct"] == pytest.approx(pos.extra["tp_pct"] * 0.8, abs=0.01)
    assert pos.extra["max_hold_min"] == 12
    assert pos.take_profit == pytest.approx(pos.entry_price * (1 + pos.extra["tp_pct"] / 100), rel=1e-6)


def test_scalp_gate_rejects_flat_market():
    cfg = Settings(scalp_mode=True, fee_multiple=2.5, _env_file=None)
    rm = RiskManager(cfg)
    from bot.strategy.signals import Weights, compute_signal
    from tests.test_trading import _state

    sig = compute_signal(_state(trend_pct=0.6), {"score": 0.9, "count": 1, "strength": 1, "top": []}, 0.0, Weights())
    ok, why = rm.can_open(sig, 0, 50.0, rules())
    assert not ok and "вола" in why
