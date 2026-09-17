import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import fs from 'node:fs';
const OUT = process.env.OUT || 'docs/screenshots/admin';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5174';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
try {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('text=Somex Admin');
  await page.fill('input[type=email]', 'admin@somex.kg');
  await page.fill('input[type=password]', 'ChangeMe!2026');
  await sleep(300);
  await shot('00-login');
  const [loginRes] = await Promise.all([page.waitForResponse((r) => r.url().includes('/auth/login')), page.click('button:has-text("Войти")')]);
  const loginJson = await loginRes.json();
  await page.waitForSelector('text=Обязательная настройка 2FA');
  const secret = loginJson.setup.secret;
  await page.fill('input[inputmode=numeric]', authenticator.generate(secret));
  await sleep(300);
  await shot('01-totp');
  await page.click('button:has-text("Подтвердить")');
  await page.waitForSelector('text=Дашборд');
  await sleep(2500);
  await shot('02-dashboard');
  const pages = [['users', 'Пользователи', '03-users'], ['kyc', 'KYC', '04-kyc'], ['aml', 'AML', '05-aml'], ['withdrawals', 'Выводы USDT', '06-withdrawals'], ['wallets', 'Кошельки', '07-wallets'], ['p2p', 'P2P сделки', '08-orders'], ['ads', 'Объявления', '09-ads'], ['escrow', 'Эскроу', '10-escrow'], ['disputes', 'Споры', '11-disputes'], ['risk', 'Risk Engine', '12-risk'], ['devices', 'Устройства', '13-devices'], ['blacklist', 'Чёрный список', '14-blacklist'], ['audit', 'Аудит', '15-audit'], ['settings', 'Настройки', '16-settings'], ['admins', 'Администраторы', '17-admins'], ['system', 'Система', '18-system'], ['banks', 'Банки', '19-banks']];
  for (const [path, text, name] of pages) {
    await page.goto(`${BASE}/${path}`);
    await page.waitForSelector(`text=${text}`, { timeout: 20000 });
    await sleep(1600);
    await shot(name);
  }
  // user detail + order drawer
  await page.goto(`${BASE}/users`);
  await page.waitForSelector('table.tbl tr.clickable');
  await page.locator('table.tbl tr.clickable').first().click();
  await page.waitForSelector('text=Связанные аккаунты');
  await sleep(1500);
  await shot('20-user-detail');
  await page.goto(`${BASE}/p2p`);
  await page.waitForSelector('table.tbl tr.clickable');
  await page.locator('table.tbl tr.clickable').first().click();
  await page.waitForSelector('text=Системные события');
  await sleep(1500);
  await shot('21-order-drawer');
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=Настройки');
  await page.click('text=WhatsApp (Wappi)');
  await sleep(800);
  await shot('22-settings-wappi');
  console.log('ADMIN SHOTS DONE');
} catch (e) {
  console.error('ADMIN SHOTS FAILED', e);
} finally {
  await browser.close();
}
