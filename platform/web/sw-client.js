/* Служебный воркер клиентского приложения.

   Задача одна: сервис должен открываться мгновенно и в лифте, где связь
   пропала. Поэтому оболочка — разметка, стили, скрипты, шрифты и значки —
   лежит в кэше, а всё живое (цены, заказы, позиция курьера) всегда идёт в сеть.

   Запросы к /api не кэшируются НИКОГДА. Показать вчерашнюю цену или чужой
   статус заказа хуже, чем честно сказать «нет связи»: по такой цене человек
   вызовет машину, а по такому статусу выйдет к подъезду.

   Префикс установки считаем сами из своего адреса: сервис умеют вешать в
   подпапку (site.kg/go/), а в .js сервер ссылки не переписывает.
*/

const VERSION = 'v1';
const SHELL_CACHE = 'sg-client-shell-' + VERSION;

/* '/' на своём домене или '/go/' в подпапке — берём из адреса самого воркера. */
const BASE = new URL('./', self.location.href).pathname;
const PAGE = BASE;

/* Оболочка приложения. Плитки карты и чужие домены не трогаем: карта живёт
   на сторонних серверах, и складывать её тайлы в наш кэш нечестно и незачем. */
const SHELL = [
  '',
  'index.html',
  'manifest.webmanifest',

  'assets/css/fonts.css',
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/components.css',
  'assets/css/map.css',
  'assets/css/client.css',
  'assets/css/pay.css',
  'assets/css/shell.css',

  'assets/js/core/api.js',
  'assets/js/core/i18n.js',
  'assets/js/core/lang.ru.js',
  'assets/js/core/lang.ky.js',
  'assets/js/core/store.js',
  'assets/js/core/router.js',
  'assets/js/core/ui.js',
  'assets/js/core/fmt.js',
  'assets/js/core/map.js',
  'assets/js/core/shell.js',
  'assets/js/client/app.js',
  'assets/js/client/order.js',
  'assets/js/client/address.js',
  'assets/js/client/track.js',
  'assets/js/client/pay.js',

  'assets/fonts/onest-cyrillic.woff2',
  'assets/fonts/onest-cyrillic-ext.woff2',
  'assets/fonts/onest-latin.woff2',
  'assets/fonts/inter-cyrillic.woff2',
  'assets/fonts/inter-cyrillic-ext.woff2',
  'assets/fonts/inter-latin.woff2',

  'assets/img/logo.svg',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
].map((path) => BASE + path);

/* Что можно держать в кэше: только наша статика внутри своей папки. */
function cacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(BASE)) return false;
  const tail = url.pathname.slice(BASE.length);
  if (tail.startsWith('api/')) return false;
  return /^(assets\/|favicon|icon-|apple-touch|manifest)/.test(tail);
}

/* Страница клиента — и только она. Курьер и админка живут своей жизнью:
   у курьера свой воркер, админке офлайн вообще ни к чему. Карточку заказа
   для мессенджеров (/share/…) рисует сервер, её тоже не перехватываем. */
function isClientPage(url) {
  if (url.origin !== self.location.origin) return false;
  const tail = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
  return tail === '' || tail === 'index.html';
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Каждый файл кладём отдельно: если один адрес не отдался, это не должно
    // валить всю установку — приложение переживёт отсутствие одного значка.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('sg-client-') && name !== SHELL_CACHE)
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
    const saved = await cache.match(PAGE) || await cache.match(BASE + 'index.html');
    if (saved) return saved;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Нет связи</title>' +
      '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
      'background:#FFDF00;color:#16150F;font:16px system-ui;text-align:center">' +
      '<p>Нет связи. Включите интернет и откройте сервис заново.</p>',
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
  if (url.origin === self.location.origin && url.pathname.startsWith(BASE + 'api/')) return;
  if ((request.headers.get('accept') || '').includes('text/event-stream')) return;

  if (request.mode === 'navigate') {
    if (isClientPage(url)) event.respondWith(navigate(request));
    return;
  }
  if (cacheable(url)) {
    event.respondWith(asset(request));
  }
});
