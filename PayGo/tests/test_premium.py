"""Premium-only emoji: texts, inline buttons and reply keyboards of the client bot."""
from __future__ import annotations

from paygo.services import bot_texts

STATE = {"enabled": True, "strict": True, "map": bot_texts.parse_emoji_map("")}


def test_plain_emoji_become_premium_or_disappear():
    out = bot_texts.premiumize("✅ Пополнено\n💸 1 500 KGS\n🆔 123", STATE)
    assert out.startswith("Пополнено\n")  # ✅ has no premium id → dropped in strict mode
    assert '<tg-emoji emoji-id="5255981634527704754">💸</tg-emoji> 1 500 KGS' in out
    assert "🆔" not in out
    # idempotent: existing entities are left alone
    assert bot_texts.premiumize(out, STATE) == out
    soft = bot_texts.premiumize("✅ Готово", {**STATE, "strict": False})
    assert soft == "✅ Готово"
    assert bot_texts.premiumize("✅ Готово", {**STATE, "enabled": False}) == "✅ Готово"


def test_map_from_settings_text_and_button_labels():
    table = bot_texts.parse_emoji_map("✅ 5000000000000000001\n🆔 = 5000000000000000002\n😎 off")
    assert table["✅"] == "5000000000000000001" and table["🆔"] == "5000000000000000002" and "😎" not in table
    state = {"enabled": True, "strict": True, "map": table}
    assert bot_texts.button_label("✅ Использовать последний", state) == ("Использовать последний", "5000000000000000001")
    assert bot_texts.button_label("😎 1xbet", state, icon="5240186449915039482") == ("1xbet", "5240186449915039482")
    assert bot_texts.button_label("🎁 Бонус", state) == ("Бонус", "")
    assert bot_texts.button_label("Закрыть", state) == ("Закрыть", "")
    markup = bot_texts.premium_markup({"inline_keyboard": [[{"text": "❌ Отмена", "callback_data": "cancel"}]]}, STATE)
    assert markup["inline_keyboard"][0][0] == {"text": "Отмена", "callback_data": "cancel", "icon_custom_emoji_id": "5384234898494088007"}
    assert bot_texts.plain_label("📥 Пополнить", STATE) == "Пополнить"
    assert bot_texts.plain_label("📥 Пополнить", {**STATE, "strict": False}) == "📥 Пополнить"
