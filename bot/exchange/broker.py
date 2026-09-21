"""Order execution: a paper broker (virtual fills at live prices) and a live Binance broker.

Both expose the same interface so the strategy engine does not care which one it drives.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Protocol

from .binance import BinanceError, BinanceREST, MarketState, SymbolRules

log = logging.getLogger("lux.broker")


@dataclass
class Fill:
    symbol: str
    side: str  # BUY / SELL
    qty: float  # base asset actually received (BUY) or sold (SELL), net of fees in base
    price: float  # average fill price
    quote_qty: float  # quote spent (BUY) or received net of fees (SELL)
    fee_quote: float  # commission, expressed in quote asset
    order_id: str
    ts: float = field(default_factory=time.time)


class Broker(Protocol):
    mode: str

    async def start(self) -> None: ...
    async def buy(self, symbol: str, quote_qty: float) -> Fill: ...
    async def sell(self, symbol: str, qty: float) -> Fill: ...
    async def free_balance(self, asset: str) -> float: ...
    async def balances(self) -> dict[str, float]: ...


class PaperBroker:
    """Simulates market orders against the live order book (best bid / ask)."""

    mode = "paper"

    def __init__(self, states: dict[str, MarketState], rules: dict[str, SymbolRules], quote_asset: str, start_balance: float, fee_rate: float = 0.001, slippage_bps: float = 2.0):
        self.states = states
        self.rules = rules
        self.quote_asset = quote_asset
        self.fee_rate = fee_rate
        self.slippage = slippage_bps / 1e4
        self.start_balance = float(start_balance)
        self._balances: dict[str, float] = {quote_asset: float(start_balance)}

    async def start(self) -> None:
        return None

    def restore(self, open_positions: list[tuple[str, float, float]], realized_total: float) -> None:
        """Rebuild virtual balances after a restart: (symbol, qty, quote_spent) per open position."""
        quote = self.start_balance + realized_total
        for sym, qty, spent in open_positions:
            quote -= spent
            base = self.rules[sym].base if sym in self.rules else sym.replace(self.quote_asset, "")
            self._balances[base] = self._balances.get(base, 0.0) + qty
        self._balances[self.quote_asset] = max(0.0, quote)

    def _state(self, symbol: str) -> MarketState:
        st = self.states.get(symbol)
        if st is None or st.mid <= 0:
            raise BinanceError(None, f"no market data for {symbol}")
        return st

    async def buy(self, symbol: str, quote_qty: float) -> Fill:
        st = self._state(symbol)
        rules = self.rules[symbol]
        free = self._balances.get(self.quote_asset, 0.0)
        if quote_qty > free + 1e-9:
            raise BinanceError(-2010, f"paper: insufficient {self.quote_asset} balance ({free:.2f} < {quote_qty:.2f})")
        price = (st.ask or st.mid) * (1 + self.slippage)
        gross_qty = quote_qty / price
        fee_base = gross_qty * self.fee_rate  # Binance charges the fee in the received asset
        net_qty = rules.round_qty(gross_qty - fee_base)
        if net_qty <= 0:
            raise BinanceError(-1013, "paper: quantity below lot size")
        self._balances[self.quote_asset] = free - quote_qty
        self._balances[rules.base] = self._balances.get(rules.base, 0.0) + net_qty
        return Fill(symbol, "BUY", net_qty, price, quote_qty, fee_base * price, f"paper-{uuid.uuid4().hex[:10]}")

    async def sell(self, symbol: str, qty: float) -> Fill:
        st = self._state(symbol)
        rules = self.rules[symbol]
        held = self._balances.get(rules.base, 0.0)
        qty = rules.round_qty(min(qty, held))
        if qty <= 0:
            raise BinanceError(-2010, f"paper: nothing to sell for {symbol}")
        price = (st.bid or st.mid) * (1 - self.slippage)
        gross = qty * price
        fee = gross * self.fee_rate
        self._balances[rules.base] = held - qty
        self._balances[self.quote_asset] = self._balances.get(self.quote_asset, 0.0) + gross - fee
        return Fill(symbol, "SELL", qty, price, gross - fee, fee, f"paper-{uuid.uuid4().hex[:10]}")

    async def free_balance(self, asset: str) -> float:
        return self._balances.get(asset, 0.0)

    async def balances(self) -> dict[str, float]:
        return {k: v for k, v in self._balances.items() if v > 0}


class LiveBroker:
    """Real market orders on Binance Spot."""

    mode = "live"

    def __init__(self, rest: BinanceREST, rules: dict[str, SymbolRules], quote_asset: str):
        self.rest = rest
        self.rules = rules
        self.quote_asset = quote_asset
        self._balances: dict[str, float] = {}
        self._balances_ts = 0.0

    async def start(self) -> None:
        await self.rest.sync_time()
        await self.refresh_balances()

    async def refresh_balances(self) -> dict[str, float]:
        bal = await self.rest.balances()
        self._balances = {a: free for a, (free, _locked) in bal.items()}
        self._balances_ts = time.time()
        return self._balances

    @staticmethod
    def _summarise(order: dict, rules: SymbolRules, quote_asset: str) -> tuple[float, float, float, float]:
        """Return (net_base_qty, avg_price, quote_amount, fee_in_quote) from a FULL order response."""
        executed = float(order.get("executedQty", 0) or 0)
        quote = float(order.get("cummulativeQuoteQty", 0) or 0)
        avg = quote / executed if executed > 0 else 0.0
        fee_base = fee_quote = fee_other_quote = 0.0
        for f in order.get("fills", []) or []:
            comm = float(f.get("commission", 0) or 0)
            asset = f.get("commissionAsset")
            if asset == rules.base:
                fee_base += comm
            elif asset == quote_asset:
                fee_quote += comm
            elif comm > 0:  # e.g. BNB discount — approximate as 0.075% of notional for reporting
                fee_other_quote += float(f.get("price", avg)) * float(f.get("qty", 0)) * 0.00075
        return executed - fee_base, avg, quote, fee_base * avg + fee_quote + fee_other_quote

    async def buy(self, symbol: str, quote_qty: float) -> Fill:
        rules = self.rules[symbol]
        order = await self.rest.market_buy(symbol, quote_qty)
        net_qty, avg, quote, fee_q = self._summarise(order, rules, self.quote_asset)
        if net_qty <= 0:
            raise BinanceError(None, f"order {order.get('orderId')} not filled: {order.get('status')}")
        log.info("LIVE BUY %s qty=%.8f avg=%.8f spent=%.4f fee=%.4f", symbol, net_qty, avg, quote, fee_q)
        try:
            await self.refresh_balances()
        except BinanceError as e:
            log.warning("balance refresh failed: %s", e)
        return Fill(symbol, "BUY", net_qty, avg, quote, fee_q, str(order.get("orderId")))

    async def sell(self, symbol: str, qty: float) -> Fill:
        rules = self.rules[symbol]
        # never try to sell more than the exchange says we hold
        try:
            held = (await self.rest.balances()).get(rules.base, (0.0, 0.0))[0]
            qty = min(qty, held)
        except BinanceError as e:
            log.warning("could not verify %s balance before sell: %s", rules.base, e)
        qty = rules.round_qty(qty)
        if qty <= 0:
            raise BinanceError(-2010, f"nothing to sell for {symbol}")
        order = await self.rest.market_sell(symbol, rules.fmt_qty(qty))
        sold, avg, quote, fee_q = self._summarise(order, rules, self.quote_asset)
        executed = float(order.get("executedQty", 0) or 0)
        log.info("LIVE SELL %s qty=%.8f avg=%.8f received=%.4f fee=%.4f", symbol, executed, avg, quote - fee_q, fee_q)
        try:
            await self.refresh_balances()
        except BinanceError as e:
            log.warning("balance refresh failed: %s", e)
        return Fill(symbol, "SELL", executed, avg, quote - fee_q, fee_q, str(order.get("orderId")))

    async def free_balance(self, asset: str) -> float:
        if time.time() - self._balances_ts > 5:
            try:
                await self.refresh_balances()
            except BinanceError as e:
                log.warning("balance refresh failed: %s", e)
        return self._balances.get(asset, 0.0)

    async def balances(self) -> dict[str, float]:
        if time.time() - self._balances_ts > 5:
            try:
                await self.refresh_balances()
            except BinanceError as e:
                log.warning("balance refresh failed: %s", e)
        return {k: v for k, v in self._balances.items() if v > 0}
