/* PayGo Admin SPA — phone-shell layout (Главная / История / Чат / Поиск / Меню). No build step. */
(function () {
  'use strict';
  const BASE = location.pathname.replace(/\/[^/]*$/, '') || '';
  const API = BASE + '/api';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const state = { admin: null, route: { page: 'home', id: null, sub: null }, live: null, poll: null, lastNotifId: 0, cashes: [], types: [], quick: [], homeTab: 'actual', historyTab: 'all', historyFilters: {}, chatTab: 'open', chatKind: 'all', chatQuery: '', searchQuery: '' };
  const ICON = { peek: 'M1.5 12C4.5 6.8 8 4.3 12 4.3s7.5 2.5 10.5 7.7C19.5 17.2 16 19.7 12 19.7S4.5 17.2 1.5 12Z M12 15.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z', home: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z', history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2', chat: 'M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z', search: 'M11 19a8 8 0 1 1 5.66-2.34L22 22', menu: 'M4 6h16M4 12h16M4 18h16', back: 'M19 12H5M11 18l-6-6 6-6', copy: 'M9 9h10v10H9zM5 15H4V5h10v1', check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M18 6 6 18', user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', more: 'M12 5h.01M12 12h.01M12 19h.01', stats: 'M5 20V10M12 20V4M19 20v-7M3 20h18', wallet: 'M4 7h15v12H4zM4 7l2-3h11l2 3M15 12h4v3h-4z', mail: 'M3 5h18v14H3zM3 6l9 7 9-7', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5', settings: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5ZM19 12l2-1-1-3-2 .2-1.4-1.4.2-2-3-1-1 2-2 0-1-2-3 1 .2 2L6.2 8.2 4 8l-1 3 2 1v2l-2 1 1 3 2.2-.2L7.8 19l-.2 2 3 1 1-2h2l1 2 3-1-.2-2 1.4-1.4 2 .2 1-3-2-1Z', plus: 'M12 5v14M5 12h14', chevron: 'M9 6l6 6-6 6', send: 'M22 2 11 13M22 2l-7 20-4-9-9-4Z', image: 'M4 4h16v16H4zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 18l4.5-4.5 3 3 2-2L19 18', trash: 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5', refresh: 'M20 6v5h-5M4 18v-5h5M6.1 8A7 7 0 0 1 18 6l2 5M18 16a7 7 0 0 1-12 2l-2-5', logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9', note: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM8 2v4M16 2v4M3 9h18', shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-5', filter: 'M4 5h16l-6 7v6l-4 2v-8Z', arrowDown: 'M12 5v14m-6-6 6 6 6-6', arrowUp: 'M12 19V5m-6 6 6-6 6 6', edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4', bank: 'M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3l9-5Z', bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z' };

  /* ------------------------------------------------------------- utils */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
    return el;
  }
  function svg(name, size) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'icon'); s.setAttribute('width', size || 20); s.setAttribute('height', size || 20); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[name] || ICON.menu); s.appendChild(p); return s; }
  const money = (v) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
  const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const fmtTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const ago = (v) => { if (!v) return ''; const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000); if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин'; if (s < 86400) return Math.floor(s / 3600) + ' ч'; return Math.floor(s / 86400) + ' дн'; };
  const MONTHS = ['ЯНВАРЯ', 'ФЕВРАЛЯ', 'МАРТА', 'АПРЕЛЯ', 'МАЯ', 'ИЮНЯ', 'ИЮЛЯ', 'АВГУСТА', 'СЕНТЯБРЯ', 'ОКТЯБРЯ', 'НОЯБРЯ', 'ДЕКАБРЯ'];
  function dayKey(v) { const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(key) { const today = dayKey(new Date()); const y = new Date(Date.now() - 86400000); if (key === today) return 'СЕГОДНЯ'; if (key === dayKey(y)) return 'ВЧЕРА'; const p = key.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + (p[0] !== String(new Date().getFullYear()) ? ' ' + p[0] : ''); }
  function groupByDay(list) { const map = {}, order = []; list.forEach((x) => { const k = dayKey(x.created_at); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(x); }); return order.map((k) => ({ key: k, label: dayLabel(k), items: map[k] })); }
  function getCookie(name) { return document.cookie.split('; ').map((x) => x.split('=')).filter((x) => x[0] === name).map((x) => decodeURIComponent(x[1]))[0] || ''; }
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    if ((opts.method || 'GET') !== 'GET') headers['X-CSRF-Token'] = (state.admin && state.admin.csrf_token) || getCookie('paygo_csrf');
    let res;
    try { res = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, opts, { headers })); } catch (e) { throw new Error('Нет соединения с сервером'); }
    let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
    if (res.status === 401) { if (state.admin) { state.admin = null; render(); } throw new Error('Сессия истекла — войдите снова'); }
    if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || ('Ошибка ' + res.status));
    return data;
  }
  function fileUrl(u) { u = String(u || ''); if (u.startsWith('/uploads/')) return API + '/files/' + u.slice(9); if (u.startsWith('uploads/')) return API + '/files/' + u.slice(8); if (u.startsWith('/')) return BASE + u; return u; }
  function toast(text, kind, ms) { const el = h('div', { class: 'toast ' + (kind || '') }, text); $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, ms || (kind === 'err' ? 4200 : 2400)); return el; }
  const err = (e) => toast(e && e.message ? e.message : String(e), 'err');
  function copy(text) { navigator.clipboard && navigator.clipboard.writeText(String(text)).then(() => toast('Скопировано', 'ok', 1200)).catch(() => {}); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function confirmDialog(text, okLabel, danger) { return new Promise((resolve) => { const s = sheet({ title: 'Подтверждение', body: h('p', { style: { margin: '4px 0 8px', fontSize: '13px', lineHeight: '1.4' } }, text), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(false); } }, 'Отмена'), h('button', { class: 'action-btn ' + (danger ? 'danger' : 'primary'), onclick: () => { s.close(); resolve(true); } }, okLabel || 'Да')] }); }); }
  function promptDialog(title, label, placeholder, value) { return new Promise((resolve) => { const input = h('textarea', { class: 'textarea', placeholder: placeholder || '' }, value || ''); const s = sheet({ title, body: h('label', { class: 'field' }, h('span', null, label || ''), input), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(null); } }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { s.close(); resolve(input.value.trim()); } }, 'Продолжить')] }); setTimeout(() => input.focus(), 60); }); }



  /* ------------------------------------------------------------- sheet (modal) — drag down to close, drag up to expand */
  function sheet(opts) {
    const root = $('#modal-root');
    const titleNode = h('h2', null, typeof opts.title === 'string' || typeof opts.title === 'number' ? String(opts.title) : (opts.title || ''));
    const grab = h('div', { class: 'sheet-grab' });
    const head = h('div', { class: 'sheet-head' }, titleNode, h('button', { class: 'close', 'aria-label': 'Закрыть', onclick: () => api_.close() }, svg('close', 16)));
    const bodyEl = h('div', { class: 'sheet-body' }, opts.body);
    const box = h('div', { class: 'sheet' + (opts.full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true' }, grab, head, bodyEl, opts.actions && opts.actions.length ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null);
    const openedAt = Date.now();
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back && Date.now() - openedAt > 450) api_.close(); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') api_.close(); };
    if (opts.guardMs) box.addEventListener('click', (e) => { if (Date.now() - openedAt < opts.guardMs) { e.stopPropagation(); e.preventDefault(); } }, true); /* the release of a long press must not press a menu item */
    let closed = false, drag = null;
    const api_ = {
      el: box, body: bodyEl,
      close() { if (closed) return; closed = true; box.classList.add('closing'); back.classList.add('closing'); setTimeout(() => back.remove(), 170); document.removeEventListener('keydown', onKey); if (!document.querySelector('.sheet-back:not(.closing)')) document.body.style.overflow = ''; if (opts.onClose) opts.onClose(); },
      setBody(node) { bodyEl.innerHTML = ''; bodyEl.appendChild(node); },
      setActions(nodes) { let a = $('.sheet-actions', box); if (!nodes || !nodes.length) { if (a) a.remove(); return; } if (!a) { a = h('div', { class: 'sheet-actions' }); box.appendChild(a); } a.innerHTML = ''; nodes.forEach((n) => a.appendChild(n)); },
      setTitle(node) { titleNode.innerHTML = ''; titleNode.appendChild(typeof node === 'string' ? document.createTextNode(node) : node); },
    };
    const start = (y, fromBody) => { drag = { y0: y, y, t0: Date.now(), fromBody, moved: false, dead: false }; box.style.transition = 'none'; };
    const move = (y, e) => {
      if (!drag || drag.dead) return; const dy = y - drag.y0; drag.y = y;
      if (!drag.moved) {
        if (Math.abs(dy) < 6) return; /* finger jitter: not a decision yet */
        if (drag.fromBody && (bodyEl.scrollTop > 0 || dy < 0)) { drag.dead = true; box.style.transition = ''; return; } /* let the body scroll */
        drag.moved = true;
      }
      if (e && e.cancelable) e.preventDefault();
      if (dy > 0) box.style.transform = 'translateY(' + dy + 'px)';
      else { box.style.transform = 'translateY(' + Math.max(-24, dy / 4) + 'px)'; if (dy < -36) box.classList.add('full'); }
    };
    const end = () => {
      if (!drag) return; const dy = drag.moved ? drag.y - drag.y0 : 0; const v = dy / Math.max(1, Date.now() - drag.t0); const moved = drag.moved; box.style.transition = ''; drag = null;
      if (!moved) { box.style.transform = ''; return; }
      if (box.classList.contains('full') && !opts.full && dy > 40 && dy < 220 && v < 0.5) { box.classList.remove('full'); box.style.transform = ''; return; }
      if (dy > 100 || (dy > 24 && v > 0.5)) { api_.close(); return; }
      box.style.transform = '';
    };
    /* head + grab: pointer events with capture — works for touch, pen and mouse */
    [grab, head].forEach((el) => {
      el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (x) {} } start(e.clientY, false); });
      el.addEventListener('pointermove', (e) => { if (drag && !drag.fromBody) move(e.clientY, e); });
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    });
    /* body: touch drag down from the very top of the content */
    bodyEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && !drag) start(e.touches[0].clientY, true); }, { passive: true });
    bodyEl.addEventListener('touchmove', (e) => { if (drag && drag.fromBody) move(e.touches[0].clientY, e); }, { passive: false });
    bodyEl.addEventListener('touchend', () => { if (drag && drag.fromBody) end(); }); bodyEl.addEventListener('touchcancel', () => { if (drag && drag.fromBody) end(); });
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(back);
    return api_;
  }
  function closeSheets() { document.querySelectorAll('.sheet-back').forEach((el) => el.remove()); document.body.style.overflow = ''; }
  function imageSheet(title, src, caption) { sheet({ title, full: true, body: h('div', { class: 'img-sheet' }, h('img', { src, alt: '' }), caption ? h('small', null, caption) : null) }); }
  function actionSheet(title, items) {
    /* quick vertical menu: [{label, icon, cls, onclick}] */
    const s = sheet({ title, guardMs: 420, body: h('div', { class: 'menu-list' }, items.filter(Boolean).map((it) => h('button', { class: 'menu-item ' + (it.cls || ''), onclick: () => { s.close(); it.onclick(); } }, it.icon ? svg(it.icon, 17) : null, it.label))) });
    return s;
  }

  /* ------------------------------------------------------------- components */
  const STATUS = { created: ['Ожидает', 'blue'], processing: ['В обработке', 'blue'], success: ['Успешно', 'success'], failed: ['Проблема', 'problem'], cancelled: ['Отменено', 'rejected'], expired: ['Истекло', 'rejected'], auto: ['Авто', ''], waiting_operator: ['Ждёт оператора', 'problem'], operator: ['У оператора', 'blue'], resolved: ['Закрыто', 'success'], closed: ['Закрыто', 'rejected'], online: ['Онлайн', 'success'], error: ['Ошибка', 'problem'], low: ['Мало средств', 'pending'], disabled: ['Отключена', 'rejected'], auto_disabled: ['Автостоп', 'problem'], unknown: ['Не проверена', ''] };
  function statusEl(status, label) { const m = STATUS[status] || [status, '']; const cls = (status === 'created' && label && /проблем|внимание/i.test(label)) ? 'problem' : m[1]; return h('span', { class: 'status ' + cls }, h('i'), label || m[0]); }
  function txStatus(tx) { if (tx.needs_attention && tx.status !== 'success') return statusEl('failed', 'Проблема'); return statusEl(tx.status, tx.status_label); }
  function switchEl(on, onChange) { const b = h('button', { class: 'switch ' + (on ? 'on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false' }, h('i')); b.onclick = async () => { b.disabled = true; try { await onChange(!b.classList.contains('on')); b.classList.toggle('on'); } catch (e) { if (!e || e.message !== '__cancel__') err(e); } b.disabled = false; }; return b; }
  function art(kind) {
    /* small animated scenes for empty states (pure CSS keyframes, no libraries) */
    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, ...kids) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); kids.forEach((c) => n.appendChild(c)); return n; };
    const root = el('svg', { viewBox: '0 0 120 90', class: 'art art-' + kind, width: '150', height: '112', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (kind === 'home') {
      root.appendChild(el('circle', { cx: 60, cy: 45, r: 30, class: 'ring ring1' }));
      root.appendChild(el('circle', { cx: 60, cy: 45, r: 30, class: 'ring ring2' }));
      root.appendChild(el('circle', { cx: 60, cy: 45, r: 22, class: 'disc' }));
      root.appendChild(el('path', { d: 'M48 46l8 8 16-17', class: 'check' }));
      return root;
    }
    if (kind === 'history' || kind === 'wallet' || kind === 'calendar') {
      [[-16, 0, 'c1'], [0, -6, 'c2'], [16, 4, 'c3']].forEach(([dx, dy, cls]) => root.appendChild(el('g', { class: 'card ' + cls, transform: 'translate(' + dx + ' ' + dy + ')' }, el('rect', { x: 34, y: 22, width: 52, height: 40, rx: 8, class: 'paper' }), el('rect', { x: 42, y: 32, width: 22, height: 4, rx: 2, class: 'line' }), el('rect', { x: 42, y: 41, width: 34, height: 4, rx: 2, class: 'line' }), el('rect', { x: 42, y: 50, width: 16, height: 4, rx: 2, class: 'line' }))));
      root.appendChild(el('circle', { cx: 22, cy: 26, r: 3, class: 'spark s1' })); root.appendChild(el('circle', { cx: 100, cy: 68, r: 2.5, class: 'spark s2' })); root.appendChild(el('circle', { cx: 96, cy: 20, r: 2, class: 'spark s3' }));
      return root;
    }
    if (kind === 'chat') {
      root.appendChild(el('path', { d: 'M22 30h44a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H40l-12 9v-9h-6a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z', class: 'bubble b1' }));
      root.appendChild(el('path', { d: 'M62 18h36a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-6v8l-10-8H62a7 7 0 0 1-7-7V25a7 7 0 0 1 7-7z', class: 'bubble b2' }));
      [[36, 45], [46, 45], [56, 45]].forEach(([x, y], i) => root.appendChild(el('circle', { cx: x, cy: y, r: 3, class: 'dot d' + (i + 1) })));
      return root;
    }
    if (kind === 'search') {
      root.appendChild(el('circle', { cx: 52, cy: 40, r: 20, class: 'lens' }));
      root.appendChild(el('path', { d: 'M67 55l16 16', class: 'handle' }));
      root.appendChild(el('path', { d: 'M40 40a12 12 0 0 1 12-12', class: 'shine' }));
      root.appendChild(el('g', { class: 'orbit' }, el('circle', { cx: 92, cy: 22, r: 3, class: 'spark s1' }), el('circle', { cx: 20, cy: 62, r: 2.5, class: 'spark s2' })));
      return root;
    }
    if (kind === 'bell') {
      root.appendChild(el('g', { class: 'bell' }, el('path', { d: 'M60 20c-11 0-18 8-18 18v12l-6 8h48l-6-8V38c0-10-7-18-18-18z', class: 'body' }), el('path', { d: 'M54 62a6 6 0 0 0 12 0', class: 'clapper' })));
      root.appendChild(el('circle', { cx: 78, cy: 26, r: 5, class: 'badge' }));
      return root;
    }
    root.appendChild(el('g', { class: 'float' }, el('rect', { x: 36, y: 24, width: 48, height: 42, rx: 10, class: 'paper' }), el('circle', { cx: 60, cy: 45, r: 9, class: 'disc' })));
    root.appendChild(el('circle', { cx: 24, cy: 30, r: 2.5, class: 'spark s1' })); root.appendChild(el('circle', { cx: 98, cy: 62, r: 2.5, class: 'spark s2' }));
    return root;
  }
  function empty(title, text, icon) { return h('div', { class: 'empty' }, art(icon || 'history'), h('b', null, title || 'Пока пусто'), text ? h('span', null, text) : null); }
  function loader(n) { return h('div', null, Array.from({ length: n || 3 }).map(() => h('div', { class: 'sk' }))); }
  function header(title, opts) { opts = opts || {}; return h('header', { class: 'v9-header' }, opts.back === false ? h('span', { class: 'header-spacer' }) : h('button', { class: 'header-btn', 'aria-label': 'Назад', onclick: () => (typeof opts.back === 'function' ? opts.back() : history.length > 1 ? history.back() : go('#/menu')) }, svg('back', 18)), h('h1', null, title), opts.right || h('span', { class: 'header-spacer' })); }
  function segEl(items, active, onSelect, cls) { return h('div', { class: 'seg ' + (cls || '') }, items.map(([key, label, count]) => h('button', { class: key === active ? 'active' : '', onclick: () => onSelect(key) }, label, count !== undefined && count !== null ? h('i', null, count) : null))); }
  function editable(value, opts) {
    const wrap = h('span', { class: 'editable' });
    const show = () => { wrap.innerHTML = ''; wrap.appendChild(h('span', null, opts.render ? opts.render(value) : (value === '' || value === null || value === undefined ? '—' : String(value)))); if (!opts.readonly) wrap.appendChild(h('button', { class: 'pen', title: 'Изменить', onclick: edit }, svg('edit', 13))); };
    const edit = () => { const input = opts.options ? h('select', { class: 'select' }, opts.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))) : h('input', { class: 'input', value: value === null || value === undefined ? '' : value, type: opts.type || 'text' }); const save = async () => { try { const v = input.value; const res = await opts.save(v); value = res === undefined || res === null ? v : res; toast('Сохранено', 'ok', 1300); show(); } catch (e) { err(e); } }; wrap.innerHTML = ''; wrap.appendChild(h('span', { class: 'inline' }, input, h('button', { class: 'outline-btn blue', onclick: save }, '✓'), h('button', { class: 'outline-btn', onclick: show }, '✕'))); input.focus(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') show(); }); };
    show(); return wrap;
  }
  function kv(rows) { return h('dl', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === undefined || v === null || v === '' ? '—' : v)])); }
  function timeline(items) { if (!items || !items.length) return h('div', { class: 'muted small' }, 'История пуста'); return h('ul', { class: 'timeline' }, items.map((it) => h('li', { class: it.level || '' }, h('time', null, fmtDate(it.at)), h('div', null, it.title), it.detail ? h('div', { class: 'muted small' }, it.detail) : null))); }
  function pager(page, size, total, go_) { const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return null; return h('div', { class: 'pager' }, h('button', { class: 'outline-btn', disabled: page <= 1, onclick: () => go_(page - 1) }, '‹'), h('span', { class: 'muted small' }, page + ' / ' + pages), h('button', { class: 'outline-btn', disabled: page >= pages, onclick: () => go_(page + 1) }, '›')); }
  function txCard(tx, opts) {
    opts = opts || {};
    const dep = tx.kind === 'deposit';
    const problem = tx.status === 'failed' || (tx.needs_attention && tx.status !== 'success');
    const pay = tx.payment;
    const card = h('button', { class: 'tx-card', onclick: () => go('#/' + (dep ? 'deposits' : 'withdrawals') + '/' + tx.id) },
      h('span', { class: 'tx-logo-wrap' }, h('span', { class: 'tx-logo' }, h('img', { src: 'brand/payqr.png', alt: '' })), h('i', { class: 'tx-flow ' + (dep ? 'deposit' : 'withdraw') }, svg(dep ? 'arrowDown' : 'arrowUp', 13))),
      h('span', { class: 'tx-copy' }, h('b', null, clientName(tx)), h('small', null, (tx.cash_name || '').toUpperCase() + ' • ' + tx.player_id), h('em', null, '# ' + (tx.public_id || tx.id).replace(/^[DW]-/, ''), h('span', { class: 'tx-peek', role: 'button', 'aria-label': 'Быстрый просмотр', onclick: (e) => { e.stopPropagation(); openTxSheet(tx.kind, tx.id); } }, svg('peek', 16)))),
      h('span', { class: 'tx-side' }, h('time', null, fmtDate(tx.created_at)), h('strong', { class: 'tx-amount ' + (dep ? 'deposit' : 'withdraw') }, (dep ? '+' : '−') + money(dep ? tx.pay_amount : tx.amount)), txStatus(tx)),
      pay ? h('span', { class: 'tx-pay ' + pay.kind }, svg(pay.kind === 'matched' ? 'check' : 'bolt', 12), (pay.kind === 'matched' ? 'Платёж получен · ' : 'Есть платёж на эту сумму · ') + srcLabel(pay.source) + ' · ' + fmtTime(pay.received_at) + ' · ' + money(pay.amount)) : null);
    if (!problem || opts.noAlert) return card;
    const title = dep ? 'Надо пополнить: деньги пришли, букмекер не зачислил' : 'Нужна проверка: касса не подтвердила сумму вывода';
    return h('div', null, card, h('div', { class: 'tx-attn' }, h('b', null, title), h('small', null, tx.error || 'Откройте заявку и повторите операцию.')));
  }
  const clientName = (tx) => (tx.player_name && tx.player_name.trim()) || tx.user_name || 'Клиент';
  function txGroups(list, opts) { opts = opts || {}; const groups = groupByDay(list); return h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((tx, i) => { const card = txCard(tx, opts); card.style.setProperty('--i', Math.min(i, 10)); const sw = opts.swipe && opts.swipe(tx); return sw ? swipeRow(card, sw) : card; }))))); }
  function swipeRow(card, opts) {
    /* swipe right → reveals one action (old admin: «Отложить») */
    const wrap = h('div', { class: 'swipe-wrap' }, h('div', { class: 'swipe-action ' + (opts.color || 'amber') }, svg(opts.icon || 'history', 18), h('span', null, opts.label)), h('div', { class: 'swipe-card' }, card));
    const inner = wrap.lastChild; let s = null;
    inner.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; s = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, lock: null }; inner.style.transition = 'none'; }, { passive: true });
    inner.addEventListener('touchmove', (e) => { if (!s) return; const dx = e.touches[0].clientX - s.x0, dy = e.touches[0].clientY - s.y0; if (s.lock === null) { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; s.lock = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'x' : 'y'; } if (s.lock !== 'x') return; if (e.cancelable) e.preventDefault(); s.dx = Math.max(0, Math.min(dx, 150)); inner.style.transform = 'translateX(' + s.dx + 'px)'; wrap.classList.toggle('armed', s.dx > 92); }, { passive: false });
    const end = () => { if (!s) return; const dx = s.dx; s = null; inner.style.transition = ''; wrap.classList.remove('armed'); if (dx > 92) { inner.style.transform = 'translateX(150px)'; wrap.classList.add('done'); if (navigator.vibrate) navigator.vibrate(10); Promise.resolve(opts.onAction()).catch(err).then(() => { inner.style.transform = ''; wrap.classList.remove('done'); }); } else { inner.style.transform = ''; if (dx > 4) { inner.dataset.swiped = '1'; setTimeout(() => { delete inner.dataset.swiped; }, 350); } } };
    inner.addEventListener('touchend', end); inner.addEventListener('touchcancel', end);
    inner.addEventListener('click', (e) => { if (inner.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
    return wrap;
  }

  /* ------------------------------------------------------------- feel: ripple, haptics, hold-to-open */
  const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
  function buzz(ms) { try { if (navigator.vibrate && isTouch()) navigator.vibrate(ms || 8); } catch (e) {} }
  const RIPPLE_SEL = '.action-btn,.primary-btn,.outline-btn,.big-btn,.menu-tile,.tx-card,.row-card,.wallet-card,.chat-row,.nav-item,.seg button,.settings-tabs button,.kind-tabs button,.chat-tabs button,.user-card,.menu-item,.header-btn,.refresh-btn,.setting-row.tap';
  document.addEventListener('touchstart', () => {}, { passive: true }); /* enables :active on iOS Safari */
  const unpress = () => document.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'dragstart'].forEach((t) => document.addEventListener(t, unpress, { passive: true }));
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(RIPPLE_SEL); if (!el || el.disabled) return;
    el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 600);
    const rect = el.getBoundingClientRect(); const size = Math.max(rect.width, rect.height) * 1.4;
    const r = h('span', { class: 'ripple', style: { width: size + 'px', height: size + 'px', left: (e.clientX - rect.left - size / 2) + 'px', top: (e.clientY - rect.top - size / 2) + 'px' } });
    el.appendChild(r); setTimeout(() => r.remove(), 520);
    if (el.matches('.action-btn,.primary-btn,.big-btn,.nav-item,.menu-tile,.send-btn')) buzz(6);
  }, { passive: true });
  function holdMenu(el, onHold) {
    /* long-press (touch) or right-click (desktop) → context menu; fires once per press */
    let timer = null, x0 = 0, y0 = 0, fired = 0;
    const fire = () => { if (Date.now() - fired < 700) return; fired = Date.now(); el.classList.remove('holding'); buzz(12); onHold(); };
    const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('holding'); };
    el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; el.classList.add('holding'); timer = setTimeout(() => { timer = null; fire(); }, 380); }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (timer && (Math.abs(e.touches[0].clientX - x0) > 8 || Math.abs(e.touches[0].clientY - y0) > 8)) cancel(); }, { passive: true });
    el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); fire(); });
    el.addEventListener('mousedown', (e) => { if (e.button !== 0) return; timer = setTimeout(() => { timer = null; fire(); }, 450); });
    el.addEventListener('mouseup', cancel); el.addEventListener('mouseleave', cancel);
    el.addEventListener('click', (e) => { if (Date.now() - fired < 700) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  /* ------------------------------------------------------------- router / shell */
  function parseHash() { const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/'); return { page: parts[0] || 'home', id: parts[1] || null, sub: parts[2] || null }; }
  window.addEventListener('hashchange', () => { closeSheets(); state.route = parseHash(); render(); window.scrollTo(0, 0); });
  const go = (hash) => { location.hash = hash; };
  const TOP = ['home', 'history', 'chats', 'search', 'users', 'menu'];
  const NAV = [['home', 'Главная', 'home'], ['history', 'История', 'history'], ['chats', 'Чат', 'chat'], ['search', 'Поиск', 'search'], ['users', 'Люди', 'user'], ['menu', 'Меню', 'menu']];
  function can(p) { return !!(state.admin && state.admin.permissions.includes(p)); }
  function navBadge(page) { const q = state.live && state.live.queues; if (!q) return 0; if (page === 'home') return q.deposits_failed + q.withdrawals_attention; if (page === 'chats') return q.support_waiting; return 0; }
  function render() {
    const app = $('#app'); app.innerHTML = '';
    if (!state.admin) { app.appendChild(loginView()); return; }
    const page = state.route.page;
    const noNav = (page === 'chats' || page === 'users') && !!state.route.id;
    const shell = h('div', { class: 'shell page-in ' + (noNav ? 'no-nav' : '') });
    document.documentElement.classList.toggle('chat-open', noNav);
    app.appendChild(shell);
    const views = { home: homeView, history: historyView, chats: chatsView, search: searchView, users: state.route.id ? (m) => userDetailView(m, state.route.id) : usersView, menu: menuView, manage: manageView, stats: statsView, cashes: cashesView, events: eventsView, wallets: walletsView, broadcast: broadcastView, security: securityView, quick: quickView, logs: logsView, settings: settingsView, macrodroid: macrodroidView, deposits: (m) => txDetailView(m, 'deposits', state.route.id), withdrawals: (m) => txDetailView(m, 'withdrawals', state.route.id), push: pushView, env: envView };
    (views[page] || homeView)(shell);
    if (!noNav) shell.appendChild(bottomNav(page));
  }
  function bottomNav(page) {
    const active = TOP.includes(page) ? page : (['deposits', 'withdrawals'].includes(page) ? 'home' : 'menu');
    return h('nav', { class: 'bottom-nav' }, NAV.map(([key, label, icon]) => { const n = navBadge(key); return h('button', { class: 'nav-item ' + (active === key ? 'active' : ''), onclick: () => go('#/' + key) }, h('span', { class: 'nav-icon' }, svg(icon, 20), n ? h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n) : null), label); }));
  }
  function updateBadges() { document.querySelectorAll('.bottom-nav .nav-item').forEach((b, i) => { const key = NAV[i][0]; const old = b.querySelector('.nav-badge'); if (old) old.remove(); const n = navBadge(key); if (n) b.querySelector('.nav-icon').appendChild(h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n)); }); }

  /* ------------------------------------------------------------- auth / live */
  function deviceHint() { try { const d = navigator.userAgentData; if (d && d.platform) return d.platform + (d.mobile ? ' · телефон' : ''); } catch (e) { /* older browsers */ } return ''; }
  function loginView() {
    const user = h('input', { class: 'input', placeholder: 'Логин', autocomplete: 'username', autocapitalize: 'none' });
    const pass = h('input', { class: 'input', placeholder: 'Пароль', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'primary-btn' }, 'Войти');
    const form = h('form', { class: 'card login-card', onsubmit: async (e) => { e.preventDefault(); btn.disabled = true; try { const r = await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value, device: deviceHint() } }); if (r.pending) { const app = $('#app'); app.innerHTML = ''; app.appendChild(authWaitView(r)); return; } state.admin = r.admin; state.route = parseHash(); startLive(); render(); } catch (ex) { err(ex); } btn.disabled = false; } },
      h('div', { class: 'brand' }, h('img', { src: 'brand/paygo-logo.png', alt: '' }), h('div', null, h('b', null, 'PayGo'), h('small', null, 'Панель управления'))),
      h('label', { class: 'field' }, h('span', null, 'Логин'), user), h('label', { class: 'field' }, h('span', null, 'Пароль'), pass), btn);
    return h('div', { class: 'shell no-nav' }, h('div', { class: 'login' }, form));
  }
  function authWaitView(r) {
    /* the owner confirms the login in the main bot; meanwhile the screen "checks the session" */
    const lines = h('div', { class: 'hk-lines' }); const cursor = h('span', { class: 'hk-cursor' }, '▌');
    const timer = h('div', { class: 'hk-timer' }, '--:--'); const status = h('div', { class: 'hk-status' }); const ring = h('i');
    const cancelBtn = h('button', { class: 'hk-btn', type: 'button', onclick: () => { stopped = true; render(); } }, 'Отмена');
    const screen = h('div', { class: 'hk' }, h('div', { class: 'hk-bg' }), h('div', { class: 'hk-card' }, h('div', { class: 'hk-head' }, h('span', { class: 'hk-dot' }), 'PAYGO // SECURE ACCESS'), lines, cursor, h('div', { class: 'hk-ring' }, ring, timer), status, cancelBtn));
    const script = [['> инициализация защищённого канала', 'OK'], ['> устройство: ' + (r.device || 'неизвестно'), 'OK'], ['> ip: ' + (r.ip || '—'), 'OK'], ['> запрос подтверждения → @' + (r.approver_bot || 'PayGoXBot'), 'SENT'], ['> ожидание решения владельца', '···']];
    let i = 0, stopped = false;
    const typeLine = () => { if (stopped || i >= script.length) return; const [t, tag] = script[i++]; const row = h('div', { class: 'hk-line' }, h('span', null, ''), h('b', { class: tag === '···' ? '' : 'ok' }, tag)); lines.appendChild(row); let k = 0; const tick = () => { if (stopped) return; row.firstChild.textContent = t.slice(0, ++k); if (k < t.length) setTimeout(tick, 12); else setTimeout(typeLine, 200); }; tick(); };
    typeLine();
    const total = Math.max(30, r.expires_in || 180); const deadline = Date.now() + total * 1000;
    const fmt = (sec) => String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    const finish = (ok, text) => { stopped = true; cursor.hidden = true; status.textContent = text; status.className = 'hk-status ' + (ok ? 'ok' : 'bad'); screen.classList.add(ok ? 'granted' : 'denied'); cancelBtn.textContent = ok ? 'Открываю…' : 'Назад'; buzz(ok ? 30 : 60); };
    const poll = async () => {
      if (stopped) return;
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000)); timer.textContent = fmt(left); ring.style.setProperty('--p', Math.round((1 - left / total) * 100) + '%');
      try {
        const st = await api('/auth/login/status', { method: 'POST', body: { request_token: r.request_token } });
        if (st.status === 'approved') { finish(true, 'ДОСТУП РАЗРЕШЁН'); state.admin = st.admin; state.route = parseHash(); setTimeout(() => { startLive(); render(); }, 900); return; }
        if (st.status === 'rejected') return finish(false, 'ДОСТУП ЗАПРЕЩЁН');
        if (st.status === 'expired' || st.status === 'used') return finish(false, 'ВРЕМЯ ВЫШЛО');
      } catch (e) { status.textContent = e.message; }
      if (left <= 0) return finish(false, 'ВРЕМЯ ВЫШЛО');
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 700);
    return screen;
  }
  async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch (e) {} state.admin = null; stopLive(); render(); }
  function startLive() {
    stopLive();
    const tick = async () => {
      try {
        const r = await api('/live'); const prev = state.live; state.live = r; updateBadges();
        const first = !state.lastNotifId;
        for (const n of r.notifications.slice().reverse()) { if (n.id > (state.lastNotifId > 0 ? state.lastNotifId : 0)) { if (!first && !n.acknowledged) { toast(n.title + (n.body ? ' — ' + n.body.split('\n')[0] : ''), n.level === 'critical' ? 'crit' : '', 5000); beep(n.level === 'critical'); } state.lastNotifId = Math.max(state.lastNotifId, n.id); } }
        if (first && !state.lastNotifId) state.lastNotifId = -1;
        if (prev && JSON.stringify(prev.revision) !== JSON.stringify(r.revision)) document.dispatchEvent(new CustomEvent('paygo:changed', { detail: r.revision }));
        document.dispatchEvent(new CustomEvent('paygo:live', { detail: r.queues }));
      } catch (e) { /* silent */ }
    };
    tick(); state.poll = setInterval(() => { if (!document.hidden) tick(); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    setInterval(() => { api('/auth/refresh', { method: 'POST' }).then((r) => { state.admin = r.admin; }).catch(() => {}); }, 10 * 60 * 1000);
  }
  function stopLive() { if (state.poll) clearInterval(state.poll); state.poll = null; }
  let audioCtx;
  function beep(critical) { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = critical ? 880 : 660; g.gain.value = 0.08; o.start(); o.stop(audioCtx.currentTime + (critical ? 0.35 : 0.15)); } catch (e) {} }
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'PAYGO_OPEN' && d.url) { const hash = String(d.url).split('#')[1]; if (hash) go('#' + hash); } if (d.type === 'PAYGO_PUSH' && d.payload) toast(d.payload.title + ' — ' + (d.payload.body || ''), d.payload.channel === 'critical' ? 'crit' : '', 5000); });
  function watchLive(root, fn) { const handler = () => { if (!document.body.contains(root)) return document.removeEventListener('paygo:live', handler); fn(); }; document.addEventListener('paygo:live', handler); }
  function watchChanges(root, fn) { const handler = () => { if (!document.body.contains(root)) return document.removeEventListener('paygo:changed', handler); fn(); }; document.addEventListener('paygo:changed', handler); }

  /* ------------------------------------------------------------- home (Главная) */
  function homeView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const listBox = h('div');
    const refresh = h('button', { class: 'refresh-btn', 'aria-label': 'Обновить', onclick: () => load(true) }, svg('refresh', 19));
    const top = h('div', { class: 'home-top' }); screen.appendChild(top); screen.appendChild(listBox);
    const counts = () => { const q = (state.live && state.live.queues) || {}; return { actual: (q.deposits_pending || 0) + (q.deposits_failed || 0) + Math.max(0, (q.withdrawals_pending || 0) - (q.withdrawals_deferred || 0)), deferred: q.withdrawals_deferred || 0 }; };
    const drawTop = () => { const c = counts(); top.innerHTML = ''; top.appendChild(segEl([['actual', 'Актуальные', c.actual], ['deferred', 'Отложенные', c.deferred]], state.homeTab, (k) => { state.homeTab = k; load(); })); top.appendChild(refresh); };
    async function load(manual) {
      drawTop(); refresh.disabled = true; refresh.classList.add('spin'); if (!listBox.children.length) listBox.appendChild(loader());
      try {
        let items;
        if (state.homeTab === 'deferred') { const w = await api('/withdrawals?status=deferred&size=100'); items = w.items; }
        else { const [d, w] = await Promise.all([api('/deposits?status=created,processing,failed&size=100'), api('/withdrawals?status=active&size=100')]); items = [...d.items, ...w.items]; }
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listBox.innerHTML = '';
        if (!items.length) listBox.appendChild(empty(state.homeTab === 'deferred' ? 'Отложенных нет' : 'Актуальных заявок нет', '', 'home'));
        else listBox.appendChild(txGroups(items, { swipe: (tx) => tx.kind === 'withdraw' && can('operations') && ['created', 'processing'].includes(tx.status) ? { label: tx.deferred ? 'Вернуть' : 'Отложить', color: tx.deferred ? 'blue' : 'amber', icon: 'history', onAction: async () => { const r = await txAction('withdraw', tx, tx.deferred ? 'resume' : 'defer', { done: tx.deferred ? 'Возвращено в работу' : 'Отложено' }); if (r) load(); } } : null }));
        if (manual) toast('Обновлено', 'ok', 1000);
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Не удалось загрузить', e.message)); }
      refresh.disabled = false; refresh.classList.remove('spin');
    }
    load(); watchChanges(screen, () => load()); watchLive(screen, drawTop);
  }

  /* ------------------------------------------------------------- history (История) */
  function historyView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const st = { page: 1, items: [], total: 0 };
    const f = state.historyFilters;
    const filterCount = () => ['status', 'cash', 'from', 'to', 'q'].filter((k) => f[k]).length;
    const top = h('div', { class: 'home-top' });
    const listBox = h('div'); screen.appendChild(top); screen.appendChild(listBox);
    const drawTop = () => { top.innerHTML = ''; top.appendChild(segEl([['all', 'Все'], ['deposit', 'Депозиты'], ['withdraw', 'Выводы']], state.historyTab, (k) => { state.historyTab = k; st.page = 1; load(); }, 'light')); const n = filterCount(); top.appendChild(h('button', { class: 'refresh-btn light', 'aria-label': 'Фильтр', onclick: openFilters }, svg('filter', 18), n ? h('span', { class: 'nav-badge', style: { position: 'absolute', top: '-6px', right: '-6px' } }, n) : null)); };
    function openFilters() {
      const q = h('input', { class: 'input', value: f.q || '', placeholder: 'ID игрока, номер, @username' }); const status = h('select', { class: 'select' }, [['', 'Любой статус'], ['success', 'Успешно'], ['created,processing', 'В работе'], ['failed', 'Проблема'], ['cancelled,expired', 'Отменено / истекло']].map(([v, l]) => h('option', { value: v, selected: (f.status || '') === v }, l))); const cash = h('select', { class: 'select' }, [['', 'Любая касса'], ...state.cashes.map((c) => [c.key, c.name])].map(([v, l]) => h('option', { value: v, selected: (f.cash || '') === v }, l))); const from = h('input', { class: 'input', type: 'date', value: f.from || '' }); const to = h('input', { class: 'input', type: 'date', value: f.to || '' });
      const s = sheet({ title: 'Фильтр истории', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Поиск'), q), h('label', { class: 'field' }, h('span', null, 'Статус'), status), h('label', { class: 'field' }, h('span', null, 'Касса'), cash), h('div', { class: 'stat-grid' }, h('label', { class: 'field' }, h('span', null, 'Дата от'), from), h('label', { class: 'field' }, h('span', null, 'Дата до'), to))), actions: [h('button', { class: 'action-btn', onclick: () => { state.historyFilters = {}; s.close(); st.page = 1; load(); } }, 'Сбросить'), h('button', { class: 'action-btn primary', onclick: () => { state.historyFilters = { q: q.value.trim(), status: status.value, cash: cash.value, from: from.value, to: to.value }; s.close(); st.page = 1; load(); } }, 'Показать')] });
    }
    async function load(more) {
      const f2 = state.historyFilters; drawTop();
      if (!more) { st.page = 1; listBox.innerHTML = ''; listBox.appendChild(loader()); }
      try {
        const qs = '&q=' + encodeURIComponent(f2.q || '') + '&status=' + encodeURIComponent(f2.status || '') + '&cash=' + encodeURIComponent(f2.cash || '') + '&date_from=' + (f2.from || '') + '&date_to=' + (f2.to || '') + '&page=' + st.page + '&size=40';
        const calls = []; if (state.historyTab !== 'withdraw') calls.push(api('/deposits?' + qs.slice(1))); if (state.historyTab !== 'deposit') calls.push(api('/withdrawals?' + qs.slice(1)));
        const results = await Promise.all(calls);
        const fresh = results.flatMap((r) => r.items); st.total = results.reduce((a, r) => a + r.total, 0);
        st.items = more ? st.items.concat(fresh) : fresh;
        st.items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listBox.innerHTML = '';
        if (!st.items.length) return listBox.appendChild(empty('Заявок не найдено', 'Измените фильтры.'));
        listBox.appendChild(txGroups(st.items, { noAlert: true }));
        if (st.items.length < st.total) listBox.appendChild(h('button', { class: 'lazy-more', onclick: () => { st.page += 1; load(true); } }, 'Показать ещё'));
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    if (!state.cashes.length) api('/cashes').then((r) => { state.cashes = r.items; state.types = r.types; }).catch(() => {});
    load();
  }

  /* ------------------------------------------------------------- search (Поиск) */
  function searchView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const input = h('input', { placeholder: 'Имя, ID клиента или заявки', value: state.searchQuery });
    const kind = h('select', { class: 'select' }, [['all', 'Заявки и клиенты'], ['deposit', 'Только пополнения'], ['withdraw', 'Только выводы'], ['users', 'Только клиенты']].map(([v, l]) => h('option', { value: v }, l)));
    const results = h('div');
    const run = debounce(async () => {
      const q = input.value.trim(); state.searchQuery = q; results.innerHTML = '';
      if (q.length < 2) return results.appendChild(empty('Поиск', 'Имя, @username, TG ID, ID игрока или номер заявки', 'search'));
      results.appendChild(loader(2));
      try {
        const k = kind.value; const calls = [];
        calls.push(k === 'all' || k === 'deposit' ? api('/deposits?q=' + encodeURIComponent(q) + '&size=30') : Promise.resolve({ items: [] }));
        calls.push(k === 'all' || k === 'withdraw' ? api('/withdrawals?q=' + encodeURIComponent(q) + '&size=30') : Promise.resolve({ items: [] }));
        calls.push(k === 'all' || k === 'users' ? api('/users?q=' + encodeURIComponent(q) + '&size=20') : Promise.resolve({ items: [] }));
        const [d, w, u] = await Promise.all(calls); results.innerHTML = '';
        if (u.items.length) { results.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Клиенты'))); u.items.forEach((x) => results.appendChild(h('button', { class: 'card row-card', onclick: () => go('#/users/' + x.id) }, h('span', { class: 'avatar mini' }, (x.name || '?').charAt(0).toUpperCase()), h('div', null, h('b', null, x.name, x.username ? ' · @' + x.username : ''), h('small', null, 'TG ' + x.telegram_id + ' · пополнений ' + x.deposits_count + ' · выводов ' + x.withdrawals_count)), x.is_blocked ? h('span', { class: 'pill red' }, 'блок') : svg('chevron', 16)))); }
        const txs = [...d.items, ...w.items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (txs.length) { results.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Заявки · ' + txs.length))); results.appendChild(txGroups(txs, { noAlert: true })); }
        if (!u.items.length && !txs.length) results.appendChild(empty('Ничего не найдено', 'Попробуйте другой запрос.', 'search'));
      } catch (e) { results.innerHTML = ''; results.appendChild(empty('Ошибка', e.message)); }
    }, 300);
    input.addEventListener('input', run); kind.addEventListener('change', run);
    screen.appendChild(h('div', { class: 'card', style: { padding: '11px', marginBottom: '10px' } }, h('div', { class: 'searchbar' }, svg('search', 20), input), h('div', { style: { marginTop: '9px' } }, kind)));
    screen.appendChild(results); run(); setTimeout(() => input.focus(), 50);
  }

  /* ------------------------------------------------------------- users (Люди) */
  function usersView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const filter = h('select', { class: 'select' }, [['all', 'Все пользователи'], ['active', 'Активные'], ['blocked', 'Заблокированные']].map(([v, l]) => h('option', { value: v }, l)));
    const search = h('input', { placeholder: 'Поиск по имени или TG ID' });
    const sortBy = h('select', { class: 'select' }, [['recent', 'По дате (новые)'], ['name', 'По имени'], ['balance', 'По балансу']].map(([v, l]) => h('option', { value: v }, l)));
    const listBox = h('div');
    screen.appendChild(h('div', { class: 'card', style: { padding: '11px', marginBottom: '10px' } }, h('div', { class: 'searchbar' }, svg('search', 20), search), h('div', { style: { marginTop: '9px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, filter, sortBy)));
    screen.appendChild(listBox);
    async function load() {
      listBox.innerHTML = ''; listBox.appendChild(loader());
      try {
        const q = search.value.trim(); const f = filter.value; const sort = sortBy.value;
        let url = '/users?size=100';
        if (q) url += '&q=' + encodeURIComponent(q);
        if (f === 'active') url += '&blocked=false';
        if (f === 'blocked') url += '&blocked=true';
        url += '&sort=' + sort;
        const r = await api(url);
        listBox.innerHTML = '';
        if (!r.items || !r.items.length) return listBox.appendChild(empty('Нет пользователей', f === 'blocked' ? 'Заблокированных пользователей не найдено' : 'Пользователи не найдены', 'user'));
        const total = r.total || 0;
        const blocked = r.items.filter(u => u.is_blocked).length;
        listBox.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Пользователи · ' + total), h('small', null, blocked ? blocked + ' заблок. · ' : '', r.items.length + ' показано')));
        r.items.forEach((u) => listBox.appendChild(h('button', { class: 'card row-card', onclick: () => go('#/users/' + u.id) }, h('span', { class: 'avatar mini' }, (u.name || '?').charAt(0).toUpperCase()), h('div', null, h('b', null, u.name, u.username ? ' · @' + u.username : ''), h('small', null, 'TG ' + u.telegram_id + ' · ПП ' + (u.deposits_count || 0) + ' · ВВ ' + (u.withdrawals_count || 0))), u.is_blocked ? h('span', { class: 'pill red' }, u.block_reason ? u.block_reason.slice(0, 20) + (u.block_reason.length > 20 ? '…' : '') : 'блок') : h('span', { class: 'pill' }, u.balance_usd || '0.00' + ' $'))));
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    search.addEventListener('input', debounce(load, 300)); filter.addEventListener('change', load); sortBy.addEventListener('change', load);
    load();
  }

  /* ------------------------------------------------------------- chats (Чат) */
  function chatsView(shell) {
    if (state.route.id) return chatThreadView(shell, Number(state.route.id));
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const search = h('input', { placeholder: 'Имя, ID клиента или заявки', value: state.chatQuery, oninput: debounce((e) => { state.chatQuery = e.target.value.trim(); load(); }, 250) });
    const kindBox = h('div'); const tabBox = h('div'); const listBox = h('div', { class: 'chat-list' });
    screen.appendChild(h('div', { class: 'chat-top' }, h('div', { class: 'searchbar' }, svg('search', 20), search), kindBox, tabBox)); screen.appendChild(listBox);
    async function load() {
      listBox.innerHTML = ''; listBox.appendChild(loader());
      try {
        const status = state.chatTab === 'closed' ? 'closed' : 'open';
        const category = state.chatKind === 'deposit' ? 'deposit' : state.chatKind === 'withdraw' ? 'withdrawal' : '';
        const r = await api('/support/conversations?status=' + status + '&category=' + category + '&q=' + encodeURIComponent(state.chatQuery) + '&size=60');
        const c = r.counts || {};
        kindBox.innerHTML = ''; kindBox.appendChild(h('div', { class: 'kind-tabs' }, [['all', 'Все', null], ['deposit', 'ПП', c.deposit || 0], ['withdraw', 'ВВ', c.withdrawal || 0]].map(([k, l, n]) => h('button', { class: state.chatKind === k ? 'active' : '', onclick: () => { state.chatKind = k; load(); } }, l, n !== null ? h('small', null, ' ' + n) : null))));
        tabBox.innerHTML = ''; tabBox.appendChild(h('div', { class: 'chat-tabs' }, h('button', { class: state.chatTab !== 'closed' ? 'active' : '', onclick: () => { state.chatTab = 'open'; load(); } }, 'Новые', h('small', null, c.open || 0)), h('button', { class: state.chatTab === 'closed' ? 'active' : '', onclick: () => { state.chatTab = 'closed'; load(); } }, 'Обработанные', h('small', null, c.closed || 0))));
        listBox.innerHTML = '';
        if (!r.items.length) return listBox.appendChild(empty(state.chatTab === 'closed' ? 'Обработанных обращений нет' : 'Новых обращений нет', '', 'chat'));
        r.items.forEach((cv, i) => { const kindCls = cv.category === 'deposit' ? 'deposit' : cv.category === 'withdrawal' ? 'withdraw' : 'neutral'; listBox.appendChild(h('button', { class: 'chat-row ' + kindCls + (cv.status === 'waiting_operator' ? ' waiting' : ''), style: { '--i': i }, onclick: () => go('#/chats/' + cv.id) }, h('span', { class: 'avatar' }, (cv.user_name || '?').charAt(0).toUpperCase()), h('span', { class: 'chat-copy' }, h('span', { class: 'chat-name-line' }, h('b', null, cv.user_name || 'Клиент'), cv.category === 'deposit' ? h('i', { class: 'kind-badge deposit' }, 'ПП') : null, cv.category === 'withdrawal' ? h('i', { class: 'kind-badge withdraw' }, 'ВВ') : null, cv.category === 'operator' ? h('i', { class: 'kind-badge operator' }, 'ОП') : null, cv.rating ? h('i', { class: 'kind-badge' }, '★ ' + cv.rating) : null), cv.subject ? h('span', { class: 'chat-mini' }, cv.subject) : null, h('span', { class: 'chat-last' }, cv.status === 'waiting_operator' ? 'Ждёт оператора' : cv.status === 'operator' ? 'В работе у оператора' : cv.status === 'resolved' ? 'Закрыто' : 'Автоответы')), h('span', { class: 'chat-side' }, h('time', null, fmtTime(cv.last_message_at) || ago(cv.updated_at)), cv.unread_count ? h('span', { class: 'unread' }, cv.unread_count) : null))); });
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    load(); watchChanges(screen, load);
  }
  async function openChat(userId) {
    /* «Написать клиенту» → the operator dialog of this client in Чат (created when needed) */
    try { const r = await api('/users/' + userId + '/conversation', { method: 'POST' }); closeSheets(); go('#/chats/' + r.item.id); } catch (e) { err(e); }
  }
  const MEDIA_EXT = { audio: ['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'wav'], video: ['mp4', 'mov', 'webm'], image: ['jpg', 'jpeg', 'png', 'webp', 'gif'] };
  function mediaNode(m) {
    if (!m.file_url) return null;
    const url = fileUrl(m.file_url); const ext = (m.file_url.split('.').pop() || '').toLowerCase();
    const kindOf = MEDIA_EXT.image.includes(ext) ? 'image' : MEDIA_EXT.audio.includes(ext) ? 'audio' : MEDIA_EXT.video.includes(ext) ? 'video' : 'file';
    if (kindOf === 'image') return h('img', { src: url, alt: '', loading: 'lazy', onclick: () => imageSheet(m.sender === 'user' ? 'Фото клиента' : 'Фото', url) });
    if (kindOf === 'audio') return h('div', { class: 'media-audio' }, svg(m.kind === 'voice' ? 'chat' : 'note', 15), h('audio', { controls: true, preload: 'metadata', src: url }));
    if (kindOf === 'video') return h('video', { class: 'media-video', controls: true, playsinline: true, preload: 'metadata', src: url });
    return h('a', { class: 'media-file', href: url, target: '_blank', rel: 'noopener' }, svg('note', 15), h('span', null, m.file_name || (m.kind === 'sticker' ? 'Стикер' : 'Файл')));
  }
  async function chatThreadView(shell, id) {
    const screen = h('section', { class: 'chat-screen' }); shell.appendChild(screen); screen.appendChild(loader(2));
    let lastId = 0; let c = null; const known = {}; let composer = null;
    const fitViewport = () => { const vv = window.visualViewport; const stick = feed && nearBottom(); if (vv) { screen.style.height = Math.round(vv.height) + 'px'; screen.style.transform = 'translateY(' + Math.round(vv.offsetTop) + 'px)'; } else screen.style.height = window.innerHeight + 'px'; if (window.scrollY) window.scrollTo(0, 0); if (feed && stick) feed.scrollTop = feed.scrollHeight; };
    const feed = h('div', { class: 'chat-feed' });
    const bottom = (smooth) => { feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
    const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
    const senderLabel = (m) => (m.sender === 'user' ? 'клиент' : m.sender === 'bot' ? 'бот' : m.sender === 'operator' ? 'оператор' : 'система');
    const bubble = (m) => {
      known[m.id] = m;
      const mine = m.direction === 'out' && m.sender === 'operator';
      const b = h('div', { class: 'bubble ' + (m.direction === 'out' ? 'out ' : '') + m.sender + (m.deleted_at ? ' deleted' : ''), 'data-id': m.id },
        m.reply_to ? h('div', { class: 'quote', onclick: () => { const t = feed.querySelector('.bubble[data-id="' + m.reply_to.id + '"]'); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 900); } } }, h('b', null, m.reply_to.sender === 'user' ? (c ? c.user_name : 'Клиент') : 'Вы'), h('span', null, m.reply_to.text || '…')) : null,
        m.deleted_at ? h('i', null, 'Сообщение удалено') : mediaNode(m), m.deleted_at ? null : (m.text && !(m.file_url && /^\[.*\]$/.test(m.text)) ? h('span', { class: 'txt' }, m.text) : null),
        h('small', null, senderLabel(m) + ' · ' + fmtTime(m.created_at) + (m.edited_at ? ' · изм.' : '')));
      if (!m.deleted_at) holdMenu(b, () => messageMenu(m, mine, b));
      return b;
    };
    const messageMenu = (m, mine, node) => {
      actionSheet('Сообщение', [
        { label: 'Ответить', icon: 'send', onclick: () => composer.reply(m) },
        mine && ['text', 'photo'].includes(m.kind) ? { label: 'Изменить', icon: 'edit', onclick: () => composer.edit(m) } : null,
        mine ? { label: 'Удалить', icon: 'trash', cls: 'danger', onclick: async () => { if (!(await confirmDialog('Удалить сообщение у клиента?', 'Удалить', true))) return; try { const rr = await api('/support/messages/' + m.id, { method: 'DELETE' }); Object.assign(m, rr.message); node.replaceWith(bubble(m)); } catch (e) { err(e); } } } : null,
      ]);
    };
    const draw = async () => {
      try {
        const r = await api('/support/conversations/' + id); c = r.item; const ctx = c.context || {}; screen.innerHTML = '';
        const head = h('header', { class: 'chat-head' }, h('button', { class: 'header-btn', onclick: () => go('#/chats') }, svg('back', 18)), h('button', { class: 'chat-person', onclick: () => go('#/users/' + c.user_id) }, h('span', { class: 'avatar mini' }, (c.user_name || '?').charAt(0).toUpperCase()), h('span', null, h('b', null, c.user_name), h('small', null, 'TG ' + c.telegram_id + (c.username ? ' · @' + c.username : '') + ' · ' + (STATUS[c.status] || [c.status])[0] + (ctx.channel === 'main' ? ' · через основной бот' : '')))), h('button', { class: 'header-btn', 'aria-label': 'Копировать ID', onclick: () => copy(c.telegram_id) }, svg('copy', 16)), can('support') ? h('button', { class: 'chat-close-btn ' + (c.status === 'resolved' ? 'open' : ''), onclick: async () => { if (c.status === 'resolved') { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'operator' } }); draw(); return; } const note = await promptDialog('Завершить обращение', 'Сообщение клиенту (необязательно)'); if (note === null) return; await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'resolved', note } }); go('#/chats'); } }, c.status === 'resolved' ? 'Вернуть' : 'Завершить') : h('span'), h('button', { class: 'header-btn', 'aria-label': 'Меню', onclick: () => chatMenu(c, draw) }, svg('more', 18)));
        screen.appendChild(head);
        if (ctx.deposit || ctx.withdrawal) { const t = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; const dep = t === ctx.deposit; screen.appendChild(h('button', { class: 'case-card', onclick: () => openTxSheet(dep ? 'deposit' : 'withdraw', t.id) }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('i', { class: 'kind-badge ' + (dep ? 'deposit' : 'withdraw') }, dep ? 'ПП' : 'ВВ'), h('b', null, (dep ? 'Пополнение ' : 'Вывод ') + t.public_id), h('span', { style: { flex: 1 } }), statusEl(t.status, t.status_label)), h('small', null, t.cash + ' • ID ' + t.player_id + ' • ' + money(t.amount) + ' ' + t.currency + ' • ' + fmtDate(t.created_at)), t.error ? h('small', { style: { color: '#bd344a' } }, reasonText(t.error)) : null)); }
        feed.innerHTML = ''; lastId = 0;
        r.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); });
        if (!r.messages.length) feed.appendChild(empty('Сообщений нет', 'Напишите первым — клиент получит сообщение в боте', 'chat'));
        screen.appendChild(feed);
        composer = makeComposer();
        if (can('support')) screen.appendChild(composer.el);
        fitViewport(); bottom(false); setTimeout(() => bottom(false), 250); setTimeout(() => bottom(false), 700);
        feed.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => { if (nearBottom()) bottom(false); }));
        const poll = setInterval(async () => { if (!document.body.contains(feed)) return clearInterval(poll); if (document.hidden) return; try { const rr = await api('/support/conversations/' + c.id + '?after_id=' + lastId); if (rr.messages.length) { const stick = nearBottom(); rr.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); }); if (stick) bottom(true); } } catch (e) {} }, 3000);
      } catch (e) { screen.innerHTML = ''; screen.appendChild(header('Чат')); screen.appendChild(empty('Ошибка', e.message)); }
    };
    function makeComposer() {
      const ta = h('textarea', { placeholder: 'Сообщение клиенту…', rows: 1 });
      const bar = h('div', { class: 'compose-bar', hidden: true });
      let mode = null; /* {type:'reply'|'edit', m} */
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
      const clearMode = () => { mode = null; bar.hidden = true; bar.innerHTML = ''; ta.value = ''; grow(); };
      const setMode = (m, type) => { mode = { m, type }; bar.hidden = false; bar.innerHTML = ''; bar.appendChild(h('div', { class: 'compose-quote' }, h('b', null, type === 'edit' ? 'Изменение' : 'Ответ ' + (m.sender === 'user' ? (c ? c.user_name : 'клиенту') : 'на своё сообщение')), h('span', null, (m.text || (m.file_name || '[файл]')).slice(0, 120)))); bar.appendChild(h('button', { class: 'compose-x', 'aria-label': 'Отмена', onclick: clearMode }, svg('close', 14))); if (type === 'edit') { ta.value = m.text || ''; grow(); } ta.focus(); };
      const keepFocus = (e) => { e.preventDefault(); }; /* buttons must not steal focus — the keyboard stays open */
      const sendBtn = h('button', { class: 'send-btn', 'aria-label': 'Отправить', type: 'button', onpointerdown: keepFocus, onmousedown: keepFocus }, svg('send', 18));
      let sending = false;
      const send = async () => {
        const text = ta.value.trim(); if (!text || sending) return; sending = true;
        const current = mode; ta.value = ''; grow(); if (current) { bar.hidden = true; bar.innerHTML = ''; mode = null; }
        if (document.activeElement !== ta) ta.focus();
        try {
          if (current && current.type === 'edit') { const rr = await api('/support/messages/' + current.m.id, { method: 'PATCH', body: { text } }); Object.assign(current.m, rr.message); const node = feed.querySelector('.bubble[data-id="' + current.m.id + '"]'); if (node) node.replaceWith(bubble(current.m)); }
          else { const rr = await api('/support/conversations/' + c.id + '/reply', { method: 'POST', body: { text, reply_to: current && current.type === 'reply' ? current.m.id : null } }); feed.appendChild(bubble(rr.message)); lastId = Math.max(lastId, rr.message.id); bottom(true); }
          buzz();
        } catch (e) { err(e); ta.value = text; grow(); if (current) setMode(current.m, current.type); }
        sending = false;
      };
      sendBtn.onclick = send;
      ta.addEventListener('input', grow);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); send(); } });
      ta.addEventListener('focus', () => { setTimeout(() => { fitViewport(); bottom(false); }, 60); setTimeout(() => { fitViewport(); bottom(false); }, 350); });
      /* photo / video from the operator: camera or gallery */
      const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
      const fileInput = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
      const sendFile = async (file) => {
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) return toast('Файл больше 25 МБ', 'err');
        const caption = ta.value.trim(); const current = mode;
        const note = toast(file.type.startsWith('video/') ? 'Отправляю видео…' : 'Отправляю фото…', '', 60000);
        try {
          const fd = new FormData(); fd.append('file', file);
          const up = await api('/support/upload', { method: 'POST', body: fd });
          const body = { text: caption, reply_to: current && current.type === 'reply' ? current.m.id : null };
          if (up.kind === 'video') body.video_url = up.url; else body.photo_url = up.url;
          const rr = await api('/support/conversations/' + c.id + '/reply', { method: 'POST', body });
          feed.appendChild(bubble(rr.message)); lastId = Math.max(lastId, rr.message.id); bottom(true); clearMode(); buzz();
        } catch (e) { err(e); }
        note.remove();
      };
      camInput.onchange = () => { sendFile(camInput.files[0]); camInput.value = ''; };
      fileInput.onchange = () => { sendFile(fileInput.files[0]); fileInput.value = ''; };
      const attach = () => actionSheet('Отправить клиенту', [{ label: 'Сделать фото', icon: 'image', onclick: () => camInput.click() }, { label: 'Фото или видео из галереи', icon: 'note', onclick: () => fileInput.click() }]);
      const vars = () => { const cx = (c && c.context) || {}; const t = cx.deposit || cx.withdrawal || {}; return { name: (c && c.user_name) || '', id: t.player_id || '' }; };
      const el = h('div', { class: 'chat-composer' }, bar, h('div', { class: 'compose-row' }, h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Быстрые ответы', onclick: () => quickPick((t) => { ta.value = t; grow(); ta.focus(); }, vars()) }, svg('bolt', 19)), h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Фото или видео', onclick: attach }, svg('image', 19)), ta, sendBtn, camInput, fileInput));
      return { el, reply: (m) => setMode(m, 'reply'), edit: (m) => setMode(m, 'edit') };
    }
    if (window.visualViewport) { const onVV = () => { if (!document.body.contains(screen)) { window.visualViewport.removeEventListener('resize', onVV); window.visualViewport.removeEventListener('scroll', onVV); return; } fitViewport(); }; window.visualViewport.addEventListener('resize', onVV); window.visualViewport.addEventListener('scroll', onVV); }
    window.addEventListener('resize', () => { if (document.body.contains(screen)) fitViewport(); });
    window.addEventListener('scroll', () => { if (document.body.contains(screen) && window.scrollY) window.scrollTo(0, 0); }, { passive: true });
    draw();
  }
  function chatMenu(c, redraw) {
    /* three dots in a chat: the client's requests (like the old «Транзакции» window) + dialog actions */
    const list = h('div', { class: 'tx-mini-list' }, loader(3));
    const count = h('small', { class: 'muted' });
    const setStatus = async (status) => { try { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status } }); s.close(); redraw(); } catch (e) { err(e); } };
    const actions = h('div', { class: 'chat-menu-actions' },
      can('support') ? h('button', { class: 'outline-btn blue', type: 'button', disabled: c.status === 'operator', onclick: () => setStatus('operator') }, svg('user', 14), c.status === 'operator' ? 'В работе' : 'Взять в работу') : null,
      can('support') ? h('button', { class: 'outline-btn', type: 'button', disabled: c.status === 'auto', onclick: () => setStatus('auto') }, svg('bolt', 14), 'Вернуть боту') : null,
      h('button', { class: 'outline-btn', type: 'button', onclick: () => { s.close(); go('#/users/' + c.user_id); } }, svg('user', 14), 'Профиль'));
    const s = sheet({ title: h('span', { class: 'tx-title' }, h('span', { class: 'copy-text', onclick: () => copy(c.telegram_id) }, c.user_name || 'Клиент', svg('copy', 13)), statusEl(c.status)), full: true, body: h('div', null, actions, h('div', { class: 'section-title tight' }, h('h2', null, 'Заявки клиента'), count), list) });
    api('/users/' + c.user_id).then((r) => {
      const txs = [...r.deposits, ...r.withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      list.innerHTML = ''; count.textContent = txs.length ? String(txs.length) : '';
      if (!txs.length) return list.appendChild(empty('Заявок нет', 'Клиент ещё ничего не оформлял', 'history'));
      txs.forEach((tx, i) => { const row = txMini(tx, s); row.style.setProperty('--i', Math.min(i, 12)); list.appendChild(row); });
    }).catch((e) => { list.innerHTML = ''; list.appendChild(empty('Ошибка', e.message)); });
  }
  function txMini(tx, s) {
    /* compact request row: tap → full page, eye → request sheet, «Чек» → the receipt image */
    const dep = tx.kind === 'deposit'; const path = dep ? 'deposits' : 'withdrawals';
    const receipt = tx.has_receipt ? h('button', { class: 'mini-btn', type: 'button', onclick: (e) => { e.stopPropagation(); imageSheet(dep ? 'Чек клиента' : 'Чек перевода', API + '/' + path + '/' + tx.id + '/receipt', '# ' + txNo(tx) + ' · ' + money(dep ? tx.pay_amount : tx.amount) + ' ' + tx.currency); } }, svg('image', 13), 'Чек') : null;
    const peek = h('button', { class: 'mini-btn', type: 'button', 'aria-label': 'Открыть заявку', onclick: (e) => { e.stopPropagation(); openTxSheet(tx.kind, tx.id); } }, svg('peek', 15));
    return h('button', { class: 'tx-mini ' + (dep ? 'deposit' : 'withdraw'), type: 'button', onclick: () => { if (s) s.close(); go('#/' + path + '/' + tx.id); } },
      h('i', { class: 'kind-badge ' + (dep ? 'deposit' : 'withdraw') }, dep ? 'ПП' : 'ВВ'),
      h('span', { class: 'tx-mini-copy' }, h('b', { class: dep ? 'deposit' : 'withdraw' }, (dep ? '+' : '−') + money(dep ? tx.pay_amount : tx.amount) + ' ' + tx.currency), h('small', null, (tx.cash_name || '').toUpperCase() + ' • ID ' + tx.player_id), h('small', null, '# ' + txNo(tx) + ' • ' + fmtDate(tx.created_at))),
      h('span', { class: 'tx-mini-side' }, txStatus(tx), h('span', { class: 'tx-mini-btns' }, receipt, peek)));
  }
  async function quickPick(onPick, vars) {
    try { const r = await api('/quick-replies'); state.quick = r.items; } catch (e) {}
    const fill = (t) => String(t || '').replace(/\{name\}/g, (vars && vars.name) || '').replace(/\{id\}/g, (vars && vars.id) || '');
    const s = sheet({ title: 'Быстрые ответы', body: state.quick.length ? h('div', { class: 'list' }, state.quick.map((q) => h('button', { class: 'card row-card', onclick: () => { s.close(); onPick(fill(q.text)); } }, h('div', null, h('b', null, q.title), h('small', null, fill(q.text)))))) : empty('Ответов нет', 'Меню → Быстрые ответы', 'bolt') });
  }

  /* ------------------------------------------------------------- tx sheet / actions (old admin layout) */
  const SOURCE = { bot: 'Телеграм', telegram: 'Телеграм', admin: 'Панель', panel: 'Панель', api: 'API', manual: 'Вручную', macrodroid: 'MacroDroid', webhook: 'MacroDroid', imap: 'Почта', email: 'Почта', support: 'Поддержка' };
  const srcLabel = (v) => (v ? (SOURCE[String(v).toLowerCase()] || v) : 'Телеграм');
  const REASON = { user_cancelled: 'Отменено клиентом', expired: 'Истекло время оплаты', timeout: 'Истекло время оплаты' };
  const reasonText = (v) => (v ? (REASON[String(v).trim()] || v) : '');
  const txNo = (tx) => String(tx.public_id || tx.id).replace(/^[DW]-/, '');
  function busy(b, on) { if (!b) return; b.disabled = !!on; b.classList.toggle('busy', !!on); }
  async function txAction(kind, tx, action, opts) {
    opts = opts || {};
    const path = kind === 'deposit' ? 'deposits' : 'withdrawals';
    let reason = opts.reason || '';
    if (opts.askReason) { reason = await promptDialog(opts.askReason, 'Клиент увидит причину', opts.placeholder || ''); if (reason === null) return null; }
    if (opts.confirm && !(await confirmDialog(opts.confirm, opts.okLabel || 'Да', opts.danger))) return null;
    try { const r = await api('/' + path + '/' + tx.id + '/action', { method: 'POST', body: { action, reason } }); toast(opts.done || 'Готово', 'ok'); return r.item || tx; } catch (e) { err(e); return null; }
  }
  function txTitle(kind, tx) { return h('span', { class: 'tx-title' }, h('span', { class: 'copy-text', onclick: () => copy(tx.public_id || txNo(tx)) }, (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' # ' + txNo(tx), svg('copy', 13)), txStatus(tx)); }
  function txHero(kind, tx, withStatus) {
    const dep = kind === 'deposit';
    return h('div', { class: 'tx-hero' }, h('div', { class: 'tx-hero-amount ' + (dep ? 'deposit' : 'withdraw') }, (dep ? '+ ' : '− ') + money(dep ? tx.pay_amount : tx.amount) + ' ' + tx.currency), h('div', { class: 'tx-hero-sub' }, withStatus ? txStatus(tx) : null, dep && tx.amount !== tx.pay_amount ? h('small', null, 'запрос ' + money(tx.amount)) : null, tx.deferred ? h('span', { class: 'pill amber' }, 'отложен') : null));
  }
  function userCard(u, onOpen, fullName) {
    const name = (fullName && fullName.trim()) || u.name || 'Клиент';
    return h('button', { class: 'user-card', onclick: () => { if (onOpen) onOpen(); go('#/users/' + u.id); } },
      h('span', { class: 'avatar' }, name.charAt(0).toUpperCase()),
      h('span', { class: 'user-copy' }, h('b', null, name, u.is_blocked ? h('i', { class: 'pill red' }, 'блок') : null), h('small', null, (fullName && fullName.trim() && u.name && u.name !== fullName ? u.name + ' · ' : '') + 'TG ' + u.telegram_id + (u.username ? ' · @' + u.username : ''))),
      h('span', { class: 'user-tiles' }, h('span', null, h('b', null, u.deposits_count), h('small', null, 'Пополнений')), h('span', null, h('b', null, u.withdrawals_count), h('small', null, 'Выводов'))));
  }
  const copyBtn = (text) => h('button', { class: 'copy-btn', type: 'button', 'aria-label': 'Копировать', onclick: (e) => { e.stopPropagation(); copy(text); } }, svg('copy', 14));
  function infoTable(rows) { return h('div', { class: 'info-table' }, rows.filter(Boolean).map(([k, v, extra]) => h('div', { class: 'info-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v === undefined || v === null || v === '' ? '—' : v), extra || null))); }
  function txRows(kind, tx) {
    const dep = kind === 'deposit';
    return [
      ['БК', (tx.cash_name || '').toUpperCase()],
      ['ID счёта', h('span', { class: 'mono strong' }, tx.player_id, tx.player_name ? h('small', null, ' ' + tx.player_name) : null), copyBtn(tx.player_id)],
      !dep ? ['Код вывода', h('span', { class: 'mono strong' }, tx.code || '—'), tx.code ? copyBtn(tx.code) : null] : null,
      ['Источник', srcLabel(tx.source)],
      dep ? ['Платёж', tx.paid_at ? fmtDate(tx.paid_at) + (tx.payment_source ? ' · ' + srcLabel(tx.payment_source) : '') : 'не поступил'] : null,
      ['Создана', fmtDate(tx.created_at)],
      !dep ? ['Выполнена', tx.completed_at ? fmtDate(tx.completed_at) : '—'] : null,
      ['Обработал', tx.operator_id ? (tx.operator_name || '—') : '—'],
      dep ? ['Чек', tx.has_receipt ? h('span', { class: 'pill green' }, 'получен') : 'нет'] : ['QR клиента', tx.has_qr ? h('span', { class: 'pill ' + (tx.qr_decoded ? 'green' : 'amber') }, tx.qr_decoded ? 'распознан' : 'не распознан') : 'нет'],
      !dep ? ['Чек перевода', tx.has_receipt ? h('span', { class: 'pill green' }, 'прикреплён') : (tx.receipt_required ? h('span', { class: 'pill amber' }, 'нужен') : '—')] : null,
      tx.error ? ['Комментарий', h('span', { class: 'err-text' }, reasonText(tx.error))] : null,
    ];
  }
  function txButtons(kind, tx, ctx) {
    const dep = kind === 'deposit';
    const open = !['success', 'cancelled'].includes(tx.status);
    const ops = can('operations');
    const out = [];
    if (ops && open) {
      if (dep) out.push(tx.status === 'processing' ? h('button', { class: 'big-btn green', disabled: true }, 'Зачисляется…') : h('button', { class: 'big-btn green', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const r = await txAction(kind, tx, 'credit', { confirm: 'Зачислить ' + money(tx.pay_amount) + ' ' + tx.currency + ' на ID ' + tx.player_id + '?', okLabel: 'Зачислить', done: 'Зачислено' }); busy(b, false); if (r) ctx.refresh(); } }, 'Зачислить на счёт игрока'));
      else if (tx.receipt_required && !tx.has_receipt) out.push(h('button', { class: 'big-btn amber', onclick: async () => { const ok = await pickReceipt(tx, null); if (!ok) return; const r = await txAction(kind, tx, 'complete', { confirm: 'Чек прикреплён. Перевели ' + money(tx.amount) + ' ' + tx.currency + ' клиенту?', okLabel: 'Да, перевёл', done: 'Вывод выполнен' }); ctx.refresh(); } }, svg('image', 18), 'Чек → Перевёл деньги'));
      else out.push(h('button', { class: 'big-btn green', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const r = await txAction(kind, tx, 'complete', { confirm: 'Перевели ' + money(tx.amount) + ' ' + tx.currency + ' клиенту?', okLabel: 'Да, перевёл', done: 'Вывод выполнен' }); busy(b, false); if (r) ctx.refresh(); } }, svg('check', 18), 'Перевёл деньги'));
    }
    const grid = h('div', { class: 'btn-grid compact' });
    grid.appendChild(h('button', { class: 'action-btn', onclick: () => { ctx.close(); go('#/users/' + tx.user_id); } }, svg('user', 14), 'Профиль'));
    if (ctx.inSheet) grid.appendChild(h('button', { class: 'action-btn', onclick: () => { ctx.close(); go('#/' + (dep ? 'deposits' : 'withdrawals') + '/' + tx.id); } }, svg('note', 14), 'Заявка'));
    if (ops) grid.appendChild(h('button', { class: 'action-btn', onclick: () => txEditSheet(kind, tx, ctx.refresh) }, svg('edit', 14), 'Изменить'));
    if (ops && open && !dep) grid.appendChild(h('button', { class: 'action-btn amber', onclick: async () => { const r = await txAction(kind, tx, tx.deferred ? 'resume' : 'defer', { done: tx.deferred ? 'Возвращено в работу' : 'Отложено' }); if (r) ctx.refresh(); } }, svg('history', 14), tx.deferred ? 'Вернуть' : 'Отложить'));
    if (ops && open && (!dep || tx.status === 'created')) grid.appendChild(h('button', { class: 'action-btn', onclick: async () => { const r = dep ? await txAction(kind, tx, 'cancel', { confirm: 'Отменить заявку?', okLabel: 'Отменить', danger: true, done: 'Отменено' }) : await txAction(kind, tx, 'reject', { askReason: 'Причина отмены', done: 'Отменено' }); if (r) ctx.refresh(); } }, svg('close', 14), 'Отменить'));
    if (dep && tx.has_receipt) grid.appendChild(h('button', { class: 'action-btn', onclick: () => imageSheet('Чек клиента', API + '/deposits/' + tx.id + '/receipt', fmtDate(tx.receipt_at)) }, svg('image', 14), 'Чек'));
    if (!dep && tx.has_receipt) grid.appendChild(h('button', { class: 'action-btn', onclick: () => imageSheet('Чек перевода', API + '/withdrawals/' + tx.id + '/receipt', fmtDate(tx.receipt_at)) }, svg('image', 14), 'Чек'));
    else if (!dep && open && ops) grid.appendChild(h('button', { class: 'action-btn', onclick: () => pickReceipt(tx, ctx.refresh) }, svg('image', 14), 'Чек перевода'));
    if (can('support')) grid.appendChild(h('button', { class: 'action-btn', onclick: () => openChat(tx.user_id) }, svg('send', 14), 'Написать'));
    if (can('users') && ctx.user) grid.appendChild(h('button', { class: 'action-btn ' + (ctx.user.is_blocked ? 'blue' : 'danger'), onclick: async () => { const u = ctx.user; if (u.is_blocked) { if (!(await confirmDialog('Разблокировать клиента?', 'Разблокировать'))) return; try { await api('/users/' + u.id, { method: 'PATCH', body: { is_blocked: false, block_reason: '' } }); toast('Разблокирован', 'ok'); ctx.refresh(); } catch (e) { err(e); } return; } const reason = await promptDialog('Заблокировать клиента', 'Клиент увидит причину'); if (reason === null) return; try { await api('/users/' + u.id, { method: 'PATCH', body: { is_blocked: true, block_reason: reason } }); toast('Заблокирован', 'ok'); ctx.refresh(); } catch (e) { err(e); } } }, ctx.user.is_blocked ? 'Разблокировать' : 'Заблокировать'));
    out.push(grid);
    if (ops && open) out.push(h('button', { class: 'link-danger', onclick: async () => { const r = await txAction(kind, tx, dep ? 'reject' : 'fail', { askReason: 'Причина отказа', done: 'Отказано' }); if (r) ctx.refresh(); } }, 'Отказать'));
    return out;
  }
  function txBody(kind, r, ctx) {
    const tx = r.item; const dep = kind === 'deposit';
    ctx.user = r.user;
    const problem = (tx.status === 'failed' || tx.needs_attention) && tx.error && tx.status !== 'success' ? h('div', { class: 'hint-card err' }, reasonText(tx.error)) : null;
    const payNote = tx.payment ? h('div', { class: 'pay-note ' + tx.payment.kind }, svg(tx.payment.kind === 'matched' ? 'check' : 'bolt', 14), (tx.payment.kind === 'matched' ? 'Платёж получен: ' : 'Есть платёж на эту сумму: ') + srcLabel(tx.payment.source) + ' · ' + money(tx.payment.amount) + ' · ' + fmtDate(tx.payment.received_at)) : null;
    const buttons = txButtons(kind, tx, ctx);
    const body = h('div', { class: 'tx-view' }, txHero(kind, tx, !ctx.inSheet), problem, payNote);
    if (!dep) {
      /* withdrawal: the client's QR comes first — scan, pay, press «Перевёл деньги» */
      if (tx.has_generated_qr || tx.qr_file_url || tx.qr_payload) body.appendChild(qrBlock(tx, r, ctx));
      if (buttons.length && buttons[0].classList.contains('big-btn')) body.appendChild(buttons.shift());
      body.appendChild(userCard(r.user, ctx.close, tx.player_name));
      body.appendChild(infoTable(txRows(kind, tx)));
    } else {
      body.appendChild(userCard(r.user, ctx.close, tx.player_name));
      body.appendChild(infoTable(txRows(kind, tx)));
    }
    body.appendChild(historyBlock(r.history));
    buttons.forEach((n) => body.appendChild(n));
    return body;
  }
  function qrBlock(tx, r, ctx) {
    /* withdrawal QR: «С суммой» (rebuilt with the payout amount) and «Оригинал» (client's photo) */
    const gen = tx.has_generated_qr ? API + '/withdrawals/' + tx.id + '/qr.png?kind=generated' : '';
    const orig = tx.qr_file_url ? API + '/withdrawals/' + tx.id + '/photo' : (tx.qr_payload ? API + '/withdrawals/' + tx.id + '/qr.png?kind=original' : '');
    const tabs = [gen ? ['gen', 'С суммой'] : null, orig ? ['orig', 'Оригинал'] : null].filter(Boolean);
    let cur = tabs.length ? tabs[0][0] : '';
    const img = h('img', { alt: 'QR' }); const cap = h('small'); const tabBar = h('div', { class: 'qr-tabs' });
    const links = r.payment_links && r.payment_links.length ? h('div', { class: 'bank-row' }, r.payment_links.map((l) => h('a', { class: 'outline-btn', href: l.url, target: '_blank', rel: 'noopener' }, l.name))) : null;
    const draw = () => {
      tabBar.innerHTML = ''; tabs.forEach(([k, l]) => tabBar.appendChild(h('button', { class: k === cur ? 'active' : '', type: 'button', onclick: () => { cur = k; draw(); } }, l)));
      const src = cur === 'gen' ? gen : orig; img.src = src; img.onclick = () => imageSheet(cur === 'gen' ? 'QR с суммой ' + money(tx.amount) + ' ' + tx.currency : 'QR клиента', src);
      cap.textContent = cur === 'gen' ? 'Сумма ' + money(tx.amount) + ' ' + tx.currency + ' уже внутри QR' : (tx.qr_decoded ? 'Фото клиента' : 'Фото клиента · QR не распознан');
      if (links) links.hidden = cur !== 'gen';
    };
    const tools = h('div', { class: 'bank-row' });
    if (!tx.qr_decoded && tx.qr_file_url && can('operations')) tools.appendChild(h('button', { class: 'outline-btn blue', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const rr = await api('/withdrawals/' + tx.id + '/decode-qr', { method: 'POST' }); toast('QR распознан', 'ok'); ctx.refresh(); } catch (ex) { err(ex); } busy(b, false); } }, svg('qr', 14), 'Распознать QR'));
    if (!tx.qr_decoded && can('operations')) tools.appendChild(h('button', { class: 'outline-btn', type: 'button', onclick: async () => { const t = await promptDialog('Текст QR', 'Вставьте содержимое QR (ELQR 000201… или ссылку банка)'); if (!t) return; try { await api('/withdrawals/' + tx.id + '/edit', { method: 'POST', body: { fields: { qr_payload: t } } }); toast('QR сохранён', 'ok'); ctx.refresh(); } catch (ex) { err(ex); } } }, svg('edit', 14), 'Ввести вручную'));
    if (!tabs.length) return h('div', { class: 'qr-pay' }, h('small', null, 'QR не прикреплён'), tools.childNodes.length ? tools : null);
    draw();
    return h('div', { class: 'qr-pay' }, tabs.length > 1 ? tabBar : null, img, cap, links, tools.childNodes.length ? tools : null);
  }
  async function pickReceipt(tx, refresh) {
    /* transfer receipt for a payout: camera or gallery → stored on the request → sent to the client with «Вывод выполнен» */
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
      const upload = async (file) => { if (!file) return resolve(false); const note = toast('Загружаю чек…', '', 60000); try { const fd = new FormData(); fd.append('file', file); await api('/withdrawals/' + tx.id + '/receipt', { method: 'POST', body: fd }); note.remove(); toast('Чек прикреплён', 'ok'); if (refresh) refresh(); resolve(true); } catch (e) { note.remove(); err(e); resolve(false); } };
      input.onchange = () => upload(input.files[0]); cam.onchange = () => upload(cam.files[0]);
      document.body.appendChild(input); document.body.appendChild(cam);
      const s = actionSheet('Чек перевода', [{ label: 'Сделать фото', icon: 'image', onclick: () => cam.click() }, { label: 'Из галереи', icon: 'note', onclick: () => input.click() }]);
      const prev = s.close; s.close = () => { prev(); setTimeout(() => { if (!input.files.length && !cam.files.length) resolve(false); input.remove(); cam.remove(); }, 1500); };
    });
  }
  function historyBlock(items) {
    /* «История» lives right under the details: one row, tap to unfold */
    items = items || [];
    const list = h('div', { class: 'history-list', hidden: true }, timeline(items));
    const last = items.length ? items[items.length - 1] : null;
    const row = h('button', { class: 'history-row', type: 'button', onclick: () => { list.hidden = !list.hidden; row.classList.toggle('open', !list.hidden); } }, svg('history', 14), h('span', { class: 'k' }, 'История'), h('span', { class: 'v' }, items.length ? items.length + ' · ' + (last.title || '').slice(0, 40) : 'пусто'), svg('chevron', 14));
    return h('div', { class: 'history-block' }, row, list);
  }
  function txEditSheet(kind, tx, refresh) {
    const dep = kind === 'deposit';
    const path = dep ? 'deposits' : 'withdrawals';
    const locked = tx.status === 'success' || tx.status === 'cancelled';
    const amountLocked = locked || (dep && tx.status === 'processing');
    const f = {};
    const field = (label, key, type, ro) => { const el = h('input', { class: 'input', type: type || 'text', step: type === 'number' ? '0.01' : undefined, inputmode: type === 'number' ? 'decimal' : undefined, value: tx[key] === null || tx[key] === undefined ? '' : tx[key], disabled: !!ro }); if (!ro) f[key] = el; return h('label', { class: 'field' }, h('span', null, label), el); };
    const body = h('div', null,
      dep ? h('div', { class: 'stat-grid' }, field('Сумма к оплате', 'pay_amount', 'number', amountLocked), field('Запросил клиент', 'amount', 'number', amountLocked)) : field('Сумма', 'amount', 'number', locked),
      field('ID счёта', 'player_id', 'text', locked), dep ? field('Имя игрока', 'player_name', 'text', locked) : null,
      field('Комментарий', 'error'));
    const extra = h('div', { class: 'btn-grid' });
    if (!locked && dep) extra.appendChild(h('button', { class: 'action-btn blue', onclick: async () => { const r = await txAction(kind, tx, 'mark_success', { confirm: 'Отметить зачисленным без запроса в кассу?', okLabel: 'Отметить', done: 'Отмечено' }); if (r) { s.close(); refresh(); } } }, 'Зачислено вручную'));
    if (!locked && !dep) {
      if (tx.status === 'created') extra.appendChild(h('button', { class: 'action-btn blue', onclick: async () => { const r = await txAction(kind, tx, 'take', { done: 'В работе' }); if (r) { s.close(); refresh(); } } }, 'Взять в работу'));
      extra.appendChild(h('button', { class: 'action-btn blue', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const r = await txAction(kind, tx, 'retry', { done: 'Код проверен' }); busy(b, false); if (r) { s.close(); refresh(); } } }, 'Перепроверить код'));
    }
    if (extra.childNodes.length) body.appendChild(extra);
    const s = sheet({ title: 'Изменить · # ' + txNo(tx), body, actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const fields = {}; for (const [k, el] of Object.entries(f)) { const cur = tx[k] === null || tx[k] === undefined ? '' : String(tx[k]); if (String(el.value) !== cur) fields[k] = el.value; } try { if (Object.keys(fields).length) await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields } }); toast('Сохранено', 'ok'); s.close(); refresh(); } catch (ex) { err(ex); busy(b, false); } } }, 'Сохранить')] });
  }
  async function openTxSheet(kind, id) {
    const path = kind === 'deposit' ? 'deposits' : 'withdrawals';
    const s = sheet({ title: (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' # ' + id, body: loader(2) });
    const load = async () => {
      try { const r = await api('/' + path + '/' + id); if (r.payment_event) r.item.payment = r.item.payment || { kind: 'matched', source: r.payment_event.source, amount: r.payment_event.amount, received_at: r.payment_event.received_at }; s.setTitle(txTitle(kind, r.item)); s.setBody(txBody(kind, r, { refresh: load, close: () => s.close(), inSheet: true })); }
      catch (e) { s.setBody(empty('Ошибка', e.message)); }
    };
    load();
  }
  function txDetailView(shell, path, id) {
    const kind = path === 'deposits' ? 'deposit' : 'withdraw';
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const head = header((kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' # ' + id, { back: () => (history.length > 1 ? history.back() : go('#/home')) }); screen.appendChild(head);
    const box = h('div', null, loader()); screen.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/' + path + '/' + id); const tx = r.item; box.innerHTML = '';
        if (r.payment_event) tx.payment = tx.payment || { kind: 'matched', source: r.payment_event.source, amount: r.payment_event.amount, received_at: r.payment_event.received_at };
        $('h1', head).textContent = (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' # ' + txNo(tx);
        box.appendChild(h('div', { class: 'card section-card' }, txBody(kind, r, { refresh: draw, close: () => {}, inSheet: false })));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw(); watchChanges(screen, draw);
  }


  /* ------------------------------------------------------------- users (client profile) */
  function userDetailView(shell, id) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(header('Клиент', { back: () => (history.length > 1 ? history.back() : go('#/users')) }));
    const box = h('div', null, loader()); screen.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/users/' + id); const u = r.item; box.innerHTML = '';
        const patch = (body) => api('/users/' + u.id, { method: 'PATCH', body });
        box.appendChild(h('div', { class: 'profile-head' }, h('span', { class: 'avatar big' }, (u.name || '?').charAt(0).toUpperCase()), h('b', null, u.name || 'Клиент'), h('div', { class: 'copy-row' }, h('button', { class: 'copy-chip', type: 'button', onclick: () => copy(u.telegram_id) }, 'TG ' + u.telegram_id, svg('copy', 13)), u.username ? h('button', { class: 'copy-chip', type: 'button', onclick: () => copy('@' + u.username) }, '@' + u.username, svg('copy', 13)) : null), u.is_blocked ? h('span', { class: 'pill red' }, 'заблокирован') : null));
        box.appendChild(h('div', { class: 'tiles3' }, h('div', { class: 'card tile' }, h('b', null, (u.deposits_count || 0) + (u.withdrawals_count || 0)), h('small', null, 'Всего')), h('div', { class: 'card tile green' }, h('b', null, money(u.deposits_sum)), h('small', null, 'Пополнения · ' + u.deposits_count)), h('div', { class: 'card tile red' }, h('b', null, money(u.withdrawals_sum)), h('small', null, 'Выводы · ' + u.withdrawals_count))));
        box.appendChild(h('div', { class: 'card section-card' },
          h('button', { class: 'setting-row tap', type: 'button', onclick: async () => { if (!can('users')) return; const t = await promptDialog('Заметка', 'Видна только операторам', '', u.note || ''); if (t === null) return; try { await patch({ note: t }); toast('Сохранено', 'ok'); draw(); } catch (e) { err(e); } } }, h('div', null, h('b', null, 'Заметка'), h('small', null, u.note || 'Нажмите, чтобы добавить')), svg('edit', 16)),
          h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Активен'), h('small', null, u.is_blocked ? (u.block_reason || 'Заблокирован') : 'Может создавать заявки')), switchEl(!u.is_blocked, async (v) => { if (!can('users')) throw new Error('Нет доступа'); let reason = ''; if (!v) { reason = await promptDialog('Причина блокировки', 'Клиент увидит причину'); if (reason === null) throw new Error('__cancel__'); } await patch({ is_blocked: !v, block_reason: reason }); setTimeout(draw, 150); })),
          h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Поддержка'), h('small', null, u.support_blocked ? 'закрыта' : 'открыта')), switchEl(!u.support_blocked, async (v) => { if (!can('users')) throw new Error('Нет доступа'); await patch({ support_blocked: !v, support_block_reason: v ? '' : 'Ограничено оператором' }); })),
          h('div', { class: 'small muted', style: { paddingTop: '9px' } }, 'Регистрация ' + fmtDate(u.created_at) + (u.last_seen_at ? ' · был ' + ago(u.last_seen_at) + ' назад' : '') + (u.has_qr ? ' · QR ' + (u.qr_bank || 'сохранён') : ''))));
        if (can('support')) box.appendChild(h('button', { class: 'primary-btn', style: { marginBottom: '6px' }, onclick: () => openChat(u.id) }, svg('send', 16), 'Написать клиенту'));
        const txs = [...r.deposits, ...r.withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Транзакции · ' + txs.length)));
        box.appendChild(txs.length ? txGroups(txs, { noAlert: true }) : empty('Заявок нет', '', 'history'));
        if (r.conversations.length) { box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Обращения'))); r.conversations.forEach((c) => box.appendChild(h('button', { class: 'card row-card', onclick: () => go('#/chats/' + c.id) }, h('div', null, h('b', null, c.subject || c.category), h('small', null, fmtDate(c.last_message_at))), statusEl(c.status)))); }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- menu */
  const MENU = [['manage', 'shield', 'Управление PayGo', 'green', 'view'], ['stats', 'stats', 'Статистика', 'blue', 'view'], ['cashes', 'wallet', 'Кассы', 'green', 'cashes'], ['wallets', 'qr', 'Кошельки', 'purple', 'settings'], ['broadcast', 'send', 'Рассылка', 'teal', 'settings'], ['security', 'shield', 'Безопасность', 'teal', 'view'], ['quick', 'bolt', 'Быстрые ответы', 'yellow', 'support'], ['logs', 'terminal', 'Логи', 'red', 'logs'], ['settings', 'settings', 'Настройки', 'gray', 'settings'], ['macrodroid', 'bolt', 'MacroDroid', 'yellow', 'settings']];
  function menuView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(h('div', { class: 'card account-card', style: { marginTop: '18px' } }, h('span', null, svg('user', 22)), h('div', null, h('b', null, 'Мой аккаунт'), h('small', null, (state.admin.name || state.admin.username) + ' · ' + ({ owner: 'Владелец', admin: 'Администратор платформы', operator: 'Оператор', viewer: 'Просмотр' }[state.admin.role] || state.admin.role)))));
    screen.appendChild(h('div', { class: 'menu-grid' }, MENU.filter((m) => can(m[4])).map((m) => h('button', { class: 'card menu-tile', onclick: () => go('#/' + m[0]) }, h('span', { class: 'menu-color ' + m[3] }, svg(m[1], 20)), h('b', null, m[2]))), h('button', { class: 'card menu-tile logout', onclick: logout }, h('span', { class: 'menu-color red' }, svg('logout', 20)), h('b', null, 'Выйти'))));
  }
  function page(shell, title, opts) { const screen = h('section', { class: 'screen' }); shell.appendChild(screen); screen.appendChild(header(title, Object.assign({ back: () => go('#/menu') }, opts || {}))); const box = h('div', null, loader()); screen.appendChild(box); return box; }

  /* ------------------------------------------------------------- manage / stats */
  async function manageView(shell) {
    const box = page(shell, 'Управление PayGo', { right: h('button', { class: 'header-btn', onclick: () => render() }, svg('refresh', 18)) });
    try {
      const d = await api('/dashboard'); const q = d.queues, t = d.today; box.innerHTML = '';
      box.appendChild(h('div', { class: 'stat-grid' }, h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, money(t.deposits_sum)), h('div', { class: 'l' }, 'Пополнения сегодня · ' + t.deposits_count)), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, money(t.withdrawals_sum)), h('div', { class: 'l' }, 'Выводы сегодня · ' + t.withdrawals_count)), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.deposits_pending + q.deposits_failed), h('div', { class: 'l' }, 'Пополнений в работе' + (q.deposits_failed ? ' · проблем ' + q.deposits_failed : ''))), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.withdrawals_pending), h('div', { class: 'l' }, 'Выводов в работе' + (q.withdrawals_attention ? ' · внимание ' + q.withdrawals_attention : ''))), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.support_waiting), h('div', { class: 'l' }, 'Ждут оператора')), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, d.total.users), h('div', { class: 'l' }, 'Клиентов · сегодня +' + t.users_new))));
      box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Кассы'), can('cashes') ? h('button', { class: 'outline-btn', onclick: () => go('#/cashes') }, 'Управление') : null));
      d.cashes.forEach((c) => box.appendChild(cashRow(c)));
      box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Уведомления'), h('button', { class: 'outline-btn', onclick: async () => { await api('/notifications/ack-all', { method: 'POST' }); render(); } }, 'Прочитано')));
      const notes = (state.live && state.live.notifications) || [];
      if (!notes.length) box.appendChild(empty('Уведомлений нет', '', 'bell'));
      notes.slice(0, 10).forEach((n) => box.appendChild(h('button', { class: 'card row-card', onclick: () => { if (n.data && n.data.url) go(n.data.url); } }, h('span', { class: 'menu-color ' + (n.level === 'critical' ? 'red' : 'blue') }, svg(n.level === 'critical' ? 'bolt' : 'bell', 18)), h('div', null, h('b', null, n.title), h('small', null, n.body)), h('small', { class: 'muted' }, ago(n.created_at)))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  function cashRow(c) { return h('button', { class: 'card wallet-card', onclick: () => go('#/cashes/' + c.id) }, h('span', { class: 'ico' }, svg('bank', 20)), h('div', { style: { minWidth: 0 } }, h('b', null, c.name), h('small', null, (c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + c.currency : 'баланс не проверен') + (c.last_check_at ? ' · ' + ago(c.last_check_at) + ' назад' : ''))), h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } }, statusEl(c.status), h('span', { class: 'small muted' }, c.deposit_enabled && !c.auto_disabled ? 'ПП' : '—', ' · ', c.withdraw_enabled ? 'ВВ' : '—'))); }
  async function statsView(shell) {
    const box = page(shell, 'Статистика'); const st = { days: 7 };
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader(2));
      try {
        const to = new Date(); const from = new Date(Date.now() - (st.days - 1) * 86400000);
        const r = await api('/stats?date_from=' + dayKey(from) + '&date_to=' + dayKey(to)); box.innerHTML = '';
        box.appendChild(h('div', { style: { marginBottom: '10px' } }, segEl([[1, 'Сегодня'], [7, '7 дней'], [30, '30 дней']], st.days, (k) => { st.days = k; draw(); }, 'light')));
        box.appendChild(h('div', { class: 'stat-grid' }, h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, money(r.deposits_sum)), h('div', { class: 'l' }, 'Пополнений · ' + r.deposits_count)), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, money(r.withdrawals_sum)), h('div', { class: 'l' }, 'Выводов · ' + r.withdrawals_count))));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'По кассам'), h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Касса', 'Пополнения', 'Выводы'].map((x) => h('th', null, x)))), h('tbody', null, r.by_cash.map((c) => h('tr', null, h('td', null, h('b', null, c.name)), h('td', null, money(c.deposits_sum), h('div', { class: 'small muted' }, c.deposits_count + ' шт')), h('td', null, money(c.withdrawals_sum), h('div', { class: 'small muted' }, c.withdrawals_count + ' шт')))))))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- cashes */
  async function cashesView(shell) {
    const box = page(shell, 'Кассы', { right: can('cashes') ? h('button', { class: 'header-btn primary-head', onclick: () => cashForm(null), 'aria-label': 'Добавить' }, svg('plus', 18)) : null });
    try {
      const r = await api('/cashes'); state.cashes = r.items; state.types = r.types; box.innerHTML = '';
      if (!r.items.length) box.appendChild(empty('Касс нет', '', 'wallet'));
      r.items.forEach((c) => {
        const card = h('div', { class: 'card section-card' });
        card.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'dot ' + c.status }), h('b', { style: { flex: 1, fontSize: '15px' } }, c.name), statusEl(c.status)));
        card.appendChild(h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, c.provider_type + ' · приоритет ' + c.priority + (c.ip_address ? ' · IP ' + c.ip_address : '')));
        card.appendChild(h('div', { style: { fontSize: '20px', fontWeight: 860 } }, c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + c.currency : '—'));
        card.appendChild(h('div', { class: 'small muted' }, c.last_check_at ? 'проверено ' + ago(c.last_check_at) + ' назад' : 'не проверялась', c.last_check_ok === false && c.last_check_message ? ' · ' + c.last_check_message : ''));
        card.appendChild(h('div', { class: 'tag-row' }, h('span', { class: 'pill ' + (c.deposit_enabled && !c.auto_disabled ? 'green' : '') }, 'Пополнение'), h('span', { class: 'pill ' + (c.withdraw_enabled ? 'green' : '') }, 'Вывод'), h('span', { class: 'pill' }, money(c.deposit_min) + ' – ' + money(c.deposit_max)), h('span', { class: 'pill amber' }, 'автостоп ≤ ' + money(c.critical_balance_threshold))));
        if (can('cashes')) card.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn blue', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const rr = await api('/cashes/' + c.id + '/check', { method: 'POST' }); toast(rr.result.ok ? 'Соединение OK · баланс ' + (rr.result.balance !== null ? money(rr.result.balance) : '—') : 'Ошибка: ' + rr.result.message, rr.result.ok ? 'ok' : 'err', 4000); render(); } catch (ex) { err(ex); } b.disabled = false; } }, svg('bolt', 14), 'Проверить'), h('button', { class: 'outline-btn', onclick: () => cashForm(c) }, svg('edit', 14), 'Изменить'), h('button', { class: 'outline-btn ' + (c.enabled ? 'danger' : 'green'), onclick: async () => { try { await api('/cashes/' + c.id, { method: 'PATCH', body: { enabled: !c.enabled } }); toast(c.enabled ? 'Касса отключена' : 'Касса включена', 'ok'); render(); } catch (ex) { err(ex); } } }, c.enabled ? 'Отключить' : 'Включить'), c.auto_disabled ? h('button', { class: 'outline-btn blue', onclick: async () => { await api('/cashes/' + c.id, { method: 'PATCH', body: { auto_disabled: false } }); render(); } }, 'Снять автостоп') : null, h('button', { class: 'outline-btn', onclick: async () => { if (await confirmDialog('Удалить кассу ' + c.name + '? Если по ней были операции, она будет отключена.', 'Удалить', true)) { try { const rr = await api('/cashes/' + c.id, { method: 'DELETE' }); toast(rr.message || 'Удалено', 'ok'); render(); } catch (ex) { err(ex); } } } }, svg('trash', 14))));
        box.appendChild(card);
      });
      if (state.route.id) { const c = r.items.find((x) => String(x.id) === String(state.route.id)); if (c && can('cashes')) cashForm(c); }
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  function cashForm(c) {
    const isNew = !c; c = c || { provider_type: 'servcul', enabled: false, priority: 100, currency: 'KGS', emoji: '', custom_emoji_id: '', deposit_enabled: true, withdraw_enabled: true, deposit_min: 100, deposit_max: 100000, auto_disable_enabled: true, low_balance_threshold: 20000, critical_balance_threshold: 1000, auto_enable_threshold: 5000, credentials: [] };
    const f = {};
    const field = (label, key, type, opts) => { const el = type === 'select' ? h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(c[key]) }, l))) : type === 'textarea' ? h('textarea', { class: 'textarea', placeholder: (opts && opts.placeholder) || '' }, c[key] || '') : h('input', { class: 'input', type: type || 'text', value: c[key] === undefined || c[key] === null ? '' : c[key], placeholder: (opts && opts.placeholder) || '' }); f[key] = el; return h('label', { class: 'field' }, h('span', null, label), el); };
    const bool = (label, key) => { const sw = switchEl(!!c[key], async (v) => { f[key].value = v ? '1' : '0'; }); f[key] = h('input', { type: 'hidden', value: c[key] ? '1' : '0' }); return h('div', { class: 'setting-row' }, h('div', null, h('b', null, label)), sw, f[key]); };
    const title = (text) => h('div', { class: 'section-title' }, h('h2', null, text));
    const credBox = h('div');
    const drawCreds = () => { credBox.innerHTML = ''; const type = state.types.find((t) => t.type === (f.provider_type ? f.provider_type.value : c.provider_type)) || { fields: [] }; credBox.appendChild(title('Учётные данные (шифруются)')); const adv = h('div', { hidden: true }); const fieldOf = (fd) => { const cur = (c.credentials || []).find((x) => x.key === fd.key); const el = h('input', { class: 'input', type: fd.secret ? 'password' : 'text', placeholder: cur && cur.set ? (fd.secret ? 'задано ' + cur.masked + ' — пусто = не менять' : cur.masked) : (fd.required ? 'обязательно' : 'необязательно'), value: cur && !fd.secret && cur.set ? cur.masked : '' }); el.dataset.cred = fd.key; return h('label', { class: 'field' }, h('span', null, fd.label), el); }; type.fields.forEach((fd) => (fd.advanced ? adv : credBox).appendChild(fieldOf(fd))); if (adv.childNodes.length) { const hasAdv = type.fields.some((fd) => fd.advanced && (c.credentials || []).some((x) => x.key === fd.key && x.set)); adv.hidden = !hasAdv; credBox.appendChild(h('button', { class: 'outline-btn', type: 'button', onclick: () => { adv.hidden = !adv.hidden; } }, svg('settings', 13), 'Дополнительно (вход на 1win.win)')); credBox.appendChild(adv); } };
    const photoField = (kind, label, hint) => {
      const wrap = h('div', { class: 'photo-field' });
      const key = kind === 'instruction' ? 'instruction_photo' : kind + '_photo';
      const draw = () => {
        wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'photo-head' }, h('b', null, label), h('small', null, hint)));
        if (isNew) { wrap.appendChild(h('div', { class: 'small muted' }, 'Сначала сохраните кассу')); return; }
        const rel = c[key]; const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        input.onchange = async () => { if (!input.files[0]) return; const fd = new FormData(); fd.append('kind', kind); fd.append('file', input.files[0]); try { const rr = await api('/cashes/' + c.id + '/photo', { method: 'POST', body: fd }); Object.assign(c, rr.item); toast('Фото загружено', 'ok'); draw(); } catch (ex) { err(ex); } };
        wrap.appendChild(h('div', { class: 'photo-row' }, rel ? h('img', { class: 'photo-thumb', src: fileUrl('/' + rel), alt: '' }) : h('div', { class: 'photo-thumb blank' }, svg('image', 18)), h('div', { class: 'btn-row', style: { margin: 0 } }, h('button', { class: 'outline-btn blue', type: 'button', onclick: () => input.click() }, svg('image', 14), rel ? 'Заменить' : 'Загрузить'), rel ? h('button', { class: 'outline-btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Удалить фото?', 'Удалить', true)) { try { const rr = await api('/cashes/' + c.id + '/photo/' + kind, { method: 'DELETE' }); Object.assign(c, rr.item); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 13)) : null, input)));
      };
      draw(); return wrap;
    };
    const body = h('div', null,
      isNew ? field('Ключ (латиницей, напр. 1xbet)', 'key') : null, field('Название (как в кнопке бота)', 'name'), isNew ? field('Тип', 'provider_type', 'select', state.types.map((t) => [t.type, t.label])) : h('label', { class: 'field' }, h('span', null, 'Тип'), h('input', { class: 'input', value: (state.types.find((t) => t.type === c.provider_type) || { label: c.provider_type }).label, disabled: true })),
      h('div', { class: 'stat-grid' }, field('Эмодзи в кнопке', 'emoji', 'text', { placeholder: '😎' }), field('ID premium-эмодзи', 'custom_emoji_id', 'text', { placeholder: 'необязательно' })),
      h('div', { class: 'stat-grid' }, field('Приоритет', 'priority', 'number'), field('Валюта', 'currency')), field('Валюты игрока (через запятую)', 'accepted_currency_ids', 'text', { placeholder: 'пусто — не проверять' }), (function () { const extra = h('div', null, field('IP кассы', 'ip_address'), field('Адрес API', 'base_url')); const sync = () => { extra.hidden = (f.provider_type ? f.provider_type.value : c.provider_type) === 'xapi'; }; setTimeout(sync, 0); if (f.provider_type) f.provider_type.addEventListener('change', sync); return extra; })(),
      h('div', { class: 'card section-card' }, bool('Касса включена', 'enabled'), bool('Пополнение', 'deposit_enabled'), bool('Вывод', 'withdraw_enabled')),
      h('div', { class: 'stat-grid' }, field('Мин. пополнение', 'deposit_min', 'number'), field('Макс. пополнение', 'deposit_max', 'number'), field('Комиссия ПП, %', 'deposit_fee_pct', 'number'), field('Комиссия ВВ, %', 'withdraw_fee_pct', 'number')),
      title('Автоотключение по балансу'), h('div', { class: 'card section-card' }, bool('Автоматически отключать пополнения', 'auto_disable_enabled')),
      field('Мало средств — уведомить', 'low_balance_threshold', 'number'), field('Критический баланс — стоп', 'critical_balance_threshold', 'number'), field('Включить обратно при', 'auto_enable_threshold', 'number'),
      credBox,
      title('Шаги бота: фото и тексты'),
      photoField('deposit', 'Пополнение → «Введите ваш ID»', ''), field('Текст шага', 'deposit_photo_text', 'textarea', { placeholder: 'пусто — общий текст' }),
      photoField('withdraw', 'Вывод → «Введите ваш ID»', ''), field('Текст шага', 'withdraw_photo_text', 'textarea', { placeholder: 'пусто — общий текст' }),
      photoField('code', 'Вывод → «Введите код»', ''), field('Текст шага', 'code_photo_text', 'textarea', { placeholder: 'пусто — общий текст' }),
      title('Инструкция по выводу (для этой кассы)'),
      h('div', { class: 'stat-grid' }, field('Город', 'withdraw_city', 'text', { placeholder: 'пусто = общий' }), field('Адрес', 'withdraw_address', 'text', { placeholder: 'пусто = общий' })),
      photoField('instruction', 'Фото инструкции', ''), field('Текст инструкции', 'instructions_text', 'textarea', { placeholder: 'пусто — общая из Настроек → Выводы' }),
      field('Заметки', 'notes', 'textarea'));
    drawCreds(); if (f.provider_type) f.provider_type.onchange = drawCreds;
    const s = sheet({ title: isNew ? 'Новая касса' : c.name, body, actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.classList.add('busy'); const payload = {}; for (const [k, el] of Object.entries(f)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; const creds = {}; credBox.querySelectorAll('input[data-cred]').forEach((el) => { if (el.value && el.value !== el.placeholder) creds[el.dataset.cred] = el.value; }); payload.credentials = creds; try { const rr = isNew ? await api('/cashes', { method: 'POST', body: payload }) : await api('/cashes/' + c.id, { method: 'PATCH', body: payload }); toast('Сохранено', 'ok'); s.close(); if (isNew && rr.item) { history.replaceState(null, '', '#/cashes/' + rr.item.id); } go('#/cashes'); render(); } catch (ex) { err(ex); b.disabled = false; b.classList.remove('busy'); } } }, 'Сохранить')] });
  }

  /* ------------------------------------------------------------- events (Выписка) */
  async function eventsView(shell) {
    const box = page(shell, 'Выписка платежей', { right: can('operations') ? h('button', { class: 'header-btn primary-head', 'aria-label': 'Платёж вручную', onclick: manualPayment }, svg('plus', 18)) : null });
    const st = { status: '', page: 1 };
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/payment-events?status=' + st.status + '&page=' + st.page + '&size=40'); box.innerHTML = '';
        box.appendChild(h('div', { style: { marginBottom: '10px' } }, segEl([['', 'Все'], ['matched', 'Зачислены'], ['received,unmatched', 'Не найдены'], ['failed', 'Ошибки']], st.status, (k) => { st.status = k; st.page = 1; draw(); }, 'light')));
        if (!r.items.length) return box.appendChild(empty('Платежей нет', '', 'calendar'));
        r.items.forEach((ev) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('div', null, h('b', null, money(ev.amount) + ' ' + ev.currency + ' · ' + ev.source), h('small', null, fmtDate(ev.received_at) + ' · ' + (ev.raw_text || '').slice(0, 80))), h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } }, statusEl(ev.status === 'matched' ? 'success' : ev.status === 'failed' ? 'failed' : ev.status === 'processing' ? 'processing' : 'created', ev.status === 'matched' ? 'Зачислен' : ev.status === 'failed' ? 'Ошибка' : ev.status === 'unmatched' ? 'Не найден' : 'Ожидает'), ev.deposit_id ? h('a', { class: 'small', href: '#/deposits/' + ev.deposit_id, style: { color: 'var(--blue)' } }, 'заявка #' + ev.deposit_id) : null, ['unmatched', 'failed', 'received'].includes(ev.status) && can('operations') ? h('button', { class: 'outline-btn', onclick: async () => { try { const rr = await api('/payment-events/' + ev.id + '/retry', { method: 'POST' }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err'); draw(); } catch (ex) { err(ex); } } }, 'Повторить') : null))));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; draw(); }); if (p) box.appendChild(p);
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
    function manualPayment() { const amount = h('input', { class: 'input', type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'напр. 1500.37' }); const note = h('input', { class: 'input', placeholder: 'необязательно' }); const s = sheet({ title: 'Платёж вручную', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Сумма из выписки (с тыйынами)'), amount), h('label', { class: 'field' }, h('span', null, 'Комментарий'), note)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { const rr = await api('/payment-events/manual', { method: 'POST', body: { amount: amount.value, note: note.value } }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err', 4000); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Провести')] }); }
  }

  /* ------------------------------------------------------------- gateway (Платёжка) */
  async function walletsView(shell) {
    /* Кошельки: QR / реквизиты, на которые клиенты платят (банковские кнопки — в Настройках) */
    const box = page(shell, 'Кошельки');
    const draw = async () => {
      try {
        const [rq, info, cashes] = await Promise.all([api('/requisites'), api('/webhook-info'), api('/cashes')]); box.innerHTML = '';
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Режим выбора реквизита')));
        box.appendChild(h('div', { style: { marginBottom: '10px' } }, segEl([['random', 'Случайный'], ['priority', 'Один основной']], info.requisite_mode, async (k) => { try { await api('/settings', { method: 'POST', body: { values: { requisite_mode: k } } }); toast('Сохранено', 'ok'); draw(); } catch (ex) { err(ex); } }, 'light')));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Кошельки · ' + rq.items.filter((q) => q.enabled).length + ' вкл.'), h('button', { class: 'outline-btn blue', onclick: () => requisiteForm(null) }, svg('plus', 14), 'Добавить')));
        if (!rq.items.length) box.appendChild(empty('Кошельков нет', 'Добавьте QR банка — на него будут платить клиенты', 'qr'));
        rq.items.forEach((q) => { const cashName = (cashes.items.find((c) => c.id === q.cash_id) || {}).name; box.appendChild(h('div', { class: 'card wallet-card', style: { opacity: q.enabled ? 1 : 0.6 } }, h('span', { class: 'ico' }, svg('qr', 20)), h('div', { style: { minWidth: 0 } }, h('b', null, q.name), h('small', null, q.bank_name + ' · ' + q.account + (q.holder ? ' · ' + q.holder : '')), h('div', { class: 'tag-row' }, h('span', { class: 'pill ' + (q.enabled ? 'green' : '') }, q.enabled ? 'включён' : 'выключен'), h('span', { class: 'pill' }, 'приоритет ' + q.priority), cashName ? h('span', { class: 'pill blue' }, cashName) : h('span', { class: 'pill' }, 'все кассы')), h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: () => requisiteForm(q) }, svg('edit', 13), 'Изменить'), h('button', { class: 'outline-btn danger', onclick: async () => { if (await confirmDialog('Удалить кошелёк ' + q.name + '?', 'Удалить', true)) { try { await api('/requisites/' + q.id, { method: 'DELETE' }); toast('Удалено', 'ok'); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 13)))), switchEl(q.enabled, async (v) => { await api('/requisites/' + q.id, { method: 'PATCH', body: { enabled: v } }); setTimeout(draw, 200); }))); });
        function requisiteForm(q) {
          const isNew = !q; q = q || { name: '', priority: 100, enabled: true, notes: '', cash_id: null };
          const name = h('input', { class: 'input', placeholder: 'напр. Optima основной', value: q.name });
          const priority = h('input', { class: 'input', type: 'number', value: q.priority });
          const cashSel = h('select', { class: 'select' }, h('option', { value: '', selected: !q.cash_id }, 'Все кассы'), cashes.items.map((c) => h('option', { value: c.id, selected: c.id === q.cash_id }, c.name)));
          const notes = h('input', { class: 'input', placeholder: 'необязательно', value: q.notes || '' });
          const src = h('textarea', { class: 'textarea', placeholder: isNew ? 'ELQR (000201…) или ссылка банка' : 'Пусто = оставить текущий QR' });
          const file = h('input', { type: 'file', accept: 'image/*', class: 'input' });
          file.onchange = async () => { const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/requisites/upload', { method: 'POST', body: fd }); src.value = rr.source; toast('QR распознан: ' + rr.meta.bank_name, 'ok'); } catch (ex) { err(ex); } };
          const s = sheet({ title: isNew ? 'Новый кошелёк' : q.name, body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), name), h('div', { class: 'stat-grid' }, h('label', { class: 'field' }, h('span', null, 'Приоритет'), priority), h('label', { class: 'field' }, h('span', null, 'Касса'), cashSel)), h('label', { class: 'field' }, h('span', null, 'Заметка'), notes), h('label', { class: 'field' }, h('span', null, isNew ? 'QR / ссылка' : 'Заменить QR / ссылку'), src), h('label', { class: 'field' }, h('span', null, 'или изображение QR'), file)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { const body = { name: name.value, priority: Number(priority.value || 100), cash_id: cashSel.value ? Number(cashSel.value) : 0, notes: notes.value }; if (src.value.trim()) body.source = src.value.trim(); try { if (isNew) { if (!body.source) return toast('Укажите QR или ссылку', 'err'); await api('/requisites', { method: 'POST', body }); } else await api('/requisites/' + q.id, { method: 'PATCH', body }); toast('Сохранено', 'ok'); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Сохранить')] });
        }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- MacroDroid / webhook */
  async function macrodroidView(shell) {
    const box = page(shell, 'MacroDroid');
    let revealed = false;
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/webhook-info'); box.innerHTML = '';
        const urlEl = h('div', { class: 'code-box' }, revealed ? r.url : r.url_masked);
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Адрес для MacroDroid'), urlEl, h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: () => { revealed = !revealed; urlEl.textContent = revealed ? r.url : r.url_masked; } }, revealed ? 'Скрыть ключ' : 'Показать ключ'), h('button', { class: 'outline-btn blue', onclick: () => copy(r.url) }, svg('copy', 14), 'Копировать адрес'), h('button', { class: 'outline-btn green', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const rr = await api('/webhook-info/test', { method: 'POST' }); toast('Тест прошёл: событие #' + rr.event.id + ' (' + rr.event.status + ')', 'ok', 4000); draw(); } catch (ex) { err(ex); } b.disabled = false; } }, svg('bolt', 14), 'Тест')), h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Адрес содержит ключ — не пересылайте посторонним')));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Настройка макроса'), h('ol', { class: 'steps' }, h('li', null, h('b', null, 'Триггер:'), ' «Уведомление получено» → выберите приложение банка (MBank, Optima, O!Деньги…).'), h('li', null, h('b', null, 'Действие:'), ' «HTTP-запрос» → метод POST → вставьте адрес выше.'), h('li', null, h('b', null, 'Content-Type:'), ' application/json. Тело запроса:'), h('div', { class: 'code-box' }, JSON.stringify(r.sample_body)), h('li', null, 'Нажмите «Тест» — событие появится ниже.'))));
        const ipInput = h('textarea', { class: 'textarea', placeholder: 'пусто — любой IP', style: { minHeight: '60px' } }, r.ip_allowlist || '');
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Защита'), h('label', { class: 'field' }, h('span', null, 'Белый список IP (через запятую)'), ipInput), h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Требовать подпись'), h('small', null, 'Только для своих скриптов, MacroDroid не умеет')), switchEl(r.require_signature, async (v) => { await api('/settings', { method: 'POST', body: { values: { webhook_require_signature: v } } }); })), h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await api('/settings', { method: 'POST', body: { values: { webhook_ip_allowlist: ipInput.value.trim() } } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } b.disabled = false; } }, svg('check', 16), 'Сохранить')));
        const c = r.counts_24h || {};
        box.appendChild(h('div', { class: 'stat-grid', style: { marginBottom: '12px' } }, h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, c.matched || 0), h('div', { class: 'l' }, 'зачислено за 24 ч')), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, c.unmatched || 0), h('div', { class: 'l' }, 'без заявки')), h('div', { class: 'card stat-card red' }, h('div', { class: 'v' }, c.failed || 0), h('div', { class: 'l' }, 'ошибки')), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, (c.received || 0) + (c.processing || 0)), h('div', { class: 'l' }, 'в обработке'))));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Последние платежи'), h('button', { class: 'outline-btn', onclick: () => go('#/events') }, 'Вся выписка')));
        if (!r.recent.length) box.appendChild(empty('Платежей ещё не было', 'Нажмите «Тест»', 'calendar'));
        r.recent.forEach((ev) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('span', { class: 'dot ' + (ev.status === 'matched' ? 'green' : ev.status === 'failed' ? 'red' : ev.status === 'unmatched' ? 'amber' : 'blue') }), h('div', null, h('b', null, money(ev.amount) + ' ' + (ev.currency || 'KGS') + ' · ' + ev.source), h('small', null, fmtDate(ev.received_at) + (ev.sender_ip ? ' · ' + ev.sender_ip : '') + ' · ' + (ev.raw_text || '').slice(0, 60))), statusEl(ev.status === 'matched' ? 'success' : ev.status === 'failed' ? 'failed' : ev.status === 'unmatched' ? 'pending' : 'processing', ev.status === 'matched' ? 'Зачислен' : ev.status === 'failed' ? 'Ошибка' : ev.status === 'unmatched' ? 'Не найден' : 'Обработка'))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw(); watchChanges(box, draw);
  }



  /* ------------------------------------------------------------- broadcast (Рассылка) */
  async function broadcastView(shell) {
    const box = page(shell, 'Рассылка');
    const st = { bot: 'main', photo: '', audience: 'all', buttons: [], testChat: '' };
    const AUD = [['all', 'Отправить всем'], ['new', 'Новым клиентам'], ['big', 'Крупным клиентам'], ['test', 'Тест рассылки (себе)']];
    const text = h('textarea', { class: 'textarea', placeholder: 'Текст сообщения', style: { minHeight: '120px' } });
    const segBox = h('div', { style: { marginBottom: '10px' } });
    const drawSeg = () => { segBox.innerHTML = ''; segBox.appendChild(segEl([['main', 'Основной бот'], ['support', 'Бот поддержки']], st.bot, (k) => { st.bot = k; drawSeg(); })); };
    const audSel = h('select', { class: 'select' }, AUD.map(([v, l]) => h('option', { value: v }, l)));
    const countEl = h('div', { class: 'aud-count' }, '…');
    const testBox = h('label', { class: 'field', hidden: true }, h('span', null, 'Telegram ID для теста'), h('input', { class: 'input', inputmode: 'numeric', placeholder: 'ваш Telegram ID', oninput: (e) => { st.testChat = e.target.value.trim(); } }));
    const loadCount = async () => { countEl.textContent = '…'; try { const r = await api('/broadcast/audience?audience=' + st.audience); countEl.textContent = 'Получателей: ' + r.count; if (st.audience === 'test') { testBox.hidden = false; const inp = $('input', testBox); if (r.test_chat_id && !inp.value) { inp.value = r.test_chat_id; st.testChat = String(r.test_chat_id); } } else testBox.hidden = true; } catch (e) { countEl.textContent = ''; } };
    audSel.onchange = () => { st.audience = audSel.value; loadCount(); };
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const photoBox = h('div', { class: 'photo-row' });
    const drawPhoto = () => { photoBox.innerHTML = ''; photoBox.appendChild(st.photo ? h('img', { class: 'photo-thumb', src: fileUrl(st.photo), alt: '' }) : h('div', { class: 'photo-thumb blank' }, svg('image', 18))); photoBox.appendChild(h('div', { class: 'btn-row', style: { margin: 0 } }, h('button', { class: 'outline-btn blue', type: 'button', onclick: () => file.click() }, svg('image', 14), st.photo ? 'Заменить' : 'Загрузить'), st.photo ? h('button', { class: 'outline-btn danger', type: 'button', onclick: () => { st.photo = ''; drawPhoto(); } }, svg('trash', 13)) : null, file)); };
    file.onchange = async () => { if (!file.files[0]) return; const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/support/upload', { method: 'POST', body: fd }); st.photo = rr.url; drawPhoto(); } catch (ex) { err(ex); } file.value = ''; };
    const btnBox = h('div', { class: 'list' });
    const drawButtons = () => {
      btnBox.innerHTML = '';
      st.buttons.forEach((b, i) => btnBox.appendChild(h('div', { class: 'btn-editor' }, h('input', { class: 'input', placeholder: 'Название', value: b.text, maxlength: 40, oninput: (e) => { b.text = e.target.value; } }), h('input', { class: 'input', placeholder: 'https://…', value: b.url, inputmode: 'url', oninput: (e) => { b.url = e.target.value; } }), h('button', { class: 'outline-btn danger', type: 'button', 'aria-label': 'Удалить', onclick: () => { st.buttons.splice(i, 1); drawButtons(); } }, svg('trash', 13)))));
      if (st.buttons.length < 6) btnBox.appendChild(h('button', { class: 'outline-btn blue', type: 'button', onclick: () => { st.buttons.push({ text: '', url: '' }); drawButtons(); const last = btnBox.querySelector('.btn-editor:last-of-type input'); if (last) last.focus(); } }, svg('plus', 14), 'Добавить кнопку'));
    };
    const btn = h('button', { class: 'primary-btn' }, svg('send', 16), 'Отправить');
    btn.onclick = async () => {
      if (!text.value.trim()) return toast('Введите текст', 'err');
      const buttons = st.buttons.filter((b) => b.text.trim() || b.url.trim());
      for (const b of buttons) { if (!b.text.trim() || !/^https?:\/\/|^tg:\/\//.test(b.url.trim())) return toast('У кнопки нужны название и ссылка https://…', 'err'); }
      const label = (AUD.find((a) => a[0] === st.audience) || AUD[0])[1];
      if (st.audience !== 'test' && !(await confirmDialog(label + ' через ' + (st.bot === 'support' ? 'бот поддержки' : 'основной бот') + '?', 'Отправить'))) return;
      busy(btn, true);
      try { const r = await api('/broadcast', { method: 'POST', body: { text: text.value, photo_url: st.photo, bot: st.bot, audience: st.audience, buttons: buttons.map((b) => ({ text: b.text.trim(), url: b.url.trim() })), test_chat_id: st.audience === 'test' ? st.testChat || null : null } }); toast(r.test ? 'Тест отправлен вам в бот' : 'В очереди · ' + r.recipients + ' получателей. Отправка идёт в фоне', 'ok', 4000); if (!r.test) { text.value = ''; st.photo = ''; st.buttons = []; drawPhoto(); drawButtons(); loadHistory(); } buzz(); } catch (ex) { err(ex); }
      busy(btn, false);
    };
    const histBox = h('div');
    const AUD_SHORT = { all: 'всем', new: 'новым', big: 'крупным', active: 'активным', test: 'тест' };
    const BSTATUS = { queued: ['В очереди', 'blue'], sending: ['Отправляется', 'blue'], delivering: ['Отправляется', 'blue'], done: ['Готово', 'success'], failed: ['Ошибка', 'problem'] };
    let histTimer = null;
    const loadHistory = async () => {
      try {
        const r = await api('/broadcast/history?limit=30');
        histBox.innerHTML = '';
        histBox.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'История рассылок')));
        if (!r.items.length) { histBox.appendChild(empty('Рассылок ещё не было', '', 'bell')); return; }
        r.items.forEach((b) => { const [label, cls] = BSTATUS[b.status] || [b.status, '']; const running = ['queued', 'sending', 'delivering'].includes(b.status); histBox.appendChild(h('button', { class: 'card row-card bc-row', onclick: () => openBroadcast(b.id) }, h('span', { class: 'menu-color ' + (b.status === 'done' ? 'green' : b.status === 'failed' ? 'red' : 'blue') }, svg(b.bot === 'support' ? 'chat' : 'send', 16)), h('div', null, h('b', null, (b.text || '').replace(/\s+/g, ' ').slice(0, 60) || (b.photo_url ? 'Фото' : b.video_url ? 'Видео' : '—')), h('small', null, fmtDate(b.created_at) + ' · ' + (b.bot === 'support' ? 'поддержка' : 'основной') + ' · ' + (AUD_SHORT[b.audience] || b.audience) + ' · ' + b.admin_name), h('div', { class: 'bc-stats' }, h('span', { class: 'status ' + cls }, h('i'), label), h('span', { class: 'pill' }, 'получателей ' + b.recipients), h('span', { class: 'pill green' }, 'отправлено ' + b.sent), b.failed ? h('span', { class: 'pill red' }, 'ошибок ' + b.failed) : null, running ? h('span', { class: 'bc-bar' }, h('i', { style: { width: (b.recipients ? Math.round(((b.sent + b.failed) / b.recipients) * 100) : 0) + '%' } })) : null)))); });
        const active = r.items.some((b) => ['queued', 'sending', 'delivering'].includes(b.status));
        clearTimeout(histTimer); if (active && document.body.contains(histBox)) histTimer = setTimeout(loadHistory, 3000);
      } catch (e) { /* silent */ }
    };
    async function openBroadcast(id) {
      const s = sheet({ title: 'Рассылка #' + id, body: loader(2) });
      try {
        const r = await api('/broadcast/' + id); const b = r.item; const [label, cls] = BSTATUS[b.status] || [b.status, ''];
        s.setBody(h('div', null, h('div', { class: 'bc-stats', style: { marginBottom: '8px' } }, h('span', { class: 'status ' + cls }, h('i'), label), h('span', { class: 'pill' }, 'получателей ' + b.recipients), h('span', { class: 'pill green' }, 'отправлено ' + b.sent), h('span', { class: 'pill ' + (b.failed ? 'red' : '') }, 'ошибок ' + b.failed)), kv([['Создана', fmtDate(b.created_at)], ['Завершена', b.finished_at ? fmtDate(b.finished_at) : '—'], ['Бот', b.bot === 'support' ? 'Бот поддержки' : 'Основной бот'], ['Кому', AUD_SHORT[b.audience] || b.audience], ['Оператор', b.admin_name || '—'], b.error ? ['Ошибка', h('span', { class: 'err-text' }, b.error)] : null]), h('div', { class: 'bubble out operator', style: { maxWidth: '100%', marginTop: '10px' } }, b.photo_url ? h('img', { src: fileUrl(b.photo_url), alt: '' }) : null, h('span', { class: 'txt' }, b.text)), b.buttons && b.buttons.length ? h('div', { class: 'bank-row', style: { marginTop: '8px' } }, b.buttons.map((x) => h('a', { class: 'outline-btn', href: x.url, target: '_blank', rel: 'noopener' }, x.text))) : null, b.errors && b.errors.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'section-title' }, h('h2', null, 'Ошибки доставки')), b.errors.map((e) => h('div', { class: 'setting-row' }, h('div', null, h('b', null, e.error), h('small', null, e.count + ' получателей'))))) : null));
      } catch (e) { s.setBody(empty('Ошибка', e.message)); }
    }
    box.innerHTML = ''; drawSeg(); drawPhoto(); drawButtons();
    box.appendChild(segBox);
    box.appendChild(h('div', { class: 'card section-card' }, h('label', { class: 'field' }, h('span', null, 'Кому'), audSel), countEl, testBox, h('label', { class: 'field' }, h('span', null, 'Текст'), text), h('div', { class: 'field' }, h('span', null, 'Фото'), photoBox), h('div', { class: 'field' }, h('span', null, 'Кнопки под сообщением'), btnBox), btn));
    box.appendChild(histBox);
    loadCount(); loadHistory();
  }

  /* ------------------------------------------------------------- security (Безопасность) */
  async function securityView(shell) {
    const box = page(shell, 'Безопасность');
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const s = await api('/auth/sessions'); box.innerHTML = '';
        const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль' });
        const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'от 10 символов, буквы и цифра' });
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Смена пароля'), h('label', { class: 'field' }, h('span', null, 'Текущий пароль'), cur), h('label', { class: 'field' }, h('span', null, 'Новый пароль'), nw), h('button', { class: 'primary-btn', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/auth/password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } }); toast('Пароль изменён, остальные сессии завершены', 'ok', 4000); cur.value = nw.value = ''; draw(); } catch (ex) { err(ex); } e.target.disabled = false; } }, svg('lock', 16), 'Изменить пароль')));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Активные сессии'), s.items.length > 1 ? h('button', { class: 'outline-btn danger', onclick: async () => { if (await confirmDialog('Завершить все остальные сессии этого аккаунта?', 'Завершить', true)) { try { await api('/auth/sessions/revoke-others', { method: 'POST' }); toast('Готово', 'ok'); draw(); } catch (ex) { err(ex); } } } }, 'Завершить остальные') : null));
        s.items.forEach((x) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('span', { class: 'avatar mini' }, svg(x.current ? 'check' : 'user', 16)), h('div', null, h('b', null, (x.username ? x.username + ' · ' : '') + (x.ip || '—'), x.current ? ' (текущая)' : ''), h('small', null, (x.user_agent || '—').slice(0, 70)), h('small', null, 'создана ' + fmtDate(x.created_at) + ' · активна ' + ago(x.last_seen_at) + ' назад')), !x.current ? h('button', { class: 'outline-btn danger', onclick: async () => { try { await api('/auth/sessions/' + x.id + '/revoke', { method: 'POST' }); draw(); } catch (ex) { err(ex); } } }, 'Выйти') : h('span', { class: 'pill green' }, 'вы'))));
        if (can('admins')) {
          const a = await api('/auth/admins');
          box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Администраторы'), h('button', { class: 'outline-btn blue', onclick: addAdmin }, svg('plus', 14), 'Добавить')));
          const ROLES = [['viewer', 'Просмотр'], ['operator', 'Оператор'], ['admin', 'Администратор'], ['owner', 'Владелец']];
          a.items.forEach((ad) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default', alignItems: 'flex-start' } }, h('span', { class: 'avatar mini' }, (ad.username || '?').slice(0, 1).toUpperCase()), h('div', null, h('b', null, ad.username + (ad.name ? ' · ' + ad.name : '')), h('small', null, 'вход: ' + fmtDate(ad.last_login_at)), h('div', { class: 'tag-row' }, editable(ad.role, { options: ROLES, render: (v) => 'роль: ' + ((ROLES.find((r) => r[0] === v) || [v, v])[1]), save: (v) => api('/auth/admins/' + ad.id, { method: 'PATCH', body: { role: v } }) })), h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: async () => { const pw = await promptDialog('Новый пароль для ' + ad.username, 'Мин. 10 символов, разный регистр и цифра'); if (pw) { try { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { password: pw } }); toast('Пароль обновлён', 'ok'); } catch (ex) { err(ex); } } } }, 'Пароль'), h('button', { class: 'outline-btn', onclick: async () => { try { await api('/auth/admins/' + ad.id + '/logout-all', { method: 'POST' }); toast('Все сессии завершены', 'ok'); } catch (ex) { err(ex); } } }, 'Выйти везде'))), switchEl(ad.is_active, async (v) => { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { is_active: v } }); }))));
          function addAdmin() { const u = h('input', { class: 'input', placeholder: 'Логин (латиницей)', autocapitalize: 'none' }); const n = h('input', { class: 'input', placeholder: 'Имя (необязательно)' }); const p = h('input', { class: 'input', type: 'password', placeholder: 'Пароль (мин. 10 символов)' }); const role = h('select', { class: 'select' }, ROLES.map(([v, l]) => h('option', { value: v, selected: v === 'operator' }, l))); const sh = sheet({ title: 'Новый администратор', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Логин'), u), h('label', { class: 'field' }, h('span', null, 'Имя'), n), h('label', { class: 'field' }, h('span', null, 'Пароль'), p), h('label', { class: 'field' }, h('span', null, 'Роль'), role)), actions: [h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { await api('/auth/admins', { method: 'POST', body: { username: u.value.trim(), name: n.value.trim(), password: p.value, role: role.value } }); toast('Администратор создан', 'ok'); sh.close(); draw(); } catch (ex) { err(ex); } } }, 'Создать')] }); }
        }
        if (can('logs')) {
          const audit = await api('/logs?kind=audit&size=12');
          box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Последние действия'), h('button', { class: 'outline-btn', onclick: () => go('#/logs/audit') }, 'Все')));
          if (!audit.items.length) box.appendChild(empty('Записей нет', '', 'shield'));
          audit.items.forEach((l) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('span', { class: 'avatar mini' }, (l.actor || '?').slice(0, 1).toUpperCase()), h('div', null, h('b', null, l.actor + ' · ' + l.action), h('small', null, (l.entity_type ? l.entity_type + ' ' + (l.entity_id || '') + ' · ' : '') + (l.ip || ''))), h('span', { class: 'small muted' }, fmtDate(l.created_at)))));
        }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }


  /* ------------------------------------------------------------- quick replies (Быстрые ответы) — hold & drag to reorder */
  function dragList(list, opts) {
    let d = null, timer = null;
    const rows = () => Array.from(list.children).filter((r) => r.classList.contains('drag-row'));
    const begin = (row, y) => { clearTimeout(timer); const all = rows(); d = { row, y0: y, y, h: row.offsetHeight + 8, from: all.indexOf(row), to: all.indexOf(row) }; row.classList.add('lifting'); list.classList.add('dragging'); if (navigator.vibrate) navigator.vibrate(12); };
    const update = (y) => { if (!d) return; d.y = y; const dy = y - d.y0; d.row.style.transform = 'translateY(' + dy + 'px)'; const all = rows(); const idx = Math.max(0, Math.min(all.length - 1, d.from + Math.round(dy / d.h))); if (idx !== d.to) { d.to = idx; all.forEach((r, i) => { if (r === d.row) return; let shift = 0; if (d.from < idx && i > d.from && i <= idx) shift = -d.h; else if (d.from > idx && i >= idx && i < d.from) shift = d.h; r.style.transform = shift ? 'translateY(' + shift + 'px)' : ''; }); } };
    const finish = () => { clearTimeout(timer); if (!d) return; const { from, to, row } = d; d = null; rows().forEach((r) => { r.style.transform = ''; r.classList.remove('lifting'); }); list.classList.remove('dragging'); row.style.transform = ''; if (to !== from) opts.onReorder(from, to); };
    list.addEventListener('touchstart', (e) => { const row = e.target.closest('.drag-row'); if (!row || e.touches.length !== 1 || e.target.closest('button')) return; const y = e.touches[0].clientY; if (e.target.closest('.drag-handle')) { begin(row, y); return; } timer = setTimeout(() => begin(row, y), 320); }, { passive: true });
    list.addEventListener('touchmove', (e) => { if (!d) { clearTimeout(timer); return; } if (e.cancelable) e.preventDefault(); update(e.touches[0].clientY); }, { passive: false });
    list.addEventListener('touchend', finish); list.addEventListener('touchcancel', finish);
    list.addEventListener('mousedown', (e) => { const row = e.target.closest('.drag-row'); if (!row || e.target.closest('button')) return; if (e.target.closest('.drag-handle')) { begin(row, e.clientY); e.preventDefault(); return; } timer = setTimeout(() => begin(row, e.clientY), 320); });
    document.addEventListener('mousemove', (e) => { if (d) update(e.clientY); });
    document.addEventListener('mouseup', finish);
  }
  async function quickView(shell) {
    const box = page(shell, 'Быстрые ответы', { right: h('button', { class: 'header-btn primary-head', 'aria-label': 'Добавить', onclick: () => edit(null) }, svg('plus', 18)) });
    let items = [];
    const save = async () => { const r = await api('/quick-replies', { method: 'POST', body: { fields: { items } } }); items = r.items; state.quick = items; };
    const list = h('div', { class: 'drag-list' });
    const draw = () => {
      box.innerHTML = ''; list.innerHTML = ''; box.appendChild(list);
      if (!items.length) return box.appendChild(empty('Ответов нет', 'Нажмите «+»', 'bolt'));
      items.forEach((q, i) => list.appendChild(h('div', { class: 'card row-card drag-row' }, h('span', { class: 'drag-handle', 'aria-label': 'Переместить' }, svg('menu', 16)), h('div', { onclick: () => edit(i) }, h('b', null, q.title), h('small', { style: { whiteSpace: 'normal' } }, q.text)), h('button', { class: 'outline-btn danger', type: 'button', 'aria-label': 'Удалить', onclick: async () => { if (await confirmDialog('Удалить «' + q.title + '»?', 'Удалить', true)) { items.splice(i, 1); try { await save(); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 13)))));
    };
    dragList(list, { onReorder: async (from, to) => { const [m] = items.splice(from, 1); items.splice(to, 0, m); draw(); try { await save(); } catch (ex) { err(ex); } } });
    function edit(i) {
      const q = i === null ? { id: 'q' + Date.now().toString(36), title: '', text: '' } : Object.assign({}, items[i]);
      const title = h('input', { class: 'input', value: q.title, placeholder: 'Название' });
      const text = h('textarea', { class: 'textarea', placeholder: 'Текст ответа', style: { minHeight: '110px' } }, q.text);
      const sh = sheet({ title: i === null ? 'Новый ответ' : 'Изменить', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), title), h('label', { class: 'field' }, h('span', null, 'Текст'), text)), actions: [h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { if (!text.value.trim()) return toast('Введите текст', 'err'); q.title = title.value.trim() || text.value.trim().slice(0, 30); q.text = text.value.trim(); if (i === null) items.push(q); else items[i] = q; try { await save(); draw(); sh.close(); } catch (ex) { err(ex); } } }, 'Сохранить')] });
      setTimeout(() => (i === null ? title : text).focus(), 80);
    }
    try { const r = await api('/quick-replies'); items = r.items; state.quick = items; draw(); } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- logs (Логи) */
  function logsView(shell) {
    const box = page(shell, 'Логи');
    const st = { kind: state.route.id === 'audit' ? 'audit' : 'system', level: '', q: '', page: 1 };
    const list = h('div');
    const search = h('input', { class: 'input', placeholder: 'Поиск по логам', oninput: debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350) });
    const level = h('select', { class: 'select', onchange: (e) => { st.level = e.target.value; st.page = 1; load(); } }, [['', 'Все уровни'], ['info', 'Инфо'], ['warning', 'Предупреждения'], ['error,critical', 'Ошибки']].map(([v, l]) => h('option', { value: v }, l)));
    const segBox = h('div', { style: { marginBottom: '10px' } });
    const LEVEL = { info: 'blue', warning: 'amber', error: 'red', critical: 'red', debug: '' };
    async function load() {
      segBox.innerHTML = ''; segBox.appendChild(segEl([['system', 'События'], ['audit', 'Действия админов']], st.kind, (k) => { st.kind = k; st.page = 1; history.replaceState(null, '', '#/logs/' + k); load(); }, 'light'));
      level.style.display = st.kind === 'system' ? '' : 'none';
      list.innerHTML = ''; list.appendChild(loader(4));
      try {
        const r = await api('/logs?kind=' + st.kind + '&level=' + st.level + '&q=' + encodeURIComponent(st.q) + '&page=' + st.page + '&size=40');
        list.innerHTML = '';
        if (!r.items.length) return list.appendChild(empty('Записей нет', '', 'terminal'));
        const groups = groupByDay(r.items);
        list.appendChild(h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((l) => st.kind === 'system'
          ? h('div', { class: 'card row-card', style: { cursor: 'default', alignItems: 'flex-start' } }, h('span', { class: 'dot ' + (LEVEL[l.level] || '') }), h('div', null, h('b', null, l.title), h('small', { style: { whiteSpace: 'normal' } }, l.detail || ''), h('div', { class: 'tag-row' }, h('span', { class: 'pill ' + (LEVEL[l.level] || '') }, l.level), h('span', { class: 'pill' }, l.category), l.entity_type ? h('span', { class: 'pill' }, l.entity_type + ' ' + (l.entity_id || '')) : null)), h('span', { class: 'small muted' }, fmtTime(l.created_at)))
          : h('div', { class: 'card row-card', style: { cursor: 'default', alignItems: 'flex-start' } }, h('span', { class: 'avatar mini' }, (l.actor || '?').slice(0, 1).toUpperCase()), h('div', null, h('b', null, l.action), h('small', null, l.actor + ' · ' + (l.ip || '—') + (l.entity_type ? ' · ' + l.entity_type + ' ' + (l.entity_id || '') : '')), l.details && Object.keys(l.details).length ? h('small', { class: 'mono', style: { whiteSpace: 'normal' } }, JSON.stringify(l.details).slice(0, 180)) : null), h('span', { class: 'small muted' }, fmtTime(l.created_at)))))))));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; load(); }); if (p) list.appendChild(p);
      } catch (e) { list.innerHTML = ''; list.appendChild(empty('Ошибка', e.message)); }
    }
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'searchbar' }, svg('search', 16), search));
    box.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '8px' } }, level));
    box.appendChild(segBox); box.appendChild(list);
    load();
  }


  /* ------------------------------------------------------------- settings (Настройки) */
  const NOTIFY_GROUP = ['Уведомления', [['notify_new_deposit', 'Новое пополнение', 'bool'], ['notify_deposit_success', 'Пополнение зачислено', 'bool'], ['notify_deposit_failed', 'Ошибка пополнения', 'bool'], ['notify_new_withdrawal', 'Новый вывод', 'bool'], ['notify_withdrawal_status', 'Статус вывода', 'bool'], ['notify_cash_critical', 'Проблемы касс', 'bool'], ['notify_support_operator', 'Обращения оператору', 'bool']]];
  const ADVANCED_TABS = [
    ['bot', 'Бот', [
      ['Работа', [['bot_paused', 'Пауза бота', 'bool'], ['deposits_enabled', 'Пополнения', 'bool'], ['withdrawals_enabled', 'Выводы', 'bool']]],
      ['Оператор', [['support_username', 'Username оператора'], ['brand_name', 'Название']]],
      ['Кнопки', [['menu_deposit_label', 'Пополнить'], ['menu_withdraw_label', 'Вывести'], ['menu_help_label', 'Помощь'], ['button_styles_enabled', 'Цветные кнопки', 'bool'], ['premium_emoji_enabled', 'Premium-эмодзи', 'bool'], ['premium_only_emoji', 'Только premium (обычные эмодзи убирать)', 'bool']]],
      ['Premium-эмодзи: соответствия (эмодзи и ID, по одному в строке)', [['premium_emoji_map', 'Эмодзи → ID', 'textarea']]],
      ['Доступ', [['subscription_enabled', 'Подписка на канал', 'bool'], ['subscription_channel', 'Канал'], ['phone_required', 'Запрашивать телефон', 'bool']]],
    ]],
    ['texts', 'Тексты', [
      ['Главное меню', [['greeting_text', 'Приветствие', 'textarea'], ['text_help', 'Помощь', 'textarea'], ['text_paused', 'Бот на паузе'], ['text_blocked', 'Клиент заблокирован', 'textarea']]],
      ['Пополнение', [['text_choose_site_deposit', 'Выбор сайта'], ['text_enter_id_deposit', 'Введите ID', 'textarea'], ['text_enter_amount', 'Введите сумму', 'textarea'], ['text_pay_card', 'Подпись под QR', 'textarea'], ['text_send_receipt', 'Просьба прислать чек'], ['text_receipt_ok', 'Чек получен', 'textarea'], ['text_deposit_cancelled', 'Отменено / истекло', 'textarea'], ['text_deposit_success', 'Пополнено', 'textarea'], ['text_deposit_rejected', 'Отказано', 'textarea']]],
      ['Вывод', [['text_choose_site_withdraw', 'Выбор сайта'], ['text_send_qr', 'Отправьте QR'], ['text_enter_id_withdraw', 'Введите ID'], ['text_enter_code', 'Введите код'], ['text_bad_withdraw', 'Неверные данные'], ['text_withdraw_accepted', 'Заявка принята', 'textarea'], ['text_withdraw_problem', 'Сумма не получена', 'textarea'], ['text_withdraw_processing', 'В обработке'], ['text_withdraw_done', 'Выполнен', 'textarea'], ['text_withdraw_failed', 'Отказано', 'textarea']]],
      ['Проверка ID', [['text_id_not_found', 'ID не найден'], ['text_currency_mismatch', 'Валюта не совпадает', 'textarea']]],
    ]],
    ['withdraw', 'Выводы', [
      ['Адрес', [['withdraw_city', 'Город'], ['withdraw_address', 'Адрес'], ['withdraw_sla_text', 'Сроки']]],
      ['Инструкция', [['instruction_text', 'Текст', 'textarea']]],
      ['Правила', [['withdraw_receipt_min', 'Чек перевода обязателен от суммы (0 — никогда)', 'number'], ['withdraw_code_min_length', 'Мин. длина кода', 'number'], ['withdraw_processing_timeout_minutes', 'Таймаут обработки, мин', 'number']]],
    ]],
    ['deposit', 'Пополнения', [
      ['Заявка', [['payment_timeout_seconds', 'Время на оплату, сек', 'number'], ['deposit_max_active_per_user', 'Активных заявок на клиента', 'number'], ['deposit_presets', 'Кнопки сумм'], ['receipt_request_enabled', 'Просить чек', 'bool']]],
      ['Уникальная сумма', [['random_tiyin', 'Уникальные тыйыны', 'bool'], ['tiyin_min', 'Тыйын от', 'number'], ['tiyin_max', 'Тыйын до', 'number'], ['amount_reuse_cooldown_seconds', 'Не повторять сумму, сек', 'number'], ['payment_event_max_age_minutes', 'Ждать платёж после истечения, мин', 'number']]],
      ['Карточка QR', [['qr_card_title', 'Заголовок'], ['qr_card_subtitle', 'Подзаголовок'], ['qr_overlay_text', 'Надпись на QR'], ['qr_watermark_text', 'Водяной знак']]],
    ]],
    ['notify', 'Уведомления', [NOTIFY_GROUP, ['Кассы', [['cash_monitor_enabled', 'Автопроверка балансов', 'bool'], ['cash_monitor_interval_seconds', 'Интервал, сек', 'number']]]]],
    ['support', 'Поддержка', [['Claude', [['assistant_enabled', 'Первым отвечает Claude (ключ ANTHROPIC_API_KEY в .env)', 'bool']]], ['Автоответчик', [['support_greeting', 'Приветствие', 'textarea'], ['support_auto_resolve_hours', 'Автозакрытие, ч', 'number']]], ['Антифлуд', [['support_rate_limit_messages', 'Сообщений подряд', 'number'], ['support_rate_limit_window_seconds', 'За сколько сек', 'number'], ['support_cooldown_seconds', 'Пауза, сек', 'number'], ['support_duplicate_window_seconds', 'Окно повторов, сек', 'number'], ['support_escalation_cooldown_seconds', 'Пауза между вызовами оператора, сек', 'number']]]]],
    ['login', 'Вход', [['Подтверждение входа в основном боте', [['login_confirm_enabled', 'Спрашивать ✅ у владельца при каждом входе', 'bool'], ['login_approver_telegram_id', 'Telegram ID владельца (0 — из .env)', 'number']]]]],
  ];
  function settingsForm(box, groups, values, extraTop, extraBottom) {
    const inputs = {};
    box.innerHTML = '';
    if (extraTop) box.appendChild(extraTop);
    groups.forEach(([title, fields]) => {
      const card = h('div', { class: 'card section-card' }, h('h2', null, title));
      fields.forEach(([key, label, type, options]) => {
        if (!(key in values)) return;
        if (type === 'bool') { const hidden = h('input', { type: 'hidden', value: values[key] ? '1' : '0' }); inputs[key] = hidden; card.appendChild(h('div', { class: 'setting-row' }, h('div', null, h('b', null, label)), switchEl(!!values[key], async (v) => { hidden.value = v ? '1' : '0'; }), hidden)); return; }
        const el = type === 'select' ? h('select', { class: 'select' }, (options || []).map(([v, l]) => h('option', { value: v, selected: String(v) === String(values[key]) }, l))) : type === 'textarea' ? h('textarea', { class: 'textarea' }, values[key] === null || values[key] === undefined ? '' : String(values[key])) : h('input', { class: 'input', type: type || 'text', step: type === 'number' ? 'any' : undefined, inputmode: type === 'number' ? 'decimal' : undefined, value: values[key] === null || values[key] === undefined ? '' : values[key] });
        inputs[key] = el; card.appendChild(h('label', { class: 'field' }, h('span', null, label), el));
      });
      if (card.childNodes.length > 1) box.appendChild(card);
    });
    if (extraBottom) box.appendChild(extraBottom);
    if (Object.keys(inputs).length) box.appendChild(h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const payload = {}; for (const [k, el] of Object.entries(inputs)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; try { await api('/settings', { method: 'POST', body: { values: payload } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } busy(b, false); } }, svg('check', 16), 'Сохранить'));
    return inputs;
  }
  function settingPhoto(key, values, label) {
    const wrap = h('div', { class: 'card section-card' }); const draw = () => {
      wrap.innerHTML = ''; wrap.appendChild(h('h2', null, label)); const rel = values[key]; const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      input.onchange = async () => { if (!input.files[0]) return; const fd = new FormData(); fd.append('key', key); fd.append('file', input.files[0]); try { const rr = await api('/settings/photo', { method: 'POST', body: fd }); values[key] = rr.path; toast('Фото загружено', 'ok'); draw(); } catch (ex) { err(ex); } };
      wrap.appendChild(h('div', { class: 'photo-row' }, rel ? h('img', { class: 'photo-thumb', src: fileUrl('/' + rel), alt: '' }) : h('div', { class: 'photo-thumb blank' }, svg('image', 18)), h('div', { class: 'btn-row', style: { margin: 0 } }, h('button', { class: 'outline-btn blue', type: 'button', onclick: () => input.click() }, svg('image', 14), rel ? 'Заменить' : 'Загрузить'), rel ? h('button', { class: 'outline-btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Удалить фото?', 'Удалить', true)) { try { await api('/settings/photo/' + key, { method: 'DELETE' }); values[key] = ''; draw(); } catch (ex) { err(ex); } } } }, svg('trash', 13)) : null, input)));
    }; draw(); return wrap;
  }
  const MORE_LINKS = [['#/wallets', 'qr', 'Кошельки', 'QR и реквизиты для приёма'], ['#/macrodroid', 'bolt', 'MacroDroid', 'Подтверждения платежей'], ['#/cashes', 'wallet', 'Кассы', 'Данные и фото шагов'], ['#/push', 'bell', 'Push', 'Уведомления на телефон'], ['#/security', 'shield', 'Безопасность', 'Пароль и администраторы'], ['#/env', 'terminal', 'Сервер', 'Домен, боты, SMTP']];
  async function settingsView(shell) {
    /* only what operators switch every day: pause, ПП/ВВ, cash desks, banks under the QR */
    if (state.route.id === 'advanced') return advancedSettingsView(shell, state.route.sub);
    const box = page(shell, 'Настройки');
    const row = (label, sub, ctl) => h('div', { class: 'setting-row' }, h('div', null, h('b', null, label), sub ? h('small', null, sub) : null), ctl);
    const draw = async () => {
      try {
        const [r, cashes, banks] = await Promise.all([api('/settings'), api('/cashes'), api('/bank-links').catch(() => ({ items: [] }))]);
        const v = r.values; box.innerHTML = '';
        const save = async (key, val) => { await api('/settings', { method: 'POST', body: { values: { [key]: val } } }); v[key] = val; toast('Сохранено', 'ok', 1200); };
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Работа'),
          row('Пауза бота', 'Клиенты видят «Бот временно выключен»', switchEl(!!v.bot_paused, (on) => save('bot_paused', on))),
          row('Пополнения', 'Кнопка «Пополнить» во всех кассах', switchEl(!!v.deposits_enabled, (on) => save('deposits_enabled', on))),
          row('Выводы', 'Кнопка «Вывести» во всех кассах', switchEl(!!v.withdrawals_enabled, (on) => save('withdrawals_enabled', on)))));
        const cashCard = h('div', { class: 'card section-card' }, h('h2', null, 'Кассы'));
        if (!cashes.items.length) cashCard.appendChild(h('small', { class: 'muted' }, 'Касс нет — добавьте в разделе «Кассы»'));
        cashes.items.forEach((c) => { const patch = (body) => api('/cashes/' + c.id, { method: 'PATCH', body }).then(() => toast('Сохранено', 'ok', 1200)); cashCard.appendChild(h('div', { class: 'cash-toggles' }, h('div', { class: 'cash-toggles-name' }, h('b', null, c.name), h('small', null, (c.provider_label || c.provider_type) + (c.auto_disabled ? ' · автостоп' : ''))), h('label', null, h('span', null, 'Вкл'), switchEl(!!c.enabled, (on) => patch({ enabled: on }))), h('label', null, h('span', null, 'ПП'), switchEl(!!c.deposit_enabled, (on) => patch({ deposit_enabled: on }))), h('label', null, h('span', null, 'ВВ'), switchEl(!!c.withdraw_enabled, (on) => patch({ withdraw_enabled: on }))))); });
        box.appendChild(cashCard);
        const bankCard = h('div', { class: 'card section-card' }, h('h2', null, 'Банки под QR'));
        if (!banks.items.length) bankCard.appendChild(h('small', { class: 'muted' }, 'Кнопок банков нет'));
        banks.items.forEach((l) => bankCard.appendChild(row((l.emoji ? l.emoji + ' ' : '') + l.name, l.kind === 'qr' ? 'картинка QR в заявке' : 'кнопка-ссылка под QR', switchEl(!!l.enabled, async (on) => { await api('/bank-links', { method: 'POST', body: { key: l.key, enabled: on } }); toast('Сохранено', 'ok', 1200); }))));
        box.appendChild(bankCard);
        const links = MORE_LINKS.slice();
        if (state.admin && state.admin.role === 'owner') links.unshift(['#/settings/advanced/bot', 'settings', 'Расширенные настройки', 'Тексты, эмодзи, поддержка, вход, уведомления']);
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Ещё')));
        links.forEach(([href, icon, title, sub]) => box.appendChild(h('button', { class: 'card row-card', onclick: () => go(href) }, h('span', { class: 'avatar mini' }, svg(icon, 16)), h('div', null, h('b', null, title), h('small', null, sub)), svg('chevron', 16))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }
  async function advancedSettingsView(shell, forcedTab) {
    const tab0 = forcedTab || 'bot';
    const box = page(shell, 'Расширенные настройки', { back: () => go('#/settings') });
    try {
      const r = await api('/settings'); const values = r.values;
      const tabsBar = h('div', { class: 'settings-tabs' }); const body = h('div');
      const drawTab = (key) => {
        tabsBar.innerHTML = ''; ADVANCED_TABS.forEach(([k, label]) => tabsBar.appendChild(h('button', { class: k === key ? 'active' : '', onclick: () => { history.replaceState(null, '', '#/settings/advanced/' + k); state.route.sub = k; drawTab(k); } }, label)));
        const tab = ADVANCED_TABS.find((t) => t[0] === key) || ADVANCED_TABS[0];
        let top = null, bottom = null;
        if (tab[0] === 'bot') bottom = h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'outline-btn blue', onclick: async (e) => { const chat = await promptDialog('Проверить premium-эмодзи', 'Ваш Telegram ID (сначала напишите боту /start)', '700100200'); if (chat === null) return; const b = e.currentTarget; busy(b, true); try { const rr = await api('/settings/premium-test', { method: 'POST', body: { chat_id: chat.trim() || null } }); if (rr.sent) toast('Отправлено — проверьте чат с ботом', 'ok', 5000); else toast('Telegram отказал: ' + rr.description + (rr.hint ? ' — ' + rr.hint : ''), 'err', 10000); } catch (ex) { err(ex); } busy(b, false); } }, svg('bolt', 14), 'Проверить premium-эмодзи'));
        if (tab[0] === 'texts') top = h('div', { class: 'card section-card' }, h('div', { class: 'placeholder-list' }, ['{name}', '{support}', '{brand}', '{cash}', '{emoji}', '{player}', '{amount}', '{cur}', '{min}', '{max}', '{minutes}', '{left}', '{reason}', '{sla}', '{city}', '{address}'].map((x) => h('code', null, x)), h('code', null, '[emoji:ID:😎]')), h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: async () => { if (await confirmDialog('Вернуть стандартные тексты? Ваши правки будут удалены.', 'Сбросить', true)) { try { const rr = await api('/settings/reset', { method: 'POST', body: { keys: ['texts'] } }); Object.assign(values, rr.values); toast('Тексты сброшены', 'ok'); drawTab('texts'); } catch (ex) { err(ex); } } } }, svg('refresh', 14), 'Сбросить тексты')));
        if (tab[0] === 'withdraw') bottom = settingPhoto('instruction_photo', values, 'Фото инструкции');
        if (tab[0] === 'support') top = h('div', { class: 'card section-card' }, h('h2', null, 'Claude в поддержке'), h('small', { class: 'muted' }, r.env && r.env.assistant_configured ? 'Ключ задан — на вопросы клиентов первым отвечает Claude, сложное передаёт оператору' : 'Ключа нет: добавьте ANTHROPIC_API_KEY в /home/PayGo/.env и перезапустите paygo-support'));
        settingsForm(body, tab[2], values, top, bottom);
      };
      box.innerHTML = ''; box.appendChild(tabsBar); box.appendChild(body);
      drawTab(ADVANCED_TABS.some((t) => t[0] === tab0) ? tab0 : 'bot');
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- push */
  function urlB64ToUint8(b64) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function pushView(shell) {
    const box = page(shell, 'Push-уведомления', { back: () => go('#/settings/more') });
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader(2));
      try {
        const r = await api('/push/config'); box.innerHTML = '';
        const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        let subscribed = false; try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); subscribed = !!(reg && (await reg.pushManager.getSubscription())); } catch (e) { /* ignore */ }
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Состояние'), kv([['Сервер', r.enabled ? h('span', { class: 'pill green' }, 'готов') : h('span', { class: 'pill red' }, 'нет ключей в .env')], ['Браузер', supported ? h('span', { class: 'pill green' }, 'поддерживает') : h('span', { class: 'pill red' }, 'не поддерживает')], ['Это устройство', subscribed ? h('span', { class: 'pill green' }, 'подписано') : h('span', { class: 'pill' }, 'не подписано')], ['Устройств', r.subscriptions]])));
        box.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'primary-btn', disabled: !supported || !r.enabled, onclick: async () => { try { const reg = await navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }); const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Уведомления запрещены в браузере', 'err'); const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(r.public_key) }); await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); toast('Подписка включена на этом устройстве', 'ok'); draw(); } catch (ex) { err(ex); } } }, svg('bell', 16), 'Включить здесь'),
          h('button', { class: 'outline-btn blue', onclick: async () => { try { await api('/push/test', { method: 'POST' }); toast('Тест отправлен', 'ok'); } catch (ex) { err(ex); } } }, 'Тест'),
          h('button', { class: 'outline-btn', disabled: !supported, onclick: async () => { try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await api('/push/unsubscribe', { method: 'POST', body: sub.toJSON() }); await sub.unsubscribe(); } toast('Отключено', 'ok'); draw(); } catch (ex) { err(ex); } } }, 'Отключить')));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- env (Окружение) */
  async function envView(shell) {
    const box = page(shell, 'Сервер', { back: () => go('#/settings/more') });
    try {
      const r = await api('/settings'); const e = r.env; box.innerHTML = '';
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Сервер'), kv([['Адрес панели', e.public_url + e.base_path + '/'], ['База данных', e.database], ['Часовой пояс', e.timezone]])));
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Интеграции'), kv([['Основной бот', e.main_bot ? '@' + e.main_bot : '—'], ['Бот поддержки', e.support_bot ? '@' + e.support_bot : '—'], ['Чаты админов', (e.admin_chat_ids || []).join(', ') || '—'], ['SMTP', e.smtp_configured ? e.smtp_host : 'нет'], ['Почта как источник платежей', e.imap_enabled ? 'да' : 'нет'], ['Push', e.push_configured ? 'настроен' : 'нет']])));
    } catch (ex) { box.innerHTML = ''; box.appendChild(empty('Ошибка', ex.message)); }
  }

  /* ------------------------------------------------------------- boot */
  (async function boot() {
    state.route = parseHash();
    try { const r = await api('/auth/me'); state.admin = r.admin; startLive(); } catch (e) { state.admin = null; }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(() => {});
  })();
})();
