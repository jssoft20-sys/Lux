/* Оформление заказа: адреса, машина, грузчики, допуслуги и контакты.

   Экран собран из трёх шагов внутри одной шторки: адреса → машина → контакты.
   Шаги не перерисовываются целиком на каждое событие: пока шаг тот же, меняются
   только те узлы, где действительно новые данные. Иначе на каждом пересчёте цены
   у человека дёргалась бы карусель и слетал фокус из поля.

   Цену считает сервер. Здесь она только показывается: перед созданием заказа
   бэкенд пересчитает всё заново по своим тарифам.
*/

import { api } from '../core/api.js';
import { t, tp, getLang } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import { el, toast, sheet, haptic } from '../core/ui.js';
import { pin } from '../core/map.js';
import { money, num, distance, duration } from '../core/fmt.js';
import { icon, iconBtn, errText, nameOf } from './app.js';
import { pickAddress, rememberPoint } from './address.js';

const QUOTE_PAUSE = 350;       // пауза перед пересчётом цены, чтобы не дёргать сервер
const MAX_LOADERS = 8;

/* ─────────────────────────────────────────────────────── мелочи */

function digits(s) {
  return String(s || '').replace(/\D/g, '');
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
  const tariffs = app.tariffs.filter((x) => x && x.id);
  const store = createStore({
    step: 'addr',
    points: [null, null],
    tariffId: tariffs.length ? tariffs[0].id : 0,
    loaders: 0,
    extras: {},                 // код услуги → количество
    route: null,
    prices: {},                 // id тарифа → итог в тыйынах
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

  function schedulePrice() {
    clearTimeout(quoteTimer);
    const state = store.get();
    if (!ready(state) || !tariffs.length) {
      store.set({ prices: {}, quote: null, priceState: 'idle', priceError: null });
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
    let quote = null;
    let fail = null;
    for (const a of answers) {
      if (a.r) {
        prices[a.id] = a.r.total;
        if (a.id === state.tariffId) quote = a.r;
      } else if (a.e && a.e.code !== 'aborted') {
        fail = a.e;
      }
    }
    if (!Object.keys(prices).length) {
      store.set({ priceState: 'err', priceError: fail, quote: null });
      return;
    }
    store.set({ prices, quote, priceState: 'ok', priceError: null });
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
    // не доскроллив список до конца.
    const value = el('span', { className: 'sg-total__val' }, priceText(store.get()));
    const sum = el('div', { className: 'sg-total' },
      el('span', { className: 'sg-total__name' }, t('order.price_total')), value);
    const off = store.on((s) => { value.textContent = priceText(s); });

    sheet({
      title: t('order.extras'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, t('order.extras_hint')), list),
      actions: [sum, { label: t('common.done'), kind: 'primary' }],
      onClose: off,
    });
  }

  function priceText(state) {
    const v = total(state);
    if (state.priceState === 'err') return t('common.error');
    return v === null ? '—' : money(v);
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
    const cards = el('div', { className: 'sg-tariffs' });
    const loadersSub = el('div', { className: 'sg-opt__sub' });
    const extrasSub = el('div', { className: 'sg-opt__sub' });
    const note = el('div', { className: 'sg-note' }, t('order.price_note'));
    const retry = el('button', {
      type: 'button', className: 'btn btn--ghost btn--block', hidden: true,
      onClick: () => schedulePrice(),
    }, t('common.retry'));
    const priceBox = el('span', { className: 'sg-cta__price' }, '—');
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

    function paintCards(state) {
      const key = tariffs.map((x) => x.id).join(',') + '|' + getLang();
      if (key !== builtFor) {
        builtFor = key;
        cards.replaceChildren(...tariffs.map((tf) => {
          const price = el('span', { className: 'sg-tariff__price' }, '—');
          // На карточке помещается только самое важное — сколько машина увезёт.
          const cap = tf.capacity_kg
            ? num(tf.capacity_kg) + ' ' + t('common.kg')
            : nameOf(tf, 'desc');
          const card = el('button', {
            type: 'button', className: 'sg-tariff', dataset: { id: String(tf.id) },
            onClick: () => {
              if (store.get().tariffId === tf.id) return;
              haptic();
              store.set({ tariffId: tf.id });
              schedulePrice();
              card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            },
          },
            el('span', { className: 'sg-tariff__icon', html: icon(tf.icon || 'van') }),
            el('span', { className: 'sg-tariff__name' }, nameOf(tf)),
            el('span', { className: 'sg-tariff__sub' }, cap),
            price);
          return card;
        }));
      }
      for (const card of cards.children) {
        const id = Number(card.dataset.id);
        card.classList.toggle('is-on', id === state.tariffId);
        const price = card.lastElementChild;
        const v = state.prices[id];
        const wait = state.priceState === 'wait' || state.priceState === 'idle';
        price.classList.toggle('is-wait', typeof v !== 'number' && wait);
        price.textContent = typeof v === 'number' ? money(v) : (wait ? '—' : t('common.error'));
      }
    }

    function update(state) {
      const pts = state.points.filter(Boolean);
      const first = pts[0];
      const last = pts[pts.length - 1];
      routeRow.replaceChildren(
        el('span', { className: 'sg-route__line' },
          el('i', null), el('b', null), el('i', null)),
        el('span', { className: 'sg-route__text' },
          el('span', { className: 'sg-route__row' }, (first && first.addr) || t('order.from')),
          el('span', { className: 'sg-route__row' }, (last && last.addr) || t('order.to'))),
        state.route
          ? el('span', { className: 'sg-route__meta' },
              distance(state.route.distance_m), el('br', null), duration(state.route.duration_s))
          : el('span', { className: 'sg-opt__go', html: icon('go') }),
      );

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
      priceBox.classList.toggle('is-wait', sum === null && wait);
      priceBox.textContent = sum === null ? (wait ? '' : '—') : money(sum);
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
      priceBox.classList.toggle('is-wait', sum === null && wait);
      priceBox.textContent = sum === null ? (wait ? '' : '—') : money(sum);
      refreshCta();
      app.panel.refresh();
    }

    return { name: 'confirm', node, update };
  }

  /* ── сборка ──────────────────────────────────────────────────────────── */

  const BUILD = { addr: stepAddr, tariff: stepTariff, confirm: stepConfirm };

  function render(state, back) {
    if (!view || view.name !== state.step) {
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
      if (app.cancelPick) app.cancelPick();
    },
  };
}

export default mountOrder;
