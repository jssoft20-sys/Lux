# Sprinter Go Platform — контракт проекта

Сервис грузоперевозок: клиент заказывает машину, курьер выполняет, админ управляет.
Три приложения на одном бэкенде. Всё собирается строго по этому документу.

## 0. Правила, которые нельзя нарушать

1. **Ноль внешних зависимостей.** Бэкенд — только стандартная библиотека Python 3.9+.
   Фронтенд — только нативные ES-модули, без сборки, без npm, без CDN.
   Причина: сервис должен подниматься одной командой на любом VPS без интернета и pip.
2. **Комментарии и текст интерфейса — по-русски.** Код (имена переменных, функций) — латиницей.
3. **Мобильный первым.** Базовая вёрстка под 360–430 px, десктоп — расширение.
4. **Деньги считает только сервер.** Клиент показывает расчёт, но заказ создаётся по цене,
   пересчитанной на сервере. Присланную клиентом цену игнорируем.
5. **Каждый файл принадлежит одному модулю.** Не править чужие файлы — только свои.

## 1. Структура

```
platform/
  server/
    __init__.py
    core.py          — мини-фреймворк: роутер, JSON, сессии, SSE-хаб, статика   [ЯДРО]
    db.py            — схема SQLite, миграции, помощники                        [ЯДРО]
    settings.py      — чтение/запись настроек админки с кэшем                   [ЯДРО]
    pricing.py       — расчёт стоимости (единственный источник истины)
    dispatch.py      — подбор курьера и раздача предложений
    geo.py           — расстояния, геокодер, подсказки адресов, маршрут
    mailer.py        — SMTP и шаблоны писем
    payments.py      — платёжные провайдеры
    i18n_server.py   — тексты писем и ошибок на ru/ky
    routers/
      public.py      — API клиента (без авторизации)
      auth.py        — регистрация и вход курьера/админа
      courier.py     — API курьера
      admin.py       — API админки
  web/
    index.html       — клиентское приложение
    courier.html     — приложение курьера
    admin.html       — админка
    assets/
      css/tokens.css      — дизайн-система                                      [ЯДРО]
      css/base.css        — сброс, типографика, утилиты                         [ЯДРО]
      css/components.css  — кнопки, поля, карточки, шторки, тосты               [ЯДРО]
      css/client.css  css/courier.css  css/admin.css  css/map.css
      js/core/        api.js i18n.js store.js ui.js router.js map.js fmt.js     [ЯДРО]
      js/client/      js/courier/      js/admin/
      fonts/          onest-*.woff2 inter-*.woff2
  data/              — sqlite-база (в git не хранится)
  scripts/           — start.sh stop.sh status.sh restart.sh seed.py
  deploy/            — nginx.conf, systemd, инструкция
  app.py             — точка входа
```

## 2. База данных

SQLite, режим WAL. Схема создаётся в `db.py`, версия хранится в `PRAGMA user_version`.
Все деньги — **в тыйынах (1/100 сома), целым числом**. Никаких float для денег.
Все времена — **UTC, целое число секунд** (unix).

```sql
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)          -- value = JSON

users(id INTEGER PK, role TEXT, email TEXT UNIQUE, phone TEXT, name TEXT,
      password_hash TEXT, avatar TEXT, status TEXT, lang TEXT DEFAULT 'ru',
      created_at INT, last_login_at INT)
      -- role: 'admin' | 'courier';  status: 'pending' | 'active' | 'blocked'

couriers(user_id INTEGER PK REFERENCES users(id), vehicle_class TEXT,
         car_model TEXT, car_plate TEXT, car_color TEXT,
         body_w INT, body_d INT, body_h INT, capacity_kg INT,
         rating_sum INT DEFAULT 0, rating_count INT DEFAULT 0,
         orders_done INT DEFAULT 0, orders_cancelled INT DEFAULT 0,
         offers_sent INT DEFAULT 0, offers_taken INT DEFAULT 0,
         priority INT DEFAULT 0,          -- ручной приоритет из админки, -50..+50
         online INT DEFAULT 0, busy INT DEFAULT 0,
         lat REAL, lng REAL, heading REAL, speed REAL, geo_at INT,
         balance INT DEFAULT 0, note TEXT)

clients(id INTEGER PK, phone TEXT UNIQUE, name TEXT, avatar TEXT, lang TEXT DEFAULT 'ru',
        orders_count INT DEFAULT 0, rating_sum INT DEFAULT 0, rating_count INT DEFAULT 0,
        blocked INT DEFAULT 0, created_at INT, last_order_at INT)

tariffs(id INTEGER PK, code TEXT UNIQUE, name_ru TEXT, name_ky TEXT,
        desc_ru TEXT, desc_ky TEXT, vehicle_class TEXT, icon TEXT,
        base_price INT, included_km REAL, included_min INT,
        per_km INT, per_min INT, min_price INT,
        waiting_free_min INT, waiting_per_min INT,
        loaders_included INT DEFAULT 0, loader_hour_price INT, loader_min_hours REAL DEFAULT 1,
        body_w INT, body_d INT, body_h INT, capacity_kg INT,
        sort INT DEFAULT 0, active INT DEFAULT 1)

extras(id INTEGER PK, code TEXT UNIQUE, name_ru TEXT, name_ky TEXT,
       kind TEXT,            -- 'fixed' | 'hourly' | 'per_unit' | 'per_floor'
       price INT, unit_ru TEXT, unit_ky TEXT,
       min_qty REAL DEFAULT 1, max_qty REAL DEFAULT 20, step REAL DEFAULT 1,
       tariff_ids TEXT,      -- JSON-массив id или null = для всех тарифов
       sort INT DEFAULT 0, active INT DEFAULT 1)

orders(id INTEGER PK, public_id TEXT UNIQUE, track_token TEXT,
       client_id INT, courier_id INT, tariff_id INT,
       status TEXT, lang TEXT DEFAULT 'ru',
       points TEXT,          -- JSON: [{addr,lat,lng,entrance,flat,floor,intercom,comment,phone,name}]
       distance_m INT, duration_s INT, route TEXT,   -- route: JSON-массив [lat,lng]
       loaders INT DEFAULT 0, extras TEXT,           -- extras: JSON [{code,qty}]
       price_base INT, price_distance INT, price_time INT, price_loaders INT,
       price_extras INT, price_waiting INT, price_total INT,
       commission INT, courier_payout INT,
       payment_method TEXT, payment_status TEXT, payment_id TEXT, paid_amount INT DEFAULT 0,
       comment TEXT, cancel_reason TEXT, cancelled_by TEXT,
       created_at INT, searching_at INT, assigned_at INT, at_pickup_at INT,
       started_at INT, done_at INT, cancelled_at INT,
       waiting_s INT DEFAULT 0,
       client_rating INT, client_comment TEXT, courier_rating INT, courier_comment TEXT)

order_events(id INTEGER PK, order_id INT, at INT, actor TEXT, type TEXT, data TEXT)

offers(id INTEGER PK, order_id INT, courier_id INT, sent_at INT, expires_at INT,
       status TEXT, distance_m INT, score REAL)   -- 'sent'|'accepted'|'declined'|'expired'

sessions(token_hash TEXT PRIMARY KEY, user_id INT, created_at INT, expires_at INT, ua TEXT, ip TEXT)

geo_track(id INTEGER PK, courier_id INT, lat REAL, lng REAL, at INT)

mail_log(id INTEGER PK, to_addr TEXT, subject TEXT, template TEXT,
         status TEXT, error TEXT, at INT)
```

### Статусы заказа

`draft` → `searching` → `assigned` → `to_pickup` → `at_pickup` → `in_transit`
→ `at_dropoff` → `done`; в любой момент → `cancelled`; из `searching` → `expired`.

## 3. API

Базовый префикс `/api/v1`. Всегда JSON. Ошибка: `{"error":{"code":"...","message":"..."}}`
с осмысленным HTTP-кодом. Успех: полезная нагрузка объектом, без обёртки.

Авторизация курьера и админа — заголовок `Authorization: Bearer <token>`.
Клиент не авторизуется: заказ доступен по паре `public_id` + `track_token`.

### Публичные (клиент)

| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/config` | тарифы, допуслуги, настройки карты, комиссия, языки |
| POST | `/geo/suggest` | `{q, lat?, lng?}` → `[{title, subtitle, lat, lng, kind}]` |
| POST | `/geo/reverse` | `{lat, lng}` → `{title, subtitle}` |
| POST | `/geo/route` | `{points:[[lat,lng],…]}` → `{distance_m, duration_s, route}` |
| POST | `/price/quote` | `{tariff_id, points, loaders, extras, hours?}` → разбивка |
| POST | `/orders` | создать заказ → `{public_id, track_token, order}` |
| GET  | `/orders/{pid}?t=` | состояние заказа |
| GET  | `/orders/{pid}/stream?t=` | SSE: обновления заказа и позиции курьера |
| POST | `/orders/{pid}/cancel` | `{reason}` |
| POST | `/orders/{pid}/rate` | `{rating, comment}` |
| POST | `/payments/init` | `{public_id}` → `{url}` или `{ok:true}` если оплата выключена |
| POST | `/payments/callback/{provider}` | вебхук провайдера |

### Авторизация

`POST /auth/register` `{email,password,name,phone,car_*}` → создаёт курьера со `status='pending'`
`POST /auth/login` `{email,password}` → `{token, user}`
`POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me`
`POST /auth/password/forgot` `{email}`, `POST /auth/password/reset` `{token,password}`

### Курьер (роль `courier`, статус `active`)

`POST /courier/online` `{online}` · `POST /courier/geo` `{lat,lng,heading,speed}`
`GET /courier/stream` SSE: `offer`, `offer_cancelled`, `order`, `ping`
`POST /courier/offers/{id}/accept` · `/decline`
`POST /courier/orders/{id}/status` `{status}` · `POST /courier/orders/{id}/waiting` `{start|stop}`
`GET /courier/orders?period=` · `GET /courier/stats`

### Админ (роль `admin`)

`GET|PUT /admin/settings` · CRUD `/admin/tariffs[/{id}]` · CRUD `/admin/extras[/{id}]`
`GET /admin/orders` (фильтры `status,from,to,q,page`) · `GET|PATCH /admin/orders/{id}`
`GET /admin/couriers` · `GET|PATCH /admin/couriers/{id}` (статус, приоритет, заметка)
`GET /admin/clients` · `PATCH /admin/clients/{id}`
`GET /admin/stats?period=` · `GET /admin/stream` SSE (живая карта)
`POST /admin/mail/test` `{to}` · `GET /admin/mail/log`

## 4. Ядро фронтенда — API модулей

Все модули — ES-модули с именованным экспортом. Импорт по относительному пути.

```js
// core/api.js
api.get(path, params?)  api.post(path, body?)  api.patch(path, body?)  api.del(path)
api.stream(path, {onEvent, onOpen, onError})   // SSE с переподключением
api.setToken(t)  api.token()  api.onUnauthorized(fn)
// Бросает ApiError {code, message, status} — обрабатывать через try/catch.

// core/i18n.js
t('key.path', {name: 'Азамат'})   // подстановка {name}
setLang('ru'|'ky')  getLang()  onLangChange(fn)  tp(n, 'key')  // множественное число

// core/store.js
const s = createStore({...});  s.get()  s.set(patch)  s.on(fn)  s.select(fn, cb)

// core/ui.js
toast(msg, {type:'ok'|'err'|'info', ms})
sheet({title, content, actions, dismissible})  // нижняя шторка, возвращает {close}
confirm({title, text, ok, cancel}) → Promise<boolean>
spinner(el, on)   skeleton(el, rows)   haptic()
el(tag, props, ...children)   // гипертекстовый помощник, возвращает HTMLElement

// core/map.js
const map = createMap(container, {center:[lat,lng], zoom, theme:'dark'|'light', interactive})
map.setView(center, zoom, {animate})   map.fitPoints(points, {padding})
map.marker({at, html, className, anchor:'center'|'bottom', zIndex}) → {moveTo(ll,{duration}), setHtml, remove, el}
map.route(coords, {color, width, dashed}) → {setCoords, remove}
map.on('click'|'move'|'moveend'|'longpress', fn)   map.destroy()
// Плитки берутся из /config → map.tiles; по умолчанию OSM (светлая) и Carto Dark (тёмная).

// core/fmt.js
money(tiyin)  // «1 250 сом»
distance(m)  duration(s)  time(unix)  date(unix)  phone(s)  plate(s)
```

## 5. Дизайн-система

Тёмная тема основная (как в приложениях такси), светлая поддерживается.
Токены в `tokens.css`, переопределяются через `[data-theme]` и `prefers-color-scheme`.

```
--bg #0E0E10   --surface #17171A   --surface-2 #202024   --surface-3 #2A2A30
--line #2E2E36 --text #F6F6F8      --muted #9A9AA5       --muted-2 #6E6E78
--accent #FFDF00  --accent-ink #16150F  --accent-soft rgba(255,223,0,.14)
--ok #24C07A   --warn #FFA726      --err #FF4D4D         --info #4DA3FF
--r-sm 10px --r-md 14px --r-lg 20px --r-xl 28px --r-full 999px
--sp-1 4px … --sp-8 40px
--ease cubic-bezier(.22,1,.36,1)   --ease-in cubic-bezier(.5,0,.75,0)
--dur-1 140ms --dur-2 240ms --dur-3 380ms
--font-display 'Onest'  --font-text 'Inter'
--shadow-1 / --shadow-2 / --shadow-sheet
--safe-b env(safe-area-inset-bottom)
```

Классы компонентов (из `components.css`, переиспользовать, не плодить свои):
`.btn .btn--primary .btn--ghost .btn--danger .btn--lg .btn--block`
`.field .field__label .field__input .field__hint .field--err`
`.card .card--tap` · `.sheet .sheet__grip .sheet__head .sheet__body`
`.chip .chip--on` · `.avatar .avatar--lg` · `.stars` · `.badge .badge--ok/--warn/--err`
`.list .list__row .list__row--tap` · `.skeleton` · `.toast` · `.switch` · `.stepper`

Анимации: вход шторки — `transform: translateY` + `opacity`, длительность `--dur-2`,
кривая `--ease`. Уважать `prefers-reduced-motion: reduce` (все длительности → 1ms).
**Не использовать `.001ms`** — минификатор ломает это значение.

## 6. Языки

Файлы `web/assets/js/core/lang.ru.js` и `lang.ky.js` — плоские объекты с точечными ключами:
`{'order.title': 'Куда везём?', 'order.from': 'Откуда', ...}`.
Правило: кыргызский пишем живым языком, не калькой с русского.
Ключи группируются по префиксам: `common.` `order.` `track.` `courier.` `admin.` `err.`

## 7. Настройки админки (ключи в `settings`)

```
service.name service.phone service.city service.currency service.tz
commission.kind('percent'|'fixed') commission.value commission.min commission.max
payment.enabled payment.provider payment.prepay_commission payment.merchant_id payment.secret
dispatch.mode('nearest'|'score'|'broadcast') dispatch.radius_m dispatch.offer_ttl_s
dispatch.w_distance dispatch.w_rating dispatch.w_priority dispatch.w_acceptance
dispatch.max_rounds dispatch.new_courier_boost
map.provider('osm'|'carto'|'yandex'|'2gis') map.tiles_light map.tiles_dark map.key
map.center_lat map.center_lng map.zoom map.attribution
geo.suggest_provider('nominatim'|'yandex'|'2gis') geo.key geo.bbox
route.provider('straight'|'osrm') route.url route.road_factor
smtp.host smtp.port smtp.secure('none'|'ssl'|'tls') smtp.user smtp.pass smtp.from smtp.from_name
mail.enabled mail.templates(JSON)
order.min_price order.cancel_free_s order.search_timeout_s order.waiting_free_min
security.allow_registration security.require_moderation
```

## 8. Соглашения по коду

- Python: 4 пробела, snake_case, типы в сигнатурах где помогают. Без сторонних библиотек.
- JS: 2 пробела, camelCase, `const` по умолчанию, без `var`. Только ES-модули.
- CSS: kebab-case, БЭМ-подобно (`.block__el--mod`), вложенность не глубже 2.
- Каждая функция, которая делает что-то неочевидное, получает комментарий «зачем», не «что».
- Никаких `TODO` и заглушек в финальном коде: либо работает, либо не попадает в сборку.
