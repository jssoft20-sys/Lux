from decimal import Decimal

from onoipay.db import transaction
from onoipay.models import Notification, User, Withdrawal
from onoipay.services import withdrawals
from onoipay.services.cashes import currency_matches, get_cash
from onoipay.services.users import last_qr, save_qr

TEMPLATE = "00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR"


def _cash_id():
    with transaction() as db:
        return get_cash(db, "1xbet").id


def test_create_withdrawal_with_last_qr(user, fake_provider):
    with transaction() as db:
        u = db.get(User, user)
        qr = save_qr(db, u, file_id="f1", file_url="https://example/qr.jpg", payload=TEMPLATE, bank_name="Optima Bank")
        qr_id = qr.id
    result = withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="ABC123", idempotency_key="w1", qr_record_id=qr_id)
    assert result["ok"] and not result.get("duplicate")
    w = result["withdrawal"]
    assert w["amount"] == "5300.00" and w["status"] == "created"
    with transaction() as db:
        row = db.get(Withdrawal, w["id"])
        assert row.generated_qr_payload.startswith("000201")
        from onoipay.services import elqr

        assert elqr.amount_from_payload(row.generated_qr_payload) == Decimal("5300")
        assert last_qr(db, db.get(User, user)).uses >= 2
        assert db.query(Notification).filter_by(event="withdrawal_new").count() == 1


def test_duplicate_code_not_sent_twice(user, fake_provider):
    withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="DUP1234", idempotency_key="d1")
    again = withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="DUP1234", idempotency_key="d2")
    assert again["duplicate"] is True
    assert len([c for c in fake_provider["calls"] if c[0] == "withdraw"]) == 1
    same_key = withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="DUP1234", idempotency_key="d1")
    assert same_key["duplicate"] is True


def test_provider_rejection_leaves_no_row(user, fake_provider):
    fake_provider["behaviour"]["withdraw_ok"] = False
    result = withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="BADCODE", idempotency_key="b1")
    assert result["ok"] is False and "код" in result["message"].lower()
    with transaction() as db:
        assert db.query(Withdrawal).count() == 0


def test_operator_flow(user, fake_provider, admin):
    result = withdrawals.create_withdrawal(user_id=user, cash_id=_cash_id(), player_id="123456", code="OK1234", idempotency_key="o1")
    wid = result["withdrawal"]["id"]
    with transaction() as db:
        w = db.get(Withdrawal, wid)
        assert withdrawals.take(db, w, admin["id"])
        assert w.status == "processing"
        assert withdrawals.complete(db, w, admin["id"])
        assert w.status == "success"
        assert not withdrawals.complete(db, w, admin["id"])
        assert db.query(Notification).filter_by(event="withdrawal_success").count() == 1


def test_currency_check():
    class C:
        accepted_currency_ids = "KGS,417"

    assert currency_matches(C(), "KGS")
    assert currency_matches(C(), "417")
    assert not currency_matches(C(), "USD")
    C.accepted_currency_ids = ""
    assert currency_matches(C(), "USD")
