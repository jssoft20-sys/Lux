import { get } from '../api.js';
import { el, esc, fmt, svg, MONTHS } from '/js/ui.js';
import { METHOD } from '../app.js';

function bars(data, key, label, color = 'var(--accent-2)') {
  const max = Math.max(1, ...data.map((d) => d[key]));
  const w = 100 / data.length;
  return `<svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none">${data.map((d, i) => { const h = (d[key] / max) * 34; return `<rect x="${i * w + w * 0.15}" y="${38 - h}" width="${w * 0.7}" height="${h}" rx="0.6" fill="${d[key] ? color : 'rgba(255,255,255,.08)'}"><title>${esc(label(d))}: ${fmt.money(d[key])}</title></rect>`; }).join('')}</svg>`;
}

export default async function analytics() {
  const PERIODS = [['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней'], ['365', 'Год']];
  let period = sessionStorage.getItem('adm.ap') || '30';
  const view = el(`<div class="view"><div class="admin-head"><h1>Аналитика</h1><div class="actions"><a class="btn secondary compact" href="/api/admin/export/bookings.csv" download>CSV броней</a></div></div><div class="chips" id="chips"></div><div id="body"></div></div>`);
  async function render() {
    const to = new Date(); const from = new Date(Date.now() - Number(period) * 86400000);
    const a = await get(`/api/admin/analytics?from=${from.toISOString()}&to=${to.toISOString()}`);
    const methods = Object.entries(a.byMethod).sort((x, y) => y[1].amountUsd - x[1].amountUsd);
    const maxCar = Math.max(1, ...a.byCar.map((c) => c.revenueUsd));
    view.querySelector('#body').innerHTML = `
      <div class="kpi-grid">
        <div class="kpi accent"><span>Выручка</span><b>${fmt.money(a.revenueUsd)}</b><small>${a.paymentsCount} платежей</small></div>
        <div class="kpi"><span>Загрузка парка</span><b>${a.occupancyAvg}%</b><small>средняя за период</small></div>
        <div class="kpi"><span>Средний чек</span><b>${fmt.money(a.avgCheck)}</b><small>средний срок ${a.avgDays} ${fmt.days(Math.round(a.avgDays))}</small></div>
        <div class="kpi"><span>Брони</span><b>${a.bookings.confirmed}</b><small>из ${a.bookings.total} заявок · ${a.bookings.conversion}% · новых клиентов ${a.newClients}</small></div>
      </div>
      <div class="section-title"><h2>Выручка по дням</h2></div>
      <div class="panel">${bars(a.days, 'amountUsd', (d) => d.date)}<div class="legend"><span>${esc(fmt.d(a.from))} — ${esc(fmt.d(a.to))}</span></div></div>
      <div class="section-title"><h2>По месяцам</h2></div>
      <div class="panel">${bars(a.months, 'amountUsd', (d) => d.month, '#5AA9FF')}<div class="legend">${a.months.filter((_, i) => i % 3 === 0).map((m) => `<span>${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}</span>`).join('')}</div></div>
      <div class="two-col">
        <div><div class="section-title"><h2>По автомобилям</h2></div><div class="panel bar-list">${a.byCar.map((c) => `<div class="item"><b>${esc(c.name)}</b><span>${fmt.money(c.revenueUsd)} · ${c.bookings} бр. · ${c.occupancy}%</span><div class="bar"><i style="width:${(c.revenueUsd / maxCar) * 100}%"></i></div></div>`).join('') || '<div class="note">Нет данных</div>'}</div></div>
        <div><div class="section-title"><h2>Способы оплаты</h2></div><div class="panel" style="padding:6px 16px">${methods.map(([m, v]) => `<div class="kv"><span>${METHOD[m] || m}</span><b>${fmt.money(v.amountUsd)} <small class="dim">· ${v.count}</small></b></div>`).join('') || '<div class="note">Нет оплат за период</div>'}</div>
        <div class="section-title"><h2>Лучшие клиенты</h2></div><div class="panel" style="padding:6px 16px">${a.topClients.map((c) => `<div class="kv"><span>${c.clientId ? `<a class="inline-link" href="/admin/clients/${c.clientId}">${esc(c.name)}</a>` : esc(c.name)}<br><small>${esc(fmt.phone(c.phone))}</small></span><b>${fmt.money(c.amountUsd)}</b></div>`).join('') || '<div class="note">Нет данных</div>'}</div></div>
      </div>`;
  }
  view.querySelector('#chips').innerHTML = PERIODS.map(([k, l]) => `<button class="chip ${period === k ? 'active' : ''}" data-p="${k}">${l}</button>`).join('');
  view.querySelectorAll('#chips .chip').forEach((b) => b.addEventListener('click', () => { period = b.dataset.p; sessionStorage.setItem('adm.ap', period); view.querySelectorAll('#chips .chip').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
  await render();
  return view;
}
