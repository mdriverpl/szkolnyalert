import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { createStore } from './store.js';

test('sessions survive reopening storage and restarting the API; logout, password changes and expiry remain effective', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'szkolny-alert-session-'));
  const file = join(directory, 'demo.json');
  let store, server, base;
  const stop = async () => {
    if (server) { await new Promise(resolve => server.close(resolve)); server = null; }
    if (store) { await store.close(); store = null; }
  };
  const start = async () => {
    store = await createStore({ file });
    server = createApp(store).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  t.after(async () => { await stop(); await rm(file, { force: true }); await rm(file + '.tmp', { force: true }); await rmdir(directory); });
  const request = (path, cookie = '', method = 'GET', body) => fetch(base + '/api' + path, {
    method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const login = async (password = 'demo12345') => {
    const response = await request('/login', '', 'POST', { login: 'admin@szkolnyalert.pl', password });
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=Strict/i); assert.match(header, /Max-Age=28800/i);
    return header.split(';')[0];
  };
  await start();
  const cookie = await login();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].tokenHash.length, 64);
  assert.equal(JSON.stringify(saved).includes(cookie.slice(8)), false, 'raw session token must not be persisted');
  await stop(); await start();
  const response = await request('/state', cookie); assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.user.schoolId, 'school-demo');
  assert.deepEqual(state.schools.map(x => x.id), ['school-demo']);
  assert.equal('sessions' in state, false);
  assert.equal((await request('/state', 'session=' + 'f'.repeat(64))).status, 401);
  assert.equal((await request('/logout', cookie, 'POST')).status, 200);
  await stop(); await start();
  assert.equal((await request('/state', cookie)).status, 401, 'logout persists across restart');

  const active = await login();
  assert.equal((await request('/users/user-demo-1', active, 'PUT', { name: 'Anna', email: 'admin@szkolnyalert.pl', role: 'admin', password: 'NoweHaslo123' })).status, 200);
  await stop(); await start();
  assert.equal((await request('/state', active)).status, 401, 'password change persists across restart');
  const renewed = await login('NoweHaslo123');
  await store.mutate(data => { for (const session of data.sessions) session.expires = Date.now() - 1; });
  await stop(); await start();
  assert.equal((await request('/state', renewed)).status, 401, 'expired sessions stay invalid');
});
