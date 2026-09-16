// Scroll [data-stage] into view and capture frames: node stageframes.mjs <url> <outDir> <w> <h> <times>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const [,, url, outDir, w='1440', h='900', times='500,3000,6000,9000,12000,15000,18000,21000'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
const el = await page.$('[data-stage]');
if (el) { await el.scrollIntoViewIfNeeded(); await page.evaluate(e => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 20); }, el); }
let last = 0;
for (const t of times.split(',').map(Number)) { await page.waitForTimeout(t - last); last = t; await page.screenshot({ path: `${outDir}/t${String(t).padStart(5,'0')}.png` }); }
const info = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, stage: document.querySelector('[data-stage]')?.getBoundingClientRect().toJSON() }));
console.log(JSON.stringify(info));
await browser.close();
