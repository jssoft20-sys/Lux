import { post } from '../api.js';
import { el, toast } from '/js/ui.js';

export default async function login({ navigate, state }) {
  const view = el(`<div class="login-wrap"><div class="login-box">
    <img src="/assets/logo.svg" alt="Luxar">
    <div class="field"><label>Логин</label><input class="input" id="login" autocomplete="username" autocapitalize="off"></div>
    <div class="field"><label>Пароль</label><input class="input" id="password" type="password" autocomplete="current-password"></div>
    <button class="btn primary" id="go" data-press>Войти</button>
    <div id="err" class="error-text center mt hidden"></div>
  </div></div>`);
  const go = async () => {
    const btn = view.querySelector('#go'); btn.disabled = true;
    try {
      const r = await post('/api/admin/login', { login: view.querySelector('#login').value.trim(), password: view.querySelector('#password').value });
      state.me = { login: r.login, defaultPassword: r.defaultPassword };
      navigate(location.pathname.startsWith('/admin') ? location.pathname : '/admin', { replace: true });
    } catch (err) { const e = view.querySelector('#err'); e.textContent = err.message; e.classList.remove('hidden'); btn.disabled = false; }
  };
  view.querySelector('#go').addEventListener('click', go);
  view.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  setTimeout(() => view.querySelector('#login').focus(), 200);
  return view;
}
