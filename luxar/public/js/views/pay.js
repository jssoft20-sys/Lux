import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, bindCopy, countdownRing, haptic, openSheet } from '../ui.js';
import { rememberBooking } from '../app.js';

function ring(expiresAt, totalMs) { return `<div class="countdown"><svg viewBox="0 0 26 26"><circle class="bgc" cx="13" cy="13" r="11"/><circle class="fgc" cx="13" cy="13" r="11"/></svg><span>Осталось <b>--:--</b></span></div>`; }

export default async function pay({ params, navigate, state, query }) {
  const token = params[0];
  let data = await get('/api/bookings/' + token);
  rememberBooking(token);
  const cfg = state.config;
  let timers = [];
  const clear = () => { timers.forEach((t) => (typeof t === 'function' ? t() : clearInterval(t))); timers = []; };

  const view = el(`<div class="view no-tabs"><div class="page-head"><a class="back-btn" href="/b/${esc(token)}" data-press>${svg('back')}</a><h1>Оплата</h1></div><div id="body"></div></div>`);
  view.onUnmount = clear;
  const body = view.querySelector('#body');
  let selected = null; // { method, network }

  function summary(b) {
    const p = b.payment; const isExt = p && p.kind === 'extension' && p.status !== 'paid';
    return `<div class="list-item reveal"><img src="${esc((b.car.photos || [])[0] || '')}" alt=""><div class="t"><b>${esc(b.car.name)}</b><span>${isExt ? `Продление на ${p.extensionDays} ${fmt.days(p.extensionDays)}` : `${esc(fmt.dt(b.startAt))} — ${esc(fmt.dt(b.endAt))}`}</span></div><div style="text-align:right"><b>${fmt.money(isExt ? p.amountUsd : b.totalUsd - b.paidUsd)}</b><br><span class="small dim">${esc(b.code)}</span></div></div>`;
  }

  function renderChooser(b) {
    const due = b.totalUsd - b.paidUsd;
    const r = cfg.rates || {};
    const pm = cfg.payments || {};
    if (!pm.elqr && !pm.usdt) { body.innerHTML = summary(b) + `<div class="empty">${svg('info')}<div>Онлайн-оплата временно недоступна. Напишите нам в WhatsApp — подтвердим бронь вручную.</div>${cfg.company.whatsapp ? `<a class="btn primary wa-btn mt" href="https://wa.me/${esc(cfg.company.whatsapp)}?text=${encodeURIComponent('Бронь ' + b.code + ' — хочу оплатить')}" target="_blank" rel="noopener">${svg('whatsapp')} WhatsApp</a>` : ''}</div>`; return; }
    if (!selected) selected = { method: pm.elqr ? 'elqr' : 'usdt', network: (pm.networks[0] || {}).id };
    body.innerHTML = `${summary(b)}
      <div class="label" style="margin:22px 0 10px">Способ оплаты</div>
      ${pm.elqr ? `<button class="method ${selected.method === 'elqr' ? 'selected' : ''}" data-m="elqr"><div class="ic qr">${svg('qr')}</div><div><b>ELQR · любой банк</b><span>QR-код, приложение любого банка</span></div><div class="amt">${fmt.kgs(due * r.kgsPerUsd)}<small>≈ ${fmt.money(due)}</small></div></button>` : ''}
      ${pm.usdt ? `<button class="method ${selected.method === 'usdt' ? 'selected' : ''}" data-m="usdt"><div class="ic usdt">USDT</div><div><b>USDT</b><span>Криптовалюта, ${pm.networks.map((n) => n.id).join(' / ')}</span></div><div class="amt">${fmt.usdt(due * r.usdtPerUsd)}<small>≈ ${fmt.money(due)}</small></div></button>` : ''}
      <div id="nets" class="mt ${selected.method === 'usdt' && pm.networks.length > 1 ? '' : 'hidden'}"><div class="label" style="margin-bottom:8px">Сеть</div><div class="net-chips">${pm.networks.map((n) => `<button class="chip accent ${selected.network === n.id ? 'active' : ''}" data-n="${esc(n.id)}">${esc(n.label)}</button>`).join('')}</div></div>
      ${b.holdUntil ? `<div class="note mt2 center">Бронь удерживается до ${esc(fmt.t(b.holdUntil))}</div>` : ''}
      <button class="btn primary mt" id="go" data-press>Перейти к оплате</button>
      <button class="btn ghost mt" id="cancel" data-press>Отменить бронь</button>`;
    body.querySelectorAll('.method').forEach((m) => m.addEventListener('click', () => { haptic(); selected.method = m.dataset.m; renderChooser(b); }));
    body.querySelectorAll('#nets .chip').forEach((c) => c.addEventListener('click', () => { haptic(); selected.network = c.dataset.n; renderChooser(b); }));
    body.querySelector('#go').addEventListener('click', async () => {
      const btn = body.querySelector('#go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        data = await post(`/api/bookings/${token}/pay`, { method: selected.method, network: selected.network });
        haptic(12); render();
      } catch (err) { toast(err.message, 'error', 5000); btn.disabled = false; btn.textContent = 'Перейти к оплате'; }
    });
    body.querySelector('#cancel').addEventListener('click', () => {
      const c = el(`<div><p class="muted" style="margin:0 0 16px">Бронь ${esc(b.code)} будет снята, автомобиль освободится.</p><div class="btn-row"><button class="btn secondary" id="no">Оставить</button><button class="btn primary" id="yes">Отменить</button></div></div>`);
      const sh = openSheet({ title: 'Отменить бронь?', content: c });
      c.querySelector('#no').addEventListener('click', sh.close);
      c.querySelector('#yes').addEventListener('click', async () => { try { await post(`/api/bookings/${token}/cancel`); sh.close(); toast('Бронь отменена'); navigate('/', { replace: true }); } catch (err) { toast(err.message, 'error'); } });
    });
  }

  function renderPayment(b) {
    const p = b.payment;
    const total = p.method === 'elqr' ? (cfg.payments.qrTtlMinutes || 20) * 60000 : (cfg.payments.usdtWindowMinutes || 60) * 60000;
    if (p.status === 'expired' || p.status === 'error' || p.status === 'cancelled') {
      body.innerHTML = `${summary(b)}<div class="empty">${svg('clock')}<div>${p.status === 'error' ? esc(p.errorMessage || 'Ошибка оплаты') : 'Срок оплаты истёк'}</div></div><button class="btn primary" id="retry" data-press>${p.method === 'elqr' ? 'Создать новый QR' : 'Создать новую оплату'}</button><button class="btn ghost mt" id="other" data-press>Выбрать другой способ</button>`;
      body.querySelector('#retry').addEventListener('click', async () => { try { data = p.kind === 'extension' ? await post(`/api/bookings/${token}/extend`, { days: p.extensionDays, method: p.method, network: p.network }) : await post(`/api/bookings/${token}/pay`, { method: p.method, network: p.network }); render(); } catch (err) { toast(err.message, 'error', 5000); } });
      body.querySelector('#other').addEventListener('click', () => { selected = null; if (p.kind === 'extension') navigate('/b/' + token); else { data.payment = null; render(); } });
      return;
    }
    if (p.method === 'elqr') {
      body.innerHTML = `${summary(b)}
        <div class="amount-hero mt"><div class="sum">${fmt.kgs(p.amountKgs)}</div><div class="sub">ELQR · оплата через приложение любого банка</div></div>
        <div class="qr-box">${p.qrBase64 ? `<img src="data:image/png;base64,${p.qrBase64}" alt="QR для оплаты">` : `<span class="spinner" style="color:#000"></span>`}</div>
        ${ring(p.expiresAt, total)}
        ${p.deepLinks && p.deepLinks.length ? `<div class="bank-links">${p.deepLinks.map((l) => `<a class="bank-link" href="${esc(l.url)}" target="_blank" rel="noopener" data-press>${l.icon ? `<img src="${esc(l.icon)}" alt="">` : ''}<span>Открыть в ${esc(l.name)}</span>${svg('external')}</a>`).join('')}</div>` : ''}
        ${p.qrUrl ? `<div class="copy-field"><div class="txt"><small>Ссылка для оплаты</small>${esc(p.qrUrl.length > 60 ? p.qrUrl.slice(0, 60) + '…' : p.qrUrl)}</div><button data-copy="${esc(p.qrUrl)}">Копировать</button></div>` : ''}
        <div class="waiting mt"><span class="pulse"></span>Ожидаем оплату. Подтверждение придёт автоматически.</div>
        <button class="btn ghost mt" id="other" data-press>Выбрать другой способ</button>`;
    } else {
      body.innerHTML = `${summary(b)}
        <div class="amount-hero mt"><div class="sum">${fmt.usdt(p.amountUsdt)}</div><div class="sub">Сеть ${esc(p.networkLabel || p.network)} · отправьте точную сумму</div></div>
        <div class="qr-box">${p.qrDataUrl ? `<img src="${esc(p.qrDataUrl)}" alt="QR адреса">` : ''}</div>
        <div class="copy-field"><div class="txt"><small>Адрес ${esc(p.network)}</small>${esc(p.address)}</div><button data-copy="${esc(p.address)}">Копировать</button></div>
        <div class="copy-field"><div class="txt"><small>Сумма</small>${p.amountUsdt.toFixed(2)}</div><button data-copy="${p.amountUsdt.toFixed(2)}">Копировать</button></div>
        ${p.memo ? `<div class="copy-field"><div class="txt"><small>Memo / Tag</small>${esc(p.memo)}</div><button data-copy="${esc(p.memo)}">Копировать</button></div>` : ''}
        ${p.binancePayId ? `<div class="copy-field"><div class="txt"><small>Binance Pay ID</small>${esc(p.binancePayId)}</div><button data-copy="${esc(p.binancePayId)}">Копировать</button></div>` : ''}
        ${ring(p.expiresAt, total)}
        ${p.status === 'awaiting' ? `<div class="waiting"><span class="pulse"></span>Проверяем поступление. Обычно занимает несколько минут — страницу можно закрыть, подтверждение придёт в WhatsApp.</div>` : `<button class="btn primary mt" id="paid" data-press>Я оплатил</button><p class="note center" style="margin:10px 0 0">Сумма должна совпадать до копейки — так платёж определяется автоматически.</p>`}
        <button class="btn ghost mt" id="other" data-press>Выбрать другой способ</button>`;
      const paidBtn = body.querySelector('#paid');
      if (paidBtn) paidBtn.addEventListener('click', async () => { paidBtn.disabled = true; paidBtn.innerHTML = '<span class="spinner"></span>'; try { const r = await post(`/api/payments/${p.id}/mark-paid`, { token }); data.payment = r.payment; haptic(12); render(); } catch (err) { toast(err.message, 'error'); paidBtn.disabled = false; paidBtn.textContent = 'Я оплатил'; } });
    }
    bindCopy(body);
    body.querySelector('#other').addEventListener('click', () => { selected = null; if (p.kind === 'extension') navigate('/b/' + token); else { data.payment = null; render(); } });
    const cd = body.querySelector('.countdown');
    if (cd) timers.push(countdownRing(cd, p.expiresAt, total, () => refresh()));
    timers.push(setInterval(refresh, 3000));
  }

  async function refresh() {
    try {
      const r = await get(`/api/payments/${data.payment.id}?token=${token}`);
      const prevStatus = data.payment.status;
      data = { ...r.booking, payment: r.payment };
      if (r.payment.status === 'paid') { clear(); haptic(20); navigate(`/done/${token}${r.payment.kind === 'extension' ? '?kind=extension' : ''}`, { replace: true }); return; }
      if (r.payment.status !== prevStatus) render();
    } catch (err) { /* сеть моргнула — попробуем на следующем тике */ }
  }

  function render() {
    clear();
    const b = data;
    if (b.status === 'cancelled') { body.innerHTML = `<div class="empty">${svg('info')}<div>Бронь отменена</div><a class="btn secondary sm mt" href="/">На главную</a></div>`; return; }
    if (b.payment && b.payment.status === 'paid' && b.payment.kind === 'rental') { navigate('/done/' + token, { replace: true }); return; }
    if (b.payment && ['pending', 'awaiting', 'expired', 'error', 'cancelled'].includes(b.payment.status) && !(b.payment.status === 'cancelled' && b.payment.kind === 'rental')) { renderPayment(b); return; }
    if (b.status === 'confirmed' && b.paidUsd >= b.totalUsd) { navigate('/b/' + token, { replace: true }); return; }
    renderChooser(b);
  }
  render();
  return view;
}
