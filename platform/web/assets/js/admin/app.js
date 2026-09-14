/* Оболочка панели управления: вход, меню, маршруты и один поток событий на всё.

   Раздел сам решает, что рисовать, — этот файл отвечает за то, где он живёт:
   боковое меню на ноутбуке, нижняя навигация на телефоне, общий поток SSE,
   кэш настроек (его спрашивают калькулятор тарифа и карточка курьера) и вопрос
   «уходим с несохранённым?» на каждом переходе.
*/

import { api, ApiError } from '../core/api.js';
import { setLang, getLang, applyTo, onLangChange } from '../core/i18n.js';
import { createRouter } from '../core/router.js';
import { el, toast, sheet, haptic } from '../core/ui.js';
import { setTimeZone } from '../core/fmt.js';

import { t, guardLeave, errText } from './forms.js';
import {
  renderOverview, renderLive, renderOrders, renderOrder,
  renderCouriers, renderCourier, renderClients, renderVerify,
  renderTariffs, renderExtras, renderSettings,
} from './pages.js';

/* ─────────────────────────────────────────────────────── иконки меню */

const ICONS = {
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 5.9v5.2c0 4.3 2.9 8.3 7 9.5 4.1-1.2 7-5.2 7-9.5V5.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9.2 11.9 2 2 3.6-3.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z" fill="currentColor"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c-3.2 0-5.8 2.5-5.8 5.6 0 4.2 5.8 12.8 5.8 12.8s5.8-8.6 5.8-12.8c0-3.1-2.6-5.6-5.8-5.6zm0 7.9a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6z" fill="currentColor"/></svg>',
  orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v15l-3-2-2 2-2-2-2 2-2-2-3 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 9h7M8.5 13h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-4.2L5.7 7.6A2 2 0 0 1 7.6 6.3h8.8a2 2 0 0 1 1.9 1.3L20 11.8V16a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1v-.8H7.4v.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6" fill="currentColor"/><path d="M4.6 20c.7-3.7 3.7-5.6 7.4-5.6s6.7 1.9 7.4 5.6z" fill="currentColor"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5V4.5h7l9 9-7 7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18" cy="12" r="1.8" fill="currentColor"/></svg>',
};

/* ─────────────────────────────────────────────────────── разделы */

const SECTIONS = [
  { path: '/overview', title: 'admin.nav_overview', icon: 'grid', dock: true },
  { path: '/map', title: 'admin.nav_map', icon: 'map', dock: true },
  { path: '/orders', title: 'admin.nav_orders', icon: 'orders', dock: true },
  { path: '/couriers', title: 'admin.nav_couriers', icon: 'car', dock: true },
  { path: '/verify', title: 'adm.vf_title', icon: 'shield' },
  { path: '/clients', title: 'admin.nav_clients', icon: 'user' },
  { path: '/tariffs', title: 'admin.nav_tariffs', icon: 'tag' },
  { path: '/extras', title: 'admin.nav_extras', icon: 'plus' },
  { path: '/settings', title: 'admin.nav_settings', icon: 'gear' },
];

const THEME_KEY = 'sg_theme';

/* ─────────────────────────────────────────────────────── состояние */

const state = {
  user: null,
  config: null,
  settings: {},
  connected: false,
};

const nav = document.getElementById('nav');
const dock = document.getElementById('dock');
const top = document.getElementById('top');
const main = document.getElementById('main');
const sideFoot = document.getElementById('side-foot');
const loginForm = document.getElementById('form-login');
const loginError = document.getElementById('login-err');

let router = null;
let cleanup = null;
let source = null;
let section = '/overview';
let booted = false;

/* ─────────────────────────────────────────────────────── тема */

function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch (e) { /* хранилище закрыто */ }
  return 'dark';
}

function applyTheme(next) {
  const value = next === 'light' || next === 'auto' ? next : 'dark';
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* переживём */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mapTheme() === 'light' ? '#F4F4F6' : '#0E0E10');
  return value;
}

/** Карте нужен простой ответ: светлая тема сейчас или тёмная. */
function mapTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light') return 'light';
  if (set === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light' : 'dark';
}

/* ─────────────────────────────────────────────────────── поток событий */

const liveSubs = new Set();

function onLive(fn) {
  if (typeof fn !== 'function') return () => {};
  liveSubs.add(fn);
  return () => liveSubs.delete(fn);
}

function emitLive(name, data) {
  for (const fn of Array.from(liveSubs)) {
    try {
      fn(name, data);
    } catch (e) {
      console.error('[admin] обработчик события «' + name + '» упал', e);
    }
  }
}

function setConnected(on) {
  if (state.connected === on) return;
  state.connected = on;
  paintTop();
}

function connect() {
  if (source) source.close();
  source = api.stream('/admin/stream', {
    events: ['snapshot', 'search_failed'],
    onOpen: () => setConnected(true),
    onError: () => setConnected(false),
    onEvent(name, data) {
      if (name === 'ping') { setConnected(true); return; }
      if (name === 'settings') loadSettings();
      // Заказ остался без машины — это то, ради чего оператор и сидит в панели.
      if (name === 'search_failed' && data) {
        toast(t('err.no_couriers') + ' · ' + (data.public_id || ''), { type: 'warn', ms: 6000 });
      }
      emitLive(name, data);
    },
  });
}

/* ─────────────────────────────────────────────────────── настройки */

async function loadSettings() {
  try {
    const data = await api.get('/admin/settings');
    state.settings = data.values || {};
    const tz = state.settings['service.tz'];
    if (tz) setTimeZone(tz);
  } catch (e) {
    if (!(e instanceof ApiError && e.isAuth)) {
      console.warn('[admin] настройки не прочитались', e);
    }
  }
}

function setting(key, fallback) {
  const v = state.settings[key];
  return v === undefined || v === null || v === '' ? fallback : v;
}

/* ─────────────────────────────────────────────────────── оболочка */

function paintNav() {
  nav.replaceChildren(...SECTIONS.map((item) => el('button', {
    className: 'navi' + (item.path === section ? ' is-on' : ''),
    type: 'button',
    'aria-current': item.path === section ? 'page' : null,
    onClick: () => go(item.path),
  }, el('span', { className: 'navi__ico', html: ICONS[item.icon] }),
    el('span', { className: 'navi__txt' }, t(item.title)))));
}

function paintDock() {
  const items = SECTIONS.filter((s) => s.dock);
  dock.replaceChildren(...items.map((item) => el('button', {
    className: 'dock__i' + (item.path === section ? ' is-on' : ''),
    type: 'button',
    'aria-current': item.path === section ? 'page' : null,
    onClick: () => { haptic(); go(item.path); },
  }, el('span', { html: ICONS[item.icon] }), t(item.title))),
  el('button', {
    className: 'dock__i' + (items.every((s) => s.path !== section) ? ' is-on' : ''),
    type: 'button',
    onClick: () => { haptic(); moreSheet(); },
  }, el('span', { html: ICONS.more }), t('adm.more')));
}

/* Остальные разделы на телефоне — в шторке: в нижнюю полосу влезает четыре. */
function moreSheet() {
  const rest = SECTIONS.filter((s) => !s.dock);
  const list = el('div', { className: 'list' });
  const panel = sheet({ title: t('adm.sections'), content: list });
  for (const item of rest) {
    const row = el('div', {
      className: 'list__row list__row--tap' + (item.path === section ? ' is-on' : ''),
      role: 'link',
      tabIndex: 0,
      onClick: () => { panel.close(); go(item.path); },
    }, el('span', { className: 'navi__ico', html: ICONS[item.icon] }),
      el('span', { className: 'grow' }, t(item.title)));
    list.appendChild(row);
  }
  list.appendChild(el('div', { className: 'pad' }, settingsBar(() => panel.close())));
}

function paintTop() {
  const item = SECTIONS.find((s) => s.path === section) || SECTIONS[0];
  top.replaceChildren(
    el('div', { className: 'grow truncate' },
      el('div', { className: 'adm__title truncate' }, t(item.title)),
      el('div', { className: 'adm__sub truncate' },
        (state.user && (state.user.name || state.user.email)) || '')),
    el('span', {
      className: 'badge ' + (state.connected ? 'badge--ok' : 'badge--warn'),
      title: state.connected ? t('adm.live_on') : t('adm.live_off'),
    }, el('span', { className: 'badge__dot' }),
      state.connected ? t('status.online') : t('common.offline')));
}

/** Язык, тема и выход — одинаковые и в боковом меню, и в шторке «Ещё». */
function settingsBar(done) {
  const themes = ['dark', 'light', 'auto'];
  const now = getTheme();
  const close = () => { if (typeof done === 'function') done(); };

  const themeBtn = el('button', {
    className: 'btn btn--ghost btn--sm', type: 'button',
    onClick: () => {
      applyTheme(themes[(themes.indexOf(getTheme()) + 1) % themes.length]);
      close();
      paint();
      // Карта живёт своими цветами, поэтому раздел пересобираем целиком.
      if (currentRoute) render(section, currentRoute);
    },
  }, t('common.theme') + ': ' +
     t(now === 'light' ? 'common.theme_light' : now === 'auto' ? 'common.theme_auto' : 'common.theme_dark'));

  const langBtn = el('button', {
    className: 'btn btn--ghost btn--sm', type: 'button',
    onClick: () => {
      close();
      setLang(getLang() === 'ru' ? 'ky' : 'ru');
      haptic();
    },
  }, getLang() === 'ru' ? t('common.lang_ky') : t('common.lang_ru'));

  const outBtn = el('button', {
    className: 'btn btn--ghost btn--sm', type: 'button',
    onClick: () => { close(); signOut(); },
  }, t('common.logout'));

  return el('div', { className: 'row gap-2 wrap' }, themeBtn, langBtn, outBtn);
}

function paint() {
  paintNav();
  paintDock();
  paintTop();
  sideFoot.replaceChildren(settingsBar());
}

/* ─────────────────────────────────────────────────────── маршруты */

let currentRoute = null;

const ctx = {
  get config() { return state.config; },
  get user() { return state.user; },
  theme: () => mapTheme(),
  setting,
  settingsChanged(values) {
    if (values) state.settings = values;
    const tz = setting('service.tz', '');
    if (tz) setTimeZone(tz);
  },
  onLive,
  guard: () => guardLeave(),
  go: (path, query) => go(path, query),
  back: () => back(),
};

async function go(path, query) {
  if (!(await guardLeave())) return;
  if (!router) return;
  router.go(path, query ? { query } : undefined);
}

async function back() {
  if (!(await guardLeave())) return;
  if (router) router.back();
}

/** Показать раздел: уборка старого, отрисовка нового, подсветка меню. */
function render(sectionPath, route) {
  section = sectionPath;
  currentRoute = route;
  if (cleanup) {
    try { cleanup(); } catch (e) { console.error('[admin] уборка раздела упала', e); }
  }
  cleanup = null;
  main.replaceChildren();
  paintNav();
  paintDock();
  paintTop();
  try {
    cleanup = route.draw(main) || null;
  } catch (e) {
    console.error('[admin] раздел не отрисовался', e);
    main.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty__title' }, errText(e)),
      el('button', {
        className: 'btn btn--ghost', type: 'button',
        onClick: () => render(sectionPath, route),
      }, t('common.retry'))));
  }
  applyTo(main);
  main.scrollTop = 0;
}

function routes() {
  const at = (sectionPath, draw) => () => render(sectionPath, { draw, path: sectionPath });
  return {
    '/overview': at('/overview', (host) => renderOverview(host, ctx)),
    '/map': at('/map', (host) => renderLive(host, ctx)),
    '/orders': at('/orders', (host) => renderOrders(host, ctx)),
    '/orders/:id': (r) => render('/orders', {
      draw: (host) => renderOrder(host, ctx, r.params.id),
      path: '/orders/' + r.params.id,
    }),
    '/couriers': at('/couriers', (host) => renderCouriers(host, ctx)),
    '/couriers/:id': (r) => render('/couriers', {
      draw: (host) => renderCourier(host, ctx, r.params.id),
      path: '/couriers/' + r.params.id,
    }),
    '/verify': at('/verify', (host) => renderVerify(host, ctx)),
    '/clients': (r) => render('/clients', {
      draw: (host) => renderClients(host, ctx, r.query),
      path: '/clients',
    }),
    '/tariffs': at('/tariffs', (host) => renderTariffs(host, ctx)),
    '/extras': at('/extras', (host) => renderExtras(host, ctx)),
    '/settings': at('/settings', (host) => renderSettings(host, ctx)),
    '*': at('/overview', (host) => renderOverview(host, ctx)),
  };
}

/* ─────────────────────────────────────────────────────── вход и выход */

function showGate(message) {
  delete document.documentElement.dataset.screen;
  if (loginError) {
    loginError.textContent = message || '';
    loginError.hidden = !message;
  }
  const email = loginForm && loginForm.querySelector('input[name="email"]');
  if (email) setTimeout(() => email.focus(), 60);
}

function hideGate() {
  document.documentElement.dataset.screen = 'app';
  if (loginError) {
    loginError.textContent = '';
    loginError.hidden = true;
  }
}

/* Подписи входа: часть текстов панели живёт в её собственном словаре,
   и разметка о них не знает — проставляем руками. */
function paintGate() {
  const sub = document.getElementById('gate-sub');
  if (sub) sub.textContent = t('adm.gate_sub');
  const button = loginForm && loginForm.querySelector('button[type="submit"]');
  if (button) button.textContent = t('adm.enter');
}

function wireGate() {
  if (!loginForm) return;
  paintGate();
  const button = loginForm.querySelector('button[type="submit"]');
  let busy = false;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const email = loginForm.querySelector('input[name="email"]').value.trim();
    const password = loginForm.querySelector('input[name="password"]').value;
    if (!email || !password) {
      showGate(t('common.required'));
      return;
    }
    busy = true;
    button.classList.add('is-loading');
    try {
      const res = await api.post('/auth/login', { email, password }, { auth: false });
      api.setToken(res.token);
      await start(res.user);
    } catch (err) {
      api.setToken(null);
      showGate(errText(err));
    } finally {
      busy = false;
      button.classList.remove('is-loading');
    }
  });

  for (const btn of document.querySelectorAll('[data-lang]')) {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  }

  const eye = document.querySelector('[data-eye]');
  if (eye) {
    eye.addEventListener('click', () => {
      const field = document.getElementById(eye.dataset.eye);
      if (!field) return;
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      eye.classList.toggle('is-on', show);
    });
  }
}

async function signOut() {
  if (!(await guardLeave())) return;
  try {
    await api.post('/auth/logout');
  } catch (e) { /* токен мог протухнуть — выходим всё равно */ }
  teardown();
  api.setToken(null);
  showGate();
}

function teardown() {
  if (source) source.close();
  source = null;
  if (cleanup) {
    try { cleanup(); } catch (e) { /* раздел уже не важен */ }
  }
  cleanup = null;
  liveSubs.clear();
  booted = false;
  state.user = null;
  state.settings = {};
  state.connected = false;
  main.replaceChildren();
}

async function start(user) {
  const me = user || null;
  if (!me || me.role !== 'admin') {
    api.setToken(null);
    showGate(t('adm.only_admin'));
    return;
  }
  if (me.status && me.status !== 'active') {
    api.setToken(null);
    showGate(t('err.account_blocked'));
    return;
  }
  state.user = me;
  hideGate();
  booted = true;
  paint();
  await loadSettings();

  if (!router) {
    router = createRouter(routes(), { home: '/overview', auto: false });
    router.start();
  } else {
    router.refresh();
  }
  connect();
}

/* ─────────────────────────────────────────────────────── запуск */

async function boot() {
  applyTheme(getTheme());
  wireGate();

  // Конфиг нужен карте и до, и после входа, и он не требует авторизации.
  api.get('/config', null, { auth: false })
    .then((config) => {
      state.config = config;
      const tz = config.service && config.service.tz;
      if (tz) setTimeZone(tz);
    })
    .catch(() => { /* карта поднимется на значениях по умолчанию */ });

  if (!api.token()) {
    showGate();
    return;
  }
  try {
    const me = await api.get('/auth/me');
    await start(me.user || me);
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      showGate(t('err.offline'));
      return;
    }
    api.setToken(null);
    showGate();
  }
}

api.onUnauthorized(() => {
  teardown();
  showGate(t('err.session'));
});

onLangChange(() => {
  paintGate();
  if (!booted) return;
  paint();
  if (currentRoute) render(section, currentRoute);
});

boot();
