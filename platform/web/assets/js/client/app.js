/* Клиентское приложение: карта во весь экран и шторка снизу.

   Здесь собрана оболочка — настройки сервиса, карта, шторка с переходами между
   шагами, язык, тема и маршрутизация. Сами экраны живут в order.js и track.js, а
   поиск адреса в address.js; оболочка передаёт им объект app со всем, что нужно.

   Ещё оболочка помнит человека. Регистрации у клиента нет и не будет: телефон,
   имя и постоянный ключ клиента лежат в localStorage под ключом sg_client, ключ
   выдаёт сервер тому, кто предъявил свой заказ вместе с токеном отслеживания.
   Отсюда же открывается профиль с историей заказов — не отдельной страницей, а
   шторкой поверх карты, чтобы наполовину набранный заказ под ней остался цел.

   Всё общение с сервером идёт через core/api.js, тексты — только через t().
*/

import { api } from '../core/api.js';
import {
  t, tp, has, setLang, getLang, onLangChange, applyTo, extend, LANGS,
} from '../core/i18n.js';
import { createMap, pin } from '../core/map.js';
import { el, toast, sheet, confirm, haptic, skeleton, mountStars } from '../core/ui.js';
import { createRouter } from '../core/router.js';
import {
  setTimeZone, money, distance, duration, dateTime, date as fmtDate,
  phone as fmtPhone, plate as fmtPlate, initials,
} from '../core/fmt.js';
import { mountOrder } from './order.js';
import { mountTrack } from './track.js';

/* Свои строки: в общий словарь их не тащим, там правки соседних модулей.
   Кыргызский — как говорят в Бишкеке, а не как переводит машина. */
extend({
  ru: {
    'me.noname': 'Без имени',
    'me.name_ph': 'Как к вам обращаться',
    'me.phone_note': 'Номер меняется вместе с новым заказом',
    'me.since': 'С нами с {date}',
    'me.orders': 'Всего заказов',
    'me.done': 'Довезли',
    'me.spent': 'Потрачено',
    'me.rating': 'Как вас оценивают',
    'me.no_rating': 'Оценок пока нет',
    'me.history': 'История заказов',
    'me.live_now': 'Заказ в работе',
    'me.watch': 'Смотреть на карте',
    'me.empty_title': 'Заказов пока нет',
    'me.empty_text': 'Первый заказ появится здесь сразу после поездки.',
    'me.load_more': 'Показать ещё',
    'me.unknown': 'Список заказов откроется, когда вы оформите заказ с этого телефона.',
    'me.card': 'Заказ {id}',
    'me.points': 'Адреса',
    'me.car': 'Машина',
    'me.pay': 'Оплата',
    'me.rated': 'Ваша оценка заказу',
    'me.not_rated': 'Заказ не оценён',
    'me.repeated': 'Берём те же адреса',
    'me.forget': 'Забыть меня',
    'me.forget_q': 'Забыть этот телефон?',
    'me.forget_text': 'С этого устройства пропадут имя, номер и список заказов. '
      + 'Сами заказы никуда не денутся — открыть их снова можно по ссылке из смс.',
    'me.forget_ok': 'Забыть',
    'me.forgot': 'Готово. Больше мы вас не помним',
    'me.support_call': 'Позвонить в поддержку',
    'me.wa_hello': 'Здравствуйте! У меня вопрос по заказу машины.',
  },
  ky: {
    'me.noname': 'Аты жок',
    'me.name_ph': 'Сизди кантип атайбыз',
    'me.phone_note': 'Номер жаңы заказ менен кошо өзгөрөт',
    'me.since': '{date} тартып биз менен',
    'me.orders': 'Бардык заказдар',
    'me.done': 'Жеткирилди',
    'me.spent': 'Төлөнгөн сумма',
    'me.rating': 'Сизди кандай баалашат',
    'me.no_rating': 'Азырынча баа жок',
    'me.history': 'Заказдардын тарыхы',
    'me.live_now': 'Заказ иштеп жатат',
    'me.watch': 'Картадан көрүү',
    'me.empty_title': 'Азырынча заказ жок',
    'me.empty_text': 'Биринчи заказ сапардан кийин ушул жерден көрүнөт.',
    'me.load_more': 'Дагы көрсөтүү',
    'me.unknown': 'Заказдардын тизмеси ушул телефондон заказ бергенде ачылат.',
    'me.card': 'Заказ {id}',
    'me.points': 'Даректер',
    'me.car': 'Унаа',
    'me.pay': 'Төлөм',
    'me.rated': 'Заказга койгон бааңыз',
    'me.not_rated': 'Заказга баа коюлган жок',
    'me.repeated': 'Ошол эле даректерди алабыз',
    'me.forget': 'Мени унутуңуз',
    'me.forget_q': 'Бул телефонду унутабызбы?',
    'me.forget_text': 'Бул түзмөктөн атыңыз, номериңиз жана заказдар тизмеси өчөт. '
      + 'Заказдардын өзү жоголбойт — смстеги шилтеме менен кайра ачса болот.',
    'me.forget_ok': 'Унутуу',
    'me.forgot': 'Болду. Эми сизди эстебейбиз',
    'me.support_call': 'Колдоо кызматына чалуу',
    'me.wa_hello': 'Саламатсызбы! Унаа заказы боюнча суроом бар.',
  },
});

/* Ключи в localStorage: активный заказ, память о человеке, недавние адреса, тема.
   KEY_ME остался от первой версии — он ещё читается один раз, при переносе. */
export const KEY_ORDER = 'sg_order';
export const KEY_ME = 'sg_me';
export const KEY_CLIENT = 'sg_client';
export const KEY_RECENT = 'sg_recent';
export const KEY_THEME = 'sg_theme';

const HISTORY_PAGE = 20;
const NEAR_BOTTOM = 260;      // за сколько пикселей до конца списка просим следующую страницу
const RECENT_MAX = 8;         // столько адресов помнит поиск (столько же, сколько address.js)
const CLAIM_RETRY_S = 120;    // ключ клиента не дался — не долбим сервер чаще, чем раз в две минуты

/* Коды ошибок, у которых имя в словаре не совпадает с кодом сервера. */
const ERR_ALIAS = {
  server_error: 'server',
  http_500: 'server',
  http_502: 'server',
  http_503: 'server',
  bad_json: 'bad_request',
  stream: 'network',
};

/* Цвет метки статуса в истории: зелёный — довезли, красный — не состоялось,
   синий — едет прямо сейчас, жёлтый — ещё ищем машину. */
const STATUS_TONE = {
  done: 'ok',
  cancelled: 'err',
  expired: 'err',
  draft: 'warn',
  searching: 'warn',
  assigned: 'info',
  to_pickup: 'info',
  at_pickup: 'info',
  in_transit: 'info',
  at_dropoff: 'info',
};

/* Статусы, при которых заказ ещё живой и его стоит открыть на карте. */
const LIVE_STATUSES = ['draft', 'searching', 'assigned', 'to_pickup',
  'at_pickup', 'in_transit', 'at_dropoff'];

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

/* ─────────────────────────────────────────────────────── память о человеке */

/** Что мы помним: {phone, name, token, photo}. Пустой объект — человек новый. */
export function readClient() {
  const saved = readJson(KEY_CLIENT);
  if (saved && typeof saved === 'object') return saved;
  // Первая версия держала телефон с именем под другим ключом. Переносим один
  // раз и старый ключ убираем, чтобы не остаться с двумя разными правдами.
  const old = readJson(KEY_ME);
  if (old && typeof old === 'object' && (old.phone || old.name)) {
    const moved = { phone: old.phone || '', name: old.name || '' };
    writeJson(KEY_CLIENT, moved);
    writeJson(KEY_ME, null);
    return moved;
  }
  return {};
}

/**
 * Дописать то, что узнали. undefined значит «не трогай это поле», пустая строка
 * и null — «забудь». Разница важная: человек мог стереть имя нарочно, а мог
 * просто прислать патч, где имени нет вовсе.
 */
export function saveClient(patch) {
  const next = readClient();
  for (const key of Object.keys(patch || {})) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value === '') delete next[key];
    else next[key] = value;
  }
  writeJson(KEY_CLIENT, next);
  paintProfileButton();
  return next;
}

/** «Забыть меня»: с устройства уходит всё, что могло указать на человека. */
export function forgetClient() {
  writeJson(KEY_CLIENT, null);
  writeJson(KEY_ME, null);
  writeJson(KEY_ORDER, null);
  writeJson(KEY_RECENT, null);
  paintProfileButton();
}

export function clientToken() {
  return readClient().token || '';
}

let claiming = null;      // запрос за ключом уже в пути — второй не нужен
let claimAfter = 0;       // раньше этой секунды не пробуем снова

/**
 * Постоянный ключ клиента. Сервер выдаёт его тому, кто доказал, что заказ его:
 * нужны телефон, номер заказа и токен отслеживания. Всё это у нас есть сразу
 * после оформления, поэтому ключ забираем молча и в фоне — человека это не
 * касается, а без ключа не откроется ни профиль, ни история.
 */
export function ensureClientToken() {
  const me = readClient();
  if (me.token) return Promise.resolve(me.token);
  if (claiming) return claiming;

  const order = readJson(KEY_ORDER);
  const now = Math.floor(Date.now() / 1000);
  if (!me.phone || !order || !order.pid || !order.token || now < claimAfter) {
    return Promise.resolve('');
  }

  claiming = api.post('/client/claim', {
    phone: me.phone, order_id: order.pid, track_token: order.token,
  }, { auth: false }).then((res) => {
    const token = (res && res.token) || '';
    if (token) saveClient({ token, name: (res.profile && res.profile.name) || me.name });
    return token;
  }).catch(() => {
    // Сервер отказал или связи нет: подождём и попробуем со следующим заказом.
    claimAfter = Math.floor(Date.now() / 1000) + CLAIM_RETRY_S;
    return '';
  }).then((token) => {
    claiming = null;
    return token;
  });

  return claiming;
}

/* Адрес из истории кладём в «недавние» — так «Повторить заказ» помогает даже
   на шаге поиска адреса, а не только подстановкой в новый заказ. */
function rememberRecent(points) {
  const key = (p) => (p.addr || '') + '|' + Number(p.lat).toFixed(4) + Number(p.lng).toFixed(4);
  const fresh = (points || [])
    .filter((p) => p && p.addr && p.lat != null && p.lng != null)
    .map((p) => ({
      addr: p.addr, subtitle: p.subtitle || '', lat: p.lat, lng: p.lng,
    }));
  if (!fresh.length) return;
  const was = readJson(KEY_RECENT, []);
  const list = (Array.isArray(was) ? was : [])
    .filter((p) => p && p.lat != null && !fresh.some((f) => key(f) === key(p)));
  writeJson(KEY_RECENT, fresh.concat(list).slice(0, RECENT_MAX));
}

/* ─────────────────────────────────────────────────────── тема */

const THEMES = ['auto', 'dark', 'light'];
const lightMedia = window.matchMedia('(prefers-color-scheme: light)');
const themeWatchers = new Set();

export function getTheme() {
  const saved = readJson(KEY_THEME);
  return THEMES.indexOf(saved) >= 0 ? saved : 'auto';
}

/** Светло ли сейчас на самом деле: «как в системе» спрашиваем у системы. */
export function isLightNow() {
  const mode = getTheme();
  return mode === 'light' || (mode === 'auto' && lightMedia.matches);
}

/** Выбор темы. 'auto' убирает атрибут и отдаёт решение системе. */
export function setTheme(mode) {
  const next = THEMES.indexOf(mode) >= 0 ? mode : 'auto';
  writeJson(KEY_THEME, next === 'auto' ? null : next);
  applyTheme();
  return next;
}

function applyTheme() {
  const mode = getTheme();
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  const light = isLightNow();
  for (const fn of Array.from(themeWatchers)) {
    try {
      fn(light);
    } catch (e) {
      console.error('[theme]', e);
    }
  }
}

export function onThemeChange(fn) {
  if (typeof fn !== 'function') return () => {};
  themeWatchers.add(fn);
  return () => themeWatchers.delete(fn);
}

// Тему ставим до первой отрисовки: иначе светлый экран успеет мигнуть тёмным.
applyTheme();
if (lightMedia.addEventListener) {
  lightMedia.addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme();
  });
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

/** «4.7» → «4,7». Дробная часть показывается, только если она есть. */
function rate(value) {
  const v = Math.round((Number(value) || 0) * 10) / 10;
  return String(v).replace('.', ',');
}

/** Название статуса: из словаря, а если ключа нет — то, что прислал сервер. */
function statusName(item) {
  const key = 'status.' + item.status;
  return has(key) ? t(key) : (item.status_name || item.status || '');
}

function statusBadge(item) {
  const tone = STATUS_TONE[item.status] || '';
  return el('span', { className: 'badge' + (tone ? ' badge--' + tone : '') }, statusName(item));
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
  user: '<circle cx="12" cy="8.4" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 20.2c.6-3.8 3.6-5.8 7.2-5.8s6.6 2 7.2 5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  list: '<path d="M8.4 6.6h11M8.4 12h11M8.4 17.4h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4.6" cy="6.6" r="1.4" fill="currentColor"/><circle cx="4.6" cy="12" r="1.4" fill="currentColor"/><circle cx="4.6" cy="17.4" r="1.4" fill="currentColor"/>',
  star: '<path d="M12 17.1l-5.3 3.1 1.4-6L3.4 10l6.1-.5L12 3.9l2.5 5.6 6.1.5-4.7 4.2 1.4 6z" fill="currentColor"/>',
  wa: '<path d="M12 3.4a8.5 8.5 0 0 0-7.3 12.8L3.4 20.6l4.5-1.2A8.5 8.5 0 1 0 12 3.4zm4.7 11.9c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1a12 12 0 0 1-5.2-4.5c-.4-.6-.7-1.3-.7-2 0-.7.4-1.2.6-1.4.2-.2.4-.3.6-.3h.4c.2 0 .3 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.3.4c-.1.1-.2.3-.1.5.3.5.7 1.1 1.2 1.6.6.5 1.1.8 1.6 1 .2.1.4 0 .5-.1l.5-.6c.1-.2.3-.2.5-.1l1.5.8c.2.1.3.2.3.3 0 .1 0 .5-.2.8z" fill="currentColor"/>',
  trash: '<path d="M5.6 7.2h12.8M9.4 7.2V5.6c0-.6.5-1.1 1.1-1.1h3c.6 0 1.1.5 1.1 1.1v1.6M7.2 7.2l.8 11.2c0 .6.5 1.1 1.1 1.1h5.8c.6 0 1.1-.5 1.1-1.1l.8-11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
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

/* Иконка отдельным узлом заданного размера. Размер ставим атрибутами самому svg:
   там, где у контейнера нет своего правила для svg, браузер растянет картинку
   до 300×150 и разнесёт вёрстку. */
function iconNode(name, size) {
  const box = el('span', {
    html: icon(name),
    style: { display: 'block', width: size + 'px', height: size + 'px' },
  });
  const svg = box.firstElementChild;
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  return box;
}

/* ─────────────────────────────────────────────────────── кнопка профиля */

let profileBtn = null;

/* Кружок справа сверху. У нового человека его нет: показывать пустой профиль
   тому, кто зашёл впервые, — только пугать лишней кнопкой. */
function makeProfileButton(onOpen) {
  // Если кнопка уже стоит в разметке — берём её, а не заводим вторую такую же.
  const ready = document.getElementById('profile-btn');
  if (ready) {
    ready.addEventListener('click', () => { haptic(); onOpen(); });
    ready.hidden = true;
    return ready;
  }

  const btn = el('button', {
    type: 'button',
    id: 'profile-btn',
    className: 'avatar no-sel sg-profile',
    // Своих правил в client.css у кнопки нет — её правит другой модуль, поэтому
    // размер и тень задаём здесь: 44 px под палец и та же подложка, что у языка.
    style: {
      width: '44px', height: '44px', fontSize: '16px',
      background: 'var(--surface)', boxShadow: 'var(--shadow-2)', cursor: 'pointer',
    },
    onClick: () => { haptic(); onOpen(); },
  });
  btn.hidden = true;

  const lang = document.getElementById('lang-switch');
  const top = document.querySelector('.sg-top');
  if (lang && lang.parentNode) {
    // Язык и профиль встают одной связкой: в шапке space-between, и три
    // самостоятельных ребёнка расползлись бы по углам.
    const side = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
    });
    lang.parentNode.insertBefore(side, lang);
    side.appendChild(lang);
    side.appendChild(btn);
  } else if (top) {
    top.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
  return btn;
}

function paintProfileButton() {
  if (!profileBtn) return;
  const me = readClient();
  const known = !!(me.phone || me.token);
  profileBtn.hidden = !known;
  if (!known) return;
  const label = me.name ? t('common.profile') + ': ' + me.name : t('common.profile');
  profileBtn.setAttribute('aria-label', label);
  profileBtn.title = label;
  if (me.photo) {
    profileBtn.replaceChildren(el('img', { src: me.photo, alt: '' }));
  } else {
    const short = initials(me.name);
    profileBtn.replaceChildren(short
      ? document.createTextNode(short)
      : iconNode('user', 22));
  }
}

/* ─────────────────────────────────────────────────────── кирпичики профиля */

/* Шапка вида. Липкая: список заказов длинный, а кнопка «назад» должна
   оставаться под большим пальцем, куда бы человек ни прокрутил. */
function viewHead(title, sub, onBack, onClose) {
  const close = onClose ? iconBtn('close', 'sg-back', t('common.close'), onClose) : null;
  if (close) close.style.marginLeft = '0';   // отрицательный отступ у .sg-back — для левого края
  return el('div', {
    className: 'sg-head',
    style: {
      position: 'sticky', top: '0', zIndex: '3',
      background: 'var(--surface)', padding: 'var(--sp-1) 0 var(--sp-3)',
    },
  },
    onBack ? iconBtn('back', 'sg-back', t('common.back'), onBack) : null,
    el('div', { className: 'sg-head__text' },
      el('div', { className: 'sg-head__title truncate' }, title),
      sub ? el('div', { className: 'sg-head__sub' }, sub) : null),
    close);
}

function group(title) {
  return el('div', { className: 'sg-group' }, title);
}

/** Строка «название — значение», как в разбивке цены. */
function sumRow(name, value, total) {
  return el('div', { className: 'sg-sum' + (total ? ' sg-sum--total' : '') },
    el('span', { className: 'sg-sum__name' }, name),
    el('span', { className: 'sg-sum__val' }, value));
}

/* Поле с плавающей меткой: метка идёт после поля, её поднимает соседний
   селектор в components.css — без единой строчки скрипта. */
function textField(label, value, opts = {}) {
  const input = el('input', {
    className: 'field__input',
    type: opts.type || 'text',
    placeholder: ' ',
    value: value || '',
    autocomplete: opts.autocomplete || 'off',
    enterkeyhint: 'done',
    maxLength: opts.maxLength || 80,
    disabled: !!opts.disabled,
  });
  const node = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null);
  return { node, input };
}

/* Переключатель из нескольких кнопок. Высоту поднимаем до 44 px: базовые
   34 px в components.css рассчитаны на мышь, а здесь палец. */
function segmented(items, active, onPick) {
  const box = el('div', { className: 'segmented' });
  for (const item of items) {
    const on = item.value === active;
    box.appendChild(el('button', {
      type: 'button',
      className: 'segmented__i' + (on ? ' is-on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      style: { minHeight: '44px' },
      onClick: () => { if (!on) { haptic(); onPick(item.value); } },
    }, item.label));
  }
  return box;
}

/** Строка списка с иконкой: ведёт куда-то или звонит. */
function linkRow(iconName, title, sub, opts = {}) {
  const kids = [
    el('span', { className: 'sg-item__icon' + (opts.accent ? ' sg-item__icon--accent' : ''), html: icon(iconName) }),
    el('span', { className: 'sg-item__text' },
      el('span', { className: 'sg-item__title' }, title),
      sub ? el('span', { className: 'sg-item__sub' }, sub) : null),
    el('span', { className: 'sg-opt__go', html: icon('go') }),
  ];
  if (opts.href) {
    return el('a', {
      className: 'sg-item', href: opts.href,
      target: opts.blank ? '_blank' : null,
      rel: opts.blank ? 'noopener noreferrer' : null,
    }, kids);
  }
  return el('button', { type: 'button', className: 'sg-item', onClick: opts.onClick }, kids);
}

/** Приписка к адресу: подъезд, квартира, этаж — то, что человек уточнил сам. */
function pointNote(p) {
  const parts = [];
  if (p.entrance) parts.push(t('order.entrance') + ' ' + p.entrance);
  if (p.flat) parts.push(t('order.flat') + ' ' + p.flat);
  if (p.floor) parts.push(t('order.floor') + ' ' + p.floor);
  if (p.comment) parts.push(p.comment);
  return parts.join(', ');
}

/* Карточка заказа в списке: маршрут двумя строками, под ним статус с датой,
   справа сумма. Всё, по чему человек узнаёт свою поездку. */
function historyRow(item, onOpen) {
  const pts = Array.isArray(item.points) ? item.points : [];
  const from = item.from || (pts[0] && pts[0].addr) || t('order.from');
  const last = pts.length > 1 ? pts[pts.length - 1] : null;
  const to = item.to || (last && last.addr) || '';
  const meta = el('span', { className: 'row wrap gap-2', style: { paddingTop: '4px' } },
    statusBadge(item),
    el('span', { className: 'sg-opt__sub' }, dateTime(item.at || item.created_at)),
    item.rating
      ? el('span', { className: 'sg-opt__sub t-accent' }, '★ ' + rate(item.rating))
      : null);

  return el('button', {
    type: 'button', className: 'sg-opt',
    onClick: () => { haptic(); onOpen(item); },
  },
    el('span', { className: 'sg-route__line' }, el('i'), el('b'), el('i')),
    el('span', { className: 'sg-opt__text' },
      el('span', { className: 'sg-route__row' }, from),
      to ? el('span', { className: 'sg-route__row' }, to) : null,
      meta),
    el('span', { className: 'sg-opt__total' }, money(item.price_total || 0)));
}

/* Настройки плиток из /config. Пустые значения не подставляем совсем:
   Object.assign внутри createMap перекрыл бы ими её собственные умолчания,
   и вместо карты остался бы серый квадрат. Подпись — исключение: пустую
   строку админ ставит нарочно, и заменять её чужой нельзя. */
function mapTiles(cfg) {
  const out = { attribution: cfg.attribution || '' };
  if (cfg.tiles_light) out.tilesLight = cfg.tiles_light;
  if (cfg.tiles_dark) out.tilesDark = cfg.tiles_dark;
  if (cfg.max_zoom) out.maxZoom = +cfg.max_zoom;
  return out;
}

/* Маленькая карта в карточке заказа: пальцем не двигается, только показывает,
   куда ездили. Живёт вместе с видом и уничтожается вместе с ним. */
function miniMap(app, coords, line) {
  const box = el('div', {
    style: {
      position: 'relative', height: '168px', marginBottom: 'var(--sp-3)',
      borderRadius: 'var(--r-md)', overflow: 'hidden',
    },
  });
  const cfg = (app.cfg && app.cfg.map) || {};
  const map = createMap(box, Object.assign({
    center: coords[0] || cfg.center || [42.8746, 74.5698],
    zoom: cfg.zoom || 13,
    theme: isLightNow() ? 'light' : 'dark',
    interactive: false,
    controls: false,
    locate: false,
  }, mapTiles(cfg)));
  const start = line && line.length > 1 ? line : coords;
  let drawn = start.length > 1 ? map.route(start, { width: 5 }) : null;
  coords.forEach((ll, i) => map.marker({
    at: ll,
    html: i === 0 ? pin('a') : pin('b', coords.length > 2 ? String(i + 1) : ''),
    anchor: i === 0 ? 'center' : 'bottom',
    zIndex: 10 + i,
  }));

  function fit(path) {
    map.fitPoints(path, {
      padding: { top: 26, right: 26, bottom: 26, left: 26 },
      maxZoom: 16, animate: false,
    });
  }
  fit(start);

  return {
    node: box,
    /* Настоящая линия дороги приходит вместе с полным заказом — до неё рисуем
       прямую между точками, чтобы карта не стояла пустой. */
    setRoute(path) {
      if (drawn) drawn.setCoords(path);
      else drawn = map.route(path, { width: 5 });
      fit(path);
    },
    destroy() { map.destroy(); },
  };
}

/* ─────────────────────────────────────────────────────── шторка профиля */

/**
 * Профиль, история и карточка заказа в одной шторке. Шторка, а не отдельный
 * экран: под ней остаётся нетронутым набранный заказ, и человек возвращается
 * ровно туда, откуда ушёл.
 */
function openProfileSheet(app, startWith) {
  // Состояние живёт рядом со шторкой, а не внутри вида: виды перерисовываются
  // на смене языка и после сохранения имени, а загруженные страницы истории
  // при этом должны остаться на месте.
  const state = {
    view: 'profile',      // profile | history | card
    profile: null,
    loading: true,
    error: null,
    items: [],
    page: 0,
    total: 0,
    more: true,
    listing: false,
    listError: null,
    card: null,           // открытый заказ: {item, order}
  };

  let alive = true;
  let current = null;     // {node, destroy}
  let redraw = null;      // как перерисовать то, что открыто сейчас
  const holder = el('div');

  const ui = sheet({
    fullHeight: true,
    content: holder,
    onClose: () => {
      alive = false;
      offLang();
      offTheme();
      drop();
    },
  });
  ui.box.setAttribute('aria-label', t('common.profile'));

  // Язык переключают прямо здесь, поэтому вид обязан перерисоваться сам.
  const offLang = onLangChange(() => { if (alive && redraw) redraw(); });
  const offTheme = onThemeChange(() => { if (alive && redraw) redraw(); });

  function drop() {
    if (current && typeof current.destroy === 'function') current.destroy();
    current = null;
  }

  function show(build) {
    if (!alive) return;
    redraw = () => {
      const top = ui.body.scrollTop;
      drop();
      current = build();
      holder.replaceChildren(current.node);
      ui.body.scrollTop = top;      // перерисовка не должна швырять список наверх
    };
    drop();
    current = build();
    holder.replaceChildren(current.node);
    ui.body.scrollTop = 0;
  }

  const nav = {
    profile: () => { state.view = 'profile'; show(buildProfile); },
    history: () => { state.view = 'history'; show(buildHistory); loadFirstPage(); },
    card: (item) => {
      state.view = 'card';
      state.card = { item, order: null };
      show(buildCard);
      loadCard(item);
    },
    close: () => ui.close(),
  };

  /* ── данные ──────────────────────────────────────────────────────────── */

  async function loadProfile() {
    state.loading = true;
    state.error = null;
    try {
      const token = clientToken() || await ensureClientToken();
      if (!token) {
        state.profile = null;
      } else {
        state.profile = await api.get('/client/profile', { token }, { auth: false });
        // Сервер помнит имя точнее нас: оно переживает смену устройства.
        if (state.profile.name) saveClient({ name: state.profile.name });
      }
    } catch (e) {
      state.error = e;
    }
    state.loading = false;
    if (!alive) return;
    if (redraw) redraw();
    // Ключ мог приехать только что — тогда список ждал именно его.
    if (state.view === 'history') loadFirstPage();
  }

  async function loadPage(page) {
    const token = clientToken();
    if (!token || state.listing) return;
    state.listing = true;
    state.listError = null;
    if (redraw) redraw();
    try {
      const res = await api.get('/client/orders',
        { token, page, per_page: HISTORY_PAGE }, { auth: false });
      const items = Array.isArray(res.items) ? res.items : [];
      // Страницу могли догрузить дважды подряд — повторы отсекаем по номеру.
      const seen = new Set(state.items.map((x) => x.public_id));
      state.items = state.items.concat(items.filter((x) => x && !seen.has(x.public_id)));
      state.page = res.page || page;
      state.total = res.total || state.items.length;
      state.more = !!res.has_more;
    } catch (e) {
      state.listError = e;
    }
    state.listing = false;
    if (alive && redraw) redraw();
  }

  function loadFirstPage() {
    if (state.items.length || state.listing) return;
    loadPage(1);
  }

  function loadMore() {
    if (!state.more || state.listing || state.listError) return;
    loadPage(state.page + 1);
  }

  /* Полный заказ ради разбивки цены и линии маршрута: в списке их нет, а
     показывать «из чего цена» по одной итоговой сумме нечестно. */
  async function loadCard(item) {
    if (!item.track_token) return;
    try {
      const order = await api.get('/orders/' + encodeURIComponent(item.public_id),
        { t: item.track_token }, { auth: false });
      if (!alive || !state.card || state.card.item.public_id !== item.public_id) return;
      state.card.order = order;
      if (state.view !== 'card') return;
      if (current && typeof current.apply === 'function') current.apply(order);
      else if (redraw) redraw();
    } catch (e) {
      /* не пришло — карточка и без разбивки полная, шуметь не о чем */
    }
  }

  /* ── профиль ─────────────────────────────────────────────────────────── */

  function buildProfile() {
    const me = readClient();
    const p = state.profile;
    const node = el('div');

    node.appendChild(viewHead(t('common.profile'), null, null, nav.close));

    const face = me.photo
      ? el('span', { className: 'avatar avatar--lg' }, el('img', { src: me.photo, alt: '' }))
      : el('span', { className: 'avatar avatar--lg avatar--accent' },
        initials(me.name) || iconNode('user', 28));

    node.appendChild(el('div', {
      className: 'col center gap-2', style: { padding: '0 0 var(--sp-4)' },
    },
      face,
      el('div', { className: 'sg-head__title ta-c' }, me.name || t('me.noname')),
      p && p.created_at
        ? el('div', { className: 'muted-2 t-xs' }, t('me.since', { date: fmtDate(p.created_at) }))
        : null));

    // ── имя и телефон
    const nameField = textField(t('common.name'), me.name || '', {
      autocomplete: 'name', maxLength: 80, hint: t('me.name_ph'),
    });
    nameField.input.addEventListener('change', () => saveName(nameField.input));
    node.appendChild(nameField.node);

    const phoneField = textField(t('common.phone'), me.phone ? fmtPhone(me.phone) : '', {
      type: 'tel', disabled: true, hint: t('me.phone_note'),
    });
    node.appendChild(el('div', { style: { paddingTop: 'var(--sp-3)' } }, phoneField.node));

    // ── счёт заказов и оценка
    if (state.loading) {
      const box = el('div', { style: { padding: 'var(--sp-5) 0' } });
      skeleton(box, 3);
      node.appendChild(box);
    } else if (!clientToken()) {
      node.appendChild(el('p', {
        className: 'sheet__text', style: { paddingTop: 'var(--sp-4)' },
      }, t('me.unknown')));
    } else if (state.error) {
      node.appendChild(el('div', { className: 'sg-fail' },
        el('div', { className: 'sg-fail__text' }, errText(state.error)),
        el('button', {
          type: 'button', className: 'btn btn--ghost', onClick: loadProfile,
        }, t('common.retry'))));
    } else if (p) {
      const stats = el('div', { style: { paddingTop: 'var(--sp-3)' } });
      stats.appendChild(sumRow(t('me.orders'), String(p.orders_count || 0)));
      stats.appendChild(sumRow(t('me.done'), String(p.orders_done || 0)));
      if (p.spent) stats.appendChild(sumRow(t('me.spent'), money(p.spent)));

      const starsBox = el('div');
      mountStars(starsBox, { value: p.rating || 0, readonly: true });
      stats.appendChild(el('div', { className: 'sg-sum', style: { alignItems: 'center' } },
        el('span', { className: 'sg-sum__name' }, t('me.rating')),
        el('span', { className: 'row gap-2' },
          starsBox,
          el('span', { className: 'sg-sum__val' },
            p.rating ? rate(p.rating) : t('me.no_rating')))));
      node.appendChild(stats);

      node.appendChild(group(t('me.history')));
      for (const one of (Array.isArray(p.active) ? p.active : [])) {
        node.appendChild(linkRow('car', t('me.live_now'),
          statusName(one) + ' · ' + t('me.card', { id: one.public_id }), {
            accent: true,
            onClick: () => {
              ui.close();
              app.go('/order/' + one.public_id, { t: one.track_token });
            },
          }));
      }
      node.appendChild(linkRow('list', t('order.my_orders'),
        p.orders_count ? tp(p.orders_count, 'common.n_order') : t('common.empty'),
        { onClick: nav.history }));
    }

    // ── язык и тема
    node.appendChild(group(t('common.settings')));
    node.appendChild(el('div', { className: 'sg-sum' },
      el('span', { className: 'sg-sum__name' }, t('common.language'))));
    node.appendChild(segmented(
      LANGS.map((code) => ({ value: code, label: t('common.lang_' + code) })),
      getLang(), pickLang));

    node.appendChild(el('div', { className: 'sg-sum', style: { paddingTop: 'var(--sp-3)' } },
      el('span', { className: 'sg-sum__name' }, t('common.theme'))));
    node.appendChild(segmented([
      { value: 'auto', label: t('common.theme_auto') },
      { value: 'dark', label: t('common.theme_dark') },
      { value: 'light', label: t('common.theme_light') },
    ], getTheme(), setTheme));

    // ── поддержка
    const waNumber = String((p && p.support_wa)
      || (app.cfg.service && app.cfg.service.support_wa) || '').replace(/\D/g, '');
    const phoneNumber = String((p && p.support_phone)
      || (app.cfg.service && app.cfg.service.phone) || '').replace(/[^\d+]/g, '');
    if (waNumber || phoneNumber) {
      node.appendChild(group(t('common.support')));
      if (waNumber) {
        node.appendChild(linkRow('wa', t('common.whatsapp'), null, {
          accent: true, blank: true,
          href: 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(t('me.wa_hello')),
        }));
      }
      if (phoneNumber) {
        node.appendChild(linkRow('phone', t('me.support_call'), fmtPhone(phoneNumber), {
          href: 'tel:' + phoneNumber,
        }));
      }
    }

    node.appendChild(el('div', { style: { padding: 'var(--sp-5) 0 var(--sp-2)' } },
      el('button', {
        type: 'button', className: 'btn btn--danger btn--lg btn--block',
        onClick: askForget,
      }, t('me.forget'))));

    return { node };
  }

  async function saveName(input) {
    const name = input.value.trim().slice(0, 80);
    const me = readClient();
    if (name === (me.name || '')) return;
    saveClient({ name });
    const token = clientToken();
    if (!token) {
      toast(t('common.saved'), { type: 'ok' });
      return;
    }
    try {
      const fresh = await api.patch('/client/profile', { token, name }, { auth: false });
      if (fresh && fresh.phone !== undefined) state.profile = fresh;
      toast(t('common.saved'), { type: 'ok' });
    } catch (e) {
      toast(errText(e), { type: 'err' });
    }
    if (alive && redraw) redraw();
  }

  function pickLang(code) {
    setLang(code);
    const token = clientToken();
    // Язык нужен и серверу: письма, смс и названия статусов приходят на нём.
    if (token) api.patch('/client/profile', { token, lang: code }, { auth: false }).catch(() => {});
  }

  async function askForget() {
    const yes = await confirm({
      title: t('me.forget_q'),
      text: t('me.forget_text'),
      ok: t('me.forget_ok'),
      cancel: t('common.cancel'),
      danger: true,
    });
    if (!yes) return;
    forgetClient();
    ui.close();
    toast(t('me.forgot'), { type: 'ok' });
  }

  /* ── история ─────────────────────────────────────────────────────────── */

  function buildHistory() {
    const node = el('div');
    node.appendChild(viewHead(t('order.my_orders'),
      state.total ? tp(state.total, 'common.n_order') : null,
      nav.profile, nav.close));

    const list = el('div');
    node.appendChild(list);

    if (!clientToken()) {
      list.appendChild(el('p', { className: 'sheet__text' }, t('me.unknown')));
      return { node };
    }

    for (const item of state.items) list.appendChild(historyRow(item, nav.card));

    if (state.listing) {
      const box = el('div', { style: { padding: 'var(--sp-4) 0' } });
      skeleton(box, state.items.length ? 2 : 4);
      list.appendChild(box);
    } else if (state.listError) {
      list.appendChild(el('div', { className: 'sg-fail' },
        el('div', { className: 'sg-fail__text' }, errText(state.listError)),
        el('button', {
          type: 'button', className: 'btn btn--ghost',
          onClick: () => { state.listError = null; loadPage(state.page + 1); },
        }, t('common.retry'))));
    } else if (!state.items.length) {
      list.appendChild(el('div', { className: 'empty' },
        el('div', { className: 'empty__icon', html: icon('list') }),
        el('div', { className: 'empty__title' }, t('me.empty_title')),
        el('div', { className: 'empty__text' }, t('me.empty_text')),
        el('button', {
          type: 'button', className: 'btn btn--primary btn--lg',
          onClick: () => { ui.close(); app.go('/'); },
        }, t('order.submit'))));
    } else if (state.more) {
      // Прокрутка догружает сама, но кнопка нужна: мышью до низа доезжают не все,
      // да и на длинном списке видно, что дальше ещё есть.
      list.appendChild(el('div', { style: { padding: 'var(--sp-3) 0 var(--sp-5)' } },
        el('button', {
          type: 'button', className: 'btn btn--ghost btn--lg btn--block', onClick: loadMore,
        }, t('me.load_more'))));
    }

    function onScroll() {
      if (!alive || state.listing || !state.more || state.listError) return;
      const box = ui.body;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - NEAR_BOTTOM) loadMore();
    }
    ui.body.addEventListener('scroll', onScroll, { passive: true });

    return {
      node,
      destroy() { ui.body.removeEventListener('scroll', onScroll); },
    };
  }

  /* ── карточка заказа ─────────────────────────────────────────────────── */

  function buildCard() {
    const { item } = state.card;
    const node = el('div');
    node.appendChild(viewHead(t('me.card', { id: item.public_id }),
      statusName(item), nav.history, nav.close));

    const pts = (Array.isArray(item.points) ? item.points : []).filter((p) => p && p.addr);
    const coords = pts.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
    const order = state.card.order;
    const line = order && Array.isArray(order.route) ? order.route : null;

    let map = null;
    if (coords.length) {
      map = miniMap(app, coords, line);
      node.appendChild(map.node);
    }

    node.appendChild(el('div', { className: 'row wrap gap-2', style: { paddingBottom: 'var(--sp-2)' } },
      statusBadge(item),
      el('span', { className: 'sg-opt__sub' }, dateTime(item.at || item.created_at))));

    // ── адреса
    node.appendChild(group(t('me.points')));
    const list = el('div', { className: 'sg-list' });
    pts.forEach((p, i) => {
      const note = pointNote(p);
      list.appendChild(el('div', { className: 'sg-item' },
        el('span', {
          className: 'sg-item__icon' + (i === 0 ? ' sg-item__icon--accent' : ''),
          html: icon('pin'),
        }),
        el('span', { className: 'sg-item__text' },
          el('span', { className: 'sg-item__title' }, p.addr),
          note ? el('span', { className: 'sg-item__sub' }, note) : null)));
    });
    node.appendChild(list);

    // ── из чего цена. Итог и общие цифры знаем сразу, разбивку — когда придёт
    // полный заказ, поэтому строки собираются отдельной функцией.
    node.appendChild(group(t('order.price_details')));
    const rows = el('div');
    function fillPrice(full) {
      const price = (full && full.price) || {};
      const list = [];
      if (item.distance_m) list.push(sumRow(t('order.distance'), distance(item.distance_m)));
      if (item.duration_s) list.push(sumRow(t('order.duration'), duration(item.duration_s)));
      if (item.tariff) list.push(sumRow(t('me.car'), nameOf(item.tariff)));
      if (price.base) list.push(sumRow(t('order.price_base'), money(price.base)));
      if (price.distance) list.push(sumRow(t('order.price_distance'), money(price.distance)));
      if (price.time) list.push(sumRow(t('order.price_time'), money(price.time)));
      if (item.loaders) {
        list.push(sumRow(t('order.price_loaders'),
          price.loaders ? money(price.loaders) : String(item.loaders)));
      }
      for (const ex of (Array.isArray(item.extras) ? item.extras : [])) {
        const found = app.extras.find((x) => x && x.code === ex.code);
        const qty = Number(ex.qty) || 1;
        list.push(sumRow(nameOf(found) || ex.code,
          qty === 1 ? t('common.yes') : '×' + String(qty).replace('.', ',')));
      }
      if (price.waiting) list.push(sumRow(t('order.price_waiting'), money(price.waiting)));
      list.push(sumRow(t('order.price_total'), money(item.price_total || 0), true));
      const payKey = 'status.pay_' + (item.payment_status || 'none');
      if (has(payKey)) list.push(sumRow(t('me.pay'), t(payKey)));
      rows.replaceChildren(...list);
    }
    fillPrice(order);
    node.appendChild(rows);

    if (item.comment) {
      node.appendChild(group(t('common.comment')));
      node.appendChild(el('p', { className: 'sheet__text' }, item.comment));
    }

    // ── курьер
    const courier = item.courier || (order && order.courier);
    if (courier && courier.name) {
      node.appendChild(group(t('track.courier')));
      const car = courier.car || {};
      node.appendChild(el('div', { className: 'sg-courier' },
        el('span', { className: 'avatar' },
          courier.avatar ? el('img', { src: courier.avatar, alt: '' }) : initials(courier.name)),
        el('span', { className: 'sg-courier__text' },
          el('span', { className: 'sg-courier__name' }, courier.name),
          el('span', { className: 'sg-courier__car' },
            car.model ? el('span', { className: 'truncate' }, car.model) : null,
            car.plate ? el('span', { className: 'sg-plate' }, fmtPlate(car.plate)) : null)),
        courier.rating
          ? el('span', { className: 'sg-courier__rate' }, '★ ' + rate(courier.rating))
          : null));
    }

    // ── оценка
    if (item.status === 'done') {
      node.appendChild(group(item.rating ? t('me.rated') : t('me.not_rated')));
      if (item.rating) {
        const stars = el('div');
        mountStars(stars, { value: item.rating, readonly: true, size: 'lg' });
        node.appendChild(el('div', { className: 'col center gap-2' }, stars,
          item.rating_comment
            ? el('div', { className: 'muted t-sm ta-c' }, item.rating_comment)
            : null));
      }
    }

    // ── что можно сделать дальше
    const foot = el('div', { className: 'col gap-2', style: { padding: 'var(--sp-5) 0 var(--sp-2)' } });
    const live = item.live || LIVE_STATUSES.indexOf(item.status) >= 0;
    if (live && item.track_token) {
      foot.appendChild(el('button', {
        type: 'button', className: 'btn btn--ghost btn--lg btn--block',
        onClick: () => {
          ui.close();
          app.go('/order/' + item.public_id, { t: item.track_token });
        },
      }, t('me.watch')));
    }
    if (pts.length >= 2) {
      foot.appendChild(el('button', {
        type: 'button', className: 'sg-cta',
        onClick: () => {
          haptic(18);
          ui.close();
          app.startOrder(draftFrom(item));
          toast(t('me.repeated'), { type: 'ok' });
        },
      }, el('span', { className: 'sg-cta__label' }, t('order.repeat'))));
    }
    node.appendChild(foot);

    return {
      node,
      destroy() { if (map) map.destroy(); },
      /* Пришёл полный заказ: дописываем разбивку и настоящую линию маршрута,
         а карточку целиком не пересобираем — карта бы моргнула. */
      apply(full) {
        fillPrice(full);
        if (map && Array.isArray(full.route) && full.route.length > 1) map.setRoute(full.route);
      },
    };
  }

  /* Экран открываем сразу, данные подтягиваем следом: пустая шторка с крутилкой
     раздражает сильнее, чем профиль, у которого секунду догружается счётчик. */
  if (startWith === 'history') {
    show(buildHistory);
    loadFirstPage();
  } else {
    show(buildProfile);
  }
  loadProfile();
}

/** Заказ из истории превращаем в заготовку нового: те же адреса и та же машина. */
function draftFrom(item) {
  const extras = {};
  for (const ex of (Array.isArray(item.extras) ? item.extras : [])) {
    if (ex && ex.code) extras[ex.code] = ex.qty || 1;
  }
  return {
    points: (Array.isArray(item.points) ? item.points : [])
      .filter((p) => p && p.lat != null && p.lng != null)
      .map((p) => ({
        addr: p.addr || '', subtitle: '', lat: p.lat, lng: p.lng,
        entrance: p.entrance || '', flat: p.flat || '', floor: p.floor || '',
        intercom: p.intercom || '', comment: p.comment || '',
        name: p.name || '', phone: p.phone || '',
      })),
    tariffId: item.tariff_id || 0,
    loaders: item.loaders || 0,
    extras,
    comment: item.comment || '',
  };
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

  const mapCfg = cfg.map || {};
  const map = createMap(mapBox, Object.assign({
    center: mapCfg.center || [42.8746, 74.5698],
    zoom: mapCfg.zoom || 13,
    theme: isLightNow() ? 'light' : 'dark',
  }, mapTiles(mapCfg)));
  // Тему меняют и в профиле, и в настройках телефона — карта следует за обеими.
  onThemeChange((light) => map.setTheme(light ? 'light' : 'dark'));

  // Пока карту тянут, метка выбора точки приподнимается — как настоящая булавка.
  const shell = document.querySelector('.sg-app');
  map.on('move', () => shell.classList.add('is-dragging'));
  map.on('moveend', () => shell.classList.remove('is-dragging'));

  const owned = new Set();
  const centerPin = document.getElementById('center-pin');
  let lastFit = null;
  let screen = null;
  let draft = null;              // заготовка нового заказа после «Повторить заказ»

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
      // Заказ есть, телефон есть — значит, можно забрать постоянный ключ клиента.
      ensureClientToken();
    },
    forgetOrder() { writeJson(KEY_ORDER, null); },

    /** Что мы помним о человеке. known — телефон уже спрашивали, второй раз не надо. */
    me() {
      const saved = readClient();
      return {
        phone: saved.phone || '',
        name: saved.name || '',
        token: saved.token || '',
        known: !!saved.phone,
      };
    },
    setMe(patch) {
      saveClient(patch);
      return app.me();
    },
    known() { return !!readClient().phone; },
    clientToken,

    /** Тема: 'auto' | 'dark' | 'light'. */
    theme: getTheme,
    setTheme,

    openProfile() { openProfileSheet(app, 'profile'); },
    openHistory() { openProfileSheet(app, 'history'); },

    /** Заготовка нового заказа из «Повторить заказ». Экран заказа забирает её
        один раз при запуске: второй вызов вернёт null. */
    takeDraft() {
      const v = draft;
      draft = null;
      return v;
    },

    /** Начать новый заказ с готовыми адресами. Адреса заодно кладём в недавние —
        так они под рукой и на шаге поиска адреса. */
    startOrder(next) {
      draft = next || null;
      if (next) rememberRecent(next.points);
      router.go('/', { force: true });
    },
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

  profileBtn = makeProfileButton(app.openProfile);
  paintProfileButton();

  // Язык меняется на лету: заголовок вкладки, разметка и текущий экран.
  onLangChange(() => {
    paintLang();
    applyTo(document);
    paintProfileButton();
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

  // Ключ клиента могли не успеть получить в прошлый раз — тихо доберём сейчас.
  ensureClientToken();
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
