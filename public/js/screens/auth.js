/* Auth screen: login / register. */
(function () {
  const UI = window.UI, h = UI.h;

  App.registerScreen('auth', {
    render() {
      let mode = 'login';
      const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)', overflow: 'auto' } });
      const wrap = h('div', { class: 'col', style: { alignItems: 'center', padding: '40px 24px', gap: '10px', minHeight: '100%' } });
      root.appendChild(wrap);

      wrap.appendChild(h('div', { html: '<svg viewBox="0 0 64 64" width="88" height="88"><circle cx="32" cy="32" r="32" fill="#29a9eb"/><path d="M14 31l34-13-6 30-9-7-5 5-2-8z" fill="#fff"/></svg>' }));
      const title = h('div', { style: { fontSize: '26px', fontWeight: 700, marginTop: '6px' }, text: 'Telegram' });
      const sub = h('div', { class: 'muted', style: { fontSize: '15px', textAlign: 'center', marginBottom: '16px' }, text: 'Быстрый и безопасный мессенджер' });
      wrap.appendChild(title); wrap.appendChild(sub);

      const form = h('div', { class: 'col', style: { width: '100%', maxWidth: '360px', gap: '10px' } });
      wrap.appendChild(form);

      const nameI = inp('Имя');
      const lastI = inp('Фамилия (необязательно)');
      const userI = inp('Имя пользователя (@username)');
      const phoneI = inp('Телефон (необязательно)'); phoneI.type = 'tel';
      const passI = inp('Пароль'); passI.type = 'password';
      const errBox = h('div', { class: 'danger-text', style: { fontSize: '14px', minHeight: '18px', textAlign: 'center' } });
      const submitBtn = h('button', { class: 'btn block', style: { marginTop: '6px' } });
      const toggle = h('button', { class: 'btn ghost block' });

      function field(input) { return h('div', { class: 'field', style: { margin: 0 } }, input); }

      function render() {
        UI.clear(form);
        if (mode === 'register') {
          form.appendChild(field(nameI)); form.appendChild(field(lastI));
          form.appendChild(field(userI)); form.appendChild(field(phoneI)); form.appendChild(field(passI));
          submitBtn.textContent = 'Создать аккаунт';
          toggle.textContent = 'У меня уже есть аккаунт';
        } else {
          form.appendChild(field(userI)); form.appendChild(field(passI));
          submitBtn.textContent = 'Войти';
          toggle.textContent = 'Создать новый аккаунт';
        }
        form.appendChild(errBox); form.appendChild(submitBtn); form.appendChild(toggle);
        if (mode === 'login') {
          form.appendChild(h('div', { class: 'muted', style: { fontSize: '13px', textAlign: 'center', marginTop: '14px', lineHeight: 1.5 },
            html: 'Демо-аккаунты:<br><b>alice</b> / demo · <b>boris</b> / demo · <b>chloe</b> / demo' }));
        }
      }

      submitBtn.onclick = async () => {
        errBox.textContent = '';
        try {
          if (mode === 'login') {
            const { token, user } = await App.api('POST', '/auth/login', { username: userI.value.trim(), password: passI.value });
            await App.afterLogin(token, user);
          } else {
            const { token, user } = await App.api('POST', '/auth/register', {
              name: nameI.value.trim(), lastName: lastI.value.trim(), username: userI.value.trim(),
              phone: phoneI.value.trim(), password: passI.value });
            await App.afterLogin(token, user);
          }
        } catch (e) { errBox.textContent = e.message || 'Ошибка'; }
      };
      passI.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
      toggle.onclick = () => { mode = mode === 'login' ? 'register' : 'login'; errBox.textContent = ''; render(); };

      render();
      return root;

      function inp(placeholder) { return h('input', { placeholder, autocapitalize: 'off', autocomplete: 'off', spellcheck: false }); }
    },
  });
})();
