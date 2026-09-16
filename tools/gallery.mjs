// Scroll gallery: node gallery.mjs <url> <outDir> <w> <h> [mobile=0]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const [,, url, outDir, w='1440', h='900', mobile='0'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, isMobile: mobile === '1', hasTouch: mobile === '1', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(800);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
let i = 0;
for (let y = 0; y < total; y += +h * 0.85) {
  await page.evaluate(v => window.scrollTo({ top: v, behavior: 'instant' }), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/s${String(i).padStart(2, '0')}-y${Math.round(y)}.png` });
  i++;
}
await browser.close();
console.log('screens', i, 'height', total);
