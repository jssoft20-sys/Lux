"""Polls every news source on its own schedule, de-duplicates, scores and publishes items."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

import httpx

from .book import NewsItem
from .entities import EntityExtractor
from .sentiment import analyse
from .sources import Source, fetch_source

log = logging.getLogger("lux.news")


class NewsCollector:
    def __init__(self, sources: list[Source], extractor: EntityExtractor, on_item: Callable[[NewsItem], None], seen: set[str] | None = None):
        self.sources = sources
        self.extractor = extractor
        self.on_item = on_item
        self.seen: set[str] = set(seen or ())
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=6.0), limits=httpx.Limits(max_connections=30))
        self._tasks: list[asyncio.Task] = []
        self._stop = asyncio.Event()
        self.total_items = 0
        self.started = time.time()
        self.last_item_ts = 0.0
        self._first_pass: set[str] = set()

    async def start(self) -> None:
        # stagger start so ~30 sources do not hit the network at the very same instant
        for i, src in enumerate(self.sources):
            self._tasks.append(asyncio.create_task(self._loop(src, delay=i * 0.35), name=f"news:{src.name}"))

    async def stop(self) -> None:
        self._stop.set()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self._client.aclose()

    async def poll_once(self, src: Source) -> int:
        raw = await fetch_source(self._client, src)
        first = src.name not in self._first_pass
        self._first_pass.add(src.name)
        n = 0
        now = time.time()
        for r in raw:
            if r["id"] in self.seen:
                continue
            self.seen.add(r["id"])
            item = self._make_item(r, now, first)
            if item is None:
                continue
            n += 1
            self.total_items += 1
            self.last_item_ts = now
            try:
                self.on_item(item)
            except Exception:  # noqa: BLE001
                log.exception("on_item failed for %s", item.title)
        if len(self.seen) > 50000:  # bound memory; the DB keeps the long-term record
            self.seen = set(list(self.seen)[-20000:])
        return n

    def _make_item(self, r: dict[str, Any], now: float, first_pass: bool) -> NewsItem | None:
        text = f"{r['title']}. {r.get('summary', '')}"
        tickers, market_wide = self.extractor.extract(text)
        for t in r.get("tickers_hint") or []:
            if t in self.extractor.known and t not in tickers:
                tickers.append(t)
        macro = r.get("macro")
        is_exchange_feed = "binance" in r["source"].lower()
        if not macro and not is_exchange_feed and not self.extractor.is_crypto_related(text, tickers):
            return None  # not about crypto at all (e.g. a general-news feed item)
        s = analyse(r["title"] if not r.get("summary") else f"{r['title']}. {r['summary'][:200]}")
        published = r.get("published")
        if published and published > now + 600:  # broken clocks in feeds
            published = now
        if first_pass:
            # initial load: never treat backlog as breaking news
            ts = published if published else now - 3 * 3600
        else:
            ts = published if published else now
            ts = max(ts, now - 6 * 3600)
        return NewsItem(
            id=r["id"],
            ts=float(ts),
            fetched=now,
            source=r["source"],
            title=r["title"],
            summary=r.get("summary", ""),
            url=r.get("url", ""),
            tickers=tickers,
            market_wide=bool(market_wide),
            score=s.score,
            importance=s.importance,
            confidence=s.confidence,
            source_weight=float(r.get("weight", 0.8)),
            terms=s.terms,
            macro=macro,
        )

    async def _loop(self, src: Source, delay: float = 0.0) -> None:
        await asyncio.sleep(delay)
        backoff = src.interval
        while not self._stop.is_set():
            t0 = time.time()
            try:
                n = await self.poll_once(src)
                if n:
                    log.info("%s: %d new item(s)", src.name, n)
                backoff = src.interval
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                src.errors += 1
                src.last_error = f"{type(e).__name__}: {e}"
                backoff = min(backoff * 2, 600)
                log.warning("%s: %s (retry in %.0fs)", src.name, src.last_error, backoff)
            elapsed = time.time() - t0
            await asyncio.sleep(max(1.0, backoff - elapsed))

    def status(self) -> list[dict[str, Any]]:
        now = time.time()
        return [
            {
                "name": s.name,
                "kind": s.kind,
                "interval": s.interval,
                "items": s.items,
                "errors": s.errors,
                "last_ok_age": round(now - s.last_ok, 1) if s.last_ok else None,
                "last_error": s.last_error,
                "latency_ms": round(s.last_latency_ms, 1),
            }
            for s in self.sources
        ]
