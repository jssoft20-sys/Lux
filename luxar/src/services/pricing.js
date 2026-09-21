import { round2 } from '../utils/money.js';
import { store } from '../store.js';

export function discountFor(car, days) {
  const d = car.discounts || {};
  if (days >= 30 && d.d30) return Number(d.d30);
  if (days >= 7 && d.d7) return Number(d.d7);
  if (days >= 3 && d.d3) return Number(d.d3);
  return 0;
}

/* Расчёт стоимости аренды (в USD) */
export function quote({ car, days, pickup = 'self', pricePerDay }) {
  const site = store.settings.site;
  const ppd = Number(pricePerDay ?? car.pricePerDay) || 0;
  const subtotal = round2(ppd * days);
  const discountPercent = discountFor(car, days);
  const discount = round2((subtotal * discountPercent) / 100);
  const deliveryFee = pickup === 'delivery' && site.deliveryEnabled ? Number(site.deliveryFeeUsd) || 0 : 0;
  const totalUsd = round2(subtotal - discount + deliveryFee);
  return { pricePerDay: ppd, days, subtotal, discountPercent, discount, deliveryFee, totalUsd };
}

/* Перевод суммы в сомы и USDT по курсам из настроек */
export function convert(totalUsd) {
  const r = store.settings.rates;
  return {
    kgs: Math.round(totalUsd * (Number(r.kgsPerUsd) || 0)),
    usdt: round2(totalUsd * (Number(r.usdtPerUsd) || 1)),
    rates: { kgsPerUsd: Number(r.kgsPerUsd) || 0, usdtPerUsd: Number(r.usdtPerUsd) || 1 },
  };
}
