import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const [,, w='412', h='823'] = process.argv;
async function measure(blockFonts) {
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (blockFonts) await page.route('**/*.woff2', r => r.abort());
  await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const q = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), font: getComputedStyle(e).fontFamily.split(',')[0] }; };
    return { eyebrow: q('.hero-eyebrow'), h1: q('.hero-h1'), lead: q('.hero-lead'), actions: q('.hero-actions'), btn: q('.hero-actions .btn'), stats: q('.hero-stats'), loaded: document.fonts.check('700 20px Unbounded') };
  });
  await ctx.close();
  return r;
}
console.log('WITH fonts   ', JSON.stringify(await measure(false)));
console.log('WITHOUT fonts', JSON.stringify(await measure(true)));
await browser.close();
