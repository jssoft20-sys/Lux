import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { store } from '../store.js';
import { MAIL_PRESETS } from '../defaults.js';
import { uuid } from '../utils/ids.js';

/*
 * Почта используется для двух задач:
 *  1) SMTP — отправка писем клиенту и администратору;
 *  2) IMAP — чтение входящих уведомлений Binance о поступлении USDT и автоматическое подтверждение оплаты.
 * Пресеты: Gmail, Яндекс, Timeweb, Mail.ru, свой сервер.
 */

function cfg() {
  return store.settings.mail;
}

export function presetHosts(preset) {
  return MAIL_PRESETS[preset] || MAIL_PRESETS.custom;
}

export function smtpConfigured(m = cfg()) {
  return Boolean(m.enabled && m.email && m.password && m.smtpHost);
}

export function imapConfigured(m = cfg()) {
  return Boolean(m.enabled && m.email && m.password && m.imapHost);
}

function transport(m = cfg()) {
  const port = Number(m.smtpPort) || 465;
  return nodemailer.createTransport({
    host: m.smtpHost,
    port,
    secure: m.smtpSecure !== false && port === 465,
    requireTLS: port !== 465,
    auth: { user: m.email, pass: m.password },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
}

function logNotification(entry) {
  const rec = { id: uuid(), at: new Date().toISOString(), ...entry };
  store.insert('notifications', rec);
  if (store.data.notifications.length > 2000) store.data.notifications.splice(0, store.data.notifications.length - 2000);
  return rec;
}

export async function sendMail({ to, subject, text, html, template = 'custom', bookingId = null }) {
  const m = cfg();
  if (!smtpConfigured(m)) return { ok: false, error: 'SMTP не настроен' };
  if (!to) return { ok: false, error: 'Не указан получатель' };
  try {
    const info = await transport(m).sendMail({ from: `"${(m.fromName || 'Luxar Autorent').replace(/"/g, '')}" <${m.email}>`, to, subject, text, html: html || textToHtml(text) });
    logNotification({ channel: 'email', to, template, bookingId, status: 'sent', subject, messageId: info.messageId });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    logNotification({ channel: 'email', to, template, bookingId, status: 'failed', subject, error: err.message });
    return { ok: false, error: err.message };
  }
}

function textToHtml(text) {
  const esc = String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#FD4A08">$1</a>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;white-space:pre-wrap">${linked}</div>`;
}

export async function testSmtp(overrides) {
  const m = { ...cfg(), ...(overrides || {}), enabled: true };
  if (!m.email || !m.password || !m.smtpHost) throw new Error('Заполните почту, пароль и SMTP-сервер');
  const t = transport(m);
  await t.verify();
  const to = m.adminEmail || m.email;
  await t.sendMail({ from: `"${(m.fromName || 'Luxar Autorent').replace(/"/g, '')}" <${m.email}>`, to, subject: 'Luxar Autorent — проверка почты', text: 'SMTP настроен верно. Это тестовое письмо от Luxar Autorent.' });
  return { ok: true, message: `Письмо отправлено на ${to}` };
}

function imapClient(m) {
  return new ImapFlow({
    host: m.imapHost,
    port: Number(m.imapPort) || 993,
    secure: m.imapSecure !== false,
    auth: { user: m.email, pass: m.password },
    logger: false,
    socketTimeout: 60000,
    greetingTimeout: 20000,
    connectionTimeout: 20000,
  });
}

export async function testImap(overrides) {
  const m = { ...cfg(), ...(overrides || {}), enabled: true };
  if (!m.email || !m.password || !m.imapHost) throw new Error('Заполните почту, пароль и IMAP-сервер');
  const client = imapClient(m);
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(m.folder || 'INBOX', { readOnly: true });
    const since = new Date(Date.now() - 7 * 86400000);
    let binance = 0;
    const filter = String(m.senderFilter || '').toLowerCase();
    for await (const msg of client.fetch({ since }, { envelope: true, uid: true }, { uid: true })) {
      const from = (msg.envelope?.from || []).map((f) => `${f.name || ''} ${f.address || ''}`).join(' ').toLowerCase();
      if (!filter || from.includes(filter)) binance += 1;
    }
    return { ok: true, message: `Папка ${mailbox.path}: писем ${mailbox.exists}, за 7 дней от «${m.senderFilter || 'любого отправителя'}»: ${binance}` };
  } finally {
    await client.logout().catch(() => {});
  }
}

/*
 * Забирает новые письма (после lastUid). Возвращает только письма, подходящие под фильтр отправителя.
 * При первом запуске просматривает письма за последние 3 часа.
 */
export async function fetchNewMessages({ maxMessages = 50 } = {}) {
  const m = cfg();
  if (!imapConfigured(m)) return [];
  const client = imapClient(m);
  await client.connect();
  const out = [];
  try {
    const mailbox = await client.mailboxOpen(m.folder || 'INBOX', { readOnly: true });
    const filter = String(m.senderFilter || '').toLowerCase();
    let lastUid = Number(m.lastUid) || 0;
    let uids = [];
    if (!lastUid) {
      const since = new Date(Date.now() - 3 * 3600000);
      uids = (await client.search({ since }, { uid: true })) || [];
      lastUid = Math.max(0, (mailbox.uidNext || 1) - 1);
    } else if ((mailbox.uidNext || 1) - 1 > lastUid) {
      uids = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [];
      uids = uids.filter((u) => u > lastUid);
    }
    uids.sort((a, b) => a - b);
    if (uids.length > maxMessages) uids = uids.slice(-maxMessages);
    let maxUid = lastUid;
    if (uids.length) {
      const candidates = [];
      for await (const msg of client.fetch(uids, { envelope: true, uid: true, internalDate: true }, { uid: true })) {
        maxUid = Math.max(maxUid, msg.uid);
        const fromList = msg.envelope?.from || [];
        const from = fromList.map((f) => f.address || '').join(', ');
        const fromFull = fromList.map((f) => `${f.name || ''} ${f.address || ''}`).join(' ').toLowerCase();
        if (filter && !fromFull.includes(filter)) continue;
        candidates.push({ uid: msg.uid, from, subject: msg.envelope?.subject || '', date: (msg.envelope?.date || msg.internalDate || new Date()).toISOString?.() || new Date().toISOString() });
      }
      for (const c of candidates) {
        try {
          const full = await client.fetchOne(String(c.uid), { source: true }, { uid: true });
          const parsed = await simpleParser(full.source);
          const text = parsed.text || htmlToText(parsed.html || '') || '';
          out.push({ ...c, subject: parsed.subject || c.subject, text: text.slice(0, 20000), date: parsed.date ? parsed.date.toISOString() : c.date });
        } catch (err) {
          out.push({ ...c, text: '', error: err.message });
        }
      }
    }
    store.updateSettings('mail', { lastUid: maxUid, lastPollAt: new Date().toISOString(), lastCheck: { ok: true, at: new Date().toISOString(), message: `Проверено. Новых писем: ${uids.length}` } });
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
