import { icons } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function el(html) { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(ms = 8) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} }

/* ---------- toast ---------- */
export function toast(message, type = 'info', ms = 2800) {
  const root = document.getElementById('toasts');
  const t = el(`<div class="toast ${type}">${esc(message)}</div>`);
  root.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, ms);
  return t;
}

/* ---------- bottom sheet ---------- */
export function openSheet({ title = '', content, onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const backdrop = el('<div class="sheet-backdrop"></div>');
  const sheet = el(`<div class="sheet" role="dialog" aria-modal="true"><div class="handle"></div>${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sheet-body"></div></div>`);
  const body = $('.sheet-body', sheet);
  if (typeof content === 'string') body.innerHTML = content; else if (content) body.appendChild(content);
  root.append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    backdrop.classList.add('closing'); sheet.classList.add('closing');
    setTimeout(() => { backdrop.remove(); sheet.remove(); document.body.style.overflow = ''; if (onClose) onClose(); }, 300);
  };
  backdrop.addEventListener('click', close);
  // drag to close
  let startY = 0, dy = 0, dragging = false;
  sheet.addEventListener('pointerdown', (e) => { if (sheet.scrollTop > 0 && !e.target.closest('.handle')) return; startY = e.clientY; dragging = true; sheet.style.transition = 'none'; });
  sheet.addEventListener('pointermove', (e) => { if (!dragging) return; dy = Math.max(0, e.clientY - startY); if (dy > 4) { sheet.style.transform = `translateY(${dy}px)`; } });
  const end = () => { if (!dragging) return; dragging = false; sheet.style.transition = ''; if (dy > 90) close(); else sheet.style.transform = ''; dy = 0; };
  sheet.addEventListener('pointerup', end); sheet.addEventListener('pointercancel', end);
  return { close, sheet, body };
}

/* ---------- press feedback (global) ---------- */
export function installPress() {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-press]');
    if (!t) return;
    t.classList.add('pressed');
    const up = () => { t.classList.remove('pressed'); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }, { passive: true });
}

/* ---------- reveal on scroll ---------- */
let io;
export function reveal(root) {
  const items = $$('.reveal', root);
  if (!items.length) return;
  if (reducedMotion()) { items.forEach((i) => i.classList.add('is-in')); return; }
  io = io || new IntersectionObserver((entries) => { for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  items.forEach((i, idx) => { if (!i.style.getPropertyValue('--d')) i.style.setProperty('--d', `${(idx % 5) * 70}ms`); io.observe(i); });
}

/* ---------- image parallax on scroll ---------- */
export function installParallax() {
  if (reducedMotion()) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const img of $$('.car-card .bg img')) {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const p = (r.top + r.height / 2 - vh / 2) / vh; // -0.5..0.5
      img.style.setProperty('--py', `${(-p * 26).toFixed(1)}px`);
    }
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

export function lazyImages(root) {
  for (const img of $$('img[data-src]', root)) {
    const src = img.dataset.src; delete img.dataset.src;
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    img.src = src;
    if (img.complete) img.classList.add('loaded');
  }
}

/* ---------- formatting ---------- */
export const fmt = {
  tz: 'Asia/Bishkek',
  symbol: '$',
  money(n, digits) { const v = Number(n) || 0; const s = v.toLocaleString('ru-RU', { minimumFractionDigits: digits ?? (Number.isInteger(v) ? 0 : 2), maximumFractionDigits: 2 }); return fmt.symbol === '$' ? `$${s}` : `${s} ${fmt.symbol}`; },
  kgs(n) { return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} сом`; },
  usdt(n) { return `${(Number(n) || 0).toFixed(2)} USDT`; },
  parts(iso) {
    const d = new Date(iso);
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: fmt.tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(d)) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour.padStart(2, '0'), mm: p.minute.padStart(2, '0'), wd: p.weekday, date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, time: `${p.hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}` };
  },
  dt(iso, { year = false } = {}) { if (!iso) return ''; const p = fmt.parts(iso); return `${p.d} ${MONTHS[p.m - 1]}${year ? ' ' + p.y : ''}, ${p.hh}:${p.mm}`; },
  d(iso, { year = false } = {}) { if (!iso) return ''; const p = fmt.parts(iso); return `${p.d} ${MONTHS[p.m - 1]}${year ? ' ' + p.y : ''}`; },
  t(iso) { if (!iso) return ''; const p = fmt.parts(iso); return `${p.hh}:${p.mm}`; },
  days(n) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? 'дней' : b > 1 && b < 5 ? 'дня' : b === 1 ? 'день' : 'дней'; },
  hours(n) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? 'часов' : b > 1 && b < 5 ? 'часа' : b === 1 ? 'час' : 'часов'; },
  countdown(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; },
  left(iso) { const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'завершена'; const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); if (h >= 48) { const d = Math.floor(h / 24); return `${d} ${fmt.days(d)}`; } return h ? `${h} ч ${m} мин` : `${m} мин`; },
  phone(digits) { const d = String(digits || '').replace(/\D/g, ''); if (d.startsWith('996') && d.length === 12) return `+996 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`; if (d.startsWith('7') && d.length === 11) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`; return d ? '+' + d : ''; },
};
export const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function normalizeDigits(input) {
  let d = String(input || '').replace(/\D+/g, '');
  if (d.length === 10 && d.startsWith('0')) d = '996' + d.slice(1);
  else if (d.length === 9 && /^[2-9]/.test(d)) d = '996' + d;
  return d;
}

/* смещение зоны и перевод локального времени в UTC (та же логика, что на сервере) */
function tzOffsetMinutes(date, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(date)) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
export function zonedToUtc(dateStr, timeStr, tz = fmt.tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch { return false; }
}

export function bindCopy(root) {
  for (const btn of $$('[data-copy]', root)) {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy);
      haptic();
      if (ok) { const t = btn.textContent; btn.textContent = 'Готово'; btn.classList.add('done'); setTimeout(() => { btn.textContent = t; btn.classList.remove('done'); }, 1600); } else toast('Не удалось скопировать', 'error');
    });
  }
}

export function tween(node, from, to, format, ms = 480) {
  if (reducedMotion() || from === to) { node.textContent = format(to); return; }
  const start = performance.now();
  const step = (now) => { const p = Math.min(1, (now - start) / ms); const e = 1 - Math.pow(1 - p, 3); node.textContent = format(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

export function countdownRing(node, expiresAt, totalMs, onExpire) {
  const circ = 2 * Math.PI * 11;
  const fg = $('.fgc', node); const label = $('b', node);
  fg.style.strokeDasharray = circ;
  const tick = () => {
    const left = new Date(expiresAt) - Date.now();
    const frac = Math.max(0, Math.min(1, left / totalMs));
    fg.style.strokeDashoffset = circ * (1 - frac);
    label.textContent = fmt.countdown(left);
    if (left <= 0) { clearInterval(timer); if (onExpire) onExpire(); }
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

export const svg = (name) => icons[name] || '';
export function phoneInput(input) {
  input.addEventListener('input', () => {
    const digits = normalizeDigits(input.value);
    input.dataset.digits = digits;
    if (digits.startsWith('996')) input.value = fmt.phone(digits.slice(0, 12));
  });
  input.addEventListener('blur', () => { const d = normalizeDigits(input.value); if (d) input.value = fmt.phone(d); input.dataset.digits = d; });
}
