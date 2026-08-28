const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:8044';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.locator('input').first().fill('alice');
  await p.locator('input[type=password]').fill('demo');
  await p.locator('button:has-text("Войти")').click();
  await p.waitForTimeout(1200);

  // chat view (Boris)
  await p.locator('.chat-item', { hasText: 'Boris' }).first().click();
  await p.waitForTimeout(700);
  await p.locator('.msg-input').fill('Смотри: **жирный**, __курсив__, `код` и ||спойлер|| 🚀');
  await p.locator('.send-btn').click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/shot-chat.png' });

  // group with poll
  await p.locator('.chat-nav .nav-btn').first().click(); await p.waitForTimeout(400);
  await p.locator('.chat-item', { hasText: 'Design Crew' }).first().click(); await p.waitForTimeout(700);
  await p.screenshot({ path: 'scripts/shot-group.png' });
  await p.locator('.chat-nav .nav-btn').first().click(); await p.waitForTimeout(400);

  // settings
  await p.locator('.tab[data-tab=settings]').click(); await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/shot-settings.png' });

  // calls
  await p.locator('.tab[data-tab=calls]').click(); await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/shot-calls.png' });

  // dark theme chats
  await p.evaluate(() => App.toggleTheme('dark'));
  await p.locator('.tab[data-tab=chats]').click(); await p.waitForTimeout(600);
  await p.screenshot({ path: 'scripts/shot-dark.png' });

  await b.close();
  console.log('shots done');
})().catch((e) => { console.error(e); process.exit(1); });
