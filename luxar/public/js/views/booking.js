import { get, post } from '../api.js';
import { el, esc, fmt, svg, toast, haptic, tween } from '../ui.js';
import { rememberBooking } from '../app.js';

const STATE_LABEL = { hold: ['Ожидает оплаты', 'warn'], upcoming: ['Подтверждена', 'ok'], active: ['Активна', 'ok'], finished: ['Завершается', 'gold'], completed: ['Завершена', ''], cancelled: ['Отменена', ''], expired: ['Не оплачена', 'warn'] };

export default async function bookingView({ params, navigate, state }) {
  const token = params[0];
  const b = await get('/api/bookings/' + token);
  rememberBooking(token);
  const cfg = state.config;
  const [label, cls] = STATE_LABEL[b.state] || STATE_LABEL[b.status] || ['', ''];
  const photo = (b.car.photos || []) [0] || '';
  const pm = cfg.payments || {};
  const canPay = ['hold', 'expired'].includes(b.status);
  const activeExt = b.payment && b.payment.kind === 'extension' && ['pending', 'awaiting'].includes(b.payment.status);
  const r = cfg.rates || {};

  const view = el(`<div class="view no-tabs">
    <div class="page-head"><a class="back-btn" href="/" data-press>${svg('back')}</a><h1>${esc(b.code)}</h1><span class="tag ${cls}">${label}</span></div>
    <div class="car-card reveal" style="height:220px;pointer-events:none"><div class="bg">${photo ? `<img src="${esc(photo)}" alt="" class="loaded">` : ''}</div><div class="inner"><div class="label">${esc(b.car.classLabel)}</div><div class="name" style="font-size:26px">${esc(b.car.name)}</div><div class="bottom"><div class="pill sm">${esc(fmt.dt(b.startAt))} → ${esc(fmt.dt(b.endAt))}</div></div></div></div>
    ${b.state === 'active' ? `<div class="avail mt reveal"><span class="dot"></span><div><b>До конца аренды ${esc(fmt.left(b.endAt))}</b><span>Вернуть до ${esc(fmt.dt(b.endAt))}</span></div></div>` : ''}
    <div class="panel mt reveal">
      <div class="kv"><span>Период</span><b>${b.days} ${fmt.days(b.days)}</b></div>
      <div class="kv"><span>Получение</span><b>${b.pickup === 'delivery' ? 'Доставка' + (b.address ? ': ' + esc(b.address) : '') : 'Самовывоз'}</b></div>
      <div class="kv"><span>Стоимость</span><b>${fmt.money(b.totalUsd)}</b></div>
      <div class="kv"><span>Оплачено</span><b class="${b.paidUsd >= b.totalUsd ? 'status-ok' : ''}">${fmt.money(b.paidUsd)}</b></div>
      ${b.extensions && b.extensions.length ? `<div class="kv"><span>Продления</span><b>${b.extensions.map((e) => `+${e.days} ${fmt.days(e.days)}`).join(', ')}</b></div>` : ''}
    </div>
    ${canPay ? `<a class="btn primary mt" href="/pay/${esc(token)}" data-press>Оплатить ${fmt.money(b.totalUsd - b.paidUsd)}</a>` : ''}
    ${activeExt ? `<a class="btn primary mt" href="/pay/${esc(token)}" data-press>Продолжить оплату продления</a>` : ''}
    ${b.canExtend && !activeExt ? `<h2 class="section reveal">Продлить аренду</h2>
      <div class="stepper reveal"><button id="minus">${svg('minus')}</button><div class="val"><b id="days">1</b><span id="daysw"></span></div><button id="plus">${svg('plus')}</button></div>
      <div class="panel mt reveal" id="quote"></div>
      <div class="label reveal" style="margin:16px 0 8px">Способ оплаты</div>
      <div class="reveal" id="methods">
        ${pm.elqr ? `<button class="method selected" data-m="elqr"><div class="ic qr">${svg('qr')}</div><div><b>ELQR · любой банк</b><span>QR-код</span></div><div class="amt" id="amtKgs"></div></button>` : ''}
        ${pm.usdt ? `<button class="method ${pm.elqr ? '' : 'selected'}" data-m="usdt"><div class="ic usdt">USDT</div><div><b>USDT</b><span>${pm.networks.map((n) => n.id).join(' / ')}</span></div><div class="amt" id="amtUsdt"></div></button>` : ''}
      </div>
      ${pm.networks && pm.networks.length > 1 ? `<div id="nets" class="mt ${pm.elqr ? 'hidden' : ''}"><div class="net-chips">${pm.networks.map((n, i) => `<button class="chip accent ${i === 0 ? 'active' : ''}" data-n="${esc(n.id)}">${esc(n.label)}</button>`).join('')}</div></div>` : ''}
      ${pm.elqr || pm.usdt ? `<button class="btn primary mt reveal" id="extend" data-press>Оплатить продление</button>` : `<div class="note mt">Онлайн-оплата продления сейчас недоступна — напишите нам в WhatsApp.</div>`}` : ''}
    ${b.status === 'confirmed' && !b.canExtend && b.maxExtendDays === 0 && b.state !== 'finished' ? `<p class="note mt2 center">Продление недоступно: на следующие даты автомобиль уже забронирован.</p>` : ''}
    ${cfg.company.whatsapp ? `<a class="btn secondary mt2" href="https://wa.me/${esc(cfg.company.whatsapp)}?text=${encodeURIComponent('Бронь ' + b.code)}" target="_blank" rel="noopener" data-press>${svg('whatsapp')} Написать нам</a>` : ''}
  </div>`);

  if (b.canExtend && !activeExt) {
    const $ = (s) => view.querySelector(s);
    let days = 1; let method = pm.elqr ? 'elqr' : 'usdt'; let network = (pm.networks[0] || {}).id; let last = 0; let q = null;
    const maxDays = Math.min(b.maxExtendDays, cfg.site.maxDays || 60);
    async function update() {
      $('#days').textContent = days; $('#daysw').textContent = `${fmt.days(days)} · до ${fmt.dt(new Date(new Date(b.endAt).getTime() + days * 86400000).toISOString())}`;
      $('#minus').disabled = days <= 1; $('#plus').disabled = days >= maxDays;
      try {
        q = await get(`/api/bookings/${token}/extension-quote?days=${days}`);
        $('#quote').innerHTML = `<div class="kv"><span>${fmt.money(q.pricePerDay)} × ${days} ${fmt.days(days)}</span><b>${fmt.money(q.subtotal)}</b></div>${q.discount ? `<div class="kv"><span>Скидка ${q.discountPercent}%</span><b class="accent">−${fmt.money(q.discount)}</b></div>` : ''}<div class="total-row"><span>Итого</span><span class="sum" id="total"></span></div>`;
        tween($('#total'), last, q.totalUsd, (v) => fmt.money(Math.round(v))); last = q.totalUsd;
        if ($('#amtKgs')) $('#amtKgs').textContent = fmt.kgs(q.kgs); if ($('#amtUsdt')) $('#amtUsdt').textContent = fmt.usdt(q.usdt);
      } catch (err) { toast(err.message, 'error'); }
    }
    $('#minus').addEventListener('click', () => { if (days > 1) { days--; haptic(); update(); } });
    $('#plus').addEventListener('click', () => { if (days < maxDays) { days++; haptic(); update(); } });
    view.querySelectorAll('#methods .method').forEach((m) => m.addEventListener('click', () => { haptic(); method = m.dataset.m; view.querySelectorAll('#methods .method').forEach((x) => x.classList.toggle('selected', x === m)); const n = $('#nets'); if (n) n.classList.toggle('hidden', method !== 'usdt'); }));
    view.querySelectorAll('#nets .chip').forEach((c) => c.addEventListener('click', () => { haptic(); network = c.dataset.n; view.querySelectorAll('#nets .chip').forEach((x) => x.classList.toggle('active', x === c)); }));
    const btn = $('#extend');
    if (btn) btn.addEventListener('click', async () => { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; try { await post(`/api/bookings/${token}/extend`, { days, method, network }); haptic(12); navigate('/pay/' + token); } catch (err) { toast(err.message, 'error', 5000); btn.disabled = false; btn.textContent = 'Оплатить продление'; } });
    update();
  }
  return view;
}
