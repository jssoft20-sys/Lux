"""E-mail delivery (Timeweb SMTP from environment) and client e-mail verification."""
from __future__ import annotations

import logging
import re
import secrets
import smtplib
from datetime import timedelta
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import EmailVerification, User
from ..utils import as_utc, constant_time_equal, sha256_hex, utcnow
from .logs import log_event

logger = logging.getLogger("onoipay.email")
OTP_TTL_SECONDS = 600
RESEND_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5


class EmailError(Exception):
    pass


def smtp_configured() -> bool:
    settings = get_settings()
    return bool(settings.smtp_host and settings.smtp_user)


def send_mail(to: str, subject: str, body: str) -> None:
    settings = get_settings()
    if not smtp_configured():
        raise EmailError("SMTP не настроен")
    sender = settings.smtp_from or settings.smtp_user
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = sender
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1].strip(">") if "@" in sender else "localhost")
    msg["Auto-Submitted"] = "auto-generated"
    if settings.smtp_ssl:
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        if settings.smtp_starttls:
            server.starttls()
    try:
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(sender, [to], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", email) or len(email) > 160:
        raise EmailError("Введите корректный e-mail")
    return email


def start_verification(db: Session, user: User, email: str) -> dict:
    """Create/refresh one verification per user. Never duplicates users or e-mails."""
    email = normalize_email(email)
    if user.email == email and user.email_verified_at:
        return {"ok": True, "already_verified": True}
    other = db.execute(select(User.id).where(User.email == email, User.email_verified_at.is_not(None), User.id != user.id)).first()
    if other:
        raise EmailError("Этот e-mail уже привязан к другому аккаунту")
    row = db.execute(select(EmailVerification).where(EmailVerification.user_id == user.id)).scalar_one_or_none()
    now = utcnow()
    if row and row.email == email and row.sent_at and (now - as_utc(row.sent_at)).total_seconds() < RESEND_COOLDOWN_SECONDS:
        retry = RESEND_COOLDOWN_SECONDS - int((now - as_utc(row.sent_at)).total_seconds())
        return {"ok": True, "sent": False, "retry_in": retry}
    code = f"{secrets.randbelow(900000) + 100000}"
    if row is None:
        row = EmailVerification(user_id=user.id, email=email, code_hash=sha256_hex(code), expires_at=now + timedelta(seconds=OTP_TTL_SECONDS))
        db.add(row)
    else:
        row.email = email
        row.code_hash = sha256_hex(code)
        row.attempts = 0
        row.sent_at = now
        row.expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)
    db.flush()
    delivery = "email"
    try:
        send_mail(email, "OnoiPay: код подтверждения", f"Ваш код подтверждения e-mail в OnoiPay: {code}\n\nКод действует 10 минут. Если это не вы — проигнорируйте письмо.")
    except Exception as exc:
        delivery = "failed"
        log_event(db, "Ошибка отправки письма", f"{email} • {str(exc)[:200]}", level="warning", category="email", entity_type="user", entity_id=user.id)
        if get_settings().is_production:
            raise EmailError("Не удалось отправить письмо. Попробуйте позже.") from exc
        logger.warning("SMTP not configured: verification code for %s is %s", email, code)
        delivery = "log"
    return {"ok": True, "sent": True, "delivery": delivery, "ttl": OTP_TTL_SECONDS, **({"debug_code": code} if delivery == "log" else {})}


def confirm_verification(db: Session, user: User, code: str) -> dict:
    row = db.execute(select(EmailVerification).where(EmailVerification.user_id == user.id)).scalar_one_or_none()
    if row is None:
        raise EmailError("Сначала запросите код подтверждения")
    if as_utc(row.expires_at) < utcnow():
        raise EmailError("Код истёк, запросите новый")
    if row.attempts >= MAX_ATTEMPTS:
        raise EmailError("Слишком много попыток, запросите новый код")
    if not constant_time_equal(sha256_hex(str(code or "").strip()), row.code_hash):
        row.attempts += 1
        db.flush()
        raise EmailError("Неверный код")
    other = db.execute(select(User.id).where(User.email == row.email, User.email_verified_at.is_not(None), User.id != user.id)).first()
    if other:
        raise EmailError("Этот e-mail уже привязан к другому аккаунту")
    user.email = row.email
    user.email_verified_at = utcnow()
    db.delete(row)
    db.flush()
    log_event(db, "E-mail подтверждён", f"{user.telegram_id} • {user.email}", category="users", entity_type="user", entity_id=user.id)
    return {"ok": True, "email": user.email}
