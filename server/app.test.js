import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { createApp } from './app.js';

async function fixture(t) {
  const store = await createStore({ memory: true });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  return { store, client };
}
const login = (request, email = 'admin@szkolnyalert.pl') => request('/login', 'POST', { email, password: 'demo12345' });
const newSchool = { name: 'Szkoła testowa', username: 'nowa.szkola', password: 'Haslo123456' };

test('authentication is mandatory and each account opens exactly one school', async t => {
  const { client } = await fixture(t); const request = client();
  assert.equal((await request('/state')).status, 401);
  assert.equal((await request('/teachers', 'POST', {})).status, 401);
  assert.equal((await request('/login', 'POST', { email: 'bad', password: 'bad' })).status, 401);
  assert.equal((await login(request)).status, 200);
  const state = (await request('/state')).body;
  assert.deepEqual(state.schools.map(x => x.id), ['school-demo']);
  for (const key of ['teachers', 'procedures', 'alerts', 'incidents', 'users']) assert.ok(state[key].every(x => x.schoolId === 'school-demo'));
  assert.equal(JSON.stringify(state).includes('passwordHash'), false);
  assert.equal(JSON.stringify(state).includes('authVersion'), false);
  assert.equal(state.user.schoolId, 'school-demo');
  assert.equal((await request('/state?schoolId=school-demo-2')).body.schools[0].id, 'school-demo');
  await request('/logout', 'POST'); assert.equal((await request('/state')).status, 401);
});

test('registration creates an isolated school and admin atomically without previous login', async t => {
  const { client, store } = await fixture(t); const request = client();
  assert.equal((await request('/register-school', 'POST', { ...newSchool, password: '1234567890' })).status, 400);
  assert.equal((await store.read()).schools.length, 2);
  const registered = await request('/register-school', 'POST', newSchool);
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.role, 'admin');
  assert.equal(registered.body.user.schoolId, registered.body.school.id);
  assert.equal(registered.body.user.username, newSchool.username);
  assert.equal(registered.body.school.city, '');
  assert.equal(registered.body.school.address, '');
  assert.equal(JSON.stringify(registered.body).includes('passwordHash'), false);
  const state = (await request('/state')).body;
  assert.equal(state.schools.length, 1); assert.equal(state.schools[0].name, newSchool.name);
  assert.equal(state.teachers.length, 0); assert.equal(state.alerts.length, 6);
  assert.equal(state.incidents.length, 0, 'sample alerts must not launch an incident');
  assert.ok(state.alerts.every(a => state.procedures.some(p => p.id === a.procedureId && p.schoolId === a.schoolId)));
  assert.equal(state.procedures.length, 6);
  assert.ok(state.procedures.every(p => p.schoolId === registered.body.school.id && p.steps.length >= 4 && p.description.includes('SZABLON')));
  assert.equal(state.users.length, 1);
  const other = client();
  assert.equal((await other('/register-school', 'POST', { ...newSchool, username: newSchool.username.toUpperCase() })).status, 409);
  assert.equal((await store.read()).schools.length, 3, 'duplicate account must not leave orphan schools');
  await request('/logout', 'POST');
  assert.equal((await request('/login', 'POST', { login: newSchool.username.toUpperCase(), password: newSchool.password })).status, 200);
  assert.equal((await request('/state')).body.schools[0].id, registered.body.school.id);
});

test('foreign school IDs cannot read, edit, delete, create linked records, or launch or resolve incidents', async t => {
  const { client } = await fixture(t); const a = client(), b = client(); await login(a); await login(b, 'admin2@szkolnyalert.pl');
  const beforeB = (await b('/state')).body;
  for (const [type, id] of [['schools', 'school-demo-2'], ['teachers', 'teacher-9'], ['procedures', 'procedure-6'], ['alerts', 'alert-6'], ['users', 'user-demo-2']]) {
    assert.equal((await a(`/${type}/${id}`, 'PUT', { name: 'Atak', email: 'attacker@example.com', role: 'admin' })).status, 404);
    assert.equal((await a(`/${type}/${id}`, 'DELETE')).status, 404);
  }
  assert.equal((await a('/teachers', 'POST', { name: 'Atak', schoolId: 'school-demo-2', email: 'a@example.com', subject: 'Test' })).status, 403);
  assert.equal((await a('/users', 'POST', { name: 'Atak', schoolId: 'school-demo-2', email: 'a@example.com', role: 'admin', password: 'testowe-haslo-123' })).status, 403);
  assert.equal((await a('/alerts', 'POST', { name: 'Atak', procedureId: 'procedure-6', severity: 'info', description: 'Atak' })).status, 404);
  assert.equal((await a('/incidents', 'POST', { alertId: 'alert-6', location: 'Test' })).status, 404);
  assert.equal((await b('/incidents/incident-demo-1/resolve', 'POST')).status, 404);
  assert.equal((await a('/schools', 'POST', newSchool)).status, 403);
  assert.deepEqual((await b('/state')).body, beforeB);
});

test('teacher permissions, account changes, and last administrator protection', async t => {
  const { client, store } = await fixture(t); const admin = client(), teacher = client(); await login(admin); await login(teacher, 'nauczyciel@szkolnyalert.pl');
  assert.deepEqual((await teacher('/state')).body.users, []);
  for (const type of ['schools', 'teachers', 'alerts', 'procedures', 'users']) assert.equal((await teacher('/' + type, 'POST', {})).status, 403);
  assert.equal((await teacher('/incidents/incident-demo-1/resolve', 'POST')).status, 403);
  const event = await teacher('/incidents', 'POST', { alertId: 'alert-2', location: 'Sala 1' });
  assert.equal(event.status, 201); assert.equal(event.body.createdBy, 'nauczyciel@szkolnyalert.pl');
  assert.equal((await admin('/users/user-demo-1', 'DELETE')).status, 400);
  assert.equal((await admin('/users/user-demo-1', 'PUT', { name: 'Anna', email: 'admin@szkolnyalert.pl', role: 'teacher' })).status, 400);
  const changed = await admin('/users/user-demo-3', 'PUT', { name: 'Michał', email: 'nauczyciel@szkolnyalert.pl', role: 'teacher', password: 'nowe-testowe-haslo' });
  assert.equal(changed.status, 200); assert.equal('passwordHash' in changed.body, false);
  assert.equal((await teacher('/state')).status, 401, 'password reset revokes existing sessions');
  assert.equal((await teacher('/login', 'POST', { email: 'nauczyciel@szkolnyalert.pl', password: 'nowe-testowe-haslo' })).status, 200);
  assert.notEqual((await store.read()).users.find(x => x.id === 'user-demo-3').passwordHash, 'nowe-testowe-haslo');
  assert.equal((await admin('/users/user-demo-3', 'DELETE')).status, 200);
  assert.equal((await teacher('/state')).status, 401, 'deleted account loses access immediately');
});

test('alert lifecycle retains a snapshot of the procedure in its own school', async t => {
  const { client } = await fixture(t); const request = client(); await login(request);
  const teacher = { name: 'Jan Testowy', subject: 'Historia', email: 'jan@example.com', phone: '+48 500 600 710' };
  assert.equal((await request('/teachers', 'POST', { ...teacher, email: 'bad' })).status, 400);
  assert.equal((await request('/teachers', 'POST', { ...teacher, phone: 'abc' })).status, 400);
  const addedTeacher = await request('/teachers', 'POST', teacher);
  assert.equal(addedTeacher.status, 201);
  assert.equal(addedTeacher.body.phone, teacher.phone);
  const teacherPath = `/teachers/${addedTeacher.body.id}`;
  const { phone, ...withoutPhone } = teacher;
  assert.equal((await request(teacherPath, 'PUT', withoutPhone)).body.phone, phone);
  assert.equal((await request(teacherPath, 'PUT', { ...teacher, phone: '+48 500 600 711' })).body.phone, '+48 500 600 711');
  assert.equal((await request(teacherPath, 'PUT', { ...teacher, phone: '' })).body.phone, '');
  assert.equal((await request('/teachers', 'POST', teacher)).status, 400);
  const proc = (await request('/procedures', 'POST', { name: 'Test', category: 'Test', description: 'Test', steps: ['Krok pierwszy'] })).body;
  const created = (await request('/alerts', 'POST', { name: 'Test', severity: 'info', description: 'Test', procedureId: proc.id })).body;
  assert.equal((await request(`/procedures/${proc.id}`, 'DELETE')).status, 400);
  const event = (await request('/incidents', 'POST', { alertId: created.id, location: 'Sala 1' })).body;
  assert.equal((await request('/incidents', 'POST', { alertId: created.id, location: 'Sala 1' })).status, 400);
  await request(`/procedures/${proc.id}`, 'PUT', { ...proc, steps: ['Zmieniony krok'] });
  assert.deepEqual((await request('/state')).body.incidents[0].procedure.steps, ['Krok pierwszy']);
  assert.equal((await request(`/incidents/${event.id}/resolve`, 'POST')).body.status, 'resolved');
  assert.equal((await request(`/incidents/${event.id}/resolve`, 'POST')).status, 400);
});

test('alerts launch without a location but still validate supplied values', async t => {
  const { client } = await fixture(t); const admin = client(); await login(admin);
  for (const location of [null, 42, 'x'.repeat(201), ' '.repeat(201)]) {
    assert.equal((await admin('/incidents', 'POST', { alertId: 'alert-2', location })).status, 400);
  }
  for (const fields of [{}, { location: '' }, { location: '   ' }, { location: ' Sala 12 ' }]) {
    const result = await admin('/incidents', 'POST', { alertId: 'alert-2', ...fields });
    assert.equal(result.status, 201);
    assert.equal(result.body.location, fields.location?.trim() || 'Nie podano miejsca');
    assert.ok(result.body.procedure.steps.length);
    await admin(`/incidents/${result.body.id}/resolve`, 'POST');
  }
});

test('user phone is optional, validated, editable and limited to its school', async t => {
  const { client } = await fixture(t); const admin = client(), other = client();
  await login(admin); await login(other, 'admin2@szkolnyalert.pl');
  const account = { name: 'Telefon Testowy', username: 'telefon.test', role: 'teacher', password: 'Haslo123456', phone: '+48 500 600 700' };
  assert.equal((await admin('/users', 'POST', { ...account, phone: 'abc' })).status, 400);
  assert.equal((await admin('/users', 'POST', { ...account, phone: '123' })).status, 400);
  const created = await admin('/users', 'POST', account);
  assert.equal(created.status, 201); assert.equal(created.body.phone, account.phone);
  const update = { name: account.name, username: account.username, role: account.role };
  const path = `/users/${created.body.id}`;
  assert.equal((await admin(path, 'PUT', update)).body.phone, account.phone, 'omitting the field preserves the number');
  assert.equal((await admin(path, 'PUT', { ...update, phone: '(22) 123-45-67' })).body.phone, '(22) 123-45-67');
  assert.equal((await other(path, 'PUT', { ...update, phone: '+48 500 600 702' })).status, 404);
  assert.equal((await other('/state')).body.users.some(x => x.id === created.body.id), false);
  assert.equal((await admin('/state')).body.users.find(x => x.id === created.body.id).phone, '(22) 123-45-67');
  assert.equal((await admin(path, 'PUT', { ...update, phone: '' })).body.phone, '', 'number can be removed');
});

test('teacher CSV import is admin-only, atomic, repeatable and isolated to the session school', async t => {
  const { client } = await fixture(t); const anonymous = client(), admin = client(), other = client(), teacher = client();
  const csv = 'imię i nazwisko;email;przedmiot;telefon;schoolId\nTest CSV;csv@example.com;Historia;+48 500 600 700;school-demo-2\nAnna;anna@example.com;Nowy opis;;school-demo-2';
  assert.equal((await anonymous('/teachers/import/preview', 'POST', { csv })).status, 401);
  await login(admin); await login(other, 'admin2@szkolnyalert.pl'); await login(teacher, 'nauczyciel@szkolnyalert.pl');
  assert.equal((await teacher('/teachers/import/preview', 'POST', { csv })).status, 403);
  assert.equal((await teacher('/teachers/import', 'POST', { csv })).status, 403);
  const before = (await admin('/state')).body.teachers;
  const preview = await admin('/teachers/import/preview', 'POST', { csv });
  assert.equal(preview.status, 200); assert.equal(preview.body.ready, 1); assert.equal(preview.body.skipped, 1);
  assert.deepEqual((await admin('/state')).body.teachers, before, 'preview never writes');
  const bad = 'name,email,subject\nInvalid,bad,Test\nValid,valid@example.com,Test';
  const rejected = await admin('/teachers/import', 'POST', { csv: bad });
  assert.equal(rejected.status, 422); assert.equal(rejected.body.preview.invalid, 1);
  assert.deepEqual((await admin('/state')).body.teachers, before, 'no partial import on validation failure');
  const result = await admin('/teachers/import', 'POST', { csv });
  assert.deepEqual(result.body, { imported: 1, skipped: 1, total: 2 });
  const own = (await admin('/state')).body.teachers;
  assert.equal(own.find(x => x.email === 'csv@example.com').schoolId, 'school-demo');
  assert.equal(own.find(x => x.email === 'csv@example.com').phone, '+48 500 600 700');
  assert.equal(own.find(x => x.email === 'anna@example.com').subject, before.find(x => x.email === 'anna@example.com').subject);
  assert.equal((await admin('/teachers/import', 'POST', { csv })).body.imported, 0, 'retry does not duplicate teachers');
  assert.equal((await other('/state')).body.teachers.some(x => x.email === 'csv@example.com'), false);
  assert.equal((await other('/teachers/import', 'POST', { csv })).body.imported, 2, 'same contact email may exist in a separate school');
});
