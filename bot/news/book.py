"""SentimentBook: per-symbol news sentiment with exponential time decay.

Every item contributes ``score × importance × source_weight × 2^(-age / half_life)``.
Items that name the coin count fully; BTC items count 50% for every other coin (BTC drives
the market); market-wide / macro items count 40%. A Fear & Greed reading adds a small bias.
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class NewsItem:
    id: str
    ts: float  # publication time (or fetch time) — used for decay
    fetched: float
    source: str
    title: str
    summary: str
    url: str
    tickers: list[str]
    market_wide: bool
    score: float  # lexicon score [-1, 1]
    importance: float  # [0, 1]
    confidence: float
    source_weight: float = 0.8
    terms: list[str] = field(default_factory=list)
    llm_score: float | None = None
    llm_confidence: float | None = None
    llm_reason: str | None = None
    llm_impact: str | None = None
    macro: dict[str, Any] | None = None

    @property
    def effective_score(self) -> float:
        if self.llm_score is None:
            return self.score
        # the LLM is the better judge, the lexicon keeps a vote so a single model hiccup cannot flip everything
        return 0.75 * self.llm_score + 0.25 * self.score

    @property
    def effective_importance(self) -> float:
        imp = self.importance
        if self.llm_impact == "high":
            imp = max(imp, 0.9)
        elif self.llm_impact == "medium":
            imp = max(imp, 0.6)
        elif self.llm_impact == "low":
            imp = min(imp, 0.4)
        if self.llm_confidence is not None:
            imp *= 0.5 + 0.5 * self.llm_confidence
        return imp

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["effective_score"] = round(self.effective_score, 3)
        return d


class SentimentBook:
    def __init__(self, symbols: list[str], base_of: dict[str, str], half_life_minutes: float = 20.0, max_age_hours: float = 12.0):
        self.symbols = symbols
        self.base_of = base_of
        self.half_life = max(1.0, half_life_minutes) * 60.0
        self.max_age = max_age_hours * 3600.0
        self.items: deque[NewsItem] = deque(maxlen=3000)
        self.by_id: dict[str, NewsItem] = {}
        self.fng: int | None = None
        self.fng_ts: float = 0.0
        self.last_item_ts: float = 0.0

    # ---- ingestion ----
    def add(self, item: NewsItem) -> None:
        if item.macro:
            # macro readings (Fear & Greed) only set the bias — they are not headlines
            if "fng" in item.macro:
                self.fng = int(item.macro["fng"])
                self.fng_ts = time.time()
            return
        if item.id in self.by_id:
            return
        self.items.append(item)
        self.by_id[item.id] = item
        self.last_item_ts = max(self.last_item_ts, item.fetched)
        self._prune()

    def update_llm(self, item_id: str, score: float | None, confidence: float | None, reason: str | None, impact: str | None, tickers: list[str] | None = None, market_wide: bool | None = None) -> NewsItem | None:
        it = self.by_id.get(item_id)
        if it is None:
            return None
        it.llm_score = score
        it.llm_confidence = confidence
        it.llm_reason = reason
        it.llm_impact = impact
        if tickers:
            merged = list(it.tickers)
            for t in tickers:
                if t not in merged:
                    merged.append(t)
            it.tickers = merged
        if market_wide is not None:
            it.market_wide = it.market_wide or market_wide
        return it

    def _prune(self) -> None:
        # items are inserted in fetch order, not time order, so scan instead of popping from the left
        cutoff = time.time() - self.max_age
        if any(it.ts < cutoff for it in self.items):
            keep = [it for it in self.items if it.ts >= cutoff]
            self.items.clear()
            self.items.extend(keep)
            self.by_id = {it.id: it for it in keep}

    # ---- scoring ----
    def _decay(self, item: NewsItem, now: float) -> float:
        age = max(0.0, now - item.ts)
        return math.pow(2.0, -age / self.half_life)

    def macro_bias(self) -> float:
        if self.fng is None or time.time() - self.fng_ts > 6 * 3600:
            return 0.0
        # extreme fear (0) -> -0.1, extreme greed (100) -> +0.1
        return (self.fng - 50) / 50.0 * 0.1

    def score(self, symbol: str, now: float | None = None, top_n: int = 5) -> dict[str, Any]:
        now = now or time.time()
        base = self.base_of.get(symbol, symbol)
        weighted = 0.0
        norm = 0.0
        count = 0
        contributions: list[tuple[float, NewsItem, float]] = []
        for it in self.items:
            if base in it.tickers:
                rel = 1.0
            elif "BTC" in it.tickers and base != "BTC":
                rel = 0.5
            elif it.market_wide:
                rel = 0.4
            else:
                continue
            w = rel * it.effective_importance * it.source_weight * self._decay(it, now)
            if w < 1e-4:
                continue
            s = it.effective_score
            weighted += s * w
            norm += w
            count += 1
            contributions.append((abs(s * w), it, s * w))
        # "+0.6" in the denominator: a single weak item cannot saturate the score
        score = weighted / (norm + 0.6) if norm > 0 else 0.0
        score = max(-1.0, min(1.0, score + self.macro_bias()))
        contributions.sort(key=lambda c: c[0], reverse=True)
        return {
            "symbol": symbol,
            "score": round(score, 4),
            "count": count,
            "strength": round(norm, 3),
            "top": [{"id": it.id, "title": it.title, "source": it.source, "score": round(it.effective_score, 3), "contribution": round(c, 4), "ts": it.ts, "url": it.url} for _, it, c in contributions[:top_n]],
        }

    def market_score(self, now: float | None = None) -> float:
        now = now or time.time()
        weighted = norm = 0.0
        for it in self.items:
            if not (it.market_wide or "BTC" in it.tickers or "ETH" in it.tickers):
                continue
            w = it.effective_importance * it.source_weight * self._decay(it, now)
            weighted += it.effective_score * w
            norm += w
        return round(weighted / (norm + 0.6), 4) if norm > 0 else 0.0

    def recent(self, limit: int = 60) -> list[dict[str, Any]]:
        newest = sorted(self.items, key=lambda it: it.ts, reverse=True)[:limit]
        return [it.to_dict() for it in newest]
