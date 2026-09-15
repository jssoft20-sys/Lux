// usage: node shot.mjs <url-or-file> <out.png> [width] [height] [waitMs] [fullPage=1]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, target, out, w='1440', h='900', wait='800', full='1'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async e => {
  return chromium.launch();
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const url = target.startsWith('http') ? target : 'file://' + target;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, fullPage: full === '1' });
await browser.close();
console.log('saved', out);
