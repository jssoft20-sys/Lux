/* Проверка карты: не должно быть серых дыр ни на одном масштабе.

   Владелец жаловался: «карта прогоняет, когда отдаляю — серая». Этот прогон
   меряет ровно это. Мы не считаем плитки в коде — мы тыкаем в экран сеткой
   точек и смотрим, лежит ли под каждой загруженная картинка. Если под точкой
   пусто, человек видит серое пятно, и неважно, что движок думает про себя.

   Запуск:  TEST_PORT=7099 node tools/map_test.mjs   (сервер уже поднят)
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import zlib from 'node:zlib';

const PORT = process.env.TEST_PORT || '7099';
// Обычно проверяем свой сервис, но можно направить прогон и на живой сайт:
// MAP_URL=https://sprintergo.kg/go/ node tools/map_test.mjs
const BASE = (process.env.MAP_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const REAL_TILES = !!process.env.MAP_REAL;   // не подменять плитки своими
const SHOT = '/tmp/sg-map';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};

/** Плитка-заглушка 256×256, собранная прямо здесь.

   Настоящие плитки в прогоне не нужны и вредны: мы проверяем движок, а не
   поставщика. Своя плитка приходит мгновенно, одинаково на каждом запуске и
   не зависит от того, есть ли вообще интернет на машине, где идёт проверка.
*/
function fakeTile() {
  const N = 256;
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let y = 0; y < N; y++) {
    const row = y * (N * 3 + 1);
    raw[row] = 0;                                  // фильтр строки: без фильтра
    for (let x = 0; x < N; x++) {
      const i = row + 1 + x * 3;
      const edge = x < 2 || y < 2 || x > N - 3 || y > N - 3;
      raw[i] = edge ? 90 : 46;                     // рамка, чтобы плитки было видно
      raw[i + 1] = edge ? 96 : 52;
      raw[i + 2] = edge ? 104 : 58;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 2;                        // 8 бит на канал, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** CRC32 на случай старого node, где zlib.crc32 ещё не завезли. */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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

  // Плитки отдаём сами, не выходя в сеть, но НЕ мгновенно. Задержка здесь —
  // главное в прогоне: серые дыры появляются не потому, что плитки не пришли,
  // а потому, что движок выбрасывает старый слой, пока новый ещё едет. С
  // мгновенными плитками этого окна нет, и прогон прошёл бы на сломанном коде.
  const tile = fakeTile();
  const LAG_MS = Number(process.env.MAP_LAG || 450);   // мобильный интернет Бишкека
  let served = 0;
  if (!REAL_TILES) await page.route(/tile|maps|basemaps/i, async route => {
    if (/\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(route.request().url())
        || route.request().resourceType() === 'image') {
      served++;
      await new Promise(r => setTimeout(r, LAG_MS));
      return route.fulfill({ status: 200, contentType: 'image/png', body: tile });
    }
    return route.continue();
  });

  console.log('\n\x1b[1mКарта: серые дыры при отдалении\x1b[0m');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  console.log('  проверяем', BASE, REAL_TILES ? '· плитки настоящие' : '· плитки свои');
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

  const worst = { cover: 1, step: 0, when: '' };
  for (let step = 1; step <= 8 && hasMinus; step++) {
    await minus.tap({ timeout: 5000 }).catch(async () => { await minus.click({ force: true }); });

    // Смотрим не только на успокоившуюся карту, но и на неё же в движении:
    // человек видит именно эти кадры, и серую полосу он поймает здесь.
    let low = { cover: 1, holes: [] };
    for (const wait of [120, 200, 300, 400, 500]) {
      await page.waitForTimeout(wait);
      const shot = await page.evaluate(COVER);
      if (!shot.err && shot.cover < low.cover) low = shot;
    }
    await page.waitForTimeout(900);
    const m = await page.evaluate(COVER);
    if (m.err) { ok(`отдаление ${step}`, false, m.err); break; }

    const worstNow = Math.min(m.cover, low.cover);
    if (worstNow < worst.cover) {
      worst.cover = worstNow; worst.step = step;
      worst.when = low.cover < m.cover ? 'в движении' : 'после остановки';
    }
    const line = `отдаление ${step}: в движении ${(low.cover * 100).toFixed(0)}%, `
               + `после ${(m.cover * 100).toFixed(0)}%, плиток ${m.loaded} из ${m.tiles}`;
    ok(line, worstNow >= 0.98,
       `дыры ${JSON.stringify((low.cover < m.cover ? low : m).holes)}`);
    if (worstNow < 0.98) await page.screenshot({ path: `${SHOT}-hole-${step}.png` });
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

  // Спросим и сам движок: он считает дыры честнее, чем взгляд снаружи.
  const own = await page.evaluate(() => (window.SG_MAP && window.SG_MAP.tiles)
    ? window.SG_MAP.tiles() : null);
  if (own) {
    ok('движок сам не видит дыр', own.holes === 0,
       `движок насчитал дыр: ${own.holes}, всего ${own.total}, загружено ${own.loaded}`);
  }
  if (!REAL_TILES) ok('плитки действительно запрашивались', served > 20, `отдано ${served}`);
  ok('в консоли нет исключений', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: `${SHOT}-final.png` });
  await browser.close();

  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  if (worst.step) {
    console.log(`Худший момент: отдаление ${worst.step} ${worst.when}, `
              + `закрыто ${(worst.cover * 100).toFixed(0)}%`);
  }
  if (fails.length) {
    console.log('\n\x1b[31mПровалы:\x1b[0m');
    for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  }
  return fails.length ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
