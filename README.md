# HeliHop — вертолётные полёты по Кыргызстану (v3)

Сайт с **3D-вертолётом Airbus H125 (борт EX-88010) на Three.js**, который используется везде: кабинное интро
с кнопкой START, приборами и звуком при каждом открытии главной, hero, витрина «Борт», карточки, блок «Борт»
на страницах маршрутов, CTA, 404, а также маркеры на карте и графике высоты (снимки 3D-модели).
Все фотографии — живые, из полётов HeliHop (80 фото со старого сайта). Калькулятор мест: 3 у окна + 1 среднее,
весь борт, цена за место. Страница «Как проходит полёт» — анимированный день полёта от заявки до посадки со звуком.
3 языка (RU / EN / KG), 45 страниц, заявки на почту и в Telegram, монохромный фирменный стиль HELI HOP.

**Что нового в v3**
- один 3D-движок на всю страницу (один рендер, несколько окон) — без лагов на телефоне; исправлен баг с гигантской иконкой на карте (iOS);
- интро запуска: START → приборы (N1, NR, TOT, ALT), чек-лист, звук турбины и ротора (WebAudio, включается по клику), взлёт и перелёт в hero; на внутренних страницах — быстрый пролёт;
- реальные фото: гости, Marry Me, впечатления, маршруты, борта, подарок;
- калькулятор стоимости на страницах маршрутов и в форме брони (места × цена, весь борт = 3 у окна + 1 среднее, цена за место при полном борте, предоплата 30 %);
- новая страница `/how/` («Как проходит полёт»): чат брони, погода, встреча, два пилота и осмотр, посадка в вертолёт, запуск (3D + приборы), полёт по карте, посадка в горах, кадры.

**Без зависимостей.** Нужен только Node.js ≥ 18. Сайт уже собран — папка `public/` готова к раздаче.

---

## Запуск на сервере (порт 7033)

```bash
# вариант 1 — с GitHub (репозиторий публичный)
cd /home && rmdir /home/Helip 2>/dev/null
git clone -b claude/helip-helicopter-tours-site-scma8v --depth 1 https://github.com/jssoft20-sys/Lux.git /home/Helip
cd /home/Helip && node server.js
# → http://<IP-сервера>:7033

# вариант 2 — из архива
mkdir -p /home/Helip && cd /home/Helip
unzip -o /path/to/Helip.zip && node server.js
```

Автозапуск + сервис systemd + открытие порта в фаерволе одной командой:

```bash
cd /home/Helip && bash deploy/install.sh
journalctl -u helip -f        # логи
systemctl restart helip       # перезапуск
```

Обновить сайт до новой версии из GitHub: `cd /home/Helip && git pull && systemctl restart helip`.

Альтернативы: PM2 (`pm2 start server.js --name helip`), Docker (`docker build -t helip . && docker run -d -p 7033:7033 helip`),
nginx + домен + HTTPS (`deploy/nginx.conf`, сертификат — `certbot --nginx`).

---

## Заявки на почту и в Telegram

Форма бронирования отправляет `POST /api/book`. Каждая заявка:
1. сохраняется в `data/bookings.jsonl` (всегда);
2. уходит **на почту** по SMTP — если заданы переменные `MAIL_TO` и `SMTP_*`;
3. уходит **в Telegram** — если заданы `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`.

Переменные задаются в `/etc/systemd/system/helip.service` (строки `Environment=`), затем
`systemctl daemon-reload && systemctl restart helip`. Пример — в `.env.example`.

| Почта | SMTP_HOST | SMTP_PORT | Пароль |
|---|---|---|---|
| Gmail | smtp.gmail.com | 465 | «пароль приложения» (Google Account → Security → App passwords) |
| Yandex | smtp.yandex.ru | 465 | «пароль приложения» (id.yandex.ru → Безопасность) |
| Mail.ru | smtp.mail.ru | 465 | «пароль для внешних приложений» |

```ini
Environment=MAIL_TO=booking@helihop-travel.com
Environment=SMTP_HOST=smtp.gmail.com
Environment=SMTP_PORT=465
Environment=SMTP_USER=you@gmail.com
Environment=SMTP_PASS=xxxx-xxxx-xxxx-xxxx
Environment=MAIL_FROM=HeliHop <you@gmail.com>
```

Письмо содержит маршрут, дату, места, имя, телефон, комментарий и кнопку «Ответить в WhatsApp».
Проверка настроек: `curl http://127.0.0.1:7033/api/health` → `"email": true`.
Список заявок: `GET /api/bookings?token=<ADMIN_TOKEN>`.

---

## Структура

```
Helip/
├── server.js            статический сервер + API заявок (почта/Telegram), порт 7033
├── lib/smtp.js          SMTP-клиент без зависимостей (465 SSL / 587 STARTTLS)
├── build.js             сборка HTML из шаблонов: node build.js
├── public/              ГОТОВЫЙ САЙТ
│   ├── assets/js/heli3d.js   3D-движок (Three.js): модель H125, окна просмотра, интро, аудио
│   ├── assets/js/main.js     интро-кабина, калькулятор, форма, карта, страница «Как проходит полёт»
│   └── assets/css/main.css   стили (монохромный бренд)
├── src/data/site.js     ⚙️ бренд, телефон, WhatsApp, Instagram
├── src/data/routes.js   ⚙️ маршруты, цены, координаты (RU/EN/KG)
├── src/data/i18n.js     ⚙️ тексты интерфейса, главной, интро, витрины (3 языка)
├── src/data/pages.js    ⚙️ тексты внутренних страниц, FAQ, вертолёты, гости
├── src/data/story.js    ⚙️ сцены страницы «Как проходит полёт» (3 языка)
├── src/data/images.json  размеры и превью всех фото (80 живых фото HeliHop)
├── deploy/              install.sh, helip.service, nginx.conf
└── .env.example         переменные для почты/Telegram
```

Редактирование: правите файлы в `src/data/` → `node build.js` → готово (перезапуск сервера не нужен).
Свои фото: положить в `public/assets/img/` с теми же именами (`guest-01-480.webp`, `guest-01-900.webp`, `guest-01-1400.webp` …) или добавить новое имя в `src/data/images.json`.

## Технологии и производительность

- Three.js r180 (процедурная PBR-модель Airbus H125 в ливрее борта EX-88010: белая лаковая краска, чёрные рамки
  остекления, флаг и регистрация, надпись AIRBUS, медная выхлопная труба, тёмные полозья, огни, размытие ротора, площадка).
- Один рендерер на страницу: hero/витрина рисуются напрямую, остальные окна копируются из общего буфера;
  рендер только когда окно на экране, на телефоне не больше двух живых окон одновременно; DPR ограничен;
  на программных GPU — fallback на фото/SVG. Звук — процедурный WebAudio без аудиофайлов.
- GSAP 3.13 + Lenis; на телефонах отключены тяжёлые эффекты (blur, зерно, шейдер тумана).
- Шрифты Unbounded + Manrope (self-hosted, кириллица и кыргызские буквы), SEO: hreflang, sitemap, JSON-LD, OG.
- Фото: © HeliHop Travel (80 живых фото со старого сайта, публикуются с согласия гостей); шрифты и библиотеки — на `/credits/`.
