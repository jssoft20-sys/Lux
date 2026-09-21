import { get, post, put } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet, phoneInput, normalizeDigits, haptic, MONTHS } from '/js/ui.js';
import { loadCars, STATUS, PAY_STATUS, METHOD, tag, stat, waLink, confirmSheet, state } from '../app.js';

const pad = (n) => String(n).padStart(2, '0');

export async function bookingForm({ navigate, onSaved, prefill = {} }) {
  const cars = await loadCars();
  const today = fmt.parts(new Date().toISOString());
  const body = el(`<div>
    <div class="form-grid">
      <div class="field full"><label>Автомобиль</label><div class="select-wrap"><select class="select" name="carId">${cars.filter((c) => c.status !== 'hidden').map((c) => `<option value="${c.id}" ${c.id === prefill.carId ? 'selected' : ''}>${esc(c.name)} · ${fmt.money(c.pricePerDay)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Имя клиента</label><input class="input" name="name" value="${esc(prefill.name || '')}"></div>
      <div class="field"><label>Телефон (WhatsApp)</label><input class="input" name="phone" type="tel" value="${esc(prefill.phone ? fmt.phone(prefill.phone) : '')}"></div>
      <div class="field"><label>Дата начала</label><input class="input" name="startDate" type="date" value="${today.date}"></div>
      <div class="field"><label>Время</label><input class="input" name="startTime" type="time" value="10:00"></div>
      <div class="field"><label>Дней</label><input class="input" name="days" type="number" inputmode="numeric" value="1" min="1"></div>
      <div class="field"><label>Получение</label><div class="select-wrap"><select class="select" name="pickup"><option value="self">Самовывоз</option><option value="delivery">Доставка</option></select></div></div>
      <div class="field full"><label>Адрес доставки</label><input class="input" name="address" placeholder="Если доставка"></div>
      <div class="field"><label>Сумма, $ (пусто = по прайсу)</label><input class="input" name="totalUsd" type="number" inputmode="decimal" placeholder="авто"></div>
      <div class="field"><label>Оплата</label><div class="select-wrap"><select class="select" name="paid"><option value="">Не оплачено</option><option value="cash">Оплачено наличными</option><option value="transfer">Оплачено переводом</option><option value="card">Оплачено картой</option><option value="elqr">Оплачено ELQR</option><option value="usdt">Оплачено USDT</option></select></div></div>
      <div class="field full"><label>Заметка</label><input class="input" name="adminNote" placeholder="Видна только вам"></div>
    </div>
    <label class="switch"><div><b>Отправить клиенту подтверждение</b><span>WhatsApp / email, если настроены</span></div><div class="toggle on" id="notify"></div></label>
    <button class="btn primary" id="save" data-press>Создать бронь</button>
  </div>`);
  phoneInput(body.querySelector('[name=phone]'));
  body.querySelector('#notify').addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
  body.querySelector('#save').addEventListener('click', async () => {
    const f = (n) => body.querySelector(`[name="${n}"]`).value;
    const btn = body.querySelector('#save'); btn.disabled = true;
    try {
      const b = await post('/api/admin/bookings', { carId: f('carId'), name: f('name'), phone: normalizeDigits(f('phone')), startDate: f('startDate'), startTime: f('startTime'), days: Number(f('days')), pickup: f('pickup'), address: f('address'), totalUsd: f('totalUsd'), paid: Boolean(f('paid')), paidMethod: f('paid') || 'cash', adminNote: f('adminNote'), notifyClient: body.querySelector('#notify').classList.contains('on') });
      toast(`Бронь ${b.code} создана`, 'ok'); haptic();
      if (onSaved) onSaved(b);
    } catch (err) { toast(err.message, 'error', 5000); btn.disabled = false; }
  });
  return body;
}

export async function openBooking(id, { navigate, onChange }) {
  let b = await get(`/api/admin/bookings/${id}`);
  const sheet = openSheet({ title: `${b.code}`, content: '' });
  const render = () => {
    const link = `${location.origin}/b/${b.token}`;
    const reminderText = `Luxar Autorent: аренда ${b.car?.name} заканчивается ${fmt.dt(b.endAt)}. Продлить: ${link}`;
    const st = b.state === 'active' ? 'active' : b.state === 'upcoming' ? 'upcoming' : b.state === 'finished' ? 'finished' : b.status;
    sheet.body.innerHTML = `
      <div class="row-card" style="cursor:default"><img src="${esc(b.car?.photo || '/assets/car-placeholder.jpg')}" alt=""><div class="t"><b>${esc(b.car?.name || '')}</b><span>${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))} · ${b.days} ${fmt.days(b.days)}</span></div><div class="r">${tag(STATUS, st)}</div></div>
      ${b.conflict ? `<div class="result bad">${esc(b.conflict)}</div>` : ''}
      <div class="panel mt" style="padding:6px 16px">
        <div class="kv"><span>Клиент</span><b>${esc(b.name)}${b.client ? ` <a class="inline-link" href="/admin/clients/${b.client.id}">карточка</a>` : ''}</b></div>
        <div class="kv"><span>Телефон</span><b><a href="${waLink(b.whatsapp || b.phone)}" target="_blank" class="inline-link">${esc(fmt.phone(b.phone))}</a></b></div>
        ${b.email ? `<div class="kv"><span>Email</span><b>${esc(b.email)}</b></div>` : ''}
        <div class="kv"><span>Получение</span><b>${b.pickup === 'delivery' ? 'Доставка: ' + esc(b.address || '') : 'Самовывоз'}</b></div>
        <div class="kv"><span>Стоимость</span><b>${fmt.money(b.totalUsd)}${b.discountPercent ? ` <small class="dim">скидка ${b.discountPercent}%</small>` : ''}</b></div>
        <div class="kv"><span>Оплачено</span><b class="${b.dueUsd > 0 ? 'accent' : 'status-ok'}">${fmt.money(b.paidUsd)}${b.dueUsd > 0 ? ` · долг ${fmt.money(b.dueUsd)}` : ''}</b></div>
        ${b.state === 'active' ? `<div class="kv"><span>До конца</span><b>${esc(fmt.left(b.endAt))}${b.reminderSentAt ? ' · напоминание отправлено' : ''}</b></div>` : ''}
        ${b.comment ? `<div class="kv"><span>Комментарий клиента</span><b style="font-weight:500">${esc(b.comment)}</b></div>` : ''}
        <div class="kv"><span>Источник</span><b>${b.source === 'admin' ? 'вручную' : 'сайт'} · ${esc(fmt.dt(b.createdAt))}</b></div>
        ${(b.extensions || []).length ? `<div class="kv"><span>Продления</span><b>${b.extensions.map((e) => `+${e.days} дн. ${fmt.money(e.amountUsd)}`).join(', ')}</b></div>` : ''}
      </div>
      <div class="field mt"><label>Заметка</label><input class="input" id="note" value="${esc(b.adminNote || '')}" placeholder="Например: залог наличными, второй ключ у клиента"></div>
      <div class="detail-grid">
        ${['hold', 'confirmed'].includes(b.status) ? `<a class="btn secondary" href="${waLink(b.whatsapp || b.phone, reminderText)}" target="_blank">${svg('whatsapp')} Ссылка на продление</a>` : ''}
        ${b.dueUsd > 0 && b.status !== 'cancelled' ? `<button class="btn success" id="markPaid">Отметить оплату</button>` : ''}
        ${b.status === 'confirmed' ? `<button class="btn secondary" id="extend">Продлить</button>` : ''}
        ${b.status === 'confirmed' && ['active', 'finished'].includes(b.state) ? `<button class="btn secondary" id="remind">Напомнить сейчас</button>` : ''}
        <button class="btn secondary" id="edit">Изменить даты / данные</button>
        <a class="btn secondary" href="${link}" target="_blank">Страница клиента</a>
        ${b.status === 'confirmed' ? `<button class="btn secondary" id="complete">Завершить (возврат)</button>` : ''}
        ${['hold', 'confirmed'].includes(b.status) ? `<button class="btn danger" id="cancel">Отменить</button>` : ''}
        ${['cancelled', 'expired', 'completed'].includes(b.status) ? `<button class="btn secondary" id="restore">Восстановить</button>` : ''}
      </div>
      ${b.payments.length ? `<div class="section-title"><h2>Платежи</h2></div>${b.payments.map((p) => `<div class="row-card" style="cursor:default"><div class="t"><b>${METHOD[p.method] || p.method} · ${fmt.money(p.amountUsd)}${p.method === 'usdt' ? ` (${fmt.usdt(p.amountUsdt)})` : p.method === 'elqr' ? ` (${fmt.kgs(p.amountKgs)})` : ''}</b><span>${p.kind === 'extension' ? 'продление +' + p.extensionDays + ' дн. · ' : ''}${esc(fmt.dt(p.paidAt || p.createdAt))}${p.confirmedBy ? ' · ' + p.confirmedBy : ''}</span></div><div class="r">${tag(PAY_STATUS, p.status)}${['pending', 'awaiting'].includes(p.status) ? `<br><button class="btn success tiny mt" data-confirm="${p.id}" style="margin-top:6px">Подтвердить</button>` : ''}</div></div>`).join('')}` : ''}
      ${b.notifications.length ? `<div class="section-title"><h2>Уведомления</h2></div><div class="panel" style="padding:6px 16px">${b.notifications.slice(0, 8).map((n) => `<div class="kv"><span>${esc(fmt.dt(n.at))} · ${n.channel}</span><b class="${n.status === 'sent' ? 'status-ok' : 'accent'}">${n.status === 'sent' ? 'доставлено' : 'ошибка'}</b></div>`).join('')}</div>` : ''}
    `;
    const q = (s) => sheet.body.querySelector(s);
    const reload = async () => { b = await get(`/api/admin/bookings/${id}`); render(); if (onChange) onChange(); };
    q('#note').addEventListener('change', async () => { try { await put(`/api/admin/bookings/${id}`, { adminNote: q('#note').value }); toast('Заметка сохранена', 'ok'); } catch (err) { toast(err.message, 'error'); } });
    q('#markPaid')?.addEventListener('click', () => {
      const c = el(`<div><div class="form-grid"><div class="field"><label>Сумма, $</label><input class="input" id="amt" type="number" value="${b.dueUsd}"></div><div class="field"><label>Способ</label><div class="select-wrap"><select class="select" id="m"><option value="cash">Наличные</option><option value="transfer">Перевод</option><option value="card">Карта</option><option value="elqr">ELQR</option><option value="usdt">USDT</option></select></div></div></div><label class="switch"><div><b>Отправить подтверждение клиенту</b></div><div class="toggle on" id="n"></div></label><button class="btn primary" id="ok">Отметить оплату</button></div>`);
      const sh = openSheet({ title: 'Оплата', content: c });
      c.querySelector('#n').addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
      c.querySelector('#ok').addEventListener('click', async () => { try { await post(`/api/admin/bookings/${id}/mark-paid`, { amountUsd: c.querySelector('#amt').value, method: c.querySelector('#m').value, notifyClient: c.querySelector('#n').classList.contains('on') }); sh.close(); toast('Оплата отмечена', 'ok'); reload(); } catch (err) { toast(err.message, 'error'); } });
    });
    q('#extend')?.addEventListener('click', () => {
      const c = el(`<div><p class="help">Можно продлить максимум на ${b.maxExtendDays} дн. — дальше автомобиль забронирован.</p><div class="form-grid"><div class="field"><label>Дней</label><input class="input" id="d" type="number" value="1" min="1" max="${b.maxExtendDays}"></div><div class="field"><label>Сумма, $ (пусто = по прайсу)</label><input class="input" id="a" type="number" placeholder="авто"></div><div class="field"><label>Оплата</label><div class="select-wrap"><select class="select" id="m"><option value="">Не оплачено</option><option value="cash">Наличные</option><option value="transfer">Перевод</option><option value="elqr">ELQR</option><option value="usdt">USDT</option></select></div></div></div><button class="btn primary" id="ok">Продлить</button></div>`);
      const sh = openSheet({ title: 'Продлить аренду', content: c });
      c.querySelector('#ok').addEventListener('click', async () => { try { await post(`/api/admin/bookings/${id}/extend`, { days: c.querySelector('#d').value, amountUsd: c.querySelector('#a').value, paid: Boolean(c.querySelector('#m').value), method: c.querySelector('#m').value || 'cash' }); sh.close(); toast('Продлено', 'ok'); reload(); } catch (err) { toast(err.message, 'error', 5000); } });
    });
    q('#remind')?.addEventListener('click', async () => { try { const r = await post(`/api/admin/bookings/${id}/send-reminder`); toast(r.ok ? 'Напоминание отправлено' : 'Не отправлено: проверьте WhatsApp/почту в настройках', r.ok ? 'ok' : 'error', 5000); reload(); } catch (err) { toast(err.message, 'error'); } });
    q('#complete')?.addEventListener('click', async () => { if (await confirmSheet('Завершить аренду?', 'Автомобиль станет свободным с этого момента.')) { await post(`/api/admin/bookings/${id}/complete`); toast('Аренда завершена', 'ok'); reload(); } });
    q('#cancel')?.addEventListener('click', async () => { if (await confirmSheet('Отменить бронь?', 'Автомобиль освободится на эти даты.', 'Отменить бронь', true)) { await post(`/api/admin/bookings/${id}/cancel`); toast('Бронь отменена'); reload(); } });
    q('#restore')?.addEventListener('click', async () => { try { await post(`/api/admin/bookings/${id}/restore`); toast('Бронь восстановлена', 'ok'); reload(); } catch (err) { toast(err.message, 'error', 5000); } });
    q('#edit')?.addEventListener('click', async () => {
      const cars = await loadCars(); const s = fmt.parts(b.startAt), e = fmt.parts(b.endAt);
      const c = el(`<div><div class="form-grid">
        <div class="field full"><label>Автомобиль</label><div class="select-wrap"><select class="select" id="carId">${cars.map((x) => `<option value="${x.id}" ${x.id === b.carId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
        <div class="field"><label>Имя</label><input class="input" id="name" value="${esc(b.name)}"></div><div class="field"><label>Телефон</label><input class="input" id="phone" value="${esc(fmt.phone(b.phone))}"></div>
        <div class="field"><label>Начало</label><input class="input" id="sd" type="date" value="${s.date}"></div><div class="field"><label>Время</label><input class="input" id="st" type="time" value="${s.time}"></div>
        <div class="field"><label>Окончание</label><input class="input" id="ed" type="date" value="${e.date}"></div><div class="field"><label>Время</label><input class="input" id="et" type="time" value="${e.time}"></div>
        <div class="field"><label>Стоимость, $</label><input class="input" id="total" type="number" value="${b.totalUsd}"></div><div class="field"><label>Оплачено, $</label><input class="input" id="paid" type="number" value="${b.paidUsd}"></div>
        <div class="field full"><label>Адрес доставки</label><input class="input" id="addr" value="${esc(b.address || '')}"></div>
      </div><button class="btn primary" id="ok">Сохранить</button></div>`);
      const sh = openSheet({ title: 'Изменить бронь', content: c });
      c.querySelector('#ok').addEventListener('click', async () => { const v = (x) => c.querySelector(x).value; try { await put(`/api/admin/bookings/${id}`, { carId: v('#carId'), name: v('#name'), phone: v('#phone'), startDate: v('#sd'), startTime: v('#st'), endDate: v('#ed'), endTime: v('#et'), totalUsd: v('#total'), paidUsd: v('#paid'), address: v('#addr'), pickup: v('#addr') ? 'delivery' : b.pickup }); sh.close(); toast('Сохранено', 'ok'); reload(); } catch (err) { toast(err.message, 'error', 5000); } });
    });
    sheet.body.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', async () => { try { await post(`/api/admin/payments/${btn.dataset.confirm}/confirm`); toast('Оплата подтверждена', 'ok'); reload(); } catch (err) { toast(err.message, 'error'); } }));
  };
  render();
  return sheet;
}

export default async function bookings({ params, navigate, query }) {
  const FILTERS = [['active', 'Активные'], ['upcoming', 'Предстоящие'], ['hold', 'Ждут оплаты'], ['completed,finished', 'Завершённые'], ['cancelled,expired', 'Отменённые'], ['all', 'Все']];
  let filter = sessionStorage.getItem('adm.bf') || 'active'; let q = ''; let mode = sessionStorage.getItem('adm.bm') || 'list';
  const view = el(`<div class="view">
    <div class="admin-head"><h1>Брони</h1><div class="actions"><button class="btn secondary compact" id="mode" data-press>${svg('calendar')}</button><button class="btn primary compact" id="add" data-press>${svg('plus')} Новая</button></div></div>
    <div class="filters"><input class="input" id="q" placeholder="Поиск: код, имя, телефон, авто"></div>
    <div class="chips" id="chips"></div>
    <div id="list"></div>
  </div>`);
  const list = view.querySelector('#list');
  async function renderList() {
    const r = await get(`/api/admin/bookings?status=${encodeURIComponent(filter)}&q=${encodeURIComponent(q)}`);
    const items = r.items;
    if (filter === 'active' || filter === 'upcoming') items.sort((a, b) => new Date(filter === 'active' ? a.endAt : a.startAt) - new Date(filter === 'active' ? b.endAt : b.startAt));
    list.innerHTML = items.length ? items.map((b) => { const st = b.state === 'active' ? 'active' : b.state === 'upcoming' ? 'upcoming' : b.state === 'finished' ? 'finished' : b.status; return `<div class="row-card" data-id="${b.id}"><img src="${esc(b.car?.photo || '/assets/car-placeholder.jpg')}" alt=""><div class="t"><b>${esc(b.car?.name || '')} · ${esc(b.name)}</b><span>${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))}</span><span>${esc(b.code)} · ${esc(fmt.phone(b.phone))}${b.dueUsd > 0 ? ` · <span class="accent">долг ${fmt.money(b.dueUsd)}</span>` : ''}</span></div><div class="r">${tag(STATUS, st)}<span>${st === 'active' ? 'до конца ' + fmt.left(b.endAt) : fmt.money(b.totalUsd)}</span></div></div>`; }).join('') : `<div class="empty">${svg('calendar')}<div>Ничего не найдено</div></div>`;
    list.querySelectorAll('.row-card').forEach((r) => r.addEventListener('click', () => openBooking(r.dataset.id, { navigate, onChange: renderList })));
  }
  async function renderCalendar() {
    const from = new Date(Date.now() - 2 * 86400000); const to = new Date(Date.now() + 26 * 86400000);
    const d = await get(`/api/admin/calendar?from=${from.toISOString()}&to=${to.toISOString()}`);
    const todayP = fmt.parts(new Date().toISOString());
    const days = []; for (let i = -2; i < 26; i++) { const dt = new Date(Date.UTC(todayP.y, todayP.m - 1, todayP.d + i)); days.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), today: i === 0, we: [0, 6].includes(dt.getUTCDay()) }); }
    const CELL = 44; const first = Date.UTC(days[0].y, days[0].m - 1, days[0].d);
    const idx = (iso) => { const p = fmt.parts(iso); return (Date.UTC(p.y, p.m - 1, p.d) - first) / 86400000 + (Number(p.hh) * 60 + Number(p.mm)) / 1440; };
    list.innerHTML = `<div class="timeline"><div class="tl-inner"><div class="tl-days">${days.map((x) => `<div class="${x.today ? 'today' : ''} ${x.we ? 'we' : ''}"><b>${x.d}</b>${x.today ? 'сегодня' : MONTHS[x.m - 1]}</div>`).join('')}</div>
      ${d.cars.map((c) => `<div class="tl-row admin"><div class="tl-car"><img src="${esc(c.photo || '/assets/car-placeholder.jpg')}" alt=""><b>${esc(c.name)}</b></div><div class="tl-track">${days.map((x) => `<div class="tl-cell ${x.today ? 'today' : ''}"></div>`).join('')}${c.bookings.map((b) => { const a = Math.max(0, idx(b.startAt)), e = Math.min(days.length, idx(b.endAt)); if (e <= a) return ''; const cls = b.status === 'hold' ? 'hold' : b.status === 'completed' ? 'completed' : b.state === 'upcoming' ? 'upcoming' : ''; return `<div class="tl-bar ${cls}" data-id="${b.id}" style="left:${a * CELL}px;width:${(e - a) * CELL}px"><span>${esc(b.name)}</span></div>`; }).join('')}</div></div>`).join('')}
    </div></div><div class="legend"><span><i style="background:var(--accent-2)"></i>активна</span><span><i style="background:#5AA9FF"></i>предстоит</span><span><i style="background:#3a3a3a"></i>ждёт оплаты</span><span><i style="background:#3d3d3d;opacity:.6"></i>завершена</span></div>`;
    list.querySelectorAll('.tl-bar').forEach((bar) => bar.addEventListener('click', () => openBooking(bar.dataset.id, { navigate, onChange: renderCalendar })));
    setTimeout(() => { const tl = list.querySelector('.timeline'); if (tl) tl.scrollLeft = CELL * 1.5; }, 30);
  }
  function renderChips() {
    view.querySelector('#chips').innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('');
    view.querySelector('#chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; sessionStorage.setItem('adm.bf', filter); renderChips(); renderList(); }));
  }
  const draw = () => { view.querySelector('#chips').classList.toggle('hidden', mode !== 'list'); view.querySelector('#q').parentElement.classList.toggle('hidden', mode !== 'list'); view.querySelector('#mode').innerHTML = mode === 'list' ? svg('calendar') : svg('calendar') + ' Список'; return mode === 'list' ? renderList() : renderCalendar(); };
  view.querySelector('#mode').addEventListener('click', () => { mode = mode === 'list' ? 'calendar' : 'list'; sessionStorage.setItem('adm.bm', mode); draw(); });
  let t; view.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); renderList(); }, 250); });
  view.querySelector('#add').addEventListener('click', async () => { const form = await bookingForm({ navigate, onSaved: () => { sheet.close(); draw(); } }); const sheet = openSheet({ title: 'Новая бронь', content: form }); });
  renderChips(); await draw();
  if (params[0] === 'new') view.querySelector('#add').click(); else if (params[0]) openBooking(params[0], { navigate, onChange: draw });
  return view;
}
