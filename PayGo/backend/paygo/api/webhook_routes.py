"""Inbound payment confirmations (bank notification forwarder / MacroDroid / statement bots).

Security: the secret is a URL path segment (or ``X-Webhook-Key`` header) compared in
constant time; optionally an HMAC-SHA256 signature of the raw body in ``X-Signature``.
Processing is idempotent: the same notification is stored once and credited once.
"""
from __future__ import annotations

import hmac
import json
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from ..config import get_settings
from ..db import transaction
from ..services import payments, settings_store
from ..utils import constant_time_equal, hmac_hex
from .deps import client_ip

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = logging.getLogger("paygo.webhooks")

TEXT_KEYS = ("text", "content", "notification", "notification_text", "body", "message", "title", "ticker", "not_ticker", "not_text_lines", "not_title", "payload", "data", "sms", "msg")


def _blob(values: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in TEXT_KEYS:
        value = values.get(key)
        if value not in (None, ""):
            parts.append(json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value))
    for key, value in values.items():
        if key not in TEXT_KEYS:
            parts.append(str(key))
        if value not in (None, "") and str(value) not in parts:
            parts.append(str(value))
    return " ".join(parts).strip()


async def _extract(request: Request) -> tuple[str, dict[str, Any], bytes]:
    body = await request.body()
    body_text = body.decode("utf-8", "ignore").strip() if body else ""
    parsed: Any = None
    if body_text:
        try:
            parsed = json.loads(body_text)
        except Exception:
            parsed = None
    raw_text = body_text
    content_type = str(request.headers.get("content-type") or "").lower()
    if body and ("application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type):
        try:
            form = await request.form()
            parsed = {str(k): str(v) for k, v in form.items()}
        except Exception:
            pass
    payload: dict[str, Any] = parsed if isinstance(parsed, dict) else {}
    if payload:
        raw_text = _blob(payload) or raw_text
    query = {str(k): str(v) for k, v in request.query_params.multi_items() if k != "key"}
    if query:
        payload = {**query, **payload}
        raw_text = (raw_text + " " + _blob(query)).strip()
    return raw_text.strip(), payload, body


def ip_allowed(ip: str, allowlist: str) -> bool:
    """``allowlist`` — comma/space separated IPs or CIDR networks; empty = everyone (the secret still applies)."""
    import ipaddress

    entries = [x.strip() for x in str(allowlist or "").replace(";", ",").replace("\n", ",").split(",") if x.strip()]
    if not entries:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in entries:
        try:
            if "/" in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            elif addr == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def _authorize(request: Request, path_key: str, body: bytes) -> None:
    settings = get_settings()
    expected = settings.webhook_secret
    if not expected:
        raise HTTPException(503, "WEBHOOK_NOT_CONFIGURED")
    with transaction() as db:
        allowlist = str(settings_store.get(db, "webhook_ip_allowlist") or "")
        require_signature = settings_store.get_bool(db, "webhook_require_signature")
    if not ip_allowed(client_ip(request), allowlist):
        logger.warning("webhook from a non-allowlisted address %s", client_ip(request))
        raise HTTPException(403, "IP_NOT_ALLOWED")
    signature = request.headers.get("x-signature", "")
    if signature:
        if hmac.compare_digest(signature.lower(), hmac_hex(expected, body.decode("utf-8", "ignore"))):
            return
        raise HTTPException(401, "BAD_SIGNATURE")
    if require_signature:
        raise HTTPException(401, "SIGNATURE_REQUIRED")
    supplied = path_key or request.headers.get("x-webhook-key", "") or request.query_params.get("key", "")
    if not supplied or not constant_time_equal(supplied, expected):
        raise HTTPException(401, "BAD_KEY")


async def _handle(request: Request, background: BackgroundTasks, path_key: str, source: str) -> dict[str, Any]:
    raw_text, payload, body = await _extract(request)
    _authorize(request, path_key, body)
    try:
        amount = payments.extract_amount(raw_text, payload)
    except ValueError as exc:
        logger.warning("webhook payload without amount: %r", raw_text[:200])
        raise HTTPException(422, str(exc))
    external_id = str(payload.get("id") or payload.get("external_id") or payload.get("transaction_id") or "")[:160]
    with transaction() as db:
        event, created = payments.ingest_event(db, source=source, amount=amount, raw_text=raw_text, raw_payload=payload, external_id=external_id, sender_ip=client_ip(request))
        event_id, status = event.id, event.status
    if created or status in {"received", "processing"}:
        background.add_task(payments.process_event, event_id)
    return {"ok": True, "accepted": True, "duplicate": not created, "event_id": event_id, "amount": str(amount), "status": status}


@router.api_route("/payments/{path_key}", methods=["POST", "GET"])
async def payments_webhook(path_key: str, request: Request, background: BackgroundTasks):
    return await _handle(request, background, path_key, "webhook")


@router.api_route("/payments", methods=["POST", "GET"])
async def payments_webhook_header(request: Request, background: BackgroundTasks):
    return await _handle(request, background, "", "webhook")


@router.get("/payments-test")
def payments_test():
    settings = get_settings()
    return {"ok": True, "service": "PayGo payment webhook", "post_url": f"{settings.base_path}/api/webhooks/payments/<WEBHOOK_SECRET>", "accepted": ["text/plain", "application/json", "application/x-www-form-urlencoded", "GET query"], "headers": ["X-Webhook-Key", "X-Signature (HMAC-SHA256 of body)"]}
