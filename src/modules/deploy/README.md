# Sprinter Go — сайт грузоперевозок в Бишкеке

Готовый одностраничник: анимированная сцена со спринтером и грузчиками, калькулятор стоимости с заявкой в WhatsApp, SEO-разметка (schema.org, Open Graph, sitemap), адаптив под телефоны. Без внешних зависимостей — только статические файлы.

---

## 1. Быстрый запуск для проверки (по IP, порт 7022)

Архив `sprinter-go-site.zip` загружен в `/home/`. Выполните на сервере:

```bash
cd /home
mkdir -p gotaxi
unzip -o sprinter-go-site.zip -d gotaxi
cd gotaxi
chmod +x start.sh stop.sh status.sh restart.sh
./start.sh
```

Скрипт выведет адрес вида `http://IP_СЕРВЕРА:7022/` — откройте его в браузере.

Если нет `unzip`:

```bash
sudo apt install -y unzip            # Ubuntu / Debian
sudo dnf install -y unzip            # CentOS / Alma / Rocky
# или используйте tar-архив:
mkdir -p /home/gotaxi && tar -xzf /home/sprinter-go-site.tar.gz -C /home/gotaxi
```

Если страница не открывается снаружи — откройте порт в файрволе:

```bash
sudo ufw allow 7022/tcp                                              # Ubuntu / Debian
sudo firewall-cmd --permanent --add-port=7022/tcp && sudo firewall-cmd --reload   # CentOS / Alma
```

Управление:

```bash
./status.sh    # работает ли, последние строки лога
./restart.sh   # перезапуск (после обновления файлов)
./stop.sh      # остановить
PORT=8080 ./start.sh   # запустить на другом порту
```

Сервер — `server.py` на стандартной библиотеке Python 3 (нужен только `python3`): gzip, кэш-заголовки, ETag, security-заголовки, красивая 404.

---

## 2. Автозапуск после перезагрузки (systemd)

```bash
sudo bash /home/gotaxi/deploy/install-service.sh
# управление:
sudo systemctl status sprinter-go
sudo systemctl restart sprinter-go
journalctl -u sprinter-go -f
```

---

## 3. Боевой запуск на домене с HTTPS (nginx + certbot)

1. В DNS домена `gruzoperevozki.biz.kg` создайте A-записи `@` и `www` → IP сервера (подождите обновления DNS).
2. Установите nginx и certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

3. Подключите конфиг сайта:

```bash
sudo cp /home/gotaxi/deploy/nginx.conf /etc/nginx/sites-available/gruzoperevozki.biz.kg
sudo ln -s /etc/nginx/sites-available/gruzoperevozki.biz.kg /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

4. Выпустите сертификат (certbot сам настроит редирект на https):

```bash
sudo certbot --nginx -d gruzoperevozki.biz.kg -d www.gruzoperevozki.biz.kg
```

5. Проверьте: `https://gruzoperevozki.biz.kg/`. Python-сервер на 7022 при этом можно остановить (`./stop.sh`) — nginx отдаёт файлы из `/home/gotaxi` напрямую. Если хотите оставить python-сервер, в `nginx.conf` есть готовый закомментированный блок `proxy_pass`.

Права: `sudo chown -R www-data:www-data /home/gotaxi` (для nginx на Debian/Ubuntu) или `nginx:nginx` на CentOS; убедитесь, что у `/home` и `/home/gotaxi` есть право на чтение и вход (`chmod 755`).

---

## 4. Вариант Docker

```bash
cd /home/gotaxi
docker compose -f deploy/docker-compose.yml up -d --build
# сайт: http://IP_СЕРВЕРА:7022
```

---

## 5. Что поменять под себя

| Что | Где |
|---|---|
| Телефон, WhatsApp, адрес, email, часы | `index.html` — поиск по `+996755555357`, `0755 555 357`, `wa.me/996755555357`, `ул. Чуйкова`, `info@moveit.kg`; а также JSON-LD в `<head>` |
| Тарифы и цены в тексте | `index.html`, секции `#prices`, `#services`, FAQ, JSON-LD |
| Формулы калькулятора | `assets/js/site.js`, блок `calc` (константы тарифов и допуслуг) |
| Отзывы | `index.html`, секция `#reviews` (карточки `<article>`) |
| Районы и направления | `index.html`, секция `#areas` |
| Логотип / иконки | `favicon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `og-image.png` |
| Год в футере | ставится автоматически (JS) |
| Количество лет на рынке | считается автоматически от 2015 (`data-count-from-year`) |

После правки текста в `index.html` обновите дату `dateModified` в JSON-LD и `<lastmod>` в `sitemap.xml`.

Email `info@moveit.kg` и адрес «ул. Чуйкова, 123» взяты со старого сайта — проверьте, что они актуальны. Межгородские перевозки упомянуты как «по запросу» — уберите фразу в секции `#areas`, если не выполняете.

---

## 6. SEO: что сделать после запуска (важно для топ-1)

1. **Google Search Console** — https://search.google.com/search-console → добавить ресурс `gruzoperevozki.biz.kg`, подтвердить через HTML-тег: раскомментировать `<meta name="google-site-verification">` в `index.html` и вставить код. Отправить `https://gruzoperevozki.biz.kg/sitemap.xml`.
2. **Яндекс.Вебмастер** — https://webmaster.yandex.ru → аналогично, тег `<meta name="yandex-verification">`, добавить sitemap.
3. **Google Business Profile** (https://business.google.com) и **Яндекс Бизнес** (https://business.yandex.ru), **2ГИС** — создать карточку компании с тем же названием, телефоном и адресом, что на сайте, категория «Грузоперевозки / Переезды». Это главный фактор для гео-запросов «грузоперевозки Бишкек».
4. **Счётчики** — вставить Яндекс.Метрику и/или GA4 в блок-заготовку перед `</body>` в `index.html`.
5. **Отзывы** — просить клиентов оставлять отзывы в Google Maps / 2ГИС / Яндекс Картах; добавлять новые на сайт в секцию «Отзывы».
6. **Проверки**: https://pagespeed.web.dev, https://validator.schema.org, https://search.google.com/test/rich-results, https://developers.facebook.com/tools/debug (OG-картинка).
7. Регулярно обновлять контент (цены, районы, FAQ) — `dateModified` и `lastmod`.

---

## 7. Структура файлов

```
index.html               — сайт (одна страница)
404.html                 — страница ошибки
assets/css/site.css      — все стили (шрифты, дизайн-система, сцена, секции)
assets/js/site.js        — вся логика (анимации, калькулятор, форма WhatsApp)
assets/fonts/*.woff2     — шрифты Unbounded и Manrope (самохостинг)
favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-*.png
og-image.png             — картинка для соцсетей и мессенджеров (1200×630)
manifest.webmanifest     — PWA-манифест
robots.txt, sitemap.xml  — для поисковиков
server.py                — python-сервер (для запуска по IP:7022 без nginx)
start.sh / stop.sh / status.sh / restart.sh — управление сервером
deploy/nginx.conf        — конфиг nginx для домена
deploy/sprinter-go.service, deploy/install-service.sh — автозапуск (systemd)
deploy/Dockerfile, deploy/docker-compose.yml, deploy/nginx-docker.conf — Docker-вариант
```

---

## 8. Проверка после запуска

```bash
curl -I http://127.0.0.1:7022/                 # 200, Cache-Control, CSP
curl -I http://127.0.0.1:7022/assets/css/site.css
curl -s -H "Accept-Encoding: gzip" -I http://127.0.0.1:7022/ | grep -i content-encoding   # gzip
curl -I http://127.0.0.1:7022/nope             # 404
```

В браузере: калькулятор считает сумму, кнопка «Отправить заявку» открывает WhatsApp с текстом расчёта, на телефоне снизу закреплена панель «Рассчитать / WhatsApp / Позвонить».
