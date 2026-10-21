import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { createStore } from './store.js';
import { createPushGateway, validateSubscription } from './push.js';

const vapid = webpush.generateVAPIDKeys();
const subscription = name => ({ endpoint: 'https://fcm.googleapis.com/push/' + name, keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } });
async function setup(t, sendImpl) {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  await store.mutate(data => {
    data.teacherKeys = [{ teacherId: 'teacher-1', schoolId: 'school-demo', keyHash: 'key-1' }, { teacherId: 'teacher-9', schoolId: 'school-demo-2', keyHash: 'key-9' }];
    data.incidents.push({ id: 'push-incident', schoolId: 'school-demo', name: 'Sensitive name', location: 'Sensitive location', procedure: { name: 'Private procedure' }, isTest: true });
  });
  return { store, push: createPushGateway(store, { ...vapid, sendImpl }), teacher: { id: 'teacher-1', schoolId: 'school-demo' }, other: { id: 'teacher-9', schoolId: 'school-demo-2' } };
}
test('only supported HTTPS push services with valid device keys can be registered', () => {
  assert.equal(validateSubscription(subscription('ok')).endpoint, subscription('ok').endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8080/x']) {
    assert.throws(() => validateSubscription({ ...subscription('bad'), endpoint }), { status: 400 });
  }
  assert.throws(() => validateSubscription({ ...subscription('bad'), keys: {} }), { status: 400 });
});
test('push is school scoped, deduplicated and contains only the approved generic notification', async t => {
  const calls = [];
  const { store, push, teacher, other } = await setup(t, async (sub, payload, options) => calls.push({ sub, payload: JSON.parse(payload), options }));
  await push.subscribe(teacher, 'key-1', subscription('first'));
  await push.subscribe(teacher, 'key-1', subscription('first'));
  await push.subscribe(other, 'key-9', subscription('other'));
  assert.equal((await store.read()).pushSubscriptions.length, 2);
  await assert.rejects(push.test(other, 'key-9', subscription('first').endpoint), { status: 404 });
  await push.notifyIncident('school-demo', 'push-incident'); await push.notifyIncident('school-demo', 'push-incident');
  assert.equal(calls.length, 1); assert.equal(calls[0].sub.endpoint, subscription('first').endpoint);
  assert.equal(calls[0].payload.body, 'Nowy alert w szkole — otwórz aplikację.');
  assert.equal(calls[0].payload.title, 'TEST — Szkolny Alert');
  assert.equal(JSON.stringify(calls[0].payload).includes('Sensitive'), false);
  assert.equal(calls[0].options.TTL, 120);
  assert.equal((await store.read()).incidents.find(x => x.id === 'push-incident').push.accepted, 1);
  await push.unsubscribe(other, subscription('first').endpoint);
  assert.equal((await store.read()).pushSubscriptions.length, 2);
  await push.unsubscribe(teacher, subscription('first').endpoint);
  assert.equal((await store.read()).pushSubscriptions.length, 1);
});
test('revoked access and expired endpoints stop receiving push; failures do not undo alerts', async t => {
  const { store, push, teacher } = await setup(t, async () => { throw Object.assign(new Error('private provider reply'), { statusCode: 410 }); });
  await push.subscribe(teacher, 'key-1', subscription('expired'));
  await push.notifyIncident('school-demo', 'push-incident');
  const result = (await store.read()).incidents.find(x => x.id === 'push-incident').push;
  assert.equal(result.status, 'failed'); assert.equal((await store.read()).pushSubscriptions.length, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
  await store.mutate(data => { data.teacherKeys = []; });
  await assert.rejects(push.subscribe(teacher, 'key-1', subscription('revoked')), { status: 401 });
  assert.equal(createPushGateway(store, { publicKey: '', privateKey: '' }).config().enabled, false);
});
