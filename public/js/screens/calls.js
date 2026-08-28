/* Calls tab — recent calls list + start a new call. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  function dirIcon(call) {
    if (call.status === 'missed' || call.status === 'declined') return h('span', { class: 'dir-missed', style: { width: '16px', display: 'inline-flex' }, html: arrow(true) });
    return call.out ? h('span', { class: 'dir-out', style: { width: '16px', display: 'inline-flex' }, html: arrow(true) })
                    : h('span', { class: 'dir-in', style: { width: '16px', display: 'inline-flex' }, html: arrow(false) });
  }
  function arrow(out) { return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="' + (out ? 'M7 17L17 7M17 7H9M17 7v8' : 'M17 7L7 17M7 17h8M7 17V9') + '"/></svg>'; }

  function callLabel(call) {
    if (call.status === 'missed') return 'Пропущенный';
    if (call.status === 'declined') return 'Отклонён';
    const dir = call.out ? 'Исходящий' : 'Входящий';
    return call.duration ? dir + ' (' + UI.duration(call.duration) + ')' : dir;
  }

  function callItem(call) {
    const row = h('div', { class: 'call-item' });
    row.appendChild(UI.avatar(call.peer, 44));
    const name = h('div', { class: 'ci-name' + ((call.status === 'missed' || call.status === 'declined') ? ' missed' : '') },
      h('span', { text: call.peer.name + (call.peer.lastName ? ' ' + call.peer.lastName : '') }));
    if (call.video) name.appendChild(h('span', { style: { width: '16px', color: 'var(--text-2)' }, html: Icons.video() }));
    const dir = h('div', { class: 'ci-dir' }, dirIcon(call), h('span', { text: callLabel(call) }));
    row.appendChild(h('div', { class: 'ci-body', onClick: () => startCall(call.peer, call.video) }, name, dir));
    row.appendChild(h('div', { class: 'ci-time', text: UI.dateShort(call.ts) }));
    row.appendChild(h('button', { class: 'info-btn nav-btn circle', html: Icons.question().replace(/#fff/g, 'currentColor'), onClick: () => App.openProfile(call.peer) }));
    return row;
  }

  function startCall(peer, video) {
    if (!window.WebRTC) return UI.toast('Звонки недоступны');
    window.WebRTC.call(peer, !!video);
  }

  function newCallPicker() {
    App.api('GET', '/directory').then(({ users }) => {
      UI.sheet({ title: 'Кому позвонить', actions: (users || []).slice(0, 10).map((u) => ({
        label: u.name + (u.lastName ? ' ' + u.lastName : ''), icon: 'phone', onClick: () => startCall(u, false) })) });
    });
  }

  App.registerScreen('calls', {
    render() {
      let filter = 'all';
      const root = h('div', { class: 'col', style: { height: '100%' } });
      const segToggle = h('div', { class: 'seg-toggle' },
        h('button', { class: 'active', text: 'Все', onClick: (e) => setFilter('all', e) }),
        h('button', { text: 'Пропущ.', onClick: (e) => setFilter('missed', e) }));
      const nav = UI.header({ left: UI.textBtn('Изм.', () => UI.toast('Очистить историю звонков')), titleEl: segToggle });
      root.appendChild(nav);
      const content = h('div', { class: 'content scroll' });
      root.appendChild(content);

      content.appendChild(h('div', { class: 'group', style: { marginTop: '4px' } },
        h('div', { class: 'cell tap', onClick: newCallPicker },
          h('div', { class: 'ic-box', style: { background: 'transparent', color: 'var(--accent)' }, html: Icons.call() }),
          h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--accent)' }, text: 'Новый звонок' })))));

      const listWrap = h('div', { class: 'list' });
      content.appendChild(h('div', { class: 'list-title', text: 'НЕДАВНИЕ ЗВОНКИ', style: { marginTop: '14px' } }));
      content.appendChild(listWrap);

      function setFilter(f, e) { filter = f; segToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.textContent === (f === 'all' ? 'Все' : 'Пропущ.'))); load(); }

      async function load() {
        UI.clear(listWrap);
        try {
          let { calls } = await App.api('GET', '/calls');
          if (filter === 'missed') calls = calls.filter((c) => c.status === 'missed' || c.status === 'declined');
          if (!calls.length) { listWrap.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'em', text: '📞' }), h('div', { text: 'Нет звонков' }))); return; }
          const g = h('div', { class: 'group full' });
          calls.forEach((c) => g.appendChild(callItem(c)));
          listWrap.appendChild(g);
        } catch (e) { listWrap.appendChild(h('div', { class: 'empty-state', text: 'Ошибка' })); }
      }
      load();
      return root;
    },
  });
})();
