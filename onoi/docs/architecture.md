# Архитектура OnoiPay

## Процессы

| Процесс | Команда | Назначение |
|---|---|---|
| backend | `python -m onoipay.server` | HTTP API и админка на порту 7030 (uvicorn, 1 процесс; при необходимости — несколько инстансов за nginx) |
| worker | `python -m onoipay.workers.main` | фоновые задачи: платежи, истечение заявок, зависшие зачисления, мониторинг касс, push, очередь jobs, IMAP |
| bot | `python -m onoibot.main_bot` | клиентский Telegram-бот (long polling) + доставка уведомлений клиентам (`notifications.channel=telegram_user, bot=main`) |
| support | `python -m onoibot.support_bot` | бот поддержки + доставка ответов операторов и Telegram-уведомлений админам |

Все процессы используют один пакет `onoipay` (сервисы + модели) и одну базу данных. Между процессами нет HTTP-вызовов: обмен идёт через таблицы `notifications` (исходящие сообщения) и `payment_events`/`jobs` (входящие задачи). Это убирает зависания при недоступности одного из процессов: сообщение ждёт в очереди и доставляется после перезапуска, но не дублируется.

## Слои backend

```
api/            FastAPI-роутеры: auth, admin, webhooks, public (тонкие, без бизнес-логики)
services/       бизнес-логика: deposits, withdrawals, payments, cashes, support, users, notifications, auth, email, elqr, qr
providers/      адаптеры касс: servcul (1xBet Mobcash), xapi (1win); единый интерфейс lookup/deposit/withdraw/balance
workers/        фоновые циклы
models.py       схема (SQLAlchemy 2), db.py — engine/сессии/транзакции, config.py — .env
```

## Жизненный цикл операций

Статусы: `created → processing → success | failed | cancelled` (+ `expired` для пополнений).

**Пополнение.** Бот проверяет ID в кассе (lookup → валюта аккаунта) → `create_deposit` подбирает уникальную сумму с тыйынами (частичный уникальный индекс `ux_deposits_active_pay_amount`) и генерирует ELQR с суммой (тег 54, блокировка изменения суммы 32.12=12) → клиент платит по QR/кнопке банка → банковское уведомление приходит на webhook → `payment_events` (уникальный `event_key`) → `process_event` находит заявку по точной сумме, переводит её в `processing` в отдельной транзакции (только один победитель) → вызов API кассы вне транзакции → `success`/`failed` → уведомление клиенту (`event_key=deposit_success:<id>`), уведомление админам, реферальный бонус. Повторный webhook с тем же содержимым — `duplicate: true`, повторного зачисления нет.

**Вывод.** Бот проверяет ID → предлагает последний QR или новый → код из кассы → `create_withdrawal` сначала вставляет строку с `provider_claim_key = касса:ID:код` (уникально), затем вызывает Payout в кассе. Отказ кассы без подтверждения — строка удаляется, код не «сгорает» дважды. Оператор в админке: взять → выполнен / отклонить / отложить / перепроверить код.

## Идемпотентность и защита от гонок

* `deposits.idempotency_key`, `withdrawals.idempotency_key` — повтор одного действия клиента возвращает существующую заявку;
* переходы статусов проверяются в транзакции (`created/expired/failed → processing`), а сетевые вызовы кассы выполняются вне транзакции;
* `payment_events.event_key`, `notifications.event_key`, `support_messages.dedupe_key`;
* зависшие `processing` (нет ответа кассы > `STUCK_PROCESSING_TIMEOUT_SECONDS`) переводятся в `failed` с критическим уведомлением;
* старые `pending` уведомления при старте worker помечаются `expired` и не отправляются повторно.

## Боты

`onoibot/dispatcher.py`: мгновенный `answerCallbackQuery`, дедупликация update_id/callback_id, FIFO по чату, отбрасывание повторных нажатий (1 c) и нажатий во время незавершённого перехода, персистентный offset. Экран бота — одно сообщение-панель, которое редактируется на месте (`bot_sessions`). Фото QR пополнения отправляется отдельным сообщением и заменяется итоговым текстом после оплаты/истечения.

## Админка

Статический SPA (`frontend/admin`): хэш-роутер, polling `/api/live` раз в 3 с (счётчики, новые уведомления, ревизии для автообновления списков), модальные окна заявок, inline-редактирование полей (иконка ✎), Web Push через service worker с отдельным «критическим» каналом (requireInteraction, вибрация).
