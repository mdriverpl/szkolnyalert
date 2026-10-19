// Dane operacyjne wymagają aktualnego połączenia; nigdy nie buforujemy API.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
