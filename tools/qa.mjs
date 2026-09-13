// QA: console errors, horizontal overflow, broken anchors, screenshots at several widths.
// usage: node tools/qa.mjs <url> <outDir>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const [,, url = 'http://127.0.0.1:7022/', outDir = 'qa'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const report = { url, viewports: {}, consoleErrors: [], pageErrors: [], failedRequests: [] };

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'mobile-small', width: 360, height: 740, mobile: true },
];

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(`[${vp.name}] ${m.text()}`); });
  page.on('pageerror', e => report.pageErrors.push(`[${vp.name}] ${e.message}`));
  page.on('requestfailed', r => report.failedRequests.push(`[${vp.name}] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) report.failedRequests.push(`[${vp.name}] ${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const early = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, vv: window.visualViewport ? window.visualViewport.width : null }));
  // scroll through the page slowly to trigger reveals/counters
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += vp.height * 0.7) {
    await page.evaluate(v => window.scrollTo({ top: v, behavior: 'instant' }), y);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [];
    const vw = window.innerWidth;
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed') {
        // ignore elements inside overflow hidden/auto containers
        let p = el.parentElement, clipped = false;
        while (p && p !== document.body) { const cs = getComputedStyle(p); const o = cs.overflowX; if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip' || cs.position === 'fixed') { clipped = true; break; } p = p.parentElement; }
        if (!clipped) wide.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
      }
    });
    const anchors = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1);
    const broken = [...new Set(anchors)].filter(h => { try { return !document.querySelector(h); } catch { return true; } });
    const smallText = [];
    document.querySelectorAll('input,select,textarea').forEach(el => { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) smallText.push(`${el.tagName}#${el.id}:${fs}px`); });
    const tiny = [];
    document.querySelectorAll('a,button').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40) && el.offsetParent !== null) tiny.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().trim().split(/\s+/)[0]} ${Math.round(r.width)}x${Math.round(r.height)}`); });
    return {
      scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, scrollHeight: de.scrollHeight,
      overflowing: wide.slice(0, 20), brokenAnchors: broken, smallInputs: smallText, smallTapTargets: tiny.slice(0, 25),
      h1: document.querySelectorAll('h1').length, title: document.title, titleLen: document.title.length,
      desc: (document.querySelector('meta[name=description]') || {}).content, revealPending: document.querySelectorAll('.reveal:not(.is-in)').length,
      stagesVisible: document.querySelectorAll('[data-stage].is-visible').length, stages: document.querySelectorAll('[data-stage]').length,
      images: [...document.images].filter(i => !i.alt).length,
    };
  });
  info.earlyScrollWidth = early.scrollWidth; info.earlyInnerWidth = early.innerWidth;
  report.viewports[vp.name] = info;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/${vp.name}-top.png`, fullPage: false });
  await page.screenshot({ path: `${outDir}/${vp.name}-full.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
report.consoleErrors = [...new Set(report.consoleErrors)];
report.failedRequests = [...new Set(report.failedRequests)];
fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
