"""Bank statement import: parsing and money-safe two-check auto-credit."""
from datetime import timedelta
from decimal import Decimal

from paygo.db import transaction
from paygo.models import Deposit, User
from paygo.services import deposits, statements
from paygo.services.cashes import get_cash
from paygo.utils import money, utcnow


def test_parse_amount_signed():
    assert statements.parse_amount("-1 558,00") == Decimal("-1558.00")
    assert statements.parse_amount("8 000,00") == Decimal("8000.00")
    assert statements.parse_amount("-550,00") == Decimal("-550.00")
    assert statements.parse_amount("900.37") == Decimal("900.37")


def test_parse_optima_text_rows():
    text = (
        "Выписка\n"
        "2026-08-25\n     00:05\nПеревод по QR: Эмирбек С. -1 558,00\nKGS\n1090145\n"
        "2026-08-25\n     00:43\nВозврат: Перевод по QR: Эмирбек С.\n1 570,00\nKGS\n1090265\n"
    )
    rows = statements.parse_text_rows(text)
    assert len(rows) == 2
    assert rows[0].amount == Decimal("-1558.00") and not rows[0].incoming  # outgoing payout
    assert rows[1].amount == Decimal("1570.00") and rows[1].incoming       # incoming


def _pending_deposit(user_id, key):
    with transaction() as db:
        u = db.get(User, user_id)
        cash = get_cash(db, "1xbet")
        dep, _ = deposits.create_deposit(db, user=u, cash=cash, player_id="123456", amount="900", idempotency_key=key)
        return dep.id, money(dep.pay_amount)


def _statement(amount, when):
    amt = f"{amount:.2f}".replace(".", ",")
    return (f"Выписка\n{when:%Y-%m-%d}\n     {when:%H:%M}\nПеревод по QR: Тест К. {amt}\nKGS\n1090145006806590\n").encode()


def test_statement_import_credits_matching_incoming(user, fake_provider):
    dep_id, pay = _pending_deposit(user, "st1")
    report = statements.import_statement("vypiska.txt", _statement(pay, utcnow()))
    assert report["incoming"] == 1
    assert len(report["credited"]) == 1 and report["credited"][0]["ok"] is True
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "success"


def test_statement_outside_window_not_credited(user, fake_provider):
    dep_id, pay = _pending_deposit(user, "st2")
    report = statements.import_statement("vypiska.txt", _statement(pay, utcnow() - timedelta(hours=2)))
    assert len(report["credited"]) == 0 and report["unmatched"]  # payment predates the request → not credited
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "created"


def test_statement_outgoing_skipped_and_reimport_deduped(user, fake_provider):
    dep_id, pay = _pending_deposit(user, "st3")
    data = _statement(pay, utcnow())
    first = statements.import_statement("vypiska.txt", data)
    assert len(first["credited"]) == 1
    again = statements.import_statement("vypiska.txt", data)  # same file again
    assert again["duplicates"] == 1 and len(again["credited"]) == 0  # never double-credits
