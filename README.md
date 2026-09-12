# LuxOn Optima Hub

Мультикошельковая система для **optimabusiness.kg**: автоматическая авторизация
через Chromium (reCAPTCHA + TOTP), хранение нескольких кошельков в админке и
выдача транзакций в формате **JSON** по ключу — для просмотра прямо в терминале,
с обновлением новых операций в реальном времени.

## Почему Chromium

Вход на optimabusiness.kg защищён **Google reCAPTCHA Enterprise**: запрос
`GET /api/v1/login` требует заголовок `captoken`, который невозможно получить
обычным HTTP-клиентом — его выдаёт только реальный браузер. Поэтому логин
выполняет headless **Chromium** (Playwright): он сам проходит reCAPTCHA, мы
вводим TOTP, забираем cookie сессии (`SESSION`/`SERVERID`) и дальше работаем
быстрыми HTTP-запросами к GraphQL. Браузер запускается **только при входе**,
поэтому получение транзакций остаётся мгновенным.

Если сессия закончилась (HTTP 401/403 или истёк срок) — система **сама заново
логинится** через Chromium и продолжает работу.

## Компоненты

| Файл | Назначение |
|------|-----------|
| `optima.py` | Сервер-хаб: админка, база, движок транзакций, API, SSE-стрим |
| `optima_login.mjs` | Помощник входа на Playwright/Chromium (выдаёт cookie сессии) |
| `optima_html.py` | Веб-интерфейс админки/кабинета (встроен в сервер) |

Данные (логины, пароли, TOTP, cookie) хранятся в SQLite и **шифруются**
(AES-подобная схема на HMAC-SHA256, encrypt-then-MAC) локальным ключом
`data/master.key`. В репозиторий секреты не попадают.

## Требования

- **Python 3.9+** (только стандартная библиотека — внешних пакетов не нужно).
- **Node.js 18+** и **Playwright Chromium** — для входа.

## Установка

```bash
# 1. Зависимости для входа (Chromium через Playwright)
npm install
npx playwright install chromium        # один раз скачивает браузер

# 2. Конфигурация
cp .env.example .env
# отредактируйте .env (как минимум OPTIMA_ADMIN_PASSWORD)
```

## Быстрый старт

Файл `.env` из рабочего каталога загружается автоматически (ничего
дополнительно экспортировать не нужно).

```bash
# (необязательно) сразу привязать свой кошелёк из OPTIMA_SEED_*
python3 optima.py --init

# запустить сервер
python3 optima.py --serve
# → http://127.0.0.1:7094/
```

Откройте `http://127.0.0.1:7094/` и войдите **паролем администратора**.
Пароль задаётся в `OPTIMA_ADMIN_PASSWORD` (в `.env`). Если переменная пустая —
при первом запуске генерируется случайный пароль и сохраняется в
`data/admin_password.txt` (и один раз печатается в логах).

## Админка

- **Кошельки** — список привязанных кошельков: компания, счёт, баланс, статус,
  ошибки, время последней синхронизации.
- **+ Кошелёк** — привязать новый по **логину, паролю и TOTP-ключу**
  (base32-секрет из Google Authenticator). После добавления сразу показываются
  ключи и примеры запросов.
- **Показать ключи** — `API-ключ` (для терминала/машин) и `Client-ключ`
  (для read-only веб-кабинета конкретного кошелька).
- **Ротация API**, **Синхронизировать сейчас**, **Удалить**.
- Транзакции с фильтром по датам/поиску и живым обновлением.

## Транзакции в терминале (JSON)

У каждого кошелька есть `API-ключ` и свой эндпоинт `…/optima/api/<slug>`.

```bash
# JSON всех транзакций
curl "http://127.0.0.1:7094/optima/api/<slug>?key=<API-ключ>"

# принудительно подтянуть свежие прямо сейчас
curl "http://127.0.0.1:7094/optima/api/<slug>?fresh=1&key=<API-ключ>"

# фильтры: период, поиск, лимит, конкретная операция
curl "http://.../optima/api/<slug>?key=<API>&from=2026-09-01&to=2026-09-30&q=QR&limit=200"

# можно передавать ключ заголовком вместо query
curl -H "Authorization: Bearer <API-ключ>" "http://.../optima/api/<slug>"
```

Пример ответа:

```json
{
  "ok": true,
  "wallet": "ИП ...",
  "account": "10918xxxxxxxxxxx",
  "balance": "43929.47",
  "currency": "KGS",
  "count": 8,
  "transactions": [
    {
      "id": "4822645",
      "date": "2026-09-12",
      "time": "21:28:36",
      "datetime": "2026-09-12 21:28:36",
      "amount": 43000.0,
      "currency": "KGS",
      "type": "QR",
      "status": "ERROR",
      "direction": "out",
      "transferNum": "OB-2128367BIuLr",
      "recipientName": "...",
      "purpose": "..."
    }
  ]
}
```

### Живой поток новых операций (реальное время)

Server-Sent Events — новые транзакции приходят **в момент появления**:

```bash
curl -N "http://127.0.0.1:7094/optima/api/<slug>/stream?key=<API-ключ>"
# event: hello  { ... последние операции ... }
# event: transaction  { "tx": { ...новая операция... } }
```

Сам фоновый опрос идёт каждые `OPTIMA_SYNC_SECONDS` (по умолчанию 3 c), а веб-панель
обновляется каждые ~2.5 c и дополнительно слушает SSE для мгновенного показа.

## Безопасность

- Секреты шифруются локальным `master.key` (права `600`), в git не коммитятся.
- API-ключ можно ограничить по IP (`allowed_ip`, отдельные адреса или CIDR).
- Админ-сессия — подписанная cookie (HttpOnly, SameSite=Strict) + CSRF-токен.
- Рекомендуется запускать за HTTPS-реверс-прокси и ограничить доступ к админке.

## Продакшн (systemd + nginx)

Пример unit-файла `/etc/systemd/system/optima.service`:

```ini
[Unit]
Description=LuxOn Optima Hub
After=network.target

[Service]
WorkingDirectory=/opt/luxon-optima
EnvironmentFile=/opt/luxon-optima/.env
ExecStart=/usr/bin/python3 optima.py --serve
Restart=always
User=optima

[Install]
WantedBy=multi-user.target
```

nginx (проксирование + корректная работа SSE):

```nginx
location /optima/ {
    proxy_pass http://127.0.0.1:7094;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;          # важно для /stream (SSE)
    proxy_read_timeout 3600s;
}
```

Задайте `OPTIMA_PUBLIC_URL=https://ваш-домен` — тогда в панели и curl-примерах
будут правильные публичные адреса.

## CLI

```bash
python3 optima.py --init     # создать БД + админ, при наличии OPTIMA_SEED_* — привязать кошелёк
python3 optima.py --serve    # запустить сервер (поведение по умолчанию)
python3 optima.py --add      # добавить кошелёк из OPTIMA_SEED_*
python3 optima.py --keys     # показать кошельки и их ключи/эндпоинты
python3 optima.py --check    # проверка окружения (node, Chromium helper, БД)
```

## Переменные окружения

Полный список — в `.env.example`. Ключевые: `OPTIMA_ADMIN_PASSWORD`,
`OPTIMA_PORT`, `OPTIMA_PUBLIC_URL`, `OPTIMA_SYNC_SECONDS`, `OPTIMA_CHROMIUM_PATH`,
`OPTIMA_DIR`, `OPTIMA_SEED_*`.
