/* Chat folders. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  App.registerScreen('folders', {
    render() {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const nav = UI.header({ onBack: () => App.pop(), title: 'Папки с чатами' });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
      root.appendChild(content);
      content.appendChild(h('div', { class: 'col', style: { alignItems: 'center', padding: '10px 20px' } },
        h('div', { style: { fontSize: '54px' }, text: '🗂️' }),
        h('div', { class: 'muted center', style: { fontSize: '14px', marginTop: '6px' }, text: 'Создавайте папки для групп чатов и быстро переключайтесь между ними.' })));

      const listWrap = h('div', {}); content.appendChild(listWrap);
      async function load() {
        UI.clear(listWrap);
        const { folders } = await App.api('GET', '/folders'); App.state.folders = folders;
        listWrap.appendChild(h('div', { class: 'group', style: { marginTop: '10px' } },
          h('div', { class: 'cell tap link', onClick: () => createFolder() },
            h('div', { class: 'ic-box', style: { background: 'transparent', color: 'var(--accent)' }, html: Icons.plus() }),
            h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--accent)' }, text: 'Создать папку' })))));
        if (folders.length) {
          const g = h('div', { class: 'group', style: { marginTop: '16px' } });
          folders.forEach((f) => g.appendChild(UI.cell({ title: (f.emoji || '📁') + ' ' + f.title, sub: (f.includedChats || []).length + ' чатов',
            onClick: () => editFolder(f) })));
          listWrap.appendChild(g);
        }
      }
      function createFolder() { App.push('editfolder', { onSaved: load }); }
      function editFolder(f) { App.push('editfolder', { folder: f, onSaved: load }); }
      load();
      return root;
    },
  });

  App.registerScreen('editfolder', {
    render(params) {
      const folder = params.folder || null;
      const included = new Set((folder && folder.includedChats) || []);
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const done = UI.iconBtn('check', save); done.classList.add('title-text');
      const nav = UI.header({ left: UI.iconBtn('close', () => App.pop()), title: 'Настройки папки', right: done });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
      root.appendChild(content);

      content.appendChild(h('div', { class: 'list-title', text: 'НАЗВАНИЕ ПАПКИ' }));
      const nameI = h('input', { placeholder: 'Название', value: folder ? folder.title : '' });
      content.appendChild(h('div', { class: 'field' }, nameI));

      content.appendChild(h('div', { class: 'list-title', text: 'ВЫБРАННЫЕ ЧАТЫ' }));
      const g = h('div', { class: 'group' });
      App.state.chats.forEach((c) => {
        const check = h('div', { class: 'p-radio' + (included.has(c.id) ? ' on' : ''), style: { width: '22px', height: '22px' } });
        const cell = UI.cell({ avatar: UI.avatar(c.peer || { id: c.id, name: c.title }, 40), title: c.title, chevron: false, right: check,
          onClick: () => { if (included.has(c.id)) { included.delete(c.id); check.classList.remove('on'); } else { included.add(c.id); check.classList.add('on'); } } });
        g.appendChild(cell);
      });
      content.appendChild(g);
      content.appendChild(h('div', { class: 'field-hint', text: 'Выберите чаты, которые нужно показывать в этой папке.' }));

      if (folder) content.appendChild(h('div', { class: 'group', style: { marginTop: '16px', marginBottom: '30px' } },
        h('div', { class: 'cell tap danger', onClick: () => del() }, h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--danger)' }, text: 'Удалить папку' })))));

      async function save() {
        const title = nameI.value.trim(); if (!title) return UI.toast('Введите название');
        try {
          if (folder) { await App.api('DELETE', '/folders/' + folder.id); }
          await App.api('POST', '/folders', { title, emoji: '📁', includedChats: [...included] });
          UI.toast('Папка сохранена'); App.pop(); params.onSaved && params.onSaved();
        } catch (e) { UI.toast('Ошибка'); }
      }
      async function del() { await App.api('DELETE', '/folders/' + folder.id); App.pop(); params.onSaved && params.onSaved(); }
      return root;
    },
  });
})();
