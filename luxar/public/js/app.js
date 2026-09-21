import { get } from './api.js';
import { el, $, $$, installPress, installParallax, reveal, lazyImages, fmt, toast, wait, reducedMotion, svg } from './ui.js';

export const state = { config: null, cars: null, carsAt: 0, profile: loadProfile() };

function loadProfile() {
  try { return { name: '', phone: '', tokens: [], ...(JSON.parse(localStorage.getItem('luxar.profile') || '{}')) }; } catch { return { name: '', phone: '', tokens: [] }; }
}
export function saveProfile(patch) {
  Object.assign(state.profile, patch);
  try { localStorage.setItem('luxar.profile', JSON.stringify(state.profile)); } catch {}
}
export function rememberBooking(token) {
  if (!token) return;
  const tokens = [token, ...state.profile.tokens.filter((t) => t !== token)].slice(0, 30);
  saveProfile({ tokens });
}

export async function loadCars(force = false) {
  if (!force && state.cars && Date.now() - state.carsAt < 45000) return state.cars;
  state.cars = await get('/api/cars');
  state.carsAt = Date.now();
  return state.cars;
}

const routes = [
  { re: /^\/$/, tab: 'home', load: () => import('./views/home.js') },
  { re: /^\/car\/([^/]+)$/, load: () => import('./views/car.js') },
  { re: /^\/car\/([^/]+)\/book$/, load: () => import('./views/book.js') },
  { re: /^\/pay\/([^/]+)$/, load: () => import('./views/pay.js') },
  { re: /^\/done\/([^/]+)$/, load: () => import('./views/done.js') },
  { re: /^\/b\/([^/]+)$/, load: () => import('./views/booking.js') },
  { re: /^\/extend\/([^/]+)$/, load: () => import('./views/booking.js') },
  { re: /^\/schedule$/, tab: 'schedule', load: () => import('./views/schedule.js') },
  { re: /^\/service$/, tab: 'service', load: () => import('./views/service.js') },
  { re: /^\/profile$/, tab: 'profile', load: () => import('./views/profile.js') },
];

const TABS = [
  { id: 'home', path: '/', label: 'Главная', icon: 'home' },
  { id: 'schedule', path: '/schedule', label: 'График', icon: 'calendar' },
  { id: 'service', path: '/service', label: 'Сервис', icon: 'sparkle' },
  { id: 'profile', path: '/profile', label: 'Профиль', icon: 'user' },
];

let current = { el: null, unmount: null };
let renderId = 0;

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  render();
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = `<div class="ind"></div>` + TABS.map((t) => `<a class="tab" href="${t.path}" data-tab="${t.id}">${svg(t.icon)}<span>${t.label}</span></a>`).join('');
}

function updateTabbar(tab) {
  const bar = document.getElementById('tabbar');
  bar.classList.toggle('hidden', !tab);
  if (!tab) return;
  const idx = TABS.findIndex((t) => t.id === tab);
  $('.ind', bar).style.transform = `translateX(${idx * 100}%)`;
  $$('.tab', bar).forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

async function render() {
  const id = ++renderId;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = routes.find((r) => r.re.test(path)) || routes[0];
  const params = (path.match(route.re) || []).slice(1).map(decodeURIComponent);
  const app = document.getElementById('app');
  let mod;
  try { mod = await route.load(); } catch (err) { toast('Не удалось загрузить страницу', 'error'); return; }
  if (id !== renderId) return;
  if (current.unmount) { try { current.unmount(); } catch {} current.unmount = null; }
  let view;
  try {
    view = await mod.default({ params, query: new URLSearchParams(location.search), navigate, state });
  } catch (err) {
    view = el(`<div class="view"><div class="empty">${svg('info')}<div>${err.status === 404 ? 'Страница не найдена' : (err.message || 'Ошибка')}</div><a class="btn secondary sm mt" href="/">На главную</a></div></div>`);
  }
  if (id !== renderId) return;
  const swap = () => { app.replaceChildren(view); };
  if (document.startViewTransition && !reducedMotion() && current.el) {
    await document.startViewTransition(swap).finished.catch(() => {});
  } else {
    if (current.el && !reducedMotion()) { current.el.classList.add('leaving'); await wait(140); }
    swap();
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  updateTabbar(route.tab);
  reveal(view);
  lazyImages(view);
  current = { el: view, unmount: view.onUnmount || null };
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//')) return;
  e.preventDefault();
  if (href === location.pathname + location.search) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  navigate(href);
});
window.addEventListener('popstate', render);

(async function boot() {
  installPress();
  buildTabbar();
  try {
    state.config = await get('/api/config');
    fmt.tz = state.config.site.timezone || fmt.tz;
    fmt.symbol = state.config.site.currencySymbol || '$';
  } catch (err) {
    state.config = { company: {}, site: {}, rates: {}, payments: { elqr: false, usdt: false, networks: [] } };
    toast('Сервер недоступен. Обновите страницу', 'error', 5000);
  }
  await render();
  installParallax();
  // обновляем конфиг раз в 5 минут (курсы, способы оплаты)
  setInterval(async () => { try { state.config = await get('/api/config'); } catch {} }, 300000);
})();
