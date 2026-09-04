/* OnoiPay admin service worker: web push with critical/normal channels, no caching of API. */
const VERSION = 'onoipay-sw-1.0.0';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'OnoiPay', body: event.data ? event.data.text() : '' }; }
    const critical = data.channel === 'critical' || data.level === 'critical';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.some((c) => c.visibilityState === 'visible');
    for (const c of windows) { try { c.postMessage({ type: 'ONOI_PUSH', payload: data }); } catch (e) {} }
    if (visible && !critical) return; // the open panel shows it in-app
    await self.registration.showNotification(data.title || 'OnoiPay', {
      body: data.body || '',
      icon: 'brand/onoipay-logo.png',
      badge: 'brand/onoipay-logo.png',
      tag: data.tag || ('onoipay-' + (data.id || Date.now())),
      renotify: critical,
      requireInteraction: !!data.requireInteraction || critical,
      silent: false,
      vibrate: critical ? [200, 100, 200, 100, 400] : [120, 60, 120],
      timestamp: data.timestamp || Date.now(),
      data: { url: data.url || './', id: data.id || '', event: data.event || '', channel: critical ? 'critical' : 'normal' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = (event.notification.data && event.notification.data.url) || './';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of windows) {
      try {
        if ('focus' in c) {
          await c.focus();
          c.postMessage({ type: 'ONOI_OPEN', url: target, id: event.notification.data && event.notification.data.id });
          return;
        }
      } catch (e) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
