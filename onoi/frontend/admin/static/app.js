/* OnoiPay Admin SPA — phone-shell layout (Главная / История / Чат / Поиск / Меню). No build step. */
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
    if ((opts.method || 'GET') !== 'GET') headers['X-CSRF-Token'] = (state.admin && state.admin.csrf_token) || getCookie('onoipay_csrf');
    let res;
    try { res = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, opts, { headers })); } catch (e) { throw new Error('Нет соединения с сервером'); }
    let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
    if (res.status === 401) { if (state.admin) { state.admin = null; render(); } throw new Error('Сессия истекла — войдите снова'); }
    if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || ('Ошибка ' + res.status));
    return data;
  }
  function toast(text, kind, ms) { const el = h('div', { class: 'toast ' + (kind || '') }, text); $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, ms || (kind === 'err' ? 4200 : 2400)); }
  const err = (e) => toast(e && e.message ? e.message : String(e), 'err');
  function copy(text) { navigator.clipboard && navigator.clipboard.writeText(String(text)).then(() => toast('Скопировано', 'ok', 1200)).catch(() => {}); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function confirmDialog(text, okLabel, danger) { return new Promise((resolve) => { const s = sheet({ title: 'Подтверждение', body: h('p', { style: { margin: '4px 0 8px', fontSize: '13px', lineHeight: '1.4' } }, text), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(false); } }, 'Отмена'), h('button', { class: 'action-btn ' + (danger ? 'danger' : 'primary'), onclick: () => { s.close(); resolve(true); } }, okLabel || 'Да')] }); }); }
  function promptDialog(title, label, placeholder) { return new Promise((resolve) => { const input = h('textarea', { class: 'textarea', placeholder: placeholder || '' }); const s = sheet({ title, body: h('label', { class: 'field' }, h('span', null, label || ''), input), actions: [h('button', { class: 'action-btn', onclick: () => { s.close(); resolve(null); } }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: () => { s.close(); resolve(input.value.trim()); } }, 'Продолжить')] }); setTimeout(() => input.focus(), 60); }); }

  /* ------------------------------------------------------------- sheet (modal) */
  function sheet(opts) {
    const root = $('#modal-root');
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-grab' }), h('div', { class: 'sheet-head' }, h('h2', null, opts.title || ''), h('button', { class: 'close', 'aria-label': 'Закрыть', onclick: () => api_.close() }, svg('close', 16))), h('div', { class: 'sheet-body' }, opts.body), opts.actions && opts.actions.length ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null);
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) api_.close(); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') api_.close(); };
    const api_ = { el: box, close() { back.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; if (opts.onClose) opts.onClose(); }, setBody(node) { const c = $('.sheet-body', box); c.innerHTML = ''; c.appendChild(node); }, setActions(nodes) { let a = $('.sheet-actions', box); if (!a) { a = h('div', { class: 'sheet-actions' }); box.appendChild(a); } a.innerHTML = ''; nodes.forEach((n) => a.appendChild(n)); } };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; root.appendChild(back);
    return api_;
  }
  function closeSheets() { document.querySelectorAll('.sheet-back').forEach((el) => el.remove()); document.body.style.overflow = ''; }

  /* ------------------------------------------------------------- components */
  const STATUS = { created: ['Ожидает', 'blue'], processing: ['В обработке', 'blue'], success: ['Успешно', 'success'], failed: ['Проблема', 'problem'], cancelled: ['Отменено', 'rejected'], expired: ['Истекло', 'rejected'], auto: ['Авто', ''], waiting_operator: ['Ждёт оператора', 'problem'], operator: ['У оператора', 'blue'], resolved: ['Закрыто', 'success'], closed: ['Закрыто', 'rejected'], online: ['Онлайн', 'success'], error: ['Ошибка', 'problem'], low: ['Мало средств', 'pending'], disabled: ['Отключена', 'rejected'], auto_disabled: ['Автостоп', 'problem'], unknown: ['Не проверена', ''] };
  function statusEl(status, label) { const m = STATUS[status] || [status, '']; const cls = (status === 'created' && label && /проблем|внимание/i.test(label)) ? 'problem' : m[1]; return h('span', { class: 'status ' + cls }, h('i'), label || m[0]); }
  function txStatus(tx) { if (tx.needs_attention && tx.status !== 'success') return statusEl('failed', 'Проблема'); return statusEl(tx.status, tx.status_label); }
  function switchEl(on, onChange) { const b = h('button', { class: 'switch ' + (on ? 'on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false' }, h('i')); b.onclick = async () => { b.disabled = true; try { await onChange(!b.classList.contains('on')); b.classList.toggle('on'); } catch (e) { err(e); } b.disabled = false; }; return b; }
  function empty(title, text, icon) { return h('div', { class: 'empty' }, svg(icon || 'history', 26), h('b', null, title || 'Пока пусто'), h('span', null, text || 'Новые данные появятся здесь автоматически.')); }
  function loader(n) { return h('div', null, Array.from({ length: n || 3 }).map(() => h('div', { class: 'sk' }))); }
  function header(title, opts) { opts = opts || {}; return h('header', { class: 'v9-header' }, opts.back === false ? h('span', { class: 'header-spacer' }) : h('button', { class: 'header-btn', 'aria-label': 'Назад', onclick: () => (typeof opts.back === 'function' ? opts.back() : history.length > 1 ? history.back() : go('#/menu')) }, svg('back', 18)), h('h1', null, title), opts.right || h('span', { class: 'header-spacer' })); }
  function segEl(items, active, onSelect, cls) { return h('div', { class: 'seg ' + (cls || '') }, items.map(([key, label, count]) => h('button', { class: key === active ? 'active' : '', onclick: () => onSelect(key) }, label, count !== undefined && count !== null ? h('i', null, count) : null))); }
  function editable(value, opts) {
    const wrap = h('span', { class: 'editable' });
    const show = () => { wrap.innerHTML = ''; wrap.appendChild(h('span', null, opts.render ? opts.render(value) : (value === '' || value === null || value === undefined ? '—' : String(value)))); if (!opts.readonly) wrap.appendChild(h('button', { class: 'pen', title: 'Изменить', onclick: edit }, svg('edit', 13))); };
    const edit = () => { const input = opts.options ? h('select', { class: 'select' }, opts.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))) : h('input', { class: 'input', value: value === null || value === undefined ? '' : value, type: opts.type || 'text' }); const save = async () => { try { const v = input.value; await opts.save(v); value = v; toast('Сохранено', 'ok', 1300); show(); } catch (e) { err(e); } }; wrap.innerHTML = ''; wrap.appendChild(h('span', { class: 'inline' }, input, h('button', { class: 'outline-btn blue', onclick: save }, '✓'), h('button', { class: 'outline-btn', onclick: show }, '✕'))); input.focus(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') show(); }); };
    show(); return wrap;
  }
  function kv(rows) { return h('dl', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === undefined || v === null || v === '' ? '—' : v)])); }
  function timeline(items) { if (!items || !items.length) return h('div', { class: 'muted small' }, 'История пуста'); return h('ul', { class: 'timeline' }, items.map((it) => h('li', { class: it.level || '' }, h('time', null, fmtDate(it.at)), h('div', null, it.title), it.detail ? h('div', { class: 'muted small' }, it.detail) : null))); }
  function pager(page, size, total, go_) { const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return null; return h('div', { class: 'pager' }, h('button', { class: 'outline-btn', disabled: page <= 1, onclick: () => go_(page - 1) }, '‹'), h('span', { class: 'muted small' }, page + ' / ' + pages), h('button', { class: 'outline-btn', disabled: page >= pages, onclick: () => go_(page + 1) }, '›')); }
  function txCard(tx, opts) {
    opts = opts || {};
    const dep = tx.kind === 'deposit';
    const problem = tx.status === 'failed' || (tx.needs_attention && tx.status !== 'success');
    const card = h('button', { class: 'tx-card', onclick: () => openTxSheet(tx.kind, tx.id) },
      h('span', { class: 'tx-logo-wrap' }, h('span', { class: 'tx-logo' }, h('img', { src: 'brand/onoipay-logo.png', alt: '' })), h('i', { class: 'tx-flow ' + (dep ? 'deposit' : 'withdraw') }, svg(dep ? 'arrowDown' : 'arrowUp', 13))),
      h('span', { class: 'tx-copy' }, h('b', null, tx.user_name || 'Клиент'), h('small', null, (tx.cash_name || '').toUpperCase() + ' • ' + tx.player_id), h('em', null, '# ' + (tx.public_id || tx.id).replace(/^[DW]-/, ''), h('span', { class: 'tx-peek', role: 'button', 'aria-label': 'Быстрый просмотр', onclick: (e) => { e.stopPropagation(); openTxSheet(tx.kind, tx.id); } }, svg('peek', 16)))),
      h('span', { class: 'tx-side' }, h('time', null, fmtDate(tx.created_at)), h('strong', { class: 'tx-amount ' + (dep ? 'deposit' : 'withdraw') }, (dep ? '+' : '−') + money(dep ? tx.pay_amount : tx.amount)), txStatus(tx)));
    if (!problem || opts.noAlert) return card;
    const title = dep ? 'Надо пополнить: деньги пришли, букмекер не зачислил' : 'Нужна проверка: касса не подтвердила сумму вывода';
    return h('div', null, card, h('div', { class: 'tx-attn' }, h('b', null, title), h('small', null, tx.error || 'Откройте заявку и повторите операцию.')));
  }
  function txGroups(list, opts) { const groups = groupByDay(list); return h('div', { class: 'tx-groups' }, groups.map((g) => h('section', { class: 'tx-day' }, h('div', { class: 'tx-day-title' }, g.label), h('div', { class: 'tx-day-list' }, g.items.map((tx) => txCard(tx, opts)))))); }

  /* ------------------------------------------------------------- router / shell */
  function parseHash() { const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/'); return { page: parts[0] || 'home', id: parts[1] || null, sub: parts[2] || null }; }
  window.addEventListener('hashchange', () => { closeSheets(); state.route = parseHash(); render(); });
  const go = (hash) => { location.hash = hash; };
  const TOP = ['home', 'history', 'chats', 'search', 'menu'];
  const NAV = [['home', 'Главная', 'home'], ['history', 'История', 'history'], ['chats', 'Чат', 'chat'], ['search', 'Поиск', 'search'], ['menu', 'Меню', 'menu']];
  function can(p) { return !!(state.admin && state.admin.permissions.includes(p)); }
  function navBadge(page) { const q = state.live && state.live.queues; if (!q) return 0; if (page === 'home') return q.deposits_failed + q.withdrawals_attention; if (page === 'chats') return q.support_waiting; return 0; }
  function render() {
    const app = $('#app'); app.innerHTML = '';
    if (!state.admin) { app.appendChild(loginView()); return; }
    const page = state.route.page;
    const noNav = page === 'chats' && !!state.route.id;
    const shell = h('div', { class: 'shell ' + (noNav ? 'no-nav' : '') });
    app.appendChild(shell);
    const views = { home: homeView, history: historyView, chats: chatsView, search: searchView, menu: menuView, manage: manageView, stats: statsView, cashes: cashesView, events: eventsView, gateway: gatewayView, broadcast: broadcastView, security: securityView, quick: quickView, logs: logsView, settings: settingsView, firstline: firstLineView, deposits: (m) => txDetailView(m, 'deposits', state.route.id), withdrawals: (m) => txDetailView(m, 'withdrawals', state.route.id), users: (m) => userDetailView(m, state.route.id), push: pushView, env: envView };
    (views[page] || homeView)(shell);
    if (!noNav) shell.appendChild(bottomNav(page));
  }
  function bottomNav(page) {
    const active = TOP.includes(page) ? page : (['deposits', 'withdrawals'].includes(page) ? 'home' : page === 'users' ? 'search' : 'menu');
    return h('nav', { class: 'bottom-nav' }, NAV.map(([key, label, icon]) => { const n = navBadge(key); return h('button', { class: 'nav-item ' + (active === key ? 'active' : ''), onclick: () => go('#/' + key) }, h('span', { class: 'nav-icon' }, svg(icon, 20), n ? h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n) : null), label); }));
  }
  function updateBadges() { document.querySelectorAll('.bottom-nav .nav-item').forEach((b, i) => { const key = NAV[i][0]; const old = b.querySelector('.nav-badge'); if (old) old.remove(); const n = navBadge(key); if (n) b.querySelector('.nav-icon').appendChild(h('span', { class: 'nav-badge' }, n > 99 ? '99+' : n)); }); }

  /* ------------------------------------------------------------- auth / live */
  function loginView() {
    const user = h('input', { class: 'input', placeholder: 'Логин', autocomplete: 'username', autocapitalize: 'none' });
    const pass = h('input', { class: 'input', placeholder: 'Пароль', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'primary-btn' }, 'Войти');
    const form = h('form', { class: 'card login-card', onsubmit: async (e) => { e.preventDefault(); btn.disabled = true; try { const r = await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } }); state.admin = r.admin; state.route = parseHash(); startLive(); render(); } catch (ex) { err(ex); } btn.disabled = false; } },
      h('div', { class: 'brand' }, h('img', { src: 'brand/onoipay-logo.png', alt: '' }), h('div', null, h('b', null, 'OnoiPay'), h('small', null, 'Панель управления'))),
      h('label', { class: 'field' }, h('span', null, 'Логин'), user), h('label', { class: 'field' }, h('span', null, 'Пароль'), pass), btn);
    return h('div', { class: 'shell no-nav' }, h('div', { class: 'login' }, form));
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
        if (prev && JSON.stringify(prev.revision) !== JSON.stringify(r.revision)) document.dispatchEvent(new CustomEvent('onoi:changed', { detail: r.revision }));
        document.dispatchEvent(new CustomEvent('onoi:live', { detail: r.queues }));
      } catch (e) { /* silent */ }
    };
    tick(); state.poll = setInterval(tick, 3000);
    setInterval(() => { api('/auth/refresh', { method: 'POST' }).then((r) => { state.admin = r.admin; }).catch(() => {}); }, 10 * 60 * 1000);
  }
  function stopLive() { if (state.poll) clearInterval(state.poll); state.poll = null; }
  let audioCtx;
  function beep(critical) { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = critical ? 880 : 660; g.gain.value = 0.08; o.start(); o.stop(audioCtx.currentTime + (critical ? 0.35 : 0.15)); } catch (e) {} }
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'ONOI_OPEN' && d.url) { const hash = String(d.url).split('#')[1]; if (hash) go('#' + hash); } if (d.type === 'ONOI_PUSH' && d.payload) toast(d.payload.title + ' — ' + (d.payload.body || ''), d.payload.channel === 'critical' ? 'crit' : '', 5000); });
  function watchLive(root, fn) { const handler = () => { if (!document.body.contains(root)) return document.removeEventListener('onoi:live', handler); fn(); }; document.addEventListener('onoi:live', handler); }
  function watchChanges(root, fn) { const handler = () => { if (!document.body.contains(root)) return document.removeEventListener('onoi:changed', handler); fn(); }; document.addEventListener('onoi:changed', handler); }

  /* ------------------------------------------------------------- home (Главная) */
  function homeView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const listBox = h('div');
    const refresh = h('button', { class: 'refresh-btn', 'aria-label': 'Обновить', onclick: () => load(true) }, svg('refresh', 19));
    const top = h('div', { class: 'home-top' }); screen.appendChild(top); screen.appendChild(listBox);
    const counts = () => { const q = (state.live && state.live.queues) || {}; return { actual: (q.deposits_pending || 0) + (q.deposits_failed || 0) + Math.max(0, (q.withdrawals_pending || 0) - (q.withdrawals_deferred || 0)), deferred: q.withdrawals_deferred || 0 }; };
    const drawTop = () => { const c = counts(); top.innerHTML = ''; top.appendChild(segEl([['actual', 'Актуальные', c.actual], ['deferred', 'Отложенные', c.deferred]], state.homeTab, (k) => { state.homeTab = k; load(); })); top.appendChild(refresh); };
    async function load(manual) {
      drawTop(); refresh.disabled = true; if (!listBox.children.length) listBox.appendChild(loader());
      try {
        let items;
        if (state.homeTab === 'deferred') { const w = await api('/withdrawals?status=deferred&size=100'); items = w.items; }
        else { const [d, w] = await Promise.all([api('/deposits?status=created,processing,failed&size=100'), api('/withdrawals?status=active&size=100')]); items = [...d.items, ...w.items]; }
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listBox.innerHTML = '';
        if (!items.length) listBox.appendChild(empty(state.homeTab === 'deferred' ? 'Отложенных нет' : 'Актуальных заявок нет', 'Новые заявки появятся здесь автоматически.', 'home'));
        else listBox.appendChild(txGroups(items));
        if (manual) toast('Обновлено', 'ok', 1000);
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Не удалось загрузить', e.message)); }
      refresh.disabled = false;
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
      if (q.length < 2) return results.appendChild(empty('Введите запрос', 'Минимум 2 символа: имя, @username, Telegram ID, ID игрока или номер заявки.', 'search'));
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

  /* ------------------------------------------------------------- chats (Чат) */
  function chatsView(shell) {
    if (state.route.id) return chatThreadView(shell, Number(state.route.id));
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    const st = { page: 1 };
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
        if (!r.items.length) return listBox.appendChild(empty(state.chatTab === 'closed' ? 'Обработанных обращений нет' : 'Новых обращений нет', 'Сложные вопросы попадают сюда с контекстом заявок. Простые решает бот.', 'chat'));
        r.items.forEach((cv) => { const ctx = cv.context || {}; const kindCls = cv.category === 'deposit' ? 'deposit' : cv.category === 'withdrawal' ? 'withdraw' : 'neutral'; listBox.appendChild(h('button', { class: 'chat-row ' + kindCls + (cv.status === 'waiting_operator' ? ' waiting' : ''), onclick: () => go('#/chats/' + cv.id) }, h('span', { class: 'avatar' }, (cv.user_name || '?').charAt(0).toUpperCase()), h('span', { class: 'chat-copy' }, h('span', { class: 'chat-name-line' }, h('b', null, cv.user_name || 'Клиент'), cv.category === 'deposit' ? h('i', { class: 'kind-badge deposit' }, 'ПП') : null, cv.category === 'withdrawal' ? h('i', { class: 'kind-badge withdraw' }, 'ВВ') : null, cv.category === 'operator' ? h('i', { class: 'kind-badge operator' }, 'ОП') : null, cv.rating ? h('i', { class: 'kind-badge' }, '★ ' + cv.rating) : null), cv.subject ? h('span', { class: 'chat-mini' }, cv.subject) : null, h('span', { class: 'chat-last' }, cv.status === 'waiting_operator' ? 'Ждёт оператора' : cv.status === 'operator' ? 'В работе у оператора' : cv.status === 'resolved' ? 'Закрыто' : 'Автоответы')), h('span', { class: 'chat-side' }, h('time', null, fmtTime(cv.last_message_at) || ago(cv.updated_at)), cv.unread_count ? h('span', { class: 'unread' }, cv.unread_count) : null))); });
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    load(); watchChanges(screen, load);
  }
  async function chatThreadView(shell, id) {
    const screen = h('section', { class: 'chat-screen' }); shell.appendChild(screen); screen.appendChild(loader(2));
    let lastId = 0;
    const draw = async () => {
      try {
        const r = await api('/support/conversations/' + id); const c = r.item; const ctx = c.context || {}; screen.innerHTML = '';
        const head = h('header', { class: 'chat-head' }, h('button', { class: 'header-btn', onclick: () => go('#/chats') }, svg('back', 18)), h('button', { class: 'chat-person', onclick: () => go('#/users/' + c.user_id) }, h('span', { class: 'avatar mini' }, (c.user_name || '?').charAt(0).toUpperCase()), h('span', null, h('b', null, c.user_name), h('small', null, 'TG ' + c.telegram_id + (c.username ? ' · @' + c.username : '') + ' · ' + (STATUS[c.status] || [c.status])[0]))), can('support') ? h('button', { class: 'chat-close-btn ' + (c.status === 'resolved' ? 'open' : ''), onclick: async () => { if (c.status === 'resolved') { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'operator' } }); draw(); return; } const note = await promptDialog('Завершить обращение', 'Сообщение клиенту (необязательно)'); if (note === null) return; await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'resolved', note } }); go('#/chats'); } }, c.status === 'resolved' ? 'Вернуть' : 'Завершить') : h('span'), h('button', { class: 'header-btn', 'aria-label': 'Меню', onclick: () => chatMenu(c, draw) }, svg('more', 18)));
        screen.appendChild(head);
        if (ctx.deposit || ctx.withdrawal) { const t = ctx.withdrawal && c.category !== 'deposit' ? ctx.withdrawal : ctx.deposit; const dep = t === ctx.deposit; screen.appendChild(h('button', { class: 'case-card', style: { textAlign: 'left', width: 'calc(100% - 20px)' }, onclick: () => openTxSheet(dep ? 'deposit' : 'withdraw', t.id) }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('i', { class: 'kind-badge ' + (dep ? 'deposit' : 'withdraw') }, dep ? 'ПП' : 'ВВ'), h('b', null, (dep ? 'Пополнение ' : 'Вывод ') + t.public_id), h('span', { style: { flex: 1 } }), statusEl(t.status, t.status_label)), h('small', null, t.cash + ' • ID ' + t.player_id + ' • ' + money(t.amount) + ' ' + t.currency + ' • ' + fmtDate(t.created_at)), t.error ? h('small', { style: { color: '#bd344a' } }, t.error) : null)); }
        const feed = h('div', { class: 'chat-feed' });
        const bubble = (m) => h('div', { class: 'bubble ' + (m.direction === 'out' ? 'out ' : '') + m.sender }, m.file_url ? h('img', { src: m.file_url.startsWith('/') ? BASE + m.file_url : m.file_url, alt: '' }) : null, m.text, h('small', null, (m.sender === 'user' ? 'клиент' : m.sender === 'bot' ? 'авто' : m.sender === 'operator' ? 'оператор' : 'система') + ' · ' + fmtTime(m.created_at)));
        r.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); });
        if (!r.messages.length) feed.appendChild(empty('Сообщений нет', 'Сообщения клиента появятся здесь.', 'chat'));
        screen.appendChild(feed);
        const ta = h('textarea', { placeholder: 'Сообщение клиенту...', rows: 1 });
        const send = async () => { const text = ta.value.trim(); if (!text) return; ta.disabled = true; try { const rr = await api('/support/conversations/' + c.id + '/reply', { method: 'POST', body: { text } }); ta.value = ''; feed.appendChild(bubble(rr.message)); feed.scrollTop = feed.scrollHeight; lastId = Math.max(lastId, rr.message.id); } catch (e) { err(e); } ta.disabled = false; ta.focus(); };
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        if (can('support')) screen.appendChild(h('div', { class: 'chat-composer' }, h('button', { class: 'composer-icon', 'aria-label': 'Быстрые ответы', onclick: () => quickPick((text) => { ta.value = text; ta.focus(); }) }, svg('bolt', 19)), ta, h('button', { class: 'send-btn', onclick: send, 'aria-label': 'Отправить' }, svg('send', 18))));
        feed.scrollTop = feed.scrollHeight;
        const poll = setInterval(async () => { if (!document.body.contains(feed)) return clearInterval(poll); try { const rr = await api('/support/conversations/' + c.id + '?after_id=' + lastId); rr.messages.forEach((m) => { feed.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); feed.scrollTop = feed.scrollHeight; }); } catch (e) {} }, 3000);
      } catch (e) { screen.innerHTML = ''; screen.appendChild(header('Чат')); screen.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }
  function chatMenu(c, redraw) {
    const s = sheet({ title: 'Обращение #' + c.id, body: h('div', null, kv([['Клиент', h('a', { href: '#/users/' + c.user_id, onclick: () => s.close() }, c.user_name)], ['Telegram ID', h('span', { class: 'copy mono', onclick: () => copy(c.telegram_id) }, c.telegram_id)], ['Категория', c.category], ['Тема', c.subject || '—'], ['Статус', statusEl(c.status)], ['Создано', fmtDate(c.created_at)], ['Оценка', c.rating ? '★ ' + c.rating : '—']])), actions: [h('button', { class: 'action-btn blue', onclick: async () => { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'operator' } }); s.close(); redraw(); } }, 'Взять в работу'), h('button', { class: 'action-btn', onclick: async () => { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'auto' } }); s.close(); redraw(); } }, 'Вернуть боту')] });
  }
  async function quickPick(onPick) {
    try { const r = await api('/quick-replies'); state.quick = r.items; } catch (e) {}
    const s = sheet({ title: 'Быстрые ответы', body: state.quick.length ? h('div', { class: 'list' }, state.quick.map((q) => h('button', { class: 'card row-card', onclick: () => { s.close(); onPick(q.text); } }, h('div', null, h('b', null, q.title), h('small', null, q.text))))) : empty('Ответов нет', 'Добавьте их в Меню → Быстрые ответы', 'bolt') });
  }

  /* ------------------------------------------------------------- tx sheet / actions */
  const ACTIONS = {
    deposit: (tx) => [['credit', 'Зачислить через API', 'green', ['created', 'expired', 'failed', 'cancelled']], ['mark_success', 'Отметить зачисленным', 'blue', ['created', 'expired', 'failed', 'processing']], ['reject', 'Отклонить', 'danger', ['created', 'expired', 'failed']], ['cancel', 'Отменить', '', ['created']]].filter((a) => a[3].includes(tx.status)),
    withdraw: (tx) => [['take', 'Взять в работу', 'blue', ['created']], ['complete', 'Выполнен', 'green', ['created', 'processing']], ['retry', 'Перепроверить код', '', ['created', 'processing', 'failed']], [tx.deferred ? 'resume' : 'defer', tx.deferred ? 'Вернуть в работу' : 'Отложить', '', ['created', 'processing']], ['reject', 'Отклонить', 'danger', ['created', 'processing', 'failed']]].filter((a) => a[3].includes(tx.status)),
  };
  async function runAction(kind, tx, action, after) {
    let reason = '';
    if (['reject', 'cancel', 'fail'].includes(action)) { reason = await promptDialog('Причина', 'Клиент увидит причину в боте', 'Например: неверные реквизиты'); if (reason === null) return; }
    if (action === 'credit' && !(await confirmDialog('Отправить пополнение в API кассы? На счёт игрока ' + tx.player_id + ' будет зачислено ' + money(tx.pay_amount) + ' ' + tx.currency, 'Зачислить'))) return;
    if (action === 'complete' && !(await confirmDialog('Подтвердите, что перевод ' + money(tx.amount) + ' ' + tx.currency + ' на банк клиента выполнен.', 'Выполнен'))) return;
    try { const r = await api('/' + (kind === 'deposit' ? 'deposits' : 'withdrawals') + '/' + tx.id + '/action', { method: 'POST', body: { action, reason } }); toast('Готово', 'ok'); if (after) after(r.item); } catch (e) { err(e); if (after) after(null); }
  }
  function txRows(tx) {
    const dep = tx.kind === 'deposit';
    return [['Статус', h('span', { style: { display: 'inline-flex', gap: '5px', flexWrap: 'wrap' } }, txStatus(tx), tx.deferred ? h('span', { class: 'pill amber' }, 'отложен') : null)], ['Сумма', h('b', null, money(dep ? tx.pay_amount : tx.amount) + ' ' + tx.currency, dep && tx.amount !== tx.pay_amount ? h('span', { class: 'muted small' }, ' (запрос ' + money(tx.amount) + ')') : null)], ['Касса', tx.cash_name], ['ID игрока', h('span', { class: 'copy mono', onclick: () => copy(tx.player_id) }, tx.player_id, tx.player_name ? ' · ' + tx.player_name : '')], ['Клиент', h('a', { href: '#/users/' + tx.user_id, style: { color: 'var(--blue)' } }, tx.user_name, tx.username ? ' @' + tx.username : '')], ['Telegram ID', h('span', { class: 'copy mono', onclick: () => copy(tx.telegram_id) }, tx.telegram_id)], ['Номер', h('span', { class: 'copy mono', onclick: () => copy(tx.public_id) }, tx.public_id)], ['Создано', fmtDate(tx.created_at)], dep ? ['Истекает', tx.expires_at ? fmtDate(tx.expires_at) : '—'] : ['Выполнено', fmtDate(tx.completed_at)], dep ? ['Оплачено', fmtDate(tx.paid_at)] : ['Референс кассы', tx.provider_ref ? h('span', { class: 'copy mono', onclick: () => copy(tx.provider_ref) }, tx.provider_ref) : '—'], dep ? ['Источник платежа', tx.payment_source || '—'] : null, tx.error ? ['Комментарий', h('span', { style: { color: '#bd344a' } }, tx.error)] : null];
  }
  async function openTxSheet(kind, id) {
    const path = kind === 'deposit' ? 'deposits' : 'withdrawals';
    const s = sheet({ title: (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' #' + id, body: loader(2) });
    try {
      const r = await api('/' + path + '/' + id); const tx = r.item;
      const body = h('div', null, (tx.status === 'failed' || tx.needs_attention) && tx.error ? h('div', { class: 'hint-card err' }, tx.error) : null, kv(txRows(tx)), h('div', { class: 'section-title' }, h('h2', null, 'История')), timeline(r.history));
      if (kind === 'withdraw' && tx.has_generated_qr) body.appendChild(h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/qr.png?kind=generated', alt: 'QR' }), h('div', { class: 'small muted' }, 'QR с суммой для перевода клиенту')));
      s.setBody(body);
      const actions = [h('button', { class: 'action-btn', onclick: () => { s.close(); go('#/' + path + '/' + tx.id); } }, 'Открыть страницу')];
      if (can('operations')) ACTIONS[kind](tx).forEach(([a, label, cls]) => actions.push(h('button', { class: 'action-btn ' + cls, onclick: () => runAction(kind, tx, a, () => { s.close(); openTxSheet(kind, id); }) }, label)));
      s.setActions(actions);
    } catch (e) { s.setBody(empty('Ошибка', e.message)); }
  }
  function txDetailView(shell, path, id) {
    const kind = path === 'deposits' ? 'deposit' : 'withdraw';
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(header((kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' #' + id, { back: () => go('#/home') }));
    const box = h('div', null, loader()); screen.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/' + path + '/' + id); const tx = r.item; box.innerHTML = '';
        const locked = tx.status === 'success' || !can('operations');
        const editField = (label, field, value, opts) => [label, editable(value, Object.assign({ readonly: locked, save: async (v) => { const rr = await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields: { [field]: v } } }); Object.assign(tx, rr.item); } }, opts || {}))];
        const editRows = [editField('ID игрока', 'player_id', tx.player_id)];
        if (kind === 'withdraw') editRows.push(editField('Сумма', 'amount', tx.amount, { type: 'number', render: (v) => money(v) + ' ' + tx.currency }));
        if (kind === 'deposit') editRows.push(editField('Имя игрока', 'player_name', tx.player_name));
        editRows.push(editField('Комментарий', 'error', tx.error, { readonly: !can('operations') }));
        if (kind === 'withdraw') editRows.push(['Отложен', switchEl(tx.deferred, async (v) => { await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields: { deferred: v } } }); })]);
        box.appendChild(h('div', { class: 'card section-card' }, (tx.status === 'failed' || tx.needs_attention) && tx.error ? h('div', { class: 'hint-card err' }, tx.error) : null, kv(txRows(tx).filter((x) => x && !['ID игрока', 'Комментарий'].includes(x[0])))));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Редактирование'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Нажмите иконку рядом с полем'), kv(editRows)));
        if (can('operations') && ACTIONS[kind](tx).length) box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Действия'), h('div', { class: 'stat-grid', style: { marginBottom: 0 } }, ACTIONS[kind](tx).map(([a, label, cls]) => h('button', { class: 'action-btn ' + cls, onclick: () => runAction(kind, tx, a, draw) }, label)))));
        if (kind === 'deposit' && tx.qr_payload) box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'QR для оплаты'), h('div', { class: 'qr-box' }, h('img', { src: API + '/deposits/' + tx.id + '/qr.png', alt: 'QR' })), r.payment_event ? h('div', { class: 'hint-card' }, 'Платёж: ' + r.payment_event.source + ' · ' + money(r.payment_event.amount) + ' · ' + fmtDate(r.payment_event.received_at)) : null));
        if (kind === 'withdraw') box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Реквизиты клиента'), tx.has_generated_qr ? h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/qr.png?kind=generated', alt: 'QR' }), h('div', { class: 'small muted' }, 'QR с суммой ' + money(tx.amount) + ' ' + tx.currency)) : null, tx.qr_file_url ? h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/photo', alt: 'Фото QR' }), h('div', { class: 'small muted' }, 'Фото QR от клиента' + (tx.qr_payload ? '' : ' (не распознан автоматически)'))) : h('div', { class: 'small muted' }, 'QR не прикреплён'), r.payment_links && r.payment_links.length ? h('div', { class: 'tag-row' }, r.payment_links.map((l) => h('a', { class: 'outline-btn', href: l.url, target: '_blank', rel: 'noopener' }, l.name))) : null, kv([['Код вывода', h('span', { class: 'mono copy', onclick: () => copy(tx.code) }, tx.code || '—')]])));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'История'), timeline(r.history)));
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Клиент'), kv([['Имя', h('a', { href: '#/users/' + r.user.id, style: { color: 'var(--blue)' } }, r.user.name)], ['Пополнений', r.user.deposits_count + ' · ' + money(r.user.deposits_sum)], ['Выводов', r.user.withdrawals_count + ' · ' + money(r.user.withdrawals_sum)], ['Заметка', r.user.note || '—'], r.user.is_blocked ? ['Блокировка', h('span', { class: 'pill red' }, 'заблокирован')] : null])));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- users */
  function userDetailView(shell, id) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(header('Клиент', { back: () => go('#/search') }));
    const box = h('div', null, loader()); screen.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/users/' + id); const u = r.item; box.innerHTML = '';
        const patch = (body) => api('/users/' + u.id, { method: 'PATCH', body });
        box.appendChild(h('div', { class: 'card account-card' }, h('span', { class: 'avatar' }, (u.name || '?').charAt(0).toUpperCase()), h('div', { style: { minWidth: 0, flex: 1 } }, h('b', null, u.name), h('small', null, (u.username ? '@' + u.username + ' · ' : '') + 'TG ' + u.telegram_id)), u.is_blocked ? h('span', { class: 'pill red' }, 'блок') : null));
        box.appendChild(h('div', { class: 'card section-card' }, kv([['Telegram ID', h('span', { class: 'copy mono', onclick: () => copy(u.telegram_id) }, u.telegram_id)], ['Язык', u.language], ['Телефон', u.phone || '—'], ['E-mail', u.email ? u.email + (u.email_verified ? ' ✅' : ' (не подтверждён)') : '—'], ['Регистрация', fmtDate(u.created_at)], ['Активность', fmtDate(u.last_seen_at)], ['Пополнений', u.deposits_count + ' · ' + money(u.deposits_sum)], ['Выводов', u.withdrawals_count + ' · ' + money(u.withdrawals_sum)], ['QR вывода', u.has_qr ? 'сохранён' + (u.qr_bank ? ' · ' + u.qr_bank : '') : 'нет'], ['Реф. код', h('span', { class: 'mono' }, u.referral_code)], ['Пригласил', r.inviter ? h('a', { href: '#/users/' + r.inviter.id, style: { color: 'var(--blue)' } }, r.inviter.name) : '—'], ['Реф. баланс', can('settings') ? editable(u.referral_balance, { type: 'number', render: (v) => money(v) + ' KGS', save: (v) => patch({ referral_balance: v }) }) : money(u.referral_balance) + ' KGS'], ['Заметка', editable(u.note, { readonly: !can('users'), save: (v) => patch({ note: v }) })]])));
        box.appendChild(h('div', { class: 'card section-card' }, h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Блокировка'), h('small', null, u.block_reason || 'Клиент может создавать заявки')), switchEl(u.is_blocked, async (v) => { let reason = ''; if (v) { reason = await promptDialog('Причина блокировки', 'Клиент увидит причину'); if (reason === null) throw new Error('Отменено'); } await patch({ is_blocked: v, block_reason: reason }); })), h('div', { class: 'setting-row' }, h('div', null, h('b', null, 'Поддержка'), h('small', null, u.support_blocked ? 'ограничена' : 'доступна')), switchEl(!u.support_blocked, async (v) => { await patch({ support_blocked: !v, support_block_reason: v ? '' : 'Ограничено оператором' }); })), can('support') ? h('button', { class: 'primary-btn', onclick: async () => { const t = await promptDialog('Сообщение клиенту', 'Отправится через основной бот'); if (t) { try { await api('/users/' + u.id + '/message', { method: 'POST', body: { text: t } }); toast('Отправлено', 'ok'); } catch (e) { err(e); } } } }, svg('send', 16), 'Написать клиенту') : null));
        const payouts = await api('/users/' + id + '/referral-payouts').catch(() => ({ items: [] }));
        if (payouts.items.length) box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Вывод реферального баланса'), payouts.items.map((p) => h('div', { class: 'setting-row' }, h('div', null, h('b', null, money(p.amount) + ' KGS · ' + p.public_id), h('small', null, fmtDate(p.created_at) + (p.error ? ' · ' + p.error : ''))), statusEl(p.status), (p.status === 'created' || p.status === 'processing') && can('operations') ? h('button', { class: 'outline-btn green', onclick: async () => { if (await confirmDialog('Подтвердить перевод бонуса ' + money(p.amount) + ' KGS на QR клиента?', 'Выполнен')) { await api('/users/' + u.id + '/referral-payouts/' + p.id + '/action', { method: 'POST', body: { action: 'complete' } }); draw(); } } }, 'Выполнен') : null))));
        const txs = [...r.deposits, ...r.withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Заявки · ' + txs.length)));
        box.appendChild(txs.length ? txGroups(txs, { noAlert: true }) : empty('Заявок нет', 'Клиент ещё не создавал заявок.'));
        if (r.conversations.length) { box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Обращения'))); r.conversations.forEach((c) => box.appendChild(h('button', { class: 'card row-card', onclick: () => go('#/chats/' + c.id) }, h('div', null, h('b', null, c.subject || c.category), h('small', null, fmtDate(c.last_message_at))), statusEl(c.status)))); }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- menu */
  const MENU = [['manage', 'shield', 'Управление OnoiPay', 'green', 'view'], ['stats', 'stats', 'Статистика', 'blue', 'view'], ['cashes', 'wallet', 'Кассы', 'green', 'cashes'], ['events', 'calendar', 'Выписка', 'violet', 'operations'], ['gateway', 'qr', 'Платёжка', 'purple', 'settings'], ['broadcast', 'send', 'Рассылка', 'teal', 'settings'], ['security', 'shield', 'Безопасность', 'teal', 'view'], ['quick', 'bolt', 'Быстрые ответы', 'yellow', 'support'], ['logs', 'terminal', 'Логи', 'red', 'logs'], ['settings', 'settings', 'Настройки', 'gray', 'settings'], ['firstline', 'chat', 'Первая линия', 'blue', 'settings']];
  function menuView(shell) {
    const screen = h('section', { class: 'screen' }); shell.appendChild(screen);
    screen.appendChild(h('div', { class: 'card account-card', style: { marginTop: '18px' } }, h('span', null, svg('user', 22)), h('div', null, h('b', null, 'Мой аккаунт'), h('small', null, (state.admin.name || state.admin.username) + ' · ' + ({ owner: 'Владелец', admin: 'Администратор платформы', operator: 'Оператор', viewer: 'Просмотр' }[state.admin.role] || state.admin.role)))));
    screen.appendChild(h('div', { class: 'menu-grid' }, MENU.filter((m) => can(m[4])).map((m) => h('button', { class: 'card menu-tile', onclick: () => go('#/' + m[0]) }, h('span', { class: 'menu-color ' + m[3] }, svg(m[1], 20)), h('b', null, m[2]))), h('button', { class: 'card menu-tile logout', onclick: logout }, h('span', { class: 'menu-color red' }, svg('logout', 20)), h('b', null, 'Выйти'))));
  }
  function page(shell, title, opts) { const screen = h('section', { class: 'screen' }); shell.appendChild(screen); screen.appendChild(header(title, Object.assign({ back: () => go('#/menu') }, opts || {}))); const box = h('div', null, loader()); screen.appendChild(box); return box; }

  /* ------------------------------------------------------------- manage / stats */
  async function manageView(shell) {
    const box = page(shell, 'Управление OnoiPay', { right: h('button', { class: 'header-btn', onclick: () => render() }, svg('refresh', 18)) });
    try {
      const d = await api('/dashboard'); const q = d.queues, t = d.today; box.innerHTML = '';
      box.appendChild(h('div', { class: 'stat-grid' }, h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, money(t.deposits_sum)), h('div', { class: 'l' }, 'Пополнения сегодня · ' + t.deposits_count)), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, money(t.withdrawals_sum)), h('div', { class: 'l' }, 'Выводы сегодня · ' + t.withdrawals_count)), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.deposits_pending + q.deposits_failed), h('div', { class: 'l' }, 'Пополнений в работе' + (q.deposits_failed ? ' · проблем ' + q.deposits_failed : ''))), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.withdrawals_pending), h('div', { class: 'l' }, 'Выводов в работе' + (q.withdrawals_attention ? ' · внимание ' + q.withdrawals_attention : ''))), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, q.support_waiting), h('div', { class: 'l' }, 'Ждут оператора')), h('div', { class: 'card stat-card' }, h('div', { class: 'v' }, d.total.users), h('div', { class: 'l' }, 'Клиентов · сегодня +' + t.users_new))));
      box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Кассы'), can('cashes') ? h('button', { class: 'outline-btn', onclick: () => go('#/cashes') }, 'Управление') : null));
      d.cashes.forEach((c) => box.appendChild(cashRow(c)));
      box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Уведомления'), h('button', { class: 'outline-btn', onclick: async () => { await api('/notifications/ack-all', { method: 'POST' }); render(); } }, 'Прочитано')));
      const notes = (state.live && state.live.notifications) || [];
      if (!notes.length) box.appendChild(empty('Тихо', 'Уведомления появятся здесь', 'bell'));
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
      box.appendChild(h('div', { class: 'hint-card' }, svg('shield', 16), 'Активна только 1xBet. Остальные кассы выключены и не участвуют в работе бота. Пороги автоотключения настраиваются здесь, не в коде.'));
      if (!r.items.length) box.appendChild(empty('Касс нет', 'Добавьте первую кассу', 'wallet'));
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
    const isNew = !c; c = c || { provider_type: 'servcul', enabled: false, priority: 100, currency: 'KGS', deposit_enabled: true, withdraw_enabled: true, deposit_min: 100, deposit_max: 100000, auto_disable_enabled: true, low_balance_threshold: 20000, critical_balance_threshold: 1000, auto_enable_threshold: 5000, credentials: [] };
    const f = {};
    const field = (label, key, type, opts) => { const el = type === 'select' ? h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(c[key]) }, l))) : type === 'textarea' ? h('textarea', { class: 'textarea' }, c[key] || '') : h('input', { class: 'input', type: type || 'text', value: c[key] === undefined || c[key] === null ? '' : c[key], placeholder: (opts && opts.placeholder) || '' }); f[key] = el; return h('label', { class: 'field' }, h('span', null, label), el); };
    const bool = (label, key) => { const sw = switchEl(!!c[key], async (v) => { f[key].value = v ? '1' : '0'; }); f[key] = h('input', { type: 'hidden', value: c[key] ? '1' : '0' }); return h('div', { class: 'setting-row' }, h('div', null, h('b', null, label)), sw, f[key]); };
    const credBox = h('div');
    const drawCreds = () => { credBox.innerHTML = ''; const type = state.types.find((t) => t.type === (f.provider_type ? f.provider_type.value : c.provider_type)) || { fields: [] }; credBox.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Учётные данные (шифруются)'))); type.fields.forEach((fd) => { const cur = (c.credentials || []).find((x) => x.key === fd.key); const el = h('input', { class: 'input', type: fd.secret ? 'password' : 'text', placeholder: cur && cur.set ? (fd.secret ? 'задано ' + cur.masked + ' — пусто = не менять' : cur.masked) : (fd.required ? 'обязательно' : 'необязательно'), value: cur && !fd.secret && cur.set ? cur.masked : '' }); el.dataset.cred = fd.key; credBox.appendChild(h('label', { class: 'field' }, h('span', null, fd.label), el)); }); };
    const body = h('div', null, isNew ? field('Ключ (латиницей, напр. 1xbet)', 'key') : null, field('Название', 'name'), isNew ? field('Тип', 'provider_type', 'select', state.types.map((t) => [t.type, t.label])) : h('label', { class: 'field' }, h('span', null, 'Тип'), h('input', { class: 'input', value: c.provider_type, disabled: true })), field('Приоритет (меньше — выше)', 'priority', 'number'), field('Валюта кассы', 'currency'), field('ID валют игрока (через запятую, пусто — не проверять)', 'accepted_currency_ids', 'text', { placeholder: 'KGS,417' }), field('IP сервера / белый список', 'ip_address'), field('Base URL API', 'base_url'),
      h('div', { class: 'card section-card' }, bool('Касса включена', 'enabled'), bool('Пополнение', 'deposit_enabled'), bool('Вывод', 'withdraw_enabled')),
      h('div', { class: 'stat-grid' }, field('Мин. пополнение', 'deposit_min', 'number'), field('Макс. пополнение', 'deposit_max', 'number'), field('Комиссия ПП, %', 'deposit_fee_pct', 'number'), field('Комиссия ВВ, %', 'withdraw_fee_pct', 'number')),
      h('div', { class: 'section-title' }, h('h2', null, 'Автоотключение по балансу')), h('div', { class: 'card section-card' }, bool('Автоматически отключать пополнения', 'auto_disable_enabled')),
      field('Порог «мало» (уведомление)', 'low_balance_threshold', 'number'), field('Критический порог (стоп)', 'critical_balance_threshold', 'number'), field('Порог автовключения', 'auto_enable_threshold', 'number'),
      credBox, field('Инструкция по выводу для клиентов', 'instructions_text', 'textarea'), field('Заметки', 'notes', 'textarea'));
    drawCreds(); if (f.provider_type) f.provider_type.onchange = drawCreds;
    const s = sheet({ title: isNew ? 'Новая касса' : c.name, body, actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async (e) => { e.currentTarget.disabled = true; const payload = {}; for (const [k, el] of Object.entries(f)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; const creds = {}; credBox.querySelectorAll('input[data-cred]').forEach((el) => { if (el.value && el.value !== el.placeholder) creds[el.dataset.cred] = el.value; }); payload.credentials = creds; try { if (isNew) await api('/cashes', { method: 'POST', body: payload }); else await api('/cashes/' + c.id, { method: 'PATCH', body: payload }); toast('Сохранено', 'ok'); s.close(); go('#/cashes'); render(); } catch (ex) { err(ex); e.target.disabled = false; } } }, 'Сохранить')] });
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
        if (!r.items.length) return box.appendChild(empty('Платежей нет', 'Подтверждения из банка появятся здесь.', 'calendar'));
        r.items.forEach((ev) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('div', null, h('b', null, money(ev.amount) + ' ' + ev.currency + ' · ' + ev.source), h('small', null, fmtDate(ev.received_at) + ' · ' + (ev.raw_text || '').slice(0, 80))), h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } }, statusEl(ev.status === 'matched' ? 'success' : ev.status === 'failed' ? 'failed' : ev.status === 'processing' ? 'processing' : 'created', ev.status === 'matched' ? 'Зачислен' : ev.status === 'failed' ? 'Ошибка' : ev.status === 'unmatched' ? 'Не найден' : 'Ожидает'), ev.deposit_id ? h('a', { class: 'small', href: '#/deposits/' + ev.deposit_id, style: { color: 'var(--blue)' } }, 'заявка #' + ev.deposit_id) : null, ['unmatched', 'failed', 'received'].includes(ev.status) && can('operations') ? h('button', { class: 'outline-btn', onclick: async () => { try { const rr = await api('/payment-events/' + ev.id + '/retry', { method: 'POST' }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err'); draw(); } catch (ex) { err(ex); } } }, 'Повторить') : null))));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; draw(); }); if (p) box.appendChild(p);
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
    function manualPayment() { const amount = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'Точная сумма с тыйынами, напр. 1500.37' }); const note = h('input', { class: 'input', placeholder: 'Комментарий (откуда платёж)' }); const s = sheet({ title: 'Платёж вручную', body: h('div', null, h('div', { class: 'hint-card' }, 'Введите точную сумму из выписки банка — система найдёт заявку с такой суммой и зачислит её через API кассы.'), h('label', { class: 'field' }, h('span', null, 'Сумма'), amount), h('label', { class: 'field' }, h('span', null, 'Комментарий'), note)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { const rr = await api('/payment-events/manual', { method: 'POST', body: { amount: amount.value, note: note.value } }); toast(rr.result.ok ? 'Зачислено' : (rr.result.message || 'Заявка не найдена'), rr.result.ok ? 'ok' : 'err', 4000); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Провести')] }); }
  }

  /* ------------------------------------------------------------- gateway (Платёжка) */
  async function gatewayView(shell) {
    const box = page(shell, 'Платёжка');
    const draw = async () => {
      try {
        const [rq, bl] = await Promise.all([api('/requisites'), api('/bank-links')]); box.innerHTML = '';
        box.appendChild(h('div', { class: 'hint-card' }, svg('qr', 16), 'Реквизит — QR вашего банка, на который клиенты платят пополнения. В него подставляется точная сумма с тыйынами.'));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Реквизиты'), h('button', { class: 'outline-btn blue', onclick: addRequisite }, svg('plus', 14), 'Добавить')));
        if (!rq.items.length) box.appendChild(empty('Реквизитов нет', 'Без реквизита пополнения недоступны', 'qr'));
        rq.items.forEach((q) => box.appendChild(h('div', { class: 'card wallet-card' }, h('span', { class: 'ico' }, svg('qr', 20)), h('div', { style: { minWidth: 0 } }, h('b', null, q.name), h('small', null, q.bank_name + ' · ' + q.account + (q.holder ? ' · ' + q.holder : '')), h('div', { class: 'tag-row' }, editable(q.priority, { type: 'number', render: (v) => 'приоритет ' + v, save: (v) => api('/requisites/' + q.id, { method: 'PATCH', body: { priority: Number(v) } }) }), h('button', { class: 'outline-btn danger', onclick: async () => { if (await confirmDialog('Удалить реквизит ' + q.name + '?', 'Удалить', true)) { await api('/requisites/' + q.id, { method: 'DELETE' }); draw(); } } }, svg('trash', 13)))), switchEl(q.enabled, async (v) => { await api('/requisites/' + q.id, { method: 'PATCH', body: { enabled: v } }); }))));
        box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Кнопки банков под QR')));
        bl.items.forEach((l) => box.appendChild(h('div', { class: 'card wallet-card' }, h('span', { class: 'ico' }, svg('bank', 20)), h('div', { style: { minWidth: 0 } }, h('b', null, l.name), h('small', null, l.prefix || 'показ QR-картинки')), switchEl(l.enabled, async (v) => { await api('/bank-links', { method: 'POST', body: { key: l.key, enabled: v } }); }))));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    function addRequisite() { const name = h('input', { class: 'input', placeholder: 'Название (напр. Optima основной)' }); const src = h('textarea', { class: 'textarea', placeholder: 'ELQR (000201…) или ссылка банка' }); const file = h('input', { type: 'file', accept: 'image/*', class: 'input' }); file.onchange = async () => { const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/requisites/upload', { method: 'POST', body: fd }); src.value = rr.source; toast('QR распознан: ' + rr.meta.bank_name, 'ok'); } catch (ex) { err(ex); } }; const s = sheet({ title: 'Новый реквизит', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), name), h('label', { class: 'field' }, h('span', null, 'QR / ссылка'), src), h('label', { class: 'field' }, h('span', null, 'или изображение QR'), file)), actions: [h('button', { class: 'action-btn', onclick: () => s.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { try { await api('/requisites', { method: 'POST', body: { name: name.value, source: src.value } }); toast('Добавлено', 'ok'); s.close(); draw(); } catch (ex) { err(ex); } } }, 'Добавить')] }); }
    draw();
  }

  /* ------------------------------------------------------------- broadcast (Рассылка) */
  async function broadcastView(shell) {
    const box = page(shell, 'Рассылка');
    const text = h('textarea', { class: 'textarea', placeholder: 'Текст сообщения для клиентов основного бота…', style: { minHeight: '120px' } });
    const days = h('input', { class: 'input', type: 'number', value: '0', min: '0' });
    const btn = h('button', { class: 'primary-btn' }, svg('send', 16), 'Отправить');
    btn.onclick = async () => {
      if (!text.value.trim()) return toast('Введите текст', 'err');
      if (!(await confirmDialog('Отправить рассылку выбранным клиентам? Отменить отправку будет нельзя.', 'Отправить'))) return;
      btn.disabled = true;
      try { const r = await api('/broadcast', { method: 'POST', body: { text: text.value, only_active_days: Number(days.value || 0) } }); toast('Поставлено в очередь: ' + r.recipients + ' получателей', 'ok', 4000); text.value = ''; } catch (ex) { err(ex); }
      btn.disabled = false;
    };
    box.innerHTML = '';
    let total = null; try { const u = await api('/users?size=1'); total = u.total; } catch (e) { /* ignore */ }
    box.appendChild(h('div', { class: 'hint-card' }, svg('send', 16), 'Сообщение уйдёт через основной бот. Доставка идёт очередью с защитой от лимитов Telegram.' + (total !== null ? ' Клиентов в базе: ' + total + '.' : '')));
    box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Сообщение'), h('label', { class: 'field' }, h('span', null, 'Текст (поддерживается HTML Telegram)'), text), h('label', { class: 'field' }, h('span', null, 'Только клиентам, активным за N дней (0 — всем)'), days), btn));
  }

  /* ------------------------------------------------------------- security (Безопасность) */
  async function securityView(shell) {
    const box = page(shell, 'Безопасность');
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const s = await api('/auth/sessions'); box.innerHTML = '';
        const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль' });
        const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Мин. 10 символов, буквы разного регистра и цифра' });
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
          if (!audit.items.length) box.appendChild(empty('Записей нет', 'Действия администраторов появятся здесь', 'shield'));
          audit.items.forEach((l) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default' } }, h('span', { class: 'avatar mini' }, (l.actor || '?').slice(0, 1).toUpperCase()), h('div', null, h('b', null, l.actor + ' · ' + l.action), h('small', null, (l.entity_type ? l.entity_type + ' ' + (l.entity_id || '') + ' · ' : '') + (l.ip || ''))), h('span', { class: 'small muted' }, fmtDate(l.created_at)))));
        }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- quick replies (Быстрые ответы) */
  async function quickView(shell) {
    const box = page(shell, 'Быстрые ответы', { right: h('button', { class: 'header-btn primary-head', 'aria-label': 'Добавить', onclick: () => edit(null) }, svg('plus', 18)) });
    let items = [];
    const save = async () => { const r = await api('/quick-replies', { method: 'POST', body: { fields: { items } } }); items = r.items; state.quick = items; draw(); };
    const draw = () => {
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'hint-card' }, svg('bolt', 16), 'Шаблоны для оператора в чате поддержки: кнопка «молния» в поле ввода. Доступны {name} и {id}.'));
      if (!items.length) return box.appendChild(empty('Шаблонов нет', 'Нажмите «+», чтобы добавить первый быстрый ответ.', 'bolt'));
      items.forEach((q, i) => box.appendChild(h('div', { class: 'card row-card', style: { cursor: 'default', alignItems: 'flex-start' } }, h('span', { class: 'avatar mini' }, svg('bolt', 15)), h('div', null, h('b', null, q.title), h('small', { style: { whiteSpace: 'normal' } }, q.text)), h('span', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'outline-btn', 'aria-label': 'Изменить', onclick: () => edit(i) }, svg('edit', 13)), h('button', { class: 'outline-btn danger', 'aria-label': 'Удалить', onclick: async () => { if (await confirmDialog('Удалить шаблон «' + q.title + '»?', 'Удалить', true)) { items.splice(i, 1); try { await save(); toast('Удалено', 'ok'); } catch (ex) { err(ex); } } } }, svg('trash', 13))))));
    };
    function edit(i) {
      const q = i === null ? { id: 'q' + Date.now().toString(36), title: '', text: '' } : Object.assign({}, items[i]);
      const title = h('input', { class: 'input', value: q.title, placeholder: 'Короткое название' });
      const text = h('textarea', { class: 'textarea', placeholder: 'Текст ответа', style: { minHeight: '110px' } }, q.text);
      const sh = sheet({ title: i === null ? 'Новый шаблон' : 'Изменить шаблон', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Название'), title), h('label', { class: 'field' }, h('span', null, 'Текст'), text)), actions: [h('button', { class: 'action-btn', onclick: () => sh.close() }, 'Отмена'), h('button', { class: 'action-btn primary', onclick: async () => { if (!text.value.trim()) return toast('Введите текст', 'err'); q.title = title.value.trim() || text.value.trim().slice(0, 30); q.text = text.value.trim(); if (i === null) items.push(q); else items[i] = q; try { await save(); toast('Сохранено', 'ok'); sh.close(); } catch (ex) { err(ex); } } }, 'Сохранить')] });
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
        if (!r.items.length) return list.appendChild(empty('Записей нет', 'Изменённые фильтры или поиск могут скрывать записи.', 'terminal'));
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
  const SETTINGS_GROUPS = [
    ['Бот и тексты', [['brand_name', 'Название бренда'], ['support_username', 'Username поддержки'], ['greeting_text', 'Приветствие ({name}, {support})', 'textarea'], ['withdraw_instruction', 'Инструкция по выводу', 'textarea'], ['withdraw_city', 'Город для вывода'], ['withdraw_address', 'Адрес для вывода'], ['withdraw_sla_text', 'Текст о сроках вывода']]],
    ['Режим работы', [['bot_paused', 'Пауза бота', 'bool'], ['deposits_enabled', 'Пополнения включены', 'bool'], ['withdrawals_enabled', 'Выводы включены', 'bool'], ['subscription_enabled', 'Требовать подписку на канал', 'bool'], ['subscription_channel', 'Канал (@username или id)'], ['phone_required', 'Требовать номер телефона', 'bool']]],
    ['Пополнения', [['payment_timeout_seconds', 'Таймаут оплаты, сек', 'number'], ['random_tiyin', 'Уникальные тыйыны', 'bool'], ['tiyin_min', 'Тыйын мин', 'number'], ['tiyin_max', 'Тыйын макс', 'number'], ['amount_reuse_cooldown_seconds', 'Не переиспользовать сумму, сек', 'number'], ['payment_event_max_age_minutes', 'Ждать платёж после истечения, мин', 'number'], ['deposit_max_active_per_user', 'Активных заявок на клиента', 'number']]],
    ['Выводы и рефералы', [['withdraw_code_min_length', 'Мин. длина кода вывода', 'number'], ['withdraw_processing_timeout_minutes', 'Таймаут обработки вывода, мин', 'number'], ['referral_bonus_pct', 'Реферальный бонус, %', 'number'], ['referral_withdraw_min', 'Мин. вывод реферального баланса', 'number']]],
    ['Мониторинг касс', [['cash_monitor_enabled', 'Автопроверка балансов', 'bool'], ['cash_monitor_interval_seconds', 'Интервал проверки, сек', 'number']]],
    ['Уведомления', [['notify_new_deposit', 'Новое пополнение', 'bool'], ['notify_deposit_success', 'Успешное пополнение', 'bool'], ['notify_deposit_failed', 'Ошибка пополнения', 'bool'], ['notify_new_withdrawal', 'Новый вывод', 'bool'], ['notify_withdrawal_status', 'Статус вывода', 'bool'], ['notify_cash_critical', 'Критические ошибки касс', 'bool'], ['notify_support_operator', 'Обращения оператору', 'bool'], ['ui_poll_seconds', 'Опрос панели, сек', 'number'], ['ui_page_size', 'Размер страницы', 'number']]],
  ];
  const SUPPORT_GROUPS = [
    ['Автоответчик', [['support_greeting', 'Приветствие поддержки', 'textarea'], ['support_auto_resolve_hours', 'Автозакрытие тихих диалогов, ч', 'number']]],
    ['Антифлуд', [['support_rate_limit_messages', 'Сообщений в окне', 'number'], ['support_rate_limit_window_seconds', 'Окно, сек', 'number'], ['support_cooldown_seconds', 'Cooldown при превышении, сек', 'number'], ['support_debounce_seconds', 'Объединять сообщения, сек', 'number'], ['support_duplicate_window_seconds', 'Окно повторов, сек', 'number'], ['support_escalation_cooldown_seconds', 'Пауза между эскалациями, сек', 'number']]],
  ];
  function settingsForm(box, groups, values, extraTop) {
    const inputs = {};
    box.innerHTML = '';
    if (extraTop) box.appendChild(extraTop);
    groups.forEach(([title, fields]) => {
      const card = h('div', { class: 'card section-card' }, h('h2', null, title));
      fields.forEach(([key, label, type]) => {
        if (!(key in values)) return;
        if (type === 'bool') { const hidden = h('input', { type: 'hidden', value: values[key] ? '1' : '0' }); inputs[key] = hidden; card.appendChild(h('div', { class: 'setting-row' }, h('div', null, h('b', null, label), h('small', null, key)), switchEl(!!values[key], async (v) => { hidden.value = v ? '1' : '0'; }), hidden)); return; }
        const el = type === 'textarea' ? h('textarea', { class: 'textarea' }, values[key] === null || values[key] === undefined ? '' : String(values[key])) : h('input', { class: 'input', type: type || 'text', step: type === 'number' ? 'any' : undefined, value: values[key] === null || values[key] === undefined ? '' : values[key] });
        inputs[key] = el; card.appendChild(h('label', { class: 'field' }, h('span', null, label), el));
      });
      box.appendChild(card);
    });
    box.appendChild(h('button', { class: 'primary-btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const payload = {}; for (const [k, el] of Object.entries(inputs)) payload[k] = el.type === 'hidden' ? el.value === '1' : el.value; try { await api('/settings', { method: 'POST', body: { values: payload } }); toast('Настройки сохранены', 'ok'); } catch (ex) { err(ex); } b.disabled = false; } }, svg('check', 16), 'Сохранить'));
    return inputs;
  }
  async function settingsView(shell) {
    const box = page(shell, 'Настройки');
    try {
      const r = await api('/settings');
      const links = h('div', { class: 'list', style: { marginBottom: '12px' } },
        h('button', { class: 'card row-card', onclick: () => go('#/gateway') }, h('span', { class: 'avatar mini' }, svg('qr', 16)), h('div', null, h('b', null, 'Платёжка'), h('small', null, 'Реквизиты QR и кнопки банков')), svg('chevron', 16)),
        h('button', { class: 'card row-card', onclick: () => go('#/push') }, h('span', { class: 'avatar mini' }, svg('bell', 16)), h('div', null, h('b', null, 'Push-уведомления'), h('small', null, 'Подписка этого устройства и тест')), svg('chevron', 16)),
        h('button', { class: 'card row-card', onclick: () => go('#/env') }, h('span', { class: 'avatar mini' }, svg('terminal', 16)), h('div', null, h('b', null, 'Окружение'), h('small', null, 'Домен, webhook, SMTP, боты (из .env)')), svg('chevron', 16)));
      settingsForm(box, SETTINGS_GROUPS, r.values, links);
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- first line (Первая линия — автоподдержка) */
  async function firstLineView(shell) {
    const box = page(shell, 'Первая линия');
    try {
      const r = await api('/settings');
      const q = (state.live && state.live.queues) || {};
      const top = h('div', null,
        h('div', { class: 'hint-card' }, svg('chat', 16), 'Бот поддержки отвечает сам: статусы заявок, инструкции, курсы валют и частые вопросы. Оператор подключается только по эскалации.'),
        h('div', { class: 'stat-grid', style: { marginBottom: '12px' } }, h('div', { class: 'card stat-card red' }, h('div', { class: 'v' }, q.support_waiting || 0), h('div', { class: 'l' }, 'ждут оператора')), h('div', { class: 'card stat-card blue' }, h('div', { class: 'v' }, q.support_open || 0), h('div', { class: 'l' }, 'открытых диалогов')), h('div', { class: 'card stat-card green' }, h('div', { class: 'v' }, q.support_closed || 0), h('div', { class: 'l' }, 'закрыто ботом'))),
        h('div', { class: 'list', style: { marginBottom: '12px' } }, h('button', { class: 'card row-card', onclick: () => go('#/chats') }, h('span', { class: 'avatar mini' }, svg('chat', 16)), h('div', null, h('b', null, 'Открыть чаты'), h('small', null, 'Диалоги клиентов с ботом и оператором')), svg('chevron', 16)), h('button', { class: 'card row-card', onclick: () => go('#/quick') }, h('span', { class: 'avatar mini' }, svg('bolt', 16)), h('div', null, h('b', null, 'Быстрые ответы'), h('small', null, 'Шаблоны для оператора')), svg('chevron', 16))));
      settingsForm(box, SUPPORT_GROUPS, r.values, top);
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- push */
  function urlB64ToUint8(b64) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function pushView(shell) {
    const box = page(shell, 'Push-уведомления', { back: () => go('#/settings') });
    const draw = async () => {
      box.innerHTML = ''; box.appendChild(loader(2));
      try {
        const r = await api('/push/config'); box.innerHTML = '';
        const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        let subscribed = false; try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); subscribed = !!(reg && (await reg.pushManager.getSubscription())); } catch (e) { /* ignore */ }
        box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Состояние'), kv([['Сервер', r.enabled ? h('span', { class: 'pill green' }, 'VAPID настроен') : h('span', { class: 'pill red' }, 'VAPID-ключей нет в .env')], ['Браузер', supported ? h('span', { class: 'pill green' }, 'поддерживает push') : h('span', { class: 'pill red' }, 'не поддерживает')], ['Это устройство', subscribed ? h('span', { class: 'pill green' }, 'подписано') : h('span', { class: 'pill' }, 'не подписано')], ['Разрешение', typeof Notification !== 'undefined' ? Notification.permission : '—'], ['Всего устройств', r.subscriptions]])));
        box.appendChild(h('div', { class: 'hint-card' }, svg('bell', 16), 'Критические события (ошибки касс, проблемные заявки) приходят отдельным каналом со звуком даже при закрытой панели. На iPhone панель нужно добавить на экран «Домой».'));
        box.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'primary-btn', disabled: !supported || !r.enabled, onclick: async () => { try { const reg = await navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }); const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Уведомления запрещены в браузере', 'err'); const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(r.public_key) }); await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); toast('Подписка включена на этом устройстве', 'ok'); draw(); } catch (ex) { err(ex); } } }, svg('bell', 16), 'Включить на этом устройстве'),
          h('button', { class: 'outline-btn blue', onclick: async () => { try { await api('/push/test', { method: 'POST' }); toast('Тест отправлен', 'ok'); } catch (ex) { err(ex); } } }, 'Тест'),
          h('button', { class: 'outline-btn', disabled: !supported, onclick: async () => { try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await api('/push/unsubscribe', { method: 'POST', body: sub.toJSON() }); await sub.unsubscribe(); } toast('Отключено', 'ok'); draw(); } catch (ex) { err(ex); } } }, 'Отключить')));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- env (Окружение) */
  async function envView(shell) {
    const box = page(shell, 'Окружение', { back: () => go('#/settings') });
    try {
      const r = await api('/settings'); const e = r.env; box.innerHTML = '';
      box.appendChild(h('div', { class: 'hint-card' }, svg('terminal', 16), 'Значения берутся из .env на сервере и здесь только читаются. Секреты не показываются.'));
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Сервер'), kv([['Публичный URL', e.public_url + e.base_path + '/'], ['Webhook платежей', h('span', { class: 'mono small', style: { wordBreak: 'break-all' } }, e.webhook_url)], ['База данных', e.database], ['Часовой пояс', e.timezone]])));
      box.appendChild(h('div', { class: 'card section-card' }, h('h2', null, 'Интеграции'), kv([['SMTP', e.smtp_configured ? e.smtp_host + ' · ' + e.smtp_from : 'не настроен'], ['IMAP-источник платежей', e.imap_enabled ? 'включён' : 'выключен'], ['Основной бот', e.main_bot ? '@' + e.main_bot : '—'], ['Бот поддержки', e.support_bot ? '@' + e.support_bot : '—'], ['Telegram-чаты админов', (e.admin_chat_ids || []).join(', ') || '—'], ['Web Push', e.push_configured ? 'настроен' : 'нет']])));
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
