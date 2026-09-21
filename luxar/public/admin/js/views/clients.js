import { get, post, put, del } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet, phoneInput, normalizeDigits } from '/js/ui.js';
import { STATUS, tag, waLink, confirmSheet } from '../app.js';
import { openBooking, bookingForm } from './bookings.js';

function clientForm(c, onSaved) {
  const body = el(`<div><div class="form-grid">
    <div class="field"><label>Имя</label><input class="input" id="name" value="${esc(c?.name || '')}"></div>
    <div class="field"><label>Телефон</label><input class="input" id="phone" type="tel" value="${esc(c?.phone ? fmt.phone(c.phone) : '')}"></div>
    <div class="field"><label>WhatsApp (если другой)</label><input class="input" id="wa" type="tel" value="${esc(c?.whatsapp && c.whatsapp !== c.phone ? fmt.phone(c.whatsapp) : '')}"></div>
    <div class="field"><label>Email</label><input class="input" id="email" value="${esc(c?.email || '')}"></div>
    <div class="field full"><label>Заметка</label><input class="input" id="note" value="${esc(c?.note || '')}" placeholder="Паспорт, залог, особенности"></div>
  </div>${c ? `<label class="switch"><div><b>Заблокирован</b><span>Не сможет бронировать на сайте</span></div><div class="toggle ${c.blocked ? 'on' : ''}" id="blocked"></div></label>` : ''}
  <div class="btn-row"><button class="btn primary" id="save">Сохранить</button>${c ? `<button class="btn danger" id="del" style="flex:0 0 30%">Удалить</button>` : ''}</div></div>`);
  phoneInput(body.querySelector('#phone')); phoneInput(body.querySelector('#wa'));
  body.querySelector('#blocked')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
  body.querySelector('#save').addEventListener('click', async () => {
    const v = (s) => body.querySelector(s).value;
    const data = { name: v('#name'), phone: normalizeDigits(v('#phone')), whatsapp: normalizeDigits(v('#wa')) || normalizeDigits(v('#phone')), email: v('#email'), note: v('#note'), blocked: body.querySelector('#blocked')?.classList.contains('on') || false };
    try { const saved = c ? await put(`/api/admin/clients/${c.id}`, data) : await post('/api/admin/clients', data); toast('Сохранено', 'ok'); onSaved(saved); } catch (err) { toast(err.message, 'error', 4000); }
  });
  body.querySelector('#del')?.addEventListener('click', async () => { if (await confirmSheet('Удалить клиента?', 'Брони останутся в истории без привязки к карточке.', 'Удалить', true)) { await del(`/api/admin/clients/${c.id}`); toast('Удалено'); onSaved(null); } });
  return body;
}

export async function openClient(id, { navigate, onChange }) {
  let c = await get(`/api/admin/clients/${id}`);
  const sheet = openSheet({ title: c.name || fmt.phone(c.phone), content: '' });
  const render = () => {
    sheet.body.innerHTML = `<div class="panel" style="padding:6px 16px">
      <div class="kv"><span>Телефон</span><b><a class="inline-link" href="${waLink(c.whatsapp || c.phone)}" target="_blank">${esc(fmt.phone(c.phone))}</a></b></div>
      ${c.email ? `<div class="kv"><span>Email</span><b>${esc(c.email)}</b></div>` : ''}
      <div class="kv"><span>Броней</span><b>${c.bookingsCount}</b></div>
      <div class="kv"><span>Сумма аренд</span><b>${fmt.money(c.totalSpentUsd)}</b></div>
      <div class="kv"><span>Клиент с</span><b>${esc(fmt.d(c.createdAt, { year: true }))}</b></div>
      ${c.note ? `<div class="kv"><span>Заметка</span><b style="font-weight:500">${esc(c.note)}</b></div>` : ''}
      ${c.blocked ? `<div class="kv"><span></span><b class="accent">Заблокирован</b></div>` : ''}
    </div>
    <div class="detail-grid mt"><a class="btn secondary" href="${waLink(c.whatsapp || c.phone)}" target="_blank">${svg('whatsapp')} Написать</a><button class="btn secondary" id="newb">Новая бронь</button><button class="btn secondary" id="edit">Изменить</button></div>
    <div class="section-title"><h2>История</h2></div>
    ${c.bookings.length ? c.bookings.map((b) => { const st = b.state === 'active' ? 'active' : b.state === 'upcoming' ? 'upcoming' : b.status; return `<div class="row-card" data-b="${b.id}"><img src="${esc(b.car?.photo || '/assets/car-placeholder.jpg')}" alt=""><div class="t"><b>${esc(b.car?.name || '')}</b><span>${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))}</span></div><div class="r">${tag(STATUS, st)}<span>${fmt.money(b.totalUsd)}</span></div></div>`; }).join('') : '<div class="note">Броней ещё не было</div>'}`;
    sheet.body.querySelectorAll('[data-b]').forEach((r) => r.addEventListener('click', () => openBooking(r.dataset.b, { navigate, onChange: async () => { c = await get(`/api/admin/clients/${id}`); render(); } })));
    sheet.body.querySelector('#edit').addEventListener('click', () => { const sh = openSheet({ title: 'Клиент', content: clientForm(c, async (saved) => { sh.close(); if (!saved) { sheet.close(); onChange && onChange(); return; } c = await get(`/api/admin/clients/${id}`); render(); onChange && onChange(); }) }); });
    sheet.body.querySelector('#newb').addEventListener('click', async () => { const form = await bookingForm({ navigate, prefill: { name: c.name, phone: c.phone }, onSaved: async () => { sh.close(); c = await get(`/api/admin/clients/${id}`); render(); onChange && onChange(); } }); const sh = openSheet({ title: 'Новая бронь', content: form }); });
  };
  render();
  return sheet;
}

export default async function clients({ params, navigate }) {
  let q = '';
  const view = el(`<div class="view">
    <div class="admin-head"><h1>Клиенты</h1><div class="actions"><a class="btn secondary compact" href="/api/admin/export/clients.csv" download>CSV</a><button class="btn primary compact" id="add" data-press>${svg('plus')} Добавить</button></div></div>
    <div class="filters"><input class="input" id="q" placeholder="Имя, телефон, заметка"></div>
    <div id="list"></div>
  </div>`);
  const list = view.querySelector('#list');
  async function render() {
    const items = await get('/api/admin/clients?q=' + encodeURIComponent(q));
    list.innerHTML = items.length ? items.map((c) => `<div class="row-card" data-id="${c.id}"><div class="thumb" style="display:grid;place-items:center;font-weight:800;font-size:16px;border-radius:50%;width:46px;height:46px">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div><div class="t"><b>${esc(c.name || 'Без имени')}${c.blocked ? ' <span class="tag warn">блок</span>' : ''}${c.activeBooking ? ' <span class="tag ok">в аренде</span>' : ''}</b><span>${esc(fmt.phone(c.phone))}${c.note ? ' · ' + esc(c.note) : ''}</span></div><div class="r"><b>${fmt.money(c.totalSpentUsd)}</b><span>${c.bookingsCount} ${c.bookingsCount === 1 ? 'бронь' : c.bookingsCount < 5 ? 'брони' : 'броней'}</span></div></div>`).join('') : `<div class="empty">${svg('user')}<div>Клиенты появятся после первой брони</div></div>`;
    list.querySelectorAll('.row-card').forEach((r) => r.addEventListener('click', () => openClient(r.dataset.id, { navigate, onChange: render })));
  }
  let t; view.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); render(); }, 250); });
  view.querySelector('#add').addEventListener('click', () => { const sh = openSheet({ title: 'Новый клиент', content: clientForm(null, () => { sh.close(); render(); }) }); });
  await render();
  if (params[0]) openClient(params[0], { navigate, onChange: render });
  return view;
}
