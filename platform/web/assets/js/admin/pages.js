/* Разделы панели управления.

   Каждый раздел — функция render*(host, ctx), которая рисует себя в host
   и возвращает функцию уборки: снять подписки, погасить карту, остановить таймеры.
   Оболочка (app.js) вызывает уборку перед каждым переходом, поэтому ни один
   раздел не продолжает жить после того, как с него ушли.

   Общее правило вёрстки: на широком экране таблица, на телефоне те же строки
   превращаются в карточки (за это отвечает admin.css), а не в боковую прокрутку —
   возить таблицу пальцем невозможно.
*/

import { api, ApiError } from '../core/api.js';
import {
  el, toast, sheet, confirm as ask, skeleton, haptic, mountStars, photoViewer, copyText,
} from '../core/ui.js';
import {
  money, moneyShort, num, distance as fmtDistance, duration as fmtDuration,
  time as fmtTime, date as fmtDate, dateTime, timeAgo, phone as fmtPhone,
  plate as fmtPlate, initials,
} from '../core/fmt.js';
import { createMap, pin } from '../core/map.js';
import { getLang, extend } from '../core/i18n.js';
import {
  t, tp, createForm, quoteTariff, tiyinToSom, somToTiyin, commissionFor, errText, parseNum,
} from './forms.js';

/* ─────────────────────────────────────────────────────── мелочи */

const ORDER_STATUSES = ['draft', 'searching', 'assigned', 'to_pickup', 'at_pickup',
  'in_transit', 'at_dropoff', 'done', 'cancelled', 'expired'];
const LIVE_STATUSES = ['draft', 'searching', 'assigned', 'to_pickup', 'at_pickup',
  'in_transit', 'at_dropoff'];

const STATUS_KIND = {
  done: 'ok', cancelled: 'err', expired: 'err', searching: 'warn',
  assigned: 'info', to_pickup: 'info', at_pickup: 'info',
  in_transit: 'accent', at_dropoff: 'accent',
};

const PAY_KIND = { paid: 'ok', failed: 'err', pending: 'warn', refunded: 'info' };

const PERIODS = [
  ['today', 'common.today'], ['yesterday', 'common.yesterday'], ['week', 'common.week'],
  ['month', 'common.month'], ['year', 'adm.period_year'], ['all', 'adm.period_all'],
];

/** Название справочника на языке интерфейса, с откатом на русский. */
function localName(row, prefix) {
  if (!row) return '';
  const p = prefix || 'name';
  const ky = row[p + '_ky'];
  const ru = row[p + '_ru'];
  return (getLang() === 'ky' ? ky || ru : ru || ky) || '';
}

function statusBadge(status) {
  const kind = STATUS_KIND[status];
  return el('span', { className: 'badge' + (kind ? ' badge--' + kind : '') },
    t('status.' + (status || 'draft')));
}

function payBadge(status) {
  const s = status || 'none';
  const kind = PAY_KIND[s];
  return el('span', { className: 'badge' + (kind ? ' badge--' + kind : '') },
    t('status.pay_' + s));
}

function tile(label, value, hint) {
  return el('div', { className: 'tile' },
    el('div', { className: 'tile__cap' }, label),
    el('div', { className: 'tile__val num' }, value),
    hint ? el('div', { className: 'tile__hint' }, hint) : null);
}

function block(title, ...kids) {
  return el('section', { className: 'block' },
    title ? el('h2', { className: 'block__head' }, title) : null,
    ...kids);
}

/* Название раздела уже написано в шапке панели, поэтому на странице оно
   нужно только программе чтения с экрана — на узком экране это целая строка. */
function sectionTitle(text) {
  return el('h1', { className: 'sect__title sr-only' }, text);
}

function emptyBox(text) {
  return el('div', { className: 'empty' }, el('div', { className: 'empty__title' }, text));
}

function rowsSkeleton(host, rows) {
  skeleton(host, rows || 5);
}

/** Заголовок раздела: кнопка «назад», название и всё, что нужно справа. */
function pageHead(ctx, title, sub, right) {
  return el('div', { className: 'phead' },
    el('button', {
      className: 'btn btn--ghost btn--icon phead__back',
      type: 'button',
      'aria-label': t('common.back'),
      onClick: () => ctx.back(),
    }, el('span', { html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>' })),
    el('div', { className: 'grow truncate' },
      el('div', { className: 'phead__title truncate' }, title),
      sub ? el('div', { className: 'phead__sub truncate' }, sub) : null),
    right || null);
}

/**
 * Таблица, которая на телефоне рассыпается в карточки.
 * cols: [{key, label, cell(row) → строка или узел, num, wide, hide}]
 */
function dataTable(cols, rows, opts) {
  const o = opts || {};
  const head = el('thead', null, el('tr', null, ...cols.map((c) => el('th', {
    className: (c.num ? 'ta-r ' : '') + (c.hide ? 'tbl__hide' : ''),
  }, c.label))));

  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr', { className: 'tbl__row' + (o.onRow ? ' tbl__row--tap' : '') });
    for (const c of cols) {
      const value = c.cell ? c.cell(row) : row[c.key];
      const td = el('td', {
        className: (c.num ? 'ta-r ' : '') + (c.hide ? 'tbl__hide' : '') + (c.wide ? ' tbl__wide' : ''),
        dataset: { label: c.label },
      });
      if (value instanceof Node) td.appendChild(value);
      else td.textContent = value === null || value === undefined ? '—' : String(value);
      tr.appendChild(td);
    }
    if (o.onRow) {
      tr.tabIndex = 0;
      tr.setAttribute('role', 'link');
      tr.addEventListener('click', () => o.onRow(row));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          o.onRow(row);
        }
      });
    }
    body.appendChild(tr);
  }
  return el('div', { className: 'tbl-wrap' }, el('table', { className: 'tbl' }, head, body));
}

/** Постраничная навигация. Возвращает узел или null, если страница одна. */
function pager(info, onGo) {
  const pages = Math.max(1, info.pages || 1);
  const page = Math.min(Math.max(1, info.page || 1), pages);
  if (pages < 2) return null;
  const btn = (label, to, disabled) => el('button', {
    className: 'btn btn--ghost btn--sm', type: 'button', disabled: !!disabled,
    onClick: () => onGo(to),
  }, label);
  return el('div', { className: 'pager' },
    btn(t('common.back'), page - 1, page <= 1),
    el('span', { className: 'pager__now' }, t('adm.page_of', { n: page, m: pages })),
    btn(t('common.next'), page + 1, page >= pages));
}

/** Столбики: часы, дни — что угодно, где важна форма, а не точность до пикселя. */
function barChart(items, opts) {
  const o = opts || {};
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  const chart = el('div', { className: 'chart' + (o.dense ? ' chart--dense' : '') });
  for (const item of items) {
    const h = Math.round(((item.value || 0) / max) * 100);
    chart.appendChild(el('div', {
      className: 'chart__col', title: item.title || (item.label + ': ' + (item.value || 0)),
    },
      el('span', { className: 'chart__bar' + (item.value ? '' : ' is-zero') },
        el('span', { className: 'chart__fill', style: { height: Math.max(2, h) + '%' } })),
      el('span', { className: 'chart__x' }, item.label)));
  }
  return chart;
}

function listRow(kids, onTap) {
  const row = el('div', { className: 'list__row' + (onTap ? ' list__row--tap' : '') }, ...kids);
  if (onTap) {
    row.tabIndex = 0;
    row.setAttribute('role', 'link');
    row.addEventListener('click', onTap);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onTap(); }
    });
  }
  return row;
}

function avatarFor(name) {
  return el('span', { className: 'avatar avatar--sm' }, initials(name || '—'));
}

/** Короткая строка маршрута: откуда → куда. */
function routeLine(order) {
  const from = order.from_addr || '—';
  const to = order.to_addr || '—';
  const extra = order.stops ? ' +' + order.stops : '';
  return el('span', { className: 'route-line' },
    el('span', { className: 'truncate' }, from),
    el('span', { className: 'route-line__arrow' }, '→'),
    el('span', { className: 'truncate' }, to + extra));
}

function periodChips(current, onPick) {
  const box = el('div', { className: 'chips' });
  for (const [code, key] of PERIODS) {
    box.appendChild(el('button', {
      className: 'chip' + (code === current ? ' chip--on' : ''),
      type: 'button',
      onClick: () => { haptic(); onPick(code); },
    }, t(key)));
  }
  return box;
}

/* Дата из поля <input type="date"> — сервер принимает и такой вид. */
function dayInput(value, onChange, label) {
  const input = el('input', {
    className: 'field__input', type: 'date', value: value || '',
    onChange: () => onChange(input.value),
  });
  return el('label', { className: 'field field--fill filters__day' },
    input, el('span', { className: 'field__label' }, label));
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Сообщение об ошибке загрузки с кнопкой «повторить». */
function failBox(e, retry) {
  return el('div', { className: 'empty' },
    el('div', { className: 'empty__title' }, errText(e)),
    el('button', { className: 'btn btn--ghost', type: 'button', onClick: retry },
      t('common.retry')));
}

/* ═══════════════════════════════════════════════════════ обзор */

const ovState = { period: 'today' };

export function renderOverview(host, ctx) {
  let alive = true;
  let timer = 0;
  const body = el('div', { className: 'col gap-4' });
  const head = el('div', { className: 'toolbar' });
  host.replaceChildren(el('div', { className: 'sect' }, head, body));

  function paintHead() {
    head.replaceChildren(periodChips(ovState.period, (code) => {
      ovState.period = code;
      paintHead();
      load();
    }));
  }

  async function load() {
    rowsSkeleton(body, 6);
    try {
      const [stats, orders, online] = await Promise.all([
        api.get('/admin/stats', { period: ovState.period }),
        api.get('/admin/orders', { per_page: 8 }),
        api.get('/admin/couriers', { online: 1, per_page: 12 }),
      ]);
      if (!alive) return;
      paint(stats, orders, online);
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  function paint(stats, orders, online) {
    const m = stats.money || {};
    const o = stats.orders || {};
    const c = stats.couriers || {};
    const conv = stats.conversion || {};

    const tiles = el('div', { className: 'tiles' },
      tile(t('admin.ov_orders'), num(o.total || 0),
        t('admin.ov_done') + ': ' + num(o.done || 0) + ' · ' +
        t('admin.ov_cancelled') + ': ' + num(o.cancelled || 0)),
      tile(t('admin.ov_revenue'), money(m.revenue || 0),
        t('adm.ov_payout') + ': ' + money(m.payout || 0)),
      tile(t('admin.ov_commission'), money(m.commission || 0)),
      tile(t('admin.ov_avg'), money(m.avg_check || 0)),
      tile(t('admin.ov_online'), num(c.online || 0),
        t('admin.ov_busy') + ': ' + num(c.busy || 0) + ' · ' +
        t('admin.ov_free') + ': ' + num(Math.max(0, (c.online || 0) - (c.busy || 0)))),
      tile(t('adm.ov_conversion'), (conv.percent || 0).toString().replace('.', ',') + '%',
        t('adm.ov_conversion_hint')));

    const hours = (stats.by_hour || []).map((h) => ({
      label: String(h.hour).padStart(2, '0'),
      value: h.orders || 0,
      title: String(h.hour).padStart(2, '0') + ':00 — ' + tp(h.orders || 0, 'common.n_order'),
    }));
    const days = (stats.by_day || []).map((d) => ({
      label: (d.d || '').slice(8) || '—',
      value: d.n || 0,
      title: (d.d || '') + ' — ' + tp(d.n || 0, 'common.n_order') + ', ' + money(d.revenue || 0),
    }));

    const liveNow = el('div', { className: 'row gap-2 wrap' },
      el('span', { className: 'badge badge--accent' },
        t('adm.orders_live') + ': ' + num(o.live || 0)),
      el('span', { className: 'badge' },
        t('adm.ov_new_couriers') + ': ' + num(c.new || 0)),
      el('span', { className: 'badge' },
        t('admin.ov_new_clients') + ': ' + num((stats.clients || {}).new || 0)));

    // Колонка с адресами сюда не помещается: обзор стоит в половину экрана,
    // а маршрут целиком всё равно смотрят в карточке заказа.
    const lastOrders = (orders.items || []).length
      ? dataTable([
        { key: 'public_id', label: t('admin.col_id'), cell: (r) => el('b', { className: 'mono' }, r.public_id) },
        {
          key: 'created_at',
          label: t('admin.col_created'),
          cell: (r) => el('span', { title: dateTime(r.created_at) }, timeAgo(r.created_at)),
        },
        {
          key: 'client',
          label: t('admin.col_client'),
          cell: (r) => r.client_name || fmtPhone(r.client_phone) || '—',
          wide: true,
        },
        { key: 'price_total', label: t('admin.col_price'), num: true, cell: (r) => money(r.price_total) },
        { key: 'status', label: t('admin.col_status'), cell: (r) => statusBadge(r.status) },
      ], orders.items, { onRow: (r) => ctx.go('/orders/' + r.id) })
      : emptyBox(t('admin.orders_empty'));

    const onlineList = el('div', { className: 'list' });
    for (const cour of online.items || []) {
      onlineList.appendChild(listRow([
        avatarFor(cour.name),
        el('div', { className: 'grow truncate' },
          el('div', { className: 'truncate t-mid' }, cour.name || '—'),
          el('div', { className: 'muted t-sm truncate' },
            [cour.car_model, fmtPlate(cour.car_plate)].filter(Boolean).join(' · ') || '—')),
        el('span', { className: 'badge ' + (cour.busy ? 'badge--accent' : 'badge--ok') },
          cour.busy ? t('status.busy') : t('admin.ov_free')),
      ], () => ctx.go('/couriers/' + cour.id)));
    }
    if (!(online.items || []).length) onlineList.appendChild(emptyBox(t('adm.ov_nobody')));

    const top = (stats.couriers && stats.couriers.top) || [];
    const topList = top.length ? dataTable([
      { key: 'name', label: t('admin.col_courier'), cell: (r) => r.name || '—' },
      { key: 'n', label: t('admin.ov_orders'), num: true, cell: (r) => num(r.n) },
      { key: 'revenue', label: t('admin.ov_revenue'), num: true, cell: (r) => money(r.revenue) },
      { key: 'payout', label: t('adm.ov_payout'), num: true, cell: (r) => money(r.payout), hide: true },
    ], top, { onRow: (r) => ctx.go('/couriers/' + r.id) }) : emptyBox(t('common.empty'));

    const byTariff = (stats.by_tariff || []).filter((r) => r.tariff_id);
    const tariffList = byTariff.length ? dataTable([
      { key: 'name', label: t('admin.nav_tariffs'), cell: (r) => localName(r) || r.code || '—' },
      { key: 'n', label: t('admin.ov_orders'), num: true, cell: (r) => num(r.n) },
      { key: 'done', label: t('admin.ov_done'), num: true, cell: (r) => num(r.done), hide: true },
      { key: 'total', label: t('admin.ov_revenue'), num: true, cell: (r) => money(r.total) },
    ], byTariff) : emptyBox(t('adm.ov_empty_period'));

    body.replaceChildren(
      tiles,
      liveNow,
      block(t('admin.ov_chart'), hours.some((h) => h.value)
        ? barChart(hours, { dense: true })
        : emptyBox(t('adm.ov_empty_period'))),
      block(t('adm.ov_by_day'), days.length
        ? barChart(days, { dense: days.length > 14 })
        : emptyBox(t('adm.ov_empty_period'))),
      el('div', { className: 'two-col' },
        block(t('adm.ov_last'), lastOrders),
        block(t('admin.map_online'), onlineList)),
      el('div', { className: 'two-col' },
        block(t('adm.ov_top'), topList),
        block(t('adm.ov_by_tariff'), tariffList)));
  }

  // Живые события перерисовывают обзор не чаще раза в пять секунд: цифры важны,
  // но дёргать сервер на каждый шаг курьера незачем.
  const bump = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; if (alive) load(); }, 5000);
  };
  const un = ctx.onLive((name) => {
    if (name === 'order' || name === 'courier') bump();
  });

  paintHead();
  load();

  return () => {
    alive = false;
    clearTimeout(timer);
    un();
  };
}

/* ═══════════════════════════════════════════════════════ живая карта */

const CAR_STATE = { free: 'is-free', busy: 'is-busy', off: 'is-off' };

function courierState(c) {
  if (!c.online) return 'off';
  return c.busy ? 'busy' : 'free';
}

export function renderLive(host, ctx) {
  let alive = true;
  const roster = new Map();       // id курьера → всё, что о нём известно
  const marks = new Map();        // id курьера → маркер на карте
  const orderMarks = new Map();   // id заказа → маркер
  const state = { filter: 'all', orders: true };
  let cardFor = 0;

  const mapBox = el('div', { className: 'live__map' });
  const legend = el('div', { className: 'live__legend', 'aria-label': t('adm.map_legend') });
  const filters = el('div', { className: 'chips live__filters' });
  const wrap = el('div', { className: 'live' }, mapBox, filters, legend);
  host.replaceChildren(wrap);

  const mapCfg = (ctx.config && ctx.config.map) || {};
  const map = createMap(mapBox, {
    center: mapCfg.center || [42.8746, 74.5698],
    zoom: mapCfg.zoom || 12,
    max_zoom: mapCfg.max_zoom || 19,
    tiles_light: mapCfg.tiles_light,
    tiles_dark: mapCfg.tiles_dark,
    attribution: mapCfg.attribution,
    theme: ctx.theme(),
  });

  function visible(c) {
    if (state.filter === 'all') return true;
    return courierState(c) === state.filter;
  }

  function carHtml(c) {
    return '<span class="car ' + CAR_STATE[courierState(c)] + '">' + pin('car') + '</span>';
  }

  /* Одна машина на карте. Курьер без координат и курьер, отсеянный фильтром,
     с карты уходят, но из списка не пропадают — их считает легенда. */
  function putCourier(c) {
    if (!c || !c.id) return;
    const data = Object.assign({}, roster.get(c.id) || {}, c);
    roster.set(c.id, data);
    const at = data.at && data.at[0] !== null && data.at[0] !== undefined ? data.at : null;
    const marker = marks.get(c.id);
    if (!at || !visible(data)) {
      if (marker) { marker.remove(); marks.delete(c.id); }
      return;
    }
    if (marker) {
      marker.setHtml(carHtml(data));
      marker.moveTo(at, {
        duration: 900,
        heading: typeof data.heading === 'number' ? data.heading : undefined,
      });
      return;
    }
    const fresh = map.marker({
      at,
      html: carHtml(data),
      anchor: 'center',
      rotate: true,
      heading: typeof data.heading === 'number' ? data.heading : 0,
      interactive: true,
      zIndex: 20,
    });
    fresh.el.addEventListener('click', () => openCourier(data.id));
    fresh.el.title = data.name || '';
    marks.set(c.id, fresh);
  }

  function paintLegend() {
    const all = Array.from(roster.values());
    const free = all.filter((c) => courierState(c) === 'free').length;
    const busy = all.filter((c) => courierState(c) === 'busy').length;
    const off = all.filter((c) => courierState(c) === 'off').length;
    legend.replaceChildren(
      el('span', { className: 'legend__i' }, el('i', { className: 'dot dot--free' }),
        t('admin.ov_free') + ' · ' + free),
      el('span', { className: 'legend__i' }, el('i', { className: 'dot dot--busy' }),
        t('status.busy') + ' · ' + busy),
      el('span', { className: 'legend__i' }, el('i', { className: 'dot dot--off' }),
        t('status.offline') + ' · ' + off),
      el('span', { className: 'legend__i' }, el('i', { className: 'dot dot--order' }),
        t('admin.map_orders') + ' · ' + orderMarks.size));
    if (!roster.size) legend.appendChild(el('span', { className: 'muted' }, t('adm.map_empty')));
  }

  function paintFilters() {
    const items = [
      ['all', t('admin.orders_filter_all')],
      ['free', t('admin.ov_free')],
      ['busy', t('status.busy')],
      ['off', t('status.offline')],
    ];
    filters.replaceChildren(...items.map(([code, label]) => el('button', {
      className: 'chip' + (state.filter === code ? ' chip--on' : ''),
      type: 'button',
      onClick: () => { state.filter = code; paintFilters(); applyFilter(); },
    }, label)), el('button', {
      className: 'chip' + (state.orders ? ' chip--on' : ''),
      type: 'button',
      onClick: () => {
        state.orders = !state.orders;
        paintFilters();
        if (state.orders) loadOrders();
        else clearOrders();
      },
    }, t('admin.map_orders')));
  }

  /* Смена фильтра — это не повод идти на сервер: всё уже известно,
     достаточно заново решить, кого показывать. */
  function applyFilter() {
    for (const id of Array.from(roster.keys())) putCourier({ id });
    paintLegend();
  }

  function clearOrders() {
    for (const m of orderMarks.values()) m.remove();
    orderMarks.clear();
    paintLegend();
  }

  /* Заказ на карте — точка подачи. Координаты лежат в карточке заказа,
     поэтому живые заказы догружаем по одному, но не больше двух десятков:
     карта, забитая метками, перестаёт быть картой. */
  async function loadOrders() {
    try {
      const list = await api.get('/admin/orders', { status: 'live', per_page: 24 });
      if (!alive || !state.orders) return;
      const rows = list.items || [];
      const ids = new Set(rows.map((r) => r.id));
      // Карточки тянем разом, а не по очереди: два десятка последовательных
      // запросов складываются в заметную паузу перед первой меткой.
      const fresh = rows.filter((r) => !orderMarks.has(r.id));
      const cards = await Promise.all(fresh.map((r) => api.get('/admin/orders/' + r.id)
        .then((full) => ({ row: r, full }))
        .catch(() => null)));
      if (!alive || !state.orders) return;
      for (const item of cards) {
        if (!item) continue;
        const point = (item.full.points || [])[0];
        if (!point || point.lat === null || point.lat === undefined) continue;
        const marker = map.marker({
          at: [point.lat, point.lng],
          html: '<span class="order-pin">' + pin('a') + '</span>',
          anchor: 'bottom',
          interactive: true,
          zIndex: 10,
        });
        marker.el.addEventListener('click', () => ctx.go('/orders/' + item.row.id));
        marker.el.title = item.row.public_id + ' · ' + t('status.' + item.row.status);
        orderMarks.set(item.row.id, marker);
      }
      for (const [id, marker] of Array.from(orderMarks)) {
        if (!ids.has(id)) { marker.remove(); orderMarks.delete(id); }
      }
      paintLegend();
    } catch (e) {
      if (alive && !(e instanceof ApiError && e.isAuth)) {
        toast(errText(e), { type: 'err' });
      }
    }
  }

  async function reloadCouriers() {
    for (const m of marks.values()) m.remove();
    marks.clear();
    roster.clear();
    try {
      const list = await api.get('/admin/couriers', { per_page: 100 });
      if (!alive) return;
      for (const c of list.items || []) putCourier(c);
      const points = Array.from(roster.values())
        .filter((c) => marks.has(c.id)).map((c) => c.at).filter(Boolean);
      if (points.length > 1) map.fitPoints(points, { padding: { top: 40, right: 40, bottom: 80, left: 40 } });
      paintLegend();
    } catch (e) {
      if (alive && !(e instanceof ApiError && e.isAuth)) {
        toast(errText(e), { type: 'err' });
      }
    }
  }

  async function openCourier(id) {
    if (cardFor === id) return;
    cardFor = id;
    const data = roster.get(id) || null;
    const body = el('div', { className: 'col gap-3' });
    const panel = sheet({
      title: (data && data.name) || t('admin.nav_couriers'),
      content: body,
      actions: [
        { label: t('adm.open_card'), kind: 'primary', onClick: () => ctx.go('/couriers/' + id) },
        { label: t('common.close'), kind: 'ghost' },
      ],
      onClose: () => { cardFor = 0; },
    });
    rowsSkeleton(body, 4);
    try {
      const card = await api.get('/admin/couriers/' + id);
      body.replaceChildren(courierBrief(card));
    } catch (e) {
      body.replaceChildren(el('p', { className: 'muted' }, errText(e)));
    }
    return panel;
  }

  paintFilters();
  paintLegend();
  reloadCouriers();
  if (state.orders) loadOrders();

  let ordersTimer = 0;
  const bumpOrders = () => {
    if (ordersTimer || !state.orders) return;
    ordersTimer = setTimeout(() => { ordersTimer = 0; if (alive) loadOrders(); }, 4000);
  };

  const un = ctx.onLive((name, data) => {
    if (!alive || !data) return;
    if (name === 'geo' && data.courier_id) {
      const known = roster.has(data.courier_id);
      putCourier({
        id: data.courier_id,
        name: data.name,
        at: data.at,
        heading: data.heading,
        geo_at: data.geo_at,
        online: 1,
        busy: data.public_id ? 1 : 0,
      });
      if (!known) paintLegend();
      return;
    }
    if (name === 'courier' && data.id) {
      putCourier(Object.assign({}, data, { online: data.online ? 1 : 0, busy: data.busy ? 1 : 0 }));
      paintLegend();
      return;
    }
    if (name === 'order') bumpOrders();
  });

  return () => {
    alive = false;
    clearTimeout(ordersTimer);
    un();
    map.destroy();
  };
}

/** Короткая карточка курьера — её показывают и с карты, и из списка. */
function courierBrief(c) {
  const rating = c.rating ? String(c.rating).replace('.', ',') : '—';
  const stars = el('div');
  const box = el('div', { className: 'col gap-3' },
    el('div', { className: 'row gap-3' },
      el('span', { className: 'avatar avatar--lg' }, initials(c.name)),
      el('div', { className: 'grow' },
        el('div', { className: 'h2' }, c.name || '—'),
        el('div', { className: 'muted' }, fmtPhone(c.phone)),
        stars)),
    el('div', { className: 'kv' },
      kv(t('adm.cour_car'), [c.car_model, c.car_color].filter(Boolean).join(', ') || '—'),
      kv(t('courier.car_plate'), fmtPlate(c.car_plate) || '—'),
      kv(t('common.status'), t('status.user_' + (c.status || 'pending'))),
      kv(t('admin.ov_done'), num(c.orders_done || 0)),
      kv(t('adm.cour_acceptance'), c.acceptance === null || c.acceptance === undefined
        ? '—' : Math.round(c.acceptance * 100) + '%'),
      kv(t('admin.courier_priority'), String(c.priority || 0)),
      kv(t('admin.courier_last_seen'), c.geo_at ? timeAgo(c.geo_at) : t('adm.map_no_geo'))),
    c.note ? el('p', { className: 'note' }, c.note) : null);
  mountStars(stars, { value: Number(c.rating) || 0, readonly: true });
  if (rating !== '—') stars.appendChild(el('span', { className: 'muted t-sm' }, ' ' + rating));
  return box;
}

function kv(label, value) {
  return el('div', { className: 'kv__i' },
    el('span', { className: 'kv__k' }, label),
    value instanceof Node ? value : el('span', { className: 'kv__v' }, value));
}

/* ═══════════════════════════════════════════════════════ заказы */

const ordersState = { page: 1, status: '', q: '', from: '', to: '' };

export function renderOrders(host, ctx) {
  let alive = true;
  const body = el('div');
  const tools = el('div', { className: 'filters' });
  const totals = el('div', { className: 'row gap-2 wrap' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('admin.orders_title')), tools, totals, body));

  const search = el('input', {
    className: 'field__input', type: 'search', placeholder: ' ',
    value: ordersState.q,
  });
  const runSearch = debounce(() => {
    ordersState.q = search.value.trim();
    ordersState.page = 1;
    load();
  }, 400);
  search.addEventListener('input', runSearch);

  const status = el('select', { className: 'field__input' },
    el('option', { value: '' }, t('admin.orders_filter_all')),
    el('option', { value: 'live' }, t('adm.orders_live')),
    ...ORDER_STATUSES.map((s) => el('option', { value: s }, t('status.' + s))));
  status.value = ordersState.status;
  status.addEventListener('change', () => {
    ordersState.status = status.value;
    ordersState.page = 1;
    load();
  });

  tools.append(
    el('label', { className: 'field filters__search' },
      search, el('span', { className: 'field__label' }, t('admin.orders_search_ph'))),
    el('label', { className: 'field field--sel field--fill filters__status' },
      status, el('span', { className: 'field__label' }, t('admin.orders_filter_status'))),
    dayInput(ordersState.from, (v) => { ordersState.from = v; ordersState.page = 1; load(); },
      t('admin.orders_from')),
    dayInput(ordersState.to, (v) => { ordersState.to = v; ordersState.page = 1; load(); },
      t('admin.orders_to')),
    el('button', {
      className: 'btn btn--ghost btn--sm', type: 'button',
      onClick: () => {
        ordersState.q = '';
        ordersState.status = '';
        ordersState.from = '';
        ordersState.to = '';
        ordersState.page = 1;
        search.value = '';
        status.value = '';
        for (const day of tools.querySelectorAll('input[type="date"]')) day.value = '';
        load();
      },
    }, t('adm.reset_filters')));

  async function load() {
    rowsSkeleton(body, 8);
    try {
      const data = await api.get('/admin/orders', {
        page: ordersState.page,
        status: ordersState.status || null,
        q: ordersState.q || null,
        from: ordersState.from || null,
        to: ordersState.to || null,
      });
      if (!alive) return;
      const sums = data.totals || {};
      totals.replaceChildren(
        el('span', { className: 'badge' }, t('adm.rows_total', { n: num(data.total || 0) })),
        el('span', { className: 'badge badge--ok' },
          t('admin.ov_revenue') + ': ' + money(sums.revenue || 0)),
        el('span', { className: 'badge badge--accent' },
          t('admin.ov_commission') + ': ' + money(sums.commission || 0)));

      if (!(data.items || []).length) {
        body.replaceChildren(emptyBox(t('admin.orders_empty')));
        return;
      }
      const table = dataTable([
        { key: 'public_id', label: t('admin.col_id'), cell: (r) => el('b', { className: 'mono' }, r.public_id) },
        {
          key: 'created_at',
          label: t('admin.col_created'),
          cell: (r) => el('span', { title: dateTime(r.created_at) }, timeAgo(r.created_at)),
        },
        {
          key: 'client',
          label: t('admin.col_client'),
          cell: (r) => el('span', { className: 'truncate' },
            r.client_name || fmtPhone(r.client_phone) || '—'),
        },
        {
          key: 'courier',
          label: t('admin.col_courier'),
          cell: (r) => r.courier_name || '—',
          hide: true,
        },
        { key: 'route', label: t('admin.col_route'), cell: routeLine, wide: true },
        { key: 'price_total', label: t('admin.col_price'), num: true, cell: (r) => money(r.price_total) },
        { key: 'status', label: t('admin.col_status'), cell: (r) => statusBadge(r.status) },
        { key: 'payment', label: t('admin.col_payment'), cell: (r) => payBadge(r.payment_status), hide: true },
      ], data.items, { onRow: (r) => ctx.go('/orders/' + r.id) });

      const foot = pager(data, (page) => { ordersState.page = page; load(); });
      body.replaceChildren(table, foot || el('span'));
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  // Первая страница живёт своей жизнью: новые заказы должны появляться сами.
  let timer = 0;
  const bump = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; if (alive) load(); }, 4000);
  };

  load();
  const un = ctx.onLive((name) => {
    if (name === 'order' && ordersState.page === 1) bump();
  });

  return () => {
    alive = false;
    clearTimeout(timer);
    un();
  };
}

/* ── карточка заказа ───────────────────────────────────────────────────── */

const EVENT_TEXT = {
  created: 'adm.ev_created',
  search_started: 'adm.ev_search_started',
  dispatch_round: 'adm.ev_dispatch_round',
  offer_sent: 'adm.ev_offer_sent',
  offer_declined: 'adm.ev_offer_declined',
  offer_expired: 'adm.ev_offer_expired',
  assigned: 'adm.ev_assigned',
  unassigned: 'adm.ev_unassigned',
  status: 'adm.ev_status',
  waiting_start: 'adm.ev_waiting_start',
  waiting_stop: 'adm.ev_waiting_stop',
  done: 'adm.ev_done',
  cancelled: 'adm.ev_cancelled',
  search_expired: 'adm.ev_search_expired',
  search_cancelled: 'adm.ev_search_cancelled',
  search_restart: 'adm.ev_search_restart',
  payment_started: 'adm.ev_payment_started',
  payment_paid: 'adm.ev_payment_paid',
  payment_failed: 'adm.ev_payment_failed',
  payment_pending: 'adm.ev_payment_pending',
  payment_reset: 'adm.ev_payment_reset',
  payment_offline: 'adm.ev_payment_offline',
  comment: 'adm.ev_comment',
  rated: 'adm.ev_rated',
  client: 'adm.ev_client',
  system: 'adm.ev_system',
};

function actorName(actor) {
  const who = String(actor || '').split(':')[0];
  if (who === 'admin') return t('adm.actor_admin');
  if (who === 'client') return t('adm.actor_client');
  if (who === 'courier') return t('adm.actor_courier');
  return t('adm.actor_system');
}

/* Причины, которые сервер присылает кодом, а не текстом. */
const REASON_TEXT = {
  no_couriers: 'err.no_couriers',
  timeout: 'adm.reason_timeout',
  rounds: 'adm.reason_rounds',
  order_expired: 'status.expired',
  order_taken: 'err.order_gone',
};

/* Подробности события: только то, что оператору правда пригодится. */
function eventDetail(ev) {
  const d = ev.data;
  if (!d || typeof d !== 'object') return '';
  const bits = [];
  if (d.status) bits.push(t('status.' + d.status));
  if (d.reason) {
    const known = REASON_TEXT[String(d.reason)];
    bits.push(known ? t(known) : String(d.reason));
  }
  if (d.text) bits.push(String(d.text));
  if (d.courier_id) bits.push('#' + d.courier_id);
  if (d.round) bits.push(t('admin.disp_rounds') + ': ' + d.round);
  if (d.rating) bits.push(d.rating + '/5');
  if (d.amount) bits.push(money(d.amount));
  return bits.join(' · ');
}

export function renderOrder(host, ctx, id) {
  let alive = true;
  let map = null;
  let order = null;
  const body = el('div', { className: 'sect' });
  host.replaceChildren(body);
  rowsSkeleton(body, 8);

  async function load() {
    try {
      const data = await api.get('/admin/orders/' + id);
      if (!alive) return;
      order = data;
      paint();
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  async function patch(payload) {
    try {
      const res = await api.patch('/admin/orders/' + id, payload);
      if (!alive) return null;
      order = res.order || order;
      toast(t('admin.order_saved'), { type: 'ok' });
      paint();
      return res;
    } catch (e) {
      toast(errText(e), { type: 'err' });
      return null;
    }
  }

  async function pickCourier() {
    const list = el('div', { className: 'list' });
    const panel = sheet({ title: t('adm.order_pick_courier'), content: list });
    rowsSkeleton(list, 5);
    try {
      const data = await api.get('/admin/couriers', { status: 'active', per_page: 60 });
      const free = (data.items || []).filter((c) => !c.busy);
      if (!free.length) {
        list.replaceChildren(emptyBox(t('adm.order_no_couriers')));
        return;
      }
      list.replaceChildren(...free.map((c) => listRow([
        avatarFor(c.name),
        el('div', { className: 'grow truncate' },
          el('div', { className: 'truncate t-mid' }, c.name || '—'),
          el('div', { className: 'muted t-sm truncate' },
            [c.car_model, fmtPlate(c.car_plate)].filter(Boolean).join(' · '))),
        el('span', { className: 'badge ' + (c.online ? 'badge--ok' : '') },
          c.online ? t('status.online') : t('status.offline')),
      ], () => {
        panel.close();
        patch({ courier_id: c.id });
      })));
    } catch (e) {
      list.replaceChildren(el('p', { className: 'muted' }, errText(e)));
    }
  }

  async function cancelOrder() {
    const input = el('textarea', {
      className: 'field__input', placeholder: ' ', rows: 3, maxLength: 300,
    });
    sheet({
      title: t('admin.order_cancel'),
      content: el('label', { className: 'field' },
        input, el('span', { className: 'field__label' }, t('admin.order_cancel_reason'))),
      actions: [
        { label: t('common.cancel'), kind: 'ghost' },
        {
          label: t('admin.order_cancel'),
          kind: 'danger',
          onClick: () => {
            const reason = input.value.trim();
            // Причину сохраняем комментарием к заказу: так она останется
            // в карточке и в ленте событий, а не только в голове оператора.
            return patch(reason ? { comment: reason, status: 'cancelled' } : { status: 'cancelled' });
          },
        },
      ],
    });
  }

  function statusSheet() {
    const list = el('div', { className: 'list' });
    const panel = sheet({ title: t('adm.order_status_set'), content: list });
    for (const s of ORDER_STATUSES) {
      if (s === order.status) continue;
      list.appendChild(listRow([
        el('div', { className: 'grow' }, t('status.' + s)),
        statusBadge(s),
      ], async () => {
        panel.close();
        if (s === 'cancelled') { cancelOrder(); return; }
        await patch({ status: s });
      }));
    }
  }

  function paint() {
    const o = order;
    const points = o.points || [];
    const mapBox = el('div', { className: 'order__map' });

    const price = el('div', { className: 'kv' });
    for (const line of o.breakdown || []) {
      const title = getLang() === 'ky' ? (line.title_ky || line.title_ru) : (line.title_ru || line.title_ky);
      const qty = line.qty && line.qty !== 1
        ? ' × ' + String(line.qty).replace('.', ',') +
          (getLang() === 'ky' ? (line.unit_ky ? ' ' + line.unit_ky : '') : (line.unit_ru ? ' ' + line.unit_ru : ''))
        : '';
      price.appendChild(kv(title + qty, money(line.sum)));
    }
    price.appendChild(el('div', { className: 'kv__i kv__i--total' },
      el('span', { className: 'kv__k' }, t('common.total')),
      el('span', { className: 'kv__v num' }, money(o.price_total))));
    price.appendChild(kv(t('admin.ov_commission'), money(o.commission || 0)));
    price.appendChild(kv(t('adm.order_payout'), money(o.courier_payout || 0)));

    const addr = el('div', { className: 'list' });
    points.forEach((p, i) => {
      addr.appendChild(listRow([
        el('span', { className: 'point__no' }, i === 0 ? 'A' : String.fromCharCode(65 + i)),
        el('div', { className: 'grow' },
          el('div', { className: 't-mid' }, p.addr || '—'),
          el('div', { className: 'muted t-sm' }, [
            p.entrance ? t('order.entrance') + ' ' + p.entrance : '',
            p.flat ? t('order.flat') + ' ' + p.flat : '',
            p.floor ? tp(p.floor, 'common.n_floor') : '',
            p.intercom || '',
            p.comment || '',
          ].filter(Boolean).join(' · ')),
          p.phone ? el('a', { className: 'link t-sm', href: 'tel:' + p.phone }, fmtPhone(p.phone)) : null),
      ]));
    });

    const people = el('div', { className: 'two-col' },
      block(t('admin.col_client'), o.client ? el('div', { className: 'list' }, listRow([
        avatarFor(o.client.name),
        el('div', { className: 'grow truncate' },
          el('div', { className: 't-mid truncate' }, o.client.name || '—'),
          el('div', { className: 'muted t-sm' }, fmtPhone(o.client.phone))),
        el('span', { className: 'badge' }, tp(o.client.orders_count || 0, 'common.n_order')),
      ], () => ctx.go('/clients', { q: o.client.phone || '' }))) : emptyBox('—')),
      block(t('admin.col_courier'), o.courier ? el('div', { className: 'list' }, listRow([
        avatarFor(o.courier.name),
        el('div', { className: 'grow truncate' },
          el('div', { className: 't-mid truncate' }, o.courier.name || '—'),
          el('div', { className: 'muted t-sm truncate' },
            [o.courier.car && o.courier.car.model, fmtPlate(o.courier.car && o.courier.car.plate)]
              .filter(Boolean).join(' · '))),
        el('span', { className: 'badge' }, String(o.courier.rating || '—').replace('.', ',')),
      ], () => ctx.go('/couriers/' + o.courier.id)) ) : emptyBox(t('common.empty'))));

    const timeline = el('ol', { className: 'tl' });
    for (const ev of o.events || []) {
      const key = EVENT_TEXT[ev.type];
      const detail = eventDetail(ev);
      timeline.appendChild(el('li', { className: 'tl__i' },
        el('span', { className: 'tl__time num' }, fmtTime(ev.at)),
        el('div', { className: 'grow' },
          el('div', { className: 't-mid' }, key ? t(key) : ev.type),
          el('div', { className: 'muted t-sm' },
            [actorName(ev.actor), detail].filter(Boolean).join(' · ')))));
    }
    if (!(o.events || []).length) timeline.appendChild(emptyBox(t('common.empty')));

    const offers = (o.offers || []).length ? dataTable([
      { key: 'courier_name', label: t('admin.col_courier'), cell: (r) => r.courier_name || ('#' + r.courier_id) },
      { key: 'sent_at', label: t('admin.col_created'), cell: (r) => fmtTime(r.sent_at) },
      { key: 'distance_m', label: t('adm.order_distance'), num: true, cell: (r) => fmtDistance(r.distance_m) },
      {
        key: 'status',
        label: t('common.status'),
        cell: (r) => el('span', { className: 'badge' }, t('status.offer_' + r.status)),
      },
    ], o.offers) : null;

    const live = LIVE_STATUSES.includes(o.status);
    const actions = el('div', { className: 'row gap-2 wrap' },
      live ? el('button', {
        className: 'btn btn--primary btn--sm', type: 'button', onClick: pickCourier,
      }, o.courier_id ? t('admin.order_reassign') : t('admin.order_assign')) : null,
      o.status === 'draft' || o.status === 'expired' || o.status === 'searching' ? el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => patch({ status: 'searching' }),
      }, t('admin.order_restart')) : null,
      el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button', onClick: statusSheet,
      }, t('adm.order_status_set')),
      o.payment_status === 'paid' ? el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => patch({ payment: 'pending' }),
      }, t('adm.order_unmark_paid')) : el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => patch({ payment: 'paid' }),
      }, t('adm.order_mark_paid')),
      live ? el('button', {
        className: 'btn btn--danger btn--sm', type: 'button', onClick: cancelOrder,
      }, t('admin.order_cancel')) : null);

    const note = el('div', { className: 'col gap-2' },
      el('label', { className: 'field' },
        el('textarea', {
          className: 'field__input', placeholder: ' ', rows: 2, maxLength: 500,
          value: o.comment || '', id: 'order-note',
        }),
        el('span', { className: 'field__label' }, t('common.comment'))),
      el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => {
          const field = note.querySelector('#order-note');
          patch({ comment: field.value.trim() });
        },
      }, t('common.save')));

    body.replaceChildren(
      pageHead(ctx, t('admin.order_card', { id: o.public_id }),
        dateTime(o.created_at), statusBadge(o.status)),
      el('div', { className: 'tiles tiles--sm' },
        tile(t('admin.col_price'), money(o.price_total)),
        tile(t('adm.order_distance'), fmtDistance(o.distance_m || 0)),
        tile(t('adm.order_duration'), fmtDuration(o.duration_s || 0)),
        tile(t('admin.col_payment'), t('status.pay_' + (o.payment_status || 'none')),
          o.paid_amount ? money(o.paid_amount) : '')),
      points.length ? block(null, mapBox) : null,
      el('div', { className: 'two-col' },
        block(t('admin.order_price'), price),
        block(t('admin.order_points'), addr)),
      block(t('adm.order_actions'), actions, note),
      people,
      o.track_url ? block(t('adm.order_track'), el('div', { className: 'row gap-2 wrap' },
        el('a', { className: 'link truncate', href: o.track_url, target: '_blank', rel: 'noopener' },
          o.track_url),
        el('button', {
          className: 'btn btn--ghost btn--sm', type: 'button',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(o.track_url);
              toast(t('common.copied'), { type: 'ok' });
            } catch (e) {
              toast(t('err.unknown'), { type: 'err' });
            }
          },
        }, t('common.copy')))) : null,
      offers ? block(t('adm.order_offers'), offers) : null,
      block(t('admin.order_timeline'), timeline),
      (o.client_rating || o.courier_rating) ? block(t('admin.order_rating'), el('div', { className: 'kv' },
        o.client_rating ? kv(t('admin.col_client'), o.client_rating + '/5 ' + (o.client_comment || '')) : null,
        o.courier_rating ? kv(t('admin.col_courier'), o.courier_rating + '/5 ' + (o.courier_comment || '')) : null)) : null);

    if (points.length) {
      if (map) map.destroy();
      const cfg = (ctx.config && ctx.config.map) || {};
      map = createMap(mapBox, {
        center: [points[0].lat, points[0].lng],
        zoom: cfg.zoom || 13,
        tiles_light: cfg.tiles_light,
        tiles_dark: cfg.tiles_dark,
        attribution: cfg.attribution,
        max_zoom: cfg.max_zoom || 19,
        theme: ctx.theme(),
      });
      const coords = (o.route || []).length > 1
        ? o.route
        : points.map((p) => [p.lat, p.lng]);
      map.route(coords, { width: 5 });
      points.forEach((p, i) => {
        map.marker({
          at: [p.lat, p.lng],
          html: pin(i === 0 ? 'a' : 'b', i === 0 ? '' : String(i)),
          anchor: 'bottom',
        });
      });
      map.fitPoints(points.map((p) => [p.lat, p.lng]),
        { padding: { top: 40, right: 40, bottom: 40, left: 40 } });
    }
  }

  load();
  const un = ctx.onLive((name, data) => {
    if (!alive || name !== 'order' || !data) return;
    if (data.id === Number(id) || (order && data.public_id === order.public_id)) load();
  });

  return () => {
    alive = false;
    un();
    if (map) map.destroy();
  };
}

/* ═══════════════════════════════════════════════════════ курьеры */

const couriersState = { page: 1, status: '', q: '', online: false };

export function renderCouriers(host, ctx) {
  let alive = true;
  const body = el('div');
  const tools = el('div', { className: 'filters' });
  const counts = el('div', { className: 'chips' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('admin.couriers_title')), tools, counts, body));

  const search = el('input', {
    className: 'field__input', type: 'search', placeholder: ' ', value: couriersState.q,
  });
  search.addEventListener('input', debounce(() => {
    couriersState.q = search.value.trim();
    couriersState.page = 1;
    load();
  }, 400));
  tools.append(el('label', { className: 'field filters__search' },
    search, el('span', { className: 'field__label' }, t('admin.couriers_search_ph'))));

  function paintCounts(data) {
    const c = data.counts || {};
    const items = [
      ['', t('admin.orders_filter_all'), data.total],
      ['pending', t('admin.couriers_pending'), c.pending],
      ['active', t('admin.couriers_active'), c.active],
      ['blocked', t('admin.couriers_blocked'), c.blocked],
    ];
    counts.replaceChildren(...items.map(([code, label, n]) => el('button', {
      className: 'chip' + (couriersState.status === code && !couriersState.online ? ' chip--on' : ''),
      type: 'button',
      onClick: () => {
        couriersState.status = code;
        couriersState.online = false;
        couriersState.page = 1;
        load();
      },
    }, label + (n === undefined ? '' : ' · ' + n))), el('button', {
      className: 'chip' + (couriersState.online ? ' chip--on' : ''),
      type: 'button',
      onClick: () => {
        couriersState.online = !couriersState.online;
        couriersState.page = 1;
        load();
      },
    }, t('status.online') + ' · ' + (c.online || 0)));
  }

  async function load() {
    rowsSkeleton(body, 6);
    try {
      const data = await api.get('/admin/couriers', {
        page: couriersState.page,
        status: couriersState.status || null,
        q: couriersState.q || null,
        online: couriersState.online ? 1 : null,
      });
      if (!alive) return;
      paintCounts(data);
      if (!(data.items || []).length) {
        body.replaceChildren(emptyBox(t('common.nothing_found')));
        return;
      }
      const table = dataTable([
        {
          key: 'name',
          label: t('common.name'),
          cell: (r) => el('div', { className: 'row gap-2' }, avatarFor(r.name),
            el('span', { className: 'truncate' }, r.name || '—')),
        },
        { key: 'phone', label: t('common.phone'), cell: (r) => fmtPhone(r.phone), hide: true },
        {
          key: 'car',
          label: t('adm.cour_car'),
          cell: (r) => [r.car_model, fmtPlate(r.car_plate)].filter(Boolean).join(' · ') || '—',
          wide: true,
        },
        {
          key: 'rating',
          label: t('adm.cour_acceptance'),
          num: true,
          cell: (r) => String(r.rating || '—').replace('.', ',') +
            (r.acceptance === null || r.acceptance === undefined ? '' : ' · ' + Math.round(r.acceptance * 100) + '%'),
        },
        { key: 'orders_done', label: t('admin.ov_done'), num: true, cell: (r) => num(r.orders_done || 0) },
        {
          key: 'status',
          label: t('common.status'),
          cell: (r) => el('span', {
            className: 'badge badge--' + (r.status === 'active' ? 'ok' : r.status === 'blocked' ? 'err' : 'warn'),
          }, t('status.user_' + r.status)),
        },
        {
          key: 'online',
          label: t('status.online'),
          cell: (r) => el('span', { className: 'badge ' + (r.online ? 'badge--ok' : '') },
            r.online ? (r.busy ? t('status.busy') : t('admin.ov_free')) : t('status.offline')),
        },
      ], data.items, { onRow: (r) => ctx.go('/couriers/' + r.id) });
      const foot = pager(data, (page) => { couriersState.page = page; load(); });
      body.replaceChildren(table, foot || el('span'));
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  load();
  return () => { alive = false; };
}

export function renderCourier(host, ctx, id) {
  let alive = true;
  let form = null;
  const body = el('div', { className: 'sect' });
  host.replaceChildren(body);
  rowsSkeleton(body, 8);

  async function load() {
    try {
      const data = await api.get('/admin/couriers/' + id);
      if (!alive) return;
      paint(data);
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  async function patch(payload, silent) {
    const res = await api.patch('/admin/couriers/' + id, payload);
    if (!alive) return res;
    if (!silent) toast(t('admin.courier_saved'), { type: 'ok' });
    // Ответ на PATCH — только профиль, без истории и денег, поэтому карточку
    // перечитываем целиком: иначе половина экрана опустеет.
    await load();
    return res;
  }

  async function blockCourier() {
    const input = el('textarea', { className: 'field__input', placeholder: ' ', rows: 3, maxLength: 300 });
    sheet({
      title: t('admin.courier_block'),
      content: el('div', { className: 'col gap-2' },
        el('label', { className: 'field' }, input,
          el('span', { className: 'field__label' }, t('adm.cour_block_reason')),
          el('span', { className: 'field__hint' }, t('adm.cour_block_hint')))),
      actions: [
        { label: t('common.cancel'), kind: 'ghost' },
        {
          label: t('admin.courier_block'),
          kind: 'danger',
          onClick: () => patch({ status: 'blocked', reason: input.value.trim() }),
        },
      ],
    });
  }

  function priorityHint(value, weight) {
    const base = value < 0 ? t('adm.prio_low') : value > 0 ? t('adm.prio_high') : t('adm.prio_zero');
    return base + '. ' + t('adm.prio_weight', { n: weight });
  }

  function paint(c) {
    if (form) form.destroy();
    const weight = ctx.setting('dispatch.w_priority', 15);
    const money_ = c.money || {};

    form = createForm({
      fields: [
        {
          name: 'priority', kind: 'range', label: 'admin.courier_priority',
          min: -50, max: 50, step: 1, hintText: priorityHint(c.priority || 0, weight), span: 2,
        },
        { name: 'note', kind: 'textarea', label: 'admin.courier_note', span: 2, maxlength: 1000 },
      ],
      values: { priority: c.priority || 0, note: c.note || '' },
      onChange: (values, name) => {
        if (name !== 'priority') return;
        const cell = form.field('priority');
        if (cell) cell.hint.textContent = priorityHint(values.priority, weight);
      },
      onSubmit: async (values, changed) => {
        if (!Object.keys(changed).length) {
          toast(t('adm.nothing_changed'), { type: 'info' });
          return false;
        }
        await patch(changed, true);
        toast(t('admin.courier_saved'), { type: 'ok' });
        return true;
      },
    });

    const actions = el('div', { className: 'row gap-2 wrap' },
      c.status !== 'active' ? el('button', {
        className: 'btn btn--primary btn--sm', type: 'button',
        onClick: async () => {
          try { await patch({ status: 'active' }); } catch (e) { toast(errText(e), { type: 'err' }); }
        },
      }, c.status === 'blocked' ? t('admin.courier_unblock') : t('admin.courier_approve')) : null,
      c.status !== 'blocked' ? el('button', {
        className: 'btn btn--danger btn--sm', type: 'button', onClick: blockCourier,
      }, t('admin.courier_block')) : null,
      c.at ? el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button', onClick: () => ctx.go('/map'),
      }, t('admin.courier_on_map')) : null);

    const orders = (c.orders || []).length ? dataTable([
      { key: 'public_id', label: t('admin.col_id'), cell: (r) => el('b', { className: 'mono' }, r.public_id) },
      { key: 'created_at', label: t('admin.col_created'), cell: (r) => timeAgo(r.created_at) },
      { key: 'route', label: t('admin.col_route'), cell: routeLine, wide: true },
      { key: 'price', label: t('adm.order_payout'), num: true, cell: (r) => money(r.courier_payout || 0) },
      { key: 'status', label: t('admin.col_status'), cell: (r) => statusBadge(r.status) },
    ], c.orders, { onRow: (r) => ctx.go('/orders/' + r.id) }) : emptyBox(t('common.empty'));

    body.replaceChildren(
      pageHead(ctx, c.name || '—', fmtPhone(c.phone),
        el('span', {
          className: 'badge badge--' + (c.status === 'active' ? 'ok' : c.status === 'blocked' ? 'err' : 'warn'),
        }, t('status.user_' + c.status))),
      el('div', { className: 'two-col' },
        block(t('admin.courier_stats'), courierBrief(c)),
        block(t('adm.cour_money'), el('div', { className: 'kv' },
          kv(t('admin.ov_revenue'), money(money_.revenue || 0)),
          kv(t('adm.cour_earned'), money(money_.payout || 0)),
          kv(t('admin.ov_commission'), money(money_.commission || 0)),
          kv(t('admin.courier_offers'), num(c.offers_sent || 0)),
          kv(t('admin.courier_taken'), num(c.offers_taken || 0)),
          kv(t('admin.ov_cancelled'), num(c.orders_cancelled || 0)),
          kv(t('common.email'), c.email || '—')))),
      block(t('adm.order_actions'), actions),
      block(t('admin.courier_priority'), form.el),
      block(t('adm.cour_history'), orders));
  }

  load();
  return () => {
    alive = false;
    if (form) form.destroy();
  };
}

/* ═══════════════════════════════════════════════════════ клиенты */

const clientsState = { page: 1, q: '', blocked: false };

export function renderClients(host, ctx, query) {
  let alive = true;
  if (query && query.q !== undefined) {
    clientsState.q = query.q;
    clientsState.page = 1;
  }
  const body = el('div');
  const tools = el('div', { className: 'filters' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('admin.clients_title')), tools, body));

  const search = el('input', {
    className: 'field__input', type: 'search', placeholder: ' ', value: clientsState.q,
  });
  search.addEventListener('input', debounce(() => {
    clientsState.q = search.value.trim();
    clientsState.page = 1;
    load();
  }, 400));

  tools.append(
    el('label', { className: 'field filters__search' },
      search, el('span', { className: 'field__label' }, t('admin.clients_search_ph'))),
    el('button', {
      className: 'chip' + (clientsState.blocked ? ' chip--on' : ''),
      type: 'button',
      onClick: (e) => {
        clientsState.blocked = !clientsState.blocked;
        clientsState.page = 1;
        e.currentTarget.classList.toggle('chip--on', clientsState.blocked);
        load();
      },
    }, t('admin.client_blocked')));

  async function openClient(row) {
    const box = el('div', { className: 'col gap-3' });
    const panel = sheet({ title: row.name || fmtPhone(row.phone), content: box });
    rowsSkeleton(box, 5);
    try {
      const c = await api.get('/admin/clients/' + row.id);
      const m = c.money || {};
      const orders = (c.orders || []).length ? dataTable([
        { key: 'public_id', label: t('admin.col_id'), cell: (r) => el('b', { className: 'mono' }, r.public_id) },
        { key: 'created_at', label: t('admin.col_created'), cell: (r) => timeAgo(r.created_at) },
        { key: 'price_total', label: t('admin.col_price'), num: true, cell: (r) => money(r.price_total) },
        { key: 'status', label: t('admin.col_status'), cell: (r) => statusBadge(r.status) },
      ], c.orders, {
        onRow: (r) => { panel.close(); ctx.go('/orders/' + r.id); },
      }) : emptyBox(t('common.empty'));

      const toggle = el('button', {
        className: 'btn btn--' + (c.blocked ? 'ghost' : 'danger') + ' btn--sm',
        type: 'button',
        onClick: async () => {
          try {
            await api.patch('/admin/clients/' + c.id, { blocked: c.blocked ? 0 : 1 });
            toast(t('common.saved'), { type: 'ok' });
            panel.close();
            load();
          } catch (e) {
            toast(errText(e), { type: 'err' });
          }
        },
      }, c.blocked ? t('admin.client_unblock') : t('admin.client_block'));

      box.replaceChildren(
        el('div', { className: 'kv' },
          kv(t('common.phone'), fmtPhone(c.phone)),
          kv(t('admin.client_orders'), num(c.orders_count || 0)),
          kv(t('adm.cli_spent'), money(m.spent || 0)),
          kv(t('admin.client_last'), c.last_order_at ? timeAgo(c.last_order_at) : '—'),
          kv(t('common.language'), c.lang === 'ky' ? t('common.lang_ky') : t('common.lang_ru')),
          kv(t('adm.cli_since_label'), c.created_at ? fmtDate(c.created_at) : '—')),
        el('div', { className: 'row gap-2' }, toggle),
        block(t('adm.cli_orders'), orders));
    } catch (e) {
      box.replaceChildren(el('p', { className: 'muted' }, errText(e)));
    }
  }

  async function load() {
    rowsSkeleton(body, 6);
    try {
      const data = await api.get('/admin/clients', {
        page: clientsState.page,
        q: clientsState.q || null,
        blocked: clientsState.blocked ? 1 : null,
      });
      if (!alive) return;
      if (!(data.items || []).length) {
        body.replaceChildren(emptyBox(t('common.nothing_found')));
        return;
      }
      const table = dataTable([
        {
          key: 'name',
          label: t('common.name'),
          cell: (r) => el('div', { className: 'row gap-2' }, avatarFor(r.name || r.phone),
            el('span', { className: 'truncate' }, r.name || '—')),
        },
        { key: 'phone', label: t('common.phone'), cell: (r) => fmtPhone(r.phone) },
        { key: 'orders_count', label: t('admin.client_orders'), num: true, cell: (r) => num(r.orders_count || 0) },
        {
          key: 'last_order_at',
          label: t('admin.client_last'),
          cell: (r) => (r.last_order_at ? timeAgo(r.last_order_at) : '—'),
          hide: true,
        },
        {
          key: 'rating',
          label: t('admin.order_rating'),
          num: true,
          cell: (r) => (r.rating ? String(r.rating).replace('.', ',') : '—'),
          hide: true,
        },
        {
          key: 'blocked',
          label: t('common.status'),
          cell: (r) => el('span', { className: 'badge ' + (r.blocked ? 'badge--err' : 'badge--ok') },
            r.blocked ? t('admin.client_blocked') : t('status.user_active')),
        },
      ], data.items, { onRow: openClient });
      const foot = pager(data, (page) => { clientsState.page = page; load(); });
      body.replaceChildren(table, foot || el('span'));
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  load();
  return () => { alive = false; };
}

/* ═══════════════════════════════════════════════════════ тарифы */

const TARIFF_FIELDS = [
  { name: 'code', kind: 'text', label: 'admin.tariff_code', required: true, maxlength: 32, group: 'admin.tariffs_title' },
  { name: 'name_ru', kind: 'text', label: 'admin.tariff_name_ru', required: true },
  { name: 'name_ky', kind: 'text', label: 'admin.tariff_name_ky', required: true },
  { name: 'desc_ru', kind: 'textarea', label: 'admin.tariff_desc_ru', rows: 2, maxlength: 200 },
  { name: 'desc_ky', kind: 'textarea', label: 'admin.tariff_desc_ky', rows: 2, maxlength: 200 },
  { name: 'vehicle_class', kind: 'text', label: 'admin.tariff_class', maxlength: 32 },
  { name: 'icon', kind: 'text', label: 'admin.tariff_icon', maxlength: 32 },
  { name: 'base_price', kind: 'money', label: 'admin.tariff_base', min: 0, required: true, group: 'admin.order_price' },
  { name: 'min_price', kind: 'money', label: 'admin.tariff_min', min: 0 },
  { name: 'included_km', kind: 'number', label: 'admin.tariff_included_km', min: 0, max: 500 },
  { name: 'included_min', kind: 'number', label: 'admin.tariff_included_min', min: 0, max: 1440 },
  { name: 'per_km', kind: 'money', label: 'admin.tariff_per_km', min: 0 },
  { name: 'per_min', kind: 'money', label: 'admin.tariff_per_min', min: 0 },
  { name: 'waiting_free_min', kind: 'number', label: 'admin.tariff_wait_free', min: 0, max: 240 },
  { name: 'waiting_per_min', kind: 'money', label: 'admin.tariff_wait_min', min: 0 },
  { name: 'loaders_included', kind: 'number', label: 'admin.tariff_loaders_inc', min: 0, max: 8, group: 'adm.group_loaders' },
  { name: 'loader_hour_price', kind: 'money', label: 'admin.tariff_loader_price', min: 0 },
  { name: 'loader_min_hours', kind: 'number', label: 'admin.tariff_loader_hours', min: 0, max: 24 },
  { name: 'body_d', kind: 'number', label: 'courier.body_d', min: 0, max: 2000, group: 'admin.tariff_body' },
  { name: 'body_w', kind: 'number', label: 'courier.body_w', min: 0, max: 2000 },
  { name: 'body_h', kind: 'number', label: 'courier.body_h', min: 0, max: 2000 },
  { name: 'capacity_kg', kind: 'number', label: 'admin.tariff_capacity', min: 0, max: 50000 },
  { name: 'sort', kind: 'number', label: 'admin.tariff_sort', min: 0, max: 999, group: 'adm.group_list' },
  { name: 'active', kind: 'switch', label: 'admin.tariff_active', span: 2 },
];

const NEW_TARIFF = {
  code: '', name_ru: '', name_ky: '', desc_ru: '', desc_ky: '',
  vehicle_class: 'van', icon: 'van',
  base_price: 0, min_price: 0, included_km: 0, included_min: 0,
  per_km: 0, per_min: 0, waiting_free_min: 10, waiting_per_min: 0,
  loaders_included: 0, loader_hour_price: 0, loader_min_hours: 1,
  body_d: 0, body_w: 0, body_h: 0, capacity_kg: 0, sort: 10, active: true,
};

/* Живой калькулятор рядом с формой тарифа: считает то же, что и сервер,
   но по значениям, которые сейчас в полях, — ошибку видно до сохранения. */
function priceCheck(ctx, getTariff) {
  const out = el('div', { className: 'calc__out' });
  const state = { km: 12, min: 25, wait: 0, loaders: 0 };

  function numField(label, key, max) {
    const input = el('input', {
      className: 'field__input', type: 'text', inputMode: 'decimal',
      placeholder: ' ', value: String(state[key]),
    });
    input.addEventListener('input', () => {
      const v = parseNum(input.value);
      state[key] = v === null || Number.isNaN(v) ? 0 : Math.min(Math.max(v, 0), max);
      paint();
    });
    return el('label', { className: 'field form__f' }, input,
      el('span', { className: 'field__label' }, label));
  }

  function paint() {
    const tariff = getTariff();
    const env = {
      commission: {
        kind: ctx.setting('commission.kind', 'percent'),
        value: ctx.setting('commission.value', 0),
        min: ctx.setting('commission.min', 0),
        max: ctx.setting('commission.max', 0),
      },
      min_price: ctx.setting('order.min_price', 0),
      waiting_free_min: ctx.setting('order.waiting_free_min', 10),
    };
    const r = quoteTariff(tariff, {
      distance_m: Math.round(state.km * 1000),
      duration_s: Math.round(state.min * 60),
      waiting_s: Math.round(state.wait * 60),
      loaders: state.loaders,
    }, env);

    const rows = el('div', { className: 'kv' },
      kv(t('admin.tariff_base'), money(r.base)),
      r.distance ? kv(t('adm.order_distance') + ' · ' +
        String(r.billable_km).replace('.', ',') + ' ' + t('common.km'), money(r.distance)) : null,
      r.time ? kv(t('adm.order_duration') + ' · ' + tp(r.billable_min, 'common.n_min'), money(r.time)) : null,
      r.loaders ? kv(tp(r.paid_loaders, 'common.n_loader'), money(r.loaders)) : null,
      r.waiting ? kv(t('adm.order_waiting'), money(r.waiting)) : null,
      r.min_extra ? kv(t('adm.calc_min_hit'), money(r.min_extra)) : null);

    out.replaceChildren(rows,
      el('div', { className: 'calc__total' },
        el('span', null, t('common.total')),
        el('b', { className: 'num' }, money(r.total))),
      el('div', { className: 'row between muted t-sm' },
        el('span', null, t('admin.ov_commission')), el('span', { className: 'num' }, money(r.commission))),
      el('div', { className: 'row between muted t-sm' },
        el('span', null, t('adm.order_payout')), el('span', { className: 'num' }, money(r.payout))));
  }

  const box = el('aside', { className: 'calc' },
    el('h3', { className: 'calc__head' }, t('adm.calc_title')),
    el('div', { className: 'calc__grid' },
      numField(t('adm.calc_km'), 'km', 400),
      numField(t('adm.calc_min'), 'min', 1440),
      numField(t('adm.calc_wait'), 'wait', 600),
      numField(t('adm.calc_loaders'), 'loaders', 8)),
    out,
    el('p', { className: 'calc__hint' }, t('adm.calc_hint')));
  paint();
  return { el: box, refresh: paint };
}

export function renderTariffs(host, ctx) {
  return catalogPage(host, ctx, {
    title: 'admin.tariffs_title',
    addLabel: 'admin.tariff_new',
    path: '/admin/tariffs',
    empty: 'adm.pick_tariff',
    fields: TARIFF_FIELDS,
    blank: NEW_TARIFF,
    deleteAsk: 'admin.tariff_delete',
    listRow(row) {
      return [
        el('div', { className: 'grow truncate' },
          el('div', { className: 't-mid truncate' }, localName(row) || row.code),
          el('div', { className: 'muted t-sm truncate' },
            money(row.base_price) + ' · ' + row.code)),
        row.orders_count ? el('span', {
          className: 'badge', title: t('adm.tariff_orders'),
        }, num(row.orders_count)) : null,
        el('span', { className: 'badge ' + (row.active ? 'badge--ok' : '') },
          row.active ? t('status.user_active') : t('common.hide')),
      ].filter(Boolean);
    },
    toForm(row) {
      const out = {};
      for (const f of TARIFF_FIELDS) {
        out[f.name] = f.kind === 'switch' ? !!row[f.name] : row[f.name];
      }
      return out;
    },
    aside(ctx2, form, row) {
      const check = priceCheck(ctx2, () => Object.assign({}, row, form.values()));
      return check;
    },
  });
}

/* ═══════════════════════════════════════════════════════ допуслуги */

const EXTRA_FIELDS = [
  { name: 'code', kind: 'text', label: 'admin.tariff_code', required: true, maxlength: 32, group: 'admin.extras_title' },
  { name: 'name_ru', kind: 'text', label: 'admin.tariff_name_ru', required: true },
  { name: 'name_ky', kind: 'text', label: 'admin.tariff_name_ky', required: true },
  {
    name: 'kind', kind: 'select', label: 'admin.extra_kind', options: [
      { value: 'fixed', label: 'admin.extra_kind_fixed' },
      { value: 'hourly', label: 'admin.extra_kind_hourly' },
      { value: 'per_unit', label: 'admin.extra_kind_unit' },
      { value: 'per_floor', label: 'admin.extra_kind_floor' },
    ],
  },
  { name: 'price', kind: 'money', label: 'admin.extra_price', min: 0, required: true },
  { name: 'unit_ru', kind: 'text', label: 'admin.extra_unit_ru', maxlength: 32 },
  { name: 'unit_ky', kind: 'text', label: 'admin.extra_unit_ky', maxlength: 32 },
  { name: 'min_qty', kind: 'number', label: 'admin.extra_min', min: 0, max: 1000, group: 'adm.group_list' },
  { name: 'max_qty', kind: 'number', label: 'admin.extra_max', min: 0, max: 1000 },
  { name: 'step', kind: 'number', label: 'admin.extra_step', min: 0.1, max: 100 },
  { name: 'sort', kind: 'number', label: 'admin.tariff_sort', min: 0, max: 999 },
  { name: 'tariff_ids', kind: 'chips', label: 'admin.extra_tariffs', hint: 'admin.extra_tariffs_all', span: 2 },
  { name: 'active', kind: 'switch', label: 'admin.tariff_active', span: 2 },
];

const NEW_EXTRA = {
  code: '', name_ru: '', name_ky: '', kind: 'fixed', price: 0,
  unit_ru: '', unit_ky: '', min_qty: 1, max_qty: 20, step: 1, sort: 10,
  tariff_ids: [], active: true,
};

export function renderExtras(host, ctx) {
  return catalogPage(host, ctx, {
    title: 'admin.extras_title',
    addLabel: 'admin.extra_new',
    path: '/admin/extras',
    empty: 'adm.pick_extra',
    fields: EXTRA_FIELDS,
    blank: NEW_EXTRA,
    deleteAsk: 'admin.extra_delete',
    async prepare() {
      // Список тарифов нужен для выбора «к каким тарифам применяется».
      const data = await api.get('/admin/tariffs');
      const options = (data.items || []).map((row) => ({
        value: row.id, text: localName(row) || row.code,
      }));
      const field = EXTRA_FIELDS.find((f) => f.name === 'tariff_ids');
      field.options = options;
    },
    listRow(row) {
      return [
        el('div', { className: 'grow truncate' },
          el('div', { className: 't-mid truncate' }, localName(row) || row.code),
          el('div', { className: 'muted t-sm truncate' },
            money(row.price) + ' · ' + t('admin.extra_kind_' +
              (row.kind === 'per_unit' ? 'unit' : row.kind === 'per_floor' ? 'floor' : row.kind)))),
        el('span', { className: 'badge ' + (row.active ? 'badge--ok' : '') },
          row.active ? t('status.user_active') : t('common.hide')),
      ];
    },
    toForm(row) {
      const out = {};
      for (const f of EXTRA_FIELDS) {
        if (f.kind === 'switch') out[f.name] = !!row[f.name];
        else if (f.kind === 'chips') out[f.name] = Array.isArray(row[f.name]) ? row[f.name] : [];
        else out[f.name] = row[f.name];
      }
      return out;
    },
  });
}

/* ── общий каркас справочника: список слева, форма справа ──────────────── */

function catalogPage(host, ctx, spec) {
  let alive = true;
  let form = null;
  let aside = null;
  let items = [];
  let current = null;      // редактируемая запись или null

  const listBox = el('div', { className: 'list catalog__list' });
  const editBox = el('div', { className: 'catalog__edit' });
  const wrap = el('div', { className: 'sect' },
    el('div', { className: 'row between gap-2' },
      sectionTitle(t(spec.title)),
      el('button', {
        className: 'btn btn--primary btn--sm', type: 'button',
        onClick: () => openEditor(null),
      }, t(spec.addLabel))),
    el('div', { className: 'catalog' }, listBox, editBox));
  host.replaceChildren(wrap);

  function paintList() {
    listBox.replaceChildren(...items.map((row) => {
      const node = listRow(spec.listRow(row), () => openEditor(row));
      if (current && current.id === row.id) node.classList.add('is-on');
      return node;
    }));
    if (!items.length) listBox.appendChild(emptyBox(t('common.empty')));
  }

  function closeEditor() {
    if (form) { form.destroy(); form = null; }
    aside = null;
    current = null;
    editBox.replaceChildren(emptyBox(t(spec.empty)));
    wrap.classList.remove('is-editing');
    paintList();
  }

  async function save(values) {
    const payload = {};
    for (const f of spec.fields) {
      let v = values[f.name];
      if (f.kind === 'switch') v = v ? 1 : 0;
      if (f.kind === 'number' && v === null) v = 0;
      if (f.kind === 'money' && v === null) v = 0;
      payload[f.name] = v;
    }
    const saved = current && current.id
      ? await api.patch(spec.path + '/' + current.id, payload)
      : await api.post(spec.path, payload);
    toast(t('common.saved'), { type: 'ok' });
    await reload();
    if (!alive) return true;
    // Сервер мог подправить значения (обрезать минус, выключить тариф) —
    // открываем форму заново на том, что реально лежит в базе.
    openEditor(items.find((r) => r.id === saved.id) || saved);
    return true;
  }

  async function remove() {
    const ok = await ask({
      title: t(spec.deleteAsk),
      text: current ? (localName(current) || current.code) : '',
      ok: t('common.delete'),
      cancel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.del(spec.path + '/' + current.id);
      toast(res.message || t('common.deleted'), { type: res.deactivated ? 'warn' : 'ok' });
      await reload();
      closeEditor();
    } catch (e) {
      toast(errText(e), { type: 'err' });
    }
  }

  function openEditor(row) {
    if (form) form.destroy();
    current = row ? Object.assign({}, row) : null;
    const values = row ? spec.toForm(row) : Object.assign({}, spec.blank);

    form = createForm({
      fields: spec.fields,
      values,
      submit: 'common.save',
      onChange: () => { if (aside) aside.refresh(); },
      onSubmit: (vals) => save(vals),
      extra: [
        row ? { label: 'common.delete', kind: 'danger', onClick: remove } : null,
        { label: 'adm.back_to_list', kind: 'ghost', onClick: () => closeEditor() },
      ].filter(Boolean),
    });

    aside = spec.aside ? spec.aside(ctx, form, row || spec.blank) : null;
    editBox.replaceChildren(el('div', { className: 'catalog__form' }, form.el),
      aside ? aside.el : null);
    wrap.classList.add('is-editing');
    paintList();
    editBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function reload() {
    const data = await api.get(spec.path);
    if (!alive) return;
    items = data.items || [];
  }

  async function boot() {
    rowsSkeleton(listBox, 5);
    editBox.replaceChildren(emptyBox(t(spec.empty)));
    try {
      if (spec.prepare) await spec.prepare();
      await reload();
      if (!alive) return;
      paintList();
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      listBox.replaceChildren(failBox(e, boot));
    }
  }

  boot();
  return () => {
    alive = false;
    if (form) form.destroy();
  };
}

/* ═══════════════════════════════════════════════════════ настройки */

const SECRET_KEYS = ['payment.secret', 'smtp.pass', 'geo.key', 'map.key'];

const TABS = [
  { code: 'service', label: 'admin.set_service' },
  { code: 'commission', label: 'admin.pay_commission' },
  { code: 'dispatch', label: 'admin.disp_title' },
  { code: 'map', label: 'admin.map_title' },
  { code: 'route', label: 'adm.set_router' },
  { code: 'payment', label: 'admin.pay_title' },
  { code: 'mail', label: 'admin.mail_title' },
  { code: 'security', label: 'admin.set_security' },
];

function choiceOptions(choices, key, labels) {
  return (choices[key] || []).map((code) => ({
    value: code,
    text: (labels && labels[code]) || code,
  }));
}

/* Описание вкладки: какие ключи настроек показываем и как. */
function tabFields(code, data, pick) {
  const choices = data.choices || {};
  const meta = data.meta || {};
  const money0 = { kind: 'money', min: 0 };

  if (code === 'service') {
    return [
      { name: 'service.name', kind: 'text', label: 'admin.set_name', required: true, group: 'admin.set_service' },
      { name: 'service.phone', kind: 'text', label: 'admin.set_phone' },
      { name: 'service.city', kind: 'text', label: 'admin.set_city' },
      {
        name: 'service.currency', kind: 'select', label: 'adm.currency',
        options: choiceOptions(choices, 'service.currency'),
      },
      { name: 'service.tz', kind: 'text', label: 'admin.set_tz', hint: 'adm.tz_hint' },
      { name: 'service.support_wa', kind: 'text', label: 'adm.wa' },
      {
        name: 'service.base_url', kind: 'text', label: 'adm.set_base_url',
        hint: 'adm.set_base_url_hint', span: 2, maxlength: 200,
      },
      Object.assign({ name: 'order.min_price', label: 'admin.set_min_price', group: 'admin.set_orders' }, money0),
      { name: 'order.search_timeout_s', kind: 'number', label: 'admin.set_search_timeout', min: 30, max: 3600 },
      { name: 'order.cancel_free_s', kind: 'number', label: 'admin.set_cancel_free', min: 0, max: 3600 },
      { name: 'order.max_points', kind: 'number', label: 'admin.set_max_points', min: 2, max: 10 },
      { name: 'order.waiting_free_min', kind: 'number', label: 'admin.tariff_wait_free', min: 0, max: 240, fallback: 10 },
      { name: 'order.allow_scheduled', kind: 'switch', label: 'adm.allow_scheduled', span: 2 },
    ];
  }

  if (code === 'dispatch') {
    return [
      {
        name: 'dispatch.mode', kind: 'select', label: 'admin.disp_mode', span: 2,
        options: choiceOptions(choices, 'dispatch.mode', {
          nearest: t('admin.disp_mode_nearest'),
          score: t('admin.disp_mode_score'),
          broadcast: t('admin.disp_mode_broadcast'),
        }),
        hint: 'admin.disp_hint',
        group: 'admin.disp_title',
      },
      { name: 'dispatch.radius_m', kind: 'number', label: 'admin.disp_radius', min: 300, max: 100000 },
      { name: 'dispatch.offer_ttl_s', kind: 'number', label: 'admin.disp_ttl', min: 5, max: 120 },
      { name: 'dispatch.batch', kind: 'number', label: 'admin.disp_batch', min: 1, max: 50 },
      { name: 'dispatch.max_rounds', kind: 'number', label: 'admin.disp_rounds', min: 1, max: 50 },
      { name: 'dispatch.min_rating', kind: 'number', label: 'admin.disp_min_rating', min: 0, max: 5 },
      { name: 'dispatch.new_courier_boost', kind: 'range', label: 'admin.disp_boost', min: 0, max: 100 },
      { name: 'dispatch.w_distance', kind: 'range', label: 'admin.disp_w_distance', min: 0, max: 100, group: 'adm.group_weights' },
      { name: 'dispatch.w_rating', kind: 'range', label: 'admin.disp_w_rating', min: 0, max: 100 },
      { name: 'dispatch.w_priority', kind: 'range', label: 'admin.disp_w_priority', min: 0, max: 100 },
      { name: 'dispatch.w_acceptance', kind: 'range', label: 'admin.disp_w_acceptance', min: 0, max: 100 },
    ];
  }

  if (code === 'map') {
    return [
      {
        name: 'map.provider', kind: 'select', label: 'admin.map_provider',
        options: choiceOptions(choices, 'map.provider'), group: 'admin.map_title',
      },
      { name: 'map.zoom', kind: 'number', label: 'admin.map_zoom', min: 1, max: 21 },
      { name: 'map.tiles_light', kind: 'text', label: 'admin.map_tiles_light', span: 2, maxlength: 300 },
      { name: 'map.tiles_dark', kind: 'text', label: 'admin.map_tiles_dark', span: 2, maxlength: 300 },
      { name: 'map.attribution', kind: 'text', label: 'admin.map_attribution', span: 2, maxlength: 200 },
      { name: 'map.center_lat', kind: 'number', label: 'adm.center_lat', min: -90, max: 90 },
      { name: 'map.center_lng', kind: 'number', label: 'adm.center_lng', min: -180, max: 180 },
      { name: 'map.max_zoom', kind: 'number', label: 'adm.max_zoom', min: 1, max: 22 },
      {
        name: 'map.key', kind: 'password', label: 'admin.map_key',
        hintText: (data.secrets || {})['map.key'] ? t('adm.secret_saved') : t('adm.secret_empty'),
      },
      {
        name: 'geo.provider', kind: 'select', label: 'admin.set_geo_provider',
        options: choiceOptions(choices, 'geo.provider'), group: 'admin.set_geo',
      },
      { name: 'geo.country', kind: 'text', label: 'adm.geo_country', maxlength: 8 },
      { name: 'geo.bbox', kind: 'text', label: 'admin.set_geo_bbox', span: 2, maxlength: 120 },
      {
        name: 'geo.key', kind: 'password', label: 'admin.map_key',
        hintText: (data.secrets || {})['geo.key'] ? t('adm.secret_saved') : t('adm.secret_empty'),
      },
    ];
  }

  if (code === 'route') {
    return [
      {
        name: 'route.provider', kind: 'select', label: 'admin.set_route_provider',
        options: choiceOptions(choices, 'route.provider'), group: 'adm.set_router',
      },
      { name: 'route.url', kind: 'text', label: 'admin.set_route_url', span: 2, maxlength: 200 },
      { name: 'route.road_factor', kind: 'number', label: 'admin.set_road_factor', min: 1, max: 3 },
      { name: 'route.avg_speed_kmh', kind: 'number', label: 'adm.route_speed', min: 5, max: 120 },
    ];
  }

  if (code === 'payment') {
    const providers = meta.payment_providers || [];
    return [
      { name: 'payment.enabled', kind: 'switch', label: 'admin.pay_enabled', span: 2, group: 'admin.pay_title' },
      {
        name: 'payment.provider', kind: 'select', label: 'admin.pay_provider', span: 2,
        options: providers.map((p) => ({
          value: p.code, text: p.title + (p.ready ? '' : ' · ' + t('adm.secret_empty')),
        })),
      },
      { name: 'payment.merchant_id', kind: 'text', label: 'admin.pay_merchant' },
      {
        name: 'payment.secret', kind: 'password', label: 'admin.pay_secret',
        hintText: (data.secrets || {})['payment.secret'] ? t('adm.secret_saved') : t('adm.secret_empty'),
      },
      { name: 'payment.lifetime_s', kind: 'number', label: 'adm.pay_lifetime', min: 300, max: 86400, fallback: 1800 },
      { name: 'payment.test_mode', kind: 'switch', label: 'admin.pay_test' },
      { name: 'payment.prepay_commission', kind: 'switch', label: 'admin.pay_prepay', span: 2 },
    ];
  }

  if (code === 'mail') {
    return [
      { name: 'mail.enabled', kind: 'switch', label: 'admin.mail_enabled', span: 2, group: 'admin.mail_title' },
      { name: 'smtp.host', kind: 'text', label: 'admin.mail_host' },
      { name: 'smtp.port', kind: 'number', label: 'admin.mail_port', min: 1, max: 65535 },
      {
        name: 'smtp.secure', kind: 'select', label: 'admin.mail_secure',
        options: choiceOptions(choices, 'smtp.secure', { none: t('adm.smtp_none'), ssl: 'SSL', tls: 'STARTTLS' }),
      },
      { name: 'smtp.user', kind: 'text', label: 'admin.mail_user', maxlength: 120 },
      {
        name: 'smtp.pass', kind: 'password', label: 'admin.mail_pass',
        hintText: (data.secrets || {})['smtp.pass'] ? t('adm.secret_saved') : t('adm.secret_empty'),
      },
      { name: 'smtp.from', kind: 'email', label: 'admin.mail_from' },
      { name: 'smtp.from_name', kind: 'text', label: 'admin.mail_from_name' },
    ];
  }

  if (code === 'security') {
    return [
      { name: 'security.allow_registration', kind: 'switch', label: 'admin.set_allow_reg', span: 2, group: 'admin.set_security' },
      { name: 'security.require_moderation', kind: 'switch', label: 'admin.set_moderation', span: 2 },
      { name: 'security.session_days', kind: 'number', label: 'adm.session_days', min: 1, max: 365 },
    ];
  }

  // комиссия: размер поля зависит от того, проценты это или сумма
  const kind = (pick && pick.commissionKind) || data.values['commission.kind'];
  return [
    {
      name: 'commission.kind', kind: 'select', label: 'admin.pay_commission', span: 2,
      options: [
        { value: 'percent', label: 'admin.pay_kind_percent' },
        { value: 'fixed', label: 'admin.pay_kind_fixed' },
      ],
      group: 'admin.pay_commission',
    },
    kind !== 'fixed'
      ? { name: 'commission.value', kind: 'number', label: 'admin.pay_value', min: 0, max: 100, required: true }
      : { name: 'commission.value', kind: 'money', label: 'admin.pay_value', min: 0, required: true },
    { name: 'commission.min', kind: 'money', label: 'admin.pay_min', min: 0 },
    { name: 'commission.max', kind: 'money', label: 'admin.pay_max', min: 0 },
  ];
}

export function renderSettings(host, ctx) {
  let alive = true;
  let form = null;
  let data = null;
  let tab = 'service';
  // Выбранный, но ещё не сохранённый вид комиссии: от него зависит, чем
  // считается поле «размер» — процентами или сомами.
  let commissionKind = null;

  const tabsBox = el('div', { className: 'chips tabs' });
  const body = el('div', { className: 'col gap-4' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('admin.set_title')), tabsBox, body));

  function paintTabs() {
    tabsBox.replaceChildren(...TABS.map((item) => el('button', {
      className: 'chip' + (item.code === tab ? ' chip--on' : ''),
      type: 'button',
      onClick: async () => {
        if (item.code === tab) return;
        if (form && form.dirty() && !(await ctx.guard())) return;
        tab = item.code;
        paintTabs();
        paintTab();
      },
    }, t(item.label))));
  }

  /* Веса диспетчеризации: показываем не голое число, а долю в общей оценке —
     иначе «50» ни о чём не говорит. */
  function weightHints() {
    if (tab !== 'dispatch' || !form) return;
    const names = ['dispatch.w_distance', 'dispatch.w_rating',
      'dispatch.w_priority', 'dispatch.w_acceptance'];
    const values = form.values();
    const sum = names.reduce((acc, n) => acc + (Number(values[n]) || 0), 0);
    for (const n of names) {
      const cell = form.field(n);
      if (!cell) continue;
      cell.hint.textContent = sum > 0
        ? t('adm.disp_share', { n: Math.round(((Number(values[n]) || 0) / sum) * 100) })
        : t('adm.disp_share_none');
      if (!cell.hint.isConnected) cell.wrap.appendChild(cell.hint);
    }
  }

  async function save(values, changed) {
    const patch = {};
    for (const [key, value] of Object.entries(changed)) {
      if (SECRET_KEYS.includes(key) && !value) continue;   // пустой секрет значит «не трогать»
      patch[key] = value === null ? 0 : value;
    }
    if (!Object.keys(patch).length) {
      toast(t('adm.nothing_changed'), { type: 'info' });
      return false;
    }
    data = await api.put('/admin/settings', { values: patch });
    toast(t('admin.set_saved'), { type: 'ok' });
    commissionKind = null;
    ctx.settingsChanged(data.values);
    paintTab();
    return true;
  }

  function paintTab() {
    if (form) { form.destroy(); form = null; }
    const fields = tabFields(tab, data, { commissionKind }).map((f) => {
      const limits = (data.limits || {})[f.name];
      if (limits && f.kind === 'money') {
        return Object.assign({
          min: limits[0], max: limits[1],
          minText: tiyinToSom(limits[0]), maxText: tiyinToSom(limits[1]),
        }, f);
      }
      return f;
    });
    const values = {};
    for (const f of fields) {
      const raw = data.values[f.name];
      if (f.kind === 'switch') {
        values[f.name] = !!raw;
      } else if (raw === undefined || raw === null || raw === '') {
        // Ключа ещё нет в базе — показываем то значение, по которому сервис
        // работает на самом деле, а не пустоту.
        values[f.name] = f.fallback === undefined ? '' : f.fallback;
      } else {
        values[f.name] = raw;
      }
    }
    // «Было» всегда берём с сервера: показанное значение может отличаться,
    // если вид комиссии только что переключили и поле очистили.
    const wasOnServer = {};
    if (commissionKind) {
      values['commission.kind'] = commissionKind;
      values['commission.value'] = '';
      wasOnServer['commission.kind'] = data.values['commission.kind'];
      wasOnServer['commission.value'] = data.values['commission.value'];
    }

    form = createForm({
      fields,
      values,
      base: wasOnServer,
      submit: 'common.save',
      onChange: (vals, name) => {
        weightHints();
        // Смена вида комиссии меняет смысл поля: проценты и сомы — разные вещи,
        // поэтому размер приходится задать заново.
        if (name === 'commission.kind') {
          commissionKind = vals['commission.kind'];
          paintTab();
        }
      },
      onSubmit: save,
    });

    body.replaceChildren(form.el);
    weightHints();
    if (tab === 'mail') body.appendChild(mailPanel(ctx, data));
  }

  async function load() {
    rowsSkeleton(body, 8);
    try {
      data = await api.get('/admin/settings');
      if (!alive) return;
      paintTabs();
      paintTab();
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  load();
  return () => {
    alive = false;
    if (form) form.destroy();
  };
}

/* Проверочное письмо и журнал отправок — рядом с настройками SMTP,
   потому что смотрят туда ровно после того, как их поменяли. */
function mailPanel(ctx, data) {
  const meta = data.meta || {};
  const to = el('input', {
    className: 'field__input', type: 'email', placeholder: ' ',
    value: (ctx.user && ctx.user.email) || '',
  });
  const logBox = el('div');
  const send = el('button', {
    className: 'btn btn--primary btn--sm', type: 'button',
    onClick: async () => {
      const addr = to.value.trim();
      if (!addr) { toast(t('common.required'), { type: 'err' }); return; }
      send.disabled = true;
      try {
        const res = await api.post('/admin/mail/test', { to: addr });
        toast(res.message || t('admin.mail_test_ok'), { type: 'ok', ms: 6000 });
        loadLog();
      } catch (e) {
        toast(errText(e), { type: 'err', ms: 7000 });
      } finally {
        send.disabled = false;
      }
    },
  }, t('admin.mail_test'));

  async function loadLog() {
    rowsSkeleton(logBox, 4);
    try {
      const log = await api.get('/admin/mail/log', { limit: 40 });
      const counts = log.counts || {};
      const head = el('div', { className: 'row gap-2 wrap' },
        el('span', { className: 'badge badge--ok' }, t('adm.mail_ok') + ': ' + (counts.sent || 0)),
        el('span', { className: 'badge badge--err' }, t('adm.mail_bad') + ': ' + (counts.failed || 0)),
        el('span', { className: 'badge' }, t('adm.mail_queue') + ': ' + (log.queue || 0)),
        log.enabled ? null : el('span', { className: 'badge badge--warn' }, t('adm.mail_off')));
      const rows = (log.items || []).length ? dataTable([
        { key: 'at', label: t('common.time'), cell: (r) => dateTime(r.at) },
        { key: 'to_addr', label: t('common.email'), cell: (r) => r.to_addr, wide: true },
        { key: 'template', label: t('admin.mail_templates'), cell: (r) => r.template, hide: true },
        {
          key: 'status',
          label: t('common.status'),
          cell: (r) => el('span', {
            className: 'badge badge--' + (r.status === 'sent' ? 'ok' : 'err'),
            title: r.error || '',
          }, r.status === 'sent' ? t('adm.mail_ok') : t('adm.mail_bad')),
        },
      ], log.items) : emptyBox(t('adm.mail_empty'));
      logBox.replaceChildren(head, rows);
    } catch (e) {
      logBox.replaceChildren(el('p', { className: 'muted' }, errText(e)));
    }
  }

  loadLog();
  return el('div', { className: 'col gap-3' },
    block(t('admin.mail_test'), el('div', { className: 'row gap-2 wrap' },
      el('label', { className: 'field grow' }, to,
        el('span', { className: 'field__label' }, t('admin.mail_test_to'))),
      send),
      meta.mail_ready ? null : el('p', { className: 'muted t-sm' }, t('adm.mail_off'))),
    block(t('admin.mail_log'), logBox));
}


/* ─────────────────────────────────────────────────────── проверка документов */

extend({
  ru: {
    'adm.vf_title': 'Проверка документов',
    'adm.vf_none': 'Никто не ждёт проверки',
    'adm.vf_none_all': 'Пока никто не присылал документы',
    'adm.vf_pending': 'Ждут решения',
    'adm.vf_approved': 'Проверены',
    'adm.vf_rejected': 'Отказано',
    'adm.vf_all': 'Все',
    'adm.vf_open': 'Открыть фото',
    'adm.vf_nophoto': 'Фото ещё не прислано',
    'adm.vf_approve': 'Одобрить',
    'adm.vf_reject': 'Отказать',
    'adm.vf_sent': 'Прислано',
    'adm.vf_registered': 'Зарегистрирован',
    'adm.vf_reason_title': 'Что не так с документами?',
    'adm.vf_reason_hint': 'Курьер увидит это и пришлёт фото заново',
    'adm.vf_reason_ph': 'Например: лицо не видно, паспорт закрыт пальцем',
    'adm.vf_reason_need': 'Напишите причину — человек должен понимать, что переснять',
    'adm.vf_ok': 'Доступ к заказам открыт',
    'adm.vf_no': 'Отказано, курьер получит замечание',
    'adm.vf_confirm': 'Открыть этому курьеру доступ к заказам?',
    'adm.vf_note_was': 'Замечание',
    'adm.vf_orders': 'заказов',
  },
  ky: {
    'adm.vf_title': 'Документтерди текшерүү',
    'adm.vf_none': 'Текшерүүнү күткөндөр жок',
    'adm.vf_none_all': 'Азырынча эч ким документ жиберген жок',
    'adm.vf_pending': 'Чечим күтүүдө',
    'adm.vf_approved': 'Текшерилген',
    'adm.vf_rejected': 'Четке кагылган',
    'adm.vf_all': 'Баары',
    'adm.vf_open': 'Сүрөттү ачуу',
    'adm.vf_nophoto': 'Сүрөт жиберилген жок',
    'adm.vf_approve': 'Уруксат берүү',
    'adm.vf_reject': 'Четке кагуу',
    'adm.vf_sent': 'Жиберилген',
    'adm.vf_registered': 'Катталган',
    'adm.vf_reason_title': 'Документте эмне туура эмес?',
    'adm.vf_reason_hint': 'Курьер муну окуп, сүрөттү кайра жиберет',
    'adm.vf_reason_ph': 'Мисалы: жүзү көрүнбөйт, паспортту манжа жаап турат',
    'adm.vf_reason_need': 'Себебин жазыңыз: адам эмнени кайра тартууну билиши керек',
    'adm.vf_ok': 'Заказдарга уруксат ачылды',
    'adm.vf_no': 'Четке кагылды, курьер эскертүү алат',
    'adm.vf_confirm': 'Бул курьерге заказдарга уруксат берелиби?',
    'adm.vf_note_was': 'Эскертүү',
    'adm.vf_orders': 'заказ',
  },
});

const verifyState = { status: 'pending', page: 1 };

/** Очередь на проверку документов курьеров.
 *
 *  Отдельный раздел, а не вкладка внутри курьеров: это ежедневная работа,
 *  за которой человек заходит специально, и ждущие решения не должны
 *  теряться среди сотни строк общего списка.
 */
export function renderVerify(host, ctx) {
  let alive = true;
  const chips = el('div', { className: 'chips' });
  const body = el('div');
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('adm.vf_title')), chips, body));

  function paintChips(data) {
    const c = data.counts || {};
    const items = [
      ['pending', t('adm.vf_pending'), c.pending],
      ['approved', t('adm.vf_approved'), c.approved],
      ['rejected', t('adm.vf_rejected'), c.rejected],
      ['all', t('adm.vf_all'), data.total],
    ];
    chips.replaceChildren(...items.map(([code, label, n]) => el('button', {
      className: 'chip' + (verifyState.status === code ? ' chip--on' : ''),
      type: 'button',
      onClick: () => { verifyState.status = code; verifyState.page = 1; load(); },
    }, label + (n === undefined ? '' : ' · ' + n))));
  }

  async function decide(row, status) {
    let note = '';
    if (status === 'rejected') {
      note = await askReason();
      if (note === null) return;
    } else if (!await ask({ title: t('adm.vf_confirm'), ok: t('adm.vf_approve') })) {
      return;
    }
    try {
      await api.patch('/admin/verify/' + row.user_id, { status, note });
      haptic();
      toast(status === 'approved' ? t('adm.vf_ok') : t('adm.vf_no'), { type: 'ok' });
      load();
    } catch (e) {
      toast(errText(e), { type: 'err' });
    }
  }

  /** Причина отказа: без неё курьер не поймёт, что переснимать. */
  function askReason() {
    return new Promise((resolve) => {
      const input = el('textarea', {
        className: 'field__input', rows: 3, placeholder: t('adm.vf_reason_ph'),
      });
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      sheet({
        title: t('adm.vf_reason_title'),
        content: el('div', { className: 'col gap-3' },
          el('p', { className: 'muted' }, t('adm.vf_reason_hint')),
          el('label', { className: 'field' }, input)),
        actions: [
          { label: t('common.cancel'), kind: 'ghost', onClick: () => finish(null) },
          {
            label: t('adm.vf_reject'), kind: 'danger',
            onClick: () => {
              const v = input.value.trim();
              // Возврат false держит шторку открытой: человеку есть что исправить.
              if (!v) { toast(t('adm.vf_reason_need'), { type: 'err' }); input.focus(); return false; }
              finish(v);
              return true;
            },
          },
        ],
        // Закрыли крестиком, тапом мимо или свайпом — считаем это отменой,
        // иначе обещание повисло бы навсегда.
        onClose: () => finish(null),
      });
      setTimeout(() => input.focus(), 120);
    });
  }

  function card(row) {
    const car = row.car || {};
    const thumb = row.photo_url
      ? el('button', {
          className: 'vf__photo', type: 'button', title: t('adm.vf_open'),
          onClick: () => photoViewer(row.photo_url, { alt: row.name }),
        }, el('img', { src: row.photo_url, alt: row.name, loading: 'lazy' }))
      : el('div', { className: 'vf__photo vf__photo--empty' }, t('adm.vf_nophoto'));

    const when = row.verified_at || row.registered_at;
    const meta = [
      car.model && car.plate ? car.model + ' · ' + fmtPlate(car.plate) : car.model || '',
      row.phone ? fmtPhone(row.phone) : '',
      when ? t('adm.vf_sent') + ': ' + dateTime(when) : '',
      row.orders_done ? row.orders_done + ' ' + t('adm.vf_orders') : '',
    ].filter(Boolean);

    const buttons = [];
    if (row.verify_status !== 'approved') {
      buttons.push(el('button', {
        className: 'btn btn--primary', type: 'button',
        onClick: () => decide(row, 'approved'),
      }, t('adm.vf_approve')));
    }
    if (row.verify_status !== 'rejected') {
      buttons.push(el('button', {
        className: 'btn btn--danger', type: 'button',
        onClick: () => decide(row, 'rejected'),
      }, t('adm.vf_reject')));
    }

    return el('article', { className: 'card vf' },
      thumb,
      el('div', { className: 'vf__body' },
        el('div', { className: 'vf__head' },
          el('strong', {}, row.name || '—'),
          el('span', {
            className: 'badge badge--' + (row.verify_status === 'approved' ? 'ok'
              : row.verify_status === 'rejected' ? 'err' : 'warn'),
          }, row.verify_name || row.verify_status)),
        el('div', { className: 'vf__meta muted' }, meta.join(' · ')),
        row.verify_note
          ? el('div', { className: 'vf__note' }, t('adm.vf_note_was') + ': ' + row.verify_note)
          : null,
        el('div', { className: 'vf__actions' }, ...buttons,
          el('a', { className: 'btn btn--ghost', href: '#/couriers/' + row.user_id },
            t('admin.nav_couriers')))));
  }

  async function load() {
    rowsSkeleton(body, 4);
    try {
      const data = await api.get('/admin/verify', {
        status: verifyState.status, page: verifyState.page,
      });
      if (!alive) return;
      paintChips(data);
      const items = data.items || [];
      if (!items.length) {
        body.replaceChildren(emptyBox(
          verifyState.status === 'pending' ? t('adm.vf_none') : t('adm.vf_none_all')));
        return;
      }
      const list = el('div', { className: 'vf-list' }, ...items.map(card));
      const nav = pager(data, (p) => { verifyState.page = p; load(); });
      body.replaceChildren(nav ? el('div', {}, list, nav) : list);
    } catch (e) {
      if (!alive) return;
      body.replaceChildren(emptyBox(errText(e)));
    }
  }

  load();
  return () => { alive = false; };
}

/* ═══════════════════════════════════════════════════════ оплата, бонусы, отчёты

   Три раздела, за которыми владелец заходит в панель чаще всего: куда падают
   деньги, чем возвращаем людей и что вообще происходит с сервисом. Свои тексты
   они приносят с собой — общий словарь для этого трогать не нужно. */

extend({
  ru: {
    /* ── оплата ── */
    'apay.nav': 'Оплата',
    'apay.title': 'Приём оплаты',
    'apay.bank': 'Связь с Оптима Банком',
    'apay.on': 'Принимать бронь онлайн',
    'apay.on_hint': 'Выключите — и заказы пойдут без предоплаты, деньги курьеру наличными',
    'apay.way': 'Как принимаем деньги',
    'apay.key': 'API-ключ Оптимы',
    'apay.key_hint': 'Выдают в кабинете Оптима Бизнес, раздел интеграций',
    'apay.key_set': 'Ключ задан и спрятан',
    'apay.key_none': 'Ключ ещё не задан',
    'apay.key_replace': 'Заменить ключ',
    'apay.key_keep': 'Оставить прежний',
    'apay.key_new': 'Новый API-ключ',
    'apay.company': 'ID компании',
    'apay.company_hint': 'legalPartyId — число из кабинета Оптимы',
    'apay.check': 'Проверить связь',
    'apay.checking': 'Спрашиваем банк…',
    'apay.points': 'Торговая точка и касса',
    'apay.points_hint': 'Руками их вводить не нужно: список присылает сам банк',
    'apay.points_ask': 'Нажмите «Проверить связь» — подтянем точки и кассы из банка',
    'apay.point_one': 'Точка одна, выбрали её без вопросов',
    'apay.point_pick': 'Точек несколько — выберите, через какую проводим оплату',
    'apay.point_now': 'Работаем через эту точку',
    'apay.cash': 'Касса',
    'apay.cash_pick': 'Касса в этой точке',
    'apay.no_points': 'Банк не прислал ни одной точки. Проверьте ключ и ID компании.',
    'apay.point_saved': 'Точка и касса сохранены',
    'apay.prepay': 'Размер брони',
    'apay.prepay_hint': 'Вперёд человек платит только бронь — это подтверждение, что он настоящий. Остальное отдаёт курьеру наличными.',
    'apay.percent': 'Процент от заказа',
    'apay.percent_hint': 'Ноль — считаем бронь от комиссии сервиса',
    'apay.min': 'Бронь не меньше',
    'apay.max': 'Бронь не больше',
    'apay.max_hint': 'Ноль — верхней границы нет',
    'apay.example': 'Живой пример',
    'apay.example_order': 'Заказ на сумму',
    'apay.example_text': 'С заказа на {total} клиент заплатит вперёд {prepay}, курьеру наличными — {rest}',
    'apay.qr': 'Код оплаты',
    'apay.ttl': 'Код живёт, секунд',
    'apay.note': 'Назначение платежа',
    'apay.note_hint': 'Эту строку человек увидит в приложении банка, а вы — в выписке',
    'apay.cb': 'Уведомление банка об оплате',
    'apay.cb_hint': 'Сразу после оплаты банк стучится на наш адрес. Без этого заказ будет ждать денег, которые уже пришли.',
    'apay.cb_url': 'Адрес нашего обработчика',
    'apay.cb_login': 'Логин',
    'apay.cb_pass': 'Пароль',
    'apay.cb_set': 'Логин и пароль созданы',
    'apay.cb_none': 'Логин и пароль ещё не созданы',
    'apay.cb_make': 'Создать логин и пароль',
    'apay.cb_again': 'Создать заново',
    'apay.cb_once': 'Пароль показан один раз. Скопируйте его сейчас — второй раз мы его не покажем.',
    'apay.cb_where': 'Кабинет Оптима Бизнес → интеграции → обратное уведомление. Там три поля: адрес, логин, пароль — впишите то, что ниже.',
    'apay.cb_warn': 'Старый пароль сразу перестанет работать. Не забудьте вписать новый в кабинете Оптимы.',
    'apay.copy': 'Скопировать',
    'apay.ready': 'Готово к работе',
    'apay.not_ready': 'Ещё не настроено',
    'apay.off': 'Оплата выключена',
    'apay.manual_note': 'Сейчас оплату отмечает оператор вручную',

    /* ── бонусы ── */
    'abn.nav': 'Бонусы',
    'abn.title': 'Бонусы клиентам',
    'abn.rules': 'Правила',
    'abn.on': 'Бонусы включены',
    'abn.on_hint': 'Выключите — начисления остановятся, накопленное сохранится',
    'abn.percent': 'Кэшбек с заказа',
    'abn.max_share': 'Можно закрыть бонусами',
    'abn.expire_days': 'Сгорают без заказов, дней',
    'abn.warn_days': 'Предупредить за, дней',
    'abn.invite_friend': 'Другу за код',
    'abn.invite_owner': 'Тому, кто позвал',
    'abn.review': 'За отзыв',
    'abn.signup': 'Новому клиенту',
    'abn.group_invite': 'Приглашения',
    'abn.ex_percent': 'С заказа на {total} вернётся {sum}',
    'abn.ex_share': 'В заказе на {total} бонусами можно закрыть не больше {sum}',
    'abn.ex_expire': 'Заказал сегодня — бонусы доживут до {date}, напомним {warn}',
    'abn.ex_invite': 'За одного приглашённого сервис отдаст {sum}: {friend} другу и {owner} позвавшему',
    'abn.ex_review': 'Каждый отзыв стоит {sum}',
    'abn.ex_signup': 'Каждый новый клиент сразу получает {sum}',
    'abn.ex_signup_off': 'Приветственных бонусов нет',
    'abn.money': 'Что с деньгами',
    'abn.issued': 'Выдано всего',
    'abn.spent': 'Списано в заказах',
    'abn.burned': 'Сгорело',
    'abn.live': 'Висит сейчас',
    'abn.live_hint': 'Это обязательство сервиса: люди придут и потратят',
    'abn.clients': 'С бонусами на счету',
    'abn.invites': 'Пришли по коду',
    'abn.invites_paid': 'Из них доехали',
    'abn.moves': 'Последние движения',
    'abn.moves_empty': 'Движений пока не было',
    'abn.col_when': 'Когда',
    'abn.col_who': 'Клиент',
    'abn.col_what': 'За что',
    'abn.col_sum': 'Сумма',
    'abn.col_rest': 'Остаток',
    'abn.expire_run': 'Прогнать сгорание',
    'abn.expire_ask': 'Сжечь бонусы всем, кто давно не заказывал?',
    'abn.expire_done': 'Сгорело у {n}: {sum}',
    'abn.expire_none': 'Сжигать нечего',
    'abn.off': 'Выключены',
    'abn.off_note': 'Бонусы выключены: начисления не идут, списать тоже нельзя',

    /* ── отчёты ── */
    'rep.nav': 'Отчёты',
    'rep.title': 'Отчёты',
    'rep.period': 'Период',
    'rep.money': 'Деньги за период',
    'rep.revenue': 'Выручка',
    'rep.revenue_hint': 'Сумма выполненных заказов',
    'rep.commission': 'Комиссия сервиса',
    'rep.payout': 'Курьерам',
    'rep.avg': 'Средний чек',
    'rep.orders': 'Заказов',
    'rep.done': 'Выполнено',
    'rep.cancelled': 'Отменено',
    'rep.expired': 'Без машины',
    'rep.conv': 'Нашли машину',
    'rep.conv_hint': 'Доля поисков, которые закончились назначенным курьером',
    'rep.by_day': 'Выручка по дням',
    'rep.by_day_hint': 'Линия — выручка выполненных заказов за сутки',
    'rep.by_hour': 'По часам суток',
    'rep.by_hour_hint': 'Когда ставить больше машин на линию',
    'rep.by_dow': 'По дням недели',
    'rep.by_tariff': 'По тарифам',
    'rep.top': 'Топ курьеров',
    'rep.top_hint': 'За период: сколько привезли и как отвечают на предложения',
    'rep.clients': 'Клиенты',
    'rep.cancels': 'Отмены',
    'rep.cancels_hint': 'Отмена до поиска ничего не стоит, отмена после подачи — стоит курьеру дороги',
    'rep.csv': 'CSV',
    'rep.csv_hint': 'Скачать таблицу',
    'rep.hover': 'Коснитесь столбца — покажем точные цифры',
    'rep.empty': 'За этот период данных нет',
    'rep.col_metric': 'Показатель',
    'rep.col_value': 'Значение',
    'rep.col_date': 'Дата',
    'rep.col_hour': 'Час',
    'rep.col_dow': 'День недели',
    'rep.col_tariff': 'Тариф',
    'rep.col_orders': 'Заказов',
    'rep.col_done': 'Выполнено',
    'rep.col_sum': 'Сумма',
    'rep.col_share': 'Доля',
    'rep.col_courier': 'Курьер',
    'rep.col_rating': 'Рейтинг',
    'rep.col_decline': 'Отказы',
    'rep.col_reason': 'Причина',
    'rep.col_count': 'Сколько',
    'rep.col_step': 'На каком шаге',
    'rep.decline_hint': 'Доля предложений, на которые курьер не ответил или отказался',
    'rep.cli_new': 'Новые',
    'rep.cli_back': 'Вернувшиеся',
    'rep.cli_active': 'Заказывали',
    'rep.cli_repeat': 'Больше одного заказа',
    'rep.cli_per': 'Заказов на клиента',
    'rep.cli_hint': 'Вернувшийся — тот, кто завёлся раньше, а заказал в этом периоде',
    'rep.step_before': 'До поиска машины',
    'rep.step_search': 'Пока искали машину',
    'rep.step_assigned': 'Курьер уже ехал',
    'rep.step_before_s': 'До поиска',
    'rep.step_search_s': 'В поиске',
    'rep.step_assigned_s': 'С курьером',
    'rep.by_whom': 'Кто отменил',
    'rep.whom_client': 'Клиент',
    'rep.whom_courier': 'Курьер',
    'rep.whom_admin': 'Оператор',
    'rep.whom_system': 'Сервис',
    'rep.no_reason': 'Без причины',
    'rep.dow_1': 'Пн', 'rep.dow_2': 'Вт', 'rep.dow_3': 'Ср', 'rep.dow_4': 'Чт',
    'rep.dow_5': 'Пт', 'rep.dow_6': 'Сб', 'rep.dow_7': 'Вс',
  },
  ky: {
    /* ── төлөм ── */
    'apay.nav': 'Төлөм',
    'apay.title': 'Төлөмдү кабыл алуу',
    'apay.bank': 'Оптима Банк менен байланыш',
    'apay.on': 'Бронду онлайн кабыл алуу',
    'apay.on_hint': 'Өчүрсөңүз, заказдар алдын ала төлөмсүз кетет, акча курьерге накталай берилет',
    'apay.way': 'Акчаны кантип алабыз',
    'apay.key': 'Оптиманын API-ачкычы',
    'apay.key_hint': 'Оптима Бизнес кабинетинде, интеграция бөлүмүндө берилет',
    'apay.key_set': 'Ачкыч коюлган жана жашырылган',
    'apay.key_none': 'Ачкыч азырынча коюла элек',
    'apay.key_replace': 'Ачкычты алмаштыруу',
    'apay.key_keep': 'Мурункусун калтыруу',
    'apay.key_new': 'Жаңы API-ачкыч',
    'apay.company': 'Компаниянын ID',
    'apay.company_hint': 'legalPartyId — Оптима кабинетиндеги сан',
    'apay.check': 'Байланышты текшерүү',
    'apay.checking': 'Банктан сурап жатабыз…',
    'apay.points': 'Соода түйүнү жана касса',
    'apay.points_hint': 'Аларды кол менен жазуунун кереги жок: тизмени банк өзү берет',
    'apay.points_ask': '«Байланышты текшерүү» дегенди басыңыз — түйүндөрдү банктан тартып алабыз',
    'apay.point_one': 'Түйүн бирөө экен, аны сурабай эле тандап койдук',
    'apay.point_pick': 'Түйүн бир нече — төлөм кайсынысы аркылуу өтөрүн тандаңыз',
    'apay.point_now': 'Ушул түйүн аркылуу иштеп жатабыз',
    'apay.cash': 'Касса',
    'apay.cash_pick': 'Бул түйүндөгү касса',
    'apay.no_points': 'Банк бир да түйүн бербеди. Ачкычты жана компаниянын ID ин текшериңиз.',
    'apay.point_saved': 'Түйүн менен касса сакталды',
    'apay.prepay': 'Брондун өлчөмү',
    'apay.prepay_hint': 'Адам алдын ала бронду гана төлөйт — бул анын чын экенин ырастайт. Калганын курьерге накталай берет.',
    'apay.percent': 'Заказдан пайыз',
    'apay.percent_hint': 'Нөл болсо, бронду сервистин комиссиясынан эсептейбиз',
    'apay.min': 'Брон кем дегенде',
    'apay.max': 'Брон көп дегенде',
    'apay.max_hint': 'Нөл болсо, жогорку чек жок',
    'apay.example': 'Тирүү мисал',
    'apay.example_order': 'Заказдын суммасы',
    'apay.example_text': '{total} заказдан кардар {prepay} алдын ала төлөйт, курьерге накталай — {rest}',
    'apay.qr': 'Төлөм коду',
    'apay.ttl': 'Код канча секунд жашайт',
    'apay.note': 'Төлөмдүн багыты',
    'apay.note_hint': 'Бул сапты адам банк тиркемесинен, сиз выпискадан көрөсүз',
    'apay.cb': 'Банктын төлөм жөнүндө кабары',
    'apay.cb_hint': 'Төлөм өткөн замат банк биздин дарекке кабар берет. Ансыз заказ келип калган акчаны күтүп тура берет.',
    'apay.cb_url': 'Биздин дарегибиз',
    'apay.cb_login': 'Логин',
    'apay.cb_pass': 'Сырсөз',
    'apay.cb_set': 'Логин менен сырсөз түзүлгөн',
    'apay.cb_none': 'Логин менен сырсөз түзүлө элек',
    'apay.cb_make': 'Логин жана сырсөз түзүү',
    'apay.cb_again': 'Кайрадан түзүү',
    'apay.cb_once': 'Сырсөз бир жолу гана көрүнөт. Азыр көчүрүп алыңыз — экинчи жолу көрсөтпөйбүз.',
    'apay.cb_where': 'Оптима Бизнес кабинети → интеграциялар → кайтарым кабар. Ал жерде үч талаа бар: дарек, логин, сырсөз — төмөндөгүнү жазыңыз.',
    'apay.cb_warn': 'Эски сырсөз ошол замат иштебей калат. Жаңысын Оптима кабинетине жазууну унутпаңыз.',
    'apay.copy': 'Көчүрүү',
    'apay.ready': 'Иштөөгө даяр',
    'apay.not_ready': 'Дагы жөндөлө элек',
    'apay.off': 'Төлөм өчүрүлгөн',
    'apay.manual_note': 'Азыр төлөмдү оператор кол менен белгилейт',

    /* ── бонустар ── */
    'abn.nav': 'Бонустар',
    'abn.title': 'Кардарларга бонус',
    'abn.rules': 'Эрежелер',
    'abn.on': 'Бонустар күйүк',
    'abn.on_hint': 'Өчүрсөңүз, эсептөө токтойт, чогулганы сакталат',
    'abn.percent': 'Заказдан кэшбек',
    'abn.max_share': 'Бонус менен жабууга болот',
    'abn.expire_days': 'Заказсыз күйөт, күн',
    'abn.warn_days': 'Канча күн мурун эскертебиз',
    'abn.invite_friend': 'Код киргизген доско',
    'abn.invite_owner': 'Чакырган кишиге',
    'abn.review': 'Пикир үчүн',
    'abn.signup': 'Жаңы кардарга',
    'abn.group_invite': 'Чакыруулар',
    'abn.ex_percent': '{total} заказдан {sum} кайтат',
    'abn.ex_share': '{total} заказда бонус менен {sum} чейин гана жабууга болот',
    'abn.ex_expire': 'Бүгүн заказ кылса, бонус {date} чейин жашайт, {warn} эскертебиз',
    'abn.ex_invite': 'Бир чакырылган киши үчүн сервис {sum} берет: {friend} доско, {owner} чакырганга',
    'abn.ex_review': 'Ар бир пикир {sum} турат',
    'abn.ex_signup': 'Ар бир жаңы кардар дароо {sum} алат',
    'abn.ex_signup_off': 'Тааныштык белеги жок',
    'abn.money': 'Акча кандай',
    'abn.issued': 'Баары берилди',
    'abn.spent': 'Заказдарда пайдаланылды',
    'abn.burned': 'Күйүп кетти',
    'abn.live': 'Азыр турат',
    'abn.live_hint': 'Бул сервистин милдети: адамдар келип жумшайт',
    'abn.clients': 'Эсебинде бонусу барлар',
    'abn.invites': 'Код менен келгендер',
    'abn.invites_paid': 'Алардын жүргөндөрү',
    'abn.moves': 'Акыркы кыймылдар',
    'abn.moves_empty': 'Азырынча кыймыл болгон жок',
    'abn.col_when': 'Качан',
    'abn.col_who': 'Кардар',
    'abn.col_what': 'Эмне үчүн',
    'abn.col_sum': 'Сумма',
    'abn.col_rest': 'Калдыгы',
    'abn.expire_run': 'Күйүүнү айдоо',
    'abn.expire_ask': 'Көптөн бери заказ кылбагандардын бонусун күйгүзөлүбү?',
    'abn.expire_done': '{n} кардардын {sum} күйдү',
    'abn.expire_none': 'Күйгүзө турган эч нерсе жок',
    'abn.off': 'Өчүк',
    'abn.off_note': 'Бонустар өчүк: эсептелбейт да, пайдаланылбайт да',

    /* ── отчёттор ── */
    'rep.nav': 'Отчёттор',
    'rep.title': 'Отчёттор',
    'rep.period': 'Мезгил',
    'rep.money': 'Мезгилдеги акча',
    'rep.revenue': 'Түшкөн акча',
    'rep.revenue_hint': 'Аткарылган заказдардын суммасы',
    'rep.commission': 'Сервистин комиссиясы',
    'rep.payout': 'Курьерлерге',
    'rep.avg': 'Орточо чек',
    'rep.orders': 'Заказдар',
    'rep.done': 'Аткарылды',
    'rep.cancelled': 'Жокко чыгарылды',
    'rep.expired': 'Унаа табылбады',
    'rep.conv': 'Унаа табылды',
    'rep.conv_hint': 'Курьер дайындалган издөөлөрдүн үлүшү',
    'rep.by_day': 'Күндөр боюнча түшкөн акча',
    'rep.by_day_hint': 'Сызык — бир күндө аткарылган заказдардын суммасы',
    'rep.by_hour': 'Суткадагы сааттар боюнча',
    'rep.by_hour_hint': 'Качан линияга көбүрөөк унаа коюу керек',
    'rep.by_dow': 'Жума күндөрү боюнча',
    'rep.by_tariff': 'Тарифтер боюнча',
    'rep.top': 'Мыкты курьерлер',
    'rep.top_hint': 'Мезгил ичинде: канча ташышты жана сунуштарга кандай жооп беришет',
    'rep.clients': 'Кардарлар',
    'rep.cancels': 'Жокко чыгаруулар',
    'rep.cancels_hint': 'Издөөгө чейинки баш тартуу бекер, унаа чыккандан кийинкиси курьерге жолго туура келет',
    'rep.csv': 'CSV',
    'rep.csv_hint': 'Таблицаны жүктөп алуу',
    'rep.hover': 'Мамычага тийиңиз — так сандарды көрсөтөбүз',
    'rep.empty': 'Бул мезгилде маалымат жок',
    'rep.col_metric': 'Көрсөткүч',
    'rep.col_value': 'Мааниси',
    'rep.col_date': 'Күнү',
    'rep.col_hour': 'Саат',
    'rep.col_dow': 'Жума күнү',
    'rep.col_tariff': 'Тариф',
    'rep.col_orders': 'Заказдар',
    'rep.col_done': 'Аткарылды',
    'rep.col_sum': 'Сумма',
    'rep.col_share': 'Үлүшү',
    'rep.col_courier': 'Курьер',
    'rep.col_rating': 'Рейтинг',
    'rep.col_decline': 'Баш тартуу',
    'rep.decline_hint': 'Курьер жооп бербеген же баш тарткан сунуштардын үлүшү',
    'rep.cli_new': 'Жаңылар',
    'rep.cli_back': 'Кайра келгендер',
    'rep.cli_active': 'Заказ кылгандар',
    'rep.cli_repeat': 'Бирден көп заказ',
    'rep.cli_per': 'Бир кардарга заказ',
    'rep.cli_hint': 'Кайра келген — мурун катталып, ушул мезгилде заказ кылган киши',
    'rep.step_before': 'Издөөгө чейин',
    'rep.step_search': 'Унаа издеп жатканда',
    'rep.step_assigned': 'Курьер жолдо баратканда',
    'rep.step_before_s': 'Издөөгө чейин',
    'rep.step_search_s': 'Издөөдө',
    'rep.step_assigned_s': 'Курьер менен',
    'rep.by_whom': 'Ким жокко чыгарды',
    'rep.whom_client': 'Кардар',
    'rep.whom_courier': 'Курьер',
    'rep.whom_admin': 'Оператор',
    'rep.whom_system': 'Сервис',
    'rep.no_reason': 'Себепсиз',
    'rep.dow_1': 'Дүй', 'rep.dow_2': 'Шей', 'rep.dow_3': 'Шар', 'rep.dow_4': 'Бей',
    'rep.dow_5': 'Жум', 'rep.dow_6': 'Ише', 'rep.dow_7': 'Жек',
  },
});

/* ─────────────────────────────────────────────────────── графики руками

   Библиотек в проекте нет, поэтому рисуем сами. Столбцы — обычные блоки:
   так подписи остаются нормального размера на телефоне, чего не бывает,
   когда весь график ужимают через viewBox. Линия — svg поверх тех же
   столбцов, растянутый по их коробке. Значение показывается строкой над
   графиком: на телефоне наводить нечем, а тыкать пальцем в столбик удобно. */

/** Круглый потолок оси: 137 → 150, 1 240 → 1 500. Чтобы подписи читались. */
function niceTop(max) {
  const v = Math.max(1, Math.ceil(Number(max) || 0));
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const head = v / pow;
  const step = head <= 1 ? 1 : head <= 2 ? 2 : head <= 2.5 ? 2.5 : head <= 5 ? 5 : 10;
  return Math.round(step * pow);
}

/**
 * График. spec = {
 *   items: [{label, value, note}], kind: 'bars'|'line',
 *   format: (v) => строка, dense: подписи через одну, axis: (v) => строка оси
 * }
 */
function plot(spec) {
  const items = (spec.items || []).map((i) => ({
    label: String(i.label === undefined ? '' : i.label),
    value: Math.max(0, Number(i.value) || 0),
    note: i.note || '',
  }));
  const fmt = spec.format || ((v) => num(v));
  const axisFmt = spec.axis || fmt;
  const line = spec.kind === 'line';
  const top = niceTop(Math.max(0, ...items.map((i) => i.value)));
  const read = el('div', { className: 'plot__read' }, spec.hint || t('rep.hover'));

  // Подписи по оси X: на телефоне двадцать четыре часа рядом не поместятся,
  // поэтому оставляем около дюжины — форма графика важнее, чем каждая цифра.
  const every = Math.max(1, Math.ceil(items.length / 12));
  // За год столбцов набирается триста с лишним: с зазорами они не влезут
  // в экран ни при какой ширине, поэтому у плотного графика зазора нет.
  const tight = items.length > 32;

  const cols = el('div', { className: 'plot__cols' });
  items.forEach((item, i) => {
    const pct = top > 0 ? Math.min(100, (item.value / top) * 100) : 0;
    const mark = line
      ? el('span', { className: 'plot__dot', style: { bottom: pct + '%' } })
      : el('span', {
          className: 'plot__bar' + (item.value ? '' : ' is-zero'),
          style: { height: Math.max(item.value ? 3 : 2, pct) + '%' },
        });
    cols.appendChild(el('div', {
      className: 'plot__col',
      dataset: { i: String(i) },
      title: item.label + ' — ' + fmt(item.value) + (item.note ? ' · ' + item.note : ''),
    },
      el('span', { className: 'plot__slot' }, mark),
      el('span', { className: 'plot__x' }, i % every === 0 ? item.label : '')));
  });

  const body = el('div', { className: 'plot__body' },
    el('div', { className: 'plot__grid' },
      el('i'), el('i'), el('i'), el('i')),
    cols);

  if (line && items.length) {
    // preserveAspectRatio="none" растягивает координаты по коробке, а
    // vector-effect держит толщину линии настоящей, а не растянутой.
    const step = items.length > 1 ? 100 / (items.length - 1) : 0;
    const pts = items.map((item, i) => {
      const x = items.length > 1 ? i * step : 50;
      const y = 100 - (top > 0 ? Math.min(100, (item.value / top) * 100) : 0);
      return x.toFixed(2) + ',' + y.toFixed(2);
    });
    const area = '0,100 ' + pts.join(' ') + ' 100,100';
    // svg собираем разметкой: createElement('svg') дал бы обычный html-узел,
    // который браузер не рисует.
    body.appendChild(el('div', {
      className: 'plot__line', 'aria-hidden': 'true',
      html: '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<polygon class="plot__fill" points="' + area + '"></polygon>' +
        '<polyline class="plot__stroke" fill="none" vector-effect="non-scaling-stroke" ' +
        'points="' + pts.join(' ') + '"></polyline></svg>',
    }));
  }

  // Середину показываем, только если она честно делится: на шкале из двух
  // заказов подписи «1 и 1» выглядят как ошибка.
  const half = top / 2;
  const axis = el('div', { className: 'plot__axis' },
    el('span', {}, axisFmt(top)),
    el('span', {}, Number.isInteger(half) && top >= 2 ? axisFmt(half) : ''),
    el('span', {}, axisFmt(0)));

  function show(i) {
    for (const node of cols.children) node.classList.remove('is-on');
    if (i < 0 || !items[i]) {
      read.textContent = spec.hint || t('rep.hover');
      return;
    }
    cols.children[i].classList.add('is-on');
    read.textContent = items[i].label + ' — ' + fmt(items[i].value) +
      (items[i].note ? ' · ' + items[i].note : '');
  }

  const at = (e) => {
    const col = e.target.closest ? e.target.closest('.plot__col') : null;
    if (col) show(Number(col.dataset.i));
  };
  cols.addEventListener('pointerover', at);
  cols.addEventListener('click', at);
  cols.addEventListener('pointerleave', () => show(-1));

  // Для программы чтения с экрана график бесполезен, поэтому те же числа
  // лежат рядом обычным текстом.
  const words = items.map((i) => i.label + ': ' + fmt(i.value)).join(', ');
  return el('figure', {
    className: 'plot' + (spec.dense ? ' plot--dense' : '') + (tight ? ' plot--tight' : ''),
  },
    read,
    el('div', { className: 'plot__wrap' }, axis, body),
    el('figcaption', { className: 'sr-only' }, words));
}

/* ─────────────────────────────────────────────────────── выгрузка в CSV

   Файл собирается прямо в браузере из тех же чисел, что показаны на экране.
   Разделитель — точка с запятой, дробная часть через запятую, в начале BOM:
   так файл открывается двойным щелчком в Excel с русскими настройками,
   а не рассыпается в один столбец. */

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(name, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  // BOM пишем escape-последовательностью: живой невидимый символ в исходнике
  // рано или поздно вычистит чей-нибудь редактор, и Excel сломается.
  const blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Ссылку держим до конца тика: Safari успевает начать скачивание, а память
  // не течёт при десятке выгрузок подряд.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Кнопка «CSV» для заголовка блока. build() возвращает {name, header, rows}. */
function csvButton(build) {
  return el('button', {
    className: 'btn btn--ghost btn--sm', type: 'button', title: t('rep.csv_hint'),
    onClick: () => {
      const data = build();
      if (!data || !data.rows.length) { toast(t('rep.empty'), { type: 'info' }); return; }
      downloadCsv(data.name, data.header, data.rows);
      haptic();
    },
  }, t('rep.csv'));
}

/** Заголовок блока с кнопкой справа. */
function panel(title, right, ...kids) {
  return el('section', { className: 'block' },
    el('div', { className: 'block__bar' },
      el('h2', { className: 'block__head' }, title),
      right || null),
    ...kids);
}

function pctOf(part, whole) {
  const w = Number(whole) || 0;
  if (w <= 0) return '0%';
  return (Math.round((Number(part) || 0) * 1000 / w) / 10).toString().replace('.', ',') + '%';
}

/** Дата вида 2026-03-14 из unix-времени с поправкой на часовой пояс сервиса. */
function dayIso(unix, offset) {
  const d = new Date(((Number(unix) || 0) + (Number(offset) || 0)) * 1000);
  return d.toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════ оплата */

/* Что видит владелец: два поля и кнопка. Всё остальное — точка, касса,
   логин с паролем для уведомления — появляется само. */

const PREPAY_SAMPLE = 150000;      // заказ на 1500 сом: с него и считаем пример

export function renderPay(host, ctx) {
  let alive = true;
  let data = null;            // последний ответ сервера
  let points = [];            // торговые точки из банка
  let replaceKey = false;     // владелец нажал «Заменить ключ»
  let sample = PREPAY_SAMPLE;
  // Раздел перерисовывается целиком после каждого ответа банка. Старые формы
  // надо гасить, иначе они останутся в списке несохранённых и панель начнёт
  // спрашивать «уходим?» на пустом месте.
  let forms = [];

  const body = el('div', { className: 'col gap-4' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('apay.title')), body));

  /* ── бронь: тот же расчёт, что в server/pricing.py ──────────────────
     Повторяем формулу, чтобы пример оживал прямо под пальцем, до сохранения.
     Настоящую бронь всё равно считает сервер. */
  function prepayFor(total, rule) {
    const sum = Math.max(0, Math.round(Number(total) || 0));
    if (sum <= 0) return 0;
    const share = Math.max(0, Number(rule.percent) || 0);
    let base = share > 0
      ? Math.floor((sum * Math.round(share * 100) + 5000) / 10000)
      : commissionFor(sum, {
        kind: ctx.setting('commission.kind', 'percent'),
        value: ctx.setting('commission.value', 10),
        min: ctx.setting('commission.min', 0),
        max: ctx.setting('commission.max', 0),
      });
    const pctLow = Math.max(0, Number(ctx.setting('payment.prepay_pct_min', 5)) || 0);
    const pctHigh = Math.max(pctLow, Number(ctx.setting('payment.prepay_pct_max', 10)) || 0);
    if (pctHigh > 0) base = Math.min(base, Math.floor((sum * pctHigh + 50) / 100));
    if (pctLow > 0) base = Math.max(base, Math.floor((sum * pctLow + 50) / 100));
    const low = Math.max(0, Math.round(Number(rule.min) || 0));
    const high = Math.max(0, Math.round(Number(rule.max) || 0));
    if (low > 0) base = Math.max(base, low);
    if (high > 0) base = Math.min(base, high);
    return Math.max(0, Math.min(base, sum));
  }

  async function load(showSkeleton) {
    if (showSkeleton !== false) rowsSkeleton(body, 8);
    try {
      const res = await api.get('/admin/pay/settings');
      if (!alive) return;
      apply(res);
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, () => load()));
    }
  }

  function apply(res) {
    data = res;
    if (Array.isArray(res.points) && res.points.length) points = res.points;
    paint();
  }

  /** Сохранить то, что изменили, и показать ответ банка. */
  async function put(patch, okMessage) {
    const res = await api.put('/admin/pay/settings', patch);
    if (!alive) return res;
    // Ключ уже на сервере — поле ввода закрываем, дальше о нём говорит значок.
    if (patch && patch.key) replaceKey = false;
    apply(res);
    const text = res.message || okMessage || t('admin.set_saved');
    toast(text, { type: res.ok === false ? 'warn' : 'ok', ms: res.ok === false ? 7000 : 3000 });
    return res;
  }

  /* ── блок «связь с банком» ──────────────────────────────────────── */

  function bankBlock() {
    const s = data.settings || {};
    const keySet = !!s.key_set;
    const showKey = replaceKey || !keySet;

    // Первыми идут те самые два поля, ради которых человек сюда зашёл,
    // и только потом — переключатели. Заголовок у первой группы не нужен:
    // он уже написан на самом блоке.
    const fields = [
      {
        name: 'company', kind: 'text', label: 'apay.company', hint: 'apay.company_hint',
        maxlength: 32,
      },
    ];
    if (showKey) {
      fields.push({
        name: 'key', kind: 'password', label: keySet ? 'apay.key_new' : 'apay.key',
        hint: 'apay.key_hint', maxlength: 200, span: 2, autocomplete: 'new-password',
      });
    }
    fields.push({
      name: 'enabled', kind: 'switch', label: 'apay.on', hint: 'apay.on_hint',
      span: 2, group: 'apay.way',
    }, {
      name: 'provider', kind: 'select', label: 'admin.pay_provider', span: 2,
      options: (s.providers || []).map((p) => ({
        value: p.code,
        text: p.title + (p.ready ? '' : ' · ' + t('apay.not_ready')),
      })),
    });

    const form = createForm({
      fields,
      values: {
        enabled: !!s.enabled,
        provider: s.provider || 'none',
        company: s.company || '',
        key: '',
      },
      submit: 'common.save',
      extra: [{
        label: 'apay.check', kind: 'ghost',
        onClick: (f) => check(f),
      }],
      onSubmit: async (values, changed) => {
        const patch = pickPatch(values, changed);
        if (!patch) { toast(t('adm.nothing_changed'), { type: 'info' }); return false; }
        await put(patch);
        return true;
      },
    });
    forms.push(form);

    const keyState = el('div', { className: 'row gap-2 wrap' },
      el('span', { className: 'badge ' + (keySet ? 'badge--ok' : 'badge--warn') },
        keySet ? t('apay.key_set') : t('apay.key_none')),
      keySet ? el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => { replaceKey = !replaceKey; paint(); },
      }, replaceKey ? t('apay.key_keep') : t('apay.key_replace')) : null);

    const state = el('div', { className: 'row gap-2 wrap' },
      el('span', {
        className: 'badge ' + (s.active === 'optima' ? 'badge--ok'
          : s.active === 'manual' ? 'badge--info' : 'badge--warn'),
      }, s.active === 'optima' ? t('apay.ready')
        : s.active === 'manual' ? t('apay.manual_note') : t('apay.off')));

    return panel(t('apay.bank'), state, keyState, form.el);
  }

  /** Что из формы связи уходит на сервер: пустой ключ значит «не трогать». */
  function pickPatch(values, changed) {
    const patch = {};
    if ('enabled' in changed) patch.enabled = !!values.enabled;
    if ('provider' in changed) patch.provider = values.provider;
    if ('company' in changed) patch.company = String(values.company || '').trim();
    if (values.key) patch.key = values.key;
    return Object.keys(patch).length ? patch : null;
  }

  /** Проверка связи: сначала сохраняем введённое, потом спрашиваем банк. */
  async function check(form) {
    const patch = pickPatch(form.values(), form.changed());
    try {
      if (patch) await put(patch);
      const res = await api.post('/admin/pay/test', {});
      if (!alive) return;
      apply(res);
      toast(res.message || t('apay.ready'),
        { type: res.ok ? 'ok' : 'err', ms: res.ok ? 4000 : 8000 });
    } catch (e) {
      toast(errText(e), { type: 'err', ms: 8000 });
    }
  }

  /* ── блок «точка и касса» ───────────────────────────────────────── */

  function pointsBlock() {
    const s = data.settings || {};
    const chosen = Number(s.sale_point) || 0;
    const chosenCash = Number(s.cash) || 0;

    if (!points.length) {
      return panel(t('apay.points'), null,
        el('p', { className: 'muted t-sm' }, t('apay.points_hint')),
        emptyBox(s.ready ? t('apay.points_ask') : t('apay.no_points')));
    }

    const list = el('div', { className: 'list' });
    for (const point of points) {
      const on = point.code === chosen;
      const cashes = point.cashes || [];
      const row = el('div', {
        className: 'list__row list__row--tap pick' + (on ? ' is-on' : ''),
        role: 'button',
        tabIndex: 0,
      },
        el('span', { className: 'pick__mark' + (on ? ' is-on' : '') }),
        el('span', { className: 'grow' },
          el('b', { className: 'pick__name' }, point.name),
          el('span', { className: 'pick__addr muted t-sm' },
            [point.address, point.account ? '№ ' + point.account : '']
              .filter(Boolean).join(' · ')),
          on && cashes.length > 1
            ? el('span', { className: 'chips pick__cash' }, ...cashes.map((c) => el('button', {
              className: 'chip' + (c.code === chosenCash ? ' chip--on' : ''),
              type: 'button',
              onClick: (e) => {
                e.stopPropagation();
                pickPoint(point.code, c.code);
              },
            }, c.name)))
            : el('span', { className: 'pick__addr muted t-sm' },
              t('apay.cash') + ': ' +
              ((cashes.find((c) => c.code === chosenCash) || cashes[0] || {}).name || '—'))));
      const tap = () => pickPoint(point.code, on ? chosenCash : (cashes[0] || {}).code);
      row.addEventListener('click', tap);
      row.addEventListener('keydown', (e) => {
        // Нажатие на чипе кассы всплывает сюда же; чужие клавиши не наши.
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
      });
      list.appendChild(row);
    }

    const note = points.length === 1 ? t('apay.point_one')
      : chosen ? t('apay.point_now') : t('apay.point_pick');
    return panel(t('apay.points'), null,
      el('p', { className: 'muted t-sm' }, note), list);
  }

  async function pickPoint(code, cash) {
    try {
      await put({ sale_point: code, cash: cash || 0 }, t('apay.point_saved'));
      haptic();
    } catch (e) {
      toast(errText(e), { type: 'err' });
    }
  }

  /* ── блок «размер брони» ────────────────────────────────────────── */

  function prepayBlock() {
    const s = data.settings || {};
    const rule = s.prepay || {};
    const hint = el('p', { className: 'hintline' });
    const sampleInput = el('input', {
      className: 'field__input', type: 'text', inputMode: 'decimal',
      placeholder: ' ', value: tiyinToSom(sample),
    });

    const form = createForm({
      fields: [
        {
          name: 'prepay_percent', kind: 'number', label: 'apay.percent',
          hint: 'apay.percent_hint', min: 0, max: 100, group: 'apay.prepay',
        },
        { name: 'prepay_min', kind: 'money', label: 'apay.min', min: 0, max: 1000000 },
        {
          name: 'prepay_max', kind: 'money', label: 'apay.max', hint: 'apay.max_hint',
          min: 0, max: 1000000,
        },
        { name: 'qr_ttl_s', kind: 'number', label: 'apay.ttl', min: 120, max: 3600, group: 'apay.qr' },
        {
          name: 'note', kind: 'text', label: 'apay.note', hint: 'apay.note_hint',
          maxlength: 100, span: 2,
        },
      ],
      values: {
        prepay_percent: Number(rule.percent) || 0,
        prepay_min: Number(rule.min) || 0,
        prepay_max: Number(rule.max) || 0,
        qr_ttl_s: Number(s.qr_ttl_s) || 600,
        note: s.note || '',
      },
      submit: 'common.save',
      onChange: () => redraw(),
      onSubmit: async (values, changed) => {
        const patch = {};
        // Пустое поле — это ноль, а не «ничего»: сервер ждёт число.
        for (const [key, v] of Object.entries(changed)) patch[key] = v === null ? 0 : v;
        if (!Object.keys(patch).length) {
          toast(t('adm.nothing_changed'), { type: 'info' });
          return false;
        }
        await put(patch);
        return true;
      },
    });
    forms.push(form);

    function redraw() {
      const v = form.values();
      const prepay = prepayFor(sample, {
        percent: v.prepay_percent, min: v.prepay_min, max: v.prepay_max,
      });
      hint.textContent = t('apay.example_text', {
        total: money(sample),
        prepay: money(prepay),
        rest: money(Math.max(0, sample - prepay)),
      });
    }

    sampleInput.addEventListener('input', () => {
      const v = somToTiyin(sampleInput.value);
      sample = Number.isFinite(v) && v > 0 ? v : PREPAY_SAMPLE;
      redraw();
    });
    redraw();

    return panel(t('apay.prepay'), null,
      el('p', { className: 'muted t-sm' }, t('apay.prepay_hint')),
      form.el,
      el('div', { className: 'example' },
        el('div', { className: 'example__head' }, t('apay.example')),
        el('label', { className: 'field field--fill' },
          sampleInput, el('span', { className: 'field__label' }, t('apay.example_order'))),
        hint));
  }

  /* ── блок «уведомление банка» ───────────────────────────────────── */

  function callbackBlock() {
    const s = data.settings || {};
    const url = data.callback_url || '';
    const has = !!s.callback_login && !!s.callback_password_set;

    const make = el('button', {
      className: 'btn ' + (has ? 'btn--ghost' : 'btn--primary'), type: 'button',
      onClick: async () => {
        if (has && !(await ask({
          title: t('apay.cb_again'), text: t('apay.cb_warn'),
          ok: t('apay.cb_again'), cancel: t('common.cancel'), danger: true,
        }))) return;
        make.disabled = true;
        try {
          const res = await api.put('/admin/pay/settings', { generate_callback: true });
          if (!alive) return;
          apply(res);
          if (res.callback) showCreds(res.callback);
        } catch (e) {
          toast(errText(e), { type: 'err' });
        } finally {
          make.disabled = false;
        }
      },
    }, has ? t('apay.cb_again') : t('apay.cb_make'));

    return panel(t('apay.cb'),
      el('span', { className: 'badge ' + (has ? 'badge--ok' : 'badge--warn') },
        has ? t('apay.cb_set') : t('apay.cb_none')),
      el('p', { className: 'muted t-sm' }, t('apay.cb_hint')),
      copyLine(t('apay.cb_url'), url),
      s.callback_login ? copyLine(t('apay.cb_login'), s.callback_login) : null,
      el('p', { className: 'muted t-sm' }, t('apay.cb_where')),
      el('div', { className: 'row gap-2 wrap' }, make));
  }

  /** Строка «подпись — значение — скопировать». */
  function copyLine(label, value) {
    return el('div', { className: 'copyline' },
      el('span', { className: 'copyline__cap' }, label),
      el('code', { className: 'copyline__val' }, value || '—'),
      el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button', disabled: !value,
        onClick: () => copyText(value, t('common.copied')),
      }, t('apay.copy')));
  }

  /** Логин и пароль показываются ровно один раз — здесь. */
  function showCreds(creds) {
    sheet({
      title: t('apay.cb_make'),
      content: el('div', { className: 'col gap-3' },
        el('p', { className: 'sheet__text' }, t('apay.cb_where')),
        copyLine(t('apay.cb_url'), creds.url),
        copyLine(t('apay.cb_login'), creds.login),
        copyLine(t('apay.cb_pass'), creds.password),
        el('p', { className: 'note note--warn' }, t('apay.cb_once'))),
      actions: [{ label: t('common.close'), kind: 'primary' }],
    });
  }

  function paint() {
    for (const f of forms) f.destroy();
    forms = [];
    body.replaceChildren(
      bankBlock(),
      pointsBlock(),
      prepayBlock(),
      callbackBlock());
  }

  load();
  return () => {
    alive = false;
    for (const f of forms) f.destroy();
    forms = [];
  };
}

/* ═══════════════════════════════════════════════════════ бонусы */

const BONUS_SAMPLE = 150000;       // тот же заказ на 1500 сом, что и в оплате

export function renderBonus(host, ctx) {
  let alive = true;
  let data = null;
  let forms = [];             // гасим старые формы перед каждой перерисовкой

  const body = el('div', { className: 'col gap-4' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('abn.title')), body));

  async function load(showSkeleton) {
    if (showSkeleton !== false) rowsSkeleton(body, 8);
    try {
      const res = await api.get('/admin/bonus', { limit: 40 });
      if (!alive) return;
      data = res;
      paint();
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, () => load()));
    }
  }

  /* Кэшбек считается так же, как в server/bonus.py: процент от суммы и вниз
     до целого сома. Баланс с копейками выглядит как ошибка, а не как подарок. */
  function cashback(total, percent) {
    const hundredths = Math.round((Number(percent) || 0) * 100);
    if (hundredths <= 0 || total <= 0) return 0;
    const v = Math.floor((total * hundredths + 5000) / 10000);
    return Math.floor(v / 100) * 100;
  }

  function rulesBlock() {
    const s = data.settings || {};
    const hints = {};
    const hintNode = (name) => {
      hints[name] = el('p', { className: 'hintline' });
      return hints[name];
    };

    const form = createForm({
      fields: [
        { name: 'enabled', kind: 'switch', label: 'abn.on', hint: 'abn.on_hint', span: 2 },
        { name: 'percent', kind: 'range', label: 'abn.percent', min: 0, max: 50, step: 0.5, suffix: '%', span: 2 },
        { name: 'max_share', kind: 'range', label: 'abn.max_share', min: 0, max: 100, step: 1, suffix: '%', span: 2 },
        { name: 'expire_days', kind: 'number', label: 'abn.expire_days', min: 1, max: 3650, required: true },
        { name: 'warn_days', kind: 'number', label: 'abn.warn_days', min: 0, max: 90 },
        { name: 'invite_friend', kind: 'money', label: 'abn.invite_friend', min: 0, max: 1000000, group: 'abn.group_invite' },
        { name: 'invite_owner', kind: 'money', label: 'abn.invite_owner', min: 0, max: 1000000 },
        { name: 'review', kind: 'money', label: 'abn.review', min: 0, max: 100000 },
        { name: 'signup', kind: 'money', label: 'abn.signup', min: 0, max: 1000000 },
      ],
      values: {
        enabled: !!s.enabled,
        percent: Number(s.percent) || 0,
        max_share: Number(s.max_share) || 0,
        expire_days: Number(s.expire_days) || 180,
        warn_days: Number(s.warn_days) || 7,
        invite_friend: Number(s.invite_friend) || 0,
        invite_owner: Number(s.invite_owner) || 0,
        review: Number(s.review) || 0,
        signup: Number(s.signup) || 0,
      },
      submit: 'common.save',
      onChange: () => redraw(),
      onSubmit: async (values, changed) => {
        if (!Object.keys(changed).length) {
          toast(t('adm.nothing_changed'), { type: 'info' });
          return false;
        }
        const patch = {};
        for (const [key, v] of Object.entries(changed)) patch[key] = v === null ? 0 : v;
        const res = await api.put('/admin/bonus/settings', patch);
        if (!alive) return true;
        data.settings = res.settings || data.settings;
        toast(t('admin.set_saved'), { type: 'ok' });
        // Сводка считается по журналу, но значок «включено» и пояснения
        // зависят от настроек — перечитываем раздел целиком.
        load(false);
        return true;
      },
    });
    forms.push(form);

    const box = el('div', { className: 'hints' },
      hintNode('percent'), hintNode('share'), hintNode('expire'),
      hintNode('invite'), hintNode('review'), hintNode('signup'));

    function redraw() {
      const v = form.values();
      const day = 86400;
      const now = Math.floor(Date.now() / 1000);
      const till = now + Math.max(1, Number(v.expire_days) || 1) * day;
      hints.percent.textContent = t('abn.ex_percent', {
        total: money(BONUS_SAMPLE),
        sum: money(cashback(BONUS_SAMPLE, v.percent)),
      });
      hints.share.textContent = t('abn.ex_share', {
        total: money(BONUS_SAMPLE),
        sum: money(cashback(BONUS_SAMPLE, v.max_share)),
      });
      hints.expire.textContent = t('abn.ex_expire', {
        date: fmtDate(till),
        warn: fmtDate(till - Math.max(0, Number(v.warn_days) || 0) * day),
      });
      hints.invite.textContent = t('abn.ex_invite', {
        sum: money((Number(v.invite_friend) || 0) + (Number(v.invite_owner) || 0)),
        friend: money(v.invite_friend || 0),
        owner: money(v.invite_owner || 0),
      });
      hints.review.textContent = t('abn.ex_review', { sum: money(v.review || 0) });
      hints.signup.textContent = (Number(v.signup) || 0) > 0
        ? t('abn.ex_signup', { sum: money(v.signup) })
        : t('abn.ex_signup_off');
    }

    redraw();
    return panel(t('abn.rules'),
      el('span', { className: 'badge ' + (s.enabled ? 'badge--ok' : 'badge--warn') },
        s.enabled ? t('abn.on') : t('abn.off')),
      s.enabled ? null : el('p', { className: 'note note--warn' }, t('abn.off_note')),
      form.el, box);
  }

  function moneyBlock() {
    const burn = el('button', {
      className: 'btn btn--ghost btn--sm', type: 'button',
      onClick: async () => {
        if (!(await ask({ title: t('abn.expire_run'), text: t('abn.expire_ask'),
          ok: t('abn.expire_run'), cancel: t('common.cancel'), danger: true }))) return;
        burn.disabled = true;
        try {
          const res = await api.post('/admin/bonus/expire', {});
          toast(res.burned
            ? t('abn.expire_done', { n: num(res.burned), sum: money(res.amount || 0) })
            : t('abn.expire_none'), { type: 'ok' });
          load(false);
        } catch (e) {
          toast(errText(e), { type: 'err' });
        } finally {
          burn.disabled = false;
        }
      },
    }, t('abn.expire_run'));

    const tiles = el('div', { className: 'tiles tiles--sm' },
      tile(t('abn.issued'), money(data.issued || 0)),
      tile(t('abn.spent'), money(data.spent || 0)),
      tile(t('abn.burned'), money(data.burned || 0)),
      tile(t('abn.live'), money(data.live || 0), t('abn.live_hint')));

    const counts = el('div', { className: 'row gap-2 wrap' },
      el('span', { className: 'badge' }, t('abn.clients') + ': ' + num(data.clients || 0)),
      el('span', { className: 'badge' }, t('abn.invites') + ': ' + num(data.invites || 0)),
      el('span', { className: 'badge badge--ok' },
        t('abn.invites_paid') + ': ' + num(data.invites_paid || 0)));

    return panel(t('abn.money'), burn, tiles, counts);
  }

  function movesBlock() {
    const moves = data.moves || [];
    const csv = csvButton(() => ({
      name: 'sprintergo-bonus.csv',
      header: [t('abn.col_when'), t('abn.col_who'), t('common.phone'), t('abn.col_what'),
        t('abn.col_sum'), t('abn.col_rest'), t('admin.col_id')],
      rows: moves.map((m) => [dateTime(m.at), m.client || '', m.phone || '', m.text || '',
        tiyinToSom(m.amount), tiyinToSom(m.balance), m.order || '']),
    }));

    if (!moves.length) {
      return panel(t('abn.moves'), csv, emptyBox(t('abn.moves_empty')));
    }

    const table = dataTable([
      {
        key: 'at', label: t('abn.col_when'),
        cell: (r) => el('span', { title: dateTime(r.at) }, timeAgo(r.at)),
      },
      {
        key: 'client', label: t('abn.col_who'),
        cell: (r) => el('span', { className: 'truncate' },
          r.client || fmtPhone(r.phone) || '—'),
      },
      { key: 'text', label: t('abn.col_what'), cell: (r) => r.text || '—', wide: true },
      {
        key: 'amount', label: t('abn.col_sum'), num: true,
        cell: (r) => el('b', { className: (r.amount || 0) < 0 ? 'amt amt--out' : 'amt amt--in' },
          ((r.amount || 0) > 0 ? '+' : '') + money(r.amount || 0)),
      },
      { key: 'balance', label: t('abn.col_rest'), num: true, cell: (r) => money(r.balance || 0), hide: true },
    ], moves, {
      onRow: (r) => { if (r.phone) ctx.go('/clients', { q: r.phone }); },
    });

    return panel(t('abn.moves'), csv, table);
  }

  function paint() {
    for (const f of forms) f.destroy();
    forms = [];
    body.replaceChildren(rulesBlock(), moneyBlock(), movesBlock());
  }

  load();
  return () => {
    alive = false;
    for (const f of forms) f.destroy();
    forms = [];
  };
}

/* ═══════════════════════════════════════════════════════ отчёты */

const repState = { period: 'month', from: '', to: '' };

export function renderReports(host, ctx) {
  let alive = true;
  const tools = el('div', { className: 'col gap-2' });
  const body = el('div', { className: 'col gap-4' });
  host.replaceChildren(el('div', { className: 'sect' },
    sectionTitle(t('rep.title')), tools, body));

  function params() {
    if (repState.from || repState.to) {
      return { from: repState.from || null, to: repState.to || null };
    }
    return { period: repState.period };
  }

  function paintTools() {
    const days = el('div', { className: 'filters filters--dates' },
      dayInput(repState.from, (v) => { repState.from = v; paintTools(); load(); },
        t('admin.orders_from')),
      dayInput(repState.to, (v) => { repState.to = v; paintTools(); load(); },
        t('admin.orders_to')),
      (repState.from || repState.to) ? el('button', {
        className: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => {
          repState.from = '';
          repState.to = '';
          paintTools();
          load();
        },
      }, t('adm.reset_filters')) : null);

    tools.replaceChildren(
      periodChips(repState.from || repState.to ? '' : repState.period, (code) => {
        repState.period = code;
        repState.from = '';
        repState.to = '';
        paintTools();
        load();
      }),
      days);
  }

  async function load() {
    rowsSkeleton(body, 10);
    try {
      const [stats, first] = await Promise.all([
        api.get('/admin/stats', params()),
        api.get('/admin/couriers', { per_page: 100 }),
      ]);
      if (!alive) return;
      // Рейтинг и отказы лежат в списке курьеров, а он постраничный. Топ может
      // оказаться на второй странице, поэтому дочитываем — но не бесконечно.
      let couriers = first.items || [];
      const pages = Math.min(Number(first.pages) || 1, 5);
      if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 },
          (unused, i) => api.get('/admin/couriers', { per_page: 100, page: i + 2 })));
        if (!alive) return;
        for (const page of rest) couriers = couriers.concat(page.items || []);
      }
      paint(stats, couriers);
    } catch (e) {
      if (!alive || (e instanceof ApiError && e.isAuth)) return;
      body.replaceChildren(failBox(e, load));
    }
  }

  function paint(stats, couriers) {
    const period = stats.period || {};
    const off = Number(period.tz_offset) || 0;
    const tail = dayIso(period.from, off) + '_' + dayIso(Math.max(0, (period.to || 0) - 1), off);
    const fileName = (part) => 'sprintergo-' + part + '-' + tail + '.csv';

    const m = stats.money || {};
    const o = stats.orders || {};
    const conv = stats.conversion || {};

    /* ── итоги ─────────────────────────────────────────────────────── */
    const totals = [
      [t('rep.revenue'), tiyinToSom(m.revenue || 0)],
      [t('rep.commission'), tiyinToSom(m.commission || 0)],
      [t('rep.payout'), tiyinToSom(m.payout || 0)],
      [t('rep.avg'), tiyinToSom(m.avg_check || 0)],
      [t('rep.orders'), String(o.total || 0)],
      [t('rep.done'), String(o.done || 0)],
      [t('rep.cancelled'), String(o.cancelled || 0)],
      [t('rep.expired'), String(o.expired || 0)],
      [t('rep.conv'), String(conv.percent || 0).replace('.', ',') + '%'],
    ];

    const moneyBlock = panel(t('rep.money'),
      csvButton(() => ({
        name: fileName('itogi'),
        header: [t('rep.col_metric'), t('rep.col_value')],
        rows: totals,
      })),
      el('div', { className: 'tiles' },
        tile(t('rep.revenue'), money(m.revenue || 0), t('rep.revenue_hint')),
        tile(t('rep.commission'), money(m.commission || 0),
          t('rep.payout') + ': ' + money(m.payout || 0)),
        tile(t('rep.avg'), money(m.avg_check || 0)),
        tile(t('rep.orders'), num(o.total || 0),
          t('rep.done') + ': ' + num(o.done || 0)),
        tile(t('rep.cancelled'), num(o.cancelled || 0),
          t('rep.expired') + ': ' + num(o.expired || 0)),
        tile(t('rep.conv'), String(conv.percent || 0).replace('.', ',') + '%',
          t('rep.conv_hint'))));

    /* ── по дням ───────────────────────────────────────────────────── */
    const byDay = stats.by_day || [];
    const dayItems = byDay.map((d) => ({
      label: (d.d || '').slice(8),
      value: d.revenue || 0,
      note: tp(d.n || 0, 'common.n_order'),
    }));
    const dayBlock = panel(t('rep.by_day'),
      csvButton(() => ({
        name: fileName('po-dnyam'),
        header: [t('rep.col_date'), t('rep.col_orders'), t('rep.col_sum')],
        rows: byDay.map((d) => [d.d, d.n || 0, tiyinToSom(d.revenue || 0)]),
      })),
      el('p', { className: 'muted t-sm' }, t('rep.by_day_hint')),
      dayItems.length
        ? plot({ items: dayItems, kind: 'line', format: money, axis: moneyShort })
        : emptyBox(t('rep.empty')));

    /* ── по часам ──────────────────────────────────────────────────── */
    const byHour = stats.by_hour || [];
    const hourItems = byHour.map((h) => ({
      label: String(h.hour).padStart(2, '0'),
      value: h.orders || 0,
      note: money(h.total || 0),
    }));
    const hourBlock = panel(t('rep.by_hour'),
      csvButton(() => ({
        name: fileName('po-chasam'),
        header: [t('rep.col_hour'), t('rep.col_orders'), t('rep.col_sum')],
        rows: byHour.map((h) => [String(h.hour).padStart(2, '0') + ':00',
          h.orders || 0, tiyinToSom(h.total || 0)]),
      })),
      el('p', { className: 'muted t-sm' }, t('rep.by_hour_hint')),
      plot({ items: hourItems, dense: true, axis: num, format: (v) => tp(v, 'common.n_order') }));

    /* ── по дням недели ────────────────────────────────────────────── */
    /* Сервер отдаёт дни как есть; неделю собираем из них сами — для этого
       достаточно даты, а лишний запрос гонять незачем. */
    const dow = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ n: 0, revenue: 0, i }));
    for (const d of byDay) {
      const parts = String(d.d || '').split('-');
      if (parts.length !== 3) continue;
      const js = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
      const idx = (js.getUTCDay() + 6) % 7;        // понедельник первым
      dow[idx].n += d.n || 0;
      dow[idx].revenue += d.revenue || 0;
    }
    const dowBlock = panel(t('rep.by_dow'),
      csvButton(() => ({
        name: fileName('po-dnyam-nedeli'),
        header: [t('rep.col_dow'), t('rep.col_orders'), t('rep.col_sum')],
        rows: dow.map((d) => [t('rep.dow_' + d.i), d.n, tiyinToSom(d.revenue)]),
      })),
      plot({
        items: dow.map((d) => ({
          label: t('rep.dow_' + d.i), value: d.n, note: money(d.revenue),
        })),
        axis: num,
        format: (v) => tp(v, 'common.n_order'),
      }));

    /* ── по тарифам ────────────────────────────────────────────────── */
    const byTariff = stats.by_tariff || [];
    const tariffTotal = byTariff.reduce((acc, r) => acc + (r.n || 0), 0);
    const tariffName = (r) => localName(r) || r.code || '—';
    const tariffBlock = panel(t('rep.by_tariff'),
      csvButton(() => ({
        name: fileName('po-tarifam'),
        header: [t('rep.col_tariff'), t('rep.col_orders'), t('rep.col_done'),
          t('rep.col_sum'), t('rep.col_share')],
        rows: byTariff.map((r) => [tariffName(r), r.n || 0, r.done || 0,
          tiyinToSom(r.total || 0), pctOf(r.n, tariffTotal)]),
      })),
      byTariff.length ? el('div', { className: 'col gap-3' },
        plot({
          items: byTariff.map((r) => ({
            label: tariffName(r), value: r.n || 0, note: money(r.total || 0),
          })),
          axis: num,
          format: (v) => tp(v, 'common.n_order'),
        }),
        dataTable([
          { key: 'name', label: t('rep.col_tariff'), cell: tariffName, wide: true },
          { key: 'n', label: t('rep.col_orders'), num: true, cell: (r) => num(r.n || 0) },
          { key: 'done', label: t('rep.col_done'), num: true, cell: (r) => num(r.done || 0) },
          { key: 'total', label: t('rep.col_sum'), num: true, cell: (r) => money(r.total || 0) },
          { key: 'share', label: t('rep.col_share'), num: true, cell: (r) => pctOf(r.n, tariffTotal) },
        ], byTariff))
        : emptyBox(t('rep.empty')));

    /* ── топ курьеров ──────────────────────────────────────────────── */
    const byId = new Map(couriers.map((c) => [c.id, c]));
    const top = (stats.couriers || {}).top || [];
    const declineOf = (row) => {
      const c = byId.get(row.id);
      if (!c || !c.offers_sent) return null;
      return 1 - (Number(c.acceptance) || 0);
    };
    const ratingOf = (row) => {
      const c = byId.get(row.id);
      return c && c.rating ? c.rating : null;
    };
    const topBlock = panel(t('rep.top'),
      csvButton(() => ({
        name: fileName('kurery'),
        header: [t('rep.col_courier'), t('common.phone'), t('rep.col_orders'),
          t('rep.col_sum'), t('adm.ov_payout'), t('rep.col_rating'), t('rep.col_decline')],
        rows: top.map((r) => {
          const d = declineOf(r);
          return [r.name || '', r.phone || '', r.n || 0, tiyinToSom(r.revenue || 0),
            tiyinToSom(r.payout || 0), ratingOf(r) === null ? '' : String(ratingOf(r)).replace('.', ','),
            d === null ? '' : Math.round(d * 100) + '%'];
        }),
      })),
      el('p', { className: 'muted t-sm' }, t('rep.top_hint')),
      top.length ? dataTable([
        {
          key: 'name', label: t('rep.col_courier'),
          cell: (r) => el('div', { className: 'row gap-2' }, avatarFor(r.name),
            el('span', { className: 'truncate' }, r.name || '—')),
          wide: true,
        },
        { key: 'n', label: t('rep.col_orders'), num: true, cell: (r) => num(r.n || 0) },
        { key: 'revenue', label: t('rep.col_sum'), num: true, cell: (r) => money(r.revenue || 0) },
        {
          key: 'payout', label: t('adm.ov_payout'), num: true,
          cell: (r) => money(r.payout || 0), hide: true,
        },
        {
          key: 'rating', label: t('rep.col_rating'), num: true,
          cell: (r) => (ratingOf(r) === null ? '—' : String(ratingOf(r)).replace('.', ',')),
        },
        {
          key: 'decline', label: t('rep.col_decline'), num: true,
          cell: (r) => {
            const d = declineOf(r);
            if (d === null) return '—';
            const share = Math.round(d * 100);
            return el('span', {
              className: 'badge ' + (share > 50 ? 'badge--err' : share > 25 ? 'badge--warn' : 'badge--ok'),
              title: t('rep.decline_hint'),
            }, share + '%');
          },
        },
      ], top, { onRow: (r) => ctx.go('/couriers/' + r.id) })
        : emptyBox(t('rep.empty')));

    /* ── клиенты ───────────────────────────────────────────────────── */
    const c = stats.clients || {};
    const perClient = ((c.orders_per_client || 0) / 100).toFixed(2).replace('.', ',');
    const clientRows = [
      [t('rep.cli_new'), String(c.new || 0)],
      [t('rep.cli_back'), String(c.returning || 0)],
      [t('rep.cli_active'), String(c.active || 0)],
      [t('rep.cli_repeat'), String(c.repeat || 0)],
      [t('rep.cli_per'), perClient],
    ];
    const fresh = Math.max(0, (c.active || 0) - (c.returning || 0));
    const clientsBlock = panel(t('rep.clients'),
      csvButton(() => ({
        name: fileName('klienty'),
        header: [t('rep.col_metric'), t('rep.col_value')],
        rows: clientRows,
      })),
      el('p', { className: 'muted t-sm' }, t('rep.cli_hint')),
      el('div', { className: 'tiles tiles--sm' },
        tile(t('rep.cli_new'), num(c.new || 0)),
        tile(t('rep.cli_back'), num(c.returning || 0),
          pctOf(c.returning || 0, c.active || 0)),
        tile(t('rep.cli_repeat'), num(c.repeat || 0)),
        tile(t('rep.cli_per'), perClient)),
      plot({
        items: [
          { label: t('rep.cli_new'), value: fresh },
          { label: t('rep.cli_back'), value: c.returning || 0 },
        ],
        format: (v) => num(v),
      }));

    /* ── отмены ────────────────────────────────────────────────────── */
    const cancels = stats.cancels || {};
    const steps = cancels.by_step || {};
    const whom = cancels.by_whom || {};
    const reasons = cancels.reasons || [];
    // Под столбцом помещается одно-два слова, поэтому у шага есть короткое имя
    // для подписи и полное — для подсказки и выгрузки.
    const stepItems = [
      { label: t('rep.step_before'), short: t('rep.step_before_s'), value: steps.before_search || 0 },
      { label: t('rep.step_search'), short: t('rep.step_search_s'), value: steps.searching || 0 },
      { label: t('rep.step_assigned'), short: t('rep.step_assigned_s'), value: steps.assigned || 0 },
    ];
    // Незнакомого «кто отменил» быть не должно, но если сервер добавит нового,
    // покажем код как есть, а не пустое место.
    const WHOM = { client: 'rep.whom_client', courier: 'rep.whom_courier',
      admin: 'rep.whom_admin', system: 'rep.whom_system' };
    const whomName = (code) => (WHOM[code] ? t(WHOM[code]) : code);
    const cancelBlock = panel(t('rep.cancels'),
      csvButton(() => ({
        name: fileName('otmeny'),
        header: [t('rep.col_reason'), t('rep.col_count'), t('rep.col_share')],
        rows: reasons.map((r) => [r.reason === '—' ? t('rep.no_reason') : r.reason,
          r.count, pctOf(r.count, cancels.total || 0)])
          .concat(stepItems.map((s) => [s.label, s.value, pctOf(s.value, cancels.total || 0)])),
      })),
      el('p', { className: 'muted t-sm' }, t('rep.cancels_hint')),
      el('div', { className: 'row gap-2 wrap' },
        el('span', { className: 'badge badge--err' },
          t('rep.cancelled') + ': ' + num(cancels.total || 0)),
        ...Object.keys(whom).map((code) => el('span', { className: 'badge' },
          whomName(code) + ': ' + num(whom[code])))),
      (cancels.total || 0) ? el('div', { className: 'col gap-3' },
        plot({
          items: stepItems.map((s) => ({
            label: s.short, value: s.value,
            note: s.label + ' · ' + pctOf(s.value, cancels.total || 0),
          })),
          format: (v) => num(v),
        }),
        reasons.length ? dataTable([
          {
            key: 'reason', label: t('rep.col_reason'), wide: true,
            cell: (r) => (r.reason === '—' ? t('rep.no_reason') : r.reason),
          },
          { key: 'count', label: t('rep.col_count'), num: true, cell: (r) => num(r.count) },
          {
            key: 'share', label: t('rep.col_share'), num: true,
            cell: (r) => pctOf(r.count, cancels.total || 0),
          },
        ], reasons) : null)
        : emptyBox(t('rep.empty')));

    body.replaceChildren(moneyBlock, dayBlock, hourBlock, dowBlock,
      tariffBlock, topBlock, clientsBlock, cancelBlock);
  }

  paintTools();
  load();
  return () => { alive = false; };
}
