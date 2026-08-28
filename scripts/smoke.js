const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:8044';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  function log(s) { console.log(s); }

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Login screen
  log('1) auth screen: ' + (await page.locator('text=Telegram').first().isVisible()));
  // fill username + password
  await page.locator('input').first().fill('alice');
  await page.locator('input[type=password]').fill('demo');
  await page.locator('button:has-text("Войти")').click();
  await page.waitForTimeout(1200);

  // Chats tab
  const chatsVisible = await page.locator('text=Чаты').first().isVisible().catch(() => false);
  log('2) chats tab visible: ' + chatsVisible);
  const chatItems = await page.locator('.chat-item').count();
  log('3) chat items: ' + chatItems);

  // Open first chat
  if (chatItems > 0) {
    await page.locator('.chat-item').first().click();
    await page.waitForTimeout(800);
    const composer = await page.locator('.msg-input').isVisible().catch(() => false);
    log('4) chat opened, composer visible: ' + composer);
    // send a message
    await page.locator('.msg-input').fill('Привет из smoke-теста! **жирный** __курсив__ https://telegram.org');
    await page.waitForTimeout(200);
    await page.locator('.send-btn').click();
    await page.waitForTimeout(700);
    const bubbles = await page.locator('.bubble').count();
    log('5) bubbles after send: ' + bubbles);
    const hasBold = await page.locator('.bubble b').count();
    log('6) formatted bold rendered: ' + (hasBold > 0));
    // open emoji picker
    await page.locator('.emoji-btn').click();
    await page.waitForTimeout(400);
    log('7) emoji picker visible: ' + (await page.locator('.emoji-grid').first().isVisible().catch(() => false)));
    await page.locator('.emoji-btn').click(); // close
    // back
    await page.locator('.chat-nav .nav-btn').first().click();
    await page.waitForTimeout(400);
  }

  // Contacts tab
  await page.locator('.tab[data-tab=contacts]').click();
  await page.waitForTimeout(600);
  log('8) contacts count: ' + (await page.locator('#base .chat-item').count()));

  // Calls tab
  await page.locator('.tab[data-tab=calls]').click();
  await page.waitForTimeout(500);
  log('9) calls tab has "Новый звонок": ' + (await page.locator('text=Новый звонок').isVisible().catch(() => false)));

  // Settings tab
  await page.locator('.tab[data-tab=settings]').click();
  await page.waitForTimeout(500);
  log('10) settings shows Конфиденциальность: ' + (await page.locator('text=Конфиденциальность').isVisible().catch(() => false)));
  // open privacy
  await page.locator('text=Конфиденциальность').click();
  await page.waitForTimeout(500);
  log('11) privacy rows: ' + (await page.locator('#stack .cell').count()));
  await page.locator('#stack .screen .nav-btn').first().click(); // back within top overlay
  await page.waitForTimeout(400);

  // Search (base tab bar now visible)
  await page.locator('.tab.search').click();
  await page.waitForTimeout(500);
  await page.locator('#stack .search-input input').fill('boris');
  await page.waitForTimeout(700);
  log('12) search results present: ' + (await page.locator('#stack .chat-item').count() > 0));
  await page.locator('#stack .screen .nav-btn').last().click().catch(() => {});
  await page.waitForTimeout(300);

  // Poll creation via a group chat
  await page.locator('.tab[data-tab=chats]').click();
  await page.waitForTimeout(400);
  const groupItem = page.locator('.chat-item', { hasText: 'Design Crew' }).first();
  if (await groupItem.isVisible().catch(() => false)) {
    await groupItem.click(); await page.waitForTimeout(700);
    const pollVisible = await page.locator('.poll').first().isVisible().catch(() => false);
    log('13) group poll rendered: ' + pollVisible);
    await page.locator('.chat-nav .nav-btn').first().click();
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: 'scripts/smoke-chats.png', fullPage: false });

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 30).forEach((e) => console.log(e));

  await browser.close();
  process.exit(errors.length > 0 ? 2 : 0);
})().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
