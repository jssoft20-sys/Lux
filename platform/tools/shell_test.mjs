/* Оболочка: заставка, светлая тема, установка приложения, память места.

   Это то, что человек видит до всякого заказа. Если здесь что-то сломано,
   дальше он не пойдёт: заставка, которая не уходит, выглядит как зависший сайт.

   Запуск:  TEST_PORT=7099 node tools/shell_test.mjs
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PORT = process.env.TEST_PORT || '7099';
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};

const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');

async function phone(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, locale: 'ru-RU',
    userAgent: opts.ua, colorScheme: opts.scheme || 'light',
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => (opts.errors || []).push(String(e).slice(0, 180)));
  page.on('console', m => { if (m.type() === 'error') (opts.errors || []).push(m.text().slice(0, 180)); });
  await page.route(/tile|maps|basemaps/i,
    r => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK }));
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  console.log('\n\x1b[1m1. Заставка\x1b[0m');
  {
    // Заставка обязана быть видна БЕЗ единого скрипта: она затем и нужна, чтобы
    // закрыть белый лист, пока эти скрипты грузятся. Проверяем честно — глушим
    // все модули и смотрим, что человек видит.
    const bare = await phone(browser, {});
    await bare.page.route(/\/assets\/js\//, r => r.abort());
    await bare.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await bare.page.waitForTimeout(800);
    const early = await bare.page.evaluate(() => {
      const s = document.querySelector('.sg-splash');
      if (!s) return { there: false };
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return {
        there: true,
        shown: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5,
        big: r.width > 200 && r.height > 300,
        bg: cs.backgroundColor,
      };
    }).catch(() => ({ there: false }));
    ok('заставка видна и без единого скрипта',
       early.there && early.shown && early.big, JSON.stringify(early));
    await bare.page.screenshot({ path: '/tmp/sg-splash.png' }).catch(() => {});
    await bare.ctx.close();

    const { ctx, page } = await phone(browser, { errors });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(4500);
    const gone = await page.evaluate(() => {
      const s = document.querySelector('.sg-splash');
      if (!s) return true;
      const cs = getComputedStyle(s);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    });
    ok('и она уходит сама, а не висит', gone);
    await ctx.close();
  }

  console.log('\n\x1b[1m2. Светлая тема по умолчанию\x1b[0m');
  {
    // Системная тема тёмная, а сервис всё равно должен открыться светлым:
    // владелец попросил прямо — «всегда светлая тема дефолт».
    const { ctx, page } = await phone(browser, { errors, scheme: 'dark' });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const look = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g) || [];
      const light = m.length >= 3 && (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 > 140;
      return { bg, light, attr: document.documentElement.dataset.theme || '(нет)' };
    });
    ok('страница светлая даже при тёмной системной теме', look.light,
       `фон ${look.bg}, data-theme=${look.attr}`);
    await ctx.close();
  }

  console.log('\n\x1b[1m3. Приложение на телефон\x1b[0m');
  {
    const { ctx, page } = await phone(browser, {
      errors,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const txt = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
    ok('на айфоне предлагают поставить на экран «Домой»',
       /установ|домой|приложени/i.test(txt), txt.slice(0, 200));
    await ctx.close();
  }

  console.log('\n\x1b[1m4. Приложение курьера скачивается\x1b[0m');
  {
    const r = await fetch(BASE + '/app/version.json');
    if (r.ok) {
      const info = await r.json();
      ok('сведения о сборке отдаются', !!info.version && !!info.url, JSON.stringify(info).slice(0, 160));
      const apk = await fetch(BASE + info.url, { method: 'HEAD' });
      ok('файл приложения на месте', apk.ok, `код ${apk.status}`);
      ok('и отдаётся с правильным типом',
         (apk.headers.get('content-type') || '').includes('android.package-archive'),
         apk.headers.get('content-type') || '(нет)');
    } else {
      console.log('  \x1b[33m~\x1b[0m приложение ещё не выложено — проверка пропущена');
    }
  }

  console.log('\n\x1b[1m5. Память места\x1b[0m');
  {
    const { ctx, page } = await phone(browser, { errors });
    await page.goto(BASE + '/#/help', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => location.hash);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => location.hash);
    ok('перезагрузка оставляет человека там же', before === after, `было ${before}, стало ${after}`);
    await ctx.close();
  }

  console.log('\n\x1b[1m6. Ошибок в консоли нет\x1b[0m');
  ok('за все проверки ни одного исключения', errors.length === 0,
     errors.slice(0, 4).join(' | '));

  await browser.close();
  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  return fails.length ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
