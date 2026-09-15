import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:7022/', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const r = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('2d');
  const sample = 'Грузоперевозки в Бишкеке без лишней суеты Спринтер и грузчики приедут в выбранное время Рассчитать стоимость Sprinter Go 0755 555 357';
  const w = (font) => { c.font = font; return c.measureText(sample).width; };
  const out = {};
  for (const [name, fb] of [['Unbounded', 'Arial'], ['Manrope', 'Arial']]) {
    for (const wt of [400, 700, 800]) {
      out[`${name}-${wt}`] = w(`${wt} 40px "${name}"`) / w(`${wt} 40px ${fb}`);
    }
  }
  out.loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
