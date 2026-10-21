import test from 'node:test';
import assert from 'node:assert/strict';
import { hostavaIdempotencyKey, sendHostava } from './hostava-sms.js';
import { createStore } from './store.js';
import { createSmsGateway } from './smsapi.js';

const date = new Date('2026-10-21T10:00:00Z');
const token = 'fake-hostava-api-key';
const settings = { provider: 'hostava', token, enabled: true, testMode: false, sender: '' };

test('idempotency uses recipient, exact text and Warsaw calendar day', () => {
  const key = hostavaIdempotencyKey('+48500600700', 'Treść', date);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, hostavaIdempotencyKey('+48500600700', 'Treść', new Date('2026-10-21T21:59:59Z')));
  assert.notEqual(key, hostavaIdempotencyKey('+48500600700', 'Treść', new Date('2026-10-21T22:00:00Z')));
  assert.notEqual(key, hostavaIdempotencyKey('+48500600701', 'Treść', date));
  assert.notEqual(key, hostavaIdempotencyKey('+48500600700', 'Inna treść', date));
});

test('Hostava sends separate JSON requests with bearer auth and stable idempotency keys', async () => {
  const calls = [];
  const options = { token, numbers: ['48500600700', '48500600701'], text: 'Treść SMS', date,
    fetchImpl: async (url, init) => { calls.push({ url, ...init }); return Response.json({ id: 'sms-1', status: 'QUEUED', remainingBudget: 123.45 }, { status: 202 }); } };
  assert.equal((await sendHostava(options)).accepted, 2);
  assert.equal((await sendHostava(options)).status, 'accepted');
  assert.equal(calls[0].url, 'https://cloud.hostava.pl/v1/messages');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { to: '+48500600700', text: 'Treść SMS' });
  assert.equal(calls[0].headers['Idempotency-Key'], calls[2].headers['Idempotency-Key']);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('rejections, malformed replies, upstream failures and timeouts report accurate counts without leaking responses', async () => {
  const responses = [
    () => Response.json({ id: 'ok', status: 'QUEUED' }, { status: 202 }),
    () => Response.json({ error: token }, { status: 401 }),
    () => { throw new Error(token); },
    () => new Response('invalid JSON', { status: 202 }),
    () => Response.json({ error: token }, { status: 502 }),
    () => Response.json({ status: 'QUEUED' }, { status: 202 })
  ];
  let index = 0;
  const result = await sendHostava({ token, text: 'test', numbers: responses.map((_, i) => '4850060070' + i), date, fetchImpl: async () => responses[index++]() });
  assert.equal(result.status, 'partial');
  assert.equal(result.accepted, 1); assert.equal(result.failed, 1); assert.equal(result.unknown, 4);
  assert.equal(JSON.stringify(result).includes(token), false);
  for (const [status, expected] of [[400, 'failed'], [503, 'unknown']]) {
    assert.equal((await sendHostava({ token, text: 'test', numbers: ['48500600700'], fetchImpl: async () => Response.json({}, { status }) })).status, expected);
  }
});

test('gateway encrypts Hostava key, normalizes phones, simulates locally and protects provider switches', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  const calls = [];
  const gateway = createSmsGateway(store, { encryptionKey: Buffer.alloc(32, 1), now: () => date, hostavaKey: '', fetchImpl: async (url, init) => {
    calls.push({ url, ...init }); return Response.json({ id: 'ok', status: 'QUEUED' }, { status: 202 });
  } });
  const saved = await gateway.saveSettings('school-demo', settings);
  assert.equal(saved.provider, 'hostava'); assert.equal(saved.hasToken, true);
  assert.equal(JSON.stringify(await store.read()).includes(token), false);
  await gateway.test('school-demo', '500 600 700');
  await gateway.test('school-demo', '+48 500600700');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  await gateway.saveSettings('school-demo', { ...settings, token: '', testMode: true });
  const simulation = await gateway.test('school-demo', '500600700');
  assert.equal(simulation.status, 'test'); assert.equal(calls.length, 2);
  await assert.rejects(gateway.saveSettings('school-demo', { ...settings, provider: 'smsapi', token: '' }), { status: 400 });
  await assert.rejects(gateway.saveSettings('school-demo', { ...settings, provider: 'invalid' }), { status: 400 });
});

test('server Hostava key is assigned only on save and is never reused as an SMSAPI token', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  const gateway = createSmsGateway(store, { encryptionKey: Buffer.alloc(32, 2), hostavaKey: token });
  assert.equal((await gateway.getSettings('school-demo')).hasToken, false);
  const saved = await gateway.saveSettings('school-demo', { ...settings, token: '' });
  assert.equal(saved.hasToken, true);
  assert.equal(JSON.stringify(saved).includes(token), false);
  await assert.rejects(gateway.saveSettings('school-demo', { ...settings, provider: 'smsapi', token: '' }), { status: 400 });
  await gateway.removeToken('school-demo');
  assert.equal((await gateway.getSettings('school-demo')).hasToken, false);
});

test('Hostava alerts deduplicate school recipients and personal links use the same gateway', async t => {
  const store = await createStore({ memory: true }); t.after(() => store.close());
  const calls = [];
  const gateway = createSmsGateway(store, { encryptionKey: Buffer.alloc(32, 3), now: () => date, fetchImpl: async (_, init) => {
    calls.push(JSON.parse(init.body)); return Response.json({ id: 'queued', status: 'QUEUED' }, { status: 202 });
  } });
  await gateway.saveSettings('school-demo', settings);
  await store.mutate(data => {
    data.teachers = [
      { schoolId: 'school-demo', phone: '500600700' },
      { schoolId: 'school-demo', phone: '+48 500 600 700' },
      { schoolId: 'school-demo-2', phone: '500600799' }
    ];
    data.incidents.push({ id: 'hostava-incident', schoolId: 'school-demo', name: 'Alert', location: 'Sala 1', procedure: { name: 'Procedura' }, sms: { status: 'pending' } });
  });
  await gateway.notifyIncident('school-demo', 'hostava-incident');
  await gateway.notifyIncident('school-demo', 'hostava-incident');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, '+48500600700');
  assert.ok(calls[0].text.includes('Sala 1'));
  const data = await store.read();
  assert.equal(data.incidents.find(x => x.id === 'hostava-incident').sms.status, 'accepted');
  const link = 'https://school.example/nauczyciel#klucz=test';
  assert.equal((await gateway.sendLink(data.smsSettings[0], 'school-demo', '48500600700', link)).status, 'accepted');
  assert.equal(calls.length, 2); assert.ok(calls[1].text.includes(link));
});
