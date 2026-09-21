"""Per-symbol signal: news sentiment + short-term momentum + order-book imbalance + taker flow."""

from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass
from typing import Any

from ..exchange.binance import MarketState


@dataclass
class Weights:
    news: float = 0.55
    momentum: float = 0.25
    orderbook: float = 0.10
    flow: float = 0.10

    def normalised(self) -> "Weights":
        tot = self.news + self.momentum + self.orderbook + self.flow
        if tot <= 0:
            return Weights()
        return Weights(self.news / tot, self.momentum / tot, self.orderbook / tot, self.flow / tot)


@dataclass
class SymbolSignal:
    symbol: str
    ts: float
    price: float
    bid: float
    ask: float
    spread_bps: float
    mom_1m: float
    mom_5m: float
    mom_15m: float
    imbalance: float
    flow: float
    volatility_bps: float
    volume_1m: float
    day_change_pct: float
    news_score: float
    news_count: int
    news_strength: float
    market_score: float
    momentum_score: float
    orderbook_score: float
    flow_score: float
    composite: float
    data_age_ms: float
    top_news: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for k, v in d.items():
            if isinstance(v, float):
                d[k] = round(v, 6 if k in ("price", "bid", "ask") else 4)
        return d


def compute_signal(state: MarketState, news: dict[str, Any], market_score: float, weights: Weights) -> SymbolSignal:
    mom_1 = state.momentum_pct(60)
    mom_5 = state.momentum_pct(300)
    mom_15 = state.momentum_pct(900)
    # each term is scaled so that a "strong" move for a large cap maps to ~1 before tanh
    momentum_score = math.tanh(0.5 * mom_1 / 0.25 + 0.35 * mom_5 / 0.6 + 0.15 * mom_15 / 1.0)
    # thin markets: a single trade or a tiny top-of-book should not look like conviction
    vol_5m = state.volume_quote(300)
    liquidity = min(1.0, vol_5m / 5000.0)
    imbalance = state.imbalance() * liquidity
    flow = state.flow(60) * liquidity
    w = weights.normalised()
    news_score = float(news.get("score", 0.0))
    # BTC-led market tone adds a small tilt so alts do not fight the tape
    tilt = 0.15 * market_score if news.get("count", 0) == 0 else 0.0
    composite = w.news * (news_score + tilt) + w.momentum * momentum_score + w.orderbook * imbalance + w.flow * flow
    composite = max(-1.0, min(1.0, composite))
    return SymbolSignal(
        symbol=state.symbol,
        ts=time.time(),
        price=state.mid,
        bid=state.bid,
        ask=state.ask,
        spread_bps=state.spread_bps() if state.mid > 0 else float("inf"),
        mom_1m=mom_1,
        mom_5m=mom_5,
        mom_15m=mom_15,
        imbalance=imbalance,
        flow=flow,
        volatility_bps=state.volatility_bps(300),
        volume_1m=state.volume_quote(60),
        day_change_pct=state.day_change_pct(),
        news_score=news_score,
        news_count=int(news.get("count", 0)),
        news_strength=float(news.get("strength", 0.0)),
        market_score=market_score,
        momentum_score=momentum_score,
        orderbook_score=imbalance,
        flow_score=flow,
        composite=composite,
        data_age_ms=state.age_ms,
        top_news=news.get("top", [])[:3],
    )
