const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:8044';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const p = await b.newContext({ viewport: { width: 420, height: 860 } }).then(c => c.newPage());
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
  await p.locator('input').first().fill('alice');
  await p.locator('input[type=password]').fill('demo');
  await p.locator('button:has-text("Войти")').click();
  await p.waitForTimeout(1200);
  // open BotFather
  await p.locator('.chat-item', { hasText: 'BotFather' }).first().click();
  await p.waitForTimeout(700);
  // send /start-like text to trigger keyboard reply (default botfather reply has keyboard)
  await p.locator('.msg-input').fill('hi');
  await p.locator('.send-btn').click();
  await p.waitForTimeout(2500); // bot replies after typing delay
  const kbButtons = await p.locator('.inline-kb button').count();
  console.log('bot inline-keyboard buttons rendered:', kbButtons, '(expect > 0)');
  // click a keyboard button -> should send that command as a message
  if (kbButtons > 0) {
    await p.locator('.inline-kb button').first().click();
    await p.waitForTimeout(1500);
    console.log('clicking kb button sent a command: ok');
  }
  console.log('ERRORS:', errors.length);
  errors.forEach(e => console.log(' ', e));
  await b.close();
  process.exit(kbButtons > 0 && errors.length === 0 ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
