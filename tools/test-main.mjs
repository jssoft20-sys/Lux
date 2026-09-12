// Проверка build/js/main.js через preview.html
// usage: node tools/test-main.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = '/tmp/claude-0/-home-user-Lux/7dca5838-9194-5f06-a843-0c83e0bebcb1/scratchpad';
const URL = 'file://' + ROOT + '/build/js/preview.html';
const NBSP = ' ';
const YEAR = new Date().getFullYear();

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const collectErrors = (page, bucket) => {
  page.on('console', (m) => { if (m.type() === 'error') bucket.push('console: ' + m.text()); });
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message));
};

/* ================= 1. Desktop: основной сценарий ================= */
{
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  collectErrors(page, errors);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  // Сразу после load
  const initial = await page.evaluate(() => ({
    html: document.documentElement.className,
    sg: typeof window.SG,
    heroReveal: [...document.querySelectorAll('#hero .reveal')].map((e) => e.classList.contains('is-in')),
    heroStage: document.querySelector('[data-stage="hero-stage"]').classList.contains('is-visible'),
    secondStage: document.querySelector('[data-stage="second-stage"]').classList.contains('is-visible'),
    belowReveal: [...document.querySelectorAll('#reveal .reveal')].some((e) => e.classList.contains('is-in')),
    counterText: document.querySelector('[data-count-from-year]').textContent,
    years: [...document.querySelectorAll('[data-year]')].map((e) => e.textContent),
    wa: [...document.querySelectorAll('a[href^="https://wa.me"], a[href^="https://t.me"]')].map((a) => ({ t: a.getAttribute('target'), r: a.getAttribute('rel') })),
    offset: window.SG.headerOffset(),
    fmt: [window.SG.formatNumber(1500), window.SG.formatNumber(125000), window.SG.formatNumber(1.5, 1), window.SG.formatNumber(-2500)],
    plural: [1, 2, 5, 11, 21, 22, 25, 111, 112].map((n) => window.SG.plural(n, 'год|года|лет')),
  }));
  check('window.SG экспортирован', initial.sg === 'object');
  check('html.is-loaded после load', /\bis-loaded\b/.test(initial.html), initial.html);
  check('hero .reveal → is-in сразу (без скролла)', initial.heroReveal.length > 0 && initial.heroReveal.every(Boolean), JSON.stringify(initial.heroReveal));
  check('hero [data-stage] → is-visible сразу', initial.heroStage);
  check('второй [data-stage] вне экрана — без is-visible', !initial.secondStage);
  check('.reveal ниже первого экрана ещё без is-in', !initial.belowReveal);
  check('счётчик вне экрана ещё не запущен', initial.counterText === '0', initial.counterText);
  check('[data-year] = текущий год', initial.years.every((y) => y === String(YEAR)), initial.years.join(','));
  check('wa.me/t.me без target → _blank + noopener', JSON.stringify(initial.wa) === JSON.stringify([
    { t: '_blank', r: 'noopener' }, { t: '_blank', r: 'noopener' }, { t: '_blank', r: 'nofollow noopener' }, { t: '_self', r: null },
  ]), JSON.stringify(initial.wa));
  check('headerOffset = 76 + 12', initial.offset === 88, String(initial.offset));
  check('formatNumber ru-RU', JSON.stringify(initial.fmt) === JSON.stringify([`1${NBSP}500`, `125${NBSP}000`, '1,5', `−2${NBSP}500`]), JSON.stringify(initial.fmt));
  check('plural год|года|лет', initial.plural.join(',') === 'год,года,лет,лет,год,года,лет,лет,лет', initial.plural.join(','));

  // Плавный скролл вниз по шагам
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 500) {
    await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1600); // дать счётчикам досчитать

  const after = await page.evaluate(() => ({
    revealTotal: document.querySelectorAll('.reveal').length,
    revealIn: document.querySelectorAll('.reveal.is-in').length,
    missing: [...document.querySelectorAll('.reveal:not(.is-in)')].map((e) => e.tagName + '.' + e.className + ' top=' + Math.round(e.getBoundingClientRect().top)),
    heroStage: document.querySelector('[data-stage="hero-stage"]').classList.contains('is-visible'),
    counters: [...document.querySelectorAll('.num[data-count], [data-count-from-year]')].map((e) => e.textContent),
    counted: document.querySelectorAll('.is-counted').length,
  }));
  check('все .reveal получили is-in после скролла', after.revealIn === after.revealTotal, `${after.revealIn}/${after.revealTotal} ${after.missing.join('; ')}`);
  check('hero stage потерял is-visible (вне экрана)', !after.heroStage);
  const expected = [
    `${YEAR - 2015} ${window_plural(YEAR - 2015)}`, '6 мес.', `от 1${NBSP}500 сом`, '1,5 т',
    '0 скрытых платежей', '24/7', '3 тарифа', `~125${NBSP}000 кг`,
  ];
  check('счётчики досчитали до значений', JSON.stringify(after.counters) === JSON.stringify(expected), JSON.stringify(after.counters));
  check('все счётчики помечены is-counted', after.counted === expected.length, String(after.counted));

  // Второй stage виден при скролле к нему
  await page.evaluate(() => document.querySelector('[data-stage="second-stage"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(250);
  check('второй stage → is-visible в кадре', await page.evaluate(() => document.querySelector('[data-stage="second-stage"]').classList.contains('is-visible')));

  // visibilitychange: hidden → снять, visible → восстановить
  const vis = await page.evaluate(async () => {
    const stage = document.querySelector('[data-stage="second-stage"]');
    const hero = document.querySelector('[data-stage="hero-stage"]');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const hidden = { stage: stage.classList.contains('is-visible'), hero: hero.classList.contains('is-visible') };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const restoredSync = { stage: stage.classList.contains('is-visible'), hero: hero.classList.contains('is-visible') };
    await new Promise((r) => setTimeout(r, 150));
    const restoredIO = { stage: stage.classList.contains('is-visible'), hero: hero.classList.contains('is-visible') };
    delete document.visibilityState;
    return { hidden, restoredSync, restoredIO };
  });
  check('visibility hidden → is-visible снят со всех', !vis.hidden.stage && !vis.hidden.hero, JSON.stringify(vis.hidden));
  check('visibility visible → восстановлено по пересечению', vis.restoredSync.stage && !vis.restoredSync.hero && vis.restoredIO.stage && !vis.restoredIO.hero, JSON.stringify(vis));

  // Якоря
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(150);
  await page.click('.pv-nav a[href="#counters"]');
  await page.waitForTimeout(900);
  const anchor = await page.evaluate(() => {
    const el = document.getElementById('counters');
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    return { scrollY: Math.round(window.scrollY), expected: top - 88, hash: location.hash, histLen: history.length };
  });
  check('якорь #counters: scrollY = top − 88', Math.abs(anchor.scrollY - anchor.expected) <= 2, `${anchor.scrollY} vs ${anchor.expected}`);
  check('якорь: hash обновлён через replaceState', anchor.hash === '#counters', anchor.hash);

  await page.click('.pv-nav a[href="#контакты"]');
  await page.waitForTimeout(1200);
  const cyr = await page.evaluate(() => {
    const el = document.getElementById('контакты');
    return { d: Math.abs(el.getBoundingClientRect().top - 88), hash: decodeURIComponent(location.hash) };
  });
  check('кириллический якорь работает', cyr.d <= 2 && cyr.hash === '#контакты', JSON.stringify(cyr));

  await page.click('a[href="#top"].btn');
  await page.waitForTimeout(900);
  const top = await page.evaluate(() => ({ y: window.scrollY, hash: location.hash }));
  check('#top → наверх и hash снят', top.y === 0 && top.hash === '', JSON.stringify(top));

  await page.click('a[href="#nope"]');
  await page.waitForTimeout(200);
  check('несуществующий якорь не падает', errors.length === 0);

  // Динамический контент через SG.init(scope)
  await page.click('#addBlock');
  await page.waitForTimeout(1600);
  const dyn = await page.evaluate(() => {
    const card = document.querySelector('#dynamic .card');
    return { in: card.classList.contains('is-in'), text: card.querySelector('.num').textContent, wa: card.querySelector('a').getAttribute('target') };
  });
  check('динамический блок: reveal + счётчик + ссылка', dyn.in && dyn.text === '700 сом' && dyn.wa === '_blank', JSON.stringify(dyn));

  // SG.on/emit/off
  const bus = await page.evaluate(() => {
    const got = [];
    const off = window.SG.on('ping', (d) => got.push(d));
    window.SG.on('ping', () => { throw new Error('boom'); }); // не должен ломать остальных
    window.SG.emit('ping', 1);
    off();
    window.SG.emit('ping', 2);
    return got;
  });
  check('SG.on / emit / off', JSON.stringify(bus) === '[1]', JSON.stringify(bus));
  // ошибка слушателя логируется через console.error — это ожидаемо, исключаем из подсчёта
  const realErrors = errors.filter((e) => !e.includes('listener "ping" failed'));
  check('0 ошибок в консоли (desktop)', realErrors.length === 0, realErrors.join(' | '));
  await page.close();
}

/* ================= 2. prefers-reduced-motion ================= */
{
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  collectErrors(page, errors);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({
    pref: window.SG.prefersReducedMotion,
    total: document.querySelectorAll('.reveal').length,
    inn: document.querySelectorAll('.reveal.is-in').length,
    years: document.querySelector('[data-count-from-year]').textContent,
    sum: document.querySelector('[data-count="1500"]').textContent,
  }));
  check('reduced-motion: все .reveal is-in сразу', r.pref && r.total === r.inn, `${r.inn}/${r.total}`);
  check('reduced-motion: счётчики сразу финальные', r.years === `${YEAR - 2015} ${window_plural(YEAR - 2015)}` && r.sum === `от 1${NBSP}500 сом`, `${r.years} / ${r.sum}`);
  // Клик по якорю в reduced-motion: мгновенно
  await page.click('.pv-nav a[href="#counters"]');
  await page.waitForTimeout(50);
  const y = await page.evaluate(() => Math.abs(document.getElementById('counters').getBoundingClientRect().top - 88));
  check('reduced-motion: якорь без плавности (мгновенно)', y <= 2, String(y));
  check('0 ошибок в консоли (reduced-motion)', errors.length === 0, errors.join(' | '));
  await page.close();
}

/* ================= 3. Мобильный тач + вибрация + lite ================= */
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vibrations.push(p); return true; } });
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } });
  });
  const page = await ctx.newPage();
  collectErrors(page, errors);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({ touch: document.documentElement.classList.contains('is-touch'), lite: document.documentElement.classList.contains('is-lite'), sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check('mobile: нет горизонтального скролла', before.sw <= before.iw, `${before.sw} <= ${before.iw}`);
  check('is-lite при saveData', before.lite);
  check('is-touch до касания отсутствует', !before.touch);
  await page.tap('#hero a.btn.btn--yellow');
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => ({ touch: document.documentElement.classList.contains('is-touch'), sgTouch: window.SG.isTouch, vib: window.__vibrations }));
  check('is-touch после первого touchstart', t.touch && t.sgTouch);
  check('вибрация 8 мс на тап по .btn', JSON.stringify(t.vib) === '[8]', JSON.stringify(t.vib));
  await page.tap('#hero a.btn.btn--wa');
  await page.waitForTimeout(200);
  check('0 ошибок в консоли (mobile)', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: ROOT + '/build/js/.preview-mobile.png', fullPage: false });
  await ctx.close();
}

/* ================= 4. Внедрение после load (порядок объявлений, TDZ) ================= */
{
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  collectErrors(page, errors);
  await page.setContent('<!doctype html><html><head><style>:root{--header-h:60px}</style></head><body><div class="reveal">a</div><span class="num" data-count="5">0</span></body></html>', { waitUntil: 'load' });
  await page.addScriptTag({ path: ROOT + '/build/js/main.js' });
  await page.waitForTimeout(1500);
  const late = await page.evaluate(() => ({ loaded: document.documentElement.classList.contains('is-loaded'), inn: document.querySelector('.reveal').classList.contains('is-in'), n: document.querySelector('.num').textContent, off: window.SG.headerOffset() }));
  check('скрипт после load: is-loaded сразу, без TDZ-ошибок', late.loaded && late.inn && late.n === '5' && late.off === 72 && errors.length === 0, JSON.stringify(late) + ' ' + errors.join('|'));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

/* Русский плюрализатор для ожидаемых значений в тесте */
function window_plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}
