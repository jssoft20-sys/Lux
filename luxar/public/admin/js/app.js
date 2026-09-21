import { get, post } from './api.js';
import { el, $, $$, installPress, fmt, toast, reveal, lazyImages, svg, wait, reducedMotion } from '/js/ui.js';

export const state = { me: null, settings: null, cars: null };

const NAV = [
  { id: 'dashboard', path: '/admin', label: 'Обзор', icon: 'home' },
  { id: 'bookings', path: '/admin/bookings', label: 'Брони', icon: 'calendar' },
  { id: 'cars', path: '/admin/cars', label: 'Автопарк', icon: 'car' },
  { id: 'clients', path: '/admin/clients', label: 'Клиенты', icon: 'user' },
  { id: 'payments', path: '/admin/payments', label: 'Платежи', icon: 'qr' },
  { id: 'analytics', path: '/admin/analytics', label: 'Аналитика', icon: 'gauge' },
  { id: 'settings', path: '/admin/settings', label: 'Настройки', icon: 'key' },
];
const routes = [
  { re: /^\/admin\/?$/, id: 'dashboard', load: () => import('./views/dashboard.js') },
  { re: /^\/admin\/bookings(?:\/([^/]+))?$/, id: 'bookings', load: () => import('./views/bookings.js') },
  { re: /^\/admin\/cars(?:\/([^/]+))?$/, id: 'cars', load: () => import('./views/cars.js') },
  { re: /^\/admin\/clients(?:\/([^/]+))?$/, id: 'clients', load: () => import('./views/clients.js') },
  { re: /^\/admin\/payments$/, id: 'payments', load: () => import('./views/payments.js') },
  { re: /^\/admin\/analytics$/, id: 'analytics', load: () => import('./views/analytics.js') },
  { re: /^\/admin\/settings(?:\/([^/]+))?$/, id: 'settings', load: () => import('./views/settings.js') },
];

let current = null; let renderId = 0;
export function navigate(path, { replace = false } = {}) { history[replace ? 'replaceState' : 'pushState']({}, '', path); render(); }

export async function loadCars(force = false) {
  if (!force && state.cars) return state.cars;
  state.cars = await get('/api/admin/cars');
  return state.cars;
}

function shell(id, viewEl) {
  const nav = (cls) => NAV.map((n) => `<a class="${cls} ${n.id === id ? 'active' : ''}" href="${n.path}">${svg(n.icon)}<span>${n.label}</span></a>`).join('');
  const root = el(`<div class="layout">
    <aside class="sidebar"><div class="brand"><img src="/assets/logo.svg" alt="Luxar"></div>${nav('nav')}<div class="foot">${state.me ? state.me.login : ''} · <a href="#" id="logout" class="inline-link">Выйти</a></div></aside>
    <main class="main"></main>
    <nav class="nav-mobile">${nav('')}</nav>
  </div>`);
  root.querySelector('main').appendChild(viewEl);
  root.querySelector('#logout').addEventListener('click', async (e) => { e.preventDefault(); await post('/api/admin/logout'); state.me = null; navigate('/admin', { replace: true }); });
  return root;
}

async function render() {
  const id = ++renderId;
  const app = document.getElementById('app');
  const path = location.pathname.replace(/\/+$/, '') || '/admin';
  if (!state.me) {
    try { state.me = await get('/api/admin/me'); } catch { state.me = null; }
    if (id !== renderId) return;
    if (!state.me) {
      const mod = await import('./views/login.js');
      const v = await mod.default({ navigate, state });
      app.replaceChildren(v);
      return;
    }
  }
  const route = routes.find((r) => r.re.test(path)) || routes[0];
  const params = (path.match(route.re) || []).slice(1).map((x) => (x ? decodeURIComponent(x) : x));
  let mod;
  try { mod = await route.load(); } catch (err) { toast('Не удалось загрузить раздел', 'error'); return; }
  if (current && current.onUnmount) { try { current.onUnmount(); } catch {} }
  let view;
  try { view = await mod.default({ params, query: new URLSearchParams(location.search), navigate, state }); }
  catch (err) { view = el(`<div class="view"><div class="empty">${svg('info')}<div>${err.message || 'Ошибка'}</div></div></div>`); }
  if (id !== renderId) return;
  const layout = shell(route.id, view);
  if (document.startViewTransition && !reducedMotion() && current) await document.startViewTransition(() => app.replaceChildren(layout)).finished.catch(() => {});
  else app.replaceChildren(layout);
  window.scrollTo({ top: 0, behavior: 'instant' });
  reveal(view); lazyImages(view);
  current = view;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/admin')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', render);
window.addEventListener('admin:unauthorized', () => { if (state.me) { state.me = null; toast('Сессия завершена, войдите снова', 'error'); render(); } });

(async function boot() {
  installPress();
  try { const cfg = await get('/api/config'); fmt.tz = cfg.site.timezone || fmt.tz; fmt.symbol = cfg.site.currencySymbol || '$'; state.config = cfg; } catch {}
  await render();
})();

/* helpers shared by views */
export const STATUS = { hold: ['Ожидает оплаты', 'warn'], upcoming: ['Предстоит', 'gold'], active: ['Активна', 'ok'], finished: ['Не закрыта', 'warn'], confirmed: ['Подтверждена', 'ok'], completed: ['Завершена', ''], cancelled: ['Отменена', 'bad'], expired: ['Истекла', ''] };
export const PAY_STATUS = { pending: ['Ожидает', 'gold'], awaiting: ['Проверить', 'warn'], paid: ['Оплачен', 'ok'], expired: ['Истёк', ''], cancelled: ['Отменён', ''], error: ['Ошибка', 'bad'] };
export const METHOD = { elqr: 'ELQR', usdt: 'USDT', cash: 'Наличные', transfer: 'Перевод', card: 'Карта', other: 'Другое' };
export function tag(map, key) { const [l, c] = map[key] || [key, '']; return `<span class="tag ${c}">${l}</span>`; }
export function stat(map, key) { const [l, c] = map[key] || [key, '']; return `<span class="status ${c}"><i></i>${l}</span>`; }
export function waLink(phone, text) { return `https://wa.me/${String(phone || '').replace(/\D/g, '')}${text ? '?text=' + encodeURIComponent(text) : ''}`; }
export function confirmSheet(title, text, okLabel = 'Подтвердить', danger = false) {
  return new Promise((resolve) => {
    import('/js/ui.js').then(({ openSheet, el }) => {
      const c = el(`<div><p class="muted" style="margin:0 0 16px">${text}</p><div class="btn-row"><button class="btn secondary" id="no">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" id="yes">${okLabel}</button></div></div>`);
      const sh = openSheet({ title, content: c, onClose: () => resolve(false) });
      c.querySelector('#no').addEventListener('click', () => sh.close());
      c.querySelector('#yes').addEventListener('click', () => { resolve(true); sh.close(); });
    });
  });
}
