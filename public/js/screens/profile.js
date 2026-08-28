/* User / chat profile. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  App.registerScreen('profile', {
    render(params) {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      let user = params.user || null;
      const chat = params.chat || null;
      const content = h('div', { class: 'content scroll' });
      const nav = UI.header({ onBack: () => App.pop(), title: '', right: UI.textBtn('Изм.', () => {}) });
      nav.classList.add('solid'); root.appendChild(nav); root.appendChild(content);

      async function ensureUser() {
        if (user) return user;
        if (params.userId) { const { user: u } = await App.api('GET', '/users/' + params.userId); user = u; }
        else if (chat && chat.peer) user = chat.peer;
        return user;
      }

      async function build() {
        await ensureUser();
        UI.clear(content);
        const isChannelOrGroup = chat && (chat.type === 'group' || chat.type === 'channel');
        const entity = user || { id: chat && chat.id, name: chat && chat.title, color: chat && chat.color, avatar: chat && chat.avatar };
        const title = user ? (user.name + (user.lastName ? ' ' + user.lastName : '')) : (chat && chat.title) || 'Профиль';

        // header
        const head = h('div', { class: 'profile-head' }, UI.avatar(entity, 96));
        const nameEl = h('div', { class: 'p-name' }, h('span', { text: title }));
        if ((user && user.verified) || (chat && chat.verified)) nameEl.appendChild(h('span', { class: 'verified badge-verified', style: { width: '22px' }, html: Icons.verified() }));
        head.appendChild(nameEl);
        let status = '';
        if (user) status = user.isBot ? 'бот' : UI.lastSeen(user);
        else if (chat && chat.type === 'group') status = chat.memberCount + ' участников';
        else if (chat && chat.type === 'channel') status = chat.memberCount + ' подписчиков';
        head.appendChild(h('div', { class: 'p-status' + ((user && user.online) ? ' online' : ''), text: status }));
        content.appendChild(head);

        // action buttons
        const actions = h('div', { class: 'action-buttons' });
        actions.appendChild(ab('chats', 'чат', () => { App.pop(); if (user) App.openChatWith(user.id); else if (chat) App.openChat(chat.id); }));
        if (user && !user.isBot) {
          actions.appendChild(ab('call', 'звонок', () => window.WebRTC && window.WebRTC.call(user, false)));
          actions.appendChild(ab('video', 'видео', () => window.WebRTC && window.WebRTC.call(user, true)));
        }
        actions.appendChild(ab('mute', 'звук', () => toggleMute()));
        actions.appendChild(ab('more', 'ещё', (e) => moreMenu(e)));
        content.appendChild(actions);

        // info group
        const info = [];
        if (user && user.bio) info.push(UI.cell({ title: user.bio, sub: 'О себе', chevron: false }));
        if (user && user.username) info.push(UI.cell({ titleHTML: '@' + user.username, sub: 'Имя пользователя', chevron: false, onClick: () => { navigator.clipboard && navigator.clipboard.writeText('@' + user.username); UI.toast('Скопировано'); } }));
        if (user && user.phone) info.push(UI.cell({ title: user.phone, sub: 'Телефон', chevron: false }));
        if (chat && chat.about) info.push(UI.cell({ title: chat.about, sub: 'Описание', chevron: false }));
        if (info.length) content.appendChild(h('div', { class: 'group', style: { marginTop: '10px' } }, info));

        // add to contacts / block (for other users)
        if (user && user.id !== App.state.me.id && !user.isBot) {
          content.appendChild(h('div', { class: 'group', style: { marginTop: '16px' } },
            h('div', { class: 'cell tap link', onClick: () => addContact() }, h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--accent)' }, text: 'Добавить в контакты' }))),
            h('div', { class: 'cell tap danger', onClick: () => blockUser() }, h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--danger)' }, text: 'Заблокировать' })))));
        }

        // shared media tabs
        const tabsBar = h('div', { class: 'tabs-bar', style: { marginTop: '14px' } });
        ['media:Медиа','files:Файлы','voice:Голосовые','links:Ссылки'].forEach((s, i) => {
          const [t, label] = s.split(':');
          tabsBar.appendChild(h('div', { class: 'tb' + (i === 0 ? ' active' : ''), dataset: { t }, text: label, onClick: () => { tabsBar.querySelectorAll('.tb').forEach((x) => x.classList.toggle('active', x.dataset.t === t)); loadShared(t); } }));
        });
        content.appendChild(tabsBar);
        const sharedWrap = h('div', {}); content.appendChild(sharedWrap);
        async function loadShared(kind) {
          UI.clear(sharedWrap);
          const cid = chat ? chat.id : null;
          if (!cid) { sharedWrap.appendChild(placeholder(kind)); return; }
          try {
            const { items } = await App.api('GET', '/chats/' + cid + '/shared?kind=' + kind);
            if (!items.length) { sharedWrap.appendChild(placeholder(kind)); return; }
            if (kind === 'media') { const grid = h('div', { class: 'media-grid' }); items.forEach((m) => grid.appendChild(h('div', { class: 'mg-item' }, m.media.url ? h('img', { src: m.media.url }) : (m.media.emoji || '🖼️')))); sharedWrap.appendChild(grid); }
            else { const g = h('div', { class: 'group full' }); items.forEach((m) => g.appendChild(UI.cell({ icon: kind === 'voice' ? 'mic' : 'file', iconBg: '#5aa9e6', title: m.media.name || m.media.title || (kind === 'voice' ? 'Голосовое' : 'Файл'), sub: UI.dateShort(m.ts), chevron: false }))); sharedWrap.appendChild(g); }
          } catch (e) { sharedWrap.appendChild(placeholder(kind)); }
        }
        function placeholder(kind) { return h('div', { class: 'empty-state', style: { height: '160px' } }, h('div', { class: 'em', text: kind === 'voice' ? '🎤' : kind === 'files' ? '📎' : kind === 'links' ? '🔗' : '🖼️' }), h('div', { text: 'Пусто' })); }
        loadShared('media');

        function ab(icon, label, onClick) { return h('button', { class: 'ab', onClick }, UI.svg(icon), h('span', { text: label })); }

        function moreMenu(e) {
          const x = (e && e.clientX) || 300, y = (e && e.clientY) || 200;
          UI.contextMenu(x, y, [
            { label: 'Изменить обои', icon: 'wallpaper', onClick: () => UI.toast('Изменить обои') },
            { label: 'Начать секретный чат', icon: 'secret', onClick: () => UI.toast('Секретный чат 🔒') },
            { label: 'Отправить подарок', icon: 'gift', onClick: () => UI.toast('Отправить подарок 🎁') },
            { sep: true },
            { label: 'Автоудаление', icon: 'timer', onClick: () => autoDelete() },
            { label: 'Запретить копирование', icon: 'noCopy', onClick: () => UI.toast('Копирование запрещено') },
            { label: 'Удалить переписку', icon: 'trash', danger: true, onClick: () => deleteChat() },
          ]);
        }
        function autoDelete() { UI.sheet({ title: 'Автоудаление сообщений', actions: [
          { label: 'Выключено', onClick: () => UI.toast('Автоудаление выключено') },
          { label: 'Через 1 день', onClick: () => UI.toast('Автоудаление: 1 день') },
          { label: 'Через 1 неделю', onClick: () => UI.toast('Автоудаление: 1 неделя') },
          { label: 'Через 1 месяц', onClick: () => UI.toast('Автоудаление: 1 месяц') } ] }); }
        async function toggleMute() { if (!chat) return UI.toast('Уведомления'); await App.api('PATCH', '/chats/' + chat.id + '/mute', { muted: !chat.muted }); chat.muted = !chat.muted; UI.toast(chat.muted ? 'Без звука' : 'Звук включён'); }
        async function addContact() { try { await App.api('POST', '/contacts', { username: user.username }); UI.toast('Добавлено в контакты'); } catch (e) { UI.toast('Ошибка'); } }
        async function blockUser() {
          if (!(await UI.confirm({ title: 'Заблокировать ' + title + '?', text: 'Пользователь не сможет писать вам и звонить.', okLabel: 'Заблокировать', danger: true }))) return;
          UI.toast(title + ' заблокирован');
        }
        async function deleteChat() {
          if (!chat) return App.pop();
          if (!(await UI.confirm({ title: 'Удалить переписку?', okLabel: 'Удалить', danger: true }))) return;
          await App.api('DELETE', '/chats/' + chat.id); App.popTo(); App.loadChats(); App.tab('chats');
        }
      }
      build();
      return root;
    },
  });
})();
