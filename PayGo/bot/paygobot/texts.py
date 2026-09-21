"""Static UI strings for the client bot (buttons, service notes) in Russian and Kyrgyz.
Client-facing screen texts live in system settings — see ``paygo.services.bot_texts``
(the Kyrgyz layer for those is ``bot_texts.KG_TEXTS``)."""
from __future__ import annotations

LANGS = ("ru", "kg")
# language chooser buttons — the name of a language is shown the same way to everybody
LANG_BUTTONS = (("ru", "🇷🇺 Русский"), ("kg", "🇰🇬 Кыргызча"))

T: dict[str, dict[str, str]] = {
    "menu_profile": {"ru": "👤 Профиль", "kg": "👤 Жеке кабинет"},
    "menu_ref": {"ru": "🎁 Рефералка", "kg": "🎁 Досторду чакыруу"},
    "menu_instruction": {"ru": "📋 Инструкция", "kg": "📋 Көрсөтмө"},
    "menu_support": {"ru": "💬 Написать оператору", "kg": "💬 Операторго жазуу"},
    "back": {"ru": "◀️ Назад", "kg": "◀️ Артка"},
    "menu": {"ru": "🏠 Главное меню", "kg": "🏠 Башкы меню"},
    "cancel": {"ru": "✖️ Отмена", "kg": "✖️ Жокко чыгаруу"},
    "show_request": {"ru": "📌 Показать заявку", "kg": "📌 Өтүнмөнү көрсөтүү"},
    "cancel_request": {"ru": "❌ Отменить пополнение", "kg": "❌ Толуктоону жокко чыгаруу"},
    "close": {"ru": "Закрыть", "kg": "Жабуу"},
    "cancel_deposit": {"ru": "❌ Отменить пополнение", "kg": "❌ Толуктоону жокко чыгаруу"},
    "enter_new_id": {"ru": "✍️ Ввести новый ID", "kg": "✍️ Жаңы ID киргизүү"},
    "id_digits": {"ru": "ID — только цифры", "kg": "ID — сандар гана"},
    "checking_id": {"ru": "⚡ Проверяем ID…", "kg": "⚡ ID текшерилүүдө…"},
    "id_check_failed": {"ru": "Не удалось проверить ID у кассы, попробуйте ещё раз", "kg": "Кассадан ID текшерүү мүмкүн болбоду, кайра аракет кылыңыз"},
    "amount_digits": {"ru": "Введите сумму цифрами, без тыйынов", "kg": "Сумманы сандар менен, тыйынсыз киргизиңиз"},
    "creating": {"ru": "⚡ Создаём заявку…", "kg": "⚡ Өтүнмө түзүлүүдө…"},
    "use_last_qr": {"ru": "✅ Использовать последний", "kg": "✅ Акыркысын колдонуу"},
    "new_qr": {"ru": "🗺 Ввести новый", "kg": "🗺 Жаңысын киргизүү"},
    "use_last_qr_q": {"ru": "Использовать последний QR вывода?", "kg": "Акыркы чыгаруу QR-кодун колдоносузбу?"},
    "qr_photo_only": {"ru": "Нужно фото QR или ссылка из банка (MBank, Finik, Optima…)", "kg": "QR-коддун сүрөтү же банктын шилтемеси керек (MBank, Finik, Optima…)"},
    "qr_link_ok": {"ru": "Ссылка получена", "kg": "Шилтеме алынды"},
    "qr_bank_off": {"ru": "❌ {bank}: на этот банк сейчас не переводим. Отправьте QR или ссылку другого банка", "kg": "❌ {bank}: бул банкка азырынча которбойбуз. Башка банктын QR-кодун же шилтемесин жөнөтүңүз"},
    "qr_saved": {"ru": "QR получен", "kg": "QR алынды"},
    "instruction": {"ru": "📌 Инструкция", "kg": "📌 Көрсөтмө"},
    "checking_code": {"ru": "⚡ Проверяем код…", "kg": "⚡ Код текшерилүүдө…"},
    "code_short": {"ru": "Введите код вывода", "kg": "Чыгаруу кодун киргизиңиз"},
    "profile_title": {"ru": "👤 Профиль PayGo", "kg": "👤 PayGo жеке кабинети"},
    "history": {"ru": "🧾 История заявок", "kg": "🧾 Өтүнмөлөр тарыхы"},
    "email_btn": {"ru": "✉️ E-mail", "kg": "✉️ Электрондук почта"},
    "qr_btn_add": {"ru": "🗺 Добавить QR", "kg": "🗺 QR кошуу"},
    "qr_btn_update": {"ru": "🗺 Обновить QR", "kg": "🗺 QR жаңылоо"},
    "enter_email": {"ru": "✉️ Введите e-mail — на него придёт код подтверждения", "kg": "✉️ E-mail дарегиңизди киргизиңиз — ага ырастоо коду келет"},
    "enter_email_code": {"ru": "Введите код из письма (6 цифр)", "kg": "Каттагы кодду киргизиңиз (6 сан)"},
    "email_ok": {"ru": "✅ E-mail подтверждён", "kg": "✅ E-mail ырасталды"},
    "history_empty": {"ru": "Заявок пока нет", "kg": "Азырынча өтүнмөлөр жок"},
    "ref_title": {"ru": "🎁 Реферальная система", "kg": "🎁 Реферал системасы"},
    "ref_share": {"ru": "📣 Поделиться ссылкой", "kg": "📣 Шилтеме менен бөлүшүү"},
    "ref_payout": {"ru": "💸 Вывести бонус", "kg": "💸 Бонусту чыгаруу"},
    "profile_qr_prompt": {"ru": "🗺 Отправьте фото QR-кода вашего банка — он сохранится для выводов", "kg": "🗺 Банкыңыздын QR-кодунун сүрөтүн жөнөтүңүз — ал чыгаруулар үчүн сакталат"},
    "error_generic": {"ru": "❌ Что-то пошло не так, попробуйте ещё раз", "kg": "❌ Бир нерсе туура эмес болду, кайра аракет кылыңыз"},
    "active_request": {"ru": "📥 Открыть активную заявку", "kg": "📥 Активдүү өтүнмөнү ачуу"},
    "subscribe": {"ru": "🔐 Подпишитесь на канал и нажмите «Проверить»", "kg": "🔐 Каналга жазылып, «Текшерүү» баскычын басыңыз"},
    "check": {"ru": "✅ Проверить", "kg": "✅ Текшерүү"},
    "not_subscribed": {"ru": "Вы ещё не подписаны", "kg": "Сиз азырынча жазыла элексиз"},
    "cashes_unavailable": {"ru": "Кассы временно недоступны", "kg": "Кассалар убактылуу жеткиликсиз"},
    # language switch (/lang, the 🌐 button)
    "lang_button": {"ru": "🌐 Язык / Тил", "kg": "🌐 Тил / Язык"},
    "lang_choose": {"ru": "🌐 Выберите язык / Тилди тандаңыз", "kg": "🌐 Тилди тандаңыз / Выберите язык"},
    "lang_switched": {"ru": "✅ Язык: Русский", "kg": "✅ Тил: Кыргызча"},
    # service lines of the flows (the editable screen texts live in settings)
    "friend": {"ru": "друг", "kg": "дос"},
    "rating_thanks": {"ru": "Спасибо за оценку!", "kg": "Бааңыз үчүн рахмат!"},
    "ref_joined": {"ru": "🎁 Вы присоединились по приглашению", "kg": "🎁 Сиз чакыруу боюнча кошулдуңуз"},
    "phone_prompt": {"ru": "📱 Подтвердите номер телефона кнопкой ниже", "kg": "📱 Төмөнкү баскыч менен телефон номериңизди ырастаңыз"},
    "phone_button": {"ru": "Подтвердить номер", "kg": "Номерди ырастоо"},
    "phone_own_only": {"ru": "❌ Отправьте именно свой контакт", "kg": "❌ Өзүңүздүн контактыңызды гана жөнөтүңүз"},
    "choose_saved_id": {"ru": "Выберите сохранённый ID или введите новый", "kg": "Сакталган ID тандаңыз же жаңысын киргизиңиз"},
    "bank_qr": {"ru": "QR банка", "kg": "Банк QR-коду"},
    "minutes_left": {"ru": " (осталось {left} мин)", "kg": " ({left} мүнөт калды)"},
    "active_deposit_notice": {
        "ru": "⏳ У вас есть активная заявка на пополнение <b>{request}</b> на {amount} {cur}{left}.\nСначала оплатите её или отмените — потом можно оформить вывод.",
        "kg": "⏳ Сизде <b>{request}</b> номерлүү {amount} {cur} суммасына активдүү толуктоо өтүнмөсү бар{left}.\nАдегенде аны төлөңүз же жокко чыгарыңыз — андан кийин чыгарууну тариздөөгө болот.",
    },
    "queue_line": {"ru": "📊 Вы {pos}-й в очереди на вывод (в работе: {size})", "kg": "📊 Чыгаруу кезегиндеги ордуңуз: {pos} (иштетилүүдө: {size})"},
    # status notices the backend renders in Russian — rebuilt for a Kyrgyz client when delivered
    "reason_line": {"ru": "Причина: {reason}", "kg": "Себеби: {reason}"},
    "reason_none": {"ru": "Если нужна проверка — напишите оператору.", "kg": "Текшерүү керек болсо — операторго жазыңыз."},
    "deposit_updated": {
        "ru": "✏️ Оператор изменил сумму заявки: <b>{amount} {cur}</b>. Оплатите ровно эту сумму по новому QR.",
        "kg": "✏️ Оператор өтүнмөнүн суммасын өзгөрттү: <b>{amount} {cur}</b>. Жаңы QR боюнча так ушул сумманы төлөңүз.",
    },
}


def norm_lang(value: object) -> str:
    """``ru`` / ``kg`` from whatever is stored or sent by Telegram (``ky`` is Kyrgyz too); anything else is Russian."""
    value = str(value or "").strip().lower()
    return "kg" if value in {"kg", "ky"} else "ru"


def t(lang: str, key: str, **kwargs: object) -> str:
    row = T.get(key) or {}
    text = row.get(lang) or row.get("ru") or key
    try:
        return text.format(**kwargs) if kwargs else text
    except Exception:
        return text
