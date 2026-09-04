/* OnoiPay Admin SPA — no build step, no framework. */
(function () {
  'use strict';
  const BASE = location.pathname.replace(/\/[^/]*$/, '') || '';
  const API = BASE + '/api';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const state = { admin: null, route: { page: 'dashboard', id: null }, live: null, poll: null, lastNotifId: 0, cashes: [], types: [], seenNotif: new Set(), pushKey: '' };

  /* ---------------------------------------------------------------- utils */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const money = (v) => { const n = Number(v || 0); return n.toLocaleString('ru-RU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  const fmtDate = (v, withYear) => { if (!v) return '—'; const d = new Date(v); if (isNaN(d)) return String(v); const o = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }; if (withYear) o.year = 'numeric'; return d.toLocaleString('ru-RU', o).replace(',', ''); };
  const fmtTime = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  const ago = (v) => { if (!v) return ''; const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000); if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин'; if (s < 86400) return Math.floor(s / 3600) + ' ч'; return Math.floor(s / 86400) + ' дн'; };
  function getCookie(name) { return document.cookie.split('; ').map((x) => x.split('=')).filter((x) => x[0] === name).map((x) => decodeURIComponent(x[1]))[0] || ''; }
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    if ((opts.method || 'GET') !== 'GET') headers['X-CSRF-Token'] = (state.admin && state.admin.csrf_token) || getCookie('onoipay_csrf');
    let res;
    try { res = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, opts, { headers })); }
    catch (e) { throw new Error('Нет соединения с сервером'); }
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (res.status === 401) { if (state.admin) { state.admin = null; render(); } throw new Error('Сессия истекла — войдите снова'); }
    if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || ('Ошибка ' + res.status));
    return data;
  }
  function toast(text, kind, ms) {
    const el = h('div', { class: 'toast ' + (kind || '') }, text);
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, ms || (kind === 'err' ? 4200 : 2600));
  }
  const err = (e) => toast(e && e.message ? e.message : String(e), 'err');
  function copy(text) { navigator.clipboard && navigator.clipboard.writeText(String(text)).then(() => toast('Скопировано', 'ok', 1200)).catch(() => {}); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function confirmDialog(text, okLabel, danger) {
    return new Promise((resolve) => {
      const m = modal({ title: 'Подтверждение', body: h('p', null, text), actions: [
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { m.close(); resolve(true); } }, okLabel || 'Да'),
      ] });
    });
  }
  function promptDialog(title, label, placeholder) {
    return new Promise((resolve) => {
      const input = h('textarea', { class: 'textarea', placeholder: placeholder || '' });
      const m = modal({ title, body: h('label', { class: 'field' }, h('span', null, label || ''), input), actions: [
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(null); } }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(input.value.trim()); } }, 'Продолжить'),
      ] });
      setTimeout(() => input.focus(), 50);
    });
  }

  /* ---------------------------------------------------------------- modal */
  function modal(opts) {
    const root = $('#modal-root');
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('header', null, h('h2', null, opts.title || ''), opts.headerRight || null, h('button', { class: 'btn icon ghost', 'aria-label': 'Закрыть', onclick: () => api_.close() }, '✕')),
      h('div', { class: 'content' }, opts.body),
      opts.actions && opts.actions.length ? h('footer', null, ...opts.actions) : null);
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) api_.close(); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') api_.close(); };
    const api_ = { el: box, close() { back.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; if (opts.onClose) opts.onClose(); }, setBody(node) { const c = $('.content', box); c.innerHTML = ''; c.appendChild(node); } };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    root.appendChild(back);
    return api_;
  }

  /* ------------------------------------------------------------- components */
  const STATUS_META = {
    created: ['Ожидает', 'blue'], processing: ['В обработке', 'blue'], success: ['Успешно', 'green'], failed: ['Ошибка', 'red'], cancelled: ['Отменено', 'gray'], expired: ['Истекло', 'gray'],
    auto: ['Авто', 'gray'], waiting_operator: ['Ждёт оператора', 'red'], operator: ['У оператора', 'blue'], resolved: ['Закрыто', 'green'], closed: ['Закрыто', 'gray'],
    online: ['Онлайн', 'green'], error: ['Ошибка', 'red'], low: ['Мало средств', 'amber'], disabled: ['Отключена', 'gray'], auto_disabled: ['Автостоп', 'red'], unknown: ['Не проверена', 'gray'],
  };
  function statusBadge(status, label) { const m = STATUS_META[status] || [status, 'gray']; return h('span', { class: 'badge ' + m[1] }, h('i'), label || m[0]); }
  function switchEl(on, onChange) { const b = h('button', { class: 'switch ' + (on ? 'on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false' }); b.onclick = async () => { b.disabled = true; try { await onChange(!b.classList.contains('on')); b.classList.toggle('on'); } catch (e) { err(e); } b.disabled = false; }; return b; }
  function empty(title, text) { return h('div', { class: 'empty' }, h('b', null, title || 'Пока пусто'), h('div', null, text || 'Новые данные появятся здесь автоматически.')); }
  function loader() { return h('div', null, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })); }
  function pager(page, size, total, go) {
    const pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) return null;
    return h('div', { class: 'pager' }, h('button', { class: 'btn sm', disabled: page <= 1, onclick: () => go(page - 1) }, '‹'), h('span', { class: 'muted small' }, page + ' / ' + pages), h('button', { class: 'btn sm', disabled: page >= pages, onclick: () => go(page + 1) }, '›'));
  }
  function tabs(items, active, onSelect) { return h('div', { class: 'tabs' }, items.map(([key, label, count]) => h('button', { class: 'tab ' + (key === active ? 'active' : ''), onclick: () => onSelect(key) }, label, count ? ' ' : '', count ? h('span', { class: 'badge count' }, count) : null))); }
  /** Inline editable field: pencil → input/select → save (PATCH/POST) → toast */
  function editable(value, opts) {
    const wrap = h('span', { class: 'editable' });
    const show = () => { wrap.innerHTML = ''; wrap.appendChild(h('span', null, opts.render ? opts.render(value) : (value === '' || value === null ? '—' : String(value)))); if (!opts.readonly) wrap.appendChild(h('button', { class: 'pen', title: 'Изменить', onclick: edit }, '✎')); };
    const edit = () => {
      const input = opts.options ? h('select', { class: 'select' }, opts.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))) : h('input', { class: 'input', value: value === null ? '' : value, type: opts.type || 'text' });
      const save = async () => { try { const v = input.value; await opts.save(v); value = v; toast('Сохранено', 'ok', 1400); show(); } catch (e) { err(e); } };
      wrap.innerHTML = '';
      wrap.appendChild(h('span', { class: 'inline' }, input, h('button', { class: 'btn sm primary', onclick: save }, '✓'), h('button', { class: 'btn sm', onclick: show }, '✕')));
      input.focus();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') show(); });
    };
    show();
    return wrap;
  }
  function kv(rows) { return h('dl', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === undefined || v === null || v === '' ? '—' : v)])); }
  function timeline(items) { if (!items || !items.length) return h('div', { class: 'muted small' }, 'История пуста'); return h('ul', { class: 'timeline' }, items.map((it) => h('li', { class: it.level || '' }, h('time', null, fmtDate(it.at, true)), h('div', null, it.title), it.detail ? h('div', { class: 'muted small' }, it.detail) : null))); }

  /* ------------------------------------------------------------- router */
  function parseHash() { const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/'); return { page: parts[0] || 'dashboard', id: parts[1] || null, sub: parts[2] || null }; }
  window.addEventListener('hashchange', () => { state.route = parseHash(); render(); });
  const go = (hash) => { location.hash = hash; };

  /* ------------------------------------------------------------- shell */
  const NAV = [['dashboard', 'Dashboard', '▦'], ['deposits', 'Пополнения', '↓'], ['withdrawals', 'Выводы', '↑'], ['users', 'Пользователи', '👤'], ['cashes', 'Кассы', '🏦'], ['support', 'Поддержка', '💬'], ['settings', 'Настройки', '⚙'], ['logs', 'Логи', '☰']];
  const PERM = { cashes: 'cashes', settings: 'settings', logs: 'logs', support: 'support', users: 'users' };
  function can(p) { return !!(state.admin && state.admin.permissions.includes(p)); }
  function badgeFor(page) {
    const q = state.live && state.live.queues; if (!q) return 0;
    if (page === 'deposits') return q.deposits_pending + q.deposits_failed;
    if (page === 'withdrawals') return q.withdrawals_pending;
    if (page === 'support') return q.support_waiting;
    return 0;
  }
  function render() {
    const app = $('#app');
    app.innerHTML = '';
    if (!state.admin) { app.appendChild(loginView()); return; }
    const page = state.route.page;
    const items = NAV.filter(([k]) => !PERM[k] || can(PERM[k]));
    const sidebar = h('aside', { class: 'sidebar' },
      h('div', { class: 'brand' }, h('img', { src: 'brand/onoipay-logo.png', alt: '' }), h('b', null, 'OnoiPay')),
      items.map(([key, label, icon]) => h('button', { class: 'nav-item ' + (page === key ? 'active' : ''), onclick: () => go('#/' + key) }, h('span', null, icon), label, badgeFor(key) ? h('span', { class: 'badge count' }, badgeFor(key)) : null)),
      h('div', { class: 'spacer' }),
      h('div', { class: 'small muted', style: { padding: '8px 12px' } }, state.admin.name, h('br'), h('span', { class: 'badge gray' }, state.admin.role)),
      h('button', { class: 'nav-item', onclick: logout }, '⎋ Выйти'));
    const mobile = h('nav', { class: 'mobile-nav' }, items.slice(0, 5).map(([key, label, icon]) => h('button', { class: page === key ? 'active' : '', onclick: () => go('#/' + key) }, h('span', null, icon), label, badgeFor(key) ? h('span', { class: 'badge count' }, badgeFor(key)) : null)));
    const main = h('main', { class: 'main' });
    app.appendChild(h('div', { class: 'shell' }, sidebar, main, mobile));
    const views = { dashboard: dashboardView, deposits: depositsView, withdrawals: withdrawalsView, users: usersView, cashes: cashesView, support: supportView, settings: settingsView, logs: logsView };
    (views[page] || dashboardView)(main);
  }

  /* ------------------------------------------------------------- auth */
  function loginView() {
    const user = h('input', { class: 'input', placeholder: 'Логин', autocomplete: 'username', autocapitalize: 'none' });
    const pass = h('input', { class: 'input', placeholder: 'Пароль', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary block' }, 'Войти');
    const form = h('form', { class: 'login-card', onsubmit: async (e) => { e.preventDefault(); btn.disabled = true; try { const r = await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } }); state.admin = r.admin; state.route = parseHash(); startLive(); render(); } catch (ex) { err(ex); } btn.disabled = false; } },
      h('div', { class: 'logo' }, h('img', { src: 'brand/onoipay-logo.png', alt: '' }), h('div', null, h('h1', null, 'OnoiPay'), h('div', { class: 'muted small' }, 'Панель управления'))),
      h('label', { class: 'field' }, h('span', null, 'Логин'), user), h('label', { class: 'field' }, h('span', null, 'Пароль'), pass), btn);
    return h('div', { class: 'login' }, form);
  }
  async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch (e) {} state.admin = null; stopLive(); render(); }

  /* ------------------------------------------------------------- live */
  function startLive() {
    stopLive();
    const tick = async () => {
      try {
        const r = await api('/live');
        const prev = state.live;
        state.live = r;
        updateBadges();
        for (const n of r.notifications.slice().reverse()) {
          if (n.id > state.lastNotifId) {
            if (state.lastNotifId) { toast(n.title + (n.body ? ' — ' + n.body.split('\n')[0] : ''), n.level === 'critical' ? 'crit' : '', 5000); beep(n.level === 'critical'); }
            state.lastNotifId = Math.max(state.lastNotifId, n.id);
          }
        }
        if (prev && JSON.stringify(prev.revision) !== JSON.stringify(r.revision)) document.dispatchEvent(new CustomEvent('onoi:changed', { detail: r.revision }));
      } catch (e) { /* silent */ }
    };
    tick();
    state.poll = setInterval(tick, 3000);
    setInterval(() => { api('/auth/refresh', { method: 'POST' }).then((r) => { state.admin = r.admin; }).catch(() => {}); }, 10 * 60 * 1000);
  }
  function stopLive() { if (state.poll) clearInterval(state.poll); state.poll = null; }
  function updateBadges() { document.querySelectorAll('.nav-item, .mobile-nav button').forEach((b) => { const key = NAV.find(([k, l]) => b.textContent.includes(l)); if (!key) return; const old = b.querySelector('.badge'); const n = badgeFor(key[0]); if (old) old.remove(); if (n) b.appendChild(h('span', { class: 'badge count' }, n)); }); }
  let audioCtx;
  function beep(critical) { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = critical ? 880 : 660; g.gain.value = 0.08; o.start(); o.stop(audioCtx.currentTime + (critical ? 0.35 : 0.15)); } catch (e) {} }
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'ONOI_OPEN' && d.url) { const hash = String(d.url).split('#')[1]; if (hash) go('#' + hash); } if (d.type === 'ONOI_PUSH' && d.payload) { toast(d.payload.title + ' — ' + (d.payload.body || ''), d.payload.channel === 'critical' ? 'crit' : '', 5000); } });

  /* ------------------------------------------------------------- dashboard */
  async function dashboardView(main) {
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Dashboard'), h('button', { class: 'btn sm', onclick: () => render() }, '↻ Обновить')));
    const box = h('div', null, loader()); main.appendChild(box);
    try {
      const d = await api('/dashboard');
      const q = d.queues, t = d.today;
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'grid cols-4' },
        h('div', { class: 'card stat green' }, h('div', { class: 'v' }, money(t.deposits_sum)), h('div', { class: 'l' }, 'Пополнения сегодня · ' + t.deposits_count)),
        h('div', { class: 'card stat blue' }, h('div', { class: 'v' }, money(t.withdrawals_sum)), h('div', { class: 'l' }, 'Выводы сегодня · ' + t.withdrawals_count)),
        h('div', { class: 'card stat ' + (q.deposits_pending ? 'blue' : '') }, h('div', { class: 'v' }, q.deposits_pending), h('div', { class: 'l' }, 'Пополнения в ожидании' + (q.deposits_failed ? ' · ошибок ' + q.deposits_failed : ''))),
        h('div', { class: 'card stat ' + (q.withdrawals_pending ? 'blue' : '') }, h('div', { class: 'v' }, q.withdrawals_pending), h('div', { class: 'l' }, 'Выводы в ожидании' + (q.withdrawals_attention ? ' · требуют внимания ' + q.withdrawals_attention : '')))));
      box.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Кассы'), can('cashes') ? h('button', { class: 'btn sm', onclick: () => go('#/cashes') }, 'Управление') : null));
      box.appendChild(h('div', { class: 'grid cols-3' }, d.cashes.length ? d.cashes.map(cashCard) : empty('Нет касс', 'Добавьте кассу в разделе «Кассы»')));
      const row = h('div', { class: 'grid cols-2', style: { marginTop: '14px' } });
      const act = h('div', { class: 'card' }, h('h2', null, 'Актуальные заявки'), h('div', { class: 'list', id: 'dash-active' }, loader()));
      const notif = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { style: { flex: 1 } }, 'Уведомления' + (q.notifications_unread ? ' · ' + q.notifications_unread : '')), h('button', { class: 'btn sm ghost', onclick: async () => { await api('/notifications/ack-all', { method: 'POST' }); render(); } }, 'Прочитано')), h('div', { class: 'list notif-list', id: 'dash-notif' }));
      row.appendChild(act); row.appendChild(notif); box.appendChild(row);
      const [deps, wds] = await Promise.all([api('/deposits?status=active&size=8'), api('/withdrawals?status=active&size=8')]);
      const list = $('#dash-active'); list.innerHTML = '';
      const items = [...deps.items, ...wds.items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (!items.length) list.appendChild(empty('Нет актуальных заявок', 'Все заявки обработаны'));
      items.forEach((tx) => list.appendChild(txItem(tx)));
      const nl = $('#dash-notif'); nl.innerHTML = '';
      const notes = (state.live && state.live.notifications) || [];
      if (!notes.length) nl.appendChild(empty('Тихо', 'Уведомления появятся здесь'));
      notes.slice(0, 8).forEach((n) => nl.appendChild(h('div', { class: 'item', onclick: () => { if (n.data && n.data.url) go(n.data.url); } }, h('div', { class: 'ico ' + (n.level === 'critical' ? 'attn' : '') }, n.level === 'critical' ? '!' : '•'), h('div', { class: 'body' }, h('b', null, n.title), h('small', null, n.body)), h('div', { class: 'right' }, h('time', null, ago(n.created_at))))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Не удалось загрузить', e.message)); }
  }
  function cashCard(c) {
    return h('div', { class: 'card flat', style: { cursor: 'pointer' }, onclick: () => go('#/cashes/' + c.id) },
      h('div', { class: 'row' }, h('span', { class: 'dot ' + c.status }), h('b', { style: { flex: 1 } }, c.name), statusBadge(c.status)),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, c.provider_type + ' · приоритет ' + c.priority),
      h('div', { style: { marginTop: '8px', fontSize: '18px', fontWeight: 700 } }, c.last_balance !== null && c.last_balance !== undefined ? money(c.last_balance) + ' ' + c.currency : '—'),
      h('div', { class: 'small muted' }, c.last_check_at ? 'проверено ' + ago(c.last_check_at) + ' назад' : 'не проверялась', c.last_check_ok === false && c.last_check_message ? ' · ' + c.last_check_message : ''),
      h('div', { class: 'pill-row', style: { marginTop: '8px' } }, h('span', { class: 'badge ' + (c.deposit_enabled && !c.auto_disabled ? 'green' : 'gray') }, 'Пополнение'), h('span', { class: 'badge ' + (c.withdraw_enabled ? 'green' : 'gray') }, 'Вывод')));
  }
  function txItem(tx) {
    const dep = tx.kind === 'deposit';
    const attn = tx.needs_attention || tx.status === 'failed';
    return h('div', { class: 'item', onclick: () => openTxModal(tx.kind, tx.id) },
      h('div', { class: 'ico ' + (attn ? 'attn' : dep ? 'dep' : 'wd') }, dep ? '↓' : '↑'),
      h('div', { class: 'body' }, h('b', null, tx.user_name || 'Клиент', tx.username ? ' · @' + tx.username : ''), h('small', null, tx.cash_name + ' · ID ' + tx.player_id + ' · ' + tx.public_id)),
      h('div', { class: 'right' }, h('strong', { class: 'amount ' + (dep ? 'dep' : 'wd') }, (dep ? '+' : '−') + money(dep ? tx.pay_amount : tx.amount)), h('time', null, fmtDate(tx.created_at)), h('div', null, statusBadge(tx.status, tx.status_label))));
  }

  /* ------------------------------------------------------------- operations list */
  function opsList(kind, main, tabsDef, title) {
    const st = { tab: tabsDef[0][0], q: '', page: 1, size: 30 };
    const head = h('div', { class: 'topbar' }, h('h1', null, title));
    main.appendChild(head);
    const search = h('input', { class: 'input', placeholder: 'Поиск: ID, номер, @username, Telegram ID', oninput: debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350) });
    const tabsBox = h('div'); const listBox = h('div', { style: { marginTop: '10px' } });
    main.appendChild(h('div', { class: 'toolbar' }, search)); main.appendChild(tabsBox); main.appendChild(listBox);
    const renderTabs = () => { tabsBox.innerHTML = ''; tabsBox.appendChild(tabs(tabsDef, st.tab, (k) => { st.tab = k; st.page = 1; load(); })); };
    async function load() {
      renderTabs(); listBox.innerHTML = ''; listBox.appendChild(loader());
      try {
        const status = st.tab === 'all' ? '' : st.tab;
        const r = await api('/' + kind + '?status=' + encodeURIComponent(status) + '&q=' + encodeURIComponent(st.q) + '&page=' + st.page + '&size=' + st.size);
        listBox.innerHTML = '';
        if (!r.items.length) { listBox.appendChild(empty('Заявок нет', 'Здесь появятся ' + (kind === 'deposits' ? 'пополнения' : 'выводы'))); return; }
        if (window.innerWidth < 700) { const l = h('div', { class: 'list' }); r.items.forEach((tx) => l.appendChild(txItem(tx))); listBox.appendChild(l); }
        else {
          listBox.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, ['№', 'Клиент', 'Касса / ID', 'Сумма', 'Статус', 'Создано', ''].map((x) => h('th', null, x)))),
            h('tbody', null, r.items.map((tx) => h('tr', { class: (tx.needs_attention || tx.status === 'failed') ? 'attn' : (tx.status === 'created' || tx.status === 'processing') ? 'active-row' : '', onclick: () => openTxModal(tx.kind, tx.id) },
              h('td', { class: 'mono' }, tx.public_id), h('td', null, h('b', null, tx.user_name), h('div', { class: 'small muted' }, tx.username ? '@' + tx.username : tx.telegram_id)),
              h('td', null, tx.cash_name, h('div', { class: 'small muted' }, 'ID ' + tx.player_id)), h('td', null, h('b', { class: 'amount ' + (tx.kind === 'deposit' ? 'dep' : 'wd') }, money(tx.kind === 'deposit' ? tx.pay_amount : tx.amount) + ' ' + tx.currency)),
              h('td', null, statusBadge(tx.status, tx.status_label), tx.deferred ? h('span', { class: 'badge amber', style: { marginLeft: '4px' } }, 'отложен') : null, tx.needs_attention ? h('span', { class: 'badge red', style: { marginLeft: '4px' } }, 'внимание') : null),
              h('td', { class: 'small muted' }, fmtDate(tx.created_at)), h('td', null, h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); go('#/' + kind + '/' + tx.id); } }, 'Открыть'))))))));
        }
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; load(); }); if (p) listBox.appendChild(p);
      } catch (e) { listBox.innerHTML = ''; listBox.appendChild(empty('Ошибка', e.message)); }
    }
    load();
    const onChange = () => { if (st.page === 1) load(); };
    document.addEventListener('onoi:changed', onChange);
    const obs = new MutationObserver(() => { if (!document.body.contains(main)) { document.removeEventListener('onoi:changed', onChange); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: false });
  }
  function depositsView(main) { if (state.route.id) return txDetailView(main, 'deposits', state.route.id); opsList('deposits', main, [['active', 'Актуальные'], ['problem', 'Ошибки'], ['success', 'Зачислено'], ['all', 'Все']], 'Пополнения'); }
  function withdrawalsView(main) { if (state.route.id) return txDetailView(main, 'withdrawals', state.route.id); opsList('withdrawals', main, [['active', 'Актуальные'], ['deferred', 'Отложенные'], ['problem', 'Проблемные'], ['success', 'Выполнено'], ['all', 'Все']], 'Выводы'); }

  /* ------------------------------------------------------------- tx modal & actions */
  const ACTIONS = {
    deposit: (tx) => [
      ['credit', 'Зачислить через API', 'green', ['created', 'expired', 'failed', 'cancelled']],
      ['mark_success', 'Отметить зачисленным', 'blue', ['created', 'expired', 'failed', 'processing']],
      ['reject', 'Отклонить', 'danger', ['created', 'expired', 'failed']],
      ['cancel', 'Отменить', '', ['created']],
    ].filter((a) => a[3].includes(tx.status)),
    withdraw: (tx) => [
      ['take', 'Взять в работу', 'blue', ['created']],
      ['complete', 'Выполнен', 'green', ['created', 'processing']],
      ['retry', 'Перепроверить код', '', ['created', 'processing', 'failed']],
      [tx.deferred ? 'resume' : 'defer', tx.deferred ? 'Вернуть в работу' : 'Отложить', '', ['created', 'processing']],
      ['reject', 'Отклонить', 'danger', ['created', 'processing', 'failed']],
    ].filter((a) => a[3].includes(tx.status)),
  };
  async function runAction(kind, tx, action, after) {
    let reason = '';
    if (['reject', 'cancel', 'fail'].includes(action)) { reason = await promptDialog('Причина', 'Клиент увидит причину в боте', 'Например: неверные реквизиты'); if (reason === null) return; }
    if (action === 'credit' && !(await confirmDialog('Отправить пополнение в API кассы? Средства будут зачислены на счёт игрока ' + tx.player_id + ' — ' + money(tx.pay_amount) + ' ' + tx.currency, 'Зачислить'))) return;
    if (action === 'complete' && !(await confirmDialog('Подтвердите, что перевод ' + money(tx.amount) + ' ' + tx.currency + ' выполнен на банк клиента.', 'Выполнен'))) return;
    try {
      const r = await api('/' + (kind === 'deposit' ? 'deposits' : 'withdrawals') + '/' + tx.id + '/action', { method: 'POST', body: { action, reason } });
      toast('Готово', 'ok'); if (after) after(r.item);
    } catch (e) { err(e); if (after) after(null); }
  }
  function txBaseRows(tx) {
    const dep = tx.kind === 'deposit';
    return [
      ['Статус', h('span', null, statusBadge(tx.status, tx.status_label), tx.deferred ? h('span', { class: 'badge amber', style: { marginLeft: '6px' } }, 'отложен') : null, tx.needs_attention ? h('span', { class: 'badge red', style: { marginLeft: '6px' } }, 'требует внимания') : null)],
      ['Сумма', h('b', null, money(dep ? tx.pay_amount : tx.amount) + ' ' + tx.currency, dep && tx.amount !== tx.pay_amount ? h('span', { class: 'muted small' }, ' (запрошено ' + money(tx.amount) + ')') : null)],
      ['Касса', tx.cash_name], ['ID игрока', h('span', { class: 'copy mono', onclick: () => copy(tx.player_id) }, tx.player_id, tx.player_name ? ' · ' + tx.player_name : '')],
      ['Клиент', h('a', { href: '#/users/' + tx.user_id }, tx.user_name, tx.username ? ' @' + tx.username : '')], ['Telegram ID', h('span', { class: 'copy mono', onclick: () => copy(tx.telegram_id) }, tx.telegram_id)],
      ['Номер', h('span', { class: 'copy mono', onclick: () => copy(tx.public_id) }, tx.public_id)], ['Создано', fmtDate(tx.created_at, true)],
      dep ? ['Истекает', tx.expires_at ? fmtDate(tx.expires_at, true) : '—'] : null, dep ? ['Оплачено', fmtDate(tx.paid_at, true)] : ['Выполнено', fmtDate(tx.completed_at, true)],
      dep ? ['Источник платежа', tx.payment_source || '—'] : ['Ссылка кассы', tx.provider_ref || '—'],
      tx.error ? ['Ошибка', h('span', { class: 'notice err' }, tx.error)] : null,
    ];
  }
  async function openTxModal(kind, id) {
    const path = kind === 'deposit' ? 'deposits' : 'withdrawals';
    const m = modal({ title: (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' #' + id, body: loader() });
    try {
      const r = await api('/' + path + '/' + id);
      const tx = r.item;
      const body = h('div', null, kv(txBaseRows(tx)), h('div', { class: 'section-title' }, h('h3', null, 'История')), timeline(r.history));
      if (kind === 'withdraw' && tx.has_generated_qr) body.appendChild(h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/qr.png?kind=generated&_=' + Date.now(), alt: 'QR' }), h('div', { class: 'small muted' }, 'QR с суммой для перевода клиенту')));
      m.setBody(body);
      const footer = $('footer', m.el) || m.el.appendChild(h('footer'));
      footer.innerHTML = '';
      footer.appendChild(h('button', { class: 'btn', onclick: () => { m.close(); go('#/' + path + '/' + tx.id); } }, 'Открыть страницу'));
      if (can('operations')) ACTIONS[kind](tx).forEach(([a, label, cls]) => footer.appendChild(h('button', { class: 'btn ' + cls, onclick: () => runAction(kind, tx, a, () => { m.close(); openTxModal(kind, id); }) }, label)));
    } catch (e) { m.setBody(empty('Ошибка', e.message)); }
  }
  async function txDetailView(main, path, id) {
    const kind = path === 'deposits' ? 'deposit' : 'withdraw';
    main.appendChild(h('div', { class: 'topbar' }, h('button', { class: 'btn icon', onclick: () => go('#/' + path) }, '‹'), h('h1', null, (kind === 'deposit' ? 'Пополнение' : 'Вывод') + ' #' + id)));
    const box = h('div', null, loader()); main.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/' + path + '/' + id); const tx = r.item; box.innerHTML = '';
        const editRows = [];
        const editField = (label, field, value, opts) => editRows.push([label, editable(value, Object.assign({ save: async (v) => { const rr = await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields: { [field]: v } } }); Object.assign(tx, rr.item); } }, opts || {}))]);
        const locked = tx.status === 'success' || !can('operations');
        editField('ID игрока', 'player_id', tx.player_id, { readonly: locked });
        if (kind === 'withdraw') editField('Сумма', 'amount', tx.amount, { readonly: locked, type: 'number', render: (v) => money(v) + ' ' + tx.currency });
        if (kind === 'deposit') editField('Имя игрока', 'player_name', tx.player_name, { readonly: locked });
        editField('Комментарий / ошибка', 'error', tx.error, { readonly: !can('operations') });
        if (kind === 'withdraw') editRows.push(['Отложен', switchEl(tx.deferred, async (v) => { await api('/' + path + '/' + tx.id + '/edit', { method: 'POST', body: { fields: { deferred: v } } }); })]);
        const left = h('div', { class: 'card' }, h('h2', null, 'Заявка'), kv(txBaseRows(tx).filter((r) => r && !['ID игрока', 'Ошибка'].includes(r[0]))), h('div', { class: 'section-title' }, h('h3', null, 'Редактирование'), h('span', { class: 'muted small' }, 'нажмите ✎ рядом с полем')), kv(editRows),
          can('operations') ? h('div', { class: 'form-actions' }, ACTIONS[kind](tx).map(([a, label, cls]) => h('button', { class: 'btn ' + cls, onclick: () => runAction(kind, tx, a, draw) }, label))) : null);
        const right = h('div', null);
        if (kind === 'deposit' && tx.qr_payload) right.appendChild(h('div', { class: 'card' }, h('h2', null, 'QR для оплаты'), h('div', { class: 'qr-box' }, h('img', { src: API + '/deposits/' + tx.id + '/qr.png', alt: 'QR' })), h('div', { class: 'small muted mono', style: { wordBreak: 'break-all' } }, tx.qr_payload), r.payment_event ? h('div', { class: 'notice', style: { marginTop: '8px' } }, 'Платёж: ' + r.payment_event.source + ' · ' + money(r.payment_event.amount) + ' · ' + fmtDate(r.payment_event.received_at)) : null));
        if (kind === 'withdraw') {
          right.appendChild(h('div', { class: 'card' }, h('h2', null, 'Реквизиты клиента'), tx.has_generated_qr ? h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/qr.png?kind=generated', alt: 'QR' }), h('div', { class: 'small muted' }, 'QR с суммой ' + money(tx.amount) + ' ' + tx.currency)) : null,
            tx.qr_file_url ? h('div', { class: 'qr-box' }, h('img', { src: API + '/withdrawals/' + tx.id + '/photo', alt: 'Фото QR клиента' }), h('div', { class: 'small muted' }, 'Фото QR от клиента' + (tx.qr_payload ? '' : ' (не распознан автоматически)'))) : h('div', { class: 'muted small' }, 'QR не прикреплён'),
            r.payment_links && r.payment_links.length ? h('div', { class: 'pill-row', style: { marginTop: '8px' } }, r.payment_links.map((l) => h('a', { class: 'btn sm', href: l.url, target: '_blank', rel: 'noopener' }, l.name))) : null,
            h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', null, 'Код вывода'), h('dd', { class: 'mono copy', onclick: () => copy(tx.code) }, tx.code || '—'))));
        }
        right.appendChild(h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'История'), timeline(r.history)));
        right.appendChild(h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'Клиент'), kv([['Имя', h('a', { href: '#/users/' + r.user.id }, r.user.name)], ['Пополнений', r.user.deposits_count + ' · ' + money(r.user.deposits_sum)], ['Выводов', r.user.withdrawals_count + ' · ' + money(r.user.withdrawals_sum)], ['Заметка', r.user.note || '—'], r.user.is_blocked ? ['Блокировка', h('span', { class: 'badge red' }, 'заблокирован')] : null])));
        box.appendChild(h('div', { class: 'grid cols-2' }, left, right));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- users */
  function usersView(main) {
    if (state.route.id) return userDetailView(main, state.route.id);
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Пользователи')));
    const st = { q: '', page: 1 };
    const box = h('div');
    main.appendChild(h('div', { class: 'toolbar' }, h('input', { class: 'input', placeholder: 'Поиск: имя, @username, Telegram ID, e-mail', oninput: debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350) })));
    main.appendChild(box);
    async function load() {
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/users?q=' + encodeURIComponent(st.q) + '&page=' + st.page);
        box.innerHTML = '';
        if (!r.items.length) return box.appendChild(empty('Пользователей нет'));
        const l = h('div', { class: 'list' });
        r.items.forEach((u) => l.appendChild(h('div', { class: 'item', onclick: () => go('#/users/' + u.id) }, h('div', { class: 'ico ' + (u.is_blocked ? 'attn' : '') }, (u.name || '?').charAt(0).toUpperCase()), h('div', { class: 'body' }, h('b', null, u.name, u.username ? ' · @' + u.username : ''), h('small', null, 'TG ' + u.telegram_id + ' · пополнений ' + u.deposits_count + ' · выводов ' + u.withdrawals_count + (u.email ? ' · ' + u.email : ''))), h('div', { class: 'right' }, u.is_blocked ? h('span', { class: 'badge red' }, 'блок') : null, h('time', null, ago(u.last_seen_at) + ' назад')))));
        box.appendChild(l);
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; load(); }); if (p) box.appendChild(p);
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    }
    load();
  }
  async function userDetailView(main, id) {
    main.appendChild(h('div', { class: 'topbar' }, h('button', { class: 'btn icon', onclick: () => go('#/users') }, '‹'), h('h1', null, 'Пользователь #' + id)));
    const box = h('div', null, loader()); main.appendChild(box);
    const draw = async () => {
      try {
        const r = await api('/users/' + id); const u = r.item; box.innerHTML = '';
        const patch = (body) => api('/users/' + u.id, { method: 'PATCH', body });
        const left = h('div', { class: 'card' }, h('h2', null, u.name), kv([
          ['Telegram ID', h('span', { class: 'copy mono', onclick: () => copy(u.telegram_id) }, u.telegram_id)], ['Username', u.username ? '@' + u.username : '—'], ['Язык', u.language], ['Телефон', u.phone || '—'], ['E-mail', u.email ? u.email + (u.email_verified ? ' ✅' : ' (не подтверждён)') : '—'],
          ['Регистрация', fmtDate(u.created_at, true)], ['Последняя активность', fmtDate(u.last_seen_at, true)], ['Пополнений', u.deposits_count + ' · ' + money(u.deposits_sum)], ['Выводов', u.withdrawals_count + ' · ' + money(u.withdrawals_sum)],
          ['QR вывода', u.has_qr ? 'сохранён' + (u.qr_bank ? ' · ' + u.qr_bank : '') : 'нет'], ['Реферальный код', h('span', { class: 'mono' }, u.referral_code)], ['Пригласил', r.inviter ? h('a', { href: '#/users/' + r.inviter.id }, r.inviter.name) : '—'],
          ['Реферальный баланс', can('settings') ? editable(u.referral_balance, { type: 'number', render: (v) => money(v) + ' KGS', save: (v) => patch({ referral_balance: v }) }) : money(u.referral_balance) + ' KGS'],
          ['Блокировка', h('span', { class: 'row' }, switchEl(u.is_blocked, async (v) => { let reason = ''; if (v) { reason = await promptDialog('Причина блокировки', 'Клиент увидит причину'); if (reason === null) throw new Error('Отменено'); } await patch({ is_blocked: v, block_reason: reason }); }), h('span', { class: 'small muted' }, u.block_reason || ''))],
          ['Поддержка', h('span', { class: 'row' }, switchEl(!u.support_blocked, async (v) => { await patch({ support_blocked: !v, support_block_reason: v ? '' : 'Ограничено оператором' }); }), h('span', { class: 'small muted' }, u.support_blocked ? 'ограничена' : 'доступна'))],
          ['Заметка', editable(u.note, { readonly: !can('users'), save: (v) => patch({ note: v }) })],
        ]), can('support') ? h('div', { class: 'form-actions' }, h('button', { class: 'btn', onclick: async () => { const t = await promptDialog('Сообщение клиенту', 'Отправится через основной бот'); if (t) { try { await api('/users/' + u.id + '/message', { method: 'POST', body: { text: t } }); toast('Отправлено', 'ok'); } catch (e) { err(e); } } } }, '✉ Написать клиенту')) : null);
        const payouts = await api('/users/' + id + '/referral-payouts').catch(() => ({ items: [] }));
        const ops = h('div', null,
          payouts.items.length ? h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h2', null, 'Выводы реферального баланса'), h('div', { class: 'list' }, payouts.items.map((p) => h('div', { class: 'item', style: { cursor: 'default' } }, h('div', { class: 'ico' }, '🎁'), h('div', { class: 'body' }, h('b', null, money(p.amount) + ' KGS · ' + p.public_id), h('small', null, fmtDate(p.created_at) + (p.error ? ' · ' + p.error : ''))), h('div', { class: 'right' }, statusBadge(p.status), (p.status === 'created' || p.status === 'processing') && can('operations') ? h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { class: 'btn sm green', onclick: async () => { if (await confirmDialog('Подтвердить перевод бонуса ' + money(p.amount) + ' KGS на QR клиента?', 'Выполнен')) { try { await api('/users/' + u.id + '/referral-payouts/' + p.id + '/action', { method: 'POST', body: { action: 'complete' } }); draw(); } catch (ex) { err(ex); } } } }, 'Выполнен'), h('button', { class: 'btn sm danger', onclick: async () => { const reason = await promptDialog('Причина отклонения', ''); if (reason === null) return; try { await api('/users/' + u.id + '/referral-payouts/' + p.id + '/action', { method: 'POST', body: { action: 'reject', reason } }); draw(); } catch (ex) { err(ex); } } }, 'Отклонить')) : null))))) : null,
          h('div', { class: 'card' }, h('h2', null, 'Пополнения'), r.deposits.length ? h('div', { class: 'list' }, r.deposits.map(txItem)) : h('div', { class: 'muted small' }, 'Нет')),
          h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'Выводы'), r.withdrawals.length ? h('div', { class: 'list' }, r.withdrawals.map(txItem)) : h('div', { class: 'muted small' }, 'Нет')),
          h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'Обращения'), r.conversations.length ? h('div', { class: 'list' }, r.conversations.map((c) => h('div', { class: 'item', onclick: () => go('#/support/' + c.id) }, h('div', { class: 'ico' }, '💬'), h('div', { class: 'body' }, h('b', null, c.subject || c.category), h('small', null, fmtDate(c.last_message_at))), h('div', { class: 'right' }, statusBadge(c.status))))) : h('div', { class: 'muted small' }, 'Нет')));
        box.appendChild(h('div', { class: 'grid cols-2' }, left, ops));
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    };
    draw();
  }

  /* ------------------------------------------------------------- cashes */
  function cashesView(main) {
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Кассы'), can('cashes') ? h('button', { class: 'btn primary sm', onclick: () => cashForm(null) }, '+ Добавить кассу') : null));
    const box = h('div', null, loader()); main.appendChild(box);
    (async () => {
      try {
        const r = await api('/cashes'); state.cashes = r.items; state.types = r.types; box.innerHTML = '';
        if (!r.items.length) return box.appendChild(empty('Касс нет', 'Добавьте первую кассу'));
        box.appendChild(h('div', { class: 'grid cols-2' }, r.items.map((c) => {
          const card = cashCard(c); card.onclick = null; card.style.cursor = 'default';
          card.appendChild(h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Лимиты пополнения: ' + money(c.deposit_min) + ' – ' + money(c.deposit_max) + ' ' + c.currency + ' · автостоп при ' + money(c.critical_balance_threshold) + (c.ip_address ? ' · IP ' + c.ip_address : '')));
          if (can('cashes')) card.appendChild(h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
            h('button', { class: 'btn sm', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const rr = await api('/cashes/' + c.id + '/check', { method: 'POST' }); toast(rr.result.ok ? 'Соединение OK · баланс ' + (rr.result.balance !== null ? money(rr.result.balance) : '—') : 'Ошибка: ' + rr.result.message, rr.result.ok ? 'ok' : 'err', 4000); render(); } catch (ex) { err(ex); } b.disabled = false; } }, '⚡ Проверить'),
            h('button', { class: 'btn sm', onclick: () => cashForm(c) }, '✎ Изменить'),
            h('button', { class: 'btn sm ' + (c.enabled ? 'danger' : 'green'), onclick: async () => { try { await api('/cashes/' + c.id, { method: 'PATCH', body: { enabled: !c.enabled } }); toast(c.enabled ? 'Касса отключена' : 'Касса включена', 'ok'); render(); } catch (ex) { err(ex); } } }, c.enabled ? 'Отключить' : 'Включить'),
            c.auto_disabled ? h('button', { class: 'btn sm blue', onclick: async () => { await api('/cashes/' + c.id, { method: 'PATCH', body: { auto_disabled: false } }); render(); } }, 'Снять автостоп') : null,
            h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDialog('Удалить кассу ' + c.name + '? Если по ней были операции, она будет отключена.', 'Удалить', true)) { try { const rr = await api('/cashes/' + c.id, { method: 'DELETE' }); toast(rr.message || 'Удалено', 'ok'); render(); } catch (ex) { err(ex); } } } }, 'Удалить')));
          return card;
        })));
        if (state.route.id) { const c = r.items.find((x) => String(x.id) === String(state.route.id)); if (c && can('cashes')) cashForm(c); }
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    })();
  }
  function cashForm(c) {
    const isNew = !c; c = c || { provider_type: 'servcul', enabled: false, priority: 100, currency: 'KGS', deposit_enabled: true, withdraw_enabled: true, deposit_min: 100, deposit_max: 100000, auto_disable_enabled: true, low_balance_threshold: 20000, critical_balance_threshold: 1000, auto_enable_threshold: 5000, credentials: [] };
    const f = {};
    const field = (label, key, type, opts) => { const el = type === 'select' ? h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(c[key]) }, l))) : type === 'textarea' ? h('textarea', { class: 'textarea' }, c[key] || '') : h('input', { class: 'input', type: type || 'text', value: c[key] === undefined || c[key] === null ? '' : c[key], placeholder: (opts && opts.placeholder) || '' }); f[key] = el; return h('label', { class: 'field' }, h('span', null, label), el); };
    const bool = (label, key) => { const el = h('input', { type: 'checkbox', checked: !!c[key] }); f[key] = el; return h('label', { class: 'row', style: { marginBottom: '10px' } }, el, ' ', label); };
    const credBox = h('div');
    const drawCreds = () => {
      credBox.innerHTML = '';
      const type = state.types.find((t) => t.type === (f.provider_type ? f.provider_type.value : c.provider_type)) || { fields: [] };
      credBox.appendChild(h('h3', { style: { margin: '12px 0 8px' } }, 'Учётные данные (хранятся зашифрованными)'));
      type.fields.forEach((fd) => { const cur = (c.credentials || []).find((x) => x.key === fd.key); const el = h('input', { class: 'input', type: fd.secret ? 'password' : 'text', placeholder: cur && cur.set ? (fd.secret ? 'задано ' + cur.masked + ' — оставьте пустым, чтобы не менять' : cur.masked) : (fd.required ? 'обязательно' : 'необязательно'), value: cur && !fd.secret && cur.set ? cur.masked : '' }); el.dataset.cred = fd.key; credBox.appendChild(h('label', { class: 'field' }, h('span', null, fd.label), el)); });
    };
    const body = h('div', null,
      h('div', { class: 'grid cols-2' }, isNew ? field('Ключ (латиницей, напр. 1xbet)', 'key') : null, field('Название', 'name'), isNew ? field('Тип', 'provider_type', 'select', state.types.map((t) => [t.type, t.label])) : h('label', { class: 'field' }, h('span', null, 'Тип'), h('input', { class: 'input', value: c.provider_type, disabled: true })), field('Приоритет (меньше — выше)', 'priority', 'number'), field('Валюта кассы', 'currency'), field('Допустимые ID валюты игрока (через запятую, пусто — не проверять)', 'accepted_currency_ids', 'text', { placeholder: 'KGS,417' }), field('IP сервера / белый список', 'ip_address'), field('Base URL API', 'base_url')),
      h('div', { class: 'row', style: { margin: '6px 0 10px' } }, bool('Касса включена', 'enabled'), bool('Пополнение', 'deposit_enabled'), bool('Вывод', 'withdraw_enabled')),
      h('div', { class: 'grid cols-2' }, field('Мин. пополнение', 'deposit_min', 'number'), field('Макс. пополнение', 'deposit_max', 'number'), field('Комиссия пополнения, %', 'deposit_fee_pct', 'number'), field('Комиссия вывода, %', 'withdraw_fee_pct', 'number')),
      h('h3', { style: { margin: '10px 0 8px' } }, 'Автоотключение по балансу'),
      bool('Включить автоматическое отключение пополнений', 'auto_disable_enabled'),
      h('div', { class: 'grid cols-3' }, field('Порог «мало» (уведомление)', 'low_balance_threshold', 'number'), field('Критический порог (стоп)', 'critical_balance_threshold', 'number'), field('Порог автовключения', 'auto_enable_threshold', 'number')),
      credBox, field('Инструкция по выводу для клиентов', 'instructions_text', 'textarea'), field('Заметки', 'notes', 'textarea'));
    drawCreds(); if (f.provider_type) f.provider_type.onchange = drawCreds;
    const m = modal({ title: isNew ? 'Новая касса' : 'Касса ' + c.name, body, actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const payload = {}; for (const [k, el] of Object.entries(f)) payload[k] = el.type === 'checkbox' ? el.checked : el.value;
      const creds = {}; credBox.querySelectorAll('input[data-cred]').forEach((el) => { if (el.value && !(el.placeholder && el.value === el.placeholder)) creds[el.dataset.cred] = el.value; }); payload.credentials = creds;
      try { if (isNew) await api('/cashes', { method: 'POST', body: payload }); else await api('/cashes/' + c.id, { method: 'PATCH', body: payload }); toast('Сохранено', 'ok'); m.close(); go('#/cashes'); render(); } catch (ex) { err(ex); e.target.disabled = false; }
    } }, 'Сохранить')] });
  }

  /* ------------------------------------------------------------- support */
  function supportView(main) {
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Поддержка')));
    const st = { tab: 'open', q: '', page: 1, active: state.route.id ? Number(state.route.id) : null, lastMsgId: 0 };
    const wrap = h('div', { class: 'chat ' + (st.active ? 'open' : '') });
    const listCol = h('div', { class: 'conv-list' }); const view = h('div', { class: 'conv-view' });
    const listWrap = h('div', null, h('div', { class: 'toolbar' }, h('input', { class: 'input', placeholder: 'Поиск', oninput: debounce((e) => { st.q = e.target.value.trim(); loadList(); }, 350) })), h('div', { id: 'sup-tabs' }), listCol);
    listWrap.className = 'conv-list-wrap';
    wrap.appendChild(h('div', { class: 'conv-list' }, listWrap)); wrap.appendChild(view); main.appendChild(wrap);
    async function loadList() {
      const tabsBox = $('#sup-tabs', wrap); tabsBox.innerHTML = ''; tabsBox.appendChild(tabs([['open', 'Открытые', state.live && state.live.queues.support_open], ['waiting', 'Ждут', state.live && state.live.queues.support_waiting], ['auto', 'Авто'], ['closed', 'Закрытые']], st.tab, (k) => { st.tab = k; loadList(); }));
      listCol.innerHTML = ''; listCol.appendChild(loader());
      try {
        const r = await api('/support/conversations?status=' + st.tab + '&q=' + encodeURIComponent(st.q) + '&size=40');
        listCol.innerHTML = '';
        if (!r.items.length) return listCol.appendChild(empty('Обращений нет'));
        r.items.forEach((c) => listCol.appendChild(h('div', { class: 'conv ' + (st.active === c.id ? 'active' : ''), onclick: () => { st.active = c.id; wrap.classList.add('open'); history.replaceState(null, '', '#/support/' + c.id); loadList(); openConv(); } }, h('div', { class: 'row' }, h('b', { style: { flex: 1 } }, c.user_name, c.username ? ' @' + c.username : ''), c.unread_count ? h('span', { class: 'badge count' }, c.unread_count) : null, statusBadge(c.status)), h('small', null, (c.subject || c.category) + ' · ' + ago(c.last_message_at) + ' назад'))));
      } catch (e) { listCol.innerHTML = ''; listCol.appendChild(empty('Ошибка', e.message)); }
    }
    async function openConv() {
      view.innerHTML = ''; if (!st.active) return view.appendChild(empty('Выберите обращение', 'Слева список диалогов. Сложные обращения попадают сюда с контекстом заявок.'));
      view.appendChild(loader());
      try {
        const r = await api('/support/conversations/' + st.active); const c = r.item; const ctx = c.context || {};
        view.innerHTML = '';
        const head = h('div', { class: 'ctx' }, h('button', { class: 'btn icon sm', onclick: () => { st.active = null; wrap.classList.remove('open'); history.replaceState(null, '', '#/support'); openConv(); } }, '‹'), h('b', null, c.user_name), h('a', { href: '#/users/' + c.user_id, class: 'small' }, 'TG ' + c.telegram_id), statusBadge(c.status), h('span', { class: 'badge gray' }, c.category), c.subject ? h('span', { class: 'small muted' }, c.subject) : null,
          h('span', { style: { flex: 1 } }), can('support') && c.status !== 'resolved' ? h('button', { class: 'btn sm', onclick: async () => { await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'operator' } }); openConv(); loadList(); } }, 'Взять') : null,
          can('support') && c.status !== 'resolved' ? h('button', { class: 'btn sm green', onclick: async () => { const note = await promptDialog('Закрыть обращение', 'Сообщение клиенту (необязательно)'); if (note === null) return; await api('/support/conversations/' + c.id + '/status', { method: 'POST', body: { status: 'resolved', note } }); openConv(); loadList(); } }, 'Закрыть') : null);
        view.appendChild(head);
        const ctxRows = [];
        if (ctx.deposit) ctxRows.push(h('a', { class: 'badge blue', href: '#/deposits/' + ctx.deposit.id }, '↓ ' + ctx.deposit.public_id + ' · ' + ctx.deposit.status_label + ' · ' + money(ctx.deposit.amount) + ' ' + ctx.deposit.currency));
        if (ctx.withdrawal) ctxRows.push(h('a', { class: 'badge blue', href: '#/withdrawals/' + ctx.withdrawal.id }, '↑ ' + ctx.withdrawal.public_id + ' · ' + ctx.withdrawal.status_label + ' · ' + money(ctx.withdrawal.amount) + ' ' + ctx.withdrawal.currency));
        if (ctxRows.length) view.appendChild(h('div', { class: 'ctx' }, h('span', { class: 'small muted' }, 'Контекст:'), ctxRows, h('span', { class: 'small muted' }, 'пополнений ' + (ctx.deposits_count || 0) + ' · выводов ' + (ctx.withdrawals_count || 0) + (ctx.has_qr ? ' · QR есть' : ' · QR нет'))));
        const msgs = h('div', { class: 'msgs' });
        const drawMsg = (m) => h('div', { class: 'msg ' + (m.direction === 'out' ? 'out ' : '') + m.sender }, m.file_url ? h('img', { src: (m.file_url.startsWith('/') ? BASE + m.file_url : m.file_url), alt: '' }) : null, m.text, h('small', null, (m.sender === 'user' ? 'клиент' : m.sender === 'bot' ? 'авто' + (m.intent ? ' · ' + m.intent : '') : m.sender === 'operator' ? 'оператор' : 'система') + ' · ' + fmtTime(m.created_at)));
        r.messages.forEach((m) => { msgs.appendChild(drawMsg(m)); st.lastMsgId = Math.max(st.lastMsgId, m.id); });
        view.appendChild(msgs);
        const ta = h('textarea', { class: 'textarea', placeholder: 'Ответ клиенту… (Enter — отправить, Shift+Enter — перенос)' });
        const send = async () => { const text = ta.value.trim(); if (!text) return; ta.disabled = true; try { const rr = await api('/support/conversations/' + c.id + '/reply', { method: 'POST', body: { text } }); ta.value = ''; msgs.appendChild(drawMsg(rr.message)); msgs.scrollTop = msgs.scrollHeight; st.lastMsgId = Math.max(st.lastMsgId, rr.message.id); } catch (e) { err(e); } ta.disabled = false; ta.focus(); };
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        if (can('support')) view.appendChild(h('div', { class: 'composer' }, ta, h('button', { class: 'btn primary', onclick: send }, 'Отправить')));
        msgs.scrollTop = msgs.scrollHeight;
        const poll = setInterval(async () => { if (!document.body.contains(msgs) || st.active !== c.id) return clearInterval(poll); try { const rr = await api('/support/conversations/' + c.id + '?after_id=' + st.lastMsgId); rr.messages.forEach((m) => { msgs.appendChild(drawMsg(m)); st.lastMsgId = Math.max(st.lastMsgId, m.id); msgs.scrollTop = msgs.scrollHeight; }); } catch (e) {} }, 3000);
      } catch (e) { view.innerHTML = ''; view.appendChild(empty('Ошибка', e.message)); }
    }
    loadList(); openConv();
    document.addEventListener('onoi:changed', () => { if (document.body.contains(wrap)) loadList(); });
  }

  /* ------------------------------------------------------------- settings */
  const SETTINGS_GROUPS = [
    ['Бот и тексты', [['brand_name', 'Название бренда'], ['support_username', 'Username поддержки'], ['greeting_text', 'Приветствие ({name}, {support})', 'textarea'], ['withdraw_instruction', 'Инструкция по выводу', 'textarea'], ['withdraw_city', 'Город для вывода'], ['withdraw_address', 'Адрес для вывода'], ['withdraw_sla_text', 'Текст о сроках вывода']]],
    ['Режим работы', [['bot_paused', 'Пауза бота', 'bool'], ['deposits_enabled', 'Пополнения включены', 'bool'], ['withdrawals_enabled', 'Выводы включены', 'bool'], ['subscription_enabled', 'Требовать подписку на канал', 'bool'], ['subscription_channel', 'Канал (@username или id)'], ['phone_required', 'Требовать номер телефона', 'bool']]],
    ['Пополнения', [['payment_timeout_seconds', 'Таймаут оплаты, сек', 'number'], ['random_tiyin', 'Уникальные тыйыны', 'bool'], ['tiyin_min', 'Тыйын мин', 'number'], ['tiyin_max', 'Тыйын макс', 'number'], ['amount_reuse_cooldown_seconds', 'Не переиспользовать сумму, сек', 'number'], ['payment_event_max_age_minutes', 'Ждать платёж после истечения, мин', 'number'], ['deposit_max_active_per_user', 'Активных заявок на клиента', 'number']]],
    ['Выводы и рефералы', [['withdraw_code_min_length', 'Мин. длина кода вывода', 'number'], ['referral_bonus_pct', 'Реферальный бонус, %', 'number'], ['referral_withdraw_min', 'Мин. вывод реферального баланса', 'number']]],
    ['Мониторинг касс', [['cash_monitor_enabled', 'Автопроверка балансов', 'bool'], ['cash_monitor_interval_seconds', 'Интервал проверки, сек', 'number']]],
    ['Поддержка и антифлуд', [['support_greeting', 'Приветствие поддержки', 'textarea'], ['support_rate_limit_messages', 'Сообщений в окне', 'number'], ['support_rate_limit_window_seconds', 'Окно, сек', 'number'], ['support_cooldown_seconds', 'Cooldown при превышении, сек', 'number'], ['support_debounce_seconds', 'Объединять сообщения, сек', 'number'], ['support_duplicate_window_seconds', 'Окно повторов, сек', 'number'], ['support_escalation_cooldown_seconds', 'Пауза между эскалациями, сек', 'number'], ['support_auto_resolve_hours', 'Автозакрытие тихих диалогов, ч', 'number']]],
    ['Уведомления', [['notify_new_deposit', 'Новое пополнение', 'bool'], ['notify_deposit_success', 'Успешное пополнение', 'bool'], ['notify_deposit_failed', 'Ошибка пополнения', 'bool'], ['notify_new_withdrawal', 'Новый вывод', 'bool'], ['notify_withdrawal_status', 'Статус вывода', 'bool'], ['notify_cash_critical', 'Критические ошибки касс', 'bool'], ['notify_support_operator', 'Обращения оператору', 'bool'], ['ui_poll_seconds', 'Опрос панели, сек', 'number'], ['ui_page_size', 'Размер страницы', 'number']]],
  ];
  function settingsView(main) {
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Настройки')));
    const st = { tab: state.route.id || 'general' };
    const tabsBox = h('div'); const box = h('div', { style: { marginTop: '12px' } }); main.appendChild(tabsBox); main.appendChild(box);
    const draw = () => { tabsBox.innerHTML = ''; tabsBox.appendChild(tabs([['general', 'Параметры'], ['requisites', 'Реквизиты'], ['links', 'Кнопки банков'], ['security', 'Безопасность'], ['push', 'Push'], ['broadcast', 'Рассылка'], ['env', 'Окружение']], st.tab, (k) => { st.tab = k; history.replaceState(null, '', '#/settings/' + k); draw(); })); box.innerHTML = ''; box.appendChild(loader()); ({ general: generalSettings, requisites: requisitesSettings, links: linksSettings, security: securitySettings, push: pushSettings, broadcast: broadcastSettings, env: envSettings }[st.tab] || generalSettings)(box); };
    draw();
  }
  async function generalSettings(box) {
    try {
      const r = await api('/settings'); const values = r.values; box.innerHTML = '';
      const inputs = {};
      SETTINGS_GROUPS.forEach(([title, fields]) => {
        const card = h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h2', null, title));
        const grid = h('div', { class: 'grid cols-2' });
        fields.forEach(([key, label, type]) => {
          let el;
          if (type === 'bool') { el = h('input', { type: 'checkbox', checked: !!values[key] }); grid.appendChild(h('label', { class: 'row', style: { padding: '8px 0' } }, el, ' ', label)); }
          else if (type === 'textarea') { el = h('textarea', { class: 'textarea' }, values[key] === undefined ? '' : String(values[key])); grid.appendChild(h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, label), el)); }
          else { el = h('input', { class: 'input', type: type || 'text', value: values[key] === undefined ? '' : values[key] }); grid.appendChild(h('label', { class: 'field' }, h('span', null, label), el)); }
          inputs[key] = el;
        });
        card.appendChild(grid); box.appendChild(card);
      });
      box.appendChild(h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async (e) => { e.currentTarget.disabled = true; const payload = {}; for (const [k, el] of Object.entries(inputs)) payload[k] = el.type === 'checkbox' ? el.checked : el.value; try { await api('/settings', { method: 'POST', body: { values: payload } }); toast('Настройки сохранены', 'ok'); } catch (ex) { err(ex); } e.target.disabled = false; } }, 'Сохранить настройки')));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  async function requisitesSettings(box) {
    try {
      const r = await api('/requisites'); box.innerHTML = '';
      box.appendChild(h('div', { class: 'notice', style: { marginBottom: '10px' } }, 'Реквизит — QR банка, на который клиенты платят пополнения. Система подставляет в него точную сумму с тыйынами. Добавьте QR ссылкой/строкой ELQR или загрузите изображение.'));
      const src = h('textarea', { class: 'textarea', placeholder: 'Вставьте ELQR (000201…) или ссылку банка' }); const name = h('input', { class: 'input', placeholder: 'Название (напр. Optima основной)' }); const file = h('input', { type: 'file', accept: 'image/*' });
      file.onchange = async () => { const fd = new FormData(); fd.append('file', file.files[0]); try { const rr = await api('/requisites/upload', { method: 'POST', body: fd }); src.value = rr.source; toast('QR распознан: ' + rr.meta.bank_name, 'ok'); } catch (ex) { err(ex); } };
      box.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h2', null, 'Добавить реквизит'), h('label', { class: 'field' }, h('span', null, 'Название'), name), h('label', { class: 'field' }, h('span', null, 'QR / ссылка'), src), h('label', { class: 'field' }, h('span', null, 'или изображение QR'), file), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/requisites', { method: 'POST', body: { name: name.value, source: src.value } }); toast('Добавлено', 'ok'); requisitesSettings(box); } catch (ex) { err(ex); } } }, 'Добавить'))));
      if (!r.items.length) box.appendChild(empty('Реквизитов нет', 'Без реквизита пополнения недоступны'));
      r.items.forEach((q) => box.appendChild(h('div', { class: 'card flat', style: { marginBottom: '8px' } }, h('div', { class: 'row' }, switchEl(q.enabled, async (v) => { await api('/requisites/' + q.id, { method: 'PATCH', body: { enabled: v } }); }), h('b', null, q.name), h('span', { class: 'badge gray' }, q.bank_name), h('span', { class: 'muted small' }, 'счёт ' + q.account + ' · ' + q.holder), h('span', { style: { flex: 1 } }), editable(q.priority, { type: 'number', render: (v) => 'приоритет ' + v, save: (v) => api('/requisites/' + q.id, { method: 'PATCH', body: { priority: Number(v) } }) }), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog('Удалить реквизит ' + q.name + '?', 'Удалить', true)) { await api('/requisites/' + q.id, { method: 'DELETE' }); requisitesSettings(box); } } }, 'Удалить')))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  async function linksSettings(box) {
    try {
      const r = await api('/bank-links'); box.innerHTML = '';
      box.appendChild(h('div', { class: 'notice', style: { marginBottom: '10px' } }, 'Кнопки под QR пополнения — deep-link’и банковских приложений. «QR-код» управляет показом самой картинки.'));
      r.items.forEach((l) => box.appendChild(h('div', { class: 'card flat', style: { marginBottom: '8px' } }, h('div', { class: 'row' }, switchEl(l.enabled, async (v) => { await api('/bank-links', { method: 'POST', body: { key: l.key, enabled: v } }); }), h('b', null, l.name), h('span', { class: 'muted small mono', style: { flex: 1, wordBreak: 'break-all' } }, l.prefix || '—'), editable(l.priority, { type: 'number', render: (v) => 'порядок ' + v, save: (v) => api('/bank-links', { method: 'POST', body: { key: l.key, priority: Number(v) } }) })))));
      const key = h('input', { class: 'input', placeholder: 'ключ (latin)' }); const nm = h('input', { class: 'input', placeholder: 'Название' }); const pf = h('input', { class: 'input', placeholder: 'https://…#' });
      box.appendChild(h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'Добавить кнопку'), h('div', { class: 'grid cols-3' }, key, nm, pf), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/bank-links', { method: 'POST', body: { key: key.value, name: nm.value, prefix: pf.value, kind: 'link', enabled: true } }); linksSettings(box); } catch (ex) { err(ex); } } }, 'Добавить'))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  async function securitySettings(box) {
    try {
      box.innerHTML = '';
      const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' }); const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
      box.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h2', null, 'Смена пароля'), h('div', { class: 'grid cols-2' }, h('label', { class: 'field' }, h('span', null, 'Текущий пароль'), cur), h('label', { class: 'field' }, h('span', null, 'Новый пароль (мин. 10 символов, разный регистр, цифра)'), nw)), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/auth/password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } }); toast('Пароль изменён, остальные сессии завершены', 'ok'); cur.value = nw.value = ''; } catch (ex) { err(ex); } } }, 'Изменить'))));
      const s = await api('/auth/sessions');
      box.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'row' }, h('h2', { style: { flex: 1 } }, 'Активные сессии'), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog('Завершить все остальные сессии?', 'Завершить', true)) { await api('/auth/sessions/revoke-others', { method: 'POST' }); securitySettings(box); } } }, 'Завершить остальные')),
        h('div', { class: 'list' }, s.items.map((x) => h('div', { class: 'item', style: { cursor: 'default' } }, h('div', { class: 'ico' }, x.current ? '★' : '·'), h('div', { class: 'body' }, h('b', null, (x.username ? x.username + ' · ' : '') + (x.ip || '—'), x.current ? ' (текущая)' : ''), h('small', null, x.user_agent)), h('div', { class: 'right' }, h('time', null, 'активна ' + ago(x.last_seen_at) + ' назад'), !x.current ? h('button', { class: 'btn sm ghost', onclick: async () => { await api('/auth/sessions/' + x.id + '/revoke', { method: 'POST' }); securitySettings(box); } }, 'Завершить') : null))))));
      if (can('admins')) {
        const a = await api('/auth/admins');
        const u = h('input', { class: 'input', placeholder: 'логин' }); const p = h('input', { class: 'input', type: 'password', placeholder: 'пароль' }); const role = h('select', { class: 'select' }, ['operator', 'admin', 'viewer', 'owner'].map((x) => h('option', { value: x }, x)));
        box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Администраторы и роли'),
          h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'viewer — только просмотр · operator — заявки, поддержка, пользователи · admin — + кассы, настройки, логи · owner — + администраторы и безопасность'),
          h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Логин', 'Имя', 'Роль', 'Активен', 'Вход', ''].map((x) => h('th', null, x)))), h('tbody', null, a.items.map((ad) => h('tr', { style: { cursor: 'default' } }, h('td', null, ad.username), h('td', null, ad.name), h('td', null, editable(ad.role, { options: ['viewer', 'operator', 'admin', 'owner'].map((x) => [x, x]), save: (v) => api('/auth/admins/' + ad.id, { method: 'PATCH', body: { role: v } }) })), h('td', null, switchEl(ad.is_active, async (v) => { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { is_active: v } }); })), h('td', { class: 'small muted' }, fmtDate(ad.last_login_at)), h('td', null, h('button', { class: 'btn sm ghost', onclick: async () => { const pw = await promptDialog('Новый пароль для ' + ad.username, 'Мин. 10 символов'); if (pw) { try { await api('/auth/admins/' + ad.id, { method: 'PATCH', body: { password: pw } }); toast('Пароль обновлён', 'ok'); } catch (ex) { err(ex); } } } }, 'Пароль'), h('button', { class: 'btn sm ghost', onclick: async () => { await api('/auth/admins/' + ad.id + '/logout-all', { method: 'POST' }); toast('Сессии завершены', 'ok'); } }, 'Выйти везде'))))))),
          h('h3', { style: { margin: '12px 0 8px' } }, 'Новый администратор'), h('div', { class: 'grid cols-3' }, u, p, role), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/auth/admins', { method: 'POST', body: { username: u.value, password: p.value, role: role.value } }); toast('Создан', 'ok'); securitySettings(box); } catch (ex) { err(ex); } } }, 'Создать'))));
      }
      const audit = await api('/logs?kind=audit&size=15');
      box.appendChild(h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'Последние действия (audit log)'), h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Когда', 'Кто', 'Действие', 'Объект', 'IP'].map((x) => h('th', null, x)))), h('tbody', null, audit.items.map((l) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'small muted' }, fmtDate(l.created_at, true)), h('td', null, l.actor), h('td', { class: 'mono' }, l.action), h('td', { class: 'small' }, l.entity_type + ' ' + l.entity_id), h('td', { class: 'small muted' }, l.ip))))))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  function urlB64ToUint8(b64) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function pushSettings(box) {
    try {
      const r = await api('/push/config'); box.innerHTML = '';
      const supported = 'serviceWorker' in navigator && 'PushManager' in window;
      const status = h('div', { class: 'notice' }, supported ? (r.enabled ? 'Push настроен на сервере. Подписок: ' + r.subscriptions : 'VAPID-ключи не заданы в .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).') : 'Браузер не поддерживает Web Push. На iPhone добавьте панель на экран «Домой».');
      box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Push-уведомления'), status, h('div', { class: 'small muted', style: { margin: '8px 0' } }, 'Критические события (новый вывод, ошибка платежа, пустая касса, обращение оператору) приходят с отдельным сигналом и требуют закрытия. Старые события после перезапуска сервера повторно не отправляются.'),
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
          h('button', { class: 'btn primary', disabled: !supported || !r.enabled, onclick: async () => { try { const reg = await navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }); const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Уведомления запрещены в браузере', 'err'); const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(r.public_key) }); await api('/push/subscribe', { method: 'POST', body: sub.toJSON() }); toast('Подписка включена на этом устройстве', 'ok'); pushSettings(box); } catch (ex) { err(ex); } } }, '🔔 Включить на этом устройстве'),
          h('button', { class: 'btn', onclick: async () => { try { await api('/push/test', { method: 'POST' }); toast('Тест отправлен', 'ok'); } catch (ex) { err(ex); } } }, 'Тест'),
          h('button', { class: 'btn ghost', disabled: !supported, onclick: async () => { try { const reg = await navigator.serviceWorker.getRegistration(BASE + '/'); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await api('/push/unsubscribe', { method: 'POST', body: sub.toJSON() }); await sub.unsubscribe(); } toast('Отключено', 'ok'); pushSettings(box); } catch (ex) { err(ex); } } }, 'Отключить'))));
    } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }
  function broadcastSettings(box) {
    box.innerHTML = '';
    const text = h('textarea', { class: 'textarea', placeholder: 'Текст рассылки' }); const days = h('input', { class: 'input', type: 'number', value: 0, placeholder: '0 — всем' });
    box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Рассылка в основной бот'), h('label', { class: 'field' }, h('span', null, 'Текст'), text), h('label', { class: 'field' }, h('span', null, 'Только активным за N дней (0 — всем)'), days), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => { if (!text.value.trim()) return; if (!(await confirmDialog('Отправить рассылку всем выбранным клиентам?', 'Отправить'))) return; try { const r = await api('/broadcast', { method: 'POST', body: { text: text.value, only_active_days: Number(days.value || 0) } }); toast('В очереди: ' + r.recipients, 'ok'); text.value = ''; } catch (ex) { err(ex); } } }, 'Отправить'))));
  }
  async function envSettings(box) {
    try { const r = await api('/settings'); const e = r.env; box.innerHTML = ''; box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Окружение (из .env, только чтение)'), kv([['Публичный URL', e.public_url + e.base_path + '/'], ['Webhook платежей', h('span', { class: 'mono small' }, e.webhook_url)], ['База данных', e.database], ['SMTP', e.smtp_configured ? e.smtp_host + ' · ' + e.smtp_from : 'не настроен'], ['IMAP-источник платежей', e.imap_enabled ? 'включён' : 'выключен'], ['Основной бот', '@' + e.main_bot], ['Бот поддержки', '@' + e.support_bot], ['Telegram-чаты админов', (e.admin_chat_ids || []).join(', ') || '—'], ['Web Push', e.push_configured ? 'настроен' : 'нет'], ['Часовой пояс', e.timezone]]))); }
    catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
  }

  /* ------------------------------------------------------------- logs */
  function logsView(main) {
    main.appendChild(h('div', { class: 'topbar' }, h('h1', null, 'Логи')));
    const st = { kind: 'system', level: '', q: '', page: 1 };
    const tabsBox = h('div'); const box = h('div', { style: { marginTop: '10px' } });
    main.appendChild(h('div', { class: 'toolbar' }, h('input', { class: 'input', placeholder: 'Поиск', oninput: debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 350) }), h('select', { class: 'select', style: { maxWidth: '160px' }, onchange: (e) => { st.level = e.target.value; st.page = 1; load(); } }, [['', 'Все уровни'], ['info', 'info'], ['warning', 'warning'], ['error,critical', 'error']].map(([v, l]) => h('option', { value: v }, l)))));
    main.appendChild(tabsBox); main.appendChild(box);
    async function load() {
      tabsBox.innerHTML = ''; tabsBox.appendChild(tabs([['system', 'События'], ['audit', 'Действия админов']], st.kind, (k) => { st.kind = k; st.page = 1; load(); }));
      box.innerHTML = ''; box.appendChild(loader());
      try {
        const r = await api('/logs?kind=' + st.kind + '&level=' + st.level + '&q=' + encodeURIComponent(st.q) + '&page=' + st.page + '&size=50');
        box.innerHTML = '';
        if (!r.items.length) return box.appendChild(empty('Записей нет'));
        const rows = st.kind === 'system'
          ? r.items.map((l) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'small muted' }, fmtDate(l.created_at, true)), h('td', null, h('span', { class: 'badge ' + (l.level === 'error' || l.level === 'critical' ? 'red' : l.level === 'warning' ? 'amber' : 'gray') }, l.level)), h('td', null, h('span', { class: 'badge gray' }, l.category)), h('td', null, h('b', null, l.title), h('div', { class: 'small muted' }, l.detail)), h('td', { class: 'small mono' }, l.entity_type ? l.entity_type + ' ' + l.entity_id : '')))
          : r.items.map((l) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'small muted' }, fmtDate(l.created_at, true)), h('td', null, l.actor), h('td', { class: 'mono' }, l.action), h('td', { class: 'small' }, l.entity_type + ' ' + l.entity_id, l.details && Object.keys(l.details).length ? h('div', { class: 'muted mono small' }, JSON.stringify(l.details).slice(0, 160)) : null), h('td', { class: 'small muted' }, l.ip)));
        box.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, (st.kind === 'system' ? ['Когда', 'Уровень', 'Категория', 'Событие', 'Объект'] : ['Когда', 'Кто', 'Действие', 'Объект', 'IP']).map((x) => h('th', null, x)))), h('tbody', null, rows))));
        const p = pager(r.page, r.size, r.total, (pg) => { st.page = pg; load(); }); if (p) box.appendChild(p);
      } catch (e) { box.innerHTML = ''; box.appendChild(empty('Ошибка', e.message)); }
    }
    load();
  }

  /* ------------------------------------------------------------- boot */
  (async function boot() {
    state.route = parseHash();
    try { const r = await api('/auth/me'); state.admin = r.admin; startLive(); } catch (e) { state.admin = null; }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(() => {});
  })();
})();
