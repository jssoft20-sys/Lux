#!/usr/bin/env node
/**
 * Static build: renders every page for every language into ./public
 *   node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const site = require('./src/data/site');
const routes = require('./src/data/routes');
const i18n = require('./src/data/i18n');
const credits = require('./src/data/credits.json');
const { render } = require('./src/templates/layout');
const pages = require('./src/templates/pages');
const { url } = require('./src/templates/components');

const OUT = path.join(__dirname, 'public');
const version = Date.now().toString(36);

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function outPath(lang, p) {
  const u = url(lang, p).split('#')[0];
  return path.join(u.replace(/^\//, ''), 'index.html');
}

const defs = [
  { path: '', page: 'home', fn: pages.home },
  { path: 'routes', page: 'routes', fn: pages.routesPage },
  ...routes.map((r) => ({ path: 'routes/' + r.slug, page: 'route', fn: (ctx) => pages.routePage({ ...ctx, route: r }) })),
  { path: 'proposal', page: 'proposal', fn: pages.proposalPage },
  { path: 'experiences', page: 'experiences', fn: pages.experiencesPage },
  { path: 'gift', page: 'gift', fn: pages.giftPage },
  { path: 'guests', page: 'guests', fn: pages.guestsPage },
  { path: 'partners', page: 'partners', fn: pages.partnersPage },
  { path: 'aviation', page: 'aviation', fn: pages.aviationPage },
  { path: 'about', page: 'about', fn: pages.aboutPage },
  { path: 'how', page: 'how', fn: pages.howPage },
  { path: 'credits', page: 'credits', fn: (ctx) => pages.creditsPage({ ...ctx, credits }) },
];

const urls = [];
let count = 0;
for (const lang of site.langs) {
  const t = i18n[lang];
  for (const d of defs) {
    const res = d.fn({ lang, t });
    const html = render({ lang, t, path: d.path, page: d.page, title: res.title, description: res.description, body: res.body, jsonld: res.jsonld, noindex: res.noindex, version });
    write(outPath(lang, d.path), html);
    if (!res.noindex) urls.push(site.domain + url(lang, d.path));
    count++;
  }
  // 404 per language (root one is served by the server)
  const nf = pages.notFoundPage({ lang, t });
  const nfHtml = render({ lang, t, path: '', page: 'notfound', title: nf.title, description: nf.description, body: nf.body, noindex: true, version });
  write(lang === site.defaultLang ? '404.html' : path.join(lang, '404.html'), nfHtml);
}

// sitemap, robots, manifest, favicon
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${site.domain}/sitemap.xml\n`);
write('site.webmanifest', JSON.stringify({ name: site.brandFull, short_name: site.brand, start_url: '/', display: 'standalone', background_color: '#07090c', theme_color: '#07090c', icons: [{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] }, null, 2));
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#07090c"/><circle cx="32" cy="32" r="24" fill="none" stroke="#ffffff" stroke-width="2.5"/><path d="M32 32 30 12h4zM32 32l19 9-2 3.5zM32 32 13 41l-2-3.5z" fill="#ffffff"/><circle cx="32" cy="32" r="4" fill="#ffffff"/></svg>`);

console.log(`built ${count} pages (${site.langs.length} languages) → ${OUT}`);
