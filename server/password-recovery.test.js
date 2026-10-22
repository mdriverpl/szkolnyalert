import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { verifyPassword } from './auth.js';
import { ensureSuperadmin } from './superadmin.js';

async function fixture(t, mailOptions = {}) {
  const store = await createStore({ memory: true }), mails = [];
  const server = createApp(store, { mail: { env: {}, sendMail: async mail => { mails.push(mail); }, ...mailOptions } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  return { store, mails, client };
}
const login = (request, password = 'demo12345', login = 'admin@szkolnyalert.pl') => request('/login', 'POST', { login, password });
const temporaryPassword = mail => mail.text.match(/hasło tymczasowe: ([^\s]+)/)[1];

test('recovery sends a random expiring password to the account email without exposing secrets or disabling existing access', async t => {
  const { store, mails, client } = await fixture(t), requester = client(), existingSession = client(), recovered = client();
  await login(existingSession);
  const absent = await requester('/password-recovery', 'POST', { email: 'unknown@example.com' });
  const found = await requester('/password-recovery', 'POST', { email: ' ADMIN@SZKOLNYALERT.PL ' });
  assert.deepEqual(found, absent); assert.equal(found.status, 200); assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'admin@szkolnyalert.pl');
  const password = temporaryPassword(mails[0]);
  assert.ok(password.length >= 20);
  assert.equal(JSON.stringify(found).includes(password), false);
  assert.equal(JSON.stringify(await store.read()).includes(password), false);
  assert.equal((await existingSession('/state')).status, 200);
  assert.equal((await login(client())).status, 200, 'old password remains valid until temporary password is used');
  await requester('/password-recovery', 'POST', { email: 'admin@szkolnyalert.pl' });
  assert.equal(mails.length, 1, 'account cooldown prevents repeated emails');
  const result = await login(recovered, password);
  assert.equal(result.status, 200); assert.equal(result.body.temporaryPassword, true);
  assert.equal((await existingSession('/state')).status, 401);
  assert.equal((await login(client())).status, 401);
  assert.equal((await recovered('/state')).status, 200);
  const user = (await store.read()).users.find(x => x.email === 'admin@szkolnyalert.pl');
  assert.equal(user.passwordReset, undefined);
  assert.ok(await verifyPassword(password, user.passwordHash));
  assert.equal(JSON.stringify(result).includes('passwordHash'), false);
});

test('expired and undelivered temporary passwords cannot log in; recovery is rate limited and validates emails', async t => {
  const { store, mails, client } = await fixture(t), request = client();
  assert.equal((await request('/password-recovery', 'POST', { email: 'invalid' })).status, 400);
  await request('/password-recovery', 'POST', { email: 'admin@szkolnyalert.pl' });
  const password = temporaryPassword(mails[0]);
  await store.mutate(data => { data.users.find(x => x.email === 'admin@szkolnyalert.pl').passwordReset.delivered = false; });
  assert.equal((await login(client(), password)).status, 401);
  await store.mutate(data => { const reset = data.users.find(x => x.email === 'admin@szkolnyalert.pl').passwordReset; reset.delivered = true; reset.expires = Date.now() - 1; });
  assert.equal((await login(client(), password)).status, 401);
  assert.equal((await login(client())).status, 200);
  for (let i = 0; i < 3; i++) await request('/password-recovery', 'POST', { email: 'unknown@example.com' });
  assert.equal((await request('/password-recovery', 'POST', { email: 'unknown@example.com' })).status, 429);
});

test('missing SMTP configuration is reported uniformly and delivery failure keeps the previous password and sessions', async t => {
  const missing = await fixture(t, { sendMail: undefined });
  const request = missing.client();
  for (const email of ['admin@szkolnyalert.pl', 'unknown@example.com']) assert.equal((await request('/password-recovery', 'POST', { email })).status, 503);
  const broken = await fixture(t, { sendMail: async () => { throw new Error('smtp-secret-must-not-leak'); } });
  const logged = broken.client(); await login(logged);
  const errorLog = t.mock.method(console, 'error', () => {});
  const result = await broken.client()('/password-recovery', 'POST', { email: 'admin@szkolnyalert.pl' });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result).includes('smtp-secret'), false);
  assert.equal((await logged('/state')).status, 200);
  assert.equal((await login(broken.client())).status, 200);
  assert.equal((await broken.store.read()).users.find(x => x.email === 'admin@szkolnyalert.pl').passwordReset, undefined);
  assert.equal(errorLog.mock.calls.length, 1);
});

test('a logged-in user changes only their own password, retains the current session and revokes others and pending resets', async t => {
  const { client, store } = await fixture(t), account = client(), otherDevice = client(), otherSchool = client();
  await login(account); await login(otherDevice); await login(otherSchool, 'demo12345', 'admin2@szkolnyalert.pl');
  const change = { currentPassword: 'demo12345', newPassword: 'Nowe-haslo-12345', confirmPassword: 'Nowe-haslo-12345' };
  assert.equal((await client()('/account/password', 'POST', change)).status, 401);
  assert.equal((await account('/account/password', 'POST', { ...change, currentPassword: 'wrong' })).status, 400);
  assert.equal((await account('/account/password', 'POST', { ...change, confirmPassword: 'mismatch' })).status, 400);
  assert.equal((await account('/account/password', 'POST', { ...change, newPassword: 'short', confirmPassword: 'short' })).status, 400);
  assert.equal((await account('/account/password', 'POST', { ...change, email: 'admin2@szkolnyalert.pl' })).status, 409);
  await client()('/password-recovery', 'POST', { email: 'admin@szkolnyalert.pl' });
  const result = await account('/account/password', 'POST', { ...change, userId: 'user-2', schoolId: 'school-demo-2', email: 'recovery@example.com' });
  assert.equal(result.status, 200);
  assert.equal((await account('/state')).status, 200);
  assert.equal((await account('/state')).body.user.email, 'recovery@example.com');
  assert.equal((await otherDevice('/state')).status, 401);
  assert.equal((await otherSchool('/state')).status, 200);
  assert.equal((await login(client())).status, 401);
  assert.equal((await login(client(), change.newPassword)).status, 200);
  assert.equal((await login(client(), change.newPassword, 'recovery@example.com')).status, 200);
  assert.equal((await store.read()).users.find(x => x.username === 'admin@szkolnyalert.pl').passwordReset, undefined);
});

test('a teacher account can change its password and a superadmin password survives an unchanged environment bootstrap', async t => {
  const { client, store } = await fixture(t), teacher = client();
  await login(teacher, 'demo12345', 'nauczyciel@szkolnyalert.pl');
  assert.equal((await teacher('/account/password', 'POST', { currentPassword: 'demo12345', newPassword: 'Teacher-new-12345', confirmPassword: 'Teacher-new-12345' })).status, 200);
  const env = { SUPERADMIN_EMAIL: 'root@example.com', SUPERADMIN_PASSWORD: 'Bootstrap-password-123' };
  await ensureSuperadmin(store, env);
  const root = client(); await login(root, env.SUPERADMIN_PASSWORD, env.SUPERADMIN_EMAIL);
  assert.equal((await root('/account/password', 'POST', { currentPassword: env.SUPERADMIN_PASSWORD, newPassword: 'Root-new-password-123', confirmPassword: 'Root-new-password-123' })).status, 200);
  await ensureSuperadmin(store, env);
  assert.equal((await login(client(), 'Root-new-password-123', env.SUPERADMIN_EMAIL)).status, 200);
  assert.equal((await login(client(), env.SUPERADMIN_PASSWORD, env.SUPERADMIN_EMAIL)).status, 401);
  // A concurrent administrator change invalidates any password sent earlier.
  await store.mutate(data => { const user = data.users.find(x => x.email === env.SUPERADMIN_EMAIL); user.passwordHash = 'changed-concurrently'; user.authVersion++; });
  assert.equal((await root('/state')).status, 401);
});
