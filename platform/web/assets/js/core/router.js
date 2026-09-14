/* Хеш-роутер для одностраничных приложений.

   Адреса вида index.html#/track/AB12CD?t=токен. Хеш выбран намеренно: сервис живёт
   на трёх статических страницах, и при таком раскладе ни nginx, ни systemd не нужно
   учить отдавать index.html на любой путь — ссылка просто работает.

   Маршруты описываются объектом: {'/track/:id': handler}. Звёздочка ловит остаток
   пути, поэтому '*' — это «всё остальное».
*/

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

/* Ссылка для href: href('/track/AB12', {t: token}) → '#/track/AB12?t=…' */
export function href(path, query) {
  return '#' + normPath(path) + queryString(query);
}

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

  function read() {
    const raw = String(location.hash || '').slice(1);
    const cut = raw.indexOf('?');
    const path = normPath(cut >= 0 ? raw.slice(0, cut) : raw);
    const query = {};
    if (cut >= 0) {
      new URLSearchParams(raw.slice(cut + 1)).forEach((v, k) => {
        query[k] = v;
      });
    }
    return { path, query, raw };
  }

  function stamp() {
    try {
      window.history.replaceState({ sgDepth: depth }, '');
    } catch (e) {
      /* некоторые встроенные браузеры запрещают replaceState — переживём */
    }
  }

  function dispatch() {
    if (destroyed) return;
    const { path, query } = read();
    const hit = matchRoute(list, path);
    const prev = current;
    const ctx = {
      path,
      query,
      params: hit ? Object.assign({}, hit.params) : {},
      pattern: hit ? hit.route.pattern : null,
      prev: prev ? { path: prev.path, pattern: prev.pattern, params: prev.params } : null,
      router: self,
    };
    current = ctx;

    // Сначала даём оболочке подстроиться (подсветить таб, закрыть шторку),
    // потом рисуем экран — так не мигает старая подсветка.
    if (onChange) {
      try {
        onChange(ctx, prev);
      } catch (e) {
        console.error('[router] onChange упал', e);
      }
    }

    const run = hit ? hit.route.handler : notFound;
    if (!run) {
      console.warn('[router] нет обработчика для', path);
      return;
    }
    try {
      const result = run(ctx);
      if (result && typeof result.then === 'function') {
        result.catch((e) => console.error('[router] экран «' + path + '» не отрисовался', e));
      }
    } catch (e) {
      console.error('[router] экран «' + path + '» не отрисовался', e);
    }
  }

  /* Метку глубины ставим здесь, а не сразу после смены адреса: браузер шлёт
     hashchange отдельной задачей, и порядок «сначала событие, потом метка»
     зависит от движка. Так счётчик сходится в любом случае. */
  function onHash() {
    const st = window.history.state;
    if (pending !== null) {
      depth = pending;
      pending = null;
      stamp();
    } else if (st && typeof st.sgDepth === 'number') {
      depth = st.sgDepth;
    } else {
      depth += 1;          // адрес поправили руками — в истории появилась запись
      stamp();
    }
    dispatch();
  }

  function go(path, opts = {}) {
    const target = normPath(path) + queryString(opts.query);
    const now = String(location.hash || '').slice(1);
    if (target === now && !opts.force) return;

    if (opts.replace) {
      // replaceState хеш меняет, но hashchange не шлёт — дёргаем разбор руками.
      try {
        window.history.replaceState({ sgDepth: depth }, '', '#' + target);
        dispatch();
        return;
      } catch (e) {
        location.replace('#' + target);
        return;
      }
    }
    pending = depth + 1;
    location.hash = '#' + target;
    if (target === now) {               // принудительный повтор того же адреса
      pending = null;                   // hashchange не придёт, разбираем сами
      dispatch();
    }
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
    stamp();
    dispatch();
  }

  function add(pattern, handler) {
    if (typeof handler !== 'function') return;
    list.push(compile(pattern, handler));
    list.sort((a, b) => b.score - a.score);
  }

  function destroy() {
    destroyed = true;
    window.removeEventListener('hashchange', onHash);
  }

  const self = {
    go,
    back,
    start,
    add,
    destroy,
    href,
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
