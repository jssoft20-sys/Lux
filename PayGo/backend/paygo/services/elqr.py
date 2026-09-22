"""ELQR (EMVCo-style TLV) helpers used by Kyrgyz bank QR codes.

* parse / build TLV
* inject an exact amount (tag 54, in tiyin) into a bank QR template
* lock the amount (32.12 = 12) so the payer cannot edit it
* build payment deep links for bank apps
"""
from __future__ import annotations

import hashlib
import re
import urllib.parse
from decimal import Decimal

from ..utils import money


def parse_tlv(payload: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    i = 0
    text = str(payload or "")
    while i + 4 <= len(text):
        tag, raw_len = text[i : i + 2], text[i + 2 : i + 4]
        if not raw_len.isdigit():
            raise ValueError("QR не похож на ELQR/TLV")
        length = int(raw_len)
        value = text[i + 4 : i + 4 + length]
        if len(value) != length:
            raise ValueError("QR payload повреждён")
        out.append((tag, value))
        i += 4 + length
    if i != len(text):
        raise ValueError("QR payload повреждён")
    return out


def tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def build(items: list[tuple[str, str]]) -> str:
    return "".join(tlv(tag, value) for tag, value in items)


def checksum(body: str) -> str:
    """The bank QR generators in use derive the 4-char tail from SHA-256 of the body."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest().upper()[-4:]


def strip_crc(payload: str) -> str:
    return re.sub(r"6304[0-9A-Fa-f]{4}$", "", str(payload or "").strip())


def normalize(value: str) -> tuple[str, str]:
    """Return ``(prefix, payload_without_crc)`` from a raw ELQR or a bank deep link.

    Deep links may wrap the payload after ``#`` or inside ``qr-url=`` with several
    URL-encoding layers; every layer is tried and accepted only when the result is
    valid TLV.
    """
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("QR пустой")
    candidates: list[str] = [raw]
    current = raw
    for _ in range(6):
        decoded = urllib.parse.unquote(current)
        if decoded == current:
            break
        candidates.append(decoded)
        current = decoded
    for candidate in list(candidates):
        low = candidate.lower()
        for marker in ("qr-url=", "qr_url=", "qrlink=", "payload="):
            pos = low.find(marker)
            if pos >= 0:
                nested = candidate[pos + len(marker) :]
                if "&" in nested and not nested.lower().startswith(("http%3a", "https%3a", "http://", "https://")):
                    nested = nested.split("&", 1)[0]
                candidates.append(nested)
    seen: set[str] = set()
    for source in candidates:
        variant = str(source or "").strip()
        for _ in range(7):
            if variant and variant not in seen:
                seen.add(variant)
                prefix, payload = "", variant
                if "#" in variant:
                    before, after = variant.rsplit("#", 1)
                    if after.strip().startswith("000201"):
                        prefix, payload = before + "#", after.strip()
                if not payload.startswith("000201"):
                    match = re.search(r"(000201[^\s&]+)", payload)
                    payload = match.group(1) if match else ""
                if payload:
                    payload = strip_crc(payload)
                    try:
                        parse_tlv(payload)
                    except Exception:
                        pass
                    else:
                        return prefix, payload
            decoded = urllib.parse.unquote(variant)
            if decoded == variant:
                break
            variant = decoded
    raise ValueError("QR не похож на ELQR/TLV")


def bank_meta(source: str) -> dict[str, str]:
    prefix, payload = normalize(source)
    root = dict(parse_tlv(payload))
    block: dict[str, str] = {}
    if root.get("32"):
        try:
            block = dict(parse_tlv(root["32"]))
        except Exception:
            block = {}
    domain = str(block.get("00") or "")
    low = (domain + " " + prefix).lower()
    bank_name = "Банк"
    for needle, name in (
        ("optima", "Optima Bank"),
        ("mbank", "MBank"),
        ("bakai", "Bakai Bank"),
        ("dengi", "О!Деньги"),
        ("o.kg", "О!Деньги"),
        ("balance", "Balance"),
        ("megapay", "MegaPay"),
        ("demir", "Demir Bank"),
        ("companion", "Kompanion"),
    ):
        if needle in low:
            bank_name = name
            break
    return {
        "prefix": prefix,
        "payload": payload,
        "domain": domain,
        "account": str(block.get("10") or block.get("11") or ""),
        "holder": str(block.get("11") or root.get("59") or ""),
        "bank_name": bank_name,
        "currency": str(root.get("53") or "417"),
    }


def lock_amount_edit(payload: str) -> str:
    """Set 32.12 = 12 (amount not editable by the payer)."""
    items = parse_tlv(strip_crc(payload))
    rebuilt: list[tuple[str, str]] = []
    found = False
    for tag, value in items:
        if tag == "63":
            continue
        if tag == "32":
            found = True
            nested = parse_tlv(value)
            new_nested: list[tuple[str, str]] = []
            has_flag = False
            for ntag, nvalue in nested:
                if ntag == "12":
                    new_nested.append(("12", "12"))
                    has_flag = True
                else:
                    new_nested.append((ntag, nvalue))
            if not has_flag:
                new_nested.append(("12", "12"))
            value = build(new_nested)
        rebuilt.append((tag, value))
    if not found:
        raise ValueError("В ELQR нет блока 32")
    return build(rebuilt)


def inject_amount(original: str, amount: Decimal | str | float, *, lock: bool = True) -> str:
    """Return a complete ELQR (with CRC tail) carrying the exact amount in tiyin."""
    _, payload = normalize(original)
    if lock:
        try:
            payload = lock_amount_edit(payload)
        except Exception:
            pass
    items = parse_tlv(payload)
    root = dict(items)
    if "32" not in root:
        raise ValueError("В QR нет банковского блока 32")
    try:
        bank = dict(parse_tlv(root["32"]))
    except Exception as exc:
        raise ValueError("Банковский блок 32 повреждён") from exc
    if not (bank.get("10") or bank.get("11") or bank.get("00")):
        raise ValueError("В QR не найдены реквизиты банка")
    dec = money(amount)
    if dec <= 0:
        raise ValueError("Сумма должна быть больше нуля")
    tiyin = str(int(dec * 100))
    out: list[tuple[str, str]] = []
    inserted = False
    for tag, value in items:
        if tag in {"54", "63"}:
            continue
        out.append((tag, value))
        if tag == "53":
            out.append(("54", tiyin))
            inserted = True
    if not inserted:
        out2: list[tuple[str, str]] = []
        for tag, value in out:
            if tag == "59" and not inserted:
                out2.append(("54", tiyin))
                inserted = True
            out2.append((tag, value))
        out = out2
    if not inserted:
        out.append(("54", tiyin))
    body = build(out)
    return body + "6304" + checksum(body)


def amount_from_payload(payload: str) -> Decimal | None:
    try:
        root = dict(parse_tlv(strip_crc(normalize(payload)[1])))
    except Exception:
        return None
    raw = root.get("54")
    if not raw or not raw.isdigit():
        return None
    return money(Decimal(raw) / 100)


def bank_links(payload: str, links: list[dict]) -> list[dict]:
    """Build payment buttons for enabled bank deep links."""
    clean = str(payload or "").strip()
    if not clean.startswith("000201"):
        raise ValueError("QR payload пустой или повреждён")
    encoded = urllib.parse.quote(clean, safe="")
    out: list[dict] = []
    for link in sorted(links, key=lambda x: int(x.get("priority") or 100)):
        if not link.get("enabled", True) or link.get("kind") == "qr":
            continue
        prefix = str(link.get("prefix") or "")
        if not prefix:
            continue
        value = encoded if link.get("encode_payload") else clean
        out.append({"id": link.get("key"), "name": link.get("name"), "url": prefix + value, "emoji": str(link.get("emoji") or ""), "custom_emoji_id": str(link.get("custom_emoji_id") or "")})
    return out


def qr_image_value(payload: str) -> str:
    """Value encoded inside the generated deposit QR image (universal O!Dengi wrapper)."""
    clean = str(payload or "").strip()
    if not clean.startswith("000201"):
        raise ValueError("QR payload пустой")
    return "https://api.dengi.o.kg/#" + urllib.parse.quote(clean, safe="")


# bank recognition for a withdrawal QR/link → name + logo. The marks are the official ones the
# Finik QR page uses (frontend/admin/brand/banks/<key>.png); the order matters — the first match wins.
BANKS: list[tuple[str, str, tuple[str, ...]]] = [
    ("mbank", "MBank", ("mbank", "mbank.kg", "mbusiness")),
    ("optima", "Optima Bank", ("optima",)),
    ("bakai", "Bakai Bank", ("bakai",)),
    ("dengi", "О!Деньги", ("dengi", "o.kg", "odengi", "o!", "о!деньги")),
    ("balance", "Balance", ("balance.kg", "balance_", "balance")),
    ("megapay", "MegaPay", ("megapay",)),
    ("demir", "Demir Bank", ("demir", "dcard")),
    ("kompanion", "Компаньон", ("companion", "kompanion", "компаньон")),
    ("finik", "Finik", ("finik",)),
    ("rsk", "РСК Банк", ("rsk", "рск")),
    ("eldik", "Элдик Банк", ("eldik", "элдик")),
    ("kicb", "KICB", ("kicb",)),
    ("aiyl", "Айыл Банк", ("aiyl", "ayil", "ab.kg", "айыл")),
    ("nambaone", "Namba One", ("nambaone", "namba")),
    ("simbank", "Simbank", ("simbank",)),
    ("dantepay", "DantePay", ("dantepay",)),
    ("keremet", "Keremet Bank", ("keremet",)),
    ("elcart", "Элкарт", ("elcart", "payqr", "elqr")),
]
BANK_KEYS = tuple(k for k, _n, _m in BANKS)
_LOGO_FILES = {"mbank", "optima", "bakai", "dengi", "balance", "megapay", "demir", "kompanion", "finik", "rsk", "eldik", "kicb", "aiyl", "nambaone", "simbank", "dantepay", "elcart"}
FALLBACK_LOGO = "brand/banks/bank.png"


def bank_logo(key: str) -> str:
    """Path of the mark for a bank key (a neutral mark when the bank has no logo file)."""
    return f"brand/banks/{key}.png" if key in _LOGO_FILES else FALLBACK_LOGO


def detect_bank(text: str) -> dict[str, str]:
    """Recognise the client's bank from a withdrawal QR payload or a bank link (mbank, finik,
    optima, …) and return its key, display name and logo path. Falls back to a neutral badge."""
    low = str(text or "").lower()
    for key, name, markers in BANKS:
        if any(m in low for m in markers):
            return {"key": key, "name": name, "logo": bank_logo(key)}
    try:
        meta = bank_meta(text)
        blob = (str(meta.get("domain", "")) + " " + str(meta.get("bank_name", ""))).lower()
        for key, name, markers in BANKS:
            if any(m in blob for m in markers):
                return {"key": key, "name": name, "logo": bank_logo(key)}
        if meta.get("bank_name") and meta["bank_name"] != "Банк":
            return {"key": "bank", "name": str(meta["bank_name"]), "logo": FALLBACK_LOGO}
    except Exception:
        pass
    return {"key": "bank", "name": "Банк", "logo": FALLBACK_LOGO}


def bank_disabled(text: str, disabled: str) -> str:
    """Name of the client's bank when the owner switched that bank off for payouts, else ''."""
    keys = {k.strip().lower() for k in str(disabled or "").replace(";", ",").split(",") if k.strip()}
    if not keys:
        return ""
    bank = detect_bank(text)
    return bank["name"] if bank["key"] in keys else ""


# ----------------------------------------------------------------------------- bank links → ELQR
# A client may send the payout target as a bank link (https://qr.finik.kg/<id>?type=t, an MBank
# link, …) instead of a QR photo. The link itself carries no requisites, but the bank's QR page
# embeds the full ELQR payload in its "pay with Optima24 / MBank" buttons (…confirm-screen?qr-url=
# #000201…). Resolving it once gives the withdrawal the same payload a scanned QR would — the
# amount can be injected («Ген QR») and the Optima24 pay link works.
_PAYLOAD_RE = re.compile(r"000201[0-9A-Za-z._\-%*:/!()]{40,900}")
_FAILED_LINKS: dict[str, float] = {}
_FAIL_TTL = 600.0
_MAX_PAGE = 2_000_000


def is_bank_link(value: str) -> bool:
    """A payout target given as an http(s) link rather than a QR payload."""
    return str(value or "").strip().lower().startswith(("http://", "https://"))


def has_payload(value: str) -> bool:
    """True when ``value`` already contains a valid ELQR payload (raw or wrapped in a deep link)."""
    try:
        normalize(value)
    except Exception:
        return False
    return True


def fetch_text(url: str, timeout: float = 8.0) -> str:
    """GET a bank QR page (redirects followed, size-capped). Replaced in tests."""
    import httpx

    with httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 PayGo/1.0"}) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            size = 0
            for chunk in resp.iter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size > _MAX_PAGE:
                    break
            return b"".join(chunks).decode(resp.encoding or "utf-8", "replace")


def payloads_in_text(text: str) -> list[str]:
    """Every distinct valid ELQR payload found in a page (hrefs, scripts, data attributes)."""
    out: list[str] = []
    for raw in _PAYLOAD_RE.findall(str(text or "")):
        for candidate in (raw, urllib.parse.unquote(raw)):
            try:
                _, payload = normalize(candidate)
            except Exception:
                continue
            if payload not in out:
                out.append(payload)
            break
    return out


def resolve_bank_link(link: str, *, fetch=None) -> str:
    """ELQR payload (without CRC) for a bank link or a raw payload; '' when it cannot be resolved.

    Raw payloads and deep links that already wrap one need no network. For a page link the page is
    fetched once; a link that failed is not retried for ten minutes so the panel stays fast offline.
    """
    import time

    value = str(link or "").strip()
    if not value:
        return ""
    try:
        return normalize(value)[1]
    except Exception:
        pass
    if not is_bank_link(value):
        return ""
    failed_at = _FAILED_LINKS.get(value)
    if failed_at and time.monotonic() - failed_at < _FAIL_TTL:
        return ""
    try:
        text = (fetch or fetch_text)(value)
        found = payloads_in_text(text)
    except Exception:
        found = []
    if not found:
        _FAILED_LINKS[value] = time.monotonic()
        if len(_FAILED_LINKS) > 500:
            _FAILED_LINKS.clear()
        return ""
    return found[0]


# The link format is the one the banks' own QR pages use (qr.finik.kg → «Оплатить в Optima24»).
OPTIMA_PAY_LINK_BASE = "https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=#"


def optima_confirm_link(full_payload: str, base: str = OPTIMA_PAY_LINK_BASE) -> str:
    """Deep link that opens Optima24 on the confirm screen, recipient and amount pre-filled.

    ``full_payload`` is a complete ELQR (with the amount injected and the CRC tail) — for a
    withdrawal that is ``generated_qr_payload``. Tapping the link on a phone with the Optima24
    app opens it ready to pay; the operator still confirms (Face ID / PIN) — the link never
    sends money on its own. Only spaces are encoded, matching the links Optima itself accepts.
    """
    clean = str(full_payload or "").strip()
    if not clean.startswith("000201"):
        return ""
    return (base or OPTIMA_PAY_LINK_BASE) + clean.replace(" ", "%20")
