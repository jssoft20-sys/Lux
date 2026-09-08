/* =========================================================
   HeliHop — front-end animation & interaction layer
   GSAP 3.13 (ScrollTrigger, MotionPath, SplitText) + Lenis
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
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hasGsap = typeof gsap !== 'undefined';
  if (!hasGsap) { doc.classList.add('js-failed'); return; }
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
  function lockScroll(lock) {
    if (lenis) { lock ? lenis.stop() : lenis.start(); }
    doc.style.overflow = lock ? 'hidden' : '';
  }

  /* ---------------- preloader ---------------- */
  function preloader() {
    const el = $('#preloader');
    const returning = doc.classList.contains('is-returning');
    let entering = false;
    try { entering = sessionStorage.getItem('hh-transition') === '1'; sessionStorage.removeItem('hh-transition'); sessionStorage.setItem('hh-seen', '1'); } catch (e) { /* private mode */ }
    return new Promise((resolve) => {
      if (!el || returning || reduced) {
        el && el.remove();
        setTimeout(resolve, entering ? 420 : 0);
        return;
      }
      lockScroll(true);
      const num = $('[data-alt]', el), bar = $('.preloader__bar span', el);
      const o = { v: 0 };
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      gsap.timeline({ onComplete: () => { el.remove(); lockScroll(false); done(); } })
        .to(o, { v: 3500, duration: 1.5, ease: 'power3.inOut', onUpdate: () => { num.textContent = fmt(o.v); } }, 0)
        .to(bar, { scaleX: 1, duration: 1.5, ease: 'power3.inOut' }, 0)
        .to('.preloader__inner', { opacity: 0, y: -20, duration: .5, ease: 'power2.in' }, 1.45)
        .to(el, { clipPath: 'inset(0 0 100% 0)', duration: .95, ease: 'power4.inOut', onStart: () => { lockScroll(false); setTimeout(done, 250); } }, 1.65);
      setTimeout(() => { if (!resolved) { el.remove(); lockScroll(false); done(); } }, 6000);
    });
  }

  /* ---------------- page transitions ---------------- */
  function transitions() {
    const curtain = $('#curtain');
    if (!curtain) return;
    let entering = false;
    try { entering = sessionStorage.getItem('hh-entering') === '1'; sessionStorage.removeItem('hh-entering'); } catch (e) { /* noop */ }
    if (entering && !reduced) { curtain.classList.add('is-active'); gsap.set(curtain, { y: 0 }); gsap.to(curtain, { y: '-101%', duration: .9, ease: 'power4.inOut', delay: .05, onComplete: () => curtain.classList.remove('is-active') }); }
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
      try { sessionStorage.setItem('hh-transition', '1'); sessionStorage.setItem('hh-entering', '1'); } catch (err) { /* noop */ }
      closeMenu();
      curtain.classList.add('is-active');
      gsap.set(curtain, { y: '101%' });
      gsap.to(curtain, { y: 0, duration: .7, ease: 'power4.inOut', onComplete: () => { location.href = u.href; } });
      setTimeout(() => { location.href = u.href; }, 1600);
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
    $$('.lang').forEach((l) => {
      const b = $('.lang__btn', l);
      b.addEventListener('click', (e) => { e.stopPropagation(); const open = l.classList.toggle('is-open'); b.setAttribute('aria-expanded', open); });
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.lang')) $$('.lang.is-open').forEach((l) => { l.classList.remove('is-open'); $('.lang__btn', l).setAttribute('aria-expanded', 'false'); }); });
    // remember language choice
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
    // split headings
    $$('[data-split]').forEach((el) => {
      if (el.closest('.hero')) return;
      try {
        SplitText.create(el, {
          type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true,
          onSplit(self) {
            return gsap.from(self.lines, { yPercent: 110, opacity: 0, duration: 1.15, ease: 'power4.out', stagger: .09, scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
          },
        });
      } catch (e) { el.style.opacity = 1; }
    });
    const handled = new Set();
    const fromFor = (el) => {
      const v = el.dataset.reveal;
      if (v === 'scale') return { opacity: 0, y: 34, scale: .94 };
      if (v === 'left') return { opacity: 0, x: -50 };
      if (v === 'right') return { opacity: 0, x: 50 };
      return { opacity: 0, y: 40 };
    };
    $$('[data-stagger]').forEach((box) => {
      const kids = $$('[data-reveal]', box).filter((k) => !handled.has(k));
      if (!kids.length) return;
      kids.forEach((k) => handled.add(k));
      gsap.fromTo(kids, fromFor(kids[0]), { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.05, ease: 'power3.out', stagger: .09, clearProps: 'transform', scrollTrigger: { trigger: box, start: 'top 88%', once: true } });
    });
    $$('[data-reveal]').forEach((el) => {
      if (handled.has(el)) return;
      gsap.fromTo(el, fromFor(el), { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.05, ease: 'power3.out', clearProps: 'transform', scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
    });
    $$('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const o = { v: 0 };
      gsap.to(o, { v: target, duration: 2.2, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v); }, scrollTrigger: { trigger: el, start: 'top 100%', once: true } });
    });
    $$('[data-parallax]').forEach((el) => {
      const s = parseFloat(el.dataset.parallax) || .2;
      gsap.fromTo(el, { yPercent: -s * 40 }, { yPercent: s * 40, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
  }

  /* ---------------- magnetic + tilt ---------------- */
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
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        gsap.to(el, { rotateY: px * 7, rotateX: -py * 7, transformPerspective: 1100, duration: .7, ease: 'power3' });
      });
      el.addEventListener('mouseleave', () => gsap.to(el, { rotateY: 0, rotateX: 0, duration: .9, ease: 'power3' }));
    });
  }

  /* ---------------- device orientation (mobile parallax) ---------------- */
  const gyroFns = [];
  function initGyro() {
    if (!isTouch || reduced || !('DeviceOrientationEvent' in window)) return;
    let base = null;
    const handler = (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (base === null) base = { b: e.beta, g: e.gamma };
      const x = clamp((e.gamma - base.g) / 25, -1, 1), y = clamp((e.beta - base.b) / 25, -1, 1);
      gyroFns.forEach((f) => f(x, y));
    };
    const start = () => addEventListener('deviceorientation', handler, { passive: true });
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const ask = () => { DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') start(); }).catch(() => {}); removeEventListener('touchend', ask); };
      addEventListener('touchend', ask, { once: true });
    } else start();
  }
  function onGyro(fn) { gyroFns.push(fn); }

  /* ---------------- WebGL mist ---------------- */
  function mist() {
    const canvas = $('#mist');
    if (!canvas || reduced) return;
    let gl;
    try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch (e) { gl = null; }
    if (!gl) { canvas.remove(); return; }
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision mediump float;uniform vec2 r;uniform float t;uniform vec2 m;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
      void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=vec2(uv.x*r.x/r.y,uv.y);float tt=t*.035;
      float a=fbm(p*2.1+vec2(tt*1.3,tt*.35)+m*.06);float b=fbm(p*4.2-vec2(tt*.9,tt*.25)+a*.6);
      float d=smoothstep(.38,.9,a*.72+b*.34);
      float w=smoothstep(.95,.3,uv.y)*smoothstep(0.,.12,uv.y)*smoothstep(-.1,.35,uv.x+.2);
      vec3 col=mix(vec3(.52,.68,.86),vec3(.96,.98,1.),b);float al=d*w*.5;gl_FragColor=vec4(col*al,al);}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let w = 0, hgt = 0, visible = true, mx = 0, my = 0, tmx = 0, tmy = 0;
    const resize = () => { const scale = isMobile() ? .35 : .5; w = Math.max(2, Math.floor(canvas.clientWidth * scale)); hgt = Math.max(2, Math.floor(canvas.clientHeight * scale)); canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); };
    resize(); addEventListener('resize', resize);
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(canvas);
    addEventListener('mousemove', (e) => { tmx = e.clientX / innerWidth - .5; tmy = .5 - e.clientY / innerHeight; }, { passive: true });
    onGyro((x, y) => { tmx = x * .5; tmy = -y * .5; });
    const start = performance.now();
    const frame = () => {
      if (visible && !document.hidden) {
        mx += (tmx - mx) * .04; my += (tmy - my) * .04;
        gl.uniform2f(uR, w, hgt); gl.uniform1f(uT, (performance.now() - start) / 1000); gl.uniform2f(uM, mx * 4, my * 4);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }

  /* ---------------- hero ---------------- */
  function hero(entering) {
    const h = $('#hero');
    if (!h) return;
    const lines = $$('.line__in', h), heli = $('#hero-heli'), heliP = $('#hero-heli-p'), items = $$('[data-hero]', h), img = $('.hero__img', h), stats = $('.hero__stats', h);
    if (reduced) { gsap.set([items, heli, stats], { opacity: 1 }); return; }
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' }, delay: entering ? .3 : 0 });
    tl.fromTo(img, { scale: 1.28 }, { scale: 1.12, duration: 2.6, ease: 'power3.out' }, 0)
      .fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 1.25, stagger: .11 }, .15)
      .fromTo(items, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, stagger: .1 }, .6)
      .fromTo(heli, { opacity: 0, x: 380, y: 90, rotate: 9, scale: .9 }, { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, duration: 2.4, ease: 'power3.out' }, .25)
      .fromTo(stats, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1 }, 1)
      .call(() => ScrollTrigger.refresh(), null, 2.3)
      .to(img, { scale: 1.2, duration: 22, ease: 'none', yoyo: true, repeat: -1 }, 2.6);
    // scroll-driven: content parachutes away, helicopter flies off, background drifts
    gsap.to('.hero__inner', { yPercent: 25, opacity: 0, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: '70% top', scrub: true } });
    gsap.to(heli, { x: () => innerWidth * .55, y: () => -innerHeight * .35, scale: .55, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: .5 } });
    gsap.to(img, { yPercent: 16, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: true } });
    // pointer / gyro parallax
    const bg = $('#hero-bg');
    const bx = gsap.quickTo(bg, 'x', { duration: 1.6, ease: 'power3' }), by = gsap.quickTo(bg, 'y', { duration: 1.6, ease: 'power3' });
    const hx = gsap.quickTo(heliP, 'x', { duration: 1.2, ease: 'power3' }), hy = gsap.quickTo(heliP, 'y', { duration: 1.2, ease: 'power3' });
    const tx = gsap.quickTo('#hero-title', 'x', { duration: 1.4, ease: 'power3' });
    const apply = (x, y) => { bx(-x * 18); by(-y * 12); hx(x * 46); hy(y * 30); tx(x * 10); };
    if (finePointer) addEventListener('mousemove', (e) => apply(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5), { passive: true });
    onGyro((x, y) => apply(x * .8, y * .8));
    mist();
  }

  /* ---------------- inner page heroes ---------------- */
  function pageHero(entering) {
    const h = $('.phero, .rhero');
    if (!h) return;
    const items = $$('[data-hero]', h), heli = $('.rhero__heli', h);
    if (reduced) { gsap.set(items, { opacity: 1 }); heli && gsap.set(heli, { opacity: 1 }); return; }
    const tl = gsap.timeline({ delay: entering ? .3 : .1, defaults: { ease: 'power4.out' } });
    tl.fromTo(items, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1, stagger: .1 }, .3);
    if (heli) tl.fromTo(heli, { opacity: 0, x: 300, y: 60, rotate: 8 }, { opacity: 1, x: 0, y: 0, rotate: 0, duration: 2.2, ease: 'power3.out' }, .2);
    tl.call(() => ScrollTrigger.refresh(), null, 1.6);
    const img = $('.phero__bg img, .rhero__bg img', h);
    img && tl.fromTo(img, { scale: 1.15 }, { scale: 1, duration: 2.4, ease: 'power3.out' }, 0);
    if (heli) gsap.to(heli, { x: () => innerWidth * .4, y: -160, scale: .7, ease: 'none', scrollTrigger: { trigger: h, start: 'top top', end: 'bottom top', scrub: .5 } });
    const gift = $('#gift3d');
    if (gift) gift3d(gift);
  }

  /* ---------------- flight log path ---------------- */
  function flightLog() {
    const track = $('#flight-track');
    if (!track) return;
    const svg = $('#flight-svg'), path = $('#flight-path'), bg = $('.flight__path--bg', svg), heli = $('#flight-heli');
    const nodes = [$('[data-node-start]', track), ...$$('.flight__node', track), $('[data-node-end]', track)].filter(Boolean);
    const catmull = (p) => {
      if (p.length < 2) return '';
      let d = `M${p[0][0]},${p[0][1]}`;
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
        const T = 0.45;
        const c1 = [p1[0] + (p2[0] - p0[0]) * T / 3, p1[1] + (p2[1] - p0[1]) * T / 3];
        const c2 = [p2[0] - (p3[0] - p1[0]) * T / 3, p2[1] - (p3[1] - p1[1]) * T / 3];
        d += `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
      }
      return d;
    };
    let len = 0;
    const build = () => {
      const tr = track.getBoundingClientRect();
      const pts = nodes.map((n) => { const d = $('.flight__node-dot', n) || n; const r = d.getBoundingClientRect(); return [r.left + r.width / 2 - tr.left, r.top + r.height / 2 - tr.top]; });
      const d = catmull(pts);
      path.setAttribute('d', d); bg.setAttribute('d', d);
      svg.setAttribute('viewBox', `0 0 ${tr.width} ${tr.height}`);
      len = path.getTotalLength();
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
    };
    build();
    let lastP = -1;
    const update = (pr) => {
      if (!len) return;
      path.style.strokeDashoffset = len * (1 - pr);
      const pt = path.getPointAtLength(len * pr), pt2 = path.getPointAtLength(Math.min(len, len * pr + 3));
      const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI + 90;
      gsap.set(heli, { x: pt.x - 27, y: pt.y - 27, rotation: ang, opacity: pr > .004 && pr < .996 ? 1 : 0 });
      lastP = pr;
    };
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
    const data = (key) => HH.routes.find((r) => r.slug === key) || HH.dests.find((d) => d.slug === key);
    const fillCard = (key) => {
      if (!card) return;
      const r = HH.routes.find((x) => x.slug === key), d = HH.dests.find((x) => x.slug === key);
      const it = r || d; if (!it) return;
      card.classList.remove('is-switching'); void card.offsetWidth; card.classList.add('is-switching');
      card.style.setProperty('--pin', r ? r.color : '#8fd3ff');
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
      if (path.classList.contains('map-route--dest')) { gsap.fromTo(path, { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 1.2, ease: 'none' }); }
      if (!fly) return;
      heliTween && heliTween.kill();
      gsap.set(heli, { opacity: 1 });
      heliTween = gsap.to(heli, { duration: 3.2, ease: 'power1.inOut', motionPath: { path, align: path, alignOrigin: [.5, .5], autoRotate: 90 }, onComplete: () => gsap.to(heli, { opacity: 0, duration: .5 }) });
    };
    const routeKeys = pins.filter((p) => p.dataset.kind === 'route').map((p) => p.dataset.key);
    const allKeys = pins.map((p) => p.dataset.key);
    let inView = false;
    const cycle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (inView && Date.now() - userAt > 9000 && !document.hidden) {
          const keys = card ? allKeys : routeKeys;
          const i = keys.indexOf(active);
          activate(keys[(i + 1) % keys.length]);
        }
        cycle();
      }, 4800);
    };
    pins.forEach((p) => {
      const go = () => { userAt = Date.now(); activate(p.dataset.key); };
      p.addEventListener('click', go); p.addEventListener('mouseenter', go); p.addEventListener('focus', go);
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    ScrollTrigger.create({
      trigger: wrap, start: 'top 80%', end: 'bottom 10%',
      onToggle: (s) => { inView = s.isActive; },
      onEnter: () => {
        if (!wrap.dataset.drawn) {
          wrap.dataset.drawn = '1';
          paths.filter((p) => !p.classList.contains('map-route--dest')).forEach((p, i) => gsap.to(p, { strokeDashoffset: 0, duration: 1.8, delay: i * .25, ease: 'power2.inOut' }));
          gsap.fromTo(pins, { opacity: 0, scale: .4, transformOrigin: 'center' }, { opacity: 1, scale: 1, duration: .7, stagger: .07, delay: .5, ease: 'back.out(2)' });
          setTimeout(() => activate(routeKeys[0] || allKeys[0]), 900);
          cycle();
        }
      },
    });
  }

  /* ---------------- fleet horizontal ---------------- */
  function fleet() {
    const sec = $('#fleet'), track = $('#fleet-track');
    if (!sec || !track || reduced) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1025px)', () => {
      const dist = () => track.scrollWidth - innerWidth + 40;
      const tween = gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: sec, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: .8, anticipatePin: 1, invalidateOnRefresh: true } });
      return () => tween.kill();
    });
  }

  /* ---------------- custom destinations chips ---------------- */
  function custom() {
    const sec = $('#custom'); if (!sec) return;
    const chips = $$('.chip', sec), imgs = $$('.custom__img', sec), desc = $('#custom-desc');
    if (!chips.length) return;
    let i = 0, timer, userAt = 0, inView = false;
    const set = (n) => {
      i = n;
      chips.forEach((c, k) => c.classList.toggle('is-active', k === n));
      imgs.forEach((im) => im.classList.toggle('is-active', im.dataset.image === chips[n].dataset.image));
      if (desc && !reduced) gsap.fromTo(desc, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', onStart: () => { desc.textContent = chips[n].dataset.desc; } });
      else if (desc) desc.textContent = chips[n].dataset.desc;
    };
    chips.forEach((c, k) => c.addEventListener('click', () => { userAt = Date.now(); set(k); }));
    const cycle = () => { timer = setTimeout(() => { if (inView && Date.now() - userAt > 8000 && !document.hidden) set((i + 1) % chips.length); cycle(); }, 5000); };
    ScrollTrigger.create({ trigger: sec, start: 'top 80%', end: 'bottom 20%', onToggle: (s) => { inView = s.isActive; } });
    cycle();
  }

  /* ---------------- FAQ ---------------- */
  function faq() {
    $$('.faq__item').forEach((d) => {
      const s = $('summary', d), a = $('.faq__a', d), inner = $('.faq__inner', d);
      s.addEventListener('click', (e) => {
        e.preventDefault();
        const open = d.classList.contains('is-open');
        if (open) {
          d.classList.remove('is-open');
          gsap.to(a, { height: 0, duration: .5, ease: 'power3.inOut', onComplete: () => d.removeAttribute('open') });
        } else {
          d.setAttribute('open', '');
          d.classList.add('is-open');
          gsap.fromTo(a, { height: 0 }, { height: inner.offsetHeight, duration: .6, ease: 'power3.inOut', onComplete: () => { a.style.height = 'auto'; } });
        }
      });
    });
  }

  /* ---------------- altimeter / progress / mobile bar ---------------- */
  function scrollWidgets() {
    const alt = $('#altimeter'), altV = $('[data-alt-value]'), ticks = $('.altimeter__ticks'), prog = $('#progress span'), mbar = $('#mbar');
    let max = 1;
    const measure = () => { max = Math.max(1, doc.scrollHeight - innerHeight); };
    measure(); addEventListener('resize', measure); addEventListener('load', measure);
    let raf = false, ly = 0;
    onScroll((y) => {
      ly = y;
      if (raf) return; raf = true;
      requestAnimationFrame(() => {
        raf = false;
        const p = clamp(ly / max, 0, 1);
        prog && (prog.style.transform = `scaleX(${p})`);
        if (alt) { alt.classList.toggle('is-visible', ly > 240); altV.textContent = fmt(800 + p * 2700); ticks.style.setProperty('--tape', `${-(p * 330) % 55}px`); }
        mbar && mbar.classList.toggle('is-visible', ly > innerHeight * .55);
      });
    });
  }

  /* ---------------- booking modal ---------------- */
  const modal = $('#booking');
  let bookingStep = 1;
  function openBooking(opts = {}) {
    if (!modal) return;
    const form = $('#bform');
    form.reset();
    $('.bform__success', modal).hidden = true; form.hidden = false; $('.bform__error', form).hidden = true;
    if (opts.route) { const r = $(`input[name=route][value="${opts.route}"]`, form); if (r) r.checked = true; }
    if (opts.seat) { const s = $(`input[name=seatType][value="${opts.seat}"]`, form); if (s) s.checked = true; }
    if (opts.seats) { $('input[name=seats]', form).value = opts.seats; }
    gotoStep(opts.route ? 2 : 1);
    modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false');
    lockScroll(true);
    setTimeout(() => { const f = $('.bform__step.is-active input:not([type=radio]), .bform__step.is-active input[type=radio]', form); f && f.focus({ preventScroll: true }); }, 350);
  }
  function closeBooking() {
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true');
    lockScroll(false);
  }
  function gotoStep(n) {
    bookingStep = n;
    $$('.bform__step', modal).forEach((f) => f.classList.toggle('is-active', +f.dataset.step === n));
    $$('.steps__item', modal).forEach((s) => { const k = +s.dataset.step; s.classList.toggle('is-active', k === n); s.classList.toggle('is-done', k < n); });
    $('[data-prev]', modal).hidden = n === 1;
    $('[data-next]', modal).hidden = n === 3;
    $('[data-submit]', modal).hidden = n !== 3;
    if (n === 2) updateTotal();
    $('.modal__panel', modal).scrollTo({ top: 0, behavior: 'smooth' });
  }
  function selectedRoute() { const r = $('input[name=route]:checked', modal); return r || null; }
  function updateTotal() {
    const r = selectedRoute(), box = $('#bform-total', modal);
    if (!r || !box) return;
    const wholeOnly = r.dataset.wholeOnly === '1';
    const segs = $$('input[name=seatType]', modal);
    segs.forEach((s) => { s.disabled = wholeOnly && s.value !== 'whole'; s.parentElement.style.opacity = s.disabled ? .4 : 1; });
    if (wholeOnly) $('input[name=seatType][value=whole]', modal).checked = true;
    const type = ($('input[name=seatType]:checked', modal) || {}).value;
    const seats = clamp(parseInt($('input[name=seats]', modal).value, 10) || 1, 1, 8);
    let total = null;
    if (type === 'whole') total = r.dataset.whole ? +r.dataset.whole : null;
    else if (r.dataset[type]) total = +r.dataset[type] * seats;
    box.hidden = total == null;
    if (total != null) $('[data-total]', box).textContent = `${fmt(total)} ${HH.currency}`;
  }
  function booking() {
    if (!modal) return;
    const form = $('#bform');
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]');
      if (b) { e.preventDefault(); openBooking({ route: b.dataset.bookRoute, seat: b.dataset.bookSeat, seats: b.dataset.bookSeats }); return; }
      if (e.target.closest('#booking [data-close]')) closeBooking();
    });
    $('[data-next]', form).addEventListener('click', () => {
      if (bookingStep === 1 && !selectedRoute()) { gsap.fromTo('.choices', { x: -6 }, { x: 0, duration: .4, ease: 'elastic.out(1,.3)' }); return; }
      gotoStep(Math.min(3, bookingStep + 1));
    });
    $('[data-prev]', form).addEventListener('click', () => gotoStep(Math.max(1, bookingStep - 1)));
    form.addEventListener('change', (e) => { if (e.target.name === 'seatType' || e.target.name === 'seats' || e.target.name === 'route') updateTotal(); });
    $$('.stepper__btn', form).forEach((b) => b.addEventListener('click', () => { const i = $('input[name=seats]', form); i.value = clamp((parseInt(i.value, 10) || 1) + +b.dataset.step, 1, 8); updateTotal(); }));
    $$('input[name=route]', form).forEach((r) => r.addEventListener('change', () => { if (r.value.startsWith('type:')) { /* skip seats for non-flight types */ } }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('input[name=phone]', form);
      if (phone.value.replace(/\D/g, '').length < 7) { phone.classList.add('is-invalid'); phone.focus(); return; }
      phone.classList.remove('is-invalid');
      const r = selectedRoute();
      const fd = new FormData(form);
      const payload = {
        lang: HH.lang, page: location.pathname,
        type: r && r.value.startsWith('type:') ? r.value.slice(5) : (fd.get('seatType') === 'whole' ? 'whole' : 'flight'),
        route: r ? r.dataset.title : '', date: fd.get('date') || '', seats: r && r.value.startsWith('type:') ? '' : fd.get('seats'), seatType: r && r.value.startsWith('type:') ? '' : fd.get('seatType'),
        name: fd.get('name') || '', phone: phone.value, message: fd.get('message') || '', website: fd.get('website') || '',
      };
      const btn = $('[data-submit] .btn__label', form); btn.textContent = btn.dataset.sending;
      let ok = false;
      try { const res = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); ok = res.ok; } catch (err) { ok = false; }
      btn.textContent = btn.dataset.label;
      const wa = `${HH.whatsapp}?text=${encodeURIComponent(buildWaText(payload))}`;
      if (ok) {
        form.hidden = true; const s = $('.bform__success', modal); s.hidden = false; $('[data-wa-success]', s).href = wa;
      } else { const er = $('.bform__error', form); er.hidden = false; er.innerHTML = `${er.textContent} <a href="${wa}" target="_blank" rel="noopener" style="color:#c9ffdc;text-decoration:underline">WhatsApp →</a>`; }
    });
  }
  function buildWaText(p) {
    const b = HH.booking;
    let s = p.route ? b.waText.replace('{route}', '«' + p.route + '»') : b.waGeneric;
    const extra = [];
    if (p.date) extra.push(p.date);
    if (p.seats) extra.push(`${p.seats} × ${p.seatType === 'window' ? b.window : p.seatType === 'middle' ? b.middle : b.whole}`);
    if (p.name) extra.push(p.name);
    if (p.message) extra.push(p.message);
    if (extra.length) s += '\n' + extra.join(' · ');
    return s;
  }

  /* ---------------- lightbox ---------------- */
  const lb = $('#lightbox');
  let lbItems = [], lbIndex = 0;
  function openLightbox(items, i) {
    if (!lb) return;
    lbItems = items; lbIndex = i;
    showLb();
    lb.classList.add('is-open'); lb.setAttribute('aria-hidden', 'false'); lockScroll(true);
  }
  function showLb(dir = 0) {
    const img = $('.lightbox__img', lb), it = lbItems[lbIndex];
    if (!it) return;
    const full = it.getAttribute('href'), alt = ($('img', it) || {}).alt || '';
    if (dir && !reduced) gsap.fromTo(img, { opacity: 0, x: 40 * dir, scale: .96 }, { opacity: 1, x: 0, scale: 1, duration: .5, ease: 'power3.out' });
    img.src = full; img.alt = alt; $('.lightbox__cap', lb).textContent = `${lbIndex + 1} / ${lbItems.length}`;
  }
  function closeLightbox() { if (!lb || !lb.classList.contains('is-open')) return; lb.classList.remove('is-open'); lb.setAttribute('aria-hidden', 'true'); lockScroll(false); }
  function lightbox() {
    if (!lb) return;
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-lightbox]');
      if (a) { e.preventDefault(); const g = a.closest('[data-gallery]') || document; const items = $$('[data-lightbox]', g); openLightbox(items, items.indexOf(a)); return; }
      if (e.target.closest('#lightbox [data-close]')) closeLightbox();
      const n = e.target.closest('#lightbox [data-dir]');
      if (n) { const d = +n.dataset.dir; lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; showLb(d); }
    });
    document.addEventListener('keydown', (e) => { if (!lb.classList.contains('is-open')) return; if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % lbItems.length; showLb(1); } if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length; showLb(-1); } });
    let sx = 0;
    lb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) { const d = dx < 0 ? 1 : -1; lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; showLb(d); } }, { passive: true });
  }

  /* ---------------- route page: seats + altitude chart ---------------- */
  function seats() {
    const map = $('.seatmap');
    if (!map) return;
    const seatsEls = $$('.seat:not(.seat--pilot)', map), total = $('#seat-total'), btn = $('#book-seat');
    const update = () => {
      const sel = seatsEls.filter((s) => s.classList.contains('is-selected'));
      const sum = sel.reduce((a, s) => a + (+s.dataset.price || 0), 0);
      if (total) { total.hidden = !sel.length; $('[data-seat-count]', total).textContent = sel.length; $('[data-seat-total]', total).textContent = `${fmt(sum)} ${HH.currency}`; }
      if (btn) { btn.dataset.bookSeats = sel.length || 1; btn.dataset.bookSeat = sel.length && sel.every((s) => s.dataset.type === 'window') ? 'window' : (sel.length ? 'middle' : 'window'); }
    };
    seatsEls.forEach((s) => {
      const toggle = () => { s.classList.toggle('is-selected'); s.setAttribute('aria-checked', s.classList.contains('is-selected')); if (!reduced) gsap.fromTo(s, { scale: .85 }, { scale: 1, duration: .5, ease: 'back.out(3)', transformOrigin: 'center' }); update(); };
      s.addEventListener('click', toggle);
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }
  function altitudeChart() {
    const chart = $('.alt');
    if (!chart) return;
    const line = $('.alt__line', chart), area = $('.alt__area', chart), wps = $$('.alt__wp', chart), heli = $('.alt__heli', chart);
    const len = line.getTotalLength();
    line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
    if (reduced) { line.style.strokeDashoffset = 0; area.style.opacity = 1; return; }
    ScrollTrigger.create({ trigger: chart, start: 'top 85%', once: true, onEnter: () => {
      gsap.to(line, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut' });
      gsap.to(area, { opacity: 1, duration: 1.2, delay: .8 });
      gsap.fromTo(wps, { opacity: 0, scale: .5, transformOrigin: 'center' }, { opacity: 1, scale: 1, duration: .5, stagger: .35, delay: .3, ease: 'back.out(2)' });
      gsap.set(heli, { opacity: 1 });
      gsap.to(heli, { duration: 2.2, ease: 'power2.inOut', motionPath: { path: line, align: line, alignOrigin: [.5, .5], autoRotate: 90 } });
    } });
  }

  /* ---------------- gift 3D card ---------------- */
  function gift3d(wrap) {
    const card = $('.gift3d__card', wrap);
    if (!card || reduced) return;
    const rx = gsap.quickTo(card, 'rotateX', { duration: .6, ease: 'power3' }), ry = gsap.quickTo(card, 'rotateY', { duration: .6, ease: 'power3' });
    gsap.set(card, { transformPerspective: 1200 });
    const apply = (px, py) => { ry(px * 22); rx(-py * 22); card.style.setProperty('--sx', `${50 + px * 80}%`); card.style.setProperty('--sy', `${50 + py * 80}%`); };
    if (finePointer) {
      wrap.addEventListener('mousemove', (e) => { const r = card.getBoundingClientRect(); apply((e.clientX - r.left) / r.width - .5, (e.clientY - r.top) / r.height - .5); });
      wrap.addEventListener('mouseleave', () => apply(0, 0));
    }
    onGyro((x, y) => apply(x * .6, y * .6));
    gsap.to(card, { y: -8, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }

  /* ---------------- CTA helicopter fly-by ---------------- */
  function ctaFly() {
    const h = $('.cta__heli'); if (!h || reduced) return;
    gsap.fromTo(h, { xPercent: -140 }, { xPercent: 460, ease: 'none', scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'bottom top', scrub: 1.2 } });
  }

  /* ---------------- misc: ticker speed on scroll velocity, images ---------------- */
  function extras() {
    // pause marquees when off-screen (battery)
    $$('.ticker, .gmarquee').forEach((m) => { const t = $('.ticker__track, .gmarquee__track', m); if (!t) return; new IntersectionObserver((en) => { t.style.animationPlayState = en[0].isIntersecting ? 'running' : 'paused'; }).observe(m); });
    // lqip: mark loaded images
    $$('img.img').forEach((im) => { const done = () => im.classList.add('is-loaded'); if (im.complete) done(); else im.addEventListener('load', done, { once: true }); });
    // hash on load
    if (location.hash && location.hash !== '#booking') setTimeout(() => scrollTo(location.hash), 900);
    if (location.hash === '#booking') setTimeout(() => openBooking({}), 900);
  }

  /* ---------------- init ---------------- */
  function init() {
    let entering = false;
    try { entering = sessionStorage.getItem('hh-entering') === '1'; } catch (e) { /* noop */ }
    initLenis();
    transitions();
    nav();
    cursor();
    initGyro();
    booking();
    lightbox();
    faq();
    seats();
    scrollWidgets();
    if ($('#hero') && !reduced) gsap.set(['.hero__stats', '#hero-heli'], { opacity: 0 });
    preloader().then(() => {
      hero(entering);
      pageHero(entering);
      reveals();
      flightLog();
      mapSection();
      fleet();
      custom();
      altitudeChart();
      ctaFly();
      magnetic();
      tilt();
      extras();
      ScrollTrigger.refresh();
      addEventListener('load', () => ScrollTrigger.refresh());
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
