/* Тексты интерфейса: перевод, числовые формы и простановка текстов по разметке.

   Оба словаря подключены статически. Вместе они весят меньше одной иконки, зато
   переключение языка происходит мгновенно: при динамическом импорте пользователь
   успел бы увидеть пустые кнопки, а это хуже лишнего килобайта в бандле.

   Числовые формы хранятся прямо в значении через вертикальную черту:
     'common.n_min': '{n} минута|{n} минуты|{n} минут'
   В кыргызском слово после числа не меняется, поэтому там форма всегда одна.
*/

import ru from './lang.ru.js';
import ky from './lang.ky.js';
import { setDefaultLang } from './fmt.js';

const STORE_KEY = 'sg_lang';
const FALLBACK = 'ru';
const DICTS = { ru, ky };

export const LANGS = ['ru', 'ky'];

/* Атрибут разметки → свойство или атрибут узла. textContent стоит первым,
   потому что это самый частый случай. */
const BINDINGS = [
  ['data-t', null],
  ['data-t-ph', 'placeholder'],
  ['data-t-aria', 'aria-label'],
  ['data-t-title', 'title'],
];
const SELECTOR = BINDINGS.map((b) => '[' + b[0] + ']').join(',');

function normalize(value) {
  const v = String(value || '').toLowerCase().slice(0, 2);
  return v === 'ky' || v === 'ru' ? v : '';
}

function stored() {
  try {
    return normalize(localStorage.getItem(STORE_KEY));
  } catch (e) {
    return '';            // инкогнито или запрет на хранилище: просто работаем без памяти
  }
}

/* Кыргызский включаем сами, только если браузер прямо о нём просит.
   Во всех остальных случаях русский: в Бишкеке его понимают все. */
function fromBrowser() {
  if (typeof navigator === 'undefined') return FALLBACK;
  const list = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const item of list) {
    if (normalize(item) === 'ky') return 'ky';
  }
  return FALLBACK;
}

let lang = stored() || fromBrowser();
let dict = DICTS[lang];
const listeners = new Set();
const reported = new Set();     // о каждом потерянном ключе ругаемся ровно один раз

function warn(key, note) {
  if (reported.has(key)) return;
  reported.add(key);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[i18n] ' + note + ': ' + key + ' (' + lang + ')');
  }
}

/* Ищем строку в текущем словаре, затем в русском. Если нет нигде — null,
   и тогда наверх уйдёт сам ключ: дыру в переводе должно быть видно сразу. */
function lookup(key) {
  const own = dict[key];
  if (typeof own === 'string') return own;
  const base = DICTS[FALLBACK][key];
  if (typeof base === 'string') {
    warn(key, 'нет перевода, показываем русский');
    return base;
  }
  warn(key, 'ключ потерялся');
  return null;
}

/* Подстановка {name}. Пропущенную переменную оставляем в скобках: так ошибка
   бросается в глаза, а не превращается в «undefined» посреди фразы. */
function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/* Выбор числовой формы по русским правилам: 1 книга, 2 книги, 5 книг. */
function pick(raw, n) {
  const forms = raw.split('|');
  if (forms.length < 2) return raw;
  if (lang === 'ky') return forms[0];
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2] || forms[1] || forms[0];
  if (b === 1) return forms[0];
  if (b > 1 && b < 5) return forms[1] || forms[0];
  return forms[2] || forms[1] || forms[0];
}

/* t('order.from') → «Откуда»;  t('track.eta', {time: '8 мин'}) → «Будет через 8 мин».
   Если в ключе лежат числовые формы, берём ту, что подходит к vars.n. */
export function t(key, vars) {
  const raw = lookup(key);
  if (raw === null) return key;
  const n = vars && vars.n !== undefined && vars.n !== null ? Math.round(Number(vars.n) || 0) : 1;
  return fill(pick(raw, n), vars);
}

/* tp(3, 'common.n_min') → «3 минуты». Число само подставляется вместо {n}. */
export function tp(n, key, vars) {
  const count = Math.round(Number(n) || 0);
  const raw = lookup(key);
  if (raw === null) return key;
  const data = { n: count };
  if (vars) Object.assign(data, vars);
  return fill(pick(raw, count), data);
}

export function getLang() {
  return lang;
}

export function has(key) {
  return typeof dict[key] === 'string' || typeof DICTS[FALLBACK][key] === 'string';
}

/* Подписка на смену языка. Возвращает функцию отписки, чтобы экран, который
   уходит с глаз, не держал обработчик вечно. */
export function onLangChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLang(next) {
  const value = normalize(next) || FALLBACK;
  if (value === lang) return lang;
  lang = value;
  dict = DICTS[lang];
  reported.clear();               // в новом словаре могут не хватать другие ключи
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch (e) {
    /* хранилище закрыто: язык продержится до перезагрузки, это не повод падать */
  }
  setDefaultLang(lang);           // даты, деньги и расстояния должны заговорить так же
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', lang);
    applyTo(document);
  }
  for (const fn of Array.from(listeners)) {
    try {
      fn(lang);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('[i18n]', e);
    }
  }
  return lang;
}

function varsOf(node) {
  const raw = node.getAttribute('data-t-vars');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    warn(node.getAttribute('data-t') || 'data-t-vars', 'не разобрать data-t-vars');
    return null;
  }
}

function textOf(node, key) {
  const vars = varsOf(node);
  const count = node.getAttribute('data-t-n');
  return count === null ? t(key, vars) : tp(count, key, vars);
}

/* Проставляет тексты по разметке:
     <span data-t="order.from"></span>
     <input data-t-ph="order.from_ph" data-t-aria="order.from">
     <b data-t="common.n_loader" data-t-n="3"></b>
     <p data-t="track.eta" data-t-vars='{"time":"8 мин"}'></p>
   Содержимое узла с data-t заменяется целиком, поэтому внутрь него не кладут
   разметку. Возвращает число обработанных узлов: удобно в тестах. */
export function applyTo(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
  const nodes = Array.from(scope.querySelectorAll(SELECTOR));
  if (scope.nodeType === 1 && typeof scope.matches === 'function' && scope.matches(SELECTOR)) {
    nodes.unshift(scope);
  }
  for (const node of nodes) {
    for (const [attr, target] of BINDINGS) {
      const key = node.getAttribute(attr);
      if (!key) continue;
      const value = textOf(node, key);
      if (target === null) node.textContent = value;
      else if (target in node) node[target] = value;
      else node.setAttribute(target, value);
    }
  }
  return nodes.length;
}

// Язык известен ещё до первой отрисовки, поэтому сразу сообщаем его форматтеру
// и странице: иначе даты успеют мелькнуть на другом языке.
setDefaultLang(lang);
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.setAttribute('lang', lang);
}

export const i18n = { t, tp, setLang, getLang, onLangChange, applyTo, has, LANGS };
export default i18n;
