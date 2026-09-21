/* PayGo Admin SPA — phone-first panel (Главная / История / Чат / Поиск / Меню). No build step.
   Layout and sizes follow the reference screenshots 1:1; a request opens as its own page. */
(function () {
  'use strict';
  const BASE = location.pathname.replace(/\/[^/]*$/, '') || '';
  const API = BASE + '/api';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const state = { admin: null, route: { page: 'home', id: null, sub: null }, live: null, poll: null, lastNotifId: 0, cashes: [], types: [], quick: [], homeTab: 'actual', historyTab: 'all', historyFilters: {}, chatTab: 'open', chatQuery: '', searchQuery: '', searchMode: 'player' };
  const ICON = { home: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z', history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2', chat: 'M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z', search: 'M11 19a8 8 0 1 1 5.66-2.34L22 22', menu: 'M4 6h16M4 12h16M4 18h16', back: 'M19 12H5M11 18l-6-6 6-6', copy: 'M9 9h10v10H9zM5 15H4V5h10v1', check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M18 6 6 18', user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', more: 'M12 5h.01M12 12h.01M12 19h.01', stats: 'M5 20V10M12 20V4M19 20v-7M3 20h18', wallet: 'M4 7h15v12H4zM4 7l2-3h11l2 3M15 12h4v3h-4z', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5', settings: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5ZM19 12l2-1-1-3-2 .2-1.4-1.4.2-2-3-1-1 2-2 0-1-2-3 1 .2 2L6.2 8.2 4 8l-1 3 2 1v2l-2 1 1 3 2.2-.2L7.8 19l-.2 2 3 1 1-2h2l1 2 3-1-.2-2 1.4-1.4 2 .2 1-3-2-1Z', plus: 'M12 5v14M5 12h14', chevron: 'M9 6l6 6-6 6', send: 'M22 2 11 13M22 2l-7 20-4-9-9-4Z', image: 'M4 4h16v16H4zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 18l4.5-4.5 3 3 2-2L19 18', trash: 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5', refresh: 'M20 6v5h-5M4 18v-5h5M6.1 8A7 7 0 0 1 18 6l2 5M18 16a7 7 0 0 1-12 2l-2-5', logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9', note: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM8 2v4M16 2v4M3 9h18', shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-5', filter: 'M4 5h16l-6 7v6l-4 2v-8Z', edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4', bank: 'M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3l9-5Z', bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z', alert: 'M12 9v4M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', arrowDL: 'M17 7 7 17M7 8v9h9', arrowUR: 'M7 17 17 7M8 7h9v9', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', upload: 'M12 16V4M6 10l6-6 6 6M4 20h16', download: 'M12 4v12M6 10l6 6 6-6M4 20h16', doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6', hash: 'M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 12l10 5 10-5M2 17l10 5 10-5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', flask: 'M9 3h6M10 3v6L4 20h16l-6-11V3', save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2', paperclip: 'M21 12 12 21a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8-8', printer: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z', timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10v4M9 2h6', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', moon: 'M21 13A8 8 0 1 1 11 3a6 6 0 0 0 10 10Z', card: 'M3 6h18v12H3zM3 10h18M7 15h3' };

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
  function svg(name, size) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'icon'); s.setAttribute('width', size || 22); s.setAttribute('height', size || 22); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[name] || ICON.menu); s.appendChild(p); return s; }
  const money = (v) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
  const money0 = (v) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v) || 0);
  const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); if (isNaN(d)) return String(v); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const fmtTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const ago = (v) => { if (!v) return ''; const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000); if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин'; if (s < 86400) return Math.floor(s / 3600) + ' ч'; return Math.floor(s / 86400) + ' дн'; };
  const MONTHS = ['ЯНВАРЯ', 'ФЕВРАЛЯ', 'МАРТА', 'АПРЕЛЯ', 'МАЯ', 'ИЮНЯ', 'ИЮЛЯ', 'АВГУСТА', 'СЕНТЯБРЯ', 'ОКТЯБРЯ', 'НОЯБРЯ', 'ДЕКАБРЯ'];
  const MONTHS_L = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function dayKey(v) { const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(key) { const p = key.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + (p[0] !== String(new Date().getFullYear()) ? ' ' + p[0] : ''); }
  function groupByDay(list) { const map = {}, order = []; list.forEach((x) => { const k = dayKey(x.created_at); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(x); }); return order.map((k) => ({ key: k, label: dayLabel(k), items: map[k] })); }
  const msgStamp = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS_L[d.getMonth()] + ' ' + fmtTime(d); };
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
  function toast(text, kind, ms) { const ic = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : kind === 'crit' ? 'bolt' : 'bell'; const el = h('div', { class: 'toast ' + (kind || '') }, h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => el.remove() }, svg('close', 14)), h('span', { class: 'toast-ico' }, svg(ic, 15)), h('span', { class: 'toast-msg' }, text)); $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, ms || (kind === 'err' ? 4200 : 2400)); return el; }
  const err = (e) => toast(e && e.message ? e.message : String(e), 'err');
  function copy(text) { navigator.clipboard && navigator.clipboard.writeText(String(text)).then(() => toast('Скопировано', 'ok', 1200)).catch(() => {}); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function confirmDialog(text, okLabel, danger) { return new Promise((resolve) => { const s = sheet({ title: 'Подтверждение', body: h('p', { style: { margin: '4px 0 8px', fontSize: '17px', lineHeight: '1.4' } }, text), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(false); } }, 'Отмена'), h('button', { class: 'action-btn ' + (danger ? 'danger' : 'primary'), onclick: () => { s.close(); resolve(true); } }, okLabel || 'Да')] }); }); }
  function promptDialog(title, label, placeholder, value) { return new Promise((resolve) => { const input = h('textarea', { class: 'textarea', placeholder: placeholder || '' }, value || ''); const s = sheet({ title, body: h('label', { class: 'field' }, h('span', null, label || ''), input), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(null); } }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { s.close(); resolve(input.value.trim()); } }, 'Продолжить')] }); setTimeout(() => input.focus(), 60); }); }

  /* ------------------------------------------------------------- theme: light / dark (Telegram-like grey) */
  function themeName() { try { return localStorage.getItem('paygo_theme') === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } }
  function applyTheme(name) {
    const dark = name === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('paygo_theme', dark ? 'dark' : 'light'); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', dark ? '#141414' : '#f4f5f8');
  }

  /* ------------------------------------------------------------- sheet (bottom modal) — drag down to close, drag up to expand */
  function sheet(opts) {
    const root = $('#modal-root');
    const titleNode = h('h2', null, typeof opts.title === 'string' || typeof opts.title === 'number' ? String(opts.title) : (opts.title || ''));
    const grab = h('div', { class: 'sheet-grab' });
    const head = h('div', { class: 'sheet-head' }, titleNode, h('button', { class: 'close', 'aria-label': 'Закрыть', onclick: () => api_.close() }, svg('close', 18)));
    const bodyEl = h('div', { class: 'sheet-body' }, opts.body);
    const box = h('div', { class: 'sheet' + (opts.full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true' }, grab, head, bodyEl, opts.actions && opts.actions.length ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null);
    const openedAt = Date.now();
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back && Date.now() - openedAt > 450) api_.close(); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') api_.close(); };
    if (opts.guardMs) box.addEventListener('click', (e) => { if (Date.now() - openedAt < opts.guardMs) { e.stopPropagation(); e.preventDefault(); } }, true);
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
      if (!drag.moved) { if (Math.abs(dy) < 6) return; if (drag.fromBody && (bodyEl.scrollTop > 0 || dy < 0)) { drag.dead = true; box.style.transition = ''; return; } drag.moved = true; }
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
    [grab, head].forEach((el) => {
      el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (x) {} } start(e.clientY, false); });
      el.addEventListener('pointermove', (e) => { if (drag && !drag.fromBody) move(e.clientY, e); });
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    });
    bodyEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && !drag) start(e.touches[0].clientY, true); }, { passive: true });
    bodyEl.addEventListener('touchmove', (e) => { if (drag && drag.fromBody) move(e.touches[0].clientY, e); }, { passive: false });
    bodyEl.addEventListener('touchend', () => { if (drag && drag.fromBody) end(); }); bodyEl.addEventListener('touchcancel', () => { if (drag && drag.fromBody) end(); });
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(back);
    return api_;
  }
  function closeSheets() { document.querySelectorAll('.sheet-back').forEach((el) => el.remove()); document.body.style.overflow = ''; closeDropdown(); }
  function imageSheet(title, src, caption) { sheet({ title, full: true, body: h('div', { class: 'img-sheet' }, h('img', { src, alt: '' }), caption ? h('small', null, caption) : null) }); }
  function actionSheet(title, items) { const s = sheet({ title, guardMs: 420, body: h('div', { class: 'menu-list' }, items.filter(Boolean).map((it) => h('button', { class: 'menu-item ' + (it.cls || ''), onclick: () => { s.close(); it.onclick(); } }, it.icon ? svg(it.icon, 20) : null, it.label))) }); return s; }
  /* the «⋮» dropdown of the reference: a small card under the button */
  let openDrop = null;
  function closeDropdown() { if (openDrop) { openDrop.remove(); openDrop = null; document.removeEventListener('pointerdown', onDocDown, true); } }
  function onDocDown(e) { if (openDrop && !openDrop.contains(e.target)) closeDropdown(); }
  function dropdown(anchor, items) {
    closeDropdown();
    const menu = h('div', { class: 'dropdown' }, items.filter(Boolean).map((it) => h('button', { class: it.cls || '', type: 'button', disabled: !!it.disabled, onclick: (e) => { e.stopPropagation(); closeDropdown(); it.onclick(); } }, it.icon ? svg(it.icon, 22) : null, it.label)));
    anchor.appendChild(menu); openDrop = menu;
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
    return menu;
  }

  /* ------------------------------------------------------------- components */
  const STATUS = { created: ['Ожидает', 'pending'], processing: ['В обработке', 'blue'], success: ['Успешно', 'success'], failed: ['Проблема', 'problem'], cancelled: ['Отменено', 'rejected'], expired: ['Истекло', 'rejected'], auto: ['Авто', ''], waiting_operator: ['Ждёт оператора', 'problem'], operator: ['У оператора', 'blue'], resolved: ['Закрыто', 'success'], closed: ['Закрыто', 'rejected'], online: ['Онлайн', 'success'], error: ['Ошибка', 'problem'], low: ['Мало средств', 'pending'], disabled: ['Отключена', 'rejected'], auto_disabled: ['Автостоп', 'problem'], unknown: ['Не проверена', ''] };
  function statusEl(status, label) { const m = STATUS[status] || [status, '']; return h('span', { class: 'status ' + m[1] }, h('i'), label || m[0]); }
  function txState(tx) { const problem = tx.needs_attention && tx.status !== 'success'; return { cls: problem ? 'problem' : ((STATUS[tx.status] || ['', ''])[1] || ''), label: problem ? 'Проблема' : (tx.status_label || (STATUS[tx.status] || [tx.status])[0]) }; }
  function stateEl(tx) { const s = txState(tx); return h('span', { class: 'tx-state ' + s.cls }, h('i'), s.label); }
  function statusPill(tx) { const s = txState(tx); return h('span', { class: 'status-pill ' + s.cls }, h('i'), s.label); }
  function switchEl(on, onChange) { const b = h('button', { class: 'switch ' + (on ? 'on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false' }, h('i')); b.onclick = async () => { b.disabled = true; try { await onChange(!b.classList.contains('on')); b.classList.toggle('on'); } catch (e) { if (!e || e.message !== '__cancel__') err(e); } b.disabled = false; }; return b; }
  function art(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, ...kids) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); kids.forEach((c) => n.appendChild(c)); return n; };
    const root = el('svg', { viewBox: '0 0 120 90', class: 'art art-' + kind, width: '150', height: '112', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (kind === 'home') { root.appendChild(el('circle', { cx: 60, cy: 45, r: 30, class: 'ring ring1' })); root.appendChild(el('circle', { cx: 60, cy: 45, r: 30, class: 'ring ring2' })); root.appendChild(el('circle', { cx: 60, cy: 45, r: 22, class: 'disc' })); root.appendChild(el('path', { d: 'M48 46l8 8 16-17', class: 'check' })); return root; }
    if (kind === 'chat') { root.appendChild(el('path', { d: 'M22 30h44a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H40l-12 9v-9h-6a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z', class: 'bubble b1' })); root.appendChild(el('path', { d: 'M62 18h36a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-6v8l-10-8H62a7 7 0 0 1-7-7V25a7 7 0 0 1 7-7z', class: 'bubble b2' })); [[36, 45], [46, 45], [56, 45]].forEach(([x, y], i) => root.appendChild(el('circle', { cx: x, cy: y, r: 3, class: 'dot d' + (i + 1) }))); return root; }
    if (kind === 'search') { root.appendChild(el('circle', { cx: 52, cy: 40, r: 20, class: 'lens' })); root.appendChild(el('path', { d: 'M67 55l16 16', class: 'handle' })); root.appendChild(el('path', { d: 'M40 40a12 12 0 0 1 12-12', class: 'shine' })); return root; }
    if (kind === 'bell') { root.appendChild(el('g', { class: 'bell' }, el('path', { d: 'M60 20c-11 0-18 8-18 18v12l-6 8h48l-6-8V38c0-10-7-18-18-18z', class: 'body' }), el('path', { d: 'M54 62a6 6 0 0 0 12 0', class: 'clapper' }))); root.appendChild(el('circle', { cx: 78, cy: 26, r: 5, class: 'badge' })); return root; }
    [[-16, 0, 'c1'], [0, -6, 'c2'], [16, 4, 'c3']].forEach(([dx, dy, cls]) => root.appendChild(el('g', { class: 'card ' + cls, transform: 'translate(' + dx + ' ' + dy + ')' }, el('rect', { x: 34, y: 22, width: 52, height: 40, rx: 8, class: 'paper' }), el('rect', { x: 42, y: 32, width: 22, height: 4, rx: 2, class: 'line' }), el('rect', { x: 42, y: 41, width: 34, height: 4, rx: 2, class: 'line' }), el('rect', { x: 42, y: 50, width: 16, height: 4, rx: 2, class: 'line' }))));
    root.appendChild(el('circle', { cx: 22, cy: 26, r: 3, class: 'spark s1' })); root.appendChild(el('circle', { cx: 100, cy: 68, r: 2.5, class: 'spark s2' }));
    return root;
  }
  function empty(title, text, icon) { return h('div', { class: 'empty' }, art(icon || 'history'), h('b', null, title || 'Пока пусто'), text ? h('span', null, text) : null); }
  function loader(n) { return h('div', null, Array.from({ length: n || 3 }).map(() => h('div', { class: 'sk' }, h('i', { class: 'a' }), h('div', null, h('i', { class: 'l1' }), h('i', { class: 'l2' }), h('i', { class: 'l3' })), h('div', null, h('i', { class: 'r1' }), h('i', { class: 'r2' }), h('i', { class: 'r3' }))))); }
  function backTo(fallback) { return () => (history.length > 1 ? history.back() : go(fallback || '#/home')); }
  function topbar(title, opts) { opts = opts || {}; return h('header', { class: 'topbar' + (opts.plain ? ' plain' : '') }, opts.back === false ? h('span', { class: 'icon-btn spacer' }) : h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: typeof opts.back === 'function' ? opts.back : backTo('#/menu') }, svg('back', 24)), h('h1', null, title), opts.right || h('span', { class: 'icon-btn spacer' })); }
  function hero(title, sub, opts) { opts = opts || {}; return h('div', { class: 'hero' }, opts.back ? h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: opts.back }, svg('back', 24)) : null, opts.icon ? h('span', { class: 'ico' }, svg(opts.icon, 26)) : null, h('div', null, h('b', null, title), sub ? h('small', null, sub) : null), opts.tools ? h('div', { class: 'tools' }, ...opts.tools) : null); }
  function segEl(items, active, onSelect, cls) { return h('div', { class: 'seg ' + (cls || '') }, items.map(([key, label, count]) => h('button', { class: key === active ? 'active' : '', type: 'button', onclick: () => onSelect(key) }, label, count !== undefined && count !== null && Number(count) > 0 ? h('i', { class: key === active ? '' : 'red' }, count) : null))); }
  function kv(rows) { return h('dl', { class: 'kv-dl' }, rows.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === undefined || v === null || v === '' ? '—' : v)])); }
  function timeline(items) { if (!items || !items.length) return h('div', { class: 'muted small' }, 'История пуста'); return h('ul', { class: 'timeline' }, items.map((it) => h('li', { class: it.level || '' }, h('time', null, fmtDate(it.at)), h('div', null, it.title), it.detail ? h('div', { class: 'muted small' }, it.detail) : null))); }
  function pager(page, size, total, go_) { const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return null; return h('div', { class: 'pager' }, h('button', { class: 'outline-btn', disabled: page <= 1, onclick: () => go_(page - 1) }, '‹'), h('span', { class: 'muted' }, page + ' / ' + pages), h('button', { class: 'outline-btn', disabled: page >= pages, onclick: () => go_(page + 1) }, '›')); }
  function editable(value, opts) {
    const wrap = h('span', { class: 'editable' });
    const show = () => { wrap.innerHTML = ''; wrap.appendChild(h('span', null, opts.render ? opts.render(value) : (value === '' || value === null || value === undefined ? '—' : String(value)))); if (!opts.readonly) wrap.appendChild(h('button', { class: 'pen', title: 'Изменить', onclick: edit }, svg('edit', 14))); };
    const edit = () => { const input = opts.options ? h('select', { class: 'select' }, opts.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))) : h('input', { class: 'input', value: value === null || value === undefined ? '' : value, type: opts.type || 'text' }); const save = async () => { try { const v = input.value; const res = await opts.save(v); value = res === undefined || res === null ? v : res; toast('Сохранено', 'ok', 1300); show(); } catch (e) { err(e); } }; wrap.innerHTML = ''; wrap.appendChild(h('span', { class: 'inline' }, input, h('button', { class: 'outline-btn blue', onclick: save }, '✓'), h('button', { class: 'outline-btn', onclick: show }, '✕'))); input.focus(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') show(); }); };
    show(); return wrap;
  }
  const curSign = (c) => (!c || c === 'KGS' ? 'с' : c);
  const som = (v, c) => money(v) + ' ' + curSign(c);
  /* bank marks (official ones from the Finik QR page); the backend sends {key,name,logo} — the panel also recognises a bank from free text (wallets) */
  const BANKS = [['mbank', 'MBank', ['mbank', 'mbusiness']], ['optima', 'Optima Bank', ['optima']], ['bakai', 'Bakai Bank', ['bakai']], ['dengi', 'О!Деньги', ['dengi', 'o.kg', 'odengi', 'o!', 'о!деньги']], ['balance', 'Balance', ['balance']], ['megapay', 'MegaPay', ['megapay', 'mega']], ['demir', 'Demir Bank', ['demir', 'dcard']], ['kompanion', 'Компаньон', ['companion', 'kompanion', 'компаньон']], ['finik', 'Finik', ['finik']], ['rsk', 'РСК Банк', ['rsk', 'рск']], ['eldik', 'Элдик Банк', ['eldik', 'элдик']], ['kicb', 'KICB', ['kicb']], ['aiyl', 'Айыл Банк', ['aiyl', 'ayil', 'айыл']], ['nambaone', 'Namba One', ['namba']], ['simbank', 'Simbank', ['simbank']], ['dantepay', 'DantePay', ['dantepay']], ['elcart', 'Элкарт', ['elcart', 'payqr', 'elqr']]];
  const WITHDRAW_BANKS = [['mbank', 'MBank'], ['optima', 'Optima'], ['bakai', 'Bakai'], ['dengi', 'О!Деньги'], ['balance', 'Balance'], ['megapay', 'MegaPay'], ['demir', 'Demir'], ['kompanion', 'Компаньон'], ['finik', 'Finik'], ['rsk', 'РСК'], ['eldik', 'Элдик'], ['kicb', 'KICB'], ['aiyl', 'Айыл Банк'], ['elcart', 'Элкарт']];
  function bankOf(text) { const t = String(text || '').toLowerCase(); for (const [key, name, needles] of BANKS) if (needles.some((n) => t.includes(n))) return { key, name, logo: 'brand/banks/' + key + '.png' }; return { key: 'bank', name: '', logo: 'brand/banks/bank.png' }; }
  function bankLogo(bank) { const src = (bank && bank.logo) || 'brand/banks/bank.png'; return h('img', { src, alt: '', loading: 'lazy', onerror: function () { this.onerror = null; this.src = 'brand/banks/bank.png'; } }); }
  function avatarClass(name) { let s = 0; for (const ch of String(name || '')) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return 'g' + (s % 6); }
  function avatarEl(name, url, cls) { const n = String(name || '').trim() || '?'; const initial = n.charAt(0).toUpperCase(); return h('span', { class: 'avatar ' + avatarClass(n) + (cls ? ' ' + cls : '') }, url ? h('img', { src: fileUrl(url), alt: '', loading: 'lazy', onerror: function () { this.replaceWith(document.createTextNode(initial)); } }) : initial); }
  const clientName = (tx) => (tx.player_name && tx.player_name.trim()) || tx.user_name || 'Клиент';
  const txHref = (tx) => '#/' + (tx.kind === 'deposit' ? 'deposit' : 'withdrawal') + '/' + tx.id;
  function txCard(tx, opts) {
    opts = opts || {};
    const dep = tx.kind === 'deposit';
    const problem = tx.status === 'failed' || (tx.needs_attention && tx.status !== 'success');
    const pay = tx.payment;
    const chip = tx.status === 'success' && (tx.source === 'auto' || (dep && tx.payment_source && tx.payment_source !== 'manual')) ? 'Авто' : (tx.operator_name && tx.status !== 'created' ? tx.operator_name : '');
    const card = h('button', { class: 'tx-card', type: 'button', onclick: () => go(txHref(tx)) },
      h('span', { class: 'tx-logo-wrap' }, h('span', { class: 'tx-logo' }, bankLogo(tx.bank)), h('i', { class: 'tx-flow ' + (dep ? 'deposit' : 'withdraw') }, svg(dep ? 'arrowDL' : 'arrowUR', 12))),
      h('span', { class: 'tx-copy' }, h('b', null, h('span', { class: 'nm' }, clientName(tx)), chip ? h('span', { class: 'tx-chip' }, chip) : null), h('small', null, fmtDate(tx.created_at) + ' • ID ' + tx.player_id)),
      h('span', { class: 'tx-side' }, h('strong', { class: 'tx-amount ' + (dep ? 'deposit' : 'withdraw') }, (dep ? '+ ' : '− ') + som(dep ? tx.pay_amount : tx.amount, tx.currency)), stateEl(tx)),
      pay ? h('span', { class: 'tx-pay ' + pay.kind }, svg(pay.kind === 'matched' ? 'check' : 'bolt', 13), (pay.kind === 'matched' ? 'Платёж получен · ' : 'Есть платёж на эту сумму · ') + srcLabel(pay.source) + ' · ' + fmtTime(pay.received_at) + ' · ' + money(pay.amount)) : null);
    if (!problem || opts.noAlert) return card;
    return h('div', null, card, h('div', { class: 'tx-attn' }, h('b', null, dep ? 'Надо пополнить: деньги пришли, букмекер не зачислил' : 'Нужна проверка: касса не подтвердила сумму вывода'), h('small', null, tx.error || 'Откройте заявку и повторите операцию.')));
  }
  function txGroups(list, opts) { opts = opts || {}; const groups = groupByDay(list); return h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((tx, i) => { const card = txCard(tx, opts); card.style.setProperty('--i', Math.min(i, 10)); const sw = opts.swipe && opts.swipe(tx); return sw ? swipeRow(card, sw) : card; }))))); }
  function swipeRow(card, opts) {
    const wrap = h('div', { class: 'swipe-wrap' }, h('div', { class: 'swipe-action ' + (opts.color || 'amber') }, svg(opts.icon || 'history', 20), h('span', null, opts.label)), h('div', { class: 'swipe-card' }, card));
    const inner = wrap.lastChild; let s = null;
    inner.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; s = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, lock: null }; inner.style.transition = 'none'; }, { passive: true });
    inner.addEventListener('touchmove', (e) => { if (!s) return; const dx = e.touches[0].clientX - s.x0, dy = e.touches[0].clientY - s.y0; if (s.lock === null) { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; s.lock = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'x' : 'y'; } if (s.lock !== 'x') return; if (e.cancelable) e.preventDefault(); s.dx = Math.max(0, Math.min(dx, 150)); inner.style.transform = 'translateX(' + s.dx + 'px)'; wrap.classList.toggle('armed', s.dx > 92); }, { passive: false });
    const end = () => { if (!s) return; const dx = s.dx; s = null; inner.style.transition = ''; wrap.classList.remove('armed'); if (dx > 92) { inner.style.transform = 'translateX(150px)'; wrap.classList.add('done'); buzz(10); Promise.resolve(opts.onAction()).catch(err).then(() => { inner.style.transform = ''; wrap.classList.remove('done'); }); } else { inner.style.transform = ''; if (dx > 4) { inner.dataset.swiped = '1'; setTimeout(() => { delete inner.dataset.swiped; }, 350); } } };
    inner.addEventListener('touchend', end); inner.addEventListener('touchcancel', end);
    inner.addEventListener('click', (e) => { if (inner.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
    return wrap;
  }

  /* ------------------------------------------------------------- feel: ripple, haptics, hold-to-open */
  const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
  function buzz(ms) { try { if (navigator.vibrate && isTouch()) navigator.vibrate(ms || 8); } catch (e) {} }
  const RIPPLE_SEL = '.action-btn,.primary-btn,.outline-btn,.menu-row,.tx-card,.row-card,.chat-row,.nav-item,.seg button,.act,.check-pill,.tabs4 button,.mode-seg button,.save-btn,.refresh-btn,.round-btn,.icon-btn,.chat-btn,.doc-btn,.upload-btn,.find-btn,.search-btn,.send-wide,.test-btn,.green-btn,.add-btn,.quick-chip,.txm-card,.txm-btn,.menu-item';
  document.addEventListener('touchstart', () => {}, { passive: true });
  const unpress = () => document.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'dragstart'].forEach((t) => document.addEventListener(t, unpress, { passive: true }));
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(RIPPLE_SEL); if (!el || el.disabled) return;
    el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 600);
    const rect = el.getBoundingClientRect(); const size = Math.max(rect.width, rect.height) * 1.4;
    const r = h('span', { class: 'ripple', style: { width: size + 'px', height: size + 'px', left: (e.clientX - rect.left - size / 2) + 'px', top: (e.clientY - rect.top - size / 2) + 'px' } });
    el.appendChild(r); setTimeout(() => r.remove(), 520);
    if (el.matches('.action-btn,.primary-btn,.act,.nav-item,.save-btn,.send-btn')) buzz(6);
  }, { passive: true });
  function holdMenu(el, onHold) {
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
  const TOP = ['home', 'history', 'chats', 'search', 'menu'];
  const NAV = [['home', 'Главная', 'home'], ['history', 'История', 'history'], ['chats', 'Чат', 'chat'], ['search', 'Поиск', 'search'], ['menu', 'Меню', 'menu']];
  function can(p) { return !!(state.admin && state.admin.permissions.includes(p)); }
  const isOperator = () => !!state.admin && !can('settings'); /* operators and viewers: requests, chats, balances — no system pages */
  function navBadge(page) { const q = state.live && state.live.queues; if (!q) return 0; if (page === 'home') return q.deposits_failed + q.withdrawals_attention; if (page === 'chats') return q.support_waiting; return 0; }
  function render() {
    closeDropdown();
    const app = $('#app'); app.innerHTML = '';
    if (!state.admin) { app.appendChild(loginView()); return; }
    const page = state.route.page;
    const noNav = (page === 'chats' && !!state.route.id) || ((page === 'deposit' || page === 'withdrawal' || page === 'deposits' || page === 'withdrawals') && !!state.route.id);
    const shell = h('div', { class: 'shell page-in ' + (noNav ? 'no-nav' : '') });
    document.documentElement.classList.toggle('chat-open', page === 'chats' && !!state.route.id);
    app.appendChild(shell);
    const views = { home: homeView, history: historyView, chats: chatsView, search: searchView, menu: menuView, stats: statsView, cashes: cashesView, events: eventsView, wallets: walletsView, broadcast: broadcastView, security: securityView, quick: quickView, logs: logsView, settings: settingsView, macrodroid: macrodroidView, statements: statementsView, deposit: (m) => txDetailView(m, 'deposit', state.route.id), withdrawal: (m) => txDetailView(m, 'withdraw', state.route.id), deposits: (m) => (state.route.id ? txDetailView(m, 'deposit', state.route.id) : homeView(m)), withdrawals: (m) => (state.route.id ? txDetailView(m, 'withdraw', state.route.id) : homeView(m)), users: (m) => userDetailView(m, state.route.id), push: pushView, env: envView };
    (views[page] || homeView)(shell);
    if (!noNav) shell.appendChild(bottomNav(page));
  }
  function bottomNav(page) {
    const active = TOP.includes(page) ? page : (page === 'users' ? 'search' : 'menu');
    return h('nav', { class: 'bottom-nav' }, NAV.map(([key, label, icon]) => { const n = navBadge(key); return h('button', { class: 'nav-item ' + (active === key ? 'active' : ''), type: 'button', onclick: () => go('#/' + key) }, h('span', { class: 'nav-icon' }, svg(icon, 24), n ? h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n) : null), label); }));
  }
  function updateBadges() { document.querySelectorAll('.bottom-nav .nav-item').forEach((b, i) => { const key = NAV[i][0]; const old = b.querySelector('.nav-badge'); if (old) old.remove(); const n = navBadge(key); if (n) b.querySelector('.nav-icon').appendChild(h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n)); }); }
  function page(shell, title, opts) { const screen = h('section', { class: 'screen' }); shell.appendChild(screen); screen.appendChild(topbar(title, Object.assign({ back: backTo('#/menu') }, opts || {}))); const box = h('div', null, loader()); screen.appendChild(box); return box; }

  /* ------------------------------------------------------------- auth / live */
  function deviceHint() { try { const d = navigator.userAgentData; if (d && d.platform) return d.platform + (d.mobile ? ' · телефон' : ''); } catch (e) {} return ''; }
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

  /* ------------------------------------------------------------- home (Главная): Актуальные / Отложенные + refresh */
  function homeView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const listBox = h('div');
    const refresh = h('button', { class: 'refresh-btn', 'aria-label': 'Обновить', type: 'button', onclick: () => load(true) }, svg('refresh', 26));
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
        else listBox.appendChild(txGroups(items, { swipe: (tx) => tx.kind === 'withdraw' && can('operations') && ['created', 'processing'].includes(tx.status) ? { label: tx.deferred ? 'Вернуть' : 'Отложить', color: tx.deferred ? 'blue' : 'amber', icon: 'timer', onAction: async () => { const r = await txAction('withdraw', tx, tx.deferred ? 'resume' : 'defer', { done: tx.deferred ? 'Возвращено в работу' : 'Отложено' }); if (r) load(); } } : null }));
        if (manual) toast('Обновлено', 'ok', 1000);
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Не удалось загрузить', e.message)); }
      refresh.disabled = false; refresh.classList.remove('spin');
    }
    load(); watchChanges(screen, () => load()); watchLive(screen, drawTop);
  }

  /* ------------------------------------------------------------- history (История): tabs + filter panel */
  function historyView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const st = { page: 1, items: [], total: 0 };
    const f = state.historyFilters;
    const filterCount = () => ['status', 'cash', 'from', 'to', 'q', 'amount', 'amin', 'amax', 'attention', 'deferred'].filter((k) => f[k]).length;
    const top = h('div', { class: 'home-top solo' });
    const listBox = h('div'); screen.appendChild(top); screen.appendChild(listBox);
    const drawTop = () => {
      top.innerHTML = '';
      const seg = segEl([['all', 'Все'], ['deposit', 'Депозиты'], ['withdraw', 'Выводы']], state.historyTab, (k) => { state.historyTab = k; st.page = 1; load(); }, 'light tabs4c');
      seg.appendChild(h('button', { class: 'filter' + (filterCount() ? ' on' : ''), type: 'button', 'aria-label': 'Фильтр', onclick: (e) => { e.currentTarget.classList.add('open'); openFilters(() => { const b = top.querySelector('.filter'); if (b) b.classList.remove('open'); }); } }, svg('filter', 24)));
      top.appendChild(seg);
    };
    function openFilters(onClose) {
      const q = h('input', { class: 'input', value: f.q || '', placeholder: 'Поиск по ID...', inputmode: 'search' });
      const amount = h('input', { class: 'input', type: 'number', step: '0.01', inputmode: 'decimal', value: f.amount || '', placeholder: 'Поиск по сумме...' });
      const amin = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: f.amin || '', placeholder: 'От' }); const amax = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: f.amax || '', placeholder: 'До' });
      const radio = (items, cur, onPick) => h('div', { class: 'radio-row' }, items.map(([v, l]) => h('button', { class: 'radio' + (cur === v ? ' on' : ''), type: 'button', onclick: (e) => { onPick(v); e.currentTarget.parentNode.querySelectorAll('.radio').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, h('i'), l)));
      const check = (label, color, on, onPick) => { const b = h('button', { class: 'check-row' + (on ? ' on' : ''), type: 'button' }, h('i', null, svg('check', 16)), h('span', { class: 'cdot', style: { background: color } }), label); b.onclick = () => { b.classList.toggle('on'); onPick(b.classList.contains('on')); }; return b; };
      let status = f.status || '', cash = f.cash || '', attention = !!f.attention, deferred = !!f.deferred;
      const from = h('input', { class: 'input', type: 'date', value: f.from || '' }); const to = h('input', { class: 'input', type: 'date', value: f.to || '' });
      const s = sheet({ title: 'Фильтр', onClose, body: h('div', null,
        h('span', { class: 'lbl' }, 'Поиск по ID'), q,
        h('span', { class: 'lbl' }, 'Поиск по точной сумме'), amount,
        h('span', { class: 'lbl' }, 'Диапазон сумм'), h('div', { class: 'range-row' }, amin, h('span', { style: { textAlign: 'center' } }, '—'), amax),
        radio([['', 'Все'], ['success', 'Принятые'], ['cancelled,expired,failed', 'Отказанные']], status, (v) => { status = v; }),
        radio([['', 'Все'], ...state.cashes.map((c) => [c.key, c.name])], cash, (v) => { cash = v; }),
        h('div', { style: { padding: '4px 0 10px' } }, check('Требуют внимания', '#e0a512', attention, (v) => { attention = v; }), check('Отложенные', '#2fb673', deferred, (v) => { deferred = v; })),
        h('span', { class: 'lbl' }, 'Период'), h('div', { class: 'date-grid' }, from, to)),
        actions: [h('button', { class: 'action-btn', onclick: () => { state.historyFilters = {}; s.close(); st.page = 1; load(); } }, 'Сбросить'), h('button', { class: 'action-btn primary', onclick: () => { state.historyFilters = { q: q.value.trim(), amount: amount.value.trim(), amin: amin.value.trim(), amax: amax.value.trim(), status, cash, from: from.value, to: to.value, attention, deferred }; s.close(); st.page = 1; load(); } }, 'Применить')] });
    }
    async function load(more) {
      const f2 = state.historyFilters; drawTop();
      if (!more) { st.page = 1; listBox.innerHTML = ''; listBox.appendChild(loader()); }
      try {
        const qs = 'q=' + encodeURIComponent(f2.q || '') + '&status=' + encodeURIComponent(f2.status || '') + '&cash=' + encodeURIComponent(f2.cash || '') + '&date_from=' + (f2.from || '') + '&date_to=' + (f2.to || '') + '&amount=' + encodeURIComponent(f2.amount || '') + '&amount_min=' + encodeURIComponent(f2.amin || '') + '&amount_max=' + encodeURIComponent(f2.amax || '') + '&page=' + st.page + '&size=40';
        const calls = []; if (state.historyTab !== 'withdraw') calls.push(api('/deposits?' + qs)); if (state.historyTab !== 'deposit') calls.push(api('/withdrawals?' + qs));
        const results = await Promise.all(calls);
        let fresh = results.flatMap((r) => r.items); st.total = results.reduce((a, r) => a + r.total, 0);
        if (f2.attention) fresh = fresh.filter((x) => x.needs_attention || x.status === 'failed');
        if (f2.deferred) fresh = fresh.filter((x) => x.deferred);
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

  /* ------------------------------------------------------------- search (Поиск): ID игрока / Имя / TG ID */
  function searchView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const MODES = [['player', 'hash', 'ID игрока', 'Введите ID счёта'], ['name', 'user', 'Имя', 'Имя или @username'], ['tg', 'users', 'TG ID', 'Telegram ID клиента']];
    let mode = state.searchMode || 'player';
    const input = h('input', { class: 'big-input', placeholder: (MODES.find((m) => m[0] === mode) || MODES[0])[3], value: state.searchQuery, inputmode: 'search' });
    const modeBar = h('div', { class: 'mode-seg' }); const label = h('div', { class: 'search-label' });
    const btn = h('button', { class: 'search-btn' + (state.searchQuery ? ' ready' : ''), type: 'button' }, svg('search', 22), 'Найти');
    const results = h('div');
    const drawMode = () => { modeBar.innerHTML = ''; MODES.forEach(([k, ic, l, ph]) => modeBar.appendChild(h('button', { class: k === mode ? 'active' : '', type: 'button', onclick: () => { mode = k; state.searchMode = k; input.placeholder = ph; input.inputMode = k === 'name' ? 'search' : 'numeric'; drawMode(); if (input.value.trim()) run(); } }, svg(ic, 22), l))); const m = MODES.find((x) => x[0] === mode) || MODES[0]; label.innerHTML = ''; label.appendChild(svg(m[1], 22)); label.appendChild(document.createTextNode(m[2])); };
    const run = async () => {
      const q = input.value.trim(); state.searchQuery = q; results.innerHTML = ''; btn.classList.toggle('ready', !!q);
      if (q.length < 2) return;
      results.appendChild(loader(2));
      try {
        const wantTx = mode !== 'name' && mode !== 'tg';
        const [d, w, u] = await Promise.all([wantTx ? api('/deposits?q=' + encodeURIComponent(q) + '&size=30') : { items: [] }, wantTx ? api('/withdrawals?q=' + encodeURIComponent(q) + '&size=30') : { items: [] }, api('/users?q=' + encodeURIComponent(q) + '&size=20')]);
        results.innerHTML = '';
        if (u.items.length) { results.appendChild(h('div', { class: 'section-cap' }, 'Клиенты')); u.items.forEach((x) => results.appendChild(h('button', { class: 'card row-card', onclick: () => go('#/users/' + x.id) }, avatarEl(x.name, x.avatar_url, 'round'), h('div', null, h('b', null, x.name, x.username ? ' · @' + x.username : ''), h('small', null, 'TG ' + x.telegram_id + ' · пополнений ' + x.deposits_count + ' · выводов ' + x.withdrawals_count)), x.is_blocked ? h('span', { class: 'pill red' }, 'блок') : svg('chevron', 18)))); }
        const txs = [...d.items, ...w.items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (txs.length) { results.appendChild(h('div', { class: 'section-cap' }, 'Заявки · ' + txs.length)); results.appendChild(txGroups(txs, { noAlert: true })); }
        if (!u.items.length && !txs.length) results.appendChild(empty('Ничего не найдено', 'Попробуйте другой запрос.', 'search'));
      } catch (e) { results.innerHTML = ''; results.appendChild(empty('Ошибка', e.message)); }
    };
    input.addEventListener('input', debounce(run, 350)); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }); btn.onclick = run;
    screen.appendChild(h('div', { class: 'search-hero' }, h('b', null, 'Поиск'), h('small', null, 'Найдите нужную информацию')));
    screen.appendChild(h('div', { class: 'card search-card' }, modeBar, label, input, btn));
    screen.appendChild(h('div', { class: 'tips' }, h('b', null, 'Советы по поиску:'), h('ul', null, h('li', null, 'Используйте точные данные для лучших результатов'), h('li', null, 'ID игрока и Telegram ID должны содержать только цифры'), h('li', null, 'Поиск по имени не чувствителен к регистру'))));
    screen.appendChild(results); drawMode(); if (state.searchQuery) run();
  }

  /* ------------------------------------------------------------- chats (Чат): list, search over chats + messages */
  const chatTime = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; return dayKey(d) === dayKey(new Date()) ? fmtTime(d) : d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3).toLowerCase(); };
  function chatRow(cv, i) {
    const last = cv.last_text ? ((cv.last_sender === 'operator' ? 'Вы: ' : '') + cv.last_text) : '';
    return h('button', { class: 'chat-row', type: 'button', style: { '--i': Math.min(i || 0, 12) }, onclick: () => go('#/chats/' + cv.id) },
      avatarEl(cv.user_name, cv.user_avatar),
      h('span', { class: 'chat-copy' }, h('span', { class: 'chat-name' }, cv.user_name || 'Клиент'), h('span', { class: 'chat-last' + (last ? '' : ' none') }, last || 'Нет сообщений')),
      h('span', { class: 'chat-side' }, h('time', null, chatTime(cv.last_message_at || cv.updated_at)), cv.unread_count ? h('span', { class: 'unread' }, cv.unread_count) : null));
  }
  function chatsView(shell) {
    if (state.route.id) return chatThreadView(shell, Number(state.route.id));
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const search = h('input', { placeholder: 'Поиск...', value: state.chatQuery, inputmode: 'search', oninput: debounce((e) => { state.chatQuery = e.target.value.trim(); load(); }, 250) });
    const tabBox = h('div'); const listBox = h('div', { class: 'chat-list' });
    screen.appendChild(h('div', { class: 'chat-top' }, h('div', { class: 'chat-search-row' }, h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => { if (state.chatQuery) { state.chatQuery = ''; search.value = ''; load(); } else go('#/home'); } }, svg('back', 24)), h('div', { class: 'searchbar' }, svg('search', 20), search)), tabBox)); screen.appendChild(listBox);
    async function load() {
      listBox.innerHTML = ''; listBox.appendChild(loader());
      try {
        if (state.chatQuery) { tabBox.innerHTML = ''; return drawSearch(await api('/support/search?q=' + encodeURIComponent(state.chatQuery))); }
        const status = state.chatTab === 'closed' ? 'closed' : 'open';
        const r = await api('/support/conversations?status=' + status + '&size=60');
        const c = r.counts || {};
        tabBox.innerHTML = ''; tabBox.appendChild(h('div', { class: 'chat-tabs' }, h('button', { class: state.chatTab !== 'closed' ? 'active' : '', onclick: () => { state.chatTab = 'open'; load(); } }, 'Открытые', h('small', null, c.open || 0)), h('button', { class: state.chatTab === 'closed' ? 'active' : '', onclick: () => { state.chatTab = 'closed'; load(); } }, 'Закрытые', h('small', null, c.closed || 0))));
        listBox.innerHTML = '';
        if (!r.items.length) return listBox.appendChild(empty(state.chatTab === 'closed' ? 'Закрытых обращений нет' : 'Открытых обращений нет', '', 'chat'));
        r.items.forEach((cv, i) => listBox.appendChild(chatRow(cv, i)));
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    function drawSearch(r) {
      listBox.innerHTML = '';
      const wrap = h('div', { style: { padding: '0 16px' } });
      if (r.chats.length) { wrap.appendChild(h('div', { class: 'res-title' }, svg('user', 20), 'Чаты')); r.chats.forEach((cv, i) => { const row = chatRow(cv, i); row.style.margin = '0 -16px'; row.style.width = 'calc(100% + 32px)'; wrap.appendChild(row); }); }
      if (r.messages.length) {
        if (r.chats.length) wrap.appendChild(h('div', { class: 'res-split' }));
        wrap.appendChild(h('div', { class: 'res-title' }, svg('chat', 20), 'Сообщения'));
        r.messages.forEach((m) => wrap.appendChild(h('button', { class: 'msg-row', type: 'button', onclick: () => go('#/chats/' + m.conversation_id) }, avatarEl(m.user_name, m.user_avatar), h('span', { style: { minWidth: 0 } }, h('span', { class: 'msg-head' }, h('b', null, m.user_name || 'Клиент'), h('time', null, chatTime(m.created_at))), h('span', { class: 'msg-box' }, (m.sender === 'operator' ? 'Вы: ' : '') + m.text)))));
      }
      if (!r.chats.length && !r.messages.length) wrap.appendChild(empty('Ничего не найдено', 'Имя, @username, Telegram ID или текст сообщения', 'search'));
      listBox.appendChild(wrap);
    }
    load(); watchChanges(screen, () => { if (!state.chatQuery) load(); });
  }
  async function openChat(userId) {
    try { const r = await api('/users/' + userId + '/conversation', { method: 'POST' }); closeSheets(); go('#/chats/' + r.item.id); } catch (e) { err(e); }
  }
  const MEDIA_EXT = { audio: ['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'wav'], video: ['mp4', 'mov', 'webm'], image: ['jpg', 'jpeg', 'png', 'webp', 'gif'] };
  function mediaNode(m) {
    if (!m.file_url) return null;
    const url = fileUrl(m.file_url); const ext = (m.file_url.split('.').pop() || '').toLowerCase();
    const kindOf = MEDIA_EXT.image.includes(ext) ? 'image' : MEDIA_EXT.audio.includes(ext) ? 'audio' : MEDIA_EXT.video.includes(ext) ? 'video' : 'file';
    if (kindOf === 'image') return h('div', null, h('img', { src: url, alt: '', loading: 'lazy', onclick: () => imageSheet(m.sender === 'user' ? 'Фото клиента' : 'Фото', url) }), h('span', { class: 'media-cap' }, 'Изображение', h('a', { href: url, download: '', target: '_blank', rel: 'noopener' }, svg('download', 20))), h('span', { class: 'kind' }, 'Фото'));
    if (kindOf === 'audio') return h('div', { class: 'media-audio' }, svg(m.kind === 'voice' ? 'chat' : 'note', 16), h('audio', { controls: true, preload: 'metadata', src: url }));
    if (kindOf === 'video') return h('video', { class: 'media-video', controls: true, playsinline: true, preload: 'metadata', src: url });
    return h('a', { class: 'media-file', href: url, target: '_blank', rel: 'noopener' }, svg('note', 16), h('span', null, m.file_name || (m.kind === 'sticker' ? 'Стикер' : 'Файл')));
  }
  async function chatThreadView(shell, id) {
    const screen = h('section', { class: 'chat-screen' }); shell.appendChild(screen); screen.appendChild(loader(2));
    let lastId = 0; let c = null; const known = {}; let composer = null;
    const fitViewport = () => { const vv = window.visualViewport; const stick = feed && nearBottom(); if (vv) { screen.style.height = Math.round(vv.height) + 'px'; screen.style.transform = 'translateY(' + Math.round(vv.offsetTop) + 'px)'; } else screen.style.height = window.innerHeight + 'px'; if (window.scrollY) window.scrollTo(0, 0); if (feed && stick) feed.scrollTop = feed.scrollHeight; };
    const feed = h('div', { class: 'chat-feed' });
    const bottom = (smooth) => { feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
    const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
    const bubble = (m) => {
      known[m.id] = m;
      const mine = m.direction === 'out' && m.sender === 'operator';
      const voice = ['voice', 'audio', 'video_note'].includes(m.kind) && m.file_url && !m.deleted_at;
      const fresh = Date.now() - new Date(m.created_at).getTime() < 3 * 60 * 1000;
      const b = h('div', { class: 'bubble ' + (mine ? 'out ' : '') + m.sender + (m.deleted_at ? ' deleted' : ''), 'data-id': m.id },
        m.reply_to ? h('div', { class: 'quote', onclick: () => { const t = feed.querySelector('.bubble[data-id="' + m.reply_to.id + '"]'); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 900); } } }, h('b', null, m.reply_to.sender === 'user' ? (c ? c.user_name : 'Клиент') : 'Вы'), h('span', null, m.reply_to.text || '…')) : null,
        m.deleted_at ? h('i', null, 'Сообщение удалено') : mediaNode(m), m.deleted_at ? null : (m.text && !(m.file_url && /^\[.*\]$/.test(m.text)) ? h('span', { class: 'txt' }, m.text) : null),
        voice ? (m.transcript ? h('span', { class: 'transcript' }, h('b', null, 'Расшифровка'), m.transcript) : (fresh ? h('span', { class: 'transcript wait' }, 'Расшифровка…') : null)) : null,
        h('small', null, msgStamp(m.created_at) + (m.edited_at ? ' · изм.' : '') + (m.sender === 'bot' ? ' · бот' : '')));
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
        const u = r.user || {}; const seen = u.last_seen_at ? (Date.now() - new Date(u.last_seen_at).getTime() < 5 * 60 * 1000 ? 'был(а) недавно' : 'был(а) ' + ago(u.last_seen_at) + ' назад') : (STATUS[c.status] || [c.status])[0];
        const tgLink = c.username ? 'https://t.me/' + c.username : 'tg://user?id=' + c.telegram_id;
        const tools = h('div', { style: { position: 'relative' } });
        const more = h('button', { class: 'icon-btn', 'aria-label': 'Меню', type: 'button', onclick: () => chatMenu(c, tools, draw) }, svg('more', 24));
        tools.appendChild(more);
        const head = h('header', { class: 'chat-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => go('#/chats') }, svg('back', 24)), avatarEl(c.user_name, u.avatar_url), h('button', { class: 'chat-person', onclick: () => go('#/users/' + c.user_id) }, h('b', null, c.user_name || 'Клиент'), h('small', null, seen + (c.status === 'waiting_operator' ? ' · ждёт оператора' : ''))), h('a', { class: 'open-chat', href: tgLink, target: '_blank', rel: 'noopener' }, 'Открыть чат'), tools);
        screen.appendChild(head);
        if (ctx.deposit || ctx.withdrawal) { const t = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; const dep = t === ctx.deposit; screen.appendChild(h('button', { class: 'case-card', onclick: () => go('#/' + (dep ? 'deposit' : 'withdrawal') + '/' + t.id) }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('b', null, (dep ? 'Пополнение # ' : 'Вывод # ') + String(t.public_id || t.id).replace(/^[DW]-/, '')), h('span', { style: { flex: 1 } }), statusEl(t.status, t.status_label)), h('small', null, t.cash + ' • ID ' + t.player_id + ' • ' + money(t.amount) + ' ' + curSign(t.currency) + ' • ' + fmtDate(t.created_at)), t.error ? h('small', { style: { color: 'var(--red)' } }, reasonText(t.error)) : null)); }
        feed.innerHTML = ''; lastId = 0;
        r.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); });
        if (!r.messages.length) feed.appendChild(empty('Сообщений нет', 'Напишите первым — клиент получит сообщение в боте', 'chat'));
        screen.appendChild(feed);
        composer = makeComposer();
        if (can('support')) screen.appendChild(composer.el);
        fitViewport(); bottom(false); setTimeout(() => bottom(false), 250); setTimeout(() => bottom(false), 700);
        feed.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => { if (nearBottom()) bottom(false); }));
        const poll = setInterval(async () => { if (!document.body.contains(feed)) return clearInterval(poll); if (document.hidden) return; try { const rr = await api('/support/conversations/' + c.id + '?after_id=' + lastId); if (rr.messages.length) { const stick = nearBottom(); rr.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); }); if (stick) bottom(true); } const waiting = Object.values(known).filter((m) => ['voice', 'audio', 'video_note'].includes(m.kind) && m.file_url && !m.transcript && Date.now() - new Date(m.created_at).getTime() < 3 * 60 * 1000); if (waiting.length) { const full = await api('/support/conversations/' + c.id); full.messages.forEach((m) => { const old = known[m.id]; if (old && m.transcript && !old.transcript) { Object.assign(old, m); const node = feed.querySelector('.bubble[data-id="' + m.id + '"]'); if (node) node.replaceWith(bubble(old)); } }); } } catch (e) {} }, 3000);
      } catch (e) { screen.innerHTML = ''; screen.appendChild(topbar('Чат', { back: () => go('#/chats') })); screen.appendChild(empty('Ошибка', e.message)); }
    };
    function makeComposer() {
      const ta = h('textarea', { placeholder: 'Введите сообщение...', rows: 1 });
      const bar = h('div', { class: 'compose-bar', hidden: true });
      let mode = null;
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; sendBtn.classList.toggle('ready', !!ta.value.trim()); };
      const clearMode = () => { mode = null; bar.hidden = true; bar.innerHTML = ''; ta.value = ''; grow(); };
      const setMode = (m, type) => { mode = { m, type }; bar.hidden = false; bar.innerHTML = ''; bar.appendChild(h('div', { class: 'compose-quote' }, h('b', null, type === 'edit' ? 'Изменение' : 'Ответ ' + (m.sender === 'user' ? (c ? c.user_name : 'клиенту') : 'на своё сообщение')), h('span', null, (m.text || (m.file_name || '[файл]')).slice(0, 120)))); bar.appendChild(h('button', { class: 'compose-x', 'aria-label': 'Отмена', onclick: clearMode }, svg('close', 16))); if (type === 'edit') { ta.value = m.text || ''; grow(); } ta.focus(); };
      const keepFocus = (e) => { e.preventDefault(); };
      const sendBtn = h('button', { class: 'send-btn', 'aria-label': 'Отправить', type: 'button', onpointerdown: keepFocus, onmousedown: keepFocus }, svg('send', 22));
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
      const el = h('div', { class: 'chat-composer' }, bar, h('div', { class: 'compose-row' }, h('div', { class: 'compose-side' }, h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Быстрые ответы', onclick: () => quickPick((t) => { ta.value = t; grow(); ta.focus(); }, vars()) }, svg('bolt', 26)), h('button', { class: 'composer-icon', type: 'button', 'aria-label': 'Фото или видео', onclick: attach }, svg('paperclip', 26))), h('div', { class: 'compose-box' }, ta, sendBtn), camInput, fileInput));
      return { el, reply: (m) => setMode(m, 'reply'), edit: (m) => setMode(m, 'edit') };
    }
    if (window.visualViewport) { const onVV = () => { if (!document.body.contains(screen)) { window.visualViewport.removeEventListener('resize', onVV); window.visualViewport.removeEventListener('scroll', onVV); return; } fitViewport(); }; window.visualViewport.addEventListener('resize', onVV); window.visualViewport.addEventListener('scroll', onVV); }
    window.addEventListener('resize', () => { if (document.body.contains(screen)) fitViewport(); });
    window.addEventListener('scroll', () => { if (document.body.contains(screen) && window.scrollY) window.scrollTo(0, 0); }, { passive: true });
    draw();
  }
  function chatMenu(c, anchor, redraw) {
    /* «⋮» in a chat: Транзакции (the client's requests) + dialog actions */
    const setStatus = async (status) => { try { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status } }); redraw(); } catch (e) { err(e); } };
    dropdown(anchor, [
      { label: 'Транзакции', icon: 'card', onclick: () => clientTransactions(c) },
      { label: 'Профиль', icon: 'user', onclick: () => go('#/users/' + c.user_id) },
      can('support') && c.status !== 'operator' ? { label: 'Взять в работу', icon: 'check', onclick: () => setStatus('operator') } : null,
      can('support') && c.status !== 'auto' && c.status !== 'resolved' ? { label: 'Вернуть боту', icon: 'bolt', onclick: () => setStatus('auto') } : null,
      can('support') ? (c.status === 'resolved' ? { label: 'Открыть снова', icon: 'refresh', onclick: () => setStatus('operator') } : { label: 'Завершить', icon: 'close', cls: 'danger', onclick: async () => { const note = await promptDialog('Завершить обращение', 'Сообщение клиенту (необязательно)'); if (note === null) return; try { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'resolved', note } }); go('#/chats'); } catch (e) { err(e); } } }) : null,
    ]);
  }
  function clientTransactions(c) {
    const list = h('div', { class: 'txm' }, loader(3));
    const s = sheet({ title: 'Транзакции', full: true, body: list });
    api('/users/' + c.user_id).then((r) => {
      const txs = [...r.deposits, ...r.withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      list.innerHTML = '';
      if (!txs.length) return list.appendChild(empty('Заявок нет', 'Клиент ещё ничего не оформлял', 'history'));
      txs.forEach((tx) => list.appendChild(txmCard(tx, s)));
    }).catch((e) => { list.innerHTML = ''; list.appendChild(empty('Ошибка', e.message)); });
  }
  function txmCard(tx, s) {
    const dep = tx.kind === 'deposit'; const st = txState(tx); const open = !['success', 'cancelled', 'expired'].includes(tx.status);
    const chipCls = tx.status === 'success' ? '' : (open ? 'pending' : 'rejected');
    const chipLabel = tx.status === 'success' ? 'Принят' : st.label;
    const receipt = tx.has_receipt ? h('button', { class: 'txm-btn', type: 'button', onclick: (e) => { e.stopPropagation(); imageSheet(dep ? 'Чек клиента' : 'Чек перевода', API + '/' + (dep ? 'deposits' : 'withdrawals') + '/' + tx.id + '/receipt', money(dep ? tx.pay_amount : tx.amount) + ' ' + curSign(tx.currency)); } }, svg('printer', 20), 'Чек') : (open ? h('button', { class: 'txm-btn', type: 'button', onclick: (e) => { e.stopPropagation(); s.close(); go(txHref(tx)); } }, 'На проверку') : null);
    return h('button', { class: 'txm-card', type: 'button', onclick: () => { s.close(); go(txHref(tx)); } },
      h('span', { class: 'txm-main' }, h('span', { class: 'ico' }, svg(dep ? 'download' : 'upload', 22)), h('span', { style: { minWidth: 0 } }, h('b', null, dep ? 'Пополнение' : 'Вывод'), h('small', null, 'ID: ' + tx.player_id))),
      h('span', { class: 'txm-status ' + chipCls }, chipLabel),
      h('span', { class: 'txm-date' }, fmtDate(tx.created_at)),
      receipt || h('span'),
      h('span', { class: 'txm-amt ' + (dep ? 'deposit' : 'withdraw') }, money(dep ? tx.pay_amount : tx.amount)));
  }
  async function quickPick(onPick, vars) {
    try { const r = await api('/quick-replies'); state.quick = r.items; } catch (e) {}
    const fill = (t) => String(t || '').replace(/\{name\}/g, (vars && vars.name) || '').replace(/\{id\}/g, (vars && vars.id) || '');
    const s = sheet({ title: 'Быстрые ответы', body: state.quick.length ? h('div', { class: 'quick-chips' }, state.quick.map((q) => h('button', { class: 'quick-chip', type: 'button', title: fill(q.text), onclick: () => { s.close(); onPick(fill(q.text)); } }, q.title || fill(q.text).slice(0, 30)))) : empty('Ответов нет', 'Меню → Быстрые ответы', 'bell') });
  }

  /* ------------------------------------------------------------- request page (Пополнение / Вывод) */
  const SOURCE = { bot: 'Телеграм', telegram: 'Телеграм', admin: 'Панель', panel: 'Панель', api: 'API', manual: 'Вручную', macrodroid: 'MacroDroid', webhook: 'MacroDroid', imap: 'Почта', email: 'Почта', support: 'Поддержка', statement: 'Выписка' };
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
    try { const r = await api('/' + path + '/' + tx.id + '/action', { method: 'POST', body: { action, reason, amount: opts.amount } }); toast(opts.done || 'Готово', 'ok'); return r.item || tx; } catch (e) { err(e); return null; }
  }
  function creditDialog(tx) {
    /* «Зачислить»: the player gets exactly what the client paid — tiyins included */
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; resolve(v); };
      const fromBank = tx.payment && tx.payment.amount ? String(tx.payment.amount) : '';
      const input = h('input', { class: 'input', type: 'number', step: '0.01', inputmode: 'decimal', value: fromBank || String(tx.pay_amount || '') });
      const note = fromBank ? 'Платёж из банка: ' + money(tx.payment.amount) + ' ' + curSign(tx.currency) + ' · ' + srcLabel(tx.payment.source) : 'Заявка на ' + money(tx.pay_amount) + ' ' + curSign(tx.currency) + '. Если клиент оплатил другую сумму — впишите её.';
      const s = sheet({ title: 'Зачислить на счёт игрока', onClose: () => finish(null),
        body: h('div', null, h('div', { class: 'hint-card' }, 'Зачислится ровно та сумма, что оплатил клиент, с тыйынами.'), h('label', { class: 'field' }, h('span', null, 'Оплачено клиентом, ' + curSign(tx.currency)), input), h('div', { class: 'muted' }, note), h('div', { class: 'muted', style: { marginTop: '6px' } }, 'ID ' + tx.player_id + ' · ' + (tx.cash_name || '').toUpperCase() + (tx.player_name ? ' · ' + tx.player_name : ''))),
        actions: [h('button', { class: 'action-btn', onclick: () => { finish(null); s.close(); } }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { const v = String(input.value).replace(',', '.').trim(); if (!(Number(v) > 0)) return toast('Введите оплаченную сумму', 'err'); finish(v); s.close(); } }, 'Зачислить')] });
      setTimeout(() => { input.focus(); input.select(); }, 80);
    });
  }
  const copyBtn = (text) => h('button', { class: 'copy-btn', type: 'button', 'aria-label': 'Копировать', onclick: (e) => { e.stopPropagation(); copy(text); } }, svg('copy', 20));
  function txActions(kind, tx, ctx) {
    /* the fixed bar at the bottom of the page: «Принять» (зачислить / перевёл) and «Отказать» */
    const dep = kind === 'deposit';
    const open = !['success', 'cancelled', 'expired'].includes(tx.status);
    if (!can('operations') || !open) return null;
    let accept;
    if (dep) accept = tx.status === 'processing' ? h('button', { class: 'act accept', disabled: true }, 'Зачисляется…') : h('button', { class: 'act accept', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const amount = await creditDialog(tx); if (amount === null) { busy(b, false); return; } const r = await txAction(kind, tx, 'credit', { amount, done: 'Зачислено ' + money(amount) + ' ' + curSign(tx.currency) }); busy(b, false); if (r) ctx.refresh(); } }, svg('check', 22), 'Принять');
    else if (tx.receipt_required && !tx.has_receipt) accept = h('button', { class: 'act accept amber', onclick: async () => { const ok = await pickReceipt(tx, null); if (!ok) return; await txAction(kind, tx, 'complete', { confirm: 'Чек прикреплён. Перевели ' + money(tx.amount) + ' ' + curSign(tx.currency) + ' клиенту?', okLabel: 'Да, перевёл', done: 'Вывод выполнен' }); ctx.refresh(); } }, svg('image', 22), 'Чек → Принять');
    else accept = h('button', { class: 'act accept', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const r = await txAction(kind, tx, 'complete', { confirm: 'Перевели ' + money(tx.amount) + ' ' + curSign(tx.currency) + ' клиенту?', okLabel: 'Да, перевёл', done: 'Вывод выполнен' }); busy(b, false); if (r) ctx.refresh(); } }, svg('check', 22), 'Принять');
    const reject = h('button', { class: 'act reject', onclick: async () => { const r = await txAction(kind, tx, dep ? 'reject' : 'fail', { askReason: 'Причина отказа', done: 'Отказано' }); if (r) ctx.refresh(); } }, svg('close', 22), 'Отказать');
    return h('div', { class: 'action-bar' }, accept, reject);
  }
  function txMenu(kind, tx, ctx, anchor) {
    /* «⋮» of the request page */
    const dep = kind === 'deposit';
    const open = !['success', 'cancelled', 'expired'].includes(tx.status);
    const ops = can('operations');
    dropdown(anchor, [
      ops && open && !dep ? { label: tx.deferred ? 'Вернуть в работу' : 'Отложить заявку', icon: 'timer', onclick: async () => { const r = await txAction(kind, tx, tx.deferred ? 'resume' : 'defer', { done: tx.deferred ? 'Возвращено в работу' : 'Отложено' }); if (r) ctx.refresh(); } } : null,
      { label: 'Поиск по ID', icon: 'search', onclick: () => { state.historyFilters = { q: tx.player_id }; state.historyTab = 'all'; go('#/history'); } },
      ops ? { label: 'Изменить', icon: 'edit', onclick: () => txEditSheet(kind, tx, ctx.refresh) } : null,
      ops && open && !dep && tx.status === 'created' ? { label: 'Взять в работу', icon: 'user', onclick: async () => { const r = await txAction(kind, tx, 'take', { done: 'В работе' }); if (r) ctx.refresh(); } } : null,
      ops && open && !dep && tx.autopay_active ? { label: 'Через Optima24', icon: 'send', onclick: async () => { try { const r = await api('/withdrawals/' + tx.id + '/action', { method: 'POST', body: { action: 'autopay' } }); toast(r.message || (r.dry_run ? 'Тест выполнен' : 'Отправлено'), 'ok'); ctx.refresh(); } catch (e2) { err(e2); } } } : null,
      ops && open && !dep && tx.optima_pay_link ? { label: 'Оплатить в Optima24', icon: 'send', onclick: () => window.open(tx.optima_pay_link, '_blank', 'noopener') } : null,
      ops && open && (!dep || tx.status === 'created') ? { label: 'Отменить заявку', icon: 'close', onclick: async () => { const r = dep ? await txAction(kind, tx, 'cancel', { confirm: 'Отменить заявку?', okLabel: 'Отменить', danger: true, done: 'Отменено' }) : await txAction(kind, tx, 'reject', { askReason: 'Причина отмены', done: 'Отменено' }); if (r) ctx.refresh(); } } : null,
      can('users') && ctx.user ? { label: ctx.user.is_blocked ? 'Разблокировать' : 'Заблокировать', icon: 'shield', cls: ctx.user.is_blocked ? '' : 'danger', onclick: async () => { const u = ctx.user; if (u.is_blocked) { if (!(await confirmDialog('Разблокировать клиента?', 'Разблокировать'))) return; try { await api('/users/' + u.id, { method: 'PATCH', body: { is_blocked: false, block_reason: '' } }); toast('Разблокирован', 'ok'); ctx.refresh(); } catch (e) { err(e); } return; } const reason = await promptDialog('Заблокировать клиента', 'Клиент увидит причину'); if (reason === null) return; try { await api('/users/' + u.id, { method: 'PATCH', body: { is_blocked: true, block_reason: reason } }); toast('Заблокирован', 'ok'); ctx.refresh(); } catch (e) { err(e); } } } : null,
    ]);
  }
  function amountBlock(kind, tx, ctx) {
    /* «+119,19» with the pencil → an inline field with ✓ / ✕ (like the reference) */
    const dep = kind === 'deposit';
    const open = !['success', 'cancelled', 'expired'].includes(tx.status) && !(dep && tx.status === 'processing');
    const wrap = h('div');
    const show = () => { wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'req-amount' }, h('div', null, h('b', { class: dep ? 'deposit' : 'withdraw' }, (dep ? '+' : '−') + money(dep ? tx.pay_amount : tx.amount)), dep && tx.amount !== tx.pay_amount ? h('small', null, 'запрос клиента ' + money(tx.amount)) : null, tx.deferred ? h('small', null, 'заявка отложена') : null), can('operations') && open ? h('button', { class: 'pen-btn', type: 'button', 'aria-label': 'Изменить сумму', onclick: edit }, svg('edit', 22)) : null)); };
    const edit = () => {
      const input = h('input', { type: 'number', step: '0.01', inputmode: 'decimal', value: String(dep ? tx.pay_amount : tx.amount) });
      const save = async () => { const v = String(input.value).replace(',', '.').trim(); if (!(Number(v) > 0)) return toast('Введите сумму', 'err'); try { await api('/' + (dep ? 'deposits' : 'withdrawals') + '/' + tx.id + '/edit', { method: 'POST', body: { fields: dep ? { pay_amount: v } : { amount: v } } }); toast('Сохранено', 'ok'); ctx.refresh(); } catch (e) { err(e); } };
      wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'amount-edit' }, input, h('button', { class: 'sq-btn blue', type: 'button', 'aria-label': 'Сохранить', onclick: save }, svg('check', 24)), h('button', { class: 'sq-btn red', type: 'button', 'aria-label': 'Отмена', onclick: show }, svg('close', 24))));
      input.focus(); input.select(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') show(); });
    };
    show(); return wrap;
  }
  function qrBlock(tx, r, ctx) {
    /* withdrawal QR: «Ген QR» (rebuilt with the payout amount) and «Ориг QR» (client's photo / link) */
    const gen = tx.has_generated_qr ? API + '/withdrawals/' + tx.id + '/qr.png?kind=generated' : '';
    const orig = tx.qr_file_url ? API + '/withdrawals/' + tx.id + '/photo' : (tx.qr_payload ? API + '/withdrawals/' + tx.id + '/qr.png?kind=original' : '');
    const tabs = [gen ? ['gen', 'Ген QR'] : null, orig ? ['orig', 'Ориг QR'] : null].filter(Boolean);
    let cur = tabs.length ? tabs[0][0] : '';
    const img = h('img', { class: 'qr-img', alt: 'QR' }); const cap = h('div', { class: 'qr-cap' }); const tabBar = h('div', { class: 'qr-tabs' });
    const links = r.payment_links && r.payment_links.length ? h('div', { class: 'bank-row' }, r.payment_links.map((l) => h('a', { class: 'outline-btn', href: l.url, target: '_blank', rel: 'noopener' }, l.name))) : null;
    const draw = () => {
      tabBar.innerHTML = ''; tabs.forEach(([k, l]) => tabBar.appendChild(h('button', { class: k === cur ? 'active' : '', type: 'button', onclick: () => { cur = k; draw(); } }, l)));
      const src = cur === 'gen' ? gen : orig; img.src = src; img.onclick = () => imageSheet(cur === 'gen' ? 'QR с суммой ' + money(tx.amount) + ' ' + curSign(tx.currency) : 'QR клиента', src);
      cap.textContent = cur === 'gen' ? 'Сумма ' + money(tx.amount) + ' ' + curSign(tx.currency) + ' уже внутри QR' : (tx.qr_file_url ? (tx.qr_decoded ? 'Фото клиента' : 'Фото клиента · QR не распознан') : 'Ссылка клиента' + (tx.bank && tx.bank.name ? ' · ' + tx.bank.name : ''));
      if (links) links.hidden = cur !== 'gen';
    };
    const tools = h('div', { class: 'bank-row' });
    if (!tx.qr_decoded && tx.qr_file_url && can('operations')) tools.appendChild(h('button', { class: 'outline-btn blue', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { await api('/withdrawals/' + tx.id + '/decode-qr', { method: 'POST' }); toast('QR распознан', 'ok'); ctx.refresh(); } catch (ex) { err(ex); } busy(b, false); } }, svg('qr', 16), 'Распознать QR'));
    if (!tx.qr_payload && can('operations')) tools.appendChild(h('button', { class: 'outline-btn', type: 'button', onclick: async () => { const t = await promptDialog('QR или ссылка', 'Вставьте содержимое QR (000201…) или ссылку банка'); if (!t) return; try { await api('/withdrawals/' + tx.id + '/edit', { method: 'POST', body: { fields: { qr_payload: t } } }); toast('Сохранено', 'ok'); ctx.refresh(); } catch (ex) { err(ex); } } }, svg('edit', 16), 'Ввести вручную'));
    if (!tabs.length) return h('div', { class: 'qr-wrap' }, h('div', { class: 'qr-cap' }, 'QR не прикреплён'), tools.childNodes.length ? tools : null);
    draw();
    return h('div', { class: 'qr-wrap' }, tabs.length > 1 ? tabBar : h('div', { style: { height: '14px' } }), img, cap, links, tools.childNodes.length ? tools : null);
  }
  async function pickReceipt(tx, refresh) {
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
  function relatedBlock(tx) {
    /* «Транзакции / Ордера»: bank payments with the searched amount (MacroDroid, почта, выписка) and other requests on it */
    const input = h('input', { placeholder: 'Сумма для поиска...', inputmode: 'decimal', value: String(tx.pay_amount || '') });
    const list = h('div', { class: 'rel-list' }); let tab = 'events';
    const tabs = h('div', { class: 'tabs2' });
    const drawTabs = () => { tabs.innerHTML = ''; [['events', 'Транзакции'], ['orders', 'Ордера']].forEach(([k, l]) => tabs.appendChild(h('button', { class: k === tab ? 'active' : '', type: 'button', onclick: () => { tab = k; drawTabs(); run(); } }, l))); };
    const run = async () => {
      const q = String(input.value).replace(',', '.').trim(); list.innerHTML = '';
      if (!(Number(q) > 0)) return list.appendChild(h('div', { class: 'rel-empty' }, 'Введите сумму'));
      list.appendChild(loader(1));
      try {
        if (tab === 'events') {
          const r = await api('/payment-events?amount=' + encodeURIComponent(q) + '&size=20'); list.innerHTML = '';
          if (!r.items.length) return list.appendChild(h('div', { class: 'rel-empty' }, 'Связанных транзакций не найдено'));
          r.items.forEach((ev) => list.appendChild(h('div', { class: 'rel-row' }, h('div', null, h('b', null, srcLabel(ev.source) + (ev.status === 'matched' ? ' · зачислен' : ev.status === 'unmatched' ? ' · без заявки' : '')), h('small', null, fmtDate(ev.received_at) + (ev.deposit_id ? ' · заявка #' + ev.deposit_id : '') + (ev.raw_text ? ' · ' + String(ev.raw_text).slice(0, 60) : ''))), h('span', { class: 'amt' }, money(ev.amount)))));
        } else {
          const r = await api('/deposits?amount=' + encodeURIComponent(q) + '&size=20'); list.innerHTML = '';
          const items = r.items.filter((x) => x.id !== tx.id);
          if (!items.length) return list.appendChild(h('div', { class: 'rel-empty' }, 'Других ордеров на эту сумму нет'));
          items.forEach((d) => list.appendChild(h('button', { class: 'rel-row', type: 'button', onclick: () => go('#/deposit/' + d.id) }, h('div', null, h('b', null, clientName(d) + ' · ID ' + d.player_id), h('small', null, fmtDate(d.created_at) + ' · ' + txState(d).label)), h('span', { class: 'amt' }, money(d.pay_amount)))));
        }
      } catch (e) { list.innerHTML = ''; list.appendChild(h('div', { class: 'rel-empty' }, e.message)); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    drawTabs(); run();
    return h('div', { class: 'card rel' }, h('div', { class: 'search' }, h('div', { class: 'searchbar' }, svg('search', 22), input), h('button', { class: 'find-btn', type: 'button', onclick: run }, 'Найти')), tabs, list);
  }
  function kvBlock(kind, tx) {
    const dep = kind === 'deposit';
    const closed = ['success', 'cancelled', 'expired'].includes(tx.status);
    const line = (k, v, mono, cls) => h('div', { class: 'kv-line' + (cls ? ' ' + cls : '') }, h('span', { class: 'k' }, k), h('span', { class: 'v' + (mono ? ' mono' : '') }, v === undefined || v === null || v === '' ? '—' : v));
    return h('div', { class: 'card kv' },
      closed && tx.operator_name ? line('Закрыл', tx.operator_name) : null,
      line('Букмекерская контора', h('span', { class: 'chip-plain' }, (tx.cash_name || '—').toUpperCase())),
      line('Идентификатор аккаунта', h('span', { class: 'copy-text', onclick: () => copy(tx.player_id) }, tx.player_id, svg('copy', 16)), true),
      !dep ? line('Код верификации', h('span', { class: 'copy-text', onclick: () => copy(tx.code) }, tx.code || '—'), false, 'hl') : null,
      dep && tx.payment ? line('Платёж', money(tx.payment.amount) + ' с · ' + srcLabel(tx.payment.source) + ' · ' + fmtDate(tx.payment.received_at)) : null,
      line('Создано', fmtDate(tx.created_at)),
      !dep && tx.completed_at ? line('Выполнено', fmtDate(tx.completed_at)) : null,
      tx.error ? line('Комментарий', h('span', { class: 'err-text' }, reasonText(tx.error))) : null);
  }
  function historyBlock(items) {
    items = items || [];
    const list = h('div', { class: 'history-list', hidden: true }, timeline(items));
    const last = items.length ? items[items.length - 1] : null;
    const row = h('button', { class: 'history-row', type: 'button', onclick: () => { list.hidden = !list.hidden; row.classList.toggle('open', !list.hidden); } }, svg('history', 18), h('span', { class: 'k' }, 'История'), h('span', { class: 'v' }, items.length ? items.length + ' · ' + (last.title || '').slice(0, 40) : 'пусто'), svg('chevron', 18));
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
    if (!locked && !dep) extra.appendChild(h('button', { class: 'action-btn blue', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const r = await txAction(kind, tx, 'retry', { done: 'Код проверен' }); busy(b, false); if (r) { s.close(); refresh(); } } }, 'Перепроверить код'));
    if (extra.childNodes.length) body.appendChild(extra);
    const s = sheet({ title: 'Изменить · # ' + txNo(tx), body, actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const fields = {}; for (const [k, el] of Object.entries(f)) { const cur = tx[k] === null || tx[k] === undefined ? '' : String(tx[k]); if (String(el.value) !== cur) fields[k] = el.value; } try { if (Object.keys(fields).length) await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields } }); toast('Сохранено', 'ok'); s.close(); refresh(); } catch (ex) { err(ex); busy(b, false); } } }, 'Сохранить')] });
  }
  function txDetailView(shell, kind, id) {
    const dep = kind === 'deposit';
    const path = dep ? 'deposits' : 'withdrawals';
    const screen = h('section', { class: 'screen detail' }); shell.appendChild(screen);
    const headBox = h('div'); const body = h('div'); screen.appendChild(headBox); screen.appendChild(body); body.appendChild(loader(2));
    let stamp = '';
    const ctx = { refresh: () => load(true), close: () => history.back(), user: null };
    async function load(force) {
      try {
        const r = await api('/' + path + '/' + id);
        if (r.payment_event) r.item.payment = r.item.payment || { kind: 'matched', source: r.payment_event.source, amount: r.payment_event.amount, received_at: r.payment_event.received_at };
        const next = JSON.stringify([r.item.updated_at, r.item.status, r.item.error, r.item.has_receipt, r.item.deferred, r.item.needs_attention, (r.history || []).length, r.item.payment, r.user && r.user.is_blocked, r.user && r.user.note]);
        if (!force && next === stamp) return;
        stamp = next;
        const tx = r.item; const u = r.user || {}; ctx.user = r.user;
        /* header: back · client pill · chat · ⋮ */
        const tools = h('div', { class: 'd-tools' });
        tools.appendChild(h('button', { class: 'round-btn circle blue', type: 'button', 'aria-label': 'Чат', onclick: () => openChat(tx.user_id) }, svg('chat', 22), tx.needs_attention && tx.status !== 'success' ? h('span', { class: 'dot' }) : null));
        tools.appendChild(h('button', { class: 'round-btn circle', type: 'button', 'aria-label': 'Меню', onclick: () => txMenu(kind, tx, ctx, tools) }, svg('more', 22)));
        headBox.innerHTML = '';
        headBox.appendChild(h('header', { class: 'd-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: backTo('#/home') }, svg('back', 24)), h('button', { class: 'who-pill', type: 'button', onclick: () => go('#/users/' + tx.user_id) }, h('i', null, svg('user', 16)), h('span', null, clientName(tx))), tools));
        body.innerHTML = '';
        if (u.note) body.appendChild(h('div', { class: 'note pink' }, h('b', null, 'Комментарий профиля:'), u.note));
        if ((tx.status === 'failed' || tx.needs_attention) && tx.error && tx.status !== 'success') body.appendChild(h('div', { class: 'note pink' }, reasonText(tx.error)));
        const card = h('div', { class: 'card req' });
        if (dep) {
          const noteEl = tx.payment ? h('div', { class: 'note ' + (tx.payment.kind === 'matched' ? 'green' : 'amber') }, (tx.payment.kind === 'matched' ? 'Платёж получен: ' : 'Есть платёж на эту сумму: ') + money(tx.payment.amount) + ' с · ' + srcLabel(tx.payment.source)) : (tx.status === 'created' ? h('div', { class: 'note green' }, 'Ожидаем оплату клиента, проверьте поступление') : h('div'));
          card.appendChild(h('div', { class: 'req-note-row' }, noteEl, can('support') ? h('button', { class: 'chat-btn', type: 'button', onclick: () => openChat(tx.user_id) }, svg('send', 22), 'Чат') : h('span')));
          card.appendChild(h('div', { class: 'req-top' }, h('div', { style: { minWidth: 0 } }, h('div', { class: 'req-id' }, h('span', null, tx.player_id), copyBtn(tx.player_id)), h('div', { class: 'req-date' }, fmtDate(tx.created_at))), h('div', { class: 'req-side' }, statusPill(tx), tx.has_receipt ? h('button', { class: 'doc-btn', type: 'button', 'aria-label': 'Чек', onclick: () => imageSheet('Чек клиента', API + '/deposits/' + tx.id + '/receipt', fmtDate(tx.receipt_at)) }, svg('doc', 22)) : null)));
          card.appendChild(amountBlock(kind, tx, ctx));
        } else {
          card.appendChild(h('div', { class: 'req-top' }, h('div', { class: 'req-bank' }, h('span', { class: 'logo' }, bankLogo(tx.bank)), h('div', { style: { minWidth: 0 } }, h('div', { class: 'req-id' }, h('span', null, tx.player_id), copyBtn(tx.player_id)), h('div', { class: 'req-date' }, fmtDate(tx.created_at)))), h('div', { class: 'req-side' }, statusPill(tx), h('b', { class: 'req-withdraw-amt' }, '-' + money0(tx.amount)), tx.has_receipt ? h('button', { class: 'doc-btn', type: 'button', 'aria-label': 'Чек', onclick: () => imageSheet('Чек перевода', API + '/withdrawals/' + tx.id + '/receipt', fmtDate(tx.receipt_at)) }, svg('doc', 22)) : null)));
          card.appendChild(qrBlock(tx, r, ctx));
          const open = !['success', 'cancelled', 'expired'].includes(tx.status);
          if (can('operations') && open) card.appendChild(h('div', { style: { textAlign: 'center' } }, tx.has_receipt ? h('button', { class: 'upload-btn done', type: 'button', onclick: () => pickReceipt(tx, ctx.refresh) }, svg('check', 20), 'Чек прикреплён · заменить') : h('button', { class: 'upload-btn', type: 'button', onclick: () => pickReceipt(tx, ctx.refresh) }, svg('upload', 20), 'Загрузить чек')));
        }
        body.appendChild(card);
        if (dep) body.appendChild(relatedBlock(tx));
        body.appendChild(kvBlock(kind, tx));
        body.appendChild(historyBlock(r.history));
        const hist = h('div', { class: 'client-hist' }); body.appendChild(hist);
        Promise.all([api('/deposits?user_id=' + tx.user_id + '&size=10'), api('/withdrawals?user_id=' + tx.user_id + '&size=10')]).then(([d, w]) => { const list = [...d.items, ...w.items].filter((x) => !(x.kind === kind && x.id === tx.id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10); if (list.length) hist.appendChild(txGroups(list, { noAlert: true })); }).catch(() => {});
        const bar = txActions(kind, tx, ctx); const oldBar = screen.querySelector('.action-bar'); if (oldBar) oldBar.remove(); if (bar) screen.appendChild(bar);
      } catch (e) { body.innerHTML = ''; headBox.innerHTML = ''; headBox.appendChild(topbar(dep ? 'Пополнение' : 'Вывод', { back: backTo('#/home') })); body.appendChild(empty('Ошибка', e.message)); }
    }
    load(true); watchChanges(screen, () => load(false));
  }

  /* ------------------------------------------------------------- client profile */
  function userDetailView(shell, id) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(topbar('Профиль', { back: backTo('#/search') }));
    const box = h('div', null, loader()); screen.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/users/' + id); const u = r.item; box.innerHTML = '';
        const patch = (body) => api('/users/' + u.id, { method: 'PATCH', body });
        box.appendChild(h('div', { class: 'card profile' },
          h('div', { class: 'profile-top' }, avatarEl(u.name, u.avatar_url, 'round'), h('div', null, h('b', null, u.name || 'Клиент'), h('span', { class: 'st' + (u.is_blocked ? ' off' : '') }, h('i'), u.is_blocked ? 'Заблокирован' : 'Активен'))),
          h('div', { class: 'prow' }, 'Пополнений', h('b', null, (u.deposits_count || 0) + ' / ' + money(u.deposits_sum))),
          h('div', { class: 'prow' }, 'Выводов', h('b', null, (u.withdrawals_count || 0) + ' / ' + money(u.withdrawals_sum))),
          can('support') ? h('button', { class: 'green-btn', type: 'button', onclick: () => openChat(u.id) }, 'Чат с оператором') : null));
        box.appendChild(h('button', { class: 'card note-card', type: 'button', onclick: async () => { if (!can('users')) return; const t = await promptDialog('Заметка', 'Видна только операторам', '', u.note || ''); if (t === null) return; try { await patch({ note: t }); toast('Сохранено', 'ok'); draw(); } catch (e) { err(e); } } }, h('div', { class: 'top' }, h('b', null, 'Заметка'), svg('edit', 24)), h('p', { class: u.note ? 'has' : '' }, u.note || 'Нажмите на иконку редактирования, чтобы добавить заметку о пользователе')));
        box.appendChild(h('div', { class: 'card shield-row' }, svg('shield', 30), h('div', null, h('b', null, u.is_blocked ? 'Заблокирован' : 'Активен'), h('small', null, u.is_blocked ? (u.block_reason || 'Операции недоступны') : 'Все операции доступны')), switchEl(!u.is_blocked, async (v) => { if (!can('users')) throw new Error('Нет доступа'); let reason = ''; if (!v) { reason = await promptDialog('Причина блокировки', 'Клиент увидит причину'); if (reason === null) throw new Error('__cancel__'); } await patch({ is_blocked: !v, block_reason: reason }); setTimeout(draw, 150); })));
        const txs = [...r.deposits, ...r.withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        box.appendChild(txs.length ? txGroups(txs, { noAlert: true }) : empty('Заявок нет', '', 'history'));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- menu: account, theme, sections (operators see only what they need) */
  const MENU = [['stats', 'stats', 'Аналитика', 'blue', 'view'], ['quick', 'bolt', 'Быстрые ответы', 'yellow', 'support'], ['wallets', 'qr', 'Кошельки', 'purple', 'settings'], ['settings', 'settings', 'Настройки', 'gray', 'settings'], ['logs', 'terminal', 'Логи', 'red', 'logs'], ['broadcast', 'send', 'Рассылки', 'teal', 'settings'], ['statements', 'note', 'Выписки', 'blue', 'settings'], ['cashes', 'wallet', 'Кассы', 'green', 'cashes'], ['security', 'shield', 'Безопасность', 'teal', 'settings']];
  const ROLE_LABEL = { owner: 'Владелец', admin: 'Администратор', operator: 'Оператор', viewer: 'Просмотр' };
  function menuView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const a = state.admin;
    screen.appendChild(h('div', { class: 'card account' }, avatarEl(a.name || a.username, ''), h('div', null, h('b', null, a.name || a.username), h('small', null, '@' + a.username + ' · ' + (ROLE_LABEL[a.role] || a.role)))));
    screen.appendChild(h('div', { class: 'card theme-row' }, h('b', null, 'Тема'), segEl([['light', 'Светлая'], ['dark', 'Тёмная']], themeName(), (k) => { applyTheme(k); render(); }, 'light')));
    const rows = MENU.filter((m) => can(m[4]));
    screen.appendChild(h('div', { class: 'card menu-card' }, rows.map((m) => h('button', { class: 'menu-row', type: 'button', onclick: () => go('#/' + m[0]) }, h('span', { class: 'ico menu-color ' + m[3] }, svg(m[1], 22)), m[2], h('span', { class: 'chev' }, svg('chevron', 20))))));
    screen.appendChild(h('div', { class: 'card menu-card' }, h('button', { class: 'menu-row danger', type: 'button', onclick: logout }, h('span', { class: 'ico menu-color red' }, svg('logout', 22)), 'Выйти')));
  }

  /* ------------------------------------------------------------- analytics (Аналитика) */
  async function statsView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const st = { from: '', to: '', label: 'Выбрать период' };
    const box = h('div'); screen.appendChild(hero('Аналитика', 'Финансовые показатели', { tools: [h('span', { class: 'round-btn soft' }, svg('stats', 26))] })); screen.appendChild(box);
    const pickPeriod = () => {
      const from = h('input', { class: 'input', type: 'date', value: st.from }); const to = h('input', { class: 'input', type: 'date', value: st.to });
      const quick = (days, label) => h('button', { class: 'action-btn', type: 'button', onclick: () => { const t = new Date(); const f = new Date(Date.now() - (days - 1) * 86400000); st.from = dayKey(f); st.to = dayKey(t); st.label = label; s.close(); draw(); } }, label);
      const s = sheet({ title: 'Период', body: h('div', null, h('div', { class: 'btn-grid' }, quick(1, 'Сегодня'), quick(7, '7 дней'), quick(30, '30 дней'), h('button', { class: 'action-btn', type: 'button', onclick: () => { st.from = ''; st.to = ''; st.label = 'Выбрать период'; s.close(); draw(); } }, 'Всё время')), h('span', { class: 'lbl' }, 'Свой период'), h('div', { class: 'date-grid' }, from, to)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { st.from = from.value; st.to = to.value; st.label = (from.value || '…') + ' — ' + (to.value || '…'); s.close(); draw(); } }, 'Применить')] });
    };
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(h('button', { class: 'period-btn', type: 'button', onclick: pickPeriod }, svg('calendar', 24), st.label)); box.appendChild(loader(2));
      try {
        const qs = (st.from || st.to) ? '?date_from=' + st.from + '&date_to=' + st.to : '?date_from=2000-01-01';
        const [r, cs] = await Promise.all([api('/stats' + qs), api('/cashes').catch(() => ({ items: [] }))]);
        box.innerHTML = ''; box.appendChild(h('button', { class: 'period-btn', type: 'button', onclick: pickPeriod }, svg('calendar', 24), st.label));
        const cashes = cs.items || []; const feeOf = (name) => cashes.find((c) => c.name === name) || {};
        const incomeOf = (c) => { const f = feeOf(c.name); return Number(c.deposits_sum) * (Number(f.deposit_fee_pct) || 0) / 100 + Number(c.withdrawals_sum) * (Number(f.withdraw_fee_pct) || 0) / 100; };
        const income = r.by_cash.reduce((a, c) => a + incomeOf(c), 0);
        const limit = cashes.reduce((a, c) => a + (c.last_balance !== null && c.last_balance !== undefined ? Number(c.last_balance) : 0), 0);
        const turnover = Number(r.deposits_sum) + Number(r.withdrawals_sum);
        const usd = Number(r.usd_rate) > 0 ? income / Number(r.usd_rate) : 0;
        box.appendChild(h('div', { class: 'dark-card' }, h('div', { class: 'cap' }, 'Приблизительный доход'), h('div', { class: 'big' }, money0(income) + ' с'), h('div', { class: 'sub' }, '~ ' + money0(usd) + ' $'), h('div', { class: 'grid' }, h('div', null, h('small', null, 'Выведено наличных'), h('b', null, money0(r.withdrawals_sum) + ' с')), h('div', null, h('small', null, 'Суммарный лимит'), h('b', null, money0(limit) + ' с')))));
        box.appendChild(h('div', { class: 'stat2' }, h('div', { class: 'card stat-card green' }, h('div', { class: 'ico' }, svg('arrowUR', 22)), h('div', { class: 'l' }, 'Пополнения'), h('div', { class: 'v' }, money0(r.deposits_sum) + ' с'), h('span', { class: 'chip' }, r.deposits_count + ' транзакций')), h('div', { class: 'card stat-card red' }, h('div', { class: 'ico' }, svg('arrowDL', 22)), h('div', { class: 'l' }, 'Выводы'), h('div', { class: 'v' }, money0(r.withdrawals_sum) + ' с'), h('span', { class: 'chip' }, r.withdrawals_count + ' транзакций'))));
        box.appendChild(h('div', { class: 'card list-card' }, h('div', { class: 'cap' }, svg('layers', 18), 'Лимиты шлюзов'), cashes.length ? cashes.map((c) => h('div', { class: 'kv-row' }, c.name, h('span', { class: 'amt' }, c.last_balance !== null && c.last_balance !== undefined ? money0(c.last_balance) + ' с' : '—'))) : h('div', { class: 'muted' }, 'Касс нет'), h('div', { class: 'kv-row hl' }, h('span', { class: 'lbl-ico' }, svg('wallet', 20), 'Баланс · оборот кассы'), h('span', { class: 'amt' }, money0(turnover) + ' с'))));
        box.appendChild(h('div', { class: 'section-cap' }, 'Разбивка по шлюзам'));
        r.by_cash.forEach((c) => box.appendChild(h('div', { class: 'card gw-card' }, h('div', { class: 'head' }, h('b', null, c.name), h('span', { class: 'income' }, 'Доход: ' + money0(incomeOf(c)) + ' с')), h('div', { class: 'cols' }, h('div', null, h('small', null, 'Ввод'), h('b', null, money0(c.deposits_sum) + ' с'), h('em', null, c.deposits_count + ' операций')), h('div', null, h('small', null, 'Вывод'), h('b', null, money0(c.withdrawals_sum) + ' с'), h('em', null, c.withdrawals_count + ' операций'))), h('div', { class: 'foot' }, 'Оборот кассы:', h('b', null, money0(Number(c.deposits_sum) + Number(c.withdrawals_sum)) + ' с')))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- wallets (Кошельки) */
  async function walletsView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const box = h('div', null, loader()); let cashes = { items: [] };
    screen.appendChild(hero('Кошельки', '', { icon: 'wallet', tools: [h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Обновить', onclick: () => draw() }, svg('refresh', 24)), h('button', { class: 'add-btn', type: 'button', onclick: () => requisiteForm(null) }, svg('plus', 20), 'Добавить')] }));
    screen.appendChild(box);
    const draw = async () => {
      try {
        const [rq, cs] = await Promise.all([api('/requisites'), api('/cashes')]); cashes = cs; box.innerHTML = '';
        if (!rq.items.length) box.appendChild(empty('Кошельков нет', 'Добавьте QR банка — на него будут платить клиенты', 'wallet'));
        rq.items.forEach((q) => {
          const bank = bankOf((q.bank_type || '') + ' ' + (q.bank_name || ''));
          box.appendChild(h('div', { class: 'card wallet' + (q.enabled ? '' : ' off') },
            h('button', { class: 'wallet-main', type: 'button', onclick: () => requisiteForm(q) }, h('span', { class: 'logo' }, bankLogo(bank)), h('div', null, h('b', null, q.name), h('small', null, bank.name || q.bank_name || 'Банк'))),
            h('button', { class: 'wallet-del', type: 'button', 'aria-label': 'Удалить', onclick: async () => { if (await confirmDialog('Удалить кошелёк ' + q.name + '?', 'Удалить', true)) { try { await api('/requisites/' + q.id, { method: 'DELETE' }); toast('Удалено', 'ok'); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 24))));
        });
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    function requisiteForm(q) {
      const isNew = !q; q = q || { name: '', priority: 100, enabled: true, notes: '', cash_id: null };
      const name = h('input', { class: 'input', placeholder: 'напр. Optima основной', value: q.name });
      const priority = h('input', { class: 'input', type: 'number', value: q.priority });
      const cashSel = h('select', { class: 'select' }, h('option', { value: '', selected: !q.cash_id }, 'Все кассы'), cashes.items.map((c) => h('option', { value: c.id, selected: c.id === q.cash_id }, c.name)));
      const src = h('textarea', { class: 'textarea', placeholder: isNew ? 'ELQR (000201…) или ссылка банка' : 'Пусто = оставить текущий QR' });
      const file = h('input', { type: 'file', accept: 'image/*', class: 'input' });
      let enabled = !!q.enabled;
      file.onchange = async () => { const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/requisites/upload', { method: 'POST', body: fd }); src.value = rr.source; toast('QR распознан: ' + rr.meta.bank_name, 'ok'); } catch (ex) { err(ex); } };
      const s = sheet({ title: isNew ? 'Новый кошелёк' : q.name, body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), name), isNew ? null : h('div', { class: 'toggle-pill' }, h('div', null, 'Включён'), switchEl(enabled, async (v) => { enabled = v; })), h('div', { class: 'stat-grid' }, h('label', { class: 'field' }, h('span', null, 'Приоритет'), priority), h('label', { class: 'field' }, h('span', null, 'Касса'), cashSel)), h('label', { class: 'field' }, h('span', null, isNew ? 'QR / ссылка' : 'Заменить QR / ссылку'), src), h('label', { class: 'field' }, h('span', null, 'или изображение QR'), file)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { const body = { name: name.value, priority: Number(priority.value || 100), cash_id: cashSel.value ? Number(cashSel.value) : 0, notes: q.notes || '', enabled }; if (src.value.trim()) body.source = src.value.trim(); try { if (isNew) { if (!body.source) return toast('Укажите QR или ссылку', 'err'); await api('/requisites', { method: 'POST', body }); } else await api('/requisites/' + q.id, { method: 'PATCH', body }); toast('Сохранено', 'ok'); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Сохранить')] });
    }
    draw();
  }

  /* ------------------------------------------------------------- logs (Логи) */
  function logsView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const st = { kind: state.route.id === 'audit' ? 'audit' : 'system', page: 1 };
    const list = h('div'); const segBox = h('div', { style: { marginBottom: '16px' } });
    const iconOf = (l) => { const cat = String(l.category || ''); const lv = String(l.level || ''); if (lv === 'error' || lv === 'critical') return ['red', 'alert']; if (lv === 'warning') return ['amber', 'alert']; if (cat === 'payments' || cat === 'deposits' || cat === 'statements') return ['green', 'arrowDL']; if (cat === 'withdrawals' || cat === 'autopay') return ['red', 'arrowUR']; if (cat === 'support') return ['blue', 'chat']; if (cat === 'users') return ['blue', 'user']; if (cat === 'cashes') return ['blue', 'bank']; return ['', 'terminal']; };
    const amountOf = (l) => { const m = String(l.detail || '').match(/(\d[\d\s]*[.,]\d{2}|\d{3,})\s*(?:KGS|сом|с\b)/); return m ? m[1] : ''; };
    async function load() {
      segBox.innerHTML = ''; segBox.appendChild(segEl([['system', 'События'], ['audit', 'Действия']], st.kind, (k) => { st.kind = k; st.page = 1; history.replaceState(null, '', '#/logs/' + k); load(); }, 'light'));
      list.innerHTML = ''; list.appendChild(loader(4));
      try {
        const r = await api('/logs?kind=' + st.kind + '&page=' + st.page + '&size=40');
        list.innerHTML = '';
        if (!r.items.length) return list.appendChild(empty('Записей нет', '', 'bell'));
        list.appendChild(h('div', { class: 'card log-card' }, r.items.map((l) => { if (st.kind === 'system') { const [cls, ic] = iconOf(l); const amt = amountOf(l); return h('div', { class: 'log-row' }, h('span', { class: 'ico ' + cls }, svg(ic, 24)), h('div', null, h('b', null, l.title), h('small', null, (l.detail || '').slice(0, 140))), h('div', { class: 'side' }, amt ? h('b', { class: cls === 'red' ? 'red' : '' }, amt) : null, h('small', null, fmtDate(l.created_at)))); } return h('div', { class: 'log-row' }, h('span', { class: 'ico' }, avatarEl(l.actor, '', 'round')), h('div', null, h('b', null, l.action), h('small', null, l.actor + (l.entity_type ? ' · ' + l.entity_type + ' ' + (l.entity_id || '') : ''))), h('div', { class: 'side' }, h('small', null, fmtDate(l.created_at)))); })));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; load(); }); if (p) list.appendChild(p);
      } catch (e) { list.innerHTML = ''; list.appendChild(empty('Ошибка', e.message)); }
    }
    screen.appendChild(h('div', { class: 'title-only' }, 'Логи')); screen.appendChild(segBox); screen.appendChild(list);
    load();
  }

  /* ------------------------------------------------------------- broadcast (Рассылки) */
  async function broadcastView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(hero('Рассылки', 'Отправка сообщений пользователям', { back: backTo('#/menu') }));
    const box = h('div'); screen.appendChild(box);
    const st = { bot: 'main', photo: '', testChat: '' };
    const text = h('textarea', { class: 'textarea', placeholder: 'Текст сообщения...' });
    const botSel = h('select', { class: 'select' }, [['main', 'Основной бот'], ['support', 'Бот поддержки']].map(([v, l]) => h('option', { value: v }, l))); botSel.onchange = () => { st.bot = botSel.value; };
    const countEl = h('b', null, '…');
    const testInput = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'ID получателя (Telegram)', oninput: (e) => { st.testChat = e.target.value.trim(); } });
    const loadCount = async () => { countEl.textContent = '…'; try { const r = await api('/broadcast/audience?audience=all'); countEl.textContent = r.count; if (r.test_chat_id && !testInput.value) { testInput.value = r.test_chat_id; st.testChat = String(r.test_chat_id); } } catch (e) { countEl.textContent = '—'; } };
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const photoBox = h('button', { class: 'drop-image', type: 'button', onclick: () => file.click() });
    const drawPhoto = () => { photoBox.innerHTML = ''; if (st.photo) { photoBox.appendChild(h('img', { src: fileUrl(st.photo), alt: '' })); photoBox.appendChild(h('small', null, 'нажмите, чтобы заменить')); photoBox.appendChild(h('span', { class: 'outline-btn danger', onclick: (e) => { e.stopPropagation(); st.photo = ''; drawPhoto(); } }, svg('trash', 16), 'Убрать')); } else { photoBox.appendChild(svg('image', 48)); photoBox.appendChild(document.createTextNode('Нажмите, чтобы добавить картинку')); photoBox.appendChild(h('small', null, 'PNG, JPG до ~10 МБ')); } };
    file.onchange = async () => { if (!file.files[0]) return; const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/support/upload', { method: 'POST', body: fd }); st.photo = rr.url; drawPhoto(); } catch (ex) { err(ex); } file.value = ''; };
    const send = async (test) => {
      if (!text.value.trim()) return toast('Введите текст', 'err');
      if (test && !st.testChat) return toast('Укажите Telegram ID для теста', 'err');
      if (!test && !(await confirmDialog('Отправить всем клиентам через ' + (st.bot === 'support' ? 'бот поддержки' : 'основной бот') + '?', 'Отправить'))) return;
      const b = test ? testBtn : sendBtn; busy(b, true);
      try { const r = await api('/broadcast', { method: 'POST', body: { text: text.value, photo_url: st.photo, bot: st.bot, audience: test ? 'test' : 'all', buttons: [], test_chat_id: test ? st.testChat : null } }); toast(r.test ? 'Тест отправлен в бот' : 'В очереди · ' + r.recipients + ' получателей. Отправка идёт в фоне', 'ok', 4000); if (!r.test) { text.value = ''; st.photo = ''; drawPhoto(); sendBtn.classList.remove('ready'); loadHistory(); } buzz(); } catch (ex) { err(ex); }
      busy(b, false);
    };
    const testBtn = h('button', { class: 'test-btn', type: 'button', onclick: () => send(true) }, 'Тест');
    const sendBtn = h('button', { class: 'send-wide', type: 'button', onclick: () => send(false) }, svg('send', 22), 'Отправить');
    text.addEventListener('input', () => sendBtn.classList.toggle('ready', !!text.value.trim()));
    const histBox = h('div');
    const BSTATUS = { queued: ['В очереди', 'blue'], sending: ['Отправляется', 'blue'], delivering: ['Отправляется', 'blue'], done: ['Готово', 'success'], failed: ['Ошибка', 'problem'] };
    let histTimer = null;
    const loadHistory = async () => {
      try {
        const r = await api('/broadcast/history?limit=30');
        histBox.innerHTML = ''; histBox.appendChild(h('div', { class: 'h2' }, 'История рассылок'));
        if (!r.items.length) { histBox.appendChild(empty('Рассылок ещё не было', '', 'bell')); return; }
        r.items.forEach((b) => { const [label, cls] = BSTATUS[b.status] || [b.status, '']; const running = ['queued', 'sending', 'delivering'].includes(b.status); histBox.appendChild(h('button', { class: 'card bc-item', onclick: () => openBroadcast(b.id) }, h('div', { class: 'top' }, h('span', { class: 'ico' }, svg('menu', 22)), h('b', null, (b.bot === 'support' ? 'Поддержка' : 'Бот') + ' | ' + (running ? label : 'Всем')), running ? h('span', { class: 'status ' + cls }, h('i'), label) : svg('eye', 22)), h('div', { class: 'txt' }, (b.text || '').slice(0, 400) || (b.photo_url ? 'Фото' : '—')), h('div', { class: 'meta' }, h('span', null, svg('users', 18), b.sent + ' отправлено' + (b.failed ? ' · ошибок ' + b.failed : '')), h('span', null, svg('calendar', 18), fmtDate(b.created_at)), running ? h('span', { class: 'bc-bar' }, h('i', { style: { width: (b.recipients ? Math.round(((b.sent + b.failed) / b.recipients) * 100) : 0) + '%' } })) : null))); });
        const active = r.items.some((b) => ['queued', 'sending', 'delivering'].includes(b.status));
        clearTimeout(histTimer); if (active && document.body.contains(histBox)) histTimer = setTimeout(loadHistory, 3000);
      } catch (e) { /* silent */ }
    };
    async function openBroadcast(id) {
      const s = sheet({ title: 'Рассылка #' + id, body: loader(2) });
      try {
        const r = await api('/broadcast/' + id); const b = r.item; const [label, cls] = BSTATUS[b.status] || [b.status, ''];
        s.setBody(h('div', null, h('div', { class: 'bc-stats', style: { marginBottom: '10px' } }, h('span', { class: 'status ' + cls }, h('i'), label), h('span', { class: 'pill' }, 'получателей ' + b.recipients), h('span', { class: 'pill green' }, 'отправлено ' + b.sent), h('span', { class: 'pill ' + (b.failed ? 'red' : '') }, 'ошибок ' + b.failed)), kv([['Создана', fmtDate(b.created_at)], ['Завершена', b.finished_at ? fmtDate(b.finished_at) : '—'], ['Бот', b.bot === 'support' ? 'Бот поддержки' : 'Основной бот'], ['Оператор', b.admin_name || '—'], b.error ? ['Ошибка', h('span', { class: 'err-text' }, b.error)] : null]), h('div', { class: 'bubble', style: { maxWidth: '100%', marginTop: '12px' } }, b.photo_url ? h('img', { src: fileUrl(b.photo_url), alt: '' }) : null, h('span', { class: 'txt' }, b.text)), b.errors && b.errors.length ? h('div', { style: { marginTop: '12px' } }, h('div', { class: 'section-title' }, h('h2', null, 'Ошибки доставки')), b.errors.map((e) => h('div', { class: 'setting-row' }, h('div', null, h('b', null, e.error), h('small', null, e.count + ' получателей'))))) : null));
      } catch (e) { s.setBody(empty('Ошибка', e.message)); }
    }
    drawPhoto();
    box.appendChild(h('div', { class: 'card sect' }, h('div', { class: 'sect-head' }, h('span', { class: 'ico sq' }, svg('send', 24)), h('b', null, 'Новая рассылка')), h('div', { class: 'sect-body' }, h('span', { class: 'lbl' }, 'Бот'), botSel, h('span', { class: 'lbl' }, 'Сообщение'), text, h('span', { class: 'lbl' }, 'Изображение'), photoBox, file, h('div', { class: 'test-box' }, h('b', null, svg('flask', 18), 'Тестовая отправка'), h('div', { class: 'row' }, testInput, testBtn)), h('div', { class: 'bc-foot' }, h('span', { class: 'cnt' }, svg('users', 22), 'Получателей: ', countEl), sendBtn))));
    box.appendChild(histBox);
    loadCount(); loadHistory();
  }

  /* ------------------------------------------------------------- settings (Настройки): four tabs, one big save */
  async function settingsView(shell) {
    if (state.route.id === 'advanced') return advancedSettingsView(shell, state.route.sub);
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(hero('Настройки', 'Управление системой', { icon: 'settings' }));
    const box = h('div', null, loader()); screen.appendChild(box);
    let tab = state.settingsTab || 'main';
    const TABS = [['main', 'clock', 'Основные'], ['sites', 'globe', 'Сайты'], ['withdraw', 'arrowUR', 'Выводы'], ['deposit', 'arrowDL', 'Попол.']];
    const draw = async () => {
      try {
        const [r, cashes, banks, rq] = await Promise.all([api('/settings'), api('/cashes'), api('/bank-links').catch(() => ({ items: [] })), api('/requisites').catch(() => ({ items: [] }))]);
        const v = r.values; box.innerHTML = '';
        const save = async (vals) => { await api('/settings', { method: 'POST', body: { values: vals } }); Object.assign(v, vals); toast('Сохранено', 'ok', 1200); };
        const toggle = (label, on, fn, sub) => h('div', { class: 'toggle-pill' }, h('div', null, label, sub ? h('small', null, sub) : null), switchEl(!!on, fn));
        const sect = (icon, title, ...kids) => h('div', { class: 'card sect' }, h('div', { class: 'sect-head' }, h('span', { class: 'ico' }, svg(icon, 22)), h('b', null, title)), h('div', { class: 'sect-body' }, ...kids));
        const saveBtn = (fields) => h('button', { class: 'save-btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { const vals = {}; for (const [k, el] of Object.entries(fields || {})) vals[k] = el.value; await save(vals); } catch (ex) { err(ex); } busy(b, false); } }, svg('save', 24), 'Сохранить настройки');
        const num = (key) => h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: v[key] === null || v[key] === undefined ? '' : String(v[key]) });
        const txt = (key, ph) => h('input', { class: 'input', value: v[key] || '', placeholder: ph || '' });
        box.appendChild(h('div', { class: 'tabs4' }, TABS.map(([k, ic, l]) => h('button', { class: k === tab ? 'active' : '', type: 'button', onclick: () => { tab = k; state.settingsTab = k; draw(); } }, svg(ic, 22), l))));
        if (tab === 'main') {
          const f = { support_username: txt('support_username', '@PayOperator_bot'), subscription_channel: txt('subscription_channel', '@PayGoX') };
          const chips = h('div', { class: 'chips-box' });
          const drawChips = () => { chips.innerHTML = ''; if (!rq.items.length) chips.appendChild(h('small', { class: 'muted' }, 'Кошельков нет — раздел «Кошельки»')); rq.items.forEach((q) => chips.appendChild(h('span', { class: 'chip-x' + (q.enabled ? '' : ' off') }, q.name, h('button', { type: 'button', 'aria-label': q.enabled ? 'Выключить' : 'Включить', onclick: async () => { try { await api('/requisites/' + q.id, { method: 'PATCH', body: { enabled: !q.enabled } }); q.enabled = !q.enabled; drawChips(); toast('Сохранено', 'ok', 1200); } catch (ex) { err(ex); } } }, svg(q.enabled ? 'close' : 'plus', 16))))); };
          drawChips();
          box.appendChild(sect('clock', 'Основные настройки',
            toggle('Пауза', v.bot_paused, (on) => save({ bot_paused: on })),
            toggle('Заявки без чеков', !v.receipt_request_enabled, (on) => save({ receipt_request_enabled: !on })),
            h('span', { class: 'lbl' }, 'Оператор'), f.support_username,
            toggle('Включить подписку на канал', v.subscription_enabled, (on) => save({ subscription_enabled: on })),
            h('span', { class: 'lbl' }, 'Название канала'), f.subscription_channel,
            h('span', { class: 'lbl' }, 'Выберите реквизит'), chips));
          box.appendChild(saveBtn(f));
          const links = [['#/settings/advanced/bot', 'settings', 'Расширенные настройки'], ['#/cashes', 'wallet', 'Кассы'], ['#/macrodroid', 'bolt', 'MacroDroid'], ['#/push', 'bell', 'Push-уведомления'], ['#/env', 'terminal', 'Сервер']];
          box.appendChild(h('div', { class: 'card menu-card' }, links.map(([href, icon, title]) => h('button', { class: 'menu-row', type: 'button', onclick: () => go(href) }, h('span', { class: 'ico menu-color blue' }, svg(icon, 22)), title, h('span', { class: 'chev' }, svg('chevron', 20))))));
        } else if (tab === 'sites') {
          const body = [];
          if (!cashes.items.length) body.push(h('small', { class: 'muted' }, 'Касс нет — добавьте в разделе «Кассы»'));
          cashes.items.forEach((c) => { const patch = async (b) => { try { await api('/cashes/' + c.id, { method: 'PATCH', body: b }); Object.assign(c, b); toast('Сохранено', 'ok', 1200); draw(); } catch (ex) { err(ex); } }; body.push(h('div', { class: 'site-box' }, h('div', { class: 'name' + (c.enabled ? '' : ' off') }, c.name + (c.auto_disabled ? ' · автостоп' : ''), h('button', { type: 'button', 'aria-label': 'Включить / выключить кассу', onclick: () => patch({ enabled: !c.enabled }) }, h('i', null, svg('check', 16)))), h('div', { class: 'check-grid' }, h('button', { class: 'check-pill' + (c.deposit_enabled ? '' : ' off'), type: 'button', onclick: () => patch({ deposit_enabled: !c.deposit_enabled }) }, h('span', null, 'Пополнения'), h('i', null, svg('check', 16))), h('button', { class: 'check-pill' + (c.withdraw_enabled ? '' : ' off'), type: 'button', onclick: () => patch({ withdraw_enabled: !c.withdraw_enabled }) }, h('span', null, 'Выводы'), h('i', null, svg('check', 16)))))); });
          box.appendChild(sect('globe', 'Настройки сайтов', ...body));
          box.appendChild(saveBtn({}));
        } else if (tab === 'withdraw') {
          const disabled = new Set(String(v.withdraw_banks_disabled || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
          const grid = h('div', { class: 'check-grid' });
          const drawBanks = () => { grid.innerHTML = ''; WITHDRAW_BANKS.forEach(([key, name]) => grid.appendChild(h('button', { class: 'check-pill' + (disabled.has(key) ? ' off' : ''), type: 'button', onclick: async () => { if (disabled.has(key)) disabled.delete(key); else disabled.add(key); try { await save({ withdraw_banks_disabled: Array.from(disabled).join(',') }); } catch (ex) { err(ex); } drawBanks(); } }, h('span', null, name), h('i', null, svg('check', 16))))); };
          drawBanks();
          const f = { withdraw_receipt_min: num('withdraw_receipt_min') };
          box.appendChild(sect('arrowUR', 'Настройки выводов', toggle('Включить выводы', v.withdrawals_enabled, (on) => save({ withdrawals_enabled: on })), grid, h('span', { class: 'lbl' }, 'Чек перевода обязателен от суммы'), f.withdraw_receipt_min));
          box.appendChild(saveBtn(f));
        } else {
          const grid = h('div', { class: 'check-grid' });
          const drawBanks = () => { grid.innerHTML = ''; if (!banks.items.length) grid.appendChild(h('small', { class: 'muted' }, 'Кнопок банков нет')); banks.items.forEach((l) => grid.appendChild(h('button', { class: 'check-pill' + (l.enabled ? '' : ' off'), type: 'button', onclick: async () => { try { await api('/bank-links', { method: 'POST', body: { key: l.key, enabled: !l.enabled } }); l.enabled = !l.enabled; drawBanks(); toast('Сохранено', 'ok', 1200); } catch (ex) { err(ex); } } }, h('span', null, l.name), h('i', null, svg('check', 16))))); };
          drawBanks();
          box.appendChild(sect('arrowDL', 'Настройки пополнений', toggle('Включить пополнения', v.deposits_enabled, (on) => save({ deposits_enabled: on })), toggle('Уникальные тыйыны', v.random_tiyin, (on) => save({ random_tiyin: on })), grid));
          box.appendChild(saveBtn({}));
        }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }
  const NOTIFY_GROUP = ['Уведомления', [['notify_new_deposit', 'Новое пополнение', 'bool'], ['notify_deposit_success', 'Пополнение зачислено', 'bool'], ['notify_deposit_failed', 'Ошибка пополнения', 'bool'], ['notify_new_withdrawal', 'Новый вывод', 'bool'], ['notify_withdrawal_status', 'Статус вывода', 'bool'], ['notify_cash_critical', 'Проблемы касс', 'bool'], ['notify_support_operator', 'Обращения оператору', 'bool']]];
  const ADVANCED_TABS = [
    ['bot', 'Бот', [
      ['Работа', [['bot_paused', 'Пауза бота', 'bool'], ['deposits_enabled', 'Пополнения', 'bool'], ['withdrawals_enabled', 'Выводы', 'bool']]],
      ['Оператор', [['support_username', 'Username оператора'], ['brand_name', 'Название']]],
      ['Кнопки', [['menu_deposit_label', 'Пополнить'], ['menu_withdraw_label', 'Вывести'], ['menu_help_label', 'Помощь'], ['button_styles_enabled', 'Цветные кнопки', 'bool'], ['premium_emoji_enabled', 'Premium-эмодзи', 'bool'], ['premium_only_emoji', 'Только premium (обычные эмодзи убирать)', 'bool']]],
      ['Premium-эмодзи: соответствия (эмодзи и ID, по одному в строке)', [['premium_emoji_map', 'Эмодзи → ID', 'textarea']]],
      ['Доступ', [['subscription_enabled', 'Подписка на канал', 'bool'], ['subscription_channel', 'Канал'], ['phone_required', 'Запрашивать телефон', 'bool']]],
      ['Аналитика', [['usd_rate', 'Курс доллара, сом', 'number']]],
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
      ['Реквизиты', [['requisite_mode', 'Выбор кошелька', 'select', [['random', 'Случайный'], ['priority', 'Один основной']]]]],
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
    if (Object.keys(inputs).length) box.appendChild(h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const payload = {}; for (const [k, el] of Object.entries(inputs)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; try { await api('/settings', { method: 'POST', body: { values: payload } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } busy(b, false); } }, svg('check', 18), 'Сохранить'));
    return inputs;
  }
  function settingPhoto(key, values, label) {
    const wrap = h('div', { class: 'card section-card' }); const draw = () => {
      wrap.innerHTML = ''; wrap.appendChild(h('h2', null, label)); const rel = values[key]; const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      input.onchange = async () => { if (!input.files[0]) return; const fd = new FormData(); fd.append('key', key); fd.append('file', input.files[0]); try { const rr = await api('/settings/photo', { method: 'POST', body: fd }); values[key] = rr.path; toast('Фото загружено', 'ok'); draw(); } catch (ex) { err(ex); } };
      wrap.appendChild(h('div', { class: 'photo-row' }, rel ? h('img', { class: 'photo-thumb', src: fileUrl('/' + rel), alt: '' }) : h('div', { class: 'photo-thumb blank' }, svg('image', 20)), h('div', { class: 'btn-row', style: { margin: 0 } }, h('button', { class: 'outline-btn blue', type: 'button', onclick: () => input.click() }, svg('image', 16), rel ? 'Заменить' : 'Загрузить'), rel ? h('button', { class: 'outline-btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Удалить фото?', 'Удалить', true)) { try { await api('/settings/photo/' + key, { method: 'DELETE' }); values[key] = ''; draw(); } catch (ex) { err(ex); } } } }, svg('trash', 16)) : null, input)));
    }; draw(); return wrap;
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
        if (tab[0] === 'bot') bottom = h('div', { class: 'btn-row', style: { marginTop: 0 } }, h('button', { class: 'outline-btn blue', onclick: async (e) => { const chat = await promptDialog('Проверить premium-эмодзи', 'Ваш Telegram ID (сначала напишите боту /start)', '700100200'); if (chat === null) return; const b = e.currentTarget; busy(b, true); try { const rr = await api('/settings/premium-test', { method: 'POST', body: { chat_id: chat.trim() || null } }); if (rr.sent) toast('Отправлено — проверьте чат с ботом', 'ok', 5000); else toast('Telegram отказал: ' + rr.description + (rr.hint ? ' — ' + rr.hint : ''), 'err', 10000); } catch (ex) { err(ex); } busy(b, false); } }, svg('bolt', 16), 'Проверить premium-эмодзи'));
        if (tab[0] === 'texts') top = h('div', { class: 'card section-card' }, h('div', { class: 'placeholder-list' }, ['{name}', '{support}', '{brand}', '{cash}', '{emoji}', '{player}', '{amount}', '{cur}', '{min}', '{max}', '{minutes}', '{left}', '{reason}', '{sla}', '{city}', '{address}'].map((x) => h('code', null, x)), h('code', null, '[emoji:ID:😎]')), h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: async () => { if (await confirmDialog('Вернуть стандартные тексты? Ваши правки будут удалены.', 'Сбросить', true)) { try { const rr = await api('/settings/reset', { method: 'POST', body: { keys: ['texts'] } }); Object.assign(values, rr.values); toast('Тексты сброшены', 'ok'); drawTab('texts'); } catch (ex) { err(ex); } } } }, svg('refresh', 16), 'Сбросить тексты')));
        if (tab[0] === 'withdraw') bottom = settingPhoto('instruction_photo', values, 'Фото инструкции');
        if (tab[0] === 'support') top = h('div', { class: 'card section-card' }, h('h2', null, 'Claude в поддержке'), h('small', { class: 'muted' }, r.env && r.env.assistant_configured ? 'Ключ задан — на вопросы клиентов первым отвечает Claude, сложное передаёт оператору' : 'Ключа нет: добавьте ANTHROPIC_API_KEY в /home/PayGo/.env и перезапустите paygo-support'));
        settingsForm(body, tab[2], values, top, bottom);
      };
      box.innerHTML = ''; box.appendChild(tabsBar); box.appendChild(body);
      drawTab(ADVANCED_TABS.some((t) => t[0] === tab0) ? tab0 : 'bot');
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- cashes (Кассы) */
  async function cashesView(shell) {
    const box = page(shell, 'Кассы', { right: can('cashes') ? h('button', { class: 'icon-btn', onclick: () => cashForm(null), 'aria-label': 'Добавить' }, svg('plus', 26)) : null });
    try {
      const r = await api('/cashes'); state.cashes = r.items; state.types = r.types; box.innerHTML = '';
      if (!r.items.length) box.appendChild(empty('Касс нет', '', 'wallet'));
      r.items.forEach((c) => {
        const card = h('div', { class: 'card section-card' });
        card.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { class: 'dot ' + c.status }), h('b', { style: { flex: 1, fontSize: '19px' } }, c.name), statusEl(c.status)));
        card.appendChild(h('div', { class: 'muted', style: { margin: '6px 0 10px', fontSize: '14px' } }, c.provider_type + ' · приоритет ' + c.priority));
        card.appendChild(h('div', { style: { fontSize: '26px', fontWeight: 700 } }, c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + curSign(c.currency) : '—'));
        card.appendChild(h('div', { class: 'muted', style: { fontSize: '14px' } }, c.last_check_at ? 'проверено ' + ago(c.last_check_at) + ' назад' : 'не проверялась', c.last_check_ok === false && c.last_check_message ? ' · ' + c.last_check_message : ''));
        card.appendChild(h('div', { class: 'tag-row' }, h('span', { class: 'pill ' + (c.deposit_enabled && !c.auto_disabled ? 'green' : '') }, 'Пополнение'), h('span', { class: 'pill ' + (c.withdraw_enabled ? 'green' : '') }, 'Вывод'), h('span', { class: 'pill' }, money(c.deposit_min) + ' – ' + money(c.deposit_max)), h('span', { class: 'pill amber' }, 'автостоп ≤ ' + money(c.critical_balance_threshold))));
        if (can('cashes')) card.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn blue', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const rr = await api('/cashes/' + c.id + '/check', { method: 'POST' }); toast(rr.result.ok ? 'Соединение OK · баланс ' + (rr.result.balance !== null ? money(rr.result.balance) : '—') : 'Ошибка: ' + rr.result.message, rr.result.ok ? 'ok' : 'err', 4000); render(); } catch (ex) { err(ex); } b.disabled = false; } }, svg('bolt', 16), 'Проверить'), h('button', { class: 'outline-btn', onclick: () => cashForm(c) }, svg('edit', 16), 'Изменить'), h('button', { class: 'outline-btn ' + (c.enabled ? 'danger' : 'green'), onclick: async () => { try { await api('/cashes/' + c.id, { method: 'PATCH', body: { enabled: !c.enabled } }); toast(c.enabled ? 'Касса отключена' : 'Касса включена', 'ok'); render(); } catch (ex) { err(ex); } } }, c.enabled ? 'Отключить' : 'Включить'), c.auto_disabled ? h('button', { class: 'outline-btn blue', onclick: async () => { await api('/cashes/' + c.id, { method: 'PATCH', body: { auto_disabled: false } }); render(); } }, 'Снять автостоп') : null, h('button', { class: 'outline-btn', onclick: async () => { if (await confirmDialog('Удалить кассу ' + c.name + '? Если по ней были операции, она будет отключена.', 'Удалить', true)) { try { const rr = await api('/cashes/' + c.id, { method: 'DELETE' }); toast(rr.message || 'Удалено', 'ok'); render(); } catch (ex) { err(ex); } } } }, svg('trash', 16))));
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
    const drawCreds = () => { credBox.innerHTML = ''; const type = state.types.find((t) => t.type === (f.provider_type ? f.provider_type.value : c.provider_type)) || { fields: [] }; credBox.appendChild(title('Учётные данные (шифруются)')); const adv = h('div', { hidden: true }); const fieldOf = (fd) => { const cur = (c.credentials || []).find((x) => x.key === fd.key); const el = h('input', { class: 'input', type: fd.secret ? 'password' : 'text', placeholder: cur && cur.set ? (fd.secret ? 'задано ' + cur.masked + ' — пусто = не менять' : cur.masked) : (fd.required ? 'обязательно' : 'необязательно'), value: cur && !fd.secret && cur.set ? cur.masked : '' }); el.dataset.cred = fd.key; return h('label', { class: 'field' }, h('span', null, fd.label), el); }; type.fields.forEach((fd) => (fd.advanced ? adv : credBox).appendChild(fieldOf(fd))); if (adv.childNodes.length) { const hasAdv = type.fields.some((fd) => fd.advanced && (c.credentials || []).some((x) => x.key === fd.key && x.set)); adv.hidden = !hasAdv; credBox.appendChild(h('button', { class: 'outline-btn', type: 'button', onclick: () => { adv.hidden = !adv.hidden; } }, svg('settings', 16), 'Дополнительно (вход на 1win.win)')); credBox.appendChild(adv); } };
    const photoField = (kind, label, hint) => {
      const wrap = h('div', { class: 'photo-field' });
      const key = kind === 'instruction' ? 'instruction_photo' : kind + '_photo';
      const draw = () => {
        wrap.innerHTML = ''; wrap.appendChild(h('div', { class: 'photo-head' }, h('b', null, label), h('small', null, hint)));
        if (isNew) { wrap.appendChild(h('div', { class: 'muted' }, 'Сначала сохраните кассу')); return; }
        const rel = c[key]; const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        input.onchange = async () => { if (!input.files[0]) return; const fd = new FormData(); fd.append('kind', kind); fd.append('file', input.files[0]); try { const rr = await api('/cashes/' + c.id + '/photo', { method: 'POST', body: fd }); Object.assign(c, rr.item); toast('Фото загружено', 'ok'); draw(); } catch (ex) { err(ex); } };
        wrap.appendChild(h('div', { class: 'photo-row' }, rel ? h('img', { class: 'photo-thumb', src: fileUrl('/' + rel), alt: '' }) : h('div', { class: 'photo-thumb blank' }, svg('image', 20)), h('div', { class: 'btn-row', style: { margin: 0 } }, h('button', { class: 'outline-btn blue', type: 'button', onclick: () => input.click() }, svg('image', 16), rel ? 'Заменить' : 'Загрузить'), rel ? h('button', { class: 'outline-btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Удалить фото?', 'Удалить', true)) { try { const rr = await api('/cashes/' + c.id + '/photo/' + kind, { method: 'DELETE' }); Object.assign(c, rr.item); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 16)) : null, input)));
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
    const s = sheet({ title: isNew ? 'Новая касса' : c.name, body, actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async (e) => { const b = e.currentTarget; busy(b, true); const payload = {}; for (const [k, el] of Object.entries(f)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; const creds = {}; credBox.querySelectorAll('input[data-cred]').forEach((el) => { if (el.value && el.value !== el.placeholder) creds[el.dataset.cred] = el.value; }); payload.credentials = creds; try { const rr = isNew ? await api('/cashes', { method: 'POST', body: payload }) : await api('/cashes/' + c.id, { method: 'PATCH', body: payload }); toast('Сохранено', 'ok'); s.close(); if (isNew && rr.item) { history.replaceState(null, '', '#/cashes/' + rr.item.id); } go('#/cashes'); render(); } catch (ex) { err(ex); busy(b, false); } } }, 'Сохранить')] });
  }

  /* ------------------------------------------------------------- payment events (Выписка платежей) */
  async function eventsView(shell) {
    const box = page(shell, 'Платежи', { back: () => go('#/macrodroid'), right: can('operations') ? h('button', { class: 'icon-btn', 'aria-label': 'Платёж вручную', onclick: manualPayment }, svg('plus', 26)) : null });
    const st = { status: '', page: 1 };
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/payment-events?status=' + st.status + '&page=' + st.page + '&size=40'); box.innerHTML = '';
        box.appendChild(h('div', { style: { marginBottom: '14px' } }, segEl([['', 'Все'], ['matched', 'Зачислены'], ['received,unmatched', 'Не найдены'], ['failed', 'Ошибки']], st.status, (k) => { st.status = k; st.page = 1; draw(); }, 'light')));
        if (!r.items.length) return box.appendChild(empty('Платежей нет', '', 'calendar'));
        r.items.forEach((ev) => box.appendChild(h('div', { class: 'card row-card' }, h('div', null, h('b', null, money(ev.amount) + ' ' + curSign(ev.currency) + ' · ' + srcLabel(ev.source)), h('small', null, fmtDate(ev.received_at) + ' · ' + (ev.raw_text || '').slice(0, 80))), h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' } }, statusEl(ev.status === 'matched' ? 'success' : ev.status === 'failed' ? 'failed' : ev.status === 'processing' ? 'processing' : 'created', ev.status === 'matched' ? 'Зачислен' : ev.status === 'failed' ? 'Ошибка' : ev.status === 'unmatched' ? 'Не найден' : 'Ожидает'), ev.deposit_id ? h('a', { class: 'small', href: '#/deposit/' + ev.deposit_id, style: { color: 'var(--blue)' } }, 'заявка #' + ev.deposit_id) : null, ['unmatched', 'failed', 'received'].includes(ev.status) && can('operations') ? h('button', { class: 'outline-btn', onclick: async () => { try { const rr = await api('/payment-events/' + ev.id + '/retry', { method: 'POST' }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err'); draw(); } catch (ex) { err(ex); } } }, 'Повторить') : null))));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; draw(); }); if (p) box.appendChild(p);
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
    function manualPayment() { const amount = h('input', { class: 'input', type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'напр. 1500.37' }); const note = h('input', { class: 'input', placeholder: 'необязательно' }); const s = sheet({ title: 'Платёж вручную', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Сумма из выписки (с тыйынами)'), amount), h('label', { class: 'field' }, h('span', null, 'Комментарий'), note)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { const rr = await api('/payment-events/manual', { method: 'POST', body: { amount: amount.value, note: note.value } }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err', 4000); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Провести')] }); }
  }

  /* ------------------------------------------------------------- MacroDroid / webhook */
  async function macrodroidView(shell) {
    const box = page(shell, 'MacroDroid', { back: () => go('#/settings') });
    let revealed = false;
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/webhook-info'); box.innerHTML = '';
        const urlEl = h('div', { class: 'code-box' }, revealed ? r.url : r.url_masked);
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Адрес для MacroDroid'), urlEl, h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: () => { revealed = !revealed; urlEl.textContent = revealed ? r.url : r.url_masked; } }, revealed ? 'Скрыть ключ' : 'Показать ключ'), h('button', { class: 'outline-btn blue', onclick: () => copy(r.url) }, svg('copy', 16), 'Копировать'), h('button', { class: 'outline-btn green', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const rr = await api('/webhook-info/test', { method: 'POST' }); toast('Тест прошёл: событие #' + rr.event.id + ' (' + rr.event.status + ')', 'ok', 4000); draw(); } catch (ex) { err(ex); } b.disabled = false; } }, svg('bolt', 16), 'Тест')), h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '14px' } }, 'Адрес содержит ключ — не пересылайте посторонним')));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Настройка макроса'), h('ol', { class: 'steps' }, h('li', null, h('b', null, 'Триггер:'), ' «Уведомление получено» → выберите приложение банка (MBank, Optima, O!Деньги…).'), h('li', null, h('b', null, 'Действие:'), ' «HTTP-запрос» → метод POST → вставьте адрес выше.'), h('li', null, h('b', null, 'Content-Type:'), ' application/json. Тело запроса:'), h('div', { class: 'code-box' }, JSON.stringify(r.sample_body)), h('li', null, 'Нажмите «Тест» — событие появится ниже.'))));
        const ipInput = h('textarea', { class: 'textarea', placeholder: 'пусто — любой IP', style: { minHeight: '70px' } }, r.ip_allowlist || '');
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Защита'), h('label', { class: 'field' }, h('span', null, 'Белый список IP (через запятую)'), ipInput), h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Требовать подпись'), h('small', null, 'Только для своих скриптов, MacroDroid не умеет')), switchEl(r.require_signature, async (v) => { await api('/settings', { method: 'POST', body: { values: { webhook_require_signature: v } } }); })), h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await api('/settings', { method: 'POST', body: { values: { webhook_ip_allowlist: ipInput.value.trim() } } }); toast('Сохранено', 'ok'); } catch (ex) { err(ex); } b.disabled = false; } }, svg('check', 18), 'Сохранить')));
        const c = r.counts_24h || {};
        box.appendChild(h('div', { class: 'stat-grid', style: { marginBottom: '14px' } }, h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, c.matched || 0), h('div', { class: 'l' }, 'зачислено за 24 ч')), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, c.unmatched || 0), h('div', { class: 'l' }, 'без заявки')), h('div', { class: 'card stat-card red' }, h('div', { class: 'v' }, c.failed || 0), h('div', { class: 'l' }, 'ошибки')), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, (c.received || 0) + (c.processing || 0)), h('div', { class: 'l' }, 'в обработке'))));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Последние платежи'), h('button', { class: 'outline-btn', onclick: () => go('#/events') }, 'Все платежи')));
        if (!r.recent.length) box.appendChild(empty('Платежей ещё не было', 'Нажмите «Тест»', 'calendar'));
        r.recent.forEach((ev) => box.appendChild(h('div', { class: 'card row-card' }, h('span', { class: 'dot ' + (ev.status === 'matched' ? 'green' : ev.status === 'failed' ? 'red' : ev.status === 'unmatched' ? 'amber' : 'blue') }), h('div', null, h('b', null, money(ev.amount) + ' ' + curSign(ev.currency) + ' · ' + srcLabel(ev.source)), h('small', null, fmtDate(ev.received_at) + ' · ' + (ev.raw_text || '').slice(0, 60))), statusEl(ev.status === 'matched' ? 'success' : ev.status === 'failed' ? 'failed' : ev.status === 'unmatched' ? 'pending' : 'processing', ev.status === 'matched' ? 'Зачислен' : ev.status === 'failed' ? 'Ошибка' : ev.status === 'unmatched' ? 'Не найден' : 'Обработка'))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw(); watchChanges(box, draw);
  }

  /* ------------------------------------------------------------- statements (Выписки) */
  async function statementsView(shell) {
    const box = page(shell, 'Выписки');
    const st = { file: null, auto: true };
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Импорт выписки'), h('small', { class: 'muted', style: { display: 'block', fontSize: '15px', lineHeight: '1.4' } }, 'Резерв на случай, когда MacroDroid не прислал платёж. Загрузите выписку из банка (PDF, XML, CSV). Совпадение ищется по точной сумме и по дате-времени — две проверки, деньги не уйдут на чужую заявку.')));
    const file = h('input', { type: 'file', accept: '.pdf,.xml,.csv,.txt,application/pdf,text/xml,text/csv,text/plain', style: { display: 'none' } });
    const drop = h('button', { class: 'drop-zone', type: 'button', onclick: () => file.click() });
    const drawDrop = () => { drop.innerHTML = ''; drop.appendChild(svg(st.file ? 'note' : 'plus', 30)); drop.appendChild(h('b', null, st.file ? st.file.name : 'Выбрать файл выписки')); drop.appendChild(h('small', null, st.file ? (Math.round(st.file.size / 1024) + ' КБ · нажмите, чтобы заменить') : 'PDF · XML · CSV')); };
    file.onchange = () => { st.file = file.files[0] || null; drawDrop(); };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { st.file = e.dataTransfer.files[0]; drawDrop(); } });
    drawDrop();
    const autoRow = h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Автозачисление'), h('small', null, 'Найденные заявки зачисляются сразу. Выключите — только показать совпадения.')), switchEl(st.auto, (v) => { st.auto = v; }));
    const report = h('div');
    const submit = h('button', { class: 'primary-btn' }, svg('check', 18), 'Загрузить и проверить');
    const chip = (v, l, cls) => h('div', { class: 'card stat-card ' + (cls || '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const renderReport = (rep) => {
      report.innerHTML = '';
      const okN = (rep.credited || []).filter((x) => x.ok).length;
      report.appendChild(h('div', { class: 'stat-grid', style: { marginTop: '10px' } }, chip(rep.rows, 'строк в выписке'), chip(rep.incoming, 'поступлений', 'green'), chip(okN, 'зачислено', 'blue'), chip((rep.review || []).length + (rep.unmatched || []).length, 'на проверку', (rep.review || []).length ? 'red' : '')));
      const credited = rep.credited || [];
      if (credited.length) { const c = h('div', { class: 'card section-card' }, h('h2', null, 'Зачислено')); credited.forEach((x) => c.appendChild(h('div', { class: 'row-card', style: { padding: '8px 0', margin: 0 } }, h('span', { class: 'dot ' + (x.ok ? 'green' : 'red') }), h('div', null, h('b', null, 'Заявка ' + x.request_id), h('small', null, x.ok ? 'зачислено автоматически' : (x.message || 'не удалось')))))); report.appendChild(c); }
      const pend = [].concat((rep.review || []).map((x) => ['review', x]), (rep.unmatched || []).map((x) => ['none', x]));
      if (pend.length) { const c = h('div', { class: 'card section-card' }, h('h2', null, 'Не зачислено — проверьте вручную')); pend.forEach((pair) => { const t = pair[0], x = pair[1]; c.appendChild(h('div', { class: 'row-card', style: { padding: '8px 0', margin: 0 } }, h('span', { class: 'dot ' + (t === 'review' ? 'amber' : '') }), h('div', null, h('b', null, money(Number(x.amount)) + ' KGS · ' + (x.dt || 'без даты')), h('small', null, t === 'review' ? 'несколько подходящих заявок — зачислите вручную' : 'заявка не найдена: ' + (x.details || ''))))); }); report.appendChild(c); }
      if (rep.duplicates) report.appendChild(h('div', { class: 'card', style: { padding: '12px 16px' } }, h('small', { class: 'muted' }, 'Повторных строк (уже обработаны ранее): ' + rep.duplicates)));
      if (!credited.length && !pend.length && !rep.duplicates) report.appendChild(empty('Поступлений в выписке нет', 'В файле только исходящие платежи', 'calendar'));
    };
    submit.onclick = async () => {
      if (!st.file) return toast('Выберите файл выписки', 'err');
      busy(submit, true); report.innerHTML = ''; report.appendChild(loader(2));
      try {
        const fd = new FormData(); fd.append('file', st.file);
        const r = await api('/statements/import?auto_credit=' + (st.auto ? 'true' : 'false'), { method: 'POST', body: fd });
        renderReport(r.report);
        const okN = (r.report.credited || []).filter((x) => x.ok).length;
        toast(okN ? ('Зачислено заявок: ' + okN) : 'Готово — совпадений для зачисления нет', okN ? 'ok' : '', 3500);
        if (okN) document.dispatchEvent(new CustomEvent('paygo:changed', {}));
      } catch (ex) { report.innerHTML = ''; err(ex); }
      busy(submit, false);
    };
    box.appendChild(h('div', { class: 'card section-card' }, drop, autoRow, h('div', { class: 'btn-row' }, submit), file));
    box.appendChild(report);
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
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Смена пароля'), h('label', { class: 'field' }, h('span', null, 'Текущий пароль'), cur), h('label', { class: 'field' }, h('span', null, 'Новый пароль'), nw), h('button', { class: 'primary-btn', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/auth/password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } }); toast('Пароль изменён, остальные сессии завершены', 'ok', 4000); cur.value = nw.value = ''; draw(); } catch (ex) { err(ex); } e.target.disabled = false; } }, svg('lock', 18), 'Изменить пароль')));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Активные сессии'), s.items.length > 1 ? h('button', { class: 'outline-btn danger', onclick: async () => { if (await confirmDialog('Завершить все остальные сессии этого аккаунта?', 'Завершить', true)) { try { await api('/auth/sessions/revoke-others', { method: 'POST' }); toast('Готово', 'ok'); draw(); } catch (ex) { err(ex); } } } }, 'Завершить остальные') : null));
        s.items.forEach((x) => box.appendChild(h('div', { class: 'card row-card' }, h('div', null, h('b', null, (x.username ? x.username + ' · ' : '') + (x.ip || '—'), x.current ? ' (текущая)' : ''), h('small', null, (x.user_agent || '—').slice(0, 70)), h('small', null, 'создана ' + fmtDate(x.created_at) + ' · активна ' + ago(x.last_seen_at) + ' назад')), !x.current ? h('button', { class: 'outline-btn danger', onclick: async () => { try { await api('/auth/sessions/' + x.id + '/revoke', { method: 'POST' }); draw(); } catch (ex) { err(ex); } } }, 'Выйти') : h('span', { class: 'pill green' }, 'вы'))));
        if (can('admins')) {
          const a = await api('/auth/admins');
          box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Администраторы'), h('button', { class: 'outline-btn blue', onclick: addAdmin }, svg('plus', 16), 'Добавить')));
          const ROLES = [['viewer', 'Просмотр'], ['operator', 'Оператор'], ['admin', 'Администратор'], ['owner', 'Владелец']];
          a.items.forEach((ad) => box.appendChild(h('div', { class: 'card row-card', style: { alignItems: 'flex-start' } }, avatarEl(ad.username, '', 'round'), h('div', null, h('b', null, ad.username + (ad.name ? ' · ' + ad.name : '')), h('small', null, 'вход: ' + fmtDate(ad.last_login_at)), h('div', { class: 'tag-row' }, editable(ad.role, { options: ROLES, render: (v) => 'роль: ' + ((ROLES.find((r) => r[0] === v) || [v, v])[1]), save: (v) => api('/auth/admins/' + ad.id, { method: 'PATCH', body: { role: v } }) })), h('div', { class: 'btn-row' }, h('button', { class: 'outline-btn', onclick: async () => { const pw = await promptDialog('Новый пароль для ' + ad.username, 'Мин. 10 символов, разный регистр и цифра'); if (pw) { try { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { password: pw } }); toast('Пароль обновлён', 'ok'); } catch (ex) { err(ex); } } } }, 'Пароль'), h('button', { class: 'outline-btn', onclick: async () => { try { await api('/auth/admins/' + ad.id + '/logout-all', { method: 'POST' }); toast('Все сессии завершены', 'ok'); } catch (ex) { err(ex); } } }, 'Выйти везде'))), switchEl(ad.is_active, async (v) => { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { is_active: v } }); }))));
          function addAdmin() { const u = h('input', { class: 'input', placeholder: 'Логин (латиницей)', autocapitalize: 'none' }); const n = h('input', { class: 'input', placeholder: 'Имя (необязательно)' }); const p = h('input', { class: 'input', type: 'password', placeholder: 'Пароль (мин. 10 символов)' }); const role = h('select', { class: 'select' }, ROLES.map(([v, l]) => h('option', { value: v, selected: v === 'operator' }, l))); const sh = sheet({ title: 'Новый администратор', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Логин'), u), h('label', { class: 'field' }, h('span', null, 'Имя'), n), h('label', { class: 'field' }, h('span', null, 'Пароль'), p), h('label', { class: 'field' }, h('span', null, 'Роль'), role)), actions: [h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { await api('/auth/admins', { method: 'POST', body: { username: u.value.trim(), name: n.value.trim(), password: p.value, role: role.value } }); toast('Администратор создан', 'ok'); sh.close(); draw(); } catch (ex) { err(ex); } } }, 'Создать')] }); }
        }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- quick replies (Быстрые ответы) — hold & drag to reorder */
  function dragList(list, opts) {
    let d = null, timer = null;
    const rows = () => Array.from(list.children).filter((r) => r.classList.contains('drag-row'));
    const begin = (row, y) => { clearTimeout(timer); const all = rows(); d = { row, y0: y, y, h: row.offsetHeight + 10, from: all.indexOf(row), to: all.indexOf(row) }; row.classList.add('lifting'); list.classList.add('dragging'); buzz(12); };
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
    const box = page(shell, 'Быстрые ответы', { right: h('button', { class: 'icon-btn', 'aria-label': 'Добавить', onclick: () => edit(null) }, svg('plus', 26)) });
    let items = [];
    const save = async () => { const r = await api('/quick-replies', { method: 'POST', body: { fields: { items } } }); items = r.items; state.quick = items; };
    const list = h('div', { class: 'drag-list' });
    const draw = () => {
      box.innerHTML = ''; list.innerHTML = ''; box.appendChild(list);
      if (!items.length) return box.appendChild(empty('Ответов нет', 'Нажмите «+»', 'bell'));
      items.forEach((q, i) => list.appendChild(h('div', { class: 'card row-card drag-row' }, h('span', { class: 'drag-handle', 'aria-label': 'Переместить' }, svg('menu', 18)), h('div', { onclick: () => edit(i) }, h('b', null, q.title), h('small', { style: { whiteSpace: 'normal' } }, q.text)), h('button', { class: 'outline-btn danger', type: 'button', 'aria-label': 'Удалить', onclick: async () => { if (await confirmDialog('Удалить «' + q.title + '»?', 'Удалить', true)) { items.splice(i, 1); try { await save(); draw(); } catch (ex) { err(ex); } } } }, svg('trash', 16)))));
    };
    dragList(list, { onReorder: async (from, to) => { const [m] = items.splice(from, 1); items.splice(to, 0, m); draw(); try { await save(); } catch (ex) { err(ex); } } });
    function edit(i) {
      const q = i === null ? { id: 'q' + Date.now().toString(36), title: '', text: '' } : Object.assign({}, items[i]);
      const title = h('input', { class: 'input', value: q.title, placeholder: 'Название' });
      const text = h('textarea', { class: 'textarea', placeholder: 'Текст ответа', style: { minHeight: '120px' } }, q.text);
      const sh = sheet({ title: i === null ? 'Новый ответ' : 'Изменить', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), title), h('label', { class: 'field' }, h('span', null, 'Текст'), text)), actions: [h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { if (!text.value.trim()) return toast('Введите текст', 'err'); q.title = title.value.trim() || text.value.trim().slice(0, 30); q.text = text.value.trim(); if (i === null) items.push(q); else items[i] = q; try { await save(); draw(); sh.close(); } catch (ex) { err(ex); } } }, 'Сохранить')] });
      setTimeout(() => (i === null ? title : text).focus(), 80);
    }
    try { const r = await api('/quick-replies'); items = r.items; state.quick = items; draw(); } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- push / env */
  function urlB64ToUint8(b64) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function pushView(shell) {
    const box = page(shell, 'Push-уведомления', { back: () => go('#/settings') });
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader(2));
      try {
        const r = await api('/push/config'); box.innerHTML = '';
        const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        let subscribed = false; try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); subscribed = !!(reg && (await reg.pushManager.getSubscription())); } catch (e) { /* ignore */ }
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Состояние'), kv([['Сервер', r.enabled ? h('span', { class: 'pill green' }, 'готов') : h('span', { class: 'pill red' }, 'нет ключей в .env')], ['Браузер', supported ? h('span', { class: 'pill green' }, 'поддерживает') : h('span', { class: 'pill red' }, 'не поддерживает')], ['Это устройство', subscribed ? h('span', { class: 'pill green' }, 'подписано') : h('span', { class: 'pill' }, 'не подписано')], ['Устройств', r.subscriptions]])));
        box.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'primary-btn', disabled: !supported || !r.enabled, onclick: async () => { try { const reg = await navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }); const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Уведомления запрещены в браузере', 'err'); const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(r.public_key) }); await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); toast('Подписка включена на этом устройстве', 'ok'); draw(); } catch (ex) { err(ex); } } }, svg('bell', 18), 'Включить здесь'),
          h('button', { class: 'outline-btn blue', onclick: async () => { try { await api('/push/test', { method: 'POST' }); toast('Тест отправлен', 'ok'); } catch (ex) { err(ex); } } }, 'Тест'),
          h('button', { class: 'outline-btn', disabled: !supported, onclick: async () => { try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await api('/push/unsubscribe', { method: 'POST', body: sub.toJSON() }); await sub.unsubscribe(); } toast('Отключено', 'ok'); draw(); } catch (ex) { err(ex); } } }, 'Отключить')));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }
  async function envView(shell) {
    const box = page(shell, 'Сервер', { back: () => go('#/settings') });
    try {
      const r = await api('/settings'); const e = r.env; box.innerHTML = '';
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Сервер'), kv([['Адрес панели', e.public_url + e.base_path + '/'], ['База данных', e.database], ['Часовой пояс', e.timezone]])));
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Интеграции'), kv([['Основной бот', e.main_bot ? '@' + e.main_bot : '—'], ['Бот поддержки', e.support_bot ? '@' + e.support_bot : '—'], ['Чаты админов', (e.admin_chat_ids || []).join(', ') || '—'], ['SMTP', e.smtp_configured ? e.smtp_host : 'нет'], ['Почта как источник платежей', e.imap_enabled ? 'да' : 'нет'], ['Push', e.push_configured ? 'настроен' : 'нет']])));
    } catch (ex) { box.innerHTML = ''; box.appendChild(empty('Ошибка', ex.message)); }
  }

  /* ------------------------------------------------------------- boot */
  (async function boot() {
    applyTheme(themeName());
    state.route = parseHash();
    try { const r = await api('/auth/me'); state.admin = r.admin; startLive(); } catch (e) { state.admin = null; }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(() => {});
  })();
})();
