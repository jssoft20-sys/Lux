"""Russian ⇄ Kyrgyz in the client bot: static strings, the Kyrgyz layer of the settings texts, the /lang switch."""
from __future__ import annotations

import re

import pytest
from paygo.db import transaction
from paygo.models import Deposit, User, Withdrawal
from paygo.services import bot_texts, settings_store
from paygo.services import users as user_service
from paygobot.texts import LANG_BUTTONS, T, norm_lang, t
from test_bot_flows import CHAT, FROM, FakeTelegram, photo, pick_cash, state_of, tap, text

LETTERS = re.compile(r"[a-zа-яёңөү]", re.IGNORECASE)
PLACEHOLDER = re.compile(r"\{[a-z_]+\}")
HTML_TAG = re.compile(r"</?[a-z]+>")
RU_LABELS = ["📥 Пополнить", "📤 Вывести", "✉️ Помощь"]
KG_LABELS = ["📥 Толуктоо", "📤 Чыгаруу", "✉️ Жардам"]


# ------------------------------------------------------------------ the translations themselves

def test_every_static_string_has_its_own_kyrgyz_text():
    for key, row in T.items():
        assert row.get("ru"), key
        kg = row.get("kg")
        assert kg and kg.strip(), f"{key}: no Kyrgyz text"
        if LETTERS.search(row["ru"]):  # pure emoji / numbers may stay the same
            assert kg != row["ru"], f"{key}: the Kyrgyz text equals the Russian one"
        assert set(PLACEHOLDER.findall(kg)) == set(PLACEHOLDER.findall(row["ru"])), f"{key}: placeholders differ"
    assert t("kg", "cancel") == "✖️ Жокко чыгаруу" and t("kg", "back") == "◀️ Артка" and t("kg", "menu") == "🏠 Башкы меню" and t("kg", "check") == "✅ Текшерүү"
    assert t("ru", "lang_switched") == "✅ Язык: Русский" and t("kg", "lang_switched") == "✅ Тил: Кыргызча"
    assert t("ru", "lang_button") == "🌐 Язык / Тил" and "Тилди тандаңыз" in t("kg", "lang_choose")
    assert t("en", "check") == t("ru", "check")  # an unknown language falls back to Russian
    assert norm_lang("ky") == "kg" and norm_lang("KG") == "kg" and norm_lang("") == "ru" and norm_lang(None) == "ru" and norm_lang("en") == "ru"
    assert [code for code, _ in LANG_BUTTONS] == ["ru", "kg"]


def test_kyrgyz_settings_texts_match_the_russian_defaults():
    for key, kg in bot_texts.KG_TEXTS.items():
        ru = settings_store.DEFAULTS.get(key)
        assert isinstance(ru, str) and ru, f"{key}: not a text setting"
        assert kg.strip() and kg != ru, key
        assert set(PLACEHOLDER.findall(kg)) == set(PLACEHOLDER.findall(ru)), f"{key}: placeholders differ"
        assert kg.count("[emoji:") == ru.count("[emoji:"), f"{key}: premium emoji markers differ"
        assert bot_texts.EMOJI_TOKEN.findall(kg) == bot_texts.EMOJI_TOKEN.findall(ru), f"{key}: premium emoji ids differ"
        assert HTML_TAG.findall(kg) == HTML_TAG.findall(ru), f"{key}: HTML tags differ"
    # every client text of the settings page has a translation (the greeting sticker is an emoji only)
    for key in settings_store.TEXT_KEYS:
        if key != "greeting_sticker":
            assert key in bot_texts.KG_TEXTS, f"{key}: no Kyrgyz translation"
    assert {"withdraw_sla_text", "instruction_text", "text_paused", "text_blocked", "support_greeting"} <= set(bot_texts.KG_TEXTS)


def test_kyrgyz_resolution_rule_and_kg_override(seeded):
    with transaction() as db:
        ru = bot_texts.render(db, "greeting_text", name="Али")
        kg = bot_texts.render(db, "greeting_text", lang="kg", name="Али")
        assert "Привет Али" in bot_texts.strip_html(ru) and "кош келиңиз" in kg and "Али" in kg and "@PayOperator_bot" in kg
        assert kg.count("<tg-emoji") == ru.count("<tg-emoji") == 6
        assert bot_texts.render(db, "greeting_text", lang="en", name="Али") == ru  # unknown language → Russian
        # the owner customised the Russian text — a Kyrgyz client still gets the built-in Kyrgyz one (no mixed languages)
        settings_store.set_many(db, {"greeting_text": "Своё приветствие {name}"}, "test")
        assert bot_texts.render(db, "greeting_text", name="Али") == "Своё приветствие Али"
        assert "кош келиңиз" in bot_texts.render(db, "greeting_text", lang="kg", name="Али")
        # ...unless the owner wrote a Kyrgyz version under <key>__kg (only text keys may have one)
        changed = settings_store.set_many(db, {"greeting_text__kg": "Салам, {name}!", "nonsense__kg": "x", "bot_paused__kg": "x"}, "test")
        assert set(changed) == {"greeting_text__kg"}
        assert bot_texts.render(db, "greeting_text", lang="kg", name="Али") == "Салам, Али!"
        assert bot_texts.render(db, "greeting_text", name="Али") == "Своё приветствие Али"  # the Russian text is untouched
        assert settings_store.all_settings(db, fresh=True)["greeting_text__kg"] == "Салам, {name}!"
        # resetting the Russian text to its default drops the Kyrgyz override as well
        assert set(settings_store.reset_keys(db, ["greeting_text"])) == {"greeting_text", "greeting_text__kg"}
        assert "кош келиңиз" in bot_texts.render(db, "greeting_text", lang="kg", name="Али")
        assert "Привет Али" in bot_texts.strip_html(bot_texts.render(db, "greeting_text", name="Али"))
        # the {sla} line of a Kyrgyz withdrawal receipt is Kyrgyz too
        accepted = bot_texts.render(db, "text_withdraw_accepted", lang="kg", player="1", amount="10", cur="KGS", queue="")
        assert "кабыл алынды" in accepted and "мүнөттөн 24 саатка" in accepted and "занимает" not in accepted
        # the instruction keeps the cash desk's city and address; the desk's own (Russian) wording is for Russian clients only
        assert "Шаар: Бишкек" in bot_texts.instruction(db, None, "kg") and "ул. PayGo Online" in bot_texts.instruction(db, None, "kg")

        class Cash:
            instructions_text = "Своя инструкция: {city}"
            withdraw_city, withdraw_address, name, emoji = "Ош", "ул. Ленина 1", "1xbet", "😎"

        assert bot_texts.instruction(db, Cash(), "ru") == "Своя инструкция: Ош"
        own_kg = bot_texts.instruction(db, Cash(), "kg")
        assert "Шаар: Ош" in own_kg and "Дарек: ул. Ленина 1" in own_kg and "Своя" not in own_kg
        # reply keyboard labels and their recognition in both languages
        assert bot_texts.menu_labels(db) == {"deposit": "📥 Пополнить", "withdraw": "📤 Вывести", "help": "✉️ Помощь"}
        assert bot_texts.menu_labels(db, "kg") == {"deposit": "📥 Толуктоо", "withdraw": "📤 Чыгаруу", "help": "✉️ Жардам"}
        assert bot_texts.match_menu(db, "📥 Толуктоо") == "deposit" and bot_texts.match_menu(db, "Чыгаруу") == "withdraw" and bot_texts.match_menu(db, "✉️ Жардам") == "help"
        assert bot_texts.match_menu(db, "📥 Пополнить") == "deposit" and bot_texts.match_menu(db, "Помощь") == "help"
        assert bot_texts.label_key("Күтүңүз, өтүнмө") == "күтүңүзөтүнмө"  # Kyrgyz letters survive the normalisation


# ------------------------------------------------------------------ the bot

@pytest.fixture
def bot(seeded, fake_provider, monkeypatch):
    monkeypatch.setenv("MAIN_BOT_TOKEN", "123:abc")
    from paygo.config import reset_settings_cache

    reset_settings_cache()
    from paygobot import main_bot

    monkeypatch.setattr(main_bot.MainBot, "strip_buttons_later", lambda self, c, m: None)
    b = main_bot.MainBot()
    b.client = FakeTelegram()
    return b


def labels(markup):
    return [b["text"] for row in (markup or {}).get("keyboard", []) for b in row]


def inline_labels(markup):
    return [b["text"] for row in (markup or {}).get("inline_keyboard", []) for b in row]


def language_in_db():
    with transaction() as db:
        return db.query(User).filter_by(telegram_id=CHAT).one().language


def set_lang(code):
    with transaction() as db:
        user_service.set_language(db, db.query(User).filter_by(telegram_id=CHAT).one(), code)


def choose(bot, code):
    """Tap a language button on the chooser — the last message the bot sent."""
    bot.handle_update({"update_id": 9, "callback_query": {"id": "cb-" + code, "data": "lang:" + code, "from": FROM, "message": {"message_id": bot.client.next_id, "chat": {"id": CHAT}}}})


def test_lang_command_switches_to_kyrgyz_and_back(bot):
    text(bot, "/start")
    kind, body, markup = bot.client.last
    assert "Привет" in bot_texts.strip_html(body) and labels(markup) == RU_LABELS and language_in_db() == "ru"
    text(bot, "/lang")
    kind, body, markup = bot.client.last
    assert kind == "send" and "Тилди тандаңыз" in body and bot.client.buttons() == ["lang:ru", "lang:kg"]
    assert inline_labels(markup) == ["Русский", "Кыргызча"]  # flags are plain emoji → dropped in premium-only mode
    choose(bot, "kg")
    assert language_in_db() == "kg"
    assert bot.client.last_of("edit")[0] == "Тил: Кыргызча"  # the chooser message becomes the confirmation
    kind, body, markup = bot.client.last
    assert kind == "send" and "кош келиңиз" in body and "Али" in body and labels(markup) == KG_LABELS  # main menu in Kyrgyz
    assert state_of()[0] == "idle"
    text(bot, "/start")
    kind, body, markup = bot.client.last
    assert "кош келиңиз" in body and "Привет" not in body and labels(markup) == KG_LABELS
    text(bot, "Толуктоо")  # the Kyrgyz reply button is recognised
    kind, body, markup = bot.client.last
    assert "Толуктоо үчүн сайтты тандаңыз" in body and state_of()[0] == "choose_cash"
    assert [b for row in markup["inline_keyboard"] for b in row if b.get("callback_data") == "cancel"][0]["text"] == "Жокко чыгаруу"
    text(bot, "Пополнить")  # the Russian label from an old keyboard still works
    assert "Толуктоо үчүн сайтты тандаңыз" in bot.client.last[1]
    text(bot, "Жардам")
    assert "@PayOperator_bot" in bot.client.last[1] and "Оператор" in bot.client.last[1]
    text(bot, "/lang")
    choose(bot, "ru")
    assert language_in_db() == "ru" and bot.client.last_of("edit")[0] == "Язык: Русский"
    kind, body, markup = bot.client.last
    assert "Привет" in bot_texts.strip_html(body) and labels(markup) == RU_LABELS and state_of()[0] == "idle"
    choose(bot, "xx")  # an unknown code is Russian, never an error
    assert language_in_db() == "ru"


def test_first_contact_takes_the_language_from_telegram(bot):
    bot.handle_update({"update_id": 1, "message": {"message_id": 1, "chat": {"id": CHAT, "type": "private"}, "from": {**FROM, "first_name": "Айбек", "language_code": "ky"}, "text": "/start"}})
    kind, body, markup = bot.client.last
    assert "кош келиңиз" in body and "Айбек" in body and labels(markup) == KG_LABELS and language_in_db() == "kg"


def test_kyrgyz_deposit_flow_and_status_notices(bot, fake_provider):
    text(bot, "/start")
    set_lang("kg")
    text(bot, "Толуктоо")
    assert "Толуктоо үчүн сайтты тандаңыз" in bot.client.last[1]
    pick_cash(bot)
    assert "боюнча ID-иңизди киргизиңиз" in bot.client.last[1] and "1xbet" in bot.client.last[1]
    text(bot, "abc")
    assert "ID — сандар гана" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "USD"
    text(bot, "123456")
    assert "Аккаунттун валютасы (USD)" in bot.client.last[1]
    fake_provider["behaviour"]["lookup_currency"] = "KGS"
    text(bot, "654321")
    assert "Толуктоо суммасын киргизиңиз" in bot.client.last[1] and "Минимум: 100" in bot.client.last[1]
    text(bot, "1000")
    caption, markup = bot.client.last_of("photo")
    assert "Сиздин ID: 654321" in caption and "Төлөнүүчү сумма: 1000." in caption and "5 мүнөттүн ичинде" in caption
    assert any("Толуктоону жокко чыгаруу" in label for label in inline_labels(markup))
    assert "скриншотун жөнөтүңүз" in bot.client.last[1]  # receipt prompt
    text(bot, "Чыгаруу")  # a withdrawal while the request is open → the notice, in Kyrgyz
    kind, body, markup = bot.client.last
    assert "активдүү толуктоо өтүнмөсү бар" in body and any("Өтүнмөнү көрсөтүү" in label for label in inline_labels(markup))
    photo(bot)
    assert "Чек алынды" in bot.client.last[1]
    # the payment arrives: the backend renders «Пополнено» in Russian, the client gets the Kyrgyz card
    from paygo.services import payments

    with transaction() as db:
        dep = db.query(Deposit).one()
        event, _ = payments.ingest_event(db, source="webhook", amount=dep.pay_amount, raw_text=f"+{dep.pay_amount} сом")
        event_id = event.id
    assert payments.process_event(event_id)["ok"]
    bot.deliver_outbox()
    kind, body, _ = bot.client.last
    assert kind == "edit_media" and "Толукталды" in body and "654321" in body and "Пополнено" not in body
    assert state_of()[0] == "idle"


def test_kyrgyz_withdraw_flow_and_operator_notices(bot, fake_provider):
    from paygo.services import withdrawals as withdrawal_service

    text(bot, "/start")
    set_lang("kg")
    text(bot, "Чыгаруу")
    assert "Чыгаруу үчүн сайтты тандаңыз" in bot.client.last[1]
    pick_cash(bot)
    assert "Капчыгыңыздын QR-кодун жөнөтүңүз" in bot.client.last[1]
    text(bot, "not a photo")
    assert "QR-коддун сүрөтү керек" in bot.client.last[1]
    photo(bot)
    assert "Чыгаруу үчүн ID-иңизди киргизиңиз" in bot.client.last[1]
    text(bot, "123456")
    kind, body, markup = bot.client.last
    assert "Чыгаруу кодун киргизиңиз" in body
    assert [b for row in markup["inline_keyboard"] for b in row if b.get("callback_data") == "instr"][0]["text"] == "Көрсөтмө"
    tap(bot, "instr")
    body = bot.client.last[1]
    assert "Чыгаруу боюнча көрсөтмө" in body and "Шаар: Бишкек" in body and "ул. PayGo Online" in body and "Артка" in inline_labels(bot.client.last[2])
    tap(bot, "back_code")
    assert "Чыгаруу кодун киргизиңиз" in bot.client.last[1]
    text(bot, "ab")
    assert "Чыгаруу кодун киргизиңиз" in bot.client.last[1] and state_of()[0] == "wait_code"
    fake_provider["behaviour"]["withdraw_ok"] = False
    text(bot, "WRONG123")
    assert "туура эмес маалымат" in bot.client.last[1] and state_of()[0] == "wait_code"
    fake_provider["behaviour"]["withdraw_ok"] = True
    text(bot, "CODE1234")
    body = bot.client.last[1]
    assert "Чыгаруу өтүнмөсү кабыл алынды" in body and "5300.00" in body and "123456" in body
    assert "Чыгаруу кезегиндеги ордуңуз: 1" in body and "мүнөттөн 24 саатка" in body and "Заявка" not in body
    assert state_of()[0] == "idle"
    # the operator takes the withdrawal and completes it — both notices come in Kyrgyz
    with transaction() as db:
        assert withdrawal_service.take(db, db.query(Withdrawal).one(), None)
    bot.deliver_outbox()
    assert "оператор иштетүүгө алды" in bot.client.last[1] and "5300.00" in bot.client.last[1]
    with transaction() as db:
        assert withdrawal_service.complete(db, db.query(Withdrawal).one(), None)
    bot.deliver_outbox()
    assert "Чыгаруу аткарылды" in bot.client.last[1] and "капчыгыңызга" in bot.client.last[1] and "Вывод" not in bot.client.last[1]


def test_kyrgyz_rejected_deposit_notice_carries_the_reason(bot, fake_provider):
    from paygo.services import deposits as deposit_service

    text(bot, "/start")
    set_lang("kg")
    text(bot, "Толуктоо")
    pick_cash(bot)
    text(bot, "123456")
    text(bot, "700")
    assert state_of()[0] == "wait_payment"
    with transaction() as db:
        assert deposit_service.reject_deposit(db, db.query(Deposit).one(), None, "Платёж не найден")
    bot.deliver_outbox()
    kind, body, _ = bot.client.last
    assert kind == "edit_media" and "Толуктоо өтүнмөсү четке кагылды" in body and "Себеби: Платёж не найден" in body and "Причина" not in body
    assert state_of()[0] == "idle"


def test_russian_client_keeps_the_russian_texts(bot, fake_provider):
    """The switch changes nothing for Russian clients: the service texts and the reply keyboard stay as before."""
    text(bot, "/start")
    text(bot, "Вывести")
    pick_cash(bot)
    photo(bot)
    text(bot, "123456")
    text(bot, "CODE1234")
    body = bot.client.last[1]
    assert "Заявка на вывод принята" in body and "Вы 1-й в очереди" in body and "от 5 минут до 24 часов" in body
    with transaction() as db:
        assert user_service.set_language(db, db.query(User).filter_by(telegram_id=CHAT).one(), "ky") == "kg"
        assert user_service.set_language(db, db.query(User).filter_by(telegram_id=CHAT).one(), "de") == "ru"
    assert language_in_db() == "ru"
