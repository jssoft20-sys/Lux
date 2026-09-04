# База данных OnoiPay

* `schema.sql` — справочный дамп схемы PostgreSQL 16 (генерируется миграциями, применять вручную не нужно).
* `seed/cashes.example.json` — пример конфигурации касс (1xBet включена, 1win выключена).
* Рабочая схема создаётся командой `alembic upgrade head` (см. `migrations/`).
* Базовые данные (кассы, кнопки банков) — `python -m onoipay.cli seed`.

Основные сущности: `users`, `deposits`, `withdrawals`, `payment_cashes`, `payment_requisites`,
`payment_events`, `qr_records`, `support_conversations`, `support_messages`, `support_rate_limits`,
`notifications`, `push_subscriptions`, `admins`, `sessions`, `audit_logs`, `system_logs`,
`system_settings`, `jobs`, `referral_rewards`, `referral_payouts`, `email_verifications`, `bank_links`, `bot_sessions`.

Деньги — `NUMERIC(14,2)`. Уникальные ограничения и idempotency-ключи:
`deposits.idempotency_key`, `deposits.public_id`, частичный уникальный индекс по `pay_amount` для активных заявок,
`withdrawals.provider_claim_key` (касса:ID:код), `payment_events.event_key`, `notifications.event_key`,
`support_messages.dedupe_key`, `sessions.token_hash`.
