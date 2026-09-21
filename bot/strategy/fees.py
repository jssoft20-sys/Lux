"""Fee calculator: every target is expressed as a multiple of what Binance charges for the round trip."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeeCalculator:
    fee_rate: float  # per side, e.g. 0.001 = 0.1 %
    multiple: float = 2.5  # take-profit = round-trip fees × multiple

    @property
    def round_trip_pct(self) -> float:
        """Buy + sell commission, in percent of notional."""
        return self.fee_rate * 2 * 100

    def target_pct(self, spread_bps: float = 0.0) -> float:
        """Gross move needed so the trade nets `multiple − 1` × fees after costs (spread included)."""
        spread_pct = max(0.0, spread_bps) / 100.0 if spread_bps != float("inf") else 0.0
        return self.round_trip_pct * self.multiple + spread_pct

    def stop_pct(self, target: float) -> float:
        return target * 0.8

    def trailing(self, target: float) -> tuple[float, float]:
        """(activation %, trail %) — lock in gains once most of the target is reached."""
        return target * 0.6, target * 0.4

    def net_pct(self, gross_move_pct: float) -> float:
        return gross_move_pct - self.round_trip_pct

    def net_pnl(self, entry: float, exit_: float, qty: float) -> float:
        gross = (exit_ - entry) * qty
        fees = (entry + exit_) * qty * self.fee_rate
        return gross - fees

    def min_volatility_bps(self, target: float, ratio: float = 1.2) -> float:
        """The pair must have moved at least this much recently for the target to be reachable quickly."""
        return target * 100 * ratio
