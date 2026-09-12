/* Hero stage: мягкий параллакс слоёв (--st-px/--st-py в диапазоне -1..1; смещения и transition заданы в stage.css).
   Десктоп — от курсора над hero, телефон — от наклона (там, где не нужно разрешение). rAF-троттлинг,
   уважает prefers-reduced-motion и класс is-lite. */
(() => {
  'use strict';
  const stage = document.querySelector('.hero-stage');
  if (!stage) return;
  const root = document.documentElement;
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  if (mq('(prefers-reduced-motion: reduce)') || root.classList.contains('is-lite')) return;

  let px = 0, py = 0, raf = 0;
  const apply = () => {
    raf = 0;
    stage.style.setProperty('--st-px', px.toFixed(3));
    stage.style.setProperty('--st-py', py.toFixed(3));
  };
  const set = (x, y) => {
    px = Math.max(-1, Math.min(1, x));
    py = Math.max(-1, Math.min(1, y));
    if (!raf) raf = requestAnimationFrame(apply);
  };

  const fine = mq('(hover: hover) and (pointer: fine)');
  if (fine) {
    const hero = stage.closest('.hero') || stage;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      set(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => set(0, 0), { passive: true });
  } else if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    // Android/десктоп без запроса разрешения; iOS требует жест — пропускаем, чтобы не показывать диалог
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      set(e.gamma / 35, (e.beta - 45) / 45);
    }, { passive: true });
  }

  // Вне экрана — вернуть слои на место
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (!en.isIntersecting) set(0, 0); });
    }, { threshold: 0 }).observe(stage);
  }
})();
