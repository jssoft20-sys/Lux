/* Кирпичики интерфейса: узлы, тосты, нижние шторки, подтверждения, спиннеры, звёзды.
   Никаких зависимостей — только браузер. Все классы живут в components.css,
   здесь только поведение. Длительности берём из токенов, поэтому режим
   «меньше движения» работает сам собой: там все --dur- равны 1 мс. */

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
