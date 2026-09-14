/* Приложение курьера: сборка экранов, поток событий и жизненный цикл.

   Здесь сходится всё: вход, маршруты, один SSE-поток на всю смену, очередь
   предложений и слежение за позицией. Экраны рисуют work.js и auth.js, этот
   файл только решает, что показать и когда обновить.

   Нижняя панель разделов свёрстана в courier.html и живёт там же: мы её не
   пересобираем, а только подсвечиваем нужную кнопку и вешаем переходы.
   Так панель видна с первого кадра, ещё до того как браузер разберёт модули.

   Приложение задумано как самостоятельное — его оборачивают в APK. Поэтому
   оно переживает сворачивание: при возвращении на экран состояние берётся
   с сервера заново, а не достраивается из того, что накопилось в памяти.
*/

import { api, ApiError } from '../core/api.js';
import { t, setLang, onLangChange, applyTo } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import { createRouter } from '../core/router.js';
import { el, toast, haptic } from '../core/ui.js';
import { setTimeZone } from '../core/fmt.js';

import {
  initGate, showGate, hideGate, showStatusNotice,
  renderVerify, renderProfile, lockShift, getSound,
} from './auth.js';
import {
  renderShift, renderJob, renderHistory,
  showOffer, createGeoTracker, stopAlert, unlockAudio,
  getTheme, applyTheme, markShift, takeServerShift,
} from './work.js';

/* ─────────────────────────────────────────────────────── состояние */

const store = createStore({
  user: null,        // ответ /auth/me
  config: null,      // ответ /config: карта, тарифы, допуслуги
  online: false,
  busy: false,
  geoOk: false,
  at: null,          // последняя своя точка [lat, lng]
  order: null,       // карточка активного заказа
  waiting: null,     // состояние платного ожидания
  stats: null,
  period: 'today',
  connected: false,
  verify: null,      // состояние проверки документов; null = ещё не знаем
});

const root = document.getElementById('app');
const top = document.getElementById('app-top');
const main = document.getElementById('app-main');
const dock = document.getElementById('dock');
const offerBox = document.getElementById('offer');

/* Разделы. tab — какая кнопка панели горит, back — куда ведёт стрелка сверху
   у экранов, которых в панели нет. */
const SCREENS = {
  '/shift': { title: 'courier.shift', render: renderShift, tab: '/shift' },
  '/order': { title: 'courier.order', render: renderJob, tab: '/order' },
  '/history': { title: 'courier.history', render: renderHistory, tab: '/history' },
  '/profile': { title: 'courier.profile', render: renderProfile, tab: '/profile' },
  '/verify': { title: 'vfy.title', render: renderVerify, tab: '/profile', back: '/profile' },
};
const ROUTES = Object.keys(SCREENS);

const navButtons = Array.from(dock.querySelectorAll('[data-nav]'));

let router = null;
let path = '/shift';
let closedOrder = 0;        // заказ, который мы только что закрыли своими руками
let cleanup = null;
let source = null;          // поток событий
let booted = false;

/* Иконка из общего набора символов в courier.html. */
function ico(name) {
  return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

/* ─────────────────────────────────────────────────────── геопозиция */

const fixHandlers = new Set();

const tracker = createGeoTracker({
  onFix(point) {
    store.set({ at: [point.lat, point.lng] });
    for (const fn of Array.from(fixHandlers)) {
      try { fn(point); } catch (e) { console.error('[courier] обработчик позиции упал', e); }
    }
  },
  onState(info) {
    if (info.ok) store.set({ geoOk: true });
    else if (info.denied) store.set({ geoOk: false });
  },
});

/* Подписка экранов на свежие координаты. Возвращает «отписаться». */
function onFix(fn) {
  if (typeof fn !== 'function') return () => {};
  fixHandlers.add(fn);
  return () => fixHandlers.delete(fn);
}

/* ─────────────────────────────────────────────────────── проверка документов */

/* Короткий ответ /courier/state знает статус, но не знает ссылку на снимок,
   а полный ответ /courier/verify знает всё. Склеиваем, чтобы экран проверки
   не терял картинку при каждом обновлении состояния. */
function mergeVerify(was, next) {
  if (!next || !next.status) return was;
  const out = Object.assign({}, next);
  // Ссылку на снимок теряем только тогда, когда нам прямо сказали, что фото нет.
  if (out.photo_url === undefined && was && was.photo_url && next.photo !== false) {
    out.photo_url = was.photo_url;
  }
  if (out.max_mb === undefined && was && was.max_mb) out.max_mb = was.max_mb;
  return out;
}

/* Ключ состояния проверки: пусто, пока сервер молчит, иначе сам статус.
   По нему видно и «узнали впервые», и «решение поменялось». */
function verifyKey(v) {
  return v && v.status ? String(v.status) : '';
}

function setVerify(next) {
  const was = store.get().verify;
  const now = mergeVerify(was, next);
  if (!now) return;
  store.set({ verify: now });
  // Первый ответ сервера — не новость: о нём не объявляем, иначе проверенный
  // курьер будет получать поздравление при каждом запуске приложения.
  if (!was || was.status === now.status) return;

  // Решение админа приходит в поток событий: человек должен узнать о нём
  // сразу, даже если сидит на другом экране.
  if (now.status === 'approved') {
    toast(t('vfy.approved_title'), { type: 'ok', ms: 6000 });
    haptic([16, 70, 16]);
    if (booted) pullState();
  } else if (now.status === 'rejected') {
    toast(now.note || t('vfy.rejected_title'), { type: 'err', ms: 7000 });
    haptic([18, 80, 18]);
  }
}

/* ─────────────────────────────────────────────────────── контекст экранов */

const ctx = {
  store,
  tracker,
  onFix,
  go: (to) => (router ? router.go(to) : null),
  refresh: () => pullState(),
  // Заказ закрыт. Событие, отправленное сервером до этого, может прийти позже —
  // и воскресить заказ на экране. Помним номер и такие сообщения пропускаем.
  finished: (orderId) => { closedOrder = orderId || 0; },
  refreshTheme: () => render(path),
  setVerify,
  setLang: (code) => {
    setLang(code);
    haptic();
  },
  logout: () => signOut(),
};

/* ─────────────────────────────────────────────────────── оболочка */

function paintTop() {
  const s = store.get();
  const screen = SCREENS[path] || SCREENS['/shift'];
  const sub = path === '/order' && s.order
    ? s.order.public_id
    : (s.user && s.user.name) || '';

  const badge = el('span', {
    className: 'badge ' + (s.online ? 'badge--ok' : ''),
  }, el('span', { className: 'badge__dot' }),
    s.online ? t('courier.online') : t('courier.offline'));

  const back = screen.back ? el('button', {
    className: 'btn btn--ghost btn--icon',
    type: 'button',
    html: ico('back'),
    'aria-label': t('common.back'),
    onClick: () => { haptic(); ctx.go(screen.back); },
  }) : null;

  top.replaceChildren(...[
    back,
    el('div', { className: 'grow truncate' },
      el('div', { className: 'app__title truncate' }, t(screen.title)),
      el('div', { className: 'app__sub truncate' }, sub)),
    badge,
  ].filter(Boolean));
}

/* Панель разделов уже свёрстана: подсвечиваем нужную кнопку и ставим точку
   на «Заказы», когда заказ в работе. Разметку не трогаем. */
function paintDock() {
  const s = store.get();
  const screen = SCREENS[path] || SCREENS['/shift'];
  for (const btn of navButtons) {
    const on = btn.dataset.nav === screen.tab;
    btn.classList.toggle('is-on', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');

    const mark = btn.querySelector('.dock__mark');
    const need = btn.dataset.nav === '/order' && !!s.order;
    if (need && !mark) btn.appendChild(el('span', { className: 'dock__mark' }));
    if (!need && mark) mark.remove();
  }
}

function bindDock() {
  for (const btn of navButtons) {
    btn.addEventListener('click', () => {
      haptic();
      ctx.go(btn.dataset.nav);
    });
  }
}

/* Плашка «нет связи»: пока поток оборван, курьер должен знать, что заказы
   до него не дойдут, — иначе он будет уверен, что их просто нет. */
let lostBar = null;
function paintLink() {
  const bad = booted && !store.get().connected;
  if (bad && !lostBar) {
    lostBar = el('div', { className: 'link-lost' }, t('common.offline'));
    root.insertBefore(lostBar, main);
  } else if (!bad && lostBar) {
    lostBar.remove();
    lostBar = null;
  }
}

function render(next) {
  path = SCREENS[next] ? next : '/shift';
  if (cleanup) {
    try { cleanup(); } catch (e) { console.error('[courier] уборка экрана упала', e); }
  }
  cleanup = null;
  main.replaceChildren();
  paintTop();
  paintDock();
  const screen = SCREENS[path];
  try {
    cleanup = screen.render(main, ctx) || null;
    // Без проверки документов на линию не выйти. Экран смены при этом остаётся
    // на месте целиком: человек должен видеть, что его ждёт после проверки.
    if (path === '/shift') lockShift(main, ctx);
  } catch (e) {
    console.error('[courier] экран не отрисовался', e);
    main.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty__title' }, t('err.unknown')),
      el('button', {
        className: 'btn btn--ghost', type: 'button', onClick: () => render(path),
      }, t('common.retry'))));
  }
  applyTo(main);
  main.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ─────────────────────────────────────────────────────── очередь предложений */

const queue = [];
const answered = new Set();     // на что уже ответили: после переподключения не показываем снова
let showing = null;

function alive(offer) {
  const until = (offer && offer.expires_at ? offer.expires_at : 0) * 1000;
  return until > Date.now() + 900;
}

function enqueue(offer) {
  if (!offer || !offer.offer_id || !alive(offer)) return;
  if (store.get().order) return;                       // машина занята, не отвлекаем
  if (answered.has(offer.offer_id)) return;
  if (showing && showing.offerId === offer.offer_id) return;
  if (queue.some((o) => o.offer_id === offer.offer_id)) return;
  queue.push(offer);
  pump();
}

function drop(offerId) {
  const i = queue.findIndex((o) => o.offer_id === offerId);
  if (i >= 0) queue.splice(i, 1);
  if (showing && showing.offerId === offerId) showing.close('gone');
}

function pump() {
  if (showing) return;
  while (queue.length && !alive(queue[0])) queue.shift();
  if (!queue.length) return;
  const offer = queue.shift();
  showing = showOffer(offerBox, offer, ctx, (how, payload) => {
    showing = null;
    answered.add(offer.offer_id);
    if (answered.size > 200) answered.clear();         // редкая уборка, память не растёт
    if (how === 'accept' && payload) {
      queue.length = 0;                                // остальные предложения уже не наши
      closedOrder = 0;
      store.set({
        order: payload.order || null,
        waiting: payload.waiting || null,
        busy: true,
      });
      ctx.go('/order');
    } else {
      setTimeout(pump, 200);
    }
  });
  // Звук выключили в профиле — гасим сигнал сразу, как только карточка встала.
  // Сама карточка при этом никуда не девается: молча, но видно.
  if (!getSound()) stopAlert();
}

/* ─────────────────────────────────────────────────────── поток событий */

function applyState(data) {
  if (!data) return;
  const order = data.order && data.order.id === closedOrder ? null : (data.order || null);
  // Часы на линии ведёт сервер: водитель меняет телефон и чистит браузер, а
  // цифра, на которую он смотрит всю смену, должна быть одна и та же. Счёт в
  // телефоне остаётся запасным — на случай, если сервер ещё старой версии.
  takeServerShift(data);   // часы на линии считает сервер — они одни на все устройства
  markShift(!!data.online);
  store.set({
    online: !!data.online,
    busy: !!data.busy,
    geoOk: !!data.geo_fresh,
    order,
    at: data.at && data.at[0] != null ? data.at : store.get().at,
  });
  if (data.verify) setVerify(data.verify);
  if (data.online) tracker.start();
  else tracker.stop();
  // Курьер открыл приложение посреди заказа — ему нужен заказ, а не экран смены.
  if (booted && order && path !== '/order') ctx.go('/order');
  for (const offer of data.offers || []) enqueue(offer);
}

function applyOrder(card) {
  if (!card) return;
  if (card.id && card.id === closedOrder && card.status !== 'done') return;
  if (card.status === 'done' || card.status === 'cancelled' || card.status === 'expired') {
    const was = store.get().order;
    store.set({ order: null, waiting: null, busy: false });
    if (was && card.status === 'cancelled') {
      toast(t('track.cancelled') + ' · ' + (card.public_id || ''), { type: 'warn', ms: 5000 });
      haptic([18, 80, 18]);
      if (path === '/order') ctx.go('/shift');
    }
    return;
  }
  store.set({ order: card, busy: true });
  if (path !== '/order' && !showing) ctx.go('/order');
}

function connect() {
  if (source) source.close();
  source = api.stream('/courier/stream', {
    events: ['state', 'verify'],
    onOpen: () => store.set({ connected: true }),
    onError: () => store.set({ connected: false }),
    onEvent(name, data) {
      switch (name) {
        case 'state': applyState(data); break;
        case 'order': applyOrder(data); break;
        case 'offer': enqueue(data); break;
        case 'offer_cancelled': drop(data && data.offer_id); break;
        case 'verify': setVerify(data && { ...data, ok: data.status === 'approved' }); break;
        case 'ping': store.set({ connected: true }); break;
        default: break;
      }
    },
  });
}

/* Состояние целиком: им приложение оживает после сна, потери связи и перезапуска. */
async function pullState() {
  try {
    const data = await api.get('/courier/state');
    applyState(data);
    store.set({ connected: true });
    if (!store.get().user) {
      const me = await api.get('/auth/me');
      store.set({ user: me.user || me });
      render(path);
    }
  } catch (e) {
    if (e instanceof ApiError && e.isAuth) return;      // выход обработает onUnauthorized
    store.set({ connected: false });
  }
}

/* ─────────────────────────────────────────────────────── вход и выход */

async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch (e) { /* токен мог протухнуть — выходим всё равно */ }
  teardown();
  api.setToken(null);
  showGate();
}

function teardown() {
  tracker.stop();
  stopAlert();
  markShift(false);        // вышли из аккаунта — смена закончилась, часы стоят
  if (source) source.close();
  source = null;
  queue.length = 0;
  if (showing) showing.close('gone');
  showing = null;
  if (cleanup) {
    try { cleanup(); } catch (e) { /* экран уже не важен */ }
  }
  cleanup = null;
  booted = false;
  store.set({
    user: null, order: null, waiting: null, verify: null,
    online: false, busy: false, connected: false,
  });
  paintLink();
  main.replaceChildren();
}

/* Человек вошёл или зарегистрировался без модерации — поднимаем рабочий экран. */
async function start(user) {
  if (user && user.role !== 'courier') {
    api.setToken(null);
    showGate(t('err.forbidden'));
    return;
  }
  if (user && user.status && user.status !== 'active') {
    api.setToken(null);
    showStatusNotice(user.status);
    return;
  }
  store.set({ user: user || null });
  hideGate();
  booted = true;

  if (!router) {
    const routes = {};
    for (const to of ROUTES) routes[to] = () => render(to);
    routes['*'] = () => render('/shift');
    router = createRouter(routes, {
      home: '/shift',
      auto: false,
      onChange: (route) => { path = SCREENS[route.path] ? route.path : '/shift'; },
    });
    router.start();
  } else {
    render(path);
  }

  connect();
  await pullState();
}

/* ─────────────────────────────────────────────────────── запуск */

async function boot() {
  applyTheme(getTheme());
  bindDock();
  initGate({ onAuthed: (user) => start(user) });

  // Конфиг нужен и до входа (классы машин в анкете), и после (карта, допуслуги).
  api.get('/config', null, { auth: false })
    .then((config) => {
      store.set({ config });
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
      // Сети нет, но токен есть: показываем рабочий экран, он оживёт сам,
      // как только связь вернётся. Выкидывать человека на вход здесь нельзя.
      await start(null);
      toast(t('err.offline'), { type: 'warn' });
      return;
    }
    api.setToken(null);
    showGate();
  }
}

/* ─────────────────────────────────────────────────────── подписки приложения */

store.on((now, was) => {
  if (!booted) return;
  paintTop();
  paintDock();
  paintLink();
  // Экран заказа рисовался пустым, а заказ появился — пересобираем его целиком.
  if (path === '/order' && !was.order && now.order) render(path);
  // Состояние проверки узнали или оно поменялось — на экране смены от этого
  // зависит главная кнопка. Сравниваем именно статус, а не «пройдено да/нет»:
  // первый ответ сервера тоже меняет экран, хотя «нет» так и остаётся «нет».
  if (path === '/shift' && verifyKey(was.verify) !== verifyKey(now.verify)) render(path);
});

api.onUnauthorized(() => {
  teardown();
  showGate(t('err.session'));
});

onLangChange(() => {
  if (booted) render(path);
});

/* Вернулись к приложению — спрашиваем сервер, что изменилось, пока нас не было. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !booted) return;
  if (source && !source.connected) source.reconnect();
  pullState();
});

window.addEventListener('online', () => {
  if (!booted) return;
  toast(t('common.online_again'), { type: 'ok' });
  pullState();
});

window.addEventListener('offline', () => {
  if (booted) store.set({ connected: false });
});

/* Звук предложения браузер разрешает только после касания — ловим первое же.
   Если звук выключен в профиле, звуковой движок вообще не заводим. */
document.addEventListener('pointerdown', () => {
  if (getSound()) unlockAudio();
}, { once: true, passive: true });

/* Служебный воркер держит оболочку в кэше: на плохой сети приложение
   всё равно открывается за мгновение, а запросы к API идут только в сеть. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = window.SG_BASE || '/';
    navigator.serviceWorker.register(base + 'sw-courier.js', { scope: base + 'courier' })
      .catch(() => { /* http без tls или приватный режим — просто работаем без кэша */ });
  });
}

boot();
