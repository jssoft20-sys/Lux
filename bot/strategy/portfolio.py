"""Open positions and P&L accounting."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Position:
    symbol: str
    qty: float
    entry_price: float
    entry_ts: float
    quote_spent: float
    fee_paid: float
    stop_loss: float
    take_profit: float
    highest: float
    trailing_active: bool = False
    trailing_stop: float = 0.0
    entry_signal: float = 0.0
    entry_reason: str = ""
    order_id: str = ""
    mode: str = "paper"
    extra: dict[str, Any] = field(default_factory=dict)

    def unrealized(self, bid: float, fee_rate: float) -> tuple[float, float]:
        """(pnl in quote after estimated exit fee, pnl %)."""
        if bid <= 0:
            return 0.0, 0.0
        proceeds = bid * self.qty * (1 - fee_rate)
        pnl = proceeds - self.quote_spent
        return pnl, pnl / self.quote_spent * 100 if self.quote_spent else 0.0

    @property
    def age_s(self) -> float:
        return time.time() - self.entry_ts

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Position":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)


class Portfolio:
    def __init__(self, quote_asset: str, fee_rate: float):
        self.quote_asset = quote_asset
        self.fee_rate = fee_rate
        self.positions: dict[str, Position] = {}
        self.realized_total: float = 0.0
        self.realized_today: float = 0.0
        self.day_key: str = self._today()

    @staticmethod
    def _today() -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    def roll_day(self) -> bool:
        today = self._today()
        if today != self.day_key:
            self.day_key = today
            self.realized_today = 0.0
            return True
        return False

    def add_realized(self, pnl: float) -> None:
        self.roll_day()
        self.realized_total += pnl
        self.realized_today += pnl

    def unrealized(self, bids: dict[str, float]) -> float:
        return sum(p.unrealized(bids.get(s, 0.0), self.fee_rate)[0] for s, p in self.positions.items())

    def exposure(self) -> float:
        return sum(p.quote_spent for p in self.positions.values())

    def snapshot(self, bids: dict[str, float]) -> list[dict[str, Any]]:
        out = []
        for s, p in self.positions.items():
            bid = bids.get(s, 0.0)
            pnl, pct = p.unrealized(bid, self.fee_rate)
            d = p.to_dict()
            d.update({"current": bid, "pnl": round(pnl, 4), "pnl_pct": round(pct, 3), "age_s": round(p.age_s), "value": round(bid * p.qty, 4)})
            out.append(d)
        return out
