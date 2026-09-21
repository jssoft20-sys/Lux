import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../store.js';
import { config, UPLOAD_DIR } from '../config.js';
import { uuid, token as makeToken, shortId, slugify } from '../utils/ids.js';
import { zonedToUtc, addDays, addMinutes, toZoned } from '../utils/time.js';
import { normalizePhone, isValidPhone } from '../utils/phone.js';
import { round2 } from '../utils/money.js';
import { verifyPassword, createSession, destroySession, getSession, requireAdmin, checkLoginAllowed, registerLoginFailure, clearLoginFailures, clientIp, setAdminCredentials } from '../auth.js';
import { quote, convert } from '../services/pricing.js';
import { carOccupancy, isAvailable, maxExtensionDays, derivedStatus, overlaps } from '../services/availability.js';
import { upsertClient, recomputeClientStats } from '../services/clients.js';
import { markPaid, cancelPayment, refreshPayment, paymentsForBooking, PENDING, httpError, pollOptimaPending } from '../services/payments.js';
import * as optima from '../services/optima.js';
import { testSmtp, testImap, presetHosts } from '../services/mail.js';
import { waStatus, waSend } from '../services/whatsapp.js';
import { sendReminder, notifyBookingConfirmed, previewTemplate } from '../services/notify.js';
import { pollMailNow } from '../services/scheduler.js';
import { MAIL_PRESETS, USDT_NETWORKS } from '../defaults.js';

export const adminRouter = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MASK = '••••••••';

/* ---------- вход ---------- */
adminRouter.post('/login', (req, res) => {
  const ip = clientIp(req);
  if (!checkLoginAllowed(ip)) return res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут' });
  const { login, password } = req.body || {};
  const auth = store.data.auth;
  if (auth && String(login || '').trim() === auth.login && verifyPassword(String(password || ''), auth)) {
    clearLoginFailures(ip);
    createSession(req, res);
    store.log('auth', 'Вход в админку', { ip });
    return res.json({ ok: true, login: auth.login, defaultPassword: Boolean(auth.defaultPassword) });
  }
  registerLoginFailure(ip);
  res.status(401).json({ error: 'Неверный логин или пароль' });
});

adminRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

adminRouter.get('/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ login: store.data.auth.login, defaultPassword: Boolean(store.data.auth.defaultPassword) });
});

adminRouter.use(requireAdmin);

/* ---------- вспомогательные представления ---------- */
function carBrief(id) {
  const c = store.get('cars', id);
  return c ? { id: c.id, name: c.name, slug: c.slug, photo: (c.photos || [])[0] || '', class: c.class, plate: c.plate || '' } : null;
}

function bookingView(b) {
  const payments = paymentsForBooking(b.id);
  const client = b.clientId ? store.get('clients', b.clientId) : null;
  return {
    ...b,
    car: carBrief(b.carId),
    state: derivedStatus(b),
    hoursLeft: Math.round(((new Date(b.endAt) - Date.now()) / 3600000) * 10) / 10,
    dueUsd: round2((Number(b.totalUsd) || 0) - (Number(b.paidUsd) || 0)),
    payments: payments.map(paymentView),
    client: client ? { id: client.id, name: client.name, phone: client.phone, whatsapp: client.whatsapp, bookingsCount: client.bookingsCount, totalSpentUsd: client.totalSpentUsd, note: client.note } : null,
    maxExtendDays: b.status === 'confirmed' ? maxExtensionDays(b, store.settings.site.maxDays) : 0,
  };
}

function paymentView(p) {
  const { qrBase64, ...rest } = p;
  const b = store.get('bookings', p.bookingId);
  return { ...rest, hasQr: Boolean(qrBase64), booking: b ? { id: b.id, code: b.code, name: b.name, phone: b.phone, car: carBrief(b.carId), startAt: b.startAt, endAt: b.endAt, status: b.status } : null };
}

function maskSettings(s) {
  const out = JSON.parse(JSON.stringify(s));
  out.optima.apiKey = s.optima.apiKey ? MASK + String(s.optima.apiKey).slice(-4) : '';
  out.optima.callbackPassword = s.optima.callbackPassword ? MASK : '';
  out.mail.password = s.mail.password ? MASK : '';
  out.whatsapp.token = s.whatsapp.token ? MASK + String(s.whatsapp.token).slice(-4) : '';
  out.optima.hasApiKey = Boolean(s.optima.apiKey);
  out.mail.hasPassword = Boolean(s.mail.password);
  out.whatsapp.hasToken = Boolean(s.whatsapp.token);
  return out;
}

function unmask(section, patch) {
  const current = store.settings[section];
  const secretKeys = { optima: ['apiKey', 'callbackPassword'], mail: ['password'], whatsapp: ['token'] }[section] || [];
  for (const k of secretKeys) {
    if (k in patch && (patch[k] === '' + MASK || String(patch[k] || '').startsWith(MASK))) patch[k] = current[k];
  }
  return patch;
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/* ---------- дашборд ---------- */
adminRouter.get('/dashboard', (req, res) => {
  const now = new Date();
  const tz = store.settings.site.timezone;
  const today = toZoned(now, tz).date;
  const cars = store.list('cars');
  const occ = cars.map((c) => ({ car: c, occupancy: carOccupancy(c.id, now) }));
  const bookings = store.list('bookings');
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const activeRentals = confirmed.filter((b) => new Date(b.startAt) <= now && new Date(b.endAt) > now).sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
  const upcoming = confirmed.filter((b) => new Date(b.startAt) > now).sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).slice(0, 10);
  const endingToday = confirmed.filter((b) => toZoned(new Date(b.endAt), tz).date === today);
  const startingToday = confirmed.filter((b) => toZoned(new Date(b.startAt), tz).date === today);
  const endingSoon = activeRentals.filter((b) => new Date(b.endAt) - now < 24 * 3600000);
  const payments = store.list('payments');
  const paid = payments.filter((p) => p.status === 'paid');
  const monthKey = today.slice(0, 7);
  const prevMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const sum = (list) => round2(list.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0));
  const revenue = {
    today: sum(paid.filter((p) => toZoned(new Date(p.paidAt), tz).date === today)),
    month: sum(paid.filter((p) => toZoned(new Date(p.paidAt), tz).date.startsWith(monthKey))),
    prevMonth: sum(paid.filter((p) => toZoned(new Date(p.paidAt), tz).date.startsWith(prevMonth))),
  };
  const pendingPayments = payments.filter((p) => PENDING.has(p.status) && new Date(p.expiresAt) > now).sort((a, b) => (a.status === 'awaiting' ? -1 : 1) - (b.status === 'awaiting' ? -1 : 1));
  res.json({
    now: now.toISOString(),
    cars: {
      total: cars.length,
      active: cars.filter((c) => c.status === 'active').length,
      free: occ.filter((o) => o.car.status === 'active' && o.occupancy.state === 'free').length,
      busy: occ.filter((o) => o.occupancy.state !== 'free').length,
      service: cars.filter((c) => c.status === 'service').length,
      list: occ.map((o) => ({ ...carBrief(o.car.id), status: o.car.status, occupancy: o.occupancy, pricePerDay: o.car.pricePerDay })),
    },
    activeRentals: activeRentals.map(bookingView),
    upcoming: upcoming.map(bookingView),
    endingToday: endingToday.map(bookingView),
    startingToday: startingToday.map(bookingView),
    endingSoon: endingSoon.map(bookingView),
    holds: bookings.filter((b) => b.status === 'hold').length,
    pendingPayments: pendingPayments.map(paymentView),
    revenue,
    integrations: {
      optima: { configured: optima.isConfigured(), enabled: store.settings.optima.enabled, lastCheck: store.settings.optima.lastCheck, salePointName: store.settings.optima.salePointName },
      mail: { configured: Boolean(store.settings.mail.enabled && store.settings.mail.email && store.settings.mail.password), lastCheck: store.settings.mail.lastCheck, lastPollAt: store.settings.mail.lastPollAt },
      whatsapp: { configured: Boolean(store.settings.whatsapp.enabled && store.settings.whatsapp.profileId && store.settings.whatsapp.token), lastCheck: store.settings.whatsapp.lastCheck },
      crypto: { enabled: store.settings.crypto.enabled, networks: (store.settings.crypto.networks || []).filter((n) => n.enabled && n.address).length },
    },
    activity: store.list('activity').slice(-12).reverse(),
    defaultPassword: Boolean(store.data.auth.defaultPassword),
  });
});

/* ---------- автомобили ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' })[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now().toString(36)}-${shortId(6)}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|avif)$/.test(file.mimetype)),
});

const CAR_FIELDS = ['name', 'brand', 'model', 'class', 'year', 'engine', 'power', 'transmission', 'fuel', 'drive', 'seats', 'color', 'plate', 'pricePerDay', 'discounts', 'deposit', 'minDays', 'description', 'features', 'photos', 'rating', 'reviewsCount', 'status', 'order', 'note'];

function sanitizeCar(body, existing = {}) {
  const out = {};
  for (const k of CAR_FIELDS) if (k in body) out[k] = body[k];
  if ('name' in out) out.name = String(out.name || '').trim().slice(0, 80);
  if ('pricePerDay' in out) out.pricePerDay = round2(num(out.pricePerDay));
  if ('deposit' in out) out.deposit = round2(num(out.deposit));
  if ('year' in out) out.year = out.year ? Math.round(num(out.year)) : null;
  if ('seats' in out) out.seats = out.seats ? Math.round(num(out.seats)) : null;
  if ('power' in out) out.power = out.power ? Math.round(num(out.power)) : null;
  if ('minDays' in out) out.minDays = Math.max(1, Math.round(num(out.minDays, 1)));
  if ('order' in out) out.order = Math.round(num(out.order));
  if ('rating' in out) out.rating = Math.max(0, Math.min(5, round2(num(out.rating))));
  if ('reviewsCount' in out) out.reviewsCount = Math.max(0, Math.round(num(out.reviewsCount)));
  if ('discounts' in out) out.discounts = { d3: Math.max(0, Math.min(90, num(out.discounts?.d3))), d7: Math.max(0, Math.min(90, num(out.discounts?.d7))), d30: Math.max(0, Math.min(90, num(out.discounts?.d30))) };
  if ('features' in out) out.features = Array.isArray(out.features) ? out.features.map((f) => String(f).trim()).filter(Boolean).slice(0, 20) : String(out.features || '').split(/\n|,/).map((f) => f.trim()).filter(Boolean).slice(0, 20);
  if ('photos' in out) out.photos = Array.isArray(out.photos) ? out.photos.filter((p) => typeof p === 'string' && (p.startsWith('/uploads/') || p.startsWith('/seed/'))).slice(0, 12) : existing.photos || [];
  if ('status' in out && !['active', 'hidden', 'service'].includes(out.status)) out.status = 'active';
  if ('class' in out) out.class = String(out.class || 'business').toLowerCase().replace(/[^a-z]/g, '') || 'business';
  if ('description' in out) out.description = String(out.description || '').trim().slice(0, 600);
  for (const k of ['brand', 'model', 'engine', 'transmission', 'fuel', 'drive', 'color', 'plate', 'note']) if (k in out) out[k] = String(out[k] || '').trim().slice(0, 80);
  return out;
}

function uniqueSlug(base, excludeId) {
  let slug = slugify(base);
  let i = 2;
  while (store.find('cars', (c) => c.slug === slug && c.id !== excludeId)) slug = `${slugify(base)}-${i++}`;
  return slug;
}

adminRouter.get('/cars', (req, res) => {
  const cars = store.list('cars').slice().sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
  res.json(cars.map((c) => ({ ...c, occupancy: carOccupancy(c.id) })));
});

adminRouter.post('/cars', (req, res) => {
  const data = sanitizeCar(req.body || {});
  if (!data.name) return res.status(400).json({ error: 'Укажите название' });
  if (!(data.pricePerDay > 0)) return res.status(400).json({ error: 'Укажите цену за сутки' });
  const now = new Date().toISOString();
  const maxOrder = Math.max(0, ...store.list('cars').map((c) => c.order || 0));
  const car = store.insert('cars', { id: uuid(), slug: uniqueSlug(data.name), status: 'active', photos: [], features: [], discounts: { d3: 0, d7: 0, d30: 0 }, minDays: 1, order: maxOrder + 1, rating: 5, reviewsCount: 0, createdAt: now, updatedAt: now, ...data });
  store.log('car', `Добавлен автомобиль ${car.name}`, { carId: car.id });
  store.flush();
  res.status(201).json(car);
});

adminRouter.put('/cars/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  ids.forEach((id, i) => store.update('cars', id, { order: i + 1 }));
  store.flush();
  res.json({ ok: true });
});

adminRouter.put('/cars/:id', (req, res) => {
  const car = store.get('cars', req.params.id);
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  const data = sanitizeCar(req.body || {}, car);
  if ('name' in data && !data.name) return res.status(400).json({ error: 'Укажите название' });
  if ('pricePerDay' in data && !(data.pricePerDay > 0)) return res.status(400).json({ error: 'Укажите цену за сутки' });
  if (data.name && data.name !== car.name) data.slug = uniqueSlug(data.name, car.id);
  const updated = store.update('cars', car.id, data);
  store.flush();
  res.json(updated);
});

adminRouter.delete('/cars/:id', (req, res) => {
  const car = store.get('cars', req.params.id);
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  const active = store.filter('bookings', (b) => b.carId === car.id && ['hold', 'confirmed'].includes(b.status) && new Date(b.endAt) > new Date());
  if (active.length) return res.status(400).json({ error: `У автомобиля есть активные брони (${active.length}). Сначала завершите или отмените их, либо скройте автомобиль` });
  store.remove('cars', car.id);
  store.log('car', `Удалён автомобиль ${car.name}`, { carId: car.id });
  store.flush();
  res.json({ ok: true });
});

adminRouter.post('/cars/:id/photos', (req, res, next) => {
  const car = store.get('cars', req.params.id);
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  upload.array('photos', 12)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${config.maxUploadMb} МБ` : err.message });
    const urls = (req.files || []).map((f) => '/uploads/' + f.filename);
    if (!urls.length) return res.status(400).json({ error: 'Загрузите изображения JPG, PNG или WebP' });
    const updated = store.update('cars', car.id, { photos: [...(car.photos || []), ...urls].slice(0, 12) });
    store.flush();
    res.json({ photos: updated.photos, added: urls });
  });
});

adminRouter.delete('/cars/:id/photos', (req, res) => {
  const car = store.get('cars', req.params.id);
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  const url = String(req.body?.url || '');
  const photos = (car.photos || []).filter((p) => p !== url);
  store.update('cars', car.id, { photos });
  if (url.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(url));
    const stillUsed = store.list('cars').some((c) => (c.photos || []).includes(url));
    if (!stillUsed && fs.existsSync(file)) fs.unlink(file, () => {});
  }
  store.flush();
  res.json({ photos });
});

/* ---------- брони ---------- */
adminRouter.get('/bookings', (req, res) => {
  const { status, carId, q, from, to, limit } = req.query;
  let list = store.list('bookings').slice();
  if (status && status !== 'all') {
    const set = new Set(String(status).split(','));
    list = list.filter((b) => set.has(b.status) || set.has(derivedStatus(b)));
  }
  if (carId) list = list.filter((b) => b.carId === carId);
  if (from) list = list.filter((b) => new Date(b.endAt) >= new Date(from));
  if (to) list = list.filter((b) => new Date(b.startAt) <= new Date(to));
  if (q) {
    const s = String(q).toLowerCase();
    const digits = s.replace(/\D/g, '');
    list = list.filter((b) => b.code.toLowerCase().includes(s) || (b.name || '').toLowerCase().includes(s) || (digits && (b.phone || '').includes(digits)) || (carBrief(b.carId)?.name || '').toLowerCase().includes(s));
  }
  list.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
  const lim = Math.min(500, Number(limit) || 200);
  res.json({ total: list.length, items: list.slice(0, lim).map(bookingView) });
});

adminRouter.get('/calendar', (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 2 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : addDays(from, 21);
  const cars = store.list('cars').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const bookings = store.filter('bookings', (b) => ['hold', 'confirmed', 'completed'].includes(b.status) && overlaps(from, to, b.startAt, b.endAt));
  res.json({ from: from.toISOString(), to: to.toISOString(), timezone: store.settings.site.timezone, cars: cars.map((c) => ({ ...carBrief(c.id), status: c.status, bookings: bookings.filter((b) => b.carId === c.id).map((b) => ({ id: b.id, code: b.code, name: b.name, phone: b.phone, startAt: b.startAt, endAt: b.endAt, status: b.status, state: derivedStatus(b), paidUsd: b.paidUsd, totalUsd: b.totalUsd })) })) });
});

adminRouter.get('/bookings/:id', (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  res.json({ ...bookingView(b), notifications: store.filter('notifications', (n) => n.bookingId === b.id).slice(-30).reverse(), activity: store.filter('activity', (a) => a.meta && a.meta.bookingId === b.id).slice(-30).reverse() });
});

function parseDates(body, fallback = {}) {
  const tz = store.settings.site.timezone;
  let startAt = body.startAt ? new Date(body.startAt) : body.startDate ? zonedToUtc(body.startDate, body.startTime || '10:00', tz) : fallback.startAt ? new Date(fallback.startAt) : null;
  let endAt = body.endAt ? new Date(body.endAt) : body.endDate ? zonedToUtc(body.endDate, body.endTime || (body.startTime || '10:00'), tz) : null;
  if (!endAt && body.days && startAt) endAt = addDays(startAt, Number(body.days));
  if (!endAt && fallback.endAt) endAt = new Date(fallback.endAt);
  if (!startAt || Number.isNaN(startAt.getTime())) throw httpError(400, 'Укажите дату начала');
  if (!endAt || Number.isNaN(endAt.getTime()) || endAt <= startAt) throw httpError(400, 'Дата окончания должна быть позже начала');
  const days = Math.max(1, Math.round((endAt - startAt) / 86400000 * 100) / 100);
  return { startAt, endAt, days: Math.ceil(days - 0.02) };
}

adminRouter.post('/bookings', wrap(async (req, res) => {
  const body = req.body || {};
  const car = store.get('cars', body.carId);
  if (!car) throw httpError(400, 'Выберите автомобиль');
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  if (name.length < 2) throw httpError(400, 'Укажите имя клиента');
  if (!isValidPhone(phone)) throw httpError(400, 'Укажите номер телефона');
  const { startAt, endAt, days } = parseDates(body);
  if (!isAvailable(car.id, startAt, endAt)) throw httpError(409, 'На эти даты автомобиль уже занят');
  const pickup = body.pickup === 'delivery' ? 'delivery' : 'self';
  const q = quote({ car, days, pickup, pricePerDay: body.pricePerDay ? num(body.pricePerDay) : undefined });
  const totalUsd = body.totalUsd !== undefined && body.totalUsd !== '' ? round2(num(body.totalUsd)) : q.totalUsd;
  const client = upsertClient({ name, phone, whatsapp: body.whatsapp, email: body.email, source: 'admin' });
  const now = new Date();
  const paid = Boolean(body.paid);
  const booking = store.insert('bookings', {
    id: uuid(), code: 'LX-' + store.nextCounter('booking'), token: makeToken(), carId: car.id, clientId: client ? client.id : null,
    name, phone, whatsapp: normalizePhone(body.whatsapp) || phone, email: String(body.email || '').trim(),
    startAt: startAt.toISOString(), endAt: endAt.toISOString(), days, pickup, address: String(body.address || '').trim(), comment: String(body.comment || '').trim(), adminNote: String(body.adminNote || '').trim(),
    pricePerDay: q.pricePerDay, discountPercent: q.discountPercent, subtotal: q.subtotal, discount: q.discount, deliveryFee: q.deliveryFee, totalUsd, paidUsd: paid ? totalUsd : 0,
    status: 'confirmed', confirmedAt: now.toISOString(), holdUntil: null, source: 'admin', paymentId: null, extensions: [], reminderSentAt: null, reminderAttempts: 0, adminEndingNotifiedAt: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  if (paid && totalUsd > 0) {
    const conv = convert(totalUsd);
    const payment = store.insert('payments', { id: uuid(), bookingId: booking.id, bookingCode: booking.code, kind: 'rental', extensionDays: 0, method: body.paidMethod || 'cash', status: 'paid', amountUsd: totalUsd, amountKgs: conv.kgs, amountUsdt: conv.usdt, rates: conv.rates, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: now.toISOString(), paidAt: now.toISOString(), confirmedBy: 'admin' });
    store.update('bookings', booking.id, { paymentId: payment.id });
  }
  if (client) recomputeClientStats(client.id);
  store.log('booking', `Бронь ${booking.code} создана вручную: ${car.name}, ${name}`, { bookingId: booking.id });
  store.flush();
  if (body.notifyClient) notifyBookingConfirmed(store.get('bookings', booking.id), paid ? store.get('payments', store.get('bookings', booking.id).paymentId) : null).catch(() => {});
  res.status(201).json(bookingView(store.get('bookings', booking.id)));
}));

adminRouter.put('/bookings/:id', wrap(async (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) throw httpError(404, 'Бронь не найдена');
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.phone !== undefined) { const p = normalizePhone(body.phone); if (!isValidPhone(p)) throw httpError(400, 'Неверный номер'); patch.phone = p; }
  if (body.whatsapp !== undefined) patch.whatsapp = normalizePhone(body.whatsapp) || patch.phone || b.phone;
  if (body.email !== undefined) patch.email = String(body.email).trim();
  if (body.address !== undefined) patch.address = String(body.address).trim();
  if (body.pickup !== undefined) patch.pickup = body.pickup === 'delivery' ? 'delivery' : 'self';
  if (body.comment !== undefined) patch.comment = String(body.comment).trim();
  if (body.adminNote !== undefined) patch.adminNote = String(body.adminNote).trim();
  if (body.carId !== undefined && body.carId !== b.carId) { if (!store.get('cars', body.carId)) throw httpError(400, 'Автомобиль не найден'); patch.carId = body.carId; }
  if (body.startAt !== undefined || body.endAt !== undefined || body.startDate !== undefined || body.endDate !== undefined) {
    const { startAt, endAt, days } = parseDates(body, b);
    const carId = patch.carId || b.carId;
    if (['hold', 'confirmed'].includes(b.status) && !isAvailable(carId, startAt, endAt, b.id)) throw httpError(409, 'Даты пересекаются с другой бронью');
    patch.startAt = startAt.toISOString(); patch.endAt = endAt.toISOString(); patch.days = days;
    if (new Date(b.endAt).getTime() !== endAt.getTime()) { patch.reminderSentAt = null; patch.reminderAttempts = 0; patch.adminEndingNotifiedAt = null; }
  } else if (patch.carId && ['hold', 'confirmed'].includes(b.status) && !isAvailable(patch.carId, b.startAt, b.endAt, b.id)) throw httpError(409, 'Этот автомобиль занят на даты брони');
  if (body.totalUsd !== undefined) patch.totalUsd = round2(num(body.totalUsd));
  if (body.paidUsd !== undefined) patch.paidUsd = round2(num(body.paidUsd));
  if (body.status !== undefined && ['hold', 'confirmed', 'completed', 'cancelled'].includes(body.status)) patch.status = body.status;
  if (patch.status === 'confirmed' && !b.confirmedAt) patch.confirmedAt = new Date().toISOString();
  if ('conflict' in body && !body.conflict) patch.conflict = null;
  const updated = store.update('bookings', b.id, patch);
  if (updated.clientId) recomputeClientStats(updated.clientId);
  store.flush();
  res.json(bookingView(updated));
}));

adminRouter.post('/bookings/:id/complete', (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  const now = new Date();
  const patch = { status: 'completed', completedAt: now.toISOString(), completedBy: 'admin' };
  if (new Date(b.endAt) > now) patch.endAt = now.toISOString();
  store.update('bookings', b.id, patch);
  for (const p of paymentsForBooking(b.id)) if (PENDING.has(p.status)) cancelPayment(p.id, 'completed');
  store.log('booking', `Бронь ${b.code} завершена`, { bookingId: b.id });
  store.flush();
  res.json(bookingView(store.get('bookings', b.id)));
});

adminRouter.post('/bookings/:id/cancel', (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  store.update('bookings', b.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'admin', cancelReason: String(req.body?.reason || '').slice(0, 200) });
  for (const p of paymentsForBooking(b.id)) if (PENDING.has(p.status)) cancelPayment(p.id, 'booking cancelled');
  if (b.clientId) recomputeClientStats(b.clientId);
  store.log('booking', `Бронь ${b.code} отменена`, { bookingId: b.id });
  store.flush();
  res.json(bookingView(store.get('bookings', b.id)));
});

adminRouter.post('/bookings/:id/restore', (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  if (!isAvailable(b.carId, b.startAt, b.endAt, b.id)) return res.status(409).json({ error: 'Даты уже заняты другой бронью' });
  store.update('bookings', b.id, { status: 'confirmed', conflict: null });
  store.flush();
  res.json(bookingView(store.get('bookings', b.id)));
});

adminRouter.post('/bookings/:id/extend', wrap(async (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) throw httpError(404, 'Бронь не найдена');
  const days = Math.round(num(req.body?.days));
  if (days < 1) throw httpError(400, 'Укажите количество дней');
  const newEnd = addDays(b.endAt, days);
  if (!isAvailable(b.carId, b.endAt, newEnd, b.id)) throw httpError(409, 'На эти даты автомобиль уже забронирован');
  const car = store.get('cars', b.carId);
  const amountUsd = req.body?.amountUsd !== undefined && req.body.amountUsd !== '' ? round2(num(req.body.amountUsd)) : quote({ car, days, pricePerDay: b.pricePerDay }).totalUsd;
  const paid = Boolean(req.body?.paid);
  const now = new Date().toISOString();
  const conv = convert(amountUsd);
  let payment = null;
  if (paid && amountUsd > 0) {
    payment = store.insert('payments', { id: uuid(), bookingId: b.id, bookingCode: b.code, kind: 'extension', extensionDays: days, method: req.body?.method || 'cash', status: 'paid', amountUsd, amountKgs: conv.kgs, amountUsdt: conv.usdt, rates: conv.rates, createdAt: now, updatedAt: now, expiresAt: now, paidAt: now, confirmedBy: 'admin' });
  }
  store.update('bookings', b.id, {
    endAt: newEnd.toISOString(), days: (Number(b.days) || 0) + days, status: b.status === 'completed' ? 'confirmed' : b.status,
    totalUsd: round2((Number(b.totalUsd) || 0) + amountUsd), paidUsd: round2((Number(b.paidUsd) || 0) + (paid ? amountUsd : 0)),
    reminderSentAt: null, reminderAttempts: 0, adminEndingNotifiedAt: null,
    extensions: [...(b.extensions || []), { days, amountUsd, paymentId: payment ? payment.id : null, at: now, method: paid ? req.body?.method || 'cash' : 'unpaid', by: 'admin' }],
  });
  if (b.clientId) recomputeClientStats(b.clientId);
  store.log('booking', `Бронь ${b.code} продлена на ${days} дн. (админ)`, { bookingId: b.id });
  store.flush();
  res.json(bookingView(store.get('bookings', b.id)));
}));

adminRouter.post('/bookings/:id/mark-paid', wrap(async (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) throw httpError(404, 'Бронь не найдена');
  const due = round2((Number(b.totalUsd) || 0) - (Number(b.paidUsd) || 0));
  const amountUsd = req.body?.amountUsd !== undefined && req.body.amountUsd !== '' ? round2(num(req.body.amountUsd)) : due;
  if (amountUsd <= 0) throw httpError(400, 'Нечего оплачивать');
  const now = new Date().toISOString();
  const conv = convert(amountUsd);
  const pending = paymentsForBooking(b.id).find((p) => PENDING.has(p.status) && p.kind === 'rental');
  if (pending) {
    await markPaid(pending.id, { confirmedBy: 'admin', meta: { manualMethod: req.body?.method || null } });
  } else {
    const payment = store.insert('payments', { id: uuid(), bookingId: b.id, bookingCode: b.code, kind: 'rental', extensionDays: 0, method: req.body?.method || 'cash', status: 'paid', amountUsd, amountKgs: conv.kgs, amountUsdt: conv.usdt, rates: conv.rates, createdAt: now, updatedAt: now, expiresAt: now, paidAt: now, confirmedBy: 'admin' });
    const patch = { paidUsd: round2((Number(b.paidUsd) || 0) + amountUsd), paymentId: payment.id };
    if (['hold', 'expired'].includes(b.status)) { patch.status = 'confirmed'; patch.confirmedAt = now; }
    store.update('bookings', b.id, patch);
    if (b.clientId) recomputeClientStats(b.clientId);
    store.log('payment', `Оплата ${amountUsd}$ (${payment.method}) по брони ${b.code} отмечена вручную`, { bookingId: b.id, paymentId: payment.id });
    if (req.body?.notifyClient) notifyBookingConfirmed(store.get('bookings', b.id), payment).catch(() => {});
  }
  store.flush();
  res.json(bookingView(store.get('bookings', b.id)));
}));

adminRouter.post('/bookings/:id/send-reminder', wrap(async (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) throw httpError(404, 'Бронь не найдена');
  const r = await sendReminder(b);
  if (r.ok) store.update('bookings', b.id, { reminderSentAt: new Date().toISOString() });
  store.flush();
  res.json({ ok: r.ok, results: r.results, text: r.text, booking: bookingView(store.get('bookings', b.id)) });
}));

adminRouter.post('/bookings/:id/resend-confirmation', wrap(async (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) throw httpError(404, 'Бронь не найдена');
  await notifyBookingConfirmed(b, b.paymentId ? store.get('payments', b.paymentId) : null);
  res.json({ ok: true });
}));

adminRouter.get('/bookings/:id/preview/:template', (req, res) => {
  const b = store.get('bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  res.json({ text: previewTemplate(req.params.template, b) });
});

/* ---------- клиенты ---------- */
adminRouter.get('/clients', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const digits = q.replace(/\D/g, '');
  let list = store.list('clients').slice();
  if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q) || (digits && ((c.phone || '').includes(digits) || (c.whatsapp || '').includes(digits))) || (c.email || '').toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q));
  list.sort((a, b) => new Date(b.lastBookingAt || b.createdAt) - new Date(a.lastBookingAt || a.createdAt));
  res.json(list.map((c) => ({ ...c, activeBooking: store.find('bookings', (b) => b.clientId === c.id && b.status === 'confirmed' && new Date(b.endAt) > new Date()) ? true : false })));
});

adminRouter.get('/clients/:id', (req, res) => {
  const c = store.get('clients', req.params.id);
  if (!c) return res.status(404).json({ error: 'Клиент не найден' });
  const bookings = store.filter('bookings', (b) => b.clientId === c.id).sort((a, b) => new Date(b.startAt) - new Date(a.startAt)).map(bookingView);
  res.json({ ...c, bookings });
});

adminRouter.post('/clients', (req, res) => {
  const body = req.body || {};
  const phone = normalizePhone(body.phone);
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'Укажите номер телефона' });
  if (store.find('clients', (c) => c.phone === phone)) return res.status(409).json({ error: 'Клиент с таким номером уже есть' });
  const client = upsertClient({ name: body.name, phone, whatsapp: body.whatsapp, email: body.email, source: 'admin', note: body.note });
  store.update('clients', client.id, { name: String(body.name || '').trim(), note: String(body.note || '').trim(), email: String(body.email || '').trim(), tags: Array.isArray(body.tags) ? body.tags : [] });
  store.flush();
  res.status(201).json(store.get('clients', client.id));
});

adminRouter.put('/clients/:id', (req, res) => {
  const c = store.get('clients', req.params.id);
  if (!c) return res.status(404).json({ error: 'Клиент не найден' });
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.phone !== undefined) { const p = normalizePhone(body.phone); if (!isValidPhone(p)) return res.status(400).json({ error: 'Неверный номер' }); patch.phone = p; }
  if (body.whatsapp !== undefined) patch.whatsapp = normalizePhone(body.whatsapp) || patch.phone || c.phone;
  if (body.email !== undefined) patch.email = String(body.email).trim();
  if (body.note !== undefined) patch.note = String(body.note).trim();
  if (body.blocked !== undefined) patch.blocked = Boolean(body.blocked);
  if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const updated = store.update('clients', c.id, patch);
  store.flush();
  res.json(updated);
});

adminRouter.delete('/clients/:id', (req, res) => {
  const c = store.get('clients', req.params.id);
  if (!c) return res.status(404).json({ error: 'Клиент не найден' });
  for (const b of store.filter('bookings', (x) => x.clientId === c.id)) store.update('bookings', b.id, { clientId: null });
  store.remove('clients', c.id);
  store.flush();
  res.json({ ok: true });
});

/* ---------- платежи ---------- */
adminRouter.get('/payments', (req, res) => {
  const { status, method, from, to, limit } = req.query;
  let list = store.list('payments').slice();
  if (status && status !== 'all') { const set = new Set(String(status).split(',')); list = list.filter((p) => set.has(p.status)); }
  if (method && method !== 'all') list = list.filter((p) => p.method === method);
  if (from) list = list.filter((p) => new Date(p.paidAt || p.createdAt) >= new Date(from));
  if (to) list = list.filter((p) => new Date(p.paidAt || p.createdAt) <= new Date(to));
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ total: list.length, items: list.slice(0, Math.min(1000, Number(limit) || 300)).map(paymentView) });
});

adminRouter.get('/payments/:id/qr', (req, res) => {
  const p = store.get('payments', req.params.id);
  if (!p || !p.qrBase64) return res.status(404).json({ error: 'QR не найден' });
  res.json({ qrBase64: p.qrBase64, qrUrl: p.optima?.qrUrl || '' });
});

adminRouter.post('/payments/:id/confirm', wrap(async (req, res) => {
  const p = await markPaid(req.params.id, { confirmedBy: 'admin', meta: { note: String(req.body?.note || '').slice(0, 200) } });
  res.json(paymentView(p));
}));

adminRouter.post('/payments/:id/cancel', (req, res) => {
  const p = cancelPayment(req.params.id, 'admin');
  if (!p) return res.status(404).json({ error: 'Платёж не найден' });
  store.flush();
  res.json(paymentView(p));
});

adminRouter.post('/payments/:id/refresh', wrap(async (req, res) => {
  const p = await refreshPayment(req.params.id);
  res.json(paymentView(p));
}));

adminRouter.post('/payments/poll-optima', wrap(async (req, res) => {
  const r = await pollOptimaPending({ force: true });
  res.json(r);
}));

/* ---------- настройки ---------- */
adminRouter.get('/settings', (req, res) => {
  res.json({ settings: maskSettings(store.settings), presets: MAIL_PRESETS, networks: USDT_NETWORKS, admin: { login: store.data.auth.login, defaultPassword: Boolean(store.data.auth.defaultPassword) } });
});

adminRouter.put('/settings/:section', (req, res) => {
  const section = req.params.section;
  if (!(section in store.settings)) return res.status(404).json({ error: 'Неизвестный раздел' });
  const patch = unmask(section, { ...(req.body || {}) });
  if (section === 'rates') {
    if (patch.kgsPerUsd !== undefined && !(num(patch.kgsPerUsd) > 0)) return res.status(400).json({ error: 'Курс сома должен быть больше 0' });
    if (patch.usdtPerUsd !== undefined && !(num(patch.usdtPerUsd) > 0)) return res.status(400).json({ error: 'Курс USDT должен быть больше 0' });
    if (patch.kgsPerUsd !== undefined) patch.kgsPerUsd = round2(num(patch.kgsPerUsd));
    if (patch.usdtPerUsd !== undefined) patch.usdtPerUsd = Math.round(num(patch.usdtPerUsd) * 10000) / 10000;
    patch.updatedAt = new Date().toISOString();
  }
  if (section === 'crypto' && patch.networks !== undefined) {
    if (!Array.isArray(patch.networks)) return res.status(400).json({ error: 'Неверный список сетей' });
    patch.networks = patch.networks.map((n) => ({ id: String(n.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), label: String(n.label || n.id || '').slice(0, 60), address: String(n.address || '').trim().slice(0, 120), memo: String(n.memo || '').trim().slice(0, 60), enabled: Boolean(n.enabled) })).filter((n) => n.id);
  }
  if (section === 'mail' && patch.preset && patch.preset !== 'custom') {
    const p = presetHosts(patch.preset);
    if (!patch.imapHost) patch.imapHost = p.imapHost;
    if (!patch.smtpHost) patch.smtpHost = p.smtpHost;
    if (!patch.imapPort) patch.imapPort = p.imapPort;
    if (!patch.smtpPort) patch.smtpPort = p.smtpPort;
  }
  if (section === 'mail' && (patch.email !== undefined || patch.imapHost !== undefined || patch.folder !== undefined)) {
    const cur = store.settings.mail;
    if (patch.email !== cur.email || patch.imapHost !== cur.imapHost || (patch.folder !== undefined && patch.folder !== cur.folder)) patch.lastUid = 0;
  }
  if (section === 'whatsapp') {
    if (patch.reminderHours !== undefined) patch.reminderHours = Math.min(72, Math.max(1, num(patch.reminderHours, 3)));
    if (patch.adminPhone !== undefined) patch.adminPhone = normalizePhone(patch.adminPhone);
  }
  if (section === 'optima') {
    if (patch.qrTtlMinutes !== undefined) patch.qrTtlMinutes = Math.min(120, Math.max(3, Math.round(num(patch.qrTtlMinutes, 20))));
    if (patch.legalPartyId !== undefined) patch.legalPartyId = String(patch.legalPartyId).trim();
    if (patch.apiKey !== undefined) patch.apiKey = String(patch.apiKey).trim();
    const cur = store.settings.optima;
    if ((patch.legalPartyId !== undefined && patch.legalPartyId !== cur.legalPartyId) || (patch.apiKey !== undefined && patch.apiKey !== cur.apiKey)) { patch.salePoints = []; patch.salePointCode = null; patch.cashCode = null; patch.account = ''; patch.salePointName = ''; patch.lastCheck = null; }
  }
  if (section === 'site') {
    if (patch.baseUrl !== undefined) patch.baseUrl = String(patch.baseUrl).trim().replace(/\/+$/, '');
    if (patch.conditions !== undefined && !Array.isArray(patch.conditions)) patch.conditions = String(patch.conditions).split('\n').map((s) => s.trim()).filter(Boolean);
    for (const k of ['minDays', 'maxDays', 'holdMinutes', 'timeStepMinutes']) if (patch[k] !== undefined) patch[k] = Math.max(1, Math.round(num(patch[k], 1)));
    if (patch.deliveryFeeUsd !== undefined) patch.deliveryFeeUsd = round2(num(patch.deliveryFeeUsd));
  }
  if (section === 'company' && patch.whatsapp !== undefined) patch.whatsapp = normalizePhone(patch.whatsapp);
  store.updateSettings(section, patch);
  store.flush();
  store.log('settings', `Изменены настройки: ${section}`);
  res.json({ settings: maskSettings(store.settings) });
});

adminRouter.post('/settings/optima/check', wrap(async (req, res) => {
  const body = unmask('optima', { ...(req.body || {}) });
  const patch = {};
  for (const k of ['legalPartyId', 'apiKey', 'baseUrl']) if (body[k] !== undefined && body[k] !== '') patch[k] = String(body[k]).trim();
  if (Object.keys(patch).length) store.updateSettings('optima', patch);
  try {
    const r = await optima.checkAndDiscover();
    store.flush();
    res.json({ ok: true, salePoints: r.salePoints, selected: r.selected, settings: maskSettings(store.settings) });
  } catch (err) {
    store.updateSettings('optima', { lastCheck: { ok: false, at: new Date().toISOString(), message: err.message } });
    store.flush();
    res.status(400).json({ error: err.message, settings: maskSettings(store.settings) });
  }
}));

adminRouter.put('/settings/optima/select', (req, res) => {
  const { salePointCode, cashCode } = req.body || {};
  const sp = (store.settings.optima.salePoints || []).find((s) => String(s.salePointCode) === String(salePointCode) && String(s.cashCode) === String(cashCode));
  if (!sp) return res.status(400).json({ error: 'Точка не найдена в списке' });
  store.updateSettings('optima', { salePointCode: sp.salePointCode, cashCode: sp.cashCode, account: sp.account, salePointName: [sp.salePointName, sp.cashName].filter(Boolean).join(' · ') });
  store.flush();
  res.json({ settings: maskSettings(store.settings) });
});

adminRouter.get('/settings/optima/balances', wrap(async (req, res) => {
  if (!optima.hasCredentials()) throw httpError(400, 'Укажите ID компании и API-ключ');
  const data = await optima.getBalances(String(req.query.currencies || 'KGS,USD'));
  res.json(data);
}));

adminRouter.get('/settings/optima/statement', wrap(async (req, res) => {
  if (!optima.hasCredentials()) throw httpError(400, 'Укажите ID компании и API-ключ');
  const startDate = String(req.query.from || '').slice(0, 10);
  const endDate = String(req.query.to || '').slice(0, 10);
  if (!startDate || !endDate) throw httpError(400, 'Укажите период');
  if ((new Date(endDate) - new Date(startDate)) / 86400000 > 14) throw httpError(400, 'Период не больше 14 дней (ограничение банка)');
  const type = req.query.type === 'pos' ? 'pos' : 'qr';
  const data = type === 'pos' ? await optima.getPosStatement({ startDate, endDate, accountNumber: req.query.account }) : await optima.getQrStatement({ startDate, endDate });
  // сопоставление с нашими платежами по сумме и дате
  const ours = store.filter('payments', (p) => p.method === 'elqr' && p.status === 'paid');
  const ops = (type === 'pos' ? data.posOperations : data.qrOperations) || [];
  const matched = ops.map((op) => {
    const t = new Date(op.operationProcessedDateTime).getTime();
    const hit = ours.find((p) => Math.abs(Number(op.operationSum) - Number(p.amountKgs)) < 1 && Math.abs(new Date(p.paidAt).getTime() - t) < 6 * 3600000);
    return { ...op, matchedPaymentId: hit ? hit.id : null, matchedBookingCode: hit ? hit.bookingCode : null };
  });
  res.json({ ...data, operations: matched, type });
}));

adminRouter.post('/settings/mail/test-smtp', wrap(async (req, res) => {
  const body = unmask('mail', { ...(req.body || {}) });
  if (Object.keys(body).length) { store.updateSettings('mail', body); store.flush(); }
  try {
    const r = await testSmtp();
    store.updateSettings('mail', { lastCheck: { ok: true, at: new Date().toISOString(), message: 'SMTP: ' + r.message } });
    store.flush();
    res.json(r);
  } catch (err) {
    store.updateSettings('mail', { lastCheck: { ok: false, at: new Date().toISOString(), message: 'SMTP: ' + err.message } });
    store.flush();
    res.status(400).json({ error: err.message });
  }
}));

adminRouter.post('/settings/mail/test-imap', wrap(async (req, res) => {
  const body = unmask('mail', { ...(req.body || {}) });
  if (Object.keys(body).length) { store.updateSettings('mail', body); store.flush(); }
  try {
    const r = await testImap();
    store.updateSettings('mail', { lastCheck: { ok: true, at: new Date().toISOString(), message: 'IMAP: ' + r.message } });
    store.flush();
    res.json(r);
  } catch (err) {
    store.updateSettings('mail', { lastCheck: { ok: false, at: new Date().toISOString(), message: 'IMAP: ' + err.message } });
    store.flush();
    res.status(400).json({ error: err.message });
  }
}));

adminRouter.post('/settings/mail/poll-now', wrap(async (req, res) => {
  const r = await pollMailNow();
  if (!r.ok) return res.status(400).json({ error: r.error, results: r.results });
  res.json(r);
}));

adminRouter.post('/settings/whatsapp/status', wrap(async (req, res) => {
  const body = unmask('whatsapp', { ...(req.body || {}) });
  if (Object.keys(body).length) { store.updateSettings('whatsapp', body); store.flush(); }
  try {
    const r = await waStatus();
    store.flush();
    res.json(r);
  } catch (err) {
    store.updateSettings('whatsapp', { lastCheck: { ok: false, at: new Date().toISOString(), message: err.message } });
    store.flush();
    res.status(400).json({ error: err.message });
  }
}));

adminRouter.post('/settings/whatsapp/test', wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone || store.settings.whatsapp.adminPhone);
  if (!isValidPhone(phone)) throw httpError(400, 'Укажите номер для теста');
  const w = store.settings.whatsapp;
  const r = await waSend(phone, `Luxar Autorent: WhatsApp подключён. Тестовое сообщение.`, { template: 'test', creds: { ...w } });
  if (!r.ok) return res.status(400).json({ error: r.error || 'Не удалось отправить' });
  res.json({ ok: true, message: `Сообщение отправлено на +${phone}` });
}));

adminRouter.post('/settings/security', (req, res) => {
  const { currentPassword, newLogin, newPassword } = req.body || {};
  if (!verifyPassword(String(currentPassword || ''), store.data.auth)) return res.status(400).json({ error: 'Текущий пароль неверный' });
  const login = String(newLogin || store.data.auth.login).trim();
  const password = String(newPassword || '');
  if (login.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
  setAdminCredentials(login, password);
  createSession(req, res);
  store.log('auth', 'Изменён логин/пароль администратора');
  res.json({ ok: true, login });
});

/* ---------- аналитика ---------- */
adminRouter.get('/analytics', (req, res) => {
  const tz = store.settings.site.timezone;
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : addDays(to, -30);
  const inPeriod = (d) => d && new Date(d) >= from && new Date(d) <= to;
  const paid = store.filter('payments', (p) => p.status === 'paid' && inPeriod(p.paidAt));
  const revenueUsd = round2(paid.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0));
  const byMethod = {};
  for (const p of paid) { byMethod[p.method] = byMethod[p.method] || { count: 0, amountUsd: 0 }; byMethod[p.method].count += 1; byMethod[p.method].amountUsd = round2(byMethod[p.method].amountUsd + p.amountUsd); }
  const byDay = {};
  for (const p of paid) { const d = toZoned(new Date(p.paidAt), tz).date; byDay[d] = round2((byDay[d] || 0) + p.amountUsd); }
  const days = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) { const key = toZoned(d, tz).date; days.push({ date: key, amountUsd: byDay[key] || 0 }); }
  const allPaid = store.filter('payments', (p) => p.status === 'paid');
  const byMonth = {};
  for (const p of allPaid) { const m = toZoned(new Date(p.paidAt), tz).date.slice(0, 7); byMonth[m] = round2((byMonth[m] || 0) + p.amountUsd); }
  const months = [];
  const nowZ = toZoned(new Date(), tz);
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(nowZ.year, nowZ.month - 1 - i, 1)); const key = d.toISOString().slice(0, 7); months.push({ month: key, amountUsd: byMonth[key] || 0 }); }
  const bookings = store.filter('bookings', (b) => inPeriod(b.createdAt));
  const byStatus = {};
  for (const b of bookings) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
  const cars = store.list('cars');
  const periodDays = Math.max(1, (to - from) / 86400000);
  const byCar = cars.map((c) => {
    const bs = store.filter('bookings', (b) => b.carId === c.id && ['confirmed', 'completed'].includes(b.status) && overlaps(from, to, b.startAt, b.endAt));
    let bookedDays = 0;
    for (const b of bs) { const s = Math.max(new Date(b.startAt), from); const e = Math.min(new Date(b.endAt), to); bookedDays += Math.max(0, (e - s) / 86400000); }
    const revenue = round2(paid.filter((p) => { const b = store.get('bookings', p.bookingId); return b && b.carId === c.id; }).reduce((s, p) => s + p.amountUsd, 0));
    return { id: c.id, name: c.name, bookings: bs.length, bookedDays: Math.round(bookedDays * 10) / 10, occupancy: Math.round((bookedDays / periodDays) * 100), revenueUsd: revenue, pricePerDay: c.pricePerDay };
  }).sort((a, b) => b.revenueUsd - a.revenueUsd);
  const confirmedBookings = store.filter('bookings', (b) => ['confirmed', 'completed'].includes(b.status) && inPeriod(b.createdAt));
  const avgDays = confirmedBookings.length ? Math.round((confirmedBookings.reduce((s, b) => s + (Number(b.days) || 0), 0) / confirmedBookings.length) * 10) / 10 : 0;
  const avgCheck = confirmedBookings.length ? round2(confirmedBookings.reduce((s, b) => s + (Number(b.totalUsd) || 0), 0) / confirmedBookings.length) : 0;
  const clientsMap = {};
  for (const p of paid) { const b = store.get('bookings', p.bookingId); if (!b) continue; const key = b.clientId || b.phone; clientsMap[key] = clientsMap[key] || { clientId: b.clientId, name: b.name, phone: b.phone, amountUsd: 0, payments: 0 }; clientsMap[key].amountUsd = round2(clientsMap[key].amountUsd + p.amountUsd); clientsMap[key].payments += 1; }
  const topClients = Object.values(clientsMap).sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 8);
  const occupancyAvg = byCar.length ? Math.round(byCar.filter((c) => cars.find((x) => x.id === c.id)?.status === 'active').reduce((s, c) => s + c.occupancy, 0) / Math.max(1, cars.filter((c) => c.status === 'active').length)) : 0;
  res.json({ from: from.toISOString(), to: to.toISOString(), revenueUsd, paymentsCount: paid.length, byMethod, days, months, bookings: { total: bookings.length, byStatus, confirmed: confirmedBookings.length, conversion: bookings.length ? Math.round((confirmedBookings.length / bookings.length) * 100) : 0 }, byCar, avgDays, avgCheck, topClients, occupancyAvg, newClients: store.filter('clients', (c) => inPeriod(c.createdAt)).length });
});

/* ---------- журналы ---------- */
adminRouter.get('/activity', (req, res) => res.json(store.list('activity').slice(-Math.min(500, Number(req.query.limit) || 100)).reverse()));
adminRouter.get('/notifications', (req, res) => res.json(store.list('notifications').slice(-Math.min(500, Number(req.query.limit) || 100)).reverse()));
adminRouter.get('/mail-log', (req, res) => res.json(store.list('mailLog').slice(-Math.min(500, Number(req.query.limit) || 100)).reverse()));

/* ---------- экспорт CSV ---------- */
function csv(res, name, header, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
}

adminRouter.get('/export/bookings.csv', (req, res) => {
  const tz = store.settings.site.timezone;
  const f = (iso) => (iso ? toZoned(new Date(iso), tz).date + ' ' + toZoned(new Date(iso), tz).time : '');
  csv(res, 'bookings.csv', ['Код', 'Статус', 'Автомобиль', 'Клиент', 'Телефон', 'Начало', 'Окончание', 'Дней', 'Сумма $', 'Оплачено $', 'Получение', 'Создана', 'Источник'],
    store.list('bookings').map((b) => [b.code, b.status, carBrief(b.carId)?.name, b.name, b.phone, f(b.startAt), f(b.endAt), b.days, b.totalUsd, b.paidUsd, b.pickup === 'delivery' ? 'Доставка: ' + (b.address || '') : 'Самовывоз', f(b.createdAt), b.source]));
});

adminRouter.get('/export/clients.csv', (req, res) => {
  csv(res, 'clients.csv', ['Имя', 'Телефон', 'WhatsApp', 'Email', 'Броней', 'Потрачено $', 'Последняя бронь', 'Заметка'],
    store.list('clients').map((c) => [c.name, c.phone, c.whatsapp, c.email, c.bookingsCount, c.totalSpentUsd, c.lastBookingAt ? c.lastBookingAt.slice(0, 10) : '', c.note]));
});

adminRouter.get('/export/payments.csv', (req, res) => {
  const tz = store.settings.site.timezone;
  const f = (iso) => (iso ? toZoned(new Date(iso), tz).date + ' ' + toZoned(new Date(iso), tz).time : '');
  csv(res, 'payments.csv', ['Дата', 'Статус', 'Бронь', 'Способ', 'Сумма $', 'Сумма сом', 'Сумма USDT', 'Сеть', 'Подтвердил', 'ID транзакции'],
    store.list('payments').map((p) => [f(p.paidAt || p.createdAt), p.status, p.bookingCode, p.method, p.amountUsd, p.amountKgs, p.amountUsdt, p.network || '', p.confirmedBy || '', p.optima?.transactionId || '']));
});
