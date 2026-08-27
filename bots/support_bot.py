#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import re
import sqlite3
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from common import cfg, api, tg, send, send_photo

BASE = Path(__file__).resolve().parents[1]
DB = BASE / "data" / "support_bot.sqlite3"


def token():
    return str(cfg().get("support_bot", {}).get("token", ""))


def reopen_hint():
    return cfg().get("support_bot", {}).get(
        "reopen_hint",
        "Чтобы создать новое обращение, нажмите /start.",
    )


def conn():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    return c


with conn() as c:
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT);
        CREATE TABLE IF NOT EXISTS support_flow(
          chat_id INTEGER PRIMARY KEY,
          step TEXT DEFAULT '',
          issue_kind TEXT DEFAULT '',
          transaction_id INTEGER,
          issue_type TEXT DEFAULT '',
          updated_at TEXT
        );
        """
    )


def get_meta(k, default="0"):
    with conn() as c:
        r = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r[0] if r else default


def set_meta(k, v):
    with conn() as c:
        c.execute(
            "INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            (k, str(v)),
        )


def flow_get(cid):
    with conn() as c:
        r = c.execute("SELECT * FROM support_flow WHERE chat_id=?", (int(cid),)).fetchone()
    return dict(r) if r else {"chat_id": int(cid), "step": "", "issue_kind": "", "transaction_id": None, "issue_type": ""}


def flow_set(cid, **fields):
    current = flow_get(cid)
    current.update(fields)
    with conn() as c:
        c.execute(
            """
            INSERT INTO support_flow(chat_id,step,issue_kind,transaction_id,issue_type,updated_at)
            VALUES(?,?,?,?,?,datetime('now'))
            ON CONFLICT(chat_id) DO UPDATE SET
              step=excluded.step,issue_kind=excluded.issue_kind,
              transaction_id=excluded.transaction_id,issue_type=excluded.issue_type,
              updated_at=excluded.updated_at
            """,
            (
                int(cid), str(current.get("step") or ""), str(current.get("issue_kind") or ""),
                current.get("transaction_id"), str(current.get("issue_type") or ""),
            ),
        )


def flow_clear(cid):
    with conn() as c:
        c.execute("DELETE FROM support_flow WHERE chat_id=?", (int(cid),))


def kb(rows):
    return {"inline_keyboard": rows}


def btn(text, data):
    return {"text": text, "callback_data": data}


def send_menu(cid, text, rows):
    return tg(
        token(),
        "sendMessage",
        {
            "chat_id": int(cid),
            "text": text,
            "reply_markup": json.dumps(kb(rows), ensure_ascii=False),
        },
    )


def answer_cb(cb_id, text=""):
    try:
        tg(token(), "answerCallbackQuery", {"callback_query_id": cb_id, "text": text[:180]})
    except Exception:
        pass


def status_label(status):
    s = str(status or "").lower()
    if s in {"success", "credited", "paid", "completed"}: return "✅"
    if s in {"problem", "error", "provider_error", "failed"}: return "⚠️"
    if s in {"cancelled", "rejected", "expired"}: return "✖️"
    return "⏳"


def fmt_tx_button(x):
    amount = float(x.get("amount") or 0)
    bk = str(x.get("bookmaker") or "").upper()
    no = x.get("request_no") or x.get("row_id")
    icon = status_label(x.get("status"))
    return f"{icon} #{no} • {bk} • {amount:.2f} сом"


def show_kind_menu(cid, extra=False):
    flow_clear(cid)
    try:
        status = api(f"/bot/support-status/{cid}", timeout=5)
        if bool(status.get("support_blocked")):
            reason = str(status.get("support_block_reason") or "Доступ к поддержке ограничен.")
            send(token(), cid, f"⛔ Поддержка для вашего аккаунта ограничена.\n\nПричина: {reason}")
            return
        if int(status.get("open_cases") or 0) > 0:
            send(token(), cid, "⏳ У вас уже есть активное обращение. Дождитесь решения оператора — после закрытия можно будет создать новое.")
            return
    except Exception:
        pass
    dep = wd = None
    try:
        r = api(f"/bot/support-overview/{cid}", timeout=5)
        counts = r.get("counts") or {}
        dep = int(counts.get("deposit") or 0)
        wd = int(counts.get("withdraw") or 0)
    except Exception:
        pass
    dep_text = f"💳 Пополнение • {dep}" if dep is not None else "💳 Пополнение"
    wd_text = f"💸 Вывод • {wd}" if wd is not None else "💸 Вывод"
    send_menu(
        cid,
        "Выберите операцию, по которой нужна помощь:",
        [[btn(dep_text, "sup:k:d"), btn(wd_text, "sup:k:w")], [btn("💬 Другой вопрос", "sup:ai")]],
    )


def show_transactions(cid, kind, offset=0):
    short = "d" if kind == "deposit" else "w"
    title = "пополнение" if kind == "deposit" else "вывод"
    r = api(f"/bot/support-transactions/{cid}?kind={kind}&offset={int(offset)}&limit=6", timeout=6)
    items = r.get("items") or []
    if not items:
        send_menu(
            cid,
            f"У вас пока нет заявок на {title}.",
            [[btn("← Назад", "sup:home")]],
        )
        return
    rows = [[btn(fmt_tx_button(x), f"sup:t:{short}:{int(x['row_id'])}")] for x in items]
    nav = []
    if int(offset) > 0:
        nav.append(btn("← Новее", f"sup:l:{short}:{max(0,int(offset)-6)}"))
    if r.get("has_more"):
        nav.append(btn("Старее →", f"sup:l:{short}:{int(offset)+6}"))
    if nav: rows.append(nav)
    rows.append([btn("← К выбору операции", "sup:home")])
    send_menu(cid, f"Выберите нужную заявку на {title}:", rows)


MEDIA_LIMIT_MB = {"photo": 12, "voice": 20, "audio": 25, "video": 64, "video_note": 32, "document": 25}


def pick_media(m):
    """Возвращает (file_id, тип). Клиенту разрешены фото, голосовые, видео,
    кружки и картинки, присланные файлом."""
    if m.get("photo"):
        return m["photo"][-1]["file_id"], "photo"
    for key in ("voice", "video_note", "video", "audio", "animation"):
        obj = m.get(key)
        if isinstance(obj, dict) and obj.get("file_id"):
            return obj["file_id"], ("video" if key == "animation" else key)
    doc = m.get("document")
    if isinstance(doc, dict) and doc.get("file_id"):
        mime = str(doc.get("mime_type") or "").lower()
        if mime.startswith("image/"):
            return doc["file_id"], "photo"
        if mime.startswith("video/"):
            return doc["file_id"], "video"
        if mime.startswith("audio/"):
            return doc["file_id"], "audio"
    return "", ""


def submit_case_event(cid, m, flow, file_url="", issue_text="", media_kind=""):
    api(
        "/bot/events",
        "POST",
        {
            "event": "support_message",
            "chat_id": int(cid),
            "user": m.get("from", {}),
            "message": m,
            "file_url": file_url,
            "media_kind": media_kind or ("photo" if file_url else ""),
            "support_case": {
                "issue_kind": flow.get("issue_kind"),
                "issue_type": flow.get("issue_type"),
                "transaction_id": flow.get("transaction_id"),
                "issue_text": issue_text,
            },
        },
        timeout=10,
    )


def finalize_no_file(cid, m, flow, text):
    synthetic = {
        "message_id": int(m.get("message_id") or 0),
        "text": text,
        "chat": m.get("chat", {"id": cid}),
        "from": m.get("from", {}),
    }
    submit_case_event(cid, synthetic, flow, issue_text=text)
    flow_clear(cid)
    send(token(), cid, "✅ Обращение отправлено оператору. Ответ придёт сюда.")


def ask_ai(cid, text="", file_url=""):
    try:
        return api(
            "/bot/ai-support/respond",
            "POST",
            {"chat_id": int(cid), "text": str(text or ""), "file_url": str(file_url or "")},
            timeout=18,
        )
    except Exception:
        return {"ok": False, "handled": False, "error": "ai_unavailable"}


def ai_route_message(cid, m, text, file_url, result, media_kind=""):
    """Return True when the AI result fully handled/routed this message."""
    if not isinstance(result, dict) or not result.get("handled"):
        return False
    route = str(result.get("route") or "reply")
    answer = str(result.get("answer") or "").strip()
    txid = result.get("transaction_row_id")
    try: txid = int(txid) if txid not in (None, "") else None
    except Exception: txid = None
    if answer:
        send(token(), cid, answer)
    if result.get("close"):
        flow_clear(cid)
        return True
    if route == "reply":
        return True
    if route == "deposit":
        if txid and file_url:
            flow = {"issue_kind":"deposit","issue_type":"deposit_receipt","transaction_id":txid}
            try:
                submit_case_event(cid, m, flow, file_url=file_url, issue_text="Чек по пополнению", media_kind="photo")
                flow_clear(cid)
                send(token(), cid, "✅ Чек и заявка переданы оператору. Ответ придёт сюда.")
            except Exception:
                flow_set(cid, step="wait_deposit_receipt", issue_kind="deposit", transaction_id=txid, issue_type="deposit_receipt")
                send(token(), cid, "Не удалось передать фото. Отправьте чек ещё раз.")
            return True
        if txid:
            flow_set(cid, step="wait_deposit_receipt", issue_kind="deposit", transaction_id=txid, issue_type="deposit_receipt")
            send_menu(cid, "Прикрепите фотографию чека по этой заявке.", [[btn("← Выбрать другую заявку", "sup:k:d")]])
        else:
            flow_set(cid, step="choose_tx", issue_kind="deposit", transaction_id=None, issue_type="")
            show_transactions(cid, "deposit", 0)
        return True
    if route == "withdraw":
        if txid:
            flow_set(cid, step="choose_withdraw_problem", issue_kind="withdraw", transaction_id=txid, issue_type="")
            send_menu(cid, "Что произошло с выводом?", [
                [btn("🔄 Отправить новый QR", "sup:w:qr")],
                [btn("💸 Вывод не получил", "sup:w:no")],
                [btn("✍️ Другая проблема", "sup:w:other")],
                [btn("← Выбрать другой вывод", "sup:k:w")],
            ])
        else:
            flow_set(cid, step="choose_tx", issue_kind="withdraw", transaction_id=None, issue_type="")
            show_transactions(cid, "withdraw", 0)
        return True
    if route == "operator":
        try:
            api(
                "/bot/events", "POST",
                {"event":"support_message","chat_id":int(cid),"user":m.get("from",{}),"message":m,"file_url":file_url,"media_kind":media_kind},
                timeout=10,
            )
        except Exception:
            pass
        flow_clear(cid)
        return True
    return True


def on_callback(q):
    cid = int((q.get("message") or {}).get("chat", {}).get("id") or (q.get("from") or {}).get("id") or 0)
    if not cid: return
    data = str(q.get("data") or "")
    cbid = str(q.get("id") or "")
    status = api(f"/bot/support-status/{cid}", timeout=5)
    answer_cb(cbid)
    if bool(status.get("support_blocked")):
        reason=str(status.get("support_block_reason") or "Доступ к поддержке ограничен")
        answer_cb(cbid, reason)
        send(token(), cid, f"⛔ Поддержка для вашего аккаунта ограничена.\n\nПричина: {reason}")
        flow_clear(cid)
        return
    if int(status.get("open_cases") or 0)>0 and data not in {"sup:home"}:
        answer_cb(cbid, "Сначала дождитесь решения текущего обращения")
        send(token(), cid, "⏳ Сначала дождитесь решения текущего обращения. После закрытия можно будет выбрать другую заявку.")
        flow_clear(cid)
        return
    if data == "sup:home":
        show_kind_menu(cid); return
    if data == "sup:ai":
        flow_set(cid, step="ai_question", issue_kind="", transaction_id=None, issue_type="")
        send_menu(
            cid,
            "Напишите вопрос одним сообщением. Можно на русском или кыргызском. Если есть чек — отправьте фото с подписью или сразу после вопроса.",
            [[btn("← Назад", "sup:home")]],
        )
        return
    m = re.fullmatch(r"sup:k:([dw])", data)
    if m:
        kind = "deposit" if m.group(1) == "d" else "withdraw"
        flow_set(cid, step="choose_tx", issue_kind=kind, transaction_id=None, issue_type="")
        show_transactions(cid, kind, 0); return
    m = re.fullmatch(r"sup:l:([dw]):(\d+)", data)
    if m:
        kind = "deposit" if m.group(1) == "d" else "withdraw"
        show_transactions(cid, kind, int(m.group(2))); return
    m = re.fullmatch(r"sup:t:([dw]):(\d+)", data)
    if m:
        kind = "deposit" if m.group(1) == "d" else "withdraw"
        txid = int(m.group(2))
        if kind == "deposit":
            flow_set(cid, step="wait_deposit_receipt", issue_kind="deposit", transaction_id=txid, issue_type="deposit_receipt")
            send_menu(
                cid,
                "Прикрепите фотографию чека по выбранному пополнению. После фото обращение сразу попадёт оператору.",
                [[btn("← Выбрать другую заявку", "sup:k:d")]],
            )
        else:
            flow_set(cid, step="choose_withdraw_problem", issue_kind="withdraw", transaction_id=txid, issue_type="")
            send_menu(
                cid,
                "Что произошло с выводом?",
                [
                    [btn("🔄 Отправить новый QR", "sup:w:qr")],
                    [btn("💸 Вывод не получил", "sup:w:no")],
                    [btn("✍️ Другая проблема", "sup:w:other")],
                    [btn("← Выбрать другой вывод", "sup:k:w")],
                ],
            )
        return
    if data.startswith("sup:w:"):
        flow = flow_get(cid)
        if flow.get("issue_kind") != "withdraw" or not flow.get("transaction_id"):
            show_transactions(cid, "withdraw", 0); return
        action = data.rsplit(":", 1)[-1]
        if action == "qr":
            flow_set(cid, step="wait_withdraw_qr", issue_type="withdraw_new_qr")
            send_menu(cid, "Отправьте фотографию нового QR-кода. Лучше без обрезки и бликов.", [[btn("← Назад", f"sup:t:w:{int(flow['transaction_id'])}")]])
        elif action == "no":
            flow_set(cid, step="ready", issue_type="withdraw_not_received")
            flow = flow_get(cid)
            qm=dict(q.get("message") or {"chat":{"id":cid}}); qm["from"]=q.get("from",{})
            finalize_no_file(cid, qm, flow, "Вывод не получен")
        elif action == "other":
            flow_set(cid, step="wait_withdraw_reason", issue_type="withdraw_other")
            send_menu(cid, "Коротко опишите проблему одним сообщением.", [[btn("← Назад", f"sup:t:w:{int(flow['transaction_id'])}")]])
        return


def on_message(m):
    cid = int(m["chat"]["id"])
    text = (m.get("text") or "").strip()
    status = api(f"/bot/support-status/{cid}", timeout=5)
    exists = bool(status.get("exists"))
    opened = bool(status.get("opened"))
    open_cases = int(status.get("open_cases") or 0)
    command = text.split(None, 1)[0].lower() if text else ""

    if bool(status.get("support_blocked")):
        reason=str(status.get("support_block_reason") or "Доступ к поддержке ограничен")
        flow_clear(cid)
        send(token(), cid, f"⛔ Поддержка для вашего аккаунта ограничена.\n\nПричина: {reason}")
        return

    if command == "/start":
        flow_clear(cid)
        try: api(f"/bot/ai-support/reset/{cid}", "POST", {}, timeout=5)
        except Exception: pass
        if open_cases > 0:
            send(token(), cid, "⏳ У вас уже есть активное обращение. Дождитесь решения оператора — новое можно создать после закрытия текущего.")
            return
        show_kind_menu(cid)
        return

    if exists and not opened:
        rating_match = re.fullmatch(r"\s*([1-5])(?:\s*⭐)?\s*", text)
        if rating_match and not flow_get(cid).get("step"):
            try:
                api(f"/bot/support-rating/{cid}", "POST", {"rating": int(rating_match.group(1))}, timeout=6)
            except Exception:
                send(token(), cid, "Не удалось сохранить оценку. Попробуйте ещё раз.")
            return

    flow = flow_get(cid)
    step = str(flow.get("step") or "")

    file_url, media_kind = "", ""
    fid, media_kind = pick_media(m)
    if fid:
        try:
            f = tg(token(), "getFile", {"file_id": fid})
            file_url = f"https://api.telegram.org/file/bot{token()}/{f['file_path']}"
        except Exception:
            send(token(), cid, "Не удалось получить файл. Отправьте его ещё раз.")
            return
    has_media = bool(file_url)

    # Открытые финансовые кейсы ведёт оператор: AI туда не вмешивается.
    if step == "ai_question" or (not step and open_cases == 0):
        result = ask_ai(cid, text=text, file_url=file_url)
        if result.get("human_locked"):
            # Оператор уже взял диалог. Сообщение должно попасть ему без второго ответа AI.
            if opened:
                api(
                    "/bot/events", "POST",
                    {"event":"support_message","chat_id":cid,"user":m.get("from",{}),"message":m,"file_url":file_url,"media_kind":media_kind},
                    timeout=10,
                )
                return
        if ai_route_message(cid, m, text, file_url, result, media_kind):
            return
        if step == "ai_question":
            # AI выключен/недоступен — не теряем вопрос, отдаём оператору.
            api(
                "/bot/events", "POST",
                {"event":"support_message","chat_id":cid,"user":m.get("from",{}),"message":m,"file_url":file_url,"media_kind":media_kind},
                timeout=10,
            )
            flow_clear(cid)
            send(token(), cid, "Вопрос передан оператору. Ответ придёт сюда.")
            return

    if step == "wait_deposit_receipt":
        if not has_media:
            send(token(), cid, "Нужен чек: пришлите фото, скриншот или видео оплаты.")
            return
        try:
            submit_case_event(cid, m, flow, file_url=file_url, issue_text="Чек по пополнению", media_kind=media_kind)
        except Exception as exc:
            flow_clear(cid)
            send(token(), cid, "⏳ Не удалось создать новое обращение. Возможно, у вас уже есть активная проблема или заявка уже успешно обработана. Дождитесь решения текущего обращения и попробуйте снова.")
            return
        flow_clear(cid)
        send(token(), cid, "✅ Чек получен. Проблема по пополнению добавлена оператору.")
        return

    if step == "wait_withdraw_qr":
        if not has_media:
            send(token(), cid, "Нужна фотография нового QR-кода.")
            return
        try:
            submit_case_event(cid, m, flow, file_url=file_url, issue_text="Клиент отправил новый QR-код", media_kind=media_kind)
        except Exception:
            flow_clear(cid)
            send(token(), cid, "⏳ Новое обращение не создано. Сначала дождитесь решения текущей проблемы; успешно завершённые выводы повторно в поддержку не принимаются.")
            return
        flow_clear(cid)
        send(token(), cid, "✅ Новый QR получен. Проблема по выводу добавлена оператору.")
        return

    if step == "wait_withdraw_reason":
        if not text:
            send(token(), cid, "Опишите проблему текстом одним сообщением.")
            return
        try:
            submit_case_event(cid, m, flow, issue_text=text)
        except Exception:
            flow_clear(cid)
            send(token(), cid, "⏳ Новое обращение не создано. Сначала дождитесь решения текущей проблемы.")
            return
        flow_clear(cid)
        send(token(), cid, "✅ Проблема по выводу добавлена оператору.")
        return

    if not opened:
        send(token(), cid, "Нажмите /start и выберите конкретную заявку, по которой нужна помощь.")
        return

    # Уже открытое обращение: последующие сообщения идут напрямую оператору.
    api(
        "/bot/events",
        "POST",
        {
            "event": "support_message",
            "chat_id": cid,
            "user": m.get("from", {}),
            "message": m,
            "file_url": file_url,
            "media_kind": media_kind,
        },
        timeout=10,
    )


def outbox_loop():
    while True:
        try:
            r = api("/bot/outbox?after_id=0&bot=support", timeout=6)
            items = (r.get("items") or [])[:5]
            if not items:
                time.sleep(0.18)
                continue
            for item in items:
                try:
                    result = None
                    if item.get("photo_url"):
                        result = send_photo(token(), item["chat_id"], item["photo_url"], item.get("caption", ""))
                    else:
                        payload={"chat_id":int(item["chat_id"]),"text":item.get("text", "")}
                        reply_to=item.get("reply_to_telegram_message_id")
                        if reply_to:
                            payload["reply_parameters"]={"message_id":int(reply_to),"allow_sending_without_reply":True}
                        result = tg(token(), "sendMessage", payload)
                    tg_mid = int((result or {}).get("message_id") or 0) if isinstance(result, dict) else 0
                    api(f"/bot/outbox/{item['id']}/sent", "POST", {"telegram_message_id":tg_mid}, timeout=5)
                except Exception as exc:
                    api(f"/bot/outbox/{item['id']}/failed", "POST", {"error": str(exc)}, timeout=5)
        except Exception:
            traceback.print_exc()
            time.sleep(0.7)


POOL = ThreadPoolExecutor(max_workers=20, thread_name_prefix="support")
LOCKS = {}
LOCK_GUARD = threading.Lock()


def process_message(m):
    cid = int((m.get("chat") or {}).get("id") or 0)
    if not cid: return
    with LOCK_GUARD:
        lock = LOCKS.setdefault(cid, threading.RLock())
    with lock:
        on_message(m)


def process_callback(q):
    cid = int((q.get("message") or {}).get("chat", {}).get("id") or (q.get("from") or {}).get("id") or 0)
    if not cid: return
    with LOCK_GUARD:
        lock = LOCKS.setdefault(cid, threading.RLock())
    with lock:
        on_callback(q)


def main():
    threading.Thread(target=outbox_loop, daemon=True, name="support-outbox").start()
    offset = int(get_meta("telegram_offset", "0") or 0)
    active_token = ""
    while True:
        try:
            current = token().strip()
            if not current or ":" not in current:
                time.sleep(1.5)
                continue
            if current != active_token:
                try: tg(current, "deleteWebhook", {"drop_pending_updates": False})
                except Exception: pass
                active_token = current
            updates = tg(
                current,
                "getUpdates",
                {"offset": offset, "timeout": 30, "limit": 100, "allowed_updates": ["message", "callback_query"]},
                timeout=38,
            )
            for u in updates:
                offset = int(u["update_id"]) + 1
                set_meta("telegram_offset", offset)
                if "message" in u:
                    POOL.submit(process_message, u["message"])
                elif "callback_query" in u:
                    POOL.submit(process_callback, u["callback_query"])
        except Exception:
            traceback.print_exc()
            time.sleep(0.7)


if __name__ == "__main__":
    main()
