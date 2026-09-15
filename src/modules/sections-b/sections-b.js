/* =====================================================================
   Sprinter Go — sections-b.js
   1) FAQ: плавное открытие/закрытие <details> (Web Animations API),
      «плюс → крестик» в summary, режим аккордеона.
   2) #areas: наведение на чип района подсвечивает точку на карте и наоборот.
   Vanilla ES2020, IIFE, без глобалов. Не ломает страницу без элементов.
   ===================================================================== */
(() => {
  'use strict';

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduceMotion = () => Boolean(mq && mq.matches);
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const EASE = 'cubic-bezier(.2,.8,.2,1)';

  /* ---------- 1. FAQ ---------- */
  const faqItems = Array.from(document.querySelectorAll('.faq-item'));
  if (faqItems.length) {
    const running = new WeakMap(); // details → текущая Animation

    const stop = (item) => {
      const anim = running.get(item);
      if (anim) { running.delete(item); anim.cancel(); }
    };

    const cleanup = (item, body) => {
      running.delete(item);
      body.style.height = '';
      body.style.opacity = '';
    };

    const openItem = (item) => {
      const body = item.querySelector('.faq-a');
      const from = running.has(item) && body ? body.getBoundingClientRect().height : 0;
      stop(item);
      item.classList.remove('is-closing');
      item.open = true;
      if (!body || !canAnimate || reduceMotion()) return;
      const to = body.scrollHeight;
      if (to <= 0) return;
      const anim = body.animate(
        [{ height: from + 'px', opacity: from > 0 ? 1 : 0 }, { height: to + 'px', opacity: 1 }],
        { duration: 420, easing: EASE }
      );
      running.set(item, anim);
      anim.onfinish = () => cleanup(item, body);
      anim.oncancel = () => cleanup(item, body);
      const inner = item.querySelector('.faq-a-inner');
      if (inner && from === 0) {
        inner.animate([{ transform: 'translateY(-8px)' }, { transform: 'none' }], { duration: 480, easing: EASE });
      }
    };

    const closeItem = (item) => {
      const body = item.querySelector('.faq-a');
      if (!body || !canAnimate || reduceMotion()) {
        stop(item);
        item.classList.remove('is-closing');
        item.open = false;
        return;
      }
      const from = body.getBoundingClientRect().height;
      stop(item);
      item.classList.add('is-closing');
      const anim = body.animate(
        [{ height: from + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 320, easing: EASE }
      );
      running.set(item, anim);
      anim.onfinish = () => {
        cleanup(item, body);
        item.open = false;
        item.classList.remove('is-closing');
      };
      anim.oncancel = () => {
        cleanup(item, body);
        item.classList.remove('is-closing');
      };
    };

    faqItems.forEach((item) => {
      const summary = item.querySelector('summary');
      if (!summary) return;
      summary.addEventListener('click', (e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        const isOpen = item.open && !item.classList.contains('is-closing');
        if (isOpen) { closeItem(item); return; }
        const list = item.closest('.faq-list');
        if (list) {
          list.querySelectorAll('.faq-item[open]').forEach((other) => {
            if (other !== item && !other.classList.contains('is-closing')) closeItem(other);
          });
        }
        openItem(item);
      });
    });
  }

  /* ---------- 2. #areas: чип ↔ точка на карте ---------- */
  const tags = Array.from(document.querySelectorAll('.areas-tag[data-area]'));
  const pins = Array.from(document.querySelectorAll('.areas-pin[data-area]'));
  if (tags.length && pins.length) {
    const pinBy = new Map();
    const tagBy = new Map();
    pins.forEach((p) => pinBy.set(p.getAttribute('data-area'), p));
    tags.forEach((t) => tagBy.set(t.getAttribute('data-area'), t));
    const timers = new Map();

    const setHot = (area, on) => {
      if (!area) return;
      const p = pinBy.get(area);
      const t = tagBy.get(area);
      if (p) p.classList.toggle('is-hot', on);
      if (t) t.classList.toggle('is-hot', on);
    };

    const bind = (el, area) => {
      el.addEventListener('mouseenter', () => setHot(area, true));
      el.addEventListener('mouseleave', () => setHot(area, false));
    };
    tags.forEach((t) => {
      const area = t.getAttribute('data-area');
      bind(t, area);
      // тач: тап подсвечивает точку на карте на пару секунд
      t.addEventListener('click', () => {
        setHot(area, true);
        clearTimeout(timers.get(area));
        timers.set(area, setTimeout(() => setHot(area, false), 1600));
      });
    });
    pins.forEach((p) => bind(p, p.getAttribute('data-area')));
  }
})();
