/* Клиент к нашему API: обычные запросы и поток событий.

   Всё общение с сервером идёт через этот модуль, поэтому здесь же собраны скучные,
   но важные вещи: префикс /api/v1, токен, таймаут и понятные сообщения об ошибках.
   Если сервер молчит двадцать секунд — мы не ждём вечно, а честно говорим об этом:
   на улице со слабым интернетом зависший экран злит сильнее любой ошибки.
*/

const BASE = '/api/v1';
const TOKEN_KEY = 'sg_token';
const TIMEOUT_MS = 20000;

/* Сообщения про связь. Сервер их не присылает — это то, что видит человек,
   когда до сервера вообще не достучались. */
const NET = {
  offline: 'Нет интернета. Проверьте связь и попробуйте ещё раз',
  timeout: 'Сервер долго не отвечает. Попробуйте ещё раз',
  network: 'Не получилось связаться с сервером. Попробуйте ещё раз',
  stream: 'Связь с сервером прервалась, восстанавливаем',
};

/* Запасные подписи для случаев, когда сервер ответил кодом, но без тела. */
const BY_STATUS = {
  400: 'Запрос не принят',
  401: 'Нужно войти заново',
  403: 'Нет доступа',
  404: 'Ничего не нашлось',
  405: 'Так делать нельзя',
  409: 'Не получится: данные изменились',
  413: 'Слишком большой запрос',
  429: 'Слишком часто. Подождите немного',
  500: 'Сервис споткнулся. Мы уже разбираемся',
  502: 'Сервис временно недоступен. Попробуйте через минуту',
  503: 'Сервис временно недоступен. Попробуйте через минуту',
  504: 'Сервис не успел ответить. Попробуйте ещё раз',
};

/* Пути, на которых 401 — это нормальный ответ («неверный пароль»), а не
   протухшая сессия. На них не дёргаем обработчики выхода. */
const AUTH_FREE = /^\/auth\/(login|register|password)/;

export class ApiError extends Error {
  constructor(code, message, status = 0, extra = null) {
    super(message || 'Что-то пошло не так');
    this.name = 'ApiError';
    this.code = code || 'error';
    this.message = message || 'Что-то пошло не так';
    this.status = status || 0;
    if (extra && typeof extra === 'object') {
      for (const k of Object.keys(extra)) {
        if (k !== 'code' && k !== 'message' && k !== 'status' && k !== 'name') this[k] = extra[k];
      }
    }
  }

  /* До сервера не дошли вовсе: связь, таймаут, отмена. */
  get isNetwork() {
    return this.status === 0;
  }

  get isAuth() {
    return this.status === 401;
  }
}

// ─────────────────────────────────────────────────────────────── токен

let memToken = null;   // запасная память, если localStorage закрыт (режим инкогнито)

function token() {
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v || null;
  } catch (e) {
    return memToken;
  }
}

function setToken(value) {
  memToken = value || null;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* приватный режим — живём на памяти вкладки */
  }
  return memToken;
}

const authHandlers = new Set();

/* Подписка на «сессия закончилась». Приложение уводит человека на вход. */
function onUnauthorized(fn) {
  if (typeof fn !== 'function') return () => {};
  authHandlers.add(fn);
  return () => authHandlers.delete(fn);
}

function fireUnauthorized(err) {
  setToken(null);
  for (const fn of Array.from(authHandlers)) {
    try {
      fn(err);
    } catch (e) {
      console.error('[api] обработчик выхода упал', e);
    }
  }
}

// ─────────────────────────────────────────────────────────────── мелочи

function normalize(path) {
  const p = String(path || '');
  return p.startsWith('/') ? p : '/' + p;
}

function qs(params) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => u.append(k, String(item)));
    else if (typeof v === 'boolean') u.append(k, v ? '1' : '0');
    else u.append(k, String(v));
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

function netError(kind) {
  return new ApiError(kind, NET[kind] || NET.network, 0);
}

// ─────────────────────────────────────────────────────────────── запросы

async function request(method, path, opts = {}) {
  const {
    body = undefined,
    params = null,
    auth = true,
    timeout = TIMEOUT_MS,
    headers = null,
    signal = null,
  } = opts;

  const url = BASE + normalize(path) + qs(params);
  const head = { Accept: 'application/json' };
  const tk = auth ? token() : null;
  if (tk) head.Authorization = 'Bearer ' + tk;
  const hasBody = body !== undefined && body !== null && method !== 'GET';
  if (hasBody) head['Content-Type'] = 'application/json; charset=utf-8';
  if (headers) Object.assign(head, headers);

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, Math.max(1000, timeout));
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relay);
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: head,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (e) {
    if (timedOut) throw netError('timeout');
    if (signal && signal.aborted) throw new ApiError('aborted', 'Запрос отменён', 0);
    throw netError(navigator.onLine === false ? 'offline' : 'network');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }

  let text = '';
  try {
    if (res.status !== 204) text = await res.text();
  } catch (e) {
    throw netError('network');   // соединение оборвалось на полпути
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!res.ok) {
    const e = (data && data.error) || {};
    const err = new ApiError(
      e.code || 'http_' + res.status,
      e.message || BY_STATUS[res.status] || 'Сервер ответил ошибкой',
      res.status,
      e,
    );
    if (res.status === 401 && auth && !AUTH_FREE.test(normalize(path))) fireUnauthorized(err);
    throw err;
  }

  return data === null ? {} : data;
}

const get = (path, params = null, opts = {}) => request('GET', path, { ...opts, params });
const post = (path, body = null, opts = {}) => request('POST', path, { ...opts, body });
const put = (path, body = null, opts = {}) => request('PUT', path, { ...opts, body });
const patch = (path, body = null, opts = {}) => request('PATCH', path, { ...opts, body });
const del = (path, opts = {}) => request('DELETE', path, opts);

// ─────────────────────────────────────────────────────────────── поток событий

/* EventSource не умеет фильтровать по имени «всё подряд»: на каждое именованное
   событие нужен свой слушатель. Здесь — имена, которые шлёт наш сервер; если
   появится новое, его можно добавить через опцию events. */
export const STREAM_EVENTS = [
  'ping', 'order', 'status', 'price', 'payment',
  'geo', 'courier', 'couriers', 'route',
  'offer', 'offer_cancelled', 'offer_taken',
  'stats', 'rating', 'settings',
];

/* Подписка на серверные события с переподключением.

   Переподключаемся сами, а не полагаемся на встроенный ретрай браузера: нам нужна
   растущая пауза (1, 2, 4… до 30 секунд), иначе сотня курьеров после падения сети
   дружно ляжет на сервер в одну секунду. Плюс небольшой случайный разброс — чтобы
   они не вернулись строем.

   Токен уходит в query: заголовки к EventSource прицепить нельзя.
*/
export function stream(path, opts = {}) {
  const {
    onEvent = null,
    onOpen = null,
    onError = null,
    params = null,
    auth = true,
    events = [],
    maxDelay = 30000,
  } = opts;

  const names = Array.from(new Set(STREAM_EVENTS.concat(events || [])));
  let es = null;
  let timer = 0;
  let attempt = 0;
  let stopped = false;

  const buildUrl = () => {
    const q = Object.assign({}, params || {});
    const tk = auth ? token() : null;
    if (tk) q.token = tk;
    return BASE + normalize(path) + qs(q);
  };

  const deliver = (name, ev) => {
    if (!onEvent) return;
    let data = ev && ev.data;
    if (typeof data === 'string' && data.length) {
      try {
        data = JSON.parse(data);
      } catch (e) {
        /* пришёл не JSON — отдаём строкой как есть */
      }
    }
    try {
      onEvent(name, data, ev);
    } catch (e) {
      console.error('[api] обработчик события «' + name + '» упал', e);
    }
  };

  const scheduleRetry = () => {
    if (stopped || timer) return;
    const wait = Math.min(1000 * Math.pow(2, attempt), maxDelay) + Math.floor(Math.random() * 400);
    attempt += 1;
    timer = setTimeout(() => {
      timer = 0;
      open();
    }, wait);
  };

  const drop = () => {
    if (es) {
      es.onopen = es.onmessage = es.onerror = null;
      es.close();
      es = null;
    }
  };

  const open = () => {
    if (stopped || es) return;
    try {
      es = new EventSource(buildUrl());
    } catch (e) {
      es = null;
      scheduleRetry();
      return;
    }
    es.onopen = () => {
      attempt = 0;
      if (!onOpen) return;
      try {
        onOpen();
      } catch (e) {
        console.error('[api] onOpen упал', e);
      }
    };
    es.onmessage = (ev) => deliver('message', ev);
    for (const n of names) es.addEventListener(n, (ev) => deliver(n, ev));
    es.onerror = (ev) => {
      // Событие с именем error прилетает сюда же, но у него есть data — это сообщение,
      // а не обрыв связи. Различаем именно так.
      if (ev && typeof ev.data === 'string') {
        deliver('error', ev);
        return;
      }
      drop();
      if (onError) {
        try {
          onError(netError('stream'));
        } catch (e) {
          console.error('[api] onError упал', e);
        }
      }
      scheduleRetry();
    };
  };

  /* Сеть вернулась или человек снова открыл вкладку — незачем досиживать паузу. */
  const wake = () => {
    if (stopped) return;
    if (document.visibilityState === 'hidden') return;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    attempt = 0;
    if (!es) open();
  };

  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  open();

  return {
    close() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      drop();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    },
    /* Принудительно переоткрыть поток — например, после смены токена. */
    reconnect() {
      if (stopped) return;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      drop();
      attempt = 0;
      open();
    },
    get connected() {
      return !!es && es.readyState === 1;
    },
  };
}

export const api = {
  get, post, put, patch, del, request, stream,
  token, setToken, onUnauthorized,
  base: BASE,
};

export { get, post, put, patch, del, request, token, setToken, onUnauthorized };
export default api;
