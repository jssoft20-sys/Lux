"""Claude-based news analyser (optional — needs ANTHROPIC_API_KEY).

Headlines are batched and sent to Claude with a JSON schema so every item comes back with a
sentiment in [-1, 1], a confidence, the affected tickers, and a one-line reason. Results are
merged into the SentimentBook; the millisecond lexicon score stays as a fallback / tie-breaker.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable

from .book import NewsItem

log = logging.getLogger("lux.llm")

SYSTEM_PROMPT = """You are the news desk of a short-term crypto trading bot on Binance spot. \
Every minute you receive fresh headlines. For each one decide how the market is likely to react over the next 15-60 minutes.

Rules:
- sentiment: -1.0 (very bearish for the named coins / the market) .. +1.0 (very bullish). 0 = no tradeable effect.
- Price-move reports ("X surges 8%") are already priced in: give them at most ±0.3 unless they signal a regime change.
- Exchange listings, ETF approvals, major partnerships, hacks, delistings, lawsuits, regulatory bans, insolvencies, \
large unlocks and macro shocks are the high-impact categories.
- Old, vague, speculative or clickbait items get low confidence. Sponsored / price-prediction articles: sentiment 0, confidence 0.1.
- tickers: only exchange ticker symbols (BTC, ETH, ADA, ...) that the item is genuinely about. Empty if none.
- market_wide: true when the item moves the whole crypto market (macro, regulation, BTC itself).
- reason: at most 15 words, plain language.
- impact: high / medium / low.
Return the items in the same order with the same ids."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "sentiment": {"type": "number"},
                    "confidence": {"type": "number"},
                    "tickers": {"type": "array", "items": {"type": "string"}},
                    "market_wide": {"type": "boolean"},
                    "impact": {"type": "string", "enum": ["high", "medium", "low"]},
                    "reason": {"type": "string"},
                },
                "required": ["id", "sentiment", "confidence", "tickers", "market_wide", "impact", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


class ClaudeAnalyzer:
    def __init__(
        self,
        api_key: str,
        model: str,
        known_tickers: set[str],
        on_result: Callable[[str, dict[str, Any]], Awaitable[None] | None],
        batch_size: int = 12,
        min_interval: float = 3.0,
        max_batch_wait: float = 4.0,
        max_age_minutes: float = 90.0,
    ):
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=45.0, max_retries=2)
        self.model = model
        self.known = known_tickers
        self.on_result = on_result
        self.batch_size = batch_size
        self.min_interval = min_interval
        self.max_batch_wait = max_batch_wait
        self.max_age_s = max_age_minutes * 60.0
        self.skipped_old = 0
        self.queue: asyncio.Queue[NewsItem] = asyncio.Queue(maxsize=500)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._use_fallbacks = True
        # stats
        self.calls = 0
        self.items_done = 0
        self.errors = 0
        self.consecutive_errors = 0
        self.last_error = ""
        self.last_error_ts = 0.0
        self.last_call_ts = 0.0
        self.last_latency_ms = 0.0
        self.input_tokens = 0
        self.output_tokens = 0

    def submit(self, item: NewsItem) -> None:
        if item.macro:
            return
        if self.max_age_s > 0 and time.time() - item.ts > self.max_age_s:
            self.skipped_old += 1  # its decayed weight is negligible; the lexicon score is enough
            return
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            log.warning("LLM queue full, dropping %s", item.title[:60])

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="llm-analyzer")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _run(self) -> None:
        while not self._stop.is_set():
            batch = [await self.queue.get()]
            deadline = time.monotonic() + self.max_batch_wait
            while len(batch) < self.batch_size:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    batch.append(await asyncio.wait_for(self.queue.get(), remaining))
                except asyncio.TimeoutError:
                    break
            gap = self.min_interval - (time.time() - self.last_call_ts)
            if gap > 0:
                await asyncio.sleep(gap)
            try:
                results = await self.analyse(batch)
                self.consecutive_errors = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.errors += 1
                self.consecutive_errors += 1
                self.last_error = str(e)[:200]
                self.last_error_ts = time.time()
                # a dead key / unsupported region / no credits keeps failing: back off up to 5 minutes
                delay = min(5 * 2 ** (self.consecutive_errors - 1), 300)
                log.warning("LLM analysis failed: %s (next attempt in %ds)", self.last_error, delay)
                await asyncio.sleep(delay)
                continue
            for r in results:
                try:
                    out = self.on_result(r["id"], r)
                    if asyncio.iscoroutine(out):
                        await out
                except Exception:  # noqa: BLE001
                    log.exception("on_result failed")

    def _payload(self, batch: list[NewsItem]) -> str:
        return json.dumps(
            [{"id": it.id, "source": it.source, "age_min": int(max(0, time.time() - it.ts) // 60), "title": it.title, "summary": it.summary[:300]} for it in batch],
            ensure_ascii=False,
        )

    async def analyse(self, batch: list[NewsItem]) -> list[dict[str, Any]]:
        a = self._anthropic
        content = "Analyse these headlines:\n" + self._payload(batch)
        kwargs: dict[str, Any] = dict(
            model=self.model,
            max_tokens=4000,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        t0 = time.perf_counter()
        self.last_call_ts = time.time()
        try:
            if self._use_fallbacks:
                try:
                    # Server-side refusal fallback: if the primary model declines, the API re-runs on a fallback model.
                    response = await self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
                except (a.BadRequestError, TypeError) as e:
                    log.info("fallbacks parameter not accepted (%s); continuing without it", str(e)[:120])
                    self._use_fallbacks = False
                    response = await self.client.messages.create(**kwargs)
            else:
                response = await self.client.messages.create(**kwargs)
        except a.RateLimitError as e:
            retry_after = e.response.headers.get("retry-after", "20") if getattr(e, "response", None) else "20"
            raise RuntimeError(f"лимит запросов Anthropic, повтор через {retry_after} с") from e
        except a.AuthenticationError as e:
            raise RuntimeError("неверный ANTHROPIC_API_KEY (401)") from e
        except a.PermissionDeniedError as e:
            raise RuntimeError(f"доступ запрещён (403): {getattr(e, 'message', e)} — обычно регион сервера не поддерживается Anthropic") from e
        except a.NotFoundError as e:
            raise RuntimeError(f"модель {self.model} недоступна (404): {getattr(e, 'message', e)}") from e
        except a.BadRequestError as e:
            raise RuntimeError(f"ошибка запроса (400): {getattr(e, 'message', e)}") from e
        except a.APIStatusError as e:
            raise RuntimeError(f"ошибка API {e.status_code}: {getattr(e, 'message', e)}") from e
        except a.APIConnectionError as e:
            raise RuntimeError(f"нет соединения с api.anthropic.com: {e}") from e
        self.last_latency_ms = (time.perf_counter() - t0) * 1000
        self.calls += 1
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.input_tokens += int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "cache_read_input_tokens", 0) or 0)
            self.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
        if response.stop_reason == "refusal":
            raise RuntimeError("model refused the request")
        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        return self._parse(text, batch)

    def _parse(self, text: str, batch: list[NewsItem]) -> list[dict[str, Any]]:
        try:
            data = json.loads(text)
        except ValueError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end < 0:
                raise RuntimeError("LLM returned no JSON")
            data = json.loads(text[start:end + 1])
        valid_ids = {it.id for it in batch}
        out = []
        for r in data.get("items", []):
            rid = str(r.get("id", ""))
            if rid not in valid_ids:
                continue
            try:
                score = max(-1.0, min(1.0, float(r.get("sentiment", 0))))
                conf = max(0.0, min(1.0, float(r.get("confidence", 0))))
            except (TypeError, ValueError):
                continue
            tickers = [str(t).upper().lstrip("$") for t in (r.get("tickers") or []) if str(t).upper().lstrip("$") in self.known]
            out.append({
                "id": rid,
                "score": round(score, 3),
                "confidence": round(conf, 3),
                "tickers": tickers,
                "market_wide": bool(r.get("market_wide", False)),
                "impact": r.get("impact") if r.get("impact") in ("high", "medium", "low") else "low",
                "reason": str(r.get("reason") or "")[:200],
            })
        self.items_done += len(out)
        return out

    def status(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "model": self.model,
            "calls": self.calls,
            "items": self.items_done,
            "errors": self.errors,
            "last_error": self.last_error,
            "queue": self.queue.qsize(),
            "skipped_old": self.skipped_old,
            "latency_ms": round(self.last_latency_ms),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }
