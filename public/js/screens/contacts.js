/* Contacts tab + add-contact screen. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  function contactRow(u) {
    const row = h('div', { class: 'chat-item', onClick: () => App.openChatWith(u.id) });
    row.appendChild(UI.avatar(u, 54));
    if (u.online) row.appendChild(h('div', { class: 'status-dot' }));
    const name = h('div', { class: 'ci-name ellipsis' }, h('span', { text: u.name + (u.lastName ? ' ' + u.lastName : '') }));
    if (u.verified) name.appendChild(h('span', { class: 'verified badge-verified', html: Icons.verified() }));
    if (u.premium) name.appendChild(h('span', { class: 'badge-verified', html: Icons.premiumStar() }));
    row.appendChild(h('div', { class: 'ci-body' }, h('div', { class: 'ci-top' }, name),
      h('div', { class: 'ci-bottom' }, h('div', { class: 'ci-text muted', text: u.online ? 'в сети' : UI.lastSeen(u) }))));
    return row;
  }

  App.registerScreen('contacts', {
    render(params) {
      const root = h('div', { class: 'col', style: { height: '100%' } });
      const nav = UI.header({ title: 'Контакты', left: UI.textBtn('Сортировка', () => UI.toast('Сортировка по имени')),
        rightButtons: [UI.iconBtn('plus', () => App.push('addcontact'))] });
      root.appendChild(nav);
      root.appendChild(h('div', { class: 'searchbar' }, h('div', { class: 'search-input' }, UI.svg('search'),
        h('input', { placeholder: 'Поиск', readonly: true, onClick: () => App.push('search') }))));
      const content = h('div', { class: 'content scroll' });
      root.appendChild(content);

      content.appendChild(h('div', { class: 'group', style: { marginTop: '4px' } },
        h('div', { class: 'cell tap link', onClick: () => App.push('addcontact') },
          h('div', { class: 'ic-box', style: { background: 'transparent', color: 'var(--accent)' }, html: Icons.addUser() }),
          h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--accent)' }, text: 'Добавить контакт' })))));

      const listWrap = h('div', { class: 'group full', style: { marginTop: '10px' } });
      content.appendChild(listWrap);

      async function load() {
        UI.clear(listWrap);
        try {
          const [{ contacts }, dir] = await Promise.all([
            App.api('GET', '/contacts'),
            App.api('GET', '/directory').catch(() => ({ users: [] })),
          ]);
          let users = contacts && contacts.length ? contacts : (dir.users || []);
          App.state.contacts = users;
          if (!users.length) { listWrap.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'em', text: '👥' }), h('div', { text: 'Нет контактов' }))); return; }
          users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          users.forEach((u) => listWrap.appendChild(contactRow(u)));
        } catch (e) { listWrap.appendChild(h('div', { class: 'empty-state', text: 'Ошибка загрузки' })); }
      }
      load();
      App.bindBus(root, { 'presence': () => {} });
      if (params && params.add) setTimeout(() => App.push('addcontact'), 50);
      return root;
    },
  });

  App.registerScreen('addcontact', {
    render() {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const done = UI.textBtn('Готово', submit, 'title-text');
      const nav = UI.header({ left: UI.iconBtn('close', () => App.pop()), title: 'Новый контакт', right: done });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '14px' } });
      root.appendChild(content);

      const nameI = h('input', { placeholder: 'Имя' });
      const lastI = h('input', { placeholder: 'Фамилия' });
      content.appendChild(h('div', { class: 'field' }, nameI, lastI));
      const userI = h('input', { placeholder: '@username', autocapitalize: 'off', spellcheck: false });
      content.appendChild(h('div', { class: 'field' }, userI));
      content.appendChild(h('div', { class: 'field-hint', text: 'Введите @username пользователя, чтобы добавить его в контакты и начать чат.' }));
      const phoneI = h('input', { placeholder: '+7 000 000 0000', type: 'tel' });
      content.appendChild(h('div', { class: 'field', style: { marginTop: '16px' } }, phoneI));
      const err = h('div', { class: 'danger-text', style: { padding: '10px 20px', fontSize: '14px' } });
      content.appendChild(err);

      async function submit() {
        err.textContent = '';
        try {
          const { user, chatId } = await App.api('POST', '/contacts', {
            username: userI.value.trim(), phone: phoneI.value.trim(),
            firstName: nameI.value.trim(), lastName: lastI.value.trim() });
          UI.toast('Контакт добавлен: ' + user.name);
          App.pop();
          if (chatId) { await App.loadChats(); App.openChat(chatId); }
        } catch (e) { err.textContent = e.status === 404 ? 'Пользователь не найден. Проверьте @username.' : (e.message || 'Ошибка'); }
      }
      setTimeout(() => nameI.focus(), 100);
      return root;
    },
  });
})();
