/* Рендер иконок приложения из logo.svg. Запуск: node tools/icons.mjs */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(`${ROOT}/web/assets/img/logo.svg`, 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function render(size, out, maskable = false) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // maskable: логотип ужимаем до безопасной зоны, иначе Android обрежет углы
  const pad = maskable ? Math.round(size * 0.1) : 0;
  await page.setContent(`<style>html,body{margin:0;background:#FFDF00}
    .w{width:${size}px;height:${size}px;display:grid;place-items:center;background:#FFDF00}
    svg{width:${size - pad * 2}px;height:${size - pad * 2}px;display:block}</style>
    <div class="w">${svg}</div>`);
  await page.waitForTimeout(120);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(`${ROOT}/web/${out}`, buf);
  console.log(`  ${out}  ${size}×${size}  ${(buf.length / 1024).toFixed(1)} КБ`);
  await ctx.close();
}

console.log('Иконки:');
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(192, 'icon-maskable-192.png', true);
await render(512, 'icon-maskable-512.png', true);
await render(180, 'apple-touch-icon.png');
await render(32, 'favicon-32.png');
await browser.close();
