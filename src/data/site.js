'use strict';
/**
 * Global site configuration. Change contacts / brand here — every page is rebuilt from this file.
 */
module.exports = {
  brand: 'HeliHop',
  brandFull: 'HeliHop Travel',
  domain: 'https://helihop-travel.com',
  phone: '+996 501 112 211',
  phoneRaw: '996501112211',
  whatsapp: 'https://wa.me/996501112211',
  instagram: 'https://instagram.com/helihop.travel',
  instagramHandle: '@helihop.travel',
  email: '',
  city: { ru: 'Бишкек', en: 'Bishkek', ky: 'Бишкек' },
  base: { ru: 'Вылет из Бишкека', en: 'Departure from Bishkek', ky: 'Бишкектен учуу' },
  year: 2026,
  langs: ['ru', 'en', 'ky'],
  defaultLang: 'ru',
  langNames: { ru: 'Русский', en: 'English', ky: 'Кыргызча' },
  langShort: { ru: 'RU', en: 'EN', ky: 'KG' },
  currency: { ru: 'сом', en: 'KGS', ky: 'сом' },
  priceFrom: 33000,
  stats: [
    { value: 100, suffix: '+', label: { ru: 'предложений руки и сердца', en: 'marriage proposals, all time', ky: 'сүйүү сунушу, бардык убакытта' } },
    { value: 20, suffix: '+', label: { ru: 'лет опыта у каждого пилота', en: 'years of experience, every pilot', ky: 'жыл тажрыйба, ар бир пилотто' } },
    { value: 8000, suffix: '+', label: { ru: 'часов налёта у пилотов', en: 'flight hours, every pilot', ky: 'саат учуу, ар бир пилотто' } },
    { value: 'H125 / H145', label: { ru: 'вертолёты Airbus для горных маршрутов', en: 'Airbus helicopters for mountain routes', ky: 'тоо багыттары үчүн Airbus вертолёттору' } },
  ],
};
