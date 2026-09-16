/* Мостик между веб-приложением курьера и приложением на Android.

   Ради этого мостика приложение и существует. Веб знает, кто вошёл и на линии
   ли человек; телефон умеет держать связь и слать координаты с погасшим экраном.
   Если веб молчит, служба в телефоне не знает ни адреса, ни токена, ни смены —
   и приложение превращается в браузер без адресной строки: ни фоновой геопозиции,
   ни звука на новый заказ. Проверяем, что веб действительно зовёт мостик.

   Настоящий Android тут не нужен: со стороны веба мостик — это объект
   window.SprinterGo. Подставляем свой и смотрим, что и когда в него уехало.

   Запуск:  TEST_PORT=7099 node tools/app_test.mjs   (сервер уже поднят)
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PORT = process.env.TEST_PORT || '7099';
const BASE = `http://127.0.0.1:${PORT}`;
const API = BASE + '/api/v1';
const SHOT = '/tmp/sg-ui';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};
const wait = ms => new Promise(s => setTimeout(s, ms));

const api = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* пустой ответ */ }
  return { status: r.status, body: j };
};

const EMAIL = 'driver@test.kg';
const PASSWORD = 'sprinter2026';

async function courierExists() {
  let login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status === 200) return login.body.token;
  const { execFileSync } = await import('node:child_process');
  try {
    const data = process.env.SG_DATA || '';
    const env = { ...process.env };
    if (data && !env.SG_DB) env.SG_DB = `${data}/sprintergo.sqlite3`;
    execFileSync('python3', ['tools/mkcourier.py', EMAIL, PASSWORD, 'Талгат Осмонов',
                             '0700112233', 'van', 'Mercedes Sprinter', '01KG762ATN'],
                 { cwd: process.cwd(), env, stdio: 'pipe' });
  } catch { /* посмотрим, что скажет вход */ }
  login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  return login.body?.token || null;
}

/* Подставной мостик: ровно те методы, что есть у настоящего Bridge.java, и
   журнал вызовов, который потом читаем из прогона. */
const FAKE_BRIDGE = `
  window.__sgCalls = [];
  window.SprinterGo = {
    setToken: (t) => window.__sgCalls.push(['setToken', t]),
    clearToken: () => window.__sgCalls.push(['clearToken']),
    setBase: (b) => window.__sgCalls.push(['setBase', b]),
    setShift: (on) => window.__sgCalls.push(['setShift', !!on]),
    buzz: (ms) => window.__sgCalls.push(['buzz', ms]),
    isApp: () => true,
  };
`;

const calls = (page, name) => page.evaluate(
  n => (window.__sgCalls || []).filter(c => c[0] === n), name);

async function newApp(browser, { token } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU',
    // Подпись настоящего приложения: по ней веб понимает, что он внутри.
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko)'
      + ' Chrome/120.0.0.0 Mobile Safari/537.36 SprinterGoApp/1.0',
  });
  await ctx.route(/tile\.openstreetmap|basemaps\.cartocdn/, r => r.abort());
  await ctx.addInitScript(FAKE_BRIDGE);
  if (token) await ctx.addInitScript(t => { try { localStorage.setItem('sg_token', t); } catch (e) { /* */ } }, token);
  const page = await ctx.newPage();
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const token = await courierExists();
  if (!token) {
    console.log('  \x1b[31m✗\x1b[0m водителя завести не удалось — проверять нечего');
    process.exit(1);
  }
  await api('POST', '/courier/online', { online: false }, token);

  console.log('\n\x1b[1mПриложение открылось с уже сохранённым входом\x1b[0m');
  {
    const { ctx, page } = await newApp(browser, { token });
    await page.goto(BASE + '/courier', { waitUntil: 'domcontentloaded' });
    await wait(3000);

    const base = await calls(page, 'setBase');
    ok('веб сказал приложению адрес сервиса', base.length > 0, JSON.stringify(base));
    const gave = await calls(page, 'setToken');
    ok('и отдал токен, восстановленный из памяти телефона',
       gave.some(c => c[1] === token), JSON.stringify(gave).slice(0, 120));

    // Без этого служба ходила бы на адрес из сборки, а не на ваш домен.
    const origin = await page.evaluate(() => window.location.origin
      + String(window.SG_BASE || '/').replace(/\/$/, ''));
    ok('адрес — тот, с которого открыли, а не зашитый в приложение',
       base.length > 0 && base[base.length - 1][1] === origin,
       `сказали ${JSON.stringify(base[0] && base[0][1])}, ждали ${origin}`);

    ok('внутри приложения не предлагают его же скачать',
       (await page.locator('.sg-appbar, [data-app-bar]').count()) === 0);
    await page.screenshot({ path: `${SHOT}/app-restored.png` }).catch(() => {});
    await ctx.close();
  }

  console.log('\n\x1b[1mВход через форму\x1b[0m');
  {
    const { ctx, page } = await newApp(browser);
    await page.goto(BASE + '/courier', { waitUntil: 'domcontentloaded' });
    await wait(2500);
    const email = page.locator('input[name="email"]').first();
    const pass = page.locator('input[name="password"]').first();
    const seen = await email.count() > 0 && await pass.count() > 0;
    ok('форма входа на экране', seen);
    if (seen) {
      await email.fill(EMAIL);
      await pass.fill(PASSWORD);
      await page.keyboard.press('Enter');
      await wait(3500);
      const gave = await calls(page, 'setToken');
      ok('после входа токен уехал в приложение',
         gave.some(c => typeof c[1] === 'string' && c[1].length > 10),
         JSON.stringify(gave).slice(0, 120));

      console.log('\n\x1b[1mВыход на линию\x1b[0m');
      // Кнопку смены ищем по её роли, а не по месту: вёрстка ещё поменяется.
      const toggle = page.locator('.shift__toggle, button:has-text("На линию"), button:has-text("Выйти на линию")').first();
      if (await toggle.count()) {
        const b = await toggle.boundingBox();
        if (b) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await wait(3000);
        const shifts = await calls(page, 'setShift');
        ok('приложение узнало, что смена началась',
           shifts.some(c => c[1] === true), JSON.stringify(shifts));

        const state = await api('GET', '/courier/state', null, token);
        ok('и сервер думает так же', state.body?.online === true,
           JSON.stringify(state.body?.online));

        const b2 = await toggle.boundingBox();
        if (b2) await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
        await wait(3000);
        const off = await calls(page, 'setShift');
        ok('и что смена кончилась', off.some(c => c[1] === false), JSON.stringify(off));
      } else {
        ok('кнопка смены найдена', false, 'кнопки нет');
      }
      await page.screenshot({ path: `${SHOT}/app-shift.png` }).catch(() => {});

      console.log('\n\x1b[1mВыход из аккаунта\x1b[0m');
      await page.evaluate(() => {
        // Выход человек делает через меню; здесь важно другое — что при сбросе
        // токена приложение об этом узнаёт, каким бы путём токен ни сбросили.
        const mod = document.querySelector('script[type="module"]');
        return mod && true;
      });
      const before = (await calls(page, 'clearToken')).length;
      await page.evaluate(() => { try { localStorage.removeItem('sg_token'); } catch (e) { /* */ } });
      // Дёргаем тот же путь, которым идёт выход: api.setToken(null).
      await page.evaluate(() => import(String(window.SG_BASE || '/') + 'assets/js/core/api.js')
        .then(m => m.api.setToken(null)));
      await wait(600);
      const after = await calls(page, 'clearToken');
      ok('сброс токена гасит смену в приложении', after.length > before,
         `было ${before}, стало ${after.length}`);
    }
    await ctx.close();
  }

  console.log('\n\x1b[1mОбычный браузер — мостика нет\x1b[0m');
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU',
    });
    await ctx.route(/tile\.openstreetmap|basemaps\.cartocdn/, r => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await page.goto(BASE + '/courier', { waitUntil: 'domcontentloaded' });
    await wait(2500);
    ok('без приложения ничего не падает', errors.length === 0, errors.slice(0, 2).join(' | '));
    ok('форма входа на месте', (await page.locator('input[name="email"]').count()) > 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  for (const [n, d] of fails) console.log(`  · ${n}${d ? ' — ' + d : ''}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
