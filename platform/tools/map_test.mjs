/* Проверка карты: серых дыр не должно быть ни на одном масштабе и ни в одном
   движении, зоны спроса обязаны читаться по плотности, а режим следования —
   держать машину на месте и вести её плавно.

   Считать плитки в коде бессмысленно: движок может думать про себя что угодно,
   а человек смотрит на пиксели. Поэтому главная мера здесь — снимок экрана.
   Карте под тестом подкладывается ядовито-розовый фон, и любая точка этого
   цвета на снимке означает ровно одно: тут дыра, и её видно.

   Запуск:  TEST_PORT=7099 node tools/map_test.mjs   (сервер уже поднят)
   Живой сайт: MAP_URL=https://sprintergo.kg/go MAP_REAL=1 node tools/map_test.mjs
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import zlib from 'node:zlib';

const PORT = process.env.TEST_PORT || '7099';
const BASE = (process.env.MAP_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const REAL_TILES = !!process.env.MAP_REAL;   // не подменять плитки своими
const LAG_MS = Number(process.env.MAP_LAG || 700);   // мобильный интернет Бишкека
const SHOT = '/tmp/sg-map';
const PROBE = '/__map_probe__';              // адрес стенда, страницу отдаём сами

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};
const head = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/** Плитка-заглушка 256×256, собранная прямо здесь.

   Настоящие плитки в прогоне не нужны и вредны: мы проверяем движок, а не
   поставщика. Своя плитка приходит одинаково на каждом запуске и не зависит
   от того, есть ли вообще интернет на машине, где идёт проверка.
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
  return png(N, N, 2, raw);
}

function png(w, h, colorType, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
  return Buffer.concat([len, body, crc]);
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

/** Разбор снимка экрана: 8 бит на канал, без чересстрочности — так снимает браузер. */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, ct = 6, bd = 8;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (bd !== 8 || !ch) throw new Error('снимок в неожиданном формате: ' + bd + '/' + ct);
  const data = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = data[pos++];
    const line = data.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = (x >= ch && prev) ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

/** Доля площади карты, закрытая загруженными плитками. Сетка 24×24 точки.
    Так меряем внутри настоящего приложения, где карту сверху закрывают шторки. */
const COVER = `(() => {
  const box = document.querySelector('.map, .sg-map, [data-map]');
  if (!box) return { err: 'контейнер карты не найден' };
  const r = box.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return { err: 'карта схлопнулась: ' + r.width + '×' + r.height };
  const N = 24;
  let covered = 0, total = 0;
  const holes = [];
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

/* Стенд: карта во весь экран и ничего больше. Страницу подсовываем сами, а
   модуль карты браузер тянет с проверяемого сервера — хоть со своего, хоть с
   живого сайта. Так проверяется именно движок, а не шторки поверх него. */
const STAND = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="./assets/css/tokens.css">
<link rel="stylesheet" href="./assets/css/base.css">
<link rel="stylesheet" href="./assets/css/components.css">
<link rel="stylesheet" href="./assets/css/map.css">
<style>html,body{margin:0;height:100%;background:#101014}
#m{position:absolute;inset:0;background:#FF00FF}</style>
<div id="m"></div>
<script type="module">
import { createMap, pin } from './assets/js/core/map.js';
const box = document.getElementById('m');
const M = createMap(box, { center: [42.8746, 74.5698], zoom: 16, theme: 'light',
                           minZoom: 9, maxZoom: 19 });
box.style.background = '#FF00FF';   // дыра в плитках теперь видна невооружённым глазом
window.M = M;
window.pin = pin;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (type, id, x, y, up) => box.dispatchEvent(new PointerEvent(type, {
  pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y,
  button: up ? -1 : 0, buttons: up ? 0 : 1, bubbles: true, cancelable: true }));

/** Щипок «на себя»: два пальца сходятся, карта отдаляется. */
window.pinchOut = async (steps, gap) => {
  const d0 = 300;
  ev('pointerdown', 1, 195 - d0 / 2, 422); ev('pointerdown', 2, 195 + d0 / 2, 422);
  for (let i = 1; i <= steps; i++) {
    await wait(gap);
    const d = d0 * (1 - 0.9 * i / steps);
    ev('pointermove', 1, 195 - d / 2, 422); ev('pointermove', 2, 195 + d / 2, 422);
  }
  const d = d0 * 0.1;
  ev('pointerup', 1, 195 - d / 2, 422, 1); ev('pointerup', 2, 195 + d / 2, 422, 1);
};

/** Протяг: палец не отрывается, карта уезжает на несколько экранов. */
window.haul = async (dx, dy, steps, gap) => {
  ev('pointerdown', 9, 195, 560);
  for (let i = 1; i <= steps; i++) { await wait(gap); ev('pointermove', 9, 195 + dx * i / steps, 560 + dy * i / steps); }
  ev('pointerup', 9, 195 + dx, 560 + dy, 1);
};

/** Бросок: короткое резкое движение и палец вверх — дальше карта летит сама. */
window.fling = async (dx, dy) => {
  ev('pointerdown', 9, 195, 560);
  for (let i = 1; i <= 8; i++) { await wait(10); ev('pointermove', 9, 195 + dx * i / 8, 560 + dy * i / 8); }
  ev('pointerup', 9, 195 + dx, 560 + dy, 1);
};
</script>`;

/* Сторож телепорта. Таскать карту через полстраны законно — за тем её и таскают.
   А вот перескочить полмира за один кадр или упереться в край света карта не
   может никак: именно так она и вылетала, когда щипок заканчивался между
   кадрами. Считаем это на каждом кадре внутри страницы. */
const WATCH_JUMP = `(() => {
  window.JUMP = { max: 0, edge: false, was: null };
  const tick = () => {
    const c = window.M.getCenter();
    if (window.JUMP.was) {
      const d = Math.max(Math.abs(c[0] - window.JUMP.was[0]), Math.abs(c[1] - window.JUMP.was[1]));
      if (d > window.JUMP.max) window.JUMP.max = d;
    }
    if (Math.abs(c[1]) > 179 || Math.abs(c[0]) > 84) window.JUMP.edge = true;
    window.JUMP.was = c;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    // Клиентское приложение ставит служебного работника, и он отдаёт свои
    // сохранённые копии мимо всего. Проверять надо тот файл, что лежит на
    // сервере сейчас, а не тот, что браузер припас в прошлый раз.
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
             + '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  // Плитки отдаём сами, не выходя в сеть, но НЕ мгновенно. Задержка здесь —
  // главное в прогоне: серые дыры появляются не потому, что плитки не пришли,
  // а потому, что движок теряет то, что уже было, пока новое ещё едет.
  const tile = fakeTile();
  let served = 0;
  await page.route('**' + PROBE, r => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: STAND,
  }));
  if (!REAL_TILES) await page.route(/tile|maps|basemaps/i, async route => {
    if (/\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(route.request().url())
        || route.request().resourceType() === 'image') {
      served++;
      await new Promise(r => setTimeout(r, LAG_MS));
      return route.fulfill({ status: 200, contentType: 'image/png', body: tile });
    }
    return route.continue();
  });

  /** Доля розового на снимке: это и есть дыры, как их видит человек. */
  async function bare() {
    const im = decodePng(await page.screenshot());
    let bad = 0, total = 0;
    for (let y = 0; y < im.h; y += 2) {
      for (let x = 0; x < im.w; x += 2) {
        const i = (y * im.w + x) * im.ch;
        total++;
        if (im.data[i] > 200 && im.data[i + 1] < 80 && im.data[i + 2] > 200) bad++;
      }
    }
    return 100 * bad / total;
  }

  /** Худший кадр за отрезок времени: человек видит именно его, а не среднее. */
  async function worstOver(ms) {
    const t0 = Date.now();
    let worst = 0;
    do { const v = await bare(); if (v > worst) worst = v; } while (Date.now() - t0 < ms);
    return worst;
  }

  /* ── 1. Приложение целиком: карта под шторками ─────────────────────────── */

  head('Карта в приложении: отдаление и протаскивание');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  console.log('  проверяем', BASE, REAL_TILES ? '· плитки настоящие' : '· плитки свои');
  await page.waitForSelector('.map, .sg-map, [data-map]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);          // даём плиткам догрузиться

  const start = await page.evaluate(COVER);
  if (start.err) { ok('карта нарисовалась', false, start.err); await browser.close(); return 1; }
  ok('на старте карта закрыта плитками',
     start.cover >= 0.98, `закрыто ${(start.cover * 100).toFixed(0)}%, дыры ${JSON.stringify(start.holes)}`);

  // Первый тык у клиента съедает открытая шторка — закрываем её и не путаем
  // это с багом карты: проверяем масштаб, а не поведение шторок.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  // Кнопку ищем по метке, а не по классу: вёрстку правят чаще, чем смысл.
  const minus = page.locator('.map__btn--out, [aria-label="Отдалить"], [aria-label="Алыстатуу"]').first();
  const hasMinus = await minus.count().then(c => c > 0).catch(() => false);
  ok('кнопка отдаления есть', hasMinus);

  const worst = { cover: 1, step: 0, when: '' };
  for (let step = 1; step <= 6 && hasMinus; step++) {
    await minus.tap({ timeout: 4000 }).catch(async () => { await minus.click({ force: true }); });

    // Смотрим не только на успокоившуюся карту, но и на неё же в движении.
    let low = { cover: 1, holes: [] };
    for (const wait of [120, 200, 300, 400]) {
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
    ok(`отдаление ${step}: в движении ${(low.cover * 100).toFixed(0)}%, `
       + `после ${(m.cover * 100).toFixed(0)}%, плиток ${m.loaded} из ${m.tiles}`,
       worstNow >= 0.98, `дыры ${JSON.stringify((low.cover < m.cover ? low : m).holes)}`);
    if (worstNow < 0.98) await page.screenshot({ path: `${SHOT}-hole-${step}.png` });
  }

  const plus = page.locator('.map__btn--in, [aria-label="Приблизить"], [aria-label="Жакындатуу"]').first();
  if (await plus.count().then(c => c > 0).catch(() => false)) {
    for (let i = 0; i < 4; i++) {
      await plus.tap({ timeout: 4000 }).catch(async () => { await plus.click({ force: true }); });
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
    const back = await page.evaluate(COVER);
    ok('после возврата вплотную дыр нет', !back.err && back.cover >= 0.98,
       back.err || `закрыто ${(back.cover * 100).toFixed(0)}%`);
  }

  /* ── 2. Стенд: то самое, на что жалуется владелец ──────────────────────── */

  head('Отдалить, а потом таскать — кадр за кадром');
  await page.goto(BASE + PROBE, { waitUntil: 'domcontentloaded' });
  const alive = await page.waitForFunction(() => !!window.M, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  if (!ok('стенд с картой поднялся', alive, 'модуль карты не загрузился с ' + BASE)) {
    await browser.close();
    return 1;
  }
  await page.waitForTimeout(4500);
  ok('стенд начинает без дыр', (await bare()) < 0.5);
  await page.evaluate(WATCH_JUMP);

  let deep = 0;                                   // худшая доля розового за весь прогон
  let deepWhen = '';
  const note = (v, when) => { if (v > deep) { deep = v; deepWhen = when; } };

  for (let round = 0; round < 3; round++) {
    // отдаляем щипком на 4–6 ступеней и СРАЗУ таскаем, не давая догрузиться
    const pinch = page.evaluate(() => window.pinchOut(14, 16));
    note(await worstOver(900), `щипок, круг ${round + 1}`);
    await pinch;
    note(await worstOver(600), `сразу после щипка, круг ${round + 1}`);

    for (let k = 0; k < 4; k++) {
      const dir = k % 2 ? 1 : -1;
      const haul = page.evaluate(([dx, dy]) => window.haul(dx, dy, 26, 14), [dir * -1500, dir * 900]);
      note(await worstOver(900), `протяг ${k + 1}, круг ${round + 1}`);
      await haul;
      note(await worstOver(800), `после протяга ${k + 1}, круг ${round + 1}`);
    }

    // и то же самое броском: палец отпущен, карта летит по инерции
    for (let k = 0; k < 3; k++) {
      const dir = k % 2 ? 1 : -1;
      await page.evaluate(([dx, dy]) => window.fling(dx, dy), [dir * 330, dir * -640]);
      note(await worstOver(1400), `бросок ${k + 1}, круг ${round + 1}`);
    }

    const st = await page.evaluate(() => window.M.tiles());
    console.log(`  круг ${round + 1}: зум ${st.zoom}, центр ${st.center.join(', ')}, `
              + `слои ${st.levels.join('/')}, в очереди ${st.queue}`);
  }

  await page.waitForTimeout(3000);
  const restHole = await bare();
  const rest = await page.evaluate(() => window.M.tiles());
  const jump = await page.evaluate(() => window.JUMP);

  ok('ни одного пустого кадра при отдалении и таскании', deep < 0.5,
     `худший кадр: ${deep.toFixed(1)}% экрана пусто — ${deepWhen}`);
  // Карту выбрасывало на край света, когда щипок заканчивался между кадрами:
  // угол вида оставался от прошлого масштаба, и «что под пальцем» считалось
  // по чужим пикселям. Это и есть тот самый баг с дырами.
  ok('карту ни разу не выбросило за кадр', jump.max < 3,
     `самый большой скачок центра за кадр: ${jump.max.toFixed(2)}°`);
  ok('карта не упиралась в край света', !jump.edge, 'центр доезжал до полюса или антимеридиана');
  ok('в покое дыр нет', restHole < 0.2, `пусто ${restHole.toFixed(1)}%`);
  ok('движок сам не видит дыр', rest.holes === 0, `движок насчитал ${rest.holes}`);
  ok('в покое видны плитки своего масштаба', rest.sharp, 'экран держит растянутая подложка');
  if (deep >= 0.5) await page.screenshot({ path: `${SHOT}-hole-stand.png` });

  /* ── 3. Зоны спроса ───────────────────────────────────────────────────── */

  head('Фиолетовые зоны: чем больше заказов, тем гуще');
  await page.evaluate(() => {
    window.M.setView([42.8746, 74.5698], 13, { animate: false });
    // пять пятен столбиком по возрастанию плотности: экран высокий, и вся шкала
    // помещается на один снимок, а пятна не наползают друг на друга
    window.ZL = [0.1, 0.3, 0.55, 0.8, 1];
    window.zat = (i) => [42.8746 + (2 - i) * 0.017, 74.5698];
    window.zone = window.M.zones({ cell_m: 900, cells: window.ZL.map((lv, i) => ({
      lat: window.zat(i)[0], lng: window.zat(i)[1], level: lv, orders: Math.round(2 + lv * 22),
    })) }, { labels: false });   // подписи пока мешают мерить цвет — включим ниже
  });
  await page.waitForTimeout(1400);

  /** Насколько точка фиолетовая: фиолет — это много красного и синего при малом зелёном. */
  const purple = async () => {
    const im = decodePng(await page.screenshot());
    return await page.evaluate(() => {
      const r = document.querySelector('.map').getBoundingClientRect();
      return window.ZL.map((lv, i) => {
        const p = window.M.containerPoint(window.zat(i));
        return [Math.round(r.left + p.x), Math.round(r.top + p.y)];
      });
    }).then(pts => pts.map(([x, y]) => {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -6; dy <= 6; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const px = Math.round((x + dx) * im.w / 390), py = Math.round((y + dy) * im.h / 844);
          if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
          const i = (py * im.w + px) * im.ch;
          sr += im.data[i]; sg += im.data[i + 1]; sb += im.data[i + 2]; n++;
        }
      }
      return n ? (sr + sb) / 2 / n - sg / n : 0;   // перевес фиолетового над зелёным
    }));
  };

  const scale = await purple();
  console.log('  фиолетовость ступеней: ' + scale.map(v => v.toFixed(1)).join(' · '));
  let grows = true;
  for (let i = 1; i < scale.length; i++) if (scale[i] <= scale[i - 1] + 0.4) grows = false;
  ok('пять ступеней, и каждая гуще прошлой', grows, scale.map(v => v.toFixed(1)).join(' · '));
  ok('самая слабая зона — едва заметная дымка', scale[0] > 0.4 && scale[0] < scale[4] / 2.5,
     'перевес ' + scale[0].toFixed(1) + ' против ' + scale[4].toFixed(1));
  ok('самая густая зона — насыщенный фиолет', scale[4] > 18, 'перевес ' + scale[4].toFixed(1));

  // Подпись у крупной зоны: сколько там заказов. Светлая плашка поверх тёмных
  // плиток — считаем почти белые точки в середине самого густого пятна.
  const labelPx = async () => {
    const im = decodePng(await page.screenshot());
    const p = await page.evaluate(() => window.M.containerPoint(window.zat(4)));
    let light = 0;
    for (let dy = -14; dy <= 14; dy++) {
      for (let dx = -44; dx <= 44; dx++) {
        const px = Math.round((p.x + dx) * im.w / 390), py = Math.round((p.y + dy) * im.h / 844);
        if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
        const i = (py * im.w + px) * im.ch;
        if (im.data[i] > 200 && im.data[i + 1] > 200 && im.data[i + 2] > 200) light++;
      }
    }
    return light;
  };
  const noLabel = await labelPx();
  await page.evaluate(() => window.zone.setStyle({ labels: true }));
  await page.waitForTimeout(500);
  const withLabel = await labelPx();
  ok('у крупной зоны написано, сколько там заказов', withLabel > 200 && noLabel < withLabel / 4,
     `с подписью ${withLabel} точек, без неё ${noLabel}`);

  const counted = await page.evaluate(() => [window.zone.total(), window.zone.peak()]);
  ok('зона знает свой счёт заказов', counted[0] === 71 && counted[1] === 24,
     'всего ' + counted[0] + ', пик ' + counted[1]);

  const order = await page.evaluate(() => {
    const cv = document.querySelector('.map__zones');
    const tiles = document.querySelector('.map__tiles');
    const pane = document.querySelector('.map__pane');
    const zi = (el) => +getComputedStyle(el).zIndex || 0;
    return { above: zi(cv) > zi(tiles), below: zi(cv) < zi(pane), parent: cv.parentNode.className };
  });
  ok('зоны лежат поверх плиток, но под маркерами', order.above && order.below,
     JSON.stringify(order));
  ok('зоны едут вместе с картой, а не с экраном', order.parent === 'map__world', order.parent);

  await page.screenshot({ path: `${SHOT}-zones.png` });

  // Дрожание: пятно обязано стоять на своём квартале в любом кадре протаскивания.
  // Оставляем одно густое пятно, возим карту и каждый раз сравниваем середину
  // нарисованного пятна с точкой, где этот квартал должен быть по расчёту.
  // Разъехались — значит, зона едет не вместе с городом, а сама по себе.
  await page.evaluate(() => {
    window.zone.remove();
    window.spot = [42.8746, 74.5698];
    window.zone = window.M.zones({ cell_m: 900,
      cells: [{ lat: window.spot[0], lng: window.spot[1], level: 1, orders: 24 }] },
      { labels: false });
    window.M.setView(window.spot, 13, { animate: false });
  });
  await page.waitForTimeout(900);
  let drift = 0, seen = 0;
  for (let i = 0; i < 7; i++) {
    await page.evaluate((k) => window.M.setView(
      [42.8746 - k * 0.0018, 74.5698 + k * 0.0026], 13, { animate: false }), i);
    await page.waitForTimeout(170);
    const im = decodePng(await page.screenshot());
    const want = await page.evaluate(() => window.M.containerPoint(window.spot));
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < im.h; y += 2) {
      for (let x = 0; x < im.w; x += 2) {
        const i2 = (y * im.w + x) * im.ch;
        const r = im.data[i2], g = im.data[i2 + 1], b = im.data[i2 + 2];
        if ((r + b) / 2 - g > 22) { sx += x; sy += y; n++; }   // сердцевина густого пятна
      }
    }
    if (n < 40) continue;
    seen++;
    const gotX = sx / n * 390 / im.w, gotY = sy / n * 844 / im.h;
    drift = Math.max(drift, Math.hypot(gotX - want.x, gotY - want.y));
  }
  ok('при движении карты зоны не дрожат', seen >= 5 && drift < 12,
     `замеров ${seen}, разъезд до ${drift.toFixed(1)} точек`);

  /* ── 4. Близкий режим курьера ─────────────────────────────────────────── */

  head('Режим следования: навигатор без кнопок');
  await page.evaluate(() => {
    if (window.zone) window.zone.remove();
    window.car = window.M.marker({ at: [42.8700, 74.5600], html: window.pin('car'), rotate: true, zIndex: 60 });
    window.flag = window.M.marker({ at: [42.8880, 74.5890], html: window.pin('b', '2'), anchor: 'bottom' });
    const line = [];
    for (let i = 0; i <= 100; i++) line.push([42.8700 + 0.0012 * i, 74.5600 + 0.0022 * i]);
    window.rt = window.M.route(line, { width: 6 });
    window.trace = [];
    const watch = () => {
      const c = window.M.getCenter();
      const p = window.M.containerPoint(window.car.at());
      window.trace.push([c[0], c[1], p.x, p.y, window.M.getRotation()]);
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    window.trace = [];
    window.M.follow({ lat: 42.8700, lng: 74.5600, heading: 60, speed: 9 },
      { rotate: true, zoom: 17, marker: window.car });
  });
  // точка GPS раз в 800 мс — как её и отдаёт телефон; между ними должны идти кадры
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(800);
    await page.evaluate((k) => {
      window.M.follow({ lat: 42.8700 + 0.0012 * k, lng: 74.5600 + 0.0022 * k, heading: 60, speed: 9 },
        { marker: window.car });
      window.M.setRouteProgress(k / 100);
    }, i);
  }
  await page.waitForTimeout(900);

  const fol = await page.evaluate(() => {
    const t = window.trace;
    let held = 0, jump = 0, moved = 0;
    for (let i = 1; i < t.length; i++) {
      const dx = Math.abs(t[i][2] - t[i - 1][2]), dy = Math.abs(t[i][3] - t[i - 1][3]);
      if (dx > 3 || dy > 3) held++;                 // машина сползла с якоря
      const step = Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]);
      if (step > 0.0004) jump++;                    // карта прыгнула больше, чем надо
      if (step > 1e-7) moved++;
    }
    const last = t[t.length - 1];
    const done = document.querySelector('.map__route-done').getAttribute('d') || '';
    const live = document.querySelector('.map__route-line').getAttribute('d') || '';
    const rots = [...document.querySelectorAll('.map__marker-rot')].map(e => e.style.transform);
    return {
      frames: t.length, held, jump, moved,
      x: Math.round(last[2]), y: Math.round(last[3]), turn: Math.round(last[4]),
      done: done.length, live: live.length, rots,
      w: window.innerWidth, h: window.innerHeight,
    };
  });

  ok('машина стоит в нижней трети экрана',
     Math.abs(fol.x - fol.w / 2) < 6 && Math.abs(fol.y - fol.h * 0.68) < 14,
     `машина в ${fol.x}, ${fol.y} при экране ${fol.w}×${fol.h}`);
  ok('машина не сползает с места', fol.held === 0, `сползла в ${fol.held} кадрах`);
  ok('между точками GPS карта едет, а не прыгает', fol.jump === 0 && fol.moved > fol.frames * 0.5,
     `прыжков ${fol.jump}, кадров с движением ${fol.moved} из ${fol.frames}`);
  ok('кадров хватает на плавность', fol.frames > 250, 'кадров ' + fol.frames);
  ok('карта развернулась по ходу движения', Math.abs(fol.turn - 60) <= 2, 'поворот ' + fol.turn);
  ok('флажок остался стоять прямо', /rotate\(60/.test(fol.rots[1] || ''), fol.rots.join(' | '));
  ok('пройденная часть маршрута отделена от оставшейся',
     fol.done > 10 && fol.live > fol.done * 3, `пройдено ${fol.done}, осталось ${fol.live}`);
  ok('в режиме следования дыр нет', (await bare()) < 0.5);
  await page.screenshot({ path: `${SHOT}-follow.png` });

  // Курьеру иногда надо посмотреть, что дальше по маршруту. Оттащил карту —
  // слежение уступило; отпустил и подождал — карта сама вернулась к машине.
  const grab = await page.evaluate(async () => {
    window.M.follow({ lat: 42.8796, lng: 74.5776, heading: 60, speed: 9 },
      { marker: window.car, resume: 900 });
    await new Promise(r => setTimeout(r, 300));
    await window.haul(0, -300, 8, 14);
    await new Promise(r => setTimeout(r, 250));
    const away = window.M.containerPoint(window.car.at());
    await new Promise(r => setTimeout(r, 2200));
    const home = window.M.containerPoint(window.car.at());
    return { away: Math.round(away.y), home: Math.round(home.y), want: Math.round(window.innerHeight * 0.68) };
  });
  ok('карту можно оттащить от машины, и она вернётся сама',
     Math.abs(grab.away - grab.want) > 80 && Math.abs(grab.home - grab.want) < 14,
     `оттащили на ${grab.away}, вернулась на ${grab.home}, место машины ${grab.want}`);

  /* На это водитель жаловался прямее всего: «по карте баг — когда отдаляешь и
     двигаешься». Он отдалял карту, чтобы понять, где вообще едет, а следующая
     же посылка координат возвращала масштаб вплотную к машине. Руль у человека —
     значит и масштаб его, пока он сам не попросит вернуться. */
  const zoomHold = await page.evaluate(async () => {
    window.M.follow({ lat: 42.8796, lng: 74.5776, heading: 60, speed: 9 },
      { marker: window.car, zoom: 17, resume: 60000 });
    await new Promise(r => setTimeout(r, 500));
    const near = window.M.getZoom();
    await window.haul(0, -120, 6, 14);          // взялся за карту сам
    window.M.setView(window.M.getCenter(), near - 3, { animate: false });
    await new Promise(r => setTimeout(r, 200));
    const wide = window.M.getZoom();
    // Телефон продолжает слать координаты — каждая с «навигаторным» масштабом.
    for (let i = 1; i <= 4; i++) {
      window.M.follow({ lat: 42.8796 + 0.0012 * i, lng: 74.5776 + 0.0022 * i, heading: 60, speed: 9 },
        { marker: window.car, zoom: 17, resume: 60000 });
      await new Promise(r => setTimeout(r, 400));
    }
    const held = window.M.getZoom();
    // А теперь человек сам просит вернуться к машине — вот тут масштаб обязан
    // подтянуться обратно, иначе кнопка «к машине» ничего не делает.
    window.M.follow({ lat: 42.8796, lng: 74.5776, heading: 60, speed: 9 },
      { marker: window.car, zoom: 17, snap: true });
    await new Promise(r => setTimeout(r, 900));
    return { near, wide, held, after: window.M.getZoom() };
  });
  ok('отдалённая карта не прыгает обратно на каждой точке GPS',
     Math.abs(zoomHold.held - zoomHold.wide) < 0.2,
     `отдалили до ${zoomHold.wide}, после четырёх точек ${zoomHold.held}`);
  ok('а «к машине» масштаб возвращает',
     Math.abs(zoomHold.after - zoomHold.near) < 0.2,
     `было ${zoomHold.near}, стало ${zoomHold.after}`);

  const back = await page.evaluate(async () => {
    window.M.setRouteProgress(1);
    const full = document.querySelector('.map__route-line').getAttribute('d') || '';
    window.M.setRouteProgress(0);
    const none = document.querySelector('.map__route-done').getAttribute('d') || '';
    window.M.unfollow();
    await new Promise(r => setTimeout(r, 900));
    return { full: full.length, none: none.length, turn: window.M.getRotation(), on: window.M.isFollowing() };
  });
  ok('прогресс доходит до краёв', back.full === 0 && back.none === 0,
     `на единице осталось ${back.full}, на нуле пройдено ${back.none}`);
  ok('выход из следования возвращает север наверх', back.turn === 0 && !back.on,
     'поворот ' + back.turn + ', следит ' + back.on);

  /* ── итог ─────────────────────────────────────────────────────────────── */

  if (!REAL_TILES) ok('плитки действительно запрашивались', served > 20, `отдано ${served}`);
  ok('в консоли нет исключений', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: `${SHOT}-final.png` });
  await browser.close();

  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  if (worst.step) {
    console.log(`В приложении хуже всего: отдаление ${worst.step} ${worst.when}, `
              + `закрыто ${(worst.cover * 100).toFixed(0)}%`);
  }
  console.log(`На стенде самый пустой кадр: ${deep.toFixed(2)}%${deepWhen ? ' — ' + deepWhen : ''}`);
  if (fails.length) {
    console.log('\n\x1b[31mПровалы:\x1b[0m');
    for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  }
  return fails.length ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
