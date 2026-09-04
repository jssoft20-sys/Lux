"""Audit log (who did what) and system log (what happened)."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from ..models import AuditLog, SystemLog

logger = logging.getLogger("onoipay")


def audit(
    db: Session,
    action: str,
    *,
    admin_id: int | None = None,
    actor: str = "system",
    entity_type: str = "",
    entity_id: Any = "",
    ip: str = "",
    details: dict[str, Any] | None = None,
) -> AuditLog:
    row = AuditLog(
        admin_id=admin_id,
        actor=actor or "system",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
        ip=ip or "",
        details=details or {},
    )
    db.add(row)
    db.flush()
    return row


def log_event(
    db: Session,
    title: str,
    detail: str = "",
    *,
    level: str = "info",
    category: str = "system",
    entity_type: str = "",
    entity_id: Any = "",
) -> SystemLog:
    row = SystemLog(
        level=level,
        category=category,
        title=title[:200],
        detail=detail or "",
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
    )
    db.add(row)
    db.flush()
    getattr(logger, "warning" if level in {"warning", "error", "critical"} else "info")(
        "[%s] %s — %s", category, title, (detail or "")[:300]
    )
    return row
