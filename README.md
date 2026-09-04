# OnoiPay

Платёжная касса для Telegram: пополнение и вывод средств игроков через кассы букмекеров (сейчас активна **1xBet**, 1win перенесена и выключена), бот поддержки с автоматизацией, админ-панель `https://wwweeewww.fit/onoipay/`.

```
onoi/
├── backend/onoipay/     FastAPI-бэкенд: API, сервисы, провайдеры касс, воркеры
├── bot/onoibot/         Telegram-боты: основной (@OnoiPayBot) и поддержка (@OnoiHelpBot)
├── frontend/admin/      Админ-панель (статический SPA без сборки)
├── database/            Справочная схема PostgreSQL, примеры seed
├── migrations/          Alembic-миграции
├── deployment/          systemd-юниты, nginx
├── scripts/             install, migrate, create_admin, backup, restore, update, healthcheck
├── docs/                Архитектура, безопасность, поддержка, API, эксплуатация
├── tests/               pytest (SQLite и PostgreSQL)
├── .env.example         Шаблон переменных окружения
├── docker-compose.yml   Альтернативный запуск в Docker
└── README.md
```

Процессы: **backend** (HTTP :7030), **worker** (фоновые задачи), **bot** (клиентский бот), **support** (бот поддержки). Все используют одну базу PostgreSQL и один `.env`.

---

## 1. Требования

* Ubuntu 22.04/24.04 (или Debian 12), root-доступ
* Python 3.11+
* PostgreSQL 14+ (рекомендуется 16)
* nginx с HTTPS (Let's Encrypt) на домене `wwweeewww.fit`
* Токены двух Telegram-ботов (BotFather), доступ к API кассы 1xBet (Servcul: логин, пароль кассира, cashdeskId, hash)
* Почта Timeweb для SMTP (необязательно, нужна для подтверждения e-mail)

## 2. Установка

```bash
# распаковать архив и запустить установщик от root
unzip onoi.zip -d /home/onoi/ && cd /home/onoi/onoi
bash scripts/install.sh
```

Скрипт создаёт пользователя `onoi`, каталоги `/home/onoi/{onoi,data,logs,backups}`, виртуальное окружение, PostgreSQL-базу `onoipay`, генерирует секреты в `.env`, применяет миграции, seed и ставит systemd-юниты. Повторный запуск безопасен.

Ручная установка (если без скрипта):

```bash
useradd -m -s /bin/bash onoi
mkdir -p /home/onoi/{data,logs,backups}
cp -r onoi /home/onoi/onoi && chown -R onoi:onoi /home/onoi
sudo -u onoi bash -c 'cd /home/onoi/onoi && python3 -m venv venv && venv/bin/pip install -r requirements.txt zxing-cpp && venv/bin/pip install -e .'
```

## 3. Создание .env

```bash
cp .env.example .env
venv/bin/python -m onoipay.cli gen-secrets     # печатает SECRET_KEY, JWT_SECRET, SESSION_SECRET, WEBHOOK_SECRET, ENCRYPTION_KEY, VAPID_*
nano .env                                       # вставьте секреты, токены ботов, DATABASE_URL, SMTP_*
chmod 600 .env
```

Обязательные поля: `DATABASE_URL`, пять секретов, `MAIN_BOT_TOKEN`, `SUPPORT_BOT_TOKEN`, `PUBLIC_URL=https://wwweeewww.fit`, `BASE_PATH=/onoipay`, `PORT=7030`.
`ADMIN_TELEGRAM_CHAT_IDS` — Telegram ID операторов для критических уведомлений через бота поддержки (узнать ID: написать боту, посмотреть в разделе «Пользователи»).
Все секреты — только в `.env` (права 600), в Git и в коде их нет. Старые секреты из прежнего проекта не используются.

## 4. Создание БД

```bash
sudo -u postgres psql -c "CREATE USER onoi WITH PASSWORD 'СИЛЬНЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE onoipay OWNER onoi;"
# в .env: DATABASE_URL=postgresql+psycopg://onoi:СИЛЬНЫЙ_ПАРОЛЬ@127.0.0.1:5432/onoipay
```

База создаётся чистой. Старая база LUXON не используется. Перенос касс 1xBet/1win и банковских QR-реквизитов из старого `config.json` (пароли/токены старой панели не переносятся):

```bash
scripts/import_legacy.sh /path/to/old/config.json --enable 1xbet
```

## 5. Миграции

```bash
scripts/migrate.sh              # = alembic upgrade head
venv/bin/python -m onoipay.cli seed   # кассы 1xBet (вкл) и 1win (выкл), кнопки банков — идемпотентно
```

Новая миграция после изменения моделей: `venv/bin/alembic revision --autogenerate -m "..."`.

## 6. Создание администратора

```bash
scripts/create_admin.sh --username admin --role owner      # пароль запросит интерактивно
```

Роли: `viewer` (просмотр), `operator` (заявки, поддержка, пользователи), `admin` (+ кассы, настройки, логи), `owner` (+ администраторы, безопасность). Пароль: минимум 10 символов, буквы разного регистра и цифра.

## 7. Запуск backend

```bash
systemctl enable --now onoipay-backend
curl -s http://127.0.0.1:7030/healthz        # {"ok": true, ...}
```

Вручную (для отладки): `set -a; . ./.env; set +a; venv/bin/python -m onoipay.server`.

## 8. Запуск бота

```bash
systemctl enable --now onoipay-bot        # клиентский бот @OnoiPayBot
systemctl enable --now onoipay-support    # бот поддержки @OnoiHelpBot
```

Боты работают через long polling (webhook Telegram не нужен), состояние диалогов хранится в БД, кнопки inline-only.

## 9. Запуск workers

```bash
systemctl enable --now onoipay-worker
```

Worker: сопоставление платежей, истечение неоплаченных заявок, восстановление зависших зачислений, мониторинг балансов касс с автоотключением, Web Push/Telegram-уведомления админам, очередь задач, автозакрытие тихих обращений, необязательный IMAP-источник платежей.

## 10. Настройка домена

Добавьте в существующий `server { listen 443 ssl; server_name wwweeewww.fit; ... }`:

```nginx
include /etc/nginx/snippets/onoipay.conf;
```

и один раз в `http {}` (или перед server):

```nginx
limit_req_zone $binary_remote_addr zone=onoipay_login:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=onoipay_hook:10m rate=120r/m;
```

Сниппеты копирует `install.sh` (`deployment/nginx/`). Проксируется только префикс `/onoipay/`, другие сервисы сервера не затрагиваются. Проверка: `nginx -t && systemctl reload nginx`.

Webhook подтверждений платежей (MacroDroid / банковский форвардер): `https://wwweeewww.fit/onoipay/api/webhooks/payments/<WEBHOOK_SECRET>` (POST текстом, JSON, формой или GET-параметрами; альтернатива — заголовок `X-Webhook-Key` или подпись `X-Signature` = HMAC-SHA256 тела).

## 11. Настройка HTTPS

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d wwweeewww.fit
```

Приложение за прокси доверяет `X-Forwarded-Proto` (`TRUST_PROXY=true`), cookie ставятся с `Secure`, `HttpOnly`, `SameSite=Strict`; HSTS включён.

## 12. systemd / deployment

Юниты: `deployment/systemd/onoipay-{backend,worker,bot,support}.service` (пользователь `onoi`, `Restart=always`, логи в `/home/onoi/logs/*.log`).

```bash
systemctl status onoipay-backend onoipay-worker onoipay-bot onoipay-support
journalctl -u onoipay-backend -n 100
tail -f /home/onoi/logs/backend.log
```

Docker-вариант: `docker compose up -d` (PostgreSQL + все процессы, порт 7030 на 127.0.0.1).

## 13. Health check

```bash
scripts/healthcheck.sh                                   # backend, БД, все юниты
curl -s http://127.0.0.1:7030/healthz                    # 200 / 503
curl -s https://wwweeewww.fit/onoipay/api/health         # версия, БД, наличие токенов
```

## 14. Backup

```bash
scripts/backup.sh          # /home/onoi/backups/onoipay-YYYYmmdd-HHMM.tar.gz (pg_dump + data/ + .env), хранит 14 копий
crontab -u onoi -e         # 0 3 * * * /home/onoi/onoi/scripts/backup.sh
```

## 15. Rollback

```bash
systemctl stop onoipay-bot onoipay-support onoipay-worker onoipay-backend
scripts/restore.sh /home/onoi/backups/onoipay-YYYYmmdd-HHMM.tar.gz
venv/bin/alembic downgrade -1        # только если нужно откатить схему на предыдущую версию кода
systemctl start onoipay-backend onoipay-worker onoipay-bot onoipay-support
```

## 16. Обновление проекта

```bash
scripts/update.sh /path/to/new/onoi   # backup → остановка ботов/воркера → rsync → pip → alembic upgrade → рестарт → healthcheck
```

При ошибке миграции скрипт останавливается, восстановление — `scripts/restore.sh` из только что созданного бэкапа.

---

## Разработка и тесты

```bash
python3 -m venv venv && venv/bin/pip install -r requirements-dev.txt && venv/bin/pip install -e .
cp .env.example .env    # APP_ENV=dev, DATABASE_URL=sqlite:///./data/dev.sqlite3
venv/bin/ruff check backend bot
venv/bin/pytest -q                                        # SQLite
TEST_DATABASE_URL=postgresql+psycopg://onoi:pw@127.0.0.1/onoi_test venv/bin/pytest -q   # PostgreSQL
```

Тесты покрывают: создание/оплату/ошибку пополнения, повторный webhook (идемпотентность), вывод и дубли кода, QR (генерация и декодирование), несовпадение валют, последний QR, поддержку и антифлуд, админские действия, авторизацию (CSRF, RBAC, brute force), уведомления без дублей, диспетчер кнопок бота.

Документация: `docs/architecture.md`, `docs/security.md`, `docs/support-bot.md`, `docs/api.md`, `docs/operations.md`, `docs/migration-from-luxon.md`.
