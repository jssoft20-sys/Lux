/* =====================================================================
   Sprinter Go — main.js
   Глобальное поведение сайта: reveal-анимации, пауза сцен вне экрана,
   счётчики, якоря, ссылки мессенджеров, флаги устройства.
   Vanilla ES2020, без зависимостей. Единственный глобал — window.SG.
   ===================================================================== */
(() => {
  'use strict';

  const root = document.documentElement;
  const hasIO = 'IntersectionObserver' in window;

  /* ---------- Медиа-запросы ---------- */
  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMqChange = (mq, fn) => {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  };

  /* ---------- Крошечная шина событий ---------- */
  const listeners = new Map();

  /** Подписка. Возвращает функцию отписки. */
  const on = (event, fn) => {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
  };

  const off = (event, fn) => {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  };

  /** Рассылка: ошибка одного слушателя не ломает остальных. */
  const emit = (event, data) => {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach((fn) => {
      try { fn(data); } catch (err) { console.error(`[SG] listener "${event}" failed:`, err); }
    });
  };

  /* ---------- Числа и склонения ---------- */

  /** 1500 → «1 500» (неразрывный пробел), 1.5 → «1,5». */
  const formatNumber = (n, decimals = 0) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n);
    const d = Math.max(0, Math.min(6, decimals | 0));
    const [int, frac] = Math.abs(num).toFixed(d).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (num < 0 ? '−' : '') + grouped + (frac ? ',' + frac : '');
  };

  /** Русский плюрализатор: plural(3, 'год|года|лет') → «года». */
  const plural = (n, forms) => {
    const f = (Array.isArray(forms) ? forms : String(forms ?? '').split('|')).map((s) => s.trim());
    if (f.length < 3) return f[f.length - 1] || '';
    const a = Math.abs(Math.round(Number(n) || 0));
    const m10 = a % 10;
    const m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return f[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return f[1];
    return f[2];
  };

  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

  /* ---------- Утилиты DOM ---------- */

  /** Элементы по селектору внутри scope (включая сам scope, если подходит). */
  const collect = (selector, scope) => {
    const base = scope && scope.nodeType ? scope : document;
    const list = Array.from(base.querySelectorAll(selector));
    if (base !== document && base.matches && base.matches(selector)) list.unshift(base);
    return list;
  };

  /** Элемент в пределах или выше первого экрана и реально отрисован. */
  const inFirstScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && (r.width > 0 || r.height > 0);
  };

  const rectIntersects = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  };

  /* ---------- 1. Reveal ---------- */
  const revealed = new WeakSet();
  let revealIO = null;

  // Ближайший горизонтальный скролл-контейнер (карусели): его карточки за краем не пересекают viewport,
  // поэтому показываем их вместе с первой видимой карточкой.
  const scrollParent = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return p;
      p = p.parentElement;
    }
    return null;
  };

  const showReveal = (el) => {
    if (el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    if (revealIO) revealIO.unobserve(el);
    emit('reveal', el);
    const sp = scrollParent(el);
    if (sp) collect('.reveal', sp).forEach((sib) => { if (sib !== el) showReveal(sib); });
  };

  if (hasIO) {
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) showReveal(e.target); });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  }

  /**
   * Подключить .reveal внутри scope. immediate — элементы в первом экране
   * получают is-in сразу (используется при загрузке, чтобы hero не мерцал).
   */
  const reveal = (scope, immediate = false) => {
    collect('.reveal', scope).forEach((el) => {
      if (revealed.has(el)) return;
      revealed.add(el);
      if (SG.prefersReducedMotion || !revealIO || (immediate && inFirstScreen(el))) {
        showReveal(el);
      } else {
        revealIO.observe(el);
      }
    });
  };

  /* ---------- 2. Сцены [data-stage] ---------- */
  const stageState = new WeakMap(); // последнее известное пересечение
  const stageBound = new WeakSet();
  let stageIO = null;

  const setStage = (el, visible) => {
    stageState.set(el, visible);
    if (el.classList.contains('is-visible') === visible) return;
    el.classList.toggle('is-visible', visible);
    emit('stage', { el, visible });
  };

  if (hasIO) {
    stageIO = new IntersectionObserver((entries) => {
      if (document.visibilityState === 'hidden') return; // восстановим при возврате
      entries.forEach((e) => setStage(e.target, e.isIntersecting));
    }, { threshold: 0.05 });
  }

  /** Наблюдать сцены внутри scope. Первичное состояние ставим синхронно. */
  const stages = (scope) => {
    collect('[data-stage]', scope).forEach((el) => {
      if (stageBound.has(el)) return;
      stageBound.add(el);
      if (!stageIO) { setStage(el, true); return; }
      setStage(el, rectIntersects(el));
      stageIO.observe(el);
    });
  };

  // Вкладка скрыта → все сцены на паузу; вернулась → восстановить по пересечению.
  document.addEventListener('visibilitychange', () => {
    const all = collect('[data-stage]');
    if (document.visibilityState === 'hidden') {
      all.forEach((el) => el.classList.remove('is-visible'));
      return;
    }
    all.forEach((el) => {
      if (!stageBound.has(el)) return;
      el.classList.toggle('is-visible', stageState.get(el) === true);
      if (stageIO) { stageIO.unobserve(el); stageIO.observe(el); } // свежее пересечение
    });
  });

  /* ---------- 3. Счётчики ---------- */
  const COUNT_DURATION = 1200;
  const counterBound = new WeakSet();
  let counterIO = null;

  /** Разбор атрибутов элемента-счётчика. */
  const parseCounter = (el) => {
    const fromYear = el.getAttribute('data-count-from-year');
    let value;
    let decimals = 0;
    if (fromYear !== null && fromYear.trim() !== '') {
      const year = parseInt(fromYear, 10);
      if (!Number.isFinite(year)) return null;
      value = Math.max(0, new Date().getFullYear() - year);
    } else {
      const raw = String(el.getAttribute('data-count') ?? '').replace(/\s/g, '').replace(',', '.');
      value = parseFloat(raw);
      if (!Number.isFinite(value)) return null;
      const frac = raw.split('.')[1];
      decimals = frac ? frac.length : 0;
    }
    const prefix = el.getAttribute('data-prefix') ?? '';
    const suffixAttr = el.getAttribute('data-suffix');
    const forms = el.getAttribute('data-suffix-forms');
    let suffix;
    if (forms) {
      // Ведущий пробел берём из data-suffix (по умолчанию — один пробел).
      const lead = suffixAttr === null ? ' ' : (suffixAttr.match(/^\s*/) || [''])[0];
      suffix = (v) => lead + plural(v, forms);
    } else {
      suffix = () => suffixAttr ?? '';
    }
    return { value, decimals, prefix, suffix };
  };

  const renderCounter = (el, cfg, v) => {
    el.textContent = cfg.prefix + formatNumber(v, cfg.decimals) + cfg.suffix(v);
  };

  const runCounter = (el) => {
    const cfg = parseCounter(el);
    if (!cfg) return;
    const finish = () => {
      renderCounter(el, cfg, cfg.value);
      el.classList.add('is-counted');
      emit('count:done', { el, value: cfg.value });
    };
    if (SG.prefersReducedMotion || cfg.value === 0) { finish(); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / COUNT_DURATION);
      if (t >= 1) { finish(); return; }
      renderCounter(el, cfg, cfg.value * easeOutExpo(t));
      requestAnimationFrame(tick);
    };
    renderCounter(el, cfg, 0);
    requestAnimationFrame(tick);
  };

  if (hasIO) {
    counterIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        counterIO.unobserve(e.target);
        runCounter(e.target);
      });
    }, { threshold: 0.1 });
  }

  /** Подключить счётчики внутри scope. */
  const counters = (scope) => {
    collect('.num[data-count], [data-count-from-year]', scope).forEach((el) => {
      if (counterBound.has(el)) return;
      counterBound.add(el);
      if (SG.prefersReducedMotion || !counterIO) runCounter(el);
      else counterIO.observe(el);
    });
  };

  /* ---------- 4. Текущий год ---------- */
  const year = (scope) => {
    const y = String(new Date().getFullYear());
    collect('[data-year]', scope).forEach((el) => { if (el.textContent !== y) el.textContent = y; });
  };

  /* ---------- 5. Плавный скролл по якорям ---------- */
  const SCROLL_GAP = 12; // как scroll-padding-top в base.css

  /** Высота шапки из токена --header-h. */
  const headerOffset = () => {
    const v = parseFloat(getComputedStyle(root).getPropertyValue('--header-h'));
    return (Number.isFinite(v) ? v : 76) + SCROLL_GAP;
  };

  /**
   * Прокрутить к элементу / селектору / числу (px). Учитывает шапку и
   * prefers-reduced-motion. Возвращает целевую позицию.
   */
  const scrollTo = (target, opts = {}) => {
    let top;
    if (typeof target === 'number') {
      top = target;
    } else {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el || !el.getBoundingClientRect) return null;
      top = window.scrollY + el.getBoundingClientRect().top - (opts.offset ?? headerOffset());
    }
    top = Math.max(0, Math.round(top));
    const behavior = opts.behavior || (SG.prefersReducedMotion ? 'auto' : 'smooth');
    window.scrollTo({ top, left: 0, behavior });
    return top;
  };

  const replaceHash = (hash) => {
    try {
      history.replaceState(history.state, '', hash ? '#' + hash : location.pathname + location.search);
    } catch (_) { /* file:// и т.п. — не критично */ }
  };

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    const href = a.getAttribute('href');
    if (!href || href === '#') return;
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch (_) { id = href.slice(1); }

    if (id === 'top') {
      e.preventDefault();
      scrollTo(0);
      replaceHash('');
      emit('scroll', { id, el: null, link: a });
      return;
    }
    const el = document.getElementById(id);
    if (!el) return; // пусть браузер разбирается сам
    e.preventDefault();
    scrollTo(el);
    replaceHash(id);
    emit('scroll', { id, el, link: a });
  });

  /* ---------- 6. Ссылки мессенджеров — в новой вкладке ---------- */
  const externalLinks = (scope) => {
    collect('a[href^="https://wa.me"], a[href^="https://api.whatsapp.com"], a[href^="https://t.me"]', scope)
      .forEach((a) => {
        if (a.hasAttribute('target')) return;
        a.setAttribute('target', '_blank');
        const rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
        if (!rel.includes('noopener')) rel.push('noopener');
        a.setAttribute('rel', rel.join(' '));
      });
  };

  /* ---------- 9. Облегчённый режим (save-data / мало памяти / 2g) ---------- */
  const conn = navigator.connection;
  const isLite = Boolean(
    conn?.saveData ||
    /(^|-)2g$/.test(conn?.effectiveType || '') ||
    (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory < 2)
  );
  if (isLite) root.classList.add('is-lite');

  /* ---------- Инициализация ---------- */

  /** Подключить всё поведение внутри scope (для динамически добавленных узлов). */
  const init = (scope, immediate = false) => {
    reveal(scope, immediate);
    stages(scope);
    counters(scope);
    year(scope);
    externalLinks(scope);
    emit('init', scope || document);
  };

  /* ---------- 11. Экспорт ---------- */
  const SG = {
    on,
    off,
    emit,
    prefersReducedMotion: Boolean(mqReduce && mqReduce.matches),
    isTouch: false,
    isLite,
    isLoaded: false,
    scrollTo,
    headerOffset,
    reveal,
    stages,
    counters,
    year,
    externalLinks,
    init,
    formatNumber,
    plural,
  };
  window.SG = SG;

  // Пользователь включил reduced-motion на лету — показать всё сразу.
  onMqChange(mqReduce, (e) => {
    SG.prefersReducedMotion = e.matches;
    if (e.matches) collect('.reveal').forEach(showReveal);
  });

  /* ---------- 7. Тач-устройства ---------- */
  window.addEventListener('touchstart', () => {
    root.classList.add('is-touch');
    SG.isTouch = true;
    emit('touch');
  }, { once: true, passive: true });

  /* ---------- 8. is-loaded после load (fallback 2.5 с) ---------- */
  let loadedMarked = false;
  const markLoaded = () => {
    if (loadedMarked) return;
    loadedMarked = true;
    root.classList.add('is-loaded');
    SG.isLoaded = true;
    emit('loaded');
  };
  if (document.readyState === 'complete') markLoaded();
  else window.addEventListener('load', markLoaded, { once: true });
  setTimeout(markLoaded, 2500);

  /* ---------- 10. Микро-хаптика на .btn (только тач) ---------- */
  document.addEventListener('click', (e) => {
    if (!SG.isTouch || !e.target.closest || !e.target.closest('.btn')) return;
    try { navigator.vibrate?.(8); } catch (_) { /* ignore */ }
  }, { passive: true });

  const boot = () => init(document, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
