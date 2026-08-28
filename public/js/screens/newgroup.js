/* Create a new group. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  App.registerScreen('newgroup', {
    render() {
      const selected = new Set();
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const done = UI.textBtn('Создать', create, 'title-text');
      done.style.opacity = .4; done.style.pointerEvents = 'none';
      const nav = UI.header({ left: UI.iconBtn('close', () => App.pop()), title: 'Новая группа', right: done });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
      root.appendChild(content);

      const nameI = h('input', { placeholder: 'Название группы' });
      content.appendChild(h('div', { class: 'field' }, nameI));
      nameI.addEventListener('input', validate);

      content.appendChild(h('div', { class: 'list-title', text: 'УЧАСТНИКИ' }));
      const g = h('div', { class: 'group' });
      content.appendChild(g);

      App.api('GET', '/directory').then(({ users }) => {
        (users || []).forEach((u) => {
          const check = h('div', { class: 'p-radio', style: { width: '22px', height: '22px' } });
          g.appendChild(UI.cell({ avatar: UI.avatar(u, 44), title: u.name + (u.lastName ? ' ' + u.lastName : ''), sub: '@' + u.username, chevron: false, right: check,
            onClick: () => { if (selected.has(u.id)) { selected.delete(u.id); check.classList.remove('on'); } else { selected.add(u.id); check.classList.add('on'); } validate(); } }));
        });
      });

      function validate() { const ok = nameI.value.trim().length > 0 && selected.size > 0; done.style.opacity = ok ? 1 : .4; done.style.pointerEvents = ok ? 'auto' : 'none'; }
      async function create() {
        const title = nameI.value.trim(); if (!title || !selected.size) return;
        try { const { chat } = await App.api('POST', '/chats/group', { title, memberIds: [...selected] }); await App.loadChats(); App.pop(); App.openChat(chat.id); }
        catch (e) { UI.toast('Ошибка создания группы'); }
      }
      setTimeout(() => nameI.focus(), 100);
      return root;
    },
  });
})();
