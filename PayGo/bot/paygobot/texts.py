"""Static UI strings for the client bot (buttons, service notes). Client-facing
screen texts live in system settings — see ``paygo.services.bot_texts``."""
from __future__ import annotations

T: dict[str, dict[str, str]] = {
    "menu_profile": {"ru": "👤 Профиль"},
    "menu_ref": {"ru": "🎁 Рефералка"},
    "menu_instruction": {"ru": "📋 Инструкция"},
    "menu_support": {"ru": "💬 Написать оператору"},
    "back": {"ru": "◀️ Назад"},
    "menu": {"ru": "🏠 Главное меню"},
    "cancel": {"ru": "✖️ Отмена"},
    "cancel_deposit": {"ru": "❌ Отменить пополнение"},
    "enter_new_id": {"ru": "✍️ Ввести новый ID"},
    "id_digits": {"ru": "ID — только цифры"},
    "checking_id": {"ru": "⚡ Проверяем ID…"},
    "id_check_failed": {"ru": "Не удалось проверить ID у кассы, попробуйте ещё раз"},
    "amount_digits": {"ru": "Введите сумму цифрами, без тыйынов"},
    "creating": {"ru": "⚡ Создаём заявку…"},
    "use_last_qr": {"ru": "✅ Использовать последний"},
    "new_qr": {"ru": "🗺 Ввести новый"},
    "use_last_qr_q": {"ru": "Использовать последний QR вывода?"},
    "qr_photo_only": {"ru": "Нужно фото QR, не текст"},
    "qr_saved": {"ru": "QR получен"},
    "instruction": {"ru": "📌 Инструкция"},
    "checking_code": {"ru": "⚡ Проверяем код…"},
    "code_short": {"ru": "Введите код вывода"},
    "profile_title": {"ru": "👤 Профиль PayGo"},
    "history": {"ru": "🧾 История заявок"},
    "email_btn": {"ru": "✉️ E-mail"},
    "qr_btn_add": {"ru": "🗺 Добавить QR"},
    "qr_btn_update": {"ru": "🗺 Обновить QR"},
    "enter_email": {"ru": "✉️ Введите e-mail — на него придёт код подтверждения"},
    "enter_email_code": {"ru": "Введите код из письма (6 цифр)"},
    "email_ok": {"ru": "✅ E-mail подтверждён"},
    "history_empty": {"ru": "Заявок пока нет"},
    "ref_title": {"ru": "🎁 Реферальная система"},
    "ref_share": {"ru": "📣 Поделиться ссылкой"},
    "ref_payout": {"ru": "💸 Вывести бонус"},
    "profile_qr_prompt": {"ru": "🗺 Отправьте фото QR-кода вашего банка — он сохранится для выводов"},
    "error_generic": {"ru": "❌ Что-то пошло не так, попробуйте ещё раз"},
    "active_request": {"ru": "📥 Открыть активную заявку"},
    "subscribe": {"ru": "🔐 Подпишитесь на канал и нажмите «Проверить»"},
    "check": {"ru": "✅ Проверить"},
    "not_subscribed": {"ru": "Вы ещё не подписаны"},
    "cashes_unavailable": {"ru": "Кассы временно недоступны"},
}


def t(lang: str, key: str, **kwargs: object) -> str:
    row = T.get(key) or {}
    text = row.get(lang) or row.get("ru") or key
    try:
        return text.format(**kwargs) if kwargs else text
    except Exception:
        return text
