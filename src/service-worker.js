const CACHE = 'szkolny-alert-__BUILD_ID__';
const PRECACHE = __PRECACHE__;
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Szkolny Alert', {
    body: payload.body || 'Nowy alert w szkole — otwórz aplikację.',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: payload.tag || 'szkolnyalert',
    data: { url: '/nauczyciel' }, requireInteraction: true
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith('/nauczyciel'));
    if (existing) { await existing.focus(); existing.postMessage({ type: 'refresh-alerts' }); }
    else await self.clients.openWindow('/nauczyciel');
  })());
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('szkolny-alert-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache API responses, keys, sessions, alert states or mutation requests.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html'))));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      return cached || fetch(event.request);
    }));
  }
});
