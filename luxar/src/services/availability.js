import { store } from '../store.js';

/* Статусы броней, которые занимают автомобиль */
export const BLOCKING = new Set(['hold', 'confirmed']);

export function blockingBookings(carId, excludeId = null) {
  return store.filter('bookings', (b) => b.carId === carId && BLOCKING.has(b.status) && b.id !== excludeId);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

export function isAvailable(carId, start, end, excludeId = null) {
  return !blockingBookings(carId, excludeId).some((b) => overlaps(start, end, b.startAt, b.endAt));
}

/* Текущее состояние машины: свободна / занята до / забронирована с */
export function carOccupancy(carId, now = new Date()) {
  const list = blockingBookings(carId).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const current = list.find((b) => new Date(b.startAt) <= now && new Date(b.endAt) > now) || null;
  const next = list.find((b) => new Date(b.startAt) > now) || null;
  let state = 'free';
  if (current) state = current.status === 'hold' ? 'reserved' : 'busy';
  return {
    state,
    busyUntil: current ? current.endAt : null,
    currentBookingId: current ? current.id : null,
    nextStart: next ? next.startAt : null,
    nextEnd: next ? next.endAt : null,
  };
}

/* Занятые интервалы за период (без данных клиентов) */
export function busyRanges(carId, from, to) {
  return blockingBookings(carId)
    .filter((b) => overlaps(from, to, b.startAt, b.endAt))
    .map((b) => ({ start: b.startAt, end: b.endAt, status: b.status }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/* На сколько дней можно продлить бронь, не задев следующую */
export function maxExtensionDays(booking, hardMax = 60) {
  const next = blockingBookings(booking.carId, booking.id)
    .filter((b) => new Date(b.startAt) >= new Date(booking.endAt) - 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
  if (!next) return hardMax;
  const gapDays = Math.floor((new Date(next.startAt) - new Date(booking.endAt)) / 86400000);
  return Math.max(0, Math.min(hardMax, gapDays));
}

/* Статус брони для отображения */
export function derivedStatus(booking, now = new Date()) {
  if (booking.status !== 'confirmed') return booking.status;
  if (now < new Date(booking.startAt)) return 'upcoming';
  if (now < new Date(booking.endAt)) return 'active';
  return 'finished';
}
