"""Login / logout / session management endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Admin
from ..services import auth as auth_service
from ..services.logs import audit
from ..utils import iso
from .deps import CSRF_COOKIE, SESSION_COOKIE, Principal, client_ip, current_principal, get_db, require
from .schemas import AdminCreateBody, AdminUpdateBody, LoginBody, PasswordChangeBody

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_secure(request: Request) -> bool:
    settings = get_settings()
    if not settings.cookie_secure:
        return False
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https" or settings.is_production


def set_session_cookies(response: Response, request: Request, token: str, csrf: str) -> None:
    settings = get_settings()
    secure = _cookie_secure(request)
    max_age = settings.session_absolute_days * 86400
    path = (settings.base_path or "") + "/"
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=secure, samesite="strict", path=path)
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=secure, samesite="strict", path=path)


def clear_session_cookies(response: Response) -> None:
    path = (get_settings().base_path or "") + "/"
    response.delete_cookie(SESSION_COOKIE, path=path)
    response.delete_cookie(CSRF_COOKIE, path=path)


def principal_payload(principal: Principal) -> dict:
    admin = principal.admin
    return {
        "id": admin.id,
        "username": admin.username,
        "name": admin.name or admin.username,
        "role": admin.role,
        "permissions": sorted(auth_service.role_permissions(admin.role)),
        "session_id": principal.session.id if principal.session else None,
        "csrf_token": principal.session.csrf_token if principal.session else "",
        "last_login_at": iso(admin.last_login_at),
        "password_changed_at": iso(admin.password_changed_at),
    }


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    try:
        admin, session, token = auth_service.login(db, body.username, body.password, ip, request.headers.get("user-agent", ""))
    except auth_service.AuthError as exc:
        db.commit()
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(status_code=exc.status, detail=exc.message, headers=headers)
    set_session_cookies(response, request, token, session.csrf_token)
    principal = Principal(admin=admin, session=session, via="cookie")
    return {"ok": True, "admin": principal_payload(principal)}


@router.post("/logout")
def logout(request: Request, response: Response, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if principal.session:
        auth_service.revoke_session(db, principal.session, "logout")
        audit(db, "auth.logout", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request))
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(principal: Principal = Depends(current_principal)):
    return {"ok": True, "admin": principal_payload(principal)}


@router.post("/refresh")
def refresh(request: Request, response: Response, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Rotate the session token (called periodically by the SPA)."""
    if not principal.session or principal.via != "cookie":
        raise HTTPException(400, "NO_SESSION")
    token = auth_service.rotate_session(db, principal.session)
    set_session_cookies(response, request, token, principal.session.csrf_token)
    return {"ok": True, "admin": principal_payload(principal)}


@router.post("/token")
def access_token(principal: Principal = Depends(current_principal)):
    """Short-lived bearer token for scripts (never placed in URLs)."""
    token, exp = auth_service.issue_access_token(principal.admin, principal.session.id if principal.session else 0)
    return {"ok": True, "access_token": token, "token_type": "bearer", "expires_at": iso(exp)}


@router.get("/sessions")
def sessions(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    admin_id = None if principal.can("security") else principal.id
    rows = auth_service.list_sessions(db, admin_id)
    admins = {a.id: a.username for a in db.execute(select(Admin)).scalars().all()}
    out = []
    for row in rows:
        item = auth_service.session_public(row, principal.session.id if principal.session else None)
        item["username"] = admins.get(row.admin_id, "")
        out.append(item)
    return {"ok": True, "items": out}


@router.post("/sessions/{session_id}/revoke")
def revoke(session_id: int, request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from ..models import AdminSession

    row = db.get(AdminSession, session_id)
    if row is None or (row.admin_id != principal.id and not principal.can("security")):
        raise HTTPException(404, "NOT_FOUND")
    auth_service.revoke_session(db, row, "revoked")
    audit(db, "auth.session_revoked", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="session", entity_id=session_id)
    return {"ok": True}


@router.post("/sessions/revoke-others")
def revoke_others(request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    count = auth_service.revoke_all_sessions(db, principal.id, except_id=principal.session.id if principal.session else None)
    audit(db, "auth.sessions_revoked_others", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), details={"count": count})
    return {"ok": True, "revoked": count}


@router.post("/password")
def change_password(body: PasswordChangeBody, request: Request, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not auth_service.verify_password(principal.admin.password_hash, body.current_password):
        raise HTTPException(400, "Текущий пароль неверный")
    try:
        auth_service.change_password(db, principal.admin, body.new_password, except_session=principal.session.id if principal.session else None)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit(db, "auth.password_changed", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request))
    return {"ok": True}


# --- admin accounts (owner only) -----------------------------------------------

@router.get("/admins")
def list_admins(principal: Principal = Depends(require("admins")), db: Session = Depends(get_db)):
    rows = db.execute(select(Admin).order_by(Admin.id)).scalars().all()
    return {"ok": True, "items": [_admin_public(a) for a in rows]}


def _admin_public(a: Admin) -> dict:
    return {"id": a.id, "username": a.username, "name": a.name, "role": a.role, "is_active": a.is_active, "last_login_at": iso(a.last_login_at), "created_at": iso(a.created_at), "telegram_id": a.telegram_id}


@router.post("/admins")
def create_admin(body: AdminCreateBody, request: Request, principal: Principal = Depends(require("admins")), db: Session = Depends(get_db)):
    try:
        admin = auth_service.create_admin(db, body.username, body.password, body.role, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit(db, "admin.created", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="admin", entity_id=admin.id, details={"role": admin.role})
    return {"ok": True, "admin": _admin_public(admin)}


@router.patch("/admins/{admin_id}")
def update_admin(admin_id: int, body: AdminUpdateBody, request: Request, principal: Principal = Depends(require("admins")), db: Session = Depends(get_db)):
    admin = db.get(Admin, admin_id)
    if admin is None:
        raise HTTPException(404, "NOT_FOUND")
    if admin.id == principal.id and body.is_active is False:
        raise HTTPException(400, "Нельзя отключить свою учётную запись")
    changes: dict = {}
    if body.role is not None:
        if body.role not in auth_service.PERMISSIONS:
            raise HTTPException(400, "Неизвестная роль")
        if admin.id == principal.id and body.role != admin.role:
            raise HTTPException(400, "Нельзя менять свою роль")
        changes["role"] = [admin.role, body.role]
        admin.role = body.role
    if body.name is not None:
        admin.name = body.name[:128]
        changes["name"] = admin.name
    if body.is_active is not None:
        admin.is_active = body.is_active
        changes["is_active"] = admin.is_active
        if not admin.is_active:
            auth_service.revoke_all_sessions(db, admin.id, reason="deactivated")
    if body.telegram_id is not None:
        admin.telegram_id = int(body.telegram_id)
    if body.password:
        try:
            auth_service.change_password(db, admin, body.password)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        changes["password"] = "changed"
    db.flush()
    audit(db, "admin.updated", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="admin", entity_id=admin.id, details=changes)
    return {"ok": True, "admin": _admin_public(admin)}


@router.post("/admins/{admin_id}/logout-all")
def force_logout(admin_id: int, request: Request, principal: Principal = Depends(require("admins")), db: Session = Depends(get_db)):
    count = auth_service.revoke_all_sessions(db, admin_id, reason="forced")
    audit(db, "admin.force_logout", admin_id=principal.id, actor=principal.admin.username, ip=client_ip(request), entity_type="admin", entity_id=admin_id, details={"count": count})
    return {"ok": True, "revoked": count}
