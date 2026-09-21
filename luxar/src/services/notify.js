import { store } from '../store.js';
import { config } from '../config.js';
import { waSend, waConfigured } from './whatsapp.js';
import { sendMail, smtpConfigured } from './mail.js';
import { fmtDateTime, fmtTime, declDays } from '../utils/time.js';
import { formatPhone } from '../utils/phone.js';
import { fmtMoney, fmtKgs, fmtUsdt } from '../utils/money.js';

/* Публичный адрес сайта для ссылок в сообщениях */
export function baseUrl() {
  const s = store.settings.site;
  const url = (s.baseUrl && s.baseUrl.trim()) || config.publicUrl || store.data.meta.lastBaseUrl || `http://localhost:${config.port}`;
  return url.replace(/\/+$/, '');
}

export function bookingLink(booking) {
  return `${baseUrl()}/b/${booking.token}`;
}

export function adminLink(path = '') {
  return `${baseUrl()}/admin${path}`;
}

function render(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

function methodLabel(payment) {
  if (!payment) return '';
  if (payment.method === 'elqr') return 'ELQR';
  if (payment.method === 'usdt') return `USDT ${payment.network || ''}`.trim();
  if (payment.method === 'cash') return 'наличные';
  return payment.method;
}

function amountLabel(payment, booking) {
  if (!payment) return fmtMoney(booking.totalUsd);
  if (payment.method === 'elqr') return `${fmtMoney(payment.amountUsd)} (${fmtKgs(payment.amountKgs)})`;
  if (payment.method === 'usdt') return `${fmtMoney(payment.amountUsd)} (${fmtUsdt(payment.amountUsdt)})`;
  return fmtMoney(payment.amountUsd);
}

export function bookingVars(booking, { payment = null, days = null, hours = null } = {}) {
  const tz = store.settings.site.timezone;
  const car = store.get('cars', booking.carId);
  return {
    code: booking.code,
    car: car ? car.name : 'Автомобиль',
    name: booking.name,
    phone: formatPhone(booking.phone),
    start: fmtDateTime(booking.startAt, tz),
    end: fmtDateTime(booking.endAt, tz),
    endTime: fmtTime(booking.endAt, tz),
    days: days ?? booking.days,
    daysWord: declDays(days ?? booking.days),
    pickup: booking.pickup === 'delivery' ? `Доставка: ${booking.address || ''}`.trim() : 'Самовывоз',
    total: amountLabel(payment, booking),
    amount: payment && payment.method === 'usdt' ? fmtUsdt(payment.amountUsdt) : payment ? fmtMoney(payment.amountUsd) : fmtMoney(booking.totalUsd),
    method: methodLabel(payment),
    link: bookingLink(booking),
    adminLink: adminLink('/payments'),
    hours: hours ?? store.settings.whatsapp.reminderHours,
    company: store.settings.company.name,
  };
}

async function toClient(booking, template, text, subject) {
  const w = store.settings.whatsapp;
  const results = {};
  if (w.notifyClient !== false && waConfigured()) results.whatsapp = await waSend(booking.whatsapp || booking.phone, text, { bookingId: booking.id, template });
  if (booking.email && smtpConfigured()) results.email = await sendMail({ to: booking.email, subject, text, template, bookingId: booking.id });
  return results;
}

async function toAdmin(booking, template, text, subject) {
  const w = store.settings.whatsapp;
  const m = store.settings.mail;
  const results = {};
  if (w.notifyAdmin !== false && w.adminPhone && waConfigured()) results.whatsapp = await waSend(w.adminPhone, text, { bookingId: booking ? booking.id : null, template });
  if (m.adminEmail && smtpConfigured()) results.email = await sendMail({ to: m.adminEmail, subject, text, template, bookingId: booking ? booking.id : null });
  return results;
}

export async function notifyBookingConfirmed(booking, payment) {
  const t = store.settings.whatsapp.templates;
  const vars = bookingVars(booking, { payment });
  try {
    await toClient(booking, 'bookingConfirmed', render(t.bookingConfirmed, vars), `Бронирование ${booking.code} подтверждено`);
    await toAdmin(booking, 'adminNewBooking', render(t.adminNewBooking, vars), `Новая бронь ${booking.code}: ${vars.car}`);
  } catch (err) {
    console.error('[notify] booking confirmed:', err.message);
  }
}

export async function notifyExtensionConfirmed(booking, payment, days) {
  const t = store.settings.whatsapp.templates;
  const vars = bookingVars(booking, { payment, days });
  try {
    await toClient(booking, 'extensionConfirmed', render(t.extensionConfirmed, vars), `Продление ${booking.code} подтверждено`);
    await toAdmin(booking, 'adminExtension', render(t.adminExtension, vars), `Продление ${booking.code}: ${vars.car}`);
  } catch (err) {
    console.error('[notify] extension confirmed:', err.message);
  }
}

export async function notifyPaymentCheck(booking, payment) {
  const t = store.settings.whatsapp.templates;
  const vars = bookingVars(booking, { payment });
  try {
    await toAdmin(booking, 'adminPaymentCheck', render(t.adminPaymentCheck, vars), `Проверьте оплату USDT по брони ${booking.code}`);
  } catch (err) {
    console.error('[notify] payment check:', err.message);
  }
}

/* Напоминание клиенту за N часов до окончания аренды со ссылкой на продление */
export async function sendReminder(booking) {
  const t = store.settings.whatsapp.templates;
  const vars = bookingVars(booking);
  const text = render(t.reminder, vars);
  const results = await toClient(booking, 'reminder', text, `Аренда ${vars.car} заканчивается ${vars.end}`);
  const okWa = results.whatsapp && results.whatsapp.ok;
  const okMail = results.email && results.email.ok;
  return { ok: Boolean(okWa || okMail), results, text };
}

export async function notifyEndingSoon(booking) {
  const t = store.settings.whatsapp.templates;
  const vars = bookingVars(booking);
  try {
    await toAdmin(booking, 'adminEndingSoon', render(t.adminEndingSoon, vars), `Скоро заканчивается аренда ${vars.car}`);
  } catch (err) {
    console.error('[notify] ending soon:', err.message);
  }
}

export function previewTemplate(name, booking) {
  const t = store.settings.whatsapp.templates;
  return render(t[name] || '', bookingVars(booking));
}
