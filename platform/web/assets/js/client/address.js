/* Выбор адреса: поиск по подсказкам, свои места, недавние адреса и точка
   пальцем по карте.

   Экран занимает почти всю шторку и возвращает одну точку. Ждать ответа сервера
   на каждую букву нельзя: набирают быстро, а геокодер отвечает медленно, поэтому
   запрос уходит через четверть секунды тишины, а предыдущий отменяется.

   В найденной строке подсвечена та часть, которую человек набрал: глаз сразу
   видит, почему эта улица вообще в списке. Справа — сколько до неё отсюда:
   в Бишкеке одинаковых названий много, и расстояние отличает соседний двор
   от того же адреса в Новопавловке.

   Здесь же живёт всё, что человек уточняет про точку: подъезд, квартира, этаж,
   лифт, домофон. Один раз вписанные, они остаются с адресом и подставляются
   сами, когда человек снова везёт что-то из дома или к себе домой.
*/

import { api } from '../core/api.js';
import { t, extend } from '../core/i18n.js';
import { el, toast, chip, pressable, haptic } from '../core/ui.js';
import { distanceM } from '../core/map.js';
import { distance } from '../core/fmt.js';
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

    'find.places': 'Мои места',
    'find.home': 'Дом',
    'find.work': 'Работа',
    'find.map': 'Карта',
    'find.map_hint': 'Не нашли нужного? Поставьте точку пальцем',
  },
  ky: {
    'pt.entrance': '{v}-подъезд',
    'pt.flat': '{v}-батир',
    'pt.floor': '{v}-кабат',
    'pt.intercom': 'домофон {v}',
    'pt.lift_yes': 'лифти бар',
    'pt.lift_no': 'лифт жок',
    'pt.door': 'эшикке чейин',

    'find.places': 'Менин жерлерим',
    'find.home': 'Үй',
    'find.work': 'Жумуш',
    'find.map': 'Карта',
    'find.map_hint': 'Таппай жатасызбы? Картадан манжаңыз менен белгилеңиз',
  },
});

const TYPE_PAUSE = 250;      // столько тишины ждём перед запросом подсказок
const MOVE_PAUSE = 320;      // столько ждём после остановки карты перед геокодером
const RECENT_MAX = 8;
const MARK_MAX = 40;         // больше сорока подсвеченных кусков в строке не бывает

/* Что помним про дом вместе с адресом. Комментарий курьеру сюда не попадает —
   он про сегодняшний груз, а не про дом. «От двери до двери» тоже: это деньги,
   и человек включает их сам каждый раз, а не по памяти браузера. */
const DETAIL_KEYS = ['entrance', 'flat', 'floor', 'intercom'];

/* ─────────────────────────────────────────────────────── где человек сейчас */

/* Расстояние в списке считается от живого человека, а не от середины карты:
   карту он мог утащить в другой конец города, разглядывая маршрут. Координаты
   кладёт сюда тот, кто их получил, — экран заказа при запуске и кнопка
   «моё местоположение». Пока их нет, расстояний в списке просто не будет. */
let myPlace = null;

/** Запомнить, где человек. Принимает [lat, lng]; кривое значение игнорируем. */
export function noteMyPlace(ll) {
  if (!Array.isArray(ll) || ll.length < 2) return;
  const lat = Number(ll[0]);
  const lng = Number(ll[1]);
  if (!isFinite(lat) || !isFinite(lng)) return;
  myPlace = [lat, lng];
}

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

/* ─────────────────────────────────────────────────────── подсветка совпадения */

/* Слова запроса в найденной строке. Границы слов режем по всему, что не буква
   и не цифра: «контур № 5, 1» человек набирает как «контур 5 1», и без такой
   нарезки не подсветилось бы ничего. */
function words(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
}

/* Куски строки, совпавшие со словами запроса: список [начало, конец).
   Перекрытия склеиваем, иначе «контур» и «он» дали бы вложенные подсветки
   и строка развалилась бы на буквы. */
function hits(text, query) {
  const low = String(text || '').toLowerCase();
  const spans = [];
  for (const w of words(query)) {
    let from = low.indexOf(w);
    while (from >= 0 && spans.length < MARK_MAX) {
      spans.push([from, from + w.length]);
      from = low.indexOf(w, from + w.length);
    }
  }
  if (!spans.length) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  const out = [spans[0]];
  for (const s of spans.slice(1)) {
    const last = out[out.length - 1];
    if (s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push(s);
  }
  return out;
}

/** Строка, где набранное человеком выделено цветом. Без запроса — обычный текст. */
function marked(text, query) {
  const src = String(text || '');
  const spans = query ? hits(src, query) : [];
  if (!spans.length) return [document.createTextNode(src)];
  const out = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (from > at) out.push(document.createTextNode(src.slice(at, from)));
    out.push(el('b', { className: 'sg-hit' }, src.slice(from, to)));
    at = to;
  }
  if (at < src.length) out.push(document.createTextNode(src.slice(at)));
  return out;
}

/* ─────────────────────────────────────────────────────── строки списка */

/**
 * Строка списка адресов: значок, название с подсветкой, приписка и расстояние.
 * o: {icon, title, sub, point, query, accent, onClick}
 */
function row(o) {
  const title = el('span', { className: 'sg-item__title' }, marked(o.title, o.query));
  const text = el('span', { className: 'sg-item__text' }, title);
  if (o.sub) text.appendChild(el('span', { className: 'sg-item__sub' }, marked(o.sub, o.query)));

  // Расстояние показываем, только когда знаем, откуда мерить: выдуманные
  // «46 м» до адреса на другом конце города хуже пустого места.
  const away = myPlace && o.point && o.point.lat != null
    ? distance(distanceM(myPlace, [o.point.lat, o.point.lng]))
    : '';

  // pressable, а не :active: на айфоне :active приходит с опозданием, а стоит
  // пальцу поехать по списку — не приходит вовсе, и строка кажется мёртвой.
  return pressable(el('button', { type: 'button', className: 'sg-item', onClick: o.onClick },
    el('span', {
      className: 'sg-item__icon' + (o.accent ? ' sg-item__icon--accent' : ''),
      html: icon(o.icon),
    }),
    text,
    away ? el('span', { className: 'sg-item__dist' }, away) : null), { scale: .985 });
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

    // Пока своих координат нет, для расстояний сгодится середина карты: человек
    // смотрит именно на неё, и «от этого места» он поймёт правильно.
    if (!myPlace && Array.isArray(opts.near)) noteMyPlace(opts.near);

    const input = el('input', {
      type: 'search', className: 'sg-find__input', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: false, enterkeyhint: 'search',
      placeholder: opts.placeholder || t('order.to_ph'),
      'aria-label': opts.title || t('order.to'),
      value: (opts.value && opts.value.addr) || '',
    });

    const clear = pressable(iconBtn('close', 'sg-find__clear', t('common.clear'), () => {
      input.value = '';
      input.focus();
      schedule(0);
    }), { scale: .88 });

    /* «Карта» стоит прямо в строке поиска, а не отдельной строкой в конце
       списка: когда подсказки не нашли нужного, до конца списка уже никто
       не докручивает. */
    const mapChip = chip(t('find.map'), {
      icon: icon('map'),
      className: 'sg-find__map',
      onClick: () => openMap(),
    });

    const list = el('div', { className: 'sg-list' });
    const body = el('div', { className: 'sg-body' }, list);

    const node = el('div', { className: 'sg-step sg-step--tall' },
      el('div', { className: 'sg-head' },
        pressable(iconBtn('back', 'sg-back', t('common.back'), () => done(null)), { scale: .9 }),
        el('div', { className: 'sg-head__text' },
          el('div', { className: 'sg-head__title' }, opts.title || t('order.to')),
        ),
      ),
      el('div', { className: 'sg-find' }, input, clear, mapChip),
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
      const start = (opts.value && opts.value.lat != null)
        ? [opts.value.lat, opts.value.lng]
        : app.map.getCenter();

      let found = null;
      let moveTimer = 0;
      let reverseCtrl = null;

      const title = el('div', { className: 'sg-head__title' }, t('order.map_hint'));
      const sub = el('div', { className: 'sg-head__sub' }, t('common.loading'));
      const ok = pressable(el('button', {
        type: 'button', className: 'sg-cta', disabled: true,
        onClick: () => {
          if (!found) return;
          haptic(16);
          done(found);
        },
      }, el('span', { className: 'sg-cta__label' }, t('order.confirm_point'))), { scale: .98 });

      const mapStep = el('div', { className: 'sg-step' },
        el('div', { className: 'sg-head' },
          pressable(iconBtn('back', 'sg-back', t('common.back'), () => {
            if (unmap) { unmap(); unmap = null; }
            app.centerPin(false);
            app.panel.show(node, { back: true });
            input.focus({ preventScroll: true });
          }), { scale: .9 }),
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

    /* Дом и работа отдельной карточкой над списком: это два адреса, которыми
       человек пользуется чаще всех остальных вместе взятых. */
    function placesCard() {
      const saved = typeof app.places === 'function' ? app.places() : {};
      const kinds = [
        { key: 'home', icon: 'home', name: t('find.home') },
        { key: 'work', icon: 'work', name: t('find.work') },
      ].filter((k) => saved && saved[k.key] && saved[k.key].lat != null);
      if (!kinds.length) return null;

      const box = el('div', { className: 'sg-places' });
      for (const k of kinds) {
        const p = saved[k.key];
        box.appendChild(row({
          icon: k.icon, title: k.name, sub: p.addr, point: p, accent: true,
          onClick: () => done(Object.assign({}, p)),
        }));
      }
      return box;
    }

    function idle() {
      const box = el('div', { className: 'sg-list' });
      const places = placesCard();
      if (places) box.appendChild(places);
      box.appendChild(row({
        icon: 'locate', title: t('order.my_location'), accent: true, onClick: useGeo,
      }));

      const recent = recentPoints();
      if (recent.length) {
        box.appendChild(el('div', { className: 'sg-group' }, t('order.recent')));
        for (const p of recent) {
          // Под адресом показываем то, что человек про него уже уточнял: видно,
          // что подъезд и квартира подставятся сами.
          box.appendChild(row({
            icon: 'clock', title: p.addr || t('order.on_map'),
            sub: detailsLine(p) || p.subtitle, point: p,
            onClick: () => done(Object.assign({}, p)),
          }));
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
        noteMyPlace(ll);
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
          q, lat: (myPlace && myPlace[0]) || (opts.near && opts.near[0]) || null,
          lng: (myPlace && myPlace[1]) || (opts.near && opts.near[1]) || null,
        }, { signal: mine.signal });
        if (finished || mine !== ctrl) return;
        if (!found.length) {
          put(el('div', { className: 'sg-list' },
            el('div', { className: 'empty' },
              el('div', { className: 'empty__title' }, t('common.nothing_found')),
              el('div', { className: 'empty__text' }, t('find.map_hint')))));
          return;
        }
        const box = el('div', { className: 'sg-list' });
        for (const p of found) {
          box.appendChild(row({
            icon: 'pin', title: p.title, sub: p.subtitle, point: p, query: q,
            onClick: () => done({
              addr: p.title || '', subtitle: p.subtitle || '', lat: p.lat, lng: p.lng,
            }),
          }));
        }
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
