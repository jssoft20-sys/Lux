"""«Сторож тишины»: ловит аварии, о которых иначе узнаёшь от клиентов.

Проверяет то, что ломается молча:
  * платежи из банка перестали приходить, хотя клиенты оплачивают (упал MacroDroid или почта);
  * бот не подаёт признаков жизни (процесс упал или Telegram недоступен);
  * касса не отвечает или отключена автоматикой;
  * очередь выводов стоит дольше положенного (операторы не в работе).

Тревога уходит владельцу в Telegram один раз, восстановление — тоже один раз; состояние
хранится в настройках, поэтому перезапуск worker'а не рассылает всё заново.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import BotSession, Deposit, PaymentCash, PaymentEvent, Withdrawal
from ..utils import as_utc, utcnow
from . import settings_store
from .logs import log_event
from .notifications import admin_event

logger = logging.getLogger("paygo.watchdog")
STATE_KEY = "watchdog_state"


def _minutes(db: Session, key: str, default: int) -> int:
    try:
        return max(0, int(settings_store.get(db, key, default) or 0))
    except (TypeError, ValueError):
        return default


def _alarm(key: str, title: str, detail: str) -> dict[str, str]:
    return {"key": key, "title": title, "detail": detail}


def _payments_silent(db: Session, now: Any) -> dict[str, str] | None:
    """Клиенты оплачивают, а подтверждений из банка нет — типичная авария источника платежей."""
    window = _minutes(db, "watchdog_payments_minutes", 30)
    if window <= 0:
        return None
    since = now - timedelta(minutes=window)
    waiting = db.execute(select(func.count(Deposit.id)).where(Deposit.created_at >= since, Deposit.status.in_(("created", "expired", "failed")))).scalar() or 0
    if int(waiting) < 2:  # тихая ночь — это не авария
        return None
    last = db.execute(select(func.max(PaymentEvent.received_at))).scalar()
    if last is not None and as_utc(last) >= since:
        return None
    seen = f"последний платёж {as_utc(last).strftime('%d.%m %H:%M')}" if last is not None else "платежей ещё не было"
    return _alarm("payments_silent", "Платежи из банка не приходят",
                  f"За {window} мин ни одного поступления, а заявок на оплату: {int(waiting)} ({seen}). Проверьте MacroDroid на телефоне и почтовый источник.")


def _bot_silent(db: Session, now: Any) -> list[dict[str, str]]:
    window = _minutes(db, "watchdog_bot_minutes", 10)
    if window <= 0:
        return []
    out: list[dict[str, str]] = []
    for key, label in (("main:beat", "Основной бот"), ("support:beat", "Бот поддержки")):
        row = db.execute(select(BotSession).where(BotSession.bot == key, BotSession.telegram_id == 0)).scalar_one_or_none()
        if row is None:
            continue  # бот ни разу не запускался в этой версии — не тревожим
        beat = as_utc(row.updated_at) if row.updated_at else None
        if beat is None or (now - beat).total_seconds() > window * 60:
            ago = f"{int((now - beat).total_seconds() // 60)} мин назад" if beat else "никогда"
            out.append(_alarm(f"bot_silent:{key.split(':')[0]}", f"{label} молчит",
                              f"Последний признак жизни: {ago}. Проверьте: systemctl status paygo-{'bot' if key.startswith('main') else 'support'}"))
    return out


def _cash_down(db: Session, now: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for cash in db.execute(select(PaymentCash).where(PaymentCash.enabled.is_(True))).scalars().all():
        if cash.auto_disabled:
            out.append(_alarm(f"cash_off:{cash.key}", f"Касса {cash.name} отключена автоматикой", cash.last_check_message or "Проверьте доступ к API кассы."))
        elif cash.last_check_ok is False:
            out.append(_alarm(f"cash_down:{cash.key}", f"Касса {cash.name} не отвечает", cash.last_check_message or "Последняя проверка баланса не прошла."))
    return out


def _queue_stuck(db: Session, now: Any) -> dict[str, str] | None:
    window = _minutes(db, "watchdog_queue_minutes", 60)
    if window <= 0:
        return None
    since = now - timedelta(minutes=window)
    stuck = db.execute(select(func.count(Withdrawal.id)).where(
        Withdrawal.status.in_(("created", "processing")), Withdrawal.deferred.is_(False), Withdrawal.needs_attention.is_(False), Withdrawal.created_at <= since,
    )).scalar() or 0
    if int(stuck) <= 0:
        return None
    return _alarm("queue_stuck", "Очередь выводов стоит", f"{int(stuck)} заявк(и) ждут дольше {window} мин. Клиенты уже волнуются — раздайте операторам.")


def check(db: Session) -> list[dict[str, str]]:
    """Активные тревоги прямо сейчас (без побочных эффектов)."""
    if not settings_store.get_bool(db, "watchdog_enabled", True):
        return []
    now = utcnow()
    out: list[dict[str, str]] = []
    payments = _payments_silent(db, now)
    if payments:
        out.append(payments)
    out += _bot_silent(db, now)
    out += _cash_down(db, now)
    queue = _queue_stuck(db, now)
    if queue:
        out.append(queue)
    return out


def stored(db: Session) -> list[dict[str, str]]:
    """Тревоги из последней проверки — панель берёт их отсюда, не пересчитывая."""
    raw = str(settings_store.get(db, STATE_KEY) or "")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    return [a for a in data.get("alarms", []) if isinstance(a, dict)]


def tick(db: Session) -> list[dict[str, str]]:
    """Проверка + уведомления об изменениях (вызывается фоновым worker'ом)."""
    alarms = check(db)
    was = {a.get("key") for a in stored(db)}
    now_keys = {a["key"] for a in alarms}
    for alarm in alarms:
        if alarm["key"] in was:
            continue
        admin_event(db, "system_alarm", f"watchdog:{alarm['key']}:{utcnow().strftime('%Y%m%d%H%M')}", f"🛑 {alarm['title']}", alarm["detail"], {"url": "#/home"}, level="critical")
        log_event(db, f"Сторож: {alarm['title']}", alarm["detail"], level="error", category="system")
    for key in was - now_keys:
        admin_event(db, "system_alarm", f"watchdog:ok:{key}:{utcnow().strftime('%Y%m%d%H%M')}", "✅ Всё восстановилось", f"Тревога снята: {key}", {"url": "#/home"})
        log_event(db, "Сторож: восстановлено", key, category="system")
    settings_store.set_many(db, {STATE_KEY: json.dumps({"alarms": alarms, "at": utcnow().isoformat()}, ensure_ascii=False)})
    return alarms


__all__ = ["check", "stored", "tick"]
