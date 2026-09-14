/* Вход, регистрация, восстановление пароля.

   Разметка обеих форм лежит прямо в courier.html — так экран входа появляется
   мгновенно, ещё до того как браузер разберёт модули. Здесь только поведение:
   переключение вкладок, отправка, разбор ошибок и экран «заявка на проверке».

   Ошибки сервера показываем полем, а не общим тостом: человек должен видеть,
   в какой именно строке анкеты опечатка, а не гадать по красной плашке сверху.
*/

import { api, ApiError } from '../core/api.js';
import { t, getLang, setLang, applyTo, LANGS } from '../core/i18n.js';
import { el, toast, sheet, haptic, spinner } from '../core/ui.js';
import { bindPlate } from './work.js';

const ICON_OK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 6.5 9.5 17 4 11.6"/></svg>';

const gate = document.getElementById('gate');
const forms = {
  login: document.getElementById('form-login'),
  register: document.getElementById('form-register'),
};
const tabs = Array.from(document.querySelectorAll('[data-gate-tab]'));

let authed = null;        // что вызвать, когда человек вошёл
let classesLoaded = false;

/* ─────────────────────────────────────────────────────── мелкие помощники */

function field(input) {
  return input && input.closest ? input.closest('.field') : null;
}

function clearErrors(form) {
  for (const f of form.querySelectorAll('.field--err')) f.classList.remove('field--err');
  const box = form.querySelector('.gate__err');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

/* Показать ошибку: если сервер назвал поле — подсветить его и увести туда фокус. */
function showError(form, err) {
  const box = form.querySelector('.gate__err');
  const message = (err && err.message) || t('err.unknown');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
  const name = err && err.field;
  const input = name ? form.querySelector('[name="' + name + '"]') : null;
  if (input) {
    const wrap = field(input);
    if (wrap) wrap.classList.add('field--err');
    input.focus({ preventScroll: false });
  }
  haptic([14, 60, 14]);
}

function values(form) {
  const out = {};
  for (const input of form.querySelectorAll('input, select, textarea')) {
    if (!input.name) continue;
    const raw = String(input.value || '').trim();
    if (raw) out[input.name] = raw;
  }
  return out;
}

/* Числа из анкеты приходят строками — приводим к целым, пустые выкидываем. */
function toInt(obj, keys) {
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    const n = parseInt(obj[k], 10);
    if (isFinite(n) && n > 0) obj[k] = n;
    else delete obj[k];
  }
  return obj;
}

async function submitting(form, work) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn && btn.classList.contains('is-loading')) return;
  clearErrors(form);
  spinner(btn, true);
  try {
    await work();
  } catch (e) {
    showError(form, e instanceof ApiError ? e : new ApiError('error', t('err.unknown')));
  } finally {
    spinner(btn, false);
  }
}

/* ─────────────────────────────────────────────────────── вкладки */

function openTab(name) {
  for (const tab of tabs) {
    const on = tab.dataset.gateTab === name;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const key of Object.keys(forms)) {
    if (forms[key]) forms[key].hidden = key !== name;
  }
  if (name === 'register') loadClasses();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ─────────────────────────────────────────────────────── классы машин */

/* Список классов берём из живых тарифов: курьер, выбравший класс, под который
   нет ни одного тарифа, не получит ни одного заказа — и не поймёт почему. */
async function loadClasses() {
  const select = document.getElementById('reg-class');
  if (!select || classesLoaded) return;
  classesLoaded = true;
  let config;
  try {
    config = await api.get('/config', null, { auth: false });
  } catch (e) {
    classesLoaded = false;                 // сеть вернётся — попробуем ещё раз
    return;
  }
  const lang = getLang();
  const seen = new Map();
  for (const tariff of config.tariffs || []) {
    const code = tariff.vehicle_class;
    if (!code || seen.has(code)) continue;
    const name = (lang === 'ky' ? tariff.name_ky : tariff.name_ru) || code;
    const kg = tariff.capacity_kg ? ' · до ' + tariff.capacity_kg + ' ' + t('common.kg') : '';
    seen.set(code, name + kg);
  }
  if (!seen.size) return;
  const keep = select.value;
  select.replaceChildren(el('option', { value: '' }, t('order.tariff_choose')));
  for (const [code, label] of seen) select.appendChild(el('option', { value: code }, label));
  if (keep && seen.has(keep)) select.value = keep;
}

/* ─────────────────────────────────────────────────────── экраны-сообщения */

/* «Заявка принята» и «доступ закрыт» заменяют собой обе формы: отсюда
   человек всё равно никуда не пойдёт, пока с ним не свяжутся. */
function showNotice(title, text, extra) {
  const box = el('div', { className: 'gate__done' },
    el('div', { className: 'gate__done-mark', html: ICON_OK }),
    el('h2', { className: 'gate__title' }, title),
    el('p', { className: 'gate__sub' }, text),
    extra || null,
    el('button', {
      className: 'btn btn--ghost btn--block',
      type: 'button',
      style: { marginTop: 'var(--sp-4)' },
      onClick: () => location.reload(),
    }, t('courier.login')));

  const tabsBox = gate.querySelector('.gate__tabs');
  if (tabsBox) tabsBox.hidden = true;
  for (const key of Object.keys(forms)) {
    if (forms[key]) forms[key].hidden = true;
  }
  const old = gate.querySelector('.gate__done');
  if (old) old.remove();
  const foot = gate.querySelector('.gate__foot');
  gate.insertBefore(box, foot);
}

/* ─────────────────────────────────────────────────────── вход */

function bindLogin() {
  const form = forms.login;
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = values(form);
    if (!data.email) return showError(form, { message: t('err.bad_email'), field: 'email' });
    if (!data.password) return showError(form, { message: t('err.bad_password'), field: 'password' });

    submitting(form, async () => {
      const res = await api.post('/auth/login',
        { email: data.email, password: data.password }, { auth: false });
      api.setToken(res.token);
      form.reset();
      haptic(20);
      if (authed) authed(res.user);
    });
  });

  const forgot = document.getElementById('forgot');
  if (forgot) forgot.addEventListener('click', () => askEmail(form));
}

/* ─────────────────────────────────────────────────────── восстановление пароля */

function askEmail(loginForm) {
  const input = el('input', {
    className: 'field__input',
    type: 'email',
    inputMode: 'email',
    autocomplete: 'username',
    placeholder: ' ',
    value: (loginForm.querySelector('[name="email"]') || {}).value || '',
  });
  const wrap = el('label', { className: 'field' },
    input, el('span', { className: 'field__label' }, t('courier.email')));

  const box = sheet({
    title: t('courier.forgot_title'),
    content: el('div', { className: 'col gap-3' },
      el('p', { className: 'sheet__text' }, t('courier.forgot_hint')), wrap),
    actions: [
      { label: t('common.cancel'), kind: 'ghost' },
      {
        label: t('common.send'),
        kind: 'primary',
        onClick: async () => {
          const email = String(input.value || '').trim();
          if (!email || email.indexOf('@') < 1) {
            toast(t('err.bad_email'), { type: 'err' });
            input.focus();
            return false;
          }
          const res = await api.post('/auth/password/forgot', { email }, { auth: false });
          toast(res.message || t('courier.forgot_sent'), { type: 'ok', ms: 5000 });
          return true;
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 260);
  return box;
}

/* Ссылка из письма приходит как /courier?reset=токен. Проверяем её до того,
   как показать форму: человек не должен придумывать пароль ради «ссылка устарела». */
async function handleResetLink() {
  const params = new URLSearchParams(location.search);
  const token = (params.get('reset') || '').trim();
  if (!token) return false;

  // Токен из адресной строки убираем сразу: он одноразовый, но светиться
  // в истории браузера и в заголовке Referer ему всё равно незачем.
  try {
    const clean = location.pathname + location.hash;
    history.replaceState(history.state, '', clean);
  } catch (e) { /* встроенный браузер может запретить — не страшно */ }

  try {
    await api.get('/auth/password/check', { token }, { auth: false });
  } catch (e) {
    toast((e && e.message) || t('err.reset_expired'), { type: 'err', ms: 5000 });
    return false;
  }
  showResetForm(token);
  return true;
}

function showResetForm(token) {
  const input = el('input', {
    className: 'field__input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: ' ',
  });
  const wrap = el('label', { className: 'field' },
    input,
    el('span', { className: 'field__label' }, t('courier.password')),
    el('span', { className: 'field__hint' }, 'Не короче восьми символов'));

  sheet({
    title: t('courier.reset_title'),
    dismissible: false,
    content: wrap,
    actions: [{
      label: t('courier.reset_btn'),
      kind: 'primary',
      onClick: async () => {
        const password = String(input.value || '');
        if (password.length < 8) {
          toast(t('err.password_short'), { type: 'err' });
          input.focus();
          return false;
        }
        const res = await api.post('/auth/password/reset', { token, password }, { auth: false });
        if (res.token) {
          api.setToken(res.token);
          toast(res.message || t('common.saved'), { type: 'ok' });
          if (authed) authed(res.user);
        } else {
          toast(res.message || t('common.saved'), { type: 'ok', ms: 5000 });
        }
        return true;
      },
    }],
  });
  setTimeout(() => input.focus(), 260);
}

/* ─────────────────────────────────────────────────────── регистрация */

function bindRegister() {
  const form = forms.register;
  if (!form) return;

  // Госномер сразу приводим к виду, в котором он живёт в базе.
  bindPlate(form.querySelector('[name="car_plate"]'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = toInt(values(form), ['capacity_kg', 'body_w', 'body_d', 'body_h']);

    const need = [
      ['name', t('err.field_required')],
      ['email', t('err.bad_email')],
      ['phone', t('err.bad_phone')],
      ['password', t('err.bad_password')],
      ['vehicle_class', t('order.need_tariff')],
      ['car_model', t('err.field_required')],
      ['car_plate', t('err.field_required')],
      ['capacity_kg', t('err.field_required')],
    ];
    for (const [key, message] of need) {
      if (!data[key]) return showError(form, { message, field: key });
    }
    if (String(data.password).length < 8) {
      return showError(form, { message: t('err.password_short'), field: 'password' });
    }
    data.lang = getLang();

    submitting(form, async () => {
      const res = await api.post('/auth/register', data, { auth: false });
      form.reset();
      haptic([16, 70, 16]);
      if (res.token) {
        api.setToken(res.token);
        if (authed) authed(res.user);
        return;
      }
      showNotice(
        t('courier.pending_title'),
        res.message || t('courier.pending_text'),
        el('p', { className: 'gate__hint ta-c', style: { marginTop: 'var(--sp-2)' } },
          data.email),
      );
    });
  });
}

/* ─────────────────────────────────────────────────────── глаз у пароля */

function bindEyes() {
  for (const btn of document.querySelectorAll('[data-eye]')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      input.focus();
    });
  }
}

/* ─────────────────────────────────────────────────────── язык */

function bindLang() {
  const buttons = Array.from(document.querySelectorAll('[data-lang]'));
  const paint = () => {
    const now = getLang();
    for (const b of buttons) b.classList.toggle('is-on', b.dataset.lang === now);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (LANGS.indexOf(b.dataset.lang) < 0) return;
      setLang(b.dataset.lang);
      paint();
      classesLoaded = false;               // названия классов машин тоже переводятся
      if (forms.register && !forms.register.hidden) loadClasses();
      haptic();
    });
  }
  paint();
}

/* ─────────────────────────────────────────────────────── наружу */

/** Подготовить экран входа. onAuthed(user) вызывается, когда человек вошёл. */
export function initGate(opts = {}) {
  authed = typeof opts.onAuthed === 'function' ? opts.onAuthed : null;

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      openTab(tab.dataset.gateTab);
      haptic();
    });
  }
  bindLogin();
  bindRegister();
  bindEyes();
  bindLang();
  applyTo(gate);
  handleResetLink();
  return { open: openTab };
}

/** Показать вход: после выхода из аккаунта и когда сессия протухла. */
export function showGate(message) {
  document.documentElement.dataset.screen = 'gate';
  const tabsBox = gate.querySelector('.gate__tabs');
  if (tabsBox) tabsBox.hidden = false;
  const done = gate.querySelector('.gate__done');
  if (done) done.remove();
  openTab('login');
  applyTo(gate);
  if (message) toast(message, { type: 'info', ms: 4000 });
}

/** Спрятать вход и отдать экран рабочему приложению. */
export function hideGate() {
  document.documentElement.dataset.screen = 'app';
}

/** Человек прошёл модерацию не до конца — показываем, что его ждёт. */
export function showStatusNotice(status, message) {
  document.documentElement.dataset.screen = 'gate';
  if (status === 'blocked') {
    showNotice(t('courier.blocked_title'), message || t('courier.blocked_text'));
  } else {
    showNotice(t('courier.pending_title'), message || t('courier.pending_text'));
  }
}

export default { initGate, showGate, hideGate, showStatusNotice };
