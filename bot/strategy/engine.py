"""The decision loop: every ``decision_interval_ms`` it re-scores every symbol from the latest
order book / trade flow / news state, manages exits for open positions and opens new ones.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from ..config import Settings
from ..events import EventBus
from ..exchange.binance import BinanceError, MarketState, SymbolRules
from ..exchange.broker import Broker, Fill
from ..news.book import SentimentBook
from ..storage.db import Database
from .portfolio import Portfolio, Position
from .risk import RiskManager
from .signals import SymbolSignal, Weights, compute_signal

log = logging.getLogger("lux.engine")


class TradingEngine:
    def __init__(self, cfg: Settings, broker: Broker, states: dict[str, MarketState], rules: dict[str, SymbolRules], book: SentimentBook, db: Database, risk: RiskManager, bus: EventBus):
        self.cfg = cfg
        self.broker = broker
        self.states = states
        self.rules = rules
        self.book = book
        self.db = db
        self.risk = risk
        self.bus = bus
        self.portfolio = Portfolio(cfg.quote_asset, cfg.fee_rate)
        self.weights = Weights(cfg.w_news, cfg.w_momentum, cfg.w_orderbook, cfg.w_flow)
        self.symbols = [s for s in cfg.symbol_list if s in rules and s in states]
        self.signals: dict[str, SymbolSignal] = {}
        self.decisions: dict[str, str] = {}  # symbol -> last reason why we did not enter
        self.paused = False
        self.running = False
        self.started_ts = 0.0
        self.ticks = 0
        self.tick_ms = 0.0
        self.last_tick_ts = 0.0
        self.last_equity = 0.0
        self.last_quote_balance = 0.0
        self.last_unrealized = 0.0
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._equity_task: asyncio.Task | None = None
        self._live_sync_ts = 0.0

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self._restore_positions()
        stats = self.db.trade_stats(since=self._midnight(), mode=self.broker.mode)
        self.portfolio.realized_today = stats["pnl"]
        self.portfolio.realized_total = self.db.trade_stats(mode=self.broker.mode)["pnl"]
        restore = getattr(self.broker, "restore", None)
        if callable(restore):  # paper broker: rebuild virtual balances from history
            restore([(s, p.qty, p.quote_spent) for s, p in self.portfolio.positions.items()], self.portfolio.realized_total)
        self.risk.check_daily_loss(self.portfolio.realized_today)
        self.running = True
        self.started_ts = time.time()
        self._task = asyncio.create_task(self._loop(), name="engine-loop")
        self._equity_task = asyncio.create_task(self._equity_loop(), name="equity-loop")
        self.bus.log(f"движок запущен: режим {self.broker.mode.upper()}, {len(self.symbols)} пар, цикл {self.cfg.decision_interval_ms} мс")

    async def stop(self) -> None:
        self.running = False
        for t in (self._task, self._equity_task):
            if t:
                t.cancel()
        await asyncio.gather(*[t for t in (self._task, self._equity_task) if t], return_exceptions=True)

    @staticmethod
    def _midnight() -> float:
        t = time.gmtime()
        return time.mktime(time.struct_time((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))) - time.timezone

    def _restore_positions(self) -> None:
        for sym, data in self.db.load_positions().items():
            if sym not in self.rules:
                continue
            try:
                pos = Position.from_dict(data)
            except TypeError:
                continue
            if pos.mode != self.broker.mode:
                # a paper position must not be "sold" on the live account and vice versa
                self.db.delete_position(sym)
                continue
            self.portfolio.positions[sym] = pos
        if self.portfolio.positions:
            self.bus.log(f"восстановлено позиций: {', '.join(self.portfolio.positions)}")

    # ------------------------------------------------------------------ main loop
    async def _loop(self) -> None:
        interval = max(0.02, self.cfg.decision_interval_ms / 1000.0)
        while self.running:
            t0 = time.perf_counter()
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("tick failed")
                await asyncio.sleep(1)
            self.tick_ms = (time.perf_counter() - t0) * 1000
            await asyncio.sleep(max(0.005, interval - (time.perf_counter() - t0)))

    async def tick(self) -> None:
        now = time.time()
        self.ticks += 1
        self.last_tick_ts = now
        if self.portfolio.roll_day():
            self.risk.reset_halt()
            self.bus.log("новые сутки (UTC): дневной P&L обнулён")
        market_score = self.book.market_score(now)
        for sym in self.symbols:
            st = self.states[sym]
            if st.mid <= 0:
                continue
            self.signals[sym] = compute_signal(st, self.book.score(sym, now), market_score, self.weights)

        async with self._lock:
            await self._manage_exits(now)
            if not self.paused and not self.risk.halted:
                await self._find_entries(now)
        if self.broker.mode == "live" and now - self._live_sync_ts > 60:
            self._live_sync_ts = now
            await self._sync_live_positions()

    # ------------------------------------------------------------------ exits
    async def _manage_exits(self, now: float) -> None:
        cfg = self.cfg
        for sym, pos in list(self.portfolio.positions.items()):
            st = self.states.get(sym)
            sig = self.signals.get(sym)
            if st is None or st.bid <= 0:
                continue
            bid = st.bid
            pos.highest = max(pos.highest, bid)
            gain_pct = (bid / pos.entry_price - 1) * 100
            if not pos.trailing_active and gain_pct >= cfg.trailing_activation_pct:
                pos.trailing_active = True
            if pos.trailing_active:
                pos.trailing_stop = pos.highest * (1 - cfg.trailing_stop_pct / 100)
            reason = None
            if bid <= pos.stop_loss:
                reason = "стоп-лосс"
            elif bid >= pos.take_profit:
                reason = "тейк-профит"
            elif pos.trailing_active and bid <= pos.trailing_stop:
                reason = "трейлинг-стоп"
            elif pos.age_s > cfg.max_hold_minutes * 60:
                reason = "выход по времени"
            elif sig is not None and sig.news_score <= -0.45 and sig.news_count > 0:
                reason = "негативные новости"
            elif sig is not None and sig.composite <= cfg.exit_threshold and gain_pct > -cfg.stop_loss_pct / 2:
                reason = "сигнал развернулся"
            if reason:
                await self._close(sym, reason)

    # ------------------------------------------------------------------ entries
    async def _find_entries(self, now: float) -> None:
        cfg = self.cfg
        candidates = sorted(
            (s for s in self.signals.values() if s.symbol not in self.portfolio.positions),
            key=lambda s: s.composite,
            reverse=True,
        )
        for sig in candidates:
            if sig.composite < cfg.buy_threshold:
                self.decisions[sig.symbol] = f"сигнал {sig.composite:+.2f} < порог {cfg.buy_threshold:.2f}"
                continue
            if sig.news_score < cfg.min_news_score:
                self.decisions[sig.symbol] = f"новостной фон {sig.news_score:+.2f} ниже {cfg.min_news_score:.2f}"
                continue
            open_n = len(self.portfolio.positions)
            free = await self.broker.free_balance(cfg.quote_asset)
            ok, why = self.risk.can_open(sig, open_n, free, self.rules[sig.symbol], now)
            self.decisions[sig.symbol] = why
            if not ok:
                continue
            size = self.risk.position_size(free, self.rules[sig.symbol], open_n)
            await self._open(sig, size)

    async def _open(self, sig: SymbolSignal, size: float) -> None:
        sym = sig.symbol
        cfg = self.cfg
        try:
            fill = await self.broker.buy(sym, size)
        except BinanceError as e:
            self.risk.record_failure(sym, e.msg, permanent=e.symbol_blocked)
            self.bus.log(f"ошибка покупки {sym}: {e.msg}", level="error", symbol=sym)
            return
        self.risk.record_success(sym)
        pos = Position(
            symbol=sym,
            qty=fill.qty,
            entry_price=fill.price,
            entry_ts=fill.ts,
            quote_spent=fill.quote_qty,
            fee_paid=fill.fee_quote,
            stop_loss=fill.price * (1 - cfg.stop_loss_pct / 100),
            take_profit=fill.price * (1 + cfg.take_profit_pct / 100),
            highest=fill.price,
            entry_signal=sig.composite,
            entry_reason=self._explain(sig),
            order_id=fill.order_id,
            mode=self.broker.mode,
        )
        self.portfolio.positions[sym] = pos
        self.db.save_position(sym, pos.to_dict())
        self._record_trade(fill, reason=pos.entry_reason, signal=sig.composite)
        self.bus.log(
            f"ПОКУПКА {sym}: {fill.qty:g} по {fill.price:g} на {fill.quote_qty:.2f} {cfg.quote_asset} (сигнал {sig.composite:+.2f}; {pos.entry_reason})",
            symbol=sym, side="BUY", price=fill.price, qty=fill.qty, quote=fill.quote_qty,
        )
        self.bus.publish("trade", {"side": "BUY", "symbol": sym, "price": fill.price, "qty": fill.qty, "quote": fill.quote_qty, "reason": pos.entry_reason})

    async def _close(self, sym: str, reason: str) -> None:
        pos = self.portfolio.positions.get(sym)
        if pos is None:
            return
        try:
            fill = await self.broker.sell(sym, pos.qty)
        except BinanceError as e:
            self.risk.record_failure(sym, e.msg, permanent=e.symbol_blocked)
            self.bus.log(f"ошибка продажи {sym}: {e.msg}", level="error", symbol=sym)
            if "nothing to sell" in e.msg or e.code == -2010 and "insufficient" in e.msg.lower():
                # the asset is gone (sold manually / dust) — stop tracking it
                self.portfolio.positions.pop(sym, None)
                self.db.delete_position(sym)
            return
        pnl = fill.quote_qty - pos.quote_spent
        pnl_pct = pnl / pos.quote_spent * 100 if pos.quote_spent else 0.0
        self.portfolio.positions.pop(sym, None)
        self.db.delete_position(sym)
        self.portfolio.add_realized(pnl)
        self.risk.record_close(sym, pnl)
        self._record_trade(fill, reason=reason, pnl=pnl, pnl_pct=pnl_pct, signal=self.signals.get(sym).composite if sym in self.signals else None)
        sign = "+" if pnl >= 0 else ""
        self.bus.log(
            f"ПРОДАЖА {sym}: {fill.qty:g} по {fill.price:g} → {sign}{pnl:.4f} {self.cfg.quote_asset} ({sign}{pnl_pct:.2f}%) — {reason}",
            level="info" if pnl >= 0 else "warn", symbol=sym, side="SELL", price=fill.price, qty=fill.qty, pnl=pnl,
        )
        self.bus.publish("trade", {"side": "SELL", "symbol": sym, "price": fill.price, "qty": fill.qty, "quote": fill.quote_qty, "pnl": pnl, "pnl_pct": pnl_pct, "reason": reason})
        if self.risk.check_daily_loss(self.portfolio.realized_today):
            self.bus.log(f"ТОРГОВЛЯ ОСТАНОВЛЕНА: {self.risk.halt_reason}", level="error")

    def _record_trade(self, fill: Fill, reason: str, pnl: float | None = None, pnl_pct: float | None = None, signal: float | None = None) -> None:
        self.db.add_trade(
            ts=fill.ts, mode=self.broker.mode, symbol=fill.symbol, side=fill.side, qty=fill.qty, price=fill.price,
            quote_qty=fill.quote_qty, fee=fill.fee_quote, pnl=pnl, pnl_pct=pnl_pct, reason=reason, order_id=fill.order_id, signal=signal,
        )

    @staticmethod
    def _explain(sig: SymbolSignal) -> str:
        parts = []
        if abs(sig.news_score) >= 0.1:
            parts.append(f"новости {sig.news_score:+.2f} ({sig.news_count})")
        if abs(sig.momentum_score) >= 0.1:
            parts.append(f"импульс {sig.momentum_score:+.2f}")
        if abs(sig.imbalance) >= 0.15:
            parts.append(f"стакан {sig.imbalance:+.2f}")
        if abs(sig.flow) >= 0.15:
            parts.append(f"поток {sig.flow:+.2f}")
        if sig.top_news:
            parts.append("«" + sig.top_news[0]["title"][:70] + "»")
        return ", ".join(parts) or "композитный сигнал"

    # ------------------------------------------------------------------ manual controls
    async def close_position(self, sym: str, reason: str = "закрыто вручную") -> bool:
        async with self._lock:
            if sym not in self.portfolio.positions:
                return False
            await self._close(sym, reason)
            return sym not in self.portfolio.positions

    async def close_all(self, reason: str = "закрыто вручную") -> int:
        n = 0
        async with self._lock:
            for sym in list(self.portfolio.positions):
                await self._close(sym, reason)
                if sym not in self.portfolio.positions:
                    n += 1
        return n

    def pause(self) -> None:
        self.paused = True
        self.bus.log("пауза: новые сделки не открываются (открытые позиции сопровождаются)", level="warn")

    def resume(self) -> None:
        self.paused = False
        self.bus.log("торговля возобновлена")

    def reset_halt(self) -> None:
        self.risk.reset_halt()
        self.bus.log("дневной стоп снят вручную", level="warn")

    # ------------------------------------------------------------------ live account sync
    async def _sync_live_positions(self) -> None:
        try:
            balances = await self.broker.balances()
        except BinanceError as e:
            log.warning("live sync failed: %s", e)
            return
        for sym, pos in list(self.portfolio.positions.items()):
            base = self.rules[sym].base
            held = balances.get(base, 0.0)
            if held < pos.qty * 0.5:
                st = self.states.get(sym)
                if st and st.bid > 0 and held * st.bid < float(self.rules[sym].min_notional):
                    self.bus.log(f"{sym}: актив продан вне бота (баланс {held:g}) — позиция снята с сопровождения", level="warn")
                    self.portfolio.positions.pop(sym, None)
                    self.db.delete_position(sym)
            elif held < pos.qty:
                pos.qty = self.rules[sym].round_qty(held)
                self.db.save_position(sym, pos.to_dict())

    # ------------------------------------------------------------------ reporting
    async def _equity_loop(self) -> None:
        while self.running:
            try:
                await self.snapshot_equity()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("equity snapshot failed")
            await asyncio.sleep(5)

    async def snapshot_equity(self) -> dict[str, float]:
        bids = {s: self.states[s].bid for s in self.portfolio.positions if s in self.states}
        unrealized = self.portfolio.unrealized(bids)
        try:
            quote = await self.broker.free_balance(self.cfg.quote_asset)
        except BinanceError:
            quote = self.last_quote_balance
        equity = quote + sum(bids.get(s, 0.0) * p.qty for s, p in self.portfolio.positions.items())
        self.last_equity, self.last_quote_balance, self.last_unrealized = equity, quote, unrealized
        self.db.add_equity(round(time.time(), 3), equity, quote, unrealized, self.portfolio.realized_today, mode=self.broker.mode)
        return {"equity": equity, "quote": quote, "unrealized": unrealized}

    def status(self) -> dict[str, Any]:
        bids = {s: self.states[s].bid for s in self.portfolio.positions if s in self.states}
        return {
            "mode": self.broker.mode,
            "running": self.running,
            "paused": self.paused,
            "halted": self.risk.halted,
            "halt_reason": self.risk.halt_reason,
            "started_ts": self.started_ts,
            "uptime_s": round(time.time() - self.started_ts) if self.started_ts else 0,
            "ticks": self.ticks,
            "tick_ms": round(self.tick_ms, 2),
            "interval_ms": self.cfg.decision_interval_ms,
            "symbols": self.symbols,
            "open_positions": len(self.portfolio.positions),
            "exposure": round(self.portfolio.exposure(), 4),
            "equity": round(self.last_equity, 4),
            "quote_balance": round(self.last_quote_balance, 4),
            "unrealized": round(self.portfolio.unrealized(bids), 4),
            "realized_today": round(self.portfolio.realized_today, 4),
            "realized_total": round(self.portfolio.realized_total, 4),
            "quote_asset": self.cfg.quote_asset,
            "risk": self.risk.status(),
            "decisions": self.decisions,
        }
