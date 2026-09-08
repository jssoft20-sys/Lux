#!/usr/bin/env node
/**
 * HeliHop static server + booking API.
 * Zero dependencies. Node >= 18.
 *
 *   PORT=7033 HOST=0.0.0.0 node server.js
 *
 * Env:
 *   PORT                 default 7033
 *   HOST                 default 0.0.0.0
 *   PUBLIC_DIR           default ./public
 *   DATA_DIR             default ./data   (bookings.jsonl is written here)
 *   TELEGRAM_BOT_TOKEN   optional: forward bookings to Telegram
 *   TELEGRAM_CHAT_ID     optional: chat id for the bot
 *   MAIL_TO              optional: e-mail address(es) that receive bookings (comma separated)
 *   SMTP_HOST            SMTP server (e.g. smtp.gmail.com, smtp.yandex.ru, smtp.mail.ru)
 *   SMTP_PORT            465 (SSL) or 587 (STARTTLS); default 465
 *   SMTP_USER / SMTP_PASS  login (for Gmail/Yandex use an app password)
 *   MAIL_FROM            sender, default "HeliHop <SMTP_USER>"
 *   SMTP_INSECURE=1      accept self-signed certificates (not recommended)
 *   ADMIN_TOKEN          optional: GET /api/bookings?token=...
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { sendMail } = require('./lib/smtp');

const PORT = parseInt(process.env.PORT || '7033', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.jsonl');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

function cacheControl(ext) {
  if (ext === '.html') return 'no-cache';
  if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') return 'public, max-age=31536000, immutable';
  if (['.webp', '.avif', '.jpg', '.jpeg', '.png', '.svg', '.mp4', '.webm', '.ico'].includes(ext)) return 'public, max-age=2592000';
  if (ext === '.css' || ext === '.js' || ext === '.mjs') return 'public, max-age=86400';
  return 'public, max-age=3600';
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://wa.me");
}

function log(req, status, extra) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  console.log(`${new Date().toISOString()} ${ip} ${req.method} ${req.url} ${status}${extra ? ' ' + extra : ''}`);
}

function send(req, res, status, body, headers = {}) {
  securityHeaders(res);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(body);
  log(req, status);
}

function sendJSON(req, res, status, obj) {
  send(req, res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

// ---------- static files ----------
const etagCache = new Map();
function etagFor(stat, file) {
  const key = file + ':' + stat.mtimeMs + ':' + stat.size;
  let e = etagCache.get(key);
  if (!e) { e = '"' + crypto.createHash('md5').update(key).digest('hex').slice(0, 16) + '"'; etagCache.set(key, e); }
  return e;
}

const NUL = String.fromCharCode(0);
function resolveStatic(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  p = p.replace(/\\/g, '/');
  if (p.indexOf(NUL) !== -1) return null;
  const abs = path.normalize(path.join(PUBLIC_DIR, p));
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  const candidates = [];
  if (p.endsWith('/')) candidates.push(path.join(abs, 'index.html'));
  else { candidates.push(abs); candidates.push(abs + '.html'); candidates.push(path.join(abs, 'index.html')); }
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return { file: c, stat: st, needsSlash: (c === path.join(abs, 'index.html') && !p.endsWith('/')) };
    } catch { /* next */ }
  }
  return null;
}

function serveFile(req, res, file, stat, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  securityHeaders(res);
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cacheControl(ext));
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  const etag = etagFor(stat, file);
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); log(req, 304); return; }
  const accept = String(req.headers['accept-encoding'] || '');
  const useGzip = COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bgzip\b/.test(accept);
  const useBr = COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bbr\b/.test(accept) && typeof zlib.createBrotliCompress === 'function';
  res.statusCode = status;
  if (req.method === 'HEAD') { res.end(); log(req, status); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end(); });
  if (useBr) {
    res.setHeader('Content-Encoding', 'br');
    stream.pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
  } else if (useGzip) {
    res.setHeader('Content-Encoding', 'gzip');
    stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    stream.pipe(res);
  }
  log(req, status);
}

function serve404(req, res) {
  const m = /^\/(en|ky)(\/|$)/.exec(req.url || '');
  const candidates = m ? [path.join(PUBLIC_DIR, m[1], '404.html'), path.join(PUBLIC_DIR, '404.html')] : [path.join(PUBLIC_DIR, '404.html')];
  for (const nf of candidates) {
    try { const st = fs.statSync(nf); return serveFile(req, res, nf, st, 404); } catch { /* next */ }
  }
  send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

// ---------- booking API ----------
const rate = new Map(); // ip -> {count, ts}
function rateLimited(ip) {
  const now = Date.now();
  const r = rate.get(ip);
  if (!r || now - r.ts > 60000) { rate.set(ip, { count: 1, ts: now }); return false; }
  r.count += 1;
  return r.count > 12;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rate) if (now - v.ts > 120000) rate.delete(k); }, 60000).unref();

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// strip ASCII control characters (built from char codes to keep this file plain ASCII)
const CONTROL_CHARS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');
function clean(v, max = 200) { return String(v == null ? '' : v).replace(CONTROL_CHARS, '').trim().slice(0, max); }

function telegramNotify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return Promise.resolve(false);
  const payload = JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
  return new Promise((resolve) => {
    const rq = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 8000 },
      (rs) => { rs.resume(); rs.on('end', () => resolve(rs.statusCode === 200)); });
    rq.on('error', () => resolve(false));
    rq.on('timeout', () => { rq.destroy(); resolve(false); });
    rq.end(payload);
  });
}

const escHtml = (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function mailNotify(b) {
  const to = process.env.MAIL_TO, host = process.env.SMTP_HOST;
  if (!to || !host) return Promise.resolve(false);
  const user = process.env.SMTP_USER || '', pass = process.env.SMTP_PASS || '';
  const from = process.env.MAIL_FROM || `HeliHop <${user || 'noreply@helihop'}>`;
  const digits = b.phone.replace(/\D/g, '');
  const rows = [
    ['Тип', b.type], ['Маршрут', b.route], ['Дата', b.date], ['Места', [b.seats, b.seatType].filter(Boolean).join(' · ')],
    ['Имя', b.name], ['Телефон', b.phone], ['Сообщение', b.message], ['Язык', b.lang], ['Страница', b.page], ['Время', b.at], ['ID', b.id],
  ].filter(([, v]) => v);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (digits ? `\n\nWhatsApp: https://wa.me/${digits}` : '');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 12px">🚁 Новая заявка — HeliHop</h2><table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#666">${escHtml(k)}</td><td style="padding:6px 0"><b>${escHtml(v)}</b></td></tr>`).join('')}</table>${digits ? `<p style="margin-top:16px"><a href="https://wa.me/${digits}" style="background:#25d366;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ответить в WhatsApp</a></p>` : ''}</div>`;
  return sendMail({
    host, port: process.env.SMTP_PORT || 465, secure: String(process.env.SMTP_PORT || '465') === '465', user, pass, from, to,
    replyTo: undefined, subject: `Заявка: ${b.route || b.type} — ${b.name || b.phone}`, text, html, insecure: process.env.SMTP_INSECURE === '1',
  }).then(() => true).catch((e) => { console.error('mail failed:', e.message); return false; });
}

async function handleBooking(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  if (rateLimited(ip)) return sendJSON(req, res, 429, { ok: false, error: 'rate_limited' });
  let data;
  try { data = JSON.parse(await readBody(req)); } catch { return sendJSON(req, res, 400, { ok: false, error: 'bad_json' }); }
  if (typeof data !== 'object' || data === null) return sendJSON(req, res, 400, { ok: false, error: 'bad_json' });
  if (clean(data.website)) return sendJSON(req, res, 200, { ok: true, id: 'ok' }); // honeypot field
  const booking = {
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    ip,
    lang: clean(data.lang, 5) || 'ru',
    type: clean(data.type, 40) || 'flight',
    route: clean(data.route, 120),
    date: clean(data.date, 40),
    seats: clean(data.seats, 40),
    seatType: clean(data.seatType, 40),
    name: clean(data.name, 120),
    phone: clean(data.phone, 40),
    contact: clean(data.contact, 40),
    message: clean(data.message, 1500),
    page: clean(data.page, 300),
    ua: clean(req.headers['user-agent'], 300),
  };
  if (!booking.phone || booking.phone.replace(/\D/g, '').length < 7) return sendJSON(req, res, 422, { ok: false, error: 'phone' });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(BOOKINGS_FILE, JSON.stringify(booking) + '\n');
  } catch (e) {
    console.error('booking write failed', e);
    return sendJSON(req, res, 500, { ok: false, error: 'storage' });
  }
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const tg = await telegramNotify(
    `🚁 <b>Новая заявка</b> (${esc(booking.type)})\n` +
    (booking.route ? `Маршрут: ${esc(booking.route)}\n` : '') +
    (booking.date ? `Дата: ${esc(booking.date)}\n` : '') +
    (booking.seats ? `Места: ${esc(booking.seats)} ${esc(booking.seatType)}\n` : '') +
    `Имя: ${esc(booking.name || '—')}\nТелефон: ${esc(booking.phone)}${booking.contact ? ' (' + esc(booking.contact) + ')' : ''}\n` +
    (booking.message ? `Сообщение: ${esc(booking.message)}\n` : '') +
    `Язык: ${esc(booking.lang)} · ${esc(booking.page)}`
  );
  const mail = await mailNotify(booking);
  console.log(`booking ${booking.id} saved${tg ? ' + telegram' : ''}${mail ? ' + email' : ''}`);
  sendJSON(req, res, 200, { ok: true, id: booking.id });
}

function handleBookingsList(req, res, url) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || url.searchParams.get('token') !== token) return sendJSON(req, res, 403, { ok: false, error: 'forbidden' });
  let lines = [];
  try { lines = fs.readFileSync(BOOKINGS_FILE, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none */ }
  const items = lines.slice(-200).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  sendJSON(req, res, 200, { ok: true, count: items.length, items });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health') return sendJSON(req, res, 200, { ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString(), email: !!(process.env.MAIL_TO && process.env.SMTP_HOST), telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
      if (url.pathname === '/api/book' && req.method === 'POST') return handleBooking(req, res);
      if (url.pathname === '/api/bookings' && req.method === 'GET') return handleBookingsList(req, res, url);
      return sendJSON(req, res, 404, { ok: false, error: 'not_found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
    const hit = resolveStatic(url.pathname);
    if (!hit) return serve404(req, res);
    if (hit.needsSlash) {
      // canonical trailing slash for directory pages
      return send(req, res, 301, '', { Location: url.pathname + '/' + (url.search || '') });
    }
    return serveFile(req, res, hit.file, hit.stat);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(req, res, 500, 'Server error', { 'Content-Type': 'text/plain; charset=utf-8' });
    else res.end();
  }
});

server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => {
  console.log(`HeliHop site -> http://${HOST === '0.0.0.0' ? '<server-ip>' : HOST}:${PORT}  (public: ${PUBLIC_DIR})`);
});

function shutdown() { console.log('shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
