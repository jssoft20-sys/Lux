# API (префикс `/onoipay/api`)

Все ответы JSON `{ "ok": true, ... }` или `{ "ok": false, "error": "..." }`. Cookie-сессия + заголовок `X-CSRF-Token` для POST/PATCH/DELETE. Пагинация: `page`, `size`, ответ содержит `total`.

## Аутентификация
* `POST /auth/login` `{username,password}` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/refresh` · `POST /auth/token` (bearer на 15 мин) · `POST /auth/password`
* `GET /auth/sessions` · `POST /auth/sessions/{id}/revoke` · `POST /auth/sessions/revoke-others`
* owner: `GET/POST /auth/admins`, `PATCH /auth/admins/{id}`, `POST /auth/admins/{id}/logout-all`

## Операции
* `GET /dashboard`, `GET /stats?date_from&date_to`, `GET /live` (счётчики, уведомления, ревизии)
* `GET /deposits?status=active|problem|success|all|<status,list>&q&cash&date_from&date_to&user_id`
* `GET /deposits/{id}` · `POST /deposits/{id}/action` `{action: credit|mark_success|reject|cancel, reason}` · `POST /deposits/{id}/edit` `{fields:{player_id,player_name,error}}` · `GET /deposits/{id}/qr.png`
* `GET /withdrawals?status=active|deferred|problem|success|all` · `GET /withdrawals/{id}` · `POST /withdrawals/{id}/action` `{action: take|complete|reject|fail|defer|resume|retry}` · `POST /withdrawals/{id}/edit` `{fields:{amount,player_id,error,deferred,needs_attention,qr_payload}}` · `GET /withdrawals/{id}/qr.png?kind=generated|original` · `GET /withdrawals/{id}/photo`
* `GET /payment-events` · `POST /payment-events/manual` `{amount,note}` · `POST /payment-events/{id}/retry`

## Пользователи и поддержка
* `GET /users?q&blocked` · `GET /users/{id}` · `PATCH /users/{id}` `{is_blocked,block_reason,support_blocked,note,referral_balance}` · `POST /users/{id}/message` · `POST /broadcast`
* `GET /support/conversations?status=open|waiting|auto|closed&q` · `GET /support/conversations/{id}?after_id` · `POST /support/conversations/{id}/reply` · `POST /support/conversations/{id}/status` `{status: operator|resolved|auto, note}` · `POST /support/upload`

## Кассы и настройки
* `GET /cashes` (типы и поля учётных данных в `types`) · `POST /cashes` · `PATCH /cashes/{id}` · `DELETE /cashes/{id}` · `POST /cashes/{id}/check` · `GET /cashes/{id}/lookup/{player_id}`
* `GET/POST/PATCH/DELETE /requisites`, `POST /requisites/upload` (изображение QR)
* `GET/POST /bank-links`, `DELETE /bank-links/{key}`
* `GET /settings` · `POST /settings` `{values:{...}}` (ключи и значения по умолчанию — `settings_store.DEFAULTS`)
* `GET /logs?kind=system|audit&level&category&q`
* `GET /push/config` · `POST /push/subscribe` · `POST /push/unsubscribe` · `POST /push/test`
* `POST /notifications/{id}/ack`, `POST /notifications/ack-all`

## Публичные
* `GET /health`, `GET /healthz` (корень) · `GET /qr/deposit/{public_id}.png`
* `POST|GET /webhooks/payments/{WEBHOOK_SECRET}` — подтверждение платежа (текст/JSON/форма/query); ответ `{accepted, duplicate, event_id, amount, status}`
