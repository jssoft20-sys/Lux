/* Global search — users, chats, messages. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons, Format = window.Format;

  App.registerScreen('search', {
    render() {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const input = h('input', { placeholder: 'Поиск', autocapitalize: 'off', spellcheck: false });
      const clearBtn = h('button', { class: 'nav-btn circle pill', html: Icons.close(), onClick: () => App.pop() });
      const bar = h('div', { class: 'nav' }, h('div', { class: 'search-input', style: { flex: 1 } }, UI.svg('search'), input), clearBtn);
      root.appendChild(bar);

      const content = h('div', { class: 'content scroll' });
      root.appendChild(content);

      let tab = 'chats';
      const tabsBar = h('div', { class: 'tabs-bar' });
      ['chats:Чаты','channels:Каналы','apps:Приложения','posts:Посты','media:Медиа'].forEach((s) => {
        const [t, label] = s.split(':');
        tabsBar.appendChild(h('div', { class: 'tb' + (t === tab ? ' active' : ''), dataset: { t }, text: label, onClick: () => { tab = t; tabsBar.querySelectorAll('.tb').forEach((x) => x.classList.toggle('active', x.dataset.t === t)); doSearch(input.value); } }));
      });

      function renderRecent() {
        UI.clear(content);
        // horizontal avatars of recent chats
        const avatarsRow = h('div', { style: { display: 'flex', gap: '14px', overflowX: 'auto', padding: '10px 12px' } });
        App.state.chats.slice(0, 12).forEach((c) => {
          avatarsRow.appendChild(h('div', { class: 'col', style: { alignItems: 'center', gap: '4px', width: '64px' }, onClick: () => { App.pop(); App.openChat(c.id); } },
            UI.avatar(c.type === 'saved' ? { type: 'saved' } : (c.peer || { id: c.id, name: c.title }), 56),
            h('div', { class: 'ellipsis', style: { fontSize: '12px', width: '64px', textAlign: 'center' }, text: (c.title || '').split(' ')[0] })));
        });
        content.appendChild(avatarsRow);
        content.appendChild(h('div', { class: 'list-title', text: 'НЕДАВНИЕ', style: { display: 'flex', justifyContent: 'space-between' } }));
        const g = h('div', { class: 'group full' });
        App.state.chats.slice(0, 8).forEach((c) => g.appendChild(resultRow(c.type === 'saved' ? { type: 'saved' } : (c.peer || { id: c.id, name: c.title }), c.title, c.peer ? UI.lastSeen(c.peer) : (c.memberCount ? c.memberCount + ' участников' : ''), () => { App.pop(); App.openChat(c.id); })));
        content.appendChild(g);
      }

      function resultRow(entity, title, sub, onClick) {
        const row = h('div', { class: 'chat-item', onClick });
        row.appendChild(UI.avatar(entity, 48));
        const name = h('div', { class: 'ci-name' }, h('span', { text: title }));
        if (entity.verified) name.appendChild(h('span', { class: 'verified badge-verified', html: Icons.verified() }));
        row.appendChild(h('div', { class: 'ci-body' }, h('div', { class: 'ci-top' }, name), h('div', { class: 'ci-bottom' }, h('div', { class: 'ci-text muted', text: sub || '' }))));
        return row;
      }

      let timer;
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => doSearch(input.value), 250); });

      async function doSearch(q) {
        q = q.trim();
        if (!q) { renderRecent(); return; }
        UI.clear(content);
        content.appendChild(tabsBar);
        try {
          const { users, chats, messages } = await App.api('GET', '/search?q=' + encodeURIComponent(q));
          if (tab === 'media' || tab === 'posts') {
            if (!messages.length) return content.appendChild(empty());
            content.appendChild(h('div', { class: 'list-title', text: 'СООБЩЕНИЯ' }));
            const g = h('div', { class: 'group full' });
            messages.forEach((m) => g.appendChild(resultRow({ id: m.senderId, name: m.senderName }, m.senderName, Format.plain(m.text), () => { App.pop(); App.openChat(m.chatId); })));
            content.appendChild(g);
            return;
          }
          const peopleG = h('div', { class: 'group full' });
          const combined = [];
          users.forEach((u) => combined.push(resultRow(u, u.name + (u.lastName ? ' ' + u.lastName : ''), '@' + u.username, () => { App.pop(); App.openChatWith(u.id); })));
          chats.forEach((c) => { if (c.type === 'group' || c.type === 'channel') combined.push(resultRow({ id: c.id, name: c.title }, c.title, c.memberCount + (c.type === 'channel' ? ' подписчиков' : ' участников'), () => { App.pop(); App.openChat(c.id); })); });
          if (!combined.length && !messages.length) return content.appendChild(empty());
          if (combined.length) { content.appendChild(h('div', { class: 'list-title', text: tab === 'channels' ? 'КАНАЛЫ' : 'ЧАТЫ И КОНТАКТЫ' })); combined.forEach((r) => peopleG.appendChild(r)); content.appendChild(peopleG); }
          if (messages.length && tab === 'chats') {
            content.appendChild(h('div', { class: 'list-title', text: 'СООБЩЕНИЯ' }));
            const g = h('div', { class: 'group full' });
            messages.forEach((m) => g.appendChild(resultRow({ id: m.senderId, name: m.senderName }, m.senderName, Format.plain(m.text), () => { App.pop(); App.openChat(m.chatId); })));
            content.appendChild(g);
          }
        } catch (e) { content.appendChild(empty()); }
      }
      function empty() { return h('div', { class: 'empty-state' }, h('div', { class: 'em', text: '🔍' }), h('div', { text: 'Ничего не найдено' })); }

      renderRecent();
      setTimeout(() => input.focus(), 120);
      return root;
    },
  });
})();
