'use strict';
const site = require('../data/site');
const images = require('../data/images.json');
const geo = require('../data/kgz.geo.json');

// ---------- basic helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;

function url(lang, path = '') {
  let hash = '';
  const i = path.indexOf('#');
  if (i >= 0) { hash = path.slice(i); path = path.slice(0, i); }
  path = path.replace(/^\/+|\/+$/g, '');
  const prefix = lang === site.defaultLang ? '/' : `/${lang}/`;
  return prefix + (path ? path + '/' : '') + hash;
}

function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function price(n, lang, opts = {}) {
  if (n == null) return '';
  const cur = site.currency[lang] || 'сом';
  return `${opts.from ? (lang === 'en' ? 'from ' : lang === 'ky' ? '' : 'от ') : ''}${fmtNum(n)}${lang === 'ky' && opts.from ? ' сомдон' : ' ' + cur}`;
}

// ---------- images ----------
function img(name, o = {}) {
  const files = images.files[name];
  if (!files) throw new Error('unknown image ' + name);
  const meta = images.sizes[name];
  const widths = [...files].sort((a, b) => a - b);
  const srcset = widths.map((w) => `/assets/img/${name}-${w}.webp ${w}w`).join(', ');
  const src = `/assets/img/${name}-${widths[Math.min(widths.length - 1, 1)]}.webp`;
  const sizes = o.sizes || '100vw';
  const loading = o.eager ? 'eager' : 'lazy';
  const fetch = o.eager ? ' fetchpriority="high"' : '';
  const cls = 'img' + (o.cls ? ' ' + o.cls : '');
  const lq = images.lqip[name];
  return `<img class="${cls}" src="${src}" srcset="${srcset}" sizes="${attr(sizes)}" width="${meta.w}" height="${meta.h}" alt="${attr(o.alt || '')}" loading="${loading}" decoding="async"${fetch} style="background-image:url(${lq});background-size:cover"${o.style ? ' data-style="' + attr(o.style) + '"' : ''}${o.attrs || ''}>`;
}

// ---------- icons ----------
const I = {
  arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowUp: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wa: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8zm-3.3 4.4c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5 0 1.7-.7 2-1.4.2-.7.2-1.2.1-1.4l-.5-.3-1.9-.9c-.3-.1-.5-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.5-.9-.8-1.5-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.1c-.2-.5-.4-.4-.6-.4h-.5z"/></svg>',
  ig: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/></svg>',
  phone: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h3.5l1.8 4.4-2.3 1.5a11 11 0 0 0 6 6l1.5-2.3L20 15.5V19a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  clock: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  alt: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19 9 8l3.5 6L15 10l6 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  seat: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h6a2 2 0 0 1 2 2v7H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 13h12l2 6H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  camera: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  brief: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 11h7M9 15h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  shield: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  globe: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  heart: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  gift: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4zM3 6.5h18V10H3zM12 6.5V20M12 6.5c-1.5-3-5-3-5-1s5 1 5 1zm0 0c1.5-3 5-3 5-1s-5 1-5 1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  route: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  heli: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h14M10 6v3M4 12.5c0-1.4 1.1-2.5 2.5-2.5H12l2.5 2.5H20l-1 3H7l-1.5-1.5V12.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 18h9M9 15.5V18M13 15.5V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  star: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  wind: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h8a2 2 0 1 1-2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  medical: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  cargo: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  search: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  crown: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10zM4 20h16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  users: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 19a6 6 0 0 1 12 0M15.5 5.5a3 3 0 0 1 0 5.5M17 13a5 5 0 0 1 4 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  survey: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 9 5l3 8 3-5 5 12z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 20h16" stroke="currentColor" stroke-width="1.5"/></svg>',
  eye: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  flag: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h12l-2.5 4L17 12H5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  video: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m16 10 5-3v10l-5-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  chevron: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------- brand ----------
function rotorMark(cls = '') {
  return `<svg class="mark ${cls}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2"/><g class="mark__blades"><path d="M32 32 30 8h4zM32 32l22 11-2 3.5zM32 32 10 43l-2-3.5z" fill="currentColor"/></g><circle cx="32" cy="32" r="4.5" fill="currentColor"/></svg>`;
}
/** Helicopter silhouette (facing left) used in the wordmark */
function heliSilhouette(cls = '') {
  return `<svg class="sil ${cls}" viewBox="0 0 640 260" aria-hidden="true"><g transform="translate(640 0) scale(-1 1)">
    <path d="M44 55.5h512a3 3 0 0 1 0 6H44a3 3 0 0 1 0-6z" fill="currentColor"/><rect x="292" y="58" width="16" height="32" rx="3" fill="currentColor"/>
    <path d="M568 96 578 42h24l6 54z" fill="currentColor"/><path d="M574 112 582 140h18l6-28z" fill="currentColor"/><path d="M494 99h58l1 7h-59z" fill="currentColor"/>
    <path d="M118 150c0-24 18-46 48-54 26-8 58-10 92-8 32 2 60 8 78 20l40 18c70-2 150-8 220-14v20c-70 8-150 14-222 26-8 28-34 50-76 58-56 10-116 4-146-16-18-12-30-30-34-50z" fill="currentColor"/>
    <path d="M132 146c4-20 20-36 44-42l64-6 6 38-90 20c-14 2-22-2-24-10z" fill="#000" opacity=".85"/><path d="M252 96h64l12 38-6 8h-70z" fill="#000" opacity=".85"/>
    <path d="M192 186 184 218M298 178l6 40" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><path d="M140 214c4-9 12-12 24-10h176c12 0 20-2 26-10" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
    <path d="M594 50v52" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  </g></svg>`;
}
function logo(lang, cls = '') {
  return `<a class="logo ${cls}" href="${url(lang)}" aria-label="${site.brandFull}">${heliSilhouette('logo__sil')}<span class="logo__word"><span>HELI</span><span>HOP</span></span></a>`;
}
/** Side-view Airbus H125-style helicopter, facing right. viewBox 0 0 640 260 */
function heliSvg(cls = '', id = 'heli') {
  return `<svg class="heli ${cls}" viewBox="0 0 640 260" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d4553"/><stop offset=".4" stop-color="#1e242c"/><stop offset="1" stop-color="#0b0e12"/></linearGradient>
    <linearGradient id="${id}-boom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#343b47"/><stop offset="1" stop-color="#0d1015"/></linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f2ff" stop-opacity=".9"/><stop offset=".45" stop-color="#78bde6" stop-opacity=".5"/><stop offset="1" stop-color="#173247" stop-opacity=".75"/></linearGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6c977"/><stop offset="1" stop-color="#c98a2a"/></linearGradient>
    <radialGradient id="${id}-disc" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".75" stop-color="#ffffff" stop-opacity=".07"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="heli__rotor">
    <ellipse class="heli__disc" cx="300" cy="58" rx="256" ry="7" fill="url(#${id}-disc)"/>
    <g class="heli__blades">
      <path class="heli__blade" d="M44 55.5h512a3 3 0 0 1 0 6H44a3 3 0 0 1 0-6z" fill="#0b0d11"/>
      <path class="heli__blade heli__blade--2" d="M44 55.5h512a3 3 0 0 1 0 6H44a3 3 0 0 1 0-6z" fill="#0b0d11"/>
    </g>
    <path d="M288 52h24l-3 12h-18z" fill="#2b323c"/>
    <circle cx="300" cy="56" r="6" fill="#3a424e" stroke="#0b0d11" stroke-width="1.5"/>
  </g>
  <g class="heli__body">
    <rect x="295" y="60" width="10" height="30" rx="2" fill="#1a1f27"/>
    <path d="M568 96 578 42h24l6 54z" fill="#171c23" stroke="#0b0d11" stroke-width="1.5"/>
    <path d="M574 112 582 140h18l6-28z" fill="#151a20" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M494 99h58l1 7h-59z" fill="#222932"/>
    <path d="M546 82h5v34h-5z" fill="#1a1f27"/>
    <g class="heli__tail"><path class="heli__tailblade" d="M596 50v50" stroke="#0b0d11" stroke-width="4" stroke-linecap="round"/><circle cx="596" cy="75" r="4" fill="#2a3038"/></g>
    <path d="M112 150c0-24 18-46 48-54 26-8 58-10 92-8 32 2 60 8 78 20l40 18c70-2 150-8 220-14v20c-70 8-150 14-222 26-8 28-34 50-76 58-56 10-116 4-146-16-18-12-30-30-34-50z" fill="url(#${id}-body)" stroke="#0b0d11" stroke-width="1.5"/>
    <path d="M370 106c70-2 150-8 220-14v20c-70 8-150 14-222 26z" fill="url(#${id}-boom)" stroke="#0b0d11" stroke-width="1"/>
    <path d="M372 110c70-3 150-8 218-14v5c-68 7-148 12-218 20z" fill="url(#${id}-gold)" opacity=".95"/>
    <path d="M246 84c34-2 66 2 92 14l-10 34h-88z" fill="#20262f" opacity=".6"/>
    <path d="M118 150c2-22 20-42 48-50 20-6 44-8 70-8l6 40-100 22c-14 2-24-2-24-4z" fill="url(#${id}-glass)"/>
    <path d="M248 92h72l14 40-6 8h-84z" fill="url(#${id}-glass)"/>
    <path d="M242 92l-6 88" stroke="#0b0d11" stroke-width="1.4" opacity=".7"/>
    <path d="M336 130 342 176" stroke="#0b0d11" stroke-width="1.2" opacity=".5"/>
    <path d="M160 184c36 16 90 20 142 12" stroke="#ffffff" stroke-width="1.2" opacity=".07"/>
    <path d="M192 186 184 218M298 178l6 40" stroke="#2c333d" stroke-width="7" stroke-linecap="round"/>
    <path d="M140 214c4-9 12-12 24-10h176c12 0 20-2 26-10" fill="none" stroke="#2c333d" stroke-width="7" stroke-linecap="round"/>
    <path d="M162 100c40-14 90-16 134-8" fill="none" stroke="#ffffff" stroke-width="1.5" opacity=".12"/>
    <path d="M300 62c-4 10-6 20-4 30" stroke="#0b0d11" stroke-width="1" opacity=".4"/>
  </g>
</svg>`;
}
/** Small top-view helicopter icon for maps/paths */
function heliTop(cls = '') {
  return `<svg class="heli-top ${cls}" viewBox="0 0 64 64" aria-hidden="true"><g class="heli-top__rotor"><path d="M32 32 6 10l3-3zM32 32l26 22-3 3zM32 32 58 10l-3-3zM32 32 6 54l3 3z" fill="currentColor" opacity=".8"/></g><path d="M32 12c5 0 8 4 8 10v14l-3 12h-10l-3-12V22c0-6 3-10 8-10z" fill="currentColor"/><path d="M29 44h6l3 14h-12z" fill="currentColor" opacity=".9"/><circle cx="32" cy="32" r="3" fill="#0b0d11"/></svg>`;
}

// ---------- layout blocks ----------
function sectionHead({ label, title, sub, link, linkText, cls = '' }) {
  return `<div class="shead ${cls}">
    <div class="shead__main">
      ${label ? `<p class="label" data-reveal>${esc(label)}</p>` : ''}
      <h2 class="h2" data-split>${esc(title)}</h2>
      ${sub ? `<p class="lead" data-reveal>${esc(sub)}</p>` : ''}
    </div>
    ${link ? `<a class="link-arrow" href="${link}" data-reveal data-magnetic>${esc(linkText)} ${I.arrow}</a>` : ''}
  </div>`;
}

function btn({ href, text, kind = 'primary', icon = '', attrs = '', cls = '' }) {
  const inner = `<span class="btn__label">${esc(text)}</span>${icon ? `<span class="btn__icon">${icon}</span>` : ''}`;
  return href
    ? `<a class="btn btn--${kind} ${cls}" href="${href}" data-magnetic ${attrs}>${inner}</a>`
    : `<button type="button" class="btn btn--${kind} ${cls}" data-magnetic ${attrs}>${inner}</button>`;
}

function waLink(text) {
  return `${site.whatsapp}?text=${encodeURIComponent(text)}`;
}

function durationText(route, lang, t) {
  const c = t.common;
  let s = `${route.duration} ${c.min} ${c.flight}`;
  if (route.ground) s += ` + ${route.ground} ${c.min} ${c.ground}`;
  return s;
}
function routePriceText(route, lang, t) {
  const c = t.common;
  if (route.wholeOnly) return `${price(route.price.whole, lang)} ${c.perAircraft}`;
  return `${price(route.price.middle, lang, { from: true })} ${c.perSeat}`;
}

function routeCard(route, lang, t, i = 0) {
  const r = route.t[lang];
  return `<article class="rcard" data-index="${i}" data-tilt data-reveal="scale">
    <a class="rcard__media" href="${url(lang, 'routes/' + route.slug)}" data-cursor="view">
      ${img(route.image, { alt: r.title, sizes: '(min-width:1024px) 44vw, 92vw', cls: 'rcard__img' })}
      <span class="rcard__badge">${I.clock} ${route.duration} ${t.common.min}${route.ground ? ' + ' + route.ground : ''}</span>
      ${route.landing ? `<span class="rcard__badge rcard__badge--alt">${I.alt} ${fmtNum(route.landing)} ${t.common.metres}</span>` : ''}
      <span class="rcard__num">0${i + 1}</span>
      <span class="rcard__fly" aria-hidden="true">${heliTop()}</span>
    </a>
    <span class="glare" aria-hidden="true"></span>
    <div class="rcard__body">
      <h3 class="rcard__title"><a href="${url(lang, 'routes/' + route.slug)}">${esc(r.title)}</a></h3>
      <p class="rcard__tag">${esc(r.tagline)}</p>
      <div class="rcard__foot">
        <div class="rcard__price"><b>${routePriceText(route, lang, t)}</b><small>${esc(r.format)}</small></div>
        <a class="btn btn--ghost btn--sm" href="${url(lang, 'routes/' + route.slug)}" data-magnetic><span class="btn__label">${esc(t.common.details)}</span><span class="btn__icon">${I.arrow}</span></a>
      </div>
    </div>
  </article>`;
}

function faqList(items, id = 'faq') {
  return `<div class="faq" id="${id}">${items.map((f, i) => `
    <details class="faq__item" data-reveal ${i === 0 ? '' : ''}>
      <summary class="faq__q"><span>${esc(f.q)}</span><span class="faq__icon">${I.plus}</span></summary>
      <div class="faq__a"><div class="faq__inner">${f.a}</div></div>
    </details>`).join('')}</div>`;
}

function ctaSection(lang, t, o = {}) {
  const c = t.common;
  return `<section class="cta" id="cta">
    <div class="cta__bg" data-parallax="0.25">${img(o.image || 'cta', { alt: '', sizes: '100vw' })}</div>
    <div class="cta__heli">${heliSvg('heli--cta', 'heli-cta')}</div>
    <div class="container cta__inner">
      <h2 class="h1 cta__title" data-split>${esc(o.title || c.ctaTitle)}</h2>
      <p class="lead" data-reveal>${esc(o.sub || c.ctaSub)}</p>
      <div class="cta__actions" data-reveal>
        ${btn({ href: o.primaryHref || url(lang, 'routes'), text: o.primary || c.ctaChoose, kind: 'primary', icon: I.arrow })}
        ${btn({ href: waLink(t.booking.waGeneric), text: o.secondary || c.ctaDiscuss, kind: 'wa', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}
      </div>
    </div>
  </section>`;
}

function marquee(items, cls = '') {
  const row = items.map((s) => `<span class="ticker__item">${esc(s)}</span><span class="ticker__sep">${I.heli}</span>`).join('');
  return `<div class="ticker ${cls}" aria-hidden="true"><div class="ticker__track">${row}${row}</div></div>`;
}

function guestCard(g, lang) {
  const name = g.name[lang];
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  return `<article class="gcard"><div class="gcard__avatar" aria-hidden="true"><span>${esc(initials)}</span></div><h3 class="gcard__name">${esc(name)}</h3><p class="gcard__role">${esc(g.role[lang])}</p></article>`;
}

function specList(specs, t) {
  const c = t.common;
  const rows = [];
  if (specs.seats) rows.push([c.seatsLabel, specs.seats]);
  if (specs.cruise) rows.push([c.cruise, `${specs.cruise} ${c.kmh}`]);
  if (specs.range) rows.push([c.range, `${fmtNum(specs.range)} ${c.km}`]);
  if (specs.ceiling) rows.push([c.ceiling, `${fmtNum(specs.ceiling)} ${c.metres}`]);
  if (specs.year) rows.push([c.year, specs.year]);
  return `<dl class="specs">${rows.map(([k, v]) => `<div class="specs__row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

// ---------- map ----------
const MAP = (() => {
  const ring = geo.features[0].geometry.coordinates[0];
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const cos = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const W = 1000, P = 46;
  const s = (W - 2 * P) / ((maxLon - minLon) * cos);
  const H = Math.round((maxLat - minLat) * s + 2 * P);
  const project = (lon, lat) => [Math.round((P + (lon - minLon) * cos * s) * 10) / 10, Math.round((P + (maxLat - lat) * s) * 10) / 10];
  const path = ring.map((p, i) => (i ? 'L' : 'M') + project(p[0], p[1]).join(' ')).join('') + 'Z';
  return { W, H, project, path };
})();

function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1], p1 = points[i];
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    d += i === 1 ? `L${mx} ${my}` : `Q${p0[0]} ${p0[1]} ${mx} ${my}`;
  }
  const l = points[points.length - 1];
  d += `L${l[0]} ${l[1]}`;
  return d;
}

function mapSvg(routes, dests, lang, t, opts = {}) {
  const { W, H, project, path } = MAP;
  let vb = [0, 0, W, H], k = 1;
  if (opts.zoom && opts.zoom.length) {
    const pts = opts.zoom.map((c) => project(c[0], c[1]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padX = Math.max((x1 - x0) * .6, 40), padY = Math.max((y1 - y0) * .6, 30);
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    // keep ~16:10 aspect
    let w = x1 - x0, h = y1 - y0;
    if (w / h < 1.5) { const nw = h * 1.5; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / 1.5; y0 -= (nh - h) / 2; h = nh; }
    vb = [x0, y0, w, h]; k = w / 520;
  }
  const bish = project(74.59, 42.87);
  const cities = [
    { n: { ru: 'Бишкек', en: 'Bishkek', ky: 'Бишкек' }, c: [74.59, 42.87], base: true },
    { n: { ru: 'Ош', en: 'Osh', ky: 'Ош' }, c: [72.8, 40.53] },
    { n: { ru: 'Каракол', en: 'Karakol', ky: 'Каракол' }, c: [78.39, 42.49] },
    { n: { ru: 'Нарын', en: 'Naryn', ky: 'Нарын' }, c: [76.0, 41.43] },
    { n: { ru: 'Талас', en: 'Talas', ky: 'Талас' }, c: [72.24, 42.52] },
    { n: { ru: 'Токмок', en: 'Tokmok', ky: 'Токмок' }, c: [75.3, 42.84], minor: true },
    { n: { ru: 'Кара-Балта', en: 'Kara-Balta', ky: 'Кара-Балта' }, c: [73.85, 42.82], minor: true },
  ].filter((c) => !c.minor || k < 1);
  const sz = (v) => Math.round(v * k * 100) / 100;
  const routePaths = routes.map((r) => {
    const pts = r.coords.map((c) => project(c[0], c[1]));
    return `<path class="map-route" data-key="${r.slug}" d="${smoothPath(pts)}" stroke="${r.color}" stroke-width="${sz(2.2)}"/>`;
  }).join('');
  const destPaths = dests.map((d) => {
    const p = project(d.coords[0], d.coords[1]);
    const cx = (bish[0] + p[0]) / 2, cy = Math.min(bish[1], p[1]) - Math.abs(p[0] - bish[0]) * 0.25 - 20;
    return `<path class="map-route map-route--dest" data-key="${d.slug}" d="M${bish[0]} ${bish[1]}Q${cx} ${cy} ${p[0]} ${p[1]}" stroke-width="${sz(1.5)}"/>`;
  }).join('');
  const labelAttrs = (pos) => {
    if (pos === 'left') return `x="${sz(-13)}" y="${sz(4)}" text-anchor="end"`;
    if (pos === 'right') return `x="${sz(13)}" y="${sz(4)}" text-anchor="start"`;
    if (pos === 'below') return `x="0" y="${sz(26)}" text-anchor="middle"`;
    return `x="0" y="${sz(-14)}" text-anchor="middle"`;
  };
  const pins = [
    ...routes.map((r) => { const c = r.pin || r.coords[Math.floor(r.coords.length / 2)]; const p = project(c[0], c[1]); return { key: r.slug, x: p[0], y: p[1], label: r.t[lang].short, kind: 'route', color: r.color, pos: r.labelPos || 'above' }; }),
    ...dests.map((d) => { const p = project(d.coords[0], d.coords[1]); return { key: d.slug, x: p[0], y: p[1], label: d.t[lang].name, kind: 'dest', color: '#8fd3ff', pos: d.labelPos || 'above' }; }),
  ];
  const pid = opts.id || 'map';
  return `<svg class="map${k < 1 ? ' map--zoom' : ''}" viewBox="${vb.map((v) => Math.round(v * 10) / 10).join(' ')}" role="img" aria-label="${esc(t.home.mapTitle)}" style="--k:${k}">
    <defs>
      <pattern id="${pid}-dots" width="${sz(9)}" height="${sz(9)}" patternUnits="userSpaceOnUse"><circle cx="${sz(4.5)}" cy="${sz(4.5)}" r="${sz(1.1)}" fill="#8fd3ff" opacity=".35"/></pattern>
      <filter id="${pid}-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${sz(6)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path class="map__fill" d="${path}" fill="url(#${pid}-dots)"/>
    <path class="map__outline" d="${path}" fill="none" stroke="#8fd3ff" stroke-opacity=".55" stroke-width="${sz(1.6)}" filter="url(#${pid}-glow)"/>
    <g class="map__cities">${cities.map((c) => { const p = project(c.c[0], c.c[1]); return `<g class="map-city${c.base ? ' map-city--base' : ''}" transform="translate(${p[0]} ${p[1]})"><circle r="${sz(c.base ? 5 : 3)}"/><text x="${sz(9)}" y="${sz(4)}" font-size="${sz(11)}">${esc(c.n[lang])}</text></g>`; }).join('')}</g>
    <g class="map__routes">${destPaths}${routePaths}</g>
    <g class="map__pins">${pins.map((p) => `<g class="map-pin map-pin--${p.kind}" data-key="${p.key}" data-kind="${p.kind}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(p.label)}" style="--pin:${p.color}"><circle class="map-pin__ring" r="${sz(14)}"/><circle class="map-pin__dot" r="${sz(5)}" stroke-width="${sz(2)}"/><text class="map-pin__label" ${labelAttrs(p.pos)} font-size="${sz(12)}" stroke-width="${sz(4)}">${esc(p.label)}</text></g>`).join('')}</g>
    <g class="map__heli" style="color:#f0b35a">${heliTop('map-heli')}</g>
  </svg>`;
}

// ---------- altitude chart ----------
function altitudeChart(route, lang, t) {
  const W = 460, H = 210, P = 30;
  const alts = route.altitude;
  const max = Math.max(...alts) + 300, min = 0;
  const px = (i) => P + (i / (alts.length - 1)) * (W - 2 * P);
  const py = (a) => H - P - ((a - min) / (max - min)) * (H - 2 * P);
  const pts = alts.map((a, i) => [px(i), py(a)]);
  const line = smoothPath(pts);
  const area = line + `L${px(alts.length - 1)} ${H - P}L${px(0)} ${H - P}Z`;
  const wps = route.waypoints.map((w, i) => {
    const idx = Math.round((i / (route.waypoints.length - 1)) * (alts.length - 1));
    const x = px(idx), y = py(w.alt);
    return `<g class="alt__wp${w.landing ? ' alt__wp--landing' : ''}" transform="translate(${x} ${y})"><circle r="4.5"/><text y="-13" text-anchor="${i === 0 ? 'start' : i === route.waypoints.length - 1 ? 'end' : 'middle'}">${esc(w.name[lang])} · ${fmtNum(w.alt)} ${t.common.metres}</text></g>`;
  }).join('');
  return `<svg class="alt" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.route.profile)}">
    <defs><linearGradient id="alt-fill-${route.slug}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${route.color}" stop-opacity=".45"/><stop offset="1" stop-color="${route.color}" stop-opacity="0"/></linearGradient></defs>
    ${[1000, 2000, 3000].map((a) => a < max ? `<g class="alt__grid"><line x1="${P}" x2="${W - P}" y1="${py(a)}" y2="${py(a)}"/><text x="${W - P}" y="${py(a) - 4}" text-anchor="end">${fmtNum(a)} ${t.common.metres}</text></g>` : '').join('')}
    <path class="alt__area" d="${area}" fill="url(#alt-fill-${route.slug})"/>
    <path class="alt__line" d="${line}" fill="none" stroke="${route.color}" stroke-width="2.5" stroke-linecap="round"/>
    ${wps}
    <g class="alt__heli" style="color:${route.color}">${heliTop()}</g>
  </svg>`;
}

// ---------- seat picker (H125 cabin, top view) ----------
function seatPicker(route, lang, t) {
  const r = t.route;
  const seats = [
    { id: 'front', x: 128, y: 104, type: 'window', label: r.window },
    { id: 'rl', x: 64, y: 176, type: 'window', label: r.window },
    { id: 'rm', x: 100, y: 176, type: 'middle', label: r.middle },
    { id: 'rr', x: 136, y: 176, type: 'window', label: r.window },
  ];
  const seat = (s) => `<g class="seat" data-seat="${s.id}" data-type="${s.type}" data-price="${route.price[s.type] || 0}" transform="translate(${s.x} ${s.y})" tabindex="0" role="checkbox" aria-checked="false" aria-label="${esc(s.label)}"><rect class="seat__base" x="-14" y="-14" width="28" height="28" rx="7"/><rect class="seat__back" x="-14" y="-18" width="28" height="7" rx="3.5"/><path class="seat__check" d="m-6 0 4 4 8-8" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  return `<div class="seatmap" data-window="${route.price.window || 0}" data-middle="${route.price.middle || 0}">
    <svg viewBox="0 0 200 240" class="seatmap__svg" aria-label="${esc(r.cabin)}">
      <path class="seatmap__hull" d="M100 10c44 0 70 30 70 70v110c0 26-30 40-70 40s-70-14-70-40V80c0-40 26-70 70-70z"/>
      <path class="seatmap__glass" d="M100 18c34 0 56 24 56 56v10H44v-10c0-32 22-56 56-56z"/>
      <g class="seat seat--pilot" transform="translate(72 104)" aria-hidden="true"><rect x="-14" y="-14" width="28" height="28" rx="7"/><rect x="-14" y="-18" width="28" height="7" rx="3.5"/><text y="4" text-anchor="middle">${esc(r.pilot)}</text></g>
      ${seats.map(seat).join('')}
      <text class="seatmap__front" x="100" y="60" text-anchor="middle">↑</text>
    </svg>
    <p class="seatmap__hint">${esc(r.tapSeat)}</p>
  </div>`;
}

module.exports = { esc, attr, url, fmtNum, price, img, I, rotorMark, heliSilhouette, logo, heliSvg, heliTop, sectionHead, btn, waLink, durationText, routePriceText, routeCard, faqList, ctaSection, marquee, guestCard, specList, MAP, smoothPath, mapSvg, altitudeChart, seatPicker };
