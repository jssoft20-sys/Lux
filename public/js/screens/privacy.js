/* Privacy settings screen (Конфиденциальность). */
(function () {
  const UI = window.UI, h = UI.h;

  const OPTIONS = { everybody: 'Все', contacts: 'Контакты', nobody: 'Никто' };
  const ROWS = [
    { key: 'phone', label: 'Номер телефона' },
    { key: 'lastSeen', label: 'Время захода' },
    { key: 'profilePhoto', label: 'Фотографии профиля' },
    { key: 'bio', label: 'Раздел «О себе»' },
    { key: 'gifts', label: 'Подарки' },
    { key: 'birthday', label: 'День рождения' },
    { key: 'savedMusic', label: 'Сохранённая музыка' },
    { key: 'forwards', label: 'Пересылка сообщений' },
    { key: 'calls', label: 'Звонки' },
    { key: 'voiceMessages', label: 'Голосовые сообщения', premium: true },
    { key: 'messages', label: 'Сообщения', premium: true },
    { key: 'invites', label: 'Приглашения' },
  ];

  App.registerScreen('privacy', {
    render() {
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const nav = UI.header({ onBack: () => App.pop(), title: 'Конфиденциальность' });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '6px' } });
      root.appendChild(content);

      const privacy = Object.assign({}, App.state.me.privacy || {});

      content.appendChild(section([
        UI.cell({ icon: 'at', iconBg: '#8e8e93', title: 'Почта для входа', onClick: () => UI.toast('E-mail для входа') }),
      ]));
      content.appendChild(h('div', { class: 'field-hint', text: 'Укажите адрес электронной почты для отправки проверочных кодов Telegram.' }));

      content.appendChild(h('div', { class: 'list-title', text: 'КОНФИДЕНЦИАЛЬНОСТЬ', style: { marginTop: '16px' } }));
      const group = h('div', { class: 'group' });
      ROWS.forEach((r) => {
        const val = privacy[r.key] || 'everybody';
        const cell = UI.cell({ titleHTML: r.label + (r.premium ? ' <span style="width:16px;display:inline-block;vertical-align:-3px">' + (window.Icons.premiumStar()) + '</span>' : ''),
          title: r.label, right: OPTIONS[val], onClick: () => pick(r, cell) });
        cell._key = r.key;
        group.appendChild(cell);
      });
      content.appendChild(group);
      content.appendChild(h('div', { class: 'field-hint', text: 'Вы можете выбрать, кому разрешаете видеть ваши данные и писать вам.' }));

      content.appendChild(h('div', { class: 'list-title', text: 'БЕЗОПАСНОСТЬ', style: { marginTop: '16px' } }));
      content.appendChild(section([
        UI.cell({ icon: 'lock', iconBg: '#5aa9e6', title: 'Код-пароль', right: 'Выкл.', onClick: () => UI.toast('Код-пароль') }),
        UI.cell({ icon: 'key', iconBg: '#34c759', title: 'Двухэтапная аутентификация', onClick: () => UI.toast('2FA') }),
        UI.cell({ icon: 'device', iconBg: '#8e8e93', title: 'Активные сеансы', onClick: () => App.push('devices') }),
      ]));

      content.appendChild(h('div', { class: 'group', style: { marginTop: '20px', marginBottom: '30px' } },
        h('div', { class: 'cell tap danger', onClick: () => UI.toast('Автоудаление аккаунта') },
          h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--danger)' }, text: 'Если не захожу…' }),
            h('div', { class: 'cell-sub', text: 'Удалить аккаунт через 6 месяцев' })))));

      function section(cells) { return h('div', { class: 'group' }, cells); }
      function pick(r, cell) {
        UI.sheet({ title: r.label, actions: Object.entries(OPTIONS).map(([k, v]) => ({ label: v, onClick: () => save(r.key, k, cell) })) });
      }
      async function save(key, value, cell) {
        privacy[key] = value;
        const valSpan = cell.querySelector('.cell-right span');
        if (valSpan) valSpan.textContent = OPTIONS[value];
        try { await App.api('PATCH', '/me/privacy', { [key]: value }); App.state.me.privacy = privacy; } catch (e) { UI.toast('Ошибка'); }
      }
      return root;
    },
  });
})();
