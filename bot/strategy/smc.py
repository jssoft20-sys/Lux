"""Smart-Money-Concepts analyser (the course playbook, made mechanical).

From closed candles it derives, per symbol:
* swings (3/5-candle fractals) and market structure: HH/HL uptrend, LH/LL downtrend, BOS (body
  close beyond the last swing in trend direction) and CHoCH (body close against the trend);
* liquidity pools: equal highs/lows (EQH/EQL), previous day/week/month highs/lows, old swing
  highs/lows — and sweeps of them (wick beyond the pool, close back inside);
* imbalances (3-candle FVG) and order blocks (the engulfed candle before the impulse that shifted
  structure), kept while untested and not closed through;
* the dealing range (sweep low → highest high since), equilibrium, discount/premium, OTE 0.62-0.79;
* a long setup when: liquidity was swept below, structure shifted up afterwards with an imbalance,
  price is in discount and touching a fresh POI, and the nearest buy-side liquidity gives RR ≥ min.
Only long setups are traded (spot); the bearish mirror lowers the score so we avoid / exit.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

from .candles import Candle, Levels


@dataclass
class Swing:
    idx: int
    ts: float
    price: float
    kind: str  # "H" | "L"


@dataclass
class Zone:
    kind: str  # "FVG" | "OB"
    direction: str  # "bull" | "bear"
    lo: float
    hi: float
    idx: int  # candle index where it formed
    tested: bool = False
    valid: bool = True

    @property
    def mid(self) -> float:
        return (self.lo + self.hi) / 2

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "dir": self.direction, "lo": self.lo, "hi": self.hi, "tested": self.tested}


@dataclass
class Sweep:
    side: str  # "SSL" (sell-side, below) | "BSL" (buy-side, above)
    level: float
    extreme: float  # the wick extreme (lowest low for SSL)
    idx: int
    label: str  # EQL / PDL / PWL / swing ...


@dataclass
class Setup:
    type: str
    entry: float
    sl: float
    tp1: float
    tp2: float
    rr: float
    zone: Zone
    reason: str
    tp1_label: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["zone"] = self.zone.to_dict()
        return d


@dataclass
class SMCState:
    symbol: str
    ts: float
    bias15: str = "range"
    trend5: str = "range"
    trend1: str = "range"
    last_event: str = ""
    event_age: int = 999
    sweep: Sweep | None = None
    sweep_age: int = 999
    shift_after_sweep: bool = False
    imbalance_after_sweep: bool = False
    range_lo: float = 0.0
    range_hi: float = 0.0
    atr: float = 0.0
    zones: list[Zone] = field(default_factory=list)
    bsl: list[tuple[float, str]] = field(default_factory=list)
    ssl: list[tuple[float, str]] = field(default_factory=list)
    candles: int = 0
    # filled by evaluate(price)
    score: float = 0.0
    discount: bool = False
    in_ote: bool = False
    poi: Zone | None = None
    setup: Setup | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "bias15": self.bias15, "trend5": self.trend5, "trend1": self.trend1, "last_event": self.last_event, "event_age": self.event_age,
            "sweep": None if not self.sweep else {"side": self.sweep.side, "level": self.sweep.level, "label": self.sweep.label, "age": self.sweep_age},
            "shift": self.shift_after_sweep, "imbalance": self.imbalance_after_sweep,
            "range_lo": self.range_lo, "range_hi": self.range_hi, "discount": self.discount, "in_ote": self.in_ote,
            "poi": self.poi.to_dict() if self.poi else None, "zones": [z.to_dict() for z in self.zones[:4]],
            "bsl": self.bsl[:3], "ssl": self.ssl[:3], "score": round(self.score, 3),
            "setup": self.setup.to_dict() if self.setup else None, "notes": self.notes, "candles": self.candles,
        }


# ------------------------------------------------------------------ primitives
def atr(c: list[Candle], n: int = 14) -> float:
    if len(c) < 2:
        return c[-1].range if c else 0.0
    trs = []
    for i in range(max(1, len(c) - n), len(c)):
        trs.append(max(c[i].high - c[i].low, abs(c[i].high - c[i - 1].close), abs(c[i].low - c[i - 1].close)))
    return sum(trs) / len(trs) if trs else 0.0


def swings(c: list[Candle], n: int = 2) -> list[Swing]:
    out: list[Swing] = []
    for i in range(n, len(c) - n):
        hi = c[i].high
        lo = c[i].low
        if all(hi > c[j].high for j in range(i - n, i)) and all(hi >= c[j].high for j in range(i + 1, i + n + 1)):
            out.append(Swing(i, c[i].ts, hi, "H"))
        if all(lo < c[j].low for j in range(i - n, i)) and all(lo <= c[j].low for j in range(i + 1, i + n + 1)):
            out.append(Swing(i, c[i].ts, lo, "L"))
    return out


def trend_from_swings(sw: list[Swing]) -> str:
    highs = [s for s in sw if s.kind == "H"][-3:]
    lows = [s for s in sw if s.kind == "L"][-3:]
    if len(highs) >= 2 and len(lows) >= 2:
        hh = highs[-1].price > highs[-2].price
        hl = lows[-1].price > lows[-2].price
        lh = highs[-1].price < highs[-2].price
        ll = lows[-1].price < lows[-2].price
        if hh and hl:
            return "bull"
        if lh and ll:
            return "bear"
    return "range"


def structure_events(c: list[Candle], sw: list[Swing]) -> list[tuple[int, str, float]]:
    """(candle index, event, level): BOS_UP/DOWN in trend direction, CHOCH_UP/DOWN against it.
    A break needs a body close beyond the swing (wicks do not count)."""
    events: list[tuple[int, str, float]] = []
    last_h: Swing | None = None
    last_l: Swing | None = None
    trend = "range"
    sw_by_idx: dict[int, list[Swing]] = {}
    for s in sw:
        sw_by_idx.setdefault(s.idx, []).append(s)
    pending_h: Swing | None = None
    pending_l: Swing | None = None
    n = 2
    for i in range(len(c)):
        # swings become known only n candles after their pivot
        for s in sw_by_idx.get(i - n, []):
            if s.kind == "H":
                pending_h = s
            else:
                pending_l = s
        close = c[i].close
        if pending_h and close > pending_h.price:
            ev = "BOS_UP" if trend == "bull" else "CHOCH_UP"
            events.append((i, ev, pending_h.price))
            trend = "bull"
            last_h, pending_h = pending_h, None
        elif pending_l and close < pending_l.price:
            ev = "BOS_DOWN" if trend == "bear" else "CHOCH_DOWN"
            events.append((i, ev, pending_l.price))
            trend = "bear"
            last_l, pending_l = pending_l, None
    return events


def equal_levels(sw: list[Swing], kind: str, tol: float) -> list[float]:
    pts = sorted(s.price for s in sw if s.kind == kind)
    out: list[float] = []
    i = 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and abs(pts[j + 1] - pts[i]) <= tol:
            j += 1
        if j > i:
            out.append(min(pts[i:j + 1]) if kind == "L" else max(pts[i:j + 1]))
        i = j + 1
    return out


def fvgs(c: list[Candle], start: int = 0) -> list[Zone]:
    out: list[Zone] = []
    for i in range(max(2, start), len(c)):
        a, b = c[i - 2], c[i]
        if b.low > a.high and c[i - 1].bullish:  # bullish imbalance
            out.append(Zone("FVG", "bull", a.high, b.low, i))
        elif b.high < a.low and not c[i - 1].bullish:
            out.append(Zone("FVG", "bear", b.high, a.low, i))
    return out


def order_blocks(c: list[Candle], events: list[tuple[int, str, float]]) -> list[Zone]:
    """Bullish OB = last bearish candle before the impulse that produced an up-shift (and vice versa)."""
    out: list[Zone] = []
    for idx, ev, _level in events[-6:]:
        if ev.endswith("_UP"):
            j = idx
            while j > 0 and c[j].bullish:
                j -= 1
            if j > 0 and idx - j <= 12:
                out.append(Zone("OB", "bull", c[j].low, c[j].high, j))
        else:
            j = idx
            while j > 0 and not c[j].bullish:
                j -= 1
            if j > 0 and idx - j <= 12:
                out.append(Zone("OB", "bear", c[j].low, c[j].high, j))
    return out


def _mark_zones(c: list[Candle], zones: list[Zone]) -> list[Zone]:
    """Test / invalidate zones with the candles that came after their formation."""
    # a zone counts as "tested" (used up) once price has consumed more than half of it (the 0.5 level
    # is where the reaction is expected); a body close through the far side invalidates it
    for z in zones:
        for k in range(z.idx + 1, len(c)):
            cd = c[k]
            if z.direction == "bull":
                if cd.close < z.lo:
                    z.valid = False
                    break
                if cd.low < z.mid:
                    z.tested = True
            else:
                if cd.close > z.hi:
                    z.valid = False
                    break
                if cd.high > z.mid:
                    z.tested = True
    return [z for z in zones if z.valid]


def find_sweep(c: list[Candle], pools: list[tuple[float, str]], side: str, lookback: int, min_depth: float) -> Sweep | None:
    """Most recent sweep: a candle pokes beyond the pool by ≥ min_depth and closes back inside
    (or the next candle closes back inside)."""
    best: Sweep | None = None
    start = max(1, len(c) - lookback)
    for i in range(start, len(c)):
        cd = c[i]
        for level, label in pools:
            if side == "SSL":
                if cd.low < level - min_depth and level < cd.open:
                    nxt = c[i + 1] if i + 1 < len(c) else None
                    if cd.close > level or (nxt is not None and nxt.close > level):
                        ext = min(cd.low, nxt.low if nxt is not None else cd.low)
                        best = Sweep("SSL", level, ext, i, label)
            else:
                if cd.high > level + min_depth and level > cd.open:
                    nxt = c[i + 1] if i + 1 < len(c) else None
                    if cd.close < level or (nxt is not None and nxt.close < level):
                        ext = max(cd.high, nxt.high if nxt is not None else cd.high)
                        best = Sweep("BSL", level, ext, i, label)
    return best


# ------------------------------------------------------------------ analysis
def analyze(symbol: str, m1: list[Candle], m5: list[Candle], m15: list[Candle], levels: Levels, *, sweep_lookback: int = 60, fractal: int = 2) -> SMCState:
    st = SMCState(symbol=symbol, ts=time.time(), candles=len(m1))
    if len(m1) < 40:
        st.notes.append("мало свечей")
        return st
    c = m1[-300:]
    st.atr = atr(c)
    price = c[-1].close
    tol = max(price * 0.0006, 0.35 * st.atr)

    sw15 = swings(m15, fractal)
    sw5 = swings(m5, fractal)
    sw1 = swings(c, fractal)
    st.bias15 = trend_from_swings(sw15) if len(sw15) >= 4 else "range"
    st.trend5 = trend_from_swings(sw5) if len(sw5) >= 4 else "range"
    st.trend1 = trend_from_swings(sw1) if len(sw1) >= 4 else "range"

    events = structure_events(c, sw1)
    if events:
        idx, ev, _ = events[-1]
        st.last_event, st.event_age = ev, len(c) - 1 - idx

    # liquidity pools
    ssl_pools: list[tuple[float, str]] = [(lv, "EQL") for lv in equal_levels(sw1, "L", tol)]
    bsl_pools: list[tuple[float, str]] = [(lv, "EQH") for lv in equal_levels(sw1, "H", tol)]
    for s in sw5[-8:]:
        (ssl_pools if s.kind == "L" else bsl_pools).append((s.price, "swing5"))
    for s in sw15[-6:]:
        (ssl_pools if s.kind == "L" else bsl_pools).append((s.price, "swing15"))
    for val, label in ((levels.prev_day_low, "PDL"), (levels.prev_week_low, "PWL"), (levels.prev_month_low, "PML")):
        if val > 0:
            ssl_pools.append((val, label))
    for val, label in ((levels.prev_day_high, "PDH"), (levels.prev_week_high, "PWH"), (levels.prev_month_high, "PMH")):
        if val > 0:
            bsl_pools.append((val, label))

    min_depth = max(price * 0.0002, 0.1 * st.atr)  # "a few points beyond the level is not a sweep"
    sw_ssl = find_sweep(c, ssl_pools, "SSL", sweep_lookback, min_depth)
    sw_bsl = find_sweep(c, bsl_pools, "BSL", sweep_lookback, min_depth)
    # the more recent one defines the context
    sweep = None
    if sw_ssl and (not sw_bsl or sw_ssl.idx >= sw_bsl.idx):
        sweep = sw_ssl
    elif sw_bsl:
        sweep = sw_bsl
    st.sweep = sweep
    if sweep:
        st.sweep_age = len(c) - 1 - sweep.idx
        after = [e for e in events if e[0] > sweep.idx]
        if sweep.side == "SSL":
            st.shift_after_sweep = any(e[1].endswith("_UP") for e in after)
            st.imbalance_after_sweep = any(z.direction == "bull" for z in fvgs(c, sweep.idx + 1))
            st.range_lo = sweep.extreme
            st.range_hi = max(x.high for x in c[sweep.idx:])
        else:
            st.shift_after_sweep = any(e[1].endswith("_DOWN") for e in after)
            st.imbalance_after_sweep = any(z.direction == "bear" for z in fvgs(c, sweep.idx + 1))
            st.range_hi = sweep.extreme
            st.range_lo = min(x.low for x in c[sweep.idx:])
    else:
        lows = [s for s in sw1 if s.kind == "L"][-2:]
        highs = [s for s in sw1 if s.kind == "H"][-2:]
        if lows and highs:
            st.range_lo = min(s.price for s in lows)
            st.range_hi = max(s.price for s in highs)

    # POI zones: fresh imbalances / order blocks below price (bull) — and above (bear) for the mirror
    zones = _mark_zones(c, fvgs(c, max(0, len(c) - 120)) + order_blocks(c, events))
    zones = [z for z in zones if not z.tested and (z.hi - z.lo) > 0]
    zones.sort(key=lambda z: -z.idx)
    st.zones = zones[:8]

    # liquidity targets around the current price
    st.bsl = sorted({(round(lv, 10), lb) for lv, lb in bsl_pools if lv > price * 1.0005}, key=lambda x: x[0])[:5]
    st.ssl = sorted({(round(lv, 10), lb) for lv, lb in ssl_pools if lv < price * 0.9995}, key=lambda x: -x[0])[:5]
    return st


def evaluate(st: SMCState, price: float, *, min_rr: float = 2.0, min_tp_pct: float = 0.5, spread_bps: float = 0.0, sweep_max_age: int = 90) -> SMCState:
    """Price-dependent part (cheap; runs every tick): discount / OTE / POI touch / setup / score."""
    st.notes = []
    st.setup = None
    st.poi = None
    if st.candles < 40 or price <= 0:
        st.score = 0.0
        return st
    rng = st.range_hi - st.range_lo
    if rng > 0:
        eq = st.range_lo + rng / 2
        st.discount = price < eq
        ote_hi = st.range_hi - 0.62 * rng
        ote_lo = st.range_hi - 0.79 * rng
        st.in_ote = ote_lo <= price <= ote_hi
    else:
        st.discount = False
        st.in_ote = False
    score = 0.0
    bias = {"bull": 0.25, "bear": -0.25}.get(st.bias15, 0.0)
    score += bias
    score += {"bull": 0.1, "bear": -0.1}.get(st.trend5, 0.0)
    fresh_sweep = st.sweep is not None and st.sweep_age <= sweep_max_age
    if fresh_sweep and st.sweep:
        score += 0.25 if st.sweep.side == "SSL" else -0.25
        if st.shift_after_sweep:
            score += 0.2 if st.sweep.side == "SSL" else -0.2
    if st.last_event.endswith("_UP") and st.event_age <= 30:
        score += 0.1
    elif st.last_event.endswith("_DOWN") and st.event_age <= 30:
        score -= 0.1
    score += 0.1 if st.discount else -0.05
    # POI touch: price inside a fresh bull zone or within a hair above it
    touch_tol = max(price * 0.0005, 0.15 * st.atr)
    for z in st.zones:
        if z.direction == "bull" and z.lo - touch_tol <= price <= z.hi + touch_tol:
            st.poi = z
            score += 0.2
            break
    notes = []
    if st.bias15 == "bull":
        notes.append("15м ↑")
    elif st.bias15 == "bear":
        notes.append("15м ↓")
    if fresh_sweep and st.sweep:
        notes.append(f"свип {st.sweep.label} {st.sweep_age}м назад")
    if st.shift_after_sweep and fresh_sweep:
        notes.append("слом ↑" if st.sweep and st.sweep.side == "SSL" else "слом ↓")
    if st.discount:
        notes.append("дисконт" + (" · OTE" if st.in_ote else ""))
    if st.poi:
        notes.append(f"POI {st.poi.kind}")

    # long setup
    if fresh_sweep and st.sweep and st.sweep.side == "SSL" and st.shift_after_sweep and st.discount and st.poi and st.bias15 != "bear":
        buffer = max(spread_bps / 1e4 * price, 0.15 * st.atr)
        sl = st.sweep.extreme - buffer
        risk = price - sl
        if risk > 0:
            targets = [(lv, lb) for lv, lb in st.bsl if (lv / price - 1) * 100 >= min_tp_pct]
            if targets:
                # the main target is the first liquidity pool that pays at least min_rr; nearer pools are passed through
                main = next((i for i, (lv, _) in enumerate(targets) if (lv - price) / risk >= min_rr), None)
                if main is not None:
                    tp1, lb1 = targets[main]
                    tp2 = targets[main + 1][0] if main + 1 < len(targets) else price + (tp1 - price) * 1.5
                    rr = (tp1 - price) / risk
                    st.setup = Setup("STB", price, sl, tp1, tp2, round(rr, 2), st.poi, " · ".join(notes), lb1)
                    score = max(score, 0.9)
                    notes.append(f"сетап RR {rr:.1f} → {lb1}")
                else:
                    best_rr = max((lv - price) / risk for lv, _ in targets)
                    notes.append(f"RR {best_rr:.1f} < {min_rr}")
            else:
                notes.append("нет цели выше")
    st.score = max(-1.0, min(1.0, score))
    st.notes = notes
    return st
