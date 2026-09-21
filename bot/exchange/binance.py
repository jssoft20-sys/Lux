"""Binance Spot connectivity.

* ``BinanceREST``   — signed private endpoints (account, orders) on the main API host and
                      public market data on the data host (does not consume order-API weight).
* ``MarketDataStream`` — WebSocket feed (bookTicker / aggTrade / miniTicker) that keeps a
                      millisecond-fresh ``MarketState`` per symbol with rolling windows for
                      momentum, order-book imbalance, taker flow and volatility.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import math
import statistics
import time
from collections import deque
from dataclasses import dataclass, field
from decimal import ROUND_DOWN, Decimal
from typing import Any, Callable, Iterable

import httpx
import websockets

log = logging.getLogger("lux.binance")


class BinanceError(Exception):
    def __init__(self, code: int | None, msg: str, status: int | None = None):
        super().__init__(f"Binance error {code}: {msg}")
        self.code = code
        self.msg = msg
        self.status = status

    # Errors that mean "this symbol cannot be traded with this key" (whitelist / permissions)
    @property
    def symbol_blocked(self) -> bool:
        m = self.msg.lower()
        return any(k in m for k in ("not permitted", "whitelist", "not allowed", "restricted", "permission"))


# ----------------------------------------------------------------------------- symbol rules
@dataclass
class SymbolRules:
    symbol: str
    base: str
    quote: str
    step_size: Decimal
    min_qty: Decimal
    tick_size: Decimal
    min_notional: Decimal
    status: str = "TRADING"
    quote_order_qty_market_allowed: bool = True

    @classmethod
    def from_info(cls, s: dict[str, Any]) -> "SymbolRules":
        f = {x["filterType"]: x for x in s.get("filters", [])}
        lot = f.get("LOT_SIZE", {})
        mlot = f.get("MARKET_LOT_SIZE", {})
        notional = f.get("NOTIONAL", f.get("MIN_NOTIONAL", {}))
        step = Decimal(lot.get("stepSize", "0.00000001"))
        min_qty = Decimal(lot.get("minQty", "0"))
        if mlot:
            # market orders must also satisfy MARKET_LOT_SIZE (stepSize may be 0 = unrestricted)
            mstep = Decimal(mlot.get("stepSize", "0"))
            if mstep > 0:
                step = max(step, mstep)
            min_qty = max(min_qty, Decimal(mlot.get("minQty", "0")))
        return cls(
            symbol=s["symbol"],
            base=s["baseAsset"],
            quote=s["quoteAsset"],
            step_size=step,
            min_qty=min_qty,
            tick_size=Decimal(f.get("PRICE_FILTER", {}).get("tickSize", "0.00000001")),
            min_notional=Decimal(notional.get("minNotional", "5")),
            status=s.get("status", "TRADING"),
            quote_order_qty_market_allowed=bool(s.get("quoteOrderQtyMarketAllowed", True)),
        )

    def round_qty(self, qty: float | Decimal) -> float:
        """Round DOWN to the lot step (so we never try to sell more than we hold)."""
        q = Decimal(str(qty))
        if self.step_size <= 0:
            return float(q)
        steps = (q / self.step_size).to_integral_value(rounding=ROUND_DOWN)
        return float(steps * self.step_size)

    def round_price(self, price: float) -> float:
        p = Decimal(str(price))
        if self.tick_size <= 0:
            return float(p)
        return float((p / self.tick_size).to_integral_value(rounding=ROUND_DOWN) * self.tick_size)

    def qty_ok(self, qty: float, price: float) -> bool:
        return Decimal(str(qty)) >= self.min_qty and Decimal(str(qty * price)) >= self.min_notional

    @property
    def qty_decimals(self) -> int:
        return max(0, -self.step_size.normalize().as_tuple().exponent)

    def fmt_qty(self, qty: float) -> str:
        return f"{qty:.{self.qty_decimals}f}"


# ----------------------------------------------------------------------------- REST client
class BinanceREST:
    """Thin async client for the subset of Binance Spot REST we need."""

    def __init__(
        self,
        api_key: str = "",
        api_secret: str = "",
        api_url: str = "https://api.binance.com",
        data_url: str = "https://data-api.binance.vision",
        timeout: float = 10.0,
        recv_window: int = 5000,
    ):
        self.api_key = api_key or ""
        self.api_secret = (api_secret or "").encode()
        self.api_url = api_url.rstrip("/")
        self.data_url = (data_url or api_url).rstrip("/")
        self.recv_window = recv_window
        self._time_offset_ms = 0
        headers = {"User-Agent": "LuxBot/1.0"}
        if self.api_key:
            headers["X-MBX-APIKEY"] = self.api_key
        self._client = httpx.AsyncClient(timeout=timeout, headers=headers)
        self.last_latency_ms: float = 0.0

    async def close(self) -> None:
        await self._client.aclose()

    # ---- helpers ------------------------------------------------------------------------
    def _sign(self, params: dict[str, Any]) -> str:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return hmac.new(self.api_secret, query.encode(), hashlib.sha256).hexdigest()

    def _timestamp(self) -> int:
        return int(time.time() * 1000) + self._time_offset_ms

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        signed: bool = False,
        base: str | None = None,
        _retry: bool = True,
    ) -> Any:
        base = base or (self.api_url if signed else self.data_url)
        params = {k: v for k, v in (params or {}).items() if v is not None}
        if signed:
            if not self.api_key or not self.api_secret:
                raise BinanceError(None, "API key/secret not configured")
            params["timestamp"] = self._timestamp()
            params["recvWindow"] = self.recv_window
            params["signature"] = self._sign(params)
        t0 = time.perf_counter()
        try:
            r = await self._client.request(method, base + path, params=params)
        except httpx.HTTPError as e:  # network problems
            raise BinanceError(None, f"network error: {e}") from e
        self.last_latency_ms = (time.perf_counter() - t0) * 1000
        if r.status_code == 200:
            return r.json()
        try:
            body = r.json()
            code, msg = body.get("code"), body.get("msg", r.text)
        except ValueError:
            code, msg = None, r.text[:300]
        if r.status_code == 451:
            msg = "HTTP 451: Binance is not available from this server's location (geo-block)"
        # clock drift -> resync once and retry
        if code == -1021 and signed and _retry:
            await self.sync_time()
            return await self._request(method, path, {k: v for k, v in params.items() if k not in ("timestamp", "recvWindow", "signature")}, signed=True, base=base, _retry=False)
        raise BinanceError(code, str(msg), status=r.status_code)

    # ---- public market data ---------------------------------------------------------------
    async def ping(self) -> bool:
        await self._request("GET", "/api/v3/ping")
        return True

    async def sync_time(self) -> int:
        local = int(time.time() * 1000)
        data = await self._request("GET", "/api/v3/time")
        self._time_offset_ms = int(data["serverTime"]) - local
        return self._time_offset_ms

    async def exchange_info(self, symbols: Iterable[str] | None = None) -> dict[str, SymbolRules]:
        params = None
        if symbols:
            params = {"symbols": json.dumps([s.upper() for s in symbols], separators=(",", ":"))}
        try:
            data = await self._request("GET", "/api/v3/exchangeInfo", params)
        except BinanceError as e:
            if symbols and e.code in (-1121, -1100):
                # one of the symbols is invalid -> fetch everything and filter
                data = await self._request("GET", "/api/v3/exchangeInfo")
                wanted = {s.upper() for s in symbols}
                data["symbols"] = [s for s in data["symbols"] if s["symbol"] in wanted]
            else:
                raise
        return {s["symbol"]: SymbolRules.from_info(s) for s in data["symbols"]}

    async def ticker_prices(self, symbols: Iterable[str] | None = None) -> dict[str, float]:
        params = None
        if symbols:
            params = {"symbols": json.dumps([s.upper() for s in symbols], separators=(",", ":"))}
        data = await self._request("GET", "/api/v3/ticker/price", params)
        if isinstance(data, dict):
            data = [data]
        return {d["symbol"]: float(d["price"]) for d in data}

    async def book_tickers(self, symbols: Iterable[str]) -> dict[str, dict[str, float]]:
        params = {"symbols": json.dumps([s.upper() for s in symbols], separators=(",", ":"))}
        data = await self._request("GET", "/api/v3/ticker/bookTicker", params)
        return {
            d["symbol"]: {"bid": float(d["bidPrice"]), "ask": float(d["askPrice"]), "bid_qty": float(d["bidQty"]), "ask_qty": float(d["askQty"])}
            for d in data
        }

    async def klines(self, symbol: str, interval: str = "1m", limit: int = 60) -> list[list[Any]]:
        return await self._request("GET", "/api/v3/klines", {"symbol": symbol.upper(), "interval": interval, "limit": limit})

    # ---- private ------------------------------------------------------------------------
    async def account(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v3/account", {"omitZeroBalances": "true"}, signed=True)

    async def balances(self) -> dict[str, tuple[float, float]]:
        acc = await self.account()
        return {b["asset"]: (float(b["free"]), float(b["locked"])) for b in acc.get("balances", [])}

    async def api_restrictions(self) -> dict[str, Any]:
        return await self._request("GET", "/sapi/v1/account/apiRestrictions", signed=True)

    async def market_buy(self, symbol: str, quote_qty: float, test: bool = False) -> dict[str, Any]:
        path = "/api/v3/order/test" if test else "/api/v3/order"
        return await self._request(
            "POST",
            path,
            {"symbol": symbol.upper(), "side": "BUY", "type": "MARKET", "quoteOrderQty": f"{quote_qty:.2f}", "newOrderRespType": "FULL"},
            signed=True,
        )

    async def market_sell(self, symbol: str, qty_str: str, test: bool = False) -> dict[str, Any]:
        path = "/api/v3/order/test" if test else "/api/v3/order"
        return await self._request(
            "POST",
            path,
            {"symbol": symbol.upper(), "side": "SELL", "type": "MARKET", "quantity": qty_str, "newOrderRespType": "FULL"},
            signed=True,
        )

    async def my_trades(self, symbol: str, limit: int = 50) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/v3/myTrades", {"symbol": symbol.upper(), "limit": limit}, signed=True)

    async def open_orders(self, symbol: str | None = None) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/v3/openOrders", {"symbol": symbol.upper() if symbol else None}, signed=True)


# ----------------------------------------------------------------------------- market state
_SAMPLE_EVERY_MS = 250  # bounded price history: one sample per 250 ms
_HISTORY_SECONDS = 15 * 60
_TRADE_WINDOW_SECONDS = 120


@dataclass
class MarketState:
    symbol: str
    bid: float = 0.0
    ask: float = 0.0
    bid_qty: float = 0.0
    ask_qty: float = 0.0
    last: float = 0.0
    updated_ms: float = 0.0
    day_open: float = 0.0
    day_high: float = 0.0
    day_low: float = 0.0
    day_quote_volume: float = 0.0
    prices: deque = field(default_factory=lambda: deque(maxlen=_HISTORY_SECONDS * 1000 // _SAMPLE_EVERY_MS))
    trades: deque = field(default_factory=lambda: deque(maxlen=20000))
    _last_sample_ms: float = 0.0

    # -- feed updates --
    def on_book(self, bid: float, ask: float, bid_qty: float, ask_qty: float) -> None:
        self.bid, self.ask, self.bid_qty, self.ask_qty = bid, ask, bid_qty, ask_qty
        now = time.time() * 1000
        self.updated_ms = now
        if bid > 0 and ask > 0 and now - self._last_sample_ms >= _SAMPLE_EVERY_MS:
            self.prices.append((now, (bid + ask) / 2))
            self._last_sample_ms = now

    def on_trade(self, price: float, qty: float, buyer_is_maker: bool, ts_ms: float) -> None:
        self.last = price
        self.trades.append((ts_ms, price * qty, buyer_is_maker))
        self.updated_ms = max(self.updated_ms, time.time() * 1000)
        if self.bid == 0:  # before first book update
            self.bid = self.ask = price

    def on_mini_ticker(self, open_: float, high: float, low: float, quote_vol: float) -> None:
        self.day_open, self.day_high, self.day_low, self.day_quote_volume = open_, high, low, quote_vol

    def seed_prices(self, samples: list[tuple[float, float]]) -> None:
        """Seed history from klines so momentum works right after start."""
        for ts, px in samples:
            self.prices.append((ts, px))

    # -- derived features --
    @property
    def mid(self) -> float:
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        return self.last

    @property
    def fresh(self) -> bool:
        return self.updated_ms > 0 and (time.time() * 1000 - self.updated_ms) < 15_000

    @property
    def age_ms(self) -> float:
        return time.time() * 1000 - self.updated_ms if self.updated_ms else float("inf")

    def spread_bps(self) -> float:
        m = self.mid
        if m <= 0 or self.bid <= 0 or self.ask <= 0:
            return float("inf")
        return (self.ask - self.bid) / m * 1e4

    def price_ago(self, seconds: float) -> float | None:
        if not self.prices:
            return None
        cutoff = time.time() * 1000 - seconds * 1000
        # deque is time ordered; walk from the oldest until we pass the cutoff
        best = None
        for ts, px in self.prices:
            if ts <= cutoff:
                best = px
            else:
                break
        return best

    def momentum_pct(self, seconds: float) -> float:
        """% change of mid vs `seconds` ago (0 if not enough history)."""
        old = self.price_ago(seconds)
        m = self.mid
        if not old or m <= 0:
            return 0.0
        return (m / old - 1.0) * 100.0

    def imbalance(self) -> float:
        tot = self.bid_qty + self.ask_qty
        if tot <= 0:
            return 0.0
        return (self.bid_qty - self.ask_qty) / tot

    def flow(self, seconds: float = 60) -> float:
        """Taker buy ratio in [-1, 1] over the last `seconds` (aggTrades)."""
        cutoff = time.time() * 1000 - seconds * 1000
        buy = sell = 0.0
        for ts, notional, buyer_is_maker in reversed(self.trades):
            if ts < cutoff:
                break
            if buyer_is_maker:
                sell += notional  # taker sold into the bid
            else:
                buy += notional
        tot = buy + sell
        return (buy - sell) / tot if tot > 0 else 0.0

    def volume_quote(self, seconds: float = 60) -> float:
        cutoff = time.time() * 1000 - seconds * 1000
        return sum(n for ts, n, _ in reversed(self.trades) if ts >= cutoff)

    def volatility_bps(self, seconds: float = 300) -> float:
        cutoff = time.time() * 1000 - seconds * 1000
        pts = [px for ts, px in self.prices if ts >= cutoff]
        if len(pts) < 5:
            return 0.0
        rets = [(b / a - 1.0) * 1e4 for a, b in zip(pts, pts[1:]) if a > 0]
        return statistics.pstdev(rets) * math.sqrt(len(rets)) if rets else 0.0

    def day_change_pct(self) -> float:
        return (self.mid / self.day_open - 1) * 100 if self.day_open > 0 and self.mid > 0 else 0.0


# ----------------------------------------------------------------------------- WebSocket
class MarketDataStream:
    """Combined-stream WebSocket that feeds ``MarketState`` objects. Auto-reconnects."""

    def __init__(self, ws_url: str, symbols: list[str], on_update: Callable[[MarketState], None] | None = None):
        self.ws_url = ws_url.rstrip("/")
        self.symbols = [s.upper() for s in symbols]
        self.states: dict[str, MarketState] = {s: MarketState(s) for s in self.symbols}
        self.on_update = on_update
        self.connected = False
        self.messages = 0
        self.reconnects = 0
        self.last_msg_ms = 0.0
        self.last_error: str = ""
        self._stop = asyncio.Event()

    def _url(self) -> str:
        streams = []
        for s in self.symbols:
            ls = s.lower()
            streams += [f"{ls}@bookTicker", f"{ls}@aggTrade", f"{ls}@miniTicker"]
        return f"{self.ws_url}/stream?streams={'/'.join(streams)}"

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(self._url(), ping_interval=20, ping_timeout=20, max_queue=4096, open_timeout=15) as ws:
                    self.connected = True
                    backoff = 1.0
                    log.info("market stream connected (%d symbols)", len(self.symbols))
                    async for raw in ws:
                        self._handle(raw)
                        if self._stop.is_set():
                            break
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.last_error = f"{type(e).__name__}: {e}"
                log.warning("market stream error: %s (reconnect in %.0fs)", self.last_error, backoff)
            self.connected = False
            self.reconnects += 1
            if self._stop.is_set():
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def _handle(self, raw: str | bytes) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        data = msg.get("data") if isinstance(msg, dict) else None
        if not data:
            return
        self.messages += 1
        self.last_msg_ms = time.time() * 1000
        sym = data.get("s")
        st = self.states.get(sym)
        if st is None:
            return
        ev = data.get("e")
        if ev is None and "b" in data and "a" in data:  # bookTicker has no "e"
            st.on_book(float(data["b"]), float(data["a"]), float(data["B"]), float(data["A"]))
        elif ev == "aggTrade":
            st.on_trade(float(data["p"]), float(data["q"]), bool(data.get("m")), float(data.get("T", time.time() * 1000)))
        elif ev == "24hrMiniTicker":
            st.on_mini_ticker(float(data["o"]), float(data["h"]), float(data["l"]), float(data["q"]))
        else:
            return
        if self.on_update:
            self.on_update(st)
