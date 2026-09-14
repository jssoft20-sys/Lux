/* Проверка карты: не должно быть серых дыр ни на одном масштабе.

   Владелец жаловался: «карта прогоняет, когда отдаляю — серая». Этот прогон
   меряет ровно это. Мы не считаем плитки в коде — мы тыкаем в экран сеткой
   точек и смотрим, лежит ли под каждой загруженная картинка. Если под точкой
   пусто, человек видит серое пятно, и неважно, что движок думает про себя.

   Запуск:  TEST_PORT=7099 node tools/map_test.mjs   (сервер уже поднят)
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const PORT = process.env.TEST_PORT || '7099';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT = '/tmp/sg-map';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};

/** Доля площади карты, закрытая загруженными плитками. Сетка 24×24 точки. */
const COVER = `(() => {
  const box = document.querySelector('.map, .sg-map, [data-map]');
  if (!box) return { err: 'контейнер карты не найден' };
  const r = box.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return { err: 'карта схлопнулась: ' + r.width + '×' + r.height };
  const N = 24;
  let covered = 0, total = 0, holes = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = r.left + r.width * (i + 0.5) / N;
      const y = r.top + r.height * (j + 0.5) / N;
      total++;
      const stack = document.elementsFromPoint(x, y) || [];
      const hit = stack.some(el => el.tagName === 'IMG' && el.complete && el.naturalWidth > 0);
      if (hit) covered++;
      else if (holes.length < 6) holes.push([Math.round(x), Math.round(y)]);
    }
  }
  const imgs = [...box.querySelectorAll('img')];
  return {
    cover: covered / total,
    tiles: imgs.length,
    loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
    holes,
  };
})()`;

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
             + '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  console.log('\n\x1b[1mКарта: серые дыры при отдалении\x1b[0m');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map, .sg-map, [data-map]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);          // даём плиткам догрузиться

  const start = await page.evaluate(COVER);
  if (start.err) { ok('карта нарисовалась', false, start.err); await browser.close(); return 1; }
  ok('на старте карта закрыта плитками',
     start.cover >= 0.98, `закрыто ${(start.cover * 100).toFixed(0)}%, дыры ${JSON.stringify(start.holes)}`);

  // Кнопка «минус». Ищем по метке, а не по классу: вёрстку правят чаще, чем смысл.
  const minus = page.locator('.map__btn--out, [aria-label="Отдалить"], [aria-label="Алыстатуу"]').first();
  const hasMinus = await minus.count().then(c => c > 0).catch(() => false);
  ok('кнопка отдаления есть', hasMinus);

  const worst = { cover: 1, step: 0 };
  for (let step = 1; step <= 8 && hasMinus; step++) {
    await minus.tap({ timeout: 5000 }).catch(async () => { await minus.click({ force: true }); });
    await page.waitForTimeout(1400);
    const m = await page.evaluate(COVER);
    if (m.err) { ok(`отдаление ${step}`, false, m.err); break; }
    const line = `отдаление ${step}: закрыто ${(m.cover * 100).toFixed(0)}%, `
               + `плиток ${m.loaded} из ${m.tiles}`;
    if (m.cover < worst.cover) { worst.cover = m.cover; worst.step = step; }
    ok(line, m.cover >= 0.98, `дыры в ${JSON.stringify(m.holes)}`);
    if (m.cover < 0.98) await page.screenshot({ path: `${SHOT}-hole-${step}.png` });
  }

  // Возврат обратно: приближение не должно оставлять пустоты тем более.
  const plus = page.locator('.map__btn--in, [aria-label="Приблизить"], [aria-label="Жакындатуу"]').first();
  if (await plus.count().then(c => c > 0).catch(() => false)) {
    for (let i = 0; i < 4; i++) {
      await plus.tap({ timeout: 5000 }).catch(async () => { await plus.click({ force: true }); });
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(1200);
    const back = await page.evaluate(COVER);
    ok('после возврата вплотную дыр нет', !back.err && back.cover >= 0.98,
       back.err || `закрыто ${(back.cover * 100).toFixed(0)}%`);
  }

  // Протаскивание: при быстром смещении подложка тоже обязана закрывать экран.
  const box = await page.locator('.map, .sg-map, [data-map]').first().boundingBox();
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.touchscreen.tap(cx, cy).catch(() => {});
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx - i * 28, cy - i * 20);
    await page.mouse.up();
    await page.waitForTimeout(1600);
    const drag = await page.evaluate(COVER);
    ok('после протаскивания дыр нет', !drag.err && drag.cover >= 0.98,
       drag.err || `закрыто ${(drag.cover * 100).toFixed(0)}%`);
  }

  ok('в консоли нет исключений', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: `${SHOT}-final.png` });
  await browser.close();

  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  if (worst.step) console.log(`Худший шаг: ${worst.step}, закрыто ${(worst.cover * 100).toFixed(0)}%`);
  if (fails.length) {
    console.log('\n\x1b[31mПровалы:\x1b[0m');
    for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  }
  return fails.length ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
