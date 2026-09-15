/* Живая страница заказа, которой поделились ссылкой — в настоящем браузере.

   Разметку проверяет tools/share_test.py: там видно, что тег скрипта на месте,
   а токен не подходит — страница остаётся карточкой. Здесь проверяем то, чего
   в разметке не видно: что модуль собрался, карта нарисовалась, машина поехала,
   а кнопки «Отменить» на экране нет ни в одном состоянии заказа.

   Запуск:  TEST_PORT=7099 node tools/watch_test.mjs   (сервер уже поднят)
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

/** Курьер тот же, что и в сценарном прогоне: лимит регистраций общий на базу. */
async function courier() {
  const email = 'driver@test.kg';
  const password = 'sprinter2026';
  let login = await api('POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    const { execFileSync } = await import('node:child_process');
    try {
      const data = process.env.SG_DATA || '';
      const env = { ...process.env };
      if (data && !env.SG_DB) env.SG_DB = `${data}/sprintergo.sqlite3`;
      execFileSync('python3', ['tools/mkcourier.py', email, password, 'Талгат Осмонов',
                               '0700112233', 'van', 'Mercedes Sprinter', '01KG762ATN'],
                   { cwd: process.cwd(), env, stdio: 'pipe' });
      login = await api('POST', '/auth/login', { email, password });
    } catch { /* пойдём дальше без курьера */ }
  }
  const token = login.body?.token;
  if (!token) return null;
  // Водитель на стенде один на все прогоны. Если прошлый оставил ему заказ в
  // работе, диспетчер новых предложений не пришлёт — закрываем хвосты.
  const busy = await api('GET', '/courier/orders?active=1', null, token);
  for (const o of (busy.body?.items || busy.body || [])) {
    await api('POST', `/courier/orders/${o.id}/status`, { status: 'done' }, token);
  }
  await api('POST', '/courier/online', { online: true }, token);
  await api('POST', '/courier/geo', { lat: 42.8760, lng: 74.5710, heading: 90, speed: 0 }, token);
  return token;
}

/* Плитки в прогоне свои: настоящие идут в интернет, которого у стенда нет, и
   тогда непонятно, что проверяли — страницу или сеть. Картинка одноцветная,
   зато видно, дошла она до кадра или карта осталась серым полем. */
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9'
  + 'awAAAABJRU5ErkJggg==', 'base64');

async function stubTiles(page) {
  await page.route(/tile|maps|basemaps|openstreetmap|cartocdn/i, async route => {
    const r = route.request();
    if (r.resourceType() === 'image' || /\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(r.url())) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE });
    }
    return route.continue();
  });
}

/** Сколько плиток реально доехало до кадра: серое поле и город отличаются резко. */
async function painted(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('.watch__map img.map__tile')];
    return all.filter(i => i.naturalWidth > 0).length;
  });
}

/** Где на экране машина — чтобы увидеть, что она действительно сдвинулась. */
async function frame(page) {
  return page.evaluate(() => {
    const car = document.querySelector('.watch__map .map-pin--car');
    const box = car && car.closest('.map__marker');
    if (!box) return '';
    const r = box.getBoundingClientRect();
    return `${Math.round(r.x)}:${Math.round(r.y)}`;
  });
}

/** Виден ли человеку хоть где-то способ что-то с заказом сделать. */
async function actions(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a, [role="button"], input, textarea')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      out.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40));
    }
    return out;
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  await stubTiles(page);

  console.log('\n\x1b[1mЗаказ и ссылка\x1b[0m');
  const cfg = await api('GET', '/config');
  const tid = (cfg.body?.tariffs || []).find(t => t.code === 'sprinter')?.id
    || (cfg.body?.tariffs || [])[0]?.id;
  // Телефон у каждого прогона свой: с одного номера сервис не даёт держать
  // два заказа разом, и повторный запуск упирался бы в 409, а не в страницу.
  const phone = '0555' + String(Date.now()).slice(-6);
  const made = await api('POST', '/orders', {
    tariff_id: tid, phone, name: 'Айбек', loaders: 1,
    points: [
      { addr: 'Контур № 5, 1', lat: 42.8746, lng: 74.5698, entrance: '2', flat: '111',
        floor: '12', comment: 'Код калитки 4141' },
      { addr: 'Ахматбека Суюмбаева, 49А', lat: 42.8380, lng: 74.6100, entrance: '2', floor: '7' },
    ],
  });
  const pid = made.body?.public_id;
  const track = made.body?.track_token;
  const view = made.body?.view_token;
  ok('заказ создан', made.status === 201 || made.status === 200, `код ${made.status}`);
  ok('сервер выдал токен просмотра', !!view && view !== track, String(view).slice(0, 12));

  // Ссылку собирает клиентский экран, и токен он берёт из ответа на чтение заказа.
  const read = await api('GET', `/orders/${pid}?t=${encodeURIComponent(track)}`);
  ok('владелец видит токен просмотра в своём заказе',
     read.body?.view_token === view, String(read.body?.view_token).slice(0, 12));
  const guest = await api('GET', `/orders/${pid}?t=${encodeURIComponent(view)}`);
  ok('по токену просмотра заказ читается', guest.status === 200, `код ${guest.status}`);
  ok('и токена просмотра в нём уже нет',
     !guest.body?.view_token && !guest.body?.track_token, JSON.stringify(guest.body?.view_token));

  console.log('\n\x1b[1mСтраница без токена — прежняя карточка\x1b[0m');
  await page.goto(`${BASE}/share/${pid}`, { waitUntil: 'networkidle' });
  ok('карточка открылась', await page.locator('.card__title').isVisible());
  ok('живой карты на ней нет', (await page.locator('.watch').count()) === 0);

  console.log('\n\x1b[1mСтраница по ссылке — живая карта\x1b[0m');
  const url = `${BASE}/share/${pid}?v=${encodeURIComponent(view)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const up = await page.locator('.watch').waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false);
  ok('живая страница собралась', up, 'модуль не поднялся');
  await wait(2500);
  await page.screenshot({ path: `${SHOT}/watch-search.png` }).catch(() => {});

  const tiles = await painted(page);
  ok('карта закрыта плитками, а не серым полем', tiles >= 6, `плиток ${tiles}`);
  ok('точки А и Б на карте',
     (await page.locator('.watch__map .map-pin--a').count()) === 1
     && (await page.locator('.watch__map .map-pin--b').count()) >= 1,
     'меток нет');
  ok('маршрут прочерчен', (await page.locator('.watch__map .map__route, .watch__map svg').count()) > 0,
     'линии нет');
  const text = (await page.locator('.watch').innerText().catch(() => '')) || '';
  ok('видно, что происходит с заказом', /Ищем машину|Машина|Заказ/.test(text), text.slice(0, 80));
  ok('номер заказа на экране', text.includes(pid), text.slice(0, 120));

  const seen = await actions(page);
  ok('кнопки «Отменить» нет', !seen.some(s => /отмен/i.test(s)), JSON.stringify(seen));
  ok('телефона курьера и клиента нет',
     !text.includes(phone.slice(1)) && !/\+996\d/.test(text), text.slice(0, 120));
  ok('нет горизонтальной прокрутки',
     await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log('\n\x1b[1mМашина едет\x1b[0m');
  const ct = await courier();
  let accepted = false;
  if (ct) {
    for (let i = 0; i < 12 && !accepted; i++) {
      const offers = await api('GET', '/courier/offers', null, ct);
      const items = offers.body?.items || offers.body || [];
      const mine = items.find(o => o.public_id === pid) || items[0];
      if (mine) accepted = (await api('POST', `/courier/offers/${mine.id}/accept`, {}, ct)).status === 200;
      if (!accepted) await wait(1200);
    }
  }
  ok('курьер принял заказ', accepted, 'предложение не пришло');

  if (accepted) {
    await wait(2000);
    const afterAccept = (await page.locator('.watch').innerText().catch(() => '')) || '';
    ok('страница сама узнала о машине, без перезагрузки',
       /Mercedes|Sprinter|01KG|Талгат/i.test(afterAccept), afterAccept.slice(0, 140));

    ok('машина появилась на карте',
       await page.locator('.watch__map .map-pin--car').first()
         .waitFor({ state: 'attached', timeout: 8000 }).then(() => true).catch(() => false),
       'метки машины нет');
    const before = await frame(page);
    // Едем от первой точки заметно в сторону второй — на 48×48 такое видно.
    for (const [lat, lng] of [[42.8700, 74.5800], [42.8600, 74.5950], [42.8480, 74.6050]]) {
      await api('POST', '/courier/geo', { lat, lng, heading: 140, speed: 11 }, ct);
      await wait(900);
    }
    const after = await frame(page);
    ok('машина на карте сдвинулась', !!before && !!after && before !== after,
       `было ${before || '—'}, стало ${after || '—'}`);
    await page.screenshot({ path: `${SHOT}/watch-moving.png` }).catch(() => {});

    const orders = await api('GET', '/courier/orders?active=1', null, ct);
    const oid = (orders.body?.items || orders.body || [])[0]?.id;
    if (oid) {
      await api('POST', `/courier/orders/${oid}/status`, { status: 'at_pickup' }, ct);
      await wait(1500);
      const loading = (await page.locator('.watch').innerText().catch(() => '')) || '';
      ok('статус погрузки доехал до страницы', /Груз|погруз/i.test(loading), loading.slice(0, 120));
      await api('POST', `/courier/orders/${oid}/status`, { status: 'in_transit' }, ct);
      await wait(1500);
      const moving = (await page.locator('.watch').innerText().catch(() => '')) || '';
      ok('и «в пути» тоже', /пути/i.test(moving), moving.slice(0, 120));
      const late = await actions(page);
      ok('кнопки «Отменить» нет и в пути', !late.some(s => /отмен/i.test(s)), JSON.stringify(late));
    }
  }

  console.log('\n\x1b[1mМелочи, из-за которых страницей не пользуются\x1b[0m');
  const lang = page.locator('.watch__chip').first();
  if (await lang.count()) {
    const was = (await page.locator('.watch').innerText().catch(() => '')) || '';
    const b = await lang.boundingBox();
    if (b) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await wait(1200);
    const now = (await page.locator('.watch').innerText().catch(() => '')) || '';
    ok('язык переключается', was !== now, 'текст не поменялся');
  } else {
    ok('язык переключается', false, 'кнопки языка нет');
  }
  ok('в консоли чисто', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Убираем за собой: соседний прогон берёт того же водителя, и занятому
  // диспетчер заказов не предлагает.
  if (ct) {
    const left = await api('GET', '/courier/orders?active=1', null, ct);
    for (const o of (left.body?.items || left.body || [])) {
      await api('POST', `/courier/orders/${o.id}/status`, { status: 'done' }, ct);
    }
  }

  await browser.close();
  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  for (const [n, d] of fails) console.log(`  · ${n}${d ? ' — ' + d : ''}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
