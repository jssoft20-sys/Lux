import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast } from '/js/ui.js';
import { STATUS, tag, stat, waLink } from '../app.js';

export default async function dashboard({ navigate, state }) {
  const d = await get('/api/admin/dashboard');
  const c = d.cars; const i = d.integrations;
  const integ = (name, ok, text, link) => `<a class="integration" href="${link}"><b>${name}</b>${stat({ ok: [text, 'ok'], bad: [text, 'bad'], off: [text, ''] }, ok === true ? 'ok' : ok === false ? 'bad' : 'off')}</a>`;
  const bookingRow = (b, right) => `<a class="row-card" href="/admin/bookings/${b.id}"><img src="${esc(b.car?.photo || '/assets/car-placeholder.jpg')}" alt=""><div class="t"><b>${esc(b.car?.name || '')} · ${esc(b.name)}</b><span>${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))}</span></div><div class="r">${right}</div></a>`;
  const view = el(`<div class="view">
    <div class="admin-head"><h1>Обзор</h1><div class="actions"><a class="btn secondary compact" href="/admin/bookings/new" data-press>${svg('plus')} Бронь</a></div></div>
    ${d.defaultPassword ? `<a class="result bad" href="/admin/settings/security" style="display:block">Пароль администратора стандартный — смените его в настройках безопасности.</a>` : ''}
    <div class="kpi-grid">
      <div class="kpi green"><span>Свободно</span><b>${c.free}</b><small>из ${c.active} в работе</small></div>
      <div class="kpi accent"><span>Занято</span><b>${c.busy}</b><small>${d.holds ? d.holds + ' ожидают оплаты' : 'холдов нет'}</small></div>
      <div class="kpi"><span>Выручка сегодня</span><b>${fmt.money(d.revenue.today)}</b><small>месяц ${fmt.money(d.revenue.month)}</small></div>
      <div class="kpi"><span>Проверить оплату</span><b>${d.pendingPayments.filter((p) => p.status === 'awaiting').length}</b><small>${d.pendingPayments.length} ожидающих платежей</small></div>
    </div>
    <div class="section-title"><h2>Интеграции</h2><a href="/admin/settings">Настроить</a></div>
    <div class="integrations">
      ${integ('Optima ELQR', i.optima.configured ? (i.optima.lastCheck ? i.optima.lastCheck.ok : true) : null, i.optima.configured ? (i.optima.salePointName || 'Подключено') : 'Не настроено', '/admin/settings/optima')}
      ${integ('USDT', i.crypto.enabled && i.crypto.networks ? true : null, i.crypto.networks ? `Сетей: ${i.crypto.networks}` : 'Нет адресов', '/admin/settings/crypto')}
      ${integ('Почта', i.mail.configured ? (i.mail.lastCheck ? i.mail.lastCheck.ok : true) : null, i.mail.configured ? (i.mail.lastPollAt ? 'Проверка ' + fmt.t(i.mail.lastPollAt) : 'Подключено') : 'Не настроена', '/admin/settings/mail')}
      ${integ('WhatsApp', i.whatsapp.configured ? (i.whatsapp.lastCheck ? i.whatsapp.lastCheck.ok : true) : null, i.whatsapp.configured ? 'Подключён' : 'Не настроен', '/admin/settings/whatsapp')}
    </div>
    ${d.pendingPayments.filter((p) => p.status === 'awaiting').length ? `<div class="section-title"><h2>Ожидают подтверждения</h2><a href="/admin/payments">Все платежи</a></div><div id="awaiting">${d.pendingPayments.filter((p) => p.status === 'awaiting').map((p) => `<div class="row-card" data-pay="${p.id}"><div class="thumb" style="display:grid;place-items:center;font-weight:800;font-size:11px;background:#26A17B">USDT</div><div class="t"><b>${esc(p.booking?.code || '')} · ${esc(p.booking?.name || '')}</b><span>${fmt.usdt(p.amountUsdt)} · ${esc(p.network || '')} · клиент сообщил ${esc(fmt.t(p.clientMarkedPaidAt))}</span></div><button class="btn success tiny" data-confirm="${p.id}">Подтвердить</button></div>`).join('')}</div>` : ''}
    <div class="section-title"><h2>Заканчиваются сегодня <span class="badge-num">${d.endingToday.length}</span></h2></div>
    ${d.endingToday.length ? d.endingToday.map((b) => bookingRow(b, `<b>${esc(fmt.t(b.endAt))}</b><span>${b.hoursLeft > 0 ? 'через ' + fmt.left(b.endAt) : 'просрочена'}</span>`)).join('') : '<div class="note">Сегодня возвратов нет</div>'}
    <div class="section-title"><h2>Активные аренды <span class="badge-num">${d.activeRentals.length}</span></h2><a href="/admin/bookings">Все</a></div>
    ${d.activeRentals.length ? d.activeRentals.map((b) => bookingRow(b, `<b>до ${esc(fmt.dt(b.endAt))}</b><span>${b.reminderSentAt ? 'напоминание ✓' : 'осталось ' + fmt.left(b.endAt)}</span>`)).join('') : '<div class="note">Сейчас машины на стоянке</div>'}
    <div class="section-title"><h2>Ближайшие выдачи</h2></div>
    ${d.upcoming.length ? d.upcoming.slice(0, 6).map((b) => bookingRow(b, `<b>${esc(fmt.dt(b.startAt))}</b><span>${b.pickup === 'delivery' ? 'доставка' : 'самовывоз'}${b.dueUsd > 0 ? ' · долг ' + fmt.money(b.dueUsd) : ''}</span>`)).join('') : '<div class="note">Предстоящих броней нет</div>'}
    <div class="section-title"><h2>Автопарк</h2><a href="/admin/cars">Управлять</a></div>
    <div class="panel" style="padding:6px 16px">${c.list.map((x) => `<a class="kv" href="/admin/cars/${x.id}"><span style="color:#fff">${esc(x.name)}</span>${x.status === 'service' ? '<b class="dim">сервис</b>' : x.status === 'hidden' ? '<b class="dim">скрыт</b>' : x.occupancy.state === 'free' ? `<b class="status-ok">свободна${x.occupancy.nextStart ? ' до ' + esc(fmt.d(x.occupancy.nextStart)) : ''}</b>` : `<b class="accent">до ${esc(fmt.dt(x.occupancy.busyUntil))}</b>`}</a>`).join('')}</div>
    <div class="section-title"><h2>Последние события</h2></div>
    <div class="panel" style="padding:6px 16px">${d.activity.map((a) => `<div class="kv"><span>${esc(fmt.dt(a.at))}</span><b style="font-weight:500;text-align:right">${esc(a.message)}</b></div>`).join('') || '<div class="note">Пока пусто</div>'}</div>
  </div>`);
  view.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', async (e) => { e.stopPropagation(); btn.disabled = true; try { await post(`/api/admin/payments/${btn.dataset.confirm}/confirm`); toast('Оплата подтверждена', 'ok'); navigate('/admin', { replace: true }); } catch (err) { toast(err.message, 'error'); btn.disabled = false; } }));
  return view;
}
