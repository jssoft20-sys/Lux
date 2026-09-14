/* Клиентское приложение: карта во весь экран и шторка снизу.

   Здесь собрана оболочка — настройки сервиса, карта, шторка с переходами между
   шагами, язык и маршрутизация. Сами экраны живут в order.js и track.js, а поиск
   адреса в address.js; оболочка передаёт им объект app со всем, что нужно.

   Всё общение с сервером идёт через core/api.js, тексты — только через t().
*/

import { api } from '../core/api.js';
import { t, has, setLang, getLang, onLangChange, applyTo, LANGS } from '../core/i18n.js';
import { createMap } from '../core/map.js';
import { el, toast } from '../core/ui.js';
import { createRouter } from '../core/router.js';
import { setTimeZone } from '../core/fmt.js';
import { mountOrder } from './order.js';
import { mountTrack } from './track.js';

/* Ключи в localStorage: активный заказ, контакты и недавние адреса. */
export const KEY_ORDER = 'sg_order';
export const KEY_ME = 'sg_me';
export const KEY_RECENT = 'sg_recent';

/* Коды ошибок, у которых имя в словаре не совпадает с кодом сервера. */
const ERR_ALIAS = {
  server_error: 'server',
  http_500: 'server',
  http_502: 'server',
  http_503: 'server',
  bad_json: 'bad_request',
  stream: 'network',
};

/* ─────────────────────────────────────────────────────── хранилище */

/* localStorage закрыт в инкогнито и в части встроенных браузеров. Читать и писать
   туда без try/catch нельзя: одно исключение — и весь экран не соберётся. */
export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* места нет или хранилище закрыто — приложение работает и без памяти */
  }
  return value;
}

/* ─────────────────────────────────────────────────────── мелкие помощники */

/** Длительность из токенов в миллисекундах: с «меньше движения» вернётся 1 мс. */
export function dur(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : n * 1000;
}

/** Человеческий текст ошибки: с сервера берём его пояснение, из сети — своё. */
export function errText(e) {
  if (!e) return t('err.unknown');
  const code = ERR_ALIAS[e.code] || e.code || '';
  if (e.status === 0) {
    return has('err.' + code) ? t('err.' + code) : t('err.network');
  }
  if (e.message) return e.message;
  if (has('err.' + code)) return t('err.' + code);
  return t('err.unknown');
}

/** Название из справочника на текущем языке: у тарифов и услуг оно приходит парой. */
export function nameOf(row, field = 'name') {
  if (!row) return '';
  const key = field + '_' + (getLang() === 'ky' ? 'ky' : 'ru');
  return row[key] || row[field + '_ru'] || '';
}

/* ─────────────────────────────────────────────────────── иконки */

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  go: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.4V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  locate: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  map: '<path d="M9 4.5L3.8 6.6v13L9 17.4l6 2.1 5.2-2.1v-13L15 6.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 4.5v12.9M15 6.6v12.9" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  note: '<path d="M4.5 19.5l.9-3.6L15.7 5.6a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L9 19.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  phone: '<path d="M6.4 3.8h3l1.5 3.8-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 3.8 1.5v3a1.6 1.6 0 0 1-1.8 1.6C10.6 17.5 6.5 13.4 4.8 5.6a1.6 1.6 0 0 1 1.6-1.8z" fill="currentColor"/>',
  chat: '<path d="M4.5 6.6c0-1.2 1-2.1 2.1-2.1h10.8c1.2 0 2.1.9 2.1 2.1v7.2c0 1.2-.9 2.1-2.1 2.1H10l-4.2 3.4-.1-3.4h-.2A1.4 1.4 0 0 1 4.5 14z" fill="currentColor"/>',
  alert: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.4v5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1.2" fill="currentColor"/>',
  car: '<path d="M3.5 15.5v-3.2l2.1-4.1a2.4 2.4 0 0 1 2.1-1.3h8.6a2.4 2.4 0 0 1 2.1 1.3l2.1 4.1v3.2a1 1 0 0 1-1 1h-1.3v-1.4H5.8v1.4H4.5a1 1 0 0 1-1-1z" fill="currentColor"/><circle cx="7.4" cy="16.4" r="1.9" fill="currentColor"/><circle cx="16.6" cy="16.4" r="1.9" fill="currentColor"/>',
  van: '<path d="M2.6 7.2h10.6v9.1H2.6z" fill="currentColor"/><path d="M13.2 9.6h3.6l3.4 4v2.7h-7z" fill="currentColor"/><circle cx="7" cy="17" r="2" fill="currentColor"/><circle cx="17" cy="17" r="2" fill="currentColor"/>',
  truck: '<path d="M2 6.4h11.4v9.9H2z" fill="currentColor"/><path d="M13.4 9.2h3.9l3.7 4.3v2.8h-7.6z" fill="currentColor"/><circle cx="6.6" cy="17.2" r="2.1" fill="currentColor"/><circle cx="17.4" cy="17.2" r="2.1" fill="currentColor"/>',
  'truck-big': '<path d="M1.4 5.6h12.8v10.9H1.4z" fill="currentColor"/><path d="M14.2 8.4h4.2l4.2 4.7v3.4h-8.4z" fill="currentColor"/><circle cx="6.2" cy="17.4" r="2.2" fill="currentColor"/><circle cx="18.2" cy="17.4" r="2.2" fill="currentColor"/>',
};

/** Разметка иконки для вставки через html. Незнакомое имя рисуем кружком:
    пустое место на кнопке выглядит как поломка. */
export function icon(name) {
  const body = ICONS[name] || '<circle cx="12" cy="12" r="3" fill="currentColor"/>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
}

/** Кнопка-иконка одной строкой: класс, подпись для скринридера, обработчик. */
export function iconBtn(name, cls, label, onClick) {
  return el('button', {
    type: 'button', className: cls, 'aria-label': label, title: label,
    html: icon(name), onClick,
  });
}

/* ─────────────────────────────────────────────────────── шторка */

/* Шторка живёт на странице всегда, меняется только её содержимое. Высоту
   анимируем числом: если менять auto, браузер просто дёрнет вёрстку скачком. */
function createPanel(root) {
  const slot = root.querySelector('.sg-panel__slot');
  let timer = 0;
  let current = null;
  let leaving = [];             // шаги, которые ещё дотаивают на экране

  const shell = document.querySelector('.sg-app');

  function measure() {
    const h = Math.round(root.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sg-panel-h', h + 'px');
    // На весь экран шторка разворачивается только для поиска адреса: кнопки карты
    // под ней всё равно не нажать, и они лезут в шапку — прячем их на это время.
    if (shell) shell.classList.toggle('is-deep', !!slot.querySelector('.sg-step--tall'));
    return h;
  }

  function show(node, opts = {}) {
    if (node === current) return node;
    const old = current;
    node.classList.add('sg-step');
    current = node;

    // Хвосты прошлых переходов убираем сразу: иначе прозрачный шаг остаётся
    // в разметке и его читают поиск по странице и скринридер.
    clearTimeout(timer);
    for (const gone of leaving) gone.remove();
    leaving = [];

    if (!old) {
      slot.replaceChildren(node);
      measure();
      return node;
    }

    const time = dur('--dur-2', 240);
    const h0 = slot.getBoundingClientRect().height;
    old.classList.add('sg-step--out');
    if (opts.back) old.classList.add('sg-step--back-out');
    node.classList.add('sg-step--enter');
    if (opts.back) node.classList.add('sg-step--back');
    slot.appendChild(node);

    const h1 = node.getBoundingClientRect().height;
    slot.style.height = h0 + 'px';
    void slot.offsetHeight;                 // фиксируем стартовый кадр
    slot.style.height = h1 + 'px';
    requestAnimationFrame(() => node.classList.remove('sg-step--enter', 'sg-step--back'));

    leaving.push(old);
    timer = setTimeout(() => {
      for (const gone of leaving) gone.remove();
      leaving = [];
      slot.style.height = '';
      measure();
    }, time + 60);
    measure();
    return node;
  }

  /* Содержимое шага поменялось само (пришла цена, сменился статус) — просто
     пересчитываем высоту, чтобы кнопки карты остались над шторкой. */
  function refresh() {
    return measure();
  }

  window.addEventListener('resize', () => measure());
  return { el: root, slot, show, refresh, height: measure, current: () => current };
}

/* ─────────────────────────────────────────────────────── оболочка */

async function boot() {
  const mapBox = document.getElementById('map');
  const panel = createPanel(document.getElementById('panel'));
  const langBtn = document.getElementById('lang-switch');

  applyTo(document);
  paintLang();

  let cfg = null;
  try {
    cfg = await api.get('/config');
  } catch (e) {
    return bootFailed(panel, e);
  }

  if (cfg.service && cfg.service.tz) setTimeZone(cfg.service.tz);
  if (cfg.service && cfg.service.name) {
    const name = document.getElementById('brand-name');
    if (name) name.textContent = cfg.service.name;
    document.title = cfg.service.name + ' — ' + t('order.title');
  }

  const light = window.matchMedia('(prefers-color-scheme: light)');
  const mapCfg = cfg.map || {};
  const map = createMap(mapBox, {
    center: mapCfg.center || [42.8746, 74.5698],
    zoom: mapCfg.zoom || 13,
    maxZoom: mapCfg.max_zoom || 19,
    tilesLight: mapCfg.tiles_light,
    tilesDark: mapCfg.tiles_dark,
    attribution: mapCfg.attribution || '',
    theme: light.matches ? 'light' : 'dark',
  });
  if (light.addEventListener) {
    light.addEventListener('change', (e) => map.setTheme(e.matches ? 'light' : 'dark'));
  }

  // Пока карту тянут, метка выбора точки приподнимается — как настоящая булавка.
  const shell = document.querySelector('.sg-app');
  map.on('move', () => shell.classList.add('is-dragging'));
  map.on('moveend', () => shell.classList.remove('is-dragging'));

  const owned = new Set();
  const centerPin = document.getElementById('center-pin');
  let lastFit = null;
  let screen = null;

  const app = {
    cfg,
    map,
    panel,
    maxPoints: Math.max(2, (cfg.order && cfg.order.max_points) || 5),
    tariffs: Array.isArray(cfg.tariffs) ? cfg.tariffs.slice() : [],
    extras: Array.isArray(cfg.extras) ? cfg.extras.slice() : [],

    /** Маркер карты, который оболочка уберёт сама при смене экрана. */
    marker(o) {
      const m = map.marker(o);
      const off = m.remove;
      m.remove = () => { owned.delete(m); off(); };
      owned.add(m);
      return m;
    },

    route(coords, o) {
      const r = map.route(coords, o);
      const off = r.remove;
      r.remove = () => { owned.delete(r); off(); };
      owned.add(r);
      return r;
    },

    clearMap() {
      for (const item of Array.from(owned)) item.remove();
      owned.clear();
    },

    /** Вписать точки в свободную часть карты — ту, что не закрыта шторкой.
        Шторка бывает выше половины экрана; если честно отдать ей весь отступ,
        для маршрута не останется места вовсе — поэтому ограничиваем. */
    fit(points, o = {}) {
      const list = (points || []).filter(Boolean);
      if (!list.length) return;
      lastFit = { points: list, o };
      const tall = mapBox.clientHeight || window.innerHeight || 640;
      const bottom = Math.min(panel.height() + 24, Math.round(tall * 0.56));
      map.fitPoints(list, {
        padding: { top: Math.min(92, Math.round(tall * 0.16)), right: 32, bottom, left: 32 },
        animate: o.animate !== false,
        maxZoom: o.maxZoom || 16.5,
        zoom: o.zoom,
      });
    },

    /** Шторка выросла или сжалась — маршрут должен остаться на виду. */
    refit() {
      if (lastFit) app.fit(lastFit.points, { ...lastFit.o, animate: true });
    },

    centerPin(on) {
      centerPin.hidden = !on;
    },

    go(path, query) { router.go(path, query ? { query } : undefined); },
    back() { router.back(); },

    activeOrder() {
      const v = readJson(KEY_ORDER);
      return v && v.pid && v.token ? v : null;
    },
    saveOrder(pid, token) {
      writeJson(KEY_ORDER, { pid, token, at: Math.floor(Date.now() / 1000) });
    },
    forgetOrder() { writeJson(KEY_ORDER, null); },

    me() { return readJson(KEY_ME, {}) || {}; },
    setMe(patch) { writeJson(KEY_ME, Object.assign(app.me(), patch)); },
  };

  function leave() {
    if (screen && typeof screen.destroy === 'function') screen.destroy();
    screen = null;
    app.clearMap();
    app.centerPin(false);
    lastFit = null;
  }

  const router = createRouter({
    '/': () => {
      leave();
      screen = mountOrder(app);
    },
    '/order/:pid': (ctx) => {
      leave();
      screen = mountTrack(app, String(ctx.params.pid || '').toUpperCase(), ctx.query.t || '');
    },
    '*': () => router.go('/', { replace: true }),
  }, { auto: false, home: '/' });

  app.router = router;

  // Язык меняется на лету: заголовок вкладки, разметка и текущий экран.
  onLangChange(() => {
    paintLang();
    applyTo(document);
    if (cfg.service && cfg.service.name) {
      document.title = cfg.service.name + ' — ' + t('order.title');
    }
    if (screen && typeof screen.relang === 'function') screen.relang();
  });

  langBtn.addEventListener('click', () => {
    const next = getLang() === 'ru' ? 'ky' : 'ru';
    setLang(LANGS.indexOf(next) >= 0 ? next : 'ru');
  });

  // Вернулись на сайт с открытым заказом — показываем его сразу, а не пустую форму.
  const live = app.activeOrder();
  const hash = String(location.hash || '').slice(1);
  if (live && (!hash || hash === '/' || hash === '#/')) {
    router.go('/order/' + live.pid, { query: { t: live.token }, replace: true });
  }
  router.start();
}

function paintLang() {
  const lang = getLang();
  for (const node of document.querySelectorAll('[data-lang-code]')) {
    node.classList.toggle('is-on', node.getAttribute('data-lang-code') === lang);
  }
}

/* Настройки не пришли — без них нет ни тарифов, ни карты. Показываем причину
   и кнопку «повторить»: чаще всего это метро и пропавшая связь. */
function bootFailed(panel, e) {
  const box = el('div', { className: 'sg-step' },
    el('div', { className: 'sg-fail' },
      el('div', { className: 'sg-fail__icon', html: icon('alert') }),
      el('div', { className: 'sg-fail__title' }, t('err.load_failed')),
      el('div', { className: 'sg-fail__text' }, errText(e)),
    ),
    el('div', { className: 'sg-foot' },
      el('button', {
        type: 'button', className: 'btn btn--primary btn--lg btn--block',
        onClick: () => location.reload(),
      }, t('common.retry')),
    ),
  );
  panel.show(box);
}

boot().catch((e) => {
  toast(errText(e), { type: 'err' });
});
