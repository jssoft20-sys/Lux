"""Risk manager: position sizing, exposure limits, cooldowns, drawdown halts, session discipline."""

from __future__ import annotations

import math
import time
from typing import Any

from ..config import Settings
from ..exchange.binance import SymbolRules
from .fees import FeeCalculator
from .sessions import SessionClock
from .signals import SymbolSignal


class RiskManager:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.fees = FeeCalculator(cfg.fee_rate, cfg.fee_multiple)
        self.clock = SessionClock(cfg.ott_windows, weekdays_only=False, reduced_days=cfg.reduced_risk_days)
        self.cooldown_until: dict[str, float] = {}
        self.blocked: dict[str, tuple[float, str]] = {}  # symbol -> (until_ts or inf, reason)
        self.failures: dict[str, int] = {}
        self.halted = False
        self.halt_reason = ""
        self.halt_until: float = 0.0  # 0 = until the day rolls over
        self.loss_sessions: set[str] = set()
        self.after_loss = False  # playbook: re-enter at half risk after a stop-out

    # ---- sizing ----
    def position_size(self, free_quote: float, rules: SymbolRules, open_positions: int) -> float:
        cfg = self.cfg
        usable = max(0.0, free_quote - cfg.min_quote_reserve)
        size = min(cfg.position_size_usdt, usable * cfg.max_position_pct, usable)
        min_needed = float(rules.min_notional) * 1.05  # buffer: price may move before the fill
        if size < min_needed:
            size = min_needed if usable >= min_needed else 0.0
        return math.floor(size * 100) / 100.0

    def risk_pct(self, now: float | None = None) -> float:
        cfg = self.cfg
        if self.after_loss or self.clock.is_reduced_risk_day(now):
            return min(cfg.risk_per_trade_pct, cfg.risk_reduced_pct)
        return cfg.risk_per_trade_pct

    def size_by_risk(self, equity: float, free_quote: float, stop_pct: float, rules: SymbolRules) -> float:
        """Playbook sizing: notional = (equity × risk%) / stop distance, within the usual caps."""
        cfg = self.cfg
        if stop_pct <= 0 or equity <= 0:
            return 0.0
        risk_amount = equity * self.risk_pct() / 100.0
        size = risk_amount / (stop_pct / 100.0)
        usable = max(0.0, free_quote - cfg.min_quote_reserve)
        size = min(size, usable * cfg.max_position_pct, usable)
        min_needed = float(rules.min_notional) * 1.05
        if size < min_needed:
            size = min_needed if usable >= min_needed else 0.0
        return math.floor(size * 100) / 100.0

    # ---- gates ----
    def can_open(self, signal: SymbolSignal, open_positions: int, free_quote: float, rules: SymbolRules, now: float | None = None, smc_trade: bool = False) -> tuple[bool, str]:
        now = now or time.time()
        cfg = self.cfg
        if self.halted:
            return False, f"стоп: {self.halt_reason}"
        blk = self.blocked.get(signal.symbol)
        if blk and blk[0] > now:
            return False, f"заблокирована: {blk[1]}"
        if open_positions >= cfg.max_positions:
            return False, "лимит позиций"
        cd = self.cooldown_until.get(signal.symbol, 0)
        if cd > now:
            return False, f"пауза {int(cd - now)}с"
        if signal.data_age_ms > 5000:
            return False, "нет данных"
        if signal.price <= 0 or signal.bid <= 0:
            return False, "нет цены"
        if signal.spread_bps > cfg.max_spread_bps:
            return False, f"спред {signal.spread_bps:.0f} б.п."
        if signal.volatility_bps > 250:
            return False, "волатильность"
        if cfg.ott_only and not self.clock.in_ott(now):
            return False, "вне OTT"
        if cfg.strategy == "smc" and cfg.stop_after_loss_in_session and self.clock.session_key(now) in self.loss_sessions:
            return False, "убыток в этой сессии"
        if not smc_trade and cfg.scalp_mode:
            target = self.fees.target_pct(signal.spread_bps)
            if signal.spread_bps > target * 100 / 4:
                return False, f"спред {signal.spread_bps:.0f} б.п. > ¼ цели"
            need = self.fees.min_volatility_bps(target, cfg.scalp_min_volatility_ratio)
            if signal.volatility_bps < need:
                return False, f"вола {signal.volatility_bps:.0f} < {need:.0f} б.п."
        if rules.status != "TRADING":
            return False, f"статус {rules.status}"
        if self.position_size(free_quote, rules, open_positions) <= 0:
            return False, f"мало {cfg.quote_asset} (< {float(rules.min_notional) * 1.05:.2f})"
        return True, "ok"

    # ---- bookkeeping ----
    def record_close(self, symbol: str, pnl: float, now: float | None = None) -> None:
        now = now or time.time()
        mult = 2.0 if pnl < 0 else 1.0
        self.cooldown_until[symbol] = now + self.cfg.symbol_cooldown_minutes * 60 * mult
        if pnl < 0:
            self.after_loss = True
            self.loss_sessions.add(self.clock.session_key(now))
            if len(self.loss_sessions) > 50:
                self.loss_sessions = set(sorted(self.loss_sessions)[-20:])
        else:
            self.after_loss = False

    def record_failure(self, symbol: str, reason: str, permanent: bool = False) -> None:
        n = self.failures.get(symbol, 0) + 1
        self.failures[symbol] = n
        if permanent:
            self.blocked[symbol] = (float("inf"), reason)
        elif n >= 3:
            self.blocked[symbol] = (time.time() + 3600, f"{n} ошибок подряд: {reason}")
        else:
            self.cooldown_until[symbol] = time.time() + 300

    def record_success(self, symbol: str) -> None:
        self.failures.pop(symbol, None)

    def check_daily_loss(self, realized_today: float, day_start_equity: float = 0.0) -> bool:
        if self.halted:
            return False
        cfg = self.cfg
        limit = abs(cfg.daily_loss_limit_usdt) if cfg.daily_loss_limit_usdt > 0 else float("inf")
        if cfg.daily_drawdown_pct > 0 and day_start_equity > 0:
            limit = min(limit, day_start_equity * cfg.daily_drawdown_pct / 100.0)
        if limit != float("inf") and realized_today <= -limit:
            self.halted = True
            self.halt_reason = f"дневная просадка {realized_today:.2f} {cfg.quote_asset} достигла лимита {limit:.2f}"
            return True
        return False

    def check_weekly_loss(self, realized_week: float, week_start_equity: float) -> bool:
        if self.halted or self.cfg.weekly_drawdown_pct <= 0 or week_start_equity <= 0:
            return False
        limit = week_start_equity * self.cfg.weekly_drawdown_pct / 100.0
        if realized_week <= -limit:
            self.halted = True
            self.halt_reason = f"недельная просадка {realized_week:.2f} {self.cfg.quote_asset} достигла лимита {limit:.2f}"
            # stays until Monday 00:00 UTC
            t = time.gmtime()
            days_to_monday = (7 - t.tm_wday) % 7 or 7
            self.halt_until = time.mktime(time.struct_time((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))) - time.timezone + days_to_monday * 86400
            return True
        return False

    def reset_halt(self) -> None:
        self.halted = False
        self.halt_reason = ""
        self.halt_until = 0.0

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "after_loss": self.after_loss,
            "risk_pct": self.risk_pct(now),
            "session": self.clock.status(now),
            "loss_in_session": self.clock.session_key(now) in self.loss_sessions,
            "cooldowns": {s: round(t - now) for s, t in self.cooldown_until.items() if t > now},
            "blocked": {s: r for s, (t, r) in self.blocked.items() if t > now},
        }
