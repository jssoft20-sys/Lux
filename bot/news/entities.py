"""Map free text to crypto tickers (entity extraction) — runs in microseconds."""

from __future__ import annotations

import re

# name / alias (lowercase) -> ticker. Multi-word aliases are matched before single words.
ALIASES: dict[str, str] = {
    "bitcoin": "BTC", "btc": "BTC", "satoshi": "BTC",
    "ethereum": "ETH", "ether": "ETH", "eth": "ETH", "vitalik": "ETH",
    "binance coin": "BNB", "bnb chain": "BNB", "bnb": "BNB", "bsc": "BNB",
    "cardano": "ADA", "hoskinson": "ADA",
    "avalanche": "AVAX", "avax": "AVAX",
    "aave": "AAVE",
    "bitcoin cash": "BCH", "bch": "BCH",
    "algorand": "ALGO",
    "axie infinity": "AXS", "axie": "AXS", "ronin": "AXS",
    "1inch": "1INCH",
    "basic attention token": "BAT", "brave browser": "BAT",
    "band protocol": "BAND",
    "bella protocol": "BEL",
    "bancor": "BNT",
    "coin98": "C98",
    "ac milan": "ACM", "milan fan token": "ACM",
    "my neighbor alice": "ALICE",
    "travala": "AVA",
    "chainlink": "LINK",
    "litecoin": "LTC", "ltc": "LTC",
    "ethereum classic": "ETC",
    "solana": "SOL", "sol": "SOL",
    "xrp": "XRP", "ripple": "XRP",
    "dogecoin": "DOGE", "doge": "DOGE",
    "polkadot": "DOT", "polygon": "POL", "matic": "POL", "tron": "TRX", "toncoin": "TON",
    "shiba inu": "SHIB", "shib": "SHIB", "pepe": "PEPE", "sui": "SUI", "near protocol": "NEAR",
    "aptos": "APT", "arbitrum": "ARB", "optimism": "OP", "uniswap": "UNI", "cosmos": "ATOM",
    "stellar": "XLM", "hedera": "HBAR", "filecoin": "FIL", "internet computer": "ICP",
    "vechain": "VET", "monero": "XMR", "tezos": "XTZ", "the sandbox": "SAND", "decentraland": "MANA",
    "gala games": "GALA", "apecoin": "APE", "chiliz": "CHZ", "fantom": "FTM", "sonic labs": "S",
    "injective": "INJ", "render network": "RENDER", "immutable": "IMX", "kaspa": "KAS", "sei network": "SEI",
    "pyth": "PYTH", "jupiter": "JUP", "worldcoin": "WLD", "maker": "MKR", "sky protocol": "SKY",
    "lido": "LDO", "curve": "CRV", "compound": "COMP", "synthetix": "SNX", "the graph": "GRT",
    "stacks": "STX", "thorchain": "RUNE", "celestia": "TIA", "ondo": "ONDO", "ethena": "ENA",
    "dogwifhat": "WIF", "bonk": "BONK", "floki": "FLOKI", "hyperliquid": "HYPE", "eigenlayer": "EIGEN",
}

# Uppercase tokens that look like tickers but are ordinary words / acronyms.
_STOP = {
    "USD", "USDT", "USDC", "EUR", "GBP", "ETF", "ETFS", "SEC", "CEO", "CTO", "CFO", "AI", "US", "UK", "EU", "UN",
    "ATH", "API", "NFT", "NFTS", "DEFI", "FED", "GDP", "CPI", "FOMC", "IPO", "OK", "THE", "AND", "FOR", "NEW",
    "TOP", "BIG", "ALL", "NOT", "BUT", "ARE", "HAS", "HOW", "WHY", "WHO", "ITS", "CAN", "MAY", "NOW", "OUT",
    "OFF", "PRO", "MAX", "MIN", "ONE", "TWO", "TEN", "USA", "NYC", "LLC", "INC", "LTD", "DAO", "TVL", "APY",
    "APR", "L2", "L1", "AML", "KYC", "OTC", "CME", "CBOE", "IMF", "ECB", "BOJ", "PBOC", "RSI", "MACD", "EMA",
    "SMA", "ATM", "PDF", "PC", "TV", "VR", "AR", "OP", "GM", "GN", "FUD", "FOMO", "HODL", "DEX", "CEX", "RWA",
    "BTFD", "DYOR", "WAGMI", "NGMI", "IRS", "DOJ", "FBI", "CFTC", "FTX", "SBF", "MT", "GOX", "TRUMP", "ELON",
}

_WORD_RE = re.compile(r"[a-z0-9][a-z0-9'\-]*")
_UPPER_RE = re.compile(r"\$?\b([A-Z0-9]{2,6})\b")
_PAIR_RE = re.compile(r"\b([A-Z0-9]{2,8})[/\-]?(USDT|USDC|BTC|ETH|BUSD|USD)\b")

MARKET_WORDS = (
    "crypto", "cryptocurrency", "cryptocurrencies", "altcoin", "altcoins", "digital asset", "blockchain",
    "token market", "coin market", "market cap", "stablecoin", "defi", "web3", "bitcoin", "etf",
)
MACRO_WORDS = (
    "fed", "federal reserve", "interest rate", "rate cut", "rate hike", "inflation", "cpi", "fomc",
    "tariff", "tariffs", "recession", "treasury", "sec", "regulation", "regulator", "regulators", "congress",
    "senate", "white house", "stock market", "wall street", "nasdaq", "s&p", "risk-off", "risk-on", "war",
    "sanction", "sanctions", "etf", "etfs",
)
_MACRO_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(MARKET_WORDS + MACRO_WORDS, key=len, reverse=True)) + r")\b")


class EntityExtractor:
    def __init__(self, known_tickers: list[str] | set[str]):
        self.known = {t.upper() for t in known_tickers}
        # only aliases whose ticker we trade, plus BTC/ETH (market drivers)
        self.aliases = {k: v for k, v in ALIASES.items() if v in self.known or v in ("BTC", "ETH")}
        self.multi = sorted((k for k in self.aliases if " " in k or "-" in k), key=len, reverse=True)
        self.single = {k: v for k, v in self.aliases.items() if " " not in k and "-" not in k}

    def extract(self, text: str) -> tuple[list[str], bool]:
        """Return (tickers, market_wide). Tickers are ordered by first appearance."""
        found: dict[str, int] = {}
        low = text.lower()

        for alias in self.multi:
            idx = low.find(alias)
            if idx >= 0:
                found.setdefault(self.aliases[alias], idx)

        for m in _WORD_RE.finditer(low):
            w = m.group(0)
            t = self.single.get(w)
            if t:
                found.setdefault(t, m.start())

        for m in _PAIR_RE.finditer(text):
            base = m.group(1)
            if base in self.known:
                found.setdefault(base, m.start())

        for m in _UPPER_RE.finditer(text):
            tok = m.group(1)
            if tok in _STOP or tok not in self.known:
                continue
            if len(tok) < 3 and not m.group(0).startswith("$"):
                continue
            found.setdefault(tok, m.start())

        tickers = [t for t, _ in sorted(found.items(), key=lambda kv: kv[1])]
        market_wide = _MACRO_RE.search(low) is not None
        return tickers, market_wide

    def is_crypto_related(self, text: str, tickers: list[str]) -> bool:
        if tickers:
            return True
        low = text.lower()
        return any(w in low for w in MARKET_WORDS)
