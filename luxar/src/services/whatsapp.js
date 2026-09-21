import { store } from '../store.js';
import { uuid } from '../utils/ids.js';
import { normalizePhone } from '../utils/phone.js';

/*
 * WhatsApp через wappi.pro:
 *  POST https://wappi.pro/api/sync/message/send?profile_id={profileId}   заголовок Authorization: {token}
 *       body: { "recipient": "996555123456", "body": "текст" }
 *  GET  https://wappi.pro/api/sync/get/status?profile_id={profileId}
 */
const BASE = (process.env.WAPPI_BASE_URL || 'https://wappi.pro/api').replace(/\/+$/, '');

function cfg() {
  return store.settings.whatsapp;
}

export function waConfigured(w = cfg()) {
  return Boolean(w.enabled && w.profileId && w.token);
}

function log(entry) {
  const rec = { id: uuid(), at: new Date().toISOString(), channel: 'whatsapp', ...entry };
  store.insert('notifications', rec);
  if (store.data.notifications.length > 2000) store.data.notifications.splice(0, store.data.notifications.length - 2000);
  return rec;
}

async function call(path, { method = 'GET', body, creds } = {}) {
  const w = creds || cfg();
  const url = new URL(BASE + path);
  url.searchParams.set('profile_id', String(w.profileId || '').trim());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { method, headers: { Authorization: String(w.token || '').trim(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error((data && (data.detail || data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'wappi.pro не ответил вовремя' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

export async function waStatus(creds) {
  const data = await call('/sync/get/status', { creds });
  const authorized = Boolean(data && (data.authorized === true || data.app_status === 'active' || data.status === 'authorized'));
  const patch = { lastCheck: { ok: authorized, at: new Date().toISOString(), message: authorized ? `Профиль авторизован${data.phone ? ': ' + data.phone : ''}` : 'Профиль не авторизован в WhatsApp. Отсканируйте QR в кабинете wappi.pro' } };
  if (!creds) store.updateSettings('whatsapp', patch);
  return { ok: authorized, data, ...patch.lastCheck };
}

export async function waSend(phone, text, { bookingId = null, template = 'custom', creds } = {}) {
  const w = creds || cfg();
  const to = normalizePhone(phone);
  if (!creds && !waConfigured(w)) return { ok: false, error: 'WhatsApp не настроен' };
  if (!to) return { ok: false, error: 'Неверный номер' };
  try {
    const data = await call('/sync/message/send', { method: 'POST', body: { recipient: to, body: text }, creds: w });
    const ok = Boolean(data && (data.status === 'done' || data.message_id));
    log({ to, template, bookingId, status: ok ? 'sent' : 'failed', error: ok ? undefined : JSON.stringify(data).slice(0, 300), preview: text.slice(0, 160) });
    return { ok, data };
  } catch (err) {
    log({ to, template, bookingId, status: 'failed', error: err.message, preview: text.slice(0, 160) });
    return { ok: false, error: err.message };
  }
}
