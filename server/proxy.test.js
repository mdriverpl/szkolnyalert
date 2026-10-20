import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, loadConfigFromFile } from 'vite';
import { createApp } from './app.js';
import { createStore } from './store.js';

test('container proxy configuration trusts private bridge addresses while the native default trusts only loopback', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  const normal = createApp(store).get('trust proxy fn');
  assert.equal(normal('127.0.0.1'), true);
  assert.equal(normal('172.20.0.1'), false);
  const container = createApp(store, { trustProxy: ['loopback', 'linklocal', 'uniquelocal'] }).get('trust proxy fn');
  assert.equal(container('172.20.0.1'), true);
  assert.equal(container('8.8.8.8'), false);
});

test('browser-origin forms pass through the configured Vite proxy; foreign origins stay blocked', async t => {
  const store = await createStore({ memory: true });
  await store.mutate(data => { for (const key of Object.keys(data)) data[key] = []; });
  const api = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => api.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => api.close(resolve)); await store.close(); });
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' });
  const configuredProxy = config.server.proxy['/api'];
  const proxy = typeof configuredProxy === 'string' ? apiUrl : { ...configuredProxy, target: apiUrl };
  const web = await createServer({
    configFile: false, logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': proxy } }
  });
  t.after(() => web.close());
  await web.listen();
  const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
  const state = await fetch(origin + '/api/state');
  assert.equal(state.status, 401, 'school data is private before login');
  const save = async source => fetch(origin + '/api/register-school', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: source },
    body: JSON.stringify({ name: 'Pierwsza szkoła', city: 'Warszawa', address: 'Szkolna 1', adminName: 'Anna Testowa', email: 'test@example.com', password: 'testowe-haslo-123' })
  });
  const created = await save(origin);
  assert.equal(created.status, 201, 'first school must save without login and with a browser Origin header');
  assert.equal((await created.json()).school.name, 'Pierwsza szkoła');
  assert.equal((await save('https://foreign.example')).status, 403);
  assert.equal((await store.read()).schools.length, 1);
});
