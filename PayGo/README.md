# PayGo

Платёжная касса для Telegram: пополнение и вывод средств игроков через кассы букмекеров (сейчас активна **1xBet**, 1win перенесена и выключена), бот поддержки с автоматизацией, админ-панель `https://wwweeewww.fit/paygo/` (мобильный интерфейс в стиле прежней панели: нижняя навигация Главная / История / Чат / Поиск / Меню, карточки заявок, плитки меню — Управление PayGo, Статистика, Кассы, Выписка, Платёжка, Рассылка, Безопасность, Быстрые ответы, Логи, Настройки, Первая линия).

```
paygo/
├── backend/paygo/     FastAPI-бэкенд: API, сервисы, провайдеры касс, воркеры
├── bot/paygobot/         Telegram-боты: основной (@PayGoXBot) и поддержка (@PayOperator_bot)
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

Процессы: **backend** (HTTP :7035), **worker** (фоновые задачи), **bot** (клиентский бот), **support** (бот поддержки). Все используют одну базу PostgreSQL и один `.env`.

---

## 1. Требования

* Ubuntu 22.04/24.04 (или Debian 12), root-доступ
* Python 3.10+ (Ubuntu 22.04 — 3.10, Ubuntu 24.04 — 3.12; установщик берёт самый новый)
* PostgreSQL 14+ (рекомендуется 16)
* nginx с HTTPS (Let's Encrypt) на домене `wwweeewww.fit`
* Токены двух Telegram-ботов (BotFather), доступ к API кассы 1xBet (Servcul: логин, пароль кассира, cashdeskId, hash)
* Почта Timeweb для SMTP (необязательно, нужна для подтверждения e-mail)

## 2. Установка

```bash
# архив лежит в /home/PayGo.zip; распаковать в /home/PayGo и запустить установщик от root
apt install -y unzip
unzip -o /home/paygo.zip -d /home/ && cd /home/PayGo
bash scripts/install.sh
```

Скрипт ставит пакеты (Python, PostgreSQL, nginx), создаёт пользователя `paygo`, каталоги `/home/PayGo/{paygo,data,logs,backups}`, виртуальное окружение, пользователя и базу PostgreSQL `paygo` (пароль записывает в `.env`), генерирует секреты, если `.env` ещё нет (готовый `.env` из архива не трогает), применяет миграции, seed, ставит systemd-юниты и nginx-сниппеты. Повторный запуск безопасен.

Ручная установка (если без скрипта):

```bash
useradd -m -s /bin/bash paygo
mkdir -p /home/PayGo/{data,logs,backups}
cp -r paygo /home/PayGo && chown -R paygo:paygo /home/PayGo
sudo -u paygo bash -c 'cd /home/PayGo && python3 -m venv venv && venv/bin/pip install -r requirements.txt zxing-cpp && venv/bin/pip install -e .'
```

## 3. Создание .env

```bash
cp .env.example .env
venv/bin/python -m paygo.cli gen-secrets     # печатает SECRET_KEY, JWT_SECRET, SESSION_SECRET, WEBHOOK_SECRET, ENCRYPTION_KEY, VAPID_*
nano .env                                       # вставьте секреты, токены ботов, DATABASE_URL, SMTP_*
chmod 600 .env
```

Обязательные поля: `DATABASE_URL`, пять секретов, `MAIN_BOT_TOKEN`, `SUPPORT_BOT_TOKEN`, `PUBLIC_URL=https://wwweeewww.fit`, `BASE_PATH=/paygo`, `PORT=7035`.
`ADMIN_TELEGRAM_CHAT_IDS` — Telegram ID операторов для критических уведомлений через бота поддержки (узнать ID: написать боту, посмотреть в разделе «Пользователи»).
Все секреты — только в `.env` (права 600), в Git и в коде их нет. Старые секреты из прежнего проекта не используются.

## 4. Создание БД

```bash
sudo -u postgres psql -c "CREATE USER paygo WITH PASSWORD 'СИЛЬНЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE paygo OWNER paygo;"
# в .env: DATABASE_URL=postgresql+psycopg://paygo:СИЛЬНЫЙ_ПАРОЛЬ@127.0.0.1:5432/paygo
```

База создаётся чистой. Старая база LUXON не используется. Перенос касс 1xBet/1win и банковских QR-реквизитов из старого `config.json` (пароли/токены старой панели не переносятся):

```bash
scripts/import_legacy.sh /path/to/old/config.json --enable 1xbet
```

## 5. Миграции

```bash
scripts/migrate.sh              # = alembic upgrade head
venv/bin/python -m paygo.cli seed   # кассы 1xBet (вкл) и 1win (выкл), кнопки банков — идемпотентно
```

Новая миграция после изменения моделей: `venv/bin/alembic revision --autogenerate -m "..."`.

## 6. Создание администратора

```bash
scripts/create_admin.sh --username admin --role owner      # пароль запросит интерактивно
```

Роли: `viewer` (просмотр), `operator` (заявки, поддержка, пользователи), `admin` (+ кассы, настройки, логи), `owner` (+ администраторы, безопасность). Пароль: минимум 10 символов, буквы разного регистра и цифра.

## 7. Запуск backend

```bash
systemctl enable --now paygo-backend
curl -s http://127.0.0.1:7035/healthz        # {"ok": true, ...}
```

Вручную (для отладки): `set -a; . ./.env; set +a; venv/bin/python -m paygo.server`.

## 8. Запуск бота

```bash
systemctl enable --now paygo-bot        # клиентский бот @PayGoXBot
systemctl enable --now paygo-support    # бот поддержки @PayOperator_bot
```

Боты работают через long polling (webhook Telegram не нужен), состояние диалогов хранится в БД, кнопки inline-only.

## 9. Запуск workers

```bash
systemctl enable --now paygo-worker
```

Worker: сопоставление платежей, истечение неоплаченных заявок, восстановление зависших зачислений, мониторинг балансов касс с автоотключением, Web Push/Telegram-уведомления админам, очередь задач, автозакрытие тихих обращений, необязательный IMAP-источник платежей.

## 10. Настройка домена

`install.sh` уже скопировал сниппеты в `/etc/nginx/snippets/paygo*.conf` и зоны `limit_req` в `/etc/nginx/conf.d/paygo-zones.conf`. Остаётся подключить префикс `/paygo/` к домену.

**Вариант А — у `wwweeewww.fit` уже есть `server {}` блок** (найти: `grep -rl wwweeewww.fit /etc/nginx/sites-enabled /etc/nginx/conf.d`). Внутрь блока с `listen 443 ssl` добавьте одну строку:

```nginx
include /etc/nginx/snippets/paygo.conf;
```

**Вариант Б — конфигурации для домена ещё нет:**

```bash
cp /home/PayGo/deployment/nginx/paygo-site-http.example.conf /etc/nginx/sites-available/wwweeewww.fit
ln -sf /etc/nginx/sites-available/wwweeewww.fit /etc/nginx/sites-enabled/wwweeewww.fit
nginx -t && systemctl reload nginx
certbot --nginx -d wwweeewww.fit        # добавит HTTPS и редирект (см. раздел 11)
```

Проверка: `nginx -t && systemctl reload nginx`, затем `curl -sI https://wwweeewww.fit/paygo/ | head -1` → `HTTP/2 200`. Проксируется только префикс `/paygo/`, другие сервисы сервера не затрагиваются.

Webhook подтверждений платежей (MacroDroid / банковский форвардер): `https://wwweeewww.fit/paygo/api/webhooks/payments/<WEBHOOK_SECRET>` (POST текстом, JSON, формой или GET-параметрами; альтернатива — заголовок `X-Webhook-Key` или подпись `X-Signature` = HMAC-SHA256 тела).

## 11. Настройка HTTPS

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d wwweeewww.fit
```

Приложение за прокси доверяет `X-Forwarded-Proto` (`TRUST_PROXY=true`), cookie ставятся с `Secure`, `HttpOnly`, `SameSite=Strict`; HSTS включён.

## 12. systemd / deployment

Юниты: `deployment/systemd/paygo-{backend,worker,bot,support}.service` (пользователь `paygo`, `Restart=always`, логи в `/home/PayGo/logs/*.log`).

```bash
systemctl status paygo-backend paygo-worker paygo-bot paygo-support
journalctl -u paygo-backend -n 100
tail -f /home/PayGo/logs/backend.log
```

Docker-вариант: `docker compose up -d` (PostgreSQL + все процессы, порт 7035 на 127.0.0.1).

## 13. Health check

```bash
scripts/healthcheck.sh                                   # backend, БД, все юниты
curl -s http://127.0.0.1:7035/healthz                    # 200 / 503
curl -s https://wwweeewww.fit/paygo/api/health         # версия, БД, наличие токенов
```

## 14. Backup

```bash
scripts/backup.sh          # /home/PayGo/backups/paygo-YYYYmmdd-HHMM.tar.gz (pg_dump + data/ + .env), хранит 14 копий
crontab -u paygo -e         # 0 3 * * * /home/PayGo/scripts/backup.sh
```

## 15. Rollback

```bash
systemctl stop paygo-bot paygo-support paygo-worker paygo-backend
scripts/restore.sh /home/PayGo/backups/paygo-YYYYmmdd-HHMM.tar.gz
venv/bin/alembic downgrade -1        # только если нужно откатить схему на предыдущую версию кода
systemctl start paygo-backend paygo-worker paygo-bot paygo-support
```

## 16. Обновление проекта

```bash
scripts/update.sh /path/to/new/paygo   # backup → остановка ботов/воркера → rsync → pip → alembic upgrade → рестарт → healthcheck
```

При ошибке миграции скрипт останавливается, восстановление — `scripts/restore.sh` из только что созданного бэкапа.

---

## Разработка и тесты

```bash
python3 -m venv venv && venv/bin/pip install -r requirements-dev.txt && venv/bin/pip install -e .
cp .env.example .env    # APP_ENV=dev, DATABASE_URL=sqlite:///./data/dev.sqlite3
venv/bin/ruff check backend bot
venv/bin/pytest -q                                        # SQLite
TEST_DATABASE_URL=postgresql+psycopg://paygo:pw@127.0.0.1/paygo_test venv/bin/pytest -q   # PostgreSQL
```

Тесты покрывают: создание/оплату/ошибку пополнения, повторный webhook (идемпотентность), вывод и дубли кода, QR (генерация и декодирование), несовпадение валют, последний QR, поддержку и антифлуд, админские действия, авторизацию (CSRF, RBAC, brute force), уведомления без дублей, диспетчер кнопок бота.

Документация: `docs/architecture.md`, `docs/security.md`, `docs/support-bot.md`, `docs/api.md`, `docs/operations.md`, `docs/migration-from-luxon.md`.
