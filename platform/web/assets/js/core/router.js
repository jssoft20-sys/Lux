/* Хеш-роутер для одностраничных приложений.

   Адреса вида index.html#/track/AB12CD?t=токен. Хеш выбран намеренно: сервис живёт
   на трёх статических страницах, и при таком раскладе ни nginx, ни systemd не нужно
   учить отдавать index.html на любой путь — ссылка просто работает.

   Маршруты описываются объектом: {'/track/:id': handler}. Звёздочка ловит остаток
   пути, поэтому '*' — это «всё остальное».

   ── НАЛОЖЕНИЯ ──────────────────────────────────────────────────────────────
   Шторка поверх экрана (профиль, бонусы, история, детали заказа) — это не новый
   экран, а наложение. Раньше оно жило только в памяти, и перезагрузка его теряла:
   человек открывал профиль, обновлял страницу и оказывался снова на карте.
   Теперь наложение видно в адресе последним куском пути со знаком «~»:

       #/                 → карта
       #/~profile         → карта, поверх неё профиль
       #/~profile:bonus   → профиль, открытый на бонусах
       #/order/AB12?t=x   → отслеживание заказа
       #/order/AB12/~chat?t=x → то же и чат поверх

   Как этим пользоваться экрану:

       router.overlay('profile');          // открыть, адрес сменится сам
       router.overlay('profile:bonus', { replace: true });  // сменить раздел внутри
       router.closeOverlay();              // закрыть (системная «назад» тоже закроет)
       router.overlayName();               // что открыто прямо сейчас, '' если ничего

       router.onOverlay((name, prev, ctx) => {
         if (name === 'profile') openProfileSheet();
         else closeProfileSheet();
       });

   onOverlay зовётся и при загрузке страницы — именно так шторка возвращается
   на место после перезагрузки. Подписаться можно и позже: если наложение уже
   разобрано из адреса, новый подписчик получит его сразу.

   Обработчик самого экрана при смене наложения НЕ вызывается: карта не должна
   перерисовываться из-за того, что поверх неё открыли профиль.

   ── ПАМЯТЬ МЕСТА ───────────────────────────────────────────────────────────
   Последний осмысленный адрес страницы роутер кладёт в localStorage. Если
   человек пришёл на голый корень (закладка, значок приложения), оболочка
   спросит, вернуть ли его туда, где он был: lastPlace() отдаёт сохранённое,
   forgetPlace() забывает. Сами мы никуда не перебрасываем — выдёргивать экран
   без спроса хуже, чем лишний вопрос.
*/

/* Наложение отмечаем в пути знаком «~»: он не встречается в наших маршрутах,
   не требует экранирования и в адресной строке читается как «поверх». */
const OVERLAY_MARK = '~';

const PLACE_PREFIX = 'sg_place:';
const PLACE_TTL_S = 7 * 24 * 3600;      // неделю помним, дальше это уже чужая жизнь

function splitPath(path) {
  return String(path || '').split('/').filter(Boolean);
}

function normPath(path) {
  let p = String(path || '').trim();
  if (!p) return '/';
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function queryString(query) {
  if (!query) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue;
    u.append(k, String(v));
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

/* Двоеточие оставляем как есть: 'profile:bonus' в адресе читается человеком,
   а браузеру внутри куска пути двоеточие не мешает. */
function encodeOverlay(name) {
  return encodeURIComponent(String(name || '').trim()).replace(/%3A/gi, ':');
}

function decodeOverlay(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

/* Отделяет наложение от пути: '/order/AB12/~chat' → {path:'/order/AB12', overlay:'chat'} */
function splitOverlay(path) {
  const parts = splitPath(path);
  const last = parts.length ? parts[parts.length - 1] : '';
  if (last.length > 1 && last.startsWith(OVERLAY_MARK)) {
    return {
      path: normPath('/' + parts.slice(0, -1).join('/')),
      overlay: decodeOverlay(last.slice(1)),
    };
  }
  return { path: normPath(path), overlay: '' };
}

/* Собирает хеш обратно: путь, наложение, параметры. */
function buildHash(path, query, overlay) {
  const base = normPath(path);
  const head = overlay
    ? (base === '/' ? '' : base) + '/' + OVERLAY_MARK + encodeOverlay(overlay)
    : base;
  return head + queryString(query);
}

/* Разбирает строку хеша (без решётки) на части. */
function parseHash(raw) {
  const text = String(raw || '');
  const cut = text.indexOf('?');
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const query = {};
  if (cut >= 0) {
    new URLSearchParams(text.slice(cut + 1)).forEach((v, k) => {
      query[k] = v;
    });
  }
  const split = splitOverlay(head);
  return { path: split.path, overlay: split.overlay, query };
}

function sameQuery(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => String(a[k]) === String((b || {})[k]));
}

/* Ссылка для href: href('/track/AB12', {t: token}) → '#/track/AB12?t=…'
   Третьим аргументом можно сразу открыть наложение: href('/', null, 'profile'). */
export function href(path, query, overlay) {
  return '#' + buildHash(path, query, overlay);
}

/* ─────────────────────────────────────────────────────── память места */

/** Ключ памяти свой у каждой страницы: клиент, курьер и админка живут отдельно. */
export function placeKey(scope) {
  const page = scope || (typeof location !== 'undefined' ? location.pathname : '/') || '/';
  return PLACE_PREFIX + page;
}

/**
 * Где человек был в прошлый раз на этой странице.
 * Возвращает {hash, path, overlay, query, at} или null, если памяти нет
 * или она протухла. at — целые секунды unix UTC.
 */
export function lastPlace(opts = {}) {
  const maxAge = Number(opts.maxAgeS) > 0 ? Number(opts.maxAgeS) : PLACE_TTL_S;
  let saved = null;
  try {
    const raw = localStorage.getItem(placeKey(opts.scope));
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch (e) {
    return null;                 // приватный режим или мусор в ключе
  }
  if (!saved || typeof saved.hash !== 'string' || !saved.hash) return null;
  const at = Math.floor(Number(saved.at) || 0);
  if (!at || Math.floor(Date.now() / 1000) - at > maxAge) return null;
  const parsed = parseHash(saved.hash);
  return { hash: saved.hash, path: parsed.path, overlay: parsed.overlay, query: parsed.query, at };
}

/** Забыть место: человек отказался возвращаться — больше не спрашиваем. */
export function forgetPlace(scope) {
  try {
    localStorage.removeItem(placeKey(scope));
  } catch (e) {
    /* хранилище закрыто — забывать и нечего */
  }
}

/* ─────────────────────────────────────────────────────── маршруты */

function compile(pattern, handler) {
  const segs = splitPath(pattern);
  const params = segs.filter((s) => s.startsWith(':')).length;
  const wild = segs.indexOf('*') >= 0 || pattern === '*';
  const statics = segs.length - params - (wild ? 1 : 0);
  // Чем больше в шаблоне точных кусков, тем он «главнее»: '/track/new' должен
  // выигрывать у '/track/:id', даже если описан ниже.
  const score = (wild ? -1000 : 0) + statics * 10 - params;
  return { pattern, handler, segs: pattern === '*' ? ['*'] : segs, score };
}

function matchRoute(routes, path) {
  const parts = splitPath(path);
  for (const r of routes) {
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const seg = r.segs[i];
      if (seg === '*') {
        params.rest = parts.slice(i).join('/');
        return { route: r, params };
      }
      if (i >= parts.length) {
        ok = false;
        break;
      }
      if (seg.startsWith(':')) {
        try {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } catch (e) {
          params[seg.slice(1)] = parts[i];
        }
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok && r.segs.length === parts.length) return { route: r, params };
  }
  return null;
}

export function createRouter(routes, options = {}) {
  const {
    onChange = null,
    notFound = null,
    home = '/',
    auto = true,
    remember = true,
  } = options;

  const list = [];
  for (const [pattern, handler] of Object.entries(routes || {})) {
    if (typeof handler === 'function') list.push(compile(pattern, handler));
  }
  list.sort((a, b) => b.score - a.score);

  let current = null;
  let started = false;
  let destroyed = false;
  // Глубина истории: по ней back() понимает, есть ли куда возвращаться. Метку
  // кладём в history.state, иначе после ручного «назад» счётчик врёт.
  let depth = (window.history.state && window.history.state.sgDepth) || 0;
  let pending = null;      // глубина новой записи, которую мы только что создали
  let pendingOverlay = false;   // эту запись создало открытие наложения
  const overlayWatchers = new Set();

  function read() {
    const raw = String(location.hash || '').slice(1);
    const parsed = parseHash(raw);
    return { path: parsed.path, overlay: parsed.overlay, query: parsed.query, raw };
  }

  function stamp(isOverlay) {
    try {
      window.history.replaceState({ sgDepth: depth, sgOverlay: !!isOverlay }, '');
    } catch (e) {
      /* некоторые встроенные браузеры запрещают replaceState — переживём */
    }
  }

  /* Домашний экран без параметров и без наложения запоминать незачем: туда и так
     открывается сервис. Всё остальное — куда человека можно вернуть. */
  function keep(ctx) {
    if (!remember) return;
    const worth = ctx.path !== normPath(home) || ctx.overlay ||
      Object.keys(ctx.query).length > 0;
    try {
      if (!worth) localStorage.removeItem(placeKey());
      else localStorage.setItem(placeKey(), JSON.stringify({
        hash: buildHash(ctx.path, ctx.query, ctx.overlay),
        at: Math.floor(Date.now() / 1000),
      }));
    } catch (e) {
      /* хранилище закрыто — приложение работает и без памяти */
    }
  }

  function tellOverlay(name, prev, ctx) {
    for (const fn of Array.from(overlayWatchers)) {
      try {
        fn(name, prev, ctx);
      } catch (e) {
        console.error('[router] обработчик наложения упал', e);
      }
    }
  }

  function dispatch() {
    if (destroyed) return;
    const { path, query, overlay } = read();
    const hit = matchRoute(list, path);
    const prev = current;
    // Открыли или закрыли шторку поверх того же экрана — экран не трогаем.
    const overlayOnly = !!prev && prev.path === path &&
      sameQuery(prev.query, query) && prev.overlay !== overlay;
    const ctx = {
      path,
      query,
      overlay,
      params: hit ? Object.assign({}, hit.params) : {},
      pattern: hit ? hit.route.pattern : null,
      prev: prev
        ? { path: prev.path, pattern: prev.pattern, params: prev.params, overlay: prev.overlay }
        : null,
      router: self,
    };
    current = ctx;
    keep(ctx);

    // Сначала даём оболочке подстроиться (подсветить таб, закрыть шторку),
    // потом рисуем экран — так не мигает старая подсветка.
    if (onChange) {
      try {
        onChange(ctx, prev);
      } catch (e) {
        console.error('[router] onChange упал', e);
      }
    }

    if (!overlayOnly) {
      const run = hit ? hit.route.handler : notFound;
      if (!run) {
        console.warn('[router] нет обработчика для', path);
      } else {
        try {
          const result = run(ctx);
          if (result && typeof result.then === 'function') {
            result.catch((e) => console.error('[router] экран «' + path + '» не отрисовался', e));
          }
        } catch (e) {
          console.error('[router] экран «' + path + '» не отрисовался', e);
        }
      }
    }

    // Шторку открываем последней: экран под ней к этому моменту уже на месте.
    const was = prev ? prev.overlay : '';
    if (was !== overlay) tellOverlay(overlay, was, ctx);
  }

  /* Метку глубины ставим здесь, а не сразу после смены адреса: браузер шлёт
     hashchange отдельной задачей, и порядок «сначала событие, потом метка»
     зависит от движка. Так счётчик сходится в любом случае. */
  function onHash() {
    const st = window.history.state;
    if (pending !== null) {
      depth = pending;
      pending = null;
      stamp(pendingOverlay);
      pendingOverlay = false;
    } else if (st && typeof st.sgDepth === 'number') {
      depth = st.sgDepth;
    } else {
      depth += 1;          // адрес поправили руками — в истории появилась запись
      stamp(false);
    }
    dispatch();
  }

  function go(path, opts = {}) {
    const target = buildHash(path, opts.query, opts.overlay || '');
    const now = String(location.hash || '').slice(1);
    if (target === now && !opts.force) return;

    if (opts.replace) {
      // replaceState хеш меняет, но hashchange не шлёт — дёргаем разбор руками.
      try {
        window.history.replaceState(
          { sgDepth: depth, sgOverlay: !!opts.overlayEntry }, '', '#' + target);
        dispatch();
        return;
      } catch (e) {
        location.replace('#' + target);
        return;
      }
    }
    pending = depth + 1;
    pendingOverlay = !!opts.overlayEntry;
    location.hash = '#' + target;
    if (target === now) {               // принудительный повтор того же адреса
      pending = null;                   // hashchange не придёт, разбираем сами
      pendingOverlay = false;
      dispatch();
    }
  }

  /**
   * Открыть наложение поверх текущего экрана: overlay('profile') даёт #/…/~profile.
   * По умолчанию это новая запись истории, поэтому системная «назад» закрывает
   * шторку, а не уводит с сервиса. opts.replace меняет наложение на месте —
   * так переключают разделы внутри одной шторки.
   */
  function overlay(name, opts = {}) {
    const at = current || read();
    const next = String(name || '').trim();
    if (!next) {
      closeOverlay(opts);
      return;
    }
    if (at.overlay === next && !opts.force) return;
    go(at.path, {
      query: at.query,
      overlay: next,
      replace: !!opts.replace,
      overlayEntry: true,
      force: !!opts.force,
    });
  }

  /**
   * Закрыть наложение. Если запись создали мы сами, уходим через историю —
   * тогда в ней не копятся мёртвые шаги, на которых «назад» ничего не делает.
   */
  function closeOverlay(opts = {}) {
    const at = current || read();
    if (!at.overlay) return;
    const st = window.history.state;
    if (!opts.replace && st && st.sgOverlay && depth > 0) {
      window.history.back();
      return;
    }
    go(at.path, { query: at.query, replace: true });
  }

  /** Что открыто поверх экрана прямо сейчас. Пустая строка — ничего. */
  function overlayName() {
    return (current || read()).overlay || '';
  }

  /**
   * Подписка на наложения: fn(name, prev, ctx). Пустое имя означает «закрыли».
   * Если адрес с наложением уже разобран, новый подписчик узнает о нём сразу —
   * иначе после перезагрузки шторка не открылась бы.
   */
  function onOverlay(fn) {
    if (typeof fn !== 'function') return () => {};
    overlayWatchers.add(fn);
    if (current && current.overlay) {
      const ctx = current;
      Promise.resolve().then(() => {
        if (overlayWatchers.has(fn) && current === ctx) {
          try {
            fn(ctx.overlay, '', ctx);
          } catch (e) {
            console.error('[router] обработчик наложения упал', e);
          }
        }
      });
    }
    return () => overlayWatchers.delete(fn);
  }

  function back() {
    if (depth > 0) {
      window.history.back();
      return;
    }
    go(home, { replace: true });        // пришли по прямой ссылке — некуда возвращаться
  }

  function start() {
    if (started || destroyed) return;
    started = true;
    if (!String(location.hash || '').slice(1)) {
      go(home, { replace: true });
      return;
    }
    stamp(false);
    dispatch();
  }

  function add(pattern, handler) {
    if (typeof handler !== 'function') return;
    list.push(compile(pattern, handler));
    list.sort((a, b) => b.score - a.score);
  }

  function destroy() {
    destroyed = true;
    overlayWatchers.clear();
    window.removeEventListener('hashchange', onHash);
  }

  const self = {
    go,
    back,
    start,
    add,
    destroy,
    href,
    overlay,
    closeOverlay,
    overlayName,
    onOverlay,
    lastPlace,
    forgetPlace,
    current: () => current,
    refresh: () => dispatch(),
  };

  window.addEventListener('hashchange', onHash);
  // Запускаемся после того, как вызвавший код закончит настройку: иначе первый
  // экран отрисуется раньше, чем приложение успеет подготовить всё остальное.
  if (auto) Promise.resolve().then(start);

  return self;
}

export default createRouter;
