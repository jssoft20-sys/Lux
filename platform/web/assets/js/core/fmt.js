/* Как показывать числа, деньги, время и телефоны.

   Деньги в базе — целые тыйыны, здесь они впервые превращаются в текст.
   Внутри чисел и между числом и единицей стоит неразрывный пробел: «1 250 сом»
   на узком экране не должно разрываться посередине.

   Второй аргумент везде — язык. Если его не передали, берётся тот, что выставили
   через setDefaultLang(): приложение делает это один раз при смене языка.
*/

const NBSP = ' ';

let defaultLang = 'ru';
let tz = null;          // часовой пояс сервиса; null — часы браузера
let tzFormatter = null;

/* Язык по умолчанию для всех функций модуля. Вызывается из i18n при смене языка. */
export function setDefaultLang(lang) {
  defaultLang = lang === 'ky' ? 'ky' : 'ru';
  return defaultLang;
}

/* Часовой пояс сервиса (из настроек, например Asia/Bishkek). Нужен, чтобы
   администратор из другой страны видел те же часы, что курьер в Бишкеке. */
export function setTimeZone(name) {
  tzFormatter = null;
  if (!name) {
    tz = null;
    return null;
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name }).format(new Date());
    tz = name;
  } catch (e) {
    tz = null;          // пояс не знаком браузеру — остаёмся на местном времени
  }
  return tz;
}

function lng(lang) {
  return lang === 'ky' || lang === 'ru' ? lang : defaultLang;
}

const MONTHS = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  ky: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
};

// ─────────────────────────────────────────────────────────────── числа

function groups(digits) {
  return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

function one(value, maxWhole) {
  /* Один знак после запятой, пока число небольшое; дальше дробь только мешает. */
  if (Math.abs(value) >= maxWhole) return groups(Math.round(value));
  const r = Math.round(value * 10) / 10;
  return String(r).replace('.', ',');
}

/* Целое число с разрядами: «12 500». */
export function num(value) {
  const v = Math.round(Number(value) || 0);
  return (v < 0 ? '-' : '') + groups(Math.abs(v));
}

// ─────────────────────────────────────────────────────────────── деньги

/* Тыйыны → «1 250 сом». Копейки показываем, только если они есть. */
export function money(tiyin, lang) {
  const t = Math.round(Number(tiyin) || 0);
  const sign = t < 0 ? '-' : '';
  const abs = Math.abs(t);
  const som = Math.floor(abs / 100);
  const rest = abs % 100;
  let out = groups(som);
  if (rest) out += ',' + String(rest).padStart(2, '0');
  return sign + out + NBSP + 'сом';
}

/* Короткая форма для чипов и карточек, где места мало: «850 с», «12,4 тыс. с». */
export function moneyShort(tiyin, lang) {
  const L = lng(lang);
  const t = Math.round(Number(tiyin) || 0);
  const sign = t < 0 ? '-' : '';
  const som = Math.round(Math.abs(t) / 100);
  if (som >= 10000) {
    const big = L === 'ky' ? 'миң' : 'тыс.';
    return sign + one(som / 1000, 100) + NBSP + big + NBSP + 'с';
  }
  return sign + groups(som) + NBSP + 'с';
}

// ─────────────────────────────────────────────────────────────── расстояние и время

/* Метры → «850 м» или «12,4 км». Ниже километра округляем до десятков:
   точность в один метр всё равно врёт, зато цифра прыгает на каждом обновлении. */
export function distance(m, lang) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  if (v < 1000) {
    const r = v < 100 ? v : Math.round(v / 10) * 10;
    if (r < 1000) return r + NBSP + 'м';
  }
  return one(v / 1000, 100) + NBSP + 'км';
}

/* Секунды → «8 мин», «1 ч 20 мин», «2 д 3 ч». */
export function duration(s, lang) {
  const L = lng(lang);
  const U = L === 'ky'
    ? { d: 'күн', h: 'саат', m: 'мүн', less: 'бир мүнөттөн аз' }
    : { d: 'д', h: 'ч', m: 'мин', less: 'меньше минуты' };
  const v = Math.max(0, Math.round(Number(s) || 0));
  if (v < 60) return U.less;
  const mins = Math.round(v / 60);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days) {
    const tail = hours ? ' ' + hours + NBSP + U.h : '';
    return days + NBSP + U.d + tail;
  }
  if (hours) {
    const tail = rest ? ' ' + rest + NBSP + U.m : '';
    return hours + NBSP + U.h + tail;
  }
  return mins + NBSP + U.m;
}

// ─────────────────────────────────────────────────────────────── дата и время

function formatter() {
  if (!tzFormatter) {
    tzFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || undefined,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return tzFormatter;
}

/* Разбор момента на части в нужном поясе. Названия месяцев берём свои:
   на кыргызский Intl полагаться нельзя, в части браузеров его просто нет. */
function parts(unix) {
  const ms = (Number(unix) || 0) * 1000;
  const d = new Date(ms);
  if (!tz) {
    return {
      y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(),
      h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(),
    };
  }
  try {
    const out = {};
    for (const p of formatter().formatToParts(d)) {
      if (p.type !== 'literal') out[p.type] = p.value;
    }
    return {
      y: +out.year, mo: +out.month, d: +out.day,
      h: +out.hour % 24, mi: +out.minute, s: +out.second,
    };
  } catch (e) {
    return {
      y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(),
      h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(),
    };
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKey(p) {
  return p.y * 10000 + p.mo * 100 + p.d;
}

/* «14:05» */
export function time(unix, lang) {
  const p = parts(unix);
  return pad2(p.h) + ':' + pad2(p.mi);
}

/* «13 сентября», в другом году — «13 сентября 2025». По-кыргызски «13-сентябрь». */
export function date(unix, lang) {
  const L = lng(lang);
  const p = parts(unix);
  const now = parts(Math.floor(Date.now() / 1000));
  const month = MONTHS[L][p.mo - 1];
  if (L === 'ky') {
    const head = p.d + '-' + month;
    return p.y === now.y ? head : head + ' ' + p.y + '-жыл';
  }
  const head = p.d + ' ' + month;
  return p.y === now.y ? head : head + ' ' + p.y;
}

/* «13 сентября, 14:05» */
export function dateTime(unix, lang) {
  return date(unix, lang) + ', ' + time(unix, lang);
}

/* «только что», «5 минут назад», «вчера, 14:05», дальше — просто дата. */
export function timeAgo(unix, lang) {
  const L = lng(lang);
  const t = Number(unix) || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = nowSec - t;

  if (diff < 45) return L === 'ky' ? 'азыр эле' : 'только что';
  if (diff < 3600) {
    const m = Math.max(1, Math.round(diff / 60));
    return L === 'ky'
      ? m + NBSP + 'мүнөт мурун'
      : m + NBSP + plural(m, ['минуту', 'минуты', 'минут']) + ' назад';
  }
  const p = parts(t);
  const np = parts(nowSec);
  if (diff < 86400 && dayKey(p) === dayKey(np)) {
    const h = Math.max(1, Math.floor(diff / 3600));
    return L === 'ky'
      ? h + NBSP + 'саат мурун'
      : h + NBSP + plural(h, ['час', 'часа', 'часов']) + ' назад';
  }
  const yest = parts(nowSec - 86400);
  if (dayKey(p) === dayKey(yest)) {
    return (L === 'ky' ? 'кечээ, ' : 'вчера, ') + time(t, L);
  }
  return date(t, L);
}

// ─────────────────────────────────────────────────────────────── строки

/* «+996 755 555 357». Понимаем и 0755…, и 755…, и запись со скобками. */
export function phone(value, lang) {
  let d = String(value || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9) d = '996' + d;
  else if (d.length === 10 && d[0] === '0') d = '996' + d.slice(1);
  if (d.length === 12 && d.startsWith('996')) {
    return '+996' + NBSP + d.slice(3, 6) + NBSP + d.slice(6, 9) + NBSP + d.slice(9);
  }
  return '+' + d.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/* Кыргызские номера: 01KG123ABC → «01 KG 123 ABC», старые B1234AB → «B 1234 AB». */
export function plate(value, lang) {
  const v = String(value || '').toUpperCase().replace(/[^0-9A-ZА-Я]/g, '');
  if (!v) return '';
  let m = v.match(/^(\d{2})(KG|КГ)(\d{3,4})([A-ZА-Я]{2,3})$/);
  if (m) return m[1] + NBSP + m[2] + NBSP + m[3] + NBSP + m[4];
  m = v.match(/^(\d{2})(\d{3,4})([A-ZА-Я]{2,3})$/);
  if (m) return m[1] + NBSP + m[2] + NBSP + m[3];
  m = v.match(/^([A-ZА-Я]{1,2})(\d{3,4})([A-ZА-Я]{2,3})$/);
  if (m) return m[1] + NBSP + m[2] + NBSP + m[3];
  return v;
}

/* plural(5, ['минута','минуты','минут']) → «минут».
   В кыргызском слово после числа не меняется, поэтому берём первую форму. */
export function plural(n, forms, lang) {
  const list = Array.isArray(forms) ? forms : [String(forms || '')];
  const first = list[0] || '';
  if (lng(lang) === 'ky') return first;
  const a = Math.abs(Math.round(Number(n) || 0)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return list[2] || list[1] || first;
  if (b === 1) return first;
  if (b > 1 && b < 5) return list[1] || first;
  return list[2] || list[1] || first;
}

/* «Азамат Сыдыков» → «АС». Для кружка с аватаром, когда фото нет. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const head = (w) => {
    const ch = Array.from(w)[0];
    return ch ? ch.toUpperCase() : '';
  };
  return words.length === 1 ? head(words[0]) : head(words[0]) + head(words[1]);
}

export const fmt = {
  money, moneyShort, num, distance, duration,
  time, date, dateTime, timeAgo,
  phone, plate, plural, initials,
  setDefaultLang, setTimeZone, NBSP,
};

export { NBSP };
export default fmt;
