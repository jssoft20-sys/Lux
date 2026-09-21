import { store } from '../store.js';
import { uuid } from '../utils/ids.js';
import { normalizePhone } from '../utils/phone.js';

export function findClientByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return store.find('clients', (c) => c.phone === digits || c.whatsapp === digits);
}

/* Создаёт клиента или дополняет карточку данными из брони */
export function upsertClient({ name, phone, whatsapp, email, source = 'site', note }) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const wa = normalizePhone(whatsapp) || digits;
  let client = findClientByPhone(digits);
  const now = new Date().toISOString();
  if (!client) {
    client = store.insert('clients', {
      id: uuid(), name: String(name || '').trim(), phone: digits, whatsapp: wa, email: String(email || '').trim(), note: note || '',
      tags: [], blocked: false, source, bookingsCount: 0, totalSpentUsd: 0, lastBookingAt: null, createdAt: now, updatedAt: now,
    });
    store.log('client', `Новый клиент: ${client.name || client.phone}`, { clientId: client.id });
  } else {
    const patch = {};
    if (!client.name && name) patch.name = String(name).trim();
    if (!client.email && email) patch.email = String(email).trim();
    if (!client.whatsapp && wa) patch.whatsapp = wa;
    if (Object.keys(patch).length) store.update('clients', client.id, patch);
  }
  return client;
}

export function recomputeClientStats(clientId) {
  const client = store.get('clients', clientId);
  if (!client) return;
  const bookings = store.filter('bookings', (b) => b.clientId === clientId && ['confirmed', 'completed'].includes(b.status));
  const totalSpentUsd = bookings.reduce((s, b) => s + (Number(b.paidUsd) || 0), 0);
  const last = bookings.map((b) => b.createdAt).sort().pop() || null;
  store.update('clients', clientId, { bookingsCount: bookings.length, totalSpentUsd: Math.round(totalSpentUsd * 100) / 100, lastBookingAt: last });
}
