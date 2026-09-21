import express from 'express';
import compression from 'compression';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { config, PUBLIC_DIR, UPLOAD_DIR } from './src/config.js';
import { store } from './src/store.js';
import { seedIfEmpty } from './src/seed.js';
import { ensureAdmin } from './src/auth.js';
import { publicRouter } from './src/routes/public.js';
import { adminRouter } from './src/routes/admin.js';
import { callbackRouter } from './src/routes/callback.js';
import { startScheduler } from './src/services/scheduler.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('etag', 'weak');

app.use(compression());
app.use(express.json({ limit: '3mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // запоминаем публичный адрес (для ссылок в сообщениях), если он не задан в настройках
  const host = req.headers.host;
  if (host && req.method === 'GET' && !req.path.startsWith('/api/')) {
    const proto = config.trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : req.protocol;
    const url = `${proto}://${host}`;
    const isLocal = /^(localhost|127\.|\[::1\])/.test(host);
    if (url !== store.data.meta.lastBaseUrl && (!isLocal || !store.data.meta.lastBaseUrl)) { store.data.meta.lastBaseUrl = url; store.touch(); }
  }
  next();
});

/* API */
app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);
app.use(callbackRouter);

/* Статика */
const staticOpts = { index: false, redirect: false, maxAge: '7d', setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } };
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', index: false }));
app.use(express.static(PUBLIC_DIR, staticOpts));

/* SPA-маршруты */
app.get(['/admin', '/admin/*'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
});

app.use((req, res) => res.status(404).json({ error: 'Не найдено' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

ensureAdmin();
seedIfEmpty();
try { store.backup(); } catch (err) { console.error('[backup]', err.message); }
if (!fs.existsSync(path.join(UPLOAD_DIR, '.gitkeep'))) fs.writeFileSync(path.join(UPLOAD_DIR, '.gitkeep'), '');

const server = app.listen(config.port, config.host, () => {
  console.log(`Luxar Autorent запущен: http://localhost:${config.port}`);
  for (const ip of lanAddresses()) console.log(`  сайт:    http://${ip}:${config.port}`);
  console.log(`  админка: http://<ip-сервера>:${config.port}/admin`);
  startScheduler();
});

function shutdown() {
  console.log('Остановка…');
  try { store.flush(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => { console.error('[uncaught]', err); try { store.flush(); } catch {} });
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
