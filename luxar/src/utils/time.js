/* Работа со временем в часовом поясе компании (по умолчанию Asia/Bishkek). */

const partsCache = new Map();

function formatter(tz, opts) {
  const key = tz + JSON.stringify(opts);
  let f = partsCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...opts });
    partsCache.set(key, f);
  }
  return f;
}

/* Смещение зоны (в минутах) для конкретного момента времени */
export function tzOffsetMinutes(date, tz) {
  const f = formatter(tz, { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const map = {};
  for (const p of f.formatToParts(date)) map[p.type] = p.value;
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/* Локальные дата+время в зоне → UTC Date */
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/* UTC → компоненты в зоне */
export function toZoned(date, tz) {
  const f = formatter(tz, { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const map = {};
  for (const p of f.formatToParts(date)) map[p.type] = p.value;
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour, minute: +map.minute, weekday: map.weekday, date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function fmtDateTime(iso, tz, { year = false } = {}) {
  if (!iso) return '';
  const z = toZoned(new Date(iso), tz);
  const y = year ? ` ${z.year}` : '';
  return `${z.day} ${MONTHS_GEN[z.month - 1]}${y}, ${z.time}`;
}

export function fmtDate(iso, tz, { year = false } = {}) {
  if (!iso) return '';
  const z = toZoned(new Date(iso), tz);
  return `${z.day} ${MONTHS_GEN[z.month - 1]}${year ? ' ' + z.year : ''}`;
}

export function fmtTime(iso, tz) {
  if (!iso) return '';
  return toZoned(new Date(iso), tz).time;
}

export function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 86400000);
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

export function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

export function isoNow() {
  return new Date().toISOString();
}

/* Формат для Optima untilDateTime: локальное время без зоны */
export function localIsoNoZone(date, tz) {
  const z = toZoned(date, tz);
  const s = toZonedSeconds(date, tz);
  return `${z.date}T${z.time}:${s}`;
}

function toZonedSeconds(date, tz) {
  const f = formatter(tz, { second: '2-digit' });
  return f.format(date).padStart(2, '0');
}

export function declDays(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b > 1 && b < 5) return 'дня';
  if (b === 1) return 'день';
  return 'дней';
}
