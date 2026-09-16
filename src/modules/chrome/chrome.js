/* Sprinter Go — chrome.js: header state, mobile menu, dock, fab tooltip, active nav link. */
(() => {
  'use strict';

  const d = document;
  const body = d.body;
  const header = d.querySelector('.topbar');
  const menuBtn = d.getElementById('menuBtn');
  const menu = d.getElementById('mobileMenu');
  const dock = d.getElementById('dock');
  const fab = d.getElementById('fab');
  const desktopMq = window.matchMedia('(min-width: 1021px)');
  const mobileMq = window.matchMedia('(max-width: 760px)');

  /* ---------- Mobile menu ---------- */
  const isOpen = () => body.classList.contains('menu-open');
  let lastFocus = null;

  const focusables = () => {
    if (!menu) return [];
    return Array.from(menu.querySelectorAll('a[href],button:not([disabled])'))
      .filter((el) => el.offsetParent !== null || el.getClientRects().length);
  };

  const setMenu = (open, opts) => {
    if (!menuBtn || !menu) return;
    const restoreFocus = !opts || opts.restoreFocus !== false;
    if (open === isOpen()) {
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (open) {
      lastFocus = d.activeElement;
      body.classList.add('menu-open');
      menuBtn.setAttribute('aria-expanded', 'true');
      menuBtn.setAttribute('aria-label', 'Закрыть меню');
    } else {
      body.classList.remove('menu-open');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Открыть меню');
      if (restoreFocus && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    }
  };

  if (menuBtn && menu) {
    // sync with server-rendered state (e.g. a preview with menu-open already set)
    menuBtn.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');

    menuBtn.addEventListener('click', () => setMenu(!isOpen()));

    // any link inside the menu closes it (anchor navigation keeps working)
    menu.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a) setMenu(false, { restoreFocus: false });
    });

    d.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        setMenu(false);
        return;
      }
      if (e.key === 'Tab') {
        // keep focus inside burger + menu while it is open
        const ring = [menuBtn].concat(focusables());
        if (ring.length < 2) return;
        const first = ring[0];
        const last = ring[ring.length - 1];
        const active = d.activeElement;
        if (e.shiftKey && (active === first || !ring.includes(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // if the viewport grows to desktop while the menu is open, close it
    const onDesktop = (mq) => { if (mq.matches && isOpen()) setMenu(false, { restoreFocus: false }); };
    if (typeof desktopMq.addEventListener === 'function') desktopMq.addEventListener('change', onDesktop);
    else if (typeof desktopMq.addListener === 'function') desktopMq.addListener(onDesktop);
  }

  /* ---------- Scroll-driven states: header shadow, dock visibility ---------- */
  let ticking = false;
  const applyScroll = () => {
    ticking = false;
    const y = window.scrollY || d.documentElement.scrollTop || 0;
    if (header) header.classList.toggle('is-scrolled', y > 8);
    if (dock) dock.classList.toggle('is-shown', y > 300);
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyScroll);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  applyScroll();

  /* ---------- FAB tooltip: appears after 3s, hides 6s later ---------- */
  if (fab) {
    let shown = false;
    const showTip = () => {
      if (shown || mobileMq.matches || d.hidden) return;
      shown = true;
      fab.classList.add('is-tip');
      window.setTimeout(() => fab.classList.remove('is-tip'), 6000);
    };
    window.setTimeout(showTip, 3000);
    // if the page was opened in a background tab, show it once the tab becomes visible
    d.addEventListener('visibilitychange', () => { if (!d.hidden && !shown) window.setTimeout(showTip, 1500); });
  }

  /* ---------- Active menu item by section (IntersectionObserver) ---------- */
  const navLinks = Array.from(d.querySelectorAll('.topbar-menu a[href^="#"], .mmenu-list a[href^="#"]'));
  if (navLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(); // id -> links[]
    navLinks.forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(a);
    });

    const sections = Array.from(byId.keys())
      .map((id) => d.getElementById(id))
      .filter(Boolean);

    if (sections.length) {
      const visible = new Set();
      let current = null;

      const setActive = (id) => {
        if (id === current) return;
        current = id;
        navLinks.forEach((a) => {
          const on = a.getAttribute('href') === '#' + id;
          a.classList.toggle('is-active', on);
          if (on) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      };

      const pick = () => {
        // first intersecting section in document order wins
        const hit = sections.find((s) => visible.has(s.id));
        setActive(hit ? hit.id : null);
      };

      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) visible.add(en.target.id);
          else visible.delete(en.target.id);
        });
        pick();
      }, { rootMargin: '-38% 0px -52% 0px', threshold: 0 });

      sections.forEach((s) => io.observe(s));
    }
  }

  /* ---------- Current year (footer) — idempotent with main.js ---------- */
  const year = String(new Date().getFullYear());
  d.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
})();
