import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet, phoneInput, normalizeDigits, haptic } from '../ui.js';

const TR = { automatic: 'Автомат', manual: 'Механика', robot: 'Робот', cvt: 'Вариатор' };
const FUEL = { petrol: 'Бензин', diesel: 'Дизель', hybrid: 'Гибрид', electric: 'Электро', gas: 'Газ' };
const DRIVE = { awd: 'Полный', front: 'Передний', rear: 'Задний' };

export default async function carView({ params, navigate, state }) {
  const car = await get('/api/cars/' + encodeURIComponent(params[0]));
  const photos = car.photos && car.photos.length ? car.photos : [];
  const o = car.occupancy || { state: 'free' };
  const d = car.discounts || {};
  const discounts = [['d3', 'от 3 дней'], ['d7', 'от 7 дней'], ['d30', 'от 30 дней']].filter(([k]) => Number(d[k]) > 0);
  const busy = (car.busy || []).filter((r) => new Date(r.end) > new Date()).slice(0, 4);
  const specs = [
    car.year && ['Год', car.year], car.engine && ['Объём', `${car.engine} л`], car.power && ['Мощность', `${car.power} л.с.`],
    car.transmission && ['КПП', TR[car.transmission] || car.transmission], car.drive && ['Привод', DRIVE[car.drive] || car.drive], car.seats && ['Мест', car.seats],
    car.fuel && ['Топливо', FUEL[car.fuel] || car.fuel], car.color && ['Цвет', car.color],
  ].filter(Boolean).slice(0, 6);
  const availHtml = car.status === 'service'
    ? `<div class="avail busy"><span class="dot"></span><div><b>На обслуживании</b><span>Бронирование временно недоступно</span></div></div>`
    : o.state === 'busy' ? `<div class="avail busy"><span class="dot"></span><div><b>Занята до ${esc(fmt.dt(o.busyUntil))}</b><span>Можно забронировать на более поздние даты</span></div></div>`
    : o.state === 'reserved' ? `<div class="avail busy"><span class="dot"></span><div><b>Бронируется</b><span>Доступна на другие даты</span></div></div>`
    : `<div class="avail"><span class="dot"></span><div><b>Свободна сейчас</b><span>${o.nextStart ? 'Ближайшая бронь с ' + esc(fmt.dt(o.nextStart)) : 'Ближайших броней нет'}</span></div></div>`;

  const view = el(`<div class="view no-tabs has-cta">
    <div class="gallery">
      <div class="track">${photos.length ? photos.map((p) => `<div class="slide"><img src="${esc(p)}" alt="${esc(car.name)}"></div>`).join('') : `<div class="slide" style="background:var(--surface)"></div>`}</div>
      ${photos.length > 1 ? `<div class="dots">${photos.map((_, i) => `<i class="${i === 0 ? 'active' : ''}"></i>`).join('')}</div>` : ''}
      <div class="float"><a class="back-btn" href="/" aria-label="Назад" data-press>${svg('back')}</a>${state.config.company.whatsapp ? `<a class="icon-btn accent" href="https://wa.me/${esc(state.config.company.whatsapp)}" target="_blank" rel="noopener" data-press>${svg('whatsapp')}</a>` : ''}</div>
    </div>
    <div class="car-title-block">
      <div class="label">${esc(car.classLabel)}</div>
      <h1 class="title">${esc(car.name)}</h1>
      <div class="rating">${svg('star')}<span>${esc(car.rating || 5)} · ${esc(car.reviewsCount || 0)} отзывов</span></div>
    </div>
    <div class="price-block reveal"><span class="big">${fmt.money(car.pricePerDay)}</span><span class="per">/ сутки</span></div>
    ${discounts.length ? `<div class="discount-chips reveal">${discounts.map(([k, l]) => `<span>−${esc(d[k])}% ${l}</span>`).join('')}</div>` : ''}
    <div class="mt reveal">${availHtml}</div>
    <div class="spec-grid reveal">${specs.map(([k, v]) => `<div class="spec"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${car.description ? `<p class="muted reveal" style="margin:4px 0 0;font-size:16px">${esc(car.description)}</p>` : ''}
    ${car.features && car.features.length ? `<h2 class="section reveal">Комплектация</h2><div class="feature-list reveal">${car.features.map((f) => `<span class="feature">${esc(f)}</span>`).join('')}</div>` : ''}
    ${busy.length ? `<h2 class="section reveal">Занятые даты</h2><div class="panel reveal" style="padding:6px 20px">${busy.map((r) => `<div class="kv"><span>${r.status === 'hold' ? 'Бронируется' : 'Занята'}</span><b>${esc(fmt.dt(r.start))} — ${esc(fmt.dt(r.end))}</b></div>`).join('')}</div>` : ''}
    ${car.deposit ? `<p class="note mt reveal">Залог ${fmt.money(car.deposit)}, возвращается при сдаче автомобиля.</p>` : ''}
    <div class="cta-bar"><div class="btn-row">
      ${car.status === 'service' ? `<button class="btn secondary" disabled>Недоступна</button>` : `<a class="btn primary" href="/car/${esc(car.slug)}/book" data-press>Арендовать</a>${state.config.site.extendEnabled !== false ? `<button class="btn secondary" id="extend" data-press style="flex:0 0 42%">Продлить</button>` : ''}`}
    </div></div>
  </div>`);

  // галерея: точки
  const track = view.querySelector('.track');
  const dots = view.querySelectorAll('.dots i');
  if (dots.length) track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / track.clientWidth); dots.forEach((x, j) => x.classList.toggle('active', j === i)); }, { passive: true });

  const ext = view.querySelector('#extend');
  if (ext) ext.addEventListener('click', () => {
    haptic();
    const body = el(`<div>
      <p class="muted" style="margin:0 0 14px">Укажите номер, на который оформлена аренда ${esc(car.name)}.</p>
      <div class="field"><label>Телефон</label><input class="input" type="tel" inputmode="tel" placeholder="+996 555 123 456" value="${esc(state.profile.phone ? fmt.phone(state.profile.phone) : '')}"></div>
      <button class="btn primary" data-press>Найти аренду</button>
    </div>`);
    const input = body.querySelector('input'); phoneInput(input);
    const btn = body.querySelector('button');
    const sheet = openSheet({ title: 'Продлить аренду', content: body });
    setTimeout(() => input.focus(), 350);
    btn.addEventListener('click', async () => {
      const phone = normalizeDigits(input.value);
      if (phone.length < 10) { input.classList.add('error'); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        const r = await post(`/api/cars/${car.id}/extend-lookup`, { phone });
        sheet.close();
        navigate('/b/' + r.token);
      } catch (err) {
        toast(err.message, 'error', 4000);
        btn.disabled = false; btn.textContent = 'Найти аренду';
      }
    });
  });
  return view;
}
