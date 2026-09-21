import { store } from '../store.js';
import { pollOptimaPending, expirePayments, matchIncomingMail } from './payments.js';
import { fetchNewMessages, imapConfigured } from './mail.js';
import { sendReminder, notifyEndingSoon } from './notify.js';
import { hoursBetween } from '../utils/time.js';

/*
 * Фоновые задачи:
 *  - каждые 4 с: опрос статусов QR Optima (только пока есть ожидающие платежи);
 *  - каждые 30 с: истечение неоплаченных броней, напоминания за N часов до конца аренды, завершение старых броней;
 *  - каждые mail.pollSeconds: проверка почты на уведомления Binance;
 *  - раз в час: резервная копия базы (одна на день).
 */

const running = { optima: false, tick: false, mail: false };

export async function runReminders() {
  const w = store.settings.whatsapp;
  const hours = Number(w.reminderHours) || 3;
  const now = new Date();
  let sent = 0;
  for (const b of store.filter('bookings', (x) => x.status === 'confirmed')) {
    const left = hoursBetween(now, b.endAt);
    if (left <= 0 || left > hours) continue;
    if (!b.reminderSentAt && (b.reminderAttempts || 0) < 5) {
      const res = await sendReminder(b);
      if (res.ok) {
        store.update('bookings', b.id, { reminderSentAt: now.toISOString() });
        store.log('reminder', `Напоминание о продлении отправлено по брони ${b.code}`, { bookingId: b.id });
        sent += 1;
      } else {
        const attempts = (b.reminderAttempts || 0) + 1;
        store.update('bookings', b.id, { reminderAttempts: attempts, reminderLastError: JSON.stringify(res.results).slice(0, 300) });
        if (attempts >= 5) store.log('reminder', `Не удалось отправить напоминание по брони ${b.code}`, { bookingId: b.id });
      }
    }
    if (!b.adminEndingNotifiedAt) {
      store.update('bookings', b.id, { adminEndingNotifiedAt: now.toISOString() });
      await notifyEndingSoon(b);
    }
  }
  return sent;
}

export function completeFinished() {
  const cutoff = Date.now() - 24 * 3600000;
  for (const b of store.filter('bookings', (x) => x.status === 'confirmed' && new Date(x.endAt).getTime() < cutoff)) {
    store.update('bookings', b.id, { status: 'completed', completedAt: new Date().toISOString(), completedBy: 'auto' });
  }
}

export async function pollMailNow() {
  if (!imapConfigured()) return { ok: false, error: 'IMAP не настроен', results: [] };
  if (running.mail) return { ok: false, error: 'Проверка уже идёт', results: [] };
  running.mail = true;
  try {
    const messages = await fetchNewMessages();
    const results = await matchIncomingMail(messages);
    return { ok: true, messages: messages.length, results };
  } catch (err) {
    store.updateSettings('mail', { lastCheck: { ok: false, at: new Date().toISOString(), message: err.message } });
    return { ok: false, error: err.message, results: [] };
  } finally {
    running.mail = false;
  }
}

export function startScheduler() {
  setInterval(async () => {
    if (running.optima) return;
    running.optima = true;
    try { await pollOptimaPending(); } catch (err) { console.error('[scheduler] optima:', err.message); } finally { running.optima = false; }
  }, 4000);

  setInterval(async () => {
    if (running.tick) return;
    running.tick = true;
    try {
      expirePayments();
      completeFinished();
      await runReminders();
    } catch (err) {
      console.error('[scheduler] tick:', err.message);
    } finally {
      running.tick = false;
    }
  }, 30000);

  setInterval(async () => {
    const m = store.settings.mail;
    if (!imapConfigured(m)) return;
    const every = Math.max(20, Number(m.pollSeconds) || 60) * 1000;
    const last = m.lastPollAt ? new Date(m.lastPollAt).getTime() : 0;
    if (Date.now() - last < every) return;
    const res = await pollMailNow();
    if (!res.ok && res.error) console.error('[scheduler] mail:', res.error);
  }, 10000);

  setInterval(() => {
    try { store.backup(); } catch (err) { console.error('[scheduler] backup:', err.message); }
  }, 3600000);

  // первый прогон сразу после старта
  setTimeout(() => { expirePayments(); runReminders().catch(() => {}); }, 3000);
}
