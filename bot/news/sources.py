"""News / signal sources. Every fetcher returns a list of raw items:
``{"id", "title", "summary", "url", "published", "source", "weight", "tickers_hint"}``.
"""

from __future__ import annotations

import asyncio
import calendar
import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from urllib.parse import quote_plus

import feedparser
import httpx

log = logging.getLogger("lux.news.sources")

UA = "Mozilla/5.0 (X11; Linux x86_64) LuxBot/1.0 (+news reader)"


@dataclass
class Source:
    name: str
    kind: str  # rss | binance | google | fng | cryptopanic | newsapi | reddit
    url: str
    interval: float = 20.0
    weight: float = 0.8  # trust / impact multiplier for its items
    params: dict[str, Any] = field(default_factory=dict)
    # runtime stats
    last_ok: float = 0.0
    last_error: str = ""
    errors: int = 0
    items: int = 0
    last_latency_ms: float = 0.0


def _id(*parts: str) -> str:
    return hashlib.sha1("|".join(p or "" for p in parts).encode()).hexdigest()[:20]


def _struct_ts(entry: Any) -> float | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        st = entry.get(key)
        if st:
            try:
                return float(calendar.timegm(st))
            except (TypeError, ValueError, OverflowError):
                continue
    return None


def default_sources(symbol_bases: list[str], cryptopanic_token: str = "", newsapi_key: str = "", extra_rss: str = "") -> list[Source]:
    rss = [
        ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml", 0.9),
        ("CoinTelegraph", "https://cointelegraph.com/rss", 0.85),
        ("The Block", "https://www.theblock.co/rss.xml", 0.9),
        ("Decrypt", "https://decrypt.co/feed", 0.8),
        ("Bitcoin Magazine", "https://bitcoinmagazine.com/.rss/full/", 0.75),
        ("CryptoSlate", "https://cryptoslate.com/feed/", 0.75),
        ("NewsBTC", "https://www.newsbtc.com/feed/", 0.6),
        ("Bitcoinist", "https://bitcoinist.com/feed/", 0.6),
        ("U.Today", "https://u.today/rss", 0.6),
        ("CryptoPotato", "https://cryptopotato.com/feed/", 0.65),
        ("BeInCrypto", "https://beincrypto.com/feed/", 0.65),
        ("AMBCrypto", "https://ambcrypto.com/feed/", 0.55),
        ("CryptoNews", "https://cryptonews.com/news/feed/", 0.65),
    ]
    out = [Source(n, "rss", u, interval=20, weight=w) for n, u, w in rss]
    for u in [x.strip() for x in extra_rss.split(",") if x.strip()]:
        out.append(Source(u.split("//")[-1].split("/")[0], "rss", u, interval=30, weight=0.6))

    # Binance announcements: all + new listings + delistings (market-moving for whitelisted pairs)
    base = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query"
    out.append(Source("Binance Announcements", "binance", f"{base}?type=1&pageNo=1&pageSize=20", interval=12, weight=1.0))
    out.append(Source("Binance Listings", "binance", f"{base}?type=1&pageNo=1&pageSize=15&catalogId=48", interval=10, weight=1.0))
    out.append(Source("Binance Delistings", "binance", f"{base}?type=1&pageNo=1&pageSize=15&catalogId=161", interval=15, weight=1.0))

    # Google News: one combined market query + per-group token queries
    out.append(Source("Google News: crypto", "google", "https://news.google.com/rss/search?q=" + quote_plus("bitcoin OR ethereum OR crypto OR cryptocurrency when:1d") + "&hl=en-US&gl=US&ceid=US:en", interval=30, weight=0.6))
    names = {
        "BTC": "bitcoin", "ETH": "ethereum", "BNB": "\"BNB\" binance", "ADA": "cardano", "AVAX": "avalanche crypto", "AAVE": "aave",
        "BCH": "\"bitcoin cash\"", "ALGO": "algorand", "AXS": "\"axie infinity\"", "1INCH": "1inch crypto", "BAT": "\"basic attention token\"",
        "BAND": "\"band protocol\"", "BEL": "\"bella protocol\"", "BNT": "bancor", "C98": "coin98", "ACM": "\"ac milan\" token",
        "ALICE": "\"my neighbor alice\"", "AVA": "travala", "LINK": "chainlink", "LTC": "litecoin", "ETC": "\"ethereum classic\"",
        "SOL": "solana", "XRP": "xrp OR ripple", "DOGE": "dogecoin",
    }
    group: list[str] = []
    for b in symbol_bases:
        if b in ("BTC", "ETH"):
            continue
        group.append(names.get(b, f"{b} crypto"))
        if len(group) == 4:
            q = " OR ".join(f"({g})" for g in group) + " when:1d"
            out.append(Source(f"Google News: {'/'.join(group)[:40]}", "google", "https://news.google.com/rss/search?q=" + quote_plus(q) + "&hl=en-US&gl=US&ceid=US:en", interval=45, weight=0.6))
            group = []
    if group:
        q = " OR ".join(f"({g})" for g in group) + " when:1d"
        out.append(Source(f"Google News: {'/'.join(group)[:40]}", "google", "https://news.google.com/rss/search?q=" + quote_plus(q) + "&hl=en-US&gl=US&ceid=US:en", interval=45, weight=0.6))

    out.append(Source("Fear & Greed", "fng", "https://api.alternative.me/fng/?limit=1", interval=300, weight=1.0))
    if cryptopanic_token:
        out.append(Source("CryptoPanic", "cryptopanic", f"https://cryptopanic.com/api/v1/posts/?auth_token={cryptopanic_token}&public=true&kind=news", interval=30, weight=0.8))
    if newsapi_key:
        out.append(Source("NewsAPI", "newsapi", f"https://newsapi.org/v2/everything?q=crypto%20OR%20bitcoin%20OR%20ethereum&language=en&sortBy=publishedAt&pageSize=30&apiKey={newsapi_key}", interval=60, weight=0.7))
    out.append(Source("Reddit r/CryptoCurrency", "reddit", "https://www.reddit.com/r/CryptoCurrency/new.json?limit=25", interval=45, weight=0.4))
    return out


# ------------------------------------------------------------------------------ fetchers
async def fetch_source(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    t0 = time.perf_counter()
    try:
        fetcher = _FETCHERS[src.kind]
        items = await fetcher(client, src)
        src.last_ok = time.time()
        src.last_error = ""
        src.items += len(items)
        return items
    except Exception as e:  # noqa: BLE001
        src.errors += 1
        src.last_error = f"{type(e).__name__}: {str(e)[:160]}"
        log.debug("source %s failed: %s", src.name, src.last_error)
        return []
    finally:
        src.last_latency_ms = (time.perf_counter() - t0) * 1000


async def _get(client: httpx.AsyncClient, url: str, **kw: Any) -> httpx.Response:
    r = await client.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, follow_redirects=True, **kw)
    r.raise_for_status()
    return r


def _parse_feed(content: bytes) -> Any:
    return feedparser.parse(content)


async def _fetch_rss(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    feed = await asyncio.get_running_loop().run_in_executor(None, _parse_feed, r.content)
    out = []
    for e in feed.entries[:60]:
        title = (e.get("title") or "").strip()
        if not title:
            continue
        link = e.get("link") or ""
        summary = (e.get("summary") or e.get("description") or "")
        summary = _strip_html(summary)[:400]
        out.append({
            "id": _id(src.name, link or title),
            "title": title,
            "summary": summary,
            "url": link,
            "published": _struct_ts(e),
            "source": src.name,
            "weight": src.weight,
            "tickers_hint": [],
        })
    return out


async def _fetch_google(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    items = await _fetch_rss(client, src)
    for it in items:
        # "Headline - Publisher" -> keep the publisher as part of the source label
        t = it["title"]
        if " - " in t:
            head, pub = t.rsplit(" - ", 1)
            it["title"] = head.strip()
            it["source"] = f"{pub.strip()} (Google)"
            it["id"] = _id("google", head.strip())
        it["summary"] = ""  # Google summaries are just HTML link lists
    return items


async def _fetch_binance(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    data = r.json()
    out = []
    catalogs = (data.get("data") or {}).get("catalogs") or []
    for cat in catalogs:
        cat_name = cat.get("catalogName") or ""
        for a in cat.get("articles") or []:
            title = (a.get("title") or "").strip()
            code = a.get("code") or ""
            if not title:
                continue
            ts = a.get("releaseDate")
            out.append({
                "id": _id("binance", code or title),
                "title": title,
                "summary": cat_name,
                "url": f"https://www.binance.com/en/support/announcement/{code}" if code else "https://www.binance.com/en/support/announcement",
                "published": float(ts) / 1000 if ts else None,
                "source": src.name,
                "weight": src.weight,
                "tickers_hint": [],
            })
    return out


async def _fetch_fng(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    d = (r.json().get("data") or [{}])[0]
    value = int(d.get("value", 50))
    label = d.get("value_classification", "")
    return [{
        "id": _id("fng", d.get("timestamp", str(int(time.time() // 3600)))),
        "title": f"Crypto Fear & Greed Index: {value} ({label})",
        "summary": "",
        "url": "https://alternative.me/crypto/fear-and-greed-index/",
        "published": float(d.get("timestamp", time.time())),
        "source": src.name,
        "weight": src.weight,
        "tickers_hint": [],
        "macro": {"fng": value},
    }]


async def _fetch_cryptopanic(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    out = []
    for p in r.json().get("results", [])[:50]:
        title = (p.get("title") or "").strip()
        if not title:
            continue
        votes = p.get("votes") or {}
        hint = [c.get("code", "").upper() for c in (p.get("currencies") or []) if c.get("code")]
        published = None
        if p.get("published_at"):
            try:
                published = calendar.timegm(time.strptime(p["published_at"][:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                published = None
        out.append({
            "id": _id("cryptopanic", str(p.get("id") or title)),
            "title": title,
            "summary": f"votes +{votes.get('positive', 0)} -{votes.get('negative', 0)} important {votes.get('important', 0)}",
            "url": p.get("url") or "",
            "published": published,
            "source": f"{(p.get('source') or {}).get('title', 'CryptoPanic')} (CryptoPanic)",
            "weight": src.weight,
            "tickers_hint": hint,
        })
    return out


async def _fetch_newsapi(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    out = []
    for a in r.json().get("articles", [])[:40]:
        title = (a.get("title") or "").strip()
        if not title or title == "[Removed]":
            continue
        published = None
        if a.get("publishedAt"):
            try:
                published = calendar.timegm(time.strptime(a["publishedAt"][:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                published = None
        out.append({
            "id": _id("newsapi", a.get("url") or title),
            "title": title,
            "summary": (a.get("description") or "")[:400],
            "url": a.get("url") or "",
            "published": published,
            "source": f"{(a.get('source') or {}).get('name', 'NewsAPI')} (NewsAPI)",
            "weight": src.weight,
            "tickers_hint": [],
        })
    return out


async def _fetch_reddit(client: httpx.AsyncClient, src: Source) -> list[dict[str, Any]]:
    r = await _get(client, src.url)
    out = []
    for ch in (r.json().get("data") or {}).get("children", [])[:30]:
        d = ch.get("data") or {}
        title = (d.get("title") or "").strip()
        if not title:
            continue
        out.append({
            "id": _id("reddit", d.get("id") or title),
            "title": title,
            "summary": (d.get("selftext") or "")[:300],
            "url": "https://www.reddit.com" + (d.get("permalink") or ""),
            "published": float(d.get("created_utc") or 0) or None,
            "source": src.name,
            "weight": src.weight,
            "tickers_hint": [],
        })
    return out


_FETCHERS: dict[str, Callable[[httpx.AsyncClient, Source], Awaitable[list[dict[str, Any]]]]] = {
    "rss": _fetch_rss,
    "google": _fetch_google,
    "binance": _fetch_binance,
    "fng": _fetch_fng,
    "cryptopanic": _fetch_cryptopanic,
    "newsapi": _fetch_newsapi,
    "reddit": _fetch_reddit,
}


_TAG_RE = None


def _strip_html(s: str) -> str:
    global _TAG_RE
    import re

    if _TAG_RE is None:
        _TAG_RE = re.compile(r"<[^>]+>")
    s = _TAG_RE.sub(" ", s or "")
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")
    return " ".join(s.split())
