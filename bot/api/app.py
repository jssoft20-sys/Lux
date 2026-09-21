"""HTTP + WebSocket API and the dashboard static files."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import secrets
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..config import Settings
from ..context import AppContext

log = logging.getLogger("lux.api")
STATIC_DIR = Path(__file__).parent / "static"


def _auth_ok(cfg: Settings, header: str | None) -> bool:
    pwd = cfg.dashboard_password
    if not pwd:
        return True
    if not header or not header.lower().startswith("basic "):
        return False
    try:
        user, _, password = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8", "ignore").partition(":")
    except Exception:  # noqa: BLE001
        return False
    return secrets.compare_digest(user, cfg.dashboard_user) and secrets.compare_digest(password, pwd)


# Safari/iOS does not send Basic-auth credentials on WebSocket handshakes, so the page fetches a
# short-lived token over an authenticated GET and passes it as ?token= on the socket URL.
_WS_SECRET = secrets.token_bytes(32)


def make_ws_token(ttl: int = 3600) -> str:
    exp = str(int(time.time()) + ttl)
    return exp + "." + hmac.new(_WS_SECRET, exp.encode(), hashlib.sha256).hexdigest()[:32]


def check_ws_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(sig, hmac.new(_WS_SECRET, exp.encode(), hashlib.sha256).hexdigest()[:32])


def dynamic_warnings(ctx: AppContext) -> list[str]:
    out = list(ctx.warnings)
    now = time.time()
    if ctx.llm is not None:
        for p in ctx.llm.providers:
            if p.disabled_reason:
                short = "регион сервера не поддерживается" if "403" in p.disabled_reason else p.disabled_reason
                out.append(f"ИИ {p.name} ({p.model}) отключён: {short}")
            elif p.last_error and (p.calls == 0 or now - p.last_error_ts < 900):
                out.append(f"ИИ {p.name}: {p.last_error}")
        if all(p.disabled_reason for p in ctx.llm.providers):
            out.append("Все ИИ отключены — торговля идёт по лексическому анализу новостей")
    if not ctx.stream.connected:
        out.append("Нет потока Binance: " + (ctx.stream.last_error or "переподключение…"))
    eng = ctx.engine
    if eng.broker.mode == "live" and eng.last_quote_balance and not eng.portfolio.positions:
        min_needed = max((float(r.min_notional) for s, r in ctx.rules.items() if s in eng.symbols), default=5.0) * 1.05
        if eng.last_quote_balance < min_needed:
            out.append(f"Свободно {eng.last_quote_balance:.2f} {ctx.cfg.quote_asset} — меньше минимума сделки {min_needed:.2f}")
    return out


def build_snapshot(ctx: AppContext) -> dict[str, Any]:
    eng = ctx.engine
    bids = {s: ctx.stream.states[s].bid for s in eng.portfolio.positions if s in ctx.stream.states}
    signals = sorted((s.to_dict() for s in eng.signals.values()), key=lambda d: d["composite"], reverse=True)
    for d in signals:
        d["decision"] = eng.decisions.get(d["symbol"], "")
        d["in_position"] = d["symbol"] in eng.portfolio.positions
    return {
        "ts": time.time(),
        "status": eng.status(),
        "market": {
            "connected": ctx.stream.connected,
            "messages": ctx.stream.messages,
            "reconnects": ctx.stream.reconnects,
            "last_msg_age_ms": round(time.time() * 1000 - ctx.stream.last_msg_ms) if ctx.stream.last_msg_ms else None,
            "error": ctx.stream.last_error,
        },
        "news": {
            "items": ctx.collector.total_items,
            "sources": len(ctx.collector.sources),
            "sources_ok": sum(1 for s in ctx.collector.sources if s.last_ok and not s.last_error),
            "last_item_age_s": round(time.time() - ctx.collector.last_item_ts) if ctx.collector.last_item_ts else None,
            "fng": ctx.book.fng,
            "market_score": ctx.book.market_score(),
            "in_book": len(ctx.book.items),
        },
        "llm": ctx.llm.status() if ctx.llm else {"enabled": False, "model": ctx.cfg.llm_model},
        "account": {k: v for k, v in ctx.account_info.items() if k in ("mode", "quote_free", "real_quote_free", "real_checked_ts", "real_error", "tradable", "blocked")},
        "positions": eng.portfolio.snapshot(bids),
        "signals": signals,
        "warnings": dynamic_warnings(ctx),
    }


CONFIG_KEYS = (
    "trading_mode", "quote_asset", "position_size_usdt", "max_position_pct", "max_positions", "take_profit_pct",
    "stop_loss_pct", "trailing_stop_pct", "trailing_activation_pct", "max_hold_minutes", "min_hold_seconds", "buy_threshold", "exit_threshold", "min_news_score",
    "daily_loss_limit_usdt", "max_spread_bps", "decision_interval_ms", "news_half_life_minutes", "w_news", "w_momentum",
    "w_orderbook", "w_flow", "w_smc", "llm_model", "openai_model", "news_poll_seconds", "scalp_mode", "fee_multiple", "scalp_max_hold_minutes", "fee_rate",
    "strategy", "smc_min_rr", "smc_max_hold_minutes", "partial_tp_pct", "risk_per_trade_pct", "risk_reduced_pct", "daily_drawdown_pct", "weekly_drawdown_pct",
    "stop_after_loss_in_session", "ott_windows", "ott_only",
)


def create_app(cfg: Settings, get_ctx: Callable[[], AppContext]) -> FastAPI:
    """``get_ctx`` is resolved lazily: the context is built inside the server's event loop (lifespan)."""
    app = FastAPI(title="Continental BOT", version=__version__, docs_url=None, redoc_url=None)

    def ctx() -> AppContext:
        c = get_ctx()
        if c is None:
            raise HTTPException(503, "бот ещё запускается")
        return c

    @app.middleware("http")
    async def _basic_auth(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path.startswith("/api/health"):
            return await call_next(request)
        if not _auth_ok(cfg, request.headers.get("authorization")):
            return Response("Требуется авторизация", status_code=401, headers={"WWW-Authenticate": 'Basic realm="Continental BOT"'})
        resp = await call_next(request)
        # never let a phone cache a stale dashboard build after an update
        if request.url.path.startswith("/static") or request.url.path == "/":
            resp.headers["Cache-Control"] = "no-cache, must-revalidate"
        return resp

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        c = get_ctx()
        return {"ok": True, "version": __version__, "mode": cfg.trading_mode, "ready": c is not None and c.engine.running, "ts": time.time()}

    @app.get("/api/status")
    async def status() -> dict[str, Any]:
        c = ctx()
        snap = build_snapshot(c)
        snap["account"] = c.account_info
        snap["config"] = {k: getattr(cfg, k) for k in CONFIG_KEYS}
        fees = c.engine.risk.fees
        snap["config"].update({"fee_round_trip_pct": round(fees.round_trip_pct, 3), "scalp_target_pct": round(fees.target_pct(0), 3), "scalp_stop_pct": round(fees.stop_pct(fees.target_pct(0)), 3)})
        snap["version"] = __version__
        return snap

    @app.get("/api/signals")
    async def signals() -> list[dict[str, Any]]:
        return build_snapshot(ctx())["signals"]

    @app.get("/api/positions")
    async def positions() -> list[dict[str, Any]]:
        return build_snapshot(ctx())["positions"]

    @app.get("/api/ws-token")
    async def ws_token() -> dict[str, Any]:
        return {"token": make_ws_token(), "ttl": 3600}

    @app.get("/api/trades")
    async def trades(limit: int = 100) -> dict[str, Any]:
        c = ctx()
        mode = c.engine.broker.mode
        midnight = c.engine._midnight()
        return {"mode": mode, "trades": c.db.trades(limit=min(limit, 1000), mode=mode), "today": c.db.trade_stats(since=midnight, mode=mode), "all": c.db.trade_stats(mode=mode)}

    @app.get("/api/news")
    async def news(limit: int = 80) -> list[dict[str, Any]]:
        return ctx().book.recent(limit=min(limit, 300))

    @app.get("/api/sources")
    async def sources() -> list[dict[str, Any]]:
        return ctx().collector.status()

    @app.get("/api/equity")
    async def equity(hours: float = 24) -> list[dict[str, Any]]:
        since = time.time() - hours * 3600 if hours > 0 else None
        c = ctx()
        rows = c.db.equity(since=since, limit=20000, mode=c.engine.broker.mode)
        step = max(1, len(rows) // 1500)  # keep the chart light
        return rows[::step] if step > 1 else rows

    @app.get("/api/events")
    async def events(limit: int = 100) -> list[dict[str, Any]]:
        return ctx().db.events(limit=min(limit, 500))

    @app.get("/api/balances")
    async def balances() -> dict[str, Any]:
        try:
            return {"balances": await ctx().broker.balances()}
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, str(e)) from e

    # ---- controls ----
    @app.post("/api/control/pause")
    async def pause() -> dict[str, Any]:
        ctx().engine.pause()
        return {"ok": True, "paused": True}

    @app.post("/api/control/resume")
    async def resume() -> dict[str, Any]:
        ctx().engine.resume()
        return {"ok": True, "paused": False}

    @app.post("/api/control/close_all")
    async def close_all() -> dict[str, Any]:
        n = await ctx().engine.close_all()
        return {"ok": True, "closed": n}

    @app.post("/api/control/close/{symbol}")
    async def close_one(symbol: str) -> dict[str, Any]:
        ok = await ctx().engine.close_position(symbol.upper())
        return {"ok": ok}

    @app.post("/api/control/reset_halt")
    async def reset_halt() -> dict[str, Any]:
        ctx().engine.reset_halt()
        return {"ok": True}

    # ---- live stream ----
    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        if not (_auth_ok(cfg, ws.headers.get("authorization")) or check_ws_token(ws.query_params.get("token"))):
            await ws.close(code=1008)
            return
        await ws.accept()
        c = get_ctx()
        if c is None:
            await ws.close(code=1013)
            return
        q = c.bus.subscribe()
        try:
            await ws.send_json({"kind": "snapshot", "data": build_snapshot(c)})
            last_snap = time.monotonic()
            while True:
                timeout = max(0.05, 1.0 - (time.monotonic() - last_snap))
                try:
                    ev = await asyncio.wait_for(q.get(), timeout)
                    await ws.send_json(ev)
                except asyncio.TimeoutError:
                    pass
                if time.monotonic() - last_snap >= 1.0:
                    await ws.send_json({"kind": "snapshot", "data": build_snapshot(c)})
                    last_snap = time.monotonic()
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception:  # noqa: BLE001
            log.exception("websocket error")
        finally:
            c.bus.unsubscribe(q)

    @app.exception_handler(Exception)
    async def _err(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled API error")
        return JSONResponse({"error": str(exc)}, status_code=500)

    return app
