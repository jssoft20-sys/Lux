"""Millisecond lexicon sentiment for crypto headlines.

Not a substitute for the LLM analyser, but it reacts instantly to every new item and gives
a usable signal even without an Anthropic key. Scores are in [-1, 1].
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

# phrase / word -> weight (positive = bullish). Phrases are matched before single words.
LEXICON: dict[str, float] = {
    # --- strongly positive ---
    "all-time high": 2.5, "all time high": 2.5, "record high": 2.5, "etf approval": 3.0, "etf approved": 3.0,
    "spot etf": 1.5, "strategic reserve": 2.5, "bitcoin reserve": 2.5, "bull run": 2.5, "bull market": 2.0,
    "regulatory clarity": 2.0, "drops case": 2.0, "drops lawsuit": 2.5, "wins case": 2.5, "dismisses lawsuit": 2.5,
    "buy the dip": 1.0, "whale buys": 2.0, "whales buy": 2.0, "whale accumulation": 2.0, "accepts bitcoin": 2.0,
    "accept bitcoin": 2.0, "accept crypto": 1.5, "will list": 3.0, "to list": 2.5, "lists": 2.0, "listing": 2.0,
    "listed on binance": 3.0, "binance listing": 3.0, "binance lists": 3.0, "binance will list": 3.0, "coinbase lists": 2.5,
    "coinbase listing": 2.5, "new listing": 2.0, "launchpool": 2.0, "launchpad": 1.5, "mainnet launch": 2.0,
    "token burn": 2.0, "buyback": 2.0, "short squeeze": 2.0, "surges": 2.0, "surge": 2.0, "soars": 2.5, "soar": 2.5,
    "skyrockets": 2.5, "skyrocket": 2.5, "rallies": 2.0, "rally": 2.0, "jumps": 1.5, "jump": 1.5, "spikes": 1.5,
    "spike": 1.5, "breakout": 2.0, "breaks out": 2.0, "explodes": 1.5, "pumps": 1.5, "pump": 1.2, "moon": 1.0,
    "approves": 2.5, "approved": 2.5, "approval": 2.0, "greenlight": 2.0, "greenlights": 2.0, "inflows": 2.0,
    "inflow": 2.0, "record inflows": 3.0, "institutional": 1.0, "adoption": 1.5, "adopts": 1.5, "partnership": 1.5,
    "partners with": 1.5, "partner": 1.0, "integration": 1.0, "integrates": 1.2, "upgrade": 1.5, "upgrades": 1.5,
    "mainnet": 1.2, "milestone": 1.0, "bullish": 2.0, "optimism": 1.5, "optimistic": 1.5, "recovers": 1.5,
    "recovery": 1.5, "rebounds": 1.5, "rebound": 1.5, "bounces": 1.2, "bounce": 1.0, "outperforms": 1.5,
    "outperform": 1.5, "gains": 1.0, "gain": 1.0, "rises": 1.0, "rise": 1.0, "climbs": 1.0, "climb": 1.0,
    "tops": 1.0, "hits": 0.5, "growth": 1.0, "grows": 1.0, "expands": 1.0, "expansion": 1.0, "boosts": 1.5,
    "boost": 1.5, "accumulates": 1.5, "accumulation": 1.5, "accumulate": 1.5, "bought": 1.0, "buys": 1.5,
    "buying": 1.0, "demand": 1.0, "strong": 0.8, "strength": 1.0, "green": 0.8, "profit": 1.0, "profits": 1.0,
    "investment": 1.0, "invests": 1.5, "invest": 0.8, "funding": 1.0, "raises": 1.2, "raised": 1.0, "airdrop": 1.0,
    "grant": 0.8, "positive": 1.0, "upside": 1.5, "undervalued": 1.0, "wins": 1.0, "win": 1.0, "victory": 2.0,
    "cleared": 1.5, "settles": 1.0, "settlement": 1.0, "dismisses": 1.5, "dismissed": 1.5, "halving": 1.0,
    "tokenization": 1.0, "payments": 0.8, "reserve": 1.0, "support": 0.4, "surpasses": 1.5, "surpass": 1.5,
    "reclaims": 1.5, "recovering": 1.2, "momentum": 0.8, "ath": 2.0, "highs": 1.2, "high": 0.5, "up": 0.5,
    "soaring": 2.5, "surging": 2.0, "rallying": 2.0, "jumping": 1.5, "rising": 1.0, "climbing": 1.0, "gaining": 1.0,
    # --- strongly negative ---
    "hack": -3.0, "hacked": -3.0, "hacker": -2.5, "hackers": -2.5, "exploit": -3.0, "exploited": -3.0,
    "breach": -2.5, "stolen": -2.5, "theft": -2.5, "drained": -2.5, "drains": -2.5, "drain": -2.0, "rug pull": -3.0,
    "rugpull": -3.0, "rug": -2.0, "scam": -2.5, "fraud": -2.5, "ponzi": -2.5, "exit scam": -3.0, "lawsuit": -2.0,
    "sues": -2.0, "sued": -2.0, "charges": -2.0, "charged": -2.0, "indictment": -2.5, "indicted": -2.5,
    "arrest": -2.5, "arrested": -2.5, "ban": -2.5, "bans": -2.5, "banned": -2.5, "crackdown": -2.5,
    "investigation": -1.5, "investigates": -1.5, "probe": -1.5, "subpoena": -1.5, "fined": -1.5, "penalty": -1.5,
    "delist": -3.0, "delisted": -3.0, "delisting": -3.0, "delists": -3.0, "will delist": -3.0, "halt": -2.0,
    "halted": -2.0, "halts": -2.0, "suspend": -2.0, "suspended": -2.0, "suspends": -2.0, "outage": -2.0,
    "downtime": -1.5, "bug": -1.5, "vulnerability": -2.0, "crash": -2.5, "crashes": -2.5, "crashing": -2.5,
    "plunge": -2.5, "plunges": -2.5, "plunging": -2.5, "plummet": -2.5, "plummets": -2.5, "tumble": -2.0,
    "tumbles": -2.0, "drop": -1.5, "drops": -1.5, "dropping": -1.5, "fall": -1.5, "falls": -1.5, "falling": -1.5,
    "slump": -2.0, "slumps": -2.0, "slide": -1.5, "slides": -1.5, "dump": -2.0, "dumps": -2.0, "dumping": -2.0,
    "sell-off": -2.0, "selloff": -2.0, "sell off": -2.0, "liquidation": -2.0, "liquidations": -2.0,
    "liquidated": -2.0, "bearish": -2.0, "bear market": -2.0, "fear": -1.5, "panic": -2.0, "collapse": -3.0,
    "collapses": -3.0, "collapsed": -3.0, "bankrupt": -3.0, "bankruptcy": -3.0, "insolvent": -3.0,
    "insolvency": -3.0, "default": -2.0, "outflow": -2.0, "outflows": -2.0, "record outflows": -3.0,
    "withdrawals halted": -3.0, "withdrawals paused": -3.0, "pauses withdrawals": -3.0, "warning": -1.0,
    "warns": -1.0, "concern": -1.0, "concerns": -1.0, "uncertainty": -1.0, "loss": -1.5, "losses": -1.5,
    "loses": -1.5, "lost": -1.0, "decline": -1.5, "declines": -1.5, "declining": -1.5, "down": -0.8, "red": -0.8,
    "weak": -1.0, "weakness": -1.0, "pressure": -1.0, "sell pressure": -2.0, "whale sells": -2.0,
    "whales sell": -2.0, "whale dumps": -2.5, "sold": -1.0, "sells": -1.2, "selling": -1.0, "token unlock": -2.0,
    "unlock": -1.5, "unlocks": -1.5, "inflation": -0.8, "rate hike": -1.5, "hawkish": -1.5, "tariff": -1.5,
    "tariffs": -1.5, "recession": -2.0, "war": -1.5, "sanction": -1.5, "sanctions": -1.5, "reject": -2.0,
    "rejects": -2.0, "rejected": -2.0, "delay": -2.0, "delays": -2.0, "delayed": -2.0, "postpone": -2.0,
    "postponed": -2.0, "fud": -1.0, "scandal": -2.0, "manipulation": -2.0, "wash trading": -2.0,
    "money laundering": -2.0, "shutdown": -2.5, "shut down": -2.5, "shuts down": -2.5, "layoffs": -1.5,
    "negative": -1.0, "downside": -1.5, "overvalued": -1.0, "bubble": -1.5, "dead": -1.5, "worst": -1.5,
    "fails": -1.5, "failure": -2.0, "failed": -1.5, "attack": -2.5, "attacker": -2.5, "phishing": -2.0,
    "malware": -2.0, "frozen": -2.0, "freeze": -2.0, "freezes": -2.0, "seized": -2.0, "seizure": -2.0,
    "cease and desist": -2.5, "wells notice": -2.5, "lows": -1.2, "low": -0.5, "dips": -1.0, "dip": -0.8,
    "risk": -0.4, "risks": -0.4, "volatile": -0.5, "volatility": -0.4, "correction": -1.2, "capitulation": -2.0,
    "unrealized losses": -1.5, "underperforms": -1.5, "underperform": -1.5, "downgrade": -1.5, "downgrades": -1.5,
    "misses": -1.0, "shortfall": -1.5, "deficit": -1.0, "restriction": -1.5, "restrictions": -1.5, "blocked": -1.5,
    "blocks": -1.2, "illegal": -2.0, "criminal": -2.0, "guilty": -2.5, "prison": -2.0, "jail": -2.0,
}

# Sponsored / clickbait / prediction content: never a tradeable signal on its own.
PROMO_TERMS = (
    "price prediction", "presale", "pre-sale", "best crypto to buy", "top 5", "top 10", "top crypto", "coins to watch",
    "coin to watch", "to buy now", "next 100x", "100x", "1000x", "could reach", "will it reach", "remittix", "sponsored",
    "press release", "partner content", "giveaway", "how to buy", "where to buy", "meme coin to", "millionaire", "explosive growth",
)
NEGATORS = {"not", "no", "never", "denies", "denied", "deny", "without", "isn't", "wasn't", "false", "fake", "debunks", "debunked", "unlikely", "won't", "doesn't", "didn't", "cannot", "can't"}
INTENSIFIERS = {"massive": 1.4, "huge": 1.3, "record": 1.3, "sharply": 1.3, "major": 1.2, "biggest": 1.4, "historic": 1.4, "largest": 1.3, "extreme": 1.3, "unprecedented": 1.4, "big": 1.15, "strong": 1.15, "significant": 1.2}
QUESTION_DAMPEN = 0.6  # "Will bitcoin crash?" is weaker than "Bitcoin crashes"

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'\-]*|[&%$]")
_PHRASES = sorted((k for k in LEXICON if " " in k), key=len, reverse=True)


@dataclass
class SentimentResult:
    score: float  # [-1, 1]
    raw: float
    hits: int
    importance: float  # [0, 1]
    confidence: float  # [0, 1]
    terms: list[str]


def analyse(text: str) -> SentimentResult:
    low = " " + text.lower().replace("’", "'") + " "
    raw = 0.0
    hits = 0
    max_abs = 0.0
    terms: list[str] = []

    # phrases first; consume them so their words are not double counted
    for ph in _PHRASES:
        if f" {ph} " in low or f" {ph}," in low or f" {ph}." in low or f" {ph}:" in low or f" {ph}'" in low:
            w = LEXICON[ph]
            raw += w
            hits += 1
            max_abs = max(max_abs, abs(w))
            terms.append(ph)
            low = low.replace(ph, " ")

    tokens = _TOKEN_RE.findall(low)
    for i, tok in enumerate(tokens):
        w = LEXICON.get(tok)
        if w is None:
            continue
        window = tokens[max(0, i - 3):i]
        if any(t in NEGATORS for t in window):
            w = -w * 0.7
        for t in tokens[max(0, i - 2):i]:
            m = INTENSIFIERS.get(t)
            if m:
                w *= m
                break
        raw += w
        hits += 1
        max_abs = max(max_abs, abs(w))
        terms.append(tok)

    if "?" in text:
        raw *= QUESTION_DAMPEN
    promo = any(p in low or p in text.lower() for p in PROMO_TERMS)
    if promo:
        raw *= 0.3
        terms.append("promo")

    score = math.tanh(raw / 3.0)
    importance = min(1.0, 0.3 + max_abs / 3.0 * 0.7) if hits else 0.2
    if promo:
        importance = min(importance, 0.15)
    confidence = min(1.0, hits / 3.0)
    return SentimentResult(score=round(score, 4), raw=round(raw, 3), hits=hits, importance=round(importance, 3), confidence=round(confidence, 3), terms=terms)
