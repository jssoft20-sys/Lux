import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, phoneInput, normalizeDigits, haptic } from '../ui.js';
import { saveProfile, rememberBooking } from '../app.js';

const LABEL = { hold: ['Ожидает оплаты', 'warn'], upcoming: ['Подтверждена', 'ok'], active: ['Активна', 'ok'], finished: ['Завершается', 'gold'], completed: ['Завершена', ''], cancelled: ['Отменена', ''], expired: ['Не оплачена', 'warn'] };

export default async function profile({ state, navigate }) {
  const p = state.profile;
  const view = el(`<div class="view">
    <div class="page-head"><h1>Профиль</h1></div>
    <div class="panel reveal">
      <div class="field"><label>Имя</label><input class="input" id="name" value="${esc(p.name)}" placeholder="Ваше имя" autocomplete="name"></div>
      <div class="field" style="margin-bottom:0"><label>Телефон (WhatsApp)</label><input class="input" id="phone" type="tel" inputmode="tel" value="${esc(p.phone ? fmt.phone(p.phone) : '')}" placeholder="+996 555 123 456" autocomplete="tel"></div>
      <button class="btn secondary sm mt" id="save" data-press>Сохранить</button>
    </div>
    <h2 class="section reveal">Мои бронирования</h2>
    <div id="list" class="reveal"><div class="skeleton" style="height:90px;border-radius:20px"></div></div>
    <button class="btn ghost mt reveal" id="find" data-press>Найти бронь по номеру</button>
  </div>`);
  const $ = (s) => view.querySelector(s);
  phoneInput($('#phone'));
  $('#save').addEventListener('click', () => { const phone = normalizeDigits($('#phone').value); saveProfile({ name: $('#name').value.trim(), phone }); haptic(); toast('Сохранено', 'ok'); });

  async function renderList() {
    const tokens = state.profile.tokens || [];
    if (!tokens.length) { $('#list').innerHTML = `<div class="empty">${svg('car')}<div>Пока нет бронирований</div><a class="btn primary sm mt" href="/">Выбрать автомобиль</a></div>`; return; }
    const items = (await Promise.all(tokens.slice(0, 15).map((t) => get('/api/bookings/' + t).catch(() => null)))).filter(Boolean);
    if (!items.length) { $('#list').innerHTML = `<div class="empty">${svg('car')}<div>Пока нет бронирований</div></div>`; return; }
    items.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    $('#list').innerHTML = items.map((b) => { const [l, c] = LABEL[b.state] || LABEL[b.status] || ['', '']; return `<a class="list-item" href="/b/${esc(b.token)}" data-press><img src="${esc((b.car.photos || [])[0] || '')}" alt=""><div class="t"><b>${esc(b.car.name)}</b><span>${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))}</span></div><span class="tag ${c}">${l}</span></a>`; }).join('');
  }
  renderList();
  $('#find').addEventListener('click', async () => {
    const phone = normalizeDigits($('#phone').value);
    if (phone.length < 10) { $('#phone').classList.add('error'); toast('Укажите номер телефона', 'error'); return; }
    const btn = $('#find'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try { const r = await post('/api/extend-lookup', { phone }); r.bookings.forEach((b) => rememberBooking(b.token)); saveProfile({ phone }); await renderList(); toast(`Найдено: ${r.bookings.length}`, 'ok'); } catch (err) { toast(err.message, 'error', 4000); }
    btn.disabled = false; btn.textContent = 'Найти бронь по номеру';
  });
  return view;
}
