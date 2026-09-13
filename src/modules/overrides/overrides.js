/* Отслеживание конверсий для рекламы (Google Ads / GA4 / Яндекс.Метрика).
   Ничего не отправляет само по себе: события уходят только если на странице подключены
   счётчики (gtag / dataLayer / ym). Настройка — объект window.SG_TRACK в index.html перед </body>:
     window.SG_TRACK = {
       ads: { whatsapp: 'AW-XXXXXXXXX/AbCdEfGh', call: 'AW-XXXXXXXXX/IjKlMnOp', form: 'AW-XXXXXXXXX/QrStUvWx' },
       ym: 12345678
     };
   События: lead_whatsapp (клик по WhatsApp), lead_call (клик по телефону),
            calc_agree («Да, меня устраивает»), lead_form (отправка заявки из калькулятора). */
(() => {
  'use strict';
  const cfg = () => window.SG_TRACK || {};
  const sent = new Set();

  const fire = (name, params) => {
    const c = cfg();
    try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: name }, params || {})); } catch (e) { /* noop */ }
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (e) { /* noop */ }
    // Google Ads: конверсии (send_to из настроек)
    try {
      const map = { lead_whatsapp: 'whatsapp', lead_call: 'call', lead_form: 'form', calc_agree: 'calc' };
      const id = c.ads && c.ads[map[name]];
      if (id && typeof window.gtag === 'function') window.gtag('event', 'conversion', { send_to: id });
    } catch (e) { /* noop */ }
    // Яндекс.Метрика: цели с теми же именами
    try { if (c.ym && typeof window.ym === 'function') window.ym(c.ym, 'reachGoal', name, params || {}); } catch (e) { /* noop */ }
  };

  const once = (key, name, params) => {
    // одна и та же цель не чаще раза в 2 секунды (двойные клики)
    const k = key + ':' + Math.floor(Date.now() / 2000);
    if (sent.has(k)) return;
    sent.add(k);
    fire(name, params);
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href], button');
    if (!a) return;
    const href = (a.getAttribute('href') || '').toLowerCase();
    const place = (a.closest('section, header, footer, .dock, .fab') || {}).id || (a.closest('.dock') ? 'dock' : a.closest('.fab') ? 'fab' : a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'page');
    if (href.startsWith('tel:')) once('call', 'lead_call', { place });
    else if (href.includes('wa.me') || href.includes('whatsapp')) once('wa', a.matches('[data-calc="send"]') ? 'lead_form' : 'lead_whatsapp', { place });
    else if (a.matches('[data-calc="agree"]')) once('agree', 'calc_agree', { place: 'calc' });
    else if (a.matches('[data-calc="send"]')) once('form', 'lead_form', { place: 'calc' });
  }, true);

  // Доступно для ручной проверки в консоли: SG.track('lead_whatsapp')
  if (window.SG) window.SG.track = fire;
})();
