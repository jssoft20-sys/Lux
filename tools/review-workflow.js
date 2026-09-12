export const meta = {
  name: 'sprinter-go-review',
  description: 'Adversarial multi-lens review of the integrated Sprinter Go site served on localhost',
  phases: [
    { title: 'Review', detail: 'independent reviewers: mobile UX, motion, SEO, a11y/perf, code' },
  ],
}

const ROOT = '/tmp/claude-0/-home-user-Lux/7dca5838-9194-5f06-a843-0c83e0bebcb1/scratchpad'
const URL = (args && args.url) || 'http://127.0.0.1:7022/'
const ROUND = (args && args.round) || 1

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          area: { type: 'string' },
          where: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'area', 'where', 'problem', 'fix'],
      },
    },
    overall: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['findings', 'overall', 'score'],
}

const COMMON = `Сайт собран и запущен: ${URL} (одностраничник Sprinter Go — грузоперевозки, Бишкек). Исходники модулей: ${ROOT}/build/ (hero-v2, chrome, sections-a, calc, sections-b, js/main.js, seo/head.html), собранные файлы: ${ROOT}/site/index.html, ${ROOT}/site/assets/css/site.css, ${ROOT}/site/assets/js/site.js. Требования: ${ROOT}/SPEC.md, ${ROOT}/CONTRACT.md, ${ROOT}/HERO_BRIEF.md.
Инструменты: скриншот — node ${ROOT}/tools/shot.mjs <url> <out.png> [w] [h] [waitMs] [fullPage 1|0]; кадры анимации — node ${ROOT}/tools/stageframes.mjs <url> <outDir> <w> <h> <times>; общий QA-отчёт — node ${ROOT}/tools/qa.mjs <url> <outDir> (консольные ошибки, горизонтальный скролл, битые якоря, скриншоты 1440/1280/820/390/360). Playwright доступен: import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs', executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'. Свои файлы клади в ${ROOT}/build/review-r${ROUND}/<твоя-роль>/. ОБЯЗАТЕЛЬНО открывай сделанные скриншоты через Read и смотри глазами.
Ничего не правь — только находи проблемы. Каждое замечание: severity (blocker — сломано/некликабельно/обрезано/ошибка; major — заметно портит впечатление или SEO; minor; nit), where (секция/селектор/файл), problem, evidence (что именно видно/измерено), fix (конкретное предложение). Не выдумывай проблем ради количества: лучше 5 реальных, чем 20 надуманных. Ложные срабатывания хуже пропусков. score — общая оценка 0–10 по твоей линзе.`

const LENSES = [
  { key: 'mobile', prompt: `Роль: мобильный UX-ревьюер. Проверь на 390×844 и 360×740 (isMobile, hasTouch): прокрути всю страницу скриншотами по экранам (fullPage тоже), открой мобильное меню (клик #menuBtn), проверь нижнюю панель CTA (появляется после скролла? перекрывает ли контент/кнопки формы?), калькулятор (тап по чипам/тарифам/степперам, раскрытие формы, ввод телефона), FAQ-аккордеоны, карусели (свайп/скролл), читаемость (размер шрифта ≥14px для текста, ≥16px в инпутах), тап-зоны ≥44px, горизонтальный скролл (qa.mjs), обрезанные элементы, наезды, слишком большие пустоты, hero-сцена в мобильной обрезке (спринтер и грузчики целиком?).` },
  { key: 'motion', prompt: `Роль: motion-инженер. Проверь hero-сцену на 1440×900 (кадры 500,2000,4000,…,21000 мс через stageframes.mjs) — история читается (приезд→дверь→минимум 6 ходок с коробками→дверь→отъезд→бесшовный цикл)? Есть ли артефакты: персонажи в воздухе/в земле, коробка не в руках, дверь «летает», колёса крутятся стоя, рывок на стыке цикла (сравни кадры 21500 и 500+22000)? Проверь остальные анимации: бегущая лента доверия, иллюстрации услуг (hover), автопарк (hover), «Как проходит заказ» (прогресс при скролле: сделай скриншоты при разных scrollY секции #how), счётчики #why, карта #areas, звёзды отзывов, idle-сцена в #contacts, футер. Пауза вне экрана: проверь через playwright, что у [data-stage] вне viewport нет класса is-visible. prefers-reduced-motion: эмулируй (page.emulateMedia({reducedMotion:'reduce'})) и проверь, что страница выглядит законченно (нет пустых мест, скрытых reveal-элементов). Производительность: в keyframes только transform/opacity? Нет ли layout-thrash в JS (scroll-обработчики без rAF)? Измерь через playwright CDP Performance.getMetrics или page.evaluate с requestAnimationFrame — средний FPS при прокрутке (ориентир >50).` },
  { key: 'seo', prompt: `Роль: технический SEO-специалист. Проверь ${ROOT}/site/index.html: title/description (длины, ключи «грузоперевозки Бишкек», «грузовое такси Бишкек», «переезд Бишкек», «грузчики Бишкек»), один h1, иерархия h2/h3 по секциям (выведи outline), canonical/hreflang/OG/twitter, JSON-LD (распарси, проверь типы, что FAQPage вопросы/ответы совпадают с текстом секции #faq на странице — это требование Google; что телефон/адрес/часы совпадают с текстом; что нет AggregateRating/Review), alt у картинок/aria у svg, ссылки tel:/wa.me корректны, robots.txt/sitemap.xml/manifest доступны по URL (curl), фавиконы отдаются (200), og-image 1200×630. Плотность и естественность ключевых слов в тексте (нет переспама), наличие районов Бишкека, семантика (main/nav/article/address). Проверь Lighthouse SEO и Best Practices: lighthouse ${URL} --only-categories=seo,best-practices,accessibility,performance --chrome-flags="--headless --no-sandbox" --output=json --output-path=${ROOT}/build/review-r${ROUND}/seo/lh.json --quiet (lighthouse установлен глобально; если не запускается — сообщи). Приведи баллы по 4 категориям и топ-аудиты, которые не прошли.` },
  { key: 'a11y-perf', prompt: `Роль: инженер доступности и производительности. Через playwright проверь: клавиатурная навигация (Tab по всем интерактивным элементам — есть фокус-стили? порядок логичный? мобильное меню закрывается по Esc?), aria-атрибуты кнопок без текста, labels у полей калькулятора, контраст текста на жёлтом/чёрном (посчитай для основных пар), aria-live у суммы, details/summary доступны. Производительность: размеры index.html/site.css/site.js (и gzip), число DOM-узлов, число одновременных CSS-анимаций, preload шрифтов реально используется (нет предупреждений в консоли), нет ошибок/варнингов в консоли на десктопе и мобиле, все запросы 200 (qa.mjs report.failedRequests). LCP-элемент и его время (playwright: PerformanceObserver largest-contentful-paint) на эмуляции медленного CPU (CDP Emulation.setCPUThrottlingRate 4). CLS при загрузке. Проверь, что шрифты swap не вызывает сильный сдвиг.` },
  { key: 'code', prompt: `Роль: senior code reviewer. Прочитай ${ROOT}/site/index.html (структура, дубликаты id, незакрытые теги — прогони через python html.parser/tidy-подобную проверку), ${ROOT}/site/assets/js/site.js целиком (ошибки логики, утечки слушателей, глобалы, работа калькулятора: формула из SPEC (база + доп.грузчики×500 + доп.часы×700 + этажи×100 + коробки×50 + сборка×500 + разборка×300), формирование wa.me текста, валидация телефона, кнопки data-tariff из #prices переключают тариф), ${ROOT}/site/assets/css/site.css (конфликты между модулями: одинаковые селекторы с разными правилами, переопределения base.css, !important, дубли keyframes-имён — проверь grep-ом на дубликаты @keyframes и на селекторы, объявленные в нескольких модулях). Проверь через playwright сценарий: выбрать тариф Премиум, +2 этажа, +1 сборка → сумма 6500+200+500=7200; нажать «Да, меня устраивает», ввести телефон 0555123456 и имя, нажать отправить — перехватить window.open/ссылку и проверить URL wa.me с текстом. Проверь якоря меню и подсветку активного пункта при скролле, кнопку «наверх», год в футере, счётчик лет (2026−2015=11).` },
]

phase('Review')
const results = await parallel(LENSES.map(l => () => agent(`${COMMON}\n\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS, effort: 'high' })
  .then(r => r && ({ lens: l.key, ...r }))))
const ok = results.filter(Boolean)
const all = ok.flatMap(r => r.findings.map(f => ({ lens: r.lens, ...f })))
const order = { blocker: 0, major: 1, minor: 2, nit: 3 }
all.sort((a, b) => order[a.severity] - order[b.severity])
log(`findings: ${all.length} (blockers ${all.filter(f => f.severity === 'blocker').length}, major ${all.filter(f => f.severity === 'major').length})`)
return { scores: Object.fromEntries(ok.map(r => [r.lens, r.score])), overall: Object.fromEntries(ok.map(r => [r.lens, r.overall])), findings: all }
