import { get } from '../api.js';
import { el, esc, fmt, svg, haptic } from '../ui.js';
import { rememberBooking } from '../app.js';

export default async function done({ params, query }) {
  const b = await get('/api/bookings/' + params[0]);
  rememberBooking(b.token);
  const ext = query.get('kind') === 'extension';
  haptic(15);
  const photo = (b.car.photos || [])[0] || '';
  return el(`<div class="view no-tabs">
    <div class="hero-logo"><img src="/assets/logo.svg" alt="Luxar Autorent"></div>
    <svg class="check-ring" viewBox="0 0 150 150"><circle cx="75" cy="75" r="70"/><path d="M50 78l16 16 34-36"/></svg>
    <h1 class="success-title">${ext ? 'Продление' : 'Бронирование'}<span>подтверждено</span></h1>
    <p class="muted center" style="margin:16px 20px 0;font-size:17px">${ext ? `${esc(b.car.name)} теперь до ${esc(fmt.dt(b.endAt))}.` : 'Спасибо за выбор Luxar. Мы подготовим автомобиль к поездке.'}</p>
    ${photo ? `<div class="success-photo reveal"><img src="${esc(photo)}" alt="${esc(b.car.name)}"></div>` : ''}
    <div class="panel reveal">
      <div class="label" style="margin-bottom:10px">Детали бронирования</div>
      <h3>${esc(b.car.name)}</h3>
      <div class="muted" style="font-size:17px">${esc(fmt.t(b.startAt))} · ${b.pickup === 'delivery' ? 'Доставка' : 'Самовывоз'}</div>
      <div class="muted small mt">${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))} · ${esc(b.code)}</div>
      <div class="mt" style="font-size:17px;font-weight:700">Статус: <span class="status-ok">подтверждено</span></div>
    </div>
    <a class="btn primary mt2" href="/" data-press>Вернуться на главную</a>
    <a class="btn ghost mt" href="/b/${esc(b.token)}" data-press>Моя бронь</a>
  </div>`);
}
