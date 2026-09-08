'use strict';
const site = require('../data/site');
const routes = require('../data/routes');
const C = require('./components');
const { esc, url, I, logo, rotorMark, btn, waLink, price } = C;

function navLinks(lang, t, current) {
  const items = [
    ['routes', t.nav.routes], ['proposal', t.nav.proposal], ['experiences', t.nav.experiences], ['gift', t.nav.gift],
    ['guests', t.nav.guests], ['partners', t.nav.partners], ['aviation', t.nav.aviation], ['about', t.nav.about],
  ];
  return items.map(([p, label]) => `<a class="nav__link${current === p ? ' is-current' : ''}" href="${url(lang, p)}"${current === p ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

function langSwitch(lang, path, t, cls = '') {
  return `<div class="lang ${cls}">
    <button type="button" class="lang__btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(t.common.langLabel)}"><span>${site.langShort[lang]}</span>${I.chevron}</button>
    <ul class="lang__list" role="listbox">${site.langs.map((l) => `<li role="option" aria-selected="${l === lang}"><a href="${url(l, path)}" hreflang="${l}" lang="${l}" data-lang-link="${l}"${l === lang ? ' class="is-active"' : ''}><b>${site.langShort[l]}</b><span>${site.langNames[l]}</span></a></li>`).join('')}</ul>
  </div>`;
}

function bookingModal(lang, t) {
  const b = t.booking;
  const c = t.common;
  const routeOpts = routes.map((r) => `<label class="choice"><input type="radio" name="route" value="${r.slug}" data-title="${esc(r.t[lang].title)}" data-window="${r.price.window || ''}" data-middle="${r.price.middle || ''}" data-whole="${r.price.whole || ''}" data-whole-only="${r.wholeOnly ? 1 : 0}"><span class="choice__box"><span class="choice__title">${esc(r.t[lang].title)}</span><span class="choice__meta">${esc(C.durationText(r, lang, t))} · ${esc(C.routePriceText(r, lang, t))}</span></span></label>`).join('');
  const typeOpts = ['proposal', 'gift', 'shoot', 'custom', 'partner', 'aviation'].map((k) => `<label class="choice choice--sm"><input type="radio" name="route" value="type:${k}" data-title="${esc(b.types[k])}"><span class="choice__box"><span class="choice__title">${esc(b.types[k])}</span></span></label>`).join('');
  return `<div class="modal" id="booking" aria-hidden="true">
    <div class="modal__backdrop" data-close></div>
    <div class="modal__panel" role="dialog" data-lenis-prevent aria-modal="true" aria-labelledby="booking-title">
      <button type="button" class="modal__close" data-close aria-label="${esc(t.nav.close)}">${I.x}</button>
      <div class="modal__head">
        <p class="label">${rotorMark('label__mark')} ${site.brand}</p>
        <h3 class="h3" id="booking-title">${esc(b.title)}</h3>
        <p class="modal__sub">${esc(b.subtitle)}</p>
      </div>
      <ol class="steps" aria-hidden="true">${b.steps.map((s, i) => `<li class="steps__item${i === 0 ? ' is-active' : ''}" data-step="${i + 1}"><span class="steps__num">${i + 1}</span><span class="steps__name">${esc(s)}</span></li>`).join('')}</ol>
      <form class="bform" id="bform" novalidate>
        <fieldset class="bform__step is-active" data-step="1">
          <legend class="bform__legend">${esc(b.route)}</legend>
          <div class="choices">${routeOpts}</div>
          <div class="choices choices--row">${typeOpts}</div>
        </fieldset>
        <fieldset class="bform__step" data-step="2">
          <div class="bform__grid">
            <label class="field"><span class="field__label">${esc(b.date)}</span><input type="date" name="date" class="field__input"></label>
            <div class="field"><span class="field__label">${esc(b.seats)}</span>
              <div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="−">−</button><input type="number" name="seats" class="stepper__input" value="2" min="1" max="8" inputmode="numeric"><button type="button" class="stepper__btn" data-step="1" aria-label="+">+</button></div>
            </div>
          </div>
          <div class="field"><span class="field__label">${esc(b.seatType)}</span>
            <div class="seg" role="radiogroup">
              <label class="seg__opt"><input type="radio" name="seatType" value="window" checked><span>${esc(b.window)}</span></label>
              <label class="seg__opt"><input type="radio" name="seatType" value="middle"><span>${esc(b.middle)}</span></label>
              <label class="seg__opt"><input type="radio" name="seatType" value="whole"><span>${esc(b.whole)}</span></label>
            </div>
          </div>
          <div class="bform__total" id="bform-total" hidden><span>${esc(b.total)} <small>(${esc(b.estimate)})</small></span><b data-total>—</b></div>
        </fieldset>
        <fieldset class="bform__step" data-step="3">
          <div class="bform__grid">
            <label class="field"><span class="field__label">${esc(b.name)}</span><input type="text" name="name" class="field__input" autocomplete="name" maxlength="80"></label>
            <label class="field"><span class="field__label">${esc(b.phone)} *</span><input type="tel" name="phone" class="field__input" autocomplete="tel" inputmode="tel" placeholder="+996" required maxlength="30"></label>
          </div>
          <label class="field"><span class="field__label">${esc(b.message)}</span><textarea name="message" class="field__input" rows="3" maxlength="1000" placeholder="${esc(b.messagePh)}"></textarea></label>
          <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <p class="bform__privacy">${esc(b.privacy)}</p>
        </fieldset>
        <div class="bform__nav">
          <button type="button" class="btn btn--ghost" data-prev hidden><span class="btn__label">${esc(b.prev)}</span></button>
          <button type="button" class="btn btn--primary" data-next><span class="btn__label">${esc(b.next)}</span><span class="btn__icon">${I.arrow}</span></button>
          <button type="submit" class="btn btn--primary" data-submit hidden><span class="btn__label" data-label="${esc(b.submit)}" data-sending="${esc(b.sending)}">${esc(b.submit)}</span><span class="btn__icon">${I.arrow}</span></button>
        </div>
        <p class="bform__error" hidden>${esc(b.errorText)}</p>
      </form>
      <div class="bform__success" hidden>
        <div class="bform__success-mark">${I.check}</div>
        <h3 class="h3">${esc(b.successTitle)}</h3>
        <p>${esc(b.successText)}</p>
        <a class="btn btn--wa" href="${site.whatsapp}" target="_blank" rel="noopener" data-wa-success><span class="btn__label">${esc(b.openWa)}</span><span class="btn__icon">${I.wa}</span></a>
      </div>
    </div>
  </div>`;
}

function footer(lang, t, path) {
  const f = t.footer;
  return `<footer class="footer" id="footer">
    <div class="footer__word" aria-hidden="true"><span>HELIHOP</span></div>
    <div class="container footer__grid">
      <div class="footer__brand">
        ${logo(lang, 'footer__logo')}
        <p class="footer__tagline">${esc(f.tagline)}</p>
        <p class="footer__made">${esc(f.made)}</p>
      </div>
      <nav class="footer__col" aria-label="${esc(f.routes)}">
        <h4>${esc(f.routes)}</h4>
        ${routes.map((r) => `<a href="${url(lang, 'routes/' + r.slug)}">${esc(r.t[lang].title)}</a>`).join('')}
        <a href="${url(lang, 'routes')}">${esc(t.common.allRoutes)} ${I.arrow}</a>
      </nav>
      <nav class="footer__col" aria-label="${esc(f.sections)}">
        <h4>${esc(f.sections)}</h4>
        ${['proposal', 'experiences', 'gift', 'guests', 'partners', 'aviation', 'about'].map((p) => `<a href="${url(lang, p)}">${esc(t.nav[p])}</a>`).join('')}
      </nav>
      <div class="footer__col footer__contacts">
        <h4>${esc(f.contacts)}</h4>
        <a href="${site.whatsapp}" target="_blank" rel="noopener">${I.wa} WhatsApp ${esc(site.phone)}</a>
        <a href="tel:+${site.phoneRaw}">${I.phone} ${esc(t.common.call)}</a>
        <a href="${site.instagram}" target="_blank" rel="noopener">${I.ig} Instagram ${esc(site.instagramHandle)}</a>
        ${langSwitch(lang, path, t, 'lang--footer')}
      </div>
    </div>
    <div class="container footer__bottom">
      <span>© ${site.year} ${esc(f.rights)}</span>
      <a href="${url(lang, 'credits')}">${esc(f.credits)}</a>
    </div>
  </footer>`;
}

/**
 * @param {object} p  { lang, t, path, page, title, description, body, image, jsonld, extraHead, noindex }
 */
function render(p) {
  const { lang, t, path, page } = p;
  const canonical = site.domain + url(lang, path);
  const ogImage = site.domain + '/assets/img/og.jpg';
  const alternates = site.langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${site.domain}${url(l, path)}">`).join('\n  ');
  const jsonld = p.jsonld || {
    '@context': 'https://schema.org', '@type': 'TravelAgency', name: site.brandFull, description: t.meta.description, url: canonical,
    telephone: '+' + site.phoneRaw, areaServed: { '@type': 'Country', name: 'Kyrgyzstan' }, address: { '@type': 'PostalAddress', addressLocality: 'Bishkek', addressCountry: 'KG' }, sameAs: [site.instagram],
  };
  const hh = {
    lang, page, phone: site.phoneRaw, whatsapp: site.whatsapp, brand: site.brand,
    booking: t.booking, common: { min: t.common.min, metres: t.common.metres, altitude: t.altimeter.label, view: t.common.view, open: t.common.open, drag: t.common.drag, loading: t.common.loading, ready: t.common.ready },
    currency: site.currency[lang],
    routes: routes.map((r) => ({ slug: r.slug, title: r.t[lang].title, short: r.t[lang].short, duration: r.duration, ground: r.ground, landing: r.landing, price: r.price, wholeOnly: !!r.wholeOnly, color: r.color, url: url(lang, 'routes/' + r.slug), format: r.t[lang].format, priceText: C.routePriceText(r, lang, t) })),
    dests: routes.destinations.map((d) => ({ slug: d.slug, name: d.t[lang].name, desc: d.t[lang].desc, km: d.km, image: d.image })),
    mapText: { base: t.home.mapBase, custom: t.home.mapCustom, km: t.home.mapKm, onRequest: t.common.onRequest, details: t.common.details, discuss: t.home.customCta },
  };
  return `<!doctype html>
<html lang="${lang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.description)}">
  ${p.noindex ? '<meta name="robots" content="noindex">' : ''}
  <link rel="canonical" href="${canonical}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${site.domain}${url(site.defaultLang, path)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${site.brandFull}">
  <meta property="og:title" content="${esc(p.title)}">
  <meta property="og:description" content="${esc(p.description)}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${{ ru: 'ru_RU', en: 'en_US', ky: 'ky_KG' }[lang]}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#07090c">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preload" href="/assets/fonts/unbounded-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/unbounded-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/manrope-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/fonts.css">
  <link rel="stylesheet" href="/assets/css/main.css?v=${p.version}">
  <script>document.documentElement.className='js';try{if(sessionStorage.getItem('hh-seen'))document.documentElement.classList.add('is-returning')}catch(e){}if(matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('reduced');setTimeout(function(){if(!window.__hh_ready)document.documentElement.classList.add('js-failed')},5000)</script>
  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
  ${p.extraHead || ''}
</head>
<body class="page page--${page}" data-lang="${lang}" data-page="${page}">
  <a class="skip" href="#main">${esc(t.nav.skip)}</a>
  <div class="preloader" id="preloader" aria-hidden="true">
    <div class="preloader__inner">
      ${rotorMark('preloader__mark')}
      <div class="preloader__word">Heli<b>Hop</b></div>
      <div class="preloader__alt"><span class="preloader__label">${esc(t.altimeter.label)}</span><span class="preloader__num" data-alt>0</span><span class="preloader__unit">${esc(t.altimeter.unit)}</span></div>
      <div class="preloader__bar"><span></span></div>
    </div>
  </div>
  <div class="curtain" id="curtain" aria-hidden="true"><div class="curtain__mark">${rotorMark()}</div></div>
  <div class="cursor" id="cursor" aria-hidden="true"><div class="cursor__dot"></div><div class="cursor__ring"></div><div class="cursor__label"></div></div>
  <div class="progress" id="progress" aria-hidden="true"><span></span></div>

  <header class="nav" id="nav">
    <div class="nav__inner">
      ${logo(lang, 'nav__logo')}
      <nav class="nav__links" aria-label="Main">${navLinks(lang, t, page)}</nav>
      <div class="nav__right">
        ${langSwitch(lang, path, t, 'lang--nav')}
        <a class="btn btn--wa btn--sm nav__wa" href="${waLink(t.booking.waGeneric)}" target="_blank" rel="noopener" data-magnetic><span class="btn__icon">${I.wa}</span><span class="btn__label">WhatsApp</span></a>
        <button type="button" class="btn btn--primary btn--sm nav__book" data-book><span class="btn__label">${esc(t.common.book)}</span></button>
        <button type="button" class="burger" id="burger" aria-label="${esc(t.nav.menu)}" aria-expanded="false" aria-controls="menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </header>

  <div class="menu" id="menu" aria-hidden="true">
    <div class="menu__bg">${C.img('space-tian-shan', { alt: '', sizes: '100vw' })}</div>
    <div class="menu__inner" data-lenis-prevent>
      <nav class="menu__links" aria-label="${esc(t.nav.menu)}">
        <a class="menu__link" href="${url(lang)}"><span class="menu__num">01</span><span class="menu__text">${esc(t.nav.home)}</span></a>
        ${['routes', 'proposal', 'experiences', 'gift', 'guests', 'partners', 'aviation', 'about'].map((k, i) => `<a class="menu__link${page === k ? ' is-current' : ''}" href="${url(lang, k)}"><span class="menu__num">0${i + 2}</span><span class="menu__text">${esc(t.nav[k])}</span></a>`).join('')}
      </nav>
      <div class="menu__side">
        <div class="menu__langs">${site.langs.map((l) => `<a href="${url(l, path)}" hreflang="${l}"${l === lang ? ' class="is-active"' : ''}>${site.langNames[l]}</a>`).join('')}</div>
        <div class="menu__contacts">
          <a href="${site.whatsapp}" target="_blank" rel="noopener">${I.wa} ${esc(site.phone)}</a>
          <a href="${site.instagram}" target="_blank" rel="noopener">${I.ig} ${esc(site.instagramHandle)}</a>
        </div>
        <p class="menu__base">${esc(site.base[lang])}</p>
      </div>
    </div>
  </div>

  <main id="main" class="main">
${p.body}
  </main>

  ${footer(lang, t, path)}

  <aside class="altimeter" id="altimeter" aria-hidden="true">
    <div class="altimeter__label">${esc(t.altimeter.label)}</div>
    <div class="altimeter__tape"><div class="altimeter__ticks"></div></div>
    <div class="altimeter__value"><span data-alt-value>800</span> ${esc(t.altimeter.unit)}</div>
  </aside>

  <div class="mbar" id="mbar">
    <div class="mbar__price"><small>${esc(t.mbar.price)}</small><span>${esc(t.common.perSeat)}</span></div>
    <button type="button" class="btn btn--primary btn--sm" data-book><span class="btn__label">${esc(t.mbar.cta)}</span></button>
    <a class="mbar__wa" href="${waLink(t.booking.waGeneric)}" target="_blank" rel="noopener" aria-label="WhatsApp">${I.wa}</a>
  </div>
  <a class="wa-float" href="${waLink(t.booking.waGeneric)}" target="_blank" rel="noopener" aria-label="WhatsApp" data-magnetic>${I.wa}</a>

  ${bookingModal(lang, t)}
  <div class="lightbox" id="lightbox" aria-hidden="true"><div class="lightbox__backdrop" data-close></div><button type="button" class="lightbox__close" data-close aria-label="${esc(t.nav.close)}">${I.x}</button><button type="button" class="lightbox__nav lightbox__nav--prev" data-dir="-1" aria-label="prev">${I.arrow}</button><button type="button" class="lightbox__nav lightbox__nav--next" data-dir="1" aria-label="next">${I.arrow}</button><figure class="lightbox__fig"><img class="lightbox__img" alt=""><figcaption class="lightbox__cap"></figcaption></figure></div>

  <script>window.HH=${JSON.stringify(hh)};</script>
  <script src="/assets/js/vendor/gsap.min.js"></script>
  <script src="/assets/js/vendor/ScrollTrigger.min.js"></script>
  <script src="/assets/js/vendor/MotionPathPlugin.min.js"></script>
  <script src="/assets/js/vendor/SplitText.min.js"></script>
  <script src="/assets/js/vendor/lenis.min.js"></script>
  <script src="/assets/js/main.js?v=${p.version}" defer></script>
</body>
</html>`;
}

module.exports = { render, navLinks, langSwitch, bookingModal, footer };
