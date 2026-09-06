# PayGo

Платёжная касса для Telegram: пополнение и вывод средств игроков через кассы букмекеров (**1xbet** и **1win** включены), бот поддержки с автоматизацией, мобильная админ-панель `https://wwweeewww.fit/paygo/`.

```
/home/PayGo/                 ← весь проект в одном каталоге
├── backend/paygo/          FastAPI-бэкенд: API, сервисы, провайдеры касс, воркеры, тексты бота
├── bot/paygobot/           Telegram-боты: клиентский (@PayGoXBot) и оператор (@PayOperator_bot)
├── frontend/admin/         Админ-панель (статический SPA без сборки)
├── migrations/             Alembic-миграции
├── deployment/             systemd-юниты, nginx
├── scripts/                install, migrate, create_admin, backup, restore, update, healthcheck
├── docs/                   Архитектура, безопасность, поддержка, API, эксплуатация
├── tests/                  pytest (SQLite и PostgreSQL)
├── venv/ data/ logs/ backups/   создаются установщиком
└── .env                    все секреты и токены (права 600)
```

Процессы: **backend** (HTTP :7035), **worker** (фоновые задачи), **bot** (клиентский бот), **support** (бот-оператор). Все используют одну базу PostgreSQL и один `.env`.

---

## 1. Требования

* Ubuntu 22.04/24.04 (или Debian 12), root-доступ
* Python 3.10+ (установщик выбирает самый новый из 3.10–3.12)
* PostgreSQL 14+ (ставится установщиком)
* nginx с HTTPS на домене `wwweeewww.fit` (уже есть — подключается одной строкой)
* Токены ботов уже в `.env` из архива; доступ к API касс (1xbet: Servcul — логин, пароль кассира, cashdeskId, hash; 1win: API-ключ)
* MacroDroid на телефоне с приложением банка — для подтверждений платежей

## 2. Установка

Архив `paygo.zip` содержит папку `PayGo/`. Загрузите его в `/home/` и выполните от root:

```bash
apt install -y unzip sudo
unzip -o /home/paygo.zip -d /home/
cd /home/PayGo && bash scripts/install.sh
```

Скрипт ставит пакеты (Python, PostgreSQL, nginx), создаёт пользователя `paygo` с домашним каталогом `/home/PayGo`, виртуальное окружение, пользователя и базу PostgreSQL `paygo` (пароль записывает в `.env`), применяет миграции и seed (кассы 1xbet и 1win, кнопки банков), ставит systemd-юниты `paygo-*` и nginx-сниппеты. Готовый `.env` из архива не трогает; повторный запуск безопасен.

## 3. .env

Уже заполнен: секреты, токены ботов, `PORT=7035`, `BASE_PATH=/paygo`, `PUBLIC_URL=https://wwweeewww.fit`. Проверить/дополнить:

```bash
nano /home/PayGo/.env
```

* `SMTP_USER`, `SMTP_PASSWORD` — почта Timeweb для подтверждения e-mail (необязательно).
* `ADMIN_TELEGRAM_CHAT_IDS` — Telegram ID операторов для критических уведомлений через бота-оператора.
* `ADMIN_IP_ALLOWLIST` — при желании ограничить вход в панель адресами офиса/VPN.

Все секреты — только в `.env` (права 600), в Git и в коде их нет. Комментарии в `.env` — только отдельными строками (systemd передаёт строку целиком).

## 4. База данных

Создаётся установщиком: пользователь `paygo`, база `paygo`, `DATABASE_URL=postgresql+psycopg://paygo:<пароль>@127.0.0.1:5432/paygo`. Вручную:

```bash
sudo -u postgres psql -c "CREATE USER paygo WITH PASSWORD 'СИЛЬНЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE paygo OWNER paygo;"
```

## 5. Миграции

```bash
cd /home/PayGo && scripts/migrate.sh            # = alembic upgrade head
venv/bin/python -m paygo.cli seed               # кассы и кнопки банков — идемпотентно
```

## 6. Администратор

```bash
sudo -u paygo /home/PayGo/scripts/create_admin.sh --username admin --role owner
```

Команду запускайте одну — пароль спрашивается интерактивно (≥10 символов, буквы разного регистра и цифра). Роли: `viewer`, `operator` (заявки, поддержка, клиенты), `admin` (+ кассы, настройки, логи), `owner` (+ администраторы, безопасность).

## 7–9. Запуск backend, ботов и worker

```bash
systemctl restart paygo-backend paygo-worker paygo-bot paygo-support
systemctl is-active paygo-backend paygo-worker paygo-bot paygo-support
curl -s http://127.0.0.1:7035/healthz          # {"ok":true,...}
```

Боты работают по long polling (webhook Telegram не нужен). Вручную для отладки: `set -a; . ./.env; set +a; venv/bin/python -m paygo.server`.

## 10. Домен

Сниппеты уже в `/etc/nginx/snippets/paygo*.conf`, зоны limit_req — в `/etc/nginx/conf.d/paygo-zones.conf`. В файл домена (`/etc/nginx/sites-enabled/wwweeewww.fit`) внутрь блока `server { listen 443 ssl; ... }` добавьте одну строку:

```nginx
include /etc/nginx/snippets/paygo.conf;
```

```bash
nginx -t && systemctl reload nginx
curl -s -o /dev/null -w "%{http_code}\n" https://wwweeewww.fit/paygo/     # 200
```

Проксируется только префикс `/paygo/`; другие проекты, порты и `location` того же домена не затрагиваются. Если конфигурации домена нет — `deployment/nginx/paygo-site-http.example.conf` + `certbot --nginx -d wwweeewww.fit`.

## 11. HTTPS

Сертификат домена уже используется. Приложение за прокси доверяет `X-Forwarded-Proto` (`TRUST_PROXY=true`), cookie ставятся `Secure; HttpOnly; SameSite=Strict`, HSTS включён. Заходить в панель только по HTTPS-домену.

## 12. systemd

Юниты `paygo-backend`, `paygo-worker`, `paygo-bot`, `paygo-support` (пользователь `paygo`, `Restart=always`, логи `/home/PayGo/logs/*.log`).

```bash
systemctl status paygo-backend paygo-worker paygo-bot paygo-support --no-pager
journalctl -u paygo-backend -n 100
tail -f /home/PayGo/logs/backend.log /home/PayGo/logs/bot.log
```

Docker-вариант: `docker compose up -d` (PostgreSQL + все процессы, порт 7035 на 127.0.0.1).

## 13. Health check

```bash
/home/PayGo/scripts/healthcheck.sh                   # backend, БД, все юниты
curl -s http://127.0.0.1:7035/healthz
curl -s https://wwweeewww.fit/paygo/api/health       # версия, БД, наличие токенов
```

## 14. Backup

```bash
/home/PayGo/scripts/backup.sh                        # /home/PayGo/backups/paygo-YYYYmmdd-HHMM.tar.gz (pg_dump + data/ + .env), 14 копий
(crontab -u paygo -l 2>/dev/null; echo "0 3 * * * /home/PayGo/scripts/backup.sh") | crontab -u paygo -
```

## 15. Rollback

```bash
systemctl stop paygo-bot paygo-support paygo-worker paygo-backend
/home/PayGo/scripts/restore.sh /home/PayGo/backups/paygo-YYYYmmdd-HHMM.tar.gz
systemctl start paygo-backend paygo-worker paygo-bot paygo-support
```

## 16. Обновление

```bash
unzip -o /home/paygo.zip -d /tmp/paygo-new
/home/PayGo/scripts/update.sh /tmp/paygo-new/PayGo    # backup → стоп ботов → rsync → pip → миграции → рестарт → healthcheck
```

`.env`, `data/`, `venv/` при обновлении не затрагиваются.

---

## После установки: настройка в панели

1. **Кассы** → 1xbet → Изменить: учётные данные Servcul, «Проверить» (статус «Онлайн», баланс). 1win → API-ключ. Здесь же: эмодзи кнопки, **фото и тексты шагов** (скриншот «где взять ID» для пополнения, «ID для вывода», «код вывода»), город/адрес вывода для кассы, лимиты и пороги автоотключения.
2. **Платёжка** → Добавить реквизит: фото QR вашего банка или строка ELQR. Режим выбора: **Случайный** (реквизиты чередуются) или **Один основной** (по приоритету). Кнопки банков под QR включаются переключателями.
3. **MacroDroid** → скопировать адрес webhook (ключ показывается по кнопке), настроить макрос: триггер «Уведомление получено» от приложения банка → действие «HTTP-запрос» POST, Content-Type `application/json`, тело `{"text":"{not_text}","title":"{not_title}","app":"{not_app}"}`. Кнопка «Тест» проверяет связку. Белый список IP и режим «только с подписью» — там же.
4. **Настройки → Тексты**: все сообщения бота (приветствие, шаги, подпись под QR, «Пополнение отменено», «Пополнено», тексты вывода). Подстановки: `{name} {support} {cash} {emoji} {player} {amount} {cur} {min} {max} {minutes} {reason} {sla} {city} {address}`. Premium-эмодзи: `[emoji:ID:😎]` при включённом переключателе.
5. **Настройки → Выводы**: город `Бишкек`, адрес `ул. PayGo Online`, сроки, общая инструкция с фото. **Пополнения**: время на оплату, уникальные тыйыны, кнопки сумм, просьба прислать чек, надписи карточки QR.
6. **Безопасность**: сменить пароль, проверить сессии; **Push** — включить уведомления на телефоне.
7. **Premium-эмодзи.** Тексты по умолчанию уже содержат premium-эмодзи из вашего образца (👋 ⚡️ 💰 👩‍💻 🔝 💬 👍 📌 💵 ⏰ ❌ ℹ️, логотипы 1xbet 😎 и 1win 🥇, банков MBank/О!Деньги/MegaPay 🤩), переключатель «Premium-эмодзи» включён. Telegram показывает их только у ботов с **коллекционным username с fragment.com**: купите username на Fragment, назначьте его боту в BotFather (Bot Settings → Usernames) и нажмите Настройки → Бот → «Проверить premium-эмодзи». Пока Telegram отказывает, бот автоматически показывает обычные эмодзи, ничего не ломается. ID своих эмодзи: перешлите сообщение с нужным эмодзи боту @JsonDumpBot и возьмите `custom_emoji_id`; формат в текстах — `[emoji:ID:😎]`, у касс и кнопок банков — поле «ID premium-эмодзи».

Панель на телефоне: заявка открывается карточкой снизу (тянуть вверх — на весь экран, вниз — закрыть); большая зелёная кнопка — «Зачислить на счёт игрока» / «Перевёл на счёт игрока», рядом Профиль, Заявка, Изменить, Отменить, Чек, Написать клиенту, внизу красное «Отказать». На Главной вывод можно потянуть вправо — «Отложить» (в отложенных — «Вернуть»). Быстрые ответы переставляются: зажать строку и потянуть. Рассылка — выбор бота (основной / поддержки), фото и текст.

Бот: `/start` показывает приветствие и клавиатуру Пополнить / Вывести / Помощь; «Помощь» отвечает только контактом оператора. Каждый шаг заменяет предыдущее сообщение бота (в чате остаётся приветствие и итог), фото клиента после обработки удаляются. Заявка на пополнение живёт `payment_timeout_seconds` (5 мин): после истечения QR удаляется, клиент получает «Пополнение отменено… Создайте новую заявку», при оплате — «✅ Пополнено». Поддержка решает проблемы из панели: изменить сумму к оплате (QR пересобирается), ID игрока, зачислить через API, отклонить, посмотреть чек клиента.

## Разработка и тесты

```bash
python3 -m venv venv && venv/bin/pip install -r requirements-dev.txt && venv/bin/pip install -e .
cp .env.example .env    # APP_ENV=dev, DATABASE_URL=sqlite:///./data/dev.sqlite3
venv/bin/alembic upgrade head && venv/bin/python -m paygo.cli seed && venv/bin/python -m paygo.cli create-admin
venv/bin/pytest -q                                        # SQLite
TEST_DATABASE_URL=postgresql+psycopg://paygo:pw@127.0.0.1/paygo_test venv/bin/pytest -q   # PostgreSQL
venv/bin/ruff check backend bot tests
```

Документация: `docs/architecture.md`, `docs/security.md`, `docs/support-bot.md`, `docs/api.md`, `docs/operations.md`, `docs/migration-from-luxon.md`.
