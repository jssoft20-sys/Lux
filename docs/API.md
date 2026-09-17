# Somex API

Base URL: `/api/v1`. Все ответы JSON. Ошибки: `{ statusCode, code, message }`. Swagger в dev: `/api/docs`.
Заголовки клиента: `Authorization: Bearer <access>`, `X-Device-Id: <fingerprint>` (обязателен для привязки устройства), `X-Idempotency-Key` (создание вывода).

## Публичные
| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | статус БД/Redis |
| GET | `/catalog/banks` · `/catalog/regions` · `/catalog/rates` | справочники |
| GET | `/p2p/ads?side=BUY\|SELL&bank=&region=&amount=&priceMin=&priceMax=&online=1` | рынок (side — намерение зрителя) |
| POST | `/webhooks/didit` | вебхук KYC (HMAC) |

## Аутентификация
| POST `/auth/otp/request` | `{ phone }` → `{ requestId, channel, ttlSec, resendAfterSec, maskedPhone, devCode? }` |
|---|---|
| POST `/auth/otp/verify` | `{ phone, code, device? }` → `{ accessToken, refreshToken, expiresIn, user, isNewUser, isNewDevice }` |
| POST `/auth/refresh` | `{ refreshToken }` → новая пара (ротация) |
| POST `/auth/logout` · `/auth/logout-all` | |
| POST `/auth/pin` · `/auth/pin/verify` → `{ stepUpToken }` · `/auth/biometric` | PIN / step-up |

## Профиль `/me`
`GET /me`, `PATCH /me {nickname, language}`, `GET /me/limits`, `GET/DELETE /me/devices[/:id]`, `GET/DELETE /me/sessions[/:id]`, `GET/POST/DELETE /me/payment-methods[/:id]` (`{ bankCode, accountNumber }` — владелец из KYC), `GET /me/notifications`, `POST /me/notifications/read`, `GET /me/history`, `GET/POST /me/support`.

## KYC
`GET /kyc/status`, `POST /kyc/session` → `{ mode: 'didit'|'sandbox', url }`, `POST /kyc/refresh`, `POST /kyc/sandbox/complete` (dev).

## Кошелёк `/wallet`
`GET /wallet`, `GET /wallet/deposit-address?network=TRON`, `GET /wallet/deposits`, `GET /wallet/withdrawals`, `GET /wallet/withdraw-addresses`, `POST /wallet/withdrawals/quote {network, amount}`, `POST /wallet/withdrawals {network, address, amount, stepUpToken?}` → `{ withdrawal, otpRequired, otp }`, `POST /wallet/withdrawals/:id/confirm {code}`, `POST /wallet/withdrawals/:id/cancel`.

## P2P `/p2p`
| Метод | Путь | Тело |
|---|---|---|
| GET | `/p2p/ads/:id` · `/p2p/my-ads` | |
| POST/PATCH/DELETE | `/p2p/ads[/:id]` | `{ side, price, minAmountFiat, maxAmountFiat, totalAmount, bankCode, region, terms, paymentWindowMin }` |
| POST | `/p2p/orders` | `{ adId, amountFiat \| amountUsdt, paymentMethodId?, agreedToRules }` → сделка (эскроу заблокирован, реквизиты раскрыты покупателю) |
| GET | `/p2p/orders?filter=active\|completed` · `/p2p/orders/:id` · `/p2p/orders/:id/events` | роль-зависимое представление (`payment` для покупателя, `expected` для продавца, `permissions`) |
| POST | `/p2p/orders/:id/declare-payment` | `{ bankCode, ownAccountConfirmed, exactAmountConfirmed, nameAndBankConfirmed, receiptFileId? }` |
| POST | `/p2p/orders/:id/release` | `{ checkedBankApp, senderNameMatches, amountMatches, stepUpToken?, otpCode? }` → `{ otpRequired, otp }` или `{ order }` |
| POST | `/p2p/orders/:id/cancel` · `/dispute` · `/rate` · `/check-sender` | |
| GET/POST | `/p2p/orders/:id/messages` | `{ text?, fileId? }` |
| GET | `/p2p/chats/unread` | |

WebSocket `/chat` (socket.io, `auth.token`): `join {orderId}`, `leave`, `typing`; события `message`, `order`.

## Файлы
`POST /files?kind=RECEIPT|AVATAR|DISPUTE_EVIDENCE|CHAT|SUPPORT` (multipart `file`) → `{ id, mime, size, scanStatus }`; `GET /files/:id` (участники/владелец).

## Admin `/admin` (Bearer admin-token)
Auth: `POST /admin/auth/login` → `{ mfaRequired, tmpToken, setup? }` → `POST /admin/auth/totp {tmpToken, code}` → токены; `refresh`, `logout`, `me`, `totp/setup`, `totp/enable`, `password`.

| Область | Эндпоинты |
|---|---|
| Dashboard | `GET dashboard/stats` · `dashboard/charts?days=` · `dashboard/activity` |
| Users | `GET users?q&status&kyc&minRisk` · `GET users/:id` · `POST users/:id/{freeze,restrict,ban,unfreeze,flags,force-logout,reset-devices,reset-pin,note,balance-adjust,kyc-level}` |
| KYC | `GET kyc?status` · `GET kyc/:id` · `POST kyc/:id/{approve,reject}` |
| Wallet | `GET wallet` · `wallet/ledger` · `wallet/reconcile` · `POST wallet/hot/{sync,limits}` |
| Deposits | `GET deposits?status` · `POST deposits/:id/{release,reject}` |
| Withdrawals | `GET withdrawals?status` · `POST withdrawals/:id/{approve,reject,retry}` |
| P2P | `GET p2p/ads` · `POST p2p/ads/:id/status` · `GET p2p/orders` · `GET p2p/orders/:id` (события, чат, реквизиты) · `POST p2p/orders/:id/cancel` |
| Disputes | `GET disputes` · `GET disputes/:id` · `POST disputes/:id/{assign,resolve}` (`RELEASE\|REFUND\|PARTIAL`) |
| Risk | `GET risk/events` · `POST risk/events/:id/review` · `GET risk/rules` · `PATCH risk/rules/:code` |
| Devices | `GET devices` · `GET devices/clusters` · `POST devices/:id/block` |
| Blacklist | `GET/POST/DELETE blacklist[/:id]` · `POST blacklist/check` |
| Audit | `GET audit` · `GET audit/verify` |
| Catalog | `GET/PATCH banks[/:code]` · `GET rates` · `POST rates/USDT-KGS` |
| Support | `GET support` · `POST support/:id/answer` |
| Settings | `GET settings` · `PUT settings {values}` · `POST settings/test/{wappi,smtp,didit,tron,clamav,storage}` · `GET system` |
| Admins | `GET/POST admins` · `PUT admins/:id` · `POST admins/:id/reset-totp` |
| Dev | `POST dev/simulate-deposit {userId, amount}` (только `DEV_SIMULATE_CHAIN=true`) |
