import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__ev = [];
  window.dataLayer = { push: (o) => window.__ev.push(['dl', JSON.stringify(o)]) };
  window.gtag = (...a) => window.__ev.push(['gtag', JSON.stringify(a)]);
  window.ym = (...a) => window.__ev.push(['ym', JSON.stringify(a)]);
  window.SG_TRACK = { ads: { whatsapp: 'AW-111/wa', call: 'AW-111/call', form: 'AW-111/form' }, ym: 99 };
  window.open = () => null;
});
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
await page.waitForTimeout(1200);
// клик по WhatsApp в нижней панели
await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' }));
await page.waitForTimeout(600);
await page.click('.dock-btn--wa', { force: true }).catch(e => console.log('wa click:', e.message.slice(0, 60)));
await page.click('.dock-btn--call', { force: true }).catch(e => console.log('call click:', e.message.slice(0, 60)));
await page.waitForTimeout(300);
const ev = await page.evaluate(() => window.__ev);
console.log('события:', ev.length);
for (const e of ev) console.log(' ', e[0], e[1].slice(0, 120));
await browser.close();
