/* Sprinter Go — #calc: калькулятор стоимости + заявка в WhatsApp.
   Логика цен 1:1 со старым сайтом:
   база тарифа (1500: 2 грузчика/2 ч; 3500: 3/4; 6500: 4/8) + доп. грузчик 500 + доп. час 700
   + этаж без лифта 100 + коробка 50 + сборка 500/предмет + разборка 300/предмет. */
(() => {
  'use strict';

  const root = document.getElementById('calc');
  if (!root) return;

  const $ = (sel, ctx = root) => ctx.querySelector(sel);
  const $$ = (sel, ctx = root) => Array.from(ctx.querySelectorAll(sel));
  const byData = (name) => $(`[data-calc="${name}"]`);

  /* ---------- Константы ---------- */
  const WA_PHONE = '996755555357';
  const PRICE = { extraLoader: 500, extraHour: 700, floor: 100, box: 50, assembly: 500, disassembly: 300 };
  const TARIFFS = {
    1500: { name: 'Минимальный', loaders: 2, hours: 2 },
    3500: { name: 'Стандарт', loaders: 3, hours: 4 },
    6500: { name: 'Премиум', loaders: 4, hours: 8 }
  };
  const LIMITS = { loaders: [0, 8], hours: [1, 12], floor: [0, 18], boxes: [0, 80], assembly: [0, 20], disassembly: [0, 20] };
  const SERVICE_KEYS = {
    flat: 'Квартирный переезд', apartment: 'Квартирный переезд', kvartira: 'Квартирный переезд',
    office: 'Офисный переезд', ofis: 'Офисный переезд',
    city: 'Грузоперевозки по городу', taxi: 'Грузоперевозки по городу', cargo: 'Грузоперевозки по городу',
    loaders: 'Услуги грузчиков', movers: 'Услуги грузчиков',
    packing: 'Упаковка вещей', pack: 'Упаковка вещей',
    furniture: 'Сборка/разборка мебели', assembly: 'Сборка/разборка мебели'
  };

  const nf = new Intl.NumberFormat('ru-RU');
  const fmtNum = (n) => nf.format(n);
  const fmt = (n) => fmtNum(n) + ' сом';
  const plural = (n, [one, few, many]) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Элементы ---------- */
  const el = {
    panel: byData('panel'),
    summary: byData('summary'),
    total: byData('total'),
    totalNum: byData('total-num'),
    totalSr: byData('total-sr'),
    rows: byData('rows'),
    included: byData('included'),
    agree: byData('agree'),
    formWrap: byData('form-wrap'),
    form: byData('form'),
    send: byData('send'),
    phoneErr: byData('phone-err'),
    toast: byData('toast'),
    bar: byData('bar'),
    barTotal: byData('bar-total'),
    barGo: byData('bar-go'),
    name: $('#calcName'), phone: $('#calcPhone'), address: $('#calcAddress'), date: $('#calcDate'), comment: $('#calcComment')
  };
  const tariffInputs = $$('input[name="calcTariff"]');
  const serviceInputs = $$('input[name="calcService"]');
  const valEls = {}; $$('[data-val]').forEach((o) => { valEls[o.dataset.val] = o; });
  const hintEls = {}; $$('[data-hint]').forEach((o) => { hintEls[o.dataset.hint] = o; });

  /* ---------- Состояние ---------- */
  const state = { tariff: 3500, service: 'Квартирный переезд', loaders: 3, hours: 4, floor: 0, boxes: 0, assembly: 0, disassembly: 0 };
  const checkedTariff = tariffInputs.find((i) => i.checked);
  if (checkedTariff && TARIFFS[+checkedTariff.value]) {
    state.tariff = +checkedTariff.value;
    state.loaders = TARIFFS[state.tariff].loaders;
    state.hours = TARIFFS[state.tariff].hours;
  }
  const checkedService = serviceInputs.find((i) => i.checked);
  if (checkedService) state.service = checkedService.value;

  /* ---------- Расчёт (формула сохранена 1:1) ---------- */
  function compute() {
    const t = TARIFFS[state.tariff];
    const extraLoaders = Math.max(0, state.loaders - t.loaders) * PRICE.extraLoader;
    const extraHours = Math.max(0, state.hours - t.hours) * PRICE.extraHour;
    const floor = state.floor * PRICE.floor;
    const boxes = state.boxes * PRICE.box;
    const assembly = state.assembly * PRICE.assembly;
    const disassembly = state.disassembly * PRICE.disassembly;
    const total = state.tariff + extraLoaders + extraHours + floor + boxes + assembly + disassembly;

    const rows = [
      ['tariff', 'Тариф', `${t.name} — ${fmt(state.tariff)}`],
      ['service', 'Тип услуги', state.service],
      ['loaders', 'Грузчики', `${state.loaders} чел.` + (extraLoaders ? ` (+${fmt(extraLoaders)})` : '')],
      ['hours', 'Часы работы', `${state.hours} ч.` + (extraHours ? ` (+${fmt(extraHours)})` : '')]
    ];
    if (state.floor) rows.push(['floor', 'Этаж без лифта', `${state.floor} эт. · ${fmt(floor)}`]);
    if (state.boxes) rows.push(['boxes', 'Упаковка коробок', `${state.boxes} шт. · ${fmt(boxes)}`]);
    if (state.assembly) rows.push(['assembly', 'Сборка мебели', `${state.assembly} предм. · ${fmt(assembly)}`]);
    if (state.disassembly) rows.push(['disassembly', 'Разборка мебели', `${state.disassembly} предм. · ${fmt(disassembly)}`]);

    return { total, rows, extraLoaders, extraHours, floor, boxes, assembly, disassembly, t };
  }

  /* ---------- Анимация суммы (count-up + pop) ---------- */
  let shown = null;
  let raf = 0;
  function animateTotal(to) {
    if (!el.totalNum) return;
    if (raf) cancelAnimationFrame(raf);
    if (shown === null || reduced || shown === to) {
      shown = to;
      el.totalNum.textContent = fmtNum(to);
      return;
    }
    const from = shown;
    const start = performance.now();
    const dur = 420;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      shown = Math.round(from + (to - from) * e);
      el.totalNum.textContent = fmtNum(shown);
      if (p < 1) raf = requestAnimationFrame(step); else { shown = to; raf = 0; }
    };
    raf = requestAnimationFrame(step);
    if (el.total) {
      el.total.classList.remove('is-pop');
      void el.total.offsetWidth;
      el.total.classList.add('is-pop');
    }
  }
  if (el.total) el.total.addEventListener('animationend', () => el.total.classList.remove('is-pop'));

  /* ---------- Рендер ---------- */
  function renderRows(rows) {
    if (!el.rows) return;
    const existing = new Map(Array.from(el.rows.children).map((r) => [r.dataset.key, r]));
    rows.forEach(([key, label, value]) => {
      let row = existing.get(key);
      if (!row) {
        row = document.createElement('div');
        row.className = 'calc-row is-new';
        row.dataset.key = key;
        row.innerHTML = '<span></span><b></b>';
        row.addEventListener('animationend', () => row.classList.remove('is-new'), { once: true });
      } else {
        existing.delete(key);
      }
      if (row.firstChild.textContent !== label) row.firstChild.textContent = label;
      if (row.lastChild.textContent !== value) row.lastChild.textContent = value;
      el.rows.appendChild(row);
    });
    existing.forEach((row) => row.remove());
  }

  function renderHints(calc) {
    const t = calc.t;
    const set = (key, text, extra) => {
      const h = hintEls[key]; if (!h) return;
      if (h.textContent !== text) h.textContent = text;
      h.classList.toggle('is-extra', !!extra);
    };
    if (calc.extraLoaders) set('loaders', `доплата +${fmt(calc.extraLoaders)}`, true);
    else if (state.loaders < t.loaders) set('loaders', `входит в тариф · включено ${t.loaders}`);
    else set('loaders', `в тарифе ${t.loaders} · сверх — ${PRICE.extraLoader} сом/чел.`);

    if (calc.extraHours) set('hours', `доплата +${fmt(calc.extraHours)}`, true);
    else if (state.hours < t.hours) set('hours', `входит в тариф · включено ${t.hours}`);
    else set('hours', `в тарифе ${t.hours} · сверх — ${PRICE.extraHour} сом/час`);

    set('floor', state.floor ? `+${fmt(calc.floor)}` : `${PRICE.floor} сом за этаж`, !!state.floor);
    set('boxes', state.boxes ? `+${fmt(calc.boxes)}` : `${PRICE.box} сом за коробку`, !!state.boxes);
    set('assembly', state.assembly ? `+${fmt(calc.assembly)}` : `${PRICE.assembly} сом за предмет`, !!state.assembly);
    set('disassembly', state.disassembly ? `+${fmt(calc.disassembly)}` : `${PRICE.disassembly} сом за предмет`, !!state.disassembly);

    if (el.included) {
      el.included.textContent = `${t.loaders} ${plural(t.loaders, ['грузчик', 'грузчика', 'грузчиков'])} · ${t.hours} ${plural(t.hours, ['час', 'часа', 'часов'])}`;
    }
  }

  function renderSteppers(bumpKey) {
    Object.keys(LIMITS).forEach((key) => {
      const out = valEls[key];
      if (out) {
        const txt = String(state[key]);
        if (out.textContent !== txt) {
          out.textContent = txt;
          if (bumpKey === key) {
            out.classList.remove('is-bump');
            void out.offsetWidth;
            out.classList.add('is-bump');
          }
        }
      }
      const [min, max] = LIMITS[key];
      $$(`[data-step="${key}"]`).forEach((btn) => {
        const dir = +btn.dataset.dir;
        const off = (dir < 0 && state[key] <= min) || (dir > 0 && state[key] >= max);
        btn.setAttribute('aria-disabled', off ? 'true' : 'false');
      });
    });
  }

  function render(opts = {}) {
    const calc = compute();
    animateTotal(calc.total);
    if (el.total) el.total.dataset.total = String(calc.total);
    if (el.totalSr) el.totalSr.textContent = `Итого: ${fmt(calc.total)}`;
    if (el.barTotal) el.barTotal.textContent = fmt(calc.total);
    renderRows(calc.rows);
    renderHints(calc);
    renderSteppers(opts.bump);
    return calc;
  }

  /* ---------- Действия ---------- */
  function bump(key, dir) {
    if (!LIMITS[key]) return;
    const [min, max] = LIMITS[key];
    const next = Math.max(min, Math.min(max, state[key] + dir));
    if (next === state[key]) return;
    state[key] = next;
    render({ bump: key });
  }

  function setTariff(value, opts = {}) {
    const v = +value;
    if (!TARIFFS[v]) return false;
    state.tariff = v;
    // как в старом коде: при смене тарифа грузчики/часы = включённые в тариф
    state.loaders = TARIFFS[v].loaders;
    state.hours = TARIFFS[v].hours;
    tariffInputs.forEach((i) => { i.checked = (+i.value === v); });
    render();
    if (opts.flash) {
      const input = tariffInputs.find((i) => +i.value === v);
      const card = input && input.closest('.calc-tariff');
      if (card) {
        card.classList.remove('is-flash');
        void card.offsetWidth;
        card.classList.add('is-flash');
        card.addEventListener('animationend', () => card.classList.remove('is-flash'), { once: true });
      }
    }
    return true;
  }

  function setService(value) {
    if (!value) return false;
    const v = String(value).trim();
    const input = serviceInputs.find((i) => i.value === v || i.dataset.key === v.toLowerCase())
      || (SERVICE_KEYS[v.toLowerCase()] && serviceInputs.find((i) => i.value === SERVICE_KEYS[v.toLowerCase()]));
    if (!input) return false;
    input.checked = true;
    state.service = input.value;
    render();
    return true;
  }

  const isDesktop = () => window.matchMedia('(min-width: 961px)').matches;

  function openForm(focus) {
    if (!el.formWrap) return;
    el.formWrap.classList.add('is-open');
    el.formWrap.removeAttribute('inert');
    el.formWrap.removeAttribute('aria-hidden');
    if (el.agree) {
      el.agree.setAttribute('aria-expanded', 'true');
      const t = $('.calc-agree__text', el.agree); if (t) t.textContent = 'Расчёт принят';
    }
    if (focus && el.name) {
      window.setTimeout(() => { try { el.name.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 320);
    }
  }
  function closeForm() {
    if (!el.formWrap) return;
    el.formWrap.classList.remove('is-open');
    el.formWrap.setAttribute('inert', '');
    el.formWrap.setAttribute('aria-hidden', 'true');
    if (el.agree) {
      el.agree.setAttribute('aria-expanded', 'false');
      const t = $('.calc-agree__text', el.agree); if (t) t.textContent = 'Да, меня устраивает';
    }
  }
  const isFormOpen = () => !!(el.formWrap && el.formWrap.classList.contains('is-open'));

  /* ---------- Телефон: мягкая маска + валидация ---------- */
  function digitsOf(v) { return String(v || '').replace(/\D/g, ''); }
  function formatPhone(raw) {
    let d = digitsOf(raw);
    if (!d) return '';
    if (d.length === 10 && d[0] === '0') d = '996' + d.slice(1);
    else if (d.length === 9) d = '996' + d;
    if (d.length === 12 && d.startsWith('996')) {
      return `+996 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9, 12)}`;
    }
    return String(raw).trim();
  }
  const phoneValid = (v) => digitsOf(v).length >= 9;

  function setPhoneInvalid(on) {
    if (!el.phone) return;
    if (on) el.phone.setAttribute('aria-invalid', 'true'); else el.phone.removeAttribute('aria-invalid');
    if (el.phoneErr) el.phoneErr.classList.toggle('is-show', on);
  }

  if (el.phone) {
    el.phone.addEventListener('input', () => {
      // разрешаем только цифры, +, пробел, скобки, дефис
      const clean = el.phone.value.replace(/[^\d+\s()\-]/g, '');
      if (clean !== el.phone.value) el.phone.value = clean;
      if (el.phone.getAttribute('aria-invalid') === 'true' && phoneValid(clean)) setPhoneInvalid(false);
    });
    el.phone.addEventListener('blur', () => {
      const f = formatPhone(el.phone.value);
      if (f !== el.phone.value) el.phone.value = f;
    });
  }

  /* ---------- Тост ---------- */
  let toastTimer = 0;
  function showToast(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add('is-show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.toast.classList.remove('is-show'), 4200);
  }

  /* ---------- Текст заявки в WhatsApp ---------- */
  function buildMessage() {
    const calc = compute();
    const v = (inp) => (inp ? inp.value.trim() : '');
    const lines = [
      'Здравствуйте! Хочу заказать грузоперевозку Sprinter Go.',
      '',
      `Имя: ${v(el.name) || 'не указано'}`,
      `Телефон: ${v(el.phone) || 'не указан'}`,
      `Адрес: ${v(el.address) || 'не указан'}`,
      `Дата и время: ${v(el.date) || 'не указаны'}`,
      `Комментарий: ${v(el.comment) || 'нет'}`,
      '',
      'Расчёт:',
      ...calc.rows.map((r) => `${r[1]}: ${r[2]}`),
      `Итого: ${fmt(calc.total)}`
    ];
    return lines.join('\n');
  }
  function buildUrl() {
    return `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(buildMessage())}`;
  }

  /* ---------- События ---------- */
  if (el.panel) {
    el.panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]');
      if (!btn || !el.panel.contains(btn)) return;
      if (btn.getAttribute('aria-disabled') === 'true') return;
      bump(btn.dataset.step, +btn.dataset.dir);
    });
    // Стрелки на степпере
    el.panel.addEventListener('keydown', (e) => {
      const group = e.target.closest('[data-step-group]');
      if (!group) return;
      let dir = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') dir = 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') dir = -1;
      else if (e.key === 'Home') { state[group.dataset.stepGroup] = LIMITS[group.dataset.stepGroup][0]; render({ bump: group.dataset.stepGroup }); e.preventDefault(); return; }
      else if (e.key === 'End') { state[group.dataset.stepGroup] = LIMITS[group.dataset.stepGroup][1]; render({ bump: group.dataset.stepGroup }); e.preventDefault(); return; }
      if (!dir) return;
      e.preventDefault();
      bump(group.dataset.stepGroup, dir);
    });
  }

  tariffInputs.forEach((i) => i.addEventListener('change', () => { if (i.checked) setTariff(i.value); }));
  serviceInputs.forEach((i) => i.addEventListener('change', () => { if (i.checked) { state.service = i.value; render(); } }));

  if (el.agree) {
    el.agree.addEventListener('click', () => {
      if (isFormOpen()) { closeForm(); return; }
      openForm(true);
      if (el.form) window.setTimeout(() => { try { el.form.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { /* noop */ } }, 80);
    });
  }

  if (el.form) {
    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (el.phone) {
        el.phone.value = formatPhone(el.phone.value);
        if (!phoneValid(el.phone.value)) {
          setPhoneInvalid(true);
          try { el.phone.focus({ preventScroll: false }); } catch (err) { /* noop */ }
          return;
        }
        setPhoneInvalid(false);
      }
      const url = buildUrl();
      window.open(url, '_blank', 'noopener');
      showToast('Заявка открыта в WhatsApp — нажмите «Отправить» в чате');
    });
  }

  // Мобильная плашка: «Оформить» → к панели расчёта + открыть форму
  if (el.barGo && el.summary) {
    el.barGo.addEventListener('click', () => {
      openForm(false);
      try { el.summary.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { /* noop */ }
      if (isDesktop() && el.name) window.setTimeout(() => el.name.focus({ preventScroll: true }), 500);
    });
  }
  // Прячем плашку, когда панель расчёта уже на экране
  if (el.bar && el.summary && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => el.bar.classList.toggle('is-hidden', en.isIntersecting));
    }, { threshold: 0.12 });
    io.observe(el.summary);
  }

  // Предвыбор тарифа с любой кнопки/ссылки на странице: [data-tariff="1500|3500|6500"]
  document.addEventListener('click', (e) => {
    const trg = e.target.closest('[data-tariff]');
    if (!trg || root.contains(trg)) return;
    if (!TARIFFS[+trg.dataset.tariff]) return;
    if (trg.tagName === 'A') e.preventDefault();
    setTariff(trg.dataset.tariff, { flash: true });
    if (trg.dataset.service) setService(trg.dataset.service);
    try { root.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }); } catch (err) { /* noop */ }
    if (history.replaceState) { try { history.replaceState(null, '', '#calc'); } catch (err) { /* noop */ } }
  });

  // Query-параметры: ?tariff=3500&service=office
  try {
    const q = new URLSearchParams(window.location.search);
    const qt = q.get('tariff');
    const qs = q.get('service');
    let touched = false;
    if (qt && setTariff(qt)) touched = true;
    if (qs && setService(qs)) touched = true;
    if (touched && !window.location.hash) {
      window.setTimeout(() => { try { root.scrollIntoView({ block: 'start' }); } catch (e) { /* noop */ } }, 60);
    }
  } catch (e) { /* noop */ }

  /* ---------- Публичный API ---------- */
  window.SG = window.SG || {};
  window.SG.calc = {
    setTariff: (v) => setTariff(v, { flash: true }),
    setService,
    getState: () => Object.assign({}, state, { total: compute().total }),
    getMessage: buildMessage,
    getUrl: buildUrl,
    openForm: () => openForm(true)
  };

  render();
})();
