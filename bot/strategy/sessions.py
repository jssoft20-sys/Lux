"""Trading sessions / optimal trading time (OTT) from the playbook.

The course trades weekdays in two windows (Moscow time 07:00-12:30 and 14:45-17:45, i.e.
04:00-09:30 and 11:45-14:45 UTC), reduces risk on Monday's open and Friday's close, and stops
for the session after a losing trade. Crypto trades 24/7, so the windows are configurable and
can be advisory (a weight) or mandatory (no trade outside them).
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Window:
    start_min: int  # minutes since 00:00 UTC
    end_min: int
    name: str

    def contains(self, minute_of_day: int) -> bool:
        return self.start_min <= minute_of_day < self.end_min


def parse_windows(spec: str) -> list[Window]:
    """'04:00-09:30,11:45-14:45' (UTC) -> windows. Empty spec -> no windows (always OTT)."""
    out: list[Window] = []
    for i, part in enumerate(x.strip() for x in spec.split(",") if x.strip()):
        try:
            a, b = part.split("-")
            ah, am = (int(v) for v in a.split(":"))
            bh, bm = (int(v) for v in b.split(":"))
            out.append(Window(ah * 60 + am, bh * 60 + bm, f"OTT{i + 1}"))
        except ValueError:
            continue
    return out


class SessionClock:
    def __init__(self, windows_spec: str, weekdays_only: bool = False, reduced_days: str = ""):
        self.windows = parse_windows(windows_spec)
        self.weekdays_only = weekdays_only
        self.reduced = {d.strip().lower()[:3] for d in reduced_days.split(",") if d.strip()}

    def _parts(self, now: float | None = None) -> tuple[time.struct_time, int]:
        t = time.gmtime(now or time.time())
        return t, t.tm_hour * 60 + t.tm_min

    def current_window(self, now: float | None = None) -> Window | None:
        t, mod = self._parts(now)
        if self.weekdays_only and t.tm_wday >= 5:
            return None
        for w in self.windows:
            if w.contains(mod):
                return w
        return None

    def in_ott(self, now: float | None = None) -> bool:
        if not self.windows:
            return True
        return self.current_window(now) is not None

    def session_key(self, now: float | None = None) -> str:
        """Identifies the session a trade belongs to (date + window, or date + 4-hour block outside windows)."""
        t, mod = self._parts(now)
        w = self.current_window(now)
        tag = w.name if w else f"B{mod // 240}"
        return f"{t.tm_year}-{t.tm_yday}-{tag}"

    def is_reduced_risk_day(self, now: float | None = None) -> bool:
        t, _ = self._parts(now)
        names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        return names[t.tm_wday] in self.reduced

    def status(self, now: float | None = None) -> dict:
        w = self.current_window(now)
        return {"in_ott": self.in_ott(now), "window": w.name if w else None, "session": self.session_key(now), "reduced_risk_day": self.is_reduced_risk_day(now), "windows": [f"{x.start_min // 60:02d}:{x.start_min % 60:02d}-{x.end_min // 60:02d}:{x.end_min % 60:02d}" for x in self.windows]}
