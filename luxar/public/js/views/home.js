import { el, esc, fmt, svg, lazyImages, reveal, toast } from '../ui.js';
import { loadCars } from '../app.js';

const CLASS_ORDER = ['city', 'comfort', 'business', 'executive', 'suv', 'premium'];
const CLASS_NAMES = { city: 'City', comfort: 'Comfort', business: 'Business', executive: 'Executive', suv: 'SUV', premium: 'Premium', sport: 'Sport', minivan: 'Minivan' };

function statusBadge(car) {
  const o = car.occupancy || { state: 'free' };
  if (car.status === 'service') return `<div class="status-badge busy"><i></i>На обслуживании</div>`;
  if (o.state === 'busy') return `<div class="status-badge busy"><i></i>Занята до ${esc(fmt.dt(o.busyUntil))}</div>`;
  if (o.state === 'reserved') return `<div class="status-badge soon"><i></i>Бронируется</div>`;
  if (o.nextStart) return `<div class="status-badge"><i></i>Свободна до ${esc(fmt.d(o.nextStart))}</div>`;
  return `<div class="status-badge"><i></i>Свободна</div>`;
}

export function carCard(car, i = 0) {
  const photo = (car.photos || [])[0] || '';
  return `<a class="car-card reveal" href="/car/${esc(car.slug)}" data-press style="--d:${(i % 4) * 70}ms">
    <div class="bg">${photo ? `<img data-src="${esc(photo)}" alt="${esc(car.name)}" loading="lazy">` : ''}</div>
    <div class="inner">
      <div class="label">${esc(car.classLabel)}</div>
      <div class="name">${esc(car.name)}</div>
      ${car.description ? `<div class="desc">${esc(car.description)}</div>` : ''}
      <div class="pill price">от ${fmt.money(car.pricePerDay)}/сутки</div>
      <div class="bottom">
        <div class="rating">${svg('star')}<span>${car.rating ? esc(car.rating) : '5'} · отзывы</span></div>
        <div class="arrow-btn">${svg('arrow')}</div>
      </div>
    </div>
    ${statusBadge(car)}
  </a>`;
}

export default async function home({ state }) {
  const c = state.config;
  const wa = c.company && c.company.whatsapp;
  const view = el(`<div class="view">
    <header class="topbar">
      <a class="brand" href="/"><img src="/assets/logo-mark.svg" alt=""><div class="brand-text"><b>LUXAR</b><span>AUTORENT</span></div></a>
      ${wa ? `<a class="icon-btn accent" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp" data-press>${svg('whatsapp')}</a>` : ''}
    </header>
    <div class="chips" id="filters"></div>
    <div class="card-list" id="list"><div class="skeleton"></div><div class="skeleton"></div></div>
  </div>`);
  let filter = sessionStorage.getItem('luxar.filter') || 'all';
  let cars = [];
  const list = view.querySelector('#list');
  const filters = view.querySelector('#filters');

  function renderFilters() {
    const classes = [...new Set(cars.map((x) => x.class))].sort((a, b) => (CLASS_ORDER.indexOf(a) + 100) % 100 - (CLASS_ORDER.indexOf(b) + 100) % 100);
    if (classes.length < 2) { filters.remove(); return; }
    if (!classes.includes(filter)) filter = 'all';
    filters.innerHTML = [`<button class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">Все</button>`, ...classes.map((k) => `<button class="chip ${filter === k ? 'active' : ''}" data-f="${k}">${CLASS_NAMES[k] || k}</button>`)].join('');
    filters.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; sessionStorage.setItem('luxar.filter', filter); renderFilters(); renderList(); }));
  }
  function renderList() {
    const items = cars.filter((x) => filter === 'all' || x.class === filter);
    list.innerHTML = items.length ? items.map(carCard).join('') : `<div class="empty">${svg('car')}<div>Автомобили скоро появятся</div></div>`;
    lazyImages(list); reveal(list);
  }
  try {
    cars = await loadCars();
    renderFilters(); renderList();
  } catch (err) {
    list.innerHTML = `<div class="empty">${svg('info')}<div>${esc(err.message)}</div></div>`;
  }
  return view;
}
