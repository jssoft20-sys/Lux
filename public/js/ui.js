/* Shared UI toolkit. Everything screens need to build views. window.UI */
(function () {
  const Icons = window.Icons;

  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) return child.forEach((c) => append(el, c));
    if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
    else el.appendChild(child);
  }
  function fromHTML(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function svg(name, cls) { const s = h('span', { class: 'ic ' + (cls || ''), html: Icons[name] ? Icons[name]() : '' }); return s; }

  /* ---------- avatar ---------- */
  function initials(name) {
    if (!name) return '?';
    // strip emoji/symbols, keep letters & digits (handles surrogate pairs safely)
    const cleaned = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (!parts.length) { const cp = Array.from(String(name).trim()); return cp.length ? cp[0] : '?'; }
    const first = Array.from(parts[0])[0] || '';
    if (parts.length === 1) return first.toUpperCase();
    const last = Array.from(parts[parts.length - 1])[0] || '';
    return (first + last).toUpperCase();
  }
  const GRADS = ['g0','g1','g2','g3','g4','g5','g6'];
  function gradFor(id) { let s = 0; const str = String(id || ''); for (let i = 0; i < str.length; i++) s += str.charCodeAt(i); return GRADS[s % GRADS.length]; }
  function avatar(entity, size) {
    entity = entity || {};
    size = size || 48;
    const cls = ['avatar'];
    let inner = '';
    if (entity.saved || entity.type === 'saved') cls.push('saved');
    else if (entity.avatar) { /* image */ }
    else cls.push(gradFor(entity.id || entity.name));
    const el = h('div', { class: cls.join(' '), style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px' } });
    if (entity.saved || entity.type === 'saved') { el.innerHTML = Icons.save().replace('currentColor', '#fff'); el.querySelector('svg').style.width = size * 0.5 + 'px'; }
    else if (entity.avatar) el.appendChild(h('img', { src: entity.avatar, alt: '' }));
    else el.textContent = initials((entity.name || '') + (entity.lastName ? ' ' + entity.lastName : '') || entity.title);
    return el;
  }

  /* ---------- header ---------- */
  function iconBtn(name, onClick, cls) {
    return h('button', { class: 'nav-btn circle pill ' + (cls || ''), onClick, html: Icons[name] ? Icons[name]() : name });
  }
  function textBtn(label, onClick, cls) { return h('button', { class: 'nav-btn ' + (cls || ''), onClick, text: label }); }

  function header(opts) {
    opts = opts || {};
    const left = h('div', { class: 'nav-left' });
    const right = h('div', { class: 'nav-right' });
    if (opts.onBack) {
      const b = h('button', { class: 'nav-btn circle pill', onClick: opts.onBack, html: Icons.back() });
      left.appendChild(b);
    }
    if (opts.left) append(left, opts.left);
    if (opts.rightButtons) opts.rightButtons.forEach((rb) => append(right, rb));
    if (opts.right) append(right, opts.right);

    let titleEl;
    if (opts.titleEl) titleEl = opts.titleEl;
    else {
      titleEl = h('div', { class: 'nav-title' + (opts.pillTitle ? ' pill' : '') },
        h('span', { text: opts.title || '' }),
        opts.subtitle ? h('span', { class: 'sub', text: opts.subtitle }) : null);
    }
    return h('div', { class: 'nav ' + (opts.solid ? 'solid' : '') }, left, titleEl, right);
  }

  /* ---------- cells / groups ---------- */
  function group(children, cls) { return h('div', { class: 'group ' + (cls || '') }, children); }
  function cell(opts) {
    const parts = [];
    if (opts.icon) parts.push(h('div', { class: 'ic-box', style: { background: opts.iconBg || 'var(--accent)' }, html: Icons[opts.icon] ? Icons[opts.icon]() : opts.icon }));
    else if (opts.avatar) parts.push(opts.avatar);
    const body = h('div', { class: 'cell-body' },
      h('div', { class: 'cell-title', html: opts.titleHTML, text: opts.titleHTML ? undefined : opts.title }),
      opts.sub ? h('div', { class: 'cell-sub ellipsis', text: opts.sub }) : null);
    parts.push(body);
    const right = h('div', { class: 'cell-right' });
    if (opts.right != null) append(right, typeof opts.right === 'string' ? h('span', { text: opts.right }) : opts.right);
    if (opts.chevron !== false && (opts.onClick || opts.chevron)) right.appendChild(svg('chevron', 'chev'));
    parts.push(right);
    return h('div', { class: 'cell' + (opts.onClick ? ' tap' : '') + (opts.danger ? ' danger' : '') + (opts.link ? ' link' : '') + (opts.noSep ? ' no-sep' : ''), onClick: opts.onClick }, parts);
  }
  function switchEl(on, onChange) {
    const s = h('div', { class: 'switch' + (on ? ' on' : '') });
    s.addEventListener('click', (e) => { e.stopPropagation(); s.classList.toggle('on'); onChange && onChange(s.classList.contains('on')); });
    return s;
  }

  /* ---------- bottom sheet ---------- */
  function sheet(opts) {
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const groups = [];
    const mainGroup = h('div', { class: 'sheet-group' });
    if (opts.title) mainGroup.appendChild(h('div', { class: 'sheet-title', text: opts.title }));
    (opts.actions || []).forEach((a) => {
      if (a.hidden) return;
      const item = h('div', { class: 'sheet-item' + (a.danger ? ' danger' : ''), onClick: () => { close(); a.onClick && a.onClick(); } },
        a.icon ? svg(a.icon) : null, h('span', { text: a.label }));
      mainGroup.appendChild(item);
    });
    groups.push(mainGroup);
    const cancel = h('div', { class: 'sheet-group' }, h('div', { class: 'sheet-item cancel', text: opts.cancelLabel || 'Отмена', onClick: () => close() }));
    groups.push(cancel);
    const sheetEl = h('div', { class: 'sheet' }, groups);
    const layer = App.el.overlayLayer;
    layer.appendChild(backdrop); layer.appendChild(sheetEl);
    requestAnimationFrame(() => { backdrop.classList.add('show'); sheetEl.classList.add('show'); });
    function close() { backdrop.classList.remove('show'); sheetEl.classList.remove('show'); setTimeout(() => { backdrop.remove(); sheetEl.remove(); }, 320); }
    backdrop.addEventListener('click', close);
    return { close };
  }

  /* ---------- modal / confirm / prompt ---------- */
  function modal(opts) {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const bodyEls = [];
    if (opts.title) bodyEls.push(h('div', { class: 'modal-title', text: opts.title }));
    if (opts.text) bodyEls.push(h('div', { class: 'modal-text', html: opts.textHTML ? opts.text : undefined, text: opts.textHTML ? undefined : opts.text }));
    if (opts.content) bodyEls.push(opts.content);
    const modalEl = h('div', { class: 'modal' }, h('div', { class: 'modal-body' }, bodyEls));
    const actions = h('div', { class: 'modal-actions' });
    (opts.actions || [{ label: 'OK' }]).forEach((a) => {
      actions.appendChild(h('button', { class: (a.danger ? 'danger ' : '') + (a.bold ? 'bold' : ''), text: a.label, onClick: () => { close(); a.onClick && a.onClick(); } }));
    });
    modalEl.appendChild(actions);
    backdrop.appendChild(modalEl);
    App.el.overlayLayer.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    function close() { backdrop.classList.remove('show'); setTimeout(() => backdrop.remove(), 200); }
    if (opts.dismissable !== false) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    return { close, el: modalEl };
  }
  function confirm(opts) {
    return new Promise((res) => {
      modal({ title: opts.title, text: opts.text, actions: [
        { label: opts.cancelLabel || 'Отмена', onClick: () => res(false) },
        { label: opts.okLabel || 'OK', danger: opts.danger, bold: true, onClick: () => res(true) },
      ] });
    });
  }
  function prompt(opts) {
    return new Promise((res) => {
      const input = h('input', { class: 'modal-input', placeholder: opts.placeholder || '', value: opts.value || '' });
      const m = modal({ title: opts.title, text: opts.text, content: input, actions: [
        { label: 'Отмена', onClick: () => res(null) },
        { label: opts.okLabel || 'OK', bold: true, onClick: () => res(input.value.trim()) },
      ] });
      setTimeout(() => input.focus(), 100);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { m.close(); res(input.value.trim()); } });
    });
  }

  /* ---------- context menu ---------- */
  function contextMenu(x, y, items, opts) {
    opts = opts || {};
    const backdrop = h('div', { class: 'ctx-backdrop' });
    const menu = h('div', { class: 'ctx-menu' });
    items.forEach((it) => {
      if (it.hidden) return;
      if (it.sep) { menu.appendChild(h('div', { style: { height: '6px', background: 'var(--sep)' } })); return; }
      menu.appendChild(h('div', { class: 'ctx-item' + (it.danger ? ' danger' : ''), onClick: () => { close(); it.onClick && it.onClick(); } },
        h('span', { text: it.label }), it.icon ? svg(it.icon) : null));
    });
    App.el.overlayLayer.appendChild(backdrop); App.el.overlayLayer.appendChild(menu);
    const rect = App.el.phone.getBoundingClientRect();
    const mw = 230, mh = items.length * 46;
    let px = x - rect.left, py = y - rect.top;
    if (px + mw > rect.width - 8) px = rect.width - mw - 8;
    if (py + mh > rect.height - 8) py = Math.max(8, rect.height - mh - 8);
    menu.style.left = Math.max(8, px) + 'px'; menu.style.top = Math.max(8, py) + 'px';
    if (opts.header) { menu.insertBefore(h('div', { class: 'ctx-item', style: { pointerEvents: 'none', opacity: .6, fontSize: '14px' }, text: opts.header }), menu.firstChild); }
    requestAnimationFrame(() => { backdrop.classList.add('show'); menu.classList.add('show'); });
    function close() { backdrop.classList.remove('show'); menu.classList.remove('show'); setTimeout(() => { backdrop.remove(); menu.remove(); }, 200); }
    backdrop.addEventListener('click', close);
    return { close, menu };
  }

  /* ---------- toast ---------- */
  let toastWrap;
  function toast(msg, icon) {
    if (!toastWrap) { toastWrap = h('div', { class: 'toast-wrap' }); App.el.overlayLayer.appendChild(toastWrap); }
    const t = h('div', { class: 'toast' }, icon ? svg(icon) : null, h('span', { text: msg }));
    toastWrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
  }

  /* ---------- time / date ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function timeShort(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dateShort(ts) {
    const d = new Date(ts), now = new Date();
    const days = ['вс','пн','вт','ср','чт','пт','сб'];
    const diff = (startOfDay(now) - startOfDay(d)) / 86400000;
    if (diff === 0) return timeShort(ts);
    if (diff === 1) return 'вчера';
    if (diff < 7) return days[d.getDay()];
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function daySep(ts) {
    const d = new Date(ts), now = new Date();
    const diff = (startOfDay(now) - startOfDay(d)) / 86400000;
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function lastSeen(user) {
    if (!user) return '';
    if (user.online) return 'в сети';
    const diff = Date.now() - (user.lastSeen || 0);
    if (diff < 60000) return 'был(а) только что';
    if (diff < 3600000) return 'был(а) ' + Math.floor(diff / 60000) + ' мин назад';
    if (diff < 86400000) return 'был(а) недавно';
    if (diff < 7 * 86400000) return 'был(а) на этой неделе';
    return 'был(а) очень давно';
  }
  function duration(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) { const hh = Math.floor(m / 60); return hh + ':' + pad(m % 60) + ':' + pad(s); }
    return m + ':' + pad(s);
  }
  function fileSize(bytes) {
    if (!bytes) return '';
    const u = ['B','KB','MB','GB']; let i = 0; let n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
  }

  /* ---------- effects ---------- */
  function flyHeart(x, y, emoji) {
    const el = h('div', { class: 'fly-heart', text: emoji || '❤️' });
    const rect = App.el.phone.getBoundingClientRect();
    el.style.left = (x - rect.left) + 'px'; el.style.top = (y - rect.top) + 'px';
    App.el.overlayLayer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  window.UI = {
    h, append, fromHTML, clear, svg, initials, gradFor, avatar, header, iconBtn, textBtn,
    group, cell, switchEl, sheet, modal, confirm, prompt, contextMenu, toast,
    timeShort, dateShort, daySep, lastSeen, duration, fileSize, flyHeart, pad,
  };
})();
