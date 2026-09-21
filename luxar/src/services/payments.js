import QRCode from 'qrcode';
import { store } from '../store.js';
import { uuid } from '../utils/ids.js';
import { round2 } from '../utils/money.js';
import { addDays, addMinutes } from '../utils/time.js';
import { convert, quote } from './pricing.js';
import * as optima from './optima.js';
import { isAvailable, maxExtensionDays } from './availability.js';
import { notifyBookingConfirmed, notifyExtensionConfirmed, notifyPaymentCheck } from './notify.js';
import { recomputeClientStats } from './clients.js';

export const PENDING = new Set(['pending', 'awaiting']);

export function paymentsForBooking(bookingId) {
  return store.filter('payments', (p) => p.bookingId === bookingId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function activePayment(bookingId, kind = null) {
  const now = Date.now();
  return paymentsForBooking(bookingId).find((p) => PENDING.has(p.status) && (!kind || p.kind === kind) && new Date(p.expiresAt).getTime() > now) || null;
}

export function enabledNetworks() {
  const c = store.settings.crypto;
  return (c.networks || []).filter((n) => n.enabled && String(n.address || '').trim());
}

export function usdtAvailable() {
  return Boolean(store.settings.crypto.enabled && enabledNetworks().length);
}

export function elqrAvailable() {
  return optima.isConfigured();
}

/* Уникальная сумма USDT: копейки подбираются так, чтобы у каждой ожидающей оплаты была своя сумма */
function uniqueUsdtAmount(base) {
  const c = store.settings.crypto;
  const b = round2(base);
  if (!c.uniqueCents) return b;
  const used = new Set(store.filter('payments', (p) => p.method === 'usdt' && PENDING.has(p.status)).map((p) => round2(p.amountUsdt)));
  const whole = Math.floor(b);
  const pool = [];
  for (let cents = 1; cents <= 99; cents++) {
    const v = round2(whole + cents / 100);
    if (v >= b) pool.push(v);
  }
  for (let cents = 1; cents <= 49; cents++) pool.push(round2(whole + 1 + cents / 100));
  // перемешиваем, чтобы суммы не шли подряд
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  pool.sort((x, y) => Math.abs(x - b) - Math.abs(y - b) + (Math.random() - 0.5) * 0.3);
  for (const v of pool) if (!used.has(v)) return v;
  return round2(b + 2 + Math.floor(Math.random() * 90) / 100);
}

function carName(booking) {
  const car = store.get('cars', booking.carId);
  return car ? car.name : '';
}

/*
 * Создание платежа для брони.
 * kind = 'rental' — оплата аренды; 'extension' — продление на extensionDays.
 */
export async function createPayment({ booking, method, network, kind = 'rental', extensionDays = 0 }) {
  if (!['elqr', 'usdt'].includes(method)) throw httpError(400, 'Неизвестный способ оплаты');
  if (method === 'elqr' && !elqrAvailable()) throw httpError(400, 'Оплата по QR временно недоступна');
  if (method === 'usdt' && !usdtAvailable()) throw httpError(400, 'Оплата USDT временно недоступна');

  const car = store.get('cars', booking.carId);
  if (!car) throw httpError(404, 'Автомобиль не найден');

  let amountUsd;
  if (kind === 'extension') {
    const days = Number(extensionDays) || 0;
    if (days < 1) throw httpError(400, 'Укажите количество дней');
    const maxDays = maxExtensionDays(booking, store.settings.site.maxDays);
    if (days > maxDays) throw httpError(400, maxDays > 0 ? `Продлить можно максимум на ${maxDays} дн.` : 'На эти даты автомобиль уже забронирован');
    amountUsd = quote({ car, days, pricePerDay: booking.pricePerDay }).totalUsd;
  } else {
    amountUsd = round2(Math.max(0, (Number(booking.totalUsd) || 0) - (Number(booking.paidUsd) || 0)));
    if (amountUsd <= 0) throw httpError(400, 'Бронь уже оплачена');
  }

  // отменяем предыдущие ожидающие платежи того же типа
  for (const p of paymentsForBooking(booking.id)) {
    if (PENDING.has(p.status) && p.kind === kind) store.update('payments', p.id, { status: 'cancelled', cancelledReason: 'replaced' });
  }

  const conv = convert(amountUsd);
  const now = new Date();
  const payment = {
    id: uuid(),
    bookingId: booking.id,
    bookingCode: booking.code,
    kind,
    extensionDays: kind === 'extension' ? Number(extensionDays) : 0,
    method,
    status: 'pending',
    amountUsd,
    amountKgs: conv.kgs,
    amountUsdt: conv.usdt,
    rates: conv.rates,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: null,
    paidAt: null,
    confirmedBy: null,
  };

  if (method === 'elqr') {
    const o = store.settings.optima;
    const ttl = Number(o.qrTtlMinutes) || 20;
    const note = `${store.settings.company.name} ${booking.code} ${carName(booking)}${kind === 'extension' ? ' продление' : ''}`;
    let qr;
    try {
      qr = await optima.generateQr({ amountKgs: conv.kgs, note, ttlMinutes: ttl });
    } catch (err) {
      store.log('optima', 'Ошибка генерации QR: ' + err.message, { bookingId: booking.id });
      throw httpError(502, err.message);
    }
    payment.expiresAt = addMinutes(now, ttl).toISOString();
    payment.optima = { transactionId: qr.transactionId, qrUrl: qr.qrUrl, deepLinks: qr.deepLinks, qrGenerateType: qr.qrGenerateType, untilDateTime: qr.untilDateTime, status: 'NEW', lastPolledAt: null, pollErrors: 0, lastError: null, bankSum: null };
    payment.qrBase64 = qr.qrBase64;
  } else {
    const net = enabledNetworks().find((n) => n.id === network) || enabledNetworks()[0];
    if (!net) throw httpError(400, 'Сеть USDT недоступна');
    const c = store.settings.crypto;
    payment.network = net.id;
    payment.amountUsdt = uniqueUsdtAmount(conv.usdt);
    payment.crypto = { network: net.id, networkLabel: net.label, address: String(net.address).trim(), memo: net.memo || '', binancePayId: c.binancePayId || '' };
    payment.expiresAt = addMinutes(now, Number(c.paymentWindowMinutes) || 60).toISOString();
  }

  store.insert('payments', payment);
  const holdUntil = new Date(Math.max(new Date(booking.holdUntil || 0).getTime(), new Date(payment.expiresAt).getTime())).toISOString();
  store.update('bookings', booking.id, { paymentId: payment.id, holdUntil });
  store.log('payment', `Создан платёж ${method.toUpperCase()} ${amountUsd}$ по брони ${booking.code}`, { paymentId: payment.id, bookingId: booking.id });
  store.flush();
  return payment;
}

/* Подтверждение оплаты: бронь подтверждается или продлевается, уведомления отправляются */
export async function markPaid(paymentId, { confirmedBy = 'admin', meta = {} } = {}) {
  const payment = store.get('payments', paymentId);
  if (!payment) throw httpError(404, 'Платёж не найден');
  if (payment.status === 'paid') return payment;
  const booking = store.get('bookings', payment.bookingId);
  if (!booking) throw httpError(404, 'Бронь не найдена');
  const now = new Date().toISOString();
  store.update('payments', payment.id, { status: 'paid', paidAt: now, confirmedBy, meta: { ...(payment.meta || {}), ...meta } });

  let days = payment.extensionDays;
  if (payment.kind === 'extension') {
    const newEnd = addDays(booking.endAt, days).toISOString();
    const conflict = !isAvailable(booking.carId, booking.endAt, newEnd, booking.id);
    const patch = {
      endAt: newEnd,
      days: (Number(booking.days) || 0) + days,
      totalUsd: round2((Number(booking.totalUsd) || 0) + payment.amountUsd),
      paidUsd: round2((Number(booking.paidUsd) || 0) + payment.amountUsd),
      reminderSentAt: null,
      reminderAttempts: 0,
      adminEndingNotifiedAt: null,
      extensions: [...(booking.extensions || []), { days, amountUsd: payment.amountUsd, paymentId: payment.id, at: now, method: payment.method }],
    };
    if (conflict) patch.conflict = 'Продление пересекается с другой бронью — проверьте календарь';
    if (booking.status === 'completed') patch.status = 'confirmed';
    store.update('bookings', booking.id, patch);
  } else {
    const patch = { paidUsd: round2((Number(booking.paidUsd) || 0) + payment.amountUsd), paymentId: payment.id };
    if (['hold', 'expired'].includes(booking.status)) {
      const conflict = !isAvailable(booking.carId, booking.startAt, booking.endAt, booking.id);
      patch.status = 'confirmed';
      patch.confirmedAt = now;
      if (conflict) patch.conflict = 'Оплата пришла после истечения брони, даты пересекаются с другой бронью';
    }
    store.update('bookings', booking.id, patch);
  }
  if (booking.clientId) recomputeClientStats(booking.clientId);
  store.log('payment', `Оплата ${payment.method.toUpperCase()} ${payment.amountUsd}$ по брони ${booking.code} подтверждена (${confirmedBy})`, { paymentId: payment.id, bookingId: booking.id });
  store.flush();

  const fresh = store.get('bookings', booking.id);
  const freshPayment = store.get('payments', payment.id);
  if (payment.kind === 'extension') await notifyExtensionConfirmed(fresh, freshPayment, days);
  else await notifyBookingConfirmed(fresh, freshPayment);
  return freshPayment;
}

export async function clientMarkedPaid(paymentId) {
  const payment = store.get('payments', paymentId);
  if (!payment) throw httpError(404, 'Платёж не найден');
  if (payment.status === 'paid') return payment;
  if (!PENDING.has(payment.status)) throw httpError(400, 'Срок оплаты истёк. Создайте новую оплату');
  const booking = store.get('bookings', payment.bookingId);
  const now = new Date();
  store.update('payments', payment.id, { status: 'awaiting', clientMarkedPaidAt: now.toISOString(), expiresAt: addMinutes(now, 24 * 60).toISOString() });
  store.update('bookings', booking.id, { holdUntil: addMinutes(now, 24 * 60).toISOString() });
  store.log('payment', `Клиент сообщил об оплате USDT по брони ${booking.code}`, { paymentId: payment.id, bookingId: booking.id });
  store.flush();
  await notifyPaymentCheck(booking, store.get('payments', payment.id));
  return store.get('payments', payment.id);
}

export function cancelPayment(paymentId, reason = 'cancelled') {
  const payment = store.get('payments', paymentId);
  if (!payment || payment.status === 'paid') return payment;
  store.update('payments', payment.id, { status: 'cancelled', cancelledReason: reason });
  return store.get('payments', paymentId);
}

/* Опрос статуса QR-транзакций Optima. Правило банка: после оплаты статус нужно запросить в течение 12 секунд. */
export async function pollOptimaPending({ force = false } = {}) {
  if (!optima.isConfigured()) return { polled: 0 };
  const now = Date.now();
  const pending = store.filter('payments', (p) => p.method === 'elqr' && p.status === 'pending' && p.optima && p.optima.transactionId && new Date(p.expiresAt).getTime() + 120000 > now);
  let polled = 0;
  for (const p of pending) {
    const last = p.optima.lastPolledAt ? new Date(p.optima.lastPolledAt).getTime() : 0;
    if (!force && now - last < 3500) continue;
    polled += 1;
    try {
      const info = await optima.getTransactionInfo(p.optima.transactionId);
      store.update('payments', p.id, { optima: { ...p.optima, status: info.status, lastPolledAt: new Date().toISOString(), lastError: null, bankSum: info.sum, processedAt: info.processedAt } });
      if (info.status === 'PROCESSED') {
        await markPaid(p.id, { confirmedBy: 'optima', meta: { bankSum: info.sum, processedAt: info.processedAt } });
      } else if (info.status === 'ERROR') {
        store.update('payments', p.id, { status: 'error', errorMessage: 'Банк вернул статус ERROR. Создайте новый QR' });
        store.log('optima', `Транзакция ${p.optima.transactionId} получила статус ERROR`, { paymentId: p.id });
      }
    } catch (err) {
      const notFound = err.status === 404;
      store.update('payments', p.id, { optima: { ...p.optima, lastPolledAt: new Date().toISOString(), pollErrors: notFound ? p.optima.pollErrors : (p.optima.pollErrors || 0) + 1, lastError: notFound ? null : err.message } });
      if (!notFound) console.error('[optima] опрос статуса:', err.message);
    }
  }
  return { polled };
}

export async function refreshPayment(paymentId) {
  const p = store.get('payments', paymentId);
  if (!p) throw httpError(404, 'Платёж не найден');
  if (p.method === 'elqr' && p.status === 'pending') {
    try {
      const info = await optima.getTransactionInfo(p.optima.transactionId);
      store.update('payments', p.id, { optima: { ...p.optima, status: info.status, lastPolledAt: new Date().toISOString(), bankSum: info.sum, processedAt: info.processedAt } });
      if (info.status === 'PROCESSED') await markPaid(p.id, { confirmedBy: 'optima', meta: { bankSum: info.sum } });
      if (info.status === 'ERROR') store.update('payments', p.id, { status: 'error', errorMessage: 'Банк вернул статус ERROR' });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  return store.get('payments', paymentId);
}

/* Истечение неоплаченных платежей и броней-«холдов» */
export function expirePayments() {
  const now = Date.now();
  let expired = 0;
  for (const p of store.list('payments')) {
    if (p.status === 'pending' && new Date(p.expiresAt).getTime() < now) {
      store.update('payments', p.id, { status: 'expired' });
      expired += 1;
    }
  }
  for (const b of store.list('bookings')) {
    if (b.status !== 'hold') continue;
    const hasPending = paymentsForBooking(b.id).some((p) => PENDING.has(p.status) && new Date(p.expiresAt).getTime() > now);
    if (!hasPending && new Date(b.holdUntil || b.createdAt).getTime() < now) {
      store.update('bookings', b.id, { status: 'expired' });
      store.log('booking', `Бронь ${b.code} не оплачена вовремя и снята`, { bookingId: b.id });
    }
  }
  if (expired) store.flush();
  return expired;
}

/* ---------- Проверка входящих писем Binance ---------- */
const CREDIT_RE = /deposit|received|receive|credited|зачисл|получ|пополн|поступ|депозит|payment/i;
const DEBIT_RE = /withdraw|withdrawal|вывод|отправлен|you sent|sent to|списан/i;

export function extractUsdtAmounts(text) {
  const out = [];
  const re = /(\d[\d\s,.']*)\s*(?:USDT|USDⓈ|Tether)/gi;
  let m;
  while ((m = re.exec(text))) {
    let raw = m[1].replace(/[\s']/g, '');
    if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/,/g, '');
    else if (raw.includes(',')) {
      const parts = raw.split(',');
      raw = parts[parts.length - 1].length === 3 && parts.length > 1 && parts.every((p, i) => (i === 0 ? p.length <= 3 : p.length === 3)) ? raw.replace(/,/g, '') : raw.replace(',', '.');
    }
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) out.push(round2(v));
  }
  return [...new Set(out)];
}

export async function matchIncomingMail(messages) {
  const results = [];
  for (const msg of messages) {
    const haystack = `${msg.subject}\n${msg.text}`;
    const amounts = extractUsdtAmounts(haystack);
    const isDebit = DEBIT_RE.test(msg.subject) && !CREDIT_RE.test(msg.subject);
    const entry = { id: uuid(), at: new Date().toISOString(), uid: msg.uid, from: msg.from, subject: msg.subject, date: msg.date, amounts, matchedPaymentId: null, skipped: isDebit ? 'списание' : amounts.length ? null : 'нет суммы USDT' };
    if (!isDebit && amounts.length && store.settings.crypto.autoConfirmByEmail !== false) {
      const msgTime = new Date(msg.date || Date.now()).getTime();
      const candidates = store.filter('payments', (p) => p.method === 'usdt' && PENDING.has(p.status) && new Date(p.createdAt).getTime() - 15 * 60000 <= msgTime)
        .sort((a, b) => (a.status === 'awaiting' ? -1 : 1) - (b.status === 'awaiting' ? -1 : 1) || new Date(a.createdAt) - new Date(b.createdAt));
      const match = candidates.find((p) => amounts.some((a) => Math.abs(a - round2(p.amountUsdt)) < 0.005));
      if (match) {
        entry.matchedPaymentId = match.id;
        entry.bookingCode = match.bookingCode;
        try {
          await markPaid(match.id, { confirmedBy: 'email', meta: { mailUid: msg.uid, mailSubject: msg.subject, mailDate: msg.date, amounts } });
        } catch (err) {
          entry.error = err.message;
        }
      } else {
        entry.skipped = 'нет ожидающей оплаты с такой суммой';
      }
    }
    store.insert('mailLog', entry);
    results.push(entry);
  }
  if (store.data.mailLog.length > 1000) store.data.mailLog.splice(0, store.data.mailLog.length - 1000);
  if (results.length) store.flush();
  return results;
}

export async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 512, color: { dark: '#000000', light: '#ffffff' } });
}

/* Публичное представление платежа (без служебных полей) */
export async function publicPayment(p) {
  if (!p) return null;
  const view = {
    id: p.id, kind: p.kind, extensionDays: p.extensionDays, method: p.method, status: p.status,
    amountUsd: p.amountUsd, amountKgs: p.amountKgs, amountUsdt: p.amountUsdt,
    expiresAt: p.expiresAt, paidAt: p.paidAt, clientMarkedPaidAt: p.clientMarkedPaidAt || null, errorMessage: p.errorMessage || null, createdAt: p.createdAt,
  };
  if (p.method === 'elqr') {
    view.qrBase64 = p.qrBase64 || '';
    view.qrUrl = p.optima?.qrUrl || '';
    view.deepLinks = p.optima?.deepLinks || [];
  } else if (p.method === 'usdt') {
    view.network = p.crypto?.network;
    view.networkLabel = p.crypto?.networkLabel;
    view.address = p.crypto?.address;
    view.memo = p.crypto?.memo || '';
    view.binancePayId = p.crypto?.binancePayId || '';
    view.qrDataUrl = p.crypto?.address ? await qrDataUrl(p.crypto.address) : '';
  }
  return view;
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
