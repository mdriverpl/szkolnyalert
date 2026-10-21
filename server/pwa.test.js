import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('PWA worker caches only application files, never APIs, keys or mutation requests', async () => {
  const handlers = {}, requests = [], cached = ['/index.html', '/assets/app.js'];
  const cache = { addAll: async paths => requests.push(...paths), match: async path => path === '/index.html' ? 'offline-shell' : 'cached-asset' };
  const source = (await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8')).replace('__BUILD_ID__', 'test').replace('__PRECACHE__', JSON.stringify(cached));
  runInNewContext(source, {
    URL, self: { location: { origin: 'https://school.example' }, addEventListener: (name, fn) => handlers[name] = fn, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} }, fetch: async () => { throw new Error('offline'); }
  });
  let done; handlers.install({ waitUntil: promise => done = promise }); await done;
  assert.deepEqual(requests, cached);
  for (const [url, method] of [['https://school.example/api/teacher-panel/state', 'GET'], ['https://school.example/api/teacher-panel/access', 'POST'], ['https://external.example/file.js', 'GET']]) {
    let intercepted = false;
    handlers.fetch({ request: { url, method }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false);
  }
  let response;
  handlers.fetch({ request: { url: 'https://school.example/nauczyciel', method: 'GET', mode: 'navigate' }, respondWith: promise => response = promise });
  assert.equal(await response, 'offline-shell');
  const manifest = JSON.parse(await readFile(new URL('../public/teacher.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/nauczyciel'); assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192')); assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.equal(JSON.stringify(manifest).includes('klucz='), false);
});

test('push displays a generic notification and clicking it opens only the teacher panel', async () => {
  const handlers = {}, shown = [], opened = [];
  const source = (await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8')).replace('__BUILD_ID__', 'push-test').replace('__PRECACHE__', '[]');
  runInNewContext(source, { URL, self: {
    location: { origin: 'https://school.example' }, addEventListener: (name, fn) => handlers[name] = fn,
    registration: { showNotification: async (title, options) => shown.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }
  } });
  let done;
  handlers.push({ data: { json: () => ({ title: 'Szkolny Alert', body: 'Nowy alert w szkole — otwórz aplikację.', url: 'https://external.example' }) }, waitUntil: promise => done = promise });
  await done; assert.equal(shown.length, 1); assert.equal(shown[0].options.data.url, '/nauczyciel');
  handlers.notificationclick({ notification: { close() {} }, waitUntil: promise => done = promise });
  await done; assert.deepEqual(opened, ['/nauczyciel']);
  handlers.push({ data: { json: () => { throw new Error('invalid'); } }, waitUntil: promise => done = promise });
  await done; assert.equal(shown.length, 2);
});
