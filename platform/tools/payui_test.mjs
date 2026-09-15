/* Экран оплаты глазами клиента: код на месте, знак по центру, оплата
   подхватывается сама.

   Банк из-за границы недоступен, поэтому выпущенный код кладём в базу сами
   (tools/seed_qr.py) — ровно такой, какой положил бы ответ Оптимы. Проверяем
   не банк, а экран: виден ли код, читается ли он, не залипает ли человек.

   Запуск:  TEST_PORT=7099 SG_DATA=... node tools/payui_test.mjs
*/
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';

const PORT = process.env.TEST_PORT || '7099';
const BASE = `http://127.0.0.1:${PORT}`;
const API = BASE + '/api/v1';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  else { fails.push([n, d]); console.log(`  \x1b[31m✗\x1b[0m ${n}${d ? '  — ' + d : ''}`); }
  return !!c;
};

const api = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* пусто */ }
  return { status: r.status, body: j };
};

async function main() {
  console.log('\n\x1b[1mЭкран оплаты брони\x1b[0m');

  // Оплату надо включить так же, как её включает владелец — через админку:
  // записать настройку мимо сервера нельзя, у него свой кэш.
  // Почту админа берём из окружения: прогоны поднимают сервис по-разному,
  // а зашитый адрес тихо ломает проверку на пустом месте.
  const login = await api('POST', '/auth/login', {
    email: process.env.SG_ADMIN_EMAIL || 'admin@test.kg',
    password: process.env.SG_ADMIN_PASSWORD || 'admin12345',
  });
  const atoken = login.body?.token;
  if (!ok('админ вошёл', !!atoken, JSON.stringify(login.body).slice(0, 140))) return 1;
  const saved = await api('PUT', '/admin/pay/settings', {
    key: 'kluch-dlya-progona', company: '248', provider: 'optima', enabled: true,
    sale_point: 1, cash: 1, generate_callback: true,
  }, atoken);
  ok('реквизиты сохранены, хотя банк недоступен', saved.status === 200,
     `код ${saved.status}: ${JSON.stringify(saved.body).slice(0, 160)}`);

  const cfg = await api('GET', '/config');
  const tid = cfg.body?.tariffs?.[0]?.id;
  const made = await api('POST', '/orders', {
    tariff_id: tid, phone: '0555778899', name: 'Нурбек',
    points: [{ addr: 'Чуй 100', lat: 42.8746, lng: 74.5698 },
             { addr: 'Ахунбаева 50', lat: 42.8380, lng: 74.6100 }],
  });
  if (!ok('заказ создан', made.status < 300 && !!made.body?.public_id, JSON.stringify(made.body).slice(0, 160))) return 1;

  const seeded = JSON.parse(execFileSync('python3', ['tools/seed_qr.py', '0555778899'],
    { cwd: process.cwd(), env: process.env }).toString().trim());
  if (!ok('код оплаты выпущен', !!seeded.public_id, JSON.stringify(seeded).slice(0, 160))) return 1;

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  // Плитки отдаём пустышкой, а не отменяем: отменённый запрос сам пишет в
  // консоль ошибку, и прогон ругался бы на то, чего в жизни нет.
  const blank = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64');
  await page.route(/tile|maps|basemaps/i,
    r => r.fulfill({ status: 200, contentType: 'image/png', body: blank }));

  await page.goto(`${BASE}/#/order/${seeded.public_id}?t=${seeded.token}`,
                  { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const hello = page.locator('button:has-text("Понятно"), button:has-text("Пропустить")').first();
  if (await hello.count()) { await hello.click({ force: true }).catch(() => {}); await page.waitForTimeout(600); }
  await page.waitForTimeout(1500);

  const shot = async (name) => page.screenshot({ path: `/tmp/sg-pay-${name}.png` }).catch(() => {});
  await shot('screen');

  const view = await page.evaluate(() => {
    const img = document.querySelector('.sg-pay__img');
    const logo = document.querySelector('.sg-pay__logo');
    const code = document.querySelector('.sg-pay__code');
    const rect = el => { const r = el?.getBoundingClientRect(); return r && { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      text: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 300),
      img: rect(img), logo: rect(logo), code: rect(code),
      imgSrc: (img?.getAttribute('src') || '').slice(0, 30),
      loaded: !!(img && img.complete && img.naturalWidth > 0),
    };
  });

  ok('код оплаты виден на экране', !!view.code && view.code.w > 150,
     JSON.stringify(view.code) + ' · ' + view.text.slice(0, 120));
  ok('картинка кода пришла от банка и отрисовалась', view.loaded,
     `src «${view.imgSrc}…», размер ${JSON.stringify(view.img)}`);
  if (view.logo && view.code) {
    const share = view.logo.w / view.code.w;
    ok('знак не закрывает код: меньше пятой части стороны', share > 0.08 && share <= 0.22,
       `знак занимает ${(share * 100).toFixed(0)}% стороны`);
  } else {
    ok('знак Sprinter Go по центру кода', false, 'элемента знака нет');
  }
  ok('человек видит сумму брони', /\d/.test(view.text) && /сом/i.test(view.text),
     view.text.slice(0, 160));
  ok('объяснено, что остальное наличными',
     /наличн|курьер/i.test(view.text), view.text.slice(0, 200));

  // Банк подтверждает оплату — экран обязан уйти дальше сам, без нажатий.
  const auth = Buffer.from('x:y').toString('base64');   // пароль не тот: 401 ожидаем
  const denied = await fetch(API + '/pay/callback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
    body: JSON.stringify({ status: 'PROCESSED', sum: seeded.amount / 100, transactionId: seeded.transaction_id }),
  });
  ok('чужому уведомлению банк-обработчик отказывает', denied.status === 401, `код ${denied.status}`);

  execFileSync('python3', ['-c', `
import os, sys
sys.path.insert(0, os.getcwd())
from server import db, payments
db.init(os.path.join(os.environ.get('SG_DATA') or 'data', 'sprintergo.sqlite3'))
row = db.row("SELECT * FROM payment_qr WHERE transaction_id=?", ("${seeded.transaction_id}",))
payments.confirm(row, row['amount'], source='test')
`], { cwd: process.cwd(), env: process.env });

  await page.waitForTimeout(6000);
  await shot('after');
  const after = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  ok('экран сам ушёл с оплаты, ничего не нажимали',
     !/Отсканируйте|сканер/i.test(after), after.slice(0, 200));
  ok('в консоли нет исключений', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n\x1b[1mИтог:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`);
  return fails.length ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
