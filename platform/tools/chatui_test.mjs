/* Чат клиента, когда связь пропадает и возвращается.

   Жалоба заказчика была «чат бывает прогоняет». Разбирается она на две вещи, и
   обе видны только вживую, с настоящим обрывом связи:

   1. Пока связи не было, курьер писал. Поток событий переигрывает только то,
      что случилось при нём, поэтому эти сообщения проходили мимо, а следующее
      живое ложилось прямо поверх дыры: человек видел ответ на вопрос, которого
      не видел. Вернуть их могла только перезагрузка страницы.
   2. Своё сообщение ушло, а ответ сервера потерялся. Пузырь краснел, человек
      жал «ещё раз» — и в переписке два одинаковых.

   Связь рвём по-настоящему: страница ходит не прямо к сервису, а через
   перемычку на своём порту, и мы рвём её сокеты. Ни context.setOffline, ни
   CDP Network.emulateNetworkConditions уже открытый поток событий не роняют —
   сообщения просто копятся и приходят позже, и прогон «проходит», ничего не
   проверив. Поэтому здесь считаются ещё и обращения: без нового обращения к
   потоку и к переписке проверка не засчитывается.

   Запуск:  TEST_PORT=7099 node tools/chatui_test.mjs   (сервер уже поднят)
*/
import net from 'node:net';
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

/* Перемычка между браузером и сервисом. Рвём её — и рвётся всё, что через неё
   идёт, включая уже открытый поток событий. Другого способа воспроизвести
   «связь пропала» у браузера нет. */
function bridge(toPort) {
  const live = new Set();
  let open = true;
  const srv = net.createServer((sock) => {
    if (!open) { sock.destroy(); return; }
    const up = net.connect(toPort, '127.0.0.1');
    live.add(sock); live.add(up);
    sock.on('close', () => live.delete(sock));
    up.on('close', () => live.delete(up));
    sock.on('error', () => sock.destroy());
    up.on('error', () => { sock.destroy(); up.destroy(); });
    sock.pipe(up);
    up.pipe(sock);
  });
  return {
    listen: () => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port))),
    cut() { open = false; for (const s of live) s.destroy(); live.clear(); },
    heal() { open = true; },
    close() { srv.close(); },
  };
}

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
    } catch { /* дальше проверим токен */ }
  }
  const token = login.body?.token;
  if (!token) return null;
  // Заказ нельзя закрыть одним шагом: статусы ходят по цепочке. Проходим её
  // целиком, ошибки не важны — важно, чтобы водитель освободился и диспетчер
  // снова слал ему предложения.
  const busy = await api('GET', '/courier/orders?active=1', null, token);
  for (const o of (busy.body?.items || busy.body || [])) {
    for (const st of ['at_pickup', 'in_transit', 'done']) {
      await api('POST', `/courier/orders/${o.id}/status`, { status: st }, token);
    }
  }
  await api('POST', '/courier/online', { online: true }, token);
  await api('POST', '/courier/geo', { lat: 42.8760, lng: 74.5710, heading: 90, speed: 0 }, token);
  return token;
}

/** Пузыри переписки так, как их видит человек. */
const bubbles = page => page.evaluate(() =>
  [...document.querySelectorAll('.sg-msg .sg-msg__text')]
    .map(e => (e.textContent || '').trim())
    .filter(Boolean));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ct = await courier();
  if (!ct) { console.log('  водителя завести не удалось'); process.exit(1); }

  console.log('\n\x1b[1mЗаказ с назначенным курьером\x1b[0m');
  const cfg = await api('GET', '/config');
  const tid = (cfg.body?.tariffs || []).find(t => t.code === 'sprinter')?.id
    || (cfg.body?.tariffs || [])[0]?.id;
  const phone = '0555' + String(Date.now()).slice(-6);
  const made = await api('POST', '/orders', {
    tariff_id: tid, phone, name: 'Айбек', loaders: 1,
    points: [
      { addr: 'Токтогула 100', lat: 42.8746, lng: 74.5698 },
      { addr: 'Ахунбаева 45', lat: 42.8380, lng: 74.6100 },
    ],
  });
  const pid = made.body?.public_id;
  const track = made.body?.track_token;
  ok('заказ создан', !!pid, `код ${made.status}`);

  let oid = 0;
  for (let i = 0; i < 12 && !oid; i++) {
    const offers = await api('GET', '/courier/offers', null, ct);
    const items = offers.body?.items || offers.body || [];
    const mine = items.find(o => o.public_id === pid) || items[0];
    if (mine && (await api('POST', `/courier/offers/${mine.id}/accept`, {}, ct)).status === 200) {
      const active = await api('GET', '/courier/orders?active=1', null, ct);
      oid = (active.body?.items || active.body || [])[0]?.id || 0;
    }
    if (!oid) await wait(1200);
  }
  ok('курьер принял заказ', !!oid, 'предложение не пришло');
  const say = text => api('POST', `/courier/orders/${oid}/messages`, { text }, ct);

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU',
  });
  await ctx.route(/tile\.openstreetmap|basemaps\.cartocdn/, r => r.abort());
  const page = await ctx.newPage();
  // Считаем обращения: по ним видно, что поток правда переподключился, а
  // переписку правда перечитали — иначе прогон мог бы «пройти» на том, что
  // обрыва не случилось вовсе.
  let streams = 0;
  let reloads = 0;
  page.on('request', (r) => {
    const u = r.url();
    if (/\/stream(\?|$)/.test(u)) streams += 1;
    else if (/\/messages(\?|$)/.test(u) && r.method() === 'GET') reloads += 1;
  });
  const wire = bridge(Number(PORT));
  const wirePort = await wire.listen();
  const offline = on => { if (on) wire.cut(); else wire.heal(); };

  await page.goto(`http://127.0.0.1:${wirePort}/#/order/${pid}?t=${encodeURIComponent(track)}`,
                  { waitUntil: 'domcontentloaded' });
  await wait(4000);

  console.log('\n\x1b[1mЧат открывается\x1b[0m');
  await say('Здравствуйте, выезжаю');
  await wait(1500);
  const chatBtn = page.locator('button[aria-label*="Чат"], button[aria-label*="чат"]').first();
  ok('кнопка чата на экране', await chatBtn.count() > 0);
  const b = await chatBtn.boundingBox();
  if (b) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await wait(2000);
  const first = await bubbles(page);
  ok('сообщение курьера видно', first.some(x => x.includes('выезжаю')), JSON.stringify(first));
  await page.screenshot({ path: `${SHOT}/chat-open.png` }).catch(() => {});

  console.log('\n\x1b[1mСвязь пропала — и вернулась\x1b[0m');
  const streamsBefore = streams;
  const reloadsBefore = reloads;
  await offline(true);
  await wait(1500);
  // Курьер пишет, пока клиент «в подвале». Его связь цела: он ходит мимо браузера.
  await say('потеря-один');
  await say('потеря-два');
  await wait(2000);

  await offline(false);
  // Поток переподключается сам; ждём с запасом, но без перезагрузки страницы.
  let back = [];
  for (let i = 0; i < 20; i++) {
    await wait(1500);
    back = await bubbles(page);
    if (back.some(x => x.includes('потеря-один')) && back.some(x => x.includes('потеря-два'))) break;
  }
  ok('пропавшее догрузилось само, без перезагрузки',
     back.some(x => x.includes('потеря-один')) && back.some(x => x.includes('потеря-два')),
     JSON.stringify(back.slice(-4)));
  // Без этой проверки прогон мог бы «пройти» на том, что связь и не рвалась.
  ok('связь действительно рвалась и вернулась', streams > streamsBefore,
     `потоков было ${streamsBefore}, стало ${streams}`);
  ok('переписку перечитали, а не понадеялись на поток', reloads > reloadsBefore,
     `перечитываний было ${reloadsBefore}, стало ${reloads}`);

  await say('после-починки');
  await wait(2500);
  const after = await bubbles(page);
  const iOne = after.findIndex(x => x.includes('потеря-один'));
  const iTwo = after.findIndex(x => x.includes('потеря-два'));
  const iNew = after.findIndex(x => x.includes('после-починки'));
  ok('и легло по порядку, а не поверх дыры',
     iOne >= 0 && iTwo > iOne && iNew > iTwo, JSON.stringify(after.slice(-4)));
  ok('ничего не задвоилось',
     after.filter(x => x.includes('потеря-один')).length === 1
     && after.filter(x => x.includes('после-починки')).length === 1,
     JSON.stringify(after.slice(-5)));
  await page.screenshot({ path: `${SHOT}/chat-recovered.png` }).catch(() => {});

  console.log('\n\x1b[1mСвоё сообщение на подвисшей связи\x1b[0m');
  const before = (await bubbles(page)).length;
  // Запрос уходит и доходит, а ответ теряется — ровно то, на чём чат двоился.
  await page.route('**/api/v1/orders/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.continue().catch(() => {});
  });
  const input = page.locator('.sg-chat__input').first();
  if (await input.count()) {
    await input.fill('моё-сообщение');
    // На телефоне Enter в чате намеренно не отправляет: человек жмёт кнопку.
    const sendBtn = page.locator('.sg-chat__send').first();
    const sb = await sendBtn.boundingBox();
    if (sb) await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await wait(2500);
    const mine = await bubbles(page);
    ok('своё сообщение появилось один раз',
       mine.filter(x => x.includes('моё-сообщение')).length === 1,
       JSON.stringify(mine.slice(-3)));
    ok('и список вырос ровно на один', mine.length === before + 1,
       `было ${before}, стало ${mine.length}`);
  } else {
    ok('поле ввода в чате есть', false, 'не нашли');
  }

  const server = await api('GET', `/orders/${pid}/messages?t=${encodeURIComponent(track)}`);
  const texts = (server.body?.items || []).map(m => m.text);
  ok('на сервере тоже без дублей',
     texts.filter(x => x === 'моё-сообщение').length <= 1, JSON.stringify(texts.slice(-4)));

  if (oid) {
    for (const st of ['at_pickup', 'in_transit', 'done']) {
      await api('POST', `/courier/orders/${oid}/status`, { status: st }, ct);
    }
  }
  await browser.close();
  wire.close();
  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  for (const [n, d] of fails) console.log(`  · ${n}${d ? ' — ' + d : ''}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
