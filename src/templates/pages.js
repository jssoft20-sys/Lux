'use strict';
const site = require('../data/site');
const routes = require('../data/routes');
const { pages: P, faq: FAQ, fleet: FLEET, guests: GUESTS } = require('../data/pages');
const C = require('./components');
const { esc, url, I, img, btn, waLink, price, fmtNum, sectionHead, routeCard, faqList, ctaSection, marquee, guestCard, specList, heliSvg, heliTop, mapSvg, altitudeChart, seatPicker } = C;

const dests = routes.destinations;

function statsBlock(lang, t) {
  return `<div class="stats" data-stagger>
    ${site.stats.map((s) => `<div class="stat" data-reveal>
      <div class="stat__value">${typeof s.value === 'number' ? `<span data-count="${s.value}">0</span>${s.suffix || ''}` : esc(s.value)}</div>
      <div class="stat__label">${esc(s.label[lang])}</div>
    </div>`).join('')}
  </div>`;
}

function includedBlock(lang, t, cls = '') {
  const icons = [I.camera, I.brief, I.shield, I.person];
  return `<section class="included section ${cls}" id="included">
    <div class="container">
      ${sectionHead({ label: t.common.included, title: t.common.includedTitle })}
      <ul class="incl" data-stagger>${t.common.includedItems.map((s, i) => `<li class="incl__item" data-reveal><span class="incl__icon">${icons[i]}</span><span>${esc(s)}</span></li>`).join('')}</ul>
    </div>
  </section>`;
}

function faqSection(lang, t, items) {
  return `<section class="faqsec section" id="faq">
    <div class="container faqsec__grid">
      <div class="faqsec__head">${sectionHead({ label: t.home.faqLabel, title: t.home.faqTitle, sub: t.home.faqSub })}
        <div class="faqsec__cta" data-reveal>${btn({ href: waLink(t.booking.waGeneric), text: t.common.whatsapp, kind: 'wa', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}</div>
      </div>
      ${faqList(items)}
    </div>
  </section>`;
}

function fleetCard(f, lang, t, i) {
  const ft = f.t[lang];
  return `<article class="fcard" data-index="${i}">
    <div class="fcard__media">${img(f.image, { alt: f.name, sizes: '(min-width:1024px) 46vw, 88vw', eager: true })}<span class="fcard__num">0${i + 1}</span></div>
    <div class="fcard__body">
      <p class="label">${esc(ft.role)}</p>
      <h3 class="fcard__name">${esc(f.name)}</h3>
      <p class="fcard__desc">${esc(ft.desc)}</p>
      ${specList(f.specs, t)}
      <a class="btn btn--ghost btn--sm" href="${waLink(t.booking.waGeneric)}" target="_blank" rel="noopener" data-magnetic><span class="btn__label">${esc(P[lang].about.ask)}</span><span class="btn__icon">${I.wa}</span></a>
    </div>
  </article>`;
}

function galleryGrid(names, alt, cls = '') {
  return `<div class="gallery ${cls}" data-gallery data-stagger>${names.map((n, i) => `<a class="gallery__item" href="/assets/img/${n}-1600.webp" data-lightbox data-reveal="scale" data-cursor="view">${img(n, { alt: alt + ' ' + (i + 1), sizes: '(min-width:1024px) 30vw, 50vw' })}</a>`).join('')}</div>`;
}

function stepsTimeline(items, cls = '') {
  return `<ol class="tl ${cls}" data-stagger>${items.map((s, i) => `<li class="tl__item" data-reveal><span class="tl__num">${String(i + 1).padStart(2, '0')}</span><div class="tl__body"><h3 class="tl__title">${esc(typeof s === 'string' ? s : s.title)}</h3>${s.desc ? `<p class="tl__desc">${esc(s.desc)}</p>` : ''}</div></li>`).join('')}</ol>`;
}

// ================= HOME =================
function home({ lang, t }) {
  const h = t.home;
  const c = t.common;
  const heroTitle = h.titleLines.map((l) => `<span class="line"><span class="line__in">${esc(l)}</span></span>`).join('');
  const exp = h.exp.map((e) => `<a class="tile tile--${e.key}" href="${url(lang, e.href)}" data-reveal="scale" data-cursor="view">
      <div class="tile__media">${img(e.image, { alt: e.title, sizes: '(min-width:1024px) 50vw, 100vw' })}</div>
      <div class="tile__body"><p class="tile__price">${esc(e.price)}</p><h3 class="tile__title">${esc(e.title)}</h3><p class="tile__desc">${esc(e.desc)}</p><span class="tile__arrow">${I.arrowUp}</span></div>
    </a>`).join('');
  const flightItems = routes.map((r, i) => `<div class="flight__item" data-index="${i}">
      <div class="flight__node" data-node><span class="flight__node-dot"></span><span class="flight__node-alt">${r.landing ? fmtNum(r.landing) + ' ' + c.metres : c.noLanding}</span></div>
      ${routeCard(r, lang, t, i)}
    </div>`).join('');
  const guestsRow = (list) => `<div class="gmarquee__track">${list.map((g) => guestCard(g, lang)).join('')}${list.map((g) => guestCard(g, lang)).join('')}</div>`;
  const half = Math.ceil(GUESTS.length / 2);
  const offers = h.offers.map((o, i) => `<article class="offer${i % 2 ? ' offer--rev' : ''}" data-reveal>
      <a class="offer__media" href="${url(lang, o.href)}" data-cursor="view"><div data-parallax="0.15">${img(o.image, { alt: o.title, sizes: '(min-width:1024px) 55vw, 100vw' })}</div></a>
      <div class="offer__body"><p class="label">${esc(o.label)}</p><h3 class="h2" data-split>${esc(o.title)}</h3><p class="lead">${esc(o.desc)}</p>${btn({ href: url(lang, o.href), text: o.cta, kind: 'ghost', icon: I.arrow })}</div>
    </article>`).join('');
  const chips = dests.map((d, i) => `<button type="button" class="chip${i === 0 ? ' is-active' : ''}" data-dest="${d.slug}" data-image="${d.image}" data-desc="${esc(d.t[lang].desc)}">${esc(d.t[lang].name)}</button>`).join('');
  const body = `
  <section class="hero" id="hero">
    <div class="hero__bg" id="hero-bg">
      ${img('hero', { alt: h.title, sizes: '100vw', eager: true, cls: 'hero__img' })}
      <canvas class="hero__mist" id="mist" aria-hidden="true"></canvas>
      <div class="hero__vignette" aria-hidden="true"></div>
    </div>
    <div class="hero__heli" id="hero-heli"><div class="hero__heli-p" id="hero-heli-p">${heliSvg('heli--hero', 'heli-hero')}</div></div>
    <div class="container hero__inner">
      <p class="hero__overline" data-hero><span class="dot"></span>${esc(h.overline)}</p>
      <h1 class="hero__title" id="hero-title">${heroTitle}</h1>
      <p class="hero__sub" data-hero>${esc(h.sub)}</p>
      <div class="hero__row" data-hero>
        <div class="hero__price"><small>${esc(c.from)}</small><b>${fmtNum(site.priceFrom)} ${esc(site.currency[lang])}</b><small>${esc(c.perSeat)}</small></div>
        <div class="hero__cta">
          ${btn({ href: url(lang, 'routes'), text: c.seeRoutes, kind: 'primary', icon: I.arrow })}
          ${btn({ href: waLink(t.booking.waGeneric), text: c.discuss, kind: 'glass', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}
        </div>
      </div>
    </div>
    <a class="hero__scroll" href="#experiences" data-hero><span>${esc(c.scroll)}</span><i></i></a>
    <div class="hero__stats"><div class="container">${statsBlock(lang, t)}</div></div>
  </section>

  ${marquee(h.ticker, 'ticker--hero')}

  <section class="exp section" id="experiences">
    <div class="container">
      ${sectionHead({ label: h.expLabel, title: h.expTitle, sub: h.expSub })}
      <div class="bento" data-stagger>${exp}</div>
    </div>
  </section>

  <section class="flight section" id="routes">
    <div class="container">${sectionHead({ label: h.routesLabel, title: h.routesTitle, sub: h.routesSub, link: url(lang, 'routes'), linkText: c.allRoutes })}</div>
    <div class="container flight__track" id="flight-track">
      <svg class="flight__svg" id="flight-svg" aria-hidden="true"><path class="flight__path flight__path--bg" d=""/><path class="flight__path" id="flight-path" d=""/></svg>
      <div class="flight__heli" id="flight-heli" aria-hidden="true">${heliTop()}</div>
      <div class="flight__base" data-node-start><span class="flight__node-dot"></span><span class="flight__base-text">${esc(h.takeoff)} · ${esc(h.base)}</span></div>
      <div class="flight__items">${flightItems}</div>
      <div class="flight__base flight__base--end" data-node-end><span class="flight__node-dot"></span><span class="flight__base-text">${esc(h.landing)} · ${esc(site.city[lang])}</span></div>
    </div>
  </section>

  <section class="mapsec section" id="map">
    <div class="mapsec__bg" aria-hidden="true">${img('space-issyk-kul', { alt: '', sizes: '100vw' })}</div>
    <div class="container">
      ${sectionHead({ label: h.mapLabel, title: h.mapTitle, sub: h.mapSub })}
      <div class="mapsec__grid" data-reveal>
        <div class="mapsec__map" id="map-wrap">${mapSvg(routes, dests, lang, t)}</div>
        <aside class="mapcard" id="mapcard" aria-live="polite">
          <p class="mapcard__kind label">${esc(h.mapHint)}</p>
          <h3 class="mapcard__title">${esc(routes[0].t[lang].title)}</h3>
          <p class="mapcard__meta"></p>
          <p class="mapcard__desc"></p>
          <div class="mapcard__foot"><b class="mapcard__price"></b><a class="btn btn--ghost btn--sm mapcard__link" href="${url(lang, 'routes')}"><span class="btn__label">${esc(c.details)}</span><span class="btn__icon">${I.arrow}</span></a></div>
        </aside>
      </div>
      <div class="mapsec__legend" data-reveal><span><i class="leg leg--route"></i>${esc(h.mapBase)}</span><span><i class="leg leg--dest"></i>${esc(h.mapCustom)}</span></div>
    </div>
  </section>

  <section class="fleet section" id="fleet">
    <div class="container">${sectionHead({ label: h.fleetLabel, title: h.fleetTitle, link: url(lang, 'about'), linkText: h.fleetMore })}</div>
    <div class="fleet__scroller" id="fleet-scroller" data-cursor="drag">
      <div class="fleet__track" id="fleet-track">
        ${FLEET.map((f, i) => fleetCard(f, lang, t, i)).join('')}
        <a class="fcard fcard--end" href="${url(lang, 'about')}"><span class="fcard__end-text">${esc(h.fleetMore)}</span><span class="fcard__end-arrow">${I.arrow}</span></a>
      </div>
    </div>
  </section>

  <section class="guests section" id="guests">
    <div class="container">${sectionHead({ label: h.guestsLabel, title: h.guestsTitle, sub: h.guestsSub, link: url(lang, 'guests'), linkText: h.guestsAll })}</div>
    <div class="gmarquee" data-reveal>${guestsRow(GUESTS.slice(0, half))}</div>
    <div class="gmarquee gmarquee--rev" data-reveal>${guestsRow(GUESTS.slice(half))}</div>
  </section>

  <section class="offers section" id="offers">
    <div class="container">${offers}</div>
  </section>

  <section class="custom section" id="custom">
    <div class="custom__bg" id="custom-bg" aria-hidden="true">${dests.map((d, i) => `<div class="custom__img${i === 0 ? ' is-active' : ''}" data-image="${d.image}">${img(d.image, { alt: '', sizes: '100vw' })}</div>`).join('')}</div>
    <div class="container custom__inner">
      <p class="label" data-reveal>${esc(h.customLabel)}</p>
      <h2 class="h2" data-split>${esc(h.customTitle)}</h2>
      <p class="lead" data-reveal>${esc(h.customDesc)}</p>
      <div class="chips" data-reveal>${chips}</div>
      <p class="custom__desc" id="custom-desc" data-reveal>${esc(dests[0].t[lang].desc)}</p>
      <div data-reveal>${btn({ href: waLink(t.booking.waCustom), text: h.customCta, kind: 'wa', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}</div>
    </div>
  </section>

  ${includedBlock(lang, t)}
  ${faqSection(lang, t, FAQ[lang].slice(0, 6))}
  ${ctaSection(lang, t)}`;
  return { body, title: t.meta.title, description: t.meta.description };
}

// ================= ROUTES LIST =================
function routesPage({ lang, t }) {
  const p = P[lang].routes;
  const c = t.common;
  const rows = routes.map((r) => `<tr><td><a href="${url(lang, 'routes/' + r.slug)}">${esc(r.t[lang].title)}</a></td><td>${r.duration} ${c.min}</td><td>${r.ground ? r.ground + ' ' + c.min : '—'}</td><td>${r.landing ? fmtNum(r.landing) + ' ' + c.metres : '—'}</td><td>${r.price.window ? price(r.price.window, lang) : '—'}</td><td>${r.price.middle ? price(r.price.middle, lang) : '—'}</td><td>${r.price.whole ? price(r.price.whole, lang) : c.onRequest}</td></tr>`).join('');
  const destCards = dests.map((d) => `<article class="dcard" data-reveal="scale" data-tilt>
      <div class="dcard__media">${img(d.image, { alt: d.t[lang].name, sizes: '(min-width:1024px) 30vw, 90vw' })}<span class="dcard__km">${I.route} ~${d.km} ${c.km} ${esc(t.home.mapKm)}</span></div>
      <div class="dcard__body"><h3 class="dcard__title">${esc(d.t[lang].name)}</h3><p class="dcard__desc">${esc(d.t[lang].desc)}</p><a class="link-arrow" href="${waLink(t.booking.waCustom)}" target="_blank" rel="noopener">${esc(t.home.customCta)} ${I.arrow}</a></div>
    </article>`).join('');
  const body = `
  <section class="phero phero--routes">
    <div class="phero__bg" data-parallax="0.2">${img('gal-ala-archa-2', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner">
      <p class="label" data-hero>${esc(t.nav.routes)}</p>
      <h1 class="h1" data-split>${esc(p.title)}</h1>
      <p class="lead" data-hero>${esc(p.sub)}</p>
    </div>
  </section>
  <section class="section rlist" id="list">
    <div class="container"><div class="rgrid" data-stagger>${routes.map((r, i) => routeCard(r, lang, t, i)).join('')}</div></div>
  </section>
  <section class="section compare">
    <div class="container">
      ${sectionHead({ title: p.compare })}
      <div class="table-wrap" data-reveal><table class="table"><thead><tr>${p.compareCols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    </div>
  </section>
  <section class="section customlist" id="custom">
    <div class="container">
      ${sectionHead({ label: t.home.customLabel, title: p.customTitle, sub: p.customSub })}
      <div class="dgrid" data-stagger>${destCards}</div>
    </div>
  </section>
  ${includedBlock(lang, t)}
  ${faqSection(lang, t, FAQ[lang])}
  ${ctaSection(lang, t)}`;
  return { body, title: p.metaTitle, description: p.sub };
}

// ================= ROUTE DETAIL =================
function routePage({ lang, t, route }) {
  const r = route.t[lang];
  const p = P[lang].route;
  const c = t.common;
  const others = routes.filter((x) => x.slug !== route.slug);
  const tt = { ...t, route: p };
  const metaChips = `<div class="rhero__meta" data-hero>
      <span class="chipm">${I.clock} ${route.duration} ${c.min} ${c.flight}</span>
      ${route.ground ? `<span class="chipm">${I.person} ${route.ground} ${c.min} ${c.ground}</span>` : `<span class="chipm">${I.wind} ${c.noLanding}</span>`}
      ${route.landing ? `<span class="chipm">${I.alt} ${c.landingAt} ${fmtNum(route.landing)} ${c.metres}</span>` : ''}
      <span class="chipm">${I.heli} ${route.aircraft.name}</span>
    </div>`;
  const pricing = route.wholeOnly
    ? `<div class="pricebox__whole"><b>${price(route.price.whole, lang)}</b><span>${esc(c.perAircraft)}</span></div><p class="pricebox__note">${esc(p.wholeNote)}</p>
       ${btn({ text: p.bookWhole, kind: 'primary', icon: I.arrow, attrs: `data-book data-book-route="${route.slug}" data-book-seat="whole"` })}
       ${btn({ href: waLink(t.booking.waText.replace('{route}', '«' + r.title + '»')), text: c.whatsapp, kind: 'wa', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}`
    : `<p class="pricebox__note">${esc(p.seatNote)}</p>
       ${seatPicker(route, lang, tt)}
       <div class="pricebox__rows">
         <div class="pricebox__row"><span><i class="sw sw--window"></i>${esc(p.window)}</span><b>${price(route.price.window, lang)}</b></div>
         <div class="pricebox__row"><span><i class="sw sw--middle"></i>${esc(p.middle)}</span><b>${price(route.price.middle, lang)}</b></div>
       </div>
       <div class="pricebox__total" id="seat-total" hidden><span>${esc(p.selected)}: <b data-seat-count>0</b></span><b data-seat-total>0</b></div>
       ${btn({ text: p.bookSeat, kind: 'primary', icon: I.arrow, attrs: `data-book data-book-route="${route.slug}" data-book-seat="window" id="book-seat"` })}
       ${btn({ text: p.wantWhole, kind: 'ghost', attrs: `data-book data-book-route="${route.slug}" data-book-seat="whole"` })}
       <a class="pricebox__wa" href="${waLink(t.booking.waText.replace('{route}', '«' + r.title + '»'))}" target="_blank" rel="noopener">${I.wa} ${esc(c.whatsapp)}</a>`;
  const body = `
  <section class="rhero">
    <div class="rhero__bg" data-parallax="0.2">${img(route.image, { alt: r.title, sizes: '100vw', eager: true })}</div>
    <div class="container rhero__inner">
      <a class="back" href="${url(lang, 'routes')}" data-hero>${I.arrow} ${esc(p.all)}</a>
      <h1 class="h1 rhero__title" data-split>${esc(r.title)}</h1>
      ${metaChips}
    </div>
    <div class="rhero__heli" aria-hidden="true">${heliSvg('heli--route', 'heli-route')}</div>
  </section>
  <section class="rbody section">
    <div class="container rbody__grid">
      <div class="rbody__main">
        <div class="rblock" data-reveal>
          <p class="label">${esc(p.expect)}</p>
          <h2 class="h2">${esc(r.tagline)}</h2>
          <p class="lead">${esc(r.desc)}</p>
          <ul class="hl" data-stagger>${r.highlights.map((s) => `<li data-reveal>${I.check}<span>${esc(s)}</span></li>`).join('')}</ul>
        </div>
        <div class="rblock">
          <p class="label" data-reveal>${esc(p.photos)} · ${route.gallery.length} ${esc(c.photos)}</p>
          ${galleryGrid(route.gallery, r.title, 'gallery--route')}
        </div>
        <div class="rblock rblock--scheme">
          <p class="label" data-reveal>${esc(p.scheme)}</p>
          <div class="scheme" data-reveal>
            <div class="scheme__map" id="map-wrap">${mapSvg([route], [], lang, t, { zoom: route.coords, id: "rmap" })}</div>
            <div class="scheme__alt"><p class="scheme__label">${esc(p.profile)}</p>${altitudeChart(route, lang, tt)}</div>
          </div>
        </div>
        <div class="rblock rblock--aircraft" data-reveal>
          <p class="label">${esc(p.aircraft)}</p>
          <div class="aircraft">
            <div class="aircraft__media">${img('fleet-h125', { alt: route.aircraft.name, sizes: '(min-width:1024px) 30vw, 90vw' })}</div>
            <div class="aircraft__body"><h3 class="h3">${esc(route.aircraft.name)}</h3>${specList({ seats: route.aircraft.seats, cruise: route.aircraft.cruise, range: route.aircraft.range, ceiling: route.aircraft.ceiling, year: route.aircraft.year }, t)}</div>
          </div>
        </div>
        <div class="rblock" data-reveal>
          <p class="label">${esc(c.included)}</p>
          <ul class="incl incl--compact">${c.includedItems.map((s, i) => `<li class="incl__item"><span class="incl__icon">${[I.camera, I.brief, I.shield, I.person][i]}</span><span>${esc(s)}</span></li>`).join('')}</ul>
        </div>
      </div>
      <aside class="rbody__side">
        <div class="pricebox" id="pricebox" data-reveal>
          <p class="label">${esc(p.price)}</p>
          <h3 class="h3">${route.wholeOnly ? esc(c.wholeOnly) : esc(p.chooseSeat)}</h3>
          <p class="pricebox__format">${esc(r.format)}</p>
          ${pricing}
        </div>
      </aside>
    </div>
  </section>
  <section class="section others">
    <div class="container">
      ${sectionHead({ title: p.other, link: url(lang, 'routes'), linkText: c.allRoutes })}
      <div class="rgrid rgrid--3" data-stagger>${others.map((o, i) => routeCard(o, lang, t, i)).join('')}</div>
    </div>
  </section>
  ${ctaSection(lang, t, { title: p.ready, sub: p.readySub, primary: c.bookFlight, primaryHref: '#booking' })}`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'TouristTrip', name: r.title, description: r.desc, touristType: 'sightseeing', provider: { '@type': 'TravelAgency', name: site.brandFull, telephone: '+' + site.phoneRaw },
    offers: { '@type': 'Offer', priceCurrency: 'KGS', price: route.wholeOnly ? route.price.whole : route.price.middle, availability: 'https://schema.org/InStock' },
  };
  return { body, title: `${r.title} — ${site.brandFull}`, description: r.tagline + ' ' + r.desc, jsonld };
}

// ================= PROPOSAL =================
function proposalPage({ lang, t }) {
  const p = P[lang].proposal;
  const scenarios = p.scenarios.map((s, i) => `<article class="scard" data-reveal="scale" data-tilt>
      <div class="scard__media">${img(s.image, { alt: s.title, sizes: '(min-width:1024px) 30vw, 90vw' })}<span class="scard__num">0${i + 1}</span></div>
      <div class="scard__body"><p class="scard__meta">${esc(s.meta)}</p><h3 class="scard__title">${esc(s.title)}</h3><p class="scard__desc">${esc(s.desc)}</p><div class="scard__foot"><b>${esc(s.price)}</b>${btn({ text: p.cta, kind: 'ghost', cls: 'btn--sm', icon: I.arrow, attrs: 'data-book data-book-route="type:proposal"' })}</div></div>
    </article>`).join('');
  const body = `
  <section class="phero phero--tall">
    <div class="phero__bg" data-parallax="0.2">${img('marry', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner">
      <p class="label" data-hero>${esc(p.label)}</p>
      <h1 class="h1" data-split>${esc(p.title)}</h1>
      <p class="lead" data-hero>${esc(p.intro)}</p>
      <div data-hero>${btn({ text: p.cta, kind: 'primary', icon: I.heart, attrs: 'data-book data-book-route="type:proposal"' })}</div>
    </div>
  </section>
  <section class="section">
    <div class="container">
      ${sectionHead({ label: p.formatsLabel, title: p.formatsTitle, sub: p.formatsSub })}
      <div class="sgrid" data-stagger>${scenarios}</div>
    </div>
  </section>
  <section class="section">
    <div class="container">
      ${sectionHead({ label: p.howLabel, title: p.howTitle, sub: p.howSub })}
      ${galleryGrid(['marry-2', 'gal-kol-tor-2', 'cta', 'dest-sary-chelek', 'landing-snow', 'gal-chunkurchak-3'], p.howTitle)}
    </div>
  </section>
  <section class="section steps-sec">
    <div class="container steps-sec__grid">
      <div>${sectionHead({ label: p.stepsLabel, title: p.stepsTitle })}</div>
      ${stepsTimeline(p.steps)}
    </div>
  </section>
  <section class="section trust">
    <div class="container">
      ${sectionHead({ label: p.trustLabel, title: p.trustTitle })}
      <ul class="incl" data-stagger>${p.trust.map((s, i) => `<li class="incl__item" data-reveal><span class="incl__icon">${[I.shield, I.eye, I.brief, I.person][i]}</span><span>${esc(s)}</span></li>`).join('')}</ul>
    </div>
  </section>
  ${ctaSection(lang, t, { title: p.finalTitle, sub: p.finalSub, primary: p.cta, primaryHref: '#booking', image: 'marry-2' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= EXPERIENCES =================
function experiencesPage({ lang, t }) {
  const p = P[lang].experiences;
  const list = (title, items, icon) => `<div class="listbox" data-reveal><h3 class="listbox__title">${esc(title)}</h3><ul>${items.map((s) => `<li>${icon}<span>${esc(s)}</span></li>`).join('')}</ul></div>`;
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('cockpit', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner">
      <p class="label" data-hero>${esc(p.label)}</p>
      <h1 class="h1" data-split>${esc(p.title)}</h1>
      <p class="lead" data-hero>${esc(p.intro)}</p>
    </div>
  </section>
  <section class="section">
    <div class="container two">
      <article class="panel" data-reveal>
        <p class="label">${esc(p.afterLabel)}</p><h2 class="h2">${esc(p.afterTitle)}</h2><p class="lead">${esc(p.afterDesc)}</p>
        <div class="panel__media">${img('landing-snow', { alt: p.afterTitle, sizes: '(min-width:1024px) 45vw, 90vw' })}</div>
      </article>
      <article class="panel panel--accent" data-reveal>
        <p class="label">${esc(p.shootLabel)}</p><h2 class="h2">${esc(p.shootTitle)}</h2><p class="lead">${esc(p.shootDesc)}</p>
        <div class="pricelist">${p.prices.map((x) => `<div class="pricelist__row"><span>${esc(x.name)}</span><b>${esc(x.price)}</b></div>`).join('')}</div>
        <p class="note">${esc(p.priceNote)}</p>
        ${btn({ text: p.cta, kind: 'primary', icon: I.camera, attrs: 'data-book data-book-route="type:shoot"' })}
      </article>
    </div>
  </section>
  <section class="section">
    <div class="container">
      ${sectionHead({ label: p.galleryLabel, title: p.galleryTitle })}
      ${galleryGrid(['shoot', 'fleet-h125-2', 'aviation', 'gal-adygene-2', 'fleet-h145', 'cockpit', 'gal-ala-archa-3', 'dest-kel-suu', 'route-kol-tor'], p.galleryTitle)}
    </div>
  </section>
  <section class="section">
    <div class="container four">
      ${list(p.forLabel, p.forItems, I.star)}${list(p.inLabel, p.inItems, I.check)}${list(p.outLabel, p.outItems, I.x)}${list(p.condLabel, p.condItems, I.clock)}
    </div>
  </section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'shoot' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= GIFT =================
function giftPage({ lang, t }) {
  const p = P[lang].gift;
  const body = `
  <section class="phero phero--gift">
    <div class="phero__bg" data-parallax="0.2">${img('gift', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner phero__inner--split">
      <div>
        <p class="label" data-hero>${esc(p.label)}</p>
        <h1 class="h1" data-split>${esc(p.title)}</h1>
        <p class="lead" data-hero>${esc(p.intro)}</p>
        <div data-hero>${btn({ text: p.cta, kind: 'primary', icon: I.gift, attrs: 'data-book data-book-route="type:gift"' })}</div>
      </div>
      <div class="gift3d" id="gift3d" data-hero>
        <div class="gift3d__card">
          <div class="gift3d__shine"></div>
          <div class="gift3d__top">${C.rotorMark()}<span>Heli<b>Hop</b></span></div>
          <p class="gift3d__title">${esc(p.cardTitle)}</p>
          <p class="gift3d__sub">${esc(p.cardSub)}</p>
          <div class="gift3d__for"><small>${esc(p.cardFor)}</small><span>${esc(p.cardName)}</span></div>
          <div class="gift3d__foot"><span>${esc(p.cardValid)}</span><span>№ 0001</span></div>
          <div class="gift3d__heli">${heliTop()}</div>
        </div>
        <p class="gift3d__hint">${esc(p.cardHint)}</p>
      </div>
    </div>
  </section>
  <section class="section steps-sec">
    <div class="container steps-sec__grid">
      <div>${sectionHead({ title: p.howTitle })}<p class="note" data-reveal>${esc(p.note)}</p><div data-reveal>${btn({ href: url(lang, 'routes'), text: p.all, kind: 'ghost', icon: I.arrow })}</div></div>
      ${stepsTimeline(p.steps)}
    </div>
  </section>
  <section class="section">
    <div class="container"><div class="rgrid rgrid--3" data-stagger>${routes.slice(0, 3).map((r, i) => routeCard(r, lang, t, i)).join('')}</div></div>
  </section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'dest-song-kul' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= GUESTS =================
function guestsPage({ lang, t }) {
  const p = P[lang].guests;
  const body = `
  <section class="phero phero--short">
    <div class="phero__bg" data-parallax="0.2">${img('bishkek', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.sub)}</p></div>
  </section>
  <section class="section"><div class="container"><div class="ggrid" data-stagger>${GUESTS.map((g) => `<div data-reveal="scale">${guestCard(g, lang)}</div>`).join('')}</div></div></section>
  ${ctaSection(lang, t)}`;
  return { body, title: p.metaTitle, description: p.sub };
}

// ================= PARTNERS =================
function partnersPage({ lang, t }) {
  const p = P[lang].partners;
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('bishkek-square', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p><div data-hero>${btn({ text: p.cta, kind: 'primary', icon: I.arrow, attrs: 'data-book data-book-route="type:partner"' })}</div></div>
  </section>
  <section class="section">
    <div class="container">
      ${sectionHead({ label: p.withLabel, title: p.withLabel })}
      <div class="logos" data-stagger>${p.partners.map((x) => `<div class="logos__item" data-reveal="scale"><b>${esc(x.name)}</b><span>${esc(x.type)}</span></div>`).join('')}</div>
      <p class="note" data-reveal>${esc(p.withNote)}</p>
    </div>
  </section>
  <section class="section">
    <div class="container">
      ${sectionHead({ title: p.whoLabel })}
      <div class="whogrid" data-stagger>${p.who.map((w, i) => `<article class="who" data-reveal><span class="who__icon">${[I.crown, I.globe, I.star, I.users, I.heart][i]}</span><h3>${esc(w.title)}</h3><p>${esc(w.desc)}</p></article>`).join('')}</div>
    </div>
  </section>
  <section class="section steps-sec"><div class="container steps-sec__grid"><div>${sectionHead({ title: p.howLabel })}</div>${stepsTimeline(p.how)}</div></section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'bishkek' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= AVIATION =================
function aviationPage({ lang, t }) {
  const p = P[lang].aviation;
  const icons = [I.crown, I.heli, I.users, I.camera, I.survey, I.eye, I.medical, I.search, I.cargo, I.flag];
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('aviation', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p><div data-hero>${btn({ text: p.cta, kind: 'primary', icon: I.arrow, attrs: 'data-book data-book-route="type:aviation"' })}</div></div>
  </section>
  <section class="section">
    <div class="container"><div class="svcgrid" data-stagger>${p.services.map((s, i) => `<article class="svc" data-reveal="scale" data-tilt><span class="svc__icon">${icons[i]}</span><span class="svc__num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s)}</h3></article>`).join('')}</div></div>
  </section>
  <section class="section"><div class="container">${galleryGrid(['aviation-2', 'fleet-mi8', 'fleet-h145-2', 'gal-adygene-3', 'landing-snow', 'fleet-h125-2'], p.title)}</div></section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'aviation-2' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= ABOUT =================
function aboutPage({ lang, t }) {
  const p = P[lang].about;
  const fleetBlocks = FLEET.map((f, i) => `<article class="fdetail${i % 2 ? ' fdetail--rev' : ''}" data-reveal>
      <div class="fdetail__gallery">${galleryGrid(f.gallery, f.name, 'gallery--fleet')}</div>
      <div class="fdetail__body"><p class="label">${esc(f.t[lang].role)}</p><h2 class="h2">${esc(f.name)}</h2><p class="lead">${esc(f.t[lang].desc)}</p>${specList(f.specs, t)}${btn({ href: waLink(t.booking.waGeneric), text: p.ask, kind: 'ghost', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}</div>
    </article>`).join('');
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('fleet-h125-2', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p></div>
  </section>
  <section class="section"><div class="container fdetails">${fleetBlocks}</div></section>
  <section class="section safety">
    <div class="safety__bg" aria-hidden="true">${img('cockpit', { alt: '', sizes: '100vw' })}</div>
    <div class="container">
      ${sectionHead({ label: p.pilotsLabel, title: p.pilotsTitle })}
      <ul class="safety__list" data-stagger>${p.safety.map((s, i) => `<li data-reveal><span class="safety__num">${String(i + 1).padStart(2, '0')}</span><span>${esc(s)}</span></li>`).join('')}</ul>
    </div>
  </section>
  <section class="section steps-sec"><div class="container steps-sec__grid"><div>${sectionHead({ label: p.flowLabel, title: p.flowTitle })}</div>${stepsTimeline(p.flow)}</div></section>
  ${ctaSection(lang, t)}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= CREDITS =================
function creditsPage({ lang, t, credits }) {
  const p = P[lang].credits;
  const body = `
  <section class="phero phero--short"><div class="container phero__inner"><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p></div></section>
  <section class="section"><div class="container"><div class="table-wrap"><table class="table table--credits"><thead><tr><th>#</th><th>File</th><th>Author</th><th>License</th></tr></thead><tbody>${credits.map((c, i) => `<tr><td><img src="/assets/img/${c.name}-${Math.min(...require('../data/images.json').files[c.name])}.webp" alt="" loading="lazy" width="80" height="54" class="table__thumb"></td><td><a href="${esc(c.source)}" target="_blank" rel="noopener nofollow">${esc(c.title)}</a></td><td>${esc(c.author || '—')}</td><td>${esc(c.license)}</td></tr>`).join('')}</tbody></table></div><p class="note">Fonts: Unbounded, Manrope (SIL Open Font License). Animation: GSAP (Webflow, free license), Lenis (MIT). Map: world.geo.json (Natural Earth, public domain).</p></div></section>`;
  return { body, title: p.metaTitle, description: p.intro, noindex: true };
}

// ================= 404 =================
function notFoundPage({ lang, t }) {
  const n = t.notfound;
  const body = `<section class="nf"><div class="nf__heli">${heliSvg('heli--nf', 'heli-nf')}</div><div class="container nf__inner"><p class="nf__code">404</p><h1 class="h1">${esc(n.title)}</h1><p class="lead">${esc(n.text)}</p>${btn({ href: url(lang), text: n.cta, kind: 'primary', icon: I.arrow })}</div></section>`;
  return { body, title: '404 — ' + site.brandFull, description: n.text, noindex: true };
}

module.exports = { home, routesPage, routePage, proposalPage, experiencesPage, giftPage, guestsPage, partnersPage, aviationPage, aboutPage, creditsPage, notFoundPage };
