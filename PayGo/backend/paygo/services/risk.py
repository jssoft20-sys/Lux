"""Антифрод: подсказки оператору прямо в заявке.

Ничего не блокирует и не решает за человека — только показывает то, что оператор
иначе искал бы руками: клиент выводит больше, чем пополнял; этот же QR уже
использовал другой клиент; ID игрока общий у нескольких клиентов; серия отказов;
сумма резко выше обычной; несколько одинаковых заявок подряд.

Каждый сигнал: ``key`` (для тестов), ``level`` (danger / warn / info), короткий
``title`` и ``detail`` с цифрами, чтобы решение принималось по фактам.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Deposit, User, Withdrawal
from ..utils import as_utc, money, utcnow
from . import settings_store

FAIL_DAYS = 7  # окно, в котором считаем отказы клиента
REPEAT_MINUTES = 60  # окно «несколько одинаковых заявок подряд»
NEW_CLIENT_HOURS = 24


def _signal(key: str, level: str, title: str, detail: str) -> dict[str, str]:
    return {"key": key, "level": level, "title": title, "detail": detail}


def _sums(db: Session, user_id: int) -> tuple[Decimal, Decimal]:
    """Успешные пополнения и выводы клиента за всё время."""
    dep = db.execute(select(func.coalesce(func.sum(Deposit.pay_amount), 0)).where(Deposit.user_id == user_id, Deposit.status == "success")).scalar() or 0
    wd = db.execute(select(func.coalesce(func.sum(Withdrawal.amount), 0)).where(Withdrawal.user_id == user_id, Withdrawal.status == "success")).scalar() or 0
    return money(dep), money(wd)


def _fails(db: Session, user_id: int) -> int:
    since = utcnow() - timedelta(days=FAIL_DAYS)
    dep = db.execute(select(func.count(Deposit.id)).where(Deposit.user_id == user_id, Deposit.status.in_(("failed", "cancelled")), Deposit.created_at >= since)).scalar() or 0
    wd = db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.user_id == user_id, Withdrawal.status.in_(("failed", "cancelled")), Withdrawal.created_at >= since)).scalar() or 0
    return int(dep) + int(wd)


def _client_signals(db: Session, user: User | None, created_at: Any, amount: Decimal) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if user is None:
        return out
    if user.is_blocked:
        out.append(_signal("blocked", "danger", "Клиент заблокирован", user.block_reason or "Операции клиенту закрыты — уточните у владельца."))
    created = as_utc(user.created_at) if user.created_at else None
    if created and (as_utc(created_at) - created).total_seconds() < NEW_CLIENT_HOURS * 3600:
        threshold = money(settings_store.get(db, "risk_new_client_amount", 5000) or 0)
        if threshold > 0 and amount >= threshold:
            out.append(_signal("new_client", "warn", "Новый клиент и крупная сумма",
                               f"Аккаунт создан меньше {NEW_CLIENT_HOURS} ч назад, а сумма {money(amount)} ≥ {money(threshold)}."))
    fails = _fails(db, user.id)
    if fails >= 3:
        out.append(_signal("fails", "warn", "Серия отказов у клиента", f"За {FAIL_DAYS} дней отменено или не прошло заявок: {fails}."))
    return out


def withdrawal_signals(db: Session, w: Withdrawal) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    amount = money(w.amount)
    user = db.get(User, w.user_id)
    deposits_sum, withdrawals_sum = _sums(db, w.user_id)
    # главный сигнал: клиент выводит больше, чем когда-либо пополнял
    if amount > 0 and (withdrawals_sum + amount) > deposits_sum:
        over = money(withdrawals_sum + amount - deposits_sum)
        level = "danger" if deposits_sum <= 0 else "warn"
        out.append(_signal(
            "payout_over_deposits", level, "Вывод больше суммы пополнений",
            f"Пополнено за всё время {money(deposits_sum)}, выведено {money(withdrawals_sum)}, эта заявка {amount} — превышение на {over}."
            + (" Клиент ни разу не пополнял." if deposits_sum <= 0 else ""),
        ))
    # тот же QR у другого клиента
    if w.qr_payload:
        other = db.execute(
            select(Withdrawal).where(Withdrawal.qr_payload == w.qr_payload, Withdrawal.user_id != w.user_id).order_by(Withdrawal.id.desc())
        ).scalars().first()
        if other is not None:
            others = db.execute(select(func.count(func.distinct(Withdrawal.user_id))).where(Withdrawal.qr_payload == w.qr_payload)).scalar() or 0
            out.append(_signal("qr_shared", "danger", "Этот QR уже использовал другой клиент",
                               f"На тот же счёт выводили {int(others)} разных клиентов, последняя заявка {other.public_id}."))
    # средний вывод клиента и всплеск суммы
    if amount > 0:
        rows = db.execute(select(Withdrawal.amount).where(Withdrawal.user_id == w.user_id, Withdrawal.status == "success", Withdrawal.id != w.id).order_by(Withdrawal.id.desc()).limit(10)).scalars().all()
        values = [money(v) for v in rows if money(v) > 0]
        if len(values) >= 3:
            avg = money(sum(values) / len(values))
            factor = money(settings_store.get(db, "risk_spike_factor", 5) or 0)
            if avg > 0 and factor > 0 and amount >= avg * factor:
                out.append(_signal("amount_spike", "warn", "Сумма намного выше обычной",
                                   f"Обычно клиент выводит около {avg}, сейчас {amount} (в {money(amount / avg)} раза больше)."))
    # несколько заявок на ту же сумму подряд
    if amount > 0 and w.created_at:
        since = as_utc(w.created_at) - timedelta(minutes=REPEAT_MINUTES)
        same = db.execute(select(func.count(Withdrawal.id)).where(Withdrawal.user_id == w.user_id, Withdrawal.amount == w.amount, Withdrawal.id != w.id, Withdrawal.created_at >= since)).scalar() or 0
        if int(same) >= 1:
            out.append(_signal("repeat_amount", "info", "Похожие заявки подряд", f"За час у клиента ещё {int(same)} заявк(и) на ту же сумму {amount}."))
    # один ID игрока у нескольких клиентов
    out += _player_signal(db, w.player_id, w.user_id)
    out += _client_signals(db, user, w.created_at or utcnow(), amount)
    return out


def deposit_signals(db: Session, d: Deposit) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    amount = money(d.pay_amount)
    user = db.get(User, d.user_id)
    if amount > 0 and d.created_at:
        since = as_utc(d.created_at) - timedelta(minutes=REPEAT_MINUTES)
        same = db.execute(select(func.count(Deposit.id)).where(Deposit.user_id == d.user_id, Deposit.pay_amount == d.pay_amount, Deposit.id != d.id, Deposit.created_at >= since)).scalar() or 0
        if int(same) >= 1:
            out.append(_signal("repeat_amount", "info", "Похожие заявки подряд", f"За час у клиента ещё {int(same)} заявк(и) на ту же сумму {amount}."))
    out += _player_signal(db, d.player_id, d.user_id)
    out += _client_signals(db, user, d.created_at or utcnow(), amount)
    return out


def _player_signal(db: Session, player_id: str, user_id: int) -> list[dict[str, str]]:
    """Один и тот же игровой счёт у разных клиентов Telegram — частый признак схемы."""
    pid = str(player_id or "").strip()
    if not pid:
        return []
    users = db.execute(
        select(func.count(func.distinct(Deposit.user_id))).where(Deposit.player_id == pid)
    ).scalar() or 0
    users_w = db.execute(
        select(func.count(func.distinct(Withdrawal.user_id))).where(Withdrawal.player_id == pid)
    ).scalar() or 0
    others = db.execute(
        select(func.count(func.distinct(Deposit.user_id))).where(Deposit.player_id == pid, Deposit.user_id != user_id)
    ).scalar() or 0
    others_w = db.execute(
        select(func.count(func.distinct(Withdrawal.user_id))).where(Withdrawal.player_id == pid, Withdrawal.user_id != user_id)
    ).scalar() or 0
    if int(others) + int(others_w) <= 0:
        return []
    return [_signal("player_shared", "warn", "ID игрока используют разные клиенты",
                    f"Счёт {pid} встречается у {max(int(users), int(users_w))} разных Telegram-аккаунтов.")]


def signals(db: Session, row: Deposit | Withdrawal) -> list[dict[str, str]]:
    """Все подсказки по заявке, опасные — первыми."""
    if not settings_store.get_bool(db, "risk_signals_enabled", True):
        return []
    try:
        items = withdrawal_signals(db, row) if isinstance(row, Withdrawal) else deposit_signals(db, row)
    except Exception:  # подсказки никогда не должны мешать открыть заявку
        import logging

        logging.getLogger("paygo.risk").exception("risk signals failed")
        return []
    order = {"danger": 0, "warn": 1, "info": 2}
    return sorted(items, key=lambda s: order.get(s["level"], 3))


def has_blocking(items: list[dict[str, str]]) -> bool:
    return any(s.get("level") == "danger" for s in items)


__all__ = ["signals", "withdrawal_signals", "deposit_signals", "has_blocking"]
