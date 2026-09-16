/* Оболочка страницы: заставка, установка приложения, память места, цвет строки состояния.

   Модуль подключается прямо из html отдельным <script type="module"> и работает
   сам по себе — экраны его не зовут и ничего о нём не знают. Так сделано
   намеренно: заставка должна погаснуть даже если приложение не поднялось,
   а полоса установки — жить независимо от того, какой экран сейчас открыт.

   Что здесь происходит:
     1. Заставка. Разметка лежит в html и видна до загрузки скриптов, гасим её
        мы — когда шрифты подъехали и первый экран нарисовался.
     2. Цвет строки состояния телефона держим в тон теме: на заставке жёлтый,
        дальше цвет фона.
     3. Полоса установки (только у клиента): на Android ставим по-настоящему,
        на айфоне показываем два шага со значками.
     4. Подсказка «вернуться туда, где вы были» — по памяти из core/router.js.
     5. Служебный воркер клиента.
*/

import { t, extend, onLangChange } from './i18n.js';
import { haptic } from './ui.js';
import { lastPlace, forgetPlace } from './router.js';

extend({
  ru: {
    'shell.install_note': 'Заказ в один тап',
    'shell.install_btn': 'Установить',
    'shell.install_hide': 'Скрыть',
    'shell.installed': 'Готово, значок на экране',
    'shell.ios_title': 'Как поставить на экран',
    'shell.ios_step1': 'Нажмите «Поделиться» внизу браузера',
    'shell.ios_step2': 'Выберите «На экран «Домой»',
    'shell.ios_ok': 'Понятно',
    'shell.restore': 'Вернуться туда, где вы остановились?',
    'shell.restore_btn': 'Открыть',
    'shell.restore_no': 'Не надо',
  },
  ky: {
    'shell.install_note': 'Бир басууда заказ',
    'shell.install_btn': 'Орнотуу',
    'shell.install_hide': 'Жашыруу',
    'shell.installed': 'Даяр, белгиче экранда турат',
    'shell.ios_title': 'Экранга кантип чыгарам',
    'shell.ios_step1': 'Браузердин ылдый жагындагы «Поделиться» баскычын басыңыз',
    'shell.ios_step2': 'Тизмеден «На экран «Домой» дегенди тандаңыз',
    'shell.ios_ok': 'Түшүндүм',
    'shell.restore': 'Токтогон жериңизге кайтасызбы?',
    'shell.restore_btn': 'Ачуу',
    'shell.restore_no': 'Кереги жок',
  },
});

const root = document.documentElement;
const page = root.dataset.app || '';          // 'client' | 'courier' | 'admin'

/* Сколько живёт заставка. Холодный старт — чуть дольше, чтобы знак успели
   увидеть; тёплая перезагрузка уходит сразу, как только экран готов. */
const COLD_MIN_MS = 560;
const FONTS_CAP_MS = 1500;
const SCREEN_CAP_MS = 1200;
const HARD_CAP_MS = 2600;

const DAY_S = 24 * 3600;
const INSTALL_OFF_KEY = 'sg_install_off';
const INSTALL_SNOOZE_S = 7 * DAY_S;           // закрыл полосу — неделю не лезем
const RESTORE_DELAY_MS = 900;                 // даём приложению самому решить, куда идти
const RESTORE_LIFE_MS = 14000;

/* ─────────────────────────────────────────────────────── мелочи */

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Длительность из токенов в миллисекундах: с «меньше движения» вернётся 1 мс. */
function dur(name, fallback) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : n * 1000;
}

function nowS() {
  return Math.floor(Date.now() / 1000);
}

function readS(key) {
  try {
    return Math.floor(Number(localStorage.getItem(key)) || 0);
  } catch (e) {
    return 0;
  }
}

function writeS(key, value) {
  try {
    localStorage.setItem(key, String(Math.floor(value)));
  } catch (e) {
    /* хранилище закрыто — настойчивость переживём */
  }
}

/** Приложение уже стоит значком на экране: ставить второй раз нечего. */
function installed() {
  if (navigator.standalone === true) return true;
  if (!window.matchMedia) return false;
  return matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches;
}

const ua = navigator.userAgent || '';
// Айпад с iPadOS представляется маком, отличаем его по сенсорному экрану.
const isApple = /iphone|ipad|ipod/i.test(ua) ||
  (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);

function svg(body, extra) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
    (extra ? ' ' + extra : '') + '>' + body + '</svg>';
}

const ICO_SHARE = svg('<path d="M12 3.4v10.8"/><path d="m8.4 7 3.6-3.6L15.6 7"/>' +
  '<path d="M7.4 10.6H5.9A1.9 1.9 0 0 0 4 12.5v6.2a1.9 1.9 0 0 0 1.9 1.9h12.2a1.9 1.9 0 0 0 1.9-1.9v-6.2a1.9 1.9 0 0 0-1.9-1.9h-1.5"/>');
const ICO_ADD = svg('<rect x="4" y="4" width="16" height="16" rx="4.6"/>' +
  '<path d="M12 8.8v6.4M8.8 12h6.4"/>');
const ICO_CLOSE = svg('<path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4"/>');

/* ─────────────────────────────────────────────────────── цвет строки состояния */

/* Телефон красит свою верхнюю полосу в цвет из meta[theme-color]. Пока висит
   заставка — она жёлтая, дальше берём фон темы. Цвет читаем из токенов, а не
   пишем числом: тему правят в tokens.css, и дублировать значения тут нельзя. */
function paintBar(color) {
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  const value = color || getComputedStyle(root).getPropertyValue('--bg').trim();
  if (value) meta.setAttribute('content', value);
}

function watchTheme() {
  const obs = new MutationObserver(() => {
    if (!splashUp) paintBar();
  });
  obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) {
    const media = matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', () => {
      if (!splashUp) paintBar();
    });
  }
}

/* ─────────────────────────────────────────────────────── заставка */

let splash = document.getElementById('sg-splash');
let splashUp = !!splash;
let splashDone = null;

/** Сколько миллисекунд прошло с начала загрузки страницы. */
function sinceStart() {
  return window.performance && performance.now ? performance.now() : HARD_CAP_MS;
}

/** Внутри узла уже что-то настоящее, а не полоска загрузки? */
function live(host) {
  if (!host) return false;
  // Скрытый блок не считается: у курьера и в админке так спрятан вход.
  if (!host.getClientRects().length) return false;
  for (const node of host.children) {
    if (node.classList.contains('sg-boot') || node.classList.contains('boot')) continue;
    return true;
  }
  return false;
}

function readyHosts() {
  const sel = splash ? splash.dataset.ready : '';
  if (!sel) return [];
  return Array.from(document.querySelectorAll(sel));
}

/* Первый экран готов: в одном из наблюдаемых мест появилось содержимое.
   Ждём не дольше предела — сломанное приложение не должно держать заставку. */
function waitScreen() {
  const hosts = readyHosts();
  if (!hosts.length || hosts.some(live)) return Promise.resolve();
  return new Promise((done) => {
    let timer = 0;
    const obs = new MutationObserver(() => {
      if (!readyHosts().some(live)) return;
      obs.disconnect();
      clearTimeout(timer);
      done();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(() => {
      obs.disconnect();
      done();
    }, SCREEN_CAP_MS);
  });
}

function waitFonts() {
  if (!document.fonts || !document.fonts.ready) return Promise.resolve();
  return Promise.race([
    document.fonts.ready.then(() => {}, () => {}),
    delay(FONTS_CAP_MS),
  ]);
}

/** Убрать заставку. Зовётся сама, но экран может поторопить её вручную. */
export function hideSplash() {
  if (!splashUp) return;
  splashUp = false;
  root.dataset.boot = 'done';
  paintBar();
  if (!splash) return;
  splash.classList.add('is-out');
  setTimeout(() => splash.remove(), dur('--dur-2', 240) + 140);
}

function runSplash() {
  if (!splash) {
    paintBar();
    return;
  }
  const cold = root.dataset.boot === 'cold';
  if (!cold) {
    // Тёплая перезагрузка — заставки нет вовсе. Она нужна, чтобы скрасить
    // первое ожидание; когда всё уже в кэше, жёлтая вспышка на каждом
    // обновлении страницы только надоедает, о чём и просил владелец.
    // Разметку при этом не трогаем: следующий холодный запуск её найдёт.
    splashDone = Promise.resolve();
    splash.remove();          // без прощального затухания: её и не показывали
    splash = null;
    hideSplash();
    return;
  }
  // На заставке телефон красит верхнюю полосу в её же цвет — иначе над жёлтым
  // экраном висит светлая или тёмная плашка, и это выглядит как недогруз.
  paintBar(getComputedStyle(root).getPropertyValue('--accent').trim() || '#FFDF00');

  splashDone = (async () => {
    await Promise.race([
      Promise.all([waitFonts(), waitScreen()]),
      delay(HARD_CAP_MS),
    ]);
    // Знак не должен мигнуть на холодном старте: додерживаем до минимума.
    const left = COLD_MIN_MS - sinceStart();
    if (cold && left > 0) await delay(left);
    await new Promise((done) => requestAnimationFrame(() => done()));
    hideSplash();
  })();
  // Предохранитель на случай, если что-то выше застряло: заставка уходит всегда.
  setTimeout(hideSplash, HARD_CAP_MS + 700);
}

/* ─────────────────────────────────────────────────────── установка приложения */

let deferred = null;         // пойманное браузером предложение установки
let bar = null;
let guide = null;

function snooze(seconds) {
  writeS(INSTALL_OFF_KEY, nowS() + seconds);
}

function snoozed() {
  return readS(INSTALL_OFF_KEY) > nowS();
}

/** Можно ли прямо сейчас предложить установку. */
export function canInstall() {
  if (page !== 'client' || installed()) return false;
  return !!deferred || isApple;
}

function removeBar() {
  if (!bar) return;
  bar.remove();
  bar = null;
  root.removeAttribute('data-install-bar');
}

function barTexts() {
  if (!bar) return;
  bar.querySelector('.sg-install__note').textContent = t('shell.install_note');
  bar.querySelector('.sg-install__go').textContent = t('shell.install_btn');
  bar.querySelector('.sg-install__x').setAttribute('aria-label', t('shell.install_hide'));
}

/* Открыта ли поверх экрана шторка. Полоса установки лежит ниже них — так и
   задумано, окно важнее, — но значит, поверх открытого окна её просто не
   видно. Человек в этот момент занят другим, и предлагать ему второе дело
   всё равно не стоит. */
function sheetOpen() {
  return !!document.querySelector('.sheet, .sg-chat, .sg-photo');
}

let barWait = 0;

function showBar() {
  if (bar || !canInstall() || snoozed()) return;
  if (sheetOpen()) {
    // Дождёмся, пока человек закончит с окном, и предложим тогда.
    if (!barWait) {
      barWait = window.setInterval(() => {
        if (sheetOpen()) return;
        window.clearInterval(barWait);
        barWait = 0;
        showBar();
      }, 1200);
    }
    return;
  }
  if (barWait) { window.clearInterval(barWait); barWait = 0; }

  bar = document.createElement('div');
  bar.className = 'sg-install';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Sprinter Go');
  bar.innerHTML =
    '<img class="sg-install__logo" width="36" height="36" alt="">' +
    '<span class="sg-install__text">' +
      '<b class="sg-install__name">Sprinter Go</b>' +
      '<span class="sg-install__note"></span>' +
    '</span>' +
    '<button class="sg-install__go" type="button"></button>' +
    '<button class="sg-install__x" type="button">' + ICO_CLOSE + '</button>';

  // Путь к значку берём от префикса установки: сервис умеют вешать в подпапку.
  bar.querySelector('.sg-install__logo').src =
    (window.SG_BASE || '/') + 'assets/img/logo.svg';

  bar.querySelector('.sg-install__go').addEventListener('click', () => {
    haptic();
    promptInstall();
  });
  bar.querySelector('.sg-install__x').addEventListener('click', () => {
    haptic(8);
    snooze(INSTALL_SNOOZE_S);
    removeBar();
  });

  document.body.appendChild(bar);
  barTexts();
  root.dataset.installBar = 'on';
}

/** Поставить приложение: на Android по-настоящему, на айфоне — показать шаги. */
export async function promptInstall() {
  if (deferred) {
    const evt = deferred;
    deferred = null;
    removeBar();
    try {
      evt.prompt();
      const res = await evt.userChoice;
      // Отказался — Chrome больше не предложит до следующего захода, и нам
      // мозолить глаза незачем: вернёмся к разговору через день.
      if (!res || res.outcome !== 'accepted') snooze(DAY_S);
    } catch (e) {
      snooze(DAY_S);
    }
    return;
  }
  if (isApple) openGuide();
}

/* Айфон своего окна установки не даёт, поэтому показываем ровно два шага
   с нарисованными значками — теми же, что человек увидит в Safari. */
function openGuide() {
  if (guide) return;
  guide = document.createElement('div');
  guide.className = 'sg-guide';
  guide.innerHTML =
    '<div class="sg-guide__back"></div>' +
    '<div class="sg-guide__box" role="dialog" aria-modal="true" aria-labelledby="sg-guide-title">' +
      '<span class="sg-guide__grip" aria-hidden="true"></span>' +
      '<h2 class="sg-guide__title" id="sg-guide-title"></h2>' +
      '<ol class="sg-guide__steps">' +
        '<li class="sg-guide__step"><span class="sg-guide__n">1</span>' +
          '<span class="sg-guide__text"></span>' +
          '<span class="sg-guide__ico">' + ICO_SHARE + '</span></li>' +
        '<li class="sg-guide__step"><span class="sg-guide__n">2</span>' +
          '<span class="sg-guide__text"></span>' +
          '<span class="sg-guide__ico">' + ICO_ADD + '</span></li>' +
      '</ol>' +
      '<button class="btn btn--primary btn--lg btn--block sg-guide__ok" type="button"></button>' +
    '</div>';

  guide.querySelector('.sg-guide__title').textContent = t('shell.ios_title');
  const steps = guide.querySelectorAll('.sg-guide__text');
  steps[0].textContent = t('shell.ios_step1');
  steps[1].textContent = t('shell.ios_step2');
  const ok = guide.querySelector('.sg-guide__ok');
  ok.textContent = t('shell.ios_ok');

  const close = () => closeGuide();
  ok.addEventListener('click', close);
  guide.querySelector('.sg-guide__back').addEventListener('click', close);
  document.addEventListener('keydown', onGuideKey);

  document.body.appendChild(guide);
  requestAnimationFrame(() => guide && guide.classList.add('is-on'));
  // Фокус ставим на саму шторку, а не на кнопку: читалка прочтёт заголовок,
  // а на экране не появится синее кольцо вокруг «Понятно».
  const box = guide.querySelector('.sg-guide__box');
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
}

function onGuideKey(e) {
  if (e.key === 'Escape') closeGuide();
}

function closeGuide() {
  if (!guide) return;
  const node = guide;
  guide = null;
  document.removeEventListener('keydown', onGuideKey);
  node.classList.remove('is-on');
  setTimeout(() => node.remove(), dur('--dur-2', 240) + 60);
}

function watchInstall() {
  if (page !== 'client') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // своё окно покажем сами, когда попросят
    deferred = e;
    if (!installed()) showBar();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    const note = bar && bar.querySelector('.sg-install__note');
    if (note) {
      note.textContent = t('shell.installed');
      bar.classList.add('is-done');
      setTimeout(removeBar, 2200);
    }
    snooze(365 * DAY_S);
  });

  // У айфона события установки нет вовсе — предлагаем сами, но не сразу:
  // первым делом человек должен увидеть сервис, а не просьбу его поставить.
  if (isApple && !installed() && !snoozed()) setTimeout(showBar, 1600);
}

/* ─────────────────────────────────────────────────────── «вернуться, где был» */

let restore = null;

/* Каким адрес был в момент открытия страницы. Приложение через мгновение
   поставит свой домашний экран (#/shift, #/overview), и по адресу уже не
   понять, пришёл человек на голый корень или по прямой ссылке. Мы успеваем
   раньше: модуль подключён до приложения. */
const openedBare = (() => {
  const raw = String(location.hash || '').slice(1);
  return !raw || raw === '/';
})();

/* Запомненное место снимаем тем же кадром, что и адрес. Приложение через
   мгновение уйдёт на свой домашний экран, а домашний экран запоминать незачем —
   и роутер честно сотрёт ключ. Спросив память позже, мы находили бы пусто и
   никогда ничего не предлагали. */
const placeAtStart = openedBare ? lastPlace() : null;

/* Приложение само увело человека в дело — например, к едущему заказу.
   Тогда подсказка «вернуться» только мешает. */
function busyNow() {
  const raw = String(location.hash || '').slice(1);
  if (!raw) return false;
  if (raw.indexOf('?') >= 0) return true;          // адрес с параметрами
  if (raw.indexOf('/~') >= 0) return true;         // уже что-то открыто поверх
  return raw.split('/').filter(Boolean).length > 1;
}

function hideRestore() {
  if (!restore) return;
  restore.classList.remove('is-on');
  const node = restore;
  restore = null;
  setTimeout(() => node.remove(), dur('--dur-2', 240) + 60);
}

/* Полоску ставим под верхний ряд страницы, чтобы она не легла на логотип.
   Высоту ряда меряем: у клиента он один, у курьера и админки другой. */
function restoreTop() {
  const row = document.querySelector('.sg-top, .app__top, .adm__top');
  const barBox = bar ? bar.getBoundingClientRect() : null;
  const rowBox = row ? row.getBoundingClientRect() : null;
  const under = Math.max(rowBox ? rowBox.bottom : 0, barBox ? barBox.bottom : 0);
  return Math.max(under + 8, 8);
}

function offerRestore() {
  if (!openedBare || busyNow()) return;
  const place = placeAtStart;
  if (!place) return;
  if (place.hash === String(location.hash || '').slice(1)) return;

  restore = document.createElement('div');
  restore.className = 'sg-restore';
  restore.setAttribute('role', 'status');
  restore.innerHTML =
    '<span class="sg-restore__text"></span>' +
    '<button class="sg-restore__go" type="button"></button>' +
    '<button class="sg-restore__x" type="button">' + ICO_CLOSE + '</button>';
  restore.querySelector('.sg-restore__text').textContent = t('shell.restore');
  restore.querySelector('.sg-restore__go').textContent = t('shell.restore_btn');
  restore.querySelector('.sg-restore__x').setAttribute('aria-label', t('shell.restore_no'));

  restore.querySelector('.sg-restore__go').addEventListener('click', () => {
    haptic();
    hideRestore();
    location.hash = '#' + place.hash;     // дальше разберётся роутер приложения
  });
  restore.querySelector('.sg-restore__x').addEventListener('click', () => {
    haptic(8);
    forgetPlace();
    hideRestore();
  });

  document.body.appendChild(restore);
  restore.style.top = restoreTop() + 'px';
  requestAnimationFrame(() => restore && restore.classList.add('is-on'));

  // Ушёл сам — подсказка больше не нужна.
  window.addEventListener('hashchange', hideRestore, { once: true });
  setTimeout(hideRestore, RESTORE_LIFE_MS);
}

/* ─────────────────────────────────────────────────────── служебный воркер */

function registerWorker() {
  if (page !== 'client' || !('serviceWorker' in navigator)) return;
  const base = window.SG_BASE || '/';
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(base + 'sw-client.js', { scope: base, updateViaCache: 'none' })
      .catch(() => { /* http без tls или приватный режим — работаем без кэша */ });
  });
}

/* ─────────────────────────────────────────────────────── запуск */

watchTheme();
runSplash();
watchInstall();
registerWorker();

onLangChange(() => {
  barTexts();
  if (guide) {
    closeGuide();          // переписывать шаги на лету незачем — их и так видно один раз
  }
  hideRestore();
});

// Подсказку показываем после заставки: два уведомления разом — это суета.
// catch здесь не для красоты: если заставка споткнётся, подсказка всё равно
// должна дойти до человека.
Promise.resolve(splashDone)
  .catch(() => {})
  .then(() => delay(RESTORE_DELAY_MS))
  .then(offerRestore);

export const shell = { hideSplash, canInstall, promptInstall, lastPlace, forgetPlace };
window.sgShell = shell;
export default shell;
