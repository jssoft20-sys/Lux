#!/usr/bin/env python3
"""Create a test withdrawal request so the panel can be checked with a real bank link.

    venv/bin/python scripts/demo_withdrawal.py --qr "https://qr.finik.kg/f36e0f6a-1f22-4f34-a177-71444f6c91aa?type=t" --amount 150

The request lands in Главная → Актуальные with the recognised bank mark (Finik, MBank, Optima…),
«Ген QR / Ориг QR», the «Оплатить в Optima24» button and the Принять / Отказать bar. It belongs to
a demo client «Тест PayGo» (Telegram ID 100000001), touches no cash desk API and is never picked up
by the automatic payout — accept or reject it like any other request. scripts/update.sh creates one
such request once (marker data/.demo_withdrawal); run this by hand for another.
Run it on the server from /home/PayGo (reads .env for the database) or locally with DATABASE_URL set.
"""
from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT)


def main() -> int:
    ap = argparse.ArgumentParser(description="Create a demo withdrawal with a bank link / QR payload")
    ap.add_argument("--qr", required=True, help="bank link (https://qr.finik.kg/…, https://app.mbank.kg/…) or an ELQR payload (000201…)")
    ap.add_argument("--amount", default="150", help="payout amount in som (default 150)")
    ap.add_argument("--player", default="1759903333", help="player id shown on the request")
    ap.add_argument("--cash", default="", help="cash desk key (default: the first one)")
    ap.add_argument("--name", default="Тест PayGo", help="client display name")
    args = ap.parse_args()

    from paygo.db import transaction
    from paygo.models import PaymentCash, Withdrawal
    from paygo.services import elqr
    from paygo.services.users import get_or_create
    from paygo.utils import money, new_public_id, utcnow
    from sqlalchemy import select

    link = args.qr.strip()
    bank = elqr.detect_bank(link)
    # the bank's QR page carries the ELQR payload — with it the request gets «Ген QR» and the Optima24 link
    payload = elqr.resolve_bank_link(link) or link
    with transaction() as db:
        stmt = select(PaymentCash).order_by(PaymentCash.priority)
        if args.cash:
            stmt = stmt.where(PaymentCash.key == args.cash)
        cash = db.execute(stmt).scalars().first()
        if cash is None:
            print("Нет кассы — добавьте кассу в панели (Меню → Кассы) и повторите", file=sys.stderr)
            return 2
        user = get_or_create(db, {"id": 100000001, "username": "paygo_demo", "first_name": args.name})
        db.flush()
        amount = money(Decimal(str(args.amount).replace(",", ".")))
        stamp = int(utcnow().timestamp())
        row = Withdrawal(
            public_id=new_public_id("W"),
            user_id=user.id,
            cash_id=cash.id,
            player_id="".join(ch for ch in args.player if ch.isdigit()) or "1759903333",
            player_name=args.name,
            currency=cash.currency,
            amount=amount,
            code=f"DEMO{stamp % 100000}",
            provider_claim_key=f"demo:{stamp}",
            idempotency_key=f"demo-withdrawal-{stamp}",
            qr_payload=payload,
            status="created",
            source="demo",
            needs_attention=False,
            error="",
        )
        if payload.startswith("000201"):
            try:
                row.generated_qr_payload = elqr.inject_amount(payload, amount)
            except Exception:
                row.generated_qr_payload = ""
        db.add(row)
        user.withdrawals_count = int(user.withdrawals_count or 0) + 1
        db.flush()
        print(f"Создан тестовый вывод {row.public_id} (id {row.id}): {amount} {cash.currency}, банк {bank['name']} ({bank['key']}), QR {'распознан' if row.generated_qr_payload else 'только ссылка'}")
        print(f"Открыть в панели: #/withdrawal/{row.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
