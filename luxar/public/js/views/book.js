import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, phoneInput, normalizeDigits, zonedToUtc, tween, haptic, MONTHS_FULL } from '../ui.js';
import { saveProfile, rememberBooking } from '../app.js';

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
function addDaysStr(ds, n) { const [y, m, d] = ds.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return dateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }

export default async function book({ params, navigate, state }) {
  const car = await get('/api/cars/' + encodeURIComponent(params[0]));
  if (car.status !== 'active') { toast('Автомобиль недоступен для бронирования', 'error'); navigate('/car/' + car.slug, { replace: true }); return el('<div class="view"></div>'); }
  const site = state.config.site;
  const today = fmt.parts(new Date().toISOString());
  const minDays = Math.max(1, car.minDays || site.minDays || 1);
  const maxDays = site.maxDays || 60;
  // занятые дни (в зоне компании)
  const busyDays = new Set();
  const ranges = (car.busy || []).map((r) => ({ s: new Date(r.start).getTime(), e: new Date(r.end).getTime() }));
  for (const r of car.busy || []) { const a = fmt.parts(r.start), b = fmt.parts(r.end); let ds = a.date; const endDs = b.time === '00:00' ? addDaysStr(b.date, -1) : b.date; let guard = 0; while (ds <= endDs && guard++ < 400) { busyDays.add(ds); ds = addDaysStr(ds, 1); } }

  const times = [];
  { const [sh, sm] = (site.workStart || '09:00').split(':').map(Number); const [eh, em] = (site.workEnd || '21:00').split(':').map(Number); const step = site.timeStepMinutes || 30; for (let t = sh * 60 + sm; t <= eh * 60 + em; t += step) times.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`); }

  const form = { date: '', time: '', days: minDays, pickup: 'self', address: '', name: state.profile.name || '', phone: state.profile.phone || '', comment: '' };
  // подберём дефолт: ближайший свободный день/время
  { let ds = today.date; let g = 0; while (busyDays.has(ds) && g++ < 60) ds = addDaysStr(ds, 1); form.date = ds; const nowMin = Number(today.hh) * 60 + Number(today.mm) + 30; form.time = (ds === today.date ? times.find((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m >= nowMin; }) : times[0]) || times[0]; if (ds === today.date && !form.time) { form.date = addDaysStr(ds, 1); form.time = times[0]; } }

  let calY = Number(form.date.slice(0, 4)), calM = Number(form.date.slice(5, 7));

  const view = el(`<div class="view no-tabs has-cta">
    <div class="page-head"><a class="back-btn" href="/car/${esc(car.slug)}" data-press>${svg('back')}</a><h1>${esc(car.name)}</h1></div>
    <div class="label" style="margin-bottom:8px">Начало аренды</div>
    <div class="cal" id="cal"></div>
    <div class="chips mt" id="times"></div>
    <div class="label" style="margin:6px 0 8px">Срок</div>
    <div class="stepper"><button id="minus" aria-label="Меньше">${svg('minus')}</button><div class="val"><b id="days">${form.days}</b><span id="daysw">${fmt.days(form.days)} · до <span id="until"></span></span></div><button id="plus" aria-label="Больше">${svg('plus')}</button></div>
    ${site.deliveryEnabled ? `<div class="label" style="margin:18px 0 8px">Получение</div><div class="segment" id="pickup"><div class="thumb"></div><button class="active" data-v="self">Самовывоз</button><button data-v="delivery">Доставка${site.deliveryFeeUsd ? ` · ${fmt.money(site.deliveryFeeUsd)}` : ''}</button></div>
    <div class="field hidden mt" id="addrField"><label>Адрес доставки</label><input class="input" id="address" placeholder="Улица, дом"></div>` : ''}
    <div class="label" style="margin:18px 0 8px">Контакты</div>
    <div class="field"><label>Имя</label><input class="input" id="name" placeholder="Как к вам обращаться" value="${esc(form.name)}" autocomplete="name"></div>
    <div class="field"><label>Телефон (WhatsApp)</label><input class="input" id="phone" type="tel" inputmode="tel" placeholder="+996 555 123 456" value="${esc(form.phone ? fmt.phone(form.phone) : '')}" autocomplete="tel"></div>
    <div class="field"><label>Комментарий</label><input class="input" id="comment" placeholder="Необязательно"></div>
    <div class="panel mt" id="summary"></div>
    <div id="err" class="error-text hidden mt"></div>
    <div class="cta-bar"><div class="btn-row"><button class="btn primary" id="submit" data-press><span id="submitText">Продолжить · <span id="ctaSum"></span></span></button></div></div>
  </div>`);

  const $ = (s) => view.querySelector(s);
  let lastTotal = 0;

  function selectionOverlaps() {
    const s = zonedToUtc(form.date, form.time).getTime(); const e = s + form.days * 86400000;
    return ranges.some((r) => s < r.e && r.s < e);
  }
  function renderCal(dir = 0) {
    const first = new Date(Date.UTC(calY, calM - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const dim = new Date(Date.UTC(calY, calM, 0)).getUTCDate();
    const prevDisabled = calY < today.y || (calY === today.y && calM <= today.m);
    const endSel = addDaysStr(form.date, form.days);
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<div class="cal-day other"></div>';
    for (let d = 1; d <= dim; d++) {
      const ds = dateStr(calY, calM, d);
      const past = ds < today.date;
      const cls = ['cal-day', past ? 'past' : '', busyDays.has(ds) ? 'busy' : '', ds === today.date ? 'today' : '', ds === form.date ? 'start' : '', ds === endSel ? 'end' : '', ds > form.date && ds < endSel ? 'in-range' : ''].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-d="${ds}">${d}</button>`;
    }
    $('#cal').innerHTML = `<div class="cal-head"><button id="prev" ${prevDisabled ? 'disabled' : ''}>${svg('left')}</button><b>${MONTHS_FULL[calM - 1]} ${calY}</b><button id="next">${svg('right')}</button></div>
      <div class="cal-body" style="--dir:${dir * 24}px"><div class="cal-grid">${DOW.map((x) => `<div class="dow">${x}</div>`).join('')}${cells}</div></div>
      <div class="cal-legend"><span><i></i>занято</span></div>`;
    $('#prev').addEventListener('click', () => { calM -= 1; if (calM < 1) { calM = 12; calY -= 1; } renderCal(-1); });
    $('#next').addEventListener('click', () => { calM += 1; if (calM > 12) { calM = 1; calY += 1; } renderCal(1); });
    view.querySelectorAll('.cal-day[data-d]').forEach((b) => b.addEventListener('click', () => { haptic(); form.date = b.dataset.d; renderCal(); renderTimes(); update(); }));
  }
  function renderTimes() {
    const nowMin = Number(today.hh) * 60 + Number(today.mm) + 15;
    $('#times').innerHTML = times.map((t) => { const [h, m] = t.split(':').map(Number); const dis = form.date === today.date && h * 60 + m < nowMin; return `<button class="chip ${t === form.time ? 'active' : ''}" data-t="${t}" ${dis ? 'disabled' : ''}>${t}</button>`; }).join('');
    if (form.date === today.date && !times.some((t) => { const [h, m] = t.split(':').map(Number); return t === form.time && h * 60 + m >= nowMin; })) { const f = times.find((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m >= nowMin; }); if (f) form.time = f; }
    view.querySelectorAll('#times .chip').forEach((b) => b.addEventListener('click', () => { haptic(); form.time = b.dataset.t; renderTimes(); update(); }));
    const active = $('#times .chip.active'); if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  function quote() {
    const ppd = car.pricePerDay; const subtotal = ppd * form.days;
    const d = car.discounts || {}; const pct = form.days >= 30 && d.d30 ? +d.d30 : form.days >= 7 && d.d7 ? +d.d7 : form.days >= 3 && d.d3 ? +d.d3 : 0;
    const discount = Math.round(subtotal * pct) / 100;
    const delivery = form.pickup === 'delivery' ? Number(site.deliveryFeeUsd) || 0 : 0;
    return { subtotal, pct, discount, delivery, total: Math.round((subtotal - discount + delivery) * 100) / 100 };
  }
  function update() {
    const q = quote();
    const end = new Date(zonedToUtc(form.date, form.time).getTime() + form.days * 86400000).toISOString();
    $('#days').textContent = form.days; $('#daysw').innerHTML = `${fmt.days(form.days)} · до <span id="until">${esc(fmt.dt(end))}</span>`;
    $('#minus').disabled = form.days <= minDays; $('#plus').disabled = form.days >= maxDays;
    const r = state.config.rates || {};
    $('#summary').innerHTML = `<div class="kv"><span>${fmt.money(car.pricePerDay)} × ${form.days} ${fmt.days(form.days)}</span><b>${fmt.money(q.subtotal)}</b></div>
      ${q.discount ? `<div class="kv"><span>Скидка ${q.pct}%</span><b class="accent">−${fmt.money(q.discount)}</b></div>` : ''}
      ${q.delivery ? `<div class="kv"><span>Доставка</span><b>${fmt.money(q.delivery)}</b></div>` : ''}
      <div class="total-row"><span>Итого</span><span class="sum" id="total"></span></div>
      <div class="note" style="margin-top:8px">${esc(fmt.dt(zonedToUtc(form.date, form.time).toISOString()))} — ${esc(fmt.dt(end))}${r.kgsPerUsd ? ` · ≈ ${fmt.kgs(q.total * r.kgsPerUsd)}` : ''}</div>`;
    tween($('#total'), lastTotal, q.total, (v) => fmt.money(Math.round(v)));
    $('#ctaSum').textContent = fmt.money(q.total);
    lastTotal = q.total;
    const overlap = selectionOverlaps();
    $('#err').classList.toggle('hidden', !overlap);
    if (overlap) $('#err').textContent = 'Выбранный период пересекается с занятыми датами. Измените дату или срок.';
    $('#submit').disabled = overlap;
    renderCal();
  }
  $('#minus').addEventListener('click', () => { if (form.days > minDays) { form.days -= 1; haptic(); update(); } });
  $('#plus').addEventListener('click', () => { if (form.days < maxDays) { form.days += 1; haptic(); update(); } });
  const seg = $('#pickup');
  if (seg) seg.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => { haptic(); form.pickup = b.dataset.v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); seg.querySelector('.thumb').style.transform = `translateX(${i * 100}%)`; $('#addrField').classList.toggle('hidden', form.pickup !== 'delivery'); update(); if (form.pickup === 'delivery') setTimeout(() => $('#address').focus(), 200); }));
  phoneInput($('#phone'));
  renderTimes(); update();

  $('#submit').addEventListener('click', async () => {
    const name = $('#name').value.trim(); const phone = normalizeDigits($('#phone').value);
    let bad = false;
    $('#name').classList.toggle('error', name.length < 2); $('#phone').classList.toggle('error', phone.length < 10);
    if (name.length < 2 || phone.length < 10) { bad = true; toast(name.length < 2 ? 'Укажите имя' : 'Укажите номер телефона', 'error'); }
    const address = $('#address') ? $('#address').value.trim() : '';
    if (form.pickup === 'delivery' && address.length < 3) { $('#address').classList.add('error'); toast('Укажите адрес доставки', 'error'); bad = true; }
    if (bad) return;
    const btn = $('#submit'); btn.disabled = true; const prev = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const b = await post('/api/bookings', { carId: car.id, startDate: form.date, startTime: form.time, days: form.days, pickup: form.pickup, address, name, phone, comment: $('#comment').value.trim() });
      saveProfile({ name, phone }); rememberBooking(b.token);
      haptic(12);
      navigate('/pay/' + b.token, { replace: true });
    } catch (err) {
      toast(err.message, 'error', 4500); btn.disabled = false; btn.innerHTML = prev;
    }
  });
  return view;
}
