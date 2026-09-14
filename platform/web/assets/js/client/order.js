/* Оформление заказа: адреса, машина, грузчики, допуслуги и контакты.

   Экран собран из трёх шагов внутри одной шторки: адреса → машина → контакты.
   Шаги не перерисовываются целиком на каждое событие: пока шаг тот же, меняются
   только те узлы, где действительно новые данные. Иначе на каждом пересчёте цены
   у человека дёргалась бы карусель и слетал фокус из поля.

   Машины на карточках нарисованы здесь же, в SVG: пикап, спринтер и два грузовика
   с тентом. Человек выбирает не строчку в списке, а машину, которую увидит во дворе,
   поэтому под названием стоят вместимость и размеры кузова.

   Цену считает сервер. Здесь она только показывается: перед созданием заказа
   бэкенд пересчитает всё заново по своим тарифам.
*/

import { api } from '../core/api.js';
import { t, tp, getLang, extend } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import { el, toast, sheet, haptic } from '../core/ui.js';
import { pin } from '../core/map.js';
import { money, num, duration, NBSP } from '../core/fmt.js';
import { icon, iconBtn, errText, nameOf, dur } from './app.js';
import { pickAddress, rememberPoint } from './address.js';

/* Свои строки держим при себе: общий словарь правят соседние модули. */
extend({
  ru: {
    'car.cap_kg': 'до {v} кг',
    'car.cap_t': 'до {v} т',
    'car.body': 'кузов {v} м',
    'trip.jam': 'с пробками',
    'trip.free': 'дорога свободна',
    'trip.free_time': 'без пробок {v}',
  },
  ky: {
    'car.cap_kg': '{v} кг чейин',
    'car.cap_t': '{v} тоннага чейин',
    'car.body': 'кузов {v} м',
    'trip.jam': 'тыгын менен',
    'trip.free': 'жол бош',
    'trip.free_time': 'тыгынсыз {v}',
  },
});

const QUOTE_PAUSE = 320;       // пауза перед пересчётом цены, чтобы не дёргать сервер
const MAX_LOADERS = 8;
const JAM_STEP = 60;           // разницу меньше минуты человек не заметит, и врать про неё незачем

/* ─────────────────────────────────────────────────────── свои стили */

/* Карточки машин и строка маршрута живут только в этом экране, поэтому их стили
   приезжают вместе с ним. В client.css их класть нельзя: файл общий, его правят
   параллельно. Всё построено на токенах, так что тема переключается сама. */
const CSS = `
.sg-tariffs--live { padding: 10px var(--sp-4) 18px; }

.sg-tariff--live {
  width: 150px;
  gap: 0;
  padding: var(--sp-3);
  transition: transform var(--dur-2) var(--ease), border-color var(--dur-1) var(--ease),
              background-color var(--dur-1) var(--ease), box-shadow var(--dur-2) var(--ease);
}

/* Выбранная машина приподнимается над соседями и подсвечивается: видно даже
   краем глаза, на чём человек остановился. */
.sg-tariff--live.is-on {
  transform: translateY(-4px);
  border-color: var(--accent-line);
  background: var(--accent-soft);
  box-shadow: var(--shadow-2);
}
.sg-tariff--live:active { transform: scale(.97); }
.sg-tariff--live.is-on:active { transform: translateY(-4px) scale(.97); }

.sgv-art { display: block; width: 84px; height: 44px; margin-bottom: 4px; }
.sgv-art > svg {
  display: block;
  width: 84px;
  height: 44px;
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, .26));
}

/* Три цвета на всю машину: кузов, тёмное стекло с резиной и светлый груз.
   Кузов и ступицы загораются вместе с выбором. */
.sgv__body { fill: var(--muted); transition: fill var(--dur-2) var(--ease); }
.sgv__deck { fill: var(--muted); opacity: .5; transition: fill var(--dur-2) var(--ease); }
.sgv__hub  { fill: var(--muted); transition: fill var(--dur-2) var(--ease); }
.sgv__glass { fill: rgba(12, 12, 16, .55); }
.sgv__tyre { fill: rgba(12, 12, 16, .92); }
.sgv__cargo { fill: var(--text); opacity: .16; }
.sgv__line { fill: none; stroke: rgba(12, 12, 16, .3); stroke-width: 1.2; stroke-linecap: round; }
.sgv__shade { fill: rgba(0, 0, 0, .18); }

.sg-tariff--live.is-on .sgv__body,
.sg-tariff--live.is-on .sgv__deck,
.sg-tariff--live.is-on .sgv__hub { fill: var(--accent); }

.sgv-cap {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin-top: 1px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.sgv-dim {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted-2);
  font-size: var(--fs-xs);
  line-height: 1.4;
}

/* Пока считается новая цена, старая остаётся на месте и просто гаснет:
   пустое место на кнопке читается как поломка. */
.sg-tariff__price, .sg-cta__price, .sg-total__val {
  transition: opacity var(--dur-2) var(--ease);
}
.sg-tariff__price.is-stale, .sg-cta__price.is-stale, .sg-total__val.is-stale { opacity: .45; }

/* Расстояние, время с пробками и слово, объясняющее, почему дольше. */
.sgv-trip {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  line-height: 1.2;
}
.sgv-trip__km {
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sgv-trip__time { color: var(--muted); font-variant-numeric: tabular-nums; }
.sgv-trip__jam {
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.sgv-trip__jam.is-free { background: var(--ok-soft); color: var(--ok); }
`;

const STYLE_ID = 'sg-order-style';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(el('style', { id: STYLE_ID, text: CSS }));
}

/* ─────────────────────────────────────────────────────── машины в SVG */

/* Колесо: тёмная покрышка и ступица в цвет кузова. Все машины стоят на одной
   линии — 32 по вертикали, поэтому в ряду они выглядят одной семьёй. */
function wheel(cx, r) {
  const rr = r || 6;
  return '<circle class="sgv__tyre" cx="' + cx + '" cy="32" r="' + rr + '"/>' +
    '<circle class="sgv__hub" cx="' + cx + '" cy="32" r="' + (rr * 0.38).toFixed(1) + '"/>';
}

/* Каждая машина — несколько чистых фигур: кузов, стекло, колёса. Мелочи вроде
   рёбер тента добавлены только там, где они помогают узнать машину. */
const ART = {
  // Пикап: открытый борт с грузом сзади, кабина и капот впереди. Коробки рисуем
  // до борта — тогда борт закрывает их снизу, как в жизни.
  express: () =>
    '<rect class="sgv__cargo" x="12" y="10" width="11" height="8" rx="1.5"/>' +
    '<rect class="sgv__cargo" x="25" y="12" width="9" height="6" rx="1.5"/>' +
    '<rect class="sgv__deck" x="8" y="17" width="30" height="13" rx="2.5"/>' +
    '<path class="sgv__body" d="M38 30V13c0-2.2 1.8-4 4-4h12c1.4 0 2.7.7 3.4 1.9L61 17h9' +
      'c2.8 0 5 2.2 5 5v5.5c0 1.4-1.1 2.5-2.5 2.5H38z"/>' +
    '<path class="sgv__glass" d="M43 12h10.5l4.6 6.4H43z"/>' +
    '<rect class="sgv__glass" x="70.5" y="20.5" width="4" height="3.4" rx="1.4"/>' +
    wheel(18) + wheel(64),

  // Спринтер: высокая крыша, короткий нос и заваленное лобовое стекло во всю
  // кабину. Стекло идёт вдоль наклона кузова и держится внутри его обвода.
  van: () =>
    '<path class="sgv__body" d="M11 6h35l12 9 8 1.6c3.3.7 5.6 3.6 5.6 7V27c0 1.7-1.3 3-3 3H11' +
      'c-2.2 0-4-1.8-4-4V10c0-2.2 1.8-4 4-4z"/>' +
    '<path class="sgv__glass" d="M44 8.4h4.6l7.9 6.9H44z"/>' +
    '<path class="sgv__line" d="M41 10v19"/>' +
    '<rect class="sgv__cargo" x="13" y="20" width="20" height="1.6" rx=".8"/>' +
    wheel(22) + wheel(62),

  // Трёхтонник: тент с рёбрами и отдельная кабина, между ними рама.
  truck: () =>
    '<path class="sgv__deck" d="M6 30V13c0-2.8 2.2-5 5-5h38c2.8 0 5 2.2 5 5v17H6z"/>' +
    '<path class="sgv__line" d="M6 15h48M18 15.5v14M30 15.5v14M42 15.5v14"/>' +
    '<rect class="sgv__body" x="16" y="27.5" width="46" height="3" rx="1.5"/>' +
    '<path class="sgv__body" d="M56 30V14c0-2.2 1.8-4 4-4h9.4c1.6 0 3 .9 3.7 2.3l3.4 6.9' +
      'c.3.6.5 1.3.5 2v6.3c0 1.4-1.1 2.5-2.5 2.5H56z"/>' +
    '<path class="sgv__glass" d="M60 13h9l3.6 7.2H60z"/>' +
    wheel(26) + wheel(66),

  // Пятитонник: тент выше и длиннее, кабина со спальником, задняя ось спаренная.
  truck_big: () =>
    '<path class="sgv__deck" d="M4 30V11c0-2.8 2.2-5 5-5h44c2.8 0 5 2.2 5 5v19H4z"/>' +
    '<path class="sgv__line" d="M4 13h54M15 13.5v16M27 13.5v16M39 13.5v16M51 13.5v16"/>' +
    '<rect class="sgv__body" x="12" y="27.5" width="54" height="3" rx="1.5"/>' +
    '<path class="sgv__body" d="M60 30V11c0-2.2 1.8-4 4-4h9c1.5 0 2.9.8 3.6 2.1l2.9 5.4' +
      'c.3.6.5 1.2.5 1.9v11.1c0 1.4-1.1 2.5-2.5 2.5H60z"/>' +
    '<path class="sgv__glass" d="M64 10h8.6l3.4 6.4H64z"/>' +
    wheel(16) + wheel(30) + wheel(70),
};

const ART_BY_ICON = {
  car: 'express', pickup: 'express', van: 'van', bus: 'van',
  truck: 'truck', 'truck-big': 'truck_big', truck_big: 'truck_big',
};

/* Какую машину рисовать. Класс из тарифа главный, иконка — запасной вариант,
   а если админ придумал свой класс, судим по грузоподъёмности: показать пикап
   там, где приедет пятитонник, хуже, чем угадать по весу. */
function vehicleKind(tf) {
  const cls = String((tf && tf.vehicle_class) || '').toLowerCase();
  if (ART[cls]) return cls;
  const byIcon = ART_BY_ICON[String((tf && tf.icon) || '').toLowerCase()];
  if (byIcon) return byIcon;
  const kg = Number(tf && tf.capacity_kg) || 0;
  if (kg >= 4000) return 'truck_big';
  if (kg >= 2000) return 'truck';
  if (kg >= 700) return 'van';
  return 'express';
}

function vehicleArt(tf) {
  return '<svg class="sgv" viewBox="0 0 84 44" width="84" height="44" ' +
    'aria-hidden="true" focusable="false">' +
    '<ellipse class="sgv__shade" cx="42" cy="39.2" rx="31" ry="2.2"/>' +
    ART[vehicleKind(tf)]() + '</svg>';
}

/* ─────────────────────────────────────────────────────── мелочи */

function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

/* Расстояние с одним знаком после запятой: «12,4 км». Меньше километра
   показываем метрами — десятые доли там всё равно врут. */
function distText(m) {
  const v = Math.max(0, Number(m) || 0);
  if (v < 950) return Math.round(v / 10) * 10 + NBSP + 'м';
  return (v / 1000).toFixed(1).replace('.', ',') + NBSP + 'км';
}

/* Сколько увезёт: «до 3 т», «до 300 кг». */
function capText(tf) {
  const kg = Math.round(Number(tf && tf.capacity_kg) || 0);
  if (kg <= 0) return nameOf(tf, 'desc');
  if (kg >= 1000) {
    const tons = Math.round(kg / 100) / 10;
    return t('car.cap_t', { v: String(tons).replace('.', ',') });
  }
  return t('car.cap_kg', { v: num(kg) });
}

/* Размеры кузова в метрах: длина × ширина × высота. В базе они в сантиметрах,
   но человек прикидывает диван в метрах, а не в сантиметрах. */
function dimText(tf) {
  const raw = [tf && tf.body_d, tf && tf.body_w, tf && tf.body_h].map((v) => Number(v) || 0);
  if (raw.some((v) => v <= 0)) return '';
  return t('car.body', { v: raw.map((v) => (v / 100).toFixed(1).replace('.', ',')).join('×') });
}

/** Подпись точки: первая — откуда, последняя — куда, между ними промежуточные. */
function pointLabel(i, total) {
  if (i === 0) return t('order.from');
  if (i === total - 1) return t('order.to');
  return t('order.point', { n: i + 1 });
}

function pointHint(i, total) {
  return i === 0 ? t('order.from_ph') : t('order.to_ph');
}

/** Приписка к адресу: подъезд, квартира, этаж — то, что человек уточнил сам. */
function pointNote(p) {
  if (!p) return '';
  const parts = [];
  if (p.entrance) parts.push(t('order.entrance') + ' ' + p.entrance);
  if (p.flat) parts.push(t('order.flat') + ' ' + p.flat);
  if (p.floor) parts.push(t('order.floor') + ' ' + p.floor);
  if (!parts.length && p.subtitle) return p.subtitle;
  return parts.join(', ');
}

/* Цифра доезжает до нового значения за --dur-3, а не прыгает: скачок цены
   человек читает как ошибку расчёта. Промежуточные кадры округляем до сома —
   мелькающие тыйыны выглядят как рябь. */
function moneyBox(node) {
  let shown = null;             // что сейчас на экране, в тыйынах
  let target = null;
  let raf = 0;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function jump(v) {
    shown = v;
    node.textContent = money(v);
  }

  return {
    set(value) {
      const next = Math.round(Number(value) || 0);
      if (target === next) {
        // Уже едем ровно туда же. Если счёт закончился, а текст в узле сменили
        // со стороны, ставим число обратно.
        if (!raf && shown !== next) jump(next);
        return;
      }
      target = next;
      const from = shown;
      stop();
      const time = dur('--dur-3', 380);
      if (from === null || from === next || time <= 20) {
        jump(next);
        return;
      }
      // Время берём сами, а не из аргумента кадра: его передаёт не всякая среда,
      // а без него счётчик посчитал бы NaN и показал бы его человеку.
      const started = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - started) / time);
        const eased = 1 - Math.pow(1 - k, 3);
        // Узел уже сняли с экрана — досчитывать некому и незачем.
        if (k >= 1 || !node.isConnected) {
          raf = 0;
          jump(next);
          return;
        }
        jump(Math.round((from + (next - from) * eased) / 100) * 100);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    /** Цены нет вовсе: показываем прочерк или ошибку и забываем прошлое число. */
    clear(text) {
      stop();
      shown = null;
      target = null;
      node.textContent = text;
    },
    stop,
  };
}

/* Поле с плавающей меткой. Метка идёт после поля — так её поднимает соседний
   селектор, без единой строчки скрипта. */
function field(label, value, opts = {}) {
  const props = {
    className: 'field__input',
    placeholder: ' ',
    value: value || '',
    inputmode: opts.inputmode || null,
    autocomplete: opts.autocomplete || 'off',
    enterkeyhint: opts.enterkeyhint || null,
    maxLength: opts.maxLength || 200,
  };
  // У textarea свойство type только для чтения — трогать его нельзя.
  if (!opts.multiline) props.type = opts.type || 'text';
  const input = el(opts.multiline ? 'textarea' : 'input', props);
  const node = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, label),
    opts.hint ? el('span', { className: 'field__hint' }, opts.hint) : null,
  );
  return { node, input, get value() { return input.value.trim(); } };
}

/* ─────────────────────────────────────────────────────── экран */

export function mountOrder(app) {
  installStyles();

  const tariffs = app.tariffs.filter((x) => x && x.id);
  const store = createStore({
    step: 'addr',
    points: [null, null],
    tariffId: tariffs.length ? tariffs[0].id : 0,
    loaders: 0,
    extras: {},                 // код услуги → количество
    route: null,
    prices: {},                 // id тарифа → итог в тыйынах
    quotes: {},                 // id тарифа → полный расчёт сервера
    quote: null,
    priceState: 'idle',         // idle | wait | ok | err
    priceError: null,
    busy: false,
  });

  const me = app.me();
  const contacts = { phone: me.phone || '', name: me.name || '', comment: '', agree: true };

  let view = null;              // {name, node, update}
  let markers = [];
  let line = null;
  let quoteTimer = 0;
  let quoteCtrl = null;
  let mapKey = '';
  let dead = false;
  const runningBoxes = new Set();   // счётчики цены, которые надо остановить на выходе

  /* Счётчик цены с учётом на выходе: досчитывать цифру в узле, которого уже нет
     на экране, незачем. Остановленный счётчик не ломается — он просто начнёт
     следующий отсчёт заново. */
  function newMoneyBox(node) {
    const box = moneyBox(node);
    runningBoxes.add(box);
    return box;
  }

  function stopBoxes() {
    for (const box of runningBoxes) box.stop();
    runningBoxes.clear();
  }

  /* ── данные ──────────────────────────────────────────────────────────── */

  const tariffById = (id) => tariffs.find((x) => x.id === id) || tariffs[0] || null;

  function coords(state) {
    return state.points.filter((p) => p && p.lat != null).map((p) => [p.lat, p.lng]);
  }

  function ready(state) {
    const pts = state.points;
    return pts.length >= 2 && pts[0] && pts[0].lat != null &&
      pts[pts.length - 1] && pts[pts.length - 1].lat != null;
  }

  function extrasList(state) {
    return Object.keys(state.extras)
      .map((code) => ({ code, qty: state.extras[code] }))
      .filter((x) => x.qty > 0);
  }

  function total(state) {
    const v = state.prices[state.tariffId];
    return typeof v === 'number' ? v : null;
  }

  /* ── карта ───────────────────────────────────────────────────────────── */

  function syncMap(state) {
    const pts = state.points;
    const key = pts.map((p) => (p ? p.lat.toFixed(5) + ',' + p.lng.toFixed(5) : '-')).join(';');
    if (key === mapKey) return;
    mapKey = key;

    for (const m of markers) m.remove();
    markers = [];
    const set = [];
    pts.forEach((p, i) => {
      if (!p || p.lat == null) return;
      const first = i === 0;
      markers.push(app.marker({
        at: [p.lat, p.lng],
        html: first ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
        anchor: first ? 'center' : 'bottom',
        zIndex: 10 + i,
      }));
      set.push([p.lat, p.lng]);
    });

    if (!set.length) {
      if (line) { line.remove(); line = null; }
      return;
    }
    if (set.length < 2 && line) { line.remove(); line = null; }
    app.fit(set, { maxZoom: set.length > 1 ? 16 : 15.5 });
  }

  function drawRoute(path) {
    if (!path || path.length < 2) return;
    if (line) line.setCoords(path);
    else line = app.route(path, { width: 6 });
    app.fit(path, { maxZoom: 16 });
  }

  /* ── цена ────────────────────────────────────────────────────────────── */

  /* Пересчёт с задержкой: пока палец жмёт плюсик на грузчиках, сервер не трогаем.
     Начатый запрос сразу отменяем — его ответ уже про старые условия и, придя
     последним, показал бы неверную цену. */
  function schedulePrice() {
    clearTimeout(quoteTimer);
    if (quoteCtrl) {
      quoteCtrl.abort();
      quoteCtrl = null;
    }
    const state = store.get();
    if (!ready(state) || !tariffs.length) {
      store.set({ prices: {}, quotes: {}, quote: null, priceState: 'idle', priceError: null });
      return;
    }
    store.set({ priceState: 'wait' });
    quoteTimer = setTimeout(runPrice, QUOTE_PAUSE);
  }

  async function runPrice() {
    if (dead) return;
    if (quoteCtrl) quoteCtrl.abort();
    quoteCtrl = new AbortController();
    const mine = quoteCtrl;
    const state = store.get();
    const pts = coords(state);
    const body = {
      points: pts,
      loaders: state.loaders,
      extras: extrasList(state),
      lang: getLang(),
    };

    // Линия маршрута нужна только карте: не получилась — цена всё равно посчитается.
    api.post('/geo/route', { points: pts }, { signal: mine.signal })
      .then((r) => {
        if (dead || mine !== quoteCtrl) return;
        store.set({ route: r });
        drawRoute(r.route);
      })
      .catch(() => {});

    const answers = await Promise.all(tariffs.map((tf) => api
      .post('/price/quote', Object.assign({ tariff_id: tf.id }, body), { signal: mine.signal })
      .then((r) => ({ id: tf.id, r }))
      .catch((e) => ({ id: tf.id, e }))));
    if (dead || mine !== quoteCtrl) return;

    const prices = {};
    const quotes = {};
    let fail = null;
    for (const a of answers) {
      if (a.r) {
        prices[a.id] = a.r.total;
        quotes[a.id] = a.r;
      } else if (a.e && a.e.code !== 'aborted') {
        fail = a.e;
      }
    }
    if (!Object.keys(prices).length) {
      store.set({ priceState: 'err', priceError: fail, quote: null });
      return;
    }
    store.set({
      prices, quotes, quote: quotes[state.tariffId] || null,
      priceState: 'ok', priceError: null,
    });
  }

  /* Смена тарифа ничего не пересчитывает: цены всех машин приходят одним заходом,
     поэтому новая цифра стоит на экране в тот же кадр. Сервер зовём, только если
     этой машины в ответе не было. */
  function pickTariff(id) {
    const state = store.get();
    if (state.tariffId === id) return;
    const known = state.quotes[id];
    store.set({ tariffId: id, quote: known || null });
    if (!known) schedulePrice();
  }

  /* ── действия ────────────────────────────────────────────────────────── */

  async function choose(i) {
    const state = store.get();
    const point = await pickAddress(app, {
      title: pointLabel(i, state.points.length),
      placeholder: pointHint(i, state.points.length),
      value: state.points[i],
      near: app.map.getCenter(),
    });
    if (dead) return;
    // Шторку занимал поиск адреса, наш шаг из неё убрали — собираем заново.
    view = null;
    if (!point) {
      render(store.get(), true);
      return;
    }
    const pts = store.get().points.slice();
    pts[i] = Object.assign({}, pts[i] || {}, point);
    const full = pts.length >= 2 && pts[0] && pts[pts.length - 1];
    store.set({ points: pts, step: full && store.get().step === 'addr' ? 'tariff' : store.get().step });
    schedulePrice();
  }

  function addPoint() {
    const pts = store.get().points.slice();
    if (pts.length >= app.maxPoints) {
      toast(t('order.max_points'), { type: 'info' });
      return;
    }
    pts.push(null);
    haptic();
    store.set({ points: pts });
    choose(pts.length - 1);
  }

  function removePoint(i) {
    const pts = store.get().points.slice();
    if (pts.length <= 2) return;
    pts.splice(i, 1);
    store.set({ points: pts });
    schedulePrice();
  }

  /* Детали адреса: подъезд, этаж, домофон и кто встретит. Сервер принимает их
     в самой точке, поэтому храним прямо в ней. */
  function openDetails(i) {
    const state = store.get();
    const p = state.points[i] || {};
    const entrance = field(t('order.entrance'), p.entrance, { maxLength: 16, inputmode: 'numeric' });
    const flat = field(t('order.flat'), p.flat, { maxLength: 16 });
    const floor = field(t('order.floor'), p.floor, { maxLength: 16, inputmode: 'numeric' });
    const intercom = field(t('order.intercom'), p.intercom, { maxLength: 32 });
    const comment = field(t('order.point_comment'), p.comment,
                          { multiline: true, maxLength: 300, hint: t('order.point_comment_ph') });
    const cname = field(t('order.contact_name'), p.name, { maxLength: 80, autocomplete: 'name' });
    const cphone = field(t('order.contact_phone'), p.phone,
                         { type: 'tel', inputmode: 'tel', maxLength: 32, autocomplete: 'tel' });

    const rows = el('div', { className: 'sg-fields' },
      el('div', { className: 'row gap-3' },
        el('div', { className: 'grow' }, entrance.node),
        el('div', { className: 'grow' }, flat.node)),
      el('div', { className: 'row gap-3' },
        el('div', { className: 'grow' }, floor.node),
        el('div', { className: 'grow' }, intercom.node)),
      comment.node,
      el('div', { className: 'sg-group' }, t('order.contact')),
      cname.node,
      cphone.node,
    );

    const actions = [{
      label: t('common.save'),
      kind: 'primary',
      onClick: () => {
        const pts = store.get().points.slice();
        pts[i] = Object.assign({}, pts[i] || {}, {
          entrance: entrance.value, flat: flat.value, floor: floor.value,
          intercom: intercom.value, comment: comment.value,
          name: cname.value, phone: cphone.value,
        });
        store.set({ points: pts });
        haptic();
      },
    }];
    if (store.get().points.length > 2) {
      actions.unshift({
        label: t('order.remove_point'),
        kind: 'danger',
        onClick: () => removePoint(i),
      });
    }

    sheet({ title: t('order.details'), content: rows, actions });
  }

  /* Допуслуги: количественные со счётчиком, разовые переключателем.
     Итог внизу обновляется сам — подписка живёт ровно столько, сколько шторка. */
  function openExtras() {
    const list = el('div', { className: 'col' });
    const state0 = store.get();
    const fit = (e) => !Array.isArray(e.tariff_ids) || e.tariff_ids.indexOf(state0.tariffId) >= 0;
    const items = app.extras.filter(fit);

    if (!items.length) {
      list.appendChild(el('div', { className: 'empty' },
        el('div', { className: 'empty__title' }, t('order.extras_none'))));
    }

    for (const ex of items) {
      const unit = getLang() === 'ky' ? (ex.unit_ky || '') : (ex.unit_ru || '');
      const price = money(ex.price) + (unit ? ' / ' + unit : '');
      const right = el('div', { className: 'none' });
      const row = el('div', { className: 'sg-extra' },
        el('div', { className: 'grow' },
          el('div', { className: 'sg-opt__title' }, nameOf(ex)),
          el('div', { className: 'sg-opt__sub' }, price)),
        right);

      if (ex.kind === 'fixed') {
        const box = el('input', { type: 'checkbox', checked: !!store.get().extras[ex.code] });
        box.addEventListener('change', () => {
          const next = Object.assign({}, store.get().extras);
          if (box.checked) next[ex.code] = 1;
          else delete next[ex.code];
          store.set({ extras: next });
          schedulePrice();
          haptic();
        });
        right.appendChild(el('label', { className: 'switch' }, box,
          el('span', { className: 'switch__track' })));
      } else {
        const step = Number(ex.step) > 0 ? Number(ex.step) : 1;
        const low = Number(ex.min_qty) > 0 ? Number(ex.min_qty) : 1;
        const high = Number(ex.max_qty) > 0 ? Number(ex.max_qty) : 20;
        right.appendChild(stepper({
          value: store.get().extras[ex.code] || 0,
          min: 0, max: high, step, lowest: low,
          onChange: (v) => {
            const next = Object.assign({}, store.get().extras);
            if (v > 0) next[ex.code] = v;
            else delete next[ex.code];
            store.set({ extras: next });
            schedulePrice();
          },
        }).node);
      }
      list.appendChild(row);
    }

    // Итог держим в подвале шторки: цена меняется на лету, и её должно быть видно,
    // не доскроллив список до конца. Пока считается — прежнее число гаснет, но стоит.
    const value = el('span', { className: 'sg-total__val' });
    const box = newMoneyBox(value);
    const sum = el('div', { className: 'sg-total' },
      el('span', { className: 'sg-total__name' }, t('order.price_total')), value);
    const paint = (s) => {
      const v = total(s);
      if (v === null) box.clear(s.priceState === 'err' ? t('common.error') : '—');
      else box.set(v);
      value.classList.toggle('is-stale', v !== null && s.priceState === 'wait');
    };
    paint(store.get());
    const off = store.on(paint);

    sheet({
      title: t('order.extras'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, t('order.extras_hint')), list),
      actions: [sum, { label: t('common.done'), kind: 'primary' }],
      onClose: () => {
        off();
        box.stop();
        runningBoxes.delete(box);
      },
    });
  }

  /* ── создание заказа ─────────────────────────────────────────────────── */

  async function submit(btn) {
    const state = store.get();
    if (!ready(state)) {
      toast(state.points[0] ? t('order.need_to') : t('order.need_from'), { type: 'err' });
      store.set({ step: 'addr' });
      return;
    }
    if (!state.tariffId) {
      toast(t('order.need_tariff'), { type: 'err' });
      return;
    }
    if (digits(contacts.phone).length < 9) {
      toast(t('order.need_phone'), { type: 'err' });
      store.set({ step: 'confirm' });
      return;
    }
    if (!contacts.agree) {
      toast(t('order.confirm_hint'), { type: 'info' });
      return;
    }

    store.set({ busy: true });
    if (btn) btn.disabled = true;
    try {
      const body = {
        phone: contacts.phone,
        name: contacts.name,
        tariff_id: state.tariffId,
        loaders: state.loaders,
        extras: extrasList(state),
        comment: contacts.comment,
        lang: getLang(),
        points: state.points.filter(Boolean).map((p) => ({
          addr: p.addr || p.subtitle || '',
          lat: p.lat, lng: p.lng,
          entrance: p.entrance || '', flat: p.flat || '', floor: p.floor || '',
          intercom: p.intercom || '', comment: p.comment || '',
          name: p.name || '', phone: p.phone || '',
        })),
      };
      const res = await api.post('/orders', body);
      app.setMe({ phone: contacts.phone, name: contacts.name });
      app.saveOrder(res.public_id, res.track_token);
      for (const p of state.points) rememberPoint(p);
      haptic(24);
      if (res.payment && res.payment.url) {
        location.href = res.payment.url;     // заказ ждёт оплаты на стороне банка
        return;
      }
      app.go('/order/' + res.public_id, { t: res.track_token });
      return;
    } catch (e) {
      toast(errText(e), { type: 'err' });
      const code = e && e.code;
      if (code === 'point_outside' || code === 'same_points' ||
          code === 'few_points' || code === 'bad_point' || code === 'too_many_points') {
        store.set({ step: 'addr' });
      }
      if (code === 'bad_phone') store.set({ step: 'confirm' });
    } finally {
      store.set({ busy: false });
      if (btn) btn.disabled = false;
    }
  }

  /* ── счётчик ─────────────────────────────────────────────────────────── */

  /* Свой счётчик поверх классов components.css: у допуслуг бывает дробный шаг
     и своя нижняя граница, до которой прыгаем сразу с нуля. */
  function stepper(o) {
    let value = Number(o.value) || 0;
    const step = Number(o.step) || 1;
    const low = o.lowest === undefined ? step : Number(o.lowest);
    const min = Number(o.min) || 0;
    const max = Number(o.max) || 99;

    const show = el('span', { className: 'stepper__val' });
    // Подписи кнопок — сами знаки: скринридер прочитает «минус» и «плюс»,
    // и это ровно то, что делает кнопка.
    const minus = el('button', { type: 'button', className: 'stepper__btn' }, '−');
    const plus = el('button', { type: 'button', className: 'stepper__btn' }, '+');
    const node = el('div', { className: 'stepper' }, minus, show, plus);

    function paint() {
      show.textContent = String(Math.round(value * 10) / 10);
      minus.disabled = value <= min;
      plus.disabled = value >= max;
    }
    function set(v) {
      value = Math.max(min, Math.min(max, Math.round(v * 10) / 10));
      paint();
      haptic();
      if (o.onChange) o.onChange(value);
    }
    minus.addEventListener('click', () => set(value - (value <= low ? value - min : step)));
    plus.addEventListener('click', () => set(value < low ? low : value + step));
    paint();
    return { node, set, value: () => value };
  }

  /* ── шаг «адреса» ────────────────────────────────────────────────────── */

  function stepAddr() {
    const box = el('div', { className: 'sg-points' });
    const body = el('div', { className: 'sg-body' }, box);
    const add = el('button', { type: 'button', className: 'sg-add', onClick: addPoint },
      el('span', { html: icon('plus') }), t('order.add_point'));

    // Адреса уже вписаны, человек просто вернулся посмотреть — дайте ему уйти вперёд.
    const next = el('button', {
      type: 'button', className: 'sg-cta', hidden: true,
      onClick: () => store.set({ step: 'tariff' }),
    }, el('span', { className: 'sg-cta__label' }, t('common.continue')));

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('order.title')),
          el('div', { className: 'sg-head__sub' }, t('order.subtitle')))),
      body,
      el('div', { className: 'sg-foot' }, add, next),
    );

    function update(state) {
      const pts = state.points;
      const rows = pts.map((p, i) => {
        const has = !!(p && p.lat != null);
        const note = has ? pointNote(p) : '';
        return el('div', { className: 'sg-point' },
          el('button', {
            type: 'button', className: 'sg-point__main',
            'aria-label': pointLabel(i, pts.length),
            onClick: () => choose(i),
          },
            el('span', { className: 'sg-point__dot ' + (i === 0 ? 'sg-point__dot--a' : 'sg-point__dot--b') }),
            el('span', { className: 'grow' },
              el('span', {
                className: 'sg-point__text' + (has ? '' : ' sg-point__text--empty'),
              }, has ? (p.addr || t('order.on_map')) : pointHint(i, pts.length)),
              note ? el('span', { className: 'sg-point__note' }, note) : null)),
          has
            ? iconBtn('note', 'sg-point__act is-set', t('order.details'), () => openDetails(i))
            : (pts.length > 2
              ? iconBtn('close', 'sg-point__act', t('order.remove_point'), () => removePoint(i))
              : null),
        );
      });
      box.replaceChildren(...rows);
      add.hidden = pts.length >= app.maxPoints;
      next.hidden = !ready(state);
      app.panel.refresh();
    }

    return { name: 'addr', node, update };
  }

  /* ── шаг «машина» ────────────────────────────────────────────────────── */

  function stepTariff() {
    const routeRow = el('button', { type: 'button', className: 'sg-route',
                                    onClick: () => store.set({ step: 'addr' }) });
    const cards = el('div', { className: 'sg-tariffs sg-tariffs--live' });
    const loadersSub = el('div', { className: 'sg-opt__sub' });
    const extrasSub = el('div', { className: 'sg-opt__sub' });
    const note = el('div', { className: 'sg-note' }, t('order.price_note'));
    const retry = el('button', {
      type: 'button', className: 'btn btn--ghost btn--block', hidden: true,
      onClick: () => schedulePrice(),
    }, t('common.retry'));
    const priceBox = el('span', { className: 'sg-cta__price' }, '—');
    const priceMoney = newMoneyBox(priceBox);
    const cta = el('button', { type: 'button', className: 'sg-cta', onClick: () => go() },
      el('span', { className: 'sg-cta__label' }, t('order.submit')), priceBox);

    const loadersStep = stepper({
      value: store.get().loaders, min: 0, max: MAX_LOADERS, step: 1, lowest: 1,
      onChange: (v) => { store.set({ loaders: v }); schedulePrice(); },
    });

    const body = el('div', { className: 'sg-body' },
      routeRow,
      cards,
      el('div', { className: 'sg-opt' },
        el('div', { className: 'sg-opt__text' },
          el('div', { className: 'sg-opt__title' }, t('order.loaders')),
          loadersSub),
        loadersStep.node),
      el('button', { type: 'button', className: 'sg-opt', onClick: openExtras },
        el('span', { className: 'sg-opt__text' },
          el('span', { className: 'sg-opt__title' }, t('order.extras')),
          extrasSub),
        el('span', { className: 'sg-opt__go', html: icon('go') })),
    );

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('order.tariff_choose')))),
      body,
      el('div', { className: 'sg-foot' }, retry, note, cta),
    );

    /* Телефон уже знаем — заказываем сразу, иначе уходим на шаг с контактами. */
    function go() {
      if (digits(contacts.phone).length >= 9 && contacts.name) submit(cta);
      else store.set({ step: 'confirm' });
    }

    let builtFor = '';
    let cardList = [];
    let routeKey = '';

    function buildCard(tf) {
      const priceNode = el('span', { className: 'sg-tariff__price' }, '—');
      const cap = capText(tf);
      const dims = dimText(tf);
      const card = el('button', {
        type: 'button', className: 'sg-tariff sg-tariff--live',
        dataset: { id: String(tf.id) },
        title: nameOf(tf, 'desc') || [cap, dims].filter(Boolean).join(', '),
        onClick: () => {
          if (store.get().tariffId === tf.id) return;
          haptic();
          pickTariff(tf.id);
          card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        },
      },
        el('span', { className: 'sgv-art', html: vehicleArt(tf) }),
        el('span', { className: 'sg-tariff__name' }, nameOf(tf)),
        cap ? el('span', { className: 'sgv-cap' }, cap) : null,
        dims ? el('span', { className: 'sgv-dim' }, dims) : null,
        priceNode);
      return { id: tf.id, node: card, priceNode, box: newMoneyBox(priceNode) };
    }

    function paintCards(state) {
      const key = tariffs.map((x) => x.id).join(',') + '|' + getLang();
      if (key !== builtFor) {
        builtFor = key;
        for (const c of cardList) {
          c.box.stop();
          runningBoxes.delete(c.box);
        }
        cardList = tariffs.map(buildCard);
        cards.replaceChildren(...cardList.map((c) => c.node));
      }
      const waiting = state.priceState === 'wait' || state.priceState === 'idle';
      for (const c of cardList) {
        const on = c.id === state.tariffId;
        c.node.classList.toggle('is-on', on);
        c.node.setAttribute('aria-pressed', on ? 'true' : 'false');
        const v = state.prices[c.id];
        const known = typeof v === 'number';
        if (known) c.box.set(v);
        else c.box.clear(waiting ? '—' : t('common.error'));
        c.priceNode.classList.toggle('is-wait', !known && waiting);
        c.priceNode.classList.toggle('is-stale', known && state.priceState === 'wait');
      }
    }

    /* Строка маршрута: адреса, расстояние и честное время. Пересобираем её,
       только когда в ней правда что-то поменялось — иначе она мигала бы на
       каждый кадр пересчёта цены. */
    function paintRoute(state) {
      const pts = state.points.filter(Boolean);
      const first = pts[0];
      const last = pts[pts.length - 1];
      const r = state.route;
      const key = [
        (first && first.addr) || '', (last && last.addr) || '',
        r ? r.distance_m : '', r ? r.duration_s : '', r ? r.duration_traffic_s : '',
      ].join('|');
      if (key === routeKey) return;
      routeKey = key;

      routeRow.replaceChildren(
        el('span', { className: 'sg-route__line' },
          el('i', null), el('b', null), el('i', null)),
        el('span', { className: 'sg-route__text' },
          el('span', { className: 'sg-route__row' }, (first && first.addr) || t('order.from')),
          el('span', { className: 'sg-route__row' }, (last && last.addr) || t('order.to'))),
        r ? tripMeta(r) : el('span', { className: 'sg-opt__go', html: icon('go') }),
      );
    }

    /* Время показываем то, за которое реально доедут сейчас, и подписываем словом,
       почему оно больше свободного. Обещать двадцать минут в шесть вечера — враньё,
       за которое перед человеком отвечает курьер. */
    function tripMeta(r) {
      const free = Math.max(0, Number(r.duration_s) || 0);
      const jam = Math.max(free, Number(r.duration_traffic_s) || 0);
      const slower = jam - free >= JAM_STEP;
      return el('span', {
        className: 'sg-route__meta sgv-trip',
        title: slower ? t('trip.free_time', { v: duration(free) }) : null,
      },
        el('span', { className: 'sgv-trip__km' }, distText(r.distance_m)),
        el('span', { className: 'sgv-trip__time' }, duration(jam)),
        el('span', { className: 'sgv-trip__jam' + (slower ? '' : ' is-free') },
          slower ? t('trip.jam') : t('trip.free')));
    }

    function update(state) {
      paintRoute(state);
      paintCards(state);

      // Часть грузчиков у тарифа уже в цене — про них честно говорим отдельно.
      const tf = tariffById(state.tariffId);
      const free = tf ? Number(tf.loaders_included) || 0 : 0;
      if (state.loaders === 0) loadersSub.textContent = t('order.loaders_none');
      else if (free >= state.loaders) loadersSub.textContent = t('order.loaders_included', { n: state.loaders });
      else loadersSub.textContent = tp(state.loaders, 'common.n_loader');

      const chosen = extrasList(state);
      extrasSub.textContent = chosen.length
        ? chosen.map((x) => {
          const ex = app.extras.find((e) => e.code === x.code);
          return ex ? nameOf(ex) : x.code;
        }).join(', ')
        : t('order.extras_hint');

      const sum = total(state);
      const wait = state.priceState === 'wait';
      const bad = state.priceState === 'err';
      if (sum === null) priceMoney.clear(wait ? '' : '—');
      else priceMoney.set(sum);
      priceBox.classList.toggle('is-wait', sum === null && wait);
      priceBox.classList.toggle('is-stale', sum !== null && wait);
      note.textContent = bad ? errText(state.priceError) : t('order.price_note');
      note.classList.toggle('t-err', bad);
      retry.hidden = !bad;
      cta.disabled = sum === null || state.busy;
      app.panel.refresh();
    }

    return { name: 'tariff', node, update };
  }

  /* ── шаг «контакты» ──────────────────────────────────────────────────── */

  function stepConfirm() {
    const phone = field(t('order.phone'), contacts.phone, {
      type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxLength: 32,
      hint: t('order.phone_hint'), enterkeyhint: 'next',
    });
    const name = field(t('order.name'), contacts.name, {
      autocomplete: 'name', maxLength: 80, hint: t('order.name_ph'),
    });
    const comment = field(t('order.comment'), contacts.comment, {
      multiline: true, maxLength: 500, hint: t('order.comment_ph'),
    });

    phone.input.addEventListener('input', () => { contacts.phone = phone.input.value; refreshCta(); });
    name.input.addEventListener('input', () => { contacts.name = name.input.value; });
    comment.input.addEventListener('input', () => { contacts.comment = comment.input.value; });

    const agree = el('button', {
      type: 'button', className: 'sg-agree' + (contacts.agree ? ' is-on' : ''),
      'aria-pressed': contacts.agree ? 'true' : 'false',
      onClick: () => {
        contacts.agree = !contacts.agree;
        agree.classList.toggle('is-on', contacts.agree);
        agree.setAttribute('aria-pressed', contacts.agree ? 'true' : 'false');
        refreshCta();
        haptic();
      },
    },
      el('span', { className: 'sg-agree__box', html: icon('check') }),
      el('span', { className: 'grow' }, t('order.confirm_hint')));

    const priceBox = el('span', { className: 'sg-cta__price' }, '—');
    const priceMoney = newMoneyBox(priceBox);
    const cta = el('button', { type: 'button', className: 'sg-cta', onClick: () => submit(cta) },
      el('span', { className: 'sg-cta__label' }, t('order.confirm')), priceBox);

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        iconBtn('back', 'sg-back', t('common.back'), () => store.set({ step: 'tariff' })),
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('order.confirm')))),
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-fields' }, phone.node, name.node, comment.node, agree)),
      el('div', { className: 'sg-foot' }, cta),
    );

    function refreshCta() {
      const state = store.get();
      const sum = total(state);
      cta.disabled = state.busy || sum === null ||
        digits(contacts.phone).length < 9 || !contacts.agree;
    }

    function update(state) {
      const sum = total(state);
      const wait = state.priceState === 'wait';
      if (sum === null) priceMoney.clear(wait ? '' : '—');
      else priceMoney.set(sum);
      priceBox.classList.toggle('is-wait', sum === null && wait);
      priceBox.classList.toggle('is-stale', sum !== null && wait);
      refreshCta();
      app.panel.refresh();
    }

    return { name: 'confirm', node, update };
  }

  /* ── сборка ──────────────────────────────────────────────────────────── */

  const BUILD = { addr: stepAddr, tariff: stepTariff, confirm: stepConfirm };

  function render(state, back) {
    if (!view || view.name !== state.step) {
      stopBoxes();                       // счётчики прошлого шага уходят вместе с ним
      const next = (BUILD[state.step] || stepAddr)();
      next.update(state);
      app.panel.show(next.node, { back: !!back });
      view = next;
    } else {
      view.update(state);
    }
    syncMap(state);
  }

  store.on((state, prev) => {
    if (dead) return;
    render(state, state.step === 'addr' && prev.step !== 'addr');
  });

  /* Подставляем адрес подачи по геолокации: без разрешения ничего не спрашиваем
     повторно и молча остаёмся с пустым полем. */
  function guessOrigin() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (dead) return;
      const state = store.get();
      if (state.points[0]) return;             // человек успел ввести адрес сам
      const ll = [pos.coords.latitude, pos.coords.longitude];
      app.map.setView(ll, 16, { animate: true });
      try {
        const r = await api.post('/geo/reverse', { lat: ll[0], lng: ll[1] });
        if (dead || store.get().points[0]) return;
        const pts = store.get().points.slice();
        pts[0] = { addr: r.title || '', subtitle: r.subtitle || '', lat: ll[0], lng: ll[1] };
        store.set({ points: pts });
      } catch (e) {
        /* адрес не узнали — человек введёт его сам, это не повод шуметь */
      }
    }, () => {}, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  render(store.get(), false);
  guessOrigin();

  return {
    relang() {
      view = null;
      render(store.get(), false);
    },
    destroy() {
      dead = true;
      clearTimeout(quoteTimer);
      if (quoteCtrl) quoteCtrl.abort();
      stopBoxes();
      if (app.cancelPick) app.cancelPick();
    },
  };
}

export default mountOrder;
