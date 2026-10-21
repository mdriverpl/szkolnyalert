import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { teacherDeliveryStatus } from './teacher-panel.js';
import { createTeacherLinkSms } from './teacher-link-sms.js';

async function fixture(t) {
  const store = await createStore({ memory: true });
  let server, base;
  async function start() { server = createApp(store).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
  await start(); t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const client = () => {
    const cookies = {};
    return async (path, method = 'GET', body) => {
      const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: Object.values(cookies).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const header of response.headers.getSetCookie()) { const cookie = header.split(';')[0]; cookies[cookie.split('=')[0]] = cookie; }
      return { status: response.status, body: await response.json() };
    };
  };
  return { store, client, restart: async () => { await new Promise(resolve => server.close(resolve)); await start(); } };
}
const login = (request, login = 'admin@szkolnyalert.pl') => request('/login', 'POST', { login, password: 'demo12345' });

test('creation and CSV import issue recoverable encrypted personal keys atomically without rotating on edits or duplicates', async t => {
  const { store, client, restart } = await fixture(t);
  const admin = client(), other = client(), teacher = client(), panel = client();
  await login(admin); await login(other, 'admin2@szkolnyalert.pl'); await login(teacher, 'nauczyciel@szkolnyalert.pl');
  const created = await admin('/teachers', 'POST', { name: 'Nowa Osoba', email: 'nowa@example.com', subject: 'Historia' });
  assert.equal(created.status, 201);
  const path = `/teachers/${created.body.id}/panel-key`;
  const access = (await admin(path)).body;
  assert.match(access.key, /^[a-f0-9]{64}$/);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: access.key })).status, 200);
  assert.equal((await other(path)).status, 404);
  assert.equal((await teacher(path)).status, 403);
  await admin(`/teachers/${created.body.id}`, 'PUT', { ...created.body, subject: 'Matematyka' });
  await restart();
  assert.equal((await admin(path)).body.key, access.key);
  assert.equal((await panel('/teacher-panel/state')).status, 200);
  const csv = 'name,email,subject\nCSV Osoba,csv.auto@example.com,Historia\nNowa Osoba,nowa@example.com,Historia';
  const before = (await store.read()).teacherKeys.length;
  await admin('/teachers/import/preview', 'POST', { csv });
  assert.equal((await store.read()).teacherKeys.length, before, 'preview creates no access keys');
  const result = await admin('/teachers/import', 'POST', { csv });
  assert.equal(result.status, 200); assert.equal(result.body.imported, 1);
  const data = await store.read(), imported = data.teachers.find(x => x.email === 'csv.auto@example.com');
  const importedAccess = (await admin(`/teachers/${imported.id}/panel-key`)).body;
  assert.notEqual(importedAccess.key, access.key);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: importedAccess.key })).status, 200);
  assert.equal(JSON.stringify(data).includes(importedAccess.key), false);
  assert.equal(JSON.stringify((await teacher('/state')).body).includes('encryptedKey'), false);
  await admin('/teachers/import', 'POST', { csv });
  assert.equal((await store.read()).teacherKeys.length, before + 1);
  assert.equal((await admin(path)).body.key, access.key, 'duplicates do not rotate existing access');
  const bad = await admin('/teachers/import', 'POST', { csv: 'name,email,subject\nBad,not-an-email,Historia\nValid,valid.auto@example.com,Historia' });
  assert.equal(bad.status, 422); assert.equal((await store.read()).teacherKeys.length, before + 1);
  await admin(path, 'DELETE');
  assert.equal((await admin(path)).body.key, null);
  const rotated = (await admin(path, 'POST')).body;
  assert.notEqual(rotated.key, access.key);
  assert.equal((await admin(path)).body.key, rotated.key);
});

test('personal teacher keys grant only the teacher panel of one school, never administration', async t => {
  const { store, client, restart } = await fixture(t);
  const admin = client(), other = client(), regularTeacher = client(), panel = client();
  assert.equal((await panel('/teacher-panel/state')).status, 401);
  await login(admin); await login(other, 'admin2@szkolnyalert.pl'); await login(regularTeacher, 'nauczyciel@szkolnyalert.pl');
  assert.equal((await other('/teachers/teacher-1/panel-key', 'POST')).status, 404);
  assert.equal((await regularTeacher('/teachers/teacher-1/panel-key', 'POST')).status, 403);
  const access = await admin('/teachers/teacher-1/panel-key', 'POST');
  assert.equal(access.status, 200); assert.match(access.body.key, /^[a-f0-9]{64}$/);
  assert.equal(access.body.path, `/nauczyciel#klucz=${access.body.key}`);
  assert.equal(JSON.stringify(await store.read()).includes(access.body.key), false, 'raw personal key must not be stored');
  const state = (await admin('/state')).body;
  assert.equal(state.teachers.find(x => x.id === 'teacher-1').hasPanelKey, true);
  assert.equal(JSON.stringify(state).includes('keyHash'), false);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: access.body.key })).status, 200);
  const own = (await panel('/teacher-panel/state?schoolId=school-demo-2')).body;
  assert.equal(own.teacher.id, 'teacher-1'); assert.equal(own.school.id, 'school-demo');
  assert.ok(own.alerts.every(x => x.schoolId === 'school-demo' && x.procedure.schoolId === 'school-demo'));
  assert.ok(own.incidents.every(x => x.schoolId === 'school-demo' && x.procedure.steps.length));
  assert.equal('teachers' in own, false); assert.equal('users' in own, false);
  assert.equal((await panel('/state')).status, 401);
  assert.equal((await panel('/settings/sms')).status, 401);
  assert.equal((await panel('/teacher-panel/incidents', 'POST', { alertId: 'alert-6', location: 'Test', schoolId: 'school-demo-2' })).status, 404);
  const launched = await panel('/teacher-panel/incidents', 'POST', { alertId: 'alert-2', location: 'Sala 12', schoolId: 'school-demo-2' });
  assert.equal(launched.status, 201); assert.equal(launched.body.schoolId, 'school-demo'); assert.equal(launched.body.createdByTeacherId, 'teacher-1');
  assert.equal((await panel('/teacher-panel/state')).body.incidents.some(x => x.id === launched.body.id), true);
  assert.equal((await panel(`/incidents/${launched.body.id}/resolve`, 'POST')).status, 401);
  await restart();
  assert.equal((await panel('/teacher-panel/state')).status, 200, 'teacher session survives backend restart');
  const rotated = await admin('/teachers/teacher-1/panel-key', 'POST');
  assert.notEqual(rotated.body.key, access.body.key);
  assert.equal((await panel('/teacher-panel/state')).status, 401);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: access.body.key })).status, 401);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: rotated.body.key })).status, 200);
  await admin('/teachers/teacher-1/panel-key', 'DELETE');
  assert.equal((await panel('/teacher-panel/state')).status, 401);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key: rotated.body.key })).status, 401);
});

test('teacher sessions are separate from admin sessions and deletion immediately revokes the panel', async t => {
  const { client } = await fixture(t); const browser = client(); await login(browser);
  const access = (await browser('/teachers/teacher-2/panel-key', 'POST')).body;
  await browser('/teacher-panel/access', 'POST', { key: access.key });
  assert.equal((await browser('/state')).body.user.role, 'admin');
  assert.equal((await browser('/teacher-panel/state')).body.teacher.id, 'teacher-2');
  await browser('/teacher-panel/logout', 'POST');
  assert.equal((await browser('/teacher-panel/state')).status, 401);
  assert.equal((await browser('/state')).status, 200);
  await browser('/teacher-panel/access', 'POST', { key: access.key });
  assert.equal((await browser('/teachers/teacher-2', 'DELETE')).status, 200);
  assert.equal((await browser('/teacher-panel/state')).status, 401);
  assert.equal((await browser('/teacher-panel/access', 'POST', { key: access.key })).status, 401);
});


test('teacher list tracks authenticated panel presence, independent of notification registration', async t => {
  const { store, client } = await fixture(t);
  const admin = client(), panel = client(), anonymous = client();
  await login(admin);
  const access = (await admin('/teachers/teacher-1/panel-key', 'POST')).body;
  const status = async () => (await admin('/state')).body.teachers.find(x => x.id === 'teacher-1');
  assert.equal((await status()).online, false);
  assert.equal((await anonymous('/teacher-panel/presence', 'POST', { active: false })).status, 401);
  await panel('/teacher-panel/access', 'POST', { key: access.key });
  await panel('/teacher-panel/state');
  assert.equal((await status()).online, true);
  assert.equal((await status()).notificationsEnabled, false);
  await panel('/teacher-panel/presence', 'POST', { active: false });
  assert.equal((await status()).online, false);
  await panel('/teacher-panel/state');
  assert.equal((await status()).online, true);
  await store.mutate(data => { data.teacherSessions.forEach(x => { x.lastSeen = Date.now() - 46_000; }); });
  assert.equal((await status()).online, false);
  await panel('/teacher-panel/state');
  await admin('/teachers/teacher-1/panel-key', 'DELETE');
  assert.equal((await status()).online, false);
});

test('delivery badges ignore other schools, expired sessions, revoked keys and obsolete push keys', () => {
  const teacher = { id: 't1', schoolId: 's1' }, now = 100_000;
  const row = { teacherId: 't1', schoolId: 's1', keyHash: 'key1' };
  const data = { teacherKeys: [row], teacherSessions: [{ ...row, lastSeen: now, expires: now + 1000 }], pushSubscriptions: [{ ...row, publicKey: 'vapid1' }] };
  const config = { enabled: true, publicKey: 'vapid1' };
  assert.deepEqual(teacherDeliveryStatus(data, teacher, config, now), { online: true, notificationsEnabled: true });
  data.teacherSessions.push({ ...row, lastSeen: 0, expires: now + 1000 });
  assert.equal(teacherDeliveryStatus(data, teacher, config, now).online, true, 'one open device is enough');
  data.teacherSessions[0].expires = now;
  assert.equal(teacherDeliveryStatus(data, teacher, config, now).online, false);
  assert.equal(teacherDeliveryStatus(data, teacher, { ...config, publicKey: 'rotated' }, now).notificationsEnabled, false);
  assert.equal(teacherDeliveryStatus(data, teacher, { ...config, enabled: false }, now).notificationsEnabled, false);
  data.pushSubscriptions[0].schoolId = 's2';
  assert.equal(teacherDeliveryStatus(data, teacher, config, now).notificationsEnabled, false);
  data.pushSubscriptions[0].schoolId = 's1'; data.teacherKeys = [];
  assert.deepEqual(teacherDeliveryStatus(data, teacher, config, now), { online: false, notificationsEnabled: false });
});


test('compact SMS links retain 256-bit keys, open the correct teacher panel, and are revocable', async t => {
  const { store, client } = await fixture(t), admin = client(), panel = client();
  await login(admin);
  await store.mutate(data => {
    data.smsSettings = [{ schoolId: 'school-demo', encryptedToken: 'fake', testMode: false }];
    data.teachers.find(x => x.id === 'teacher-1').phone = '500600777';
  });
  let sent;
  const links = createTeacherLinkSms(store, { sendLink: async (_, __, phone, link) => { sent = { phone, link }; return { status: 'accepted', accepted: 1 }; } });
  const preview = await links.preview('school-demo', 'admin', 'https://szkolnyalert.pl', 'teacher-1');
  assert.equal(preview.canSend, true);
  await links.send('school-demo', 'admin', 'https://szkolnyalert.pl', { batchId: preview.batchId, confirmed: true, expectedCount: 1 });
  assert.equal(sent.link.length, 69);
  const url = new URL(sent.link), key = url.hash.slice(1);
  assert.equal(url.pathname, '/n');
  assert.equal(Buffer.from(key, 'base64url').length, 32);
  assert.equal(JSON.stringify(await store.read()).includes(key), false);
  assert.equal((await panel('/teacher-panel/access', 'POST', { key })).status, 200);
  assert.equal((await panel('/teacher-panel/state')).body.teacher.id, 'teacher-1');
  const tooLong = await links.preview('school-demo', 'admin', 'https://very-long-school-subdomain.example.com', 'teacher-1');
  assert.equal(tooLong.canSend, false);
  await admin('/teachers/teacher-1/panel-key', 'DELETE');
  assert.equal((await panel('/teacher-panel/access', 'POST', { key })).status, 401);
});
