import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { createSmsGateway, smsPhone } from './smsapi.js';

const secret = 'fake-gateway-token-123456789';
const settings = { enabled: true, testMode: true, sender: 'Szkola', token: secret };
async function fixture(t) {
  const store = await createStore({ memory: true });
  await store.mutate(data => { data.teachers[0].phone = '+48 500 600 700'; data.teachers[1].phone = '500600700'; data.teachers[8].phone = '+48 500 600 799'; });
  const calls = []; let behavior = 'success';
  const sms = { encryptionKey: Buffer.alloc(32, 7), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (behavior === 'timeout') throw new Error('network error');
    if (behavior === 'failure') return Response.json({ error: 103, message: secret }, { status: 200 });
    const numbers = new URLSearchParams(options.body).get('to').split(',');
    const accepted = behavior === 'partial' ? numbers.slice(0, 1) : numbers;
    return Response.json({ count: accepted.length, list: accepted.map((number, i) => ({ id: `provider-${i}`, number, submitted_number: number, status: 'QUEUE' })) });
  } };
  const server = createApp(store, { sms }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  };
  return { store, client, calls, sms, behavior: value => { behavior = value; } };
}
const login = (request, login = 'admin@szkolnyalert.pl') => request('/login', 'POST', { login, password: 'demo12345' });

test('SMS phones normalize Polish prefixes and reject invalid numbers', () => {
  assert.equal(smsPhone('500 600 700'), '48500600700');
  assert.equal(smsPhone('+48 (500) 600-700'), '48500600700');
  assert.equal(smsPhone('0048 500 600 700'), '48500600700');
  assert.equal(smsPhone('abc'), null); assert.equal(smsPhone('123'), null);
});
test('gateway settings are admin-only, encrypted, school-scoped and never reveal the token', async t => {
  const { store, client, calls, sms } = await fixture(t); const admin = client(), other = client(), teacher = client();
  assert.equal((await admin('/settings/sms')).status, 401);
  await login(admin); await login(other, 'admin2@szkolnyalert.pl'); await login(teacher, 'nauczyciel@szkolnyalert.pl');
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await teacher('/settings/sms', method, method === 'PUT' ? settings : undefined)).status, 403);
  assert.equal((await teacher('/settings/sms/test', 'POST', { phone: '500600700' })).status, 403);
  assert.equal((await admin('/settings/sms', 'PUT', { ...settings, schoolId: 'school-demo-2' })).status, 200);
  const saved = (await admin('/settings/sms')).body;
  assert.equal(saved.hasToken, true); assert.equal(saved.recipients, 1);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(JSON.stringify((await admin('/state')).body).includes('encryptedToken'), false);
  assert.equal((await other('/settings/sms')).body.hasToken, false);
  assert.equal(JSON.stringify((await store.read()).smsSettings).includes(secret), false);
  const result = await admin('/settings/sms/test', 'POST', { phone: '500600700' });
  assert.equal(result.body.status, 'test');
  assert.equal(calls[0].url, 'https://api.smsapi.pl/sms.do');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(new URLSearchParams(calls[0].options.body).get('test'), '1');
  await admin('/settings/sms', 'PUT', { enabled: false, testMode: false, sender: 'Szkola', token: '' });
  assert.equal((await admin('/settings/sms')).body.hasToken, true, 'blank token preserves saved secret');
  // The ciphertext is bound to its school and cannot be transplanted.
  await store.mutate(data => { const a = data.smsSettings[0]; data.smsSettings.push({ ...a, schoolId: 'school-demo-2' }); });
  assert.equal((await other('/settings/sms/test', 'POST', { phone: '500600799' })).status, 503);
  assert.equal(calls.length, 1);
  await admin('/settings/sms', 'DELETE');
  assert.equal((await admin('/settings/sms')).body.hasToken, false);
  assert.equal((await admin('/settings/sms')).body.enabled, false);
  const reopened = createSmsGateway(store, sms);
  assert.equal((await reopened.getSettings('school-demo')).hasToken, false);
});
test('an alert sends only once to unique teachers of its own school; failures do not undo the alert', async t => {
  const { store, client, calls, sms, behavior } = await fixture(t); const admin = client(); await login(admin);
  await admin('/settings/sms', 'PUT', { ...settings, testMode: false });
  const created = await admin('/incidents', 'POST', { alertId: 'alert-2', location: 'Sala 1' });
  assert.equal(created.status, 201); assert.equal(created.body.sms.status, 'accepted'); assert.equal(created.body.sms.accepted, 1);
  const params = new URLSearchParams(calls[0].options.body);
  assert.equal(params.get('to'), '48500600700'); assert.equal(params.has('test'), false);
  assert.ok(params.get('message').includes('Sala 1'));
  assert.equal((await admin('/incidents', 'POST', { alertId: 'alert-2', location: 'Sala 1' })).status, 400);
  await createSmsGateway(store, sms).notifyIncident('school-demo', created.body.id);
  assert.equal(calls.length, 1, 'reopening the gateway never retries an existing attempt');
  behavior('failure');
  const failed = await admin('/incidents', 'POST', { alertId: 'alert-4', location: 'Sala 2' });
  assert.equal(failed.status, 201); assert.equal(failed.body.status, 'active'); assert.equal(failed.body.sms.status, 'failed');
  assert.equal(JSON.stringify(failed.body).includes(secret), false, 'provider response text must not expose secrets');
  behavior('timeout');
  const unknown = await admin('/incidents', 'POST', { alertId: 'alert-3', location: 'Sala 3' });
  assert.equal(unknown.body.sms.status, 'unknown');
  await createSmsGateway(store, sms).notifyIncident('school-demo', unknown.body.id);
  assert.equal(calls.length, 3, 'ambiguous sends are not automatically retried');
});
test('partial acceptance and missing recipients are reported accurately', async t => {
  const { store, client, calls, behavior } = await fixture(t); const admin = client(), other = client(); await login(admin); await login(other, 'admin2@szkolnyalert.pl');
  await store.mutate(data => { data.teachers[1].phone = '500600701'; for (const teacher of data.teachers) if (teacher.schoolId === 'school-demo-2') teacher.phone = ''; });
  await admin('/settings/sms', 'PUT', settings); behavior('partial');
  const partial = await admin('/incidents', 'POST', { alertId: 'alert-2', location: 'Sala 1' });
  assert.equal(partial.body.sms.status, 'partial'); assert.equal(partial.body.sms.accepted, 1); assert.equal(partial.body.sms.total, 2);
  await other('/settings/sms', 'PUT', settings);
  const noRecipients = await other('/incidents', 'POST', { alertId: 'alert-6', location: 'Sala 2' });
  assert.equal(noRecipients.body.sms.status, 'no_recipients'); assert.equal(calls.length, 1);
});
