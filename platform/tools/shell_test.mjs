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

    // Владелец просил прямо: «главное чтоб постоянно не надоедало при
    // перезагрузке сайта». Значит на повторном открытии её быть не должно
    // вовсе — ни анимации, ни жёлтой вспышки на первом кадре.
    let flashed = false;
    const watch = setInterval(async () => {
      try {
        const seen = await page.evaluate(() => {
          const s = document.querySelector('.sg-splash');
          if (!s) return false;
          const cs = getComputedStyle(s);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1;
        });
        if (seen) flashed = true;
      } catch (e) { /* страница как раз перезагружается */ }
    }, 60);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    clearInterval(watch);
    const boot = await page.evaluate(() => document.documentElement.dataset.bootKind || '');
    ok('при перезагрузке заставка больше не показывается', !flashed && boot === 'warm',
       `запуск=${boot}, мелькала=${flashed}`);
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
    await page.waitForTimeout(3000);
    /* Первый заход встречает подсказкой «как это работает». Пока она открыта,
       полосу установки не показываем нарочно: она лежит ниже шторки и её всё
       равно не видно, а два предложения разом — это суета. Закрываем подсказку,
       как закрыл бы человек, и ждём полосу. */
    const hello = page.locator('button:has-text("Понятно"), button:has-text("Пропустить")').first();
    if (await hello.count()) {
      await hello.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(3000);
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

  console.log('\n\x1b[1m4б. Служебный воркер обновляется\x1b[0m');
  {
    // Воркер кэширует оболочку и переустанавливается, только если изменился сам.
    // С зашитой версией это значит «никогда»: обновили сервер, а человек сидит
    // на старых скриптах и уверен, что обновления не приехало.
    const a = await (await fetch(BASE + '/sw-client.js')).text();
    const m = a.match(/const VERSION = '([^']+)'/);
    ok('версия воркера подставляется сервером, а не зашита',
       !!m && m[1] !== 'v1' && m[1].length >= 8, m ? m[1] : '(не нашли)');
  }

  console.log('\n\x1b[1m4в. Потянуть сверху — обновить\x1b[0m');
  {
    const { ctx, page } = await phone(browser, { errors });
    let asked = 0;
    await page.route(/\/api\/v1\/config/, r => { asked++; return r.continue(); });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3200);
    const hello = page.locator('button:has-text("Понятно"), button:has-text("Пропустить")').first();
    if (await hello.count()) { await hello.click({ force: true }).catch(() => {}); await page.waitForTimeout(700); }
    await page.waitForTimeout(1200);
    const before = asked;

    /* Тянем ПАЛЬЦЕМ. Мышью этот жест намеренно не работает: на большом экране
       есть кнопки, а случайное протаскивание мышью перезагружало бы страницу.
       Поэтому шлём настоящие касания через отладочный протокол браузера —
       обычный page.mouse даёт указатель типа «мышь», и движок его не примет. */
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x, y, steps) => {
      await cdp.send('Input.dispatchTouchEvent',
        { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent',
          { type: 'touchMove', touchPoints: [{ x, y: y + i * 10 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    const box = await page.locator('.sg-panel__slot').first().boundingBox();
    if (box) {
      await swipe(box.x + box.width / 2, box.y + 12, 12);
      await page.waitForTimeout(2500);
      ok('жест сверху вниз обновляет содержимое', asked > before,
         `запросов было ${before}, стало ${asked}`);
    } else {
      ok('шторка нашлась', false, 'нет .sg-panel__slot');
    }

    // А на карте тот же жест обновление НЕ вызывает: там он двигает карту.
    const mid = asked;
    const mapBox = await page.locator('.map').first().boundingBox();
    if (mapBox) {
      await swipe(mapBox.x + mapBox.width / 2, mapBox.y + 60, 12);
      await page.waitForTimeout(2000);
      ok('на карте тот же жест обновление не вызывает', asked === mid,
         `запросов было ${mid}, стало ${asked}`);
    }
    await ctx.close();
  }

  console.log('\n\x1b[1m4г. Листаешь — обновление не срабатывает\x1b[0m');
  {
    /* Владелец жаловался: «листаешь бывает обновление баг срабатывает». Внутри
       шторки это уже проверено выше, но тот же баг был и без шторки — на
       обычном длинном экране. Главный блок у курьера и в админке лежит на
       странице и сам не прокручивается, поэтому его scrollTop всё время ноль:
       жест считал, что человек в самом верху, хотя он листал середину списка. */
    const { ctx, page } = await phone(browser, { errors });
    let hits = 0;
    await page.route(/\/api\/v1\/admin\//, r => { hits++; return r.continue(); });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const mail = page.locator('input[type="email"], input[name="email"]').first();
    const pass = page.locator('input[type="password"], input[name="password"]').first();
    if (await mail.count() && await pass.count()) {
      await mail.fill(process.env.SG_ADMIN_EMAIL || 'admin@test.kg');
      await pass.fill(process.env.SG_ADMIN_PASSWORD || 'admin12345');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3500);
    }
    const tall = await page.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      doc.scrollTop = 400;
      return { top: doc.scrollTop, height: doc.scrollHeight, view: doc.clientHeight };
    });
    if (tall.top > 50) {
      const cdp2 = await ctx.newCDPSession(page);
      const swipe2 = async (x, y, steps) => {
        await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= steps; i++) {
          await cdp2.send('Input.dispatchTouchEvent',
            { type: 'touchMove', touchPoints: [{ x, y: y + i * 10 }] });
          await page.waitForTimeout(16);
        }
        await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const was = hits;
      await swipe2(195, 220, 14);
      await page.waitForTimeout(2200);
      ok('посреди списка жест обновление не запускает', hits === was,
         `запросов было ${was}, стало ${hits}`);
    } else {
      // Не на чем проверять — так и скажем, а не сделаем вид, что проверили.
      ok('в админке нашёлся достаточно длинный экран', false,
         `страница ${tall.height} при экране ${tall.view}`);
    }
    await ctx.close();
  }

  console.log('\n\x1b[1m4д. Шторка растягивается, а не висит\x1b[0m');
  {
    /* «Когда тянешь любое модальное окно вверх — снизу пусто; чтобы там не было
       так, а растягивалось куда доступно». Раньше жест вверх не делал ничего:
       растягивание надо было включать параметром, и не включал его никто. */
    const { ctx, page } = await phone(browser, { errors });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const hi = page.locator('button:has-text("Понятно"), button:has-text("Пропустить")').first();
    if (await hi.count()) { await hi.click({ force: true }).catch(() => {}); await page.waitForTimeout(600); }

    await page.evaluate(async () => {
      const ui = await import(String(window.SG_BASE || '/') + 'assets/js/core/ui.js');
      const box = document.createElement('div');
      for (let i = 0; i < 24; i++) {
        const row = document.createElement('p');
        row.style.margin = '14px 0';
        row.textContent = 'строка ' + (i + 1);
        box.appendChild(row);
      }
      window.__probeSheet = ui.sheet({ title: 'Проба', content: box });
    });
    await page.waitForTimeout(900);

    const grip = await page.evaluate(() => {
      const g = document.querySelector('.sheet__grip');
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    const size = () => page.evaluate(() => {
      const b = document.querySelector('.sheet__box');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { h: Math.round(r.height), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    const was = await size();
    if (grip && was) {
      const cdp3 = await ctx.newCDPSession(page);
      await cdp3.send('Input.dispatchTouchEvent',
        { type: 'touchStart', touchPoints: [{ x: grip.x, y: grip.y }] });
      for (let i = 1; i <= 16; i++) {
        await cdp3.send('Input.dispatchTouchEvent',
          { type: 'touchMove', touchPoints: [{ x: grip.x, y: Math.round(grip.y - i * 22) }] });
        await page.waitForTimeout(16);
      }
      await cdp3.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(900);
      const now = await size();
      ok('потянули вверх — шторка выросла', now && now.h > was.h + 100,
         `было ${was.h}, стало ${now && now.h}`);
      // Именно про это была жалоба: снизу не должно остаться пустоты.
      ok('и низом осталась прижата к краю экрана',
         now && Math.abs(now.bottom - now.vh) <= 2,
         `низ на ${now && now.bottom} при экране ${now && now.vh}`);
    } else {
      ok('шторка открылась', false, 'не нашли .sheet__grip');
    }
    await page.evaluate(() => window.__probeSheet && window.__probeSheet.close());
    await ctx.close();
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
