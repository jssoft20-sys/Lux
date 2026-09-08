# HeliHop — вертолётные полёты по Кыргызстану (v2)

Сайт мирового уровня с **3D-вертолётом на Three.js**: при загрузке он заводится на площадке, взлетает и улетает
в hero-сцену, реагирует на мышь и гироскоп, а в разделе «Борт» его можно крутить и рассматривать по главам.
3 языка (RU / EN / KG), 42 страницы, заявки на почту и в Telegram, монохромный фирменный стиль HELI HOP.

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
│   ├── assets/js/heli3d.js   3D-вертолёт (Three.js): модель, интро, hero, витрина
│   ├── assets/js/main.js     анимации, форма, карта, переходы
│   └── assets/css/main.css   стили (монохромный бренд)
├── src/data/site.js     ⚙️ бренд, телефон, WhatsApp, Instagram
├── src/data/routes.js   ⚙️ маршруты, цены, координаты (RU/EN/KG)
├── src/data/i18n.js     ⚙️ тексты интерфейса, главной, интро, витрины (3 языка)
├── src/data/pages.js    ⚙️ тексты внутренних страниц, FAQ, вертолёты, гости
├── deploy/              install.sh, helip.service, nginx.conf
└── .env.example         переменные для почты/Telegram
```

Редактирование: правите файлы в `src/data/` → `node build.js` → готово (перезапуск сервера не нужен).
Свои фото: положить в `public/assets/img/` с теми же именами (`hero-2400.webp`, `hero-1600.webp`, `hero-960.webp` …).

## Технологии и производительность

- Three.js r180 (процедурная PBR-модель Airbus H125: лаковая краска, тонированное остекление, ливрея HELIHOP,
  навигационные огни и проблесковый маяк, размытие ротора, пыль на взлёте, вертолётная площадка).
- Рендер только когда сцена на экране; DPR ограничен; на слабых/программных GPU — автоматический fallback на SVG.
- GSAP 3.13 + Lenis; на телефонах отключены тяжёлые эффекты (blur, зерно, шейдер тумана).
- Шрифты Unbounded + Manrope (self-hosted, кириллица и кыргызские буквы), SEO: hreflang, sitemap, JSON-LD, OG.
- Фото: Wikimedia Commons (CC BY / CC BY-SA / PD), авторы на `/credits/` — для продакшена замените своими.
