import { post } from '../api.js';
import { el, esc, fmt, svg, toast, openSheet, phoneInput, normalizeDigits, haptic } from '../ui.js';

export default async function service({ state, navigate }) {
  const c = state.config.company || {}; const s = state.config.site || {};
  const view = el(`<div class="view">
    <div class="page-head"><h1>Сервис</h1></div>
    <div class="panel reveal">
      ${c.address ? `<div class="contact-row"><div class="ic">${svg('pin')}</div><div><b>${esc(c.address)}</b><span>Адрес</span></div></div>` : ''}
      ${c.hours ? `<div class="contact-row"><div class="ic">${svg('clock')}</div><div><b>${esc(c.hours)}</b><span>Режим работы</span></div></div>` : ''}
      ${c.phone ? `<a class="contact-row" href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}"><div class="ic">${svg('phone')}</div><div><b>${esc(c.phone)}</b><span>Позвонить</span></div></a>` : ''}
      ${c.instagram ? `<a class="contact-row" href="https://www.instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener"><div class="ic">${svg('sparkle')}</div><div><b>@${esc(c.instagram)}</b><span>Instagram</span></div></a>` : ''}
    </div>
    ${c.whatsapp ? `<a class="btn primary wa-btn mt reveal" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener" data-press>${svg('whatsapp')} Написать в WhatsApp</a>` : ''}
    <button class="btn secondary mt reveal" id="extend" data-press>Продлить аренду</button>
    ${s.deliveryEnabled ? `<div class="panel mt2 reveal"><div class="contact-row"><div class="ic">${svg('truck')}</div><div><b>Доставка автомобиля</b><span>По городу${s.deliveryFeeUsd ? ` · ${fmt.money(s.deliveryFeeUsd)}` : ''}. Укажите адрес при бронировании.</span></div></div></div>` : ''}
    ${s.conditions && s.conditions.length ? `<h2 class="section reveal">Условия</h2><div class="panel reveal" style="padding:6px 20px">${s.conditions.map((x) => `<div class="kv"><span style="color:#fff">${esc(x)}</span></div>`).join('')}</div>` : ''}
    <h2 class="section reveal">Оплата</h2>
    <div class="panel reveal" style="padding:6px 20px">
      <div class="kv"><span>ELQR</span><b>QR-код, приложение любого банка</b></div>
      <div class="kv"><span>USDT</span><b>${(state.config.payments.networks || []).map((n) => n.id).join(', ') || 'криптовалюта'}</b></div>
      <div class="kv"><span>Курс</span><b>1 $ = ${esc(state.config.rates.kgsPerUsd)} сом</b></div>
    </div>
  </div>`);
  view.querySelector('#extend').addEventListener('click', () => {
    haptic();
    const body = el(`<div><p class="muted" style="margin:0 0 14px">Номер, на который оформлена аренда.</p><div class="field"><label>Телефон</label><input class="input" type="tel" inputmode="tel" placeholder="+996 555 123 456" value="${esc(state.profile.phone ? fmt.phone(state.profile.phone) : '')}"></div><button class="btn primary" data-press>Найти аренду</button></div>`);
    const input = body.querySelector('input'); phoneInput(input); const btn = body.querySelector('button');
    const sheet = openSheet({ title: 'Продлить аренду', content: body });
    setTimeout(() => input.focus(), 350);
    btn.addEventListener('click', async () => {
      const phone = normalizeDigits(input.value); if (phone.length < 10) { input.classList.add('error'); return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try { const r = await post('/api/extend-lookup', { phone }); sheet.close(); navigate('/b/' + r.bookings[0].token); } catch (err) { toast(err.message, 'error', 4000); btn.disabled = false; btn.textContent = 'Найти аренду'; }
    });
  });
  return view;
}
