/* Inline SVG icon set. window.Icons.name(size?) -> svg string. */
(function () {
  const S = (p, opts) => {
    opts = opts || {};
    const fill = opts.fill || 'currentColor';
    const stroke = opts.stroke || 'none';
    const sw = opts.sw || 0;
    const vb = opts.vb || '0 0 24 24';
    return `<svg viewBox="${vb}" width="100%" height="100%" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  };
  const L = (p, opts) => S(p, Object.assign({ fill: 'none', stroke: 'currentColor', sw: 2 }, opts));

  const Icons = {
    // tabbar
    contacts: () => L('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>'),
    phone: () => L('<path d="M5 3h3l2 5-2 1.5a12 12 0 0 0 5 5L18 17l5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 6a2 2 0 0 1 2-3z" transform="scale(0.9) translate(1,0)"/>'),
    chats: () => L('<path d="M4 5h16v11H9l-4 4V5z"/>'),
    settings: () => L('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
    search: () => L('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>'),
    // nav
    back: () => L('<path d="M15 5l-7 7 7 7"/>', { sw: 2.4 }),
    close: () => L('<path d="M6 6l12 12M18 6L6 18"/>', { sw: 2.2 }),
    backspace: () => L('<path d="M21 5H9L3 12l6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-5 6M12 9l5 6" stroke-width="1.6"/>'),
    check: () => L('<path d="M4 12l6 6L20 5"/>', { sw: 2.6 }),
    plus: () => L('<path d="M12 5v14M5 12h14"/>', { sw: 2.2 }),
    edit: () => L('<path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M14 6l4 4"/>'),
    compose: () => L('<path d="M5 19h14M15 4l5 5-9 9H6v-5l9-9z"/>'),
    more: () => S('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
    dots: () => S('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
    chevron: () => L('<path d="M9 5l7 7-7 7"/>', { sw: 2 }),
    // chat header actions
    call: () => L('<path d="M5 3h3l2 5-2 1.5a12 12 0 0 0 5 5L18 17l5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 6a2 2 0 0 1 2-3z" transform="scale(0.9) translate(1,0)"/>'),
    video: () => L('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>'),
    mute: () => L('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/>'),
    bell: () => L('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    // composer
    attach: () => L('<path d="M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.2 3.2 0 0 1 4.5 4.5l-8 8a1.5 1.5 0 0 1-2-2l7.5-7.5"/>'),
    smile: () => L('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/>'),
    mic: () => L('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    send: () => S('<path d="M3 11l18-8-8 18-2-7-8-3z" fill="#fff"/>'),
    arrowUp: () => L('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    keyboard: () => L('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>'),
    // message meta
    tickSingle: () => S('<path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2"/>'),
    tickDouble: () => S('<path d="M1 12l5 5L16 6M8 15L18 4" fill="none" stroke="currentColor" stroke-width="2"/>'),
    eye: () => L('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/>'),
    pin: () => L('<path d="M9 4h6l-1 6 3 3H7l3-3-1-6z"/><path d="M12 16v4"/>'),
    // context menu
    reply: () => L('<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>'),
    copy: () => L('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    forward: () => L('<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0-5 5v1"/>'),
    trash: () => L('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    translate: () => L('<path d="M4 5h8M8 4v1c0 4-2 7-5 8M6 8c0 2 2 4 5 5M14 20l4-9 4 9M15.5 17h5"/>'),
    link: () => L('<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>'),
    save: () => L('<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>'),
    report: () => L('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/>'),
    select: () => L('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
    // profile / more sheet
    secret: () => L('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    gift: () => L('<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M2 9h20M12 9v11M12 9S9 3 6.5 5 12 9 12 9zM12 9s3-6 5.5-4S12 9 12 9z"/>'),
    timer: () => L('<circle cx="12" cy="13" r="8"/><path d="M12 13V9M9 2h6"/>'),
    wallpaper: () => L('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M3 16l5-4 4 3 3-2 6 5"/>'),
    noCopy: () => L('<path d="M8 8h10v10M16 20H6V10M3 3l18 18"/>'),
    block: () => L('<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'),
    addUser: () => L('<circle cx="9" cy="8" r="4"/><path d="M2 20c0-4 4-6 7-6s7 2 7 6M18 8v6M15 11h6"/>'),
    qr: () => S('<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h3v2h-3zM19 19h2v2h-2z"/>'),
    // settings icons (colored ic-box)
    key: () => S('<circle cx="8" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 12h9l-2 2 2 2" fill="none" stroke="#fff" stroke-width="2"/>'),
    at: () => S('<path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 12v1.5a2.5 2.5 0 0 0 5 0V12a8 8 0 1 0-3 6.2" fill="none" stroke="#fff" stroke-width="2"/>'),
    brush: () => S('<path d="M4 20c2 0 3-1 3-3l7-7-3-3-7 7c-2 0-3 1-3 3M13 6l5-5 3 3-5 5" fill="none" stroke="#fff" stroke-width="2"/>'),
    channel: () => S('<path d="M4 10v4h3l6 4V6l-6 4H4zM17 9a4 4 0 0 1 0 6" fill="none" stroke="#fff" stroke-width="2"/>'),
    ai: () => S('<path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" fill="#fff"/>'),
    lock: () => S('<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#fff" stroke-width="2"/>'),
    device: () => S('<rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 20h8" stroke="#fff" stroke-width="2"/>'),
    folder: () => S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="none" stroke="#fff" stroke-width="2"/>'),
    data: () => S('<ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M4 6v12c0 1.6 3.6 3 8 3s8-1.4 8-3V6" fill="none" stroke="#fff" stroke-width="2"/>'),
    star: () => S('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" fill="#fff"/>'),
    globe: () => S('<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="#fff" stroke-width="2"/>'),
    question: () => S('<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 16v.4" fill="none" stroke="#fff" stroke-width="2"/>'),
    // attach sheet
    gallery: () => L('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M4 17l5-4 4 3 3-2 4 4"/>'),
    file: () => L('<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/>'),
    location: () => L('<path d="M12 22s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
    wallet: () => L('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M16 12h.01M3 10h18"/>'),
    poll: () => L('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
    contact2: () => L('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/>'),
    music: () => L('<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>'),
    // misc
    camera: () => L('<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l2-3h4l2 3"/>'),
    verified: () => S('<path d="M12 2l2.4 1.8 3-.3 1 2.9 2.6 1.5-.8 2.9.8 2.9-2.6 1.5-1 2.9-3-.3L12 22l-2.4-1.8-3 .3-1-2.9L3 16.3l.8-2.9L3 10.5l2.6-1.5 1-2.9 3 .3z" fill="#3390ec"/><path d="M8.5 12l2.2 2.2 4.3-4.6" fill="none" stroke="#fff" stroke-width="2"/>'),
    premiumStar: () => S('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" fill="#a695e7"/>'),
    scan: () => L('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"/>'),
    play: () => S('<path d="M8 5v14l11-7z" fill="#fff"/>'),
    pause: () => S('<rect x="7" y="5" width="4" height="14" fill="#fff"/><rect x="14" y="5" width="4" height="14" fill="#fff"/>'),
    micOff: () => L('<path d="M9 9v3a3 3 0 0 0 5 2M15 11V6a3 3 0 0 0-6 0M5 11a7 7 0 0 0 11 5M12 18v3M3 3l18 18"/>'),
    speaker: () => L('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>'),
    flip: () => L('<path d="M4 8a8 8 0 0 1 14-3M20 5v4h-4M20 16a8 8 0 0 1-14 3M4 19v-4h4"/>'),
    hangup: () => S('<path d="M3 10c5-4 13-4 18 0 1 1 1.5 2 1 3l-2 2c-1 1-2 .5-3 0l-2-1c-1-.5-1-1-1-2v-1c-3-1-5-1-8 0v1c0 1 0 1.5-1 2l-2 1c-1 .5-2 1-3 0l-2-2c-.5-1 0-2 1-3z" fill="#fff"/>'),
  };
  window.Icons = Icons;
})();
