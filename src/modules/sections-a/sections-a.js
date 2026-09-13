/* =====================================================================
   Sprinter Go — sections-a.js
   1) Лента доверия: дублирование трека, если в разметке одна копия.
   2) #how: прогресс секции по скроллу → --how-p / --how-len на секции,
      класс is-done на пройденных шагах, is-moving во время движения.
   3) Точки-индикаторы для snap-каруселей (#services, #fleet).
   4) Иллюстрации услуг на десктопе: после ухода курсора анимация
      доигрывает цикл до исходного кадра, а не замирает на полпути.
   Vanilla ES2020, IIFE, без глобалов.
   ===================================================================== */
(() => {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rafThrottle = (fn) => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  };

  /* ---------- 1. Trust strip: бесшовный marquee ---------- */
  const trustTrack = document.querySelector('#trust-strip .trust-track');
  if (trustTrack) {
    const lists = trustTrack.querySelectorAll('.trust-list');
    if (lists.length === 1) {
      const copy = lists[0].cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.querySelectorAll('[aria-label],[title]').forEach((el) => { el.removeAttribute('aria-label'); el.removeAttribute('title'); });
      trustTrack.appendChild(copy);
    }
  }

  /* ---------- 2. How: прогресс дороги ---------- */
  const how = document.getElementById('how');
  const howTrack = how && how.querySelector('.how-track');
  const howVan = howTrack && howTrack.querySelector('.how-van');
  if (how && howTrack && howVan) {
    const steps = Array.from(howTrack.querySelectorAll('.how-step'));
    const badges = steps.map((s) => s.querySelector('.how-badge'));
    let p = -1;
    let len = 0;
    let axis = 'x';
    let moveTimer = 0;

    // Спринтер — <svg>, у него нет offsetWidth/offsetLeft: берём CSS-бокс.
    const vanBox = () => {
      const cs = getComputedStyle(howVan);
      return { w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0, l: parseFloat(cs.left) || 0, t: parseFloat(cs.top) || 0 };
    };

    const measure = () => {
      axis = (getComputedStyle(how).getPropertyValue('--how-axis') || 'x').trim() === 'y' ? 'y' : 'x';
      const size = axis === 'y' ? howTrack.clientHeight : howTrack.clientWidth;
      len = Math.max(0, size - vanBox().w); // вдоль оси движения спринтер занимает свою ширину (на мобиле он повёрнут)
      how.style.setProperty('--how-len', Math.round(len) + 'px');
    };

    const update = () => {
      const r = howTrack.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const start = vh * 0.86; // p = 0, когда верх дороги здесь
      const end = vh * 0.38;   // p = 1, когда низ дороги здесь
      const np = clamp((start - r.top) / (r.height + start - end), 0, 1);
      if (Math.abs(np - p) < 0.0005) return;
      p = np;
      how.style.setProperty('--how-p', p.toFixed(4));

      how.classList.add('is-moving');
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => how.classList.remove('is-moving'), 220);

      const box = vanBox();
      const vanCenter = (axis === 'y' ? box.t + box.h / 2 : box.l + box.w / 2) + p * len;
      badges.forEach((b, i) => {
        if (!b) return;
        const br = b.getBoundingClientRect();
        const c = axis === 'y' ? br.top + br.height / 2 - r.top : br.left + br.width / 2 - r.left;
        steps[i].classList.toggle('is-done', vanCenter >= c - 4);
      });
    };

    const onScroll = rafThrottle(update);
    const onResize = rafThrottle(() => { measure(); p = -1; update(); });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('load', onResize, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize).catch(() => {});
    onResize();
  }

  /* ---------- 3. Snap-карусели: точки-индикаторы ---------- */
  const carousel = (scrollerSel, dotsSel, dotClass) => {
    const scroller = document.querySelector(scrollerSel);
    const dots = document.querySelector(dotsSel);
    if (!scroller || !dots) return;
    const items = Array.from(scroller.children);
    if (items.length < 2) return;

    dots.textContent = '';
    const buttons = items.map((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = dotClass;
      b.addEventListener('click', () => {
        scroller.scrollTo({ left: item.offsetLeft - items[0].offsetLeft, behavior: 'smooth' });
      });
      dots.appendChild(b);
      return b;
    });

    let active = -1;
    const setActive = (i) => {
      if (i === active) return;
      active = i;
      buttons.forEach((b, k) => b.classList.toggle('is-active', k === i));
      items.forEach((it, k) => it.classList.toggle('is-active', k === i));
    };

    const sync = () => {
      const center = scroller.scrollLeft + scroller.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      items.forEach((it, i) => {
        const c = it.offsetLeft - items[0].offsetLeft + it.offsetWidth / 2 + (items[0].offsetLeft - scroller.offsetLeft);
        const d = Math.abs(c - center);
        if (d < bestD) { bestD = d; best = i; }
      });
      setActive(best);
    };

    const onScroll = rafThrottle(sync);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    sync();
  };
  carousel('#services .svc-grid', '#services .svc-dots', 'svc-dot');
  carousel('#fleet .fleet-scroll', '#fleet .fleet-dots', 'fleet-dot');

  /* ---------- 4. Иллюстрации услуг: мягкая остановка после hover ---------- */
  const canHover = window.matchMedia && window.matchMedia('(hover:hover)').matches;
  if (canHover) {
    document.querySelectorAll('#services .svc-card').forEach((card) => {
      const anims = card.querySelectorAll('.svc-anim');
      if (!anims.length) return;
      card.addEventListener('pointerenter', () => {
        anims.forEach((el) => { el.style.animationPlayState = ''; });
      });
      card.addEventListener('pointerleave', () => {
        anims.forEach((el) => { el.style.animationPlayState = 'running'; });
      });
      card.addEventListener('animationiteration', (e) => {
        const el = e.target;
        if (!el || !el.classList || !el.classList.contains('svc-anim')) return;
        if (card.matches(':hover')) return;
        el.style.animationPlayState = 'paused';
      });
    });
  }
})();
