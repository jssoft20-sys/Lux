/* Приёмочный прогон интерфейса: клиент, курьер, админка на телефонных размерах.
   Ловит ошибки консоли, горизонтальный вылет вёрстки, обрезанный текст,
   мелкие кнопки и отсутствие ответа на действия.

   Запуск:  TEST_PORT=7099 node tools/ui_test.mjs      (сервер должен быть уже поднят)
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PORT = process.env.TEST_PORT || '7099';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT = process.env.SHOT_DIR || '/tmp/sg-ui';
const VIEWPORTS = [
  { name: '360×740 (бюджетный Android)', width: 360, height: 740 },
  { name: '390×844 (iPhone 14)', width: 390, height: 844 },
  { name: '430×932 (iPhone Pro Max)', width: 430, height: 932 },
];

let pass = 0;
const fails = [];
const notes = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fails.push([name, detail]); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  return !!cond;
};
const note = (name, detail) => { notes.push([name, detail]); console.log(`  \x1b[33m~\x1b[0m ${name} — ${detail}`); };

/** Общие проверки страницы: вылет по горизонтали, обрезанный текст, мелкие кнопки. */
async function layoutAudit(page, label) {
  const r = await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    const over = [];
    const clipped = [];
    const small = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (b.right > docW + 1.5 || b.left < -1.5) {
        // Элемент внутри подрезающего предка наружу не вылезет: так устроены
        // плитки карты и горизонтальные карусели. Считаем это нормой.
        let clippedByParent = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (/hidden|clip|auto|scroll/.test(o.overflowX + o.overflow)) { clippedByParent = true; break; }
        }
        if (!clippedByParent) {
          over.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 50),
                      left: Math.round(b.left), right: Math.round(b.right) });
        }
      }
      // текст, который не влезает в свою коробку
      if (el.children.length === 0 && (el.textContent || '').trim().length > 1) {
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'auto' && cs.overflow !== 'scroll'
            && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'nowrap') {
          clipped.push({ text: el.textContent.trim().slice(0, 40), w: el.clientWidth, need: el.scrollWidth });
        }
      }
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
           (el.tagName === 'A' && el.getAttribute('href'))) && b.height > 0 && b.height < 40 && b.width > 24) {
        small.push({ text: (el.textContent || '').trim().slice(0, 26), h: Math.round(b.height) });
      }
    }
    return { docW, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 6),
             clipped: clipped.slice(0, 6), small: small.slice(0, 6) };
  });
  ok(`${label}: нет горизонтальной прокрутки`, r.scrollW <= r.docW + 1,
     `документ ${r.scrollW}px при экране ${r.docW}px`);
  ok(`${label}: ничего не вылезает за экран`, r.over.length === 0, JSON.stringify(r.over));
  ok(`${label}: текст нигде не обрезан`, r.clipped.length === 0, JSON.stringify(r.clipped));
  if (r.small.length) note(`${label}: кнопки ниже 40px`, JSON.stringify(r.small));
  return r;
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  console.log('\n\x1b[1mПриёмочный прогон интерфейса\x1b[0m\n');

  for (const vp of VIEWPORTS) {
    console.log(`\x1b[1m${vp.name}\x1b[0m`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      locale: 'ru-RU', permissions: ['geolocation'],
      geolocation: { latitude: 42.8746, longitude: 74.5698 },
    });
    // наружу не ходим: плитки карты и геокодер в тесте не нужны
    await ctx.route(/tile\.openstreetmap|basemaps\.cartocdn|nominatim|router\.project-osrm/,
                    r => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', e => errors.push('JS: ' + String(e).slice(0, 160)));

    // ── клиент ────────────────────────────────────────────────────────────
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const title = await page.title();
    ok('клиент: страница загрузилась', !!title, `заголовок «${title}»`);

    // Первый заход встречает подсказкой. Пока она на экране, до языка и адресов
    // не дотянуться — ни прогону, ни человеку, — поэтому закрываем как человек.
    const hello = page.locator('button:has-text("Понятно"), button:has-text("Пропустить"), '
                             + 'button:has-text("Түшүнүктүү"), button:has-text("Өткөрүү")').first();
    if (await hello.count()) {
      await hello.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    const hasMap = await page.locator('.sg-map, #map, [data-map]').count();
    ok('клиент: карта на экране', hasMap > 0);
    const hasSheet = await page.locator('.sheet, .sg-sheet, [data-sheet]').count();
    ok('клиент: шторка заказа на экране', hasSheet > 0);
    const bodyText = await page.locator('body').innerText();
    ok('клиент: интерфейс на русском, а не ключи словаря',
       !/\border\.[a-z_]+\b|\bcommon\.[a-z_]+\b/.test(bodyText),
       (bodyText.match(/\b(order|common|track)\.[a-z_.]+/g) || []).slice(0, 5).join(', '));
    await layoutAudit(page, 'клиент');
    await page.screenshot({ path: `${SHOT}/client-${vp.width}.png`, fullPage: false }).catch(() => {});

    // переключение языка
    const langBtn = page.locator('[data-lang], .lang-switch, [data-action="lang"]').first();
    if (await langBtn.count()) {
      await langBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
      const after = await page.locator('body').innerText();
      ok('клиент: переключение языка меняет тексты', after !== bodyText);
      ok('клиент: кыргызские буквы отрисованы', /[үөңҮӨҢ]/.test(after) || after === bodyText,
         'в кыргызском тексте нет ү ө ң');
      await langBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    } else {
      note('клиент: переключатель языка', 'не найден по известным селекторам');
    }

    // ── курьер ────────────────────────────────────────────────────────────
    await page.goto(BASE + '/courier', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    const cText = await page.locator('body').innerText();
    ok('курьер: экран входа показан', /вход|кир|почт|email|парол/i.test(cText), cText.slice(0, 120));
    ok('курьер: есть поля почты и пароля',
       (await page.locator('input[type="email"], input[name="email"]').count()) > 0 &&
       (await page.locator('input[type="password"]').count()) > 0);
    await layoutAudit(page, 'курьер');
    await page.screenshot({ path: `${SHOT}/courier-${vp.width}.png` }).catch(() => {});

    // ── админка ───────────────────────────────────────────────────────────
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    const aText = await page.locator('body').innerText();
    ok('админка: экран входа показан', /вход|парол|email|почт/i.test(aText), aText.slice(0, 120));
    await layoutAudit(page, 'админка');
    await page.screenshot({ path: `${SHOT}/admin-${vp.width}.png` }).catch(() => {});

    const real = errors.filter(e => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/i.test(e));
    ok('нет ошибок в консоли', real.length === 0, real.slice(0, 4).join(' | '));
    await ctx.close();
    console.log('');
  }

  // ── десктоп для админки ─────────────────────────────────────────────────
  console.log('\x1b[1m1440×900 (админка на ноутбуке)\x1b[0m');
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await dctx.route(/tile\.openstreetmap|basemaps\.cartocdn|nominatim|router\.project-osrm/, r => r.abort());
  const dpage = await dctx.newPage();
  const derrors = [];
  dpage.on('pageerror', e => derrors.push(String(e).slice(0, 160)));
  await dpage.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await dpage.waitForTimeout(1400);
  await layoutAudit(dpage, 'админка (десктоп)');
  ok('админка на десктопе без ошибок JS', derrors.length === 0, derrors.slice(0, 3).join(' | '));
  await dpage.screenshot({ path: `${SHOT}/admin-desktop.png` }).catch(() => {});
  await dctx.close();

  await browser.close();

  console.log(`\n\x1b[1mИтог интерфейса:\x1b[0m пройдено ${pass}, провалено ${fails.length}, замечаний ${notes.length}`);
  if (fails.length) {
    console.log('\n\x1b[31mПровалы:\x1b[0m');
    for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  }
  process.exit(fails.length ? 1 : 0);
}

run().catch(e => { console.error('Прогон упал:', e); process.exit(1); });
