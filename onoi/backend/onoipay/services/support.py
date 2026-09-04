"""Automated first-line support.

Pipeline for every incoming support message:
  anti-flood → duplicate check → classification → answer from system data
  → (optional) hand-off to an operator with full context.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Deposit,
    PaymentCash,
    SupportConversation,
    SupportMessage,
    SupportRateLimit,
    SystemLog,
    User,
    Withdrawal,
)
from ..utils import as_utc, fmt_local, iso, money, sha256_hex, utcnow
from . import settings_store
from .deposits import STATUS_LABELS as DEPOSIT_LABELS
from .logs import log_event
from .notifications import admin_event, notify_user
from .users import display_name, last_qr, user_summary
from .withdrawals import STATUS_LABELS as WITHDRAWAL_LABELS

CATEGORIES = ("deposit", "withdrawal", "payment", "verification", "account", "qr", "currency", "technical", "faq", "operator")

# --------------------------------------------------------------------------- classifier

_KG_MARKERS = re.compile(r"[өүң]|\b(кантип|качан|канча|акча|салуу|чыгаруу|толуктоо|жардам|болбой|келбей|ырахмат|саламатсызбы|салам)\b", re.I)


@dataclass
class Intent:
    category: str
    name: str
    confidence: float
    language: str = "ru"
    matched: list[str] = field(default_factory=list)


# (category, intent, weight, pattern)
_RULES: list[tuple[str, str, float, str]] = [
    ("operator", "operator", 1.0, r"\b(оператор\w*|человек\w*|живой|менеджер\w*|сотрудник\w*|поддержк[аи] живая|позов\w+|свяжите|адам менен|оператор\w*)\b"),
    ("operator", "complaint", 0.9, r"\b(мошенни\w+|обман\w*|кидал\w*|жалоб\w*|верните|украли|воры|скам\w*)\b"),
    ("withdrawal", "withdrawal_cancel", 0.95, r"(отмен\w+|вернут\w+|аннулир\w+|жокко чыгар\w*)[^.\n]{0,25}(вывод\w*|заявк\w*|чыгаруу)|(вывод\w*|заявк\w*)[^.\n]{0,25}(отмен\w+|аннулир\w+)"),
    ("withdrawal", "withdrawal_delay", 0.95, r"(когда|скоро|долго|сколько ждать|качан|канча|почему нет|не пришел|не пришёл|не пришл[иа]|не поступил|ещё нет|еще нет|не получил|задерж\w+|келбей|келген жок)[^.\n]{0,40}(вывод\w*|выплат\w*|деньги|акча|чыгаруу)|(вывод\w*|выплат\w*)[^.\n]{0,40}(когда|долго|не пришел|не пришёл|не пришл[иа]|не поступил|задерж\w+|ждать|качан|келбей|еще нет|ещё нет)"),
    ("withdrawal", "withdrawal_status", 0.85, r"(статус|состояни\w*|проверить|проверьте|что с|абал\w*|текшер\w*)[^.\n]{0,30}(вывод\w*|выплат\w*|чыгаруу)|(вывод\w*)[^.\n]{0,20}(статус|состояни\w*|абал\w*)"),
    ("withdrawal", "withdrawal_code", 0.85, r"\b(код\w*)\b[^.\n]{0,30}(вывод\w*|неверн\w*|не подходит|не принимает|устарел|одноразов\w*|ошибк\w*)|(неверн\w*|не подходит|не принимает|ошибк\w*)[^.\n]{0,30}\bкод"),
    ("withdrawal", "withdrawal_howto", 0.8, r"(как|каким образом|кантип)[^.\n]{0,25}(вывести|вывод\w*|снять|получить деньги|чыгар\w*)|инструкци\w*[^.\n]{0,20}вывод"),
    ("withdrawal", "withdrawal_reasons", 0.8, r"(почему|причин\w*|эмне үчүн|неге)[^.\n]{0,30}(ожидан\w*|ждет|ждёт|обработк\w*|в обработке|не выполнен|отклон\w*)"),
    ("deposit", "deposit_delay", 0.95, r"(оплатил\w*|перевел\w*|перевёл\w*|заплатил\w*|отправил\w*|закинул\w*|төлөд\w*|салд\w*)[^.\n]{0,60}(не пришл[оиа]|не зачисл\w*|не поступил\w*|нет денег|ещё нет|еще нет|не упал\w*|келбей|келген жок|не пополнил\w*)|(не зачисл\w*|не поступил\w*|не пришл[оиа]|не упал\w*)[^.\n]{0,40}(пополнен\w*|депозит\w*|деньги|оплат\w*|баланс)|(пополнен\w*|депозит\w*)[^.\n]{0,40}(не пришл[оиа]|не зачисл\w*|задерж\w+|долго|не поступил\w*|келбей)"),
    ("deposit", "deposit_error", 0.9, r"(ошибк\w*|не получается|не могу|не проходит|проблем\w*|болбой|ката)[^.\n]{0,40}(пополн\w*|депозит\w*|оплат\w*|толукто\w*)|(пополн\w*|депозит\w*)[^.\n]{0,40}(ошибк\w*|не получается|не проходит|проблем\w*|болбой)"),
    ("deposit", "deposit_status", 0.85, r"(статус|состояни\w*|проверить|проверьте|что с|абал\w*)[^.\n]{0,30}(пополн\w*|депозит\w*|заявк\w*|толукто\w*)|(пополн\w*|депозит\w*)[^.\n]{0,20}(статус|состояни\w*)"),
    ("deposit", "deposit_howto", 0.8, r"(как|кантип)[^.\n]{0,25}(пополнить|пополнени\w*|закинуть|внести|депозит|толукто\w*|акча сал\w*)|инструкци\w*[^.\n]{0,20}пополн"),
    ("deposit", "deposit_cancel", 0.9, r"(отмен\w+|жокко)[^.\n]{0,25}(пополн\w*|депозит\w*|толукто\w*)"),
    ("payment", "payment_status", 0.85, r"(статус|состояни\w*|прошел|прошёл|прошла|дошел|дошёл|дошла|получили)[^.\n]{0,30}(платеж\w*|платёж\w*|оплат\w*|перевод\w*|төлөм\w*)|(платеж\w*|платёж\w*|перевод\w*|оплат\w*)[^.\n]{0,20}(статус|прошел|прошёл|дошел|дошёл|получили)"),
    ("payment", "receipt", 0.8, r"\b(чек\w*|квитанци\w*|скрин\w*|скриншот\w*|подтвержден\w* оплат\w*)\b"),
    ("qr", "qr_problem", 0.9, r"(qr|кр код|куар|кюар)[^.\n]{0,40}(не читает\w*|не сканир\w*|не работает|ошибк\w*|неверн\w*|не подходит|не принимает|не открыва\w*|болбой)|(не читает\w*|не сканир\w*|не открыва\w*)[^.\n]{0,30}(qr|куар|кюар)"),
    ("qr", "qr_howto", 0.85, r"(где|как|откуда|кайдан|кантип)[^.\n]{0,25}(qr|куар|кюар|кр код)|(qr|куар|кюар)[^.\n]{0,15}(вывод\w*|банк\w*|получить|алам|алуу)|\b(qr|куар|кюар)\b"),
    ("currency", "currency_mismatch", 0.95, r"валют\w*|\b(usd|eur|rub|kzt|uzs|доллар\w*|рубл\w*|тенге|сум\w* узбек|евро)\b"),
    ("account", "id_problem", 0.9, r"(id|айди|идентификатор|номер счета|номер счёта|аккаунт\w*)[^.\n]{0,30}(не найден\w*|неверн\w*|не подходит|ошибк\w*|не принимает|не проходит|табылган жок)|(не найден\w*|неверн\w*|не подходит)[^.\n]{0,20}(id|айди)"),
    ("account", "blocked", 0.9, r"\b(заблокир\w*|блокировк\w*|бан\w*|бөгөт\w*|ограничен\w*)\b"),
    ("account", "profile", 0.7, r"\b(профил\w*|аккаунт\w*|личн\w* кабинет|мои данные|история заявок|история)\b"),
    ("verification", "email", 0.85, r"\b(email|e-mail|почт\w*|мейл\w*|письм\w*|код подтвержд\w*)\b"),
    ("verification", "phone", 0.8, r"\b(телефон\w*|номер\w* телефон\w*|контакт\w*|sms|смс)\b"),
    ("verification", "verification", 0.8, r"\b(верификац\w*|идентификац\w*|подтвердить личность|паспорт\w*|селфи)\b"),
    ("technical", "bot_broken", 0.85, r"(бот\w*|кнопк\w*|меню|приложени\w*)[^.\n]{0,30}(не работает|не отвечает|завис\w*|не нажима\w*|ошибк\w*|глючит|тормоз\w*|иштебей|болбой)|(не работает|не отвечает|завис\w*|глючит)[^.\n]{0,20}(бот\w*|кнопк\w*)"),
    ("technical", "error_generic", 0.6, r"\b(ошибк\w*|не работает|сбой\w*|ката|иштебей)\b"),
    ("faq", "commission", 0.9, r"\b(комисси\w*|процент\w*|сколько берете|сколько берёте|комиссия|плата за)\b"),
    ("faq", "limits", 0.9, r"\b(минимум\w*|минимальн\w*|максимум\w*|максимальн\w*|лимит\w*|сколько можно|от какой суммы|до какой суммы|эң аз|эң көп)\b"),
    ("faq", "referral", 0.9, r"\b(реферал\w*|рефералк\w*|бонус\w*|пригласи\w*|приглашен\w*|партнер\w*|партнёр\w*|чакыр\w*)\b"),
    ("faq", "cash_info", 0.8, r"\b(касс\w*|букмекер\w*|1xbet|1хбет|xbet|1win|1вин|бк)\b"),
    ("faq", "schedule", 0.8, r"\b(график\w*|режим работы|часы работы|работаете|круглосуточно|24/7|выходн\w*|качан иштей\w*)\b"),
    ("faq", "instructions", 0.7, r"\b(инструкци\w*|как пользоваться|как работает|что делать|помощь|help|жардам)\b"),
    ("faq", "greeting", 0.6, r"^\s*(привет\w*|здравствуй\w*|добрый (день|вечер|утро)|салам\w*|саламатсызбы|hi|hello|хай|доброго времени)\W*$"),
    ("faq", "thanks", 0.7, r"\b(спасибо|благодар\w*|рахмат|ырахмат|thanks|thank you|спс|сяп)\b"),
]
_COMPILED = [(c, n, w, re.compile(p, re.I)) for c, n, w, p in _RULES]


def detect_language(text: str) -> str:
    return "kg" if _KG_MARKERS.search(text or "") else "ru"


def classify(text: str) -> Intent:
    clean = (text or "").strip().lower()
    language = detect_language(clean)
    if not clean:
        return Intent("faq", "empty", 0.3, language)
    best: Intent | None = None
    for category, name, weight, pattern in _COMPILED:
        match = pattern.search(clean)
        if not match:
            continue
        confidence = weight
        if len(clean) > 200:
            confidence -= 0.1
        if best is None or confidence > best.confidence:
            best = Intent(category, name, round(min(1.0, confidence), 3), language, [match.group(0)[:40]])
    if best is None:
        return Intent("faq", "unknown", 0.2, language)
    return best


# ------------------------------------------------------------------------ anti-flood

@dataclass
class FloodDecision:
    allowed: bool
    reply: str = ""
    silent: bool = False
    duplicate: bool = False


def _normalize(text: str) -> str:
    return re.sub(r"\W+", " ", (text or "").lower()).strip()


def check_flood(db: Session, telegram_id: int, text: str, *, media: bool = False) -> FloodDecision:
    """Token-bucket style limiter with duplicate suppression. Normal users never notice it."""
    now = utcnow()
    limit = settings_store.get_int(db, "support_rate_limit_messages", 6)
    window = settings_store.get_int(db, "support_rate_limit_window_seconds", 20)
    cooldown = settings_store.get_int(db, "support_cooldown_seconds", 45)
    dup_window = settings_store.get_int(db, "support_duplicate_window_seconds", 600)
    row = db.get(SupportRateLimit, telegram_id)
    if row is None:
        row = SupportRateLimit(telegram_id=telegram_id, window_start=now, count=0)
        db.add(row)
    if row.cooldown_until and as_utc(row.cooldown_until) > now:
        row.last_message_at = now
        db.flush()
        return FloodDecision(False, silent=True)
    if as_utc(row.window_start) + timedelta(seconds=window) < now:
        row.window_start = now
        row.count = 0
    row.count += 1
    row.last_message_at = now
    if row.count > limit:
        row.cooldown_until = now + timedelta(seconds=cooldown)
        row.count = 0
        row.window_start = now
        already_warned = row.warned_at and (now - as_utc(row.warned_at)).total_seconds() < 3600
        row.warned_at = now
        db.flush()
        if already_warned:
            return FloodDecision(False, silent=True)
        return FloodDecision(False, reply="Сообщений слишком много. Ваши вопросы уже приняты — ответим по порядку. Подождите немного, пожалуйста.")
    digest = sha256_hex(_normalize(text))[:64] if text and not media else ""
    duplicate = False
    if digest and row.last_text_hash == digest and row.last_text_at and (now - as_utc(row.last_text_at)).total_seconds() < dup_window:
        row.repeats += 1
        duplicate = True
    else:
        row.repeats = 0
    if digest:
        row.last_text_hash = digest
        row.last_text_at = now
    db.flush()
    if duplicate:
        if row.repeats == 1:
            return FloodDecision(False, reply="Этот вопрос уже принят, повторять не нужно. Если появились новые детали — напишите их одним сообщением.", duplicate=True)
        return FloodDecision(False, silent=True, duplicate=True)
    return FloodDecision(True)


def escalation_allowed(db: Session, telegram_id: int) -> bool:
    row = db.get(SupportRateLimit, telegram_id)
    cooldown = settings_store.get_int(db, "support_escalation_cooldown_seconds", 300)
    if row and row.last_escalation_at and (utcnow() - as_utc(row.last_escalation_at)).total_seconds() < cooldown:
        return False
    if row is None:
        row = SupportRateLimit(telegram_id=telegram_id, window_start=utcnow(), count=0)
        db.add(row)
    row.last_escalation_at = utcnow()
    db.flush()
    return True


# --------------------------------------------------------------------- conversations

OPEN_STATUSES = ("auto", "waiting_operator", "operator")


def active_conversation(db: Session, user: User) -> SupportConversation | None:
    return db.execute(
        select(SupportConversation).where(SupportConversation.user_id == user.id, SupportConversation.status.in_(OPEN_STATUSES)).order_by(SupportConversation.id.desc())
    ).scalars().first()


def get_or_open_conversation(db: Session, user: User, category: str = "faq", subject: str = "") -> SupportConversation:
    conv = active_conversation(db, user)
    if conv is None:
        conv = SupportConversation(user_id=user.id, status="auto", category=category, subject=subject[:200], context={})
        db.add(conv)
        db.flush()
    elif subject and not conv.subject:
        conv.subject = subject[:200]
    return conv


def add_message(
    db: Session,
    conv: SupportConversation,
    *,
    direction: str,
    sender: str,
    text: str,
    kind: str = "text",
    file_url: str = "",
    telegram_message_id: int = 0,
    intent: Intent | None = None,
    admin_id: int | None = None,
    dedupe_key: str | None = None,
) -> SupportMessage:
    row = SupportMessage(
        conversation_id=conv.id,
        direction=direction,
        sender=sender,
        admin_id=admin_id,
        telegram_message_id=telegram_message_id,
        kind=kind,
        text=text or "",
        file_url=file_url or "",
        intent=(f"{intent.category}/{intent.name}" if intent else "")[:32],
        confidence=intent.confidence if intent else 0,
        dedupe_key=dedupe_key,
        read_by_admin=direction == "out",
    )
    db.add(row)
    conv.last_message_at = utcnow()
    if direction == "in":
        conv.last_user_message_at = utcnow()
        if conv.status in {"waiting_operator", "operator"}:
            conv.unread_count = int(conv.unread_count or 0) + 1
    db.flush()
    return row


# ------------------------------------------------------------------ context builders

def _minutes_left(deposit: Deposit) -> int:
    if not deposit.expires_at:
        return 0
    return max(0, int((as_utc(deposit.expires_at) - utcnow()).total_seconds() // 60))


def latest_deposit(db: Session, user: User) -> Deposit | None:
    return db.execute(select(Deposit).where(Deposit.user_id == user.id).order_by(Deposit.id.desc())).scalars().first()


def latest_withdrawal(db: Session, user: User) -> Withdrawal | None:
    return db.execute(select(Withdrawal).where(Withdrawal.user_id == user.id).order_by(Withdrawal.id.desc())).scalars().first()


def recent_events(db: Session, entity_type: str, entity_id: str, limit: int = 8) -> list[dict[str, Any]]:
    rows = db.execute(
        select(SystemLog).where(SystemLog.entity_type == entity_type, SystemLog.entity_id == str(entity_id)).order_by(SystemLog.id.desc()).limit(limit)
    ).scalars().all()
    return [{"at": iso(r.created_at), "title": r.title, "detail": r.detail[:200], "level": r.level} for r in reversed(rows)]


def build_context(db: Session, user: User, *, deposit: Deposit | None = None, withdrawal: Withdrawal | None = None) -> dict[str, Any]:
    deposit = deposit or latest_deposit(db, user)
    withdrawal = withdrawal or latest_withdrawal(db, user)
    summary = user_summary(db, user)
    context: dict[str, Any] = {
        "telegram_id": user.telegram_id,
        "username": user.username,
        "name": display_name(user),
        "language": user.language,
        "deposits_count": summary["deposits_count"],
        "withdrawals_count": summary["withdrawals_count"],
        "has_qr": summary["has_qr"],
        "blocked": user.is_blocked,
    }
    if deposit:
        context["deposit"] = {
            "id": deposit.id, "public_id": deposit.public_id, "status": deposit.status, "status_label": DEPOSIT_LABELS.get(deposit.status, deposit.status),
            "amount": str(money(deposit.pay_amount)), "currency": deposit.currency, "cash": deposit.cash.name if deposit.cash else "",
            "player_id": deposit.player_id, "created_at": iso(deposit.created_at), "error": deposit.error, "payment_source": deposit.payment_source,
            "events": recent_events(db, "deposit", deposit.public_id),
        }
    if withdrawal:
        context["withdrawal"] = {
            "id": withdrawal.id, "public_id": withdrawal.public_id, "status": withdrawal.status, "status_label": WITHDRAWAL_LABELS.get(withdrawal.status, withdrawal.status),
            "amount": str(money(withdrawal.amount)), "currency": withdrawal.currency, "cash": withdrawal.cash.name if withdrawal.cash else "",
            "player_id": withdrawal.player_id, "created_at": iso(withdrawal.created_at), "error": withdrawal.error, "needs_attention": withdrawal.needs_attention,
            "deferred": withdrawal.deferred, "events": recent_events(db, "withdrawal", withdrawal.public_id),
        }
    return context


# ------------------------------------------------------------------- answer builders

@dataclass
class Reply:
    text: str
    buttons: list[list[dict[str, str]]] = field(default_factory=list)
    escalate: bool = False
    category: str = "faq"
    subject: str = ""
    resolved: bool = False


def _btn(text: str, data: str) -> dict[str, str]:
    return {"text": text, "callback_data": data}


def _menu_buttons() -> list[list[dict[str, str]]]:
    return [
        [_btn("💳 Статус пополнения", "sup:dep"), _btn("💸 Статус вывода", "sup:wd")],
        [_btn("❓ Частые вопросы", "sup:faq"), _btn("👤 Позвать оператора", "sup:op")],
    ]


def deposit_status_text(db: Session, deposit: Deposit | None, lang: str = "ru") -> str:
    if deposit is None:
        return "У вас пока нет заявок на пополнение. Нажмите «Пополнить» в основном боте — заявка создаётся за минуту."
    cash = deposit.cash.name if deposit.cash else ""
    head = f"Заявка {deposit.public_id} • {cash} • ID {deposit.player_id}\nСумма: {money(deposit.pay_amount)} {deposit.currency}\nСоздана: {fmt_local(deposit.created_at)}\n\n"
    if deposit.status == "created":
        left = _minutes_left(deposit)
        return head + (f"⏳ Ожидает оплаты. Оплатите ровно {money(deposit.pay_amount)} {deposit.currency} по QR из заявки — осталось {left} мин. Зачисление происходит автоматически сразу после поступления платежа." if left else "⏳ Время оплаты почти истекло. Если вы уже перевели деньги — не создавайте новую заявку, платёж будет найден автоматически.")
    if deposit.status == "processing":
        return head + "⚡ Платёж получен, деньги зачисляются в кассу. Обычно это занимает несколько секунд."
    if deposit.status == "success":
        return head + f"✅ Зачислено {fmt_local(deposit.credited_at)}. Проверьте баланс игрового счёта."
    if deposit.status == "failed":
        return head + "⚠️ Платёж получен, но зачисление в кассу не прошло. Оператор уже уведомлён и зачислит вручную — повторно платить не нужно."
    if deposit.status == "expired":
        return head + "⌛ Время оплаты истекло, заявка закрыта. Если вы всё же перевели деньги по этому QR — напишите «оплатил», оператор проверит платёж. Если нет — просто создайте новую заявку."
    if deposit.status == "cancelled":
        return head + "❌ Заявка отменена." + (f" Причина: {deposit.error}" if deposit.error else "")
    return head + DEPOSIT_LABELS.get(deposit.status, deposit.status)


def withdrawal_status_text(db: Session, w: Withdrawal | None, lang: str = "ru") -> str:
    sla = str(settings_store.get(db, "withdraw_sla_text") or "")
    if w is None:
        return "У вас пока нет заявок на вывод. Чтобы вывести деньги: в кассе букмекера закажите вывод (город Бишкек, адрес ул. OnoiPay 24/7), получите код и отправьте его в основном боте."
    cash = w.cash.name if w.cash else ""
    amount = f"{money(w.amount)} {w.currency}" if money(w.amount) > 0 else "сумма уточняется"
    head = f"Заявка {w.public_id} • {cash} • ID {w.player_id}\nСумма: {amount}\nСоздана: {fmt_local(w.created_at)}\n\n"
    if w.status == "created" and w.needs_attention:
        return head + "⚠️ Заявка требует проверки оператором (касса не вернула сумму). Оператор уведомлён, повторно отправлять код не нужно."
    if w.status == "created":
        return head + f"⏳ Заявка создана и ожидает обработки. {sla} Точное время зависит от очереди — как только оператор выполнит перевод, придёт уведомление."
    if w.status == "processing":
        return head + f"⚙️ Заявка в обработке у оператора. {sla} Уведомление придёт сразу после перевода."
    if w.status == "success":
        return head + f"✅ Вывод выполнен {fmt_local(w.completed_at)}. Деньги отправлены на ваш банковский счёт (по QR из заявки). Если перевод не отображается в банке через 30 минут — сообщите, проверим."
    if w.status == "failed":
        return head + f"⚠️ Вывод не выполнен. {('Причина: ' + w.error) if w.error else 'Оператор уведомлён.'}"
    if w.status == "cancelled":
        return head + "❌ Заявка отменена." + (f" Причина: {w.error}" if w.error else "")
    return head + WITHDRAWAL_LABELS.get(w.status, w.status)


def faq_text(db: Session, name: str, lang: str = "ru") -> str:
    support = str(settings_store.get(db, "support_username") or "")
    if name == "commission":
        return "💸 Комиссия OnoiPay — 0% и на пополнение, и на вывод. Вы платите ровно сумму заявки."
    if name == "limits":
        cashes = db.execute(select(PaymentCash).where(PaymentCash.enabled.is_(True)).order_by(PaymentCash.priority)).scalars().all()
        lines = [f"{c.name}: пополнение от {money(c.deposit_min):.0f} до {money(c.deposit_max):.0f} {c.currency}" for c in cashes]
        return "📏 Лимиты:\n" + ("\n".join(lines) if lines else "лимиты уточняйте у оператора") + "\n\nСумма вывода определяется вашим запросом в кассе букмекера."
    if name == "referral":
        pct = settings_store.get_float(db, "referral_bonus_pct", 1.0)
        return f"🎁 Реферальная программа: приглашайте друзей по ссылке из раздела «Рефералка» в основном боте и получайте {pct:g}% от каждого их пополнения. Баланс можно вывести на ваш QR."
    if name == "cash_info":
        cashes = db.execute(select(PaymentCash).where(PaymentCash.enabled.is_(True)).order_by(PaymentCash.priority)).scalars().all()
        names = ", ".join(c.name for c in cashes) or "уточняйте у оператора"
        return f"🎰 Сейчас работают кассы: {names}. Пополнение и вывод доступны в основном боте кнопками «Пополнить» и «Вывести»."
    if name == "schedule":
        return "🕐 Работаем 24/7. Пополнения зачисляются автоматически, выводы обрабатывают операторы по очереди."
    if name == "greeting":
        return "Здравствуйте! Чем помочь? Напишите вопрос одним сообщением или выберите кнопку ниже."
    if name == "thanks":
        return "Рады помочь! Если появятся вопросы — пишите."
    if name == "instructions":
        return (
            "ℹ️ Кратко:\n"
            "• Пополнить: основной бот → «Пополнить» → касса → ID → сумма → оплатите QR ровно на указанную сумму.\n"
            "• Вывести: в кассе букмекера закажите вывод (город Бишкек, адрес ул. OnoiPay 24/7), получите код → основной бот → «Вывести» → ID → QR банка → код.\n"
            f"• Вопросы: {support}"
        )
    return "Уточните, пожалуйста, вопрос: пополнение, вывод, QR, ID или что-то другое?"


def respond(
    db: Session,
    user: User,
    text: str,
    *,
    media_kind: str = "",
    file_url: str = "",
    telegram_message_id: int = 0,
    callback: str = "",
) -> Reply | None:
    """Full pipeline for one user message. Returns ``None`` when the message must be dropped silently."""
    if user.support_blocked:
        return Reply(f"⛔ Поддержка для вашего аккаунта ограничена.\nПричина: {user.support_block_reason or 'обратитесь к администратору'}", resolved=True)
    flood = check_flood(db, user.telegram_id, text or callback, media=bool(media_kind))
    if not flood.allowed:
        return None if flood.silent else Reply(flood.reply, resolved=True)
    conv = get_or_open_conversation(db, user)
    intent = classify(text) if not callback else Intent(*_callback_intent(callback))
    dedupe = f"tg:{user.telegram_id}:{telegram_message_id}" if telegram_message_id else None
    add_message(db, conv, direction="in", sender="user", text=text or ("[фото]" if media_kind == "photo" else f"[{media_kind}]" if media_kind else ""), kind=media_kind or "text", file_url=file_url, telegram_message_id=telegram_message_id, intent=intent, dedupe_key=dedupe)
    # The operator owns the dialog: forward silently, no automation.
    if conv.status == "operator":
        conv.status = "operator"
        db.flush()
        return None
    reply = _answer(db, user, conv, intent, text, media_kind)
    if reply.escalate:
        _escalate(db, user, conv, reply, text)
    elif conv.status == "waiting_operator":
        # already queued — do not spam the operator with duplicates, still answer from data
        pass
    conv.category = intent.category if intent.category != "faq" or conv.category == "faq" else conv.category
    add_message(db, conv, direction="out", sender="bot", text=reply.text, intent=intent)
    if reply.resolved and conv.status == "auto":
        pass
    db.flush()
    return reply


def _callback_intent(callback: str) -> tuple[str, str, float, str]:
    mapping = {
        "sup:dep": ("deposit", "deposit_status", 1.0, "ru"),
        "sup:wd": ("withdrawal", "withdrawal_status", 1.0, "ru"),
        "sup:faq": ("faq", "instructions", 1.0, "ru"),
        "sup:op": ("operator", "operator", 1.0, "ru"),
        "sup:paid": ("deposit", "deposit_delay", 1.0, "ru"),
        "sup:limits": ("faq", "limits", 1.0, "ru"),
        "sup:commission": ("faq", "commission", 1.0, "ru"),
        "sup:referral": ("faq", "referral", 1.0, "ru"),
        "sup:qr": ("qr", "qr_howto", 1.0, "ru"),
        "sup:howdep": ("deposit", "deposit_howto", 1.0, "ru"),
        "sup:howwd": ("withdrawal", "withdrawal_howto", 1.0, "ru"),
    }
    return mapping.get(callback, ("faq", "unknown", 0.2, "ru"))


def _answer(db: Session, user: User, conv: SupportConversation, intent: Intent, text: str, media_kind: str) -> Reply:
    lang = intent.language
    deposit = latest_deposit(db, user)
    withdrawal = latest_withdrawal(db, user)
    cat, name = intent.category, intent.name
    op_button = [[_btn("👤 Позвать оператора", "sup:op")]]

    if media_kind and not text:
        # A receipt/screenshot without text: attach to the relevant operation and hand over.
        if deposit and deposit.status in {"created", "expired", "failed", "processing"}:
            return Reply(f"📎 Чек получен и прикреплён к заявке {deposit.public_id}. Оператор проверит платёж и зачислит — повторно платить не нужно.", escalate=True, category="deposit", subject=f"Чек по пополнению {deposit.public_id}")
        if withdrawal and withdrawal.status in {"created", "processing", "failed"}:
            return Reply(f"📎 Файл получен и прикреплён к заявке {withdrawal.public_id}. Оператор посмотрит и ответит здесь.", escalate=True, category="withdrawal", subject=f"Файл по выводу {withdrawal.public_id}")
        return Reply("📎 Файл получен. Напишите одним сообщением, с какой заявкой он связан, и я передам оператору.", buttons=_menu_buttons())

    if cat == "operator":
        if name == "complaint":
            return Reply("Понимаю, разберёмся. Передал обращение оператору с историей ваших заявок — ответ придёт в этот чат.", escalate=True, category="operator", subject="Жалоба")
        return Reply("Передал оператору. Он видит ваши заявки и историю — повторять данные не нужно. Ответ придёт в этот чат.", escalate=True, category="operator", subject="Запрос оператора")

    if cat == "withdrawal":
        if name == "withdrawal_howto":
            instr = str(settings_store.get(db, "withdraw_instruction") or "")
            return Reply(instr, buttons=[[_btn("💸 Статус вывода", "sup:wd")]], resolved=True)
        if name == "withdrawal_cancel":
            if withdrawal and withdrawal.status in {"created", "processing"}:
                return Reply(f"Заявка {withdrawal.public_id} ({money(withdrawal.amount)} {withdrawal.currency}) уже принята кассой — код использован. Отменить её самостоятельно нельзя, передал оператору: он свяжется здесь и решит вопрос.", escalate=True, category="withdrawal", subject=f"Отмена вывода {withdrawal.public_id}")
            return Reply(withdrawal_status_text(db, withdrawal, lang), buttons=op_button)
        if name == "withdrawal_code":
            return Reply("Код вывода одноразовый и действует ограниченное время. Если касса пишет «неверный код» — закажите новый вывод в кассе букмекера (город Бишкек, адрес ул. OnoiPay 24/7) и отправьте свежий код в основном боте. Если код уже был принят — смотрите статус ниже.", buttons=[[_btn("💸 Статус вывода", "sup:wd")], *op_button])
        status = withdrawal_status_text(db, withdrawal, lang)
        if withdrawal and withdrawal.status in {"created", "processing"}:
            waiting_hours = (utcnow() - as_utc(withdrawal.created_at)).total_seconds() / 3600
            if name in {"withdrawal_delay", "withdrawal_reasons"} and waiting_hours >= 24:
                return Reply(status + "\n\nЗаявка ждёт дольше обычного — передал оператору для приоритетной проверки.", escalate=True, category="withdrawal", subject=f"Задержка вывода {withdrawal.public_id}")
            if name in {"withdrawal_delay", "withdrawal_reasons"}:
                return Reply(status + "\n\nПричины ожидания: очередь заявок, проверка кассы или банка. Ускорить не получится, но всё под контролем — уведомление придёт автоматически.", buttons=op_button, resolved=True)
            return Reply(status, buttons=op_button, resolved=True)
        if withdrawal and withdrawal.status == "success" and name == "withdrawal_delay":
            return Reply(status + "\n\nЕсли деньги не пришли на банк — передаю оператору для проверки перевода.", escalate=True, category="withdrawal", subject=f"Вывод выполнен, деньги не пришли {withdrawal.public_id}")
        if withdrawal and withdrawal.needs_attention:
            return Reply(status, escalate=True, category="withdrawal", subject=f"Проблемный вывод {withdrawal.public_id}")
        return Reply(status, buttons=op_button if withdrawal else [[_btn("Как вывести", "sup:howwd")]], resolved=True)

    if cat == "deposit":
        if name == "deposit_howto":
            return Reply(faq_text(db, "instructions", lang), buttons=[[_btn("💳 Статус пополнения", "sup:dep")]], resolved=True)
        if name == "deposit_cancel":
            if deposit and deposit.status == "created":
                return Reply(f"Заявка {deposit.public_id} ожидает оплаты. Если вы не переводили деньги — просто нажмите «Отменить» под заявкой в основном боте или дождитесь окончания таймера. Если перевели — не отменяйте, платёж зачислится автоматически.", resolved=True)
            return Reply(deposit_status_text(db, deposit, lang), resolved=True)
        status = deposit_status_text(db, deposit, lang)
        if deposit is None:
            return Reply(status, buttons=[[_btn("Как пополнить", "sup:howdep")]], resolved=True)
        if name in {"deposit_delay", "deposit_error"}:
            if deposit.status == "success":
                return Reply(status + "\n\nЕсли на игровом счёте суммы нет — обновите приложение букмекера. Если всё равно нет, напишите «нет на счёте», передам оператору.", buttons=op_button, resolved=True)
            if deposit.status == "processing":
                return Reply(status, resolved=True)
            if deposit.status == "created":
                minutes = (utcnow() - as_utc(deposit.created_at)).total_seconds() / 60
                if minutes < 3:
                    return Reply(status + "\n\nПлатёж обычно находится в течение 1–2 минут после перевода. Подождите немного — зачисление автоматическое.", resolved=True)
                return Reply(status + "\n\nПлатёж пока не найден. Передал оператору вместе с заявкой — при необходимости пришлите чек в этот чат.", escalate=True, category="deposit", subject=f"Оплатил, не зачислено {deposit.public_id}")
            if deposit.status in {"expired", "failed"}:
                return Reply(status + "\n\nПередал оператору для проверки платежа.", escalate=True, category="deposit", subject=f"Проверка платежа {deposit.public_id}")
            return Reply(status, buttons=op_button, resolved=True)
        return Reply(status, buttons=op_button, resolved=True)

    if cat == "payment":
        if name == "receipt":
            if deposit and deposit.status != "success":
                return Reply(f"Пришлите чек (фото/скриншот) прямо в этот чат — он прикрепится к заявке {deposit.public_id}, и оператор проверит платёж.", resolved=True)
            return Reply("Пришлите чек прямо в этот чат и одним сообщением опишите, к какой заявке он относится.", resolved=True)
        return Reply(deposit_status_text(db, deposit, lang), buttons=op_button, resolved=True)

    if cat == "qr":
        if name == "qr_problem":
            return Reply(
                "Если QR не читается:\n• пришлите QR как фото, не файлом, без обрезки и бликов;\n• в банке используйте «Мой QR» для получения денег (не для оплаты);\n• для пополнения сканируйте QR из заявки приложением банка или нажмите кнопку банка под QR.\n\nЕсли не помогло — пришлите QR сюда, оператор проверит.",
                buttons=op_button, resolved=True,
            )
        return Reply("QR для вывода — это «Мой QR» из приложения вашего банка (MBank, О!Деньги, Bakai, Optima, Balance): раздел QR → получить/мой QR → скриншот. Отправьте его в основном боте при выводе; последний QR сохраняется и предлагается при следующем выводе. Никогда не отправляйте PIN, CVV и пароли.", resolved=True)

    if cat == "currency":
        return Reply("Кассы работают в сомах (KGS). Если валюта вашего игрового аккаунта другая — бот сообщит об этом при вводе ID и попросит другой ID. Заведите аккаунт в KGS или укажите ID счёта в сомах.", buttons=op_button, resolved=True)

    if cat == "account":
        if name == "id_problem":
            return Reply("ID — это номер игрового счёта в букмекере (только цифры). Если бот пишет «ID не найден», проверьте, что ID относится к выбранной кассе, и введите его ещё раз. Если ID точно верный — напишите его сюда, оператор проверит.", buttons=op_button, resolved=True)
        if name == "blocked":
            if user.is_blocked:
                return Reply(f"Ваш аккаунт ограничен. {('Причина: ' + user.block_reason) if user.block_reason else ''} Передал оператору.", escalate=True, category="account", subject="Блокировка аккаунта")
            return Reply("Ваш аккаунт активен, ограничений нет. Если операции не проходят — уточните, какая именно, и я проверю статус.", buttons=_menu_buttons(), resolved=True)
        summary = user_summary(db, user)
        qr = last_qr(db, user)
        return Reply(
            f"👤 Профиль\nTelegram ID: {user.telegram_id}\nUsername: @{user.username or 'не указан'}\nПополнений: {summary['deposits_count']} • Выводов: {summary['withdrawals_count']}\nQR для вывода: {'сохранён (' + (qr.bank_name or 'банк') + ')' if qr else 'не добавлен'}\nE-mail: {user.email + (' ✅' if user.email_verified_at else ' (не подтверждён)') if user.email else 'не привязан'}\n\nИстория заявок и настройки — в разделе «Профиль» основного бота.",
            resolved=True,
        )

    if cat == "verification":
        if name == "email":
            return Reply("Привязать и подтвердить e-mail можно в основном боте: «Профиль» → «E-mail». Код приходит на почту в течение минуты; если письма нет — проверьте «Спам» и запросите код повторно через 60 секунд.", resolved=True)
        if name == "phone":
            return Reply("Номер телефона подтверждается кнопкой «Поделиться контактом» в основном боте, если это требуется. Отдельно отправлять номер в чат не нужно.", resolved=True)
        return Reply("Верификация личности для операций не требуется. Достаточно ID игрового счёта и QR вашего банка для вывода.", resolved=True)

    if cat == "technical":
        return Reply(
            "Если бот не отвечает или кнопки не срабатывают:\n1) нажмите /start в основном боте — меню обновится;\n2) проверьте интернет и версию Telegram;\n3) не нажимайте кнопку несколько раз подряд — каждое нажатие обрабатывается один раз.\n\nЕсли проблема повторяется — опишите, что именно не работает, и передам оператору.",
            buttons=op_button, resolved=True,
        )

    # faq
    if name == "unknown" or name == "empty":
        return Reply("Не совсем понял вопрос. Выберите тему кнопкой ниже или опишите ситуацию одним сообщением (например: «оплатил, не зачислено» или «когда будет вывод»).", buttons=_menu_buttons())
    return Reply(faq_text(db, name, lang), buttons=_menu_buttons() if name in {"greeting", "instructions"} else [], resolved=True)


def _escalate(db: Session, user: User, conv: SupportConversation, reply: Reply, text: str) -> None:
    conv.category = reply.category or conv.category
    conv.subject = (reply.subject or conv.subject or text[:120])[:200]
    conv.context = build_context(db, user)
    fresh = conv.status != "waiting_operator"
    conv.status = "waiting_operator"
    conv.escalated_at = conv.escalated_at or utcnow()
    conv.priority = "high" if conv.category in {"withdrawal", "deposit", "operator"} else "normal"
    db.flush()
    if fresh and escalation_allowed(db, user.telegram_id):
        ctx = conv.context
        lines = [f"{display_name(user)} (@{user.username or '—'}) • TG {user.telegram_id}", f"Тема: {conv.subject}"]
        if ctx.get("withdrawal"):
            w = ctx["withdrawal"]
            lines.append(f"Вывод {w['public_id']} • {w['status_label']} • {w['amount']} {w['currency']} • {w['cash']}")
        if ctx.get("deposit"):
            d = ctx["deposit"]
            lines.append(f"Пополнение {d['public_id']} • {d['status_label']} • {d['amount']} {d['currency']} • {d['cash']}")
        admin_event(db, "support_operator", f"support_operator:{conv.id}:{int(utcnow().timestamp() // 300)}", "💬 Нужен оператор", "\n".join(lines), {"conversation_id": conv.id, "url": f"#/support/{conv.id}"}, level="critical")
        log_event(db, "Обращение передано оператору", f"{display_name(user)} • {conv.subject}", category="support", entity_type="support", entity_id=conv.id)


# ------------------------------------------------------------------- operator side

def operator_reply(db: Session, conv: SupportConversation, admin_id: int | None, admin_name: str, text: str, *, photo_url: str = "") -> SupportMessage:
    user = db.get(User, conv.user_id)
    msg = add_message(db, conv, direction="out", sender="operator", text=text, admin_id=admin_id, kind="photo" if photo_url else "text", file_url=photo_url)
    conv.status = "operator"
    conv.assigned_admin_id = admin_id or conv.assigned_admin_id
    conv.unread_count = 0
    db.flush()
    notify_user(db, user, event="support_reply", event_key=f"support_reply:{msg.id}", text=text, data={"conversation_id": conv.id, "message_id": msg.id}, bot="support", photo_url=photo_url)
    return msg


def resolve_conversation(db: Session, conv: SupportConversation, admin_id: int | None, *, note: str = "", notify: bool = True) -> None:
    conv.status = "resolved"
    conv.resolved_at = utcnow()
    conv.assigned_admin_id = admin_id or conv.assigned_admin_id
    conv.unread_count = 0
    db.flush()
    if notify:
        user = db.get(User, conv.user_id)
        notify_user(db, user, event="support_resolved", event_key=f"support_resolved:{conv.id}:{int(utcnow().timestamp())}", text=(note or "✅ Обращение закрыто. Если вопрос остался — напишите ещё раз.") + "\n\nОцените поддержку: отправьте цифру от 1 до 5.", data={"conversation_id": conv.id, "rating_prompt": True}, bot="support")
    log_event(db, "Обращение закрыто", f"#{conv.id}", category="support", entity_type="support", entity_id=conv.id)


def apply_rating(db: Session, user: User, rating: int) -> bool:
    conv = db.execute(
        select(SupportConversation).where(SupportConversation.user_id == user.id, SupportConversation.status == "resolved", SupportConversation.rating.is_(None)).order_by(SupportConversation.id.desc())
    ).scalars().first()
    if conv is None or not (1 <= rating <= 5):
        return False
    conv.rating = rating
    db.flush()
    return True


def auto_resolve_idle(db: Session) -> int:
    hours = settings_store.get_int(db, "support_auto_resolve_hours", 48)
    if hours <= 0:
        return 0
    cutoff = utcnow() - timedelta(hours=hours)
    rows = db.execute(
        select(SupportConversation).where(SupportConversation.status.in_(("auto", "operator")), SupportConversation.last_message_at < cutoff)
    ).scalars().all()
    for conv in rows:
        conv.status = "resolved"
        conv.resolved_at = utcnow()
    db.flush()
    return len(rows)


def public_conversation(conv: SupportConversation, *, with_context: bool = False) -> dict[str, Any]:
    user = conv.user
    out = {
        "id": conv.id,
        "status": conv.status,
        "category": conv.category,
        "subject": conv.subject,
        "priority": conv.priority,
        "user_id": conv.user_id,
        "telegram_id": user.telegram_id if user else 0,
        "user_name": display_name(user) if user else "",
        "username": user.username if user else "",
        "unread_count": conv.unread_count,
        "assigned_admin_id": conv.assigned_admin_id,
        "deposit_id": conv.deposit_id,
        "withdrawal_id": conv.withdrawal_id,
        "rating": conv.rating,
        "created_at": iso(conv.created_at),
        "updated_at": iso(conv.updated_at),
        "last_message_at": iso(conv.last_message_at),
        "escalated_at": iso(conv.escalated_at),
        "resolved_at": iso(conv.resolved_at),
    }
    if with_context:
        out["context"] = conv.context or {}
    return out


def public_message(msg: SupportMessage) -> dict[str, Any]:
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "direction": msg.direction,
        "sender": msg.sender,
        "admin_id": msg.admin_id,
        "kind": msg.kind,
        "text": msg.text,
        "file_url": msg.file_url,
        "intent": msg.intent,
        "confidence": float(msg.confidence or 0),
        "created_at": iso(msg.created_at),
    }
