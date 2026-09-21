"""Risk manager: position sizing, exposure limits, cooldowns, daily loss halt, symbol blocking."""

from __future__ import annotations

import math
import time
from typing import Any

from ..config import Settings
from ..exchange.binance import SymbolRules
from .signals import SymbolSignal


class RiskManager:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.cooldown_until: dict[str, float] = {}
        self.blocked: dict[str, tuple[float, str]] = {}  # symbol -> (until_ts or inf, reason)
        self.failures: dict[str, int] = {}
        self.halted = False
        self.halt_reason = ""

    # ---- sizing ----
    def position_size(self, free_quote: float, rules: SymbolRules, open_positions: int) -> float:
        cfg = self.cfg
        usable = max(0.0, free_quote - cfg.min_quote_reserve)
        size = min(cfg.position_size_usdt, usable * cfg.max_position_pct, usable)
        min_needed = float(rules.min_notional) * 1.05  # buffer: price may move before the fill
        if size < min_needed:
            size = min_needed if usable >= min_needed else 0.0
        return math.floor(size * 100) / 100.0

    # ---- gates ----
    def can_open(self, signal: SymbolSignal, open_positions: int, free_quote: float, rules: SymbolRules, now: float | None = None) -> tuple[bool, str]:
        now = now or time.time()
        cfg = self.cfg
        if self.halted:
            return False, f"остановлен: {self.halt_reason}"
        blk = self.blocked.get(signal.symbol)
        if blk and blk[0] > now:
            return False, f"пара заблокирована: {blk[1]}"
        if open_positions >= cfg.max_positions:
            return False, "достигнут лимит открытых позиций"
        cd = self.cooldown_until.get(signal.symbol, 0)
        if cd > now:
            return False, f"пауза по паре ещё {int(cd - now)}с"
        if signal.data_age_ms > 5000:
            return False, "рыночные данные устарели"
        if signal.price <= 0 or signal.bid <= 0:
            return False, "нет цены"
        if signal.spread_bps > cfg.max_spread_bps:
            return False, f"спред {signal.spread_bps:.1f} б.п. слишком широкий"
        if signal.volatility_bps > 250:
            return False, "экстремальная волатильность"
        if rules.status != "TRADING":
            return False, f"статус пары {rules.status}"
        if self.position_size(free_quote, rules, open_positions) <= 0:
            return False, f"недостаточно {cfg.quote_asset} (нужно ≥ {float(rules.min_notional) * 1.05:.2f})"
        return True, "ok"

    # ---- bookkeeping ----
    def record_close(self, symbol: str, pnl: float, now: float | None = None) -> None:
        now = now or time.time()
        mult = 2.0 if pnl < 0 else 1.0
        self.cooldown_until[symbol] = now + self.cfg.symbol_cooldown_minutes * 60 * mult

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

    def check_daily_loss(self, realized_today: float) -> bool:
        if not self.halted and self.cfg.daily_loss_limit_usdt > 0 and realized_today <= -abs(self.cfg.daily_loss_limit_usdt):
            self.halted = True
            self.halt_reason = f"дневной убыток {realized_today:.2f} {self.cfg.quote_asset} превысил лимит {self.cfg.daily_loss_limit_usdt:.2f}"
            return True
        return False

    def reset_halt(self) -> None:
        self.halted = False
        self.halt_reason = ""

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "cooldowns": {s: round(t - now) for s, t in self.cooldown_until.items() if t > now},
            "blocked": {s: r for s, (t, r) in self.blocked.items() if t > now},
        }
