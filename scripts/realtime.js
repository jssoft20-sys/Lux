const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:8044';

async function login(page, user) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.locator('input').first().fill(user);
  await page.locator('input[type=password]').fill('demo');
  await page.locator('button:has-text("Войти")').click();
  await page.waitForTimeout(1000);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const a = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const b = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const pa = await a.newPage(), pb = await b.newPage();
  [pa, pb].forEach((p, i) => { p.on('pageerror', (e) => errors.push('P' + i + ': ' + e.message)); });

  await login(pa, 'alice');
  await login(pb, 'boris');

  // Alice opens chat with Boris
  await pa.locator('.chat-item', { hasText: 'Boris' }).first().click();
  await pa.waitForTimeout(600);
  // Boris opens chat with Alice
  await pb.locator('.chat-item', { hasText: 'Alice' }).first().click();
  await pb.waitForTimeout(600);

  const stamp = 'RT-' + Date.now();
  await pa.locator('.msg-input').fill(stamp);
  await pa.locator('.send-btn').click();
  await pa.waitForTimeout(900);

  // Boris should receive it live
  const gotIt = await pb.locator('.bubble', { hasText: stamp }).first().isVisible().catch(() => false);
  console.log('1) Boris received Alice message live: ' + gotIt);

  // Boris reacts
  if (gotIt) {
    const bubble = pb.locator('.bubble', { hasText: stamp }).first();
    await bubble.dblclick(); // dbl-click reacts ❤️
    await pb.waitForTimeout(700);
    const aliceSeesReaction = await pa.locator('.reaction').first().isVisible().catch(() => false);
    console.log('2) Alice sees Boris reaction live: ' + aliceSeesReaction);
  }

  // Boris replies
  const reply = 'REPLY-' + Date.now();
  await pb.locator('.msg-input').fill(reply);
  await pb.locator('.send-btn').click();
  await pb.waitForTimeout(900);
  const aliceGotReply = await pa.locator('.bubble', { hasText: reply }).first().isVisible().catch(() => false);
  console.log('3) Alice received Boris reply live: ' + aliceGotReply);

  // read receipt: Alice's message should show double tick (Boris read it, chat open)
  await pa.waitForTimeout(500);

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach((e) => console.log(e));
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
