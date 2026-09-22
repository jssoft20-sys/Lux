"""What keeps the client bot fast — the parts that would silently get slow again.

* the payment card is built on a watermark that is drawn once per process, not per request;
* the card leaves as a palette PNG (same picture, roughly half the bytes Telegram has to carry);
* «Проверяем ID…» / «Создаём заявку…» are sent in the background, and the screen that follows
  them always lands last — a note must never stay on the client's screen.
"""
from __future__ import annotations

import io
import time

from paygo.services import qr
from PIL import Image
from test_bot_flows import CHAT, FROM, bot, pick_cash, state_of  # noqa: F401
from test_elqr_qr import TEMPLATE as VALUE  # тестовый ELQR-шаблон, без боевых реквизитов


def _fresh() -> None:
    qr._CACHE.clear()
    qr._BACKGROUNDS.clear()


def test_card_watermark_is_drawn_once_for_every_request(monkeypatch):
    _fresh()
    built: list[tuple] = []
    original = qr._background

    def counted(width, height, watermark):
        if (width, height, watermark) not in [b[:3] for b in built]:
            built.append((width, height, watermark))
        return original(width, height, watermark)

    monkeypatch.setattr(qr, "_background", counted)
    first = qr.render_pay_card(VALUE + "1", overlay="1 000 сом")
    second = qr.render_pay_card(VALUE + "2", overlay="2 500 сом")
    assert first != second
    assert len(built) == 1  # the same white-and-watermark sheet under both cards
    assert qr._background(880, 1100, "PAYGO") is qr._background(880, 1100, "PAYGO")


def test_card_is_a_small_palette_png():
    _fresh()
    data = qr.render_pay_card(VALUE + "3", overlay="10 000 сом")
    image = Image.open(io.BytesIO(data))
    assert image.mode == "P" and image.size == (880, 1100)
    assert len(data) < 60_000  # ~44 KB; the full-colour PNG was ~73 KB
    assert qr.render_pay_card(VALUE + "3", overlay="10 000 сом") == data  # second send costs nothing


def test_prewarm_uses_the_watermark_from_the_settings(seeded):
    from paygo.db import transaction
    from paygo.services import settings_store

    _fresh()
    with transaction() as db:
        settings_store.set_many(db, {"qr_watermark_text": "МОЙБРЕНД"})
    qr.prewarm()
    assert (880, 1100, "МОЙБРЕНД") in qr._BACKGROUNDS
    with transaction() as db:
        settings_store.set_many(db, {"qr_watermark_text": "PAYGO"})


def test_id_check_note_never_covers_the_next_screen(bot, fake_provider):  # noqa: F811
    """The note is sent off the handler, so the cash-desk check starts at once — but the amount
    screen that follows it must still be the last thing on the client's screen."""
    landed: list[str] = []
    client = bot.client
    original = client.edit_text

    def slow_note(chat_id, message_id, text, markup=None, **kw):
        if "Проверяем" in text:
            time.sleep(0.3)  # a slow note: without ordering it would land after the amount screen
            landed.append("note")
        return original(chat_id, message_id, text, markup, **kw)

    client.edit_text = slow_note
    from test_bot_flows import text as send

    send(bot, "/start")
    send(bot, "Пополнить")
    pick_cash(bot)
    send(bot, "654321")
    assert landed == ["note"]
    assert "Введите сумму пополнения" in bot.client.last[1]
    assert state_of()[0] == "wait_amount"
