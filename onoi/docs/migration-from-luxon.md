# Переход с LUXON (onoi123) на OnoiPay

Что убрано полностью: веб-приложение LUXON (`/app`: чаты, звонки, эфиры, конкурсы, DM, боты-конструкторы), маршруты `/luxon/notifications*`, Optima statement-gateway, IMAP-воркер Demir (заменён необязательным общим IMAP-источником), legacy `config.json` с паролями, JSON-состояние `storage/state.json`, старые SQLite-базы, provider-профили Melbet/888Starz/WinWin/Mostbet, логотип Binance в QR, reply-клавиатуры бота, premium-эмодзи, идентификация по селфи.

Что перенесено: интеграции касс 1xBet (Servcul CashdeskBotAPI) и 1win (X-API-KEY + агентский баланс), логика уникальных сумм с тыйынами, ELQR-генерация с блокировкой суммы, кнопки банков (MBank, О!Деньги, MegaPay, Balance, Bakai, Optima), webhook подтверждений (MacroDroid), реферальная программа, история заявок, e-mail через Timeweb SMTP, Web Push.

Перенос данных: `scripts/import_legacy.sh old/config.json --enable 1xbet` импортирует учётные данные касс (шифруются) и банковские QR-реквизиты. Пароли админки, токены ботов, internal_api_key, webhook-key и SMTP-пароль старого проекта **не** импортируются — задайте новые в `.env`.

MacroDroid: замените URL уведомлений на `https://wwweeewww.fit/onoipay/api/webhooks/payments/<WEBHOOK_SECRET>` (метод POST, тело — текст уведомления или JSON `{"text": "..."}`).
