"""Claude-powered first line of support.

The model talks to the client from real data (the statuses of their own requests),
fixes what a person would fix by hand — credits a bank payment that arrived for an
expired / failed request, retries a failed credit — and hands the rest to an operator
with a one-line summary. Without ``ANTHROPIC_API_KEY`` (or when the API is down) the
rule-based answers in ``support.py`` are used, so the bot never goes silent.
"""
from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import transaction
from ..models import Deposit, PaymentCash, PaymentEvent, SupportConversation, SupportMessage, User, Withdrawal
from ..utils import as_utc, fmt_local, money, utcnow
from . import settings_store
from .deposits import STATUS_LABELS as DEPOSIT_LABELS
from .users import display_name, user_summary
from .withdrawals import STATUS_LABELS as WITHDRAWAL_LABELS

logger = logging.getLogger("paygo.assistant")

MAX_HISTORY = 14
MAX_TOOL_ROUNDS = 5
MAX_TOKENS = 700
_CLIENT: Any = None
_CLIENT_LOCK = threading.Lock()

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_client_requests",
        "description": "Последние заявки клиента: пополнения и выводы со статусами, суммами, временем, ошибками и найденными платежами банка. Вызывай перед любым ответом о заявке, оплате, зачислении или выводе.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False, "required": []},
        "strict": True,
    },
    {
        "name": "credit_found_payment",
        "description": "Ищет платёж банка на сумму заявки на пополнение (пришедший, но не привязанный к заявке) и зачисляет её. Используй, когда клиент оплатил, а зачисления нет (статус «ожидает оплаты», «истекло» или «ошибка»).",
        "input_schema": {"type": "object", "properties": {"request_id": {"type": "string", "description": "Номер заявки, например D-260907-AB12CD"}}, "required": ["request_id"], "additionalProperties": False},
        "strict": True,
    },
    {
        "name": "retry_deposit_credit",
        "description": "Повторяет зачисление в кассу для заявки со статусом «ошибка» (платёж получен, касса не зачислила).",
        "input_schema": {"type": "object", "properties": {"request_id": {"type": "string"}}, "required": ["request_id"], "additionalProperties": False},
        "strict": True,
    },
    {
        "name": "escalate_to_operator",
        "description": "Передаёт диалог живому оператору с кратким описанием проблемы. Используй для жалоб, споров о деньгах, задержки вывода больше суток, блокировок, чеков без найденного платежа и всего, что требует действий человека.",
        "input_schema": {"type": "object", "properties": {"summary": {"type": "string", "description": "Суть проблемы одной строкой для оператора"}, "priority": {"type": "string", "enum": ["normal", "high"]}}, "required": ["summary", "priority"], "additionalProperties": False},
        "strict": True,
    },
]


@dataclass
class Outcome:
    text: str
    escalate: bool = False
    subject: str = ""
    priority: str = "normal"
    tools: list[str] = field(default_factory=list)


def enabled(db: Session) -> bool:
    return bool(get_settings().anthropic_api_key) and settings_store.get_bool(db, "assistant_enabled", True)


def _client() -> Any:
    """One SDK client per process (keep-alive); the key comes only from the environment."""
    global _CLIENT
    import anthropic

    with _CLIENT_LOCK:
        if _CLIENT is None:
            _CLIENT = anthropic.Anthropic(api_key=get_settings().anthropic_api_key, timeout=35.0, max_retries=1)
        return _CLIENT


def reset_client() -> None:
    global _CLIENT
    with _CLIENT_LOCK:
        _CLIENT = None


# --------------------------------------------------------------------------- prompt

def system_prompt(db: Session) -> str:
    """Stable business facts (cached by the API across calls): brand, cash desks, limits, how-to."""
    from .bot_texts import instruction, strip_html

    brand = str(settings_store.get(db, "brand_name") or "PayGo")
    cashes = db.execute(select(PaymentCash).where(PaymentCash.enabled.is_(True)).order_by(PaymentCash.priority)).scalars().all()
    lines = [f"{c.name}: пополнение от {money(c.deposit_min):.0f} до {money(c.deposit_max):.0f} {c.currency}" + ("" if c.deposit_enabled else " (пополнения сейчас выключены)") + ("" if c.withdraw_enabled else " (выводы сейчас выключены)") for c in cashes]
    sla = str(settings_store.get(db, "withdraw_sla_text") or "")
    support = str(settings_store.get(db, "support_username") or "")
    return (
        f"Ты — оператор поддержки сервиса {brand}: Telegram-бот для пополнения игровых счетов букмекеров и вывода выигрышей (Кыргызстан, валюта сом KGS). "
        "Отвечай коротко (до 6 строк), по-человечески, на языке клиента (русский или кыргызский), без markdown и без упоминания, что ты ИИ. Не повторяй вопрос клиента, не извиняйся по несколько раз.\n\n"
        "Факты о сервисе:\n"
        f"• Кассы и лимиты: {'; '.join(lines) if lines else 'уточняй у оператора'}. Комиссия 0%.\n"
        "• Пополнение: основной бот → «Пополнить» → касса → ID игрового счёта → сумма → оплата ровно указанной суммы (с тыйынами) по QR любым банком Кыргызстана. Зачисление автоматическое, обычно 1–2 минуты после платежа; заявка ждёт оплаты 5 минут, потом закрывается, но платёж по ней всё равно находится.\n"
        f"• Вывод: {strip_html(instruction(db))}\n"
        f"• Сроки вывода: {sla or 'зависят от очереди'}. Точное время никогда не обещай.\n"
        f"• Поддержка 24/7, контакт оператора: {support}.\n\n"
        "Как работать:\n"
        "1. Если речь о заявке, оплате, зачислении или выводе — сначала вызови get_client_requests и отвечай только по этим данным. Никогда не выдумывай номера заявок, суммы и статусы.\n"
        "2. «Оплатил, не зачислено»: для заявки со статусом «ожидает оплаты», «истекло» или «ошибка» вызови credit_found_payment. Если платёж найден и зачислен — сообщи клиенту. Если не найден — попроси прислать чек (фото) прямо сюда и передай оператору через escalate_to_operator с описанием (номер заявки, сумма, время).\n"
        "3. Статус «ошибка» (платёж есть, касса не зачислила) — retry_deposit_credit; если снова ошибка — оператору.\n"
        "4. Вывод ждёт дольше 24 часов, деньги по выполненному выводу не пришли, жалобы, споры, блокировка, смена данных — escalate_to_operator. Клиенту скажи, что оператор ответит здесь же.\n"
        "5. Фото или файл без текста — это чек или QR: вызови get_client_requests, попробуй credit_found_payment для последней открытой заявки; если не помогло — оператору с пометкой «пришёл чек».\n"
        "6. Никогда не проси PIN, CVV, пароли и коды из SMS. Не давай советов по ставкам. Не обсуждай другие сервисы.\n"
        "7. Простые вопросы (комиссия, лимиты, как пополнить, как вывести, график) — отвечай сразу из фактов выше без инструментов."
    )


def client_context(db: Session, user: User) -> str:
    summary = user_summary(db, user)
    return (
        f"Клиент: {display_name(user)} (Telegram ID {user.telegram_id}, @{user.username or '—'}), язык: {'кыргызский' if user.language == 'kg' else 'русский'}. "
        f"Пополнений: {summary['deposits_count']}, выводов: {summary['withdrawals_count']}, QR для вывода {'сохранён' if summary['has_qr'] else 'не добавлен'}."
        + (f" Аккаунт ограничен: {user.block_reason or 'без причины'}." if user.is_blocked else "")
        + f" Сейчас {fmt_local(utcnow())}."
    )


def history(db: Session, conv: SupportConversation, current_text: str) -> list[dict[str, Any]]:
    """Recent turns of the dialog as API messages; the client's message is always last."""
    from .support import media_label

    rows = db.execute(select(SupportMessage).where(SupportMessage.conversation_id == conv.id, SupportMessage.deleted_at.is_(None)).order_by(SupportMessage.id.desc()).limit(MAX_HISTORY)).scalars().all()
    messages: list[dict[str, Any]] = []
    for m in reversed(rows):
        text = (m.text or media_label(m.kind) or "").strip()
        if not text:
            continue
        role = "user" if m.direction == "in" else "assistant"
        if m.sender == "operator":
            text = "[оператор] " + text
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n" + text[:600]
        else:
            messages.append({"role": role, "content": text[:600]})
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": (current_text or "[файл]")[:600]})
    return messages


# ---------------------------------------------------------------------------- tools

def _deposit_row(db: Session, user: User, request_id: str) -> Deposit | None:
    key = str(request_id or "").strip().upper()
    if not key:
        return None
    return db.execute(select(Deposit).where(Deposit.user_id == user.id, Deposit.public_id.ilike(f"%{key.replace('D-', '')}%")).order_by(Deposit.id.desc())).scalars().first()


def tool_get_client_requests(db: Session, user: User) -> dict[str, Any]:
    now = utcnow()
    deposits = db.execute(select(Deposit).where(Deposit.user_id == user.id).order_by(Deposit.id.desc()).limit(4)).scalars().all()
    withdrawals = db.execute(select(Withdrawal).where(Withdrawal.user_id == user.id).order_by(Withdrawal.id.desc()).limit(4)).scalars().all()
    out: dict[str, Any] = {"deposits": [], "withdrawals": [], "now": fmt_local(now)}
    for d in deposits:
        item: dict[str, Any] = {
            "request_id": d.public_id, "status": d.status, "status_label": DEPOSIT_LABELS.get(d.status, d.status), "amount": str(money(d.pay_amount)), "currency": d.currency,
            "cash": d.cash.name if d.cash else "", "player_id": d.player_id, "created_at": fmt_local(d.created_at), "error": d.error or "",
            "receipt_sent": bool(d.receipt_file), "credited_at": fmt_local(d.credited_at) if d.credited_at else "",
        }
        if d.status == "created" and d.expires_at:
            item["minutes_left_to_pay"] = max(0, int((as_utc(d.expires_at) - now).total_seconds() // 60))
        if d.status in {"created", "expired", "failed"}:
            found = _payment_for(db, d)
            item["bank_payment_found"] = bool(found)
            if found:
                item["bank_payment"] = {"amount": str(money(found.amount)), "received_at": fmt_local(found.received_at), "source": found.source}
        out["deposits"].append(item)
    for w in withdrawals:
        hours = (now - as_utc(w.created_at)).total_seconds() / 3600 if w.created_at else 0
        out["withdrawals"].append({
            "request_id": w.public_id, "status": w.status, "status_label": WITHDRAWAL_LABELS.get(w.status, w.status), "amount": str(money(w.amount)) if money(w.amount) > 0 else "уточняется",
            "currency": w.currency, "cash": w.cash.name if w.cash else "", "player_id": w.player_id, "created_at": fmt_local(w.created_at), "hours_waiting": round(hours, 1),
            "completed_at": fmt_local(w.completed_at) if w.completed_at else "", "error": w.error or "", "needs_operator_check": bool(w.needs_attention), "deferred": bool(w.deferred),
        })
    return out


def _payment_for(db: Session, deposit: Deposit) -> PaymentEvent | None:
    """A bank confirmation with the request's exact amount that never got matched (last 48 h)."""
    since = utcnow() - timedelta(hours=48)
    return db.execute(
        select(PaymentEvent).where(PaymentEvent.amount == money(deposit.pay_amount), PaymentEvent.status.in_(("unmatched", "received", "failed")), PaymentEvent.received_at >= since).order_by(PaymentEvent.id.desc())
    ).scalars().first()


def tool_credit_found_payment(user_id: int, request_id: str) -> dict[str, Any]:
    from .deposits import credit_deposit

    with transaction() as db:
        user = db.get(User, user_id)
        deposit = _deposit_row(db, user, request_id) if user else None
        if deposit is None:
            return {"ok": False, "message": "заявка не найдена"}
        if deposit.status == "success":
            return {"ok": True, "message": "заявка уже зачислена", "request_id": deposit.public_id}
        if deposit.status not in {"created", "expired", "failed"}:
            return {"ok": False, "message": f"заявка в статусе {DEPOSIT_LABELS.get(deposit.status, deposit.status)}"}
        event = _payment_for(db, deposit)
        if event is None:
            return {"ok": False, "message": "платёж банка на эту сумму не найден — нужен чек, передай оператору", "request_id": deposit.public_id}
        event.status = "processing"
        event.deposit_id = deposit.id
        deposit_id, event_id, source = deposit.id, event.id, event.source
    result = credit_deposit(deposit_id, source=source, event_id=event_id, actor="assistant")
    return {"ok": bool(result.get("ok")), "message": "зачислено" if result.get("ok") else str(result.get("message") or "ошибка кассы"), "request_id": result.get("request_id") or request_id}


def tool_retry_deposit_credit(user_id: int, request_id: str) -> dict[str, Any]:
    from .deposits import credit_deposit

    with transaction() as db:
        user = db.get(User, user_id)
        deposit = _deposit_row(db, user, request_id) if user else None
        if deposit is None:
            return {"ok": False, "message": "заявка не найдена"}
        if deposit.status != "failed":
            return {"ok": False, "message": f"повтор возможен только для статуса «ошибка», сейчас {DEPOSIT_LABELS.get(deposit.status, deposit.status)}"}
        deposit_id, event_id = deposit.id, deposit.payment_event_id
    result = credit_deposit(deposit_id, source="retry", event_id=event_id, actor="assistant")
    return {"ok": bool(result.get("ok")), "message": "зачислено" if result.get("ok") else str(result.get("message") or "ошибка кассы")}


# ----------------------------------------------------------------------------- run

def answer(db: Session, user: User, conv: SupportConversation, text: str, *, media_kind: str = "") -> Outcome | None:
    """Ask the model (with tools) for the reply to the client's latest message. ``None`` → use the rules."""
    import anthropic

    settings = get_settings()
    current = (text or "").strip() or (f"[клиент прислал {media_kind or 'файл'} без текста]")
    messages = history(db, conv, current)
    system = [
        {"type": "text", "text": system_prompt(db), "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": client_context(db, user)},
    ]
    outcome = Outcome(text="")
    client = _client()
    try:
        for _round in range(MAX_TOOL_ROUNDS):
            response = client.messages.create(
                model=settings.assistant_model or "claude-opus-5",
                max_tokens=MAX_TOKENS,
                system=system,
                messages=messages,
                tools=TOOLS,
                output_config={"effort": "low"},
            )
            if response.stop_reason == "refusal":
                logger.info("assistant refused (%s)", getattr(response, "stop_details", None))
                return None
            text_parts = [b.text for b in response.content if getattr(b, "type", "") == "text"]
            uses = [b for b in response.content if getattr(b, "type", "") == "tool_use"]
            if not uses:
                outcome.text = "\n".join(t.strip() for t in text_parts if t.strip()).strip()
                break
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for use in uses:
                result = _run_tool(db, user, conv, use.name, dict(use.input or {}), outcome)
                results.append({"type": "tool_result", "tool_use_id": use.id, "content": json.dumps(result, ensure_ascii=False)})
            messages.append({"role": "user", "content": results})
        else:
            outcome.text = outcome.text or "Передал вопрос оператору — он ответит здесь."
            outcome.escalate = True
            outcome.subject = outcome.subject or (current[:120])
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APITimeoutError) as exc:
        logger.warning("assistant unavailable: %s", exc)
        return None
    except anthropic.APIStatusError as exc:
        logger.warning("assistant API error %s: %s", exc.status_code, exc.message)
        return None
    except Exception:
        logger.exception("assistant failed")
        return None
    if not outcome.text:
        return None
    return outcome


def _run_tool(db: Session, user: User, conv: SupportConversation, name: str, args: dict[str, Any], outcome: Outcome) -> dict[str, Any]:
    outcome.tools.append(name)
    try:
        if name == "get_client_requests":
            return tool_get_client_requests(db, user)
        if name == "credit_found_payment":
            db.commit()  # money moves in its own transactions; nothing of ours may stay locked
            return tool_credit_found_payment(user.id, str(args.get("request_id") or ""))
        if name == "retry_deposit_credit":
            db.commit()
            return tool_retry_deposit_credit(user.id, str(args.get("request_id") or ""))
        if name == "escalate_to_operator":
            outcome.escalate = True
            outcome.subject = str(args.get("summary") or "")[:120]
            outcome.priority = "high" if str(args.get("priority") or "") == "high" else "normal"
            return {"ok": True, "message": "передано оператору, он ответит в этом чате"}
    except Exception as exc:
        logger.exception("assistant tool %s failed", name)
        return {"ok": False, "message": f"инструмент недоступен: {str(exc)[:120]}"}
    return {"ok": False, "message": "неизвестный инструмент"}
