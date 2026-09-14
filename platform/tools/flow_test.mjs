/* Живой прогон сценария заказа: от пустой карты до карточки курьера.
   Проверяет то, чего не видно в юнит-тестах — что кнопки реально ведут дальше,
   цена появляется, заказ создаётся и отслеживание оживает.

   Запуск:  TEST_PORT=7099 node tools/flow_test.mjs   (сервер уже поднят)
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

/** Готовит курьера: один и тот же на все прогоны, иначе упрёмся в лимит регистраций. */
async function prepareCourier() {
  const email = 'driver@test.kg';
  const password = 'sprinter2026';

  let login = await api('POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    // Регистрация зарезана лимитом попыток — заводим напрямую тем же скриптом,
    // которым владелец добавляет водителя руками.
    const { execFileSync } = await import('node:child_process');
    try {
      // База у прогона своя (SG_DATA), и без этой подсказки скрипт заводил бы
      // курьера в соседней базе, а прогон потом не мог понять, почему его нет.
      const data = process.env.SG_DATA || '';
      const env = { ...process.env };
      if (data && !env.SG_DB) env.SG_DB = `${data}/sprintergo.sqlite3`;
      execFileSync('python3', ['tools/mkcourier.py', email, password, 'Талгат Осмонов',
                               '0700112233', 'van', 'Mercedes Sprinter', '01KG762ATN'],
                   { cwd: process.cwd(), env, stdio: 'pipe' });
      login = await api('POST', '/auth/login', { email, password });
    } catch { /* пойдём обычным путём */ }
  }
  if (login.status !== 200) {
    await api('POST', '/auth/register', {
      email, password, name: 'Талгат Осмонов', phone: '0700112233',
      car_model: 'Mercedes Sprinter', car_plate: '01KG762ATN', car_color: 'белый',
      vehicle_class: 'van', capacity_kg: 1500,
    });
    const admin = await api('POST', '/auth/login', { email: 'admin@test.kg', password: 'admin12345' });
    if (admin.status !== 200) { console.log('     админ не пускает:', JSON.stringify(admin.body).slice(0, 140)); return null; }
    const list = await api('GET', '/admin/couriers', null, admin.body.token);
    const items = list.body?.items || list.body || [];
    const me = items.find(c => c.email === email) || items[0];
    const cid = me?.id || me?.user_id;
    // Документы тоже одобряем: непроверенным курьерам диспетчер заказов не шлёт,
    // и прогон падал бы на «предложение не пришло», хотя дело не в диспетчере.
    if (cid) await api('PATCH', `/admin/couriers/${cid}`,
                       { status: 'active', verify_status: 'approved' }, admin.body.token);
    login = await api('POST', '/auth/login', { email, password });
  }
  const ct = login.body?.token;
  if (!ct) { console.log('     курьер не вошёл:', JSON.stringify(login.body).slice(0, 140)); return null; }

  await api('POST', '/courier/online', { online: true }, ct);
  await api('POST', '/courier/geo', { lat: 42.8760, lng: 74.5710, heading: 90, speed: 0 }, ct);
  return ct;
}

const shot = (p, name) => p.screenshot({ path: `${SHOT}/flow-${name}.png` }).catch(() => {});

/** Настоящий тап пальцем: приложение мобильное, мышиный клик мимо кассы. */
async function tap(page, loc) {
  const b = await loc.first().boundingBox();
  if (!b) return false;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  return true;
}

async function run() {
  console.log('\n\x1b[1mЖивой прогон сценария заказа\x1b[0m\n');
  const courierToken = await prepareCourier();
  ok('курьер подготовлен и на линии', !!courierToken, 'не удалось завести курьера через API');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'ru-RU', colorScheme: 'dark', permissions: ['geolocation'],
    geolocation: { latitude: 42.8746, longitude: 74.5698 },
  });
  await ctx.route(/tile\.openstreetmap|basemaps\.cartocdn/, r => r.abort());   // плитки не нужны
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  // Первый заход встречает подсказкой — её видит и живой человек, и прогон.
  const hello = page.locator('button:has-text("Понятно"), button:has-text("Пропустить")').first();
  if (await hello.count()) {
    ok('подсказка при первом заходе показана', true);
    await tap(page, hello);
    await page.waitForTimeout(700);
  }

  // ── 1. адрес назначения ────────────────────────────────────────────────────
  console.log('\x1b[1m1. Ввод адреса\x1b[0m');
  const rows = page.locator('button.sg-point__main');
  ok('обе строки адреса на экране', await rows.count() >= 2, `найдено ${await rows.count()}`);
  await tap(page, rows.nth(1));
  await page.waitForTimeout(900);
  await shot(page, '01-address-search');
  ok('экран поиска адреса открылся', await page.locator('input:visible').count() > 0);

  await page.locator('input:visible').first().fill('Суюмбаева Ахматбека');
  await page.waitForTimeout(3000);
  const items = page.locator('button.sg-item');
  const found = await items.count();
  ok('подсказки адресов пришли', found > 1, `вариантов ${found}`);
  await shot(page, '02-suggestions');
  await tap(page, items.first());
  await page.waitForTimeout(2500);

  // ── 1б. детали адресов ─────────────────────────────────────────────────────
  // После адресов появился шаг с подъездом, этажом и подъёмом к двери. Заполнять
  // ничего не обязательно, но пройти его надо — как и живому человеку.
  const details = page.locator('.sg-foot .sg-cta, .sg-cta').first();
  const onDetails = /Детали|Подъезд|двери/i.test(await page.locator('body').innerText());
  ok('шаг с деталями адресов появился', onDetails,
     (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  await shot(page, '02b-details');
  if (onDetails && await details.count()) {
    await tap(page, details);
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1200);
  await shot(page, '03-tariffs');

  // ── 2. тарифы и цена ───────────────────────────────────────────────────────
  console.log('\x1b[1m2. Тарифы и цена\x1b[0m');
  const bodyText = await page.locator('body').innerText();
  const priceShown = /\d[\d\s ]*сом/.test(bodyText);
  ok('цена посчиталась и показана', priceShown, bodyText.replace(/\n+/g, ' | ').slice(0, 220));
  const hasTariff = /Спринтер|Экспресс|Грузовик/.test(bodyText);
  ok('карусель тарифов на экране', hasTariff, bodyText.slice(0, 160));

  // Выбираем «Спринтер»: и карусель проверим, и класс машины совпадёт с курьером.
  const sprinter = page.getByText('Спринтер', { exact: false }).first();
  if (await sprinter.count()) {
    await tap(page, sprinter);
    await page.waitForTimeout(2200);
    await shot(page, '03b-tariff-selected');
    const afterPick = await page.locator('body').innerText();
    ok('выбор тарифа пересчитал цену', /\d[\d\s ]*сом/.test(afterPick),
       afterPick.replace(/\n+/g, ' | ').slice(0, 200));
  } else {
    ok('тариф «Спринтер» доступен для выбора', false, 'карточка не найдена');
  }

  // ── 3. оформление ──────────────────────────────────────────────────────────
  console.log('\x1b[1m3. Оформление\x1b[0m');
  const next = page.getByRole('button').filter({ hasText: /Дальше|Заказать|Продолжить|Оформить/i }).first();
  ok('кнопка перехода к оформлению есть', await next.count() > 0);
  await tap(page, next);
  await page.waitForTimeout(1400);
  await shot(page, '04-details');

  const phone = page.locator('input[type="tel"], input[inputmode="tel"], input[name*="phone"]').first();
  ok('поле телефона на экране подтверждения', await phone.count() > 0);
  if (await phone.count()) {
    await phone.fill('0555123456');
    const nameInput = page.locator('input[name*="name"], input[autocomplete="name"]').first();
    if (await nameInput.count()) await nameInput.fill('Айбек');
    await page.waitForTimeout(500);
    const submit = page.getByRole('button').filter({ hasText: /Заказать|Подтвердить/i }).last();
    ok('кнопка подтверждения заказа есть', await submit.count() > 0);
    await tap(page, submit);
    await page.waitForTimeout(3500);
    await shot(page, '05-searching');
  }
  const afterOrder = await page.locator('body').innerText();
  const searching = /Ищем машину|Ищем свободн|Поиск машины|Унаа издеп/i.test(afterOrder);
  ok('экран поиска машины появился', searching, afterOrder.replace(/\n+/g, ' | ').slice(0, 220));

  // ── 4. курьер принимает ────────────────────────────────────────────────────
  console.log('\x1b[1m4. Курьер принимает заказ\x1b[0m');
  let accepted = false;
  if (courierToken) {
    for (let i = 0; i < 12 && !accepted; i++) {
      const offers = await api('GET', '/courier/offers', null, courierToken);
      const items = offers.body?.items || offers.body || [];
      if (Array.isArray(items) && items.length) {
        const r = await api('POST', `/courier/offers/${items[0].id}/accept`, {}, courierToken);
        accepted = r.status === 200;
      }
      if (!accepted) await new Promise(s => setTimeout(s, 1500));
    }
  }
  ok('курьер принял заказ', accepted, 'предложение не пришло или не принялось');

  await page.waitForTimeout(3500);
  await shot(page, '06-courier-found');
  const tracking = await page.locator('body').innerText();
  ok('клиент увидел карточку курьера без перезагрузки',
     /Талгат|01KG762ATN/.test(tracking),
     tracking.replace(/\n+/g, ' | ').slice(0, 240));

  // ── 5. движение и статусы ──────────────────────────────────────────────────
  if (accepted && courierToken) {
    console.log('\x1b[1m5. Движение и статусы\x1b[0m');
    const mine = await api('GET', '/courier/orders?active=1', null, courierToken);
    const oid = (mine.body?.items || mine.body || [])[0]?.id;
    if (oid) {
      for (const [lat, lng] of [[42.8755, 74.5705], [42.8750, 74.5700], [42.8747, 74.5699]]) {
        await api('POST', '/courier/geo', { lat, lng, heading: 180, speed: 8 }, courierToken);
        await new Promise(s => setTimeout(s, 700));
      }
      await api('POST', `/courier/orders/${oid}/status`, { status: 'at_pickup' }, courierToken);
      await page.waitForTimeout(2200);
      await shot(page, '07-at-pickup');
      const st = await page.locator('body').innerText();
      ok('статус «на месте» доехал до клиента', /на месте|Погрузк|жеринде/i.test(st),
         st.replace(/\n+/g, ' | ').slice(0, 200));

      await api('POST', `/courier/orders/${oid}/status`, { status: 'in_transit' }, courierToken);
      await page.waitForTimeout(1800);
      await api('POST', `/courier/orders/${oid}/status`, { status: 'done' }, courierToken);
      await page.waitForTimeout(2500);
      await shot(page, '08-done-rating');
      const fin = await page.locator('body').innerText();
      ok('экран оценки показан после завершения', /Оцен|балл|звёзд|Спасибо|Баала/i.test(fin),
         fin.replace(/\n+/g, ' | ').slice(0, 200));
    }
  }

  const real = errors.filter(e => !/ERR_FAILED|ERR_BLOCKED|Failed to load resource/i.test(e));
  ok('за весь сценарий ни одной ошибки JS', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n\x1b[1mИтог сценария:\x1b[0m пройдено ${pass}, провалено ${fails.length}`);
  if (fails.length) { console.log('\n\x1b[31mПровалы:\x1b[0m'); for (const [n, d] of fails) console.log(`  · ${n}${d ? '\n      ' + d : ''}`); }
  process.exit(fails.length ? 1 : 0);
}

run().catch(e => { console.error('Прогон упал:', e); process.exit(1); });
