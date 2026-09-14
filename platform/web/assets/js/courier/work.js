/* Рабочие экраны курьера: смена, предложение заказа, заказ в работе,
   история с деньгами и профиль. Плюс две служебные вещи, которые нужны
   всему приложению, — слежение за геопозицией и звук предложения.

   Правило экранов простое: каждая функция render* получает пустой контейнер
   и возвращает функцию уборки. Всё, что она завела (карту, таймеры, подписки),
   она сама и гасит — иначе после десятка переходов телефон начнёт греться.
*/

import { api, ApiError } from '../core/api.js';
import { t, tp, getLang } from '../core/i18n.js';
import { money, moneyShort, distance, duration, time, date, phone as fmtPhone,
  plate as fmtPlate, initials, num } from '../core/fmt.js';
import { el, toast, sheet, confirm as ask, haptic, spinner, mountStars } from '../core/ui.js';
import { createMap, pin, distanceM } from '../core/map.js';

/* ─────────────────────────────────────────────────────── иконки */

const S = (d, extra) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + (extra || '') + '</svg>';

export const ICONS = {
  shift: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v5l3 1.8"/>'),
  job: S('<path d="M3.5 8.2 12 4l8.5 4.2v7.6L12 20l-8.5-4.2z"/><path d="M3.5 8.2 12 12.4l8.5-4.2M12 12.4V20"/>'),
  hist: S('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  me: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.4c1.1-3.2 3.9-5 7.2-5s6.1 1.8 7.2 5"/>'),
  phone: S('<path d="M7.2 4.5h2.1l1.5 3.6-1.8 1.3a10.4 10.4 0 0 0 4.6 4.6l1.3-1.8 3.6 1.5v2.1c0 1-.8 1.8-1.8 1.7C10.5 17 7 13.5 5.5 6.3c-.1-1 .7-1.8 1.7-1.8z"/>'),
  nav: S('<path d="M20.5 3.5 3.5 10.4l7 2.6 2.6 7z"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3 1.7"/>'),
  check: S('<path d="M20 6.5 9.5 17 4 11.6"/>'),
  star: S('<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
  wallet: S('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1.5"/><path d="M4 7.5v9A2.5 2.5 0 0 0 6.5 19H18a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 1 4 7.5z"/><circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>'),
  out: S('<path d="M15 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2A1.7 1.7 0 0 0 4.5 6.2v11.6a1.7 1.7 0 0 0 1.7 1.7h7.1a1.7 1.7 0 0 0 1.7-1.7V15"/><path d="M19.5 12H9.8m9.7 0-3-3m3 3-3 3"/>'),
  box: S('<rect x="4" y="4.8" width="16" height="14.4" rx="2.2"/><path d="M8.5 4.8v14.4M4 10h16"/>'),
};

/* ─────────────────────────────────────────────────────── тема */

const THEME_KEY = 'sg_theme';

/** Тема приложения: 'dark' | 'light' | 'auto'. Водитель ездит и днём, и ночью. */
export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch (e) { /* хранилище закрыто */ }
  return 'dark';
}

export function applyTheme(next) {
  const value = next === 'light' || next === 'auto' ? next : 'dark';
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* переживём */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mapTheme() === 'light' ? '#F4F4F6' : '#0E0E10');
  return value;
}

/* Какая тема сейчас на самом деле — карте нужен ответ «светлая или тёмная». */
function mapTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light') return 'light';
  if (set === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light' : 'dark';
}

/* ─────────────────────────────────────────────────────── звук предложения */

/* Звук синтезируем, а не грузим файлом: один короткий двойной сигнал весит
   ноль байт, звучит одинаково везде и не ждёт загрузки на плохой сети. */

let ctxAudio = null;
let alertTimer = 0;

function audio() {
  if (ctxAudio) return ctxAudio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctxAudio = new Ctor();
  } catch (e) {
    ctxAudio = null;
  }
  return ctxAudio;
}

/** Браузер разрешает звук только после касания — цепляемся за первое же. */
export function unlockAudio() {
  const ac = audio();
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
}

function beep() {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const now = ac.currentTime;
  // Две ноты подряд, вторая выше: так сигнал слышно даже сквозь музыку в машине.
  for (const [at, hz] of [[0, 880], [0.16, 1320]]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, now + at);
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.32, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.14);
    osc.connect(gain).connect(ac.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.16);
  }
}

/** Сигнал о новом заказе: звук и вибрация, пока человек не ответил. */
export function startAlert() {
  stopAlert();
  unlockAudio();
  let left = 10;
  const tick = () => {
    beep();
    if (navigator.vibrate) {
      try { navigator.vibrate([0, 320, 140, 320]); } catch (e) { /* выключена */ }
    }
    if (--left <= 0) stopAlert();
  };
  tick();
  alertTimer = setInterval(tick, 1800);
}

export function stopAlert() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = 0;
  if (navigator.vibrate) {
    try { navigator.vibrate(0); } catch (e) { /* выключена */ }
  }
}

/* ─────────────────────────────────────────────────────── геопозиция */

const MIN_MOVE_M = 15;          // меньше — это дрожание датчика, а не поездка
const SEND_FG_MS = 10000;       // экран открыт: раз в десять секунд
const SEND_BG_MS = 30000;       // приложение свернули: реже, батарея дороже
// «Я жив» даже на стоянке. В фоне срок короче секундомера не от щедрости:
// свёрнутой вкладке браузер разрешает просыпаться раз в минуту, и с порогом
// в полторы минуты очередная отправка попадала бы уже за черту, после которой
// сервер считает позицию потерянной и перестаёт слать заказы.
const BEAT_FG_MS = 45000;       // «я жив» даже стоя на месте: сервер считает
const BEAT_BG_MS = 55000;       // позицию старше двух минут потерянной

/**
 * Слежение за своей позицией.
 * Отправляем на сервер, только если реально сдвинулись больше пятнадцати метров,
 * либо давно ничего не слали. В фоне интервал растягиваем, но не глушим совсем:
 * иначе курьер пропадёт с карты и перестанет получать заказы.
 */
export function createGeoTracker(opts = {}) {
  const onFix = typeof opts.onFix === 'function' ? opts.onFix : () => {};
  const onState = typeof opts.onState === 'function' ? opts.onState : () => {};

  let watchId = 0;
  let timer = 0;
  let running = false;
  let sending = false;
  let last = null;            // самая свежая точка с датчика
  let sent = null;            // что уже ушло на сервер
  let sentAt = 0;
  let denied = false;

  const hidden = () => document.visibilityState === 'hidden';
  const every = () => (hidden() ? SEND_BG_MS : SEND_FG_MS);
  const beat = () => (hidden() ? BEAT_BG_MS : BEAT_FG_MS);

  function should(now) {
    if (!last || sending) return false;
    if (!sent) return true;
    if (now - sentAt < every()) return false;
    if (now - sentAt >= beat()) return true;
    return distanceM(sent, [last.lat, last.lng]) >= MIN_MOVE_M;
  }

  async function push() {
    const now = Date.now();
    if (!should(now)) return;
    const point = last;
    sending = true;
    try {
      await api.post('/courier/geo', {
        lat: point.lat, lng: point.lng,
        heading: point.heading, speed: point.speed,
      });
      sent = [point.lat, point.lng];
      sentAt = Date.now();
      onState({ ok: true, at: sent, geoAt: Math.floor(sentAt / 1000) });
    } catch (e) {
      // Сеть пропала — не страшно: следующая точка уйдёт, когда связь вернётся.
      if (e instanceof ApiError && e.isAuth) stop();
    } finally {
      sending = false;
    }
  }

  function fix(pos) {
    const c = pos.coords;
    denied = false;
    last = {
      lat: c.latitude, lng: c.longitude,
      heading: isFinite(c.heading) ? c.heading : null,
      speed: isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
      accuracy: c.accuracy,
      at: Math.floor((pos.timestamp || Date.now()) / 1000),
    };
    onFix(last);
    push();
  }

  function fail(err) {
    denied = err && err.code === 1;
    onState({ ok: false, denied, message: denied ? t('err.geo_denied') : t('err.geo_failed') });
  }

  function start() {
    if (running || !navigator.geolocation) {
      if (!navigator.geolocation) onState({ ok: false, denied: false, message: t('err.geo_failed') });
      return;
    }
    running = true;
    watchId = navigator.geolocation.watchPosition(fix, fail, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 25000,
    });
    // Отдельный будильник нужен для «я жив»: пока машина стоит, датчик
    // может молчать минутами, а сервер за это время спишет курьера с линии.
    timer = setInterval(push, 5000);
  }

  function stop() {
    running = false;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timer) clearInterval(timer);
    watchId = 0;
    timer = 0;
  }

  return {
    start, stop,
    get running() { return running; },
    get denied() { return denied; },
    at: () => (last ? [last.lat, last.lng] : null),
    heading: () => (last ? last.heading : null),
    /* Одиночный запрос позиции: им экран просит разрешение по кнопке. */
    request() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(fix, fail, { enableHighAccuracy: true, timeout: 15000 });
    },
  };
}

/* ─────────────────────────────────────────────────────── общие куски разметки */

function tile(key, value, mod) {
  return el('div', { className: 'tile' + (mod ? ' tile--' + mod : '') },
    el('div', { className: 'tile__k' }, key),
    el('div', { className: 'tile__v' }, value));
}

function kv(key, value) {
  return el('div', { className: 'me__kv' },
    el('span', { className: 'me__k' }, key),
    el('span', { className: 'me__v' }, value));
}

function pill(icon, text) {
  return el('span', { className: 'pill' }, el('span', { html: icon }), text);
}

/* Ссылка в навигатор: схема geo: открывает то приложение, которым человек
   пользуется сам, — 2ГИС, Яндекс или Google, какое стоит по умолчанию. */
function navHref(point) {
  if (!point || point.lat == null || point.lng == null) return null;
  const label = encodeURIComponent(point.addr || 'Точка');
  return 'geo:' + point.lat + ',' + point.lng + '?q=' + point.lat + ',' + point.lng + '(' + label + ')';
}

function telHref(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : null;
}

/* Подробности адреса одной строкой: «подъезд 2 · кв. 14 · этаж 5 · домофон 14К». */
function pointDetails(p) {
  const parts = [];
  if (p.entrance) parts.push(t('order.entrance').toLowerCase() + ' ' + p.entrance);
  if (p.flat) parts.push('кв. ' + p.flat);
  if (p.floor) parts.push(t('order.floor').toLowerCase() + ' ' + p.floor);
  if (p.intercom) parts.push(t('order.intercom').toLowerCase() + ' ' + p.intercom);
  return parts.join(' · ');
}

/**
 * Адрес в списке. full=true добавляет кнопки «позвонить» и «навигатор»
 * и показывает контакт — до принятия заказа этих данных у курьера нет.
 */
function pointRow(p, index, count, full) {
  const isLast = index === count - 1;
  const details = pointDetails(p);
  const body = el('div', { className: 'point__body' },
    el('div', { className: 'point__addr' }, p.addr || t('order.on_map')),
    details ? el('div', { className: 'point__extra' }, details) : null);

  if (full && (p.name || p.phone)) {
    body.appendChild(el('div', { className: 'point__extra' },
      [p.name, p.phone ? fmtPhone(p.phone) : null].filter(Boolean).join(' · ')));
  }
  if (p.comment) {
    body.appendChild(el('div', { className: 'point__note' }, p.comment));
  }
  if (full) {
    const acts = el('div', { className: 'point__acts' });
    const tel = telHref(p.phone);
    if (tel) {
      acts.appendChild(el('a', { className: 'btn btn--ghost btn--sm', href: tel },
        el('span', { html: ICONS.phone }), t('common.call')));
    }
    const nav = navHref(p);
    if (nav) {
      acts.appendChild(el('a', { className: 'btn btn--ghost btn--sm', href: nav },
        el('span', { html: ICONS.nav }), t('courier.navigate')));
    }
    if (acts.children.length) body.appendChild(acts);
  }

  return el('div', { className: 'point' + (isLast && count > 1 ? ' point--to' : '') },
    el('div', { className: 'point__mark' }, el('span', { className: 'point__dot' })),
    body);
}

/**
 * Госномер в поле: только буквы и цифры, верхний регистр, не длиннее двенадцати.
 * «01 kg 762 atn» и «01KG762ATN» — один и тот же номер, и вводить его человек
 * может как привык. Ограничение длины стоит здесь, а не в maxlength: иначе
 * пробелы съедали бы половину номера ещё до того, как мы их уберём.
 */
export function bindPlate(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const before = input.value;
    const at = input.selectionStart;
    const clean = before.toUpperCase().replace(/[^0-9A-ZА-Я]/g, '').slice(0, 12);
    if (clean === before) return;
    input.value = clean;
    const shift = before.length - clean.length;
    try { input.setSelectionRange(Math.max(0, at - shift), Math.max(0, at - shift)); }
    catch (e) { /* поле уже потеряло фокус */ }
  });
}

/* Названия допуслуг берём из /config: в заказе лежат только коды и количества. */
function extrasText(order, config) {
  const list = Array.isArray(order.extras) ? order.extras : [];
  if (!list.length) return '';
  const lang = getLang();
  const dict = new Map();
  for (const e of (config && config.extras) || []) {
    dict.set(e.code, (lang === 'ky' ? e.name_ky : e.name_ru) || e.code);
  }
  return list.map((e) => {
    const name = dict.get(e.code) || e.code;
    return e.qty && e.qty > 1 ? name + ' × ' + num(e.qty) : name;
  }).join(', ');
}

/* Секунды в «12:34» — счётчику ожидания нужны именно часы с минутами. */
function clock(seconds) {
  const v = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
}

/* ─────────────────────────────────────────────────────── карта */

function makeMap(node, config, opts = {}) {
  const m = (config && config.map) || {};
  return createMap(node, Object.assign({
    center: m.center && m.center[0] != null ? m.center : [42.8746, 74.5698],
    zoom: m.zoom || 13,
    tiles_light: m.tiles_light,
    tiles_dark: m.tiles_dark,
    max_zoom: m.max_zoom,
    attribution: m.attribution,
    theme: mapTheme(),
  }, opts));
}

/* ─────────────────────────────────────────────────────── экран смены */

/**
 * Смена: переключатель «на линии», карта со своей позицией и итоги дня.
 * ctx = {store, go, tracker, refresh}.
 */
export function renderShift(root, ctx) {
  const state = ctx.store.get();
  const stop = [];

  const lamp = el('span', { className: 'shift__lamp' });
  const title = el('span', { className: 'shift__state' });
  const toggle = el('button', { className: 'shift__toggle', type: 'button' }, lamp, title);

  const geoBox = el('div', { className: 'shift__geo', hidden: true });
  const mapNode = el('div', { className: 'shift__map' });
  const tilesBox = el('div', { className: 'tiles' });

  root.replaceChildren(el('div', { className: 'shift' },
    toggle, geoBox, mapNode, tilesBox));

  /* ── карта и своя точка ── */
  const map = makeMap(mapNode, state.config, { locate: false });
  stop.push(() => map.destroy());

  let me = null;
  const putMe = (at, heading) => {
    if (!at) return;
    if (!me) {
      me = map.marker({ at, html: pin('me'), anchor: 'center', zIndex: 30 });
      map.setView(at, Math.max(map.getZoom(), 15), { animate: false });
    } else {
      me.moveTo(at, { duration: 700, heading });
    }
  };
  putMe(ctx.tracker.at() || state.at, ctx.tracker.heading());

  /* ── переключатель ── */
  function paint() {
    const s = ctx.store.get();
    const on = !!s.online;
    toggle.classList.toggle('is-on', on);
    title.replaceChildren(
      document.createTextNode(on ? t('courier.online') : t('courier.offline')),
      el('span', { className: 'shift__note' },
        on ? t('courier.online_hint') : t('courier.offline_hint')));
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');

    const needGeo = on && !s.geoOk;
    geoBox.hidden = !needGeo;
    if (needGeo) {
      geoBox.replaceChildren(
        el('div', { className: 'grow' },
          el('b', null, t('courier.geo_off')),
          el('div', null, t('courier.geo_hint'))),
        el('button', {
          className: 'btn btn--sm btn--ghost',
          type: 'button',
          onClick: () => ctx.tracker.request(),
        }, t('courier.geo_retry')));
    }
  }

  toggle.addEventListener('click', async () => {
    if (toggle.classList.contains('is-loading')) return;
    const next = !ctx.store.get().online;
    haptic(next ? [12, 40, 18] : 12);
    spinner(toggle, true);
    try {
      const res = await api.post('/courier/online', { online: next });
      ctx.store.set({
        online: !!res.online,
        busy: !!res.busy,
        geoOk: !!res.geo_fresh,
        order: res.order || null,
      });
      if (res.message) toast(res.message, { type: 'warn', ms: 4500 });
      if (next) ctx.tracker.start();
      else ctx.tracker.stop();
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
    } finally {
      spinner(toggle, false);
      paint();
    }
  });

  /* ── итоги дня ── */
  function paintStats() {
    const s = ctx.store.get().stats;
    if (!s) {
      tilesBox.replaceChildren(
        tile(t('courier.earnings_today'), '—', 'accent'),
        tile(t('courier.orders_done'), '—'));
      return;
    }
    const today = s.today || {};
    tilesBox.replaceChildren(
      tile(t('courier.earnings_today'), money(today.earned || 0), 'accent'),
      tile(t('courier.orders_done'), num(today.orders || 0)),
      tile(t('courier.rating'), String(s.rating != null ? s.rating : 5).replace('.', ',')),
      tile(t('courier.earnings_week'), moneyShort((s.week || {}).earned || 0)));
  }

  paint();
  paintStats();

  stop.push(ctx.store.on(() => { paint(); paintStats(); }));
  stop.push(ctx.onFix((point) => putMe([point.lat, point.lng], point.heading)));

  // Свежие цифры по смене: экран смены открывают как раз затем, чтобы их увидеть.
  api.get('/courier/stats', { period: 'today' })
    .then((s) => ctx.store.set({ stats: s }))
    .catch(() => { /* показываем прочерки, тост здесь только помешает */ });

  return () => { for (const fn of stop) fn(); };
}

/* ─────────────────────────────────────────────────────── предложение заказа */

const RING_R = 53;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Полноэкранная карточка предложения с кольцом обратного отсчёта.
 * Возвращает {close}. onAnswer('accept'|'skip'|'gone') зовётся один раз.
 */
export function showOffer(box, offer, ctx, onAnswer) {
  const order = offer.order || {};
  const points = order.points || [];
  const lang = getLang();
  const tariff = order.tariff || {};
  const answered = { done: false };

  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [node, cls] of [[track, 'ring__track'], [bar, 'ring__bar']]) {
    node.setAttribute('class', cls);
    node.setAttribute('cx', '58');
    node.setAttribute('cy', '58');
    node.setAttribute('r', String(RING_R));
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke-width', '6');
  }
  bar.setAttribute('stroke-dasharray', RING_C.toFixed(1));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ring__svg');
  svg.setAttribute('viewBox', '0 0 116 116');
  svg.appendChild(track);
  svg.appendChild(bar);

  const left = el('span', { className: 'ring__left' });
  const accept = el('button', { className: 'ring__btn', type: 'button' },
    el('span', null, t('courier.accept')), left);
  const ring = el('div', { className: 'ring' }, svg, accept);

  const skip = el('button', { className: 'offer__skip', type: 'button' }, t('courier.decline'));

  const rows = el('div', { className: 'offer__rows' });
  for (let i = 0; i < points.length; i++) {
    rows.appendChild(pointRow(points[i], i, points.length, false));
  }

  const facts = el('div', { className: 'row wrap gap-2', style: { marginTop: 'var(--sp-4)' } });
  if (offer.to_pickup_m != null) {
    facts.appendChild(pill(ICONS.nav, t('courier.offer_distance') + ': ' + distance(offer.to_pickup_m)));
  }
  if (order.distance_m) facts.appendChild(pill(ICONS.job, distance(order.distance_m)));
  if (order.duration_s) facts.appendChild(pill(ICONS.clock, duration(order.duration_s)));
  if (order.loaders) facts.appendChild(pill(ICONS.me, tp(order.loaders, 'common.n_loader')));

  const extras = extrasText(order, ctx.store.get().config);
  if (extras) facts.appendChild(pill(ICONS.box, extras));

  const head = el('div', { className: 'offer__head' },
    el('div', null,
      el('div', { className: 'offer__kind' }, t('courier.new_order')),
      el('div', { className: 'muted t-sm' },
        (lang === 'ky' ? tariff.name_ky : tariff.name_ru) || '')),
    el('span', { className: 'badge badge--accent' }, order.public_id || ''));

  const pay = el('div', { className: 'offer__pay' },
    el('div', { className: 'offer__pay-k' }, t('courier.offer_pay')),
    el('div', { className: 'offer__pay-v' }, money(order.courier_payout || 0)),
    el('div', { className: 'offer__pay-note' },
      t('order.price_total') + ': ' + money(order.price_total || 0)));

  const body = el('div', { className: 'offer__body' }, head, pay, facts, rows);
  if (order.comment) {
    body.appendChild(el('div', { className: 'point__note', style: { marginTop: 'var(--sp-4)' } },
      t('courier.client_comment') + ': ' + order.comment));
  }

  box.replaceChildren(body, el('div', { className: 'offer__foot' }, skip, ring));
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t('courier.new_order'));
  box.tabIndex = -1;
  box.hidden = false;
  box.focus({ preventScroll: true });

  /* ── обратный отсчёт ── */
  const ttl = Math.max(1, offer.ttl_s || 30);
  const until = (offer.expires_at || 0) * 1000;
  let raf = 0;

  function tick() {
    const ms = until ? until - Date.now() : 0;
    const secs = Math.max(0, ms / 1000);
    const part = Math.max(0, Math.min(1, secs / ttl));
    bar.setAttribute('stroke-dashoffset', (RING_C * (1 - part)).toFixed(1));
    bar.classList.toggle('is-hot', secs <= 5);
    left.textContent = Math.ceil(secs) + (getLang() === 'ky' ? ' сек' : ' с');
    if (secs <= 0) {
      finish('gone');
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function finish(how, payload) {
    if (answered.done) return;
    answered.done = true;
    cancelAnimationFrame(raf);
    stopAlert();
    box.hidden = true;
    box.replaceChildren();
    if (onAnswer) onAnswer(how, payload);
  }

  accept.addEventListener('click', async () => {
    if (accept.disabled) return;
    haptic([18, 40, 24]);
    accept.disabled = true;
    skip.disabled = true;
    try {
      const res = await api.post('/courier/offers/' + offer.offer_id + '/accept');
      toast(t('courier.accepted'), { type: 'ok' });
      finish('accept', res);
    } catch (e) {
      const gone = e instanceof ApiError && (e.status === 409 || e.status === 404);
      toast((e && e.message) || t('courier.offer_gone'), { type: gone ? 'info' : 'err' });
      finish('gone');
    }
  });

  skip.addEventListener('click', async () => {
    if (skip.disabled) return;
    haptic();
    skip.disabled = true;
    accept.disabled = true;
    try {
      await api.post('/courier/offers/' + offer.offer_id + '/decline');
    } catch (e) { /* сервер и сам снимет предложение по таймеру */ }
    finish('skip');
  });

  startAlert();
  return { close: (how) => finish(how || 'gone'), offerId: offer.offer_id };
}

/* ─────────────────────────────────────────────────────── заказ в работе */

/* Куда идём дальше и что написано на большой кнопке. Порядок совпадает
   с тем, что разрешает сервер: назад по цепочке заказ не ходит. */
const FLOW = {
  assigned: { next: 'to_pickup', label: 'courier.to_pickup', now: 'courier.accepted' },
  to_pickup: { next: 'at_pickup', label: 'courier.arrived', now: 'courier.to_pickup' },
  at_pickup: { next: 'in_transit', label: 'courier.go', now: 'courier.start_loading' },
  in_transit: { next: 'at_dropoff', label: 'courier.at_dropoff', now: 'order.in_transit' },
  at_dropoff: { next: 'done', label: 'courier.finish', now: 'track.at_dropoff', swipe: true },
};

const WAITING_AT = ['at_pickup', 'at_dropoff'];

/** Полоса протяжки для последнего шага. onDone вызывается один раз. */
function swipeBar(label, onDone) {
  const fill = el('div', { className: 'swipe__fill' });
  const text = el('div', { className: 'swipe__text' }, label);
  const knob = el('div', { className: 'swipe__knob', html: ICONS.check });
  const box = el('div', {
    className: 'swipe', role: 'button', tabIndex: 0, 'aria-label': label,
  }, fill, text, knob);

  let pid = null, x0 = 0, span = 0, dx = 0, fired = false, t0 = 0;

  const draw = (value) => {
    knob.style.transform = 'translateX(' + value + 'px)';
    fill.style.width = (value + 60) + 'px';
  };

  const done = () => {
    if (fired) return;
    fired = true;
    box.classList.add('is-done');
    box.classList.remove('is-drag');
    knob.style.transform = 'translateX(' + span + 'px)';
    haptic([20, 60, 30]);
    onDone();
  };

  box.addEventListener('pointerdown', (e) => {
    if (fired || e.button) return;
    pid = e.pointerId;
    x0 = e.clientX;
    t0 = performance.now();
    span = Math.max(40, box.clientWidth - 60);
    box.classList.add('is-drag');
    try { box.setPointerCapture(pid); } catch (err) { /* мышь без захвата */ }
  });

  box.addEventListener('pointermove', (e) => {
    if (pid === null || e.pointerId !== pid) return;
    dx = Math.max(0, Math.min(span, e.clientX - x0));
    draw(dx);
  });

  const release = (e) => {
    if (pid === null || (e.pointerId !== undefined && e.pointerId !== pid)) return;
    pid = null;
    box.classList.remove('is-drag');
    // Три четверти пути — или резкий рывок больше чем на половину: случайным
    // касанием столько не проедешь, а нарочно получается с первого раза.
    const speed = dx / Math.max(1, performance.now() - t0);
    if (dx >= span * 0.75 || (dx >= span * 0.5 && speed > 0.9)) done();
    else { dx = 0; draw(0); }
  };
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', release);

  // С клавиатуры протянуть нечем, поэтому там обычное подтверждение вопросом.
  box.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (fired) return;
    if (await ask({ title: t('courier.finish'), text: t('courier.finish_confirm'), ok: t('common.done') })) {
      done();
    }
  });

  return box;
}

/**
 * Экран активного заказа: карта, клиент, адреса, деньги и главная кнопка.
 * ctx = {store, go, tracker, onFix, refresh}.
 */
export function renderJob(root, ctx) {
  const stop = [];
  const state = ctx.store.get();
  if (!state.order) {
    root.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty__icon', html: ICONS.box }),
      el('div', { className: 'empty__title' }, t('courier.no_order')),
      el('div', { className: 'empty__text' }, t('courier.offline_hint')),
      el('button', {
        className: 'btn btn--primary', type: 'button',
        style: { marginTop: 'var(--sp-3)' },
        onClick: () => ctx.go('/shift'),
      }, t('courier.shift'))));
    return () => {};
  }

  const mapNode = el('div', { className: 'job__map' });
  const statusRow = el('div', { className: 'job__status' });
  const clientBox = el('div', { className: 'job__client' });
  const pointsBox = el('div', { className: 'offer__rows' });
  const moneyBox = el('div', { className: 'job__money' });
  const waitBox = el('div', { className: 'wait' });
  const extrasBox = el('div', { className: 'row wrap gap-2' });

  const actBox = el('div', { className: 'act' });

  root.replaceChildren(el('div', { className: 'job' },
    statusRow, mapNode, clientBox, waitBox, extrasBox, pointsBox, moneyBox));
  root.appendChild(actBox);
  document.getElementById('app').classList.add('app--job');
  stop.push(() => document.getElementById('app').classList.remove('app--job'));

  /* ── карта: точки заказа, нитка между ними и своя машина ── */
  const map = makeMap(mapNode, state.config, { locate: false });
  stop.push(() => map.destroy());

  let carMarker = null;
  let line = null;
  const pointMarkers = [];

  function drawOrder(order) {
    for (const m of pointMarkers.splice(0)) m.remove();
    const coords = [];
    const points = order.points || [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.lat == null || p.lng == null) continue;
      coords.push([p.lat, p.lng]);
      const kind = i === 0 ? 'a' : 'b';
      const label = i === 0 ? '' : String(i);
      pointMarkers.push(map.marker({
        at: [p.lat, p.lng], html: pin(kind, label), anchor: 'bottom', zIndex: 10 + i,
      }));
    }
    if (coords.length >= 2) {
      if (line) line.setCoords(coords);
      else line = map.route(coords, { dashed: true, width: 5 });
    }
    const all = coords.slice();
    const at = ctx.tracker.at();
    if (at) all.push(at);
    if (all.length > 1) map.fitPoints(all, { padding: { top: 40, right: 40, bottom: 40, left: 40 } });
    else if (all.length === 1) map.setView(all[0], 15, { animate: false });
  }

  const putCar = (at, heading) => {
    if (!at) return;
    if (!carMarker) {
      carMarker = map.marker({
        at, html: pin('car'), anchor: 'center', zIndex: 40, rotate: true,
        heading: typeof heading === 'number' ? heading : 0,
      });
    } else {
      carMarker.moveTo(at, { duration: 800, heading });
    }
  };

  /* ── счётчик ожидания ── */
  let waitTimer = 0;

  function paintWait() {
    const order = ctx.store.get().order;
    const info = ctx.store.get().waiting || {};
    const canWait = order && WAITING_AT.indexOf(order.status) >= 0;
    waitBox.hidden = !canWait;
    if (!canWait) {
      if (waitTimer) clearInterval(waitTimer);
      waitTimer = 0;
      return;
    }
    const base = info.waiting_s || 0;
    const since = info.running && info.since ? info.since : 0;
    const shown = since ? base + Math.max(0, Math.floor(Date.now() / 1000) - since) : base;

    waitBox.classList.toggle('is-on', !!info.running);
    waitBox.replaceChildren(
      el('span', { html: ICONS.clock, className: 'none' }),
      el('div', { className: 'wait__body' },
        el('div', { className: 'wait__t' }, clock(shown)),
        el('div', { className: 'wait__note' },
          info.price_waiting
            ? t('track.waiting') + ': ' + money(info.price_waiting)
            : t('courier.waiting_free', { time: clock(shown) }))),
      el('button', {
        className: 'btn btn--sm ' + (info.running ? 'btn--danger' : 'btn--ghost'),
        type: 'button',
        onClick: () => toggleWait(info.running ? 'stop' : 'start'),
      }, info.running ? t('courier.waiting_stop') : t('courier.waiting_start')));

    if (info.running && !waitTimer) waitTimer = setInterval(paintWait, 1000);
    if (!info.running && waitTimer) { clearInterval(waitTimer); waitTimer = 0; }
  }
  stop.push(() => { if (waitTimer) clearInterval(waitTimer); });

  async function toggleWait(action) {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic();
    try {
      const res = await api.post('/courier/orders/' + order.id + '/waiting', { action });
      ctx.store.set({ waiting: res });
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err' });
    }
  }

  /* ── клиент, адреса, деньги ── */
  function paintOrder() {
    const order = ctx.store.get().order;
    if (!order) {
      ctx.go('/shift');
      return;
    }
    const points = order.points || [];
    const step = FLOW[order.status];

    statusRow.replaceChildren(
      el('span', { className: 'badge badge--accent' }, order.public_id || ''),
      el('span', { className: 'h3' }, step ? t(step.now) : t('track.done')),
      el('span', { className: 'ml-auto muted t-sm' },
        order.distance_m ? distance(order.distance_m) : ''));

    // Пока едем за грузом — перед глазами отправитель, после погрузки — получатель.
    const toPickup = ['assigned', 'to_pickup', 'at_pickup'].indexOf(order.status) >= 0;
    const contact = toPickup ? points[0] : points[points.length - 1];
    const who = (contact && contact.name) || t('track.courier');
    const tel = telHref(contact && contact.phone);
    clientBox.hidden = !contact;
    if (contact) {
      clientBox.replaceChildren(
        el('span', { className: 'avatar avatar--accent' }, initials(who) || '·'),
        el('div', { className: 'grow' },
          el('div', { className: 'job__client-name' }, who),
          el('div', { className: 'muted t-sm' },
            contact.phone ? fmtPhone(contact.phone) : (contact.addr || ''))),
        tel
          ? el('a', { className: 'btn btn--primary btn--icon', href: tel,
            'aria-label': t('courier.call_client'), html: ICONS.phone })
          : null);
    }

    const extras = extrasText(order, ctx.store.get().config);
    extrasBox.replaceChildren();
    if (order.loaders) extrasBox.appendChild(pill(ICONS.me, tp(order.loaders, 'common.n_loader')));
    if (extras) extrasBox.appendChild(pill(ICONS.box, extras));
    if (order.duration_s) extrasBox.appendChild(pill(ICONS.clock, duration(order.duration_s)));
    extrasBox.hidden = !extrasBox.children.length;

    pointsBox.replaceChildren();
    for (let i = 0; i < points.length; i++) {
      pointsBox.appendChild(pointRow(points[i], i, points.length, true));
    }
    if (order.comment) {
      pointsBox.appendChild(el('div', { className: 'point__note' },
        t('courier.client_comment') + ': ' + order.comment));
    }

    const paid = order.payment_status === 'paid';
    moneyBox.replaceChildren(
      el('div', { className: 'job__money-row' },
        el('span', null, t('track.price')),
        el('b', null, money(order.price_total || 0))),
      el('div', { className: 'job__money-row' },
        el('span', null, t('courier.commission')),
        el('b', null, money(order.commission || 0))),
      el('div', { className: 'job__money-row job__money-row--big' },
        el('span', null, t('courier.payout')),
        el('b', null, money(order.courier_payout || 0))),
      el('div', { className: 'job__money-row' },
        el('span', null, paid ? t('track.paid') : t('order.pay_cash')),
        el('b', null, paid ? money(order.paid_amount || order.price_total || 0)
          : money(order.price_total || 0))));

    paintAct(order);
    paintWait();
    drawOrder(order);
  }

  /* ── главная кнопка внизу ── */
  function paintAct(order) {
    const step = FLOW[order.status];
    if (!step) {
      actBox.replaceChildren(el('button', {
        className: 'btn btn--ghost btn--lg btn--block', type: 'button',
        onClick: () => ctx.go('/shift'),
      }, t('common.done')));
      return;
    }
    const label = t(step.label);
    if (step.swipe) {
      actBox.replaceChildren(
        el('span', { className: 'act__step' }, t('courier.finish_confirm')),
        swipeBar(label, () => move('done')));
      return;
    }
    actBox.replaceChildren(el('button', {
      className: 'btn btn--primary btn--lg btn--block',
      type: 'button',
      onClick: (e) => move(step.next, e.currentTarget),
    }, label));
  }

  async function move(target, btn) {
    const order = ctx.store.get().order;
    if (!order) return;
    haptic(16);
    if (btn) spinner(btn, true);
    try {
      const res = await api.post('/courier/orders/' + order.id + '/status', { status: target });
      ctx.store.set({ order: res.order || null, waiting: res.waiting || null });
      if (target === 'done') {
        if (typeof ctx.finished === 'function') ctx.finished(order.id);
        ctx.store.set({ order: null, busy: false });
        showResult(res.price || {}, order);
        ctx.refresh();
        ctx.go('/shift');
      }
    } catch (e) {
      toast((e && e.message) || t('err.unknown'), { type: 'err', ms: 4500 });
      ctx.refresh();
    } finally {
      if (btn) spinner(btn, false);
    }
  }

  /* Итог заказа: сколько взять с клиента и сколько осталось курьеру. */
  function showResult(price, order) {
    const collect = price.to_collect != null
      ? price.to_collect
      : Math.max(0, (price.total || 0) - (price.paid || 0));
    sheet({
      title: t('track.done'),
      content: el('div', { className: 'col gap-3' },
        el('div', { className: 'offer__pay' },
          el('div', { className: 'offer__pay-k' }, t('courier.payout')),
          el('div', { className: 'offer__pay-v' }, money(price.payout || 0))),
        collect > 0
          ? el('p', { className: 'sheet__text' }, t('courier.cash_note', { price: money(collect) }))
          : el('p', { className: 'sheet__text' }, t('track.paid')),
        el('div', { className: 'list' },
          el('div', { className: 'list__row' },
            el('span', { className: 'grow muted t-sm' }, t('order.price_total')),
            el('b', null, money(price.total || 0))),
          el('div', { className: 'list__row' },
            el('span', { className: 'grow muted t-sm' }, t('courier.commission')),
            el('b', null, money(price.commission || 0))),
          price.waiting_s
            ? el('div', { className: 'list__row' },
              el('span', { className: 'grow muted t-sm' }, t('track.waiting')),
              el('b', null, clock(price.waiting_s)))
            : null)),
      actions: [{ label: t('common.ok'), kind: 'primary' }],
    });
    haptic([20, 60, 20, 60, 30]);
  }

  paintOrder();
  putCar(ctx.tracker.at(), ctx.tracker.heading());

  stop.push(ctx.store.select((s) => s.order, () => paintOrder()));
  stop.push(ctx.store.select((s) => s.waiting, () => paintWait()));
  stop.push(ctx.onFix((point) => putCar([point.lat, point.lng], point.heading)));

  // Ожидание после перезапуска приложения знает только сервер — спрашиваем его.
  api.get('/courier/orders/' + state.order.id)
    .then((res) => ctx.store.set({ order: res.order || null, waiting: res.waiting || null }))
    .catch(() => { /* экран уже нарисован тем, что было в памяти */ });

  return () => { for (const fn of stop) fn(); };
}

/* ─────────────────────────────────────────────────────── история и деньги */

const PERIODS = [
  ['today', 'common.today'],
  ['week', 'common.week'],
  ['month', 'common.month'],
];

export function renderHistory(root, ctx) {
  let period = ctx.store.get().period || 'today';
  let alive = true;

  const seg = el('div', { className: 'segmented seg-wrap' });
  const sum = el('div', { className: 'hist__sum' });
  const list = el('div', { className: 'list' });

  root.replaceChildren(el('div', { className: 'hist' }, seg, sum, list));

  function paintSeg() {
    seg.replaceChildren(...PERIODS.map(([code, key]) => el('button', {
      className: 'segmented__i' + (code === period ? ' is-on' : ''),
      type: 'button',
      onClick: () => {
        if (code === period) return;
        period = code;
        ctx.store.set({ period: code });
        haptic();
        paintSeg();
        load();
      },
    }, t(key))));
  }

  function paintSummary(s) {
    sum.replaceChildren(
      el('div', { className: 'hist__sum-k' }, t('courier.payout')),
      el('div', { className: 'hist__sum-v' }, money(s.earned || 0)),
      el('div', { className: 'hist__sum-row' },
        el('div', { className: 'hist__sum-cell' },
          el('b', null, num(s.orders || 0)),
          el('span', null, t('courier.orders_done'))),
        el('div', { className: 'hist__sum-cell' },
          el('b', null, moneyShort(s.cash || 0)),
          el('span', null, t('order.pay_cash'))),
        el('div', { className: 'hist__sum-cell' },
          el('b', null, moneyShort(s.commission || 0)),
          el('span', null, t('courier.commission')))));
  }

  function paintList(items) {
    if (!items.length) {
      list.replaceChildren(el('div', { className: 'empty' },
        el('div', { className: 'empty__icon', html: ICONS.hist }),
        el('div', { className: 'empty__title' }, t('courier.history_empty')),
        el('div', { className: 'empty__text' }, t('courier.offline_hint'))));
      return;
    }
    list.replaceChildren(...items.map((o) => {
      const when = o.done_at || o.cancelled_at || o.created_at;
      const cancelled = o.status === 'cancelled';
      return el('div', { className: 'list__row hist__row' },
        el('div', { className: 'hist__when' }, time(when)),
        el('div', { className: 'hist__where' },
          el('div', { className: 'hist__addr truncate' }, o.from || '—'),
          el('div', { className: 'hist__addr truncate' }, o.to || '—'),
          el('div', { className: 'muted t-xs truncate' },
            [date(when), o.tariff, o.distance_m ? distance(o.distance_m) : null]
              .filter(Boolean).join(' · '))),
        el('div', { className: 'hist__pay' },
          cancelled ? '—' : money(o.courier_payout || 0),
          el('small', null, cancelled ? t('track.cancelled') : o.public_id)));
    }));
  }

  async function load() {
    list.replaceChildren(el('div', { className: 'list__row' },
      el('div', { className: 'skeleton grow' })));
    try {
      const res = await api.get('/courier/orders', { period, per_page: 50 });
      if (!alive) return;
      paintSummary(res.summary || {});
      paintList(res.items || []);
    } catch (e) {
      if (!alive) return;
      list.replaceChildren(el('div', { className: 'empty' },
        el('div', { className: 'empty__title' }, t('err.load_failed')),
        el('button', {
          className: 'btn btn--ghost', type: 'button', onClick: load,
        }, t('common.retry'))));
    }
  }

  paintSeg();
  paintSummary({});
  load();

  return () => { alive = false; };
}

/* ─────────────────────────────────────────────────────── профиль */

export function renderProfile(root, ctx) {
  const state = ctx.store.get();
  const user = state.user || {};
  const profile = user.courier || {};
  const car = profile.car || {};
  const body = profile.body || {};

  const starsBox = el('div');
  const head = el('div', { className: 'me__head' },
    el('span', { className: 'avatar avatar--lg avatar--accent' }, initials(user.name) || '·'),
    el('div', { className: 'grow' },
      el('div', { className: 'me__name' }, user.name || ''),
      el('div', { className: 'me__row' },
        starsBox,
        el('span', null, String(profile.rating != null ? profile.rating : 5).replace('.', ',')),
        el('span', { className: 'muted-2' },
          '· ' + tp(profile.orders_done || 0, 'common.n_order')))));

  const carList = el('div', { className: 'list' },
    kv(t('courier.car_model'), car.model || '—'),
    kv(t('courier.car_plate'), car.plate ? fmtPlate(car.plate) : '—'),
    kv(t('courier.car_color'), car.color || '—'),
    kv(t('courier.vehicle_class'), profile.vehicle_class || '—'),
    kv(t('courier.capacity'), profile.capacity_kg ? num(profile.capacity_kg) + ' ' + t('common.kg') : '—'),
    kv(t('courier.body'), (body.d && body.w && body.h)
      ? body.d + ' × ' + body.w + ' × ' + body.h : '—'));

  const meList = el('div', { className: 'list' },
    kv(t('common.email'), user.email || '—'),
    kv(t('common.phone'), user.phone ? fmtPhone(user.phone) : '—'),
    kv(t('courier.acceptance'), profile.acceptance != null
      ? Math.round(profile.acceptance * 100) + '%' : '—'),
    kv(t('courier.balance'), money(profile.balance || 0)));

  const themeSeg = el('div', { className: 'segmented seg-wrap' });
  function paintTheme() {
    const now = getTheme();
    themeSeg.replaceChildren(...[
      ['dark', 'common.theme_dark'],
      ['light', 'common.theme_light'],
      ['auto', 'common.theme_auto'],
    ].map(([code, key]) => el('button', {
      className: 'segmented__i' + (code === now ? ' is-on' : ''),
      type: 'button',
      onClick: () => { applyTheme(code); paintTheme(); haptic(); ctx.refreshTheme(); },
    }, t(key))));
  }
  paintTheme();

  const langSeg = el('div', { className: 'segmented seg-wrap' });
  function paintLang() {
    const now = getLang();
    langSeg.replaceChildren(...[
      ['ru', 'common.lang_ru'],
      ['ky', 'common.lang_ky'],
    ].map(([code, key]) => el('button', {
      className: 'segmented__i' + (code === now ? ' is-on' : ''),
      type: 'button',
      onClick: () => { ctx.setLang(code); },
    }, t(key))));
  }
  paintLang();

  root.replaceChildren(el('div', { className: 'me' },
    head,
    el('div', { className: 'me__sect' }, t('common.profile')),
    meList,
    el('button', {
      className: 'btn btn--ghost btn--block', type: 'button', onClick: () => editMe(ctx),
    }, t('common.edit')),

    el('div', { className: 'me__sect' }, t('courier.car')),
    carList,
    el('button', {
      className: 'btn btn--ghost btn--block', type: 'button', onClick: () => editCar(ctx),
    }, t('common.edit')),

    el('div', { className: 'me__sect' }, t('common.settings')),
    el('div', { className: 'col gap-3' },
      el('div', { className: 'muted t-sm' }, t('common.theme')), themeSeg,
      el('div', { className: 'muted t-sm' }, t('common.language')), langSeg),

    el('button', {
      className: 'btn btn--ghost btn--block', type: 'button', onClick: () => editPassword(ctx),
    }, t('common.password')),

    el('button', {
      className: 'btn btn--danger btn--block', type: 'button',
      style: { marginTop: 'var(--sp-2)' },
      onClick: async () => {
        if (await ask({ title: t('courier.logout_confirm'), ok: t('common.logout'), danger: true })) {
          ctx.logout();
        }
      },
    }, el('span', { html: ICONS.out }), t('common.logout'))));

  mountStars(starsBox, { value: profile.rating != null ? profile.rating : 5, readonly: true });

  return () => {};
}

/* ── правка профиля ─────────────────────────────────────────────────────── */

function textField(label, value, opts = {}) {
  const input = el('input', Object.assign({
    className: 'field__input', type: 'text', placeholder: ' ', value: value || '',
  }, opts.input || {}));
  const wrap = el('label', { className: 'field' },
    input, el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null);
  return { input, wrap };
}

async function save(ctx, patch) {
  const res = await api.patch('/auth/me', patch);
  ctx.store.set({ user: res.user || res });
  toast(t('courier.profile_saved'), { type: 'ok' });
  return true;
}

function editMe(ctx) {
  const user = ctx.store.get().user || {};
  const name = textField(t('courier.name'), user.name, { input: { autocomplete: 'name', maxLength: 80 } });
  const tel = textField(t('common.phone'), user.phone,
    { input: { type: 'tel', inputMode: 'tel', autocomplete: 'tel' }, hint: t('common.phone_ph') });

  sheet({
    title: t('common.profile'),
    content: el('div', { className: 'col gap-3' }, name.wrap, tel.wrap),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          const patch = {
            name: String(name.input.value || '').trim(),
            phone: String(tel.input.value || '').trim(),
          };
          if (!patch.name) { toast(t('err.field_required'), { type: 'err' }); return false; }
          try {
            return await save(ctx, patch);
          } catch (e) {
            toast((e && e.message) || t('err.save_failed'), { type: 'err' });
            return false;
          }
        },
      },
    ],
  });
}

function editCar(ctx) {
  const profile = (ctx.store.get().user || {}).courier || {};
  const car = profile.car || {};
  const body = profile.body || {};

  const model = textField(t('courier.car_model'), car.model, { input: { maxLength: 60 } });
  const plate = textField(t('courier.car_plate'), car.plate, { input: { maxLength: 12 } });
  const color = textField(t('courier.car_color'), car.color, { input: { maxLength: 30 } });
  const cap = textField(t('courier.capacity'), profile.capacity_kg,
    { input: { type: 'number', inputMode: 'numeric', min: 1, max: 20000 } });
  const d = textField(t('courier.body_d'), body.d, { input: { type: 'number', inputMode: 'numeric' } });
  const w = textField(t('courier.body_w'), body.w, { input: { type: 'number', inputMode: 'numeric' } });
  const h = textField(t('courier.body_h'), body.h, { input: { type: 'number', inputMode: 'numeric' } });

  bindPlate(plate.input);

  sheet({
    title: t('courier.car'),
    content: el('div', { className: 'col gap-3' },
      model.wrap, plate.wrap, color.wrap, cap.wrap,
      el('div', { className: 'gate__trio' }, d.wrap, w.wrap, h.wrap)),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          const patch = {
            car_model: String(model.input.value || '').trim(),
            car_plate: String(plate.input.value || '').trim(),
            car_color: String(color.input.value || '').trim(),
          };
          for (const [key, ref] of [['capacity_kg', cap], ['body_d', d], ['body_w', w], ['body_h', h]]) {
            const n = parseInt(ref.input.value, 10);
            if (isFinite(n) && n > 0) patch[key] = n;
          }
          if (!patch.car_model || !patch.car_plate) {
            toast(t('err.field_required'), { type: 'err' });
            return false;
          }
          try {
            return await save(ctx, patch);
          } catch (e) {
            toast((e && e.message) || t('err.save_failed'), { type: 'err' });
            return false;
          }
        },
      },
    ],
  });
}

function editPassword(ctx) {
  // Этих двух фраз нет в общем словаре — они нужны только здесь.
  const ky = getLang() === 'ky';
  const nowLabel = ky ? 'Учурдагы сырсөз' : 'Текущий пароль';
  const rule = ky ? 'Сегиз белгиден кем эмес' : 'Не короче восьми символов';
  const now = textField(nowLabel, '', { input: { type: 'password', autocomplete: 'current-password' } });
  const next = textField(t('courier.password'), '',
    { input: { type: 'password', autocomplete: 'new-password' }, hint: rule });

  sheet({
    title: t('common.password'),
    content: el('div', { className: 'col gap-3' }, now.wrap, next.wrap),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      {
        label: t('common.save'), kind: 'primary',
        onClick: async () => {
          const password = String(next.input.value || '');
          if (password.length < 8) {
            toast(t('err.password_short'), { type: 'err' });
            return false;
          }
          try {
            await api.patch('/auth/me', {
              password, current_password: String(now.input.value || ''),
            });
            toast(t('courier.profile_saved'), { type: 'ok' });
            return true;
          } catch (e) {
            toast((e && e.message) || t('err.save_failed'), { type: 'err' });
            return false;
          }
        },
      },
    ],
  });
}

export default {
  renderShift, renderJob, renderHistory, renderProfile,
  showOffer, createGeoTracker, startAlert, stopAlert, unlockAudio,
  getTheme, applyTheme, bindPlate, ICONS,
};
