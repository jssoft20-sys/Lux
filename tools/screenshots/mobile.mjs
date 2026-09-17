import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.env.OUT || 'docs/screenshots/mobile';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5173';
const SELLER_PHONES = { AltynTrade: '996700111222', KGS_Exchange: '996555777888', Bishkek_Crypto: '996777333444', Naryn_USDT: '996999555666', Eldar_Osh: '996550101010' };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function newPage(device) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
  await page.addInitScript((d) => localStorage.setItem('somex.device', d), device);
  return page;
}
async function typeKeypad(page, digits) {
  // native numeric keyboard: a single <input type="tel"> holds the local part of the number
  await page.fill('input[type=tel]', digits);
}
async function login(page, localDigits) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('text=Добро пожаловать');
  await typeKeypad(page, localDigits);
  return page;
}
try {
  const page = await newPage('shot-buyer-device-1');
  await page.goto(`${BASE}/welcome`);
  await page.waitForSelector('text=Начать');
  await sleep(900);
  await shot(page, '01-welcome');
  await login(page, '555123456');
  await sleep(300);
  await shot(page, '02-login');
  await page.getByText('Получить код').click();
  await page.waitForSelector('text=Код из WhatsApp');
  await sleep(300);
  await shot(page, '03-otp');
  await page.locator('button', { hasText: /код \d{6}, нажмите/ }).click();
  await page.waitForURL(/\/(\?.*)?$/, { timeout: 15000 });
  await page.waitForSelector('text=Мой баланс');
  await sleep(1500);
  await shot(page, '04-home');
  await page.locator('button[aria-label]').first(); // noop
  await page.locator('button:has(svg.lucide-sliders-horizontal)').click();
  await page.waitForSelector('text=Фильтры');
  await sleep(500);
  await shot(page, '05-filters');
  await page.locator('button', { hasText: /^Показать/ }).click();
  await sleep(400);
  const buyBtn = page.locator('button', { hasText: /^Купить$/ }).first();
  await buyBtn.click();
  await page.waitForSelector('text=Создать сделку');
  await sleep(600);
  await shot(page, '06-create-order');
  await page.getByText('Я согласен с').click();
  await page.getByText('Создать сделку').click();
  await page.waitForSelector('text=Ожидание оплаты', { timeout: 15000 });
  await sleep(800);
  await shot(page, '07-order-details');
  const orderUrl = page.url();
  const sellerName = (await page.locator('text=Продавец').locator('..').locator('.font-bold').first().innerText()).trim().split('\n')[0];
  console.log('order', orderUrl, 'seller', sellerName);
  await page.getByText('Я отправил оплату').click();
  await page.waitForSelector('text=Загрузите подтверждение');
  await page.getByText(/^Я перевел/).click();
  await page.getByText(/^Счёт принадлежит мне/).click();
  await page.getByText(/^ФИО и банк совпадают/).click();
  await page.setInputFiles('input[type=file]', { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
  await sleep(1200);
  await shot(page, '08-confirm-payment');
  await page.getByText('Подтвердить оплату').click();
  await page.waitForURL(/\/chat$/, { timeout: 15000 });
  await page.waitForSelector('input[placeholder="Напишите сообщение..."]');
  await page.locator('input[placeholder="Напишите сообщение..."]').fill('Я отправил оплату. Проверьте пожалуйста.');
  await page.keyboard.press('Enter');
  await sleep(1500);
  await shot(page, '09-chat');
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector('text=Мой профиль');
  await sleep(700);
  await shot(page, '10-profile');
  await page.goto(`${BASE}/wallet/deposit`);
  await page.waitForSelector('text=Ваш адрес', { timeout: 15000 }).catch(() => undefined);
  await sleep(900);
  await shot(page, '11-deposit');
  await page.goto(`${BASE}/wallet/withdraw`);
  await page.waitForSelector('text=Адрес получателя');
  await page.locator('input[placeholder="T..."]').fill('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  await page.locator('input[placeholder="0.00"]').fill('100');
  await sleep(1200);
  await shot(page, '12-withdraw');
  await page.goto(`${BASE}/profile/security`);
  await page.waitForSelector('text=Устройства');
  await sleep(700);
  await shot(page, '13-security');
  await page.goto(`${BASE}/orders`);
  await page.waitForSelector('text=Сделки');
  await sleep(900);
  await shot(page, '14-orders');
  await page.goto(`${BASE}/kyc`);
  await page.waitForSelector('text=Верификация');
  await sleep(700);
  await shot(page, '15-kyc');

  // seller side
  const seller = SELLER_PHONES[sellerName] || SELLER_PHONES[Object.keys(SELLER_PHONES).find((k) => sellerName.includes(k)) || 'AltynTrade'];
  const sp = await newPage('shot-seller-device-1');
  await sleep(4000);
  await login(sp, seller.slice(3));
  await sp.getByText('Получить код').click();
  await sp.waitForSelector('text=Код из WhatsApp');
  await sp.locator('button', { hasText: /код \d{6}, нажмите/ }).click();
  await sp.waitForURL(/\/(\?.*)?$/, { timeout: 15000 });
  await sp.goto(orderUrl);
  await sp.waitForSelector('text=Проверьте поступление');
  await sleep(800);
  await shot(sp, '16-seller-order');
  await sp.getByText('Проверить и отпустить USDT').click();
  await sp.waitForSelector('text=Проверьте приложение банка');
  for (const t of ['Я открыл приложение банка', 'Отправитель', 'Ожидаемый банк']) await sp.getByText(t, { exact: false }).first().click();
  await sp.locator('input[placeholder="Например: Бекжан Абдыкадыров"]').fill('Бекжан Абдыкадыров');
  await sp.getByText('Сверить').click();
  await sleep(1000);
  await shot(sp, '17-release');
  const hold = sp.locator('button', { hasText: /ОТПУСТИТЬ/ });
  const box = await hold.boundingBox();
  await sp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sp.mouse.down();
  await sleep(2100);
  await sp.mouse.up();
  await sleep(1500);
  if (await sp.getByText('PIN-код', { exact: true }).isVisible().catch(() => false)) {
    await sp.locator('input[type=tel]').last().fill('0000');
    await sleep(900);
  }
  const devBtn = sp.locator('button', { hasText: /код \d{6}, нажмите/ });
  if (await devBtn.isVisible().catch(() => false)) {
    await devBtn.click();
    await sp.getByText('Подтвердить и отпустить').click();
  }
  await sp.waitForSelector('text=Сделка завершена', { timeout: 20000 });
  await sleep(1400);
  await shot(sp, '18-complete');
  await page.goto(orderUrl.replace(/\/orders\/(.+)$/, '/orders/$1/complete'));
  await page.waitForSelector('text=Вы получили', { timeout: 15000 });
  await sleep(1400);
  await shot(page, '19-buyer-complete');
  console.log('DONE');
} catch (e) {
  console.error('SHOTS FAILED', e);
} finally {
  await browser.close();
}
