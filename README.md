# HeliHop — вертолётные полёты по Кыргызстану

Премиальный сайт с анимациями: 3 языка (RU / EN / KG), 42 статические страницы, форма бронирования с API,
интерактивная карта Кыргызстана, «бортовой журнал» маршрутов, WebGL-туман в hero, вертолёт, летающий по странице.

**Никаких зависимостей.** Нужен только Node.js ≥ 18. Сайт уже собран — папка `public/` готова к раздаче.

---

## Быстрый запуск на сервере (порт 7033)

```bash
# 1. Папка и распаковка
mkdir -p /home/Helip
cd /home/Helip
unzip -o /path/to/Helip.zip        # или: tar -xzf Helip.tar.gz

# 2. Проверить Node.js (нужен 18+). Если нет:
#    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# 3. Запуск
node server.js
# → сайт доступен по адресу http://<IP-сервера>:7033
```

Порт/хост можно поменять переменными окружения: `PORT=7033 HOST=0.0.0.0 node server.js`.

Если порт закрыт фаерволом: `ufw allow 7033/tcp` (Ubuntu) или `firewall-cmd --permanent --add-port=7033/tcp && firewall-cmd --reload` (CentOS).

### Автозапуск через systemd (рекомендуется)

```bash
cd /home/Helip
bash deploy/install.sh          # ставит Node (если нет), сервис helip, открывает порт
# либо вручную:
cp deploy/helip.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now helip
journalctl -u helip -f          # логи
```

### Альтернативы

- **PM2:** `npm i -g pm2 && pm2 start server.js --name helip && pm2 save && pm2 startup`
- **Docker:** `docker build -t helip . && docker run -d --name helip -p 7033:7033 -v /home/Helip/data:/app/data helip`
- **nginx + домен + HTTPS:** пример конфига в `deploy/nginx.conf` (proxy_pass на 127.0.0.1:7033), сертификат — `certbot --nginx`.

---

## Структура

```
Helip/
├── server.js            статический сервер + API бронирования (без зависимостей)
├── build.js             сборка HTML из шаблонов (node build.js)
├── public/              ГОТОВЫЙ САЙТ — раздаётся сервером
│   ├── index.html       главная (RU), en/ и ky/ — английская и кыргызская версии
│   ├── routes/…         маршруты и страницы маршрутов
│   └── assets/          css, js (GSAP, Lenis), img (WebP), fonts
├── src/
│   ├── data/site.js     ⚙️ бренд, телефон, WhatsApp, Instagram, цены «от»
│   ├── data/routes.js   ⚙️ маршруты: цены, длительность, координаты, тексты RU/EN/KG
│   ├── data/i18n.js     ⚙️ тексты интерфейса и главной страницы (3 языка)
│   ├── data/pages.js    ⚙️ тексты внутренних страниц, FAQ, вертолёты, гости
│   └── templates/       шаблоны страниц (JS-функции, возвращают HTML)
├── data/bookings.jsonl  заявки с формы (создаётся автоматически)
├── deploy/              systemd-сервис, nginx, install.sh
└── Dockerfile
```

## Как редактировать контент

1. Открыть нужный файл в `src/data/` (цены, тексты, телефоны — всё там, на трёх языках).
2. Выполнить `node build.js` — папка `public/` пересоберётся (42 страницы за ~0.3 с).
3. Перезапустить сервер не нужно — HTML отдаётся с диска.

Заменить фотографии: положить новые файлы в `public/assets/img/` с теми же именами
(например `hero-2400.webp`, `hero-1600.webp`, `hero-960.webp`) — или добавить новые имена в `src/data/images.json`.

## Заявки (бронирование)

Форма на сайте отправляет `POST /api/book` → запись в `data/bookings.jsonl` (по одной JSON-строке на заявку)
и, если заданы переменные окружения, уведомление в Telegram:

```
TELEGRAM_BOT_TOKEN=123456:ABC…   TELEGRAM_CHAT_ID=123456789
```

Список заявок: `GET /api/bookings?token=<ADMIN_TOKEN>` (если задан `ADMIN_TOKEN`).
Кнопка «Открыть WhatsApp» после отправки формирует готовое сообщение с деталями заявки.

Здоровье сервера: `GET /api/health`.

## Что внутри (технологии)

- HTML/CSS/JS без фреймворков; шрифты Unbounded + Manrope (self-hosted, поддержка кириллицы и кыргызских букв).
- GSAP 3.13 (ScrollTrigger, MotionPath, SplitText) и Lenis — анимации, плавный скролл, путь вертолёта.
- WebGL-шейдер тумана в hero (на слабых устройствах отключается автоматически), гироскоп-параллакс на телефонах.
- Адаптив: 320 px → 4K; `prefers-reduced-motion` уважается; страницы работают и без JS.
- SEO: hreflang для 3 языков, sitemap.xml, robots.txt, JSON-LD (TravelAgency / TouristTrip), Open Graph.
- Фотографии: Wikimedia Commons (CC BY / CC BY-SA / Public Domain), авторы указаны на странице `/credits/`.
  Для продакшена лучше заменить их на собственные фото компании.
