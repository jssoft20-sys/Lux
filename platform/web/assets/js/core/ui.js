/* Кирпичики интерфейса: узлы, тосты, нижние шторки, подтверждения, спиннеры, звёзды.
   Никаких зависимостей — только браузер. Все классы живут в components.css,
   здесь только поведение. Длительности берём из токенов, поэтому режим
   «меньше движения» работает сам собой: там все --dur- равны 1 мс. */

import { t, extend } from './i18n.js';

/* Свои строки модуль приносит сам: общий словарь правят другие. */
extend({
  ru: {
    'ui.photo': 'Фото',
    'ui.grip': 'Потянуть панель',
    'ui.copy_fail': 'Не получилось скопировать',
  },
  ky: {
    'ui.photo': 'Сүрөт',
    'ui.grip': 'Панелди сүйрөө',
    'ui.copy_fail': 'Көчүрүлгөн жок',
  },
});

const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 17.3l-6.2 3.6 1.7-7-5.4-4.7 7.1-.6L12 2l2.8 6.6 7.1.6-5.4 4.7 1.7 7z"/></svg>';

const FOCUSABLE =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),' +
  'textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Длительность из токенов в миллисекундах: '240ms' и '0.24s' понимаем одинаково. */
function dur(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : n * 1000;
}

/* ─────────────────────────────────────────────────────── создание узлов */

function isChild(v) {
  return v === null || v === undefined || typeof v !== 'object' ||
    v instanceof Node || Array.isArray(v);
}

function addKids(node, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === true) continue;
    if (Array.isArray(k)) addKids(node, k);
    else if (k instanceof Node) node.appendChild(k);
    else node.appendChild(document.createTextNode(String(k)));
  }
}

function applyProps(node, props) {
  for (const key of Object.keys(props)) {
    const v = props[key];
    if (v === null || v === undefined || v === false) continue;
    if (key === 'className' || key === 'class') {
      node.className = v;
    } else if (key === 'style') {
      if (typeof v === 'string') node.setAttribute('style', v);
      else for (const k of Object.keys(v)) {
        if (k.startsWith('--')) node.style.setProperty(k, v[k]);
        else node.style[k] = v[k];
      }
    } else if (key === 'dataset') {
      for (const k of Object.keys(v)) node.dataset[k] = v[k];
    } else if (key === 'html') {
      node.innerHTML = v;                 // только для нашей собственной разметки
    } else if (key === 'text') {
      node.textContent = v;
    } else if (key.startsWith('on') && typeof v === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), v);
    } else if (key in node && typeof v !== 'object' && key !== 'list' && key !== 'form') {
      node[key] = v;                      // value, checked, disabled и прочие свойства
    } else {
      node.setAttribute(key, v === true ? '' : v);
    }
  }
}

/**
 * Собрать элемент: el('div', {className:'card'}, 'текст', el('b', null, '!')).
 * Второй аргумент можно опустить — тогда он считается первым потомком.
 * Потомки: строки, числа, узлы, массивы, null/false (пропускаются).
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (isChild(props)) {
    children.unshift(props);
  } else if (props) {
    applyProps(node, props);
  }
  addKids(node, children);
  return node;
}

/* ─────────────────────────────────────────────────────── мелочи */

/** Короткая вибрация на подтверждение действия. Где её нет — молча ничего. */
export function haptic(pattern = 12) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* заблокировано настройками */ }
  }
}

/** Крутилка на кнопке или блоке. Второй вызов с false возвращает всё как было. */
export function spinner(node, on = true) {
  if (!node) return;
  node.classList.toggle('is-loading', !!on);
  if (on) node.setAttribute('aria-busy', 'true');
  else node.removeAttribute('aria-busy');
}

/** Серые полоски вместо содержимого, пока грузятся данные. Возвращает «убрать». */
export function skeleton(node, rows = 3) {
  if (!node) return () => {};
  const widths = ['100%', '84%', '66%', '92%', '74%'];
  const stack = el('div', { className: 'col gap-2' });
  for (let i = 0; i < Math.max(1, rows); i++) {
    stack.appendChild(el('div', { className: 'skeleton', style: { width: widths[i % widths.length] } }));
  }
  node.replaceChildren(stack);
  return () => node.replaceChildren();
}

/* ─────────────────────────────────────────────────────── тосты */

const TOAST_LIMIT = 4;
let toastsBox = null;

function toastsRoot() {
  if (!toastsBox || !toastsBox.isConnected) {
    toastsBox = el('div', { className: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastsBox);
  }
  return toastsBox;
}

/**
 * Короткое сообщение сверху. type: 'ok' | 'err' | 'warn' | 'info'.
 * Тост можно смахнуть пальцем в сторону или вверх, можно просто ткнуть.
 */
export function toast(msg, opts = {}) {
  const type = opts.type || 'info';
  const life = opts.ms || (type === 'err' ? 4200 : 2600);
  const root = toastsRoot();
  const node = el('div', { className: 'toast toast--' + type }, el('span', null, msg));

  root.appendChild(node);
  while (root.children.length > TOAST_LIMIT) root.firstElementChild.remove();

  let done = false;
  let timer = setTimeout(() => close(), life);

  function close(fly) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const d = dur('--dur-1', 140);
    if (fly) {
      node.style.transition = 'transform ' + d + 'ms var(--ease-in), opacity ' + d + 'ms linear';
      node.style.transform = 'translate(' + fly[0] + 'px,' + fly[1] + 'px)';
      node.style.opacity = '0';
    } else {
      // Снимаем следы перетаскивания, иначе .is-drag глушит анимацию ухода.
      node.classList.remove('is-drag');
      node.style.transition = '';
      node.style.transform = '';
      node.style.opacity = '';
      node.classList.add('is-out');
    }
    setTimeout(() => node.remove(), d + 60);
  }

  // Смахивание: по горизонтали в любую сторону, по вертикали — только вверх.
  let sx = 0, sy = 0, t0 = 0, axis = null, pid = null;

  node.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    pid = e.pointerId;
    sx = e.clientX; sy = e.clientY; t0 = performance.now(); axis = null;
    node.classList.add('is-drag');
    node.style.transition = 'none';
    clearTimeout(timer);
    try { node.setPointerCapture(pid); } catch (err) { /* мышь без захвата — не беда */ }
  });

  node.addEventListener('pointermove', (e) => {
    if (pid === null || e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dy = Math.min(0, e.clientY - sy);
    if (!axis && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (!axis) return;
    const off = axis === 'x' ? dx : dy;
    node.style.transform = axis === 'x' ? 'translateX(' + dx + 'px)' : 'translateY(' + dy + 'px)';
    node.style.opacity = String(clamp(1 - Math.abs(off) / 170, 0, 1));
  });

  function release(e) {
    if (pid === null || (e.pointerId !== undefined && e.pointerId !== pid)) return;
    pid = null;
    const dx = e.clientX - sx;
    const dy = Math.min(0, e.clientY - sy);
    const off = axis === 'y' ? dy : dx;
    const speed = Math.abs(off) / Math.max(1, performance.now() - t0);
    if (axis && (Math.abs(off) > 64 || (Math.abs(off) > 18 && speed > 0.5))) {
      const away = off < 0 ? -520 : 520;
      close(axis === 'y' ? [0, away] : [away, 0]);
      return;
    }
    // Не дотянули — возвращаем на место и снова заводим таймер.
    const back = dur('--dur-1', 140);
    node.style.transition = 'transform ' + back + 'ms var(--ease), opacity ' + back + 'ms linear';
    node.style.transform = '';
    node.style.opacity = '';
    if (!axis) close();                        // это был обычный тап
    else timer = setTimeout(() => close(), life);
  }

  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);

  return close;
}

/* ─────────────────────────────────────────────────────── блокировка прокрутки */

let lockDepth = 0;
let lockY = 0;

function lockScroll() {
  if (lockDepth++) return;
  lockY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = '-' + lockY + 'px';
  document.documentElement.classList.add('is-locked');
}

function unlockScroll() {
  if (lockDepth > 0) lockDepth--;
  if (lockDepth) return;
  document.documentElement.classList.remove('is-locked');
  document.body.style.top = '';
  window.scrollTo(0, lockY);
}

/* ─────────────────────────────────────────────────────── шторка */

const sheetStack = [];
let keysHooked = false;

function focusables(box) {
  return Array.from(box.querySelectorAll(FOCUSABLE))
    .filter((n) => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement);
}

function onSheetKey(e) {
  const top = sheetStack[sheetStack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.dismissible) {
    e.preventDefault();
    top.close();
    return;
  }
  if (e.key !== 'Tab') return;
  // Фокус ходит по кругу внутри шторки, а не убегает на страницу под ней.
  const list = focusables(top.box);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const here = document.activeElement;
  if (e.shiftKey && (here === first || !top.box.contains(here))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && here === last) {
    e.preventDefault();
    first.focus();
  }
}

function actionNode(a, close) {
  if (a instanceof Node) return a;
  const kind = a.kind || a.variant || 'ghost';
  const btn = el('button', {
    type: 'button',
    className: 'btn btn--' + kind + (a.className ? ' ' + a.className : ''),
    disabled: !!a.disabled,
  }, a.label);

  btn.addEventListener('click', async () => {
    if (btn.classList.contains('is-loading')) return;
    haptic();
    let res = true;
    if (a.onClick) {
      const out = a.onClick(btn);
      if (out && typeof out.then === 'function') {
        spinner(btn, true);
        try {
          res = await out;
        } catch (err) {
          spinner(btn, false);
          toast((err && err.message) || 'Не получилось, попробуйте ещё раз', { type: 'err' });
          return;                       // шторку держим открытой — человеку есть что исправить
        }
        spinner(btn, false);
      } else {
        res = out;
      }
    }
    if (a.close !== false && res !== false) close();
  });
  return btn;
}

/**
 * Нижняя шторка. Возвращает {el, box, body, close}.
 * content — узел, строка или массив; actions — массив {label, kind, onClick, close, disabled}
 * либо готовых узлов. onClick может вернуть промис: кнопка сама покажет крутилку,
 * а вернув false — оставит шторку открытой.
 */
export function sheet(opts = {}) {
  const dismissible = opts.dismissible !== false;
  const prevFocus = document.activeElement;

  const grip = el('div', { className: 'sheet__grip' });
  const body = el('div', { className: 'sheet__body' }, opts.content);
  const box = el('div', {
    className: 'sheet__box',
    role: 'dialog',
    'aria-modal': 'true',
    tabIndex: -1,
  }, grip);

  let head = null;
  if (opts.title) {
    head = el('div', { className: 'sheet__head' }, el('div', { className: 'sheet__title' }, opts.title));
    box.appendChild(head);
    box.setAttribute('aria-label', String(opts.title));
  }
  box.appendChild(body);

  const list = Array.isArray(opts.actions) ? opts.actions.filter(Boolean) : [];
  if (list.length) {
    const foot = el('div', { className: 'sheet__foot' });
    for (const a of list) foot.appendChild(actionNode(a, () => close()));
    box.appendChild(foot);
  }

  const scrim = el('div', { className: 'sheet__scrim' });
  const root = el('div', { className: 'sheet' + (opts.fullHeight ? ' sheet--full' : '') }, scrim, box);

  if (dismissible) scrim.addEventListener('click', () => close());

  document.body.appendChild(root);
  lockScroll();
  void root.offsetHeight;                 // заставляем браузер зафиксировать начальный кадр
  root.classList.add('sheet--in');

  const auto = box.querySelector('[autofocus]');
  // На телефоне поле в фокусе тут же выкидывает клавиатуру, поэтому по умолчанию берём саму панель.
  (auto || box).focus({ preventScroll: true });

  if (!keysHooked) {
    document.addEventListener('keydown', onSheetKey);
    keysHooked = true;
  }

  // ── перетаскивание вниз за грип и шапку ────────────────────────────────
  let dy = 0, y0 = 0, t0 = 0, pid = null, tall = 400;

  function onDown(e) {
    if (!dismissible || e.button) return;
    pid = e.pointerId;
    y0 = e.clientY;
    t0 = performance.now();
    dy = 0;
    tall = Math.max(220, box.offsetHeight);   // меряем один раз: в onMove это дёргало бы вёрстку
    root.classList.add('sheet--drag');
    try { e.currentTarget.setPointerCapture(pid); } catch (err) { /* не критично */ }
  }

  function onMove(e) {
    if (pid === null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - y0);
    box.style.transform = 'translateY(' + dy + 'px)';
    scrim.style.opacity = String(clamp(1 - dy / tall, 0, 1));
  }

  function onUp(e) {
    if (pid === null || e.pointerId !== pid) return;
    pid = null;
    const speed = dy / Math.max(1, performance.now() - t0);
    root.classList.remove('sheet--drag');
    box.style.transform = '';
    scrim.style.opacity = '';
    // Либо утянули далеко, либо коротко, но резко дёрнули. Порог в 24 px обязателен:
    // без него быстрый тап по грипу даёт огромную «скорость» и закрывает шторку зря.
    if (dy > 90 || (dy > 24 && speed > 0.6)) close();
  }

  for (const handle of [grip, head]) {
    if (!handle) continue;
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  let closed = false;

  function close(result) {
    if (closed) return;
    closed = true;
    const i = sheetStack.indexOf(api);
    if (i >= 0) sheetStack.splice(i, 1);
    root.classList.remove('sheet--in');
    unlockScroll();
    setTimeout(() => root.remove(), dur('--dur-2', 240) + 60);
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus({ preventScroll: true }); } catch (err) { /* узла уже нет */ }
    }
    if (typeof opts.onClose === 'function') opts.onClose(result);
  }

  const api = { el: root, box, body, close, dismissible };
  sheetStack.push(api);
  return api;
}

/** Да/нет в виде шторки. Возвращает Promise<boolean>. */
export function confirm(opts = {}) {
  return new Promise((resolve) => {
    let answer = false;
    sheet({
      title: opts.title || 'Подтвердите',
      content: opts.text ? el('p', { className: 'sheet__text' }, opts.text) : null,
      dismissible: opts.dismissible !== false,
      actions: [
        { label: opts.cancel || 'Отмена', kind: 'ghost', onClick: () => { answer = false; } },
        {
          label: opts.ok || 'Да',
          kind: opts.danger ? 'danger' : 'primary',
          onClick: () => { answer = true; haptic(18); },
        },
      ],
      onClose: () => resolve(answer),
    });
  });
}

/* ─────────────────────────────────────────────────────── звёзды */

/**
 * Пять звёзд в узел. {value, readonly, onChange, size:'lg'}.
 * Только для показа — рисует и дробную оценку (4,7 из 5).
 * Возвращает {set(v), value(), el}.
 */
export function mountStars(node, opts = {}) {
  if (!node) return { set() {}, value: () => 0, el: null };
  const readonly = !!opts.readonly;
  let value = clamp(Number(opts.value) || 0, 0, 5);

  node.className = 'stars' + (opts.size === 'lg' ? ' stars--lg' : '') + (readonly ? '' : ' stars--tap');
  const bg = el('span', { className: 'stars__row', html: STAR_SVG.repeat(5) });
  const clip = el('span', { className: 'stars__clip' },
    el('span', { className: 'stars__row', html: STAR_SVG.repeat(5) }));
  node.replaceChildren(bg, clip);

  function draw(v) {
    const shown = v === undefined ? value : v;
    clip.style.width = (shown / 5 * 100).toFixed(2) + '%';
  }

  function label() {
    const txt = String(Math.round(value * 10) / 10).replace('.', ',');
    node.setAttribute('aria-label', 'Оценка ' + txt + ' из 5');
  }

  function pick(i) {
    value = clamp(i, 0, 5);
    draw();
    label();
    haptic();
    if (typeof opts.onChange === 'function') opts.onChange(value);
  }

  if (readonly) {
    node.setAttribute('role', 'img');
  } else {
    const hit = el('span', { className: 'stars__hit' });
    for (let i = 1; i <= 5; i++) {
      hit.appendChild(el('button', {
        type: 'button',
        className: 'stars__i',
        'aria-label': i + ' из 5',
        // detail === 0 — нажали с клавиатуры; мышь и палец приходят через pointerup ниже.
        onClick: (e) => { if (e.detail === 0) pick(i); },
      }));
    }
    node.appendChild(hit);

    const from = (x) => {
      const r = hit.getBoundingClientRect();
      return clamp(Math.ceil((x - r.left) / (r.width / 5)), 1, 5);
    };

    let live = 0;
    hit.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      live = from(e.clientX);
      draw(live);
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    });
    hit.addEventListener('pointermove', (e) => {
      if (!live) return;
      const i = from(e.clientX);
      if (i !== live) { live = i; draw(i); haptic(8); }
    });
    hit.addEventListener('pointerup', (e) => {
      if (!live) return;
      const i = from(e.clientX);
      live = 0;
      pick(i);
    });
    hit.addEventListener('pointercancel', () => { live = 0; draw(); });
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); pick(clamp(value - 1, 1, 5)); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); pick(clamp(value + 1, 1, 5)); }
    });
  }

  draw();
  label();

  return {
    set(v) { value = clamp(Number(v) || 0, 0, 5); draw(); label(); },
    value() { return value; },
    el: node,
  };
}

/* ─────────────────────────────────────────────────────── собственные стили */

/* Просмотрщик фото — часть ядра, а не одного экрана: его зовут и клиент,
   и курьер, и админка. Правила везёт с собой сам модуль, иначе каждому из трёх
   приложений пришлось бы помнить про лишний css-файл. Цвета — из токенов. */
const OWN_CSS = `
.photo {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  transition: opacity var(--dur-2) var(--ease);
}
.photo--in { opacity: 1; }
.photo--drag { transition: none; }

.photo__scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .92); }

.photo__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: calc(var(--safe-t) + 56px) var(--sp-3) calc(var(--safe-b) + var(--sp-5));
  transform: scale(.94);
  transition: transform var(--dur-2) var(--ease-spring);
}
.photo--in .photo__stage { transform: none; }
.photo--drag .photo__stage { transition: none; }

.photo__img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  border-radius: var(--r-md);
  object-fit: contain;
  box-shadow: var(--shadow-3);
}

.photo__x {
  position: absolute;
  top: calc(var(--safe-t) + var(--sp-2));
  right: var(--sp-3);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, .16);
  color: #fff;
  touch-action: manipulation;
  transition: transform var(--dur-1) var(--ease), background-color var(--dur-1) var(--ease);
}
.photo__x:active { transform: scale(.92); background: rgba(255, 255, 255, .28); }
.photo__x > svg { width: 22px; height: 22px; }
`;

let cssDone = false;

function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head) return;
  cssDone = true;
  document.head.appendChild(el('style', { id: 'sg-ui-css', text: OWN_CSS }));
}

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/* ─────────────────────────────────────────────────────── просмотр фото */

/**
 * Фото почти во весь экран поверх всего: затемнение, крестик, закрытие тапом мимо,
 * клавишей Esc и смахиванием вниз. Возвращает {el, img, close}.
 */
export function photoViewer(src, opts = {}) {
  ensureCss();
  const alt = opts.alt || '';
  const img = el('img', { className: 'photo__img', src: src, alt: alt, decoding: 'async' });
  const stage = el('div', { className: 'photo__stage' }, img);
  const xBtn = el('button', {
    type: 'button',
    className: 'photo__x',
    html: CLOSE_SVG,
    'aria-label': t('common.close'),
    title: t('common.close'),
  });
  const root = el('div', {
    className: 'photo',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': alt || t('ui.photo'),
    tabIndex: -1,
  }, el('div', { className: 'photo__scrim' }), stage, xBtn);

  const prevFocus = document.activeElement;
  document.body.appendChild(root);
  lockScroll();
  void root.offsetHeight;                  // фиксируем начальный кадр, иначе появления не будет
  root.classList.add('photo--in');
  xBtn.focus({ preventScroll: true });

  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.classList.remove('photo--drag', 'photo--in');
    unlockScroll();
    setTimeout(() => root.remove(), dur('--dur-2', 240) + 60);
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* узла уже нет */ }
    }
    if (typeof opts.onClose === 'function') opts.onClose();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKey, true);

  xBtn.addEventListener('click', close);
  // По самому фото не закрываем: в него тычут, чтобы рассмотреть, а не чтобы уйти.
  root.addEventListener('click', (e) => { if (e.target !== img) close(); });

  // Смахивание вниз — привычный способ убрать фото на телефоне.
  let pid = null, dy = 0, y0 = 0, t0 = 0, live = false;

  stage.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    pid = e.pointerId;
    y0 = e.clientY;
    dy = 0;
    t0 = performance.now();
    live = false;
  });

  stage.addEventListener('pointermove', (e) => {
    if (pid === null || e.pointerId !== pid) return;
    const d = e.clientY - y0;
    if (!live) {
      if (Math.abs(d) < 6) return;
      live = true;
      root.classList.add('photo--drag');
      try { stage.setPointerCapture(pid); } catch (err) { /* мышь без захвата — не беда */ }
    }
    dy = d;
    const shift = d < 0 ? d / 3 : d;       // вверх тянется туго: уходим только вниз
    stage.style.transform = 'translateY(' + shift.toFixed(1) + 'px)';
    root.style.opacity = String(clamp(1 - Math.max(0, d) / 420, .25, 1));
  });

  function drop(e) {
    if (pid === null || (e.pointerId !== undefined && e.pointerId !== pid)) return;
    pid = null;
    if (!live) return;
    live = false;
    const speed = dy / Math.max(1, performance.now() - t0);
    root.classList.remove('photo--drag');
    if (dy > 110 || (dy > 30 && speed > 0.55)) {
      stage.style.transform = 'translateY(' + Math.round((window.innerHeight || 800) * 0.6) + 'px)';
      root.style.opacity = '0';
      close();
      return;
    }
    stage.style.transform = '';
    root.style.opacity = '';
  }

  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);

  return { el: root, img, close };
}

/* ─────────────────────────────────────────────────────── буфер обмена */

/* Запасной путь для старых браузеров и для http без сертификата, где
   navigator.clipboard попросту отсутствует: прячем поле за краем экрана,
   выделяем и копируем старой командой. contentEditable нужен ради iOS —
   без него Safari не выделяет содержимое поля только для чтения. */
function copyFallback(text) {
  const box = el('textarea', {
    value: text,
    readOnly: true,
    'aria-hidden': 'true',
    tabIndex: -1,
    style: { position: 'fixed', top: '0', left: '-9999px', opacity: '0', pointerEvents: 'none' },
  });
  document.body.appendChild(box);
  const sel = document.getSelection ? document.getSelection() : null;
  const prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  let done = false;
  try {
    box.contentEditable = 'true';
    box.readOnly = true;
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(box);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    box.setSelectionRange(0, text.length);
    done = !!document.execCommand && document.execCommand('copy');
  } catch (e) {
    done = false;
  }
  box.remove();
  if (sel) {
    sel.removeAllRanges();
    if (prev) sel.addRange(prev);
  }
  return done;
}

/**
 * Скопировать строку в буфер и сказать об этом тостом.
 * Возвращает Promise<boolean>: получилось или нет.
 */
export async function copyText(text, okMessage) {
  const line = text === null || text === undefined ? '' : String(text);
  let done = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(line);
      done = true;
    }
  } catch (e) {
    done = false;                      // разрешение не дали — идём запасным путём
  }
  if (!done) done = copyFallback(line);
  if (done) {
    haptic();
    toast(okMessage || t('common.copied'), { type: 'ok' });
  } else {
    toast(t('ui.copy_fail'), { type: 'err' });
  }
  return done;
}

/* ─────────────────────────────────────────────────────── панель в три положения */

/* Сверху вниз: развёрнута, наполовину, свёрнута до заголовка. */
const DOCK_POS = ['full', 'half', 'peek'];

/**
 * Нижняя панель, которая живёт на странице постоянно и ходит между тремя
 * положениями. Тянется пальцем за грип, шапку и подвал; кидок вниз сворачивает,
 * вверх разворачивает — со снятием инерции, а не ступенькой. Пока человек трогает
 * карту, панель уступает ей место и возвращается через секунду после того,
 * как он её отпустил. Возвращает {to, pos, offset, destroy}.
 */
export function dockSheet(root, opts = {}) {
  const box = root ? root.querySelector(opts.boxSelector || '.sg-panel__box') : null;
  if (!box) return { to() {}, pos: () => 'full', offset: () => 0, destroy() {} };

  const grip = root.querySelector('.sg-panel__grip');
  const slot = root.querySelector('.sg-panel__slot') || box;
  const mapEl = opts.mapEl ||
    document.querySelector(root.getAttribute('data-sheet-map') || '[data-map]');

  let pos = 'full';
  let off = 0;

  /* Сколько панели видно в свёрнутом виде: грип плюс заголовок шага.
     Меряем по разметке, а не числом: у разных шагов шапка разной высоты. */
  function metrics() {
    const tall = box.offsetHeight || 0;
    // Во время перехода в слоте лежат два шага; мерить надо по новому,
    // старый уже уезжает и его заголовок ничего не говорит о будущей высоте.
    const step = box.querySelector('.sg-step:not(.sg-step--out)');
    const head = (step || box).querySelector('.sg-head, .sheet__head');
    let seen = 96;
    if (head) {
      seen = Math.round(head.getBoundingClientRect().bottom - box.getBoundingClientRect().top) + 8;
    }
    seen = clamp(seen, 72, Math.max(72, tall));
    const deep = Math.max(0, Math.round(tall - seen));
    return { full: 0, half: Math.round(deep / 2), peek: deep, tall: tall };
  }

  function paint(v) {
    off = v;
    box.style.transform = 'translate3d(0,' + v.toFixed(1) + 'px,0)';
    document.documentElement.style.setProperty('--sg-panel-off', Math.round(v) + 'px');
  }

  /** Перевести панель в положение. animate=false — мгновенно, без анимации. */
  function to(name, animate = true) {
    const key = DOCK_POS.indexOf(name) >= 0 ? name : 'full';
    const m = metrics();
    const was = pos;
    pos = key;
    root.dataset.pos = key;
    box.classList.toggle('is-down', key !== 'full');
    if (grip) grip.setAttribute('aria-expanded', key === 'full' ? 'true' : 'false');
    if (animate) {
      paint(m[key]);
    } else if (Math.abs(m[key] - off) > 0.5) {
      root.classList.add('sg-panel--drag');
      paint(m[key]);
      void box.offsetHeight;             // фиксируем кадр, иначе следующий переход пойдёт не отсюда
      root.classList.remove('sg-panel--drag');
    }
    if (key !== was) {
      root.dispatchEvent(new CustomEvent('sheetmove', {
        bubbles: true, detail: { pos: key, offset: m[key] },
      }));
    }
    return key;
  }

  /* Прокручиваемый предок внутри панели: если списку ещё есть куда ехать,
     палец должен листать его, а не тащить всю панель. */
  function scrollerAt(node) {
    let n = node;
    while (n && n !== box) {
      if (n.nodeType === 1 && n.scrollHeight > n.clientHeight + 1) {
        const ov = getComputedStyle(n).overflowY;
        if (ov === 'auto' || ov === 'scroll') return n;
      }
      n = n.parentNode;
    }
    return null;
  }

  let pid = null, live = false, y0 = 0, x0 = 0, base = 0, scroller = null, mm = null;
  let track = [];
  let dragEnded = 0;                     // когда отпустили панель: гасит клик после перетаскивания

  function onDown(e) {
    if (e.button || pid !== null) return;
    const handle = !!(e.target.closest &&
      e.target.closest('.sg-panel__grip, .sg-head, .sg-foot'));
    if (e.pointerType === 'mouse' && !handle) return;   // мышью тянем только за шапку и подвал
    pid = e.pointerId;
    y0 = e.clientY;
    x0 = e.clientX;
    base = off;
    live = false;
    scroller = handle ? null : scrollerAt(e.target);
    track = [{ t: performance.now(), y: e.clientY }];
    stopReturn();                        // человек взялся сам — карта больше не командует
  }

  function onMove(e) {
    if (pid === null || e.pointerId !== pid) return;
    const dy = e.clientY - y0;
    const dx = e.clientX - x0;
    if (!live) {
      // Ждём явного вертикального движения: горизонтальные карусели внутри
      // панели иначе перестали бы листаться.
      if (Math.abs(dy) < 6 || Math.abs(dy) <= Math.abs(dx)) return;
      if (scroller) {
        const room = scroller.scrollHeight - scroller.clientHeight;
        const at = scroller.scrollTop;
        if ((dy < 0 && at < room - 1) || (dy > 0 && at > 0)) { pid = null; return; }
      }
      live = true;
      mm = metrics();
      base = off;
      y0 = e.clientY;                    // считаем от точки захвата, чтобы панель не прыгнула
      root.classList.add('sg-panel--drag');
      try { box.setPointerCapture(pid); } catch (err) { /* мышь без захвата — не беда */ }
    }
    let v = base + (e.clientY - y0);
    if (v < 0) v = v / 3;                                  // выше своего края панель тянется туго
    else if (v > mm.peek) v = mm.peek + (v - mm.peek) / 3;
    paint(v);
    const now = performance.now();
    track.push({ t: now, y: e.clientY });
    while (track.length > 2 && now - track[0].t > 120) track.shift();
  }

  function onUp(e) {
    if (pid === null || e.pointerId !== pid) return;
    pid = null;
    if (!live) return;
    live = false;
    dragEnded = performance.now();
    root.classList.remove('sg-panel--drag');
    const now = performance.now();
    const first = track[0] || { t: now, y: e.clientY };
    const speed = (e.clientY - first.y) / Math.max(1, now - first.t);   // px/мс, вниз положительна
    const m = mm || metrics();
    // Инерция: смотрим, куда палец доехал бы ещё за 130 мс, и садимся на ближайшее положение.
    const aim = off + speed * 130;
    let best = DOCK_POS[0];
    for (const name of DOCK_POS) {
      if (Math.abs(m[name] - aim) < Math.abs(m[best] - aim)) best = name;
    }
    // Кидок обязан сменить положение: иначе жест читается как «не сработало».
    if (Math.abs(speed) > 0.45 && best === pos) {
      best = DOCK_POS[clamp(DOCK_POS.indexOf(pos) + (speed > 0 ? 1 : -1), 0, DOCK_POS.length - 1)];
    }
    to(best, true);
  }

  /* Пока панель в пальцах, ни страница, ни списки под ней ехать не должны. */
  function onTouchMove(e) {
    if (live && e.cancelable) e.preventDefault();
  }

  /* Тап по грипу сворачивает и разворачивает панель. Клик, прилетевший сразу
     после перетаскивания, пропускаем: иначе жест отменял бы сам себя. */
  function onGrip() {
    if (performance.now() - dragEnded < 300) return;
    haptic();
    to(pos === 'full' ? 'peek' : 'full', true);
  }

  /* ── карта важнее панели, пока её трогают ─────────────────────────────── */

  let backTo = null;
  let backTimer = 0;

  function stopReturn() {
    clearTimeout(backTimer);
    backTimer = 0;
    backTo = null;
  }

  function onMapDown() {
    clearTimeout(backTimer);
    backTimer = 0;
    if (pos !== 'full') return;
    backTo = pos;
    to('half', true);
  }

  function onMapUp() {
    if (!backTo || backTimer) return;
    // Вернуть панель сразу нельзя: человек ещё возит карту пальцем туда-сюда.
    backTimer = setTimeout(() => {
      backTimer = 0;
      const back = backTo;
      backTo = null;
      if (back) to(back, true);
    }, opts.backDelay || 1000);
  }

  /* ── содержимое меняется само ─────────────────────────────────────────── */

  let lastStep = slot.querySelector('.sg-step');

  const steps = new MutationObserver(() => {
    const step = slot.querySelector('.sg-step:not(.sg-step--out)');
    if (!step || step === lastStep) return;
    lastStep = step;
    stopReturn();
    to('full', true);                    // новый шаг показываем целиком
  });
  steps.observe(slot, { childList: true });

  let sizes = null;
  if (typeof ResizeObserver === 'function') {
    // Панель подросла или сжалась — держим выбранное положение, а не пиксели.
    sizes = new ResizeObserver(() => { if (pid === null) to(pos, false); });
    sizes.observe(box);
  }

  const onResize = () => { if (pid === null) to(pos, false); };

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', onResize);
  if (grip) grip.addEventListener('click', onGrip);
  if (mapEl) {
    mapEl.addEventListener('pointerdown', onMapDown);
    window.addEventListener('pointerup', onMapUp);
    window.addEventListener('pointercancel', onMapUp);
  }

  to('full', false);

  return {
    to,
    pos: () => pos,
    offset: () => off,
    destroy() {
      steps.disconnect();
      if (sizes) sizes.disconnect();
      stopReturn();
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      if (grip) grip.removeEventListener('click', onGrip);
      if (mapEl) {
        mapEl.removeEventListener('pointerdown', onMapDown);
        window.removeEventListener('pointerup', onMapUp);
        window.removeEventListener('pointercancel', onMapUp);
      }
      box.style.transform = '';
      document.documentElement.style.removeProperty('--sg-panel-off');
    },
  };
}

/* ─────────────────────────────────────────────────────── запрет зума страницы */

/* Карта живёт по своим правилам: там щипок и двойной тап приближают вид,
   и трогать их нельзя. Всё остальное — интерфейс, его масштабировать незачем. */
function isMapArea(node) {
  return !!(node && node.closest && node.closest('[data-map], .map, [data-zoomable]'));
}

/* Safari игнорирует user-scalable=no в мета-теге, поэтому зум приходится гасить
   руками: жесты щипка, второй тап подряд и любое касание двумя пальцами.
   Двойной тап браузер после preventDefault не превратит в клик — поэтому клик
   отправляем сами, иначе кнопка «съест» каждое второе быстрое нажатие. */
function installZoomGuard() {
  if (typeof document === 'undefined') return;

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => {
      if (!isMapArea(e.target)) e.preventDefault();
    }, { passive: false });
  }

  let lastAt = 0, lastX = 0, lastY = 0, fromX = 0, fromY = 0, moved = false;
  let nativeAt = 0, pending = 0;

  // Настоящий клик от браузера отмечаем, чтобы не отправить поверх него свой.
  document.addEventListener('click', (e) => {
    if (e.isTrusted) nativeAt = performance.now();
  }, true);

  document.addEventListener('touchstart', (e) => {
    const p = e.touches[0];
    if (!p) return;
    fromX = p.clientX;
    fromY = p.clientY;
    moved = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (p && (Math.abs(p.clientX - fromX) > 12 || Math.abs(p.clientY - fromY) > 12)) moved = true;
    if (e.touches.length > 1 && !isMapArea(e.target) && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (e.touches.length || !e.cancelable) return;
    const p = e.changedTouches && e.changedTouches[0];
    if (!p) return;
    const now = performance.now();
    const near = now - lastAt < 300 &&
      Math.abs(p.clientX - lastX) < 40 && Math.abs(p.clientY - lastY) < 40;
    lastAt = now; lastX = p.clientX; lastY = p.clientY;
    if (moved) { lastAt = 0; return; }
    if (!near || isMapArea(e.target)) return;
    e.preventDefault();
    lastAt = 0;                          // третий тап считаем заново, а не как продолжение
    // Клик после preventDefault браузер уже не пришлёт — отправляем сами, иначе
    // кнопка съест каждое второе быстрое нажатие. Ждём 60 мс: если браузер всё
    // же прислал свой клик, наш не нужен, иначе действие сработает дважды.
    const mark = performance.now();
    const x = p.clientX, y = p.clientY;
    clearTimeout(pending);
    pending = setTimeout(() => {
      pending = 0;
      if (nativeAt > mark) return;
      const node = document.elementFromPoint(x, y);
      if (!node) return;
      if (node.matches('input, select, textarea, [contenteditable]') &&
          typeof node.focus === 'function') {
        node.focus({ preventScroll: true });
      }
      node.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y,
      }));
    }, 60);
  }, { passive: false });
}

/* ─────────────────────────────────────────────────────── подъём разметки */

/* Панель клиента объявлена прямо в html, а не собирается кодом, поэтому ядро
   поднимает её само: соседним модулям звать ничего не нужно. */
function autoDock() {
  for (const node of document.querySelectorAll('[data-sheet]')) {
    if (node.dataset.sheetReady) continue;
    node.dataset.sheetReady = '1';
    dockSheet(node);
  }
}

if (typeof document !== 'undefined') {
  installZoomGuard();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoDock, { once: true });
  } else {
    autoDock();
  }
}
