/* Растровая карта своими руками: плитки, жесты, маркеры, маршруты и зоны спроса.
   Ни одной библиотеки — только браузер. Всё, что делает карту «живой»
   (инерция, щипок, дробный зум, переиспользование плиток), собрано здесь.

   Система координат простая: весь мир — квадрат из 256·2^z пикселей (Web Mercator).
   Любая точка превращается в мировые пиксели на текущем (дробном) зуме, а на экран
   попадает как «мировые пиксели минус левый верхний угол вида». Дальше — только
   transform: translate3d/scale, никаких left/top, чтобы всё считала видеокарта.

   Два правила чёткости, из-за которых карта не мылит и не дрожит:
   1) на плотном экране просим удвоенные плитки — иначе телефон растягивает
      картинку 256×256 на 768 своих точек, и город превращается в кашу;
   2) любое смещение слоя округляем до целой точки устройства, а не до целого
      css-пикселя: на дробных значениях браузер размазывает и плитки, и маркеры.

   И одно правило честности, без которого всё остальное бессмысленно: угол вида
   (view) обязан совпадать с центром и зумом в любую миллисекунду, а не только
   в кадре отрисовки. Между кадрами у карты то и дело спрашивают «что под этой
   точкой» — щипок закончился, колесо докрутилось, палец ткнул. Ответ по
   вчерашнему виду смешивает пиксели старого зума с новым, и карту выкидывает
   на край света вместе со всеми плитками. Поэтому view пересчитывается там же,
   где меняются центр, зум и размер, — в syncView. */

import { t, tp, extend, onLangChange } from './i18n.js';

extend({
  ru: {
    'map.title': 'Карта',
    'map.zoom_in': 'Приблизить',
    'map.zoom_out': 'Отдалить',
    'map.locate': 'Показать, где я',
    'map.geo_no': 'Браузер не умеет определять положение',
    'map.geo_denied': 'Доступ к местоположению закрыт — включите его в настройках браузера',
    'map.geo_fail': 'Не получилось определить, где вы',
    'map.geo_slow': 'Спутники ищутся слишком долго',
    'map.geo_off': 'Местоположение недоступно',
    'map.zone_orders': '{n} заказ|{n} заказа|{n} заказов',
  },
  ky: {
    'map.title': 'Карта',
    'map.zoom_in': 'Жакындатуу',
    'map.zoom_out': 'Алыстатуу',
    'map.locate': 'Мен кайдамын',
    'map.geo_no': 'Браузер жайгашкан жерди аныктай албайт',
    'map.geo_denied': 'Жайгашкан жерге уруксат жок — браузердин жөндөөлөрүнөн ачыңыз',
    'map.geo_fail': 'Кайда экениңизди аныктай албадык',
    'map.geo_slow': 'Спутниктер өтө көпкө изделүүдө',
    'map.geo_off': 'Жайгашкан жер жеткиликсиз',
    'map.zone_orders': '{n} заказ',
  },
});

const TILE = 256;
const MAX_LAT = 85.0511287798066;     // широта, на которой Меркатор становится квадратом
const DEG = Math.PI / 180;

const DEFAULTS = {
  center: [42.8746, 74.5698],         // Бишкек, площадь Ала-Тоо
  zoom: 13,
  minZoom: 10,                        // город целиком и немного вокруг — дальше смотреть незачем
  maxZoom: 19,
  theme: 'dark',
  interactive: true,
  controls: true,                     // кнопки «+» и «−»
  locate: true,                       // кнопка «моё местоположение»
  tiles: null,                        // строка-шаблон либо {light, dark}
  tilesLight: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tilesDark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  subdomains: 'abc',
  key: '',
  attribution: '',                    // подпись владельца; источник плиток добавляется сам
  buffer: 1,                          // сколько рядов плиток подгружаем за краем экрана
};

/* Правила, по которым карта никогда не показывает серую дыру.

   Грубый подслой. Под рабочим уровнем всегда лежит уровень как минимум на
   COARSE_GAP ступеней ниже. Ту же площадь он закрывает в 64 раза меньшим числом
   плиток, то есть стоит копейки, — зато при отдалении, рывке пальцем или инерции
   мгновенно закрывает всё, что рабочий уровень подгрузить ещё не успел. Ступень
   залипающая, кратная COARSE_STEP: подробности в underZoom.

   Подстилка. Ещё ниже грубого лежит совсем грубый уровень, FLOOR_GAP ступеней
   от рабочего. Одна его плитка растянута на десятки экранов, поэтому при
   протаскивании ей нечего догружать: сколько карту ни тащи, она уже под ней.
   Стоит подстилка девять плиток на полгорода — дешевле, чем один серый кадр.

   Предел отдаления. Ниже MIN_ZOOM_FLOOR не пускаем даже из настроек админки:
   на таком масштабе Бишкек — точка, плитки считаются сотнями, а пользы ноль. */
const COARSE_GAP = 3;
const COARSE_STEP = 3;                // подслой стоит на ступенях, кратных трём
const COARSE_FLOOR = 3;               // ниже третьего уровня плиток нет почти ни у кого
const FLOOR_GAP = 6;                  // насколько ниже рабочего лежит подстилка
const MIN_ZOOM_FLOOR = 9;
const MAX_LEVELS = 7;                 // рабочий, цель, два подслоя и остатки прошлых
const TILE_RETRY = 2;                 // сколько раз перезапрашиваем упавшую плитку
const TILE_RETRY_MS = 700;            // пауза перед первым повтором, перед вторым — вдвое
const TILE_STALL_MS = 15000;          // столько ждём молчащий сервер и отпускаем полосу
const FRAME_TILES = 16;               // столько новых плиток заводим за кадр в движении

/* Сколько плиток тянем разом. Ровно столько соединений браузер держит к одному
   хосту: просить больше бессмысленно — остальное всё равно встанет в очередь,
   но уже в чужую, где мы не решаем, что важнее. */
const TILE_LANES = 6;

/* Насколько вперёд заказываем плитки при протаскивании. Пока плитка едет по
   мобильному интернету, карта успевает уехать на пол-экрана: просим не там, где
   карта сейчас, а там, где она будет. Дальше PREFETCH_SCREENS не заглядываем —
   это уже гадание, за которое платит трафик. */
const LOOKAHEAD_MS = 700;
const PREFETCH_SCREENS = 1.25;

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_LOCATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/>' +
  '<circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
  '<path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

/* Машина курьера — вид сверху: жёлтый фургон носом вперёд, тёмное лобовое,
   зеркала и колёса чуть выступают по бокам, под кузовом мягкая тень.
   Носом вверх, потому что маркер разворачивается на угол азимута, где ноль — север.
   Цвета вынесены в map.css: на светлой карте машина другая, чем на тёмной. */
const CAR_SVG = '<svg class="map-car" viewBox="0 0 44 55" aria-hidden="true">' +
  '<defs><radialGradient id="sg-car-shade" cx="50%" cy="50%" r="50%">' +
  '<stop offset="0" stop-color="#000" stop-opacity=".38"/>' +
  '<stop offset=".55" stop-color="#000" stop-opacity=".18"/>' +
  '<stop offset="1" stop-color="#000" stop-opacity="0"/>' +
  '</radialGradient></defs>' +
  '<ellipse class="map-car__shade" cx="22" cy="29.5" rx="16" ry="21.5" fill="url(#sg-car-shade)"/>' +
  '<g class="map-car__wheels">' +
  '<rect x="6.7" y="15.5" width="3.2" height="8" rx="1.6"/>' +
  '<rect x="6.7" y="32" width="3.2" height="8.5" rx="1.6"/>' +
  '<rect x="34.1" y="15.5" width="3.2" height="8" rx="1.6"/>' +
  '<rect x="34.1" y="32" width="3.2" height="8.5" rx="1.6"/>' +
  '</g>' +
  '<g class="map-car__mirrors">' +
  '<rect x="6.5" y="10.4" width="3.1" height="2.5" rx="1.2"/>' +
  '<rect x="34.4" y="10.4" width="3.1" height="2.5" rx="1.2"/>' +
  '</g>' +
  '<rect class="map-car__shell" x="9" y="5" width="26" height="46" rx="7"/>' +
  '<rect class="map-car__lamp" x="12.6" y="6.8" width="4.2" height="2" rx=".9"/>' +
  '<rect class="map-car__lamp" x="27.2" y="6.8" width="4.2" height="2" rx=".9"/>' +
  '<path class="map-car__glass" d="M12.7 16.6 14.1 10.7q.3-1.3 1.7-1.3h12.4q1.4 0 1.7 1.3l1.4 5.9z"/>' +
  '<rect class="map-car__roof" x="12" y="19.6" width="20" height="24.2" rx="3.4"/>' +
  '<rect class="map-car__glass" x="13.6" y="44.4" width="16.8" height="2.6" rx="1.2"/>' +
  '<rect class="map-car__tail" x="12.6" y="47.8" width="4" height="2" rx=".9"/>' +
  '<rect class="map-car__tail" x="27.4" y="47.8" width="4" height="2" rx=".9"/>' +
  '</svg>';

/* ─────────────────────────────────────────────────────── мелкая математика */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const n2 = (v) => Math.round(v * 100) / 100;

/* ───────────────────────────────────────── плотность экрана и чёткость плиток */

/* Плотность точек меняется на ходу: страницу увеличили колесом, окно перетащили
   на второй монитор. Держим одно значение на все карты и будим их при смене. */
let DPR = dprNow();
const dprWakes = new Set();
let dprQuery = null;

const RETINA_FROM = 1.4;              // ниже этой плотности удвоенная плитка не нужна
const RETINA_GIVE_UP = 3;             // столько промахов подряд — и больше не просим @2x
const RETINA_SLOT = /\{r\}|\{scale\}/;
const retinaMiss = new Map();         // шаблон → сколько раз удвоенной плитки не нашлось

function dprNow() {
  const v = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return v > 0 ? v : 1;
}

function mqOn(q, fn) {
  if (q.addEventListener) q.addEventListener('change', fn);
  else if (q.addListener) q.addListener(fn);        // Safari до 14
}

function mqOff(q, fn) {
  if (q.removeEventListener) q.removeEventListener('change', fn);
  else if (q.removeListener) q.removeListener(fn);
}

/** Пересчитать плотность и разбудить карты, если она и правда изменилась. */
function syncDpr() {
  const v = dprNow();
  if (Math.abs(v - DPR) < 1e-6) return false;
  DPR = v;
  for (const wake of Array.from(dprWakes)) wake();
  return true;
}

/* Медиазапрос «ровно такая плотность» перестаёт совпадать в ту же секунду,
   когда плотность поменялась, — это самый дешёвый способ об этом узнать. */
function watchDpr() {
  if (dprQuery || typeof window === 'undefined' || !window.matchMedia) return;
  const q = window.matchMedia('(resolution: ' + DPR + 'dppx)');
  const changed = () => {
    mqOff(q, changed);
    dprQuery = null;
    syncDpr();
    watchDpr();
  };
  mqOn(q, changed);
  dprQuery = q;
}

function retinaWanted(tpl) {
  return DPR > RETINA_FROM && (retinaMiss.get(tpl) || 0) < RETINA_GIVE_UP;
}

function retinaMissed(tpl) {
  retinaMiss.set(tpl, (retinaMiss.get(tpl) || 0) + 1);
}

/** Подставить параметр в адрес: был — заменим значение, не было — допишем. */
function withParam(url, name, value) {
  const re = new RegExp('([?&]' + name + '=)[^&#]*');
  if (re.test(url)) return url.replace(re, '$1' + value);
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + name + '=' + value;
}

/** Удвоенную плитку каждый поставщик просит по-своему, а шаблон об этом молчит. */
function retinaUrl(url) {
  if (/yandex/i.test(url)) return withParam(url, 'scale', '2');
  if (/2gis/i.test(url)) {
    if (/[?&]ts=online_sd/i.test(url)) return url.replace(/([?&]ts=)online_sd/i, '$1online_hd');
    return /[?&]ts=/i.test(url) ? url : withParam(url, 'ts', 'online_hd');
  }
  // OSM, Carto и почти все растровые серверы — суффикс перед расширением
  return url.replace(/(\.(?:png|jpe?g|webp))(?=$|[?#])/i, '@2x$1');
}

/* Мягкое пятно рисуем один раз на цвет и потом просто штампуем: считать
   градиент на каждую ячейку в каждом кадре — верный способ уронить кадры.
   Готовые пятна общие на все карты страницы, их всего пять. */
const ZONE_FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const zoneSprites = new Map();
const ZONE_SPRITE_PX = 128;

function zoneSprite(color) {
  const had = zoneSprites.get(color);
  if (had) return had;
  const cv = document.createElement('canvas');
  cv.width = ZONE_SPRITE_PX;
  cv.height = ZONE_SPRITE_PX;
  zoneSprites.set(color, cv);
  const g = cv.getContext ? cv.getContext('2d') : null;
  if (!g) return cv;
  const c = ZONE_SPRITE_PX / 2;
  const grad = g.createRadialGradient(c, c, c * 0.1, c, c, c);
  // край гасим в три приёма, иначе пятно выглядит как блин с обводкой
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.62)');
  grad.addColorStop(0.78, 'rgba(255,255,255,.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, ZONE_SPRITE_PX, ZONE_SPRITE_PX);
  // маску красим цветом поверх: мусорную строку браузер просто не примет,
  // и на месте пятна останется белое, а не пустота
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#7430E0';
  g.fillStyle = color;
  g.fillRect(0, 0, ZONE_SPRITE_PX, ZONE_SPRITE_PX);
  return cv;
}

function reduced() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Точку принимаем в любом разумном виде: [lat,lng], {lat,lng}, {lat,lon}, {at:[…]}. */
export function toLL(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    const a = +v[0], b = +v[1];
    return isFinite(a) && isFinite(b) ? [a, b] : null;
  }
  if (typeof v === 'object') {
    if (v.at) return toLL(v.at);
    const lat = +v.lat, lng = +(v.lng !== undefined ? v.lng : v.lon);
    return isFinite(lat) && isFinite(lng) ? [lat, lng] : null;
  }
  return null;
}

/** Географическая точка → мировые пиксели на заданном зуме. */
export function project(lat, lng, zoom) {
  const size = TILE * Math.pow(2, zoom);
  const la = clamp(lat, -MAX_LAT, MAX_LAT) * DEG;
  return {
    x: (lng / 360 + 0.5) * size,
    y: (0.5 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / (2 * Math.PI)) * size,
  };
}

/** Обратное преобразование: мировые пиксели → [lat, lng]. */
export function unproject(x, y, zoom) {
  const size = TILE * Math.pow(2, zoom);
  const lng = (x / size - 0.5) * 360;
  const lat = (2 * Math.atan(Math.exp((0.5 - y / size) * 2 * Math.PI)) - Math.PI / 2) / DEG;
  return [lat, lng];
}

/** Расстояние по земле в метрах — пригождается и для подписей, и для проверок. */
export function distanceM(a, b) {
  const p = toLL(a), q = toLL(b);
  if (!p || !q) return 0;
  const R = 6371008.8;
  const dLat = (q[0] - p[0]) * DEG;
  const dLng = (q[1] - p[1]) * DEG;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(p[0] * DEG) * Math.cos(q[0] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Азимут движения из точки в точку, 0 — на север. Нужен, чтобы развернуть машину. */
export function bearing(a, b) {
  const p = toLL(a), q = toLL(b);
  if (!p || !q) return 0;
  const dl = (q[1] - p[1]) * DEG;
  const y = Math.sin(dl) * Math.cos(q[0] * DEG);
  const x = Math.cos(p[0] * DEG) * Math.sin(q[0] * DEG) -
    Math.sin(p[0] * DEG) * Math.cos(q[0] * DEG) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/* ─────────────────────────────────────────────────── источники плиток

   Указывать, чьи это плитки, обязательно: этого требуют и лицензия
   OpenStreetMap, и условия Яндекса, и CARTO. Поэтому подпись собирается из
   самого адреса плиток, а не из настройки: название сервиса владелец может
   дописать рядом, но затереть источник у него не выйдет.
   `mark` — по чему узнаём этот же источник в тексте владельца, чтобы не
   написать «© OpenStreetMap» дважды. */

const SOURCES = [
  {
    // плитки CARTO нарисованы по данным OSM, поэтому упомянуть нужно обоих
    test: /openstreetmap|tile\.osm\b|cartocdn/i, mark: /openstreetmap|\bosm\b/i,
    text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright',
  },
  {
    test: /cartocdn|carto\.com/i, mark: /carto/i,
    text: '© CARTO', href: 'https://carto.com/attributions',
  },
  {
    test: /yandex/i, mark: /яндекс|yandex/i,
    text: '© Яндекс Карты', href: 'https://yandex.ru/maps/',
  },
  {
    test: /2gis|2гис/i, mark: /2gis|2гис/i,
    text: '© 2ГИС', href: 'https://2gis.kg/',
  },
];

/* ─────────────────────────────────────────────────────── узлы */

function div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function svgNode(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  return n;
}

function button(cls, label, html) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = html;
  return b;
}

/* ─────────────────────────────────────────────────────── сама карта */

/**
 * Создать карту внутри контейнера. Контейнер должен иметь размеры (обычно inset:0).
 * Возвращает объект управления; всё остальное — внутри замыкания.
 */
export function createMap(container, options = {}) {
  const opt = Object.assign({}, DEFAULTS, options);
  // /config отдаёт ключи в змеином регистре — принимаем и такие, чтобы не городить обёртку
  if (options.tiles_light) opt.tilesLight = options.tiles_light;
  if (options.tiles_dark) opt.tilesDark = options.tiles_dark;
  if (options.max_zoom) opt.maxZoom = +options.max_zoom;
  if (options.min_zoom) opt.minZoom = +options.min_zoom;
  opt.minZoom = clamp(+opt.minZoom || DEFAULTS.minZoom, MIN_ZOOM_FLOOR, 22);
  opt.maxZoom = clamp(opt.maxZoom, opt.minZoom, 22);
  opt.buffer = clamp(Math.round(+opt.buffer || 0), 1, 3);   // запас за краем экрана обязателен

  let theme = opt.theme === 'light' ? 'light' : 'dark';
  let center = toLL(opt.center) || DEFAULTS.center.slice();
  let zoom = clamp(+opt.zoom || DEFAULTS.zoom, opt.minZoom, opt.maxZoom);

  let w = 0, h = 0;
  const view = { x: 0, y: 0 };          // левый верхний угол вида в мировых пикселях
  let destroyed = false;

  /* ── слои ─────────────────────────────────────────────────────────────── */

  container.classList.add('map', theme === 'light' ? 'map--light' : 'map--dark');
  if (!opt.interactive) container.classList.add('map--static');
  container.setAttribute('aria-label', t('map.title'));

  /* Всё, что живёт в координатах карты, лежит внутри world. В режиме следования
     этот слой поворачивается по ходу движения — один transform на всю карту
     вместо поворота каждой плитки. Кнопки и подпись остаются снаружи: они
     принадлежат экрану, а не местности, и крутиться вместе с городом им незачем. */
  const world = div('map__world');
  const tilesPane = div('map__tiles');
  const pane = div('map__pane');
  const vector = svgNode('svg', { class: 'map__vector', 'aria-hidden': 'true' });
  const markersPane = div('map__markers');
  const attrBox = div('map__attr');

  pane.appendChild(vector);
  pane.appendChild(markersPane);
  world.appendChild(tilesPane);
  world.appendChild(pane);
  container.appendChild(world);
  container.appendChild(attrBox);

  let ctrlBox = null, locBtn = null, bIn = null, bOut = null;
  if (opt.interactive && opt.controls) {
    ctrlBox = div('map__ctrl');
    bIn = button('map__btn map__btn--in', t('map.zoom_in'), ICON_PLUS);
    bOut = button('map__btn map__btn--out', t('map.zoom_out'), ICON_MINUS);
    bIn.addEventListener('click', () => zoomStep(1));
    bOut.addEventListener('click', () => zoomStep(-1));
    ctrlBox.appendChild(bIn);
    ctrlBox.appendChild(bOut);
    container.appendChild(ctrlBox);
  }
  if (opt.interactive && opt.locate) {
    locBtn = button('map__btn map__btn--locate', t('map.locate'), ICON_LOCATE);
    locBtn.addEventListener('click', () => locate());
    container.appendChild(locBtn);
  }

  /** Подписи кнопок живут в двух языках, а язык переключают прямо на экране. */
  function relabel() {
    container.setAttribute('aria-label', t('map.title'));
    const say = (node, key) => {
      if (!node) return;
      node.setAttribute('aria-label', t(key));
      node.title = t(key);
    };
    say(bIn, 'map.zoom_in');
    say(bOut, 'map.zoom_out');
    say(locBtn, 'map.locate');
  }

  const stopLang = onLangChange(relabel);

  /* ── состояние отрисовки ──────────────────────────────────────────────── */

  const levels = new Map();             // целый зум → слой плиток
  const pool = [];                      // снятые с экрана <img>, ждут повторного применения
  const markers = new Set();
  const routes = new Set();
  let lastRoute = null;                 // к нему относится map.setRouteProgress
  const zoneLayers = new Set();
  const handlers = new Map();
  const unbinds = [];

  let activeZ = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
  let goalZ = activeZ;                  // уровень, к которому едет анимация зума
  const under = new Set();              // подслои, которые держим заполненными
  const base = { x: 0, y: 0 };          // точка отсчёта слоя маркеров
  let baseZoom = null;

  let raf = 0, lastTs = 0, dirty = true;
  let viewAnim = null, zoomAnim = null, inertia = null, rotAnim = null;
  let endTimer = 0, tapTimer = 0, pressTimer = 0, wheelTimer = 0;
  let lastLat = NaN, lastLng = NaN, lastZoom = NaN, settleZoom = zoom;
  let pendingFit = null;
  let follower = null;                  // состояние режима следования, см. follow()

  /* Поворот карты: на сколько градусов местность отвёрнута от севера.
     Косинус с синусом держим посчитанными — они нужны в каждом переводе
     координат, а это десятки раз за кадр. */
  let rotDeg = 0, rotCos = 1, rotSin = 0;

  /* Левый верхний угол вида в мировых пикселях. Меняется ровно там же, где
     центр, зум и размер контейнера, — см. большой комментарий в шапке файла. */
  function syncView() {
    const p = project(center[0], center[1], zoom);
    view.x = p.x - w / 2;
    view.y = p.y - h / 2;
  }

  /** Экранное смещение от центра вида → смещение в мировых пикселях. */
  function unrot(sx, sy) {
    if (!rotDeg) return { x: sx, y: sy };
    return { x: sx * rotCos - sy * rotSin, y: sx * rotSin + sy * rotCos };
  }

  /** Мировое смещение от центра вида → экранное. Обратное к unrot. */
  function rotate(ux, uy) {
    if (!rotDeg) return { x: ux, y: uy };
    return { x: ux * rotCos + uy * rotSin, y: -ux * rotSin + uy * rotCos };
  }

  /** Повернуть карту на месте. Ноль — север вверху, как на бумажной карте. */
  function setRot(deg) {
    const d = ((deg % 360) + 360) % 360;
    if (Math.abs(d - rotDeg) < 0.01) return;
    rotDeg = d;
    const r = d * DEG;
    rotCos = Math.cos(r);
    rotSin = Math.sin(r);
    // ноль записываем пустой строкой: карта без поворота не должна платить
    // отдельным слоем композиции за трансформацию, которая ничего не делает
    world.style.transform = d ? 'rotate(' + n2(-d) + 'deg)' : '';
    container.classList.toggle('map--turned', d !== 0);
    for (const m of markers) faceMarker(m);
    invalidate();
  }

  /* Округление до целой точки устройства. На экране с плотностью 3 половина
     css-пикселя — это полторы точки: браузер честно размажет их по трём,
     и ровные линии домов поплывут. Округляем — и картинка встаёт намертво. */
  function snap(v) {
    return Math.round(v * DPR) / DPR;
  }

  /* Экран сменил плотность: удвоенные плитки теперь нужны (или наоборот),
     а сетка округления стала другой — перекладываем слой заново. */
  function onDpr() {
    if (destroyed) return;
    rebuildTiles();
  }

  dprWakes.add(onDpr);
  watchDpr();

  /* ── события ──────────────────────────────────────────────────────────── */

  function emit(type, data) {
    const list = handlers.get(type);
    if (!list) return;
    for (const fn of list.slice()) {
      try { fn(data); } catch (e) { console.error('карта, обработчик ' + type, e); }
    }
  }

  function on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const list = handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  function bind(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    unbinds.push(() => target.removeEventListener(type, fn, o));
  }

  function state() {
    return { center: center.slice(), zoom, bounds: bounds() };
  }

  /* ── цикл отрисовки ───────────────────────────────────────────────────── */

  function invalidate() {
    dirty = true;
    schedule();
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }

  function frame(ts) {
    raf = 0;
    const dt = lastTs ? clamp(ts - lastTs, 1, 50) : 16;
    lastTs = ts;
    const busy = step(dt, ts);
    if (dirty) { dirty = false; draw(); }
    if (busy || dirty) schedule(); else lastTs = 0;
  }

  /** Один шаг всех анимаций. Возвращает true, пока хоть что-то движется. */
  function step(dt, ts) {
    if (viewAnim) {
      const t = clamp((ts - viewAnim.t0) / viewAnim.dur, 0, 1);
      const u = easeInOut(t);
      const z = lerp(viewAnim.z0, viewAnim.z1, u);
      const x = lerp(viewAnim.p0.x, viewAnim.p1.x, u);
      const y = lerp(viewAnim.p0.y, viewAnim.p1.y, u);
      applyView(unproject(x, y, 0), z);
      if (t >= 1) viewAnim = null;
    }

    if (inertia) {
      const p = project(center[0], center[1], zoom);
      // скорость броска измерена в экранных точках, а ехать надо по местности
      const d = unrot(inertia.vx * dt, inertia.vy * dt);
      applyView(unproject(p.x + d.x, p.y + d.y, zoom), zoom);
      const k = Math.exp(-dt / 190);    // затухание, не зависящее от частоты кадров
      inertia.vx *= k;
      inertia.vy *= k;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.014) {
        inertia = null;
        snapZoom();
        invalidate();       // последний кадр без спешки: добираем плитки без ограничения
      }
    }

    if (zoomAnim) {
      const a = zoomAnim;
      const left = a.target - zoom;
      let z = zoom + left * (1 - Math.exp(-dt / 58));
      if (Math.abs(left) < 0.0025) { z = a.target; zoomAnim = null; invalidate(); }
      zoomAround(a.ll, a.pt, clamp(z, opt.minZoom, opt.maxZoom));
    }

    if (rotAnim) {
      const left = ((rotAnim.target - rotDeg + 540) % 360) - 180;   // по короткой дуге
      if (Math.abs(left) < 0.15) { setRot(rotAnim.target); rotAnim = null; }
      else setRot(rotDeg + left * (1 - Math.exp(-dt / 90)));
    }

    const following = stepFollow(dt, ts);

    let moving = false;
    for (const m of markers) {
      if (!m.anim) continue;
      moving = true;
      stepMarker(m, dt);
    }
    return moving || following || !!(viewAnim || inertia || zoomAnim || rotAnim);
  }

  function draw() {
    if (!w || !h) return;
    syncView();
    trackDrift();
    drawTiles();
    drawZones();
    drawOverlay();
    if (lastLat !== center[0] || lastLng !== center[1] || lastZoom !== zoom) {
      if (lastZoom !== zoom) syncCtrl();
      lastLat = center[0]; lastLng = center[1]; lastZoom = zoom;
      emit('move', state());
      scheduleSettle();
    }
  }

  function scheduleSettle() {
    clearTimeout(endTimer);
    endTimer = setTimeout(checkSettle, 130);
  }

  /** Карта считается «остановившейся», когда нет ни пальцев на экране, ни анимаций. */
  function checkSettle() {
    endTimer = 0;
    if (destroyed) return;
    if (pointers.size || viewAnim || inertia || zoomAnim || rotAnim) { scheduleSettle(); return; }
    // маршрут строим заново под новый масштаб: так упрощение линии остаётся честным
    let again = false;
    for (const r of routes) if (Math.abs(zoom - r.vz) >= 1) { buildRoute(r); again = true; }
    if (again) invalidate();
    if (settleZoom !== zoom) { settleZoom = zoom; emit('zoomend', state()); }
    emit('moveend', state());
  }

  /* ── слой плиток ──────────────────────────────────────────────────────── */

  function template() {
    if (typeof opt.tiles === 'string' && opt.tiles) return opt.tiles;
    if (opt.tiles && typeof opt.tiles === 'object') {
      return theme === 'light'
        ? (opt.tiles.light || opt.tiles.dark || DEFAULTS.tilesLight)
        : (opt.tiles.dark || opt.tiles.light || DEFAULTS.tilesDark);
    }
    return theme === 'light' ? opt.tilesLight : opt.tilesDark;
  }

  /**
   * Адрес плитки. k — во сколько раз плотнее нужна картинка: 1 или 2.
   * {r} даёт «@2x», {scale} — «1» или «2»; если в шаблоне нет ни того, ни
   * другого, дописываем удвоение сами по правилам поставщика.
   */
  function tileUrl(x, y, z, k) {
    const tpl = template();
    const subs = String(opt.subdomains || 'abc');
    const two = k === 2;
    const url = tpl.replace(/\{(-y|[a-z]+)\}/g, (all, key) => {
      switch (key) {
        case 'z': return String(z);
        case 'x': return String(x);
        case 'y': return String(y);
        case '-y': return String(Math.pow(2, z) - 1 - y);
        case 'r': return two ? '@2x' : '';
        case 'scale': return two ? '2' : '1';
        case 's': return subs.charAt(Math.abs(x + y) % subs.length);
        case 'key': return encodeURIComponent(opt.key || '');
        default: return all;
      }
    });
    return two && !RETINA_SLOT.test(tpl) ? retinaUrl(url) : url;
  }

  /* Уровень грубого подслоя. Ступень нарочно «залипающая», кратная трём:
     при быстром отдалении на восемь шагов подслой сменится не восемь раз, а два,
     и карта не станет качать три сотни плиток, которые никто не увидит. */
  function underZoom(z) {
    const step = Math.floor((z - COARSE_GAP) / COARSE_STEP) * COARSE_STEP;
    return clamp(step, COARSE_FLOOR, z);
  }

  function level(z) {
    return levels.get(z) || addLevel(z);
  }

  function addLevel(z) {
    const p = project(center[0], center[1], z);
    const lv = {
      z,
      el: div('map__level'),
      tiles: new Map(),
      origin: { x: Math.round(p.x), y: Math.round(p.y) },
    };
    lv.el.style.zIndex = String(z);
    tilesPane.appendChild(lv.el);
    levels.set(z, lv);
    return lv;
  }

  function dropLevel(lv) {
    for (const t of lv.tiles.values()) recycle(t);
    lv.tiles.clear();
    if (lv.el.parentNode) lv.el.parentNode.removeChild(lv.el);
    levels.delete(lv.z);
  }

  /** Снятую плитку не выбрасываем, а кладём в пул: DOM-узлы дороже, чем кажется. */
  function recycle(t) {
    const img = t.img;
    img.onload = null;
    img.onerror = null;
    waiting.delete(t);
    freeLane(t);
    if (t.timer) { clearTimeout(t.timer); t.timer = 0; }
    t.state = 'off';
    img.classList.remove('is-on');
    if (img.parentNode) img.parentNode.removeChild(img);
    // адрес снимаем обязательно: иначе повторная подстановка того же адреса
    // в некоторых браузерах не вызывает onload, и плитка остаётся прозрачной;
    // заодно это обрывает начатую загрузку и возвращает браузеру соединение
    img.removeAttribute('src');
    if (pool.length < 64) pool.push(img);
  }

  /* ── очередь загрузки ───────────────────────────────────────────────────

     Браузер тянет к одному хосту шесть картинок разом, остальные честно стоят
     в очереди — и ровно в том порядке, в каком их попросили. Стоит при быстром
     протаскивании выпустить полторы сотни плиток рабочего уровня, и та
     единственная грубая плитка, которая закрывает собой весь экран, оказывается
     в этой очереди последней. Вот он, серый экран: подстилка есть, заказана,
     но ждёт своей очереди за сотней подробностей, которых никто не увидит.

     Поэтому очередь мы держим свою. Подстилка и подслой идут вперёд всегда,
     дальше — от середины экрана к краям, а то, что успело уехать за край,
     из очереди просто выбрасывается и полосу не занимает. */

  const waiting = new Set();            // плитки, ждущие свободной полосы
  let inflight = 0;                     // сколько картинок тянется прямо сейчас
  let pumping = false;

  /** Адрес плитки с учётом заворота карты по долготе и номера попытки. */
  function tileAddr(t) {
    const n = Math.pow(2, t.lv.z);
    const wx = ((t.i % n) + n) % n;
    /* Номер попытки дописываем решёткой. На сервер она не уходит (адрес тот же),
       зато строка src отличается от прошлой — иначе браузер сочтёт повтор
       присвоением того же значения и ни onload, ни onerror уже не позовёт. */
    return tileUrl(wx, t.j, t.lv.z, t.two ? 2 : 1) + (t.tries ? '#' + t.tries : '');
  }

  /**
   * Насколько срочна плитка: меньше — раньше. null значит «уже не нужна».
   * Группа важнее расстояния: подстилка закрывает весь экран одной плиткой,
   * и ждать её позади сотни подробных — это и есть серое поле под пальцем.
   */
  function tileRank(t) {
    const lv = t.lv;
    if (!lv || levels.get(lv.z) !== lv) return null;    // уровень уже снесли
    const side = TILE * Math.pow(2, zoom - lv.z);       // сторона плитки на экране
    const cx = (t.i + 0.5) * side - view.x;
    const cy = (t.j + 0.5) * side - view.y;
    const group = under.has(lv.z) ? 0
      : (lv.z === goalZ && goalZ !== activeZ) ? 2
        : lv.z === activeZ ? 4 : 6;
    const far = Math.hypot(cx - w / 2, cy - h / 2) / Math.max(1, Math.min(w, h));
    return group + Math.min(far, 1.9);      // расстояние внутри группы не перебивает группу
  }

  function pumpTiles() {
    if (destroyed || pumping) return;
    pumping = true;
    while (inflight < TILE_LANES && waiting.size) {
      let best = null, rank = Infinity;
      for (const t of waiting) {
        const r = tileRank(t);
        if (r === null) { waiting.delete(t); continue; }
        if (r < rank) { rank = r; best = t; }
      }
      if (!best) break;
      waiting.delete(best);
      startTile(best);
    }
    pumping = false;
  }

  function startTile(t) {
    t.state = 'load';
    inflight++;
    // сервер может не ответить вообще никогда, а полоса нужна живым
    t.stall = setTimeout(() => stalled(t), TILE_STALL_MS);
    t.img.src = tileAddr(t);
  }

  /** Вернуть полосу. Зовём из каждого исхода загрузки, иначе очередь встанет. */
  function freeLane(t) {
    if (t.stall) { clearTimeout(t.stall); t.stall = 0; }
    if (t.state !== 'load') return;
    t.state = 'off';
    inflight = Math.max(0, inflight - 1);
  }

  function stalled(t) {
    t.stall = 0;
    if (destroyed || t.state !== 'load') return;
    freeLane(t);
    t.img.removeAttribute('src');       // обрываем запрос, который уже не придёт
    t.state = 'dead';
    t.dead = true;
    settle(t.lv);
    pumpTiles();
  }

  function addTile(lv, i, j) {
    const img = pool.pop() || new Image();
    const tpl = template();
    const key = i + ':' + j;
    const t = {
      i, j, key, img, lv, state: 'wait', ok: false, dead: false,
      tries: 0, timer: 0, stall: 0, two: retinaWanted(tpl), fell: false,
    };
    img.className = 'map__tile';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    // плитку внутри слоя двигаем плоским сдвигом: слой и так лежит на видеокарте,
    // а каждая плитка своим слоем — это лишняя память и щели между ними
    img.style.transform =
      'translate(' + (i * TILE - lv.origin.x) + 'px,' + (j * TILE - lv.origin.y) + 'px)';

    img.onload = () => {
      if (t.state !== 'load') return;   // ответ на снятый запрос — не наше дело
      freeLane(t);
      t.state = 'ok';
      t.ok = true;
      img.classList.add('is-on');
      // обычная плитка пришла вместо удвоенной — значит, @2x у этого сервера нет
      if (t.fell) retinaMissed(tpl);
      settle(lv);
      pumpTiles();
    };
    img.onerror = () => {
      if (t.state !== 'load') return;
      if (t.two && !t.fell) {
        // удвоенной плитки не нашлось — молча берём обычную. Полосу не отдаём:
        // мы уже в начале очереди, и терять место из-за чужой прихоти незачем
        t.fell = true;
        t.two = false;
        clearTimeout(t.stall);
        t.stall = setTimeout(() => stalled(t), TILE_STALL_MS);
        img.src = tileAddr(t);
        return;
      }
      freeLane(t);
      if (t.tries < TILE_RETRY) {
        // сеть моргнула или сервер поперхнулся: подождём и попробуем ещё раз,
        // но не бесконечно — две попытки, дальше плитку закрывает подслой
        t.tries++;
        t.timer = setTimeout(() => {
          t.timer = 0;
          if (destroyed || lv.tiles.get(key) !== t) return;
          t.state = 'wait';
          waiting.add(t);
          pumpTiles();
        }, TILE_RETRY_MS * t.tries);
        pumpTiles();
        return;
      }
      t.state = 'dead';
      t.dead = true;
      settle(lv);
      pumpTiles();
    };

    lv.tiles.set(key, t);
    lv.el.appendChild(img);
    waiting.add(t);
    pumpTiles();
    return t;
  }

  /* ── что именно грузим ──────────────────────────────────────────────── */

  /* Куда и как быстро уезжает вид — в мировых пикселях текущего зума за
     миллисекунду. Скорость нужна не ради красоты: пока плитка едет по мобильному
     интернету, карта успевает уйти на пол-экрана. Просим плитки там, где карта
     будет, а не там, где она сейчас. */
  let driftX = 0, driftY = 0;
  let lastDrawX = 0, lastDrawY = 0, lastDrawZ = NaN, lastDrawT = 0;

  function trackDrift() {
    const now = performance.now();
    if (lastDrawT && lastDrawZ === zoom) {
      const dt = clamp(now - lastDrawT, 1, 250);
      const k = Math.exp(-dt / 90);     // сглаживание: один дёрганый кадр не в счёт
      driftX = driftX * k + ((view.x - lastDrawX) / dt) * (1 - k);
      driftY = driftY * k + ((view.y - lastDrawY) / dt) * (1 - k);
    } else {
      driftX = 0;                       // зум сменился: пиксели уже не те, скорость тоже
      driftY = 0;
    }
    lastDrawX = view.x; lastDrawY = view.y; lastDrawZ = zoom; lastDrawT = now;
  }

  /* Мировая рамка видимого. Пока карта смотрит на север, это просто вид; когда
     она повёрнута, экран лежит на местности наискось, и закрывать надо описанный
     вокруг него прямоугольник — иначе углы останутся пустыми. */
  function viewBox() {
    if (!rotDeg) return { x0: view.x, y0: view.y, x1: view.x + w, y1: view.y + h };
    const cx = view.x + w / 2, cy = view.y + h / 2;
    const hx = (Math.abs(w * rotCos) + Math.abs(h * rotSin)) / 2;
    const hy = (Math.abs(w * rotSin) + Math.abs(h * rotCos)) / 2;
    return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
  }

  /** Прямоугольник, который нужно закрыть плитками: вид плюс запас по ходу движения. */
  function wantBox(ahead) {
    const box = viewBox();
    if (!ahead) return box;
    const cap = Math.max(w, h) * PREFETCH_SCREENS;
    const lx = clamp(driftX * LOOKAHEAD_MS, -cap, cap);
    const ly = clamp(driftY * LOOKAHEAD_MS, -cap, cap);
    if (lx < 0) box.x0 += lx; else box.x1 += lx;
    if (ly < 0) box.y0 += ly; else box.y1 += ly;
    return box;
  }

  /** Диапазон плиток уровня z под нужный прямоугольник, с запасом buf плиток. */
  function tileRange(z, buf, ahead) {
    const scale = Math.pow(2, zoom - z);
    const b = wantBox(ahead);
    return {
      i0: Math.floor(b.x0 / scale / TILE) - buf,
      i1: Math.floor((b.x1 / scale - 0.001) / TILE) + buf,
      j0: Math.floor(b.y0 / scale / TILE) - buf,
      j1: Math.floor((b.y1 / scale - 0.001) / TILE) + buf,
      n: Math.pow(2, z),
    };
  }

  /**
   * Догрузить уровень под текущий вид. cap — сколько плиток разрешено завести
   * в этом кадре (Infinity — сколько нужно). Возвращает, сколько осталось на потом.
   */
  function fillLevel(lv, buf, cap) {
    const r = tileRange(lv.z, buf, true);
    const cx = (r.i0 + r.i1) / 2, cy = (r.j0 + r.j1) / 2;
    const wanted = [];
    for (let j = r.j0; j <= r.j1; j++) {
      if (j < 0 || j >= r.n) continue;          // выше полюса и ниже него плиток нет
      for (let i = r.i0; i <= r.i1; i++) {
        if (!lv.tiles.has(i + ':' + j)) wanted.push([i, j, Math.abs(i - cx) + Math.abs(j - cy)]);
      }
    }
    if (!wanted.length) return 0;
    // недостающие ставим от центра к краям — там, куда смотрит человек, появится первым
    wanted.sort((a, c) => a[2] - c[2]);
    const take = Math.max(0, Math.min(cap, wanted.length));
    for (let k = 0; k < take; k++) addTile(lv, wanted[k][0], wanted[k][1]);
    return wanted.length - take;
  }

  /** Закрыт ли экран этим уровнем целиком. Считаем строго по виду, без запаса. */
  function levelCovers(lv) {
    const r = tileRange(lv.z, 0, false);
    for (let j = r.j0; j <= r.j1; j++) {
      if (j < 0 || j >= r.n) continue;
      for (let i = r.i0; i <= r.i1; i++) {
        const t = lv.tiles.get(i + ':' + j);
        // мёртвую плитку ждать бессмысленно — её дыру держит подслой
        if (!t || (!t.ok && !t.dead)) return false;
      }
    }
    return true;
  }

  /** Всё, что уехало за край, возвращаем в пул — и освобождаем полосу загрузки. */
  function cullLevel(lv, buf) {
    const r = tileRange(lv.z, buf, true);
    let freed = false;
    for (const [key, t] of Array.from(lv.tiles)) {
      if (t.i < r.i0 || t.i > r.i1 || t.j < r.j0 || t.j > r.j1) {
        recycle(t);
        lv.tiles.delete(key);
        freed = true;
      }
    }
    // место в очереди освободилось: пусть его займёт то, что ещё нужно
    if (freed) pumpTiles();
  }

  /**
   * Старые уровни — единственное, что держит картинку, пока новый догружается.
   * Поэтому выбрасываем их только когда рабочий уровень закрыл экран целиком
   * (done), а до тех пор лишь подрезаем самые бесполезные, если их развелось.
   * Рабочий уровень, его подслой и уровень, к которому едет зум, не трогаем.
   */
  function trimLevels(done) {
    const keep = new Set([activeZ, goalZ]);
    for (const uz of under) keep.add(uz);
    const extra = [];
    for (const lv of levels.values()) if (!keep.has(lv.z)) extra.push(lv);
    if (!extra.length) return;
    if (done) {
      for (const lv of extra) dropLevel(lv);
      return;
    }
    if (levels.size <= MAX_LEVELS) return;
    // первыми уходят уровни мельче рабочего: при отдалении они закрывают
    // лишь середину экрана, а места занимают столько же. Среди равных — дальние
    const cost = (lv) => Math.abs(lv.z - activeZ) + (lv.z > activeZ ? 100 : 0);
    extra.sort((a, c) => cost(c) - cost(a));
    for (const lv of extra) {
      if (levels.size <= MAX_LEVELS) break;
      dropLevel(lv);
    }
  }

  /**
   * Уровни-подложки под рабочим: грубый подслой и совсем грубая подстилка.
   * Подстилка нужна именно при протаскивании: её плитка растянута на десятки
   * экранов, догружать ей нечего, и как быстро карту ни тащи, под пальцем
   * всегда что-то есть. Если оба уровня совпали, второй не заводим.
   */
  function backing(z) {
    const coarse = underZoom(z);
    const floor = clamp(Math.floor((z - FLOOR_GAP) / COARSE_STEP) * COARSE_STEP,
      COARSE_FLOOR, coarse);
    return floor === coarse ? [coarse] : [floor, coarse];
  }

  /**
   * Прошлые подложки отпускаем не раньше, чем новые сами закроют экран целиком.
   * Пока новые догружаются, старые — единственное, что держит фон при отдалении.
   */
  function pruneUnder(want) {
    if (under.size <= want.length) return;
    for (const uz of want) {
      const u = levels.get(uz);
      if (uz < activeZ && (!u || !levelCovers(u))) return;
    }
    for (const uz of Array.from(under)) if (want.indexOf(uz) < 0) under.delete(uz);
  }

  /** Какие подложки нужны прямо сейчас — под рабочий уровень и под цель зума. */
  function wantUnder() {
    const want = backing(activeZ);
    for (const uz of backing(goalZ)) if (want.indexOf(uz) < 0) want.push(uz);
    return want.filter((uz) => uz < activeZ);
  }

  /** Плитка доехала: если рабочий уровень закрыл экран, лишние слои больше не нужны. */
  function settle(lv) {
    if (destroyed) return;
    pruneUnder(wantUnder());
    if (lv.z === activeZ && levelCovers(lv)) trimLevels(true);
  }

  function drawTiles() {
    const z = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
    activeZ = z;
    // при отдалении заранее греем целевой уровень: к границе он подойдёт готовым.
    // При приближении так не делаем — плиток там вчетверо больше, а дыр всё равно
    // не будет: текущий уровень просто растянется
    const goal = clamp(Math.round(zoomGoal()), opt.minZoom, opt.maxZoom);
    goalZ = goal < z ? goal : z;

    const lv = level(z);
    const busy = !!(viewAnim || inertia || zoomAnim || pointers.size);

    // 1. Подложки — вне очереди и целиком: они весят копейки, а закрывают всё.
    //    Держим подслой и подстилку рабочего уровня и то же самое для цели зума;
    //    прошлые отпускаем не раньше, чем новые сами закроют экран
    const want = wantUnder();
    for (const uz of want) under.add(uz);
    for (const uz of Array.from(under)) {
      if (uz >= z) { under.delete(uz); continue; }
      fillLevel(level(uz), 1, Infinity);
    }
    pruneUnder(want);
    // 2. Куда едем — туда и греем, по чуть-чуть за кадр
    if (goalZ !== z) fillLevel(level(goalZ), 1, FRAME_TILES);
    // 3. Рабочий уровень. Уровень, который мы просто пролетаем по дороге к цели,
    //    не грузим вовсе — под ним уже лежит подслой, а плитки эти никто не увидит.
    //    Пока карта движется, ставим не больше горстки за кадр: сотня новых <img>
    //    разом — это провал кадра и тот самый рывок на границе уровней
    const flying = goalZ < z - 1;
    const left = fillLevel(lv, opt.buffer, flying ? 0 : (busy ? FRAME_TILES : Infinity));
    if (left > 0 && busy) dirty = true; // остальное доберём следующим кадром

    trimLevels(!left && levelCovers(lv));

    for (const lvl of levels.values()) {
      cullLevel(lvl, lvl.z === z ? opt.buffer + 1 : 2);
      const s = Math.pow(2, zoom - lvl.z);
      const tx = lvl.origin.x * s - view.x;
      const ty = lvl.origin.y * s - view.y;
      // весь слой едет одним трансформом, прижатым к сетке точек устройства:
      // так плитки остаются острыми и не дрожат на дробных смещениях
      lvl.el.style.transform =
        'translate3d(' + snap(tx) + 'px,' + snap(ty) + 'px,0) scale(' + s + ')';
      lvl.el.classList.toggle('is-scaled', s !== 1);
      // нижние слои — подложка: им проявляться незачем, они должны быть уже там
      lvl.el.classList.toggle('is-under', lvl.z < z);
    }
  }

  /**
   * Счётчик для проверки руками: сколько плиток заказано, сколько доехало,
   * сколько сейчас на экране и сколько клеток экрана не закрыто ничем.
   * holes обязан быть нулём на любом масштабе — ради этого всё и затевалось.
   */
  function tileStats() {
    let total = 0, loaded = 0, visible = 0;
    const zs = [];
    for (const lvl of levels.values()) {
      zs.push(lvl.z);
      const r = tileRange(lvl.z, 0, false);
      for (const t of lvl.tiles.values()) {
        total++;
        if (t.ok) loaded++;
        if (t.i >= r.i0 && t.i <= r.i1 && t.j >= r.j0 && t.j <= r.j1) visible++;
      }
    }
    zs.sort((a, b) => b - a);
    const own = levels.get(activeZ);
    return {
      total, loaded, visible, holes: holeCount(), zoom: n2(zoom), levels: zs,
      // закрыт ли экран плитками своего масштаба, а не растянутой подложкой:
      // в покое обязано быть true, иначе человек смотрит на мыло
      sharp: !!(own && levelCovers(own)),
      queue: waiting.size + inflight,
      center: [Math.round(center[0] * 1e4) / 1e4, Math.round(center[1] * 1e4) / 1e4],
      turn: n2(rotDeg),
    };
  }

  /** Клетки экрана, которые не закрыл ни рабочий уровень, ни один из нижних. */
  function holeCount() {
    const lv = levels.get(activeZ);
    if (!lv || !w || !h) return 0;
    const below = Array.from(levels.values())
      .filter((l) => l.z < activeZ)
      .sort((a, b) => b.z - a.z);
    const r = tileRange(activeZ, 0, false);
    let holes = 0;
    for (let j = Math.max(0, r.j0); j <= Math.min(r.n - 1, r.j1); j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const own = lv.tiles.get(i + ':' + j);
        if (own && own.ok) continue;
        let filled = false;
        for (const l of below) {
          const f = Math.pow(2, l.z - activeZ);
          const t = l.tiles.get(Math.floor(i * f) + ':' + Math.floor(j * f));
          if (t && t.ok) { filled = true; break; }
        }
        if (!filled) holes++;
      }
    }
    return holes;
  }

  function rebuildTiles() {
    for (const lvl of Array.from(levels.values())) dropLevel(lvl);
    under.clear();                      // подложки тоже были из старого источника
    waiting.clear();                    // и всё, что стояло в очереди, уже не нужно
    for (const L of zoneLayers) L.need = true;   // сменилась тема или плотность экрана
    renderAttr();                       // сменились плитки — сменился и источник
    invalidate();
  }

  /* ── зоны спроса ──────────────────────────────────────────────────────

     Зона — подсказка «отсюда сейчас чаще уезжают», а не запретная область.
     Поэтому рисуем не клетки сетки с рамками, а мягкие пятна, и красим их по
     плотности заказов: пять ступеней от едва заметной сиреневой дымки до
     густого фиолета. Между ступенями цвет переливается — два пятна с
     дополняющей прозрачностью вместо одного, иначе на карте проступают кольца.

     Слой ничего не знает про то, на линии курьер или нет: что дали — то и
     рисует. Курьеру эти пятна нужны как раз когда он не на линии — это
     единственная причина встать и поехать. */

  /* Пятиступенчатая шкала. Первая ступень почти не видна: два заказа за три
     часа — это ещё не повод ехать через город, но знать о них стоит. */
  const ZONE_STEPS = ['#B8A6EA', '#9E7BE6', '#8552E2', '#6D2ED6', '#5512B4'];
  const ZONE_ALPHA = [0.14, 0.22, 0.30, 0.38, 0.46];
  const ZONE_R_M = 700;                 // радиус пятна по умолчанию, метры

  const ZONE_LABEL_R = 46;              // мельче этого пятна подпись не помещается
  const ZONE_LABEL_MAX = 4;             // больше подписей — уже мусор поверх улиц

  /* Холст зон нарочно шире экрана: пока карта едет внутри этого запаса, пятна
     просто переезжают вместе с ней одним transform — ровно как плитки, кадр в
     кадр. Перерисовываем, только когда вид выходит за край запаса или меняется
     масштаб. Считать градиенты на каждый кадр протаскивания — это и есть то
     дрожание, из-за которого зоны выглядят приклеенными к экрану, а не к городу. */
  const ZONE_MARGIN = 96;
  const ZONE_MAX_PX = 3.2e6;            // дальше холст дороже, чем польза от запаса

  /** Метров в одном экранном пикселе на текущей широте и зуме. */
  function metersPerPx(lat) {
    return 156543.03392804097 * Math.cos(clamp(lat, -MAX_LAT, MAX_LAT) * DEG) / Math.pow(2, zoom);
  }

  /** Ячейки принимаем и массивом, и целым ответом сервера {cells, cell_m}. */
  function zoneCells(input) {
    const src = Array.isArray(input) ? input
      : (input && Array.isArray(input.cells) ? input.cells : []);
    const out = [];
    for (const c of src) {
      const ll = toLL(c);
      if (!ll) continue;
      const plain = Array.isArray(c);
      const raw = plain ? c[2] : (c && c.level !== undefined ? c.level : 1);
      const level = +raw;
      const rm = plain ? NaN : +(c.radius_m !== undefined ? c.radius_m : c.r);
      const orders = plain ? +c[3] : +(c && c.orders);
      out.push({
        ll,
        level: clamp(isFinite(level) ? level : 1, 0.05, 1),
        rm: isFinite(rm) && rm > 0 ? rm : 0,
        orders: isFinite(orders) && orders > 0 ? Math.round(orders) : 0,
      });
    }
    // густые рисуем последними, чтобы они легли поверх бледных соседей
    out.sort((a, b) => a.level - b.level);
    return out;
  }

  function drawZones() {
    if (!zoneLayers.size || !w || !h) return;
    const box = viewBox();
    for (const L of zoneLayers) {
      if (!L.gc) continue;
      if (!L.cells.length) {
        // зон нет — отпускаем холст: держать мегабайты под пустоту незачем
        if (L.cw) { L.cv.width = 1; L.cv.height = 1; L.cw = 0; L.ch = 0; L.z = NaN; L.need = true; }
        continue;
      }
      // от поворота зависят только подписи, и то еле-еле: пока карта довернулась
      // меньше чем на четыре градуса, перерисовывать холст незачем
      const turned = Math.abs(((L.turn - rotDeg + 540) % 360) - 180) > 4;
      const fits = !L.need && L.z === zoom && !turned &&
        box.x0 >= L.ox && box.y0 >= L.oy && box.x1 <= L.ox + L.cw && box.y1 <= L.oy + L.ch;
      if (!fits) paintZoneLayer(L, box);
      // холст лежит в тех же координатах, что и слой маркеров: переезд — один сдвиг
      L.cv.style.transform =
        'translate3d(' + snap(L.ox - view.x) + 'px,' + snap(L.oy - view.y) + 'px,0)';
    }
  }

  /** Перерисовать холст зон под новый кусок местности. */
  function paintZoneLayer(L, box) {
    const cw = Math.ceil(box.x1 - box.x0) + ZONE_MARGIN * 2;
    const ch = Math.ceil(box.y1 - box.y0) + ZONE_MARGIN * 2;
    // на большом холсте тройная плотность ничего не добавляет мягким пятнам,
    // зато съедает десятки мегабайт: двух точек на пиксель хватает и подписям
    const dpr = cw * ch * 4 > ZONE_MAX_PX ? 1 : Math.min(2, DPR);
    L.ox = Math.round(box.x0) - ZONE_MARGIN;
    L.oy = Math.round(box.y0) - ZONE_MARGIN;
    L.cw = cw;
    L.ch = ch;
    L.z = zoom;
    L.turn = rotDeg;
    L.need = false;
    L.cv.style.width = cw + 'px';
    L.cv.style.height = ch + 'px';
    const pw = Math.max(1, Math.round(cw * dpr));
    const ph = Math.max(1, Math.round(ch * dpr));
    const gc = L.gc;
    if (L.cv.width !== pw || L.cv.height !== ph) { L.cv.width = pw; L.cv.height = ph; }
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gc.clearRect(0, 0, cw, ch);
    if (!L.cells.length) return;

    const perPx = metersPerPx(center[0]) || 1;
    const far = Math.max(cw, ch);
    const marks = [];
    for (const cell of L.cells) {
      const r = clamp((cell.rm || L.radiusM || ZONE_R_M) / perPx, 26, far);
      const p = project(cell.ll[0], cell.ll[1], zoom);
      const x = p.x - L.ox, y = p.y - L.oy;
      if (x < -r || y < -r || x > cw + r || y > ch + r) continue;
      paintZone(gc, L, cell, x, y, r);
      if (L.labels && cell.orders > 0 && r >= ZONE_LABEL_R) marks.push({ cell, x, y, r });
    }
    gc.globalAlpha = 1;
    if (marks.length) paintZoneLabels(gc, marks);
  }

  /* Одно пятно: две ступени шкалы с дополняющей прозрачностью. Так цвет
     переливается плавно и на границе ступеней не появляется кольцо. */
  function paintZone(gc, L, cell, x, y, r) {
    if (L.color) {
      // цвет задали снаружи — шкалу не трогаем, меняем только густоту
      gc.globalAlpha = clamp(0.10 + 0.34 * cell.level, 0.05, 0.5);
      gc.drawImage(zoneSprite(L.color), x - r, y - r, r * 2, r * 2);
      return;
    }
    const slot = clamp(cell.level, 0, 1) * (ZONE_STEPS.length - 1);
    const i = Math.min(ZONE_STEPS.length - 2, Math.floor(slot));
    const f = clamp(slot - i, 0, 1);
    const a = lerp(ZONE_ALPHA[i], ZONE_ALPHA[i + 1], f);
    if (f < 1) {
      gc.globalAlpha = a * (1 - f);
      gc.drawImage(zoneSprite(ZONE_STEPS[i]), x - r, y - r, r * 2, r * 2);
    }
    if (f > 0) {
      gc.globalAlpha = a * f;
      gc.drawImage(zoneSprite(ZONE_STEPS[i + 1]), x - r, y - r, r * 2, r * 2);
    }
  }

  /* Подпись у крупного пятна: сколько там заказов прямо сейчас. Ставим её
     только самым заметным зонам и следим, чтобы подписи не налезали друг на
     друга — четыре числа поверх города человек прочтёт, десять уже нет.
     Когда карта повёрнута, подпись доворачиваем обратно: цифры читают глазами,
     а не по компасу. */
  function paintZoneLabels(gc, marks) {
    marks.sort((a, b) => b.cell.orders - a.cell.orders || b.r - a.r);
    const light = theme === 'light';
    const taken = [];
    let put = 0;
    gc.globalAlpha = 1;
    gc.font = '600 12px ' + ZONE_FONT;
    gc.textAlign = 'center';
    gc.textBaseline = 'middle';
    for (const m of marks) {
      if (put >= ZONE_LABEL_MAX) break;
      const text = tp(m.cell.orders, 'map.zone_orders');
      const tw = Math.ceil(gc.measureText(text).width);
      const bw = tw + 18, bh = 22;
      // столкновения считаем по кругу вокруг подписи: при повороте
      // прямоугольник всё равно встанет наискось, а круг честен на любом угле
      const rad = Math.hypot(bw, bh) / 2;
      let clash = false;
      for (const o of taken) {
        if (Math.hypot(m.x - o.x, m.y - o.y) < rad + o.r + 6) { clash = true; break; }
      }
      if (clash) continue;
      taken.push({ x: m.x, y: m.y, r: rad });
      put++;
      gc.save();
      gc.translate(m.x, m.y);
      if (rotDeg) gc.rotate(rotDeg * DEG);
      roundRect(gc, -bw / 2, -bh / 2, bw, bh, 11);
      gc.fillStyle = light ? 'rgba(255,255,255,.92)' : 'rgba(22,16,38,.88)';
      gc.fill();
      gc.lineWidth = 1;
      gc.strokeStyle = light ? 'rgba(85,18,180,.30)' : 'rgba(184,166,234,.45)';
      gc.stroke();
      gc.fillStyle = light ? '#4A0FA0' : '#E4D9FF';
      gc.fillText(text, 0, 0.5);
      gc.restore();
    }
  }

  function roundRect(gc, x, y, bw, bh, r) {
    const rr = Math.min(r, bw / 2, bh / 2);
    gc.beginPath();
    gc.moveTo(x + rr, y);
    gc.arcTo(x + bw, y, x + bw, y + bh, rr);
    gc.arcTo(x + bw, y + bh, x, y + bh, rr);
    gc.arcTo(x, y + bh, x, y, rr);
    gc.arcTo(x, y, x + bw, y, rr);
    gc.closePath();
  }

  /**
   * Слой зон спроса: полупрозрачные пятна с мягкими краями поверх плиток,
   * но под маркерами. cells — массив {lat, lng, level, orders} либо ответ сервера.
   */
  function zones(cells, o = {}) {
    const cv = document.createElement('canvas');
    cv.className = 'map__zones';
    cv.setAttribute('aria-hidden', 'true');
    world.insertBefore(cv, pane);

    const L = {
      cv,
      gc: cv.getContext ? cv.getContext('2d') : null,
      cells: [],
      color: o.color || '',            // пусто — красим по шкале плотности
      radiusM: +o.radiusM > 0 ? +o.radiusM : 0,
      labels: o.labels !== false,
      z: NaN, turn: 0, ox: 0, oy: 0, cw: 0, ch: 0, need: true,
    };
    zoneLayers.add(L);

    function put(next) {
      L.cells = zoneCells(next);
      if (!L.radiusM && next && !Array.isArray(next) && +next.cell_m > 0) {
        // сервер прислал шаг сетки — пятно чуть шире ячейки, чтобы соседние слились
        L.radiusM = +next.cell_m * 0.75;
      }
      L.need = true;
      cv.classList.toggle('is-on', L.cells.length > 0);
      invalidate();
    }

    put(cells);

    return {
      el: cv,
      setCells: put,
      /** Сколько заказов во всех показанных зонах — экрану есть что сказать словами. */
      total: () => L.cells.reduce((s, c) => s + c.orders, 0),
      /** Сколько заказов в самой густой зоне — по ней и зовут курьера на линию. */
      peak: () => L.cells.reduce((s, c) => (c.orders > s ? c.orders : s), 0),
      setStyle(st = {}) {
        if (st.color !== undefined) L.color = st.color || '';
        if (+st.radiusM > 0) L.radiusM = +st.radiusM;
        if (st.labels !== undefined) L.labels = !!st.labels;
        L.need = true;
        invalidate();
      },
      remove() {
        zoneLayers.delete(L);
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      },
    };
  }
  /* ── слой маркеров и маршрутов ────────────────────────────────────────── */

  function drawOverlay() {
    let moved = false;
    if (baseZoom !== zoom) {
      // точку отсчёта пересчитываем только при смене зума: при простом перетаскивании
      // достаточно сдвинуть весь слой одним transform, а не трогать каждый маркер
      const p = project(center[0], center[1], zoom);
      base.x = Math.round(p.x);
      base.y = Math.round(p.y);
      baseZoom = zoom;
      moved = true;
    }
    pane.style.transform =
      'translate3d(' + snap(base.x - view.x) + 'px,' + snap(base.y - view.y) + 'px,0)';

    for (const m of markers) {
      if (moved || m.dirty) { placeMarker(m); m.dirty = false; }
    }
    // маршрут не пересчитываем на каждый кадр: сам путь построен в координатах
    // своего зума, а масштаб и сдвиг отдаём одному атрибуту transform
    for (const r of routes) {
      const rs = Math.pow(2, zoom - r.vz);
      r.g.setAttribute('transform',
        'translate(' + snap(r.vbase.x * rs - base.x) + ' ' + snap(r.vbase.y * rs - base.y) + ') scale(' + rs + ')');
    }
  }

  function placeMarker(m) {
    const p = project(m.ll[0], m.ll[1], zoom);
    m.root.style.transform =
      'translate3d(' + snap(p.x - base.x) + 'px,' + snap(p.y - base.y) + 'px,0)';
  }

  /* Угол копим без сбросов через ноль: если писать то 350°, то 10°, машина
     на каждом круге будет прокручиваться в обратную сторону. */
  function applyHeading(m, deg) {
    const next = m.spin === null ? deg : m.spin + ((((deg - m.spin) % 360) + 540) % 360) - 180;
    m.spin = next;
    m.heading = ((deg % 360) + 360) % 360;
    faceMarker(m);
  }

  /* Иконка лежит внутри повёрнутого слоя, поэтому её угол складывается с углом
     карты. Машине это и нужно: нос смотрит по курсу. А флажку, точке и подписи
     поворот только мешает — им угол карты возвращаем обратно, чтобы стояли прямо. */
  function faceMarker(m) {
    // есть свой курс — стоим по курсу (поворот карты его уже учтёт сам),
    // нет курса — гасим поворот карты, чтобы флажок и подпись стояли прямо
    const a = m.spin === null ? rotDeg : m.spin;
    m.rot.style.transform = a ? 'rotate(' + n2(a) + 'deg)' : '';
  }

  function endMove(m) {
    m.anim = null;
    m.root.classList.remove('is-moving');
  }

  function stepMarker(m, dt) {
    const a = m.anim;
    a.t += dt;
    const u = clamp(a.t / a.dur, 0, 1);
    m.ll = [lerp(a.from[0], a.to[0], u), lerp(a.from[1], a.to[1], u)];
    if (a.turn) {
      const d = ((a.h1 - a.h0 + 540) % 360) - 180;   // доворот по короткой дуге
      // руль машина выкручивает в начале манёвра, а не размазывает по всему пути
      applyHeading(m, a.h0 + d * easeOut(u));
    }
    m.dirty = true;
    dirty = true;
    if (u >= 1) endMove(m);
  }

  function marker(o = {}) {
    const m = {
      ll: toLL(o.at) || center.slice(),
      root: div('map__marker'),
      rot: div('map__marker-rot' + (o.className ? ' ' + o.className : '')),
      heading: null,
      spin: null,                       // накопленный угол поворота, без скачков через 360°
      anim: null,
      lastAt: 0,                        // когда пришла прошлая точка — по ней считаем длительность проезда
      dirty: true,
      rotate: !!o.rotate || typeof o.heading === 'number',
    };
    const bottom = o.anchor === 'bottom';
    const inner = div('map__marker-in map__marker-in--' + (bottom ? 'bottom' : 'center'));
    if (o.html) m.rot.innerHTML = o.html;
    if (o.zIndex != null) m.root.style.zIndex = String(o.zIndex);
    if (o.interactive) m.root.classList.add('map__marker--tap');
    // булавка держится за землю носком, а не серединой: крутим её вокруг носка,
    // иначе на повороте карты остриё уедет с точки, которую показывает
    if (bottom) m.rot.style.transformOrigin = '50% 100%';
    inner.appendChild(m.rot);
    m.root.appendChild(inner);
    if (typeof o.heading === 'number') applyHeading(m, o.heading);
    else faceMarker(m);
    markers.add(m);
    markersPane.appendChild(m.root);
    invalidate();

    return {
      el: m.root,
      node: m.rot,
      at: () => m.ll.slice(),

      /**
       * Перевести маркер в новую точку. Без явной duration машина проезжает
       * ровно столько, сколько прошло между двумя посылками координат:
       * получается ровный проезд, а не прыжок раз в несколько секунд.
       */
      moveTo(next, mo = {}) {
        const to = toLL(next);
        if (!to) return;
        let head = typeof mo.heading === 'number' ? mo.heading : null;
        if (head === null && m.rotate && mo.turn !== false) {
          const far = Math.abs(to[0] - m.ll[0]) + Math.abs(to[1] - m.ll[1]);
          if (far > 2e-6) head = bearing(m.ll, to);
        }
        const now = performance.now();
        const gap = m.lastAt ? now - m.lastAt : 0;
        m.lastAt = now;
        const asked = mo.duration === undefined || mo.duration === null
          ? clamp(gap || 700, 400, 2600)
          : Math.max(0, +mo.duration || 0);
        const dur = reduced() ? 0 : asked;
        if (!dur) {
          endMove(m);
          m.ll = to;
          m.dirty = true;
          if (head !== null) applyHeading(m, head);
          invalidate();
          return;
        }
        const h0 = m.heading === null ? (head === null ? 0 : head) : m.heading;
        if (m.heading === null && head !== null) applyHeading(m, head);
        m.anim = {
          from: m.ll.slice(), to, t: 0, dur,
          turn: head !== null, h0, h1: head === null ? h0 : head,
        };
        m.root.classList.add('is-moving');
        schedule();
      },

      setHtml(html) {
        m.rot.innerHTML = html == null ? '' : String(html);
      },

      /** Довернуть маркер на месте — тоже плавно и по короткой дуге. */
      setHeading(deg, so = {}) {
        m.rotate = true;
        const to = +deg || 0;
        const dur = reduced() || so.animate === false ? 0 : Math.max(0, +so.duration || 420);
        if (!dur || m.heading === null) {
          endMove(m);
          applyHeading(m, to);
          return;
        }
        m.anim = {
          from: m.ll.slice(), to: m.ll.slice(), t: 0, dur,
          turn: true, h0: m.heading, h1: to,
        };
        m.root.classList.add('is-moving');
        schedule();
      },

      setClass(cls) {
        m.rot.className = 'map__marker-rot' + (cls ? ' ' + cls : '');
      },

      setZIndex(v) {
        m.root.style.zIndex = String(v);
      },

      remove() {
        markers.delete(m);
        if (m.root.parentNode) m.root.parentNode.removeChild(m.root);
      },
    };
  }

  function buildRoute(r) {
    r.pts = [];
    r.len = 0;
    if (r.lls.length < 2) {
      r.case.setAttribute('d', '');
      r.line.setAttribute('d', '');
      r.done.setAttribute('d', '');
      return;
    }
    r.vz = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
    const first = project(r.lls[0][0], r.lls[0][1], r.vz);
    r.vbase = { x: Math.round(first.x), y: Math.round(first.y) };
    let lx = 0, ly = 0;
    for (let i = 0; i < r.lls.length; i++) {
      const p = project(r.lls[i][0], r.lls[i][1], r.vz);
      const x = p.x - r.vbase.x, y = p.y - r.vbase.y;
      // точки ближе полутора пикселей глазу не видны, а путь укорачивают заметно
      if (r.pts.length && i < r.lls.length - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 1.5) continue;
      if (r.pts.length) r.len += Math.hypot(x - lx, y - ly);
      r.pts.push([x, y]);
      lx = x; ly = y;
    }
    r.case.setAttribute('d', pathOf(r.pts, 0, r.pts.length - 1, null));
    paintProgress(r);
  }

  /** Кусок пути в атрибут d. tail — необязательная последняя точка на полпути. */
  function pathOf(pts, from, to, tail) {
    let d = '';
    for (let i = from; i <= to; i++) d += (i === from ? 'M' : 'L') + n2(pts[i][0]) + ' ' + n2(pts[i][1]);
    if (tail) d += (d ? 'L' : 'M') + n2(tail[0]) + ' ' + n2(tail[1]);
    return d;
  }

  /* Пройденное гаснет, оставшееся горит. Режем путь ровно по доле длины, а не
     по числу точек: на прямом проспекте точек мало, а метров много, и деление
     по точкам показывало бы курьеру, что он уже приехал. */
  function paintProgress(r) {
    const pts = r.pts;
    if (!pts || pts.length < 2) return;
    const f = clamp(r.prog, 0, 1);
    if (f <= 0.0005) {
      r.done.setAttribute('d', '');
      r.line.setAttribute('d', pathOf(pts, 0, pts.length - 1, null));
      return;
    }
    if (f >= 0.9995) {
      r.done.setAttribute('d', pathOf(pts, 0, pts.length - 1, null));
      r.line.setAttribute('d', '');
      return;
    }
    const want = r.len * f;
    let acc = 0, i = 0, cut = pts[0];
    for (; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= want) {
        const u = seg > 0 ? (want - acc) / seg : 0;
        cut = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
        break;
      }
      acc += seg;
    }
    r.done.setAttribute('d', pathOf(pts, 0, i, cut));
    // оставшуюся часть начинаем с той же точки среза — иначе на стыке дырка
    let rest = 'M' + n2(cut[0]) + ' ' + n2(cut[1]);
    for (let k = i + 1; k < pts.length; k++) rest += 'L' + n2(pts[k][0]) + ' ' + n2(pts[k][1]);
    r.line.setAttribute('d', rest);
  }

  function styleRoute(r) {
    r.case.setAttribute('stroke-width', String(r.width + 4));
    r.line.setAttribute('stroke-width', String(r.width));
    r.done.setAttribute('stroke-width', String(r.width));
    if (r.color) r.line.style.stroke = r.color;
    else r.line.style.removeProperty('stroke');
    if (r.dashed) {
      const gap = '0.1 ' + (r.width * 1.9);
      r.line.setAttribute('stroke-dasharray', gap);
      r.line.setAttribute('stroke-linecap', 'round');
      r.done.setAttribute('stroke-dasharray', gap);
      r.case.setAttribute('stroke-dasharray', gap);
    } else {
      r.line.removeAttribute('stroke-dasharray');
      r.done.removeAttribute('stroke-dasharray');
      r.case.removeAttribute('stroke-dasharray');
    }
  }

  function route(coords, o = {}) {
    const r = {
      lls: [],
      pts: [],
      len: 0,
      prog: clamp(+o.progress || 0, 0, 1),
      vz: clamp(Math.round(zoom), opt.minZoom, opt.maxZoom),
      vbase: { x: 0, y: 0 },
      g: svgNode('g', { class: 'map__route' }),
      case: svgNode('path', { class: 'map__route-case', fill: 'none' }),
      done: svgNode('path', { class: 'map__route-done', fill: 'none' }),
      line: svgNode('path', { class: 'map__route-line', fill: 'none' }),
      width: +o.width || 6,
      color: o.color || '',
      dashed: !!o.dashed,
    };
    r.g.appendChild(r.case);
    r.g.appendChild(r.done);
    r.g.appendChild(r.line);
    vector.appendChild(r.g);
    routes.add(r);
    lastRoute = r;
    styleRoute(r);
    r.lls = (coords || []).map(toLL).filter(Boolean);
    buildRoute(r);
    invalidate();

    return {
      el: r.g,
      setCoords(next) {
        r.lls = (next || []).map(toLL).filter(Boolean);
        buildRoute(r);
        invalidate();
      },
      setStyle(st = {}) {
        if (st.width) r.width = +st.width;
        if (st.color !== undefined) r.color = st.color || '';
        if (st.dashed !== undefined) r.dashed = !!st.dashed;
        styleRoute(r);
      },
      /** Доля пройденного пути, 0…1: до неё линия гаснет, дальше горит. */
      setProgress(f) {
        r.prog = clamp(+f || 0, 0, 1);
        paintProgress(r);
      },
      coords: () => r.lls.map((p) => p.slice()),
      remove() {
        routes.delete(r);
        if (lastRoute === r) lastRoute = null;
        if (r.g.parentNode) r.g.parentNode.removeChild(r.g);
      },
    };
  }

  /* ── перемещение вида ─────────────────────────────────────────────────── */

  function applyView(ll, z) {
    const lat = clamp(ll[0], -MAX_LAT, MAX_LAT);
    const lng = clamp(ll[1], -180, 180);
    const nz = clamp(z, opt.minZoom, opt.maxZoom);
    if (lat === center[0] && lng === center[1] && nz === zoom) return;
    center = [lat, lng];
    zoom = nz;
    syncView();                         // вид не имеет права отстать даже на кадр
    invalidate();
  }

  /** Поставить зум так, чтобы точка ll осталась ровно под экранной точкой pt. */
  function zoomAround(ll, pt, z) {
    const p = project(ll[0], ll[1], z);
    const u = unrot(pt.x - w / 2, pt.y - h / 2);
    applyView(unproject(p.x - u.x, p.y - u.y, z), z);
  }

  function latLngAt(pt) {
    const u = unrot(pt.x - w / 2, pt.y - h / 2);
    return unproject(view.x + w / 2 + u.x, view.y + h / 2 + u.y, zoom);
  }

  function containerPoint(ll) {
    const p = toLL(ll);
    if (!p) return { x: 0, y: 0 };
    const q = project(p[0], p[1], zoom);
    const s = rotate(q.x - view.x - w / 2, q.y - view.y - h / 2);
    return { x: s.x + w / 2, y: s.y + h / 2 };
  }

  function bounds() {
    if (!w || !h) return [center.slice(), center.slice()];
    // на повёрнутой карте углы экрана лежат не по сторонам света, поэтому рамку
    // собираем по всем четырём: иначе половина видимого окажется «за краем»
    let s = Infinity, n = -Infinity, we = Infinity, e = -Infinity;
    for (const pt of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }]) {
      const ll = latLngAt(pt);
      if (ll[0] < s) s = ll[0];
      if (ll[0] > n) n = ll[0];
      if (ll[1] < we) we = ll[1];
      if (ll[1] > e) e = ll[1];
    }
    return [[s, we], [n, e]];   // юго-запад, северо-восток
  }

  function stopAnims() {
    viewAnim = null;
    inertia = null;
    zoomAnim = null;
  }

  /** Довернуть карту к заданному углу плавно. Ноль — вернуть север наверх. */
  function turnTo(deg) {
    const d = ((+deg || 0) % 360 + 360) % 360;
    if (reduced() || !w || !h) { rotAnim = null; setRot(d); return apiObj; }
    rotAnim = { target: d };
    schedule();
    return apiObj;
  }

  function setView(c, z, o = {}) {
    const ll = toLL(c) || center.slice();
    const nz = clamp(z == null ? zoom : +z, opt.minZoom, opt.maxZoom);
    stopAnims();
    if (o.animate === false || reduced() || !w || !h) {
      applyView(ll, nz);
      return apiObj;
    }
    const p0 = project(center[0], center[1], 0);
    const p1 = project(ll[0], ll[1], 0);
    const screen = Math.hypot(p1.x - p0.x, p1.y - p0.y) * Math.pow(2, Math.max(zoom, nz));
    const dur = +o.duration || clamp(260 + screen * 0.22, 260, 760);
    viewAnim = { t0: performance.now(), dur, p0, p1, z0: zoom, z1: nz };
    schedule();
    return apiObj;
  }

  /** Куда карта едет прямо сейчас: цель анимации, а если её нет — текущий зум. */
  function zoomGoal() {
    if (zoomAnim) return zoomAnim.target;
    if (viewAnim) return viewAnim.z1;
    return zoom;
  }

  /**
   * Шаг зума кнопкой или двойным тапом. Считаем от цели уже идущей анимации,
   * а не от того, где карта оказалась в этот кадр: иначе восемь быстрых нажатий
   * съедают друг друга — карта дёргается и не доезжает куда просили.
   */
  function zoomStep(dir, pt) {
    const from = zoomGoal();
    const next = dir > 0 ? Math.floor(from + 1e-6) + 1 : Math.ceil(from - 1e-6) - 1;
    return zoomTo(next, pt);
  }

  function zoomTo(z, pt, animate = true) {
    if (!w || !h) { applyView(center, clamp(z, opt.minZoom, opt.maxZoom)); return apiObj; }
    const target = clamp(z, opt.minZoom, opt.maxZoom);
    if (target === zoom && !zoomAnim) return apiObj;   // уже приехали, дёргать нечего
    const point = pt || { x: w / 2, y: h / 2 };
    const ll = latLngAt(point);
    viewAnim = null;
    inertia = null;
    if (!animate || reduced()) {
      zoomAnim = null;
      zoomAround(ll, point, target);
      syncCtrl();
      return apiObj;
    }
    // цель у пружины одна: новое нажатие не начинает движение заново, а только
    // переставляет точку прибытия — поэтому зум идёт одним непрерывным ходом
    zoomAnim = { target, ll, pt: point };
    syncCtrl();
    schedule();
    return apiObj;
  }

  /* У предела дальше жать некуда — кнопку гасим. Именно гасим, а не выключаем
     атрибутом: выключенная кнопка не ловит нажатия, и второй тык по ней карта
     приняла бы за двойной тап и прыгнула бы в другую сторону. */
  function syncCtrl() {
    const g = zoomGoal();
    dim(bIn, g >= opt.maxZoom - 1e-6);
    dim(bOut, g <= opt.minZoom + 1e-6);
  }

  function dim(btn, off) {
    if (!btn) return;
    btn.classList.toggle('is-off', off);
    btn.setAttribute('aria-disabled', off ? 'true' : 'false');
  }

  /** После жеста доводим дробный зум до целого: только так плитки остаются чёткими. */
  function snapZoom(pt) {
    const target = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
    if (Math.abs(target - zoom) < 0.001) { applyView(center, target); return; }
    zoomTo(target, pt || lastMid || { x: w / 2, y: h / 2 });
  }

  function fitPoints(points, o = {}) {
    const list = (points || []).map(toLL).filter(Boolean);
    if (!list.length) return apiObj;
    if (!w || !h) { pendingFit = () => fitPoints(points, o); return apiObj; }

    const pad = Object.assign({ top: 24, right: 24, bottom: 24, left: 24 }, o.padding || {});
    // меряем разброс точек в осях экрана, а не земли: на повёрнутой карте
    // «широко с запада на восток» может означать «узко сверху вниз»
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ll of list) {
      const p = project(ll[0], ll[1], 0);
      const q = rotate(p.x, p.y);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
    const availW = Math.max(32, w - pad.left - pad.right);
    const availH = Math.max(32, h - pad.top - pad.bottom);
    const dx = maxX - minX, dy = maxY - minY;
    const top = clamp(+o.maxZoom || opt.maxZoom, opt.minZoom, opt.maxZoom);

    let z;
    if (dx < 1e-9 && dy < 1e-9) {
      z = clamp(o.zoom == null ? 16 : +o.zoom, opt.minZoom, top);
    } else {
      const fit = Math.min(dx > 0 ? availW / dx : Infinity, dy > 0 ? availH / dy : Infinity);
      z = clamp(Math.floor(Math.log(fit) / Math.LN2), opt.minZoom, top);
    }
    // сдвигаем центр так, чтобы точки оказались в середине свободного окна,
    // а не под шторкой, которая закрывает низ экрана
    const s = Math.pow(2, z);
    const mid = unrot((minX + maxX) / 2, (minY + maxY) / 2);   // обратно в оси земли
    const off = unrot((pad.right - pad.left) / 2, (pad.bottom - pad.top) / 2);
    return setView(unproject(mid.x * s + off.x, mid.y * s + off.y, z), z,
      { animate: o.animate !== false, duration: o.duration });
  }

  /* ── режим следования ─────────────────────────────────────────────────────

     Курьеру с принятым заказом не нужна карта города — ему нужен навигатор:
     своя машина в нижней трети экрана, дорога впереди, масштаб вплотную и ни
     одной кнопки. Экран курьера шлёт сюда каждую пришедшую точку GPS, а раз в
     две-три секунды — это редко. Поэтому карта не прыгает в новую точку, а
     проезжает до неё кадр за кадром ровно столько, сколько шла посылка: между
     двумя точками получается настоящее движение, а не серия толчков.

     Тот же приём применяем к курсу: доворот идёт по короткой дуге и растянут
     на весь проезд, поэтому машина вписывается в поворот, а не переставляется.
     Стоящую машину не крутим вовсе — у неподвижного GPS курс это чистый шум.

     Трогать карту руками во время следования можно: слежение отпускает руль и
     само берёт его обратно, когда человек перестал возить пальцем. */

  const FOLLOW_ANCHOR = 0.68;           // где по высоте экрана стоит машина
  const FOLLOW_ZOOM = 17;               // «вплотную»: видно перекрёсток и дворы
  const FOLLOW_RESUME_MS = 6000;        // через столько карта возвращается к машине
  const FOLLOW_MIN_MS = 260;            // короче этого проезд неотличим от прыжка
  const FOLLOW_MAX_MS = 5000;           // дольше — значит связь оборвалась, не тянем
  const FOLLOW_TURN_M = 4;              // сдвинулся меньше — курс не трогаем

  let followTimer = 0;

  /* Человек взялся за карту — слежение отпускает руль. Вернёт его само, когда
     палец успокоится: держать ради этого кадровый цикл шесть секунд впустую
     незачем, хватит одного будильника. */
  function holdFollow() {
    if (!follower) return;
    const ms = follower.resume;
    follower.hold = ms ? performance.now() + ms : Infinity;
    clearTimeout(followTimer);
    followTimer = ms ? setTimeout(() => { followTimer = 0; schedule(); }, ms + 20) : 0;
  }

  /**
   * Поставить вид так, чтобы машина стояла в нижней трети и смотрела вперёд.
   * k < 1 — не переставить разом, а подтянуться: так карта возвращается к машине
   * после того, как человек повозил её пальцем. Возвращает, сколько пикселей
   * ещё осталось до места.
   */
  function placeFollow(lat, lng, k) {
    const off = (follower.anchor - 0.5) * h;
    const p = project(lat, lng, zoom);
    let x = p.x + off * rotSin;
    let y = p.y - off * rotCos;
    const c = project(center[0], center[1], zoom);
    const left = Math.hypot(x - c.x, y - c.y);
    if (k < 1) { x = lerp(c.x, x, k); y = lerp(c.y, y, k); }
    applyView(unproject(x, y, zoom), zoom);
    return left;
  }

  function stepFollow(dt, ts) {
    const f = follower;
    if (!f) return false;
    if (f.hold && ts >= f.hold) { f.hold = 0; f.chase = true; }
    f.t += dt;
    f.u = f.dur > 0 ? clamp(f.t / f.dur, 0, 1) : 1;
    f.at = [lerp(f.from[0], f.to[0], f.u), lerp(f.from[1], f.to[1], f.u)];
    if (f.hold) return f.u < 1;         // руль у человека: машина едет, вид стоит
    if (f.turn) {
      const d = ((f.h1 - f.h0 + 540) % 360) - 180;   // доворот по короткой дуге
      setRot(f.h0 + d * easeOut(f.u));
    }
    const left = placeFollow(f.at[0], f.at[1], f.chase ? 1 - Math.exp(-dt / 150) : 1);
    if (f.chase && left < 1.5) f.chase = false;
    return f.u < 1 || f.chase;
  }

  /**
   * Вести карту за машиной. Зовут на каждую пришедшую координату.
   *   map.follow({lat, lng, heading, speed}, {rotate, zoom, anchor, marker, resume})
   * rotate — разворачивать карту по ходу движения; marker — метка, которую вести
   * теми же кадрами, чтобы машина не отрывалась от места, где её держит карта;
   * duration — сколько ехать до точки, если экран знает это лучше нас.
   * Выключить: map.follow(null).
   */
  function follow(pos, o = {}) {
    const to = toLL(pos);
    if (!to) return unfollow();
    const now = performance.now();
    const head = pos && isFinite(+pos.heading) ? +pos.heading : null;
    const speed = pos && isFinite(+pos.speed) ? +pos.speed : null;

    if (!follower) {
      follower = {
        rotate: !!o.rotate,
        anchor: clamp(+o.anchor || FOLLOW_ANCHOR, 0.25, 0.9),
        marker: o.marker || null,
        resume: o.resume === undefined ? FOLLOW_RESUME_MS : Math.max(0, +o.resume || 0),
        from: to.slice(), to: to.slice(), at: to.slice(),
        h0: head === null ? rotDeg : head, h1: head === null ? rotDeg : head,
        turn: false, t: 0, dur: 0, u: 1, last: now, hold: 0, chase: false,
      };
      stopAnims();
      applyView(to, clamp(+o.zoom || FOLLOW_ZOOM, opt.minZoom, opt.maxZoom));
      if (follower.rotate && head !== null) setRot(head);
      placeFollow(to[0], to[1], 1);
      if (follower.marker) follower.marker.moveTo(to, { duration: 0, heading: head === null ? undefined : head });
      schedule();
      return apiObj;
    }

    const f = follower;
    // курс выключили на ходу — возвращаем север наверх, а не бросаем карту косой
    if (o.rotate !== undefined && !o.rotate && f.rotate) turnTo(0);
    if (o.rotate !== undefined) f.rotate = !!o.rotate;
    if (o.marker !== undefined) f.marker = o.marker || null;
    if (o.anchor !== undefined) f.anchor = clamp(+o.anchor || FOLLOW_ANCHOR, 0.25, 0.9);
    if (o.resume !== undefined) f.resume = Math.max(0, +o.resume || 0);
    // «вернись к машине сейчас» — после того, как человек её потерял из виду
    if (o.snap && f.hold) { f.hold = 0; f.chase = true; clearTimeout(followTimer); followTimer = 0; }
    // Масштаб трогаем только когда руль у слежения. Человек отдалил карту,
    // чтобы посмотреть, где он вообще едет, — и каждая следующая посылка
    // координат возвращала бы его вплотную к машине. Именно на это и жаловались:
    // «отдаляешь и двигаешься по карте» — а она сама прыгает обратно.
    // Пауза тут та же, что и у центра (holdFollow), и «вернись к машине»
    // (o.snap) её снимает строкой выше, так что кнопка работает как и работала.
    if (o.zoom && !f.hold) zoomTo(clamp(+o.zoom, opt.minZoom, opt.maxZoom), { x: w / 2, y: h * f.anchor });

    const gap = now - f.last;
    f.last = now;
    const moved = distanceM(f.at, to);
    // ехать столько же, сколько шла посылка: тогда машина идёт ровно и приезжает
    // ровно к приходу следующей точки, без рывка «догоняю» в конце
    const asked = o.duration === undefined ? gap : +o.duration;
    f.dur = reduced() ? 0 : clamp(isFinite(asked) ? asked : gap, FOLLOW_MIN_MS, FOLLOW_MAX_MS);
    f.from = f.at.slice();
    f.to = to.slice();
    f.t = 0;
    f.u = 0;
    const want = head !== null ? head : (moved > FOLLOW_TURN_M ? bearing(f.from, to) : null);
    const still = (speed !== null && speed < 1.2) || moved <= FOLLOW_TURN_M;
    f.turn = f.rotate && want !== null && !still;
    f.h0 = rotDeg;
    f.h1 = f.turn ? want : rotDeg;
    if (f.marker) {
      // у стоящей машины курс из GPS — чистый шум, и крутить её от него нельзя:
      // фургон будет вертеться на месте, пока курьер ждёт у подъезда
      f.marker.moveTo(to, {
        duration: f.dur,
        heading: (still || want === null) ? undefined : want,
        turn: !still,
      });
    }
    schedule();
    return apiObj;
  }

  function unfollow() {
    clearTimeout(followTimer);
    followTimer = 0;
    if (!follower) return apiObj;
    follower = null;
    turnTo(0);
    return apiObj;
  }

  /* ── жесты ────────────────────────────────────────────────────────────── */

  const pointers = new Map();
  let gesture = null;
  let gRect = null;
  let lastMid = null;
  let lastTap = null;

  function ptOf(e, rc) {
    const r = rc || container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function two() {
    const it = pointers.values();
    return [it.next().value, it.next().value];
  }

  function startDrag(id, x, y) {
    gesture = {
      mode: 'drag', id, startX: x, startY: y, moved: false, pressed: false, z: zoom,
      px: project(center[0], center[1], zoom),
      samples: [{ t: performance.now(), x, y }],
    };
  }

  /* Ближе этого пальцы уже сливаются в одно пятно, а отношение расстояний
     начинает скакать: сдвиг на пару точек давал бы целый уровень зума. */
  const PINCH_MIN = 24;

  function pinchDist(a, b) {
    return Math.max(PINCH_MIN, Math.hypot(a.x - b.x, a.y - b.y));
  }

  function startPinch() {
    const [a, b] = two();
    if (!a || !b) return;
    gRect = container.getBoundingClientRect();
    const mid = {
      x: (a.x + b.x) / 2 - gRect.left,
      y: (a.y + b.y) / 2 - gRect.top,
    };
    lastMid = mid;
    gesture = {
      mode: 'pinch',
      d0: pinchDist(a, b),
      z0: zoom,
      ll: latLngAt(mid),
    };
  }

  function onDown(e) {
    if (destroyed) return;
    // кнопки, подпись и «живые» маркеры обрабатывают нажатие сами —
    // иначе двойное нажатие на «+» карта примет за двойной тап и добавит свой зум
    const own = e.target && e.target.closest
      ? e.target.closest('.map__btn, .map__attr, .map__marker--tap, [data-map-skip]')
      : null;
    if (own) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { container.setPointerCapture(e.pointerId); } catch (err) { /* уже потеряли указатель */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopAnims();
    holdFollow();                       // человек взялся за карту сам
    clearTimeout(pressTimer);

    if (pointers.size === 1) {
      startDrag(e.pointerId, e.clientX, e.clientY);
      const pt = ptOf(e);
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        if (destroyed || !gesture || gesture.mode !== 'drag' || gesture.moved) return;
        gesture.pressed = true;          // долгое нажатие уже отработало, кликом его не считаем
        const ll = latLngAt(pt);
        emit('longpress', { lat: ll[0], lng: ll[1], point: pt, originalEvent: e });
      }, 520);
    } else if (pointers.size >= 2) {
      startPinch();
    }
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (follower) holdFollow();         // пока палец возит карту, отсчёт идёт заново

    if (gesture.mode === 'drag' && gesture.id === e.pointerId) {
      // если зум успел измениться (колесо, доводка после щипка), отсчёт начинаем заново,
      // иначе карта прыгнет: пиксели старого зума не совпадают с новыми
      if (gesture.z !== zoom) {
        gesture.z = zoom;
        gesture.px = project(center[0], center[1], zoom);
        gesture.startX = e.clientX;
        gesture.startY = e.clientY;
        return;
      }
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (!gesture.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;   // защита от дрожи пальца при нажатии
        gesture.moved = true;
        clearTimeout(pressTimer);
      }
      const d = unrot(dx, dy);          // палец тянет по экрану, карта едет по земле
      applyView(unproject(gesture.px.x - d.x, gesture.px.y - d.y, zoom), zoom);
      const now = performance.now();
      gesture.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (gesture.samples.length > 2 && now - gesture.samples[0].t > 110) gesture.samples.shift();
    } else if (gesture.mode === 'pinch') {
      const [a, b] = two();
      if (!a || !b) return;
      const d = pinchDist(a, b);
      const mid = {
        x: (a.x + b.x) / 2 - gRect.left,
        y: (a.y + b.y) / 2 - gRect.top,
      };
      lastMid = mid;
      const raw = gesture.z0 + Math.log(d / gesture.d0) / Math.LN2;
      const z = clamp(raw, opt.minZoom, opt.maxZoom);
      // упёрлись в предел — переставляем точку отсчёта пальцев. Иначе обратное
      // движение долго не даёт отклика: карта сначала «выбирает» ушедший в никуда
      // запас, и палец разводит впустую
      if (z !== raw) { gesture.z0 = z; gesture.d0 = d; }
      zoomAround(gesture.ll, mid, z);
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { container.releasePointerCapture(e.pointerId); } catch (err) { /* уже отпустили */ }
    clearTimeout(pressTimer);
    if (!gesture) return;

    if (gesture.mode === 'pinch') {
      if (pointers.size >= 2) { startPinch(); return; }
      if (pointers.size === 1) {
        // один палец остался — продолжаем как обычное перетаскивание,
        // но нажатием это уже не считается: щипок не должен закончиться кликом
        const rest = two()[0];
        startDrag(null, rest.x, rest.y);
        gesture.moved = true;
        for (const [id, pp] of pointers) if (pp === rest) gesture.id = id;
        return;
      }
      gesture = null;
      snapZoom();
      return;
    }

    if (gesture.mode === 'drag' && (gesture.id === e.pointerId || pointers.size === 0)) {
      if (!gesture.moved) {
        if (!gesture.pressed) tap(e);
      } else {
        const s = gesture.samples;
        const first = s[0], last = s[s.length - 1];
        const dt = last.t - first.t;
        if (dt > 8 && performance.now() - last.t < 90) {
          const vx = -(last.x - first.x) / dt;
          const vy = -(last.y - first.y) / dt;
          const speed = Math.hypot(vx, vy);
          if (speed > 0.12) {
            const cap = Math.min(1, 3.6 / speed);
            inertia = { vx: vx * cap, vy: vy * cap };
            schedule();
          }
        }
      }
      gesture = null;
      if (!inertia) snapZoom();
    }
  }

  function tap(e) {
    const pt = ptOf(e);
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 32) {
      lastTap = null;
      clearTimeout(tapTimer);
      tapTimer = 0;
      zoomStep(1, pt);
      return;
    }
    lastTap = { t: now, x: pt.x, y: pt.y };
    const ll = latLngAt(pt);
    const payload = { lat: ll[0], lng: ll[1], point: pt, originalEvent: e };
    if (e.pointerType === 'mouse') {
      emit('click', payload);
    } else {
      // на тачскрине ждём, не окажется ли это первым касанием двойного тапа
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapTimer = 0; emit('click', payload); }, 260);
    }
  }

  let lastWheelPt = null;

  function onWheel(e) {
    if (destroyed) return;
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 40;          // Firefox считает строками
    else if (e.deltaMode === 2) d *= h || 400;
    const sens = e.ctrlKey ? 55 : 130;       // щипок на тачпаде приходит как ctrl+колесо
    holdFollow();                            // колесо тоже забирает руль у слежения
    const from = zoomAnim ? zoomAnim.target : zoom;
    const target = clamp(from - d / sens, opt.minZoom, opt.maxZoom);
    const pt = ptOf(e);
    viewAnim = null;
    inertia = null;
    zoomAnim = { target, ll: latLngAt(pt), pt };
    schedule();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = 0;
      if (destroyed || !zoomAnim) { if (!destroyed) snapZoom(lastWheelPt); return; }
      zoomAnim.target = clamp(Math.round(zoomAnim.target), opt.minZoom, opt.maxZoom);
      schedule();
    }, 170);
    lastWheelPt = pt;
  }

  if (opt.interactive) {
    bind(container, 'pointerdown', onDown);
    bind(container, 'pointermove', onMove);
    bind(container, 'pointerup', onUp);
    bind(container, 'pointercancel', onUp);
    bind(container, 'wheel', onWheel, { passive: false });
    bind(container, 'contextmenu', (e) => e.preventDefault());
    bind(container, 'dragstart', (e) => e.preventDefault());
  }

  /* ── размер контейнера ────────────────────────────────────────────────── */

  function measure() {
    const r = container.getBoundingClientRect();
    const nw = Math.round(r.width), nh = Math.round(r.height);
    if (nw === w && nh === h) return false;
    w = nw; h = nh;
    syncView();                         // угол вида считается от половины размера
    return true;
  }

  function invalidateSize() {
    if (destroyed) return apiObj;
    // страницу могли увеличить колесом: это и смена размера, и смена плотности,
    // а медиазапрос про dppx поддерживают не все браузеры
    syncDpr();
    if (measure()) {
      // рисуем не сразу, а следующим кадром: ResizeObserver не любит,
      // когда из его обработчика тут же меняют содержимое
      if (w && h && pendingFit) { const f = pendingFit; pendingFit = null; f(); }
      invalidate();
    }
    return apiObj;
  }

  let ro = null;
  if (window.ResizeObserver) {
    ro = new window.ResizeObserver(() => invalidateSize());
    ro.observe(container);
  } else {
    bind(window, 'resize', () => invalidateSize());
  }

  /* ── геолокация ───────────────────────────────────────────────────────── */

  function locate(o = {}) {
    if (!navigator.geolocation) {
      emit('locateerror', { code: 0, message: t('map.geo_no') });
      return apiObj;
    }
    if (locBtn) locBtn.classList.add('is-busy');
    navigator.geolocation.getCurrentPosition((pos) => {
      if (destroyed) return;
      if (locBtn) locBtn.classList.remove('is-busy');
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (o.move !== false) setView(ll, Math.max(zoom, 16), { animate: true });
      emit('locate', { lat: ll[0], lng: ll[1], accuracy: pos.coords.accuracy });
    }, (err) => {
      if (destroyed) return;
      if (locBtn) locBtn.classList.remove('is-busy');
      const say = { 1: 'map.geo_denied', 2: 'map.geo_fail', 3: 'map.geo_slow' };
      emit('locateerror', { code: err.code, message: t(say[err.code] || 'map.geo_off') });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    return apiObj;
  }

  /* ── подпись об источнике ─────────────────────────────────────────────── */

  /** Что владелец дописал от себя. Источники, уже показанные ссылкой, убираем,
   *  чтобы «© OpenStreetMap» не стояло в подписи дважды. */
  function ownAttr(shown) {
    const raw = String(opt.attribution == null ? '' : opt.attribution)
      .replace(/<[^>]*>/g, ' ')          // из настроек может прийти разметка — она нам не нужна
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return '';
    const parts = raw.split(/\s*[,;·|]+\s*/).filter((chunk) => {
      if (!chunk) return false;
      for (const s of shown) if (s.mark.test(chunk)) return false;
      return true;
    });
    return parts.join(' · ');
  }

  /* Источник плиток стоит первым: подпись узкая и обрезается многоточием,
     и обрезаться должно название сервиса, а не обязательная ссылка. */
  function renderAttr() {
    const tpl = String(template() || '');
    const shown = SOURCES.filter((s) => s.test.test(tpl));
    const nodes = [];
    for (const s of shown) {
      const a = document.createElement('a');
      a.href = s.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.text;
      nodes.push(a);
    }
    const own = ownAttr(shown);
    if (own) {
      // текст владельца кладём как текст узла, а не как разметку: в настройке
      // может оказаться что угодно, и это «что угодно» не должно исполняться
      const node = document.createElement('span');
      node.textContent = own;
      nodes.push(node);
    }

    attrBox.innerHTML = '';
    for (let i = 0; i < nodes.length; i++) {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'map__attr-sep';
        sep.textContent = ' · ';
        attrBox.appendChild(sep);
      }
      attrBox.appendChild(nodes[i]);
    }
    attrBox.classList.toggle('is-empty', nodes.length === 0);
  }

  /** Своя подпись владельца. Источник плиток она не заменяет — он останется. */
  function setAttribution(text) {
    opt.attribution = text == null ? '' : String(text);
    renderAttr();
    return apiObj;
  }

  /* ── прочее ───────────────────────────────────────────────────────────── */

  function setTheme(next) {
    const t = next === 'light' ? 'light' : 'dark';
    if (t === theme) return apiObj;
    const was = template();
    theme = t;
    container.classList.toggle('map--light', t === 'light');
    container.classList.toggle('map--dark', t === 'dark');
    // подписи зон на светлой карте тёмные, на тёмной светлые — перерисовать
    for (const L of zoneLayers) L.need = true;
    if (template() !== was) rebuildTiles();
    else invalidate();
    return apiObj;
  }

  function setTiles(tpl) {
    opt.tiles = tpl;
    rebuildTiles();
    return apiObj;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(endTimer);
    clearTimeout(tapTimer);
    clearTimeout(pressTimer);
    clearTimeout(wheelTimer);
    clearTimeout(followTimer);
    if (ro) ro.disconnect();
    dprWakes.delete(onDpr);
    stopLang();
    for (const un of unbinds) un();
    unbinds.length = 0;
    for (const lvl of Array.from(levels.values())) dropLevel(lvl);
    under.clear();
    waiting.clear();
    inflight = 0;
    for (const L of zoneLayers) {
      if (L.cv.parentNode) L.cv.parentNode.removeChild(L.cv);
    }
    zoneLayers.clear();
    pool.length = 0;
    markers.clear();
    routes.clear();
    lastRoute = null;
    follower = null;
    rotAnim = null;
    handlers.clear();
    pointers.clear();
    for (const node of [world, attrBox, ctrlBox, locBtn]) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    container.classList.remove('map', 'map--dark', 'map--light', 'map--static', 'map--turned');
    container.removeAttribute('aria-label');
    if (typeof window !== 'undefined' && window.SG_MAP === apiObj) window.SG_MAP = null;
  }

  const apiObj = {
    el: container,
    setView,
    fitPoints,
    marker,
    route,
    zones,
    follow,
    unfollow,
    /** Доля пройденного пути у последнего построенного маршрута, 0…1. */
    setRouteProgress(f) {
      if (!lastRoute) return apiObj;
      lastRoute.prog = clamp(+f || 0, 0, 1);
      paintProgress(lastRoute);
      return apiObj;
    },
    turnTo,
    on,
    off,
    destroy,
    locate,
    setTheme,
    setTiles,
    setAttribution,
    invalidateSize,
    zoomIn: () => zoomStep(1),
    zoomOut: () => zoomStep(-1),
    zoomTo: (z, pt, an) => zoomTo(z, pt, an),
    tiles: tileStats,
    getCenter: () => center.slice(),
    getZoom: () => zoom,
    getZoomRange: () => [opt.minZoom, opt.maxZoom],
    getBounds: bounds,
    getRotation: () => rotDeg,
    isFollowing: () => !!follower,
    latLngAt,
    containerPoint,
    get destroyed() { return destroyed; },
  };

  /* Последняя созданная карта видна как window.SG_MAP. Это не украшение:
     приёмочный прогон так спрашивает у самого движка, сколько клеток экрана
     он не закрыл, — считать это снаружи по DOM получается грубее. Наружу
     уходит тот же объект управления, никаких скрытых потрохов. */
  if (typeof window !== 'undefined') window.SG_MAP = apiObj;

  renderAttr();
  measure();
  syncView();
  syncCtrl();
  invalidate();
  return apiObj;
}

/* ─────────────────────────────────────────────────────── готовые маркеры */

/**
 * Разметка типовых меток. Стили лежат в map.css, здесь только каркас:
 *   pin('a')       — жёлтая точка подачи
 *   pin('b', '2')  — флажок с номером точки назначения
 *   pin('car')     — фургон курьера (маркер создавать с rotate: true)
 *   pin('me')      — «я здесь»
 */
export function pin(kind, label) {
  const cls = 'map-pin map-pin--' + kind;
  if (kind === 'car') return '<span class="' + cls + '">' + CAR_SVG + '</span>';
  const tail = label ? '<span class="map-pin__label">' + label + '</span>' : '';
  return '<span class="' + cls + '">' + tail + '</span>';
}

export default createMap;
