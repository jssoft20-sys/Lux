"""FastAPI dependencies: database session, current admin, CSRF and RBAC checks."""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import session_factory
from ..models import Admin, AdminSession
from ..services import auth as auth_service

SESSION_COOKIE = "onoipay_session"
CSRF_COOKIE = "onoipay_csrf"
CSRF_HEADER = "x-csrf-token"


def get_db() -> Iterator[Session]:
    session = session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def client_ip(request: Request) -> str:
    settings = get_settings()
    if settings.trust_proxy:
        for header in ("cf-connecting-ip", "x-real-ip", "x-forwarded-for"):
            value = request.headers.get(header)
            if value:
                return value.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


@dataclass
class Principal:
    admin: Admin
    session: AdminSession | None
    via: str  # cookie | token

    @property
    def id(self) -> int:
        return self.admin.id

    @property
    def name(self) -> str:
        return self.admin.name or self.admin.username

    def can(self, permission: str) -> bool:
        return auth_service.has_permission(self.admin, permission)


def _principal_from_request(request: Request, db: Session, *, touch: bool = True) -> Principal | None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        resolved = auth_service.resolve_session(db, token, touch=touch)
        if resolved:
            session, admin = resolved
            return Principal(admin=admin, session=session, via="cookie")
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        payload = auth_service.decode_access_token(header[7:].strip())
        if payload:
            admin = db.get(Admin, int(payload.get("sub") or 0))
            if admin and admin.is_active:
                session = db.get(AdminSession, int(payload.get("sid") or 0))
                if session is None or session.revoked_at is not None:
                    return None
                return Principal(admin=admin, session=session, via="token")
    return None


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    principal = _principal_from_request(request, db)
    if principal is None:
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")
    if principal.via == "cookie" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        header = request.headers.get(CSRF_HEADER, "")
        cookie = request.cookies.get(CSRF_COOKIE, "")
        expected = principal.session.csrf_token if principal.session else ""
        if not header or not expected or header != expected or cookie != expected:
            raise HTTPException(status_code=403, detail="CSRF_FAILED")
    request.state.principal = principal
    return principal


def optional_principal(request: Request, db: Session = Depends(get_db)) -> Principal | None:
    return _principal_from_request(request, db, touch=False)


def require(permission: str):
    def _dep(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.can(permission):
            raise HTTPException(status_code=403, detail="FORBIDDEN")
        return principal

    return _dep
