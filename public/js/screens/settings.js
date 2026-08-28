/* Settings tab. */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  App.registerScreen('settings', {
    render() {
      const me = App.state.me;
      const root = h('div', { class: 'col', style: { height: '100%' } });
      const nav = UI.header({ left: UI.textBtn('Изм.', () => App.push('editprofile')), title: 'Настройки',
        rightButtons: [UI.iconBtn('search', () => App.push('search'))] });
      root.appendChild(nav);
      const content = h('div', { class: 'content scroll' });
      root.appendChild(content);

      // profile header
      const head = h('div', { class: 'group', style: { marginTop: '4px', padding: '16px' } });
      head.appendChild(h('div', { class: 'row', style: { gap: '14px' } },
        UI.avatar(me, 70),
        h('div', {}, h('div', { style: { fontSize: '22px', fontWeight: 700 }, text: me.name + (me.lastName ? ' ' + me.lastName : '') }),
          h('div', { class: 'muted', text: me.phone || ('@' + me.username) }),
          me.username ? h('div', { class: 'muted', style: { fontSize: '14px' }, text: '@' + me.username }) : null)));
      content.appendChild(head);

      // account
      content.appendChild(section([
        cell('key', '#f0913b', 'Мой профиль', () => App.openProfile(me), me.username ? '@' + me.username : ''),
        cell('at', '#5aa9e6', 'Имя пользователя', () => App.push('editusername'), '@' + me.username),
        cell('brush', '#8db255', 'Персональные цвета', () => App.push('editprofile'), colorDot(me.color)),
        cell('star', '#a695e7', 'Telegram Premium', () => togglePremium(), me.premium ? 'Вкл.' : ''),
      ]));

      // main settings
      content.appendChild(section([
        cell('bell', '#ee6b5f', 'Уведомления и звуки', () => UI.toast('Уведомления')),
        cell('lock', '#8e8e93', 'Конфиденциальность', () => App.push('privacy')),
        cell('data', '#5aa9e6', 'Данные и память', () => UI.toast('Данные и память')),
        cell('device', '#5ac8fa', 'Устройства', () => App.push('devices')),
        cell('folder', '#5aa9e6', 'Папки с чатами', () => App.push('folders')),
      ]));

      content.appendChild(section([
        cell('brush', '#34c759', 'Оформление', () => themeSheet()),
        cell('ai', '#a695e7', 'Стикеры и эмодзи', () => UI.toast('Стикеры')),
        cell('globe', '#5aa9e6', 'Язык', () => UI.toast('Русский'), 'Русский'),
      ]));

      content.appendChild(section([
        cell('question', '#5aa9e6', 'Помощь', () => UI.toast('Telegram FAQ')),
      ]));

      content.appendChild(h('div', { class: 'group', style: { marginTop: '16px', marginBottom: '30px' } },
        h('div', { class: 'cell tap danger', onClick: () => logout() }, h('div', { class: 'cell-body' }, h('div', { class: 'cell-title', style: { color: 'var(--danger)' }, text: 'Выйти' })))));

      function section(cells) { return h('div', { class: 'group', style: { marginTop: '18px' } }, cells); }
      function cell(icon, bg, title, onClick, right) {
        return UI.cell({ icon, iconBg: bg, title, onClick, right: typeof right === 'string' ? right : right });
      }
      function colorDot(color) { return h('div', { class: 'color-dot', style: { background: color } }); }

      async function togglePremium() {
        const on = !me.premium;
        await App.api('PATCH', '/me', { premium: on }); me.premium = on;
        UI.toast(on ? 'Telegram Premium включён ✨' : 'Premium выключен');
        App.tab('settings');
      }
      function themeSheet() {
        UI.sheet({ title: 'Оформление', actions: [
          { label: 'Светлая тема', icon: 'brush', onClick: () => App.toggleTheme('light') },
          { label: 'Тёмная тема', icon: 'brush', onClick: () => App.toggleTheme('dark') },
        ] });
      }
      async function logout() {
        if (!(await UI.confirm({ title: 'Выйти?', text: 'Вы уверены, что хотите выйти?', okLabel: 'Выйти', danger: true }))) return;
        App.logout();
      }
      return root;
    },
  });

  /* ---- edit profile ---- */
  App.registerScreen('editprofile', {
    render() {
      const me = App.state.me;
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const done = UI.textBtn('Готово', save, 'title-text');
      const nav = UI.header({ left: UI.textBtn('Отмена', () => App.pop()), title: 'Профиль', right: done });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
      root.appendChild(content);
      content.appendChild(h('div', { class: 'col', style: { alignItems: 'center', padding: '10px' } }, UI.avatar(me, 96),
        h('div', { class: 'accent', style: { marginTop: '8px' }, text: 'Выбрать фотографию' })));
      const nameI = h('input', { placeholder: 'Имя', value: me.name });
      const lastI = h('input', { placeholder: 'Фамилия', value: me.lastName || '' });
      content.appendChild(h('div', { class: 'field' }, nameI, lastI));
      const bioI = h('textarea', { placeholder: 'О себе', rows: 2, value: me.bio || '' });
      content.appendChild(h('div', { class: 'list-title', text: 'О СЕБЕ' }));
      content.appendChild(h('div', { class: 'field' }, bioI));
      content.appendChild(h('div', { class: 'list-title', text: 'ПЕРСОНАЛЬНЫЕ ЦВЕТА' }));
      const picker = h('div', { class: 'color-picker' });
      let chosen = me.color;
      ['#e17076','#7bc862','#e5ca77','#65aadd','#a695e7','#ee7aae','#6ec9cb','#faa774'].forEach((c) => {
        const cp = h('div', { class: 'cp' + (c === chosen ? ' sel' : ''), style: { background: c }, onClick: () => { chosen = c; picker.querySelectorAll('.cp').forEach((x) => x.classList.remove('sel')); cp.classList.add('sel'); } });
        picker.appendChild(cp);
      });
      content.appendChild(h('div', { class: 'group' }, picker));

      async function save() {
        try {
          const { user } = await App.api('PATCH', '/me', { name: nameI.value.trim(), lastName: lastI.value.trim(), bio: bioI.value.trim(), color: chosen });
          App.state.me = user; UI.toast('Сохранено'); App.pop(); App.tab('settings');
        } catch (e) { UI.toast(e.message); }
      }
      return root;
    },
  });

  /* ---- edit username ---- */
  App.registerScreen('editusername', {
    render() {
      const me = App.state.me;
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
      const done = UI.textBtn('Готово', save, 'title-text');
      const nav = UI.header({ onBack: () => App.pop(), title: 'Имя пользователя', right: done });
      nav.classList.add('solid'); root.appendChild(nav);
      const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
      root.appendChild(content);
      const userI = h('input', { value: me.username, autocapitalize: 'off', spellcheck: false, placeholder: 'username' });
      content.appendChild(h('div', { class: 'list-title', text: 'ИМЯ ПОЛЬЗОВАТЕЛЯ' }));
      content.appendChild(h('div', { class: 'field' }, userI));
      const hint = h('div', { class: 'field-hint', html: 'Люди смогут находить вас по этому имени и писать без номера телефона.<br>Ссылка: <b>t.me/' + me.username + '</b>' });
      content.appendChild(hint);
      userI.addEventListener('input', () => { hint.innerHTML = 'Ссылка: <b>t.me/' + (userI.value.trim() || 'username') + '</b>'; });
      async function save() {
        try { const { user } = await App.api('PATCH', '/me', { username: userI.value.trim() }); App.state.me = user; UI.toast('Имя пользователя обновлено'); App.pop(); App.tab('settings'); }
        catch (e) { UI.toast(e.status === 409 ? 'Это имя занято' : (e.message || 'Ошибка')); }
      }
      return root;
    },
  });
})();
