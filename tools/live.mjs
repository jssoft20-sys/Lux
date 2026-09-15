import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const url = process.argv[2] || 'https://sprintergo.kg/';
const out = process.argv[3] || 'build/live';
fs.mkdirSync(out, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: proxy ? { server: proxy } : undefined });
for (const vp of [{ n: 'desktop', w: 1440, h: 900, m: false }, { n: 'mobile', w: 390, h: 844, m: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = [], failed = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', r => failed.push(r.url() + ' ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    title: document.title, fonts: [...document.fonts].filter(f => f.status === 'loaded').length,
    stagesVisible: document.querySelectorAll('[data-stage].is-visible').length, reveals: document.querySelectorAll('.reveal.is-in').length,
    anims: document.getAnimations().filter(a => a.playState === 'running').length, cssRules: [...document.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length; } catch { return n; } }, 0),
    total: document.querySelector('#calc .calc-total, [data-calc-total]')?.textContent?.trim() || null,
  }));
  await page.screenshot({ path: `${out}/${vp.n}.png` });
  console.log(vp.n, 'load', loadMs + 'ms', JSON.stringify(info), 'errors', errs.slice(0, 5), 'failed', failed.slice(0, 5));
  await ctx.close();
}
await browser.close();
