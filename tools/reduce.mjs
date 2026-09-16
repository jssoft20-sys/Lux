import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const anims = document.getAnimations();
  const running = anims.filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().duration > 50);
  return { total: anims.length, longRunning: running.length, sample: running.slice(0, 5).map(a => (a.animationName || a.id || 'anim') + ':' + a.effect.getTiming().duration), docW: document.documentElement.scrollWidth, revealHidden: [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity === '0').length };
});
console.log('reduced-motion:', JSON.stringify(r));
await browser.close();
