/* Служебный воркер приложения курьера.

   Задача ровно одна: чтобы приложение открывалось мгновенно и в лифте, где
   интернет пропал. Поэтому оболочка — разметка, стили, скрипты и шрифты —
   лежит в кэше, а всё живое (заказы, позиция, деньги) всегда идёт в сеть.

   Запросы к /api не кэшируются НИКОГДА. Показать курьеру вчерашний заказ
   из кэша хуже, чем честно сказать «нет связи»: по такому заказу он поедет.
*/

const VERSION = 'v1';
const SHELL_CACHE = 'sg-courier-shell-' + VERSION;
const PAGE = '/courier';

/* Оболочка приложения. Всё остальное (плитки карты, чужие домены) не трогаем. */
const SHELL = [
  '/courier',
  '/courier.html',
  '/manifest-courier.webmanifest',

  '/assets/css/fonts.css',
  '/assets/css/tokens.css',
  '/assets/css/base.css',
  '/assets/css/components.css',
  '/assets/css/map.css',
  '/assets/css/courier.css',

  '/assets/js/core/api.js',
  '/assets/js/core/i18n.js',
  '/assets/js/core/lang.ru.js',
  '/assets/js/core/lang.ky.js',
  '/assets/js/core/store.js',
  '/assets/js/core/router.js',
  '/assets/js/core/ui.js',
  '/assets/js/core/fmt.js',
  '/assets/js/core/map.js',
  '/assets/js/courier/app.js',
  '/assets/js/courier/auth.js',
  '/assets/js/courier/work.js',

  '/assets/fonts/onest-cyrillic.woff2',
  '/assets/fonts/onest-cyrillic-ext.woff2',
  '/assets/fonts/onest-latin.woff2',
  '/assets/fonts/inter-cyrillic.woff2',
  '/assets/fonts/inter-cyrillic-ext.woff2',
  '/assets/fonts/inter-latin.woff2',

  '/assets/img/logo.svg',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

/* Что можно держать в кэше: только наши статические файлы. */
function cacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return /^\/(assets|favicon|icon-|apple-touch|manifest)/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Каждый файл кладём отдельно: если один адрес не отдался (например,
    // страница ещё не подключена в роутере), это не должно валить всю установку.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('sg-courier-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

/* Новая версия приложения: страница просит воркер не ждать закрытия вкладок. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/* Переход по адресу: сначала сеть, и только если её нет — сохранённая оболочка.
   Так человек всегда получает свежую версию, когда связь есть. */
async function navigate(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(PAGE, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cache = await caches.open(SHELL_CACHE);
    const saved = await cache.match(PAGE) || await cache.match('/courier.html');
    if (saved) return saved;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Нет связи</title>' +
      '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
      'background:#0E0E10;color:#F6F6F8;font:16px system-ui">' +
      '<p>Нет связи. Включите интернет и откройте приложение заново.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/* Статика: отдаём из кэша сразу, а следом тихо обновляем — при следующем
   запуске файл будет уже свежий, и ждать сеть ради этого никому не пришлось. */
async function asset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok && res.status === 200) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);

  if (saved) return saved;
  const fresh = await network;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Нет связи' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API и поток событий отдаём браузеру как есть: ни кэша, ни обёрток.
  // Длинное соединение SSE, пропущенное через воркер, рвётся на ровном месте.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if ((request.headers.get('accept') || '').includes('text/event-stream')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (cacheable(url)) {
    event.respondWith(asset(request));
  }
});
