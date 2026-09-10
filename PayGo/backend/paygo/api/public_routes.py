"""Public / unauthenticated endpoints: health, deposit QR images for Telegram."""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import __version__
from ..config import get_settings
from ..db import ping
from ..models import Deposit
from ..services import elqr
from ..services.qr import render_qr_png
from .deps import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["public"])

class DiamondEvent(BaseModel):
    device_id: str
    reason: str
    timestamp: int | None = None


@router.get("/api/health")
def health():
    settings = get_settings()
    db_ok = ping()
    return {"ok": db_ok, "service": "paygo", "version": __version__, "database": "ok" if db_ok else "error", "env": settings.app_env, "main_bot_configured": bool(settings.main_bot_token), "support_bot_configured": bool(settings.support_bot_token)}


@router.get("/api/qr/deposit/{public_id}.png")
def deposit_qr_public(public_id: str, db: Session = Depends(get_db)):
    """Branded payment QR for a deposit; the public id is unguessable (random hex)."""
    deposit = db.execute(select(Deposit).where(Deposit.public_id == public_id)).scalar_one_or_none()
    if deposit is None or not deposit.qr_payload or deposit.status not in {"created", "processing"}:
        raise HTTPException(404, "NOT_FOUND")
    png = render_qr_png(elqr.qr_image_value(deposit.qr_payload))
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/api/device/diamonds")
def device_diamonds(event: DiamondEvent):
    """Log device diamond event (auto-clear, manual action, etc)."""
    logger.info(f"Device {event.device_id} event: {event.reason} @ {event.timestamp}")
    return {"ok": True, "device_id": event.device_id}


@router.post("/api/device/event")
def device_event(event_data: dict):
    """Log device event."""
    device_id = event_data.get("device_id", "unknown")
    event_type = event_data.get("event", "unknown")
    logger.info(f"Device {device_id} event: {event_type}")
    return {"ok": True}
