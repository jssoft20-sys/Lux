import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 500) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(80); }
await page.waitForTimeout(500);
console.log(await page.evaluate(() => [...document.querySelectorAll('.reveal:not(.is-in)')].map(e => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} x=${Math.round(r.left)} w=${Math.round(r.width)} display=${getComputedStyle(e).display}`; })));
await browser.close();
