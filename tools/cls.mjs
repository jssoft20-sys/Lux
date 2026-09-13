import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.75 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
await page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({ t: Math.round(e.startTime), value: +e.value.toFixed(4), sources: (e.sources || []).map(s => ({ node: s.node ? (s.node.tagName + (s.node.id ? '#' + s.node.id : '') + '.' + [...(s.node.classList || [])].slice(0, 3).join('.')) : '?', prev: s.previousRect ? [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height] : null, cur: s.currentRect ? [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height] : null })) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
});
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
await page.waitForTimeout(4000);
const shifts = await page.evaluate(() => window.__shifts);
console.log(JSON.stringify(shifts, null, 1).slice(0, 4000));
await browser.close();
