"""Automatic payouts: fake payout channel, Optima24 reply parsing, and the engine."""
from decimal import Decimal

import pytest
from paygo.db import transaction
from paygo.models import Notification, User, Withdrawal
from paygo.services import withdrawals
from paygo.services.cashes import get_cash
from paygo.services.users import save_qr

TEMPLATE = "00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR"


# --------------------------------------------------------------------------- helpers

def _set(**values):
    from paygo.services import settings_store

    with transaction() as db:
        settings_store.set_many(db, values, "test")


def _make_withdrawal(user_id, code, key):
    with transaction() as db:
        u = db.get(User, user_id)
        qr = save_qr(db, u, file_id="f", file_url="https://e/qr.jpg", payload=TEMPLATE, bank_name="Optima Bank")
        qr_id = qr.id
        cash_id = get_cash(db, "1xbet").id
    result = withdrawals.create_withdrawal(user_id=user_id, cash_id=cash_id, player_id="123456", code=code, idempotency_key=key, qr_record_id=qr_id)
    assert result["ok"] and not result.get("duplicate"), result
    return result["withdrawal"]["id"]


@pytest.fixture
def payout_fake(monkeypatch):
    """Configure the engine to use an in-memory payout channel we control."""
    from paygo.config import reset_settings_cache
    from paygo.payouts.base import FakePayoutProvider
    from paygo.services import autopay

    monkeypatch.setenv("PAYOUT_PROVIDER", "fake")
    reset_settings_cache()
    autopay.reset_provider()
    fake = FakePayoutProvider(balance=Decimal("1000000"))
    monkeypatch.setattr(autopay, "_pool", lambda: [fake])
    yield fake
    autopay.reset_provider()
    reset_settings_cache()


# --------------------------------------------------------------------------- fake channel

def test_fake_provider_pays_once_and_guards_balance():
    from paygo.payouts.base import FakePayoutProvider, PayoutTarget

    p = FakePayoutProvider(balance=Decimal("1000"))
    t = PayoutTarget(amount=Decimal("300"), reference="W1", public_id="W1")
    first = p.pay(t)
    assert first.ok and first.status == "sent" and p.get_balance() == Decimal("700")
    again = p.pay(t)  # same reference — never double-pay
    assert again.duplicate and p.get_balance() == Decimal("700")
    big = p.pay(PayoutTarget(amount=Decimal("99999"), reference="W2", public_id="W2"))
    assert not big.ok and "недостаточно" in big.message


# --------------------------------------------------------------------------- optima24 parsing

def test_optima24_interpret_transfer():
    from paygo.payouts.base import PayoutTarget
    from paygo.payouts.optima24 import _interpret_transfer

    t = PayoutTarget(amount=Decimal("100"), reference="W1", public_id="W1")
    assert _interpret_transfer(200, {"transactionId": "T1"}, t).status == "sent"
    assert _interpret_transfer(200, {"status": "pending", "id": "T2"}, t).status == "pending"
    assert _interpret_transfer(409, {"message": "already processed"}, t).duplicate
    ambiguous = _interpret_transfer(503, {"message": "gateway timeout"}, t)
    assert not ambiguous.ok and ambiguous.acknowledged  # may have gone through — never resend
    clean = _interpret_transfer(400, {"error": "invalid card"}, t)
    assert not clean.ok and not clean.acknowledged


def test_optima24_balance_parsing():
    from paygo.payouts.optima24 import _extract_balance

    assert _extract_balance({"account": {"availableBalance": "12345.67"}}) == Decimal("12345.67")
    assert _extract_balance([{"x": 1}, {"balance": 500}]) == Decimal("500")
    assert _extract_balance({"nothing": "here"}) is None


def test_optima24_not_configured_is_loud():
    from paygo.payouts.base import PayoutError, PayoutTarget
    from paygo.payouts.optima24 import Optima24Provider

    p = Optima24Provider(base_url="https://telebank3.optima24.kg:3080", login="x", password="y")
    with pytest.raises(PayoutError):
        p.pay(PayoutTarget(amount=Decimal("100"), card="1234", reference="W1"))  # login capture missing


# --------------------------------------------------------------------------- engine

def test_autopay_dry_run_moves_no_money(user, fake_provider, payout_fake):
    _set(autopay_enabled=True, autopay_dry_run=True)
    wid = _make_withdrawal(user, "DRY1234", "d1")
    from paygo.services import autopay

    result = autopay.run_once()
    assert result["active"]
    with transaction() as db:
        w = db.get(Withdrawal, wid)
        assert w.status == "created"  # untouched
        assert w.provider_response["autopay"]["state"] == "dryrun"
    assert not payout_fake.paid


def test_autopay_sends_completes_and_is_idempotent(user, fake_provider, payout_fake):
    _set(autopay_enabled=True, autopay_dry_run=False, autopay_max_amount=15000, autopay_daily_cap=300000, autopay_min_reserve=500)
    wid = _make_withdrawal(user, "OK1234", "s1")  # amount 5300 from the fake bookmaker
    from paygo.services import autopay

    result = autopay.run_once()
    assert result["active"] and result["sent"] == 1
    with transaction() as db:
        w = db.get(Withdrawal, wid)
        assert w.status == "success"
        assert w.provider_response["autopay"]["state"] == "sent"
    assert payout_fake.get_balance() == Decimal("1000000") - Decimal("5300")
    # a second scan pays nothing more
    assert autopay.run_once().get("sent", 0) == 0
    assert len(payout_fake.paid) == 1


def test_autopay_skips_over_limit_but_operator_can_force(user, fake_provider, payout_fake):
    fake_provider["behaviour"]["withdraw_amount"] = Decimal("20000")
    _set(autopay_enabled=True, autopay_dry_run=False, autopay_max_amount=15000)
    wid = _make_withdrawal(user, "BIG1234", "b1")
    from paygo.services import autopay

    assert autopay.run_once().get("sent", 0) == 0
    with transaction() as db:
        assert db.get(Withdrawal, wid).status == "created"
    forced = autopay.pay_withdrawal(wid, operator_id=None, force=True)
    assert forced["ok"] and forced["status"] == "sent"
    with transaction() as db:
        assert db.get(Withdrawal, wid).status == "success"


def test_autopay_pauses_and_warns_on_low_balance(user, fake_provider, payout_fake):
    payout_fake._balance = Decimal("400")
    _set(autopay_enabled=True, autopay_dry_run=False, autopay_min_reserve=500, autopay_low_balance=20000)
    wid = _make_withdrawal(user, "LOW1234", "l1")
    from paygo.services import autopay

    result = autopay.run_once()
    assert result.get("paused") == "low_balance"
    with transaction() as db:
        assert db.get(Withdrawal, wid).status == "created"
        assert db.query(Notification).filter_by(event="autopay_balance").count() >= 1
    assert not payout_fake.paid


def test_autopay_paces_sends_by_interval(user, fake_provider, payout_fake):
    from paygo.services import autopay

    _set(autopay_enabled=True, autopay_dry_run=False, autopay_min_interval_seconds=18)
    _make_withdrawal(user, "PACE001", "p1")
    _make_withdrawal(user, "PACE002", "p2")
    # first tick sends exactly one
    assert autopay.run_once()["sent"] == 1
    assert len(payout_fake.paid) == 1
    # immediately after: throttled, nothing reaches the bank
    r2 = autopay.run_once()
    assert r2.get("sent", 0) == 0 and r2.get("throttled_for", 0) > 0
    assert len(payout_fake.paid) == 1
    # once the interval has elapsed, the second one goes
    autopay._LAST_SENT_AT = 0.0
    assert autopay.run_once()["sent"] == 1
    assert len(payout_fake.paid) == 2


def test_autopay_multi_account_picks_the_fullest_with_funds(user, fake_provider, monkeypatch):
    from paygo.config import reset_settings_cache
    from paygo.payouts.base import FakePayoutProvider
    from paygo.services import autopay

    monkeypatch.setenv("PAYOUT_PROVIDER", "fake")
    reset_settings_cache()
    autopay.reset_provider()
    small = FakePayoutProvider(balance=Decimal("3000"))
    small.account_name = "acc-small"
    big = FakePayoutProvider(balance=Decimal("50000"))
    big.account_name = "acc-big"
    monkeypatch.setattr(autopay, "_pool", lambda: [small, big])
    _set(autopay_enabled=True, autopay_dry_run=False, autopay_min_reserve=500, autopay_max_amount=15000)
    _make_withdrawal(user, "MULTI001", "m1")  # amount 5300 — too big for the small account + reserve
    try:
        result = autopay.run_once()
        assert result["sent"] == 1 and result["account"] == "acc-big"
        assert len(big.paid) == 1 and len(small.paid) == 0
        assert big.get_balance() == Decimal("50000") - Decimal("5300")
    finally:
        autopay.reset_provider()
        reset_settings_cache()


def test_autopay_off_when_not_enabled(user, fake_provider, payout_fake):
    _set(autopay_enabled=False)
    wid = _make_withdrawal(user, "OFF1234", "o1")
    from paygo.services import autopay

    assert autopay.run_once() == {"active": False}
    with transaction() as db:
        assert db.get(Withdrawal, wid).status == "created"


def test_manual_autopay_endpoint_dry_run(logged, user, fake_provider, payout_fake):
    wid = _make_withdrawal(user, "API1234", "a1")
    _set(autopay_enabled=True, autopay_dry_run=True)
    r = logged.post(f"/paygo/api/withdrawals/{wid}/action", json={"action": "autopay"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["dry_run"] is True


def test_autopay_status_endpoint(logged, payout_fake):
    _set(autopay_enabled=True, autopay_dry_run=True)
    r = logged.get("/paygo/api/autopay")
    assert r.status_code == 200, r.text
    data = r.json()["autopay"]
    assert data["provider"] == "fake" and data["active"] is True and data["dry_run"] is True
