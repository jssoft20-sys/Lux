"""Background worker process.

Loops (each isolated, failures are logged and never stop the others):
  * payment events   — match/credit unmatched confirmations (webhook path already
                       processes events inline; this is the safety net)
  * deposit expiry   — close unpaid deposits after the timeout
  * stuck recovery   — deposits stuck in ``processing`` longer than the timeout
  * cash monitor     — balance checks and configurable auto-disable thresholds
  * admin push       — Web Push and Telegram delivery for admin notifications
  * support          — auto-resolve idle conversations
  * jobs             — generic persistent job queue (retries with backoff)
  * imap             — optional bank e-mail poller (Timeweb IMAP)
"""
from __future__ import annotations

import logging
import signal
import threading
import time
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select

from ..config import get_settings
from ..db import transaction
from ..models import Deposit, Job, Notification, PushDelivery, PushSubscription
from ..services import cashes as cash_service
from ..services import notifications, payments, settings_store
from ..services import support as support_service
from ..services.deposits import credit_deposit, expire_deposits
from ..services.logs import log_event
from ..utils import as_utc, utcnow

logger = logging.getLogger("onoipay.worker")
STOP = threading.Event()


def _loop(name: str, fn: Callable[[], None], interval: float) -> None:
    logger.info("worker loop %s started (every %.1fs)", name, interval)
    while not STOP.is_set():
        started = time.monotonic()
        try:
            fn()
        except Exception:
            logger.exception("worker loop %s failed", name)
        elapsed = time.monotonic() - started
        STOP.wait(max(0.2, interval - elapsed))


# ------------------------------------------------------------------- payment events

def tick_payment_events() -> None:
    with transaction() as db:
        ids = payments.pending_event_ids(db, limit=50)
    for event_id in ids:
        try:
            payments.process_event(event_id)
        except Exception:
            logger.exception("event %s failed", event_id)


def tick_expiry() -> None:
    with transaction() as db:
        expired = expire_deposits(db)
        if expired:
            logger.info("expired %d deposits", len(expired))


def tick_stuck() -> None:
    settings = get_settings()
    cutoff = utcnow() - timedelta(seconds=settings.stuck_processing_timeout_seconds)
    with transaction() as db:
        rows = db.execute(select(Deposit).where(Deposit.status == "processing", Deposit.processing_started_at < cutoff)).scalars().all()
        for deposit in rows:
            deposit.status = "failed"
            deposit.error = "Зачисление зависло: нет ответа от кассы. Проверьте вручную."
            log_event(db, "Зависшее зачисление переведено в ошибку", deposit.public_id, level="error", category="deposits", entity_type="deposit", entity_id=deposit.public_id)
            notifications.admin_event(db, "deposit_failed", f"deposit_stuck:{deposit.id}", "⚠️ Зачисление зависло", f"{deposit.public_id} • {deposit.pay_amount} {deposit.currency} • ID {deposit.player_id}", {"deposit_id": deposit.id, "url": f"#/deposits/{deposit.id}"}, level="critical")


def tick_cash_monitor() -> None:
    with transaction() as db:
        if not settings_store.get_bool(db, "cash_monitor_enabled", True):
            return
        if not cash_service.monitor_due(db):
            return
        results = cash_service.monitor_once(db)
        logger.info("cash monitor: %s", results)


def tick_support() -> None:
    with transaction() as db:
        support_service.auto_resolve_idle(db)


# ------------------------------------------------------------------- admin push

def _push_send(subscription: PushSubscription, payload: str) -> tuple[bool, str, bool]:
    settings = get_settings()
    if not settings.vapid_private_key:
        return False, "vapid_not_configured", True
    try:
        from pywebpush import WebPushException, webpush
    except Exception:  # pragma: no cover
        return False, "pywebpush_not_installed", True
    try:
        webpush(
            subscription_info={"endpoint": subscription.endpoint, "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=180,
            headers={"Urgency": "high"},
        )
        return True, "", False
    except WebPushException as exc:
        code = None
        try:
            code = int(exc.response.status_code) if exc.response is not None else None
        except Exception:
            pass
        if code in (404, 410):
            return False, f"http_{code}", True
        return False, f"webpush_{code or 'error'}: {str(exc)[:200]}", False
    except Exception as exc:
        return False, f"{type(exc).__name__}: {str(exc)[:200]}", False


def tick_admin_push() -> None:
    import json

    settings = get_settings()
    delays = [2, 5, 15, 45, 120]
    with transaction() as db:
        pending = db.execute(
            select(Notification).where(Notification.channel == "admin_push", Notification.status == "pending").order_by(Notification.id.asc()).limit(50)
        ).scalars().all()
        subs = db.execute(select(PushSubscription).where(PushSubscription.enabled.is_(True))).scalars().all()
        for note in pending:
            if (utcnow() - as_utc(note.created_at)).total_seconds() > settings.notification_max_age_seconds:
                note.status = "expired"
                note.processed_at = utcnow()
                continue
            for sub in subs:
                exists = db.execute(select(PushDelivery.id).where(PushDelivery.notification_id == note.id, PushDelivery.subscription_id == sub.id)).first()
                if not exists:
                    db.add(PushDelivery(notification_id=note.id, subscription_id=sub.id, status="pending", next_attempt_at=utcnow()))
            note.status = "sent"  # the UI feed is served from the DB; push fan-out tracked per delivery
            note.processed_at = utcnow()
        db.flush()
        deliveries = db.execute(
            select(PushDelivery).where(PushDelivery.status == "pending", PushDelivery.next_attempt_at <= utcnow()).order_by(PushDelivery.id.asc()).limit(40)
        ).scalars().all()
        work = []
        for d in deliveries:
            note = db.get(Notification, d.notification_id)
            sub = db.get(PushSubscription, d.subscription_id)
            if note is None or sub is None or not sub.enabled:
                d.status = "failed"
                d.error = "missing"
                continue
            payload = json.dumps({
                "id": note.id, "event": note.event, "level": note.level, "title": note.title, "body": note.body[:500],
                "tag": f"onoipay-{note.event}-{note.id}", "url": (settings.base_path or "") + "/" + (note.data or {}).get("url", ""),
                "timestamp": int(as_utc(note.created_at).timestamp() * 1000), "requireInteraction": note.level == "critical",
                "channel": "critical" if note.level == "critical" else "normal",
            }, ensure_ascii=False)
            work.append((d.id, sub.id, payload))
    for delivery_id, sub_id, payload in work:
        with transaction() as db:
            sub = db.get(PushSubscription, sub_id)
            d = db.get(PushDelivery, delivery_id)
            if sub is None or d is None:
                continue
            ok, error, permanent = _push_send(sub, payload)
            d.attempts += 1
            if ok:
                d.status = "sent"
                sub.fail_count = 0
                sub.last_ok_at = utcnow()
            elif permanent or d.attempts >= len(delays):
                d.status = "failed"
                d.error = error[:300]
                if permanent and error.startswith("http_"):
                    sub.enabled = False
                    sub.fail_count += 1
            else:
                d.next_attempt_at = utcnow() + timedelta(seconds=delays[min(d.attempts - 1, len(delays) - 1)])
                d.error = error[:300]


# ------------------------------------------------------------------- jobs

JOB_HANDLERS: dict[str, Callable[[dict], None]] = {}


def job(kind: str):
    def _wrap(fn):
        JOB_HANDLERS[kind] = fn
        return fn

    return _wrap


@job("credit_deposit")
def _job_credit(payload: dict) -> None:
    result = credit_deposit(int(payload["deposit_id"]), source=str(payload.get("source") or "job"))
    if not result.get("ok") and not result.get("already"):
        raise RuntimeError(result.get("message") or "credit failed")


@job("process_payment_event")
def _job_event(payload: dict) -> None:
    payments.process_event(int(payload["event_id"]))


def tick_jobs() -> None:
    worker_id = f"worker-{threading.get_ident()}"
    with transaction() as db:
        rows = db.execute(select(Job).where(Job.status == "queued", Job.run_at <= utcnow()).order_by(Job.id.asc()).limit(10)).scalars().all()
        claimed = []
        for row in rows:
            row.status = "running"
            row.locked_at = utcnow()
            row.locked_by = worker_id
            row.attempts += 1
            claimed.append((row.id, row.kind, dict(row.payload or {}), row.attempts, row.max_attempts))
    for job_id, kind, payload, attempts, max_attempts in claimed:
        handler = JOB_HANDLERS.get(kind)
        error = ""
        try:
            if handler is None:
                raise RuntimeError(f"no handler for {kind}")
            handler(payload)
        except Exception as exc:
            error = str(exc)[:600]
            logger.warning("job %s (%s) failed: %s", job_id, kind, error)
        with transaction() as db:
            row = db.get(Job, job_id)
            if row is None:
                continue
            if not error:
                row.status = "done"
                row.finished_at = utcnow()
            elif attempts >= max_attempts:
                row.status = "failed"
                row.last_error = error
                row.finished_at = utcnow()
            else:
                row.status = "queued"
                row.last_error = error
                row.run_at = utcnow() + timedelta(seconds=min(600, 5 * (2 ** attempts)))
            row.locked_by = ""


# ------------------------------------------------------------------- imap (optional)

def tick_imap() -> None:
    from .imap_source import poll_once

    poll_once()


# ------------------------------------------------------------------- entry point

def on_start() -> None:
    settings = get_settings()
    with transaction() as db:
        expired = notifications.expire_stale(db, settings.notification_max_age_seconds)
        if expired:
            logger.info("expired %d stale notifications on start", expired)
        log_event(db, "Worker запущен", "фоновые задачи активны", category="system")


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    on_start()
    loops = [
        ("payment_events", tick_payment_events, max(0.5, settings.worker_poll_seconds)),
        ("expiry", tick_expiry, 1.0),
        ("stuck", tick_stuck, 15.0),
        ("cash_monitor", tick_cash_monitor, 10.0),
        ("admin_push", tick_admin_push, 1.0),
        ("support", tick_support, 300.0),
        ("jobs", tick_jobs, 2.0),
    ]
    if settings.imap_enabled:
        loops.append(("imap", tick_imap, max(2.0, settings.imap_poll_seconds)))
    threads = [threading.Thread(target=_loop, args=(name, fn, interval), name=name, daemon=True) for name, fn, interval in loops]
    for thread in threads:
        thread.start()

    def _stop(signum, frame):  # pragma: no cover
        STOP.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _stop)
        except Exception:  # pragma: no cover
            pass
    while not STOP.is_set():
        STOP.wait(1.0)
    logger.info("worker stopping")


if __name__ == "__main__":
    main()
