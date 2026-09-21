"""Candle store per symbol: 1-minute klines from Binance REST (refreshed continuously), aggregated
5m / 15m series, and the higher-timeframe reference levels the SMC playbook needs (previous
day / week / month high-low, day and week open)."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from ..exchange.binance import BinanceError, BinanceREST

log = logging.getLogger("lux.candles")


@dataclass(frozen=True)
class Candle:
    ts: float  # open time, seconds
    open: float
    high: float
    low: float
    close: float
    volume: float  # quote volume

    @property
    def bullish(self) -> bool:
        return self.close >= self.open

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def range(self) -> float:
        return self.high - self.low


@dataclass
class Levels:
    """Reference levels from D1 / W1 / M1 klines."""
    day_open: float = 0.0
    prev_day_high: float = 0.0
    prev_day_low: float = 0.0
    week_open: float = 0.0
    prev_week_high: float = 0.0
    prev_week_low: float = 0.0
    prev_month_high: float = 0.0
    prev_month_low: float = 0.0
    updated: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {k: round(v, 8) for k, v in self.__dict__.items()}


def aggregate(candles: list[Candle], minutes: int) -> list[Candle]:
    """Group 1-minute candles into `minutes`-minute candles aligned to the clock."""
    out: list[Candle] = []
    bucket: list[Candle] = []
    step = minutes * 60
    cur = None
    for c in candles:
        key = int(c.ts // step) * step
        if cur is None:
            cur = key
        if key != cur:
            if bucket:
                out.append(_merge(bucket, cur))
            bucket, cur = [], key
        bucket.append(c)
    if bucket and cur is not None:
        out.append(_merge(bucket, cur))
    return out


def _merge(bucket: list[Candle], ts: float) -> Candle:
    return Candle(ts, bucket[0].open, max(c.high for c in bucket), min(c.low for c in bucket), bucket[-1].close, sum(c.volume for c in bucket))


def _parse(kl: list[list[Any]]) -> list[Candle]:
    return [Candle(float(k[0]) / 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7])) for k in kl]


class CandleStore:
    def __init__(self, rest: BinanceREST, symbols: list[str], minute_limit: int = 500):
        self.rest = rest
        self.symbols = symbols
        self.minute_limit = minute_limit
        self.m1: dict[str, list[Candle]] = {s: [] for s in symbols}
        self.levels: dict[str, Levels] = {s: Levels() for s in symbols}
        self.last_refresh: dict[str, float] = {}
        self.errors = 0
        self.last_error = ""
        self._stop = asyncio.Event()
        self._sem = asyncio.Semaphore(4)

    # ---- accessors --------------------------------------------------------------------------
    def closed_m1(self, symbol: str) -> list[Candle]:
        """1m candles excluding the still-forming last one."""
        c = self.m1.get(symbol) or []
        if not c:
            return []
        now = time.time()
        return c[:-1] if now - c[-1].ts < 60 else c

    def series(self, symbol: str) -> dict[str, list[Candle]]:
        m1 = self.closed_m1(symbol)
        return {"m1": m1, "m5": aggregate(m1, 5), "m15": aggregate(m1, 15)}

    def ready(self, symbol: str) -> bool:
        return len(self.m1.get(symbol) or []) >= 60

    # ---- refresh loops ----------------------------------------------------------------------
    async def refresh_symbol(self, symbol: str) -> None:
        async with self._sem:
            try:
                kl = await self.rest.klines(symbol, "1m", self.minute_limit)
                self.m1[symbol] = _parse(kl)
                self.last_refresh[symbol] = time.time()
            except BinanceError as e:
                self.errors += 1
                self.last_error = e.msg
                log.debug("klines %s: %s", symbol, e.msg)

    async def refresh_levels(self, symbol: str) -> None:
        async with self._sem:
            try:
                d = _parse(await self.rest.klines(symbol, "1d", 3))
                w = _parse(await self.rest.klines(symbol, "1w", 3))
                mo = _parse(await self.rest.klines(symbol, "1M", 3))
            except BinanceError as e:
                self.errors += 1
                self.last_error = e.msg
                return
            lv = self.levels[symbol]
            if d:
                lv.day_open = d[-1].open
                if len(d) >= 2:
                    lv.prev_day_high, lv.prev_day_low = d[-2].high, d[-2].low
            if w:
                lv.week_open = w[-1].open
                if len(w) >= 2:
                    lv.prev_week_high, lv.prev_week_low = w[-2].high, w[-2].low
            if len(mo) >= 2:
                lv.prev_month_high, lv.prev_month_low = mo[-2].high, mo[-2].low
            lv.updated = time.time()

    async def run(self, minute_every: float = 45.0, levels_every: float = 1800.0) -> None:
        await asyncio.gather(*(self.refresh_symbol(s) for s in self.symbols))
        await asyncio.gather(*(self.refresh_levels(s) for s in self.symbols))
        log.info("candles loaded for %d symbols", sum(1 for s in self.symbols if self.m1[s]))
        last_levels = time.time()
        while not self._stop.is_set():
            await asyncio.sleep(minute_every)
            try:
                await asyncio.gather(*(self.refresh_symbol(s) for s in self.symbols))
                if time.time() - last_levels > levels_every:
                    await asyncio.gather(*(self.refresh_levels(s) for s in self.symbols))
                    last_levels = time.time()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("candle refresh failed")

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {
            "symbols": len(self.symbols),
            "loaded": sum(1 for s in self.symbols if self.m1[s]),
            "oldest_refresh_age_s": round(now - min(self.last_refresh.values())) if self.last_refresh else None,
            "errors": self.errors,
            "last_error": self.last_error,
        }
