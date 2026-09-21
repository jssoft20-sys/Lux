"""The decision loop: every ``decision_interval_ms`` it re-scores every symbol from the latest
order book / trade flow / news / market-structure state, manages exits for open positions and
opens new ones.

Strategy profiles (``STRATEGY``):
* scalp  — news/momentum composite ≥ threshold, fee-based targets, short hold;
* smc    — only Smart-Money setups (liquidity sweep → structure shift → POI in discount, RR ≥ min),
           stop behind the sweep, targets at the opposite liquidity, playbook risk rules;
* hybrid — SMC setups take priority with structure-based stops/targets, otherwise scalp entries.
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
from .candles import CandleStore
from .portfolio import Portfolio, Position
from .risk import RiskManager
from .signals import SymbolSignal, Weights, compute_signal
from .smc import SMCState, Setup, analyze, evaluate, swings

log = logging.getLogger("lux.engine")


class TradingEngine:
    def __init__(self, cfg: Settings, broker: Broker, states: dict[str, MarketState], rules: dict[str, SymbolRules], book: SentimentBook, db: Database, risk: RiskManager, bus: EventBus, candles: CandleStore | None = None):
        self.cfg = cfg
        self.broker = broker
        self.states = states
        self.rules = rules
        self.book = book
        self.db = db
        self.risk = risk
        self.bus = bus
        self.candles = candles
        self.portfolio = Portfolio(cfg.quote_asset, cfg.fee_rate)
        self.weights = Weights(cfg.w_news, cfg.w_momentum, cfg.w_orderbook, cfg.w_flow, cfg.w_smc if candles is not None else 0.0)
        self.symbols = [s for s in cfg.symbol_list if s in rules and s in states]
        self.signals: dict[str, SymbolSignal] = {}
        self.smc_states: dict[str, SMCState] = {}
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
        self.realized_week = 0.0
        self.smc_refreshes = 0
        self.smc_last_ts = 0.0
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._equity_task: asyncio.Task | None = None
        self._smc_task: asyncio.Task | None = None
        self._live_sync_ts = 0.0

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self._restore_positions()
        mode = self.broker.mode
        self.portfolio.realized_today = self.db.trade_stats(since=self._midnight(), mode=mode)["pnl"]
        self.portfolio.realized_total = self.db.trade_stats(mode=mode)["pnl"]
        self.realized_week = self.db.trade_stats(since=self._monday(), mode=mode)["pnl"]
        restore = getattr(self.broker, "restore", None)
        if callable(restore):  # paper broker: rebuild virtual balances from history
            restore([(s, p.qty, p.quote_spent) for s, p in self.portfolio.positions.items()], self.portfolio.realized_total)
        self.risk.check_daily_loss(self.portfolio.realized_today)
        self.running = True
        self.started_ts = time.time()
        self._task = asyncio.create_task(self._loop(), name="engine-loop")
        self._equity_task = asyncio.create_task(self._equity_loop(), name="equity-loop")
        if self.candles is not None:
            self._smc_task = asyncio.create_task(self._smc_loop(), name="smc-loop")
        self.bus.log(f"движок запущен: {self.broker.mode.upper()} · стратегия {self.cfg.strategy} · {len(self.symbols)} пар · цикл {self.cfg.decision_interval_ms} мс")

    async def stop(self) -> None:
        self.running = False
        tasks = [t for t in (self._task, self._equity_task, self._smc_task) if t]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    @staticmethod
    def _midnight() -> float:
        t = time.gmtime()
        return time.mktime(time.struct_time((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))) - time.timezone

    @classmethod
    def _monday(cls) -> float:
        return cls._midnight() - time.gmtime().tm_wday * 86400

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

    # ------------------------------------------------------------------ SMC structure refresh
    async def _smc_loop(self) -> None:
        assert self.candles is not None
        while self.running:
            try:
                self.refresh_smc()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("smc refresh failed")
            await asyncio.sleep(20)

    def refresh_smc(self) -> int:
        """Re-run the structural analysis on the latest closed candles (cheap; every ~20 s)."""
        if self.candles is None:
            return 0
        n = 0
        for sym in self.symbols:
            if not self.candles.ready(sym):
                continue
            series = self.candles.series(sym)
            old = self.smc_states.get(sym)
            st = analyze(sym, series["m1"], series["m5"], series["m15"], self.candles.levels[sym], sweep_lookback=self.cfg.smc_sweep_lookback)
            if old is not None:
                st.score, st.setup = old.score, old.setup  # keep the last evaluation until the next tick
            self.smc_states[sym] = st
            n += 1
        self.smc_refreshes += 1
        self.smc_last_ts = time.time()
        return n

    def _smc_for(self, sym: str, st: MarketState) -> dict[str, Any] | None:
        s = self.smc_states.get(sym)
        if s is None:
            return None
        min_tp = self.risk.fees.target_pct(st.spread_bps() if st.mid > 0 else 0.0)
        evaluate(s, st.mid, min_rr=self.cfg.smc_min_rr, min_tp_pct=min_tp, spread_bps=st.spread_bps() if st.mid > 0 else 0.0, sweep_max_age=self.cfg.smc_sweep_lookback + 30)
        return s.to_dict()

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
            if not self.risk.halt_until or now >= self.risk.halt_until:
                self.risk.reset_halt()
            if time.gmtime(now).tm_wday == 0:
                self.realized_week = 0.0
            self.bus.log("новые сутки (UTC): дневной P&L обнулён")
        market_score = self.book.market_score(now)
        for sym in self.symbols:
            st = self.states[sym]
            if st.mid <= 0:
                continue
            self.signals[sym] = compute_signal(st, self.book.score(sym, now), market_score, self.weights, self._smc_for(sym, st))

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
            is_smc = pos.extra.get("strategy") == "smc"
            max_hold_s = float(pos.extra.get("max_hold_min", cfg.max_hold_minutes)) * 60
            reason = None
            if is_smc:
                # playbook management: TP1 partial → stop to break-even → trail behind the last swing low → TP2
                tp1 = float(pos.extra.get("tp1", pos.take_profit))
                tp2 = float(pos.extra.get("tp2", pos.take_profit))
                if not pos.extra.get("tp1_done") and bid >= tp1:
                    part = pos.qty * cfg.partial_tp_pct / 100.0
                    min_notional = float(self.rules[sym].min_notional) * 1.05
                    if part * bid >= min_notional and (pos.qty - part) * bid >= min_notional:
                        await self._partial_close(sym, part, "TP1 · частичная фиксация")
                        pos = self.portfolio.positions.get(sym)
                        if pos is None:
                            continue
                        pos.extra["tp1_done"] = True
                        pos.stop_loss = max(pos.stop_loss, pos.entry_price * (1 + self.risk.fees.round_trip_pct / 100))  # break-even incl. fees
                        pos.extra["be_moved"] = True
                        self.db.save_position(sym, pos.to_dict())
                        self.bus.log(f"{sym}: TP1 взят, стоп в безубыток {pos.stop_loss:g}, цель TP2 {tp2:g}")
                        continue
                    reason = "TP1"
                elif pos.extra.get("tp1_done"):
                    # trail behind the most recent 1m swing low once it is above the stop
                    if self.candles is not None:
                        m1 = self.candles.closed_m1(sym)
                        lows = [s for s in swings(m1[-60:], 2) if s.kind == "L"] if len(m1) >= 10 else []
                        if lows:
                            trail_lvl = lows[-1].price * (1 - 0.0005)
                            if trail_lvl > pos.stop_loss and trail_lvl < bid:
                                pos.stop_loss = trail_lvl
                                pos.trailing_active = True
                                pos.trailing_stop = trail_lvl
                    if bid >= tp2:
                        reason = "TP2"
                if reason is None:
                    if bid <= pos.stop_loss:
                        reason = "безубыток" if pos.extra.get("be_moved") else "стоп-лосс"
                    elif pos.age_s > max_hold_s:
                        reason = "выход по времени"
                    elif pos.age_s >= cfg.min_hold_seconds and sig is not None and sig.news_score <= -0.45 and sig.news_count > 0:
                        reason = "негативные новости"
                    elif pos.age_s >= cfg.min_hold_seconds and sig is not None and sig.smc_score <= -0.5:
                        reason = "структура развернулась"
            else:
                trail_act = float(pos.extra.get("trail_act", cfg.trailing_activation_pct))
                trail = float(pos.extra.get("trail", cfg.trailing_stop_pct))
                if not pos.trailing_active and gain_pct >= trail_act:
                    pos.trailing_active = True
                if pos.trailing_active:
                    pos.trailing_stop = pos.highest * (1 - trail / 100)
                # hard protective exits always fire, even in the first seconds
                if bid <= pos.stop_loss:
                    reason = "стоп-лосс"
                elif bid >= pos.take_profit:
                    reason = "тейк-профит"
                elif pos.trailing_active and bid <= pos.trailing_stop:
                    reason = "трейлинг-стоп"
                elif pos.age_s < cfg.min_hold_seconds:
                    reason = None  # too fresh for a soft exit — do not churn on a momentary dip
                elif pos.age_s > max_hold_s:
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
            key=lambda s: (s.smc_setup, s.composite),
            reverse=True,
        )
        for sig in candidates:
            setup = self._setup_of(sig)
            smc_trade = setup is not None and cfg.strategy in ("smc", "hybrid")
            if smc_trade:
                if sig.news_score <= -0.2:
                    self.decisions[sig.symbol] = f"сетап есть, но новости {sig.news_score:+.2f}"
                    continue
            elif cfg.strategy == "smc":
                self.decisions[sig.symbol] = "нет SMC-сетапа" if not sig.smc.get("notes") else " · ".join(sig.smc.get("notes", [])[:3])
                continue
            else:
                if sig.composite < cfg.buy_threshold:
                    self.decisions[sig.symbol] = f"сигнал {sig.composite:+.2f} < {cfg.buy_threshold:.2f}"
                    continue
                if sig.news_score < cfg.min_news_score:
                    self.decisions[sig.symbol] = f"новости {sig.news_score:+.2f} < {cfg.min_news_score:.2f}"
                    continue
            open_n = len(self.portfolio.positions)
            free = await self.broker.free_balance(cfg.quote_asset)
            ok, why = self.risk.can_open(sig, open_n, free, self.rules[sig.symbol], now, smc_trade=smc_trade)
            self.decisions[sig.symbol] = why
            if not ok:
                continue
            if smc_trade and setup is not None:
                stop_pct = (setup.entry - setup.sl) / setup.entry * 100
                size = self.risk.size_by_risk(max(self.last_equity, free), free, stop_pct, self.rules[sig.symbol])
                if size <= 0:
                    self.decisions[sig.symbol] = "риск-сайзинг: мало средств"
                    continue
                await self._open(sig, size, setup)
            else:
                size = self.risk.position_size(free, self.rules[sig.symbol], open_n)
                await self._open(sig, size)

    def _setup_of(self, sig: SymbolSignal) -> Setup | None:
        st = self.smc_states.get(sig.symbol)
        return st.setup if st is not None and st.setup is not None else None

    async def _open(self, sig: SymbolSignal, size: float, setup: Setup | None = None) -> None:
        sym = sig.symbol
        cfg = self.cfg
        try:
            fill = await self.broker.buy(sym, size)
        except BinanceError as e:
            self.risk.record_failure(sym, e.msg, permanent=e.symbol_blocked)
            self.bus.log(f"ошибка покупки {sym}: {e.msg}", level="error", symbol=sym)
            return
        self.risk.record_success(sym)
        extra: dict[str, Any] = {"fee_rt_pct": round(self.risk.fees.round_trip_pct, 3)}
        if setup is not None:
            sl = min(setup.sl, fill.price * 0.999)
            tp1, tp2 = max(setup.tp1, fill.price * 1.002), max(setup.tp2, setup.tp1)
            sl_pct = (fill.price - sl) / fill.price * 100
            tp_pct = (tp1 / fill.price - 1) * 100
            trail_act, trail, max_hold = tp_pct * 0.6, tp_pct * 0.4, cfg.smc_max_hold_minutes
            extra.update({"strategy": "smc", "setup": setup.type, "rr": round((tp1 - fill.price) / max(1e-12, fill.price - sl), 2), "tp1": tp1, "tp2": tp2, "tp1_label": setup.tp1_label, "risk_pct": self.risk.risk_pct(), "smc": setup.reason})
            reason = f"SMC {setup.type} · RR {extra['rr']} · {setup.reason}"
            take_profit = tp1
        else:
            if cfg.scalp_mode:
                tp_pct = self.risk.fees.target_pct(sig.spread_bps)
                sl_pct = self.risk.fees.stop_pct(tp_pct)
                trail_act, trail = self.risk.fees.trailing(tp_pct)
                max_hold = cfg.scalp_max_hold_minutes
            else:
                tp_pct, sl_pct, trail_act, trail, max_hold = cfg.take_profit_pct, cfg.stop_loss_pct, cfg.trailing_activation_pct, cfg.trailing_stop_pct, cfg.max_hold_minutes
            sl = fill.price * (1 - sl_pct / 100)
            take_profit = fill.price * (1 + tp_pct / 100)
            extra["strategy"] = "scalp"
            reason = self._explain(sig)
        pos = Position(
            symbol=sym, qty=fill.qty, entry_price=fill.price, entry_ts=fill.ts, quote_spent=fill.quote_qty, fee_paid=fill.fee_quote,
            stop_loss=sl, take_profit=take_profit, highest=fill.price, entry_signal=sig.composite, entry_reason=reason, order_id=fill.order_id, mode=self.broker.mode,
        )
        extra.update({"tp_pct": round(tp_pct, 3), "sl_pct": round(sl_pct, 3), "trail_act": round(trail_act, 3), "trail": round(trail, 3), "max_hold_min": max_hold})
        if sig.top_news:
            extra["headline"] = sig.top_news[0]["title"][:120]
        pos.extra.update(extra)
        self.portfolio.positions[sym] = pos
        self.db.save_position(sym, pos.to_dict())
        self._record_trade(fill, reason=pos.entry_reason, signal=sig.composite)
        self.bus.log(
            f"BUY {sym} {fill.qty:g} @ {fill.price:g} · {fill.quote_qty:.2f} {cfg.quote_asset} · {'SMC RR ' + str(extra.get('rr')) if setup else 'сигнал ' + format(sig.composite, '+.2f')}",
            symbol=sym, side="BUY", price=fill.price, qty=fill.qty, quote=fill.quote_qty,
        )
        self.bus.publish("trade", {"side": "BUY", "symbol": sym, "price": fill.price, "qty": fill.qty, "quote": fill.quote_qty, "reason": pos.entry_reason})

    async def _partial_close(self, sym: str, qty: float, reason: str) -> None:
        pos = self.portfolio.positions.get(sym)
        if pos is None:
            return
        qty = self.rules[sym].round_qty(min(qty, pos.qty))
        if qty <= 0:
            return
        try:
            fill = await self.broker.sell(sym, qty)
        except BinanceError as e:
            self.bus.log(f"ошибка частичной продажи {sym}: {e.msg}", level="error", symbol=sym)
            return
        share = fill.qty / pos.qty if pos.qty else 1.0
        cost = pos.quote_spent * share
        pnl = fill.quote_qty - cost
        pos.qty -= fill.qty
        pos.quote_spent -= cost
        if pos.qty <= 0:
            self.portfolio.positions.pop(sym, None)
            self.db.delete_position(sym)
        else:
            self.db.save_position(sym, pos.to_dict())
        self.portfolio.add_realized(pnl)
        self.realized_week += pnl
        self._record_trade(fill, reason=reason, pnl=pnl, pnl_pct=pnl / cost * 100 if cost else 0.0)
        sign = "+" if pnl >= 0 else ""
        self.bus.log(f"SELL {sym} {fill.qty:g} @ {fill.price:g} · {sign}{pnl:.3f} {self.cfg.quote_asset} · {reason}", symbol=sym, side="SELL", price=fill.price, qty=fill.qty, pnl=pnl)
        self.bus.publish("trade", {"side": "SELL", "symbol": sym, "price": fill.price, "qty": fill.qty, "quote": fill.quote_qty, "pnl": pnl, "pnl_pct": pnl / cost * 100 if cost else 0.0, "reason": reason})

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
        self.realized_week += pnl
        self.risk.record_close(sym, pnl)
        self._record_trade(fill, reason=reason, pnl=pnl, pnl_pct=pnl_pct, signal=self.signals.get(sym).composite if sym in self.signals else None)
        sign = "+" if pnl >= 0 else ""
        self.bus.log(
            f"SELL {sym} {fill.qty:g} @ {fill.price:g} · {sign}{pnl:.3f} {self.cfg.quote_asset} ({sign}{pnl_pct:.2f}%) · {reason}",
            level="info" if pnl >= 0 else "warn", symbol=sym, side="SELL", price=fill.price, qty=fill.qty, pnl=pnl,
        )
        self.bus.publish("trade", {"side": "SELL", "symbol": sym, "price": fill.price, "qty": fill.qty, "quote": fill.quote_qty, "pnl": pnl, "pnl_pct": pnl_pct, "reason": reason})
        self._check_drawdowns()

    def _check_drawdowns(self) -> None:
        day_start = max(0.0, self.last_equity - self.portfolio.realized_today - self.last_unrealized)
        week_start = max(0.0, self.last_equity - self.realized_week - self.last_unrealized)
        if self.risk.check_daily_loss(self.portfolio.realized_today, day_start) or self.risk.check_weekly_loss(self.realized_week, week_start):
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
            parts.append(f"новости {sig.news_score:+.2f}")
        if abs(sig.momentum_score) >= 0.1:
            parts.append(f"импульс {sig.momentum_score:+.2f}")
        if abs(sig.smc_score) >= 0.15:
            parts.append(f"структура {sig.smc_score:+.2f}")
        if abs(sig.imbalance) >= 0.15:
            parts.append(f"стакан {sig.imbalance:+.2f}")
        if abs(sig.flow) >= 0.15:
            parts.append(f"поток {sig.flow:+.2f}")
        return " · ".join(parts) or f"сигнал {sig.composite:+.2f}"

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
        self.bus.log("стоп по просадке снят вручную", level="warn")

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
        setups = [s for s, st in self.smc_states.items() if st.setup is not None]
        return {
            "mode": self.broker.mode,
            "strategy": self.cfg.strategy,
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
            "realized_week": round(self.realized_week, 4),
            "realized_total": round(self.portfolio.realized_total, 4),
            "quote_asset": self.cfg.quote_asset,
            "risk": self.risk.status(),
            "smc": {"enabled": self.candles is not None, "analysed": len(self.smc_states), "setups": setups, "refreshes": self.smc_refreshes, "last_refresh_age_s": round(time.time() - self.smc_last_ts) if self.smc_last_ts else None, "candles": self.candles.status() if self.candles else None},
            "decisions": self.decisions,
        }
