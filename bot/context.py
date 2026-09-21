"""Shared runtime objects (built in main.py, used by the API)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .config import Settings
from .events import EventBus
from .exchange.binance import BinanceREST, MarketDataStream, SymbolRules
from .exchange.broker import Broker
from .news.book import SentimentBook
from .news.collector import NewsCollector
from .storage.db import Database
from .strategy.engine import TradingEngine


@dataclass
class AppContext:
    cfg: Settings
    db: Database
    bus: EventBus
    rest: BinanceREST
    rules: dict[str, SymbolRules]
    stream: MarketDataStream
    book: SentimentBook
    collector: NewsCollector
    broker: Broker
    engine: TradingEngine
    llm: Any | None = None
    account_info: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
