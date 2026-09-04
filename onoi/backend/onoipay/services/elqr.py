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
        out.append({"id": link.get("key"), "name": link.get("name"), "url": prefix + value})
    return out


def qr_image_value(payload: str) -> str:
    """Value encoded inside the generated deposit QR image (universal O!Dengi wrapper)."""
    clean = str(payload or "").strip()
    if not clean.startswith("000201"):
        raise ValueError("QR payload пустой")
    return "https://api.dengi.o.kg/#" + urllib.parse.quote(clean, safe="")
