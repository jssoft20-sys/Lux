"""Entry point: wires exchange, news, strategy and the dashboard together and serves on PORT (7066)."""

from __future__ import annotations

import asyncio
import logging
import sys
import time
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI

from . import __version__
from .api.app import create_app
from .config import Settings, get_settings
from .context import AppContext
from .events import EventBus
from .exchange.binance import BinanceError, BinanceREST, MarketDataStream
from .exchange.broker import LiveBroker, PaperBroker
from .news.book import NewsItem, SentimentBook
from .news.collector import NewsCollector
from .news.entities import EntityExtractor
from .news.sources import default_sources
from .storage.db import Database
from .strategy.engine import TradingEngine
from .strategy.risk import RiskManager

log = logging.getLogger("lux")


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


async def build_context(cfg: Settings) -> AppContext:
    db = Database(cfg.db_path)
    bus = EventBus(db)
    rest = BinanceREST(cfg.binance_api_key, cfg.binance_api_secret, cfg.binance_api_url, cfg.binance_data_url)
    warnings: list[str] = []

    # --- symbols & trading rules -------------------------------------------------------
    rules = await rest.exchange_info(cfg.symbol_list)
    symbols = []
    for s in cfg.symbol_list:
        r = rules.get(s)
        if r is None:
            warnings.append(f"{s}: нет такой пары на Binance — пропущена")
        elif r.status != "TRADING":
            warnings.append(f"{s}: статус {r.status} — пропущена")
        elif r.quote != cfg.quote_asset:
            warnings.append(f"{s}: котируется в {r.quote}, а не в {cfg.quote_asset} — пропущена")
        else:
            symbols.append(s)
    if not symbols:
        raise SystemExit("Нет ни одной торгуемой пары — проверьте SYMBOLS в .env")
    for w in warnings:
        log.warning(w)

    stream = MarketDataStream(cfg.binance_ws_url, symbols)
    bases = [rules[s].base for s in symbols]
    base_of = {s: rules[s].base for s in symbols}

    # --- news ------------------------------------------------------------------------------
    extractor = EntityExtractor(set(bases) | {"BTC", "ETH"})
    book = SentimentBook(symbols, base_of, cfg.news_half_life_minutes)
    # rebuild the news memory from the database so a restart does not blank the signal
    from .news.collector import JUNK_TERMS

    restored = 0
    for r in db.news_since(time.time() - book.max_age):
        if any(j in r["title"].lower() for j in JUNK_TERMS):
            continue  # junk collected before the filter existed
        book.add(NewsItem(
            id=r["id"], ts=float(r["ts"]), fetched=float(r["ts"]), source=r["source"], title=r["title"], summary=r.get("summary") or "",
            url=r.get("url") or "", tickers=r["tickers"], market_wide=bool(r.get("market_wide")), score=float(r.get("score") or 0.0),
            importance=float(r.get("importance") or 0.3), confidence=0.5, source_weight=float(r.get("source_weight") or 0.8),
            llm_score=r.get("llm_score"), llm_confidence=r.get("llm_confidence"), llm_reason=r.get("llm_reason"), llm_impact=r.get("llm_impact"),
        ))
        restored += 1
    if restored:
        log.info("news memory restored: %d items", restored)
    llm = None
    if cfg.llm_active:
        from .news.llm import AnalyzerPool, ClaudeAnalyzer, OpenAIAnalyzer

        async def on_llm(item_id: str, r: dict[str, Any]) -> None:
            it = book.update_llm(item_id, r["score"], r["confidence"], r["reason"], r["impact"], r["tickers"], r["market_wide"])
            if it is not None:
                db.update_news_llm(item_id, r["score"], r["confidence"], r["reason"], r["impact"], it.tickers)
                bus.publish("news_update", it.to_dict())

        known = set(bases) | {"BTC", "ETH"}
        providers: list[Any] = []
        for name in cfg.provider_list:
            if name == "anthropic":
                providers.append(ClaudeAnalyzer(cfg.anthropic_api_key, cfg.llm_model, known))
            elif name == "openai":
                providers.append(OpenAIAnalyzer(cfg.openai_api_key, cfg.openai_model, known))
        llm = AnalyzerPool(providers, on_llm, cfg.llm_batch_size, cfg.llm_min_interval_seconds, cfg.llm_max_batch_wait_seconds, cfg.llm_max_age_minutes)
        log.info("LLM providers: %s", ", ".join(f"{p.name}={p.model}" for p in providers))
    else:
        warnings.append("Ключи ИИ не заданы (ANTHROPIC_API_KEY / OPENAI_API_KEY) — работает только лексический анализ новостей")

    def on_item(item: NewsItem) -> None:
        book.add(item)
        if not item.macro:
            db.add_news({"id": item.id, "ts": item.ts, "source": item.source, "title": item.title, "url": item.url, "tickers": item.tickers, "score": item.score, "importance": item.importance, "market_wide": item.market_wide, "summary": item.summary, "source_weight": item.source_weight})
            bus.publish("news", item.to_dict())
            if llm is not None:
                llm.submit(item)
        else:
            bus.publish("macro", item.to_dict())

    sources = default_sources(bases, cfg.cryptopanic_token, cfg.newsapi_key, cfg.extra_rss)
    collector = NewsCollector(sources, extractor, on_item, seen=db.news_ids(since=time.time() - 3 * 86400))

    # --- broker ----------------------------------------------------------------------------
    account_info: dict[str, Any] = {}
    if cfg.live:
        if not cfg.binance_api_key or not cfg.binance_api_secret:
            raise SystemExit("TRADING_MODE=live, но BINANCE_API_KEY / BINANCE_API_SECRET не заданы")
        broker: Any = LiveBroker(rest, {s: rules[s] for s in symbols}, cfg.quote_asset)
        account_info = await verify_live_account(cfg, rest, symbols, rules, warnings)
    else:
        broker = PaperBroker(stream.states, {s: rules[s] for s in symbols}, cfg.quote_asset, cfg.paper_start_balance, cfg.fee_rate, cfg.paper_slippage_bps)
        account_info = {"mode": "paper", "start_balance": cfg.paper_start_balance}
        if cfg.binance_api_key and cfg.binance_api_secret:
            # read-only: lets the dashboard prove the key works before anyone switches to live
            await refresh_real_account(cfg, rest, account_info, warnings, first=True)

    risk = RiskManager(cfg)
    engine = TradingEngine(cfg, broker, stream.states, {s: rules[s] for s in symbols}, book, db, risk, bus)
    if cfg.live:
        for s in symbols:
            if s in account_info.get("blocked", {}):
                risk.blocked[s] = (float("inf"), account_info["blocked"][s])
    return AppContext(cfg=cfg, db=db, bus=bus, rest=rest, rules=rules, stream=stream, book=book, collector=collector, broker=broker, engine=engine, llm=llm, account_info=account_info, warnings=warnings)


async def refresh_real_account(cfg: Settings, rest: BinanceREST, info: dict[str, Any], warnings: list[str], first: bool = False) -> None:
    """Paper mode with a key configured: read the real balances (no orders) for the dashboard."""
    try:
        if first:
            await rest.sync_time()
        bal = await rest.balances()
        info["real_balances"] = {a: f for a, (f, _l) in bal.items() if f > 0}
        info["real_quote_free"] = bal.get(cfg.quote_asset, (0.0, 0.0))[0]
        info["real_checked_ts"] = time.time()
        info["real_error"] = ""
        if first:
            log.info("Binance key OK (read-only check): %.4f %s free on the real account", info["real_quote_free"], cfg.quote_asset)
    except BinanceError as e:
        info["real_error"] = e.msg
        if first:
            warnings.append(f"Ключ Binance задан, но аккаунт прочитать не удалось: {e.msg}")


async def account_watch(ctx: AppContext) -> None:
    """Keeps the real-account figures in the dashboard fresh (every 2 minutes)."""
    while True:
        await asyncio.sleep(120)
        try:
            if ctx.cfg.live:
                ctx.account_info["balances"] = await ctx.broker.balances()
                ctx.account_info["quote_free"] = ctx.account_info["balances"].get(ctx.cfg.quote_asset, 0.0)
            else:
                await refresh_real_account(ctx.cfg, ctx.rest, ctx.account_info, ctx.warnings)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("account watch: %s", e)


async def verify_live_account(cfg: Settings, rest: BinanceREST, symbols: list[str], rules: dict, warnings: list[str]) -> dict[str, Any]:
    """Checks the API key really can trade before a single real order is sent."""
    info: dict[str, Any] = {"mode": "live"}
    await rest.sync_time()
    try:
        bal = await rest.balances()
    except BinanceError as e:
        raise SystemExit(f"Не удалось прочитать аккаунт Binance: {e.msg}. Проверьте ключ/секрет, IP-ограничения и гео-доступ сервера.") from e
    quote_free = bal.get(cfg.quote_asset, (0.0, 0.0))[0]
    info["quote_free"] = quote_free
    info["balances"] = {a: f for a, (f, _l) in bal.items() if f > 0}
    log.info("Binance account OK: %.4f %s free", quote_free, cfg.quote_asset)
    try:
        restr = await rest.api_restrictions()
        info["restrictions"] = restr
        if not restr.get("enableSpotAndMarginTrading"):
            raise SystemExit("У API-ключа выключена спотовая торговля (Enable Spot & Margin Trading)")
        if restr.get("enableWithdrawals"):
            warnings.append("У ключа включён вывод средств — отключите его в настройках Binance")
        if not restr.get("ipRestrict"):
            log.warning("API key has no IP restriction; consider allowing only this server's IP")
    except BinanceError as e:
        warnings.append(f"не удалось прочитать ограничения ключа: {e.msg}")
    # test orders: detect symbols outside the key's whitelist without spending anything
    blocked: dict[str, str] = {}
    sem = asyncio.Semaphore(4)

    async def probe(sym: str) -> None:
        async with sem:
            try:
                await rest.market_buy(sym, float(rules[sym].min_notional) * 1.05, test=True)
            except BinanceError as e:
                m = e.msg.lower()
                if "insufficient" in m:  # allowed, just no money yet
                    return
                if e.symbol_blocked or e.code in (-2010, -1013, -1121):
                    blocked[sym] = e.msg
                else:
                    log.warning("test order %s: %s", sym, e.msg)

    await asyncio.gather(*(probe(s) for s in symbols))
    for s, why in blocked.items():
        warnings.append(f"{s}: не разрешена для этого ключа ({why}) — исключена")
    info["blocked"] = blocked
    info["tradable"] = [s for s in symbols if s not in blocked]
    if quote_free < 5:
        warnings.append(f"На счёте {quote_free:.2f} {cfg.quote_asset} — для сделки нужно минимум ~5.25 {cfg.quote_asset}")
    return info


async def seed_history(ctx: AppContext) -> None:
    """Load the last 15 one-minute candles per symbol so momentum works from the first tick."""
    sem = asyncio.Semaphore(5)

    async def one(sym: str) -> None:
        async with sem:
            try:
                kl = await ctx.rest.klines(sym, "1m", 16)
            except BinanceError as e:
                log.warning("klines %s: %s", sym, e.msg)
                return
            samples = [(float(k[6]), float(k[4])) for k in kl[:-1]]  # (close time ms, close price)
            ctx.stream.states[sym].seed_prices(samples)

    await asyncio.gather(*(one(s) for s in ctx.engine.symbols))


def create_application(cfg: Settings | None = None) -> FastAPI:
    cfg = cfg or get_settings()
    setup_logging(cfg.log_level)
    holder: dict[str, Any] = {"ctx": None}

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        # Everything is built inside the server's event loop so HTTP/WS clients are bound to it.
        ctx = await build_context(cfg)
        holder["ctx"] = ctx
        tasks = [asyncio.create_task(ctx.stream.run(), name="market-stream")]
        await seed_history(ctx)
        # wait (briefly) for the first order-book updates so paper fills have prices
        for _ in range(50):
            if any(s.mid > 0 for s in ctx.stream.states.values()):
                break
            await asyncio.sleep(0.1)
        await ctx.broker.start()
        await ctx.collector.start()
        if ctx.llm is not None:
            await ctx.llm.start()
        await ctx.engine.start()
        if cfg.binance_api_key and cfg.binance_api_secret:
            tasks.append(asyncio.create_task(account_watch(ctx), name="account-watch"))
        for w in ctx.warnings:
            ctx.bus.log(w, level="warn")
        ai = f"{len(ctx.llm.providers)} провайдер(а)" if ctx.llm else "выкл"
        ctx.bus.log(f"Continental BOT {__version__} готов: http://{cfg.host}:{cfg.port}  режим={cfg.trading_mode.upper()}  пар={len(ctx.engine.symbols)}  источников={len(ctx.collector.sources)}  ИИ={ai}  скальп={'вкл' if cfg.scalp_mode else 'выкл'}")
        try:
            yield
        finally:
            await ctx.engine.stop()
            if ctx.llm is not None:
                await ctx.llm.stop()
            await ctx.collector.stop()
            ctx.stream.stop()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await ctx.rest.close()
            ctx.db.close()

    app = create_app(cfg, lambda: holder["ctx"])
    app.router.lifespan_context = lifespan
    return app


def main() -> None:
    cfg = get_settings()
    app = create_application(cfg)
    if cfg.live:
        log.warning("=" * 70)
        log.warning("  РЕЖИМ LIVE: бот будет отправлять РЕАЛЬНЫЕ ордера на ваш счёт Binance")
        log.warning("=" * 70)
    if not cfg.dashboard_password:
        log.warning("DASHBOARD_PASSWORD не задан — дашборд открыт для всех, кто видит порт %d", cfg.port)
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="warning", access_log=False, ws_ping_interval=20, ws_ping_timeout=20)


if __name__ == "__main__":
    main()
