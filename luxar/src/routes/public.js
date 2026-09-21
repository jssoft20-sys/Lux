import { Router } from 'express';
import { store } from '../store.js';
import { uuid, token as makeToken } from '../utils/ids.js';
import { zonedToUtc, addDays, addMinutes, fmtDateTime } from '../utils/time.js';
import { normalizePhone, isValidPhone } from '../utils/phone.js';
import { quote, convert } from '../services/pricing.js';
import { carOccupancy, busyRanges, isAvailable, maxExtensionDays, derivedStatus, blockingBookings } from '../services/availability.js';
import { upsertClient } from '../services/clients.js';
import { createPayment, clientMarkedPaid, activePayment, publicPayment, refreshPayment, elqrAvailable, usdtAvailable, enabledNetworks, paymentsForBooking, cancelPayment, httpError, PENDING } from '../services/payments.js';
import { clientIp } from '../auth.js';

export const publicRouter = Router();

const CLASS_LABELS = { city: 'City class', comfort: 'Comfort class', business: 'Business class', executive: 'Executive class', suv: 'SUV', premium: 'Premium', sport: 'Sport', minivan: 'Minivan' };

/* простой лимит запросов: не больше N действий с одного IP за час */
const rate = new Map();
function limit(key, max, windowMs = 3600000) {
  const now = Date.now();
  const rec = rate.get(key) || [];
  const fresh = rec.filter((t) => now - t < windowMs);
  if (fresh.length >= max) return false;
  fresh.push(now);
  rate.set(key, fresh);
  if (rate.size > 5000) rate.clear();
  return true;
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function publicCar(car, { withOccupancy = true } = {}) {
  const view = {
    id: car.id, slug: car.slug, name: car.name, brand: car.brand, model: car.model, class: car.class, classLabel: CLASS_LABELS[car.class] || car.class,
    year: car.year, engine: car.engine, power: car.power, transmission: car.transmission, fuel: car.fuel, drive: car.drive, seats: car.seats, color: car.color,
    pricePerDay: car.pricePerDay, discounts: car.discounts || {}, deposit: car.deposit || 0, minDays: car.minDays || 1,
    description: car.description || '', features: car.features || [], photos: car.photos && car.photos.length ? car.photos : ['/assets/car-placeholder.jpg'], rating: car.rating || 0, reviewsCount: car.reviewsCount || 0, status: car.status, order: car.order || 0,
  };
  if (withOccupancy) view.occupancy = carOccupancy(car.id);
  return view;
}

function publicBooking(b, payment) {
  const car = store.get('cars', b.carId);
  const site = store.settings.site;
  const maxExt = b.status === 'confirmed' ? maxExtensionDays(b, site.maxDays) : 0;
  return {
    code: b.code, token: b.token, status: b.status, state: derivedStatus(b), car: car ? publicCar(car, { withOccupancy: false }) : null,
    startAt: b.startAt, endAt: b.endAt, days: b.days, pickup: b.pickup, address: b.address || '', name: b.name, phone: b.phone, email: b.email || '', comment: b.comment || '',
    pricePerDay: b.pricePerDay, discountPercent: b.discountPercent, subtotal: b.subtotal, discount: b.discount, deliveryFee: b.deliveryFee, totalUsd: b.totalUsd, paidUsd: b.paidUsd,
    holdUntil: b.holdUntil, createdAt: b.createdAt, extensions: b.extensions || [], payment: payment || null,
    canExtend: b.status === 'confirmed' && site.extendEnabled !== false && maxExt > 0 && new Date(b.endAt) > new Date(Date.now() - 6 * 3600000),
    maxExtendDays: maxExt,
    conversion: convert(b.totalUsd),
  };
}

publicRouter.get('/config', (req, res) => {
  const s = store.settings;
  res.json({
    company: s.company,
    site: { timezone: s.site.timezone, currencySymbol: s.site.currencySymbol, workStart: s.site.workStart, workEnd: s.site.workEnd, timeStepMinutes: s.site.timeStepMinutes, minDays: s.site.minDays, maxDays: s.site.maxDays, holdMinutes: s.site.holdMinutes, deliveryEnabled: s.site.deliveryEnabled, deliveryFeeUsd: s.site.deliveryFeeUsd, extendEnabled: s.site.extendEnabled, conditions: s.site.conditions || [] },
    rates: { kgsPerUsd: s.rates.kgsPerUsd, usdtPerUsd: s.rates.usdtPerUsd },
    payments: { elqr: elqrAvailable(), usdt: usdtAvailable(), networks: enabledNetworks().map((n) => ({ id: n.id, label: n.label })), usdtWindowMinutes: s.crypto.paymentWindowMinutes, qrTtlMinutes: s.optima.qrTtlMinutes, binancePayId: s.crypto.binancePayId || '' },
    now: new Date().toISOString(),
  });
});

publicRouter.get('/cars', (req, res) => {
  const cars = store.filter('cars', (c) => c.status !== 'hidden').sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
  res.json(cars.map((c) => publicCar(c)));
});

publicRouter.get('/cars/:slug', (req, res) => {
  const car = store.find('cars', (c) => (c.slug === req.params.slug || c.id === req.params.slug) && c.status !== 'hidden');
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  const from = new Date();
  const to = addDays(from, 120);
  res.json({ ...publicCar(car), busy: busyRanges(car.id, from, to) });
});

publicRouter.get('/schedule', (req, res) => {
  const days = Math.min(60, Math.max(3, Number(req.query.days) || 14));
  const from = new Date(Date.now() - 86400000);
  const to = addDays(new Date(), days + 1);
  const cars = store.filter('cars', (c) => c.status !== 'hidden').sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({ from: from.toISOString(), to: to.toISOString(), timezone: store.settings.site.timezone, cars: cars.map((c) => ({ ...publicCar(c), busy: busyRanges(c.id, from, to) })) });
});

publicRouter.post('/quote', (req, res) => {
  const { carId, days, pickup } = req.body || {};
  const car = store.get('cars', carId);
  if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
  const d = Math.max(1, Math.min(store.settings.site.maxDays, Number(days) || 1));
  const q = quote({ car, days: d, pickup });
  res.json({ ...q, ...convert(q.totalUsd) });
});

publicRouter.post('/bookings', wrap(async (req, res) => {
  const ip = clientIp(req);
  if (!limit('book:' + ip, 15)) throw httpError(429, 'Слишком много запросов. Попробуйте позже');
  const body = req.body || {};
  const site = store.settings.site;
  const car = store.get('cars', body.carId);
  if (!car || car.status !== 'active') throw httpError(400, 'Автомобиль недоступен для бронирования');
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  if (name.length < 2) throw httpError(400, 'Укажите имя');
  if (!isValidPhone(phone)) throw httpError(400, 'Укажите номер телефона');
  if (!limit('phone:' + phone, 8)) throw httpError(429, 'Слишком много броней с этого номера. Напишите нам в WhatsApp');
  const minDays = Math.max(1, Number(car.minDays) || Number(site.minDays) || 1);
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < minDays || days > site.maxDays) throw httpError(400, `Срок аренды от ${minDays} до ${site.maxDays} дней`);
  const startAt = zonedToUtc(body.startDate, body.startTime, site.timezone);
  if (!startAt) throw httpError(400, 'Укажите дату и время начала');
  if (startAt.getTime() < Date.now() - 20 * 60000) throw httpError(400, 'Выбранное время уже прошло');
  if (startAt.getTime() > Date.now() + 180 * 86400000) throw httpError(400, 'Бронирование возможно не более чем на 180 дней вперёд');
  const endAt = addDays(startAt, days);
  if (!isAvailable(car.id, startAt, endAt)) throw httpError(409, 'На эти даты автомобиль уже занят. Выберите другие даты');
  const pickup = body.pickup === 'delivery' && site.deliveryEnabled ? 'delivery' : 'self';
  const address = pickup === 'delivery' ? String(body.address || '').trim().slice(0, 200) : '';
  if (pickup === 'delivery' && address.length < 3) throw httpError(400, 'Укажите адрес доставки');
  const q = quote({ car, days, pickup });
  const email = String(body.email || '').trim().slice(0, 120);
  const client = upsertClient({ name, phone, email, source: 'site' });
  const now = new Date();
  const booking = {
    id: uuid(), code: 'LX-' + store.nextCounter('booking'), token: makeToken(),
    carId: car.id, clientId: client ? client.id : null, name, phone, whatsapp: phone, email,
    startAt: startAt.toISOString(), endAt: endAt.toISOString(), days, pickup, address, comment: String(body.comment || '').trim().slice(0, 500),
    pricePerDay: q.pricePerDay, discountPercent: q.discountPercent, subtotal: q.subtotal, discount: q.discount, deliveryFee: q.deliveryFee, totalUsd: q.totalUsd, paidUsd: 0,
    status: 'hold', holdUntil: addMinutes(now, Number(site.holdMinutes) || 30).toISOString(), source: 'site', paymentId: null, extensions: [],
    reminderSentAt: null, reminderAttempts: 0, adminEndingNotifiedAt: null, ip, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  store.insert('bookings', booking);
  store.log('booking', `Новая бронь ${booking.code}: ${car.name}, ${name}`, { bookingId: booking.id });
  store.flush();
  res.status(201).json(publicBooking(booking, null));
}));

function findBooking(req) {
  const b = store.find('bookings', (x) => x.token === req.params.token);
  if (!b) throw httpError(404, 'Бронь не найдена');
  return b;
}

publicRouter.get('/bookings/:token', wrap(async (req, res) => {
  const b = findBooking(req);
  let p = activePayment(b.id) || paymentsForBooking(b.id)[0] || null;
  if (p && p.method === 'elqr' && p.status === 'pending' && (!p.optima.lastPolledAt || Date.now() - new Date(p.optima.lastPolledAt).getTime() > 3000)) p = await refreshPayment(p.id);
  res.json(publicBooking(store.get('bookings', b.id), await publicPayment(p)));
}));

publicRouter.post('/bookings/:token/pay', wrap(async (req, res) => {
  const b = findBooking(req);
  if (!['hold', 'expired'].includes(b.status)) throw httpError(400, b.status === 'confirmed' ? 'Бронь уже оплачена' : 'Бронь неактивна');
  if (b.status === 'expired') {
    if (!isAvailable(b.carId, b.startAt, b.endAt, b.id)) throw httpError(409, 'Срок брони истёк, автомобиль на эти даты уже занят');
    store.update('bookings', b.id, { status: 'hold', holdUntil: addMinutes(new Date(), store.settings.site.holdMinutes || 30).toISOString() });
  }
  const { method, network } = req.body || {};
  const existing = activePayment(b.id, 'rental');
  if (existing && existing.method === method && (method !== 'usdt' || existing.network === (network || existing.network)) && existing.status !== 'error') {
    return res.json(publicBooking(store.get('bookings', b.id), await publicPayment(existing)));
  }
  const payment = await createPayment({ booking: store.get('bookings', b.id), method, network, kind: 'rental' });
  res.status(201).json(publicBooking(store.get('bookings', b.id), await publicPayment(payment)));
}));

publicRouter.post('/bookings/:token/cancel', wrap(async (req, res) => {
  const b = findBooking(req);
  if (!['hold', 'expired'].includes(b.status)) throw httpError(400, 'Отменить можно только неоплаченную бронь. Напишите нам в WhatsApp');
  for (const p of paymentsForBooking(b.id)) if (PENDING.has(p.status)) cancelPayment(p.id, 'client');
  store.update('bookings', b.id, { status: 'cancelled', cancelledBy: 'client', cancelledAt: new Date().toISOString() });
  store.flush();
  res.json({ ok: true });
}));

publicRouter.get('/bookings/:token/extension-quote', wrap(async (req, res) => {
  const b = findBooking(req);
  if (b.status !== 'confirmed') throw httpError(400, 'Продление доступно только для подтверждённой брони');
  const car = store.get('cars', b.carId);
  const maxDays = maxExtensionDays(b, store.settings.site.maxDays);
  const days = Math.max(1, Math.min(maxDays || 1, Number(req.query.days) || 1));
  const q = quote({ car, days, pricePerDay: b.pricePerDay });
  res.json({ ...q, ...convert(q.totalUsd), maxDays, newEndAt: addDays(b.endAt, days).toISOString() });
}));

publicRouter.post('/bookings/:token/extend', wrap(async (req, res) => {
  const b = findBooking(req);
  if (b.status !== 'confirmed') throw httpError(400, 'Продление доступно только для подтверждённой брони');
  if (store.settings.site.extendEnabled === false) throw httpError(400, 'Продление онлайн отключено. Напишите нам в WhatsApp');
  const { days, method, network } = req.body || {};
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1) throw httpError(400, 'Укажите количество дней');
  const existing = activePayment(b.id, 'extension');
  if (existing && existing.extensionDays === d && existing.method === method && existing.status !== 'error') {
    return res.json(publicBooking(b, await publicPayment(existing)));
  }
  const payment = await createPayment({ booking: b, method, network, kind: 'extension', extensionDays: d });
  res.status(201).json(publicBooking(store.get('bookings', b.id), await publicPayment(payment)));
}));

publicRouter.get('/payments/:id', wrap(async (req, res) => {
  let p = store.get('payments', req.params.id);
  if (!p) throw httpError(404, 'Платёж не найден');
  const b = store.get('bookings', p.bookingId);
  if (!b || b.token !== req.query.token) throw httpError(403, 'Нет доступа');
  if (p.method === 'elqr' && p.status === 'pending' && (!p.optima.lastPolledAt || Date.now() - new Date(p.optima.lastPolledAt).getTime() > 3000)) p = await refreshPayment(p.id);
  res.json({ payment: await publicPayment(p), booking: publicBooking(store.get('bookings', b.id), null) });
}));

publicRouter.post('/payments/:id/mark-paid', wrap(async (req, res) => {
  const p = store.get('payments', req.params.id);
  if (!p) throw httpError(404, 'Платёж не найден');
  const b = store.get('bookings', p.bookingId);
  if (!b || b.token !== (req.body || {}).token) throw httpError(403, 'Нет доступа');
  if (p.method !== 'usdt') throw httpError(400, 'Для QR-оплаты подтверждение приходит автоматически');
  const updated = await clientMarkedPaid(p.id);
  res.json({ payment: await publicPayment(updated), booking: publicBooking(store.get('bookings', b.id), null) });
}));

/* Поиск текущей аренды по номеру телефона для продления с карточки автомобиля */
publicRouter.post('/cars/:id/extend-lookup', wrap(async (req, res) => {
  const ip = clientIp(req);
  if (!limit('lookup:' + ip, 30)) throw httpError(429, 'Слишком много запросов');
  const phone = normalizePhone((req.body || {}).phone);
  if (!isValidPhone(phone)) throw httpError(400, 'Укажите номер телефона');
  const now = new Date();
  const list = blockingBookings(req.params.id).filter((b) => b.status === 'confirmed' && (b.phone === phone || b.whatsapp === phone) && new Date(b.endAt) > new Date(now.getTime() - 6 * 3600000))
    .sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
  if (!list.length) throw httpError(404, 'Аренда с этим номером не найдена. Проверьте номер или напишите нам в WhatsApp');
  const b = list[0];
  res.json({ token: b.token, code: b.code, endAt: b.endAt, endLabel: fmtDateTime(b.endAt, store.settings.site.timezone) });
}));

/* Поиск активной аренды по номеру телефона среди всех автомобилей (продление из раздела «Сервис» / «Профиль») */
publicRouter.post('/extend-lookup', wrap(async (req, res) => {
  const ip = clientIp(req);
  if (!limit('lookup:' + ip, 30)) throw httpError(429, 'Слишком много запросов');
  const phone = normalizePhone((req.body || {}).phone);
  if (!isValidPhone(phone)) throw httpError(400, 'Укажите номер телефона');
  const now = Date.now();
  const list = store.filter('bookings', (b) => ['confirmed', 'hold'].includes(b.status) && (b.phone === phone || b.whatsapp === phone) && new Date(b.endAt).getTime() > now - 6 * 3600000)
    .sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
  if (!list.length) throw httpError(404, 'Бронь с этим номером не найдена. Проверьте номер или напишите нам в WhatsApp');
  res.json({ bookings: list.map((b) => ({ token: b.token, code: b.code, status: b.status, startAt: b.startAt, endAt: b.endAt, car: carBriefPublic(b.carId) })) });
}));

function carBriefPublic(carId) {
  const c = store.get('cars', carId);
  return c ? { id: c.id, slug: c.slug, name: c.name, photo: (c.photos || [])[0] || '' } : null;
}
