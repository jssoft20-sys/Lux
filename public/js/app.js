/* Core application: state, socket, api, router, tab bar. window.App */
(function () {
  const UI = window.UI, Icons = window.Icons, h = UI.h;

  const App = {
    state: {
      token: localStorage.getItem('tg_token') || null,
      me: null,
      chats: [],
      activeChatId: null,
      messages: {},        // chatId -> [messages]
      typing: {},          // chatId -> { userId: name }
      contacts: [],
      folders: [],
      activeTab: 'chats',
      theme: localStorage.getItem('tg_theme') || 'light',
    },
    screens: {},
    el: {},
    socket: null,
    bus: makeBus(),

    registerScreen(name, def) { this.screens[name] = def; },

    /* ---------- api ---------- */
    async api(method, path, body, isForm) {
      const headers = {};
      if (this.state.token) headers.Authorization = 'Bearer ' + this.state.token;
      let bodyToSend;
      if (isForm) bodyToSend = body;
      else if (body != null) { headers['Content-Type'] = 'application/json'; bodyToSend = JSON.stringify(body); }
      const res = await fetch('/api' + path, { method, headers, body: bodyToSend });
      let data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error((data && data.error) || res.statusText); err.status = res.status; err.data = data; throw err; }
      return data;
    },
    async upload(file) {
      const fd = new FormData(); fd.append('file', file);
      return this.api('POST', '/upload', fd, true);
    },

    /* ---------- boot ---------- */
    async boot() {
      this.el.root = document.getElementById('app-root');
      document.documentElement.setAttribute('data-theme', this.state.theme);
      this.buildFrame();
      if (!this.state.token) { this.showAuth(); return; }
      try {
        const { user } = await this.api('GET', '/me');
        this.state.me = user;
        await this.loadChats();
        this.connectSocket();
        this.hideSplash();
        this.tab('chats');
      } catch (e) {
        console.warn('boot failed', e);
        localStorage.removeItem('tg_token'); this.state.token = null;
        this.showAuth();
      }
    },

    buildFrame() {
      const phone = h('div', { id: 'phone' });
      const screensWrap = h('div', { id: 'screens' });
      const base = h('div', { id: 'base', class: 'screen' });
      const stack = h('div', { id: 'stack', style: { position: 'absolute', inset: 0, pointerEvents: 'none' } });
      const overlayLayer = h('div', { id: 'overlay-layer', style: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 700 } });
      overlayLayer.addEventListener('pointerdown', (e) => { /* children re-enable */ });
      screensWrap.appendChild(base); screensWrap.appendChild(stack);
      phone.appendChild(screensWrap); phone.appendChild(overlayLayer);
      this.el.root.innerHTML = ''; this.el.root.appendChild(phone);
      this.el.phone = phone; this.el.screens = screensWrap; this.el.base = base;
      this.el.stack = stack; this.el.overlayLayer = overlayLayer;
      // overlay children should capture events
      new MutationObserver(() => { for (const c of overlayLayer.children) c.style.pointerEvents = 'auto'; for (const c of stack.children) c.style.pointerEvents = 'auto'; })
        .observe(overlayLayer, { childList: true }) ;
      const mo2 = new MutationObserver(() => { for (const c of stack.children) c.style.pointerEvents = 'auto'; });
      mo2.observe(stack, { childList: true });
    },

    hideSplash() { const s = document.getElementById('splash'); if (s) s.remove(); },

    showAuth() { this.hideSplash(); this.setBase(this.screens.auth.render()); this.el.tabbarEl && this.el.tabbarEl.remove(); },

    /* ---------- tab bar ---------- */
    buildTabbar() {
      const tabs = [
        { id: 'contacts', icon: 'contacts', label: 'Контакты' },
        { id: 'calls', icon: 'phone', label: 'Звонки' },
        { id: 'chats', icon: 'chats', label: 'Чаты' },
        { id: 'settings', icon: 'settings', label: 'Настройки' },
        { id: 'search', icon: 'search', label: '', cls: 'search' },
      ];
      const bar = h('div', { class: 'tabbar' });
      tabs.forEach((t) => {
        const badge = t.id === 'chats' ? h('span', { class: 'badge', style: { display: 'none' } }) : null;
        const el = h('div', { class: 'tab ' + (t.cls || '') + (t.id === this.state.activeTab ? ' active' : ''), dataset: { tab: t.id },
          onClick: () => { if (t.id === 'search') this.push('search'); else this.tab(t.id); } },
          h('div', { class: 'tab-ic', html: Icons[t.icon]() }), t.label ? h('div', { text: t.label }) : null, badge);
        if (badge) el._badge = badge;
        bar.appendChild(el);
      });
      this.el.tabbarEl = bar;
      return bar;
    },
    updateTabBadge() {
      if (!this.el.tabbarEl) return;
      const total = this.state.chats.reduce((s, c) => s + (c.muted ? 0 : (c.unread || 0)), 0);
      const chatTab = this.el.tabbarEl.querySelector('[data-tab="chats"]');
      if (chatTab && chatTab._badge) { chatTab._badge.style.display = total ? 'flex' : 'none'; chatTab._badge.textContent = total > 999 ? '999+' : total; }
    },
    setActiveTab(name) {
      this.state.activeTab = name;
      if (this.el.tabbarEl) this.el.tabbarEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    },

    setBase(screenEl) {
      if (this.el.base._teardown) this.el.base._teardown();
      const old = this.el.base;
      screenEl.id = 'base'; screenEl.classList.add('screen');
      old.replaceWith(screenEl);
      this.el.base = screenEl;
    },

    tab(name) {
      this.setActiveTab(name);
      const def = this.screens[name];
      const content = def.render();
      // append persistent tabbar
      if (!this.el.tabbarEl) this.buildTabbar();
      const bar = this.buildTabbar();
      content.appendChild(bar);
      content.classList.add('tab-view');
      this.setBase(content);
      this.updateTabBadge();
    },

    /* ---------- push / pop overlay stack ---------- */
    push(name, params) {
      const def = this.screens[name];
      if (!def) return console.warn('no screen', name);
      const el = def.render(params || {});
      el.classList.add('screen', 'overlay', 'enter');
      el.style.pointerEvents = 'auto';
      this.el.stack.appendChild(el);
      // slide behind previous
      const prev = this.currentTop();
      requestAnimationFrame(() => {
        el.classList.add('enter-active');
        el.classList.remove('enter');
        setTimeout(() => el.classList.remove('enter-active'), 340);
      });
      return el;
    },
    currentTop() { const c = this.el.stack.children; return c.length ? c[c.length - 1] : this.el.base; },
    pop() {
      const c = this.el.stack.children;
      if (!c.length) return;
      const top = c[c.length - 1];
      top.classList.add('exit-active');
      top.style.transform = 'translateX(100%)';
      if (top._teardown) top._teardown();
      setTimeout(() => top.remove(), 320);
    },
    popTo(name) { /* pop all */ while (this.el.stack.children.length) this.el.stack.lastChild.remove(); },

    /* ---------- convenience navigation ---------- */
    async openChat(chatId) {
      // activeChatId is managed by the chat screen's own lifecycle (set on render,
      // restored to the previous value on teardown) so nested chats nest correctly.
      this.push('chat', { chatId });
    },
    async openChatWith(userIdOrName) {
      try {
        const key = /^[a-zA-Z0-9_]+$/.test(userIdOrName) && !userIdOrName.startsWith('u') ? { username: userIdOrName } : { userId: userIdOrName };
        const { chat } = await this.api('POST', '/chats/open', key);
        this.upsertChat(chat);
        this.openChat(chat.id);
      } catch (e) { UI.toast(e.message || 'Не удалось открыть чат'); }
    },
    async openUsername(username) {
      try {
        const { chat } = await this.api('POST', '/chats/open', { username });
        this.upsertChat(chat); this.openChat(chat.id);
      } catch (e) { UI.toast('Пользователь не найден'); }
    },
    openProfile(userOrId, chat) { this.push('profile', { user: typeof userOrId === 'object' ? userOrId : null, userId: typeof userOrId === 'string' ? userOrId : null, chat }); },

    /* ---------- data ---------- */
    async loadChats() {
      const { chats } = await this.api('GET', '/chats');
      this.state.chats = chats;
      this.bus.emit('chats:changed');
      this.updateTabBadge();
    },
    upsertChat(chat) {
      const i = this.state.chats.findIndex((c) => c.id === chat.id);
      if (i >= 0) this.state.chats[i] = Object.assign(this.state.chats[i], chat);
      else this.state.chats.unshift(chat);
      this.bus.emit('chats:changed');
      this.updateTabBadge();
    },
    getChat(id) { return this.state.chats.find((c) => c.id === id); },
    me() { return this.state.me; },

    /* ---------- socket ---------- */
    connectSocket() {
      if (this.socket) this.socket.disconnect();
      const socket = io({ auth: { token: this.state.token }, transports: ['websocket', 'polling'] });
      this.socket = socket;
      socket.on('connect', () => { this.bus.emit('socket:connect'); });
      socket.on('unauthorized', () => { this.logout(); });
      socket.on('message:new', (p) => {
        const arr = this.state.messages[p.chatId];
        if (arr && !arr.find((m) => m.id === p.message.id)) arr.push(p.message);
        // update chat list preview + unread
        const chat = this.getChat(p.chatId);
        if (chat) {
          chat.lastMessage = p.message;
          if (p.message.senderId !== this.state.me.id && this.state.activeChatId !== p.chatId) chat.unread = (chat.unread || 0) + 1;
          this.bus.emit('chats:changed'); this.updateTabBadge();
        } else { this.loadChats(); }
        this.bus.emit('message:new', p);
        if (p.message.senderId !== this.state.me.id && this.state.activeChatId !== p.chatId && !(chat && chat.muted)) this.ping();
      });
      socket.on('message:edit', (p) => { const arr = this.state.messages[p.chatId]; if (arr) { const i = arr.findIndex((m) => m.id === p.message.id); if (i >= 0) arr[i] = p.message; } this.bus.emit('message:edit', p); });
      socket.on('message:delete', (p) => { const arr = this.state.messages[p.chatId]; if (arr) { const i = arr.findIndex((m) => m.id === p.messageId); if (i >= 0) arr.splice(i, 1); } this.bus.emit('message:delete', p); });
      socket.on('message:react', (p) => { const arr = this.state.messages[p.chatId]; if (arr) { const m = arr.find((x) => x.id === p.messageId); if (m) m.reactions = p.reactions; } this.bus.emit('message:react', p); });
      socket.on('message:read', (p) => this.bus.emit('message:read', p));
      socket.on('chat:pin', (p) => { const c = this.getChat(p.chatId); if (c) c.pinnedMessageId = p.pinnedMessageId; this.bus.emit('chat:pin', p); });
      socket.on('chat:new', (p) => { this.upsertChat(p.chat); });
      socket.on('poll:update', (p) => { const arr = this.state.messages[p.chatId]; if (arr) { const m = arr.find((x) => x.id === p.messageId); if (m) m.poll = p.poll; } this.bus.emit('poll:update', p); });
      socket.on('typing', (p) => {
        this.state.typing[p.chatId] = this.state.typing[p.chatId] || {};
        if (p.on) this.state.typing[p.chatId][p.userId] = p.name || '';
        else delete this.state.typing[p.chatId][p.userId];
        this.bus.emit('typing', p);
      });
      socket.on('presence', (p) => {
        const chat = this.state.chats.find((c) => c.peer && c.peer.id === p.userId);
        if (chat) { chat.online = p.online; chat.lastSeen = p.lastSeen; }
        this.bus.emit('presence', p);
      });
      // calls
      socket.on('call:incoming', (p) => { this.bus.emit('call:incoming', p); if (window.WebRTC) window.WebRTC.onIncoming(p); });
      socket.on('call:ringing', (p) => this.bus.emit('call:ringing', p));
      socket.on('call:answered', (p) => this.bus.emit('call:answered', p));
      socket.on('call:ice', (p) => this.bus.emit('call:ice', p));
      socket.on('call:hangup', (p) => this.bus.emit('call:hangup', p));
      socket.on('call:declined', (p) => this.bus.emit('call:declined', p));
      // presence ping
      this._pingTimer = setInterval(() => socket.connected && socket.emit('presence:ping'), 45000);
    },
    ping() { try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} },

    emit(event, payload, ack) { if (this.socket) this.socket.emit(event, payload, ack); },
    emitAck(event, payload) { return new Promise((res) => this.socket.emit(event, payload, res)); },

    /* ---------- bus binding helper for screens ---------- */
    bindBus(el, map) {
      const subs = [];
      for (const ev in map) subs.push(this.bus.on(ev, map[ev]));
      const prev = el._teardown;
      el._teardown = () => { subs.forEach((u) => u()); prev && prev(); };
    },

    /* ---------- theme ---------- */
    toggleTheme(theme) {
      this.state.theme = theme || (this.state.theme === 'dark' ? 'light' : 'dark');
      localStorage.setItem('tg_theme', this.state.theme);
      document.documentElement.setAttribute('data-theme', this.state.theme);
      this.bus.emit('theme', this.state.theme);
    },

    async logout() {
      try { await this.api('POST', '/auth/logout'); } catch (e) {}
      localStorage.removeItem('tg_token');
      this.state.token = null; this.state.me = null;
      if (this.socket) this.socket.disconnect();
      if (this._pingTimer) clearInterval(this._pingTimer);
      this.showAuth();
    },
    async afterLogin(token, user) {
      this.state.token = token; this.state.me = user;
      localStorage.setItem('tg_token', token);
      await this.loadChats();
      this.connectSocket();
      this.tab('chats');
    },
  };

  function makeBus() {
    const map = {};
    return {
      on(ev, fn) { (map[ev] = map[ev] || []).push(fn); return () => { map[ev] = (map[ev] || []).filter((f) => f !== fn); }; },
      emit(ev, payload) { (map[ev] || []).forEach((f) => { try { f(payload); } catch (e) { console.error(e); } }); },
    };
  }

  window.App = App;
})();
