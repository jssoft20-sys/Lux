/* Active sessions / Devices (Устройства). */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  App.registerScreen('devices', {
    render() {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const nav = UI.header({ onBack: () => App.pop(), title: 'Устройства', right: UI.textBtn('Изм.', () => terminateAll()) });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '6px' } });
      root.appendChild(content);

      content.appendChild(h('div', { class: 'col', style: { alignItems: 'center', padding: '20px' } },
        h('div', { style: { fontSize: '60px' }, text: '💻' }),
        h('div', { class: 'muted center', style: { marginTop: '8px', fontSize: '14px' }, html: 'Вы можете зайти в Telegram <span class="accent">для компьютера</span> или <span class="accent">браузера</span> с помощью QR-кода.' })));

      const currentWrap = h('div', {}); content.appendChild(currentWrap);
      const othersWrap = h('div', {}); content.appendChild(othersWrap);

      async function load() {
        UI.clear(currentWrap); UI.clear(othersWrap);
        const { sessions } = await App.api('GET', '/sessions');
        const current = sessions.find((s) => s.current) || sessions[0];
        const others = sessions.filter((s) => !s.current);
        if (current) {
          currentWrap.appendChild(h('div', { class: 'list-title', text: 'ЭТО УСТРОЙСТВО' }));
          currentWrap.appendChild(h('div', { class: 'group' }, sessionCell(current)));
        }
        if (others.length) {
          othersWrap.appendChild(h('div', { class: 'group', style: { marginTop: '16px' } },
            h('div', { class: 'cell tap danger', onClick: () => terminateAll() }, h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--danger)' }, text: 'Завершить все другие сеансы' })))));
          othersWrap.appendChild(h('div', { class: 'field-hint', text: 'Выйти на всех устройствах, кроме этого.' }));
          othersWrap.appendChild(h('div', { class: 'list-title', text: 'АКТИВНЫЕ СЕАНСЫ', style: { marginTop: '16px' } }));
          const g = h('div', { class: 'group' });
          others.forEach((s) => g.appendChild(sessionCell(s, true)));
          othersWrap.appendChild(g);
        } else {
          othersWrap.appendChild(h('div', { class: 'field-hint', style: { marginTop: '16px' }, text: 'Других активных сеансов нет.' }));
        }
      }

      function sessionCell(s, tappable) {
        return UI.cell({ icon: 'device', iconBg: s.current ? '#34c759' : '#5aa9e6',
          title: s.device, sub: (s.app || '') + ' · ' + (s.location || ''),
          right: s.current ? h('span', { class: 'accent', text: 'онлайн' }) : timeAgo(s.ts),
          chevron: !!tappable, onClick: tappable ? () => sessionSheet(s) : null });
      }

      function sessionSheet(s) {
        const backdrop = h('div', { class: 'modal-backdrop show' });
        const card = h('div', { style: { background: 'var(--bg-elev)', borderRadius: '16px', width: '86%', maxWidth: '380px', overflow: 'hidden', padding: '18px' } });
        card.appendChild(h('button', { class: 'nav-btn circle pill', style: { position: 'absolute', margin: '-4px' }, html: Icons.close(), onClick: () => backdrop.remove() }));
        card.appendChild(h('div', { class: 'col', style: { alignItems: 'center', gap: '4px', marginBottom: '14px' } },
          h('div', { style: { fontSize: '46px' }, text: '📱' }),
          h('div', { style: { fontSize: '20px', fontWeight: 700 }, text: s.device }),
          h('div', { class: 'muted', text: timeAgo(s.ts) })));
        card.appendChild(UI.group([
          UI.cell({ title: 'Приложение', right: s.app || 'Telegram', chevron: false }),
          UI.cell({ title: 'IP-адрес', right: s.ip || '—', chevron: false }),
          UI.cell({ title: 'Геопозиция', right: s.location || '—', chevron: false }),
        ]));
        card.appendChild(h('button', { class: 'btn danger block', style: { marginTop: '16px' }, text: 'Завершить сеанс',
          onClick: async () => { try { await App.api('DELETE', '/sessions/' + s.token); } catch (e) {} backdrop.remove(); UI.toast('Сеанс завершён'); load(); } }));
        backdrop.appendChild(card); backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
        App.el.overlayLayer.appendChild(backdrop);
      }

      async function terminateAll() {
        if (!(await UI.confirm({ title: 'Завершить все сеансы?', okLabel: 'Завершить', danger: true }))) return;
        try { await App.api('DELETE', '/sessions'); UI.toast('Все другие сеансы завершены'); } catch (e) { UI.toast('Ошибка'); }
        load();
      }
      function timeAgo(ts) { const d = Date.now() - ts; if (d < 3600000) return Math.max(1, Math.floor(d / 60000)) + ' мин назад'; if (d < 86400000) return Math.floor(d / 3600000) + ' ч назад'; return UI.dateShort(ts); }
      load();
      return root;
    },
  });
})();
