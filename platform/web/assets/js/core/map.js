/* Растровая карта своими руками: плитки, жесты, маркеры и маршруты.
   Ни одной библиотеки — только браузер. Всё, что делает карту «живой»
   (инерция, щипок, дробный зум, переиспользование плиток), собрано здесь.

   Система координат простая: весь мир — квадрат из 256·2^z пикселей (Web Mercator).
   Любая точка превращается в мировые пиксели на текущем (дробном) зуме, а на экран
   попадает как «мировые пиксели минус левый верхний угол вида». Дальше — только
   transform: translate3d/scale, никаких left/top, чтобы всё считала видеокарта. */

const TILE = 256;
const MAX_LAT = 85.0511287798066;     // широта, на которой Меркатор становится квадратом
const DEG = Math.PI / 180;

const DEFAULTS = {
  center: [42.8746, 74.5698],         // Бишкек, площадь Ала-Тоо
  zoom: 13,
  minZoom: 2,
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
  attribution: '© OpenStreetMap, © CARTO',
  buffer: 1,                          // сколько рядов плиток подгружаем за краем экрана
};

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_LOCATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/>' +
  '<circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
  '<path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

/* ─────────────────────────────────────────────────────── мелкая математика */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const n2 = (v) => Math.round(v * 100) / 100;

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
  opt.minZoom = clamp(opt.minZoom, 0, 22);
  opt.maxZoom = clamp(opt.maxZoom, opt.minZoom, 22);

  let theme = opt.theme === 'light' ? 'light' : 'dark';
  let center = toLL(opt.center) || DEFAULTS.center.slice();
  let zoom = clamp(+opt.zoom || DEFAULTS.zoom, opt.minZoom, opt.maxZoom);

  let w = 0, h = 0;
  const view = { x: 0, y: 0 };          // левый верхний угол вида в мировых пикселях
  let destroyed = false;

  /* ── слои ─────────────────────────────────────────────────────────────── */

  container.classList.add('map', theme === 'light' ? 'map--light' : 'map--dark');
  if (!opt.interactive) container.classList.add('map--static');
  container.setAttribute('aria-label', 'Карта');

  const tilesPane = div('map__tiles');
  const pane = div('map__pane');
  const vector = svgNode('svg', { class: 'map__vector', 'aria-hidden': 'true' });
  const markersPane = div('map__markers');
  const attrBox = div('map__attr');
  attrBox.innerHTML = opt.attribution || '';

  pane.appendChild(vector);
  pane.appendChild(markersPane);
  container.appendChild(tilesPane);
  container.appendChild(pane);
  container.appendChild(attrBox);

  let ctrlBox = null, locBtn = null;
  if (opt.interactive && opt.controls) {
    ctrlBox = div('map__ctrl');
    const bIn = button('map__btn map__btn--in', 'Приблизить', ICON_PLUS);
    const bOut = button('map__btn map__btn--out', 'Отдалить', ICON_MINUS);
    bIn.addEventListener('click', () => zoomTo(Math.round(zoom) + 1));
    bOut.addEventListener('click', () => zoomTo(Math.round(zoom) - 1));
    ctrlBox.appendChild(bIn);
    ctrlBox.appendChild(bOut);
    container.appendChild(ctrlBox);
  }
  if (opt.interactive && opt.locate) {
    locBtn = button('map__btn map__btn--locate', 'Показать, где я', ICON_LOCATE);
    locBtn.addEventListener('click', () => locate());
    container.appendChild(locBtn);
  }

  /* ── состояние отрисовки ──────────────────────────────────────────────── */

  const levels = new Map();             // целый зум → слой плиток
  const pool = [];                      // снятые с экрана <img>, ждут повторного применения
  const markers = new Set();
  const routes = new Set();
  const handlers = new Map();
  const unbinds = [];

  let activeZ = Math.round(zoom);
  const base = { x: 0, y: 0 };          // точка отсчёта слоя маркеров
  let baseZoom = null;

  let raf = 0, lastTs = 0, dirty = true;
  let viewAnim = null, zoomAnim = null, inertia = null;
  let endTimer = 0, tapTimer = 0, pressTimer = 0, wheelTimer = 0;
  let lastLat = NaN, lastLng = NaN, lastZoom = NaN, settleZoom = zoom;
  let pendingFit = null;

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
      applyView(unproject(p.x + inertia.vx * dt, p.y + inertia.vy * dt, zoom), zoom);
      const k = Math.exp(-dt / 190);    // затухание, не зависящее от частоты кадров
      inertia.vx *= k;
      inertia.vy *= k;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.014) { inertia = null; snapZoom(); }
    }

    if (zoomAnim) {
      const a = zoomAnim;
      const left = a.target - zoom;
      let z = zoom + left * (1 - Math.exp(-dt / 58));
      if (Math.abs(left) < 0.0025) { z = a.target; zoomAnim = null; }
      zoomAround(a.ll, a.pt, clamp(z, opt.minZoom, opt.maxZoom));
    }

    let moving = false;
    for (const m of markers) {
      if (!m.anim) continue;
      moving = true;
      stepMarker(m, dt);
    }
    return moving || !!(viewAnim || inertia || zoomAnim);
  }

  function draw() {
    if (!w || !h) return;
    const p = project(center[0], center[1], zoom);
    view.x = p.x - w / 2;
    view.y = p.y - h / 2;
    drawTiles();
    drawOverlay();
    if (lastLat !== center[0] || lastLng !== center[1] || lastZoom !== zoom) {
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
    if (pointers.size || viewAnim || inertia || zoomAnim) { scheduleSettle(); return; }
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

  function tileUrl(x, y, z) {
    const tpl = template();
    const subs = String(opt.subdomains || 'abc');
    const retina = window.devicePixelRatio > 1.4 ? '@2x' : '';
    return tpl.replace(/\{(-y|[a-z]+)\}/g, (all, key) => {
      switch (key) {
        case 'z': return String(z);
        case 'x': return String(x);
        case 'y': return String(y);
        case '-y': return String(Math.pow(2, z) - 1 - y);
        case 'r': return retina;
        case 's': return subs.charAt(Math.abs(x + y) % subs.length);
        case 'key': return encodeURIComponent(opt.key || '');
        default: return all;
      }
    });
  }

  function addLevel(z) {
    const p = project(center[0], center[1], z);
    const lv = {
      z,
      el: div('map__level'),
      tiles: new Map(),
      origin: { x: Math.round(p.x), y: Math.round(p.y) },
      pending: 0,
    };
    lv.el.style.zIndex = String(z);
    tilesPane.appendChild(lv.el);
    levels.set(z, lv);
    // больше трёх уровней держать незачем: это только память и лишние запросы
    if (levels.size > 3) {
      let far = null;
      for (const other of levels.values()) {
        if (other.z === z) continue;
        if (!far || Math.abs(other.z - z) > Math.abs(far.z - z)) far = other;
      }
      if (far) dropLevel(far);
    }
    return lv;
  }

  function dropLevel(lv) {
    for (const t of lv.tiles.values()) recycle(t, lv);
    lv.tiles.clear();
    if (lv.el.parentNode) lv.el.parentNode.removeChild(lv.el);
    levels.delete(lv.z);
  }

  /** Снятую плитку не выбрасываем, а кладём в пул: DOM-узлы дороже, чем кажется. */
  function recycle(t, lv) {
    const img = t.img;
    img.onload = null;
    img.onerror = null;
    if (!t.done) lv.pending--;
    img.classList.remove('is-on');
    if (img.parentNode) img.parentNode.removeChild(img);
    // адрес снимаем обязательно: иначе повторная подстановка того же адреса
    // в некоторых браузерах не вызывает onload, и плитка остаётся прозрачной
    img.removeAttribute('src');
    if (pool.length < 64) pool.push(img);
  }

  function addTile(lv, i, j, n) {
    const img = pool.pop() || new Image();
    const t = { i, j, img, done: false };
    img.className = 'map__tile';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.style.transform =
      'translate3d(' + (i * TILE - lv.origin.x) + 'px,' + (j * TILE - lv.origin.y) + 'px,0)';
    lv.pending++;
    img.onload = () => {
      t.done = true;
      lv.pending--;
      img.classList.add('is-on');
      if (lv.pending <= 0) pruneLevels(lv);
    };
    img.onerror = () => {
      // битую плитку не ждём вечно: считаем её «пришедшей», но не показываем
      t.done = true;
      lv.pending--;
      if (lv.pending <= 0) pruneLevels(lv);
    };
    const wx = ((i % n) + n) % n;
    img.src = tileUrl(wx, j, lv.z);
    lv.el.appendChild(img);
    lv.tiles.set(i + ':' + j, t);
    return t;
  }

  /** Старые уровни убираем только когда новый полностью загрузился — иначе будут дыры. */
  function pruneLevels(lv) {
    if (destroyed || lv.z !== activeZ || lv.pending > 0) return;
    for (const other of Array.from(levels.values())) {
      if (other.z !== activeZ) dropLevel(other);
    }
  }

  function drawTiles() {
    const z = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
    activeZ = z;
    const lv = levels.get(z) || addLevel(z);

    const scale = Math.pow(2, zoom - z);
    const n = Math.pow(2, z);
    const b = opt.buffer;
    const x0 = view.x / scale, y0 = view.y / scale;
    const x1 = (view.x + w) / scale, y1 = (view.y + h) / scale;
    const i0 = Math.floor(x0 / TILE) - b, i1 = Math.floor((x1 - 0.001) / TILE) + b;
    const j0 = Math.floor(y0 / TILE) - b, j1 = Math.floor((y1 - 0.001) / TILE) + b;

    // недостающие плитки ставим от центра к краям — там, куда смотрит человек, появится первым
    const cx = (i0 + i1) / 2, cy = (j0 + j1) / 2;
    const wanted = [];
    for (let j = j0; j <= j1; j++) {
      if (j < 0 || j >= n) continue;
      for (let i = i0; i <= i1; i++) {
        if (!lv.tiles.has(i + ':' + j)) wanted.push([i, j, Math.abs(i - cx) + Math.abs(j - cy)]);
      }
    }
    wanted.sort((a, c) => a[2] - c[2]);
    for (const [i, j] of wanted) addTile(lv, i, j, n);

    // всё, что уехало далеко за край, возвращаем в пул
    for (const lvl of levels.values()) {
      const k = lvl.z === z ? 1 : 0;    // чужие уровни чистим жёстче
      const f = Math.pow(2, lvl.z - z);
      const li0 = Math.floor(i0 * f) - k - 1, li1 = Math.ceil(i1 * f) + k + 1;
      const lj0 = Math.floor(j0 * f) - k - 1, lj1 = Math.ceil(j1 * f) + k + 1;
      for (const [key, t] of Array.from(lvl.tiles)) {
        if (t.i < li0 || t.i > li1 || t.j < lj0 || t.j > lj1) {
          recycle(t, lvl);
          lvl.tiles.delete(key);
        }
      }
      const s = Math.pow(2, zoom - lvl.z);
      const tx = lvl.origin.x * s - view.x;
      const ty = lvl.origin.y * s - view.y;
      // на целом зуме прижимаем слой к пиксельной сетке — плитки остаются острыми
      const px = s === 1 ? Math.round(tx) : n2(tx);
      const py = s === 1 ? Math.round(ty) : n2(ty);
      lvl.el.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0) scale(' + s + ')';
      lvl.el.classList.toggle('is-scaled', s !== 1);
    }
    if (lv.pending <= 0) pruneLevels(lv);
  }

  function rebuildTiles() {
    for (const lvl of Array.from(levels.values())) dropLevel(lvl);
    invalidate();
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
      'translate3d(' + n2(base.x - view.x) + 'px,' + n2(base.y - view.y) + 'px,0)';

    for (const m of markers) {
      if (moved || m.dirty) { placeMarker(m); m.dirty = false; }
    }
    // маршрут не пересчитываем на каждый кадр: сам путь построен в координатах
    // своего зума, а масштаб и сдвиг отдаём одному атрибуту transform
    for (const r of routes) {
      const rs = Math.pow(2, zoom - r.vz);
      r.g.setAttribute('transform',
        'translate(' + n2(r.vbase.x * rs - base.x) + ' ' + n2(r.vbase.y * rs - base.y) + ') scale(' + rs + ')');
    }
  }

  function placeMarker(m) {
    const p = project(m.ll[0], m.ll[1], zoom);
    m.root.style.transform =
      'translate3d(' + n2(p.x - base.x) + 'px,' + n2(p.y - base.y) + 'px,0)';
  }

  function applyHeading(m, deg) {
    m.heading = deg;
    m.rot.style.transform = 'rotate(' + n2(deg) + 'deg)';
  }

  function stepMarker(m, dt) {
    const a = m.anim;
    a.t += dt;
    const u = clamp(a.t / a.dur, 0, 1);
    m.ll = [lerp(a.from[0], a.to[0], u), lerp(a.from[1], a.to[1], u)];
    if (a.turn) {
      const d = ((a.h1 - a.h0 + 540) % 360) - 180;   // поворот по короткой дуге
      applyHeading(m, a.h0 + d * u);
    }
    m.dirty = true;
    dirty = true;
    if (u >= 1) m.anim = null;
  }

  function marker(o = {}) {
    const m = {
      ll: toLL(o.at) || center.slice(),
      root: div('map__marker'),
      rot: div('map__marker-rot' + (o.className ? ' ' + o.className : '')),
      heading: null,
      anim: null,
      dirty: true,
      rotate: !!o.rotate || typeof o.heading === 'number',
    };
    const inner = div('map__marker-in map__marker-in--' + (o.anchor === 'bottom' ? 'bottom' : 'center'));
    if (o.html) m.rot.innerHTML = o.html;
    if (o.zIndex != null) m.root.style.zIndex = String(o.zIndex);
    if (o.interactive) m.root.classList.add('map__marker--tap');
    inner.appendChild(m.rot);
    m.root.appendChild(inner);
    if (typeof o.heading === 'number') applyHeading(m, o.heading);
    markers.add(m);
    markersPane.appendChild(m.root);
    invalidate();

    return {
      el: m.root,
      node: m.rot,
      at: () => m.ll.slice(),

      /** Плавно перевести маркер в новую точку; с rotate — ещё и развернуть по ходу. */
      moveTo(next, mo = {}) {
        const to = toLL(next);
        if (!to) return;
        let head = typeof mo.heading === 'number' ? mo.heading : null;
        if (head === null && m.rotate && mo.turn !== false) {
          const far = Math.abs(to[0] - m.ll[0]) + Math.abs(to[1] - m.ll[1]);
          if (far > 2e-6) head = bearing(m.ll, to);
        }
        const dur = reduced() ? 0 : Math.max(0, +mo.duration || 0);
        if (!dur) {
          m.anim = null;
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
        schedule();
      },

      setHtml(html) {
        m.rot.innerHTML = html == null ? '' : String(html);
      },

      setHeading(deg) {
        m.rotate = true;
        m.anim = null;
        applyHeading(m, +deg || 0);
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
    if (r.lls.length < 2) {
      r.case.setAttribute('d', '');
      r.line.setAttribute('d', '');
      return;
    }
    r.vz = clamp(Math.round(zoom), opt.minZoom, opt.maxZoom);
    const first = project(r.lls[0][0], r.lls[0][1], r.vz);
    r.vbase = { x: Math.round(first.x), y: Math.round(first.y) };
    let d = '', lx = 0, ly = 0, started = false;
    for (let i = 0; i < r.lls.length; i++) {
      const p = project(r.lls[i][0], r.lls[i][1], r.vz);
      const x = p.x - r.vbase.x, y = p.y - r.vbase.y;
      // точки ближе полутора пикселей глазу не видны, а путь укорачивают заметно
      if (started && i < r.lls.length - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 1.5) continue;
      d += (started ? 'L' : 'M') + n2(x) + ' ' + n2(y);
      lx = x; ly = y; started = true;
    }
    r.case.setAttribute('d', d);
    r.line.setAttribute('d', d);
  }

  function styleRoute(r) {
    r.case.setAttribute('stroke-width', String(r.width + 4));
    r.line.setAttribute('stroke-width', String(r.width));
    if (r.color) r.line.style.stroke = r.color;
    else r.line.style.removeProperty('stroke');
    if (r.dashed) {
      r.line.setAttribute('stroke-dasharray', '0.1 ' + (r.width * 1.9));
      r.line.setAttribute('stroke-linecap', 'round');
      r.case.setAttribute('stroke-dasharray', '0.1 ' + (r.width * 1.9));
    } else {
      r.line.removeAttribute('stroke-dasharray');
      r.case.removeAttribute('stroke-dasharray');
    }
  }

  function route(coords, o = {}) {
    const r = {
      lls: [],
      vz: clamp(Math.round(zoom), opt.minZoom, opt.maxZoom),
      vbase: { x: 0, y: 0 },
      g: svgNode('g', { class: 'map__route' }),
      case: svgNode('path', { class: 'map__route-case', fill: 'none' }),
      line: svgNode('path', { class: 'map__route-line', fill: 'none' }),
      width: +o.width || 6,
      color: o.color || '',
      dashed: !!o.dashed,
    };
    r.g.appendChild(r.case);
    r.g.appendChild(r.line);
    vector.appendChild(r.g);
    routes.add(r);
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
      coords: () => r.lls.map((p) => p.slice()),
      remove() {
        routes.delete(r);
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
    invalidate();
  }

  /** Поставить зум так, чтобы точка ll осталась ровно под экранной точкой pt. */
  function zoomAround(ll, pt, z) {
    const p = project(ll[0], ll[1], z);
    applyView(unproject(p.x - pt.x + w / 2, p.y - pt.y + h / 2, z), z);
  }

  function latLngAt(pt) {
    return unproject(view.x + pt.x, view.y + pt.y, zoom);
  }

  function containerPoint(ll) {
    const p = toLL(ll);
    if (!p) return { x: 0, y: 0 };
    const q = project(p[0], p[1], zoom);
    return { x: q.x - view.x, y: q.y - view.y };
  }

  function bounds() {
    if (!w || !h) return [center.slice(), center.slice()];
    const a = latLngAt({ x: 0, y: h });
    const b = latLngAt({ x: w, y: 0 });
    return [a, b];   // юго-запад, северо-восток
  }

  function stopAnims() {
    viewAnim = null;
    inertia = null;
    zoomAnim = null;
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

  function zoomTo(z, pt, animate = true) {
    if (!w || !h) { applyView(center, clamp(z, opt.minZoom, opt.maxZoom)); return apiObj; }
    const target = clamp(z, opt.minZoom, opt.maxZoom);
    const point = pt || { x: w / 2, y: h / 2 };
    const ll = latLngAt(point);
    viewAnim = null;
    inertia = null;
    if (!animate || reduced()) {
      zoomAnim = null;
      zoomAround(ll, point, target);
      return apiObj;
    }
    zoomAnim = { target, ll, pt: point };
    schedule();
    return apiObj;
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
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ll of list) {
      const p = project(ll[0], ll[1], 0);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
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
    const cx = (minX + maxX) / 2 * s + (pad.right - pad.left) / 2;
    const cy = (minY + maxY) / 2 * s + (pad.bottom - pad.top) / 2;
    return setView(unproject(cx, cy, z), z, { animate: o.animate !== false, duration: o.duration });
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
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
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
      applyView(unproject(gesture.px.x - dx, gesture.px.y - dy, zoom), zoom);
      const now = performance.now();
      gesture.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (gesture.samples.length > 2 && now - gesture.samples[0].t > 110) gesture.samples.shift();
    } else if (gesture.mode === 'pinch') {
      const [a, b] = two();
      if (!a || !b) return;
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = {
        x: (a.x + b.x) / 2 - gRect.left,
        y: (a.y + b.y) / 2 - gRect.top,
      };
      lastMid = mid;
      const z = clamp(gesture.z0 + Math.log(d / gesture.d0) / Math.LN2, opt.minZoom, opt.maxZoom);
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
      zoomTo(Math.round(zoom) + 1, pt);
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
    return true;
  }

  function invalidateSize() {
    if (destroyed) return apiObj;
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
      emit('locateerror', { code: 0, message: 'Браузер не умеет определять положение' });
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
      const say = {
        1: 'Доступ к местоположению закрыт — включите его в настройках браузера',
        2: 'Не получилось определить, где вы',
        3: 'Спутники ищутся слишком долго',
      };
      emit('locateerror', { code: err.code, message: say[err.code] || 'Местоположение недоступно' });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
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
    if (template() !== was) rebuildTiles();
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
    if (ro) ro.disconnect();
    for (const un of unbinds) un();
    unbinds.length = 0;
    for (const lvl of Array.from(levels.values())) dropLevel(lvl);
    pool.length = 0;
    markers.clear();
    routes.clear();
    handlers.clear();
    pointers.clear();
    for (const node of [tilesPane, pane, attrBox, ctrlBox, locBtn]) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    container.classList.remove('map', 'map--dark', 'map--light', 'map--static');
    container.removeAttribute('aria-label');
  }

  const apiObj = {
    el: container,
    setView,
    fitPoints,
    marker,
    route,
    on,
    off,
    destroy,
    locate,
    setTheme,
    setTiles,
    invalidateSize,
    zoomIn: () => zoomTo(Math.round(zoom) + 1),
    zoomOut: () => zoomTo(Math.round(zoom) - 1),
    zoomTo: (z, pt, an) => zoomTo(z, pt, an),
    getCenter: () => center.slice(),
    getZoom: () => zoom,
    getBounds: bounds,
    latLngAt,
    containerPoint,
    get destroyed() { return destroyed; },
  };

  measure();
  invalidate();
  return apiObj;
}

/* ─────────────────────────────────────────────────────── готовые маркеры */

/**
 * Разметка типовых меток. Стили лежат в map.css, здесь только каркас:
 *   pin('a')       — жёлтая точка подачи
 *   pin('b', '2')  — флажок с номером точки назначения
 *   pin('car')     — машина курьера (маркер создавать с rotate: true)
 *   pin('me')      — «я здесь»
 */
export function pin(kind, label) {
  const cls = 'map-pin map-pin--' + kind;
  const tail = label ? '<span class="map-pin__label">' + label + '</span>' : '';
  if (kind === 'car') {
    return '<span class="' + cls + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M5 15.5V11l1.8-4.2A2 2 0 0 1 8.6 5.6h6.8a2 2 0 0 1 1.8 1.2L19 11v4.5a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1v-.8H8.4v.8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" fill="currentColor"/>' +
      '</svg></span>';
  }
  return '<span class="' + cls + '">' + tail + '</span>';
}

export default createMap;
