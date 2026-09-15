# Контракт интеграции модулей (обязателен для всех сборщиков)

Корень: `/tmp/claude-0/-home-user-Lux/7dca5838-9194-5f06-a843-0c83e0bebcb1/scratchpad/` (далее `ROOT`).
Общие файлы (читать, НЕ менять): `ROOT/SPEC.md`, `ROOT/site/assets/css/base.css`, `ROOT/site/assets/css/fonts.css`, `ROOT/src/index.html` (старый сайт).
Скриншоты: `node ROOT/tools/shot.mjs <абс. путь к html или URL> <out.png> [w=1440] [h=900] [waitMs=800] [fullPage=1|0]` → затем открыть png через Read и посмотреть глазами.

## Куда что кладём (каждый модуль — своя папка в `ROOT/build/<module>/`)

| Модуль | Файлы | Содержимое |
|---|---|---|
| `hero-v1/2/3` | `hero.html`, `stage.css`, `stage.js` (опц.), `preview.html` | `<section id="hero" class="hero">…</section>` целиком (копирайт + сцена) |
| `chrome` | `header.html`, `footer.html`, `floating.html`, `chrome.css`, `chrome.js`, `preview.html` | `<header class="topbar" id="top">` + мобильное меню; `<footer class="footer">`; плавающая WhatsApp-кнопка + мобильная нижняя CTA-панель |
| `sections-a` | `sections-a.html`, `sections-a.css`, `sections-a.js`, `preview.html` | `#trust-strip`, `#services`, `#fleet`, `#how`, `#prices` (в этом порядке) |
| `calc` | `calc.html`, `calc.css`, `calc.js`, `preview.html` | `section#calc` — калькулятор + форма → WhatsApp |
| `sections-b` | `sections-b.html`, `sections-b.css`, `sections-b.js` (опц.), `preview.html` | `#why`, `#areas`, `#reviews`, `#faq`, `#contacts` (в этом порядке) |
| `js` | `main.js` | Глобальное поведение (см. ниже) |
| `seo` | `head.html`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og-image.png`, `og-image.html` | Всё содержимое `<head>` КРОМЕ подключений css/js (их добавит интегратор) |
| `deploy` | `server.py`, `start.sh`, `stop.sh`, `status.sh`, `deploy/nginx.conf`, `deploy/sprinter-go.service`, `deploy/Dockerfile`, `deploy/docker-compose.yml`, `README.md` | Запуск на сервере |

Итоговая сборка (делает интегратор): `<!doctype html><html lang="ru"><head>` + `head.html` + css/js линки + `</head><body>` + `header.html` + `hero.html` + `<main>`-обёртка вокруг hero..contacts + `sections-a.html` + `calc.html` + `sections-b.html` + `footer.html` + `floating.html` + `<script defer>` + `</body></html>`.
CSS будет объединён в порядке: fonts → base → chrome → stage → sections-a → calc → sections-b. JS: main → chrome → stage → sections-a → calc → sections-b.

## Соглашения

1. **Префиксы классов** (чтобы не пересекаться): hero/сцена — `.hero-*`, `.st-*`; chrome — `.topbar*`, `.mmenu*`, `.footer*`, `.fab*`, `.dock*`; sections-a — `.trust-*`, `.svc-*`, `.fleet-*`, `.how-*`, `.price-*`; calc — `.calc-*`; sections-b — `.why-*`, `.areas-*`, `.rev-*`, `.faq-*`, `.contact-*`. Базовые классы из `base.css` использовать свободно. Никаких стилей на голые теги (кроме внутри своего префикса, напр. `.faq-item summary`).
2. **id секций и якоря**: `#top`, `#hero`, `#trust-strip`, `#services`, `#fleet`, `#how`, `#prices`, `#calc`, `#why`, `#areas`, `#reviews`, `#faq`, `#contacts`. Ссылки меню: Услуги→`#services`, Автопарк→`#fleet`, Цены→`#prices`, Калькулятор→`#calc`, Отзывы→`#reviews`, Контакты→`#contacts`.
3. **Reveal-анимации**: вешать класс `reveal` (+ `data-delay="1..5"`, модификаторы `reveal--left/--right/--scale`) на карточки/заголовки; `main.js` добавит `is-in` при появлении. В `preview.html` для проверки можно добавить `<script>document.querySelectorAll('.reveal').forEach(e=>e.classList.add('is-in'))</script>` или подключить `ROOT/build/js/main.js`, если он уже есть.
4. **Анимированные сцены**: контейнер с атрибутом `data-stage`; `main.js` добавляет/снимает класс `is-visible` (IntersectionObserver). Модуль сам пишет CSS `[data-stage]:not(.is-visible) *{animation-play-state:paused!important}` для своих сцен.
5. **Счётчики**: `<span class="num" data-count="6" data-suffix=" мес.">0</span>` — main.js анимирует до значения; `data-count-from-year="2015"` — main.js подставит (текущий год − 2015) и анимирует. `data-year` на элементе → текущий год.
6. **Header/меню** (chrome): `button#menuBtn[aria-controls="mobileMenu"][aria-expanded="false"]`, `nav#mobileMenu`; открытие = класс `menu-open` на `<body>`; chrome.js обрабатывает клик и закрытие по ссылке/Esc. Высота шапки — токен `--header-h` (76px), при скролле >8px на `header` добавляется класс `is-scrolled` (chrome.js).
7. **Телефон/WhatsApp** везде: `tel:+996755555357`, текст «0755 555 357», `https://wa.me/996755555357?text=<encodeURIComponent('Здравствуйте! Хочу заказать грузоперевозку Sprinter Go.')>`, `target="_blank" rel="noopener"`.
8. **JS**: vanilla ES2020, каждый файл — IIFE `(()=>{ 'use strict'; … })();`, все `querySelector` с проверкой на null, без глобальных переменных (кроме `window.SG` — общий namespace, если очень нужно), без внешних библиотек. Не ломать страницу, если элемента нет.
9. **Без внешних ресурсов**: никаких CDN, картинок по URL, iframes карт. Всё — inline SVG или файлы в `ROOT/site/assets/img/`.
10. **Мобильная версия**: проверять скриншотами 390×844 (fullPage) и 1440×900. Ни один блок не должен вызывать горизонтальный скролл (`document.documentElement.scrollWidth <= innerWidth`).
11. **Копирайт**: только русский, живой продающий язык без канцелярита и без выдуманных цифр (см. SPEC п.1). Ключевые слова SEO — естественно.
12. **Иконки**: inline SVG 24×24 (stroke 2, round caps) или собственные иллюстрации; `aria-hidden="true"` на декоративных.
13. `preview.html` каждого модуля подключает `../../site/assets/css/fonts.css`, `../../site/assets/css/base.css`, свои css/js, и содержит только свой фрагмент — для скриншот-проверки. (Пути к шрифтам в fonts.css относительные `../fonts/…` от `site/assets/css/`, поэтому preview подключает именно тот файл по относительному пути — шрифты подхватятся.)
14. Финальный ответ агента (return): краткое резюме — что сделано, список файлов, известные ограничения. Не вставлять код в ответ.
