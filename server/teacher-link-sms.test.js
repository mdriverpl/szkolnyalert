import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { createTeacherLinkSms } from './teacher-link-sms.js';

async function fixture(t, testMode = false) {
  const store = await createStore({ memory: true });
  t.after(() => store.close());
  await store.mutate(data => {
    data.teachers = [
      { id: 'a', schoolId: 'school-demo', name: 'Anna', phone: '500600701' },
      { id: 'b', schoolId: 'school-demo', name: 'Bartek', phone: '+48 500600702' },
      { id: 'c', schoolId: 'school-demo', name: 'Celina' },
      { id: 'd', schoolId: 'school-demo', name: 'Daniel', phone: '500600703' },
      { id: 'e', schoolId: 'school-demo', name: 'Ewa', phone: '+48 500600703' },
      { id: 'other', schoolId: 'school-demo-2', name: 'Other', phone: '500600799' }
    ];
    data.smsSettings = [{ schoolId: 'school-demo', encryptedToken: 'fake-encrypted', testMode }];
    data.teacherKeys = [{ teacherId: 'a', schoolId: 'school-demo', keyHash: 'old-key' }];
  });
  const calls = [];
  const service = createTeacherLinkSms(store, { sendLink: async (settings, schoolId, phone, link) => {
    calls.push({ settings, schoolId, phone, link });
    return { status: testMode ? 'test' : 'accepted', accepted: 1 };
  } });
  const preview = () => service.preview('school-demo', 'admin', 'https://school.example');
  const send = p => service.send('school-demo', 'admin', 'https://school.example', { batchId: p.batchId, confirmed: true, expectedCount: p.count });
  return { store, calls, service, preview, send };
}

test('bulk confirmation counts only unique valid phones in one school; preview sends nothing', async t => {
  const f = await fixture(t), p = await f.preview();
  assert.equal(p.count, 2); assert.equal(p.skipped.length, 3); assert.equal(p.canSend, true);
  assert.deepEqual(p.recipients.map(x => x.id), ['a', 'b']);
  assert.equal(f.calls.length, 0); assert.equal((await f.store.read()).teacherKeys.length, 1);
  assert.equal(JSON.stringify(p).includes('fake-encrypted'), false);
  await assert.rejects(f.service.send('school-demo-2', 'admin', 'https://school.example', { batchId: p.batchId, confirmed: true }), { status: 404 });
  const [result, duplicate] = await Promise.all([f.send(p), f.send(p)]);
  assert.equal(result.accepted, 2); assert.ok(['sending', 'accepted'].includes(duplicate.status));
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].link, f.calls[1].link);
  const data = await f.store.read();
  assert.equal(data.teacherKeys.length, 3);
  assert.equal(data.teacherKeys[0].keyHash, 'old-key');
  for (const call of f.calls) assert.equal(JSON.stringify(data).includes(call.link.split('=')[1]), false);
  assert.equal((await f.send(p)).accepted, 2); assert.equal(f.calls.length, 2);
});

test('stale count, changed settings or phone, missing confirmation and foreign admin cannot send', async t => {
  const f = await fixture(t), p = await f.preview();
  await assert.rejects(f.service.send('school-demo', 'admin', 'https://school.example', { batchId: p.batchId, expectedCount: 2 }), { status: 400 });
  await assert.rejects(f.service.send('school-demo', 'another', 'https://school.example', { batchId: p.batchId, confirmed: true, expectedCount: 2 }), { status: 404 });
  await assert.rejects(f.service.send('school-demo', 'admin', 'https://school.example', { batchId: p.batchId, confirmed: true, expectedCount: 9 }), { status: 409 });
  await f.store.mutate(data => { data.teachers[0].phone = '500600777'; });
  await assert.rejects(f.send(p), { status: 409 });
  const fresh = await f.preview();
  await f.store.mutate(data => { data.smsSettings[0].testMode = true; });
  await assert.rejects(f.send(fresh), { status: 409 });
  assert.equal(f.calls.length, 0);
});

test('test mode creates no usable keys; localhost live sending is blocked', async t => {
  const f = await fixture(t, true), p = await f.preview();
  assert.equal((await f.send(p)).status, 'test');
  assert.equal((await f.store.read()).teacherKeys.length, 1);
  await f.store.mutate(data => { data.smsSettings[0].testMode = false; });
  const local = await f.service.preview('school-demo', 'admin', 'http://127.0.0.1:3001');
  assert.equal(local.canSend, false);
});

test('provider rejection removes only new failed keys; uncertain results retain usable links', async t => {
  const f = await fixture(t);
  const service = createTeacherLinkSms(f.store, { sendLink: async (_, __, phone) => ({ status: phone.endsWith('1') ? 'failed' : 'unknown', accepted: 0 }) });
  const p = await service.preview('school-demo', 'admin', 'https://school.example');
  const result = await service.send('school-demo', 'admin', 'https://school.example', { batchId: p.batchId, expectedCount: 2, confirmed: true });
  assert.equal(result.failed, 1); assert.equal(result.unknown, 1);
  const keys = (await f.store.read()).teacherKeys;
  assert.equal(keys.length, 2); assert.equal(keys[0].keyHash, 'old-key'); assert.equal(keys[1].teacherId, 'b');
});

test('single-teacher batches send only to the selected teacher and cannot be widened at confirmation', async t => {
  const f = await fixture(t);
  const p = await f.service.preview('school-demo', 'admin', 'https://school.example', 'b');
  assert.equal(p.count, 1); assert.equal(p.teacherId, 'b'); assert.equal(p.canSend, true);
  assert.deepEqual(p.recipients.map(x => x.id), ['b']);
  assert.equal(f.calls.length, 0);
  const result = await f.service.send('school-demo', 'admin', 'https://school.example', {
    batchId: p.batchId, expectedCount: 1, confirmed: true, teacherId: 'a'
  });
  assert.equal(result.accepted, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].phone, '48500600702');
  assert.ok(f.calls[0].link.startsWith('https://school.example/nauczyciel#klucz='));
  const keys = (await f.store.read()).teacherKeys;
  assert.equal(keys.length, 2); assert.equal(keys[0].keyHash, 'old-key'); assert.equal(keys[1].teacherId, 'b');
  await f.send(p); assert.equal(f.calls.length, 1, 'a batch is never sent twice');
});

test('single-teacher preview rejects foreign IDs and blocks missing or shared phones and stale recipients', async t => {
  const f = await fixture(t);
  for (const id of ['other', 'missing', '', ['a']]) {
    await assert.rejects(f.service.preview('school-demo', 'admin', 'https://school.example', id), { status: 404 });
  }
  for (const id of ['c', 'd']) {
    const p = await f.service.preview('school-demo', 'admin', 'https://school.example', id);
    assert.equal(p.canSend, false); assert.equal(p.count, 0); assert.equal(p.skipped.length, 1);
    await assert.rejects(f.send(p), { status: 400 });
  }
  const p = await f.service.preview('school-demo', 'admin', 'https://school.example', 'a');
  await f.store.mutate(data => { data.teachers[0].phone = '500600777'; });
  await assert.rejects(f.send(p), { status: 409 });
  assert.equal(f.calls.length, 0);
});
