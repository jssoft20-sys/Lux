/* Живая страница заказа, которой поделились ссылкой.

   Ссылку кидают в чат тому, кто встречает груз: маме, кладовщику, соседу.
   Ему нужно видеть, где машина и когда она будет, — и больше ничего. Поэтому
   страница живёт на отдельном токене просмотра: сервер по нему отдаёт заказ без
   телефонов, квартир, домофонов и имени заказчика, с полем readonly, а любое
   действие этим токеном встречает 403. Кнопки «Отменить» здесь нет и не появится
   ни при каких данных — её просто некому нарисовать.

   Страницу собирает server/share.py. Без токена (так приходит робот мессенджера)
   она остаётся прежней карточкой с Open Graph, и этот модуль в неё не попадает.
   С токеном поверх карточки встаёт живая карта, а сама карточка остаётся под ней
   запасным вариантом: не собрался модуль, не подошла ссылка, упала сеть — человек
   всё равно видит статус и маршрут, а не белый экран.

   Движок карты берём из core/map.js как есть: свой писать незачем, а этот уже
   умеет и плитки без серых дыр, и ровный проезд машины между посылками координат.
*/

import { api } from '../core/api.js';
import { t, tp, extend, getLang, setLang, onLangChange } from '../core/i18n.js';
import {
  distance as fmtDistance, duration as fmtDuration, time as fmtTime,
  money as fmtMoney, plate as fmtPlate, initials, setTimeZone,
} from '../core/fmt.js';
import { createMap, pin, distanceM } from '../core/map.js';

/* Свои строки модуль приносит сам: общий словарь правят соседние экраны.
   Кыргызский — как говорят в Бишкеке, а не подстрочник с русского. */
extend({
  ru: {
    'watch.st.draft': 'Заказ оформляется',
    'watch.st.searching': 'Ищем машину',
    'watch.st.assigned': 'Машина назначена',
    'watch.st.to_pickup': 'Машина едет за грузом',
    'watch.st.at_pickup': 'Грузимся',
    'watch.st.in_transit': 'Заказ в пути',
    'watch.st.at_dropoff': 'Разгружаемся',
    'watch.st.done': 'Заказ доставлен',
    'watch.st.cancelled': 'Заказ отменён',
    'watch.st.expired': 'Машина не нашлась',

    'watch.sub.draft': 'Заказ ещё оформляют',
    'watch.sub.searching': 'Подбираем ближайшую свободную машину',
    'watch.sub.assigned': 'Водитель собирается и выезжает',
    'watch.sub.pickup': 'Будет на погрузке примерно через {time}',
    'watch.sub.pickup_soon': 'Машина подъезжает к месту погрузки',
    'watch.sub.at_pickup': 'Машину загружают',
    'watch.sub.transit': 'Ехать примерно {time}',
    'watch.sub.transit_soon': 'Машина почти на месте',
    'watch.sub.at_dropoff': 'Груз выгружают на месте',
    'watch.sub.done': 'Доставлено в {time}',
    'watch.sub.cancelled': 'Поездки не будет',
    'watch.sub.expired': 'Свободной машины так и не нашлось',
    'watch.sub.no_geo': 'Ждём сигнал от машины',

    'watch.left': 'Осталось',
    'watch.eta': 'Примерно',
    'watch.total': 'Весь путь',
    'watch.price': 'К оплате',
    'watch.paid': 'Оплачено',
    'watch.stops': 'Ещё {n} точка|Ещё {n} точки|Ещё {n} точек',
    'watch.recenter': 'К машине',
    'watch.lang_other': 'Кыргызча',
    'watch.order_own': 'Заказать машину',
    'watch.readonly': 'Ссылка для просмотра: видно, где машина, но менять заказ по ней нельзя',
    'watch.updated': 'Обновлено в {time}',
    'watch.just_now': 'Обновлено только что',
    'watch.offline': 'Связь пропала, ждём сигнал',
    'watch.home': 'На главную',
  },
  ky: {
    'watch.st.draft': 'Заказ даярдалууда',
    'watch.st.searching': 'Унаа издеп жатабыз',
    'watch.st.assigned': 'Унаа дайындалды',
    'watch.st.to_pickup': 'Унаа жүккө бара жатат',
    'watch.st.at_pickup': 'Жүктөп жатабыз',
    'watch.st.in_transit': 'Заказ жолдо',
    'watch.st.at_dropoff': 'Түшүрүп жатабыз',
    'watch.st.done': 'Заказ жеткирилди',
    'watch.st.cancelled': 'Заказ жокко чыгарылды',
    'watch.st.expired': 'Унаа табылган жок',

    'watch.sub.draft': 'Заказ азырынча толтурулууда',
    'watch.sub.searching': 'Жакын жердеги бош унааны издеп жатабыз',
    'watch.sub.assigned': 'Айдоочу камданып, жолго чыгып жатат',
    'watch.sub.pickup': 'Болжол менен {time} ичинде жүккө жетет',
    'watch.sub.pickup_soon': 'Унаа жүктөй турган жерге жакындап калды',
    'watch.sub.at_pickup': 'Унааны жүктөп жатышат',
    'watch.sub.transit': 'Болжол менен {time} жол калды',
    'watch.sub.transit_soon': 'Унаа дээрлик жетип калды',
    'watch.sub.at_dropoff': 'Жүктү түшүрүп жатышат',
    'watch.sub.done': 'Саат {time} жеткирилди',
    'watch.sub.cancelled': 'Заказ болбой калды',
    'watch.sub.expired': 'Бош унаа табылган жок',
    'watch.sub.no_geo': 'Унаадан белги күтүп жатабыз',

    'watch.left': 'Калды',
    'watch.eta': 'Болжол менен',
    'watch.total': 'Бүт жол',
    'watch.price': 'Төлөнөт',
    'watch.paid': 'Төлөндү',
    'watch.stops': 'Дагы {n} чекит',
    'watch.recenter': 'Унаага кайтуу',
    'watch.lang_other': 'Русский',
    'watch.order_own': 'Унаа чакыруу',
    'watch.readonly': 'Бул шилтеме көрүү үчүн гана: унаа кайда экени көрүнөт, '
      + 'заказды өзгөртүүгө болбойт',
    'watch.updated': 'Саат {time} жаңыланды',
    'watch.just_now': 'Азыр эле жаңыланды',
    'watch.offline': 'Байланыш үзүлдү, кайра туташып жатабыз',
    'watch.home': 'Башкы бетке',
  },
});

/* ── что передала страница ─────────────────────────────────────────────── */

const cfg = (typeof window !== 'undefined' && window.SG_WATCH) || {};
const PID = String(cfg.pid || '').toUpperCase();
const TOKEN = String(cfg.token || '');
const HOME = String(cfg.base || '/');
const MAPCFG = cfg.map || {};

/* Машина едет за грузом — время считаем до точки подачи. */
const TO_PICKUP = ['assigned', 'to_pickup'];
/* Машина везёт груз — время считаем по остатку маршрута. */
const ON_ROUTE = ['in_transit', 'at_dropoff'];
/* Заказ закончился: карта остаётся, но обновлять на ней больше нечего. */
const OVER = ['done', 'cancelled', 'expired'];

/* Средняя скорость по Бишкеку в рабочий день: 7 м/с — это 25 км/ч. Цифра
   грубая, поэтому время на экране всегда идёт со словом «примерно». */
const CITY_MPS = 7;
/* По прямой между двумя точками не ездят: улицы, светофоры, разворот. */
const ROAD_FACTOR = 1.3;
/* Дальше этого от линии маршрута машина считается ушедшей в объезд, и гасить
   по ней пройденный путь нельзя — получится неправда. */
const OFF_ROUTE_M = 500;
/* Чаще этого карта сама вид не переставляет: иначе она дёргается на каждой
   посылке координат, и человек не успевает прочитать, что на ней написано. */
const REFIT_MS = 4000;
/* Насколько должна отъехать машина, чтобы вид имело смысл подтягивать. */
const REFIT_M = 150;
/* Вкладка молчала дольше — при возврате спрашиваем заказ целиком. */
const STALE_MS = 20000;
/* Как часто стареет строка «обновлено». Раз в полминуты — этого хватает. */
const FRESH_MS = 30000;

const LOGO = '<svg viewBox="0 0 48 44" width="26" height="24" aria-hidden="true" focusable="false">'
  + '<rect x="1" y="9" width="27" height="19" rx="5" fill="currentColor"/>'
  + '<path d="M28 14h8l7 8v6H28z" fill="currentColor"/>'
  + '<circle cx="13" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="4"/>'
  + '<circle cx="35" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="4"/>'
  + '</svg>';

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path d="M12 17.3l-6.2 3.6 1.7-7-5.4-4.7 7.1-.6L12 2l2.8 6.6 7.1.6-5.4 4.7 1.7 7z"'
  + ' fill="currentColor"/></svg>';

/* ── состояние ─────────────────────────────────────────────────────────── */

const ui = {};              // узлы живой страницы
let map = null;
let carPin = null;          // метка машины
let spots = [];             // метки точек маршрута
let line = null;            // линия маршрута
let meta = null;            // измеренный маршрут: точки, накопленная длина, всего
let order = null;           // последний известный заказ
let stream = null;
let shown = false;          // живая страница уже показана
let follow = true;          // карта сама держит машину в кадре
let placeKey = '';          // по чему решаем, что метки пора перебрать
let statusKey = '';         // и по чему — что вид пора переставить
let routeKey = '';          // подпись строк маршрута в карточке
let carKey = '';            // подпись блока машины
let fitAt = 0;              // когда в последний раз переставляли вид
let fitFrom = null;         // и где тогда стояла машина
let beat = 0;               // когда последний раз что-то пришло с сервера

/* ── мелочи ────────────────────────────────────────────────────────────── */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* Число или null. Именно null, а не ноль: пустое поле — это «не знаем», а ноль
   в координатах — это точка в Атлантике, и машина уезжала туда с карты. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/* ── разбор заказа ─────────────────────────────────────────────────────── */

function placeLL() {
  const list = order && Array.isArray(order.points) ? order.points : [];
  const out = [];
  for (const p of list) {
    const lat = num(p && p.lat);
    const lng = num(p && p.lng);
    if (lat !== null && lng !== null) out.push([lat, lng]);
  }
  return out;
}

function routeLL() {
  const list = order && Array.isArray(order.route) ? order.route : [];
  const out = [];
  for (const p of list) {
    const lat = num(p && p[0]);
    const lng = num(p && p[1]);
    if (lat !== null && lng !== null) out.push([lat, lng]);
  }
  return out;
}

function carLL() {
  const at = order && order.courier && order.courier.at;
  const lat = num(at && at[0]);
  const lng = num(at && at[1]);
  return lat === null || lng === null ? null : [lat, lng];
}

/* Длина маршрута по кускам: пригодится и для доли пройденного, и для остатка. */
function measure(path) {
  const acc = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distanceM(path[i - 1], path[i]);
    acc.push(total);
  }
  return { pts: path, acc, total };
}

/* На городских расстояниях градусы можно считать плоскими, поджав долготу по
   широте. Возвращает, какую долю отрезка проехали. */
function along(a, b, p) {
  const k = Math.cos(a[0] * Math.PI / 180) || 1;
  const bx = (b[1] - a[1]) * k;
  const by = b[0] - a[0];
  const px = (p[1] - a[1]) * k;
  const py = p[0] - a[0];
  const len = bx * bx + by * by;
  return len > 0 ? (px * bx + py * by) / len : 0;
}

/* Где машина на линии маршрута: доля пройденного и на сколько метров она от
   линии отклонилась. Ушла далеко — значит поехала в объезд, и гасить по ней
   маршрут нельзя. */
function routeShare(ll) {
  if (!meta || meta.total <= 0) return { f: 0, gap: Infinity };
  let best = 0;
  let gap = Infinity;
  for (let i = 1; i < meta.pts.length; i++) {
    const a = meta.pts[i - 1];
    const b = meta.pts[i];
    const seg = distanceM(a, b);
    if (seg <= 0) continue;
    const u = clamp01(along(a, b, ll));
    const near = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const d = distanceM(ll, near);
    if (d < gap) {
      gap = d;
      best = (meta.acc[i - 1] + seg * u) / meta.total;
    }
  }
  return { f: clamp01(best), gap };
}

/* Сколько метров осталось ехать. Считаем по маршруту, а когда машина от него
   далеко или маршрута нет — по прямой с поправкой на улицы. */
function restMeters() {
  const car = carLL();
  const pts = placeLL();
  if (car && meta && meta.total > 0) {
    const hit = routeShare(car);
    if (hit.gap < OFF_ROUTE_M) return Math.max(0, meta.total * (1 - hit.f));
  }
  if (car && pts.length) return distanceM(car, pts[pts.length - 1]) * ROAD_FACTOR;
  return num(order && order.distance_m) || 0;
}

/* Сколько секунд ещё ехать. Ноль — сказать нечего, и тогда времени не пишем:
   выдуманная минута хуже честного молчания. */
function etaSeconds() {
  const st = order ? order.status : '';
  const car = carLL();
  const pts = placeLL();
  if (TO_PICKUP.indexOf(st) >= 0) {
    if (!car || !pts.length) return 0;
    return Math.round(distanceM(car, pts[0]) * ROAD_FACTOR / CITY_MPS);
  }
  if (ON_ROUTE.indexOf(st) >= 0) {
    const rest = restMeters();
    if (rest <= 0) return 0;
    const total = meta && meta.total > 0 ? meta.total : 0;
    const whole = num(order && order.duration_s) || 0;
    if (total > 0 && whole > 0) return Math.round(whole * (rest / total));
    return Math.round(rest * ROAD_FACTOR / CITY_MPS);
  }
  return 0;
}

/* ── сборка страницы ───────────────────────────────────────────────────── */

function build() {
  const root = node('div', 'watch');
  ui.root = root;

  ui.map = node('div', 'watch__map');
  root.appendChild(ui.map);

  ui.top = node('div', 'watch__top');
  ui.brand = node('a', 'watch__brand');
  ui.brand.href = HOME;
  ui.brand.innerHTML = LOGO;
  ui.brand.appendChild(node('span', null, cfg.service || 'Sprinter Go'));
  ui.top.appendChild(ui.brand);

  ui.lang = node('button', 'watch__chip');
  ui.lang.type = 'button';
  ui.lang.addEventListener('click', () => setLang(getLang() === 'ru' ? 'ky' : 'ru'));
  ui.top.appendChild(ui.lang);
  root.appendChild(ui.top);

  ui.wire = node('p', 'watch__wire');
  ui.wire.hidden = true;
  root.appendChild(ui.wire);

  ui.back = node('button', 'watch__recenter');
  ui.back.type = 'button';
  ui.back.hidden = true;
  ui.back.addEventListener('click', () => {
    follow = true;
    ui.back.hidden = true;
    fitAll(true);
  });
  root.appendChild(ui.back);

  const dock = node('div', 'watch__dock');
  ui.panel = node('section', 'watch__panel');

  const head = node('div', 'watch__head');
  head.setAttribute('role', 'status');
  head.setAttribute('aria-live', 'polite');
  ui.id = node('p', 'watch__id');
  ui.title = node('h1', 'watch__title');
  ui.dot = node('i', 'watch__dot');
  ui.dot.setAttribute('aria-hidden', 'true');
  ui.titleText = node('span');
  ui.title.appendChild(ui.dot);
  ui.title.appendChild(ui.titleText);
  ui.sub = node('p', 'watch__sub');
  head.appendChild(ui.id);
  head.appendChild(ui.title);
  head.appendChild(ui.sub);
  ui.panel.appendChild(head);

  ui.stats = node('ul', 'watch__stats');
  ui.panel.appendChild(ui.stats);

  ui.route = node('ul', 'watch__route');
  ui.panel.appendChild(ui.route);

  ui.car = node('div', 'watch__car');
  ui.car.hidden = true;
  ui.panel.appendChild(ui.car);

  ui.fresh = node('p', 'watch__fresh');
  ui.panel.appendChild(ui.fresh);

  ui.note = node('p', 'watch__note');
  ui.panel.appendChild(ui.note);

  ui.order = node('a', 'watch__btn');
  ui.order.href = HOME;
  ui.panel.appendChild(ui.order);

  dock.appendChild(ui.panel);
  root.appendChild(dock);
  document.body.appendChild(root);

  // Высота карточки уходит в переменную: по ней карта поднимает свои кнопки и
  // обязательную подпись об источнике плиток, чтобы они не ушли под карточку.
  const measurePanel = () => root.style.setProperty('--watch-panel',
    ui.panel.offsetHeight + 'px');
  if (window.ResizeObserver) {
    const ro = new window.ResizeObserver(measurePanel);
    ro.observe(ui.panel);
  }
  measurePanel();
}

/* Надписи, которые не зависят от данных: они должны стоять на месте ещё до
   того, как приедет первый ответ сервера, и меняться при смене языка. */
function labels() {
  ui.lang.textContent = t('watch.lang_other');
  ui.lang.setAttribute('lang', getLang() === 'ru' ? 'ky' : 'ru');
  ui.back.textContent = t('watch.recenter');
  ui.note.textContent = t('watch.readonly');
  ui.order.textContent = t('watch.order_own');
  ui.wire.textContent = t('watch.offline');
  ui.id.textContent = t('track.title', { id: PID });
  ui.brand.setAttribute('aria-label', t('watch.home'));
}

/* Человек взялся за карту — перестаём переставлять вид сами и предлагаем
   вернуться к машине одной кнопкой. */
function taken() {
  if (!follow) return;
  follow = false;
  if (carLL()) ui.back.hidden = false;
}

function darkNow() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    return false;            // браузер не умеет спрашивать тему — рисуем светлую
  }
}

function startMap() {
  map = createMap(ui.map, {
    center: Array.isArray(MAPCFG.center) ? MAPCFG.center : undefined,
    zoom: num(MAPCFG.zoom) || 13,
    theme: darkNow() ? 'dark' : 'light',
    tiles_light: MAPCFG.tiles_light || undefined,
    tiles_dark: MAPCFG.tiles_dark || undefined,
    min_zoom: num(MAPCFG.min_zoom) || undefined,
    max_zoom: num(MAPCFG.max_zoom) || undefined,
    attribution: MAPCFG.attribution || '',
    // Кнопку «где я» посторонний не просил: запрос к геолокации по чужой ссылке
    // выглядит подозрительно и ничего не даёт.
    locate: false,
  });
  for (const type of ['pointerdown', 'wheel', 'touchstart']) {
    ui.map.addEventListener(type, taken, { capture: true, passive: true });
  }
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const swap = () => {
      if (map) map.setTheme(darkNow() ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', swap);
    else if (mq.addListener) mq.addListener(swap);
  } catch (e) {
    /* следить за темой нечем — останется та, с которой открылись */
  }
}

/* ── карта ─────────────────────────────────────────────────────────────── */

/* Поля вокруг того, что должно попасть в кадр: сверху шапка, снизу карточка. */
function padBox() {
  const top = ui.top ? ui.top.offsetHeight : 0;
  const panel = ui.panel ? ui.panel.offsetHeight : 0;
  return {
    top: Math.round(top + 24),
    bottom: Math.round(panel + 24),
    left: 24,
    right: 24,
  };
}

function fitAll(force) {
  if (!map || !order) return;
  if (!follow && !force) return;
  const pts = placeLL();
  const car = carLL();
  const path = routeLL();
  const st = order.status;
  let set;
  if (st === 'draft' || st === 'searching') set = pts.slice(0, 1);
  else if (TO_PICKUP.indexOf(st) >= 0) set = (car ? [car] : []).concat(pts.slice(0, 1));
  else set = (car ? [car] : []).concat(path.length > 1 ? path : pts);
  if (!set.length) set = pts;
  if (!set.length) return;
  map.fitPoints(set, { padding: padBox(), maxZoom: 16.5 });
  fitAt = Date.now();
  fitFrom = car ? car.slice() : null;
}

/* Машина в свободной части экрана — той, что не закрыта карточкой и шапкой. */
function inFrame(ll) {
  if (!map || !ui.map) return true;
  const box = ui.map.getBoundingClientRect();
  const p = map.containerPoint(ll);
  const pad = padBox();
  return p.x > pad.left && p.x < box.width - pad.right
    && p.y > pad.top && p.y < box.height - pad.bottom;
}

/* Машина ушла за край кадра или заметно отъехала — подтягиваем вид. Пока она
   едет посреди экрана, карту не трогаем вовсе: пусть человек смотрит. */
function keepInView() {
  if (!follow) return;
  const car = carLL();
  if (!car) return;
  if (!inFrame(car)) {
    fitAll();
    return;
  }
  const moved = fitFrom ? distanceM(fitFrom, car) : Infinity;
  if (Date.now() - fitAt > REFIT_MS && moved > REFIT_M) fitAll();
}

function syncMap(first) {
  const pts = placeLL();
  const path = routeLL();
  const key = pts.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';')
    + '|' + path.length;
  if (key !== placeKey) {
    placeKey = key;
    for (const m of spots) m.remove();
    spots = pts.map((ll, i) => map.marker({
      at: ll,
      html: i === 0 ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
      anchor: i === 0 ? 'center' : 'bottom',
      zIndex: 10 + i,
    }));
    if (path.length > 1) {
      if (line) line.setCoords(path);
      else line = map.route(path, { width: 6 });
      meta = measure(path);
    } else if (line) {
      line.remove();
      line = null;
      meta = null;
    }
    fitAll(first);
  } else if (order.status !== statusKey) {
    // Сменился этап — в кадре теперь важно другое: то точка подачи, то весь путь.
    fitAll(first);
  }
  statusKey = order.status;
  syncCar(first);
}

function syncCar(first) {
  const at = carLL();
  if (!at) {
    if (carPin) {
      carPin.remove();
      carPin = null;
    }
    ui.back.hidden = true;
    return;
  }
  const heading = num(order.courier && order.courier.heading);
  if (!carPin) {
    carPin = map.marker({
      at,
      html: pin('car'),
      rotate: true,
      zIndex: 40,
      heading: heading === null ? undefined : heading,
    });
    fitAll(first);
  } else {
    carPin.moveTo(at, heading === null ? {} : { heading });
    keepInView();
  }
  if (!follow) ui.back.hidden = false;
  // Пройденный кусок маршрута гаснет позади машины: сразу видно, сколько пути
  // уже позади. Ушла в объезд — ничего не гасим, врать не будем.
  if (line && meta) {
    const hit = routeShare(at);
    if (hit.gap < OFF_ROUTE_M) line.setProgress(hit.f);
  }
}

/* ── карточка под картой ───────────────────────────────────────────────── */

function tone(st) {
  if (st === 'done') return 'ok';
  if (st === 'cancelled' || st === 'expired') return 'err';
  return 'go';
}

function subText() {
  const st = order.status;
  const eta = etaSeconds();
  if (TO_PICKUP.indexOf(st) >= 0) {
    if (!carLL()) return t('watch.sub.assigned');
    return eta < 60 ? t('watch.sub.pickup_soon')
      : t('watch.sub.pickup', { time: fmtDuration(eta) });
  }
  if (st === 'in_transit') {
    if (!carLL()) return t('watch.sub.no_geo');
    return eta < 60 ? t('watch.sub.transit_soon')
      : t('watch.sub.transit', { time: fmtDuration(eta) });
  }
  if (st === 'done') {
    const at = num(order.done_at);
    return at ? t('watch.sub.done', { time: fmtTime(at) }) : '';
  }
  return t('watch.sub.' + st);
}

function stats() {
  const out = [];
  const st = order.status;
  const driving = TO_PICKUP.indexOf(st) >= 0 || ON_ROUTE.indexOf(st) >= 0;
  const eta = driving ? etaSeconds() : 0;
  if (eta >= 60) out.push([fmtDuration(eta), t('watch.eta')]);
  if (ON_ROUTE.indexOf(st) >= 0) {
    const rest = Math.round(restMeters());
    if (rest > 0) out.push([fmtDistance(rest), t('watch.left')]);
  }
  const whole = num(order.distance_m) || 0;
  if (out.length < 2 && whole > 0) out.push([fmtDistance(whole), t('watch.total')]);
  const total = num(order.price_total) || 0;
  if (total > 0) {
    out.push([fmtMoney(total),
      order.payment_status === 'paid' ? t('watch.paid') : t('watch.price')]);
  }
  return out;
}

function renderStats() {
  ui.stats.textContent = '';
  for (const row of stats()) {
    const li = node('li');
    li.appendChild(node('b', null, row[0]));
    li.appendChild(node('span', null, row[1]));
    ui.stats.appendChild(li);
  }
}

function renderRoute() {
  const list = order && Array.isArray(order.points) ? order.points : [];
  const key = getLang() + '|' + list.map((p) => String(p && p.addr)).join('|');
  if (key === routeKey) return;
  routeKey = key;
  ui.route.textContent = '';
  if (!list.length) return;
  const rows = [[list[0], t('order.from'), 'a']];
  if (list.length > 2) rows.push([null, tp(list.length - 2, 'watch.stops'), 'mid']);
  if (list.length > 1) rows.push([list[list.length - 1], t('order.to'), 'b']);
  for (const row of rows) {
    const li = node('li', 'watch__stop watch__stop--' + row[2]);
    const dot = node('i', 'watch__pin');
    dot.setAttribute('aria-hidden', 'true');
    li.appendChild(dot);
    li.appendChild(node('span', 'watch__label', row[1]));
    const addr = row[0] ? String(row[0].addr || '').trim() : '';
    if (row[0]) li.appendChild(node('span', 'watch__addr', addr || '—'));
    ui.route.appendChild(li);
  }
}

function renderCar() {
  const c = order && order.courier;
  const car = (c && c.car) || {};
  const sign = [c && c.name, car.model, car.plate, car.color, c && c.rating].join('|');
  const key = c ? getLang() + '|' + sign : '';
  if (key === carKey) return;
  carKey = key;
  ui.car.textContent = '';
  ui.car.hidden = !c;
  if (!c) return;

  ui.car.appendChild(node('span', 'watch__face', initials(c.name || '') || '?'));

  const who = node('div', 'watch__who');
  const model = [car.model, car.color].filter(Boolean).join(', ');
  who.appendChild(node('b', null, model || t('track.car')));
  if (c.name) who.appendChild(node('span', 'watch__muted', c.name));
  ui.car.appendChild(who);

  const side = node('div', 'watch__side');
  if (car.plate) side.appendChild(node('span', 'watch__plate', fmtPlate(car.plate)));
  const rating = num(c.rating);
  if (rating) {
    const stars = node('span', 'watch__rate');
    stars.innerHTML = STAR;
    stars.appendChild(node('b', null, String(rating).replace('.', ',')));
    side.appendChild(stars);
  }
  ui.car.appendChild(side);
}

function renderFresh() {
  const at = num(order && order.courier && order.courier.geo_at)
    || (beat ? Math.floor(beat / 1000) : 0);
  if (!at) {
    ui.fresh.textContent = '';
    return;
  }
  ui.fresh.textContent = nowSec() - at < 60
    ? t('watch.just_now')
    : t('watch.updated', { time: fmtTime(at) });
}

function render() {
  if (!order) return;
  const st = order.status || 'draft';
  const title = t('watch.st.' + st);
  ui.titleText.textContent = title;
  ui.dot.className = 'watch__dot watch__dot--' + tone(st);
  ui.sub.textContent = subText();
  renderStats();
  renderRoute();
  renderCar();
  renderFresh();
  document.title = title + ' · ' + t('track.title', { id: PID });
}

/* ── связь с сервером ──────────────────────────────────────────────────── */

function take(data, first) {
  if (!data || typeof data !== 'object') return;
  beat = Date.now();
  // Из потока события приходят кусками: в одном статус и курьер, в другом
  // только координата. Поэтому кладём их поверх прежних, а не вместо них.
  order = Object.assign({}, order || {}, data);
  if (!shown) {
    shown = true;
    document.documentElement.classList.add('is-watching');
    startMap();
  }
  // Сперва карта, потом карточка: подписи считают остаток пути по измеренному
  // маршруту, а меряет его как раз карта.
  syncMap(first === true);
  render();
}

function geo(data) {
  if (!data || !order) return;
  const lat = num(data.at && data.at[0]);
  const lng = num(data.at && data.at[1]);
  if (lat === null || lng === null) return;
  beat = Date.now();
  const courier = Object.assign({}, order.courier || {}, {
    at: [lat, lng],
    heading: num(data.heading),
    speed: num(data.speed),
    geo_at: num(data.geo_at) || nowSec(),
  });
  order = Object.assign({}, order, { courier });
  if (data.status) order.status = data.status;
  if (map) syncMap(false);
  render();
}

function load() {
  return api.get('/orders/' + encodeURIComponent(PID), { t: TOKEN }, { auth: false })
    .then((data) => {
      take(data, !shown);
      return true;
    })
    .catch((e) => {
      // 403 и 404 — ссылка не подходит или заказа больше нет. Спорить не с чем:
      // человек остаётся на карточке, которую собрал сервер, и она честная.
      if (e && (e.status === 403 || e.status === 404) && stream) {
        stream.close();
        stream = null;
      }
      return false;
    });
}

function listen() {
  stream = api.stream('/orders/' + encodeURIComponent(PID) + '/stream', {
    params: { t: TOKEN },
    auth: false,
    events: ['search_failed'],
    onOpen: () => {
      ui.wire.hidden = true;
    },
    onEvent: (name, data) => {
      if (name === 'ping') beat = Date.now();
      else if (name === 'geo') geo(data);
      else if (name === 'order') take(data, !shown);
      else if (name === 'search_failed' && order) take({ status: 'expired' }, false);
    },
    onError: () => {
      if (shown) ui.wire.hidden = false;
    },
  });
}

/* Вкладку свернули и вернулись: поток переподключится сам, но между обрывом и
   возвратом мы пропустили движение. Поэтому спрашиваем заказ целиком. */
function wake() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - beat < STALE_MS) return;
  if (order && OVER.indexOf(order.status) >= 0) return;
  load();
}

function boot() {
  if (!PID || !TOKEN) return;      // токена нет — страница остаётся карточкой
  if (cfg.tz) setTimeZone(cfg.tz);
  build();
  labels();
  listen();
  load();
  onLangChange(() => {
    labels();
    routeKey = '';
    carKey = '';
    render();
  });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('resize', () => {
    if (shown) fitAll();
  });
  // Строка «обновлено» стареет сама, без единого события с сервера.
  window.setInterval(() => {
    if (order) renderFresh();
  }, FRESH_MS);
}

boot();
