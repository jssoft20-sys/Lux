import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const r = await page.evaluate(() => {
  const h = document.querySelector('.hero-h1'); const out = {};
  const cs = getComputedStyle(h);
  out.now = { w: h.getBoundingClientRect().width, hgt: h.getBoundingClientRect().height, fs: cs.fontSize, maxW: cs.maxWidth, parentW: h.parentElement.getBoundingClientRect().width, textWrap: cs.textWrap, wsp: cs.whiteSpace };
  for (const mw of ['560px', '13ch', '620px', 'none', '100%']) {
    h.style.maxWidth = mw; h.style.textWrap = 'balance';
    out[mw] = { w: Math.round(h.getBoundingClientRect().width), hgt: Math.round(h.getBoundingClientRect().height) };
  }
  h.style.maxWidth = '560px'; h.style.textWrap = 'pretty';
  out['560px+pretty'] = { w: Math.round(h.getBoundingClientRect().width), hgt: Math.round(h.getBoundingClientRect().height) };
  h.style.textWrap = 'wrap';
  out['560px+wrap'] = { w: Math.round(h.getBoundingClientRect().width), hgt: Math.round(h.getBoundingClientRect().height) };
  const mark = document.querySelector('.hero-h1 .mark'); const rng = document.createRange(); rng.selectNodeContents(mark); out.markRects = [...rng.getClientRects()].map(x => Math.round(x.width));
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
