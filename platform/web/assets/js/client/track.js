/* Отслеживание заказа: поиск машины, курьер на карте, статусы и оценка.

   Экран живёт на потоке событий: сервер сам присылает смену статуса и координаты
   машины, поэтому опроса здесь нет вовсе. Если связь оборвалась, core/api.js
   переподключится сам, а мы честно показываем полоску «нет связи».
*/

import { api } from '../core/api.js';
import { t, has, getLang } from '../core/i18n.js';
import { createStore } from '../core/store.js';
import { el, toast, sheet, haptic, mountStars } from '../core/ui.js';
import { pin, distanceM } from '../core/map.js';
import { money, distance, duration, plate as fmtPlate, initials } from '../core/fmt.js';
import { icon, iconBtn, errText } from './app.js';

/* Статусы, после которых заказ больше не меняется. */
const CLOSED = ['done', 'cancelled', 'expired'];

/* Сколько едет машина между двумя точками от сервера: координаты приходят раз
   в несколько секунд, и такая длительность выглядит как непрерывное движение. */
const CAR_MOVE_MS = 1400;

/* Заголовок шторки и подсказка под ним для каждого статуса. */
const HEAD = {
  draft: ['track.searching', 'track.searching_hint'],
  searching: ['track.searching', 'track.searching_hint'],
  assigned: ['track.found', 'track.assigned_hint'],
  to_pickup: ['track.to_pickup', ''],
  at_pickup: ['track.at_pickup', 'track.loading'],
  in_transit: ['track.in_transit', ''],
  at_dropoff: ['track.at_dropoff', ''],
  done: ['track.done', ''],
  cancelled: ['track.cancelled', ''],
  expired: ['track.expired', 'track.expired_hint'],
};

export function mountTrack(app, pid, token) {
  const store = createStore({
    order: null,
    loading: true,
    error: null,
    online: true,
    rated: false,
  });

  let view = null;
  let stream = null;
  let dead = false;
  let markers = [];
  let line = null;
  let radar = null;
  let car = null;
  let mapKey = '';

  /* ── карта ───────────────────────────────────────────────────────────── */

  function points(order) {
    return (order && Array.isArray(order.points) ? order.points : [])
      .filter((p) => p && p.lat != null);
  }

  function syncMap(order) {
    if (!order) return;
    const pts = points(order);
    const key = order.status + '|' + pts.map((p) => p.lat.toFixed(5) + p.lng.toFixed(5)).join(';');
    if (key !== mapKey) {
      mapKey = key;
      for (const m of markers) m.remove();
      markers = pts.map((p, i) => app.marker({
        at: [p.lat, p.lng],
        html: i === 0 ? pin('a') : pin('b', pts.length > 2 ? String(i + 1) : ''),
        anchor: i === 0 ? 'center' : 'bottom',
        zIndex: 10 + i,
      }));

      const path = Array.isArray(order.route) && order.route.length > 1 ? order.route : null;
      if (path) {
        if (line) line.setCoords(path);
        else line = app.route(path, { width: 6 });
      }

      // Пока ищем машину, вокруг точки подачи расходятся круги — видно, что работа идёт.
      const searching = order.status === 'searching' || order.status === 'draft';
      if (searching && pts.length && !radar) {
        radar = app.marker({ at: [pts[0].lat, pts[0].lng], html: '<span class="sg-radar"></span>', zIndex: 30 });
      }
      if (!searching && radar) { radar.remove(); radar = null; }

      fitAll(order);
    }

    const at = order.courier && order.courier.at;
    if (at && at[0] != null) {
      if (!car) {
        car = app.marker({ at, html: pin('car'), rotate: true, zIndex: 40 });
        fitAll(order);
      } else {
        car.moveTo(at, { duration: CAR_MOVE_MS, heading: order.courier.heading });
      }
    } else if (car) {
      car.remove();
      car = null;
    }
  }

  function fitAll(order) {
    const pts = points(order).map((p) => [p.lat, p.lng]);
    const at = order.courier && order.courier.at && order.courier.at[0] != null
      ? [order.courier.at] : [];
    if (order.status === 'searching' || order.status === 'draft') {
      if (pts.length) app.fit([pts[0]], { zoom: 15.5, maxZoom: 15.5 });
      return;
    }
    if (order.status === 'assigned' || order.status === 'to_pickup') {
      const set = at.concat(pts.slice(0, 1));
      app.fit(set.length ? set : pts);
      return;
    }
    const path = Array.isArray(order.route) && order.route.length > 1 ? order.route : pts;
    app.fit(at.concat(path));
  }

  /* ── загрузка и поток ────────────────────────────────────────────────── */

  async function load() {
    store.set({ loading: true, error: null });
    try {
      const order = await api.get('/orders/' + encodeURIComponent(pid),
                                  { t: token, lang: getLang() });
      if (dead) return;
      store.set({ order, loading: false, rated: !!order.rating });
      if (CLOSED.indexOf(order.status) >= 0) app.forgetOrder();
      else app.saveOrder(pid, token);
      listen();
    } catch (e) {
      if (dead) return;
      store.set({ loading: false, error: e });
      if (e && (e.status === 404 || e.status === 403)) app.forgetOrder();
    }
  }

  /* Одиночный обрыв потока — обычное дело в лифте и в метро: core/api.js
     переподключится сам. Пугаем человека полоской «нет связи» только если
     за три секунды связь так и не вернулась. */
  let offTimer = 0;
  function markOffline() {
    clearTimeout(offTimer);
    offTimer = setTimeout(() => { if (!dead) store.set({ online: false }); }, 3000);
  }
  function markOnline() {
    clearTimeout(offTimer);
    offTimer = 0;
    store.set({ online: true });
  }

  function listen() {
    if (stream || dead) return;
    stream = api.stream('/orders/' + encodeURIComponent(pid) + '/stream', {
      auth: false,
      params: { t: token, lang: getLang() },
      events: ['search_failed'],
      onOpen: markOnline,
      onError: markOffline,
      onEvent: (name, data) => {
        if (dead || !data || typeof data !== 'object') return;
        if (name === 'order') {
          const merged = Object.assign({}, store.get().order || {}, data);
          markOnline();
          store.set({ order: merged });
          if (CLOSED.indexOf(merged.status) >= 0) app.forgetOrder();
          return;
        }
        if (name === 'geo' && data.at) {
          const order = store.get().order;
          if (!order || !order.courier) return;
          const courier = Object.assign({}, order.courier, {
            at: data.at, heading: data.heading, geo_at: data.geo_at,
          });
          store.set({ order: Object.assign({}, order, { courier }) });
          return;
        }
        if (name === 'search_failed') {
          markOnline();
          toast(data.message || t('track.expired'), { type: 'warn' });
        }
      },
    });
  }

  /* ── действия ────────────────────────────────────────────────────────── */

  function shareLink() {
    const url = location.origin + '/#/order/' + pid + '?t=' + encodeURIComponent(token);
    if (navigator.share) {
      navigator.share({ title: t('track.title', { id: pid }), url }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => toast(t('common.copied'), { type: 'ok' }))
        .catch(() => toast(url, { type: 'info', ms: 6000 }));
      return;
    }
    toast(url, { type: 'info', ms: 6000 });
  }

  /* Отмена: сначала спрашиваем причину, она помогает диспетчеру больше, чем факт отмены. */
  function askCancel() {
    const order = store.get().order || {};
    const free = !order.cancel_free_until ||
      Math.floor(Date.now() / 1000) <= order.cancel_free_until;
    const reasons = ['track.cancel_r1', 'track.cancel_r2', 'track.cancel_r3', 'track.cancel_r4'];
    let chosen = '';

    const chips = el('div', { className: 'sg-chips' });
    for (const key of reasons) {
      const chip = el('button', { type: 'button', className: 'chip' }, t(key));
      chip.addEventListener('click', () => {
        chosen = t(key);
        for (const other of chips.children) other.classList.toggle('chip--on', other === chip);
        haptic();
      });
      chips.appendChild(chip);
    }
    const more = el('textarea', {
      className: 'field__input', placeholder: ' ', maxLength: 300,
    });

    sheet({
      title: t('track.cancel_title'),
      content: el('div', null,
        el('p', { className: 'sheet__text' }, free ? t('track.cancel_free') : t('track.cancel_paid')),
        chips,
        el('label', { className: 'field' }, more,
          el('span', { className: 'field__label' }, t('track.cancel_reason')),
          el('span', { className: 'field__hint' }, t('track.cancel_reason_ph')))),
      actions: [
        { label: t('common.back'), kind: 'ghost' },
        {
          label: t('track.cancel'),
          kind: 'danger',
          onClick: async () => {
            const reason = [chosen, more.value.trim()].filter(Boolean).join('. ');
            try {
              const res = await api.post('/orders/' + encodeURIComponent(pid) + '/cancel',
                                         { reason, t: token, lang: getLang() });
              if (dead) return true;
              toast(res.message || t('track.cancelled_ok'), { type: 'ok' });
              if (res.order) store.set({ order: res.order });
              app.forgetOrder();
            } catch (e) {
              toast(errText(e), { type: 'err' });
              return false;                  // шторку не закрываем: причина ещё набрана
            }
            return true;
          },
        },
      ],
    });
  }

  /* Из чего сложилась цена: те же строки, что видит бухгалтерия в заказе. */
  function openDetails() {
    const order = store.get().order || {};
    const p = order.price || {};
    const rows = el('div', null);
    const add = (key, value) => {
      if (!value) return;
      rows.appendChild(el('div', { className: 'sg-sum' },
        el('span', { className: 'sg-sum__name' }, t(key)),
        el('span', { className: 'sg-sum__val' }, money(value))));
    };
    rows.appendChild(el('div', { className: 'sg-sum' },
      el('span', { className: 'sg-sum__name' }, t('order.distance')),
      el('span', { className: 'sg-sum__val' }, distance(order.distance_m || 0))));
    rows.appendChild(el('div', { className: 'sg-sum' },
      el('span', { className: 'sg-sum__name' }, t('order.duration')),
      el('span', { className: 'sg-sum__val' }, duration(order.duration_s || 0))));
    add('order.price_base', p.base);
    add('order.price_distance', p.distance);
    add('order.price_time', p.time);
    add('order.price_loaders', p.loaders);
    add('order.price_extras', p.extras);
    add('order.price_waiting', p.waiting);
    rows.appendChild(el('div', { className: 'sg-sum sg-sum--total' },
      el('span', { className: 'sg-sum__name' }, t('order.price_total')),
      el('span', { className: 'sg-sum__val' }, money(p.total || order.price_total || 0))));

    sheet({
      title: t('track.details'),
      content: el('div', null, rows,
        el('p', { className: 'sheet__text', style: { paddingTop: 'var(--sp-3)' } },
           t('order.price_note'))),
      actions: [{ label: t('common.close'), kind: 'ghost' }],
    });
  }

  /* ── куски интерфейса ────────────────────────────────────────────────── */

  function headBox(status, order) {
    // Незнакомый статус — берём общее название из словаря, лишь бы не ключ на экране.
    const fallback = has('status.' + status) ? 'status.' + status : 'common.status';
    const pair = HEAD[status] || [fallback, ''];
    let sub = pair[1] ? t(pair[1]) : '';
    if (status === 'in_transit' && order && order.duration_s) {
      sub = t('track.eta_drop', { time: duration(order.duration_s) });
    }
    return el('div', { className: 'sg-head' },
      el('div', { className: 'sg-head__text' },
        el('div', { className: 'sg-head__title' }, t(pair[0])),
        sub ? el('div', { className: 'sg-head__sub' }, sub) : null));
  }

  function routeRow(order) {
    const pts = points(order);
    const first = pts[0] || {};
    const last = pts[pts.length - 1] || {};
    return el('button', { type: 'button', className: 'sg-route', onClick: openDetails },
      el('span', { className: 'sg-route__line' },
        el('i', null), el('b', null), el('i', null)),
      el('span', { className: 'sg-route__text' },
        el('span', { className: 'sg-route__row' }, first.addr || t('order.from')),
        el('span', { className: 'sg-route__row' }, last.addr || t('order.to'))),
      el('span', { className: 'sg-route__meta' }, distance(order.distance_m || 0)));
  }

  function priceRow(order) {
    const payKey = 'status.pay_' + (order.payment_status || 'none');
    const badge = order.payment_status && order.payment_status !== 'none' && has(payKey)
      ? el('span', { className: 'badge' }, t(payKey))
      : null;
    return el('button', { type: 'button', className: 'sg-opt', onClick: openDetails },
      el('span', { className: 'sg-opt__text' },
        el('span', { className: 'sg-opt__title' }, t('track.price')),
        el('span', { className: 'sg-opt__sub' }, t('order.price_details'))),
      badge,
      el('span', { className: 'sg-opt__total' }, money(order.price_total || 0)),
      el('span', { className: 'sg-opt__go', html: icon('go') }));
  }

  function courierCard(order) {
    const c = order.courier;
    if (!c) return null;
    const car2 = c.car || {};
    const avatar = el('span', { className: 'avatar avatar--lg' }, initials(c.name || ''));
    if (c.avatar) avatar.appendChild(el('img', { src: c.avatar, alt: '', loading: 'lazy' }));

    const stars = el('span');
    const gap = c.at && c.at[0] != null && points(order).length
      ? distanceM(c.at, [points(order)[0].lat, points(order)[0].lng])
      : 0;
    const near = gap > 60 && (order.status === 'assigned' || order.status === 'to_pickup');

    const rate = el('div', { className: 'sg-courier__rate' }, stars,
      el('span', null, String(Math.round((c.rating || 5) * 10) / 10).replace('.', ',')),
      near ? el('span', { className: 'badge badge--accent' }, distance(gap)) : null);

    const card = el('div', { className: 'sg-courier' },
      avatar,
      el('div', { className: 'sg-courier__text' },
        el('div', { className: 'sg-courier__name' }, c.name || t('track.courier')),
        el('div', { className: 'sg-courier__car' },
          el('span', { className: 'truncate' },
             [car2.model, car2.color].filter(Boolean).join(', ') || t('track.car')),
          car2.plate ? el('span', { className: 'sg-plate' }, fmtPlate(car2.plate)) : null),
        rate));

    mountStars(stars, { value: c.rating || 5, readonly: true });

    const acts = el('div', { className: 'sg-acts' });
    if (c.phone) {
      acts.appendChild(el('a', {
        className: 'btn btn--primary grow', href: 'tel:' + c.phone.replace(/[^\d+]/g, ''),
      }, el('span', { html: icon('phone') }), t('track.call')));
      acts.appendChild(el('a', {
        className: 'btn btn--ghost grow', target: '_blank', rel: 'noopener',
        href: 'https://wa.me/' + c.phone.replace(/\D/g, ''),
      }, el('span', { html: icon('chat') }), t('track.write')));
    }

    const box = el('div', null, card);
    if (acts.children.length) box.appendChild(acts);
    return box;
  }

  /* ── шаги ────────────────────────────────────────────────────────────── */

  function stepLoading() {
    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('track.title', { id: pid })),
          el('div', { className: 'sg-head__sub' }, t('common.loading')))),
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-wait' },
          el('div', { className: 'skeleton skeleton--box' }),
          el('div', { className: 'skeleton', style: { width: '64%' } }),
          el('div', { className: 'skeleton', style: { width: '40%' } }))),
      el('div', { className: 'sg-foot' }));
    return { name: 'loading', node, update() {} };
  }

  function stepError(e) {
    const gone = e && (e.status === 404 || e.status === 403);
    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-body' },
        el('div', { className: 'sg-fail' },
          el('div', { className: 'sg-fail__icon', html: icon('alert') }),
          el('div', { className: 'sg-fail__title' },
             gone ? t('track.not_found') : t('err.load_failed')),
          el('div', { className: 'sg-fail__text' },
             gone ? t('track.link_bad') : errText(e)))),
      el('div', { className: 'sg-foot' },
        gone ? null : el('button', {
          type: 'button', className: 'btn btn--ghost btn--lg btn--block', onClick: load,
        }, t('common.retry')),
        el('button', {
          type: 'button', className: 'sg-cta', onClick: () => { app.forgetOrder(); app.go('/'); },
        }, el('span', { className: 'sg-cta__label' }, t('order.submit')))));
    return { name: 'error', node, update() {} };
  }

  function stepSearch(order) {
    const line2 = el('div', { className: 'sg-search-line' },
      el('div', { className: 'progress progress--wait' }, el('div', { className: 'progress__bar' })));
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
      el('div', { className: 'sg-body' }, line2, routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' },
        el('button', {
          type: 'button', className: 'btn btn--danger btn--lg btn--block', onClick: askCancel,
        }, t('track.cancel'))));
    return { name: 'search', node, update() {} };
  }

  function stepLive(order) {
    const canCancel = !!order.can_cancel;
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
      el('div', { className: 'sg-body' },
        courierCard(order), routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' },
        el('div', { className: 'row gap-2' },
          el('button', {
            type: 'button', className: 'btn btn--ghost grow', onClick: shareLink,
          }, t('track.share')),
          canCancel ? el('button', {
            type: 'button', className: 'btn btn--danger grow', onClick: askCancel,
          }, t('track.cancel')) : null)));
    return { name: 'live:' + order.status, node, update() {} };
  }

  function stepDone(order) {
    const body = el('div', { className: 'sg-body' }, routeRow(order), priceRow(order));
    const foot = el('div', { className: 'sg-foot' });

    if (store.get().rated) {
      body.appendChild(el('div', { className: 'sg-rate' },
        el('div', { className: 'sg-fail__title' }, t('track.rate_thanks'))));
    } else {
      let value = 0;
      const stars = el('div');
      const comment = el('textarea', { className: 'field__input', placeholder: ' ', maxLength: 500 });
      const send = el('button', {
        type: 'button', className: 'sg-cta', disabled: true,
        onClick: async () => {
          send.disabled = true;
          try {
            const res = await api.post('/orders/' + encodeURIComponent(pid) + '/rate',
                                       { rating: value, comment: comment.value.trim(),
                                         t: token, lang: getLang() });
            if (dead) return;
            haptic(20);
            toast(res.message || t('track.rate_thanks'), { type: 'ok' });
            store.set({ rated: true });
          } catch (e) {
            toast(errText(e), { type: 'err' });
            send.disabled = false;
          }
        },
      }, el('span', { className: 'sg-cta__label' }, t('track.rate_send')));

      body.appendChild(el('div', { className: 'sg-rate' },
        el('div', { className: 'sg-head__title' }, t('track.rate_title')),
        stars,
        el('label', { className: 'field', style: { width: '100%' } }, comment,
          el('span', { className: 'field__label' }, t('common.comment')),
          el('span', { className: 'field__hint' }, t('track.rate_comment_ph')))));
      mountStars(stars, {
        value: 0, size: 'lg',
        onChange: (v) => { value = v; send.disabled = v < 1; },
      });
      foot.appendChild(send);
    }

    foot.appendChild(el('button', {
      type: 'button', className: 'btn btn--ghost btn--lg btn--block',
      onClick: () => { app.forgetOrder(); app.go('/'); },
    }, t('track.repeat')));

    const node = el('div', { className: 'sg-step' }, headBox('done', order), body, foot);
    return { name: 'done:' + (store.get().rated ? '1' : '0'), node, update() {} };
  }

  /* Оплата вперёд: пока деньги не пришли, поиск машины не стартует. Показываем,
     чего ждём, и даём вернуться на страницу банка. */
  function stepPay(order) {
    const pay = el('button', {
      type: 'button', className: 'sg-cta',
      onClick: async () => {
        pay.disabled = true;
        try {
          const res = await api.post('/payments/init',
                                     { public_id: pid, t: token, lang: getLang() });
          if (res && res.url) { location.href = res.url; return; }
          if (res && res.message) toast(res.message, { type: 'ok' });
          load();
        } catch (e) {
          toast(errText(e), { type: 'err' });
        }
        pay.disabled = false;
      },
    },
      el('span', { className: 'sg-cta__label' }, t('order.pay_online')),
      el('span', { className: 'sg-cta__price' }, money(order.price_total || 0)));

    const node = el('div', { className: 'sg-step' },
      el('div', { className: 'sg-head' },
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, t('status.pay_pending')))),
      el('div', { className: 'sg-body' }, routeRow(order), priceRow(order)),
      el('div', { className: 'sg-foot' }, pay,
        el('button', {
          type: 'button', className: 'btn btn--danger btn--block', onClick: askCancel,
        }, t('track.cancel'))));
    return { name: 'pay', node, update() {} };
  }

  function stepClosed(order) {
    const why = order.cancel_reason
      ? el('div', { className: 'sg-fail__text' }, order.cancel_reason)
      : null;
    const node = el('div', { className: 'sg-step' },
      headBox(order.status, order),
      el('div', { className: 'sg-body' }, why, routeRow(order)),
      el('div', { className: 'sg-foot' },
        el('button', {
          type: 'button', className: 'sg-cta',
          onClick: () => { app.forgetOrder(); app.go('/'); },
        }, el('span', { className: 'sg-cta__label' }, t('track.repeat')))));
    return { name: 'closed:' + order.status, node, update() {} };
  }

  /* ── сборка ──────────────────────────────────────────────────────────── */

  function build(state) {
    if (state.loading) return stepLoading();
    if (state.error) return stepError(state.error);
    const order = state.order || {};
    const s = order.status;
    if (s === 'done') return stepDone(order);
    if (s === 'cancelled' || s === 'expired') return stepClosed(order);
    if (s === 'draft' && order.payment_status === 'pending') return stepPay(order);
    if (s === 'searching' || s === 'draft') return stepSearch(order);
    return stepLive(order);
  }

  /* Полоска «нет связи» появляется поверх шага и уходит сама, когда поток ожил. */
  const offline = el('div', { className: 'sg-offline', hidden: true }, t('common.offline'));
  app.panel.el.querySelector('.sg-panel__box').prepend(offline);

  function render(state) {
    const next = build(state);
    if (!view || view.name !== next.name) {
      app.panel.show(next.node);
      view = next;
    } else {
      view.update(state);
      app.panel.refresh();
    }
    offline.hidden = state.online;
    if (state.order) syncMap(state.order);
  }

  store.on((state) => { if (!dead) render(state); });
  render(store.get());
  load();

  return {
    relang() {
      view = null;
      offline.textContent = t('common.offline');
      render(store.get());
    },
    destroy() {
      dead = true;
      clearTimeout(offTimer);
      if (stream) stream.close();
      stream = null;
      offline.remove();
    },
  };
}

export default mountTrack;
