import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { ensureSuperadmin } from './superadmin.js';
import { verifyPassword } from './auth.js';

const env = { SUPERADMIN_EMAIL: 'biuro@mdriver.pl', SUPERADMIN_PASSWORD: 'test-superadmin-12345' };
test('environment bootstrap creates one global account, preserves sessions until password changes, and promotes only the configured login', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  await ensureSuperadmin(store, {});
  assert.equal((await store.read()).users.some(x => x.role === 'superadmin'), false);
  await ensureSuperadmin(store, env);
  const user = (await store.read()).users.find(x => x.role === 'superadmin');
  assert.equal(user.schoolId, null); assert.equal(user.email, env.SUPERADMIN_EMAIL);
  assert.ok(await verifyPassword(env.SUPERADMIN_PASSWORD, user.passwordHash));
  await ensureSuperadmin(store, env);
  assert.equal((await store.read()).users.filter(x => x.role === 'superadmin').length, 1);
  assert.equal((await store.read()).users.find(x => x.id === user.id).passwordHash, user.passwordHash);
  await store.mutate(data => { data.sessions = [{ userId: user.id }]; });
  await ensureSuperadmin(store, { ...env, SUPERADMIN_PASSWORD: 'changed-password-12345' });
  const changed = (await store.read()).users.find(x => x.id === user.id);
  assert.equal(changed.authVersion, 1); assert.equal((await store.read()).sessions.length, 0);
  assert.ok(await verifyPassword('changed-password-12345', changed.passwordHash));
  const previousAdmin = (await store.read()).users.find(x => x.email === 'admin@szkolnyalert.pl');
  await ensureSuperadmin(store, { ...env, SUPERADMIN_EMAIL: 'admin@szkolnyalert.pl' });
  const promoted = (await store.read()).users.find(x => x.id === previousAdmin.id);
  assert.equal(promoted.role, 'superadmin'); assert.equal(promoted.schoolId, null);
  assert.equal((await store.read()).users.find(x => x.email === 'admin2@szkolnyalert.pl').role, 'admin');
  await assert.rejects(ensureSuperadmin(store, { ...env, SUPERADMIN_PASSWORD: 'short' }), /11–128/);
});

test('only superadmin can switch schools and all data and writes follow the server-selected school', async t => {
  const store = await createStore({ memory: true });
  await ensureSuperadmin(store, env);
  const server = createApp(store).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const response = await fetch(base + '/api' + path, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  };
  const root = client(), admin = client();
  assert.equal((await root('/superadmin/school', 'POST', { schoolId: 'school-demo-2' })).status, 401);
  await admin('/login', 'POST', { login: 'admin@szkolnyalert.pl', password: 'demo12345' });
  assert.equal((await admin('/superadmin/school', 'POST', { schoolId: 'school-demo-2' })).status, 403);
  assert.equal((await admin('/state')).body.availableSchools, undefined);
  assert.equal((await root('/login', 'POST', { login: env.SUPERADMIN_EMAIL, password: env.SUPERADMIN_PASSWORD })).status, 200);
  const first = (await root('/state')).body;
  assert.equal(first.user.role, 'superadmin'); assert.equal(first.availableSchools.length, 2);
  assert.equal(JSON.stringify(first).includes('passwordHash'), false);
  assert.equal((await root('/superadmin/school', 'POST', { schoolId: 'missing' })).status, 404);
  assert.equal((await root('/superadmin/school', 'POST', { schoolId: 'school-demo-2' })).status, 200);
  const selected = (await root('/state')).body;
  assert.equal(selected.selectedSchoolId, 'school-demo-2');
  for (const key of ['schools', 'teachers', 'alerts', 'procedures', 'incidents', 'users']) {
    assert.ok(selected[key].every(x => (key === 'schools' ? x.id : x.schoolId) === 'school-demo-2'));
  }
  assert.equal((await root('/settings/sms')).status, 200);
  assert.equal((await root('/schools/school-demo-2', 'PUT', { name: 'Updated school' })).status, 200);
  assert.equal((await root('/schools/school-demo', 'PUT', { name: 'Wrong school' })).status, 404);
  assert.equal((await root('/users', 'POST', { name: 'Escalation', username: 'other.root', role: 'superadmin', password: 'some-password-12345' })).status, 400);
  assert.equal((await root('/users', 'POST', { name: 'New admin', username: 'school.admin', role: 'admin', password: 'some-password-12345' })).status, 201);
  assert.equal((await admin('/state')).body.schools[0].id, 'school-demo');
  await root('/logout', 'POST'); assert.equal((await root('/state')).status, 401);
});

test('superadmin can log in before any schools exist', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  await store.mutate(data => { data.schools = []; data.users = []; });
  await ensureSuperadmin(store, env);
  const server = createApp(store).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: env.SUPERADMIN_EMAIL, password: env.SUPERADMIN_PASSWORD }) });
  assert.equal(response.status, 200);
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.deepEqual(state.availableSchools, []); assert.equal(state.selectedSchoolId, null);
  assert.equal((await fetch(base + '/api/teachers', { method: 'POST', headers, body: '{}' })).status, 403);
});
