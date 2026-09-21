"""LLM news analysers: Claude (Anthropic) and GPT (OpenAI), run together through an ``AnalyzerPool``.

Headlines are batched and sent to every healthy provider at the same time with a JSON schema;
per-item results are merged (confidence-weighted sentiment, union of tickers, strongest impact).
A provider that keeps failing with a permanent error (bad key, unsupported region, unknown model,
no credits) disables itself; the others keep working. The millisecond lexicon score stays as the
fallback / tie-breaker in the SentimentBook.
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

PERMANENT_MARKERS = ("401", "403", "404", "no credits", "insufficient_quota", "billing", "invalid api key", "неверный")


def _payload(batch: list[NewsItem]) -> str:
    return json.dumps(
        [{"id": it.id, "source": it.source, "age_min": int(max(0, time.time() - it.ts) // 60), "title": it.title, "summary": it.summary[:300]} for it in batch],
        ensure_ascii=False,
    )


class BaseAnalyzer:
    """Shared bookkeeping for one provider. Subclasses implement ``_request``."""

    name = "llm"

    def __init__(self, model: str, known_tickers: set[str]):
        self.model = model
        self.known = known_tickers
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
        self.disabled_reason = ""
        self.cooldown_until = 0.0

    @property
    def healthy(self) -> bool:
        return not self.disabled_reason and time.time() >= self.cooldown_until

    async def _request(self, content: str) -> tuple[str, int, int]:  # -> (json text, input tokens, output tokens)
        raise NotImplementedError

    async def analyse(self, batch: list[NewsItem]) -> list[dict[str, Any]]:
        t0 = time.perf_counter()
        self.last_call_ts = time.time()
        text, tin, tout = await self._request("Analyse these headlines:\n" + _payload(batch))
        self.last_latency_ms = (time.perf_counter() - t0) * 1000
        self.calls += 1
        self.consecutive_errors = 0
        self.input_tokens += tin
        self.output_tokens += tout
        return self._parse(text, batch)

    def record_error(self, err: Exception) -> None:
        self.errors += 1
        self.consecutive_errors += 1
        self.last_error = str(err)[:200]
        self.last_error_ts = time.time()
        permanent = self.calls == 0 and any(m in self.last_error.lower() for m in PERMANENT_MARKERS)
        if permanent and self.consecutive_errors >= 3:
            self.disabled_reason = self.last_error
            log.warning("%s disabled: %s", self.name, self.last_error)
            return
        delay = min(5 * 2 ** (self.consecutive_errors - 1), 300)
        self.cooldown_until = time.time() + delay
        log.warning("%s failed: %s (next attempt in %ds)", self.name, self.last_error, delay)

    def _parse(self, text: str, batch: list[NewsItem]) -> list[dict[str, Any]]:
        try:
            data = json.loads(text)
        except ValueError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end < 0:
                raise RuntimeError("no JSON in the model reply")
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
                "id": rid, "score": round(score, 3), "confidence": round(conf, 3), "tickers": tickers,
                "market_wide": bool(r.get("market_wide", False)),
                "impact": r.get("impact") if r.get("impact") in ("high", "medium", "low") else "low",
                "reason": str(r.get("reason") or "")[:200], "provider": self.name,
            })
        self.items_done += len(out)
        return out

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name, "model": self.model, "healthy": self.healthy, "disabled_reason": self.disabled_reason,
            "calls": self.calls, "items": self.items_done, "errors": self.errors, "last_error": self.last_error,
            "latency_ms": round(self.last_latency_ms), "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
        }


class ClaudeAnalyzer(BaseAnalyzer):
    name = "claude"

    def __init__(self, api_key: str, model: str, known_tickers: set[str]):
        import anthropic

        super().__init__(model, known_tickers)
        self._a = anthropic
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=45.0, max_retries=1)
        self._use_fallbacks = True

    async def _request(self, content: str) -> tuple[str, int, int]:
        a = self._a
        kwargs: dict[str, Any] = dict(
            model=self.model, max_tokens=4000,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        try:
            if self._use_fallbacks:
                try:
                    # server-side refusal fallback: if the primary model declines, the API re-runs on a fallback model
                    response = await self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
                except (a.BadRequestError, TypeError) as e:
                    log.info("fallbacks parameter not accepted (%s); continuing without it", str(e)[:120])
                    self._use_fallbacks = False
                    response = await self.client.messages.create(**kwargs)
            else:
                response = await self.client.messages.create(**kwargs)
        except a.RateLimitError as e:
            raise RuntimeError(f"лимит запросов Anthropic (429): {getattr(e, 'message', e)}") from e
        except a.AuthenticationError as e:
            raise RuntimeError("неверный ANTHROPIC_API_KEY (401)") from e
        except a.PermissionDeniedError as e:
            raise RuntimeError(f"доступ запрещён (403): {getattr(e, 'message', e)}") from e
        except a.NotFoundError as e:
            raise RuntimeError(f"модель {self.model} недоступна (404)") from e
        except a.BadRequestError as e:
            raise RuntimeError(f"ошибка запроса (400): {getattr(e, 'message', e)}") from e
        except a.APIStatusError as e:
            raise RuntimeError(f"ошибка API {e.status_code}: {getattr(e, 'message', e)}") from e
        except a.APIConnectionError as e:
            raise RuntimeError(f"нет соединения с api.anthropic.com: {e}") from e
        if response.stop_reason == "refusal":
            raise RuntimeError("модель отказалась отвечать")
        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        u = getattr(response, "usage", None)
        tin = int(getattr(u, "input_tokens", 0) or 0) + int(getattr(u, "cache_read_input_tokens", 0) or 0) if u else 0
        tout = int(getattr(u, "output_tokens", 0) or 0) if u else 0
        return text, tin, tout


class OpenAIAnalyzer(BaseAnalyzer):
    name = "gpt"

    def __init__(self, api_key: str, model: str, known_tickers: set[str]):
        import openai

        super().__init__(model, known_tickers)
        self._o = openai
        self.client = openai.AsyncOpenAI(api_key=api_key, timeout=45.0, max_retries=1)

    async def _request(self, content: str) -> tuple[str, int, int]:
        o = self._o
        try:
            r = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
                response_format={"type": "json_schema", "json_schema": {"name": "news_analysis", "strict": True, "schema": SCHEMA}},
            )
        except o.AuthenticationError as e:
            raise RuntimeError("неверный OPENAI_API_KEY (401)") from e
        except o.PermissionDeniedError as e:
            raise RuntimeError(f"доступ запрещён (403): {getattr(e, 'message', e)}") from e
        except o.NotFoundError as e:
            raise RuntimeError(f"модель {self.model} недоступна (404)") from e
        except o.RateLimitError as e:
            msg = str(getattr(e, "message", e))
            if "insufficient_quota" in msg or "credits" in msg.lower():
                raise RuntimeError("нет кредитов на аккаунте OpenAI (insufficient_quota) — пополните баланс") from e
            raise RuntimeError(f"лимит запросов OpenAI (429): {msg[:120]}") from e
        except o.BadRequestError as e:
            raise RuntimeError(f"ошибка запроса (400): {getattr(e, 'message', e)}") from e
        except o.APIStatusError as e:
            raise RuntimeError(f"ошибка API {e.status_code}: {getattr(e, 'message', e)}") from e
        except o.APIConnectionError as e:
            raise RuntimeError(f"нет соединения с api.openai.com: {e}") from e
        choice = r.choices[0] if r.choices else None
        if choice is None or (getattr(choice, "finish_reason", "") == "content_filter"):
            raise RuntimeError("пустой или отфильтрованный ответ модели")
        text = choice.message.content or ""
        u = getattr(r, "usage", None)
        return text, int(getattr(u, "prompt_tokens", 0) or 0) if u else 0, int(getattr(u, "completion_tokens", 0) or 0) if u else 0


def merge_results(per_provider: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Combine the answers of several providers for the same batch (confidence-weighted)."""
    by_id: dict[str, list[dict[str, Any]]] = {}
    for results in per_provider:
        for r in results:
            by_id.setdefault(r["id"], []).append(r)
    rank = {"low": 0, "medium": 1, "high": 2}
    out = []
    for rid, rs in by_id.items():
        wsum = sum(r["confidence"] for r in rs)
        score = sum(r["score"] * r["confidence"] for r in rs) / wsum if wsum > 0 else sum(r["score"] for r in rs) / len(rs)
        best = max(rs, key=lambda r: r["confidence"])
        tickers: list[str] = []
        for r in rs:
            for t in r["tickers"]:
                if t not in tickers:
                    tickers.append(t)
        out.append({
            "id": rid, "score": round(score, 3), "confidence": round(sum(r["confidence"] for r in rs) / len(rs), 3),
            "tickers": tickers, "market_wide": any(r["market_wide"] for r in rs),
            "impact": max((r["impact"] for r in rs), key=lambda i: rank.get(i, 0)),
            "reason": best["reason"], "providers": [r["provider"] for r in rs],
        })
    return out


class AnalyzerPool:
    """Feeds every healthy provider the same batches and merges what comes back."""

    def __init__(
        self,
        providers: list[BaseAnalyzer],
        on_result: Callable[[str, dict[str, Any]], Awaitable[None] | None],
        batch_size: int = 12,
        min_interval: float = 1.5,
        max_batch_wait: float = 2.0,
        max_age_minutes: float = 90.0,
    ):
        self.providers = providers
        self.on_result = on_result
        self.batch_size = batch_size
        self.min_interval = min_interval
        self.max_batch_wait = max_batch_wait
        self.max_age_s = max_age_minutes * 60.0
        self.queue: asyncio.Queue[NewsItem] = asyncio.Queue(maxsize=500)
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.items_done = 0
        self.skipped_old = 0
        self.last_call_ts = 0.0

    # compatibility with the single-analyzer interface used elsewhere
    @property
    def disabled_reason(self) -> str:
        if any(p.healthy or not p.disabled_reason for p in self.providers):
            return ""
        return "; ".join(f"{p.name}: {p.disabled_reason}" for p in self.providers)

    @property
    def last_error(self) -> str:
        errs = [p for p in self.providers if p.last_error]
        return "; ".join(f"{p.name}: {p.last_error}" for p in errs) if errs else ""

    @property
    def last_error_ts(self) -> float:
        return max((p.last_error_ts for p in self.providers), default=0.0)

    @property
    def calls(self) -> int:
        return sum(p.calls for p in self.providers)

    def submit(self, item: NewsItem) -> None:
        if item.macro or self.disabled_reason:
            return
        if self.max_age_s > 0 and time.time() - item.ts > self.max_age_s:
            self.skipped_old += 1
            return
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            log.warning("LLM queue full, dropping %s", item.title[:60])

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="llm-pool")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _call(self, p: BaseAnalyzer, batch: list[NewsItem]) -> list[dict[str, Any]]:
        try:
            return await p.analyse(batch)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            p.record_error(e)
            return []

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
            healthy = [p for p in self.providers if p.healthy]
            if not healthy:
                if all(p.disabled_reason for p in self.providers):
                    log.warning("all LLM providers disabled; analysis stopped")
                    return
                await asyncio.sleep(5)
                continue
            gap = self.min_interval - (time.time() - self.last_call_ts)
            if gap > 0:
                await asyncio.sleep(gap)
            self.last_call_ts = time.time()
            results = await asyncio.gather(*(self._call(p, batch) for p in healthy))
            for r in merge_results([x for x in results if x]):
                self.items_done += 1
                try:
                    out = self.on_result(r["id"], r)
                    if asyncio.iscoroutine(out):
                        await out
                except Exception:  # noqa: BLE001
                    log.exception("on_result failed")

    def status(self) -> dict[str, Any]:
        healthy = [p for p in self.providers if p.healthy]
        return {
            "enabled": bool(healthy),
            "active": len(healthy),
            "providers": [p.status() for p in self.providers],
            "model": " + ".join(p.model for p in healthy) or " / ".join(p.model for p in self.providers),
            "calls": self.calls,
            "items": self.items_done,
            "errors": sum(p.errors for p in self.providers),
            "last_error": self.last_error,
            "disabled_reason": self.disabled_reason,
            "queue": self.queue.qsize(),
            "skipped_old": self.skipped_old,
            "latency_ms": round(max((p.last_latency_ms for p in healthy), default=0)),
            "input_tokens": sum(p.input_tokens for p in self.providers),
            "output_tokens": sum(p.output_tokens for p in self.providers),
        }
