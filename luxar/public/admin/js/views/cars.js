import { get, post, put, del, upload } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet, haptic } from '/js/ui.js';
import { loadCars, confirmSheet } from '../app.js';

const CLASSES = [['city', 'City'], ['business', 'Business'], ['executive', 'Executive'], ['comfort', 'Comfort'], ['suv', 'SUV'], ['premium', 'Premium'], ['sport', 'Sport'], ['minivan', 'Minivan']];
const TR = [['automatic', 'Автомат'], ['manual', 'Механика'], ['robot', 'Робот'], ['cvt', 'Вариатор']];
const FUEL = [['petrol', 'Бензин'], ['diesel', 'Дизель'], ['hybrid', 'Гибрид'], ['electric', 'Электро'], ['gas', 'Газ']];
const DRIVE = [['awd', 'Полный'], ['front', 'Передний'], ['rear', 'Задний']];
const STATUSES = [['active', 'В работе'], ['service', 'На обслуживании'], ['hidden', 'Скрыт с сайта']];
const sel = (opts, v) => opts.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');

async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob ? new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

export function carForm(car, { onSaved, navigate }) {
  const c = car || { discounts: { d3: 5, d7: 10, d30: 20 }, photos: [], features: [], status: 'active', class: 'business', transmission: 'automatic', fuel: 'petrol', drive: 'awd', seats: 5, minDays: 1, rating: 5, reviewsCount: 0 };
  const d = c.discounts || {};
  const body = el(`<div>
    <div class="form-grid">
      <div class="field full"><label>Название на сайте</label><input class="input" name="name" value="${esc(c.name || '')}" placeholder="BMW X5"></div>
      <div class="field"><label>Класс</label><div class="select-wrap"><select class="select" name="class">${sel(CLASSES, c.class)}</select></div></div>
      <div class="field"><label>Цена за сутки, $</label><input class="input" name="pricePerDay" type="number" inputmode="decimal" value="${esc(c.pricePerDay ?? '')}"></div>
      <div class="field"><label>Залог, $</label><input class="input" name="deposit" type="number" inputmode="decimal" value="${esc(c.deposit ?? 0)}"></div>
      <div class="field"><label>Скидка от 3 дн., %</label><input class="input" name="d3" type="number" inputmode="numeric" value="${esc(d.d3 ?? 0)}"></div>
      <div class="field"><label>от 7 дн., %</label><input class="input" name="d7" type="number" inputmode="numeric" value="${esc(d.d7 ?? 0)}"></div>
      <div class="field"><label>от 30 дн., %</label><input class="input" name="d30" type="number" inputmode="numeric" value="${esc(d.d30 ?? 0)}"></div>
      <div class="field"><label>Год</label><input class="input" name="year" type="number" inputmode="numeric" value="${esc(c.year ?? '')}"></div>
      <div class="field"><label>Объём, л</label><input class="input" name="engine" value="${esc(c.engine || '')}" placeholder="3.0"></div>
      <div class="field"><label>Мощность, л.с.</label><input class="input" name="power" type="number" inputmode="numeric" value="${esc(c.power ?? '')}"></div>
      <div class="field"><label>КПП</label><div class="select-wrap"><select class="select" name="transmission">${sel(TR, c.transmission)}</select></div></div>
      <div class="field"><label>Топливо</label><div class="select-wrap"><select class="select" name="fuel">${sel(FUEL, c.fuel)}</select></div></div>
      <div class="field"><label>Привод</label><div class="select-wrap"><select class="select" name="drive">${sel(DRIVE, c.drive)}</select></div></div>
      <div class="field"><label>Мест</label><input class="input" name="seats" type="number" inputmode="numeric" value="${esc(c.seats ?? 5)}"></div>
      <div class="field"><label>Цвет</label><input class="input" name="color" value="${esc(c.color || '')}"></div>
      <div class="field"><label>Госномер</label><input class="input" name="plate" value="${esc(c.plate || '')}" placeholder="01KG123ABC"></div>
      <div class="field"><label>Мин. срок, дней</label><input class="input" name="minDays" type="number" inputmode="numeric" value="${esc(c.minDays ?? 1)}"></div>
      <div class="field"><label>Рейтинг</label><input class="input" name="rating" type="number" step="0.1" inputmode="decimal" value="${esc(c.rating ?? 5)}"></div>
      <div class="field"><label>Отзывов</label><input class="input" name="reviewsCount" type="number" inputmode="numeric" value="${esc(c.reviewsCount ?? 0)}"></div>
      <div class="field"><label>Статус</label><div class="select-wrap"><select class="select" name="status">${sel(STATUSES, c.status)}</select></div></div>
      <div class="field full"><label>Описание (одна строка на карточке)</label><input class="input" name="description" value="${esc(c.description || '')}" placeholder="Премиальный SUV для города и гор"></div>
      <div class="field full"><label>Комплектация (через запятую)</label><input class="input" name="features" value="${esc((c.features || []).join(', '))}"></div>
      <div class="field full"><label>Заметка для себя</label><input class="input" name="note" value="${esc(c.note || '')}" placeholder="Страховка до…, ТО…"></div>
    </div>
    <label style="font-size:13px;font-weight:700;color:var(--text-2)">Фото</label>
    <div class="photo-grid" id="photos"></div>
    <input type="file" id="file" accept="image/*" multiple class="hidden">
    <div class="btn-row"><button class="btn primary" id="save" data-press>Сохранить</button>${c.id ? `<button class="btn danger" id="delete" data-press style="flex:0 0 30%">Удалить</button>` : ''}</div>
  </div>`);
  let photos = [...(c.photos || [])];
  let id = c.id || null;
  const renderPhotos = () => {
    body.querySelector('#photos').innerHTML = photos.map((p, i) => `<div class="photo"><img src="${esc(p)}" alt="">${i === 0 ? '<span class="main">Главное</span>' : `<button class="set" data-main="${i}">Сделать главным</button>`}<button class="x" data-del="${i}">${svg('close')}</button></div>`).join('') + `<div class="photo add" id="add">${svg('plus')}<span>Добавить</span></div>`;
    body.querySelector('#add').addEventListener('click', () => body.querySelector('#file').click());
    body.querySelectorAll('[data-main]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.main; photos.unshift(photos.splice(i, 1)[0]); renderPhotos(); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { const i = +b.dataset.del; const url = photos[i]; photos.splice(i, 1); renderPhotos(); if (id) { try { await del(`/api/admin/cars/${id}/photos`, { url }); } catch {} } }));
  };
  renderPhotos();
  const collect = () => {
    const f = (n) => body.querySelector(`[name="${n}"]`).value;
    return { name: f('name'), class: f('class'), pricePerDay: f('pricePerDay'), deposit: f('deposit'), discounts: { d3: f('d3'), d7: f('d7'), d30: f('d30') }, year: f('year'), engine: f('engine'), power: f('power'), transmission: f('transmission'), fuel: f('fuel'), drive: f('drive'), seats: f('seats'), color: f('color'), plate: f('plate'), minDays: f('minDays'), rating: f('rating'), reviewsCount: f('reviewsCount'), status: f('status'), description: f('description'), features: f('features'), note: f('note'), photos };
  };
  const ensureSaved = async () => { if (id) return id; const created = await post('/api/admin/cars', collect()); id = created.id; return id; };
  body.querySelector('#file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    toast(`Загружаем ${files.length} фото…`);
    try {
      const carId = await ensureSaved();
      const fd = new FormData();
      for (const f of files.slice(0, 12)) fd.append('photos', await resizeImage(f));
      const r = await upload(`/api/admin/cars/${carId}/photos`, fd);
      photos = r.photos; renderPhotos(); toast('Фото загружены', 'ok');
    } catch (err) { toast(err.message, 'error', 5000); }
  });
  body.querySelector('#save').addEventListener('click', async () => {
    const btn = body.querySelector('#save'); btn.disabled = true;
    try {
      const data = collect();
      const saved = id ? await put(`/api/admin/cars/${id}`, data) : await post('/api/admin/cars', data);
      id = saved.id; toast('Сохранено', 'ok'); haptic();
      if (onSaved) onSaved(saved);
    } catch (err) { toast(err.message, 'error', 4000); btn.disabled = false; }
  });
  const delBtn = body.querySelector('#delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!(await confirmSheet('Удалить автомобиль?', `${esc(c.name)} будет удалён с сайта. Историю броней это не затронет.`, 'Удалить', true))) return;
    try { await del(`/api/admin/cars/${id}`); toast('Удалено'); if (onSaved) onSaved(null); } catch (err) { toast(err.message, 'error', 5000); }
  });
  return body;
}

export default async function cars({ params, navigate }) {
  const list = await loadCars(true);
  const view = el(`<div class="view">
    <div class="admin-head"><h1>Автопарк</h1><div class="actions"><button class="btn primary compact" id="add" data-press>${svg('plus')} Добавить</button></div></div>
    <div class="car-grid" id="grid"></div>
  </div>`);
  const grid = view.querySelector('#grid');
  function occ(c) { const o = c.occupancy; if (c.status === 'hidden') return '<span class="status"><i></i>Скрыт</span>'; if (c.status === 'service') return '<span class="status warn"><i></i>Сервис</span>'; if (o.state === 'free') return `<span class="status ok"><i></i>Свободна${o.nextStart ? ' до ' + esc(fmt.d(o.nextStart)) : ''}</span>`; return `<span class="status warn"><i></i>${o.state === 'hold' ? 'Бронируется' : 'Занята до ' + esc(fmt.dt(o.busyUntil))}</span>`; }
  function render(items) {
    grid.innerHTML = items.map((c, i) => `<div class="row-card" data-id="${c.id}"><img src="${esc((c.photos || [])[0] || '/assets/car-placeholder.jpg')}" alt=""><div class="t"><b>${esc(c.name)}</b><span>${esc((CLASSES.find((x) => x[0] === c.class) || [])[1] || c.class)} · ${c.year || ''} · ${c.engine ? c.engine + ' л' : ''}</span></div><div class="r"><b>${fmt.money(c.pricePerDay)}/сут</b>${occ(c)}</div><div class="btn-row" style="flex:0 0 auto"><button class="btn secondary tiny" data-up="${c.id}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn secondary tiny" data-down="${c.id}" ${i === items.length - 1 ? 'disabled' : ''}>↓</button></div></div>`).join('') || `<div class="empty">${svg('car')}<div>Добавьте первый автомобиль</div></div>`;
    grid.querySelectorAll('.row-card').forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('button')) return; openEdit(items.find((x) => x.id === r.dataset.id)); }));
    grid.querySelectorAll('[data-up],[data-down]').forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); const id = b.dataset.up || b.dataset.down; const idx = items.findIndex((x) => x.id === id); const j = b.dataset.up ? idx - 1 : idx + 1; if (j < 0 || j >= items.length) return; [items[idx], items[j]] = [items[j], items[idx]]; render(items); await put('/api/admin/cars/order', { ids: items.map((x) => x.id) }); }));
  }
  async function refresh() { render(await loadCars(true)); }
  function openEdit(car) {
    const sheet = openSheet({ title: car ? car.name : 'Новый автомобиль', content: carForm(car, { onSaved: () => { sheet.close(); refresh(); } }) });
  }
  view.querySelector('#add').addEventListener('click', () => openEdit(null));
  render(list);
  if (params[0]) { const c = list.find((x) => x.id === params[0]); if (c) setTimeout(() => openEdit(c), 100); }
  return view;
}
