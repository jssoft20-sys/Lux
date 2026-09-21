"""SMC analyser on synthetic candles: equal lows → sweep → CHoCH with an imbalance → pullback into the POI."""

import time

from bot.strategy.candles import Candle, Levels, aggregate
from bot.strategy.sessions import SessionClock, parse_windows
from bot.strategy.smc import analyze, evaluate, fvgs, structure_events, swings


def _c(i, o, h, l, c, t0):
    return Candle(t0 + i * 60, o, h, l, c, 1000.0)


def build_scenario():
    """~200 one-minute candles around price 100."""
    t0 = time.time() - 200 * 60
    c = []
    i = 0
    p = 100.0
    # 1) prior range with two equal lows at 99.0 and highs near 101.5 (liquidity both sides)
    pattern = [100.4, 100.9, 101.5, 101.0, 100.2, 99.4, 99.0, 99.6, 100.3, 100.9, 101.4, 100.8, 100.1, 99.5, 99.0, 99.7, 100.4]
    for _ in range(6):
        for px in pattern:
            c.append(_c(i, p, max(p, px) + 0.05, min(p, px) - 0.05, px, t0))
            p = px
            i += 1
    # 2) drift down into the lows (downtrend on 1m: LH/LL)
    for px in [100.0, 99.7, 99.9, 99.5, 99.6, 99.3, 99.45, 99.2]:
        c.append(_c(i, p, max(p, px) + 0.03, min(p, px) - 0.03, px, t0))
        p = px
        i += 1
    # 3) sweep of the equal lows: wick to 98.7, close back above 99.0
    c.append(_c(i, p, p + 0.05, 98.7, 99.15, t0))
    p = 99.15
    i += 1
    # 4) displacement up with an imbalance (candle i+1 low above candle i-1 high) and a body close above the last swing high
    seq = [(99.15, 99.2, 99.1, 99.6), (99.6, 100.3, 99.58, 100.25), (100.25, 100.9, 100.2, 100.8)]
    for o, h, l, cl in seq:
        c.append(_c(i, o, h, l, cl, t0))
        i += 1
    p = 100.8
    # 5) pullback into the imbalance zone (99.6 .. 99.58 area -> FVG between candle1 high 99.2 and candle3 low 100.2? we test touch of the OB/FVG)
    for px in [100.6, 100.4, 100.15, 100.0, 99.9]:
        c.append(_c(i, p, max(p, px) + 0.03, min(p, px) - 0.03, px, t0))
        p = px
        i += 1
    return c


def test_primitives():
    c = build_scenario()
    sw = swings(c, 2)
    assert any(s.kind == "L" for s in sw) and any(s.kind == "H" for s in sw)
    ev = structure_events(c, sw)
    assert any(e[1].endswith("_UP") for e in ev), ev[-5:]
    assert any(z.direction == "bull" for z in fvgs(c, len(c) - 12))


def test_setup_after_sweep_and_shift():
    c = build_scenario()
    m5, m15 = aggregate(c, 5), aggregate(c, 15)
    st = analyze("TESTUSDT", c, m5, m15, Levels(prev_day_low=98.9, prev_day_high=102.5))
    assert st.sweep is not None and st.sweep.side == "SSL", st.to_dict()
    assert st.shift_after_sweep, st.to_dict()
    assert st.imbalance_after_sweep
    price = 99.7  # inside the imbalance (99.2-100.2) and below the equilibrium of the 98.7-100.9 range
    evaluate(st, price, min_rr=1.5, min_tp_pct=0.3, spread_bps=2)
    assert st.discount
    assert st.poi is not None, st.to_dict()
    assert st.setup is not None, st.to_dict()
    assert st.setup.sl < st.sweep.extreme
    assert st.setup.tp1 > price and st.setup.rr >= 1.5
    assert st.score >= 0.9
    # far above equilibrium there is no setup and the score drops
    evaluate(st, 100.85, min_rr=1.5, min_tp_pct=0.3)
    assert st.setup is None and not st.discount


def test_session_clock():
    clock = SessionClock("04:00-09:30,11:45-14:45", reduced_days="mon,fri")
    assert len(parse_windows("04:00-09:30,11:45-14:45")) == 2
    ts = time.mktime(time.struct_time((2026, 9, 22, 5, 0, 0, 1, 265, 0))) - time.timezone  # Tuesday 05:00 UTC
    assert clock.in_ott(ts) and clock.current_window(ts).name == "OTT1"
    ts2 = ts + 6 * 3600  # 11:00 UTC — between windows
    assert not clock.in_ott(ts2)
    assert clock.session_key(ts) != clock.session_key(ts2)
    assert not clock.is_reduced_risk_day(ts)
    assert SessionClock("").in_ott(ts2)  # no windows = always OTT
