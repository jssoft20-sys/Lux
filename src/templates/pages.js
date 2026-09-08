'use strict';
const site = require('../data/site');
const routes = require('../data/routes');
const { pages: P, faq: FAQ, fleet: FLEET, guests: GUESTS } = require('../data/pages');
const STORY = require('../data/story');
const C = require('./components');
const { esc, url, I, img, btn, waLink, price, fmtNum, sectionHead, routeCard, faqList, ctaSection, marquee, guestCard, specList, heliSvg, heliTop, mapSvg, altitudeChart, seatPicker, view3d, gauge, miniMap, largest } = C;

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

/** "How a flight goes" teaser used on the home page and the about page */
function howTeaser(lang, t) {
  const h = t.home, S = STORY[lang];
  const steps = S.scenes.filter((s) => ['request', 'meet', 'crew', 'start', 'flight', 'landing'].includes(s.key)).slice(0, 6);
  return `<section class="howsec section" id="how">
    <div class="container howsec__grid">
      <div class="howsec__stage" data-reveal="scale">
        ${view3d('ground', 'howsec__v3d', { yaw: .85, rpm: 0, lights: true, orbit: true, pad: 1, fov: 28, elev: .16 }, img('h125-06', { alt: 'Airbus H125', sizes: '(min-width:1024px) 50vw, 100vw' }))}
        <div class="howsec__tag">${esc(t.home.model3d)}</div>
      </div>
      <div class="howsec__body">
        ${sectionHead({ label: h.howLabel, title: h.howTitle, sub: h.howSub })}
        <ol class="howsec__steps" data-stagger>${steps.map((s) => `<li data-reveal><span class="howsec__time">${esc(s.time)}</span><span class="howsec__t">${esc(s.title)}</span></li>`).join('')}</ol>
        <div data-reveal>${btn({ href: url(lang, 'how'), text: h.howCta, kind: 'primary', icon: I.arrow })}</div>
      </div>
    </div>
  </section>`;
}

function fleetMini(f, lang, t, i) {
  const media = f.model3d
    ? view3d('card', 'fmini__v3d', { yaw: .5, ground: 1, drag: 1, fov: 30, fit: .86, elev: .26 }, img(f.image, { alt: f.name, sizes: '(min-width:1024px) 30vw, 90vw' }))
    : img(f.image, { alt: f.name, sizes: '(min-width:1024px) 30vw, 90vw' });
  return `<article class="fmini${f.model3d ? ' fmini--3d' : ''}" data-reveal="scale" data-tilt>
    <div class="fmini__media">${media}<span class="fmini__num">0${i + 1}</span><span class="fmini__tag">${f.model3d ? esc(t.home.model3d) : esc(t.home.realPhotos)}</span><span class="glare" aria-hidden="true"></span></div>
    <div class="fmini__body"><p class="label">${esc(f.t[lang].role)}</p><h3 class="fmini__name">${esc(f.name)}${f.reg ? ` <small>${f.reg}</small>` : ''}</h3>${specList(f.specs, t)}<a class="link-arrow" href="${url(lang, 'about')}">${esc(t.home.fleetMore)} ${I.arrow}</a></div>
  </article>`;
}

function galleryGrid(names, alt, cls = '') {
  return `<div class="gallery ${cls}" data-gallery data-stagger>${names.map((n, i) => `<a class="gallery__item" href="/assets/img/${n}-${largest(n)}.webp" data-lightbox data-reveal="scale" data-cursor="view">${img(n, { alt: alt + ' ' + (i + 1), sizes: '(min-width:1024px) 30vw, 50vw' })}</a>`).join('')}</div>`;
}

function stepsTimeline(items, cls = '') {
  return `<ol class="tl ${cls}" data-stagger>${items.map((s, i) => `<li class="tl__item" data-reveal><span class="tl__num">${String(i + 1).padStart(2, '0')}</span><div class="tl__body"><h3 class="tl__title">${esc(typeof s === 'string' ? s : s.title)}</h3>${s.desc ? `<p class="tl__desc">${esc(s.desc)}</p>` : ''}</div></li>`).join('')}</ol>`;
}

function destCard(d, lang, t) {
  const c = t.common;
  return `<article class="dcard dcard--map" data-reveal="scale" data-tilt>
      <div class="dcard__media">${miniMap(d.coords)}<span class="dcard__km">${I.route} ~${d.km} ${c.km} ${esc(t.home.mapKm)}</span></div>
      <div class="dcard__body"><h3 class="dcard__title">${esc(d.t[lang].name)}</h3><p class="dcard__desc">${esc(d.t[lang].desc)}</p><a class="link-arrow" href="${waLink(t.booking.waCustom)}" target="_blank" rel="noopener">${esc(t.home.customCta)} ${I.arrow}</a></div>
    </article>`;
}

// ================= HOME =================
function home({ lang, t }) {
  const h = t.home;
  const c = t.common;
  const heroTitle = h.titleLines.map((l) => `<span class="line"><span class="line__in">${esc(l)}</span></span>`).join('');
  const exp = h.exp.map((e) => `<a class="tile tile--${e.key}" href="${url(lang, e.href)}" data-reveal="scale" data-cursor="view">
      <div class="tile__media">${img(e.image, { alt: e.title, sizes: '(min-width:1024px) 50vw, 100vw' })}</div>
      <div class="tile__body"><p class="tile__price">${esc(e.price)}</p><h3 class="tile__title">${esc(e.title)}</h3><p class="tile__desc">${esc(e.desc)}</p><span class="tile__arrow">${I.arrowUp}</span></div>
      <span class="glare" aria-hidden="true"></span>
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
  const chips = dests.map((d, i) => `<button type="button" class="chip${i === 0 ? ' is-active' : ''}" data-dest="${d.slug}" data-desc="${esc(d.t[lang].desc)}" data-km="~${d.km} ${esc(c.km)} ${esc(h.mapKm)}">${esc(d.t[lang].name)}</button>`).join('');
  const body = `
  <section class="hero" id="hero">
    <div class="hero__bg" id="hero-bg">
      ${img('kg-02', { alt: h.title, sizes: '100vw', eager: true, cls: 'hero__img' })}
      <canvas class="hero__mist" id="mist" aria-hidden="true"></canvas>
      <div class="hero__vignette" aria-hidden="true"></div>
    </div>
    <div class="hero__stage" id="hero-stage" aria-hidden="true"></div>
    <div class="hero__heli" id="hero-heli" hidden><div class="hero__heli-p" id="hero-heli-p">${heliSvg('heli--hero', 'heli-hero')}</div></div>
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
      <div class="flight__heli" id="flight-heli" aria-hidden="true">${heliTop('', 54, 'top')}</div>
      <div class="flight__base" data-node-start><span class="flight__node-dot"></span><span class="flight__base-text">${esc(h.takeoff)} · ${esc(h.base)}</span></div>
      <div class="flight__items">${flightItems}</div>
      <div class="flight__base flight__base--end" data-node-end><span class="flight__node-dot"></span><span class="flight__base-text">${esc(h.landing)} · ${esc(site.city[lang])}</span></div>
    </div>
  </section>

  <section class="mapsec section" id="map">
    <div class="mapsec__bg" aria-hidden="true">${img('gl-04', { alt: '', sizes: '100vw' })}</div>
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

  <section class="show section" id="fleet">
    <div class="container">${sectionHead({ label: t.showcase.label, title: t.showcase.title, sub: t.showcase.sub })}</div>
    <div class="show__pin" id="show-pin">
      <div class="show__stage" id="show-stage" data-cursor="drag"><div class="show__fallback" id="show-fallback" hidden>${img('h125-06', { alt: 'Airbus H125', sizes: '(min-width:1024px) 60vw, 100vw' })}</div><p class="show__hint">${esc(t.showcase.hint)}</p></div>
      <div class="show__chapters">${t.showcase.chapters.map((ch, i) => `<article class="show__ch${i === 0 ? ' is-active' : ''}" data-ch="${i}"><span class="show__k">${esc(ch.k)}</span><h3 class="show__title">${esc(ch.title)}</h3><p class="show__text">${esc(ch.text)}</p><div class="show__stat"><b>${esc(ch.stat)}</b><small>${esc(ch.statLabel)}</small></div></article>`).join('')}</div>
      <div class="show__dots">${t.showcase.chapters.map((ch, i) => `<i${i === 0 ? ' class="is-active"' : ''}></i>`).join('')}</div>
    </div>
    <div class="container">
      <div class="fgrid" data-stagger>${FLEET.map((f, i) => fleetMini(f, lang, t, i)).join('')}</div>
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

  ${howTeaser(lang, t)}

  <section class="custom section" id="custom">
    <div class="custom__bg" id="custom-bg" aria-hidden="true">${img('gl-05', { alt: '', sizes: '100vw' })}</div>
    <div class="container custom__inner">
      <p class="label" data-reveal>${esc(h.customLabel)}</p>
      <h2 class="h2" data-split>${esc(h.customTitle)}</h2>
      <p class="lead" data-reveal>${esc(h.customDesc)}</p>
      <div class="chips" data-reveal>${chips}</div>
      <div class="custom__card" data-reveal><div class="custom__map" id="custom-map">${dests.map((d, i) => `<div class="custom__mini${i === 0 ? ' is-active' : ''}" data-dest="${d.slug}">${miniMap(d.coords)}</div>`).join('')}</div><div><p class="custom__km" id="custom-km">~${dests[0].km} ${esc(c.km)} ${esc(h.mapKm)}</p><p class="custom__desc" id="custom-desc">${esc(dests[0].t[lang].desc)}</p></div></div>
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
  const rows = routes.map((r) => `<tr><td><a href="${url(lang, 'routes/' + r.slug)}">${esc(r.t[lang].title)}</a></td><td>${r.duration} ${c.min}</td><td>${r.ground ? r.ground + ' ' + c.min : '—'}</td><td>${r.landing ? fmtNum(r.landing) + ' ' + c.metres : '—'}</td><td>${r.price.window ? price(r.price.window, lang) : '—'}</td><td>${r.price.middle ? price(r.price.middle, lang) : '—'}</td><td>${r.price.whole ? price(r.price.whole, lang) : price(r.price.window * 3 + r.price.middle, lang)}</td></tr>`).join('');
  const body = `
  <section class="phero phero--routes">
    <div class="phero__bg" data-parallax="0.2">${img('aa-03', { alt: '', sizes: '100vw', eager: true })}</div>
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
      <p class="note" data-reveal>${esc(t.booking.approxWhole)}.</p>
    </div>
  </section>
  <section class="section customlist" id="custom">
    <div class="container">
      ${sectionHead({ label: t.home.customLabel, title: p.customTitle, sub: p.customSub })}
      <div class="dgrid" data-stagger>${dests.map((d) => destCard(d, lang, t)).join('')}</div>
    </div>
  </section>
  ${includedBlock(lang, t)}
  ${faqSection(lang, t, FAQ[lang])}
  ${ctaSection(lang, t, { image: 'kg-09' })}`;
  return { body, title: p.metaTitle, description: p.sub };
}

// ================= ROUTE DETAIL =================
function routePage({ lang, t, route }) {
  const r = route.t[lang];
  const p = P[lang].route;
  const c = t.common, b = t.booking;
  const others = routes.filter((x) => x.slug !== route.slug);
  const tt = { ...t, route: p };
  const metaChips = `<div class="rhero__meta" data-hero>
      <span class="chipm">${I.clock} ${route.duration} ${c.min} ${c.flight}</span>
      ${route.ground ? `<span class="chipm">${I.person} ${route.ground} ${c.min} ${c.ground}</span>` : `<span class="chipm">${I.wind} ${c.noLanding}</span>`}
      ${route.landing ? `<span class="chipm">${I.alt} ${c.landingAt} ${fmtNum(route.landing)} ${c.metres}</span>` : ''}
      <span class="chipm">${I.heli} ${route.aircraft.name}</span>
    </div>`;
  const perSeat = route.wholeOnly ? Math.round(route.price.whole / 4) : null;
  const plural = (n, forms) => { if (lang === 'ru') { const a = n % 10, bb = n % 100; return (a === 1 && bb !== 11) ? forms[0] : (a >= 2 && a <= 4 && (bb < 12 || bb > 14)) ? forms[1] : forms[2]; } return n === 1 ? forms[0] : forms[1]; };
  const pricing = route.wholeOnly
    ? `<div class="pricebox__whole"><b>${price(route.price.whole, lang)}</b><span>${esc(c.perAircraft)} · 4 ${esc(c.seats)}</span></div>
       <div class="calc calc--whole"><div class="calc__row"><span>${price(route.price.whole, lang)} ÷ 4</span><b>${price(perSeat, lang)}</b></div><p class="calc__sub">${esc(b.perSeatCalc)} · ${esc(b.onlyWhole)}</p></div>
       <p class="pricebox__note">${esc(p.wholeNote)}</p>
       ${btn({ text: p.bookWhole, kind: 'primary', icon: I.arrow, attrs: `data-book data-book-route="${route.slug}" data-book-seat="whole"` })}
       ${btn({ href: waLink(t.booking.waText.replace('{route}', '«' + r.title + '»')), text: c.whatsapp, kind: 'wa', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}`
    : `<p class="pricebox__note">${esc(p.seatNote)}</p>
       <div class="pricebox__rows">
         <div class="pricebox__row"><span><i class="sw sw--window"></i>${esc(p.window)} · 3 ${esc(plural(3, b.seatsWord))}</span><b>${price(route.price.window, lang)}</b></div>
         <div class="pricebox__row"><span><i class="sw sw--middle"></i>${esc(p.middle)} · 1 ${esc(plural(1, b.seatsWord))}</span><b>${price(route.price.middle, lang)}</b></div>
       </div>
       ${seatPicker(route, lang, tt)}
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
    <div class="rhero__stage" id="hero-stage" aria-hidden="true"></div>
    <div class="rhero__heli" id="hero-heli" hidden aria-hidden="true">${heliSvg('heli--route', 'heli-route')}</div>
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
            <div class="scheme__map" id="map-wrap">${mapSvg([route], [], lang, t, { zoom: route.coords, id: 'rmap' })}</div>
            <div class="scheme__alt"><p class="scheme__label">${esc(p.profile)}</p>${altitudeChart(route, lang, tt)}</div>
          </div>
        </div>
        <div class="rblock rblock--aircraft" data-reveal>
          <p class="label">${esc(p.aircraft)}</p>
          <div class="aircraft">
            <div class="aircraft__media" data-cursor="drag">${view3d('card', 'aircraft__v3d', { yaw: .55, ground: 1, drag: 1, fov: 30, fit: .84, elev: .26 }, img('h125-06', { alt: route.aircraft.name, sizes: '(min-width:1024px) 30vw, 90vw' }))}<span class="aircraft__tag">${esc(t.home.model3d)}</span></div>
            <div class="aircraft__body"><h3 class="h3">${esc(route.aircraft.name)} <small>EX-88010</small></h3>${specList({ seats: route.aircraft.seats, cruise: route.aircraft.cruise, range: route.aircraft.range, ceiling: route.aircraft.ceiling, year: route.aircraft.year }, t)}<a class="link-arrow" href="${url(lang, 'how')}">${esc(t.nav.how)} ${I.arrow}</a></div>
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
  ${ctaSection(lang, t, { title: p.ready, sub: p.readySub, primary: c.bookFlight, primaryHref: '#booking', image: route.gallery[1] || route.image })}`;
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
    <div class="phero__bg" data-parallax="0.2">${img('mm-04', { alt: '', sizes: '100vw', eager: true })}</div>
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
      ${galleryGrid(['mm-06', 'mm-01', 'mm-03', 'mm-07', 'mm-08', 'mm-05', 'mm-09', 'mm-10', 'mm-11', 'mm-12', 'mm-02', 'mm-04'], p.howTitle)}
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
  ${ctaSection(lang, t, { title: p.finalTitle, sub: p.finalSub, primary: p.cta, primaryHref: '#booking', image: 'mm-10' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= EXPERIENCES =================
function experiencesPage({ lang, t }) {
  const p = P[lang].experiences;
  const list = (title, items, icon) => `<div class="listbox" data-reveal><h3 class="listbox__title">${esc(title)}</h3><ul>${items.map((s) => `<li>${icon}<span>${esc(s)}</span></li>`).join('')}</ul></div>`;
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('exp-01', { alt: '', sizes: '100vw', eager: true })}</div>
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
        <div class="panel__media">${img('guest-07', { alt: p.afterTitle, sizes: '(min-width:1024px) 45vw, 90vw' })}</div>
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
      ${galleryGrid(['exp-01', 'exp-02', 'exp-03', 'exp-04', 'exp-05', 'exp-06', 'exp-07', 'exp-08', 'exp-09', 'guest-07'], p.galleryTitle)}
    </div>
  </section>
  <section class="section">
    <div class="container four">
      ${list(p.forLabel, p.forItems, I.star)}${list(p.inLabel, p.inItems, I.check)}${list(p.outLabel, p.outItems, I.x)}${list(p.condLabel, p.condItems, I.clock)}
    </div>
  </section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'exp-03' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= GIFT =================
function giftPage({ lang, t }) {
  const p = P[lang].gift;
  const body = `
  <section class="phero phero--gift">
    <div class="phero__bg" data-parallax="0.2">${img('gift-01', { alt: '', sizes: '100vw', eager: true })}</div>
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
          <div class="gift3d__top">${C.heliSilhouette('gift3d__sil')}<span>HELI<b>HOP</b></span></div>
          <p class="gift3d__title">${esc(p.cardTitle)}</p>
          <p class="gift3d__sub">${esc(p.cardSub)}</p>
          <div class="gift3d__for"><small>${esc(p.cardFor)}</small><span>${esc(p.cardName)}</span></div>
          <div class="gift3d__foot"><span>${esc(p.cardValid)}</span><span>№ 0001</span></div>
          <div class="gift3d__heli">${heliTop('', 84, 'iso')}</div>
        </div>
        <p class="gift3d__hint">${esc(p.cardHint)}</p>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="container two">
      <div class="panel" data-reveal><div class="panel__media panel__media--tall">${img('gift-01', { alt: p.cardTitle, sizes: '(min-width:1024px) 45vw, 90vw' })}</div></div>
      <div class="steps-sec__grid steps-sec__grid--one"><div>${sectionHead({ title: p.howTitle })}<p class="note" data-reveal>${esc(p.note)}</p><div data-reveal>${btn({ href: url(lang, 'routes'), text: p.all, kind: 'ghost', icon: I.arrow })}</div></div>${stepsTimeline(p.steps)}</div>
    </div>
  </section>
  <section class="section">
    <div class="container"><div class="rgrid rgrid--3" data-stagger>${routes.slice(0, 3).map((r, i) => routeCard(r, lang, t, i)).join('')}</div></div>
  </section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'kg-02' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= GUESTS =================
function guestsPage({ lang, t }) {
  const p = P[lang].guests;
  const body = `
  <section class="phero phero--short">
    <div class="phero__bg" data-parallax="0.2">${img('guest-07', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.sub)}</p></div>
  </section>
  <section class="section"><div class="container"><div class="ggrid" data-stagger>${GUESTS.map((g) => `<div data-reveal="scale">${guestCard(g, lang, { tilt: true, sizes: '(min-width:1024px) 22vw, (min-width:760px) 45vw, 92vw' })}</div>`).join('')}</div></div></section>
  ${ctaSection(lang, t, { image: 'exp-08' })}`;
  return { body, title: p.metaTitle, description: p.sub };
}

// ================= PARTNERS =================
function partnersPage({ lang, t }) {
  const p = P[lang].partners;
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('h145-05', { alt: '', sizes: '100vw', eager: true })}</div>
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
  <section class="section"><div class="container">${galleryGrid(['exp-07', 'h145-05', 'exp-06', 'exp-09', 'h145-04', 'exp-01'], p.title)}</div></section>
  <section class="section steps-sec"><div class="container steps-sec__grid"><div>${sectionHead({ title: p.howLabel })}</div>${stepsTimeline(p.how)}</div></section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'exp-07' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= AVIATION =================
function aviationPage({ lang, t }) {
  const p = P[lang].aviation;
  const icons = [I.crown, I.heli, I.users, I.camera, I.survey, I.eye, I.medical, I.search, I.cargo, I.flag];
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('mi8-01', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p><div data-hero>${btn({ text: p.cta, kind: 'primary', icon: I.arrow, attrs: 'data-book data-book-route="type:aviation"' })}</div></div>
  </section>
  <section class="section">
    <div class="container"><div class="svcgrid" data-stagger>${p.services.map((s, i) => `<article class="svc" data-reveal="scale" data-tilt><span class="svc__icon">${icons[i]}</span><span class="svc__num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s)}</h3></article>`).join('')}</div></div>
  </section>
  <section class="section"><div class="container">${galleryGrid(['h145-01', 'mi8-01', 'h145-06', 'h125-01', 'h145-05', 'h125-02'], p.title)}</div></section>
  ${ctaSection(lang, t, { primary: p.cta, primaryHref: '#booking', image: 'h145-01' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= ABOUT =================
function aboutPage({ lang, t }) {
  const p = P[lang].about;
  const fleetBlocks = FLEET.map((f, i) => `<article class="fdetail${i % 2 ? ' fdetail--rev' : ''}${f.model3d ? ' fdetail--3d' : ''}" data-reveal>
      <div class="fdetail__gallery">${f.model3d ? `<div class="fdetail__stage" data-cursor="drag">${view3d('card', 'fdetail__v3d', { yaw: .5, ground: 1, drag: 1, fov: 28, fit: .9, elev: .26 }, '')}<span class="fdetail__tag">${esc(t.home.model3d)} · ${f.reg}</span></div>` : ''}${galleryGrid(f.gallery, f.name, 'gallery--fleet')}</div>
      <div class="fdetail__body"><p class="label">${esc(f.t[lang].role)}</p><h2 class="h2">${esc(f.name)}${f.reg ? ` <small class="reg">${f.reg}</small>` : ''}</h2><p class="lead">${esc(f.t[lang].desc)}</p>${specList(f.specs, t)}${btn({ href: waLink(t.booking.waGeneric), text: p.ask, kind: 'ghost', icon: I.wa, attrs: 'target="_blank" rel="noopener"' })}</div>
    </article>`).join('');
  const body = `
  <section class="phero">
    <div class="phero__bg" data-parallax="0.2">${img('h125-06', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner"><p class="label" data-hero>${esc(p.label)}</p><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p></div>
  </section>
  <section class="section"><div class="container fdetails">${fleetBlocks}</div></section>
  <section class="section safety">
    <div class="safety__bg" aria-hidden="true">${img('aa-06', { alt: '', sizes: '100vw' })}</div>
    <div class="container">
      ${sectionHead({ label: p.pilotsLabel, title: p.pilotsTitle })}
      <ul class="safety__list" data-stagger>${p.safety.map((s, i) => `<li data-reveal><span class="safety__num">${String(i + 1).padStart(2, '0')}</span><span>${esc(s)}</span></li>`).join('')}</ul>
    </div>
  </section>
  <section class="section steps-sec"><div class="container steps-sec__grid"><div>${sectionHead({ label: p.flowLabel, title: p.flowTitle })}<div data-reveal>${btn({ href: url(lang, 'how'), text: t.home.howCta, kind: 'primary', icon: I.arrow })}</div></div>${stepsTimeline(p.flow)}</div></section>
  ${ctaSection(lang, t, { image: 'h125-05' })}`;
  return { body, title: p.metaTitle, description: p.intro };
}

// ================= HOW A FLIGHT GOES (animated story) =================
function howPage({ lang, t }) {
  const S = STORY[lang], c = t.common, b = t.booking;
  const glacier = routes.find((r) => r.slug === 'glacier-chunkurchak');
  const tt = { ...t, route: P[lang].route };
  const chat = (sc) => `<div class="phone" data-anim="chat"><div class="phone__top"><span class="phone__dot"></span><b>${esc(S.manager)}</b><small>WhatsApp</small></div><div class="phone__body">${sc.chat.map((m, i) => m.who === 'pay'
    ? `<div class="bubble bubble--pay" data-step="${i}"><span class="bubble__pay">${I.check}</span><b>${esc(S.paid)}</b><small>${esc(S.payLink)} · 30%</small></div>`
    : `<div class="bubble bubble--${m.who}" data-step="${i}"><small>${esc(m.who === 'you' ? S.you : S.manager)}</small>${esc(m.text)}</div>`).join('')}<div class="bubble bubble--typing" data-typing><i></i><i></i><i></i></div></div><div class="phone__stamp" data-stamp>${I.check} ${esc(S.confirmed)}</div></div>`;
  const weather = (sc) => `<div class="wx" data-anim="wx"><div class="wx__sun"><i></i></div><div class="wx__grid">${sc.weather.map(([k, v]) => `<div class="wx__item"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div><ul class="wx__checks">${sc.checks.map((x) => `<li><span class="wx__tick">${I.check}</span>${esc(x)}</li>`).join('')}</ul></div>`;
  const meet = (sc) => `<div class="meet" data-anim="meet"><div class="meet__map">${miniMap([74.47, 42.85], 'meet__mini')}<span class="meet__pin">${I.pin}</span><span class="meet__car"></span></div><ul class="meet__steps">${sc.steps.map((x, i) => `<li><span class="meet__n">${i + 1}</span>${esc(x)}</li>`).join('')}</ul></div>`;
  const crew = (sc) => `<div class="crew" data-anim="crew"><div class="crew__stage">${view3d('ground', 'crew__v3d', { yaw: .75, rpm: 0, lights: false, pad: 1, fov: 28, elev: .18, orbit: true })}${sc.checks.map((x, i) => `<span class="crew__check" data-check="${i}" style="--i:${i}"><i>${I.check}</i>${esc(x)}</span>`).join('')}</div><div class="crew__pilots">${sc.pilots.map((pl, i) => `<div class="pilot"><span class="pilot__ava">${I.person}</span><b>${esc(pl.role)}</b><small>${esc(pl.stat)}</small></div>`).join('')}</div></div>`;
  const board = (sc) => `<div class="board" data-anim="board"><div class="board__seats">${seatPicker(glacier, lang, tt).replace('id="calc"', 'id="calc-story" hidden')}<div class="board__names">${sc.seats.map((n, i) => `<span class="board__name" data-seat-i="${i}">${esc(n)}</span>`).join('')}</div></div><ul class="board__notes">${sc.notes.map((x) => `<li>${I.check}<span>${esc(x)}</span></li>`).join('')}</ul></div>`;
  const start = (sc) => `<div class="startsc" data-anim="start"><div class="startsc__stage">${view3d('ground', 'startsc__v3d', { yaw: .7, rpm: 0, lights: true, pad: 1, fov: 28, elev: .14 })}</div><div class="startsc__panel"><div class="startsc__gauges">${gauge('n1', t.intro.gauges.n1)}${gauge('nr', t.intro.gauges.nr)}</div><ol class="startsc__stages">${sc.stages.map((x, i) => `<li data-stage="${i}"><i></i>${esc(x)}</li>`).join('')}</ol><button type="button" class="sndbtn" data-story-sound aria-pressed="false"><span class="sndbtn__ic">${I.wind}</span><span data-snd-label>${esc(S.soundOff)}</span></button></div></div>`;
  const flight = (sc) => `<div class="flightsc" data-anim="flight"><div class="flightsc__map">${mapSvg([glacier], [], lang, t, { zoom: glacier.coords, id: 'smap' })}<div class="flightsc__timer"><small>${esc(c.altitude)}</small><b data-alt-story>800</b> ${esc(c.metres)}<span class="flightsc__clock" data-clock>0:00</span></div></div><ol class="flightsc__log">${sc.log.map(([tm, x], i) => `<li data-log="${i}"><b>${esc(tm)}</b><span>${esc(x)}</span></li>`).join('')}</ol><div class="flightsc__photos">${sc.photos.map((n, i) => `<figure class="flightsc__ph" data-ph="${i}">${img(n, { alt: '', sizes: '(min-width:1024px) 18vw, 40vw' })}</figure>`).join('')}</div></div>`;
  const landing = (sc) => `<div class="landsc" data-anim="landing"><div class="landsc__stage">${view3d('ground', 'landsc__v3d', { yaw: .95, rpm: 0, lights: false, pad: 0, fov: 28, elev: .12, orbit: true })}</div><div class="landsc__facts">${sc.facts.map(([v, k]) => `<div class="fact"><b>${esc(v)}</b><small>${esc(k)}</small></div>`).join('')}</div><div class="landsc__photos">${sc.photos.map((n, i) => `<figure class="polaroid" data-ph="${i}" style="--r:${(i - 1) * 6}deg">${img(n, { alt: '', sizes: '(min-width:1024px) 16vw, 40vw' })}<span class="polaroid__flash"></span></figure>`).join('')}</div></div>`;
  const ret = (sc) => `<div class="retsc" data-anim="return"><div class="retsc__photos">${sc.photos.map((n, i) => `<figure class="polaroid" data-ph="${i}" style="--r:${(i - 1) * -5}deg">${img(n, { alt: '', sizes: '(min-width:1024px) 16vw, 40vw' })}<span class="polaroid__flash"></span></figure>`).join('')}</div><ul class="retsc__steps">${sc.steps.map((x, i) => `<li data-i="${i}">${I.camera}<span>${esc(x)}</span></li>`).join('')}</ul><div class="retsc__stars" aria-hidden="true">${[0, 1, 2, 3, 4].map(() => I.star).join('')}</div></div>`;
  const visuals = { request: chat, confirm: weather, meet, crew, board, start, flight, landing, return: ret };
  const scenes = S.scenes.map((sc, i) => `<section class="scene scene--${sc.key}" data-scene="${sc.key}" data-index="${i}" id="scene-${sc.key}">
      <div class="container scene__grid">
        <div class="scene__visual"><div class="scene__vin">${visuals[sc.key](sc)}</div></div>
        <div class="scene__body">
          <p class="scene__time"><span class="scene__n">${String(i + 1).padStart(2, '0')}</span>${esc(sc.time)}</p>
          <h2 class="h2 scene__title" data-split>${esc(sc.title)}</h2>
          <p class="lead" data-reveal>${esc(sc.text)}</p>
        </div>
      </div>
    </section>`).join('');
  const body = `
  <section class="phero phero--story">
    <div class="phero__bg" data-parallax="0.2">${img('aa-06', { alt: '', sizes: '100vw', eager: true })}</div>
    <div class="container phero__inner">
      <p class="label" data-hero>${esc(S.label)}</p>
      <h1 class="h1" data-split>${esc(S.title)}</h1>
      <p class="lead" data-hero>${esc(S.intro)}</p>
      <div class="phero__row" data-hero><button type="button" class="sndbtn" data-story-sound aria-pressed="false"><span class="sndbtn__ic">${I.wind}</span><span data-snd-label>${esc(S.soundOff)}</span></button><span class="phero__scroll">${esc(S.scrollHint)} ${I.chevron}</span></div>
    </div>
  </section>
  <div class="story" id="story">
    <div class="story__bar" id="story-bar"><div class="container story__bar-in"><span class="story__bar-label">${esc(S.progress)}</span><div class="story__phases">${S.phases.map((ph, i) => `<span class="story__phase" data-phase="${i}">${esc(ph)}</span>`).join('')}</div><i class="story__prog"><b></b></i></div></div>
    ${scenes}
  </div>
  ${ctaSection(lang, t, { title: S.finalTitle, sub: S.finalSub, primary: c.ctaChoose, primaryHref: url(lang, 'routes'), image: 'gl-05' })}`;
  return { body, title: S.metaTitle, description: S.intro };
}

// ================= CREDITS =================
function creditsPage({ lang, t }) {
  const p = P[lang].credits;
  const body = `
  <section class="phero phero--short"><div class="container phero__inner"><h1 class="h1" data-split>${esc(p.title)}</h1><p class="lead" data-hero>${esc(p.intro)}</p></div></section>
  <section class="section"><div class="container"><div class="table-wrap"><table class="table table--credits"><thead><tr><th>#</th><th>License</th><th>Source</th></tr></thead><tbody>
    <tr><td>Photos</td><td>© HeliHop Travel, all rights reserved</td><td><a href="${site.instagram}" target="_blank" rel="noopener">${esc(site.instagramHandle)}</a></td></tr>
    <tr><td>Unbounded, Manrope</td><td>SIL Open Font License 1.1</td><td><a href="https://fonts.google.com" target="_blank" rel="noopener nofollow">Google Fonts</a></td></tr>
    <tr><td>Three.js</td><td>MIT</td><td><a href="https://threejs.org" target="_blank" rel="noopener nofollow">threejs.org</a></td></tr>
    <tr><td>GSAP</td><td>Webflow free license</td><td><a href="https://gsap.com" target="_blank" rel="noopener nofollow">gsap.com</a></td></tr>
    <tr><td>Lenis</td><td>MIT</td><td><a href="https://lenis.darkroom.engineering" target="_blank" rel="noopener nofollow">darkroom.engineering</a></td></tr>
    <tr><td>Map outline</td><td>Natural Earth, public domain</td><td><a href="https://www.naturalearthdata.com" target="_blank" rel="noopener nofollow">naturalearthdata.com</a></td></tr>
  </tbody></table></div></div></section>`;
  return { body, title: p.metaTitle, description: p.intro, noindex: true };
}

// ================= 404 =================
function notFoundPage({ lang, t }) {
  const n = t.notfound;
  const body = `<section class="nf"><div class="nf__heli">${view3d('fly', 'nf__v3d', { yaw: 2.4, roll: -.18, pitch: -.1, fov: 30, fit: 1.05, elev: .1 }, heliSvg('heli--nf', 'heli-nf'))}</div><div class="container nf__inner"><p class="nf__code">404</p><h1 class="h1">${esc(n.title)}</h1><p class="lead">${esc(n.text)}</p>${btn({ href: url(lang), text: n.cta, kind: 'primary', icon: I.arrow })}</div></section>`;
  return { body, title: '404 — ' + site.brandFull, description: n.text, noindex: true };
}

module.exports = { home, routesPage, routePage, proposalPage, experiencesPage, giftPage, guestsPage, partnersPage, aviationPage, aboutPage, howPage, creditsPage, notFoundPage };
