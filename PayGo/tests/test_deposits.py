from decimal import Decimal

import pytest
from paygo.db import transaction
from paygo.models import Deposit, Notification, PaymentCash, PaymentEvent, User
from paygo.services import deposits, payments
from paygo.services.cashes import get_cash


def _create(user_id, amount="1000", key="k1"):
    with transaction() as db:
        user = db.get(User, user_id)
        cash = get_cash(db, "1xbet")
        dep, created = deposits.create_deposit(db, user=user, cash=cash, player_id="123456", amount=amount, idempotency_key=key)
        return dep.id, dep.public_id, Decimal(dep.pay_amount), created


def test_create_deposit_unique_amount_and_idempotent(user, fake_provider):
    dep_id, public_id, pay1, created = _create(user, key="same")
    assert created and pay1 > Decimal("1000") and pay1 < Decimal("1001")
    dep_id2, _, pay2, created2 = _create(user, key="same")
    assert dep_id2 == dep_id and not created2 and pay2 == pay1
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        assert dep.status == "created" and dep.qr_payload.startswith("000201")
        assert db.query(Notification).filter_by(event="deposit_new").count() == 1


def test_limits_and_validation(user, fake_provider):
    with pytest.raises(deposits.DepositError) as exc:
        _create(user, amount="10", key="low")
    assert exc.value.code == "AMOUNT_LIMITS"
    with pytest.raises(deposits.DepositError) as exc:
        _create(user, amount="100.5", key="frac")
    assert exc.value.code == "BAD_AMOUNT"


def test_second_active_deposit_blocked(user, fake_provider):
    _create(user, key="a")
    with pytest.raises(deposits.DepositError) as exc:
        _create(user, key="b")
    assert exc.value.code == "ACTIVE_EXISTS"


def test_webhook_event_credits_once(user, fake_provider):
    dep_id, public_id, pay, _ = _create(user, key="w")
    with transaction() as db:
        event, created = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"Зачислено {pay} KGS", raw_payload={"text": f"Зачислено {pay} KGS"})
        assert created
        event_id = event.id
        again, created2 = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"Зачислено {pay} KGS", raw_payload={"text": f"Зачислено {pay} KGS"})
        assert not created2 and again.id == event_id
    result = payments.process_event(event_id)
    assert result["ok"] is True
    # replay of the same event must not credit twice
    result2 = payments.process_event(event_id)
    assert result2.get("already") is True
    assert len([c for c in fake_provider["calls"] if c[0] == "deposit"]) == 1
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        assert dep.status == "success" and dep.payment_event_id == event_id and dep.provider_ref == "777"
        ev = db.get(PaymentEvent, event_id)
        assert ev.status == "matched"
        assert db.query(Notification).filter_by(event="deposit_success", target_telegram_id=111222333).count() == 1
        user_row = db.get(User, user)
        assert user_row.deposits_count == 1


def test_provider_failure_marks_failed_and_retry_works(user, fake_provider):
    dep_id, _, pay, _ = _create(user, key="f")
    fake_provider["behaviour"]["deposit_ok"] = False
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"+{pay} сом")
        event_id = event.id
    result = payments.process_event(event_id)
    assert result["ok"] is False
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        assert dep.status == "failed" and "лимит" in dep.error
        assert db.query(Notification).filter_by(event="deposit_failed").count() == 1
    fake_provider["behaviour"]["deposit_ok"] = True
    result = deposits.credit_deposit(dep_id, source="manual")
    assert result["ok"] is True
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "success"


def test_unmatched_event_stays_received(user, fake_provider):
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=Decimal("77.77"), raw_text="Зачислено 77.77 KGS")
        event_id = event.id
    result = payments.process_event(event_id)
    assert result["processed"] is False
    with transaction() as db:
        assert db.get(PaymentEvent, event_id).status == "received"


def test_expiry_and_late_payment(user, fake_provider):
    from datetime import timedelta

    from paygo.utils import utcnow

    dep_id, _, pay, _ = _create(user, key="e")
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        dep.expires_at = utcnow() - timedelta(seconds=1)
    with transaction() as db:
        expired = deposits.expire_deposits(db)
        assert [d.id for d in expired] == [dep_id]
        assert db.query(Notification).filter_by(event="deposit_expired").count() == 1
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"Зачислено {pay}")
        event_id = event.id
    assert payments.process_event(event_id)["ok"] is True
    with transaction() as db:
        dep = db.get(Deposit, dep_id)
        assert dep.status == "success"
        # the stale "expired" message is superseded by the success message
        assert db.query(Notification).filter_by(event="deposit_expired").first().status == "superseded"


def test_amount_extraction():
    assert payments.extract_amount("Optima: зачисление 1500.37 KGS от ***") == Decimal("1500.37")
    assert payments.extract_amount("Поступление +2 000,55 сом") == Decimal("2000.55")
    assert payments.extract_amount("", {"amount": "300"}) == Decimal("300")
    with pytest.raises(ValueError):
        payments.extract_amount("no numbers here")


def test_cash_disabled_blocks_deposit(user, fake_provider):
    with transaction() as db:
        cash = get_cash(db, "1xbet")
        cash.auto_disabled = True
    with pytest.raises(deposits.DepositError) as exc:
        _create(user, key="d")
    assert exc.value.code == "DEPOSITS_DISABLED"
    with transaction() as db:
        assert db.get(PaymentCash, get_cash(db, "1xbet").id).auto_disabled


def test_amount_extraction_picks_the_payment_not_phones_masks_balances_or_dates():
    """The figure that gets credited is the payment — never the sender's phone, a card mask,
    the balance after the operation, the commission, a date or a time."""
    cases = {
        "Перевод от 996555123456: 1500.84 сом": "1500.84",
        "Вам перевели 1500.84 сом от 996555123456": "1500.84",
        "Пополнение карты 4***1234 на сумму 1500.84 KGS": "1500.84",
        "MBank: +1 500.84 с. Баланс: 25 000.00 с": "1500.84",
        "Баланс 25 000.00 KGS. Зачислено 1 500.84 KGS": "1500.84",
        "Поступление: 900.00 KGS, комиссия 0.00 KGS": "900.00",
        "Перевод 2 000,05 KGS от Иван И. Баланс 12 345,67 KGS": "2000.05",
        "Elcart: 18.09.2026 12:01 пополнение 1500,84 KGS карта 5***2299 доступно 30000,00 KGS": "1500.84",
        "Счет пополнен на 3000 сом 12.09.2026 в 14:05": "3000.00",
        "Кэшбэк 15.00 сом за покупку. Пополнение 500.50 сом": "500.50",
        "O!Dengi: Вам перевели 1,500.84 KGS": "1500.84",
        "Оплата QR 1 000,37 сом. Счет 1091821234350118": "1000.37",
        "Пополнение +1000,37с": "1000.37",
        "1500.84": "1500.84",
    }
    for text, want in cases.items():
        assert payments.extract_amount(text) == Decimal(want), text
    for text in ("Заявка 2260918", "Пароль 1234", ""):
        with pytest.raises(ValueError):
            payments.extract_amount(text)


def test_payment_before_request_window_is_not_matched(user, fake_provider):
    """A fresh payment that arrived before the request existed must not confirm it (2nd check)."""
    from datetime import timedelta

    from paygo.utils import utcnow

    dep_id, pub, pay, _ = _create(user, amount="1234", key="win1")
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"Зачислено {pay} KGS")
        event.received_at = utcnow() - timedelta(minutes=30)  # money moved long before the request
        event_id = event.id
    result = payments.process_event(event_id)
    assert result["processed"] is False and result["message"] == "transaction_not_found"
    with transaction() as db:
        assert db.get(Deposit, dep_id).status == "created"  # untouched — not wrongly credited


def test_payment_inside_window_still_matches(user, fake_provider):
    dep_id, pub, pay, _ = _create(user, amount="1235", key="win2")
    with transaction() as db:
        event, _ = payments.ingest_event(db, source="webhook", amount=pay, raw_text=f"Зачислено {pay} KGS")
        event_id = event.id
    assert payments.process_event(event_id)["ok"] is True
