import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet } from '/js/ui.js';
import { PAY_STATUS, METHOD, tag, confirmSheet } from '../app.js';
import { openBooking } from './bookings.js';

export default async function payments({ navigate }) {
  let status = sessionStorage.getItem('adm.pf') || 'all';
  const FILTERS = [['all', 'Все'], ['awaiting', 'Проверить'], ['pending', 'Ожидают'], ['paid', 'Оплаченные'], ['expired,cancelled,error', 'Закрытые']];
  const view = el(`<div class="view">
    <div class="admin-head"><h1>Платежи</h1><div class="actions"><a class="btn secondary compact" href="/api/admin/export/payments.csv" download>CSV</a><button class="btn secondary compact" id="mail" data-press>${svg('refresh')} Почта</button></div></div>
    <div class="chips" id="chips"></div>
    <div id="list"></div>
    <div class="section-title"><h2>Сверка с Optima Bank</h2></div>
    <div class="panel"><p class="help">Выписка по QR-платежам за период до 14 дней. Совпавшие с бронями операции помечаются.</p>
      <div class="form-grid"><div class="field"><label>С</label><input class="input" id="from" type="date" value="${new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)}"></div><div class="field"><label>По</label><input class="input" id="to" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <div class="btn-row"><button class="btn secondary sm" id="stmt">Загрузить выписку</button><button class="btn secondary sm" id="bal">Остатки на счетах</button></div>
      <div id="stmtOut" class="mt"></div>
    </div>
    <div class="section-title"><h2>Письма о поступлениях</h2></div>
    <div id="mailLog" class="panel" style="padding:6px 16px"></div>
  </div>`);
  const list = view.querySelector('#list');
  async function render() {
    const r = await get(`/api/admin/payments?status=${encodeURIComponent(status)}&limit=200`);
    list.innerHTML = r.items.length ? r.items.map((p) => `<div class="row-card" data-id="${p.id}"><div class="thumb" style="display:grid;place-items:center;font-weight:800;font-size:11px;${p.method === 'usdt' ? 'background:#26A17B' : p.method === 'elqr' ? 'background:#fff;color:#000' : ''}">${p.method === 'usdt' ? 'USDT' : p.method === 'elqr' ? 'QR' : esc((METHOD[p.method] || p.method).slice(0, 4))}</div><div class="t"><b>${fmt.money(p.amountUsd)}${p.method === 'usdt' ? ` · ${fmt.usdt(p.amountUsdt)}` : p.method === 'elqr' ? ` · ${fmt.kgs(p.amountKgs)}` : ''}${p.kind === 'extension' ? ' · продление' : ''}</b><span>${esc(p.booking?.code || p.bookingCode)} · ${esc(p.booking?.car?.name || '')} · ${esc(p.booking?.name || '')}</span><span>${esc(fmt.dt(p.paidAt || p.createdAt))}${p.confirmedBy ? ' · ' + ({ optima: 'банк', callback: 'банк (callback)', email: 'по письму', admin: 'вручную' }[p.confirmedBy] || p.confirmedBy) : ''}${p.network ? ' · ' + p.network : ''}</span></div><div class="r">${tag(PAY_STATUS, p.status)}</div></div>`).join('') : `<div class="empty">${svg('qr')}<div>Платежей нет</div></div>`;
    list.querySelectorAll('.row-card').forEach((row) => row.addEventListener('click', () => openPayment(r.items.find((x) => x.id === row.dataset.id))));
  }
  function openPayment(p) {
    const body = el(`<div>
      <div class="panel" style="padding:6px 16px">
        <div class="kv"><span>Бронь</span><b><a class="inline-link" href="#" id="ob">${esc(p.booking?.code || p.bookingCode)}</a> · ${esc(p.booking?.car?.name || '')}</b></div>
        <div class="kv"><span>Клиент</span><b>${esc(p.booking?.name || '')} ${esc(fmt.phone(p.booking?.phone))}</b></div>
        <div class="kv"><span>Сумма</span><b>${fmt.money(p.amountUsd)}${p.method === 'usdt' ? ` = ${fmt.usdt(p.amountUsdt)}` : p.method === 'elqr' ? ` = ${fmt.kgs(p.amountKgs)}` : ''}</b></div>
        <div class="kv"><span>Курс</span><b>${p.rates ? `1$ = ${p.rates.kgsPerUsd} сом · ${p.rates.usdtPerUsd} USDT` : '—'}</b></div>
        <div class="kv"><span>Статус</span><b>${tag(PAY_STATUS, p.status)}</b></div>
        ${p.optima ? `<div class="kv"><span>Optima</span><b class="mono">${esc(p.optima.transactionId)}<br>${esc(p.optima.status || '')}${p.optima.bankSum ? ' · ' + p.optima.bankSum + ' сом' : ''}${p.optima.lastError ? '<br><span class="accent">' + esc(p.optima.lastError) + '</span>' : ''}</b></div>` : ''}
        ${p.crypto ? `<div class="kv"><span>Адрес</span><b class="mono" style="word-break:break-all">${esc(p.crypto.address)}</b></div>` : ''}
        ${p.clientMarkedPaidAt ? `<div class="kv"><span>Клиент сообщил</span><b>${esc(fmt.dt(p.clientMarkedPaidAt))}</b></div>` : ''}
        ${p.meta && p.meta.mailSubject ? `<div class="kv"><span>Письмо</span><b style="font-weight:500">${esc(p.meta.mailSubject)}</b></div>` : ''}
        <div class="kv"><span>Создан</span><b>${esc(fmt.dt(p.createdAt))} · до ${esc(fmt.dt(p.expiresAt))}</b></div>
      </div>
      <div class="detail-grid mt">
        ${['pending', 'awaiting'].includes(p.status) ? `<button class="btn success" id="confirm">Подтвердить оплату</button><button class="btn danger" id="cancel">Отменить</button>` : ''}
        ${p.method === 'elqr' && p.status === 'pending' ? `<button class="btn secondary" id="refresh">Проверить в банке</button>` : ''}
        ${p.hasQr ? `<button class="btn secondary" id="qr">Показать QR</button>` : ''}
      </div><div id="qrbox"></div></div>`);
    const sh = openSheet({ title: `${METHOD[p.method] || p.method} · ${fmt.money(p.amountUsd)}`, content: body });
    body.querySelector('#ob').addEventListener('click', (e) => { e.preventDefault(); sh.close(); openBooking(p.bookingId, { navigate, onChange: render }); });
    body.querySelector('#confirm')?.addEventListener('click', async () => { if (!(await confirmSheet('Подтвердить оплату?', 'Бронь будет подтверждена, клиент получит уведомление.'))) return; try { await post(`/api/admin/payments/${p.id}/confirm`); toast('Подтверждено', 'ok'); sh.close(); render(); } catch (err) { toast(err.message, 'error'); } });
    body.querySelector('#cancel')?.addEventListener('click', async () => { try { await post(`/api/admin/payments/${p.id}/cancel`); toast('Платёж отменён'); sh.close(); render(); } catch (err) { toast(err.message, 'error'); } });
    body.querySelector('#refresh')?.addEventListener('click', async () => { try { const r = await post(`/api/admin/payments/${p.id}/refresh`); toast(`Банк: ${r.optima?.status || r.status}`); sh.close(); render(); } catch (err) { toast(err.message, 'error', 5000); } });
    body.querySelector('#qr')?.addEventListener('click', async () => { const r = await get(`/api/admin/payments/${p.id}/qr`); body.querySelector('#qrbox').innerHTML = `<div class="qr-box"><img src="data:image/png;base64,${r.qrBase64}"></div>`; });
  }
  async function renderMailLog() {
    const log = await get('/api/admin/mail-log?limit=20');
    view.querySelector('#mailLog').innerHTML = log.length ? log.map((m) => `<div class="kv"><span>${esc(fmt.dt(m.date || m.at))}<br><small>${esc(m.subject || '').slice(0, 70)}</small></span><b class="${m.matchedPaymentId ? 'status-ok' : 'dim'}" style="font-weight:600">${m.amounts && m.amounts.length ? m.amounts.map((a) => a + ' USDT').join(', ') + '<br>' : ''}${m.matchedPaymentId ? 'зачтено · ' + esc(m.bookingCode || '') : esc(m.skipped || '')}</b></div>`).join('') : '<div class="note">Писем от Binance пока не было. Настройте почту в настройках, чтобы оплаты USDT подтверждались автоматически.</div>';
  }
  view.querySelector('#chips').innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${status === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('');
  view.querySelectorAll('#chips .chip').forEach((b) => b.addEventListener('click', () => { status = b.dataset.f; sessionStorage.setItem('adm.pf', status); view.querySelectorAll('#chips .chip').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
  view.querySelector('#mail').addEventListener('click', async () => { const btn = view.querySelector('#mail'); btn.disabled = true; try { const r = await post('/api/admin/settings/mail/poll-now'); toast(`Проверено писем: ${r.messages}, зачтено: ${r.results.filter((x) => x.matchedPaymentId).length}`, 'ok', 4000); render(); renderMailLog(); } catch (err) { toast(err.message, 'error', 5000); } btn.disabled = false; });
  view.querySelector('#stmt').addEventListener('click', async () => {
    const out = view.querySelector('#stmtOut'); out.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await get(`/api/admin/settings/optima/statement?from=${view.querySelector('#from').value}&to=${view.querySelector('#to').value}`);
      out.innerHTML = `<div class="kv"><span>Период</span><b>${esc(r.statementDuration || '')}</b></div><div class="kv"><span>Операций</span><b>${r.totalOperationsCount ?? r.operations.length}</b></div><div class="kv"><span>Сумма</span><b>${fmt.kgs(r.totalSum ?? 0)}</b></div><div class="kv"><span>Комиссия банка</span><b>${fmt.kgs(r.totalCommission ?? 0)}</b></div>
        <div class="table-wrap mt"><table class="table"><tr><th>Дата</th><th>Сумма</th><th>К зачислению</th><th>Назначение</th><th>Бронь</th></tr>${r.operations.map((o) => `<tr><td>${esc(fmt.dt(o.operationProcessedDateTime))}</td><td>${fmt.kgs(o.operationSum)}</td><td>${fmt.kgs(o.operationTransferSum)}</td><td>${esc(o.description || o.operationName || '')}</td><td>${o.matchedBookingCode ? `<span class="tag ok">${esc(o.matchedBookingCode)}</span>` : '<span class="tag">—</span>'}</td></tr>`).join('')}</table></div>`;
    } catch (err) { out.innerHTML = `<div class="result bad">${esc(err.message)}</div>`; }
  });
  view.querySelector('#bal').addEventListener('click', async () => {
    const out = view.querySelector('#stmtOut'); out.innerHTML = '<span class="spinner"></span>';
    try { const r = await get('/api/admin/settings/optima/balances'); out.innerHTML = (r.accounts || []).length ? r.accounts.map((a) => `<div class="kv"><span>${esc(a.account)} · ${esc(a.currencyIsoCode)}</span><b>${Number(a.balance).toLocaleString('ru-RU')} ${esc(a.currencyIsoCode)}${a.plannedBalance !== undefined ? ` <small class="dim">план ${Number(a.plannedBalance).toLocaleString('ru-RU')}</small>` : ''}</b></div>`).join('') : '<div class="note">Активных счетов не найдено</div>'; } catch (err) { out.innerHTML = `<div class="result bad">${esc(err.message)}</div>`; }
  });
  await render(); renderMailLog();
  return view;
}
