import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const html = `<svg viewBox="0 0 400 400" width="400" height="400" style="background:#eee">
<style>.rot{transform:rotate(90deg)} .rot2{transform:rotate(90deg);transform-origin:50px 0px;transform-box:view-box}</style>
<g transform="translate(200,200)"><g class="rot" id="a"><rect x="0" y="0" width="100" height="10"/></g></g>
<g transform="translate(200,100)"><g class="rot2" id="b"><rect x="0" y="0" width="100" height="10"/></g></g>
</svg>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({viewport:{width:500,height:500}});
await p.setContent(html);
console.log(await p.evaluate(()=>{const r=id=>{const b=document.getElementById(id).getBoundingClientRect();return [b.x,b.y,b.width,b.height]};return {a:r('a'),b:r('b')}}));
await b.close();
