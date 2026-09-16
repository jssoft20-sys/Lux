/* Мостик в приложение курьера для Android.

   Веб на телефоне не умеет главного, ради чего водителю приложение: держать
   связь с сервером и слать координаты, когда экран погас, и будить звуком на
   новый заказ. Это умеет только приложение — но оно не знает, кто вошёл и на
   линии ли человек. Знает веб. Поэтому веб кричит сюда три вещи: «вот токен»,
   «я на линии», «я ушёл», а дальше приложение работает само.

   В обычном браузере окна window.SprinterGo просто нет, и всё здесь молча
   ничего не делает: ни одного условия в вызывающем коде добавлять не нужно.

   Сторона Android: android/app/src/main/java/kg/sprintergo/courier/Bridge.java
*/

function bridge() {
  try {
    const b = typeof window !== 'undefined' ? window.SprinterGo : null;
    return b && typeof b === 'object' ? b : null;
  } catch (e) {
    return null;                       // чужая песочница — считаем, что мостика нет
  }
}

/** Мы внутри приложения? Веб по этому признаку не предлагает его скачать. */
export function inApp() {
  const b = bridge();
  if (b && typeof b.isApp === 'function') {
    try {
      return !!b.isApp();
    } catch (e) {
      /* мостик есть, но отвечать отказался — проверим по подписи браузера */
    }
  }
  return / SprinterGoApp\//.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
}

function call(name, ...args) {
  const b = bridge();
  if (!b || typeof b[name] !== 'function') return false;
  try {
    b[name](...args);
    return true;
  } catch (e) {
    // Мостик не должен ронять экран: не вышло — водитель просто останется
    // на обычной, браузерной работе, а не на белом экране.
    console.warn('[приложение] не отработало', name, e);
    return false;
  }
}

/** Токен курьера. Без него служба в приложении не знает, за кого говорить. */
export function setToken(token) {
  const value = String(token || '').trim();
  if (value) return call('setToken', value);
  return call('clearToken');
}

/** Вход и выход с линии. Приложение поднимает и гасит по этому свою службу. */
export function setShift(on) {
  return call('setShift', !!on);
}

/** Адрес сервиса. Приложение обращается к серверу само, мимо страницы. */
export function announceBase() {
  try {
    const path = String((typeof window !== 'undefined' && window.SG_BASE) || '/');
    const origin = window.location.origin;
    // Приложение работает только по HTTPS — на http Android не даст ни связи в
    // фоне, ни геопозиции, и сторона Java такой адрес всё равно не примет.
    // Исключение одно: свой же компьютер, где гоняют проверки.
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
    if (!/^https:/.test(origin) && !local) return false;
    return call('setBase', origin + path.replace(/\/$/, ''));
  } catch (e) {
    return false;
  }
}

/** Короткая вибрация там, где браузер её не умеет (айфон, старый WebView). */
export function buzz(ms) {
  return call('buzz', Math.max(1, Math.min(200, Math.round(ms) || 12)));
}

/** Приложение говорит, что смена уже идёт: служба пережила перезапуск окна. */
export function onAppShift(fn) {
  if (typeof fn !== 'function' || typeof window === 'undefined') return () => {};
  const handler = (e) => {
    const on = !!(e && e.detail && e.detail.on);
    try {
      fn(on);
    } catch (err) {
      console.error('[приложение] обработчик смены упал', err);
    }
  };
  window.addEventListener('sg-app-shift', handler);
  return () => window.removeEventListener('sg-app-shift', handler);
}

/* Токен меняется в одном месте — в core/api.js. Чтобы не расставлять вызовы по
   всем экранам входа и выхода, api зовёт нас оттуда сам. */
export default { inApp, setToken, setShift, announceBase, buzz, onAppShift };
