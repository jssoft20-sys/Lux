"""Admin authentication: Argon2 passwords, server-side sessions, CSRF, RBAC,
brute-force throttling, short-lived access tokens and session revocation.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ROLES, Admin, AdminSession, AuthThrottle
from ..utils import as_utc, sha256_hex, token_urlsafe, utcnow
from .logs import audit

_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=2)

# permission matrix ----------------------------------------------------------------
PERMISSIONS: dict[str, set[str]] = {
    "viewer": {"view"},
    "operator": {"view", "operations", "support", "users"},
    "admin": {"view", "operations", "support", "users", "cashes", "settings", "logs", "notifications"},
    "owner": {"view", "operations", "support", "users", "cashes", "settings", "logs", "notifications", "admins", "security"},
}


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401, retry_after: int = 0):
        super().__init__(message)
        self.message = message
        self.status = status
        self.retry_after = retry_after


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_policy_errors(password: str) -> list[str]:
    errors = []
    if len(password) < 10:
        errors.append("минимум 10 символов")
    if password.lower() == password or password.upper() == password:
        errors.append("буквы в разном регистре")
    if not any(ch.isdigit() for ch in password):
        errors.append("хотя бы одна цифра")
    return errors


def role_permissions(role: str) -> set[str]:
    return set(PERMISSIONS.get(role, set()))


def has_permission(admin: Admin, permission: str) -> bool:
    return permission in role_permissions(admin.role)


# throttling -------------------------------------------------------------------------

def _throttle_key(scope: str, value: str) -> str:
    return f"{scope}:{sha256_hex(value)[:32]}"


def check_throttle(db: Session, scope: str, value: str) -> None:
    row = db.get(AuthThrottle, _throttle_key(scope, value))
    if row and row.locked_until and as_utc(row.locked_until) > utcnow():
        seconds = int((as_utc(row.locked_until) - utcnow()).total_seconds())
        raise AuthError("Слишком много попыток. Повторите позже.", status=429, retry_after=max(1, seconds))


def register_failure(db: Session, scope: str, value: str) -> None:
    settings = get_settings()
    key = _throttle_key(scope, value)
    now = utcnow()
    row = db.get(AuthThrottle, key)
    window = timedelta(minutes=settings.login_lock_minutes)
    if row is None:
        row = AuthThrottle(key=key, attempts=0, window_start=now)
        db.add(row)
    if as_utc(row.window_start) + window < now:
        row.attempts = 0
        row.window_start = now
    row.attempts += 1
    if row.attempts >= settings.login_max_attempts:
        row.locked_until = now + window
        row.attempts = 0
        row.window_start = now
    db.flush()


def clear_throttle(db: Session, scope: str, value: str) -> None:
    row = db.get(AuthThrottle, _throttle_key(scope, value))
    if row:
        db.delete(row)
        db.flush()


# sessions ---------------------------------------------------------------------------

def _token_hash(token: str) -> str:
    settings = get_settings()
    return sha256_hex((settings.session_secret or settings.secret_key) + ":" + token)


def create_session(db: Session, admin: Admin, ip: str, user_agent: str) -> tuple[AdminSession, str]:
    settings = get_settings()
    token = token_urlsafe(48)
    now = utcnow()
    session = AdminSession(
        admin_id=admin.id,
        token_hash=_token_hash(token),
        csrf_token=secrets.token_urlsafe(32),
        ip=(ip or "")[:64],
        user_agent=(user_agent or "")[:300],
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_idle_days),
        absolute_expires_at=now + timedelta(days=settings.session_absolute_days),
    )
    db.add(session)
    db.flush()
    return session, token


def resolve_session(db: Session, token: str | None, touch: bool = True) -> tuple[AdminSession, Admin] | None:
    if not token:
        return None
    settings = get_settings()
    token_hash = _token_hash(token)
    session = db.execute(
        select(AdminSession).where(
            (AdminSession.token_hash == token_hash) | (AdminSession.previous_token_hash == token_hash)
        )
    ).scalar_one_or_none()
    if session is None or session.revoked_at is not None:
        return None
    now = utcnow()
    if as_utc(session.expires_at) < now or as_utc(session.absolute_expires_at) < now:
        session.revoked_at = now
        session.revoked_reason = "expired"
        db.flush()
        return None
    # A rotated-out token is accepted only for a short grace period (concurrent tabs).
    if session.token_hash != token_hash:
        rotated = as_utc(session.rotated_at)
        if not rotated or (now - rotated).total_seconds() > 120:
            return None
    admin = db.get(Admin, session.admin_id)
    if admin is None or not admin.is_active:
        return None
    if touch:
        session.last_seen_at = now
        new_expiry = min(now + timedelta(days=settings.session_idle_days), as_utc(session.absolute_expires_at))
        if new_expiry > as_utc(session.expires_at):
            session.expires_at = new_expiry
        db.flush()
    return session, admin


def rotate_session(db: Session, session: AdminSession) -> str:
    """Issue a new session token (refresh). The old one stays valid for 2 minutes."""
    token = token_urlsafe(48)
    session.previous_token_hash = session.token_hash
    session.token_hash = _token_hash(token)
    session.rotated_at = utcnow()
    # the CSRF token stays bound to the session so other open tabs keep working
    db.flush()
    return token


def revoke_session(db: Session, session: AdminSession, reason: str = "logout") -> None:
    session.revoked_at = utcnow()
    session.revoked_reason = reason[:64]
    db.flush()


def revoke_all_sessions(db: Session, admin_id: int, except_id: int | None = None, reason: str = "revoke_all") -> int:
    stmt = (
        update(AdminSession)
        .where(AdminSession.admin_id == admin_id, AdminSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )
    if except_id:
        stmt = stmt.where(AdminSession.id != except_id)
    result = db.execute(stmt)
    db.flush()
    return int(result.rowcount or 0)


def list_sessions(db: Session, admin_id: int | None = None) -> list[AdminSession]:
    stmt = select(AdminSession).where(AdminSession.revoked_at.is_(None)).order_by(AdminSession.last_seen_at.desc())
    if admin_id:
        stmt = stmt.where(AdminSession.admin_id == admin_id)
    return list(db.execute(stmt).scalars().all())


# login --------------------------------------------------------------------------------

def login(db: Session, username: str, password: str, ip: str, user_agent: str) -> tuple[Admin, AdminSession, str]:
    username = (username or "").strip().lower()
    if not username or not password:
        raise AuthError("Введите логин и пароль", status=400)
    check_throttle(db, "ip", ip or "unknown")
    check_throttle(db, "user", username)
    admin = db.execute(select(Admin).where(Admin.username == username)).scalar_one_or_none()
    ok = bool(admin and admin.is_active and verify_password(admin.password_hash, password))
    if not ok:
        register_failure(db, "ip", ip or "unknown")
        register_failure(db, "user", username)
        audit(db, "auth.login_failed", actor=username, ip=ip, details={"reason": "bad_credentials"})
        raise AuthError("Неверный логин или пароль", status=401)
    assert admin is not None
    clear_throttle(db, "ip", ip or "unknown")
    clear_throttle(db, "user", username)
    admin.last_login_at = utcnow()
    admin.failed_attempts = 0
    session, token = create_session(db, admin, ip, user_agent)
    audit(db, "auth.login", admin_id=admin.id, actor=admin.username, ip=ip, details={"session_id": session.id})
    return admin, session, token


def create_admin(db: Session, username: str, password: str, role: str = "admin", name: str = "") -> Admin:
    username = (username or "").strip().lower()
    if not username or len(username) < 3:
        raise ValueError("Логин должен быть не короче 3 символов")
    if role not in ROLES:
        raise ValueError("Неизвестная роль")
    errors = password_policy_errors(password)
    if errors:
        raise ValueError("Пароль слишком простой: " + ", ".join(errors))
    existing = db.execute(select(Admin).where(Admin.username == username)).scalar_one_or_none()
    if existing:
        raise ValueError("Администратор с таким логином уже существует")
    admin = Admin(
        username=username,
        password_hash=hash_password(password),
        role=role,
        name=name or username,
        password_changed_at=utcnow(),
    )
    db.add(admin)
    db.flush()
    return admin


def change_password(db: Session, admin: Admin, new_password: str, *, revoke_others: bool = True, except_session: int | None = None) -> None:
    errors = password_policy_errors(new_password)
    if errors:
        raise ValueError("Пароль слишком простой: " + ", ".join(errors))
    admin.password_hash = hash_password(new_password)
    admin.password_changed_at = utcnow()
    db.flush()
    if revoke_others:
        revoke_all_sessions(db, admin.id, except_id=except_session, reason="password_changed")


# short lived access tokens (for API clients / scripts) -------------------------------

def issue_access_token(admin: Admin, session_id: int) -> tuple[str, datetime]:
    settings = get_settings()
    exp = utcnow() + timedelta(minutes=settings.access_token_minutes)
    payload: dict[str, Any] = {
        "sub": str(admin.id),
        "sid": session_id,
        "role": admin.role,
        "iat": int(utcnow().timestamp()),
        "exp": int(exp.timestamp()),
        "iss": "onoipay",
    }
    return jwt.encode(payload, settings.jwt_secret or settings.secret_key, algorithm="HS256"), exp


def decode_access_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret or settings.secret_key, algorithms=["HS256"], issuer="onoipay")
    except Exception:
        return None


def session_public(session: AdminSession, current_id: int | None = None) -> dict[str, Any]:
    from ..utils import iso

    return {
        "id": session.id,
        "admin_id": session.admin_id,
        "ip": session.ip,
        "user_agent": session.user_agent,
        "created_at": iso(session.created_at),
        "last_seen_at": iso(session.last_seen_at),
        "expires_at": iso(session.expires_at),
        "current": bool(current_id and session.id == current_id),
    }
