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
import { el, toast, sheet, confirm as ask, skeleton, haptic, mountStars } from '../core/ui.js';
import {
  money, num, distance as fmtDistance, duration as fmtDuration,
  time as fmtTime, date as fmtDate, dateTime, timeAgo, phone as fmtPhone,
  plate as fmtPlate, initials,
} from '../core/fmt.js';
import { createMap, pin } from '../core/map.js';
import { getLang } from '../core/i18n.js';
import {
  t, tp, createForm, quoteTariff, tiyinToSom, errText, parseNum,
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
