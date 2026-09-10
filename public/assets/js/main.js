/* =========================================================
   HeliHop — front-end v3
   Shared 3D engine everywhere, cockpit start-up intro with sound,
   price calculator, animated "how a flight goes" story page.
   ========================================================= */
(() => {
  'use strict';
  window.__hh_ready = true;
  const HH = window.HH || {};
  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = doc.classList.contains('reduced');
  const isTouch = matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 1;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isMobile = () => innerWidth < 1024;
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (typeof gsap === 'undefined') { doc.classList.add('js-failed'); return; }
  gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, SplitText);
  gsap.config({ nullTargetWarn: false });

  /* ---------------- scrolling ---------------- */
  let lenis = null;
  const scrollListeners = [];
  function onScroll(fn) { scrollListeners.push(fn); }
  function currentY() { return lenis ? lenis.scroll : (window.scrollY || doc.scrollTop); }
  function initLenis() {
    if (reduced || isTouch || typeof Lenis === 'undefined') {
      let ticking = false;
      addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; const y = currentY(); scrollListeners.forEach((f) => f(y)); }); }, { passive: true });
      return;
    }
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true, autoRaf: false });
    lenis.on('scroll', (e) => { ScrollTrigger.update(); scrollListeners.forEach((f) => f(e.scroll)); });
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    doc.classList.add('lenis');
  }
  function scrollTo(target, offset = -80) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset, duration: 1.4 });
    else { const y = el.getBoundingClientRect().top + currentY() + offset; window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' }); }
  }
  let locks = 0;
  function lockScroll(lock) {
    locks = Math.max(0, locks + (lock ? 1 : -1));
    const on = locks > 0;
    if (lenis) { on ? lenis.stop() : lenis.start(); }
    doc.style.overflow = on ? 'hidden' : '';
  }

  /* ---------------- 3D engine ---------------- */
  let engine = null, audio = null, api3d = null;
  function load3d() {
    if (reduced || !window.__hh3dReady) return Promise.resolve(null);
    return Promise.race([window.__hh3dReady, wait(7000).then(() => null)])
      .then((api) => { try { return api && api.webglOK() ? api : null; } catch (e) { return null; } });
  }
  function getEngine(api) {
    if (engine) return engine;
    if (!api) return null;
    try { engine = api.getEngine({ mobile: isMobile() }); api3d = api; window.__engine = engine; } catch (e) { console.warn('3D failed', e); engine = null; }
    return engine;
  }
  function getAudio() {
    if (audio) return audio;
    if (!api3d) return null;
    audio = new api3d.AudioEngine(); window.__audio = audio; return audio;
  }
  function dragOn(el, view) {
    let down = false, lx = 0;
    el.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } });
    el.addEventListener('pointermove', (e) => { if (!down) return; view.dragBy(e.clientX - lx); lx = e.clientX; });
    const up = () => { down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  /** mount every [data-v3d] slot as a live/static view */
  function mountViews() {
    if (!engine) return;
    $$('[data-v3d]').forEach((el) => {
      if (el.dataset.mounted) return; el.dataset.mounted = '1';
      let params = {}; try { params = JSON.parse(el.dataset.v3dParams || '{}'); } catch (e) { params = {}; }
      const pose = el.dataset.v3d, kind = el.dataset.v3dKind || 'live';
      try {
        const v = engine.addView(el, { pose, kind, ...params });
        el.classList.add('is-3d'); el.__view = v;
        if (params.drag) dragOn(el.closest('[data-cursor="drag"]') || el, v);
      } catch (e) { console.warn('view failed', e); }
    });
  }
  /** replace helicopter icons with rendered snapshots of the 3D model */
  function applySnapshots() {
    if (!engine) return;
    const cache = {};
    const get = (pose, size) => { const k = pose + size; if (!cache[k]) { try { cache[k] = engine.snapshot(pose, size).toDataURL('image/png'); } catch (e) { cache[k] = null; } } return cache[k]; };
    $$('svg.heli-top[data-snap-svg]').forEach((svg) => {
      const size = +svg.getAttribute('width') || 26, src = get(svg.dataset.snapSvg, Math.min(256, Math.max(96, size * 3)));
      if (!src) return;
      const im = new Image(); im.className = 'heli-snap ' + (svg.getAttribute('class') || ''); im.width = size; im.height = size; im.alt = ''; im.src = src; im.draggable = false;
      svg.replaceWith(im);
    });
    $$('g.hmark[data-snap]').forEach((g) => {
      const size = +g.dataset.size || 26, src = get(g.dataset.snap, 192);
      if (!src) return;
      const im = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      im.setAttribute('width', size); im.setAttribute('height', size); im.setAttribute('x', -size / 2); im.setAttribute('y', -size / 2); im.setAttribute('href', src);
      g.replaceChildren(im);
    });
  }
  function hookHero(view, heroEl) {
    if (!view) return;
    if (finePointer) addEventListener('mousemove', (e) => view.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1), { passive: true });
    onGyro((x, y) => view.setPointer(x, y));
    ScrollTrigger.create({ trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true, onUpdate: (s) => view.setScroll(s.progress) });
  }

  /* ---------------- cockpit intro (home, every load) ---------------- */
  let heroView = null;
  function setGauge(el, val) {
    if (!el) return;
    const max = +el.dataset.max || 100, p = clamp(val / max, 0, 1.05);
    const needle = $('.gauge__needle', el), txt = $('[data-gauge-val]', el);
    if (needle) needle.style.transform = `rotate(${-135 + 270 * p}deg)`;
    if (txt) txt.textContent = fmt(val);
  }
  async function introHome() {
    const intro = $('#intro'), stageEl = $('#intro-stage'), heroEl = $('#hero'), heroStage = $('#hero-stage');
    if (!intro || reduced) { intro && intro.remove(); startHeroContent(false); return; }
    lockScroll(true);
    const api = await load3d();
    const eng = getEngine(api);
    let view = null;
    if (eng && stageEl) { try { view = eng.addView(stageEl, { primary: true, pose: 'manual' }); } catch (e) { view = null; } }
    if (!view) { fallbackIntro(intro); return; }
    heroView = view; window.__heroView = view;
    const snd = getAudio();
    const T = HH.intro || {};
    const panel = $('[data-panel]', intro), status = $('[data-intro-status]', intro), check = $('[data-check]', intro), startBtn = $('[data-start]', intro), startLabel = $('[data-start-label]', intro), soundBtn = $('[data-sound]', intro), soundLabel = $('[data-sound-label]', intro), skip = $('[data-skip]', intro);
    const gauges = { n1: $('[data-gauge="n1"]', intro), nr: $('[data-gauge="nr"]', intro), tot: $('[data-gauge="tot"]', intro), alt: $('[data-gauge="alt"]', intro) };
    const sw = (k) => $(`[data-sw="${k}"]`, intro);
    let started = false, revealed = false, finished = false, soundOn = false, autoTimer = null, checkIdx = 0, nr = 0, tot = 20;
    const setSoundUI = () => { if (soundBtn) { soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); soundLabel.textContent = soundOn ? (T.soundOn || 'Sound on') : (T.soundOff || 'Muted'); } };
    const addCheck = (i, ok = true) => { const line = (T.check || [])[i]; if (!line || !check) return; const li = document.createElement('li'); li.textContent = line; if (ok) li.className = 'is-ok'; check.appendChild(li); while (check.children.length > 4) check.removeChild(check.firstChild); };
    const beep = (f, d, v) => { if (soundOn && snd) snd.beep(f, d, v); };
    const tick = () => {
      const st = view.st;
      const n1 = st.rpm * 100;
      nr += (clamp((st.rpm - .1) / .9, 0, 1) * 100 - nr) * .08;
      const totT = 20 + 720 * clamp(st.rpm / .55, 0, 1) - 190 * clamp((st.rpm - .55) / .45, 0, 1);
      tot += (totT - tot) * .06;
      setGauge(gauges.n1, n1); setGauge(gauges.nr, nr); setGauge(gauges.tot, tot);
      setGauge(gauges.alt, 800 + Math.max(0, view.pos.y - .2) * 420);
      if (snd && snd.ready) snd.setRPM(st.rpm);
    };
    const onStage = (s) => {
      if (s === 'batt') { status.textContent = T.batt || ''; }
      if (s === 'lights') { status.textContent = T.lights || ''; addCheck(1); beep(880, .07, .12); }
      if (s === 'starter') { status.textContent = T.starter || ''; addCheck(2); addCheck(3); if (soundOn && snd) snd.buzz(.4); }
      if (s === 'rotor') { status.textContent = T.rotor || ''; addCheck(4); addCheck(5); beep(990, .1, .14); }
      if (s === 'takeoff') { status.textContent = T.takeoff || ''; addCheck(6); if (soundOn && snd) snd.chime(); }
      if (s === 'climb') { status.textContent = T.climb || ''; }
    };
    const finish = () => {
      if (finished) return; finished = true;
      gsap.ticker.remove(tick);
      try { if (heroStage) view.moveTo(heroStage); } catch (e) { /* noop */ }
      intro.remove(); lockScroll(false);
      hookHero(view, heroEl);
      if (snd) snd.fadeOut(2.4);
      ScrollTrigger.refresh();
    };
    const reveal = () => {
      if (revealed) return; revealed = true;
      gsap.to(['.intro__bg', '.intro__ui'], { opacity: 0, duration: 1.0, ease: 'power2.inOut', onComplete: finish });
      startHeroContent(true);
    };
    const start = (gesture) => {
      if (started) return; started = true;
      clearTimeout(autoTimer);
      if (gesture && snd) { soundOn = snd.unlock(); if (soundOn) snd.click(); }
      setSoundUI();
      startBtn.classList.add('is-pressed'); if (startLabel) startLabel.textContent = T.start || '';
      panel.classList.add('is-on');
      [['batt', 0], ['fuel', .3], ['ign', .6]].forEach(([k, d]) => gsap.delayedCall(d, () => { const el = sw(k); el && el.classList.add('is-on'); if (soundOn && snd) snd.click(); if (k === 'batt') addCheck(0); }));
      gsap.delayedCall(.25, () => beep(660, .08, .1)); gsap.delayedCall(.55, () => beep(770, .08, .1));
      gsap.ticker.add(tick);
      eng.intro(view, { onStage, onReveal: reveal, onDone: () => { reveal(); setTimeout(finish, 900); } });
      if (window.__hhIntroPause && eng.tl) eng.tl.pause(0);
    };
    startBtn && startBtn.addEventListener('click', () => start(true));
    soundBtn && soundBtn.addEventListener('click', () => {
      if (!snd) return;
      if (!snd.ready) { soundOn = snd.unlock(); if (soundOn) snd.click(); }
      else { soundOn = !soundOn; snd.setMuted(!soundOn); if (soundOn) snd.click(); }
      setSoundUI();
    });
    skip && skip.addEventListener('click', () => { if (!started) start(false); eng.skipIntro(); if (snd) snd.fadeOut(.3); });
    status.textContent = T.pressStart || '';
    autoTimer = setTimeout(() => start(false), 2800);
    setTimeout(() => { reveal(); setTimeout(finish, 1100); }, 15000);
  }
  function fallbackIntro(intro) {
    const fb = $('#hero-heli');
    if (fb) { fb.hidden = false; gsap.fromTo(fb, { opacity: 0, x: 300, y: 80, rotate: 8 }, { opacity: 1, x: 0, y: 0, rotate: 0, duration: 2.2, ease: 'power3.out', delay: .4 }); gsap.to(fb, { x: () => innerWidth * .55, y: () => -innerHeight * .35, scale: .55, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: .5 } }); }
    if (intro) gsap.to(intro, { opacity: 0, duration: .7, ease: 'power2.inOut', onComplete: () => { intro.remove(); lockScroll(false); } });
    else lockScroll(false);
    startHeroContent(true);
  }
  /* ---------------- inner pages: quick fly-through on every open ---------------- */
  function introInner() {
    const intro = $('#intro'), stageEl = $('#intro-stage');
    if (!intro) return Promise.resolve();
    if (reduced) { intro.remove(); return Promise.resolve(); }
    lockScroll(true);
    return new Promise((resolve) => {
      let done = false, view = null;
      const finish = () => { if (done) return; done = true; intro.remove(); lockScroll(false); if (view) { try { view.remove(); } catch (e) { /* noop */ } } resolve(); };
      Promise.race([load3d(), wait(2600).then(() => null)]).then((api) => {
        const eng = getEngine(api);
        if (eng && stageEl) { try { view = eng.addView(stageEl, { primary: true, pose: 'manual' }); } catch (e) { view = null; } }
        if (!view) { gsap.to(intro, { opacity: 0, duration: .5, ease: 'power2.inOut', onComplete: finish }); return; }
        eng.flyby(view, { dir: Math.random() < .5 ? 1 : -1 });
        gsap.to(intro, { opacity: 0, duration: .6, delay: 1.2, ease: 'power2.inOut', onComplete: finish });
        const skip = $('[data-skip]', intro);
        skip && skip.addEventListener('click', () => { eng.skipIntro(); gsap.to(intro, { opacity: 0, duration: .3, onComplete: finish }); });
      });
      setTimeout(finish, 4500);
    });
  }
  function transitions() {
    const curtain = $('#curtain');
    if (!curtain) return;
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-lightbox') || a.hasAttribute('data-no-transition')) return;
      let u; try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (u.origin !== location.origin) return;
      if (u.pathname === location.pathname) {
        if (u.hash) { e.preventDefault(); if (u.hash === '#booking') openBooking({}); else scrollTo(u.hash); }
        return;
      }
      if (u.hash === '#booking') { e.preventDefault(); openBooking({}); return; }
      if (reduced) return;
      e.preventDefault();
      closeMenu();
      curtain.classList.add('is-active');
      gsap.set(curtain, { y: '101%' });
      gsap.to(curtain, { y: 0, duration: .6, ease: 'power4.inOut', onComplete: () => { location.href = u.href; } });
      setTimeout(() => { location.href = u.href; }, 1400);
    });
    addEventListener('pageshow', (e) => { if (e.persisted) { gsap.set(curtain, { y: '101%' }); curtain.classList.remove('is-active'); } });
  }

  /* ---------------- nav / menu / lang ---------------- */
  const menu = $('#menu'), burger = $('#burger');
  function openMenu() { if (!menu) return; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); burger.setAttribute('aria-expanded', 'true'); lockScroll(true); }
  function closeMenu() { if (!menu || !menu.classList.contains('is-open')) return; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); burger.setAttribute('aria-expanded', 'false'); lockScroll(false); }
  function nav() {
    const bar = $('#nav');
    let last = 0;
    onScroll((y) => {
      bar.classList.toggle('is-scrolled', y > 30);
      if (y > 380 && y > last + 4 && !menu.classList.contains('is-open')) bar.classList.add('is-hidden');
      else if (y < last - 4 || y < 380) bar.classList.remove('is-hidden');
      last = y;
    });
    burger && burger.addEventListener('click', () => (menu.classList.contains('is-open') ? closeMenu() : openMenu()));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeBooking(); closeLightbox(); $$('.lang.is-open').forEach((l) => l.classList.remove('is-open')); } });
    $$('.lang').forEach((l) => { const b = $('.lang__btn', l); b.addEventListener('click', (e) => { e.stopPropagation(); const open = l.classList.toggle('is-open'); b.setAttribute('aria-expanded', open); }); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.lang')) $$('.lang.is-open').forEach((l) => { l.classList.remove('is-open'); $('.lang__btn', l).setAttribute('aria-expanded', 'false'); }); });
    $$('[data-lang-link]').forEach((a) => a.addEventListener('click', () => { try { localStorage.setItem('hh-lang', a.dataset.langLink); } catch (e) { /* noop */ } }));
  }

  /* ---------------- cursor ---------------- */
  function cursor() {
    const c = $('#cursor');
    if (!c || !finePointer || reduced || isTouch) return;
    doc.classList.add('has-cursor');
    const dot = $('.cursor__dot', c), ring = $('.cursor__ring', c), label = $('.cursor__label', c);
    const dx = gsap.quickTo(dot, 'x', { duration: .08, ease: 'power3' }), dy = gsap.quickTo(dot, 'y', { duration: .08, ease: 'power3' });
    const rx = gsap.quickTo(ring, 'x', { duration: .35, ease: 'power3' }), ry = gsap.quickTo(ring, 'y', { duration: .35, ease: 'power3' });
    const lx = gsap.quickTo(label, 'x', { duration: .35, ease: 'power3' }), ly = gsap.quickTo(label, 'y', { duration: .35, ease: 'power3' });
    let shown = false;
    addEventListener('mousemove', (e) => {
      if (!shown) { shown = true; gsap.set(c, { opacity: 1 }); }
      dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY); lx(e.clientX); ly(e.clientY);
      const t = e.target.closest('[data-cursor]');
      const hov = e.target.closest('a,button,label,summary,.seat,[data-cursor],.chip');
      c.classList.toggle('is-hover', !!hov && !t);
      c.classList.toggle('is-label', !!t);
      if (t) label.textContent = ({ view: HH.common.view, open: HH.common.open, drag: HH.common.drag })[t.dataset.cursor] || t.dataset.cursor;
    }, { passive: true });
    addEventListener('mousedown', () => c.classList.add('is-down'));
    addEventListener('mouseup', () => c.classList.remove('is-down'));
    document.addEventListener('mouseleave', () => gsap.to(c, { opacity: 0, duration: .3 }));
    document.addEventListener('mouseenter', () => gsap.to(c, { opacity: 1, duration: .3 }));
  }

  /* ---------------- generic reveals ---------------- */
  function reveals() {
    if (reduced) { $$('[data-reveal],[data-hero]').forEach((el) => { el.style.opacity = 1; }); return; }
    $$('[data-split]').forEach((el) => {
      if (el.closest('.hero')) return;
      try {
        SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true, onSplit(self) { return gsap.from(self.lines, { yPercent: 110, opacity: 0, duration: 1.15, ease: 'power4.out', stagger: .09, scrollTrigger: { trigger: el, start: 'top 90%', once: true } }); } });
      } catch (e) { el.style.opacity = 1; }
    });
    const handled = new Set();
    const fromFor = (el) => { const v = el.dataset.reveal; if (v === 'scale') return { opacity: 0, y: 34, scale: .94 }; if (v === 'left') return { opacity: 0, x: -50 }; if (v === 'right') return { opacity: 0, x: 50 }; return { opacity: 0, y: 40 }; };
    $$('[data-stagger]').forEach((box) => {
      const kids = $$('[data-reveal]', box).filter((k) => !handled.has(k));
      if (!kids.length) return;
      kids.forEach((k) => handled.add(k));
      gsap.fromTo(kids, fromFor(kids[0]), { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.05, ease: 'power3.out', stagger: .09, clearProps: 'transform', scrollTrigger: { trigger: box, start: 'top 88%', once: true } });
    });
    $$('[data-reveal]').forEach((el) => { if (handled.has(el)) return; gsap.fromTo(el, fromFor(el), { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.05, ease: 'power3.out', clearProps: 'transform', scrollTrigger: { trigger: el, start: 'top 92%', once: true } }); });
    $$('[data-count]').forEach((el) => { const target = parseFloat(el.dataset.count); const o = { v: 0 }; gsap.to(o, { v: target, duration: 2.2, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v); }, scrollTrigger: { trigger: el, start: 'top 100%', once: true } }); });
    $$('[data-parallax]').forEach((el) => { const s = parseFloat(el.dataset.parallax) || .2; gsap.fromTo(el, { yPercent: -s * 40 }, { yPercent: s * 40, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } }); });
  }

  /* ---------------- magnetic / tilt / glare ---------------- */
  function magnetic() {
    if (!finePointer || reduced) return;
    $$('[data-magnetic]').forEach((el) => {
      const x = gsap.quickTo(el, 'x', { duration: .6, ease: 'power3' }), y = gsap.quickTo(el, 'y', { duration: .6, ease: 'power3' });
      el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * .32); y((e.clientY - r.top - r.height / 2) * .32); });
      el.addEventListener('mouseleave', () => { x(0); y(0); });
    });
  }
  function tilt() {
    if (!finePointer || reduced) return;
    $$('[data-tilt]').forEach((el) => {
      el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; gsap.to(el, { rotateY: px * 7, rotateX: -py * 7, transformPerspective: 1100, duration: .7, ease: 'power3' }); });
      el.addEventListener('mouseleave', () => gsap.to(el, { rotateY: 0, rotateX: 0, duration: .9, ease: 'power3' }));
    });
  }
  function glare() {
    if (!finePointer || reduced) return;
    $$('.glare').forEach((g) => { const el = g.parentElement; el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect(); el.style.setProperty('--gx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`); el.style.setProperty('--gy', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`); }); });
  }

  /* ---------------- device orientation ---------------- */
  const gyroFns = [];
  function initGyro() {
    if (!isTouch || reduced || !('DeviceOrientationEvent' in window)) return;
    let base = null;
    const handler = (e) => { if (e.beta == null || e.gamma == null) return; if (base === null) base = { b: e.beta, g: e.gamma }; const x = clamp((e.gamma - base.g) / 25, -1, 1), y = clamp((e.beta - base.b) / 25, -1, 1); gyroFns.forEach((f) => f(x, y)); };
    const start = () => addEventListener('deviceorientation', handler, { passive: true });
    if (typeof DeviceOrientationEvent.requestPermission === 'function') { const ask = () => { DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') start(); }).catch(() => {}); }; addEventListener('touchend', ask, { once: true }); }
    else start();
  }
  function onGyro(fn) { gyroFns.push(fn); }

  /* ---------------- WebGL mist (desktop only) ---------------- */
  function mist() {
    const canvas = $('#mist');
    if (!canvas) return;
    if (reduced || isMobile() || isTouch) { canvas.remove(); return; }
    let gl; try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch (e) { gl = null; }
    if (!gl) { canvas.remove(); return; }
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision mediump float;uniform vec2 r;uniform float t;uniform vec2 m;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
      void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=vec2(uv.x*r.x/r.y,uv.y);float tt=t*.035;
      float a=fbm(p*2.1+vec2(tt*1.3,tt*.35)+m*.06);float b=fbm(p*4.2-vec2(tt*.9,tt*.25)+a*.6);
      float d=smoothstep(.38,.9,a*.72+b*.34);float w=smoothstep(.95,.3,uv.y)*smoothstep(0.,.12,uv.y)*smoothstep(-.1,.35,uv.x+.2);
      vec3 col=mix(vec3(.52,.68,.86),vec3(.96,.98,1.),b);float al=d*w*.45;gl_FragColor=vec4(col*al,al);}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let w = 0, hgt = 0, visible = true, mx = 0, my = 0, tmx = 0, tmy = 0;
    const resize = () => { w = Math.max(2, Math.floor(canvas.clientWidth * .4)); hgt = Math.max(2, Math.floor(canvas.clientHeight * .4)); canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); };
    resize(); addEventListener('resize', resize);
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(canvas);
    addEventListener('mousemove', (e) => { tmx = e.clientX / innerWidth - .5; tmy = .5 - e.clientY / innerHeight; }, { passive: true });
    const start = performance.now();
    const frame = () => { if (visible && !document.hidden) { mx += (tmx - mx) * .04; my += (tmy - my) * .04; gl.uniform2f(uR, w, hgt); gl.uniform1f(uT, (performance.now() - start) / 1000); gl.uniform2f(uM, mx * 4, my * 4); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } requestAnimationFrame(frame); };
    frame();
  }

  /* ---------------- hero content ---------------- */
  let heroStarted = false;
  function startHeroContent(entering) {
    const h = $('#hero');
    if (!h || heroStarted) return;
    heroStarted = true;
    const lines = $$('.line__in', h), items = $$('[data-hero]', h), img = $('.hero__img', h), stats = $('.hero__stats', h);
    if (reduced) { gsap.set([items, stats], { opacity: 1 }); return; }
    gsap.timeline({ defaults: { ease: 'power4.out' }, delay: entering ? .15 : 0 })
      .fromTo(img, { scale: 1.26 }, { scale: 1.12, duration: 2.6, ease: 'power3.out' }, 0)
      .fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 1.25, stagger: .11 }, .1)
      .fromTo(items, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, stagger: .1 }, .5)
      .fromTo(stats, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1 }, .9)
      .call(() => ScrollTrigger.refresh(), null, 2.2)
      .to(img, { scale: 1.2, duration: 22, ease: 'none', yoyo: true, repeat: -1 }, 2.6);
    gsap.to('.hero__inner', { yPercent: 25, opacity: 0, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: '70% top', scrub: true } });
    gsap.to(img, { yPercent: 16, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: true } });
    const bg = $('#hero-bg');
    const bx = gsap.quickTo(bg, 'x', { duration: 1.6, ease: 'power3' }), by = gsap.quickTo(bg, 'y', { duration: 1.6, ease: 'power3' });
    const tx = gsap.quickTo('#hero-title', 'x', { duration: 1.4, ease: 'power3' });
    const apply = (x, y) => { bx(-x * 18); by(-y * 12); tx(x * 10); };
    if (finePointer) addEventListener('mousemove', (e) => apply(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5), { passive: true });
    onGyro((x, y) => apply(x * .8, y * .8));
    mist();
  }

  /* ---------------- inner page heroes ---------------- */
  function pageHero() {
    const h = $('.phero, .rhero');
    if (!h) return;
    const items = $$('[data-hero]', h);
    if (reduced) { gsap.set(items, { opacity: 1 }); const fb = $('#hero-heli'); if (fb) { fb.hidden = false; gsap.set(fb, { opacity: 1 }); } return; }
    const tl = gsap.timeline({ delay: .1, defaults: { ease: 'power4.out' } });
    tl.fromTo(items, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1, stagger: .1 }, .3);
    const img = $('.phero__bg img, .rhero__bg img', h);
    img && tl.fromTo(img, { scale: 1.15 }, { scale: 1, duration: 2.4, ease: 'power3.out' }, 0);
    tl.call(() => ScrollTrigger.refresh(), null, 1.6);
    const gift = $('#gift3d'); if (gift) gift3d(gift);
    const stageEl = $('#hero-stage');
    if (stageEl && h.classList.contains('rhero')) {
      let view = null;
      if (engine) { try { view = engine.addView(stageEl, { primary: true, pose: 'hero', poseOffset: isMobile() ? [0, .4, 0] : [1.6, 1.4, -1] }); engine.intro(view, { short: true }); } catch (e) { view = null; } }
      if (view) hookHero(view, h);
      else { const fb = $('#hero-heli'); if (fb) { fb.hidden = false; gsap.fromTo(fb, { opacity: 0, x: 300, y: 60, rotate: 8 }, { opacity: 1, x: 0, y: 0, rotate: 0, duration: 2.2, ease: 'power3.out' }); gsap.to(fb, { x: () => innerWidth * .4, y: -160, scale: .7, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: .5 } }); } }
    }
  }

  /* ---------------- showcase (3D turntable) ---------------- */
  function showcase() {
    const pin = $('#show-pin'), stageEl = $('#show-stage');
    if (!pin) return;
    const chapters = $$('.show__ch', pin), dots = $$('.show__dots i', pin);
    const setCh = (i) => { chapters.forEach((c, k) => c.classList.toggle('is-active', k === i)); dots.forEach((d, k) => d.classList.toggle('is-active', k === i)); };
    let view = null, progress = 0;
    if (!reduced) ScrollTrigger.create({ trigger: pin, start: 'top top', end: '+=280%', pin: true, scrub: .6, anticipatePin: 1, onUpdate: (s) => { progress = s.progress; view && view.setProgress(progress); setCh(Math.min(3, Math.floor(progress * 3.999))); } });
    if (engine && stageEl && !reduced) { try { view = engine.addView(stageEl, { primary: true, pose: 'showcase' }); view.setProgress(progress); window.__showView = view; } catch (e) { view = null; } }
    if (!view) { const fb = $('#show-fallback'); if (fb) fb.hidden = false; return; }
    dragOn(stageEl, view);
  }

  /* ---------------- flight log path ---------------- */
  function flightLog() {
    const track = $('#flight-track');
    if (!track) return;
    const svg = $('#flight-svg'), path = $('#flight-path'), bg = $('.flight__path--bg', svg), heli = $('#flight-heli');
    const nodes = [$('[data-node-start]', track), ...$$('.flight__node', track), $('[data-node-end]', track)].filter(Boolean);
    const catmull = (p) => { if (p.length < 2) return ''; let d = `M${p[0][0]},${p[0][1]}`; for (let i = 0; i < p.length - 1; i++) { const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2; const T = .45; const c1 = [p1[0] + (p2[0] - p0[0]) * T / 3, p1[1] + (p2[1] - p0[1]) * T / 3]; const c2 = [p2[0] - (p3[0] - p1[0]) * T / 3, p2[1] - (p3[1] - p1[1]) * T / 3]; d += `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`; } return d; };
    let len = 0;
    const build = () => { const tr = track.getBoundingClientRect(); const pts = nodes.map((n) => { const d = $('.flight__node-dot', n) || n; const r = d.getBoundingClientRect(); return [r.left + r.width / 2 - tr.left, r.top + r.height / 2 - tr.top]; }); const d = catmull(pts); path.setAttribute('d', d); bg.setAttribute('d', d); svg.setAttribute('viewBox', `0 0 ${tr.width} ${tr.height}`); len = path.getTotalLength(); path.style.strokeDasharray = len; path.style.strokeDashoffset = len; };
    build();
    let lastP = -1;
    const update = (pr) => { if (!len) return; path.style.strokeDashoffset = len * (1 - pr); const pt = path.getPointAtLength(len * pr), pt2 = path.getPointAtLength(Math.min(len, len * pr + 3)); const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI + 90; gsap.set(heli, { x: pt.x - 27, y: pt.y - 27, rotation: ang, opacity: pr > .004 && pr < .996 ? 1 : 0 }); lastP = pr; };
    if (reduced) { path.style.strokeDashoffset = 0; return; }
    ScrollTrigger.create({ trigger: track, start: 'top 62%', end: 'bottom 55%', scrub: .5, onUpdate: (s) => update(s.progress), onRefresh: (s) => { build(); update(s.progress); } });
    addEventListener('load', () => { build(); if (lastP >= 0) update(lastP); });
  }

  /* ---------------- map ---------------- */
  function mapSection() {
    const wrap = $('#map-wrap');
    if (!wrap) return;
    const svg = $('.map', wrap), pins = $$('.map-pin', svg), paths = $$('.map-route', svg), heli = $('.map__heli', svg), card = $('#mapcard');
    paths.forEach((p) => { const l = p.getTotalLength(); p.dataset.len = l; if (!p.classList.contains('map-route--dest')) { p.style.strokeDasharray = l; p.style.strokeDashoffset = l; } });
    let heliTween = null, timer = null, userAt = 0, active = null;
    const fillCard = (key) => {
      if (!card) return;
      const r = HH.routes.find((x) => x.slug === key), d = HH.dests.find((x) => x.slug === key);
      const it = r || d; if (!it) return;
      card.classList.remove('is-switching'); void card.offsetWidth; card.classList.add('is-switching');
      card.style.setProperty('--pin', r ? r.color : '#bfe1ff');
      $('.mapcard__kind', card).textContent = r ? HH.mapText.base : HH.mapText.custom;
      $('.mapcard__title', card).textContent = r ? r.title : d.name;
      $('.mapcard__meta', card).textContent = r ? `${r.duration} ${HH.common.min}${r.ground ? ' + ' + r.ground + ' ' + HH.common.min : ''}${r.landing ? ' · ' + fmt(r.landing) + ' ' + HH.common.metres : ''}` : `~${d.km} ${HH.common.metres === 'm' ? 'km' : 'км'} ${HH.mapText.km}`;
      $('.mapcard__desc', card).textContent = r ? r.format : d.desc;
      $('.mapcard__price', card).textContent = r ? r.priceText : HH.mapText.onRequest;
      const link = $('.mapcard__link', card);
      if (r) { link.href = r.url; link.removeAttribute('target'); $('.btn__label', link).textContent = HH.mapText.details; }
      else { link.href = `${HH.whatsapp}?text=${encodeURIComponent(HH.booking.waCustom)}`; link.target = '_blank'; link.rel = 'noopener'; $('.btn__label', link).textContent = HH.mapText.discuss; }
    };
    const activate = (key, fly = true) => {
      if (!key || key === active) return;
      active = key;
      pins.forEach((p) => p.classList.toggle('is-active', p.dataset.key === key));
      paths.forEach((p) => p.classList.toggle('is-active', p.dataset.key === key));
      fillCard(key);
      const path = paths.find((p) => p.dataset.key === key);
      if (!path || reduced) return;
      if (path.classList.contains('map-route--dest')) gsap.fromTo(path, { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 1.2, ease: 'none' });
      if (!fly || !heli) return;
      heliTween && heliTween.kill();
      gsap.set(heli, { opacity: 1 });
      heliTween = gsap.to(heli, { duration: 3.2, ease: 'power1.inOut', motionPath: { path, align: path, alignOrigin: [.5, .5], autoRotate: 90 }, onComplete: () => gsap.to(heli, { opacity: 0, duration: .5 }) });
    };
    const routeKeys = pins.filter((p) => p.dataset.kind === 'route').map((p) => p.dataset.key);
    const allKeys = pins.map((p) => p.dataset.key);
    let inView = false;
    const cycle = () => { clearTimeout(timer); timer = setTimeout(() => { if (inView && Date.now() - userAt > 9000 && !document.hidden) { const keys = card ? allKeys : routeKeys; const i = keys.indexOf(active); activate(keys[(i + 1) % keys.length]); } cycle(); }, 5200); };
    pins.forEach((p) => { const go = () => { userAt = Date.now(); activate(p.dataset.key); }; p.addEventListener('click', go); p.addEventListener('mouseenter', go); p.addEventListener('focus', go); p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); });
    ScrollTrigger.create({ trigger: wrap, start: 'top 80%', end: 'bottom 10%', onToggle: (s) => { inView = s.isActive; }, onEnter: () => { if (!wrap.dataset.drawn) { wrap.dataset.drawn = '1'; paths.filter((p) => !p.classList.contains('map-route--dest')).forEach((p, i) => gsap.to(p, { strokeDashoffset: 0, duration: 1.8, delay: i * .25, ease: 'power2.inOut' })); gsap.fromTo(pins, { opacity: 0, scale: .4, transformOrigin: 'center' }, { opacity: 1, scale: 1, duration: .7, stagger: .07, delay: .5, ease: 'back.out(2)' }); setTimeout(() => activate(routeKeys[0] || allKeys[0]), 900); cycle(); } } });
  }

  /* ---------------- custom destinations chips ---------------- */
  function custom() {
    const sec = $('#custom'); if (!sec) return;
    const chips = $$('.chip', sec), minis = $$('.custom__mini', sec), desc = $('#custom-desc'), km = $('#custom-km');
    if (!chips.length) return;
    let i = 0, timer, userAt = 0, inView = false;
    const set = (n) => { i = n; chips.forEach((c, k) => c.classList.toggle('is-active', k === n)); minis.forEach((m) => m.classList.toggle('is-active', m.dataset.dest === chips[n].dataset.dest)); if (km) km.textContent = chips[n].dataset.km || ''; if (desc && !reduced) gsap.fromTo(desc, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', onStart: () => { desc.textContent = chips[n].dataset.desc; } }); else if (desc) desc.textContent = chips[n].dataset.desc; };
    chips.forEach((c, k) => c.addEventListener('click', () => { userAt = Date.now(); set(k); }));
    const cycle = () => { timer = setTimeout(() => { if (inView && Date.now() - userAt > 8000 && !document.hidden) set((i + 1) % chips.length); cycle(); }, 5000); };
    ScrollTrigger.create({ trigger: sec, start: 'top 80%', end: 'bottom 20%', onToggle: (s) => { inView = s.isActive; } });
    cycle();
  }

  /* ---------------- FAQ ---------------- */
  function faq() {
    $$('.faq__item').forEach((d) => {
      const s = $('summary', d), a = $('.faq__a', d), inner = $('.faq__inner', d);
      s.addEventListener('click', (e) => { e.preventDefault(); const open = d.classList.contains('is-open'); if (open) { d.classList.remove('is-open'); gsap.to(a, { height: 0, duration: .5, ease: 'power3.inOut', onComplete: () => d.removeAttribute('open') }); } else { d.setAttribute('open', ''); d.classList.add('is-open'); gsap.fromTo(a, { height: 0 }, { height: inner.offsetHeight, duration: .6, ease: 'power3.inOut', onComplete: () => { a.style.height = 'auto'; } }); } });
    });
  }

  /* ---------------- altimeter / progress / mobile bar ---------------- */
  function scrollWidgets() {
    const alt = $('#altimeter'), altV = $('[data-alt-value]'), ticks = $('.altimeter__ticks'), prog = $('#progress span'), mbar = $('#mbar');
    let max = 1;
    const measure = () => { max = Math.max(1, doc.scrollHeight - innerHeight); };
    measure(); addEventListener('resize', measure); addEventListener('load', measure);
    let raf = false, ly = 0;
    onScroll((y) => { ly = y; if (raf) return; raf = true; requestAnimationFrame(() => { raf = false; const p = clamp(ly / max, 0, 1); prog && (prog.style.transform = `scaleX(${p})`); if (alt) { alt.classList.toggle('is-visible', ly > 240); altV.textContent = fmt(800 + p * 2700); ticks.style.setProperty('--tape', `${-(p * 330) % 55}px`); } mbar && mbar.classList.toggle('is-visible', ly > innerHeight * .55); }); });
  }

  /* ---------------- price maths (3 window seats + 1 middle) ---------------- */
  function allocate(n, type) {
    n = clamp(n, 1, 4);
    if (type === 'whole') return { w: 3, m: 1, whole: true };
    if (type === 'middle') return { w: n - 1, m: 1, whole: n === 4 };
    return { w: Math.min(n, 3), m: Math.max(0, n - 3), whole: n === 4 };
  }
  function seatWord(n) { const w = (HH.booking.seatsWord || ['seat', 'seats', 'seats']); if (HH.lang === 'ru') { const a = n % 10, b = n % 100; return (a === 1 && b !== 11) ? w[0] : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? w[1] : w[2]; } return n === 1 ? w[0] : w[1]; }
  function money(n) { return `${fmt(n)} ${HH.currency}`; }

  /* ---------------- booking sheet ---------------- */
  const bk = $('#booking');
  let bkStep = 1;
  function openBooking(opts = {}) {
    if (!bk) return;
    const form = $('#bform', bk), sheet = $('.bk__sheet', bk);
    form.reset();
    $('.bk__success', bk).hidden = true; $$('.bk__step', bk).forEach((s) => { s.hidden = false; }); $('.bk__error', bk).hidden = true; $('.bk__foot', bk).hidden = false;
    if (opts.route) { const r = $(`input[name=route][value="${opts.route}"]`, form); if (r) r.checked = true; }
    if (opts.seat) { const s = $(`input[name=seatType][value="${opts.seat}"]`, form); if (s) s.checked = true; }
    if (opts.seats) $('input[name=seats]', form).value = clamp(parseInt(opts.seats, 10) || 1, 1, 4);
    gotoStep(opts.route ? 2 : 1);
    bk.classList.add('is-open'); bk.setAttribute('aria-hidden', 'false');
    lockScroll(true);
    setTimeout(() => { const f = $('.bk__step.is-active input:not([type=radio]):not(.hp)', form) || $('.bk__step.is-active input', form); f && f.focus({ preventScroll: true }); }, 380);
    sheet.scrollTop = 0;
  }
  function closeBooking() { if (!bk || !bk.classList.contains('is-open')) return; bk.classList.remove('is-open'); bk.setAttribute('aria-hidden', 'true'); lockScroll(false); }
  function selectedRoute() { return $('input[name=route]:checked', bk); }
  function gotoStep(n) {
    bkStep = n;
    const sheet = $('.bk__sheet', bk);
    sheet.dataset.step = n;
    $$('.bk__step', bk).forEach((s) => s.classList.toggle('is-active', +s.dataset.step === n));
    $('[data-progress]', bk).style.width = `${(n / 3) * 100}%`;
    $('[data-step-label]', bk).textContent = (HH.stepOf || 'Step {a} / {b}').replace('{a}', n).replace('{b}', 3);
    $('[data-prev]', bk).hidden = n === 1;
    $('[data-next]', bk).hidden = n === 3;
    $('[data-submit]', bk).hidden = n !== 3;
    updateSummary();
    const form = $('.bk__form', bk); form.scrollTo({ top: 0, behavior: 'smooth' });
    if (!reduced) gsap.fromTo($('.bk__step.is-active', bk), { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: .45, ease: 'power3.out' });
  }
  function updateSummary() {
    const r = selectedRoute(), b = HH.booking;
    const img = $('[data-summary-img]', bk), title = $('[data-summary-title]', bk), meta = $('[data-summary-meta]', bk), box = $('[data-calc-box]', bk), lines = $('[data-calc-lines]', bk), prepay = $('[data-prepay]', bk);
    if (!r) { title.textContent = b.pickRoute; meta.textContent = ''; box.hidden = true; return; }
    title.textContent = r.dataset.title; meta.textContent = r.dataset.meta || '';
    if (r.dataset.img && !img.src.includes(`/${r.dataset.img}-480`)) { img.style.opacity = 0; img.onload = () => { img.style.opacity = 1; }; img.src = `${HH.assets || ''}/assets/img/${r.dataset.img}-480.webp`; }
    const isType = r.value.startsWith('type:');
    const segs = $$('input[name=seatType]', bk), seatsInput = $('input[name=seats]', bk);
    const wholeOnly = r.dataset.wholeOnly === '1';
    segs.forEach((s) => { s.disabled = wholeOnly && s.value !== 'whole'; });
    if (wholeOnly) $('input[name=seatType][value=whole]', bk).checked = true;
    const type = ($('input[name=seatType]:checked', bk) || {}).value;
    if (type === 'whole') seatsInput.value = 4;
    seatsInput.disabled = type === 'whole';
    const seats = clamp(parseInt(seatsInput.value, 10) || 1, 1, 4);
    if (isType) { box.hidden = true; return; }
    const W = +r.dataset.window || 0, M = +r.dataset.middle || 0, route = (HH.routes || []).find((x) => x.slug === r.dataset.slug) || {};
    const WH = +r.dataset.whole || route.whole || (W * 3 + M);
    const a = allocate(seats, type);
    const parts = [];
    let total;
    if (a.whole) { total = WH; parts.push(`${b.wholeCalc}: ${money(WH)}`); if (!route.wholeDefined && !r.dataset.whole) parts.push(`3 × ${fmt(W)} + 1 × ${fmt(M)}`); parts.push(`${money(Math.round(WH / 4))} ${b.perSeatCalc}`); }
    else { total = a.w * W + a.m * M; if (a.w) parts.push(`${a.w} × ${b.windowSeats} × ${fmt(W)} = ${money(a.w * W)}`); if (a.m) parts.push(`${a.m} × ${b.middleSeats} × ${fmt(M)} = ${money(a.m * M)}`); }
    box.hidden = false;
    lines.textContent = parts.join(' · ');
    $('[data-total]', box).textContent = money(total);
    prepay.textContent = `${b.prepay} ${b.prepayPct || 30}%: ${money(Math.round(total * (b.prepayPct || 30) / 100))}`;
  }
  function booking() {
    if (!bk) return;
    const form = $('#bform', bk);
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]');
      if (b) { e.preventDefault(); openBooking({ route: b.dataset.bookRoute, seat: b.dataset.bookSeat, seats: b.dataset.bookSeats }); return; }
      if (e.target.closest('#booking [data-close]')) closeBooking();
    });
    $('[data-next]', bk).addEventListener('click', () => { if (bkStep === 1 && !selectedRoute()) { gsap.fromTo('.bk__routes', { x: -8 }, { x: 0, duration: .5, ease: 'elastic.out(1,.3)' }); return; } gotoStep(Math.min(3, bkStep + 1)); });
    $('[data-prev]', bk).addEventListener('click', () => gotoStep(Math.max(1, bkStep - 1)));
    form.addEventListener('change', (e) => { if (['route', 'seatType', 'seats'].includes(e.target.name)) updateSummary(); });
    form.addEventListener('input', (e) => { if (e.target.name === 'seats') updateSummary(); });
    $$('.stepper__btn', form).forEach((b) => b.addEventListener('click', () => { const i = $('input[name=seats]', form); if (i.disabled) return; i.value = clamp((parseInt(i.value, 10) || 1) + +b.dataset.step, 1, 4); updateSummary(); }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('input[name=phone]', form);
      if (phone.value.replace(/\D/g, '').length < 7) { phone.classList.add('is-invalid'); phone.focus(); return; }
      phone.classList.remove('is-invalid');
      const r = selectedRoute(); const fd = new FormData(form);
      const isType = r && r.value.startsWith('type:');
      const seatsVal = $('input[name=seats]', form).value;
      const total = $('[data-total]', bk) ? $('[data-total]', bk).textContent : '';
      const payload = { lang: HH.lang, page: location.pathname, type: isType ? r.value.slice(5) : (fd.get('seatType') === 'whole' ? 'whole' : 'flight'), route: r ? r.dataset.title : '', date: fd.get('date') || '', seats: isType ? '' : seatsVal, seatType: isType ? '' : fd.get('seatType'), name: fd.get('name') || '', phone: phone.value, message: (fd.get('message') || '') + (!isType && total ? `\n[${HH.booking.total}: ${total}]` : ''), website: fd.get('website') || '' };
      const btn = $('[data-submit] .btn__label', bk); btn.textContent = btn.dataset.sending;
      let ok = false;
      try { const res = await fetch((HH.api || '') + '/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); ok = res.ok; } catch (err) { ok = false; }
      btn.textContent = btn.dataset.label;
      const wa = `${HH.whatsapp}?text=${encodeURIComponent(buildWaText(payload))}`;
      if (ok) { $$('.bk__step', bk).forEach((s) => { s.hidden = true; }); const s = $('.bk__success', bk); s.hidden = false; $('[data-wa-success]', s).href = wa; $('.bk__foot', bk).hidden = true; $('[data-progress]', bk).style.width = '100%'; }
      else { const er = $('.bk__error', bk); er.hidden = false; er.innerHTML = `${er.textContent} <a href="${wa}" target="_blank" rel="noopener" style="color:#c9ffdc;text-decoration:underline">WhatsApp →</a>`; }
    });
  }
  function buildWaText(p) {
    const b = HH.booking;
    let s = p.route ? b.waText.replace('{route}', '«' + p.route + '»') : b.waGeneric;
    const extra = [];
    if (p.date) extra.push(p.date);
    if (p.seats) extra.push(`${p.seats} × ${p.seatType === 'window' ? b.window : p.seatType === 'middle' ? b.middle : b.whole}`);
    if (p.name) extra.push(p.name);
    if (p.message) extra.push(p.message.replace(/\n/g, ' '));
    if (extra.length) s += '\n' + extra.join(' · ');
    return s;
  }

  /* ---------------- lightbox ---------------- */
  const lb = $('#lightbox');
  let lbItems = [], lbIndex = 0;
  function openLightbox(items, i) { if (!lb) return; lbItems = items; lbIndex = i; showLb(); lb.classList.add('is-open'); lb.setAttribute('aria-hidden', 'false'); lockScroll(true); }
  function showLb(dir = 0) { const img = $('.lightbox__img', lb), it = lbItems[lbIndex]; if (!it) return; const full = it.getAttribute('href'), alt = ($('img', it) || {}).alt || ''; if (dir && !reduced) gsap.fromTo(img, { opacity: 0, x: 40 * dir, scale: .96 }, { opacity: 1, x: 0, scale: 1, duration: .5, ease: 'power3.out' }); img.src = full; img.alt = alt; $('.lightbox__cap', lb).textContent = `${lbIndex + 1} / ${lbItems.length}`; }
  function closeLightbox() { if (!lb || !lb.classList.contains('is-open')) return; lb.classList.remove('is-open'); lb.setAttribute('aria-hidden', 'true'); lockScroll(false); }
  function lightbox() {
    if (!lb) return;
    document.addEventListener('click', (e) => { const a = e.target.closest('[data-lightbox]'); if (a) { e.preventDefault(); const g = a.closest('[data-gallery]') || document; const items = $$('[data-lightbox]', g); openLightbox(items, items.indexOf(a)); return; } if (e.target.closest('#lightbox [data-close]')) closeLightbox(); const n = e.target.closest('#lightbox [data-dir]'); if (n) { const d = +n.dataset.dir; lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; showLb(d); } });
    document.addEventListener('keydown', (e) => { if (!lb.classList.contains('is-open')) return; if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % lbItems.length; showLb(1); } if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length; showLb(-1); } });
    let sx = 0;
    lb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) { const d = dx < 0 ? 1 : -1; lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; showLb(d); } }, { passive: true });
  }

  /* ---------------- route page: seat picker + calculator ---------------- */
  function calculator() {
    const map = $('.pricebox .seatmap'); if (!map) return;
    const calc = $('#calc', map); if (!calc) return;
    const b = HH.booking;
    const W = +map.dataset.window || 0, M = +map.dataset.middle || 0, WH = +map.dataset.whole || (W * 3 + M), whDef = map.dataset.wholeDefined === '1';
    const seatsEls = $$('.seat:not(.seat--pilot)', map), btn = $('#book-seat'), quick = $$('.calc__q', calc);
    const row = (k) => $(`[data-c-row="${k}"]`, calc);
    const order = ['front', 'rl', 'rr', 'rm'];
    const update = () => {
      const sel = seatsEls.filter((s) => s.classList.contains('is-selected'));
      const nW = sel.filter((s) => s.dataset.type === 'window').length, nM = sel.filter((s) => s.dataset.type === 'middle').length, n = nW + nM;
      const whole = n === 4;
      const total = whole ? WH : nW * W + nM * M;
      row('window').hidden = !nW || whole; row('middle').hidden = !nM || whole; row('whole').hidden = !whole;
      if (nW) { $('[data-c-n]', row('window')).textContent = nW; $('[data-c-sum]', row('window')).textContent = money(nW * W); }
      if (nM) { $('[data-c-n]', row('middle')).textContent = nM; $('[data-c-sum]', row('middle')).textContent = money(nM * M); }
      $('[data-c-count]', calc).textContent = `${n} ${b.seatsOf}`;
      $('[data-c-total]', calc).textContent = n ? money(total) : '—';
      const sub = $('[data-c-sub]', calc);
      if (!n) { sub.hidden = false; sub.textContent = b.pick; }
      else { sub.hidden = false; sub.textContent = (whole ? `${money(Math.round(WH / 4))} ${b.perSeatCalc}${whDef ? '' : ' · ' + b.approxWhole}. ` : '') + `${b.prepay} ${b.prepayPct || 30}%: ${money(Math.round(total * (b.prepayPct || 30) / 100))}`; }
      quick.forEach((q) => q.classList.toggle('is-active', +q.dataset.q === n));
      if (btn) { btn.dataset.bookSeats = n || 1; btn.dataset.bookSeat = whole ? 'whole' : (nM && !nW ? 'middle' : 'window'); }
      if (!reduced && n) gsap.fromTo($('[data-c-total]', calc), { scale: 1.08 }, { scale: 1, duration: .5, ease: 'back.out(2)', transformOrigin: 'right center' });
    };
    const setSeat = (s, on) => { s.classList.toggle('is-selected', on); s.setAttribute('aria-checked', on); };
    seatsEls.forEach((s) => { const toggle = () => { setSeat(s, !s.classList.contains('is-selected')); if (!reduced) gsap.fromTo(s, { scale: .85 }, { scale: 1, duration: .5, ease: 'back.out(3)', transformOrigin: 'center' }); update(); }; s.addEventListener('click', toggle); s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }); });
    quick.forEach((q) => q.addEventListener('click', () => { const n = +q.dataset.q; seatsEls.forEach((s) => setSeat(s, order.indexOf(s.dataset.seat) < n)); update(); }));
    update();
  }
  function altitudeChart() {
    const chart = $('.alt'); if (!chart) return;
    const line = $('.alt__line', chart), area = $('.alt__area', chart), wps = $$('.alt__wp', chart), heli = $('.alt__heli', chart);
    const len = line.getTotalLength(); line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
    if (reduced) { line.style.strokeDashoffset = 0; area.style.opacity = 1; return; }
    ScrollTrigger.create({ trigger: chart, start: 'top 85%', once: true, onEnter: () => { gsap.to(line, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut' }); gsap.to(area, { opacity: 1, duration: 1.2, delay: .8 }); gsap.fromTo(wps, { opacity: 0, scale: .5, transformOrigin: 'center' }, { opacity: 1, scale: 1, duration: .5, stagger: .35, delay: .3, ease: 'back.out(2)' }); if (heli) { gsap.set(heli, { opacity: 1 }); gsap.to(heli, { duration: 2.2, ease: 'power2.inOut', motionPath: { path: line, align: line, alignOrigin: [.5, .5], autoRotate: true } }); } } });
  }

  /* ---------------- gift 3D card / CTA fly-by / extras ---------------- */
  function gift3d(wrap) {
    const card = $('.gift3d__card', wrap); if (!card || reduced) return;
    const rx = gsap.quickTo(card, 'rotateX', { duration: .6, ease: 'power3' }), ry = gsap.quickTo(card, 'rotateY', { duration: .6, ease: 'power3' });
    gsap.set(card, { transformPerspective: 1200 });
    const apply = (px, py) => { ry(px * 22); rx(-py * 22); card.style.setProperty('--sx', `${50 + px * 80}%`); card.style.setProperty('--sy', `${50 + py * 80}%`); };
    if (finePointer) { wrap.addEventListener('mousemove', (e) => { const r = card.getBoundingClientRect(); apply((e.clientX - r.left) / r.width - .5, (e.clientY - r.top) / r.height - .5); }); wrap.addEventListener('mouseleave', () => apply(0, 0)); }
    onGyro((x, y) => apply(x * .6, y * .6));
    gsap.to(card, { y: -8, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }
  function ctaFly() { const h = $('.cta__heli'); if (!h || reduced) return; gsap.fromTo(h, { xPercent: -60 }, { xPercent: 340, ease: 'none', scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'bottom top', scrub: 1.2 } }); }
  function extras() {
    $$('.ticker, .gmarquee').forEach((m) => { const t = $('.ticker__track, .gmarquee__track', m); if (!t) return; new IntersectionObserver((en) => { t.style.animationPlayState = en[0].isIntersecting ? 'running' : 'paused'; }).observe(m); });
    if (location.hash && location.hash !== '#booking') setTimeout(() => scrollTo(location.hash), 900);
    if (location.hash === '#booking') setTimeout(() => openBooking({}), 900);
  }

  /* ---------------- "how a flight goes" story ---------------- */
  function story() {
    const st = $('#story'); if (!st) return;
    const scenes = $$('.scene', st), phases = $$('.story__phase', st), prog = $('.story__prog b', st);
    const phaseOf = [0, 1, 1, 1, 1, 2, 3, 4, 5];
    const setPhase = (i) => phases.forEach((p, k) => p.classList.toggle('is-active', k === i));
    let soundOn = false;
    const snd = () => getAudio();
    const setSoundUI = () => $$('[data-story-sound]').forEach((b) => { b.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); const l = $('[data-snd-label]', b); if (l && HH.story) l.textContent = soundOn ? HH.story.soundOn : HH.story.soundOff; });
    $$('[data-story-sound]').forEach((b) => b.addEventListener('click', () => { const a = snd(); if (!a) return; if (!a.ready) { soundOn = a.unlock(); if (soundOn) a.click(); } else { soundOn = !soundOn; a.setMuted(!soundOn); if (soundOn) a.click(); } setSoundUI(); }));
    const beep = (f, d, v) => { const a = audio; if (soundOn && a && a.ready) a.beep(f, d, v); };
    const shutter = () => { const a = audio; if (soundOn && a && a.ready) { a.click(); a.beep(1800, .03, .08, .04); } };
    if (!reduced) ScrollTrigger.create({ trigger: st, start: 'top 60%', end: 'bottom 60%', onUpdate: (s) => { prog && (prog.style.transform = `scaleX(${s.progress})`); } });
    scenes.forEach((sc, i) => ScrollTrigger.create({ trigger: sc, start: 'top 55%', end: 'bottom 55%', onToggle: (s) => { if (s.isActive) setPhase(phaseOf[i] || 0); } }));
    if (reduced) { $$('.bubble,.phone__stamp,.wx__item,.wx__checks li,.meet__steps li,.crew__check,.pilot,.board__name,.board__notes li,.flightsc__ph,.polaroid,.fact,.retsc__steps li,.retsc__stars .ic', st).forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; el.classList.add('is-in'); }); return; }
    const once = (el, fn, start = 'top 70%') => ScrollTrigger.create({ trigger: el, start, once: true, onEnter: fn });
    const inSeq = (els, step = .35, cls = 'is-in') => els.forEach((el, i) => gsap.delayedCall(i * step, () => el.classList.add(cls)));
    const pop = (els, step = .12) => gsap.to(els, { opacity: 1, x: 0, y: 0, duration: .7, ease: 'power3.out', stagger: step });
    // 1 request: chat
    const chat = $('[data-anim="chat"]', st);
    if (chat) once(chat, () => {
      const bubbles = $$('.bubble:not(.bubble--typing)', chat), typing = $('[data-typing]', chat), stamp = $('[data-stamp]', chat);
      let t = .2;
      bubbles.forEach((b) => { const isHH = !b.classList.contains('bubble--you'); if (isHH) { gsap.delayedCall(t, () => typing.classList.add('is-in')); t += .9; } gsap.delayedCall(t, () => { typing.classList.remove('is-in'); b.classList.add('is-in'); beep(isHH ? 1040 : 780, .06, .1); }); t += .9; });
      gsap.delayedCall(t + .2, () => { stamp.classList.add('is-in'); beep(1300, .12, .12); });
    });
    // 2 weather
    const wx = $('[data-anim="wx"]', st);
    if (wx) once(wx, () => { pop($$('.wx__item', wx)); gsap.to($$('.wx__checks li', wx), { opacity: 1, x: 0, duration: .6, stagger: .3, delay: .5, ease: 'power3.out', onStart: () => beep(900, .06, .08) }); });
    // 3 meet
    const meet = $('[data-anim="meet"]', st);
    if (meet) once(meet, () => pop($$('.meet__steps li', meet), .25));
    // 4 crew
    const crew = $('[data-anim="crew"]', st);
    if (crew) once(crew, () => { pop($$('.pilot', crew), .2); gsap.delayedCall(.6, () => inSeq($$('.crew__check', crew), .45)); $$('.crew__check', crew).forEach((c, i) => gsap.delayedCall(.6 + i * .45, () => beep(1100, .05, .07))); });
    // 5 board
    const board = $('[data-anim="board"]', st);
    if (board) once(board, () => { const seats = $$('.seat:not(.seat--pilot)', board), names = $$('.board__name', board); const order = ['front', 'rl', 'rm', 'rr']; order.forEach((id, i) => gsap.delayedCall(.3 + i * .5, () => { const s = seats.find((x) => x.dataset.seat === id); s && s.classList.add('is-selected'); names[i] && names[i].classList.add('is-in'); beep(820 + i * 60, .06, .08); })); gsap.to($$('.board__notes li', board), { opacity: 1, x: 0, duration: .6, stagger: .25, delay: 1.2, ease: 'power3.out' }); });
    // 6 start: scrubbed spool-up
    const start = $('[data-anim="start"]', st);
    if (start) {
      const slot = $('[data-v3d]', start), stages = $$('.startsc__stages li', start), g1 = $('[data-gauge="n1"]', start), g2 = $('[data-gauge="nr"]', start);
      const o = { p: 0 }; let lastStage = -1;
      const apply = () => {
        const p = o.p, v = slot && slot.__view;
        const rpm = clamp(p / .8, 0, 1);
        if (v) { v.st.rpm = rpm; v.st.lightsOn = p > .05; v.pos.y = Math.max(0, (p - .86) / .14) * 1.2; v.st.shadow = .8 * (1 - Math.max(0, (p - .86) / .14)); v.invalidate(); }
        setGauge(g1, rpm * 100); setGauge(g2, clamp((rpm - .1) / .9, 0, 1) * 100);
        const stage = p < .05 ? -1 : p < .2 ? 0 : p < .35 ? 1 : p < .6 ? 2 : p < .86 ? 3 : 4;
        stages.forEach((li, i) => li.classList.toggle('is-on', i <= stage));
        if (stage !== lastStage) { lastStage = stage; if (stage >= 0) beep(700 + stage * 120, .07, .09); }
        if (soundOn && audio && audio.ready) audio.setRPM(rpm);
      };
      ScrollTrigger.create({ trigger: start.closest('.scene'), start: 'top 40%', end: 'bottom 60%', scrub: .6, onUpdate: (s) => { o.p = s.progress; apply(); }, onLeave: () => { if (audio && audio.ready) audio.setRPM(0); }, onLeaveBack: () => { if (audio && audio.ready) audio.setRPM(0); } });
    }
    // 7 flight: route draws, marker flies, clock + altitude
    const fl = $('[data-anim="flight"]', st);
    if (fl) {
      const path = $('.map-route', fl), heli = $('.map__heli', fl), clock = $('[data-clock]', fl), altEl = $('[data-alt-story]', fl), logs = $$('.flightsc__log li', fl), phs = $$('.flightsc__ph', fl);
      const len = path ? path.getTotalLength() : 0; if (path) { path.style.strokeDasharray = len; path.style.strokeDashoffset = len; path.classList.add('is-active'); }
      const alts = [800, 1400, 2100, 2800, 3300, 3500];
      ScrollTrigger.create({ trigger: fl.closest('.scene'), start: 'top 45%', end: 'bottom 65%', scrub: .5, onUpdate: (s) => {
        const p = s.progress;
        if (path) { path.style.strokeDashoffset = len * (1 - p * .55); if (heli) { const pt = path.getPointAtLength(len * p * .55), pt2 = path.getPointAtLength(Math.min(len, len * p * .55 + 2)); const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI + 90; gsap.set(heli, { x: pt.x, y: pt.y, rotation: ang, opacity: p > .01 ? 1 : 0, transformOrigin: '0 0' }); } }
        const mins = Math.round(p * 30); if (clock) clock.textContent = `0:${String(mins).padStart(2, '0')}`;
        const ai = p * (alts.length - 1), a0 = alts[Math.floor(ai)], a1 = alts[Math.min(alts.length - 1, Math.ceil(ai))]; if (altEl) altEl.textContent = fmt(a0 + (a1 - a0) * (ai % 1));
        logs.forEach((li, i) => li.classList.toggle('is-on', p >= i / logs.length));
        phs.forEach((ph, i) => ph.classList.toggle('is-in', p >= .25 + i * .25));
      } });
    }
    // 8 landing: rotor winds down, polaroids
    const land = $('[data-anim="landing"]', st);
    if (land) {
      const slot = $('[data-v3d]', land);
      once(land, () => { pop($$('.fact', land), .2); $$('.polaroid', land).forEach((p, i) => gsap.delayedCall(.8 + i * .6, () => { p.classList.add('is-in'); shutter(); })); });
      ScrollTrigger.create({ trigger: land.closest('.scene'), start: 'top 60%', end: 'center 40%', scrub: .5, onUpdate: (s) => { const v = slot && slot.__view; if (v) { v.st.rpm = 1 - s.progress; v.st.lightsOn = true; v.invalidate(); } } });
    }
    // 9 return
    const ret = $('[data-anim="return"]', st);
    if (ret) once(ret, () => { $$('.polaroid', ret).forEach((p, i) => gsap.delayedCall(.2 + i * .5, () => { p.classList.add('is-in'); shutter(); })); pop($$('.retsc__steps li', ret), .25); gsap.to($$('.retsc__stars .ic', ret), { opacity: 1, scale: 1, duration: .5, stagger: .12, delay: 1.6, ease: 'back.out(3)' }); });
  }

  /* ---------------- init ---------------- */
  function mount3d() {
    if (!engine) return;
    mountViews(); applySnapshots();
  }
  async function init() {
    initLenis(); transitions(); nav(); cursor(); initGyro(); booking(); lightbox(); faq(); calculator(); scrollWidgets();
    if ($('#hero') && !reduced) gsap.set('.hero__stats', { opacity: 0 });
    const afterIntro = () => {
      mount3d();
      reveals(); flightLog(); mapSection(); custom(); altitudeChart(); ctaFly(); magnetic(); tilt(); glare(); extras(); showcase(); story();
      ScrollTrigger.refresh();
      addEventListener('load', () => ScrollTrigger.refresh());
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    };
    if (HH.page === 'home') { introHome().then(afterIntro); }
    else { await introInner(); pageHero(); afterIntro(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
