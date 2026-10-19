import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createStore } from './store.js';
import { storageConfig } from './config.js';
import { createApp } from './app.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'school-json-'));
  const stores = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep + 'school-json-'));
    await rm(target, { recursive: true, force: true });
  });
  return { directory, file: join(directory, 'private', 'app.json'), start: async options => {
    const store = await createStore({ file: join(directory, 'private', 'app.json'), demo: false, ...options });
    stores.push(store); return store;
  } };
}

test('production JSON starts empty and persists queued changes and sessions across restart', async t => {
  const f = await fixture(t), store = await f.start();
  assert.equal(store.demo, false); assert.equal(store.storage, 'json');
  const initial = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(initial.users, []); assert.deepEqual(initial.schools, []);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.mutate(data => { data.sessions.push({ tokenHash: `hash-${i}` }); })));
  await store.close();
  const reopened = await f.start();
  assert.equal((await reopened.read()).sessions.length, 20);
  assert.equal((await readdir(join(f.directory, 'private'))).some(x => x.endsWith('.tmp')), false);
});

test('JSON lock prevents a second writer and releases on normal shutdown', async t => {
  const f = await fixture(t), store = await f.start();
  await assert.rejects(f.start(), /zablokowany/);
  await store.close();
  const reopened = await f.start(); assert.equal((await reopened.read()).users.length, 0);
});

test('automatic backups retain valid previous states and obey retention', async t => {
  const f = await fixture(t), store = await f.start({ backupIntervalMs: 0, backupLimit: 2 });
  for (let i = 1; i <= 4; i++) await store.mutate(data => { data.revision = i; });
  const directory = join(f.directory, 'private', 'backups');
  const files = await readdir(directory);
  assert.equal(files.length, 2);
  const revisions = await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8')).revision));
  assert.deepEqual(revisions.sort(), [2, 3]);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).revision, 4);
});

test('backup failure refuses mutation without replacing current data', async t => {
  const f = await fixture(t), store = await f.start();
  await writeFile(join(f.directory, 'private', 'backups'), 'not a directory');
  await assert.rejects(store.mutate(data => { data.revision = 'uncommitted'; }));
  assert.equal((await store.read()).revision, undefined);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).revision, undefined);
});

test('corrupt or empty existing JSON is never overwritten with demo data and releases startup lock', async t => {
  const f = await fixture(t); await mkdir(join(f.directory, 'private'));
  for (const invalid of ['{broken', '', '{}']) {
    await writeFile(f.file, invalid);
    await assert.rejects(f.start());
    assert.equal(await readFile(f.file, 'utf8'), invalid);
    assert.equal((await readdir(join(f.directory, 'private'))).includes('app.json.lock'), false);
  }
});

test('runtime config selects production JSON independently of DATABASE_URL, requires encryption and rejects demo', () => {
  const env = { NODE_ENV: 'production', SMS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') };
  const config = storageConfig(env);
  assert.equal(config.demo, false); assert.equal(config.backups, true); assert.equal(config.lock, true);
  assert.ok(config.file.endsWith(join('data', 'app.json')));
  assert.equal(storageConfig({ ...env, STORAGE_DRIVER: 'json', DATABASE_URL: 'unused' }).connectionString, undefined);
  assert.throws(() => storageConfig({ NODE_ENV: 'production' }), /SMS_ENCRYPTION_KEY/);
  assert.throws(() => storageConfig({ ...env, DEMO_DATA: 'true' }), /DEMO_DATA/);
  assert.throws(() => storageConfig({ ...env, JSON_BACKUP_LIMIT: '0' }), /kopii/);
  assert.throws(() => storageConfig({ ...env, STORAGE_DRIVER: 'postgres' }), /DATABASE_URL/);
});

test('a new production JSON installation registers a real school and retains teacher links and login after restart', async t => {
  const f = await fixture(t); let server, base, cookie = '';
  const start = async () => {
    const store = await f.start();
    server = createApp(store, { sms: { encryptionKey: Buffer.alloc(32, 9), fetchImpl: () => { throw new Error('SMS must not be sent'); } } }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    return store;
  };
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + '/api' + path, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
  let store = await start();
  assert.equal((await request('/health')).body.demo, false);
  assert.equal((await request('/register-school', 'POST', { name: 'Szkoła JSON', username: 'json.admin', password: 'SilneHaslo12345' })).status, 201);
  const created = await request('/teachers', 'POST', { name: 'Nauczyciel JSON', email: 'json@example.com', subject: 'Historia' });
  assert.equal(created.status, 201);
  const path = `/teachers/${created.body.id}/panel-key`;
  const access = (await request(path)).body;
  assert.match(access.key, /^[a-f0-9]{64}$/);
  await new Promise(resolve => server.close(resolve)); server = null;
  await store.close(); store = await start();
  assert.equal((await request('/state')).body.schools.length, 1);
  assert.equal((await request(path)).body.key, access.key);
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.users.length, 1);
  assert.equal(JSON.stringify(saved).includes(access.key), false);
  assert.ok((await readdir(join(f.directory, 'private', 'backups'))).length > 0);
});
