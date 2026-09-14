/* Выбор адреса: поиск по подсказкам, недавние адреса и точка пальцем по карте.

   Экран занимает почти всю шторку и возвращает одну точку. Ждать ответа сервера
   на каждую букву нельзя: набирают быстро, а геокодер отвечает медленно, поэтому
   запрос уходит через четверть секунды тишины, а предыдущий отменяется.

   Здесь же живёт всё, что человек уточняет про точку: подъезд, квартира, этаж,
   лифт, домофон. Один раз вписанные, они остаются с адресом и подставляются
   сами, когда человек снова везёт что-то из дома или к себе домой.
*/

import { api } from '../core/api.js';
import { t, extend } from '../core/i18n.js';
import { el, toast, haptic } from '../core/ui.js';
import { icon, iconBtn, errText, readJson, writeJson, KEY_RECENT, dur } from './app.js';

/* Свои строки держим при себе: общий словарь правят соседние модули.
   Это короткие приписки к адресу, они идут через запятую в одну строку. */
extend({
  ru: {
    'pt.entrance': 'подъезд {v}',
    'pt.flat': 'кв. {v}',
    'pt.floor': '{v} этаж',
    'pt.intercom': 'домофон {v}',
    'pt.lift_yes': 'с лифтом',
    'pt.lift_no': 'без лифта',
    'pt.door': 'до двери',
  },
  ky: {
    'pt.entrance': '{v}-подъезд',
    'pt.flat': '{v}-батир',
    'pt.floor': '{v}-кабат',
    'pt.intercom': 'домофон {v}',
    'pt.lift_yes': 'лифти бар',
    'pt.lift_no': 'лифт жок',
    'pt.door': 'эшикке чейин',
  },
});

const TYPE_PAUSE = 250;      // столько тишины ждём перед запросом подсказок
const MOVE_PAUSE = 320;      // столько ждём после остановки карты перед геокодером
const RECENT_MAX = 8;

/* Что помним про дом вместе с адресом. Комментарий курьеру сюда не попадает —
   он про сегодняшний груз, а не про дом. «От двери до двери» тоже: это деньги,
   и человек включает их сам каждый раз, а не по памяти браузера. */
const DETAIL_KEYS = ['entrance', 'flat', 'floor', 'intercom'];

/* ─────────────────────────────────────────────────────── детали точки */

/** Подъезд, квартира, этаж и лифт из точки — только то, что реально заполнено. */
function details(point) {
  const out = {};
  if (!point) return out;
  for (const k of DETAIL_KEYS) {
    const v = point[k];
    if (v) out[k] = String(v).slice(0, 40);
  }
  if (point.lift === true || point.lift === false) out.lift = point.lift;
  return out;
}

/**
 * Всё уточнённое по адресу одной строкой: «подъезд 2, кв. 14, 5 этаж, без лифта».
 * Ею подписан адрес и в списке точек, и в недавних адресах.
 * opts.door = false — не поминать подъём к двери: там, где рядом стоит его
 * переключатель, повторять это в строке незачем.
 */
export function detailsLine(point, opts = {}) {
  if (!point) return '';
  const parts = [];
  if (point.entrance) parts.push(t('pt.entrance', { v: point.entrance }));
  if (point.flat) parts.push(t('pt.flat', { v: point.flat }));
  if (point.floor) parts.push(t('pt.floor', { v: point.floor }));
  if (point.lift === true) parts.push(t('pt.lift_yes'));
  if (point.lift === false) parts.push(t('pt.lift_no'));
  if (point.intercom) parts.push(t('pt.intercom', { v: point.intercom }));
  if (point.door && opts.door !== false) parts.push(t('pt.door'));
  return parts.join(', ');
}

/* ─────────────────────────────────────────────────────── недавние адреса */

export function recentPoints() {
  const list = readJson(KEY_RECENT, []);
  return Array.isArray(list) ? list.filter((p) => p && p.lat != null && p.lng != null) : [];
}

/** Запомнить выбранный адрес. Один и тот же дом наверх, а не вторым экземпляром.
    Детали берём у новой точки, а если она пришла из подсказки голой — оставляем
    прошлые: выбрать тот же дом заново не значит забыть свою квартиру. Но когда
    человек сам стёр квартиру и заказал, обратно она не всплывает. */
export function rememberPoint(point) {
  if (!point || point.lat == null || point.lng == null) return;
  const key = (p) => (p.addr || '') + '|' + Number(p.lat).toFixed(4) + Number(p.lng).toFixed(4);
  const item = {
    addr: point.addr || '', subtitle: point.subtitle || '',
    lat: point.lat, lng: point.lng,
  };
  const list = recentPoints();
  const fresh = details(point);
  const keep = Object.keys(fresh).length
    ? fresh
    : details(list.find((p) => key(p) === key(item)));
  Object.assign(item, keep);
  const rest = list.filter((p) => key(p) !== key(item));
  rest.unshift(item);
  writeJson(KEY_RECENT, rest.slice(0, RECENT_MAX));
}

/* ─────────────────────────────────────────────────────── строки списка */

function row(iconName, title, sub, onClick, accent) {
  return el('button', {
    type: 'button', className: 'sg-item', onClick,
  },
  el('span', { className: 'sg-item__icon' + (accent ? ' sg-item__icon--accent' : ''), html: icon(iconName) }),
  el('span', { className: 'sg-item__text' },
    el('span', { className: 'sg-item__title' }, title),
    sub ? el('span', { className: 'sg-item__sub' }, sub) : null,
  ));
}

function skeletonRows(n) {
  const box = el('div', { className: 'col gap-3', style: { padding: 'var(--sp-4) 0' } });
  const widths = ['72%', '54%', '64%', '48%'];
  for (let i = 0; i < n; i++) {
    box.appendChild(el('div', { className: 'skeleton', style: { width: widths[i % widths.length] } }));
  }
  return box;
}

function failRow(e, onRetry) {
  return el('div', { className: 'sg-fail' },
    el('div', { className: 'sg-fail__text' }, errText(e)),
    el('button', { type: 'button', className: 'btn btn--ghost', onClick: onRetry }, t('common.retry')),
  );
}

/* ─────────────────────────────────────────────────────── экран поиска */

/**
 * Показать экран выбора адреса. Возвращает промис с точкой {addr, subtitle, lat, lng}
 * либо null, если человек вернулся назад.
 * opts: {title, placeholder, value, near:[lat,lng]}
 */
export function pickAddress(app, opts = {}) {
  return new Promise((resolve) => {
    let finished = false;
    let typeTimer = 0;
    let ctrl = null;
    let unmap = null;             // снять слушатели карты, если открыт выбор пальцем

    const input = el('input', {
      type: 'search', className: 'sg-find__input', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: false, enterkeyhint: 'search',
      placeholder: opts.placeholder || t('order.to_ph'),
      'aria-label': opts.title || t('order.to'),
      value: (opts.value && opts.value.addr) || '',
    });

    const clear = iconBtn('close', 'sg-find__clear', t('common.clear'), () => {
      input.value = '';
      input.focus();
      schedule(0);
    });

    const list = el('div', { className: 'sg-list' });
    const body = el('div', { className: 'sg-body' }, list);

    const node = el('div', { className: 'sg-step sg-step--tall' },
      el('div', { className: 'sg-head' },
        iconBtn('back', 'sg-back', t('common.back'), () => done(null)),
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, opts.title || t('order.to')),
        ),
      ),
      el('div', { className: 'sg-find' }, input, clear),
      body,
    );

    function done(point) {
      if (finished) return;
      finished = true;
      clearTimeout(typeTimer);
      if (ctrl) ctrl.abort();
      if (unmap) { unmap(); unmap = null; }
      app.cancelPick = null;
      app.centerPin(false);
      if (point) rememberPoint(point);
      resolve(point);
    }

    // Если экран заказа уйдёт (браузерная кнопка «назад»), поиск надо свернуть,
    // иначе на карте останутся висеть его слушатели.
    app.cancelPick = () => done(null);

    /* ── карта пальцем ─────────────────────────────────────────────────── */

    function openMap() {
      haptic();
      const start = (opts.value && opts.value.lat != null)
        ? [opts.value.lat, opts.value.lng]
        : app.map.getCenter();

      let found = null;
      let moveTimer = 0;
      let reverseCtrl = null;

      const title = el('div', { className: 'sg-head__title' }, t('order.map_hint'));
      const sub = el('div', { className: 'sg-head__sub' }, t('common.loading'));
      const ok = el('button', {
        type: 'button', className: 'sg-cta', disabled: true,
        onClick: () => {
          if (!found) return;
          haptic(16);
          done(found);
        },
      }, el('span', { className: 'sg-cta__label' }, t('order.confirm_point')));

      const mapStep = el('div', { className: 'sg-step' },
        el('div', { className: 'sg-head' },
          iconBtn('back', 'sg-back', t('common.back'), () => {
            if (unmap) { unmap(); unmap = null; }
            app.centerPin(false);
            app.panel.show(node, { back: true });
            input.focus({ preventScroll: true });
          }),
          el('div', { className: 'sg-head__text' }, title, sub),
        ),
        el('div', { className: 'sg-foot' }, ok),
      );

      async function ask() {
        const c = app.map.getCenter();
        if (reverseCtrl) reverseCtrl.abort();
        reverseCtrl = new AbortController();
        sub.textContent = t('common.loading');
        ok.disabled = true;
        try {
          const r = await api.post('/geo/reverse', { lat: c[0], lng: c[1] },
                                   { signal: reverseCtrl.signal });
          found = {
            addr: r.title || '', subtitle: r.subtitle || '',
            lat: r.lat == null ? c[0] : r.lat, lng: r.lng == null ? c[1] : r.lng,
          };
          title.textContent = found.addr || t('order.on_map');
          sub.textContent = found.subtitle || t('order.map_hint');
          ok.disabled = false;
        } catch (e) {
          if (e && e.code === 'aborted') return;
          // Геокодер молчит — координаты у нас всё равно есть, заказ оформится.
          found = { addr: '', subtitle: '', lat: c[0], lng: c[1] };
          title.textContent = t('order.on_map');
          sub.textContent = errText(e);
          ok.disabled = false;
        }
      }

      function onSettle() {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(ask, MOVE_PAUSE);
      }

      app.map.on('moveend', onSettle);
      unmap = () => {
        app.map.off('moveend', onSettle);
        clearTimeout(moveTimer);
        if (reverseCtrl) reverseCtrl.abort();
      };
      app.panel.show(mapStep);
      app.centerPin(true);
      app.map.setView(start, Math.max(app.map.getZoom(), 16.5), { animate: true });
      // Карта может не сдвинуться вовсе (мы уже в этой точке) — спрашиваем сразу.
      setTimeout(ask, dur('--dur-2', 240));
    }

    /* ── список ────────────────────────────────────────────────────────── */

    let current = list;

    /* В теле экрана всегда ровно один блок: список, скелет или сообщение об ошибке.
       Меняем его целиком — так не остаётся хвостов от предыдущего состояния. */
    function put(next) {
      current.replaceWith(next);
      current = next;
    }

    function idle() {
      const recent = recentPoints();
      const box = el('div', { className: 'sg-list' },
        row('map', t('order.on_map'), null, openMap, true),
        row('locate', t('order.my_location'), null, useGeo),
      );
      if (recent.length) {
        box.appendChild(el('div', { className: 'sg-group' }, t('order.recent')));
        for (const p of recent) {
          // Под адресом показываем то, что человек про него уже уточнял: видно,
          // что подъезд и квартира подставятся сами.
          box.appendChild(row('clock', p.addr || t('order.on_map'),
                              detailsLine(p) || p.subtitle,
                              () => done(Object.assign({}, p))));
        }
      }
      put(box);
    }

    function useGeo() {
      if (!navigator.geolocation) {
        toast(t('err.geo_failed'), { type: 'err' });
        return;
      }
      put(skeletonRows(2));
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        try {
          const r = await api.post('/geo/reverse', { lat: ll[0], lng: ll[1] });
          done({ addr: r.title || '', subtitle: r.subtitle || '', lat: ll[0], lng: ll[1] });
        } catch (e) {
          done({ addr: '', subtitle: '', lat: ll[0], lng: ll[1] });
        }
      }, (err) => {
        put(el('div', { className: 'sg-fail' },
          el('div', { className: 'sg-fail__text' },
             err && err.code === 1 ? t('err.geo_denied') : t('err.geo_failed'))));
        setTimeout(() => { if (!finished) idle(); }, 2200);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    }

    async function search(q) {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      const mine = ctrl;
      try {
        const found = await api.post('/geo/suggest', {
          q, lat: (opts.near && opts.near[0]) || null, lng: (opts.near && opts.near[1]) || null,
        }, { signal: mine.signal });
        if (finished || mine !== ctrl) return;
        if (!found.length) {
          put(el('div', { className: 'sg-list' },
            el('div', { className: 'empty' },
              el('div', { className: 'empty__title' }, t('common.nothing_found')),
              el('div', { className: 'empty__text' }, t('order.map_hint'))),
            row('map', t('order.on_map'), null, openMap, true)));
          return;
        }
        const box = el('div', { className: 'sg-list' });
        for (const p of found) {
          box.appendChild(row('pin', p.title, p.subtitle, () => done({
            addr: p.title || '', subtitle: p.subtitle || '', lat: p.lat, lng: p.lng,
          })));
        }
        box.appendChild(row('map', t('order.on_map'), null, openMap, true));
        put(box);
      } catch (e) {
        if (finished || (e && e.code === 'aborted') || mine !== ctrl) return;
        put(failRow(e, () => schedule(0)));
      }
    }

    function schedule(delay) {
      clearTimeout(typeTimer);
      const q = input.value.trim();
      clear.hidden = !q;
      if (q.length < 2) {
        if (ctrl) ctrl.abort();
        idle();
        return;
      }
      typeTimer = setTimeout(() => {
        put(skeletonRows(4));
        search(q);
      }, delay === 0 ? 0 : TYPE_PAUSE);
    }

    input.addEventListener('input', () => schedule(TYPE_PAUSE));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = current.querySelector ? current.querySelector('.sg-item') : null;
      if (first) first.click();
    });

    clear.hidden = !input.value.trim();
    app.panel.show(node);
    idle();
    // Фокус даём после переезда шторки: иначе клавиатура выскакивает посреди анимации.
    setTimeout(() => { if (!finished) input.focus({ preventScroll: true }); },
               dur('--dur-2', 240) + 30);
  });
}

export default pickAddress;
