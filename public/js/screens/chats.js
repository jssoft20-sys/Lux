/* Chats list (main tab). */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons, Format = window.Format;

  function previewText(chat) {
    const m = chat.lastMessage;
    if (!m) return h('span', { class: 'ci-text muted', text: chat.about || 'Нет сообщений' });
    let prefix = '';
    if ((chat.type === 'group' || chat.type === 'channel') && m.senderName && !m.service) prefix = m.senderName.split(' ')[0] + ': ';
    let body = m.text ? Format.plain(m.text) : '';
    if (m.service) body = serviceText(m);
    else if (!body && m.media) {
      const k = m.media.kind;
      body = k === 'photo' ? '📷 Фото' : k === 'video' ? '🎥 Видео' : k === 'voice' ? '🎤 Голосовое сообщение'
        : k === 'sticker' ? (m.media.emoji || '') + ' Стикер' : k === 'file' ? '📎 ' + (m.media.name || 'Файл')
        : k === 'link' ? (m.media.title || m.media.url) : 'Вложение';
    } else if (!body && m.poll) body = '📊 ' + (m.poll.question || 'Опрос');
    const span = h('span', { class: 'ci-text' });
    span.appendChild(h('b', { text: prefix }));
    span.appendChild(document.createTextNode(body));
    return span;
  }
  function serviceText(m) { const s = m.service; if (!s) return ''; if (s.type === 'group_created') return 'Группа создана'; return ''; }

  function chatItem(chat) {
    const av = UI.avatar(chat.type === 'saved' ? { type: 'saved' } : (chat.peer || { id: chat.id, name: chat.title, avatar: chat.avatar }), 54);
    const wrap = h('div', { class: 'chat-item', onClick: () => App.openChat(chat.id) });
    wrap.appendChild(av);
    if (chat.online) wrap.appendChild(h('div', { class: 'status-dot' }));
    const nameRow = h('div', { class: 'ci-name ellipsis' }, h('span', { class: 'ellipsis', text: chat.title }));
    if (chat.verified) nameRow.appendChild(h('span', { class: 'verified badge-verified', html: Icons.verified() }));
    if (chat.muted) nameRow.appendChild(h('span', { class: 'muted', style: { width: '16px', opacity: .5 }, html: Icons.mute() }));
    const time = chat.lastMessage ? h('div', { class: 'ci-time', text: UI.dateShort(chat.lastMessage.ts) }) : h('div');
    const bottom = h('div', { class: 'ci-bottom' }, previewText(chat));
    if (chat.pinnedMessageId && !chat.unread) bottom.appendChild(h('span', { class: 'pin-ic', html: Icons.pin() }));
    if (chat.unread) bottom.appendChild(h('div', { class: 'ci-badge' + (chat.muted ? ' muted' : ''), text: chat.unread > 999 ? '999+' : chat.unread }));
    const body = h('div', { class: 'ci-body' }, h('div', { class: 'ci-top' }, nameRow, time), bottom);
    wrap.appendChild(body);
    // long-press context
    attachLongPress(wrap, (e) => chatMenu(e, chat));
    return wrap;
  }

  function attachLongPress(el, handler) {
    let timer, moved;
    const start = (e) => { moved = false; timer = setTimeout(() => { if (!moved) handler(e.touches ? e.touches[0] : e); }, 480); };
    const cancel = () => clearTimeout(timer);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', () => { moved = true; cancel(); }, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); handler(e); });
  }

  function chatMenu(e, chat) {
    const x = e.clientX || 60, y = e.clientY || 200;
    UI.contextMenu(x, y, [
      { label: chat.muted ? 'Включить уведомления' : 'Выключить уведомления', icon: 'bell', onClick: () => toggleMute(chat) },
      { label: 'Отметить прочитанным', icon: 'check', onClick: () => markRead(chat) },
      { label: 'Удалить чат', icon: 'trash', danger: true, onClick: () => deleteChat(chat) },
    ]);
  }
  async function toggleMute(chat) { await App.api('PATCH', '/chats/' + chat.id + '/mute', { muted: !chat.muted }); chat.muted = !chat.muted; App.bus.emit('chats:changed'); }
  function markRead(chat) { App.emit('message:read', { chatId: chat.id }); chat.unread = 0; App.bus.emit('chats:changed'); App.updateTabBadge(); }
  async function deleteChat(chat) {
    if (!(await UI.confirm({ title: 'Удалить чат?', text: 'История будет удалена.', okLabel: 'Удалить', danger: true }))) return;
    await App.api('DELETE', '/chats/' + chat.id);
    App.state.chats = App.state.chats.filter((c) => c.id !== chat.id);
    App.bus.emit('chats:changed');
  }

  const FOLDERS = [
    { id: 'all', title: 'Все', match: () => true },
    { id: 'personal', title: 'Личные', match: (c) => c.type === 'private' || c.type === 'saved' },
    { id: 'bots', title: 'Боты', match: (c) => c.isBot || c.type === 'bot' },
    { id: 'groups', title: 'Группы', match: (c) => c.type === 'group' },
    { id: 'channels', title: 'Каналы', match: (c) => c.type === 'channel' },
    { id: 'unread', title: 'Новые', match: (c) => (c.unread || 0) > 0 },
  ];

  App.registerScreen('chats', {
    render() {
      let activeFolder = 'all';
      const root = h('div', { class: 'col', style: { height: '100%' } });

      const title = h('div', { class: 'nav-title pill' }, h('span', { text: 'Чаты' }), h('span', { text: ' 🧠' }));
      const nav = UI.header({
        titleEl: title,
        left: UI.textBtn('Изм.', () => UI.toast('Режим редактирования')),
        rightButtons: [
          UI.iconBtn('addUser', () => App.push('newgroup')),
          UI.iconBtn('compose', () => openCompose()),
        ],
      });
      root.appendChild(nav);

      // folder segments
      const seg = h('div', { class: 'segments' });
      const content = h('div', { class: 'content scroll' });
      function renderSegments() {
        UI.clear(seg);
        const custom = App.state.folders.map((f) => ({ id: 'f_' + f.id, title: f.title, match: (c) => (f.includedChats || []).includes(c.id) }));
        [...FOLDERS, ...custom].forEach((f) => {
          const count = f.id === 'all' ? 0 : App.state.chats.filter(f.match).length;
          const s = h('div', { class: 'segment' + (activeFolder === f.id ? ' active' : ''),
            onClick: () => { activeFolder = f.id; renderSegments(); renderList(); } },
            h('span', { text: f.title }), (count && f.id !== 'all') ? h('span', { class: 'cnt' + (f.id === 'unread' ? ' grey' : '') , text: count }) : null);
          seg.appendChild(s);
        });
      }
      function renderList() {
        UI.clear(content);
        const all = [...FOLDERS, ...App.state.folders.map((f) => ({ id: 'f_' + f.id, match: (c) => (f.includedChats || []).includes(c.id) }))];
        const folder = all.find((f) => f.id === activeFolder) || FOLDERS[0];
        const chats = App.state.chats.filter(folder.match);
        if (!chats.length) { content.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'em', text: '💬' }), h('div', { text: 'Нет чатов' }))); return; }
        chats.forEach((c) => content.appendChild(chatItem(c)));
      }
      root.appendChild(seg); root.appendChild(content);
      renderSegments(); renderList();

      App.bindBus(root, { 'chats:changed': () => { renderSegments(); renderList(); } });
      // preload folders
      App.api('GET', '/folders').then(({ folders }) => { App.state.folders = folders; renderSegments(); }).catch(() => {});
      return root;
    },
  });

  function openCompose() {
    UI.sheet({ actions: [
      { label: 'Новая группа', icon: 'contacts', onClick: () => App.push('newgroup') },
      { label: 'Новый контакт', icon: 'addUser', onClick: () => App.push('contacts', { add: true }) },
      { label: 'Найти людей', icon: 'search', onClick: () => App.push('search') },
    ] });
  }
})();
