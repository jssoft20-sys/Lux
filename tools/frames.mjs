// Capture hero stage frames over time: node tools/frames.mjs <url> <outDir> <width> <height> [times=500,3000,...]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const [,, url, outDir, w = '1440', h = '900', times = '500,2500,4500,6500,8500,10500,12500,14500,16500,18500,20500'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
let last = 0;
for (const t of times.split(',').map(Number)) {
  await page.waitForTimeout(t - last); last = t;
  await page.screenshot({ path: `${outDir}/t${String(t).padStart(5, '0')}.png`, fullPage: false });
}
await browser.close();
console.log('frames saved to', outDir);
