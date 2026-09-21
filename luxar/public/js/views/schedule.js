import { get } from '../api.js';
import { el, esc, fmt, svg, MONTHS } from '../ui.js';

export default async function schedule() {
  const DAYS = 14;
  const data = await get('/api/schedule?days=' + DAYS);
  const todayP = fmt.parts(new Date().toISOString());
  // дни в зоне компании
  const days = [];
  for (let i = -1; i < DAYS; i++) { const d = new Date(Date.UTC(todayP.y, todayP.m - 1, todayP.d + i)); days.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getUTCDay()], we: d.getUTCDay() === 0 || d.getUTCDay() === 6, today: i === 0 }); }
  const CELL = 44;
  const dayIndex = (iso) => { const p = fmt.parts(iso); const idx = days.findIndex((x) => x.y === p.y && x.m === p.m && x.d === p.d); const frac = (Number(p.hh) * 60 + Number(p.mm)) / 1440; if (idx >= 0) return idx + frac; const first = Date.UTC(days[0].y, days[0].m - 1, days[0].d); return (Date.UTC(p.y, p.m - 1, p.d) - first) / 86400000 + frac; };
  const rows = data.cars.map((c) => {
    const bars = (c.busy || []).map((r) => { const a = Math.max(0, dayIndex(r.start)); const b = Math.min(days.length, dayIndex(r.end)); if (b <= a) return ''; return `<div class="tl-bar ${r.status === 'hold' ? 'hold' : ''}" style="left:${a * CELL}px;width:${(b - a) * CELL}px" title="${esc(fmt.dt(r.start))} — ${esc(fmt.dt(r.end))}"></div>`; }).join('');
    return `<a class="tl-row" href="/car/${esc(c.slug)}"><div class="tl-car"><img src="${esc((c.photos || [])[0] || '')}" alt=""><b>${esc(c.name)}</b></div><div class="tl-track">${days.map((d) => `<div class="tl-cell ${d.today ? 'today' : ''}"></div>`).join('')}${bars}</div></a>`;
  }).join('');
  const view = el(`<div class="view">
    <div class="page-head"><h1>График</h1></div>
    <p class="muted" style="margin:0 0 14px">Занятость автомобилей на ${DAYS} дней. Нажмите на автомобиль, чтобы забронировать свободные даты.</p>
    <div class="timeline"><div class="tl-inner">
      <div class="tl-days">${days.map((d) => `<div class="${d.today ? 'today' : ''} ${d.we ? 'we' : ''}"><b>${d.d}</b>${d.today ? 'сегодня' : d.wd + ' ' + MONTHS[d.m - 1]}</div>`).join('')}</div>
      ${rows || `<div class="empty">${svg('car')}<div>Автомобили скоро появятся</div></div>`}
    </div></div>
    <div class="cal-legend mt"><span><i></i>занято</span><span><i style="background:#3a3a3a"></i>бронируется</span></div>
  </div>`);
  // прокрутка к сегодня
  setTimeout(() => { const tl = view.querySelector('.timeline'); if (tl) tl.scrollLeft = 0; }, 50);
  return view;
}
