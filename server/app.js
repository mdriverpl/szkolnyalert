import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { id } from './store.js';
import { hashPassword, verifyPassword, publicUser, normalizeLogin, userLogins } from './auth.js';
import { addProcedureTemplates } from './procedure-templates.js';
import { addAlertTemplates } from './alert-templates.js';
import { previewTeacherCsv } from './teacher-csv.js';
import { createSmsGateway, smsSummary } from './smsapi.js';
import { createTeacherPanel } from './teacher-panel.js';
import { createTeacherLinkSms } from './teacher-link-sms.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const required = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`Uzupełnij poprawnie pole: ${label} (maks. ${max} znaków).`);
  return value.trim();
};
const emailAddress = value => {
  const email = required(value, 'e-mail').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Podaj poprawny adres e-mail.');
  return email;
};
const validatePassword = value => {
  if (typeof value !== 'string' || value.length < 11 || value.length > 128) throw fail('Hasło musi mieć od 11 do 128 znaków.');
  return value;
};
const loginName = value => {
  const login = normalizeLogin(required(value, 'nazwa użytkownika', 80));
  if (!/^[\p{L}\p{N}._@+\-]{3,80}$/u.test(login)) throw fail('Nazwa użytkownika: od 3 do 80 znaków, bez spacji.');
  return login;
};
const optionalText = (value, label) => value === undefined || value === '' ? '' : required(value, label);
const phoneNumber = value => {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw fail('Podaj numer telefonu jako tekst.');
  const phone = value.trim();
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (phone.length > 32 || !/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) throw fail('Podaj poprawny numer telefonu: 7–15 cyfr, opcjonalnie +, spacje, nawiasy i myślniki.');
  return phone;
};
const teacherData = body => ({ name: required(body.name, 'imię i nazwisko'), email: emailAddress(body.email), subject: required(body.subject, 'przedmiot / rola'), phone: phoneNumber(body.phone) });
function assertUniqueLogin(users, record) {
  const logins = userLogins(record);
  if (users.some(user => user.id !== record.id && userLogins(user).some(login => logins.includes(login)))) throw fail('Ta nazwa użytkownika lub adres e-mail jest już zajęty.', 409);
}
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Ta operacja wymaga uprawnień administratora szkoły.' });
function ownRecord(data, collection, recordId, schoolId) {
  const record = data[collection].find(x => x.id === recordId && (collection === 'schools' ? x.id : x.schoolId) === schoolId);
  if (!record) throw fail('Nie znaleziono rekordu.', 404);
  return record;
}

export function createApp(store, options = {}) {
  const app = express(), attempts = new Map();
  const sms = createSmsGateway(store, options.sms);
  const secure = process.env.NODE_ENV === 'production';
  const sessionCookie = { httpOnly: true, sameSite: 'strict', secure, maxAge: 8 * 60 * 60_000, path: '/' };
  const tokenHash = token => createHash('sha256').update(token).digest('hex');
  function readToken(req) {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
    return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
  }
  async function issueSession(req, res, user) {
    const now = Date.now();
    const old = readToken(req);
    const token = randomBytes(32).toString('hex');
    await store.mutate(data => {
      const current = data.users.find(x => x.id === user.id && x.schoolId === user.schoolId && (x.authVersion || 0) === (user.authVersion || 0) && x.passwordHash === user.passwordHash);
      if (!current || !data.schools.some(x => x.id === current.schoolId)) throw fail('Dane konta zostały zmienione. Zaloguj się ponownie.', 401);
      data.sessions = (data.sessions || []).filter(session => session.expires > now && (!old || session.tokenHash !== tokenHash(old)));
      data.sessions.push({ tokenHash: tokenHash(token), userId: current.id, schoolId: current.schoolId, authVersion: current.authVersion || 0, expires: now + sessionCookie.maxAge });
    });
    res.cookie('session', token, sessionCookie);
  }
  function rateLimit(req, kind, limit = 15) {
    const now = Date.now(), key = `${kind}:${req.ip}`;
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const value = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    if (value.count >= limit) throw fail('Zbyt wiele prób. Spróbuj ponownie za 15 minut.', 429);
    value.count++; attempts.set(key, value);
  }
  app.disable('x-powered-by');
  // The API listens on loopback; HTTPS reverse proxies must preserve Host.
  app.set('trust proxy', 'loopback');
  app.use('/api/teachers/import', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Niedozwolone źródło żądania.' });
    next();
  });
  app.get('/api/health', (_, res) => res.json({ ok: true, demo: store.demo, loginRequired: true }));
  app.post('/api/register-school', async (req, res) => {
    rateLimit(req, 'register');
    const body = req.body;
    const school = { id: id(), name: required(body.name, 'nazwa szkoły'), city: optionalText(body.city, 'miejscowość'), address: optionalText(body.address, 'adres') };
    const username = loginName(body.username || body.email);
    const user = { id: id(), schoolId: school.id, name: body.adminName ? required(body.adminName, 'imię i nazwisko') : username, username, email: body.email ? emailAddress(body.email) : '', role: 'admin', passwordHash: await hashPassword(validatePassword(body.password)), authVersion: 0 };
    await store.mutate(data => {
      assertUniqueLogin(data.users, user);
      data.schools.push(school); data.users.push(user);
      addProcedureTemplates(data, school.id);
      addAlertTemplates(data, school.id);
    });
    await issueSession(req, res, user);
    res.status(201).json({ school, user: publicUser(user) });
  });
  app.post('/api/login', async (req, res) => {
    rateLimit(req, 'login');
    const data = await store.read();
    const login = normalizeLogin(req.body.login || req.body.email);
    const user = data.users.find(x => userLogins(x).includes(login));
    const valid = typeof req.body.password === 'string' && req.body.password.length <= 128 && await verifyPassword(req.body.password, user?.passwordHash || '00000000000000000000000000000000:' + '00'.repeat(64));
    if (!user || !valid || !data.schools.some(x => x.id === user.schoolId)) throw fail('Niepoprawna nazwa użytkownika lub hasło.', 401);
    await issueSession(req, res, user); res.json({ user: publicUser(user), demo: store.demo });
  });
  const teacherPanel = createTeacherPanel(store, { secure, rateLimit, launchIncident, vault: sms });
  app.use('/api/teacher-panel', teacherPanel.router);
  app.use('/api', async (req, res, next) => {
    const token = readToken(req);
    const reject = () => res.status(401).json({ error: 'Zaloguj się do swojej szkoły, aby kontynuować.' });
    if (!token) return reject();
    const data = await store.read();
    const hash = tokenHash(token);
    const session = data.sessions?.find(x => x.tokenHash === hash);
    if (!session || session.expires <= Date.now()) return reject();
    const user = data.users.find(x => x.id === session.userId && x.schoolId === session.schoolId && (x.authVersion || 0) === session.authVersion);
    if (!user || !data.schools.some(x => x.id === user.schoolId)) return reject();
    req.sessionHash = hash; req.user = publicUser(user); req.schoolId = user.schoolId; next();
  });
  app.post('/api/logout', async (req, res) => {
    await store.mutate(data => { data.sessions = (data.sessions || []).filter(x => x.tokenHash !== req.sessionHash); });
    res.clearCookie('session', { path: '/' }); res.json({ ok: true });
  });
  app.get('/api/state', async (req, res) => {
    const data = await store.read();
    const result = { schools: data.schools.filter(x => x.id === req.schoolId) };
    for (const type of ['teachers', 'procedures', 'alerts', 'incidents']) result[type] = data[type].filter(x => x.schoolId === req.schoolId);
    if (req.user.role === 'admin') result.teachers = result.teachers.map(teacher => ({ ...teacher, hasPanelKey: !!data.teacherKeys?.some(x => x.teacherId === teacher.id && x.schoolId === req.schoolId) }));
    result.users = req.user.role === 'admin' ? data.users.filter(x => x.schoolId === req.schoolId).map(publicUser) : [];
    const gateway = smsSummary(data.smsSettings?.find(x => x.schoolId === req.schoolId));
    res.json({ ...result, user: req.user, demo: store.demo, loginRequired: true, smsGateway: { enabled: gateway.enabled && gateway.hasToken, testMode: gateway.testMode } });
  });
  app.get('/api/settings/sms', adminOnly, async (req, res) => res.json(await sms.getSettings(req.schoolId)));
  app.put('/api/settings/sms', adminOnly, async (req, res) => res.json(await sms.saveSettings(req.schoolId, req.body)));
  app.delete('/api/settings/sms', adminOnly, async (req, res) => res.json(await sms.removeToken(req.schoolId)));
  app.post('/api/settings/sms/test', adminOnly, async (req, res) => { rateLimit(req, 'sms-test'); res.json(await sms.test(req.schoolId, req.body.phone)); });
  app.post('/api/schools', adminOnly, (_, res) => res.status(403).json({ error: 'Konto jest przypisane do jednej szkoły. Nową szkołę dodaj na ekranie startowym z osobnym kontem administratora.' }));
  const teacherLinkSms = createTeacherLinkSms(store, sms);
  app.post('/api/teachers/link-sms/preview', adminOnly, async (req, res) => res.json(await teacherLinkSms.preview(req.schoolId, req.user.id, `${req.protocol}://${req.get('host')}`)));
  app.post('/api/teachers/link-sms/send', adminOnly, async (req, res) => res.json(await teacherLinkSms.send(req.schoolId, req.user.id, `${req.protocol}://${req.get('host')}`, req.body)));
  app.post('/api/teachers/:id/panel-key', adminOnly, teacherPanel.generate);
  app.get('/api/teachers/:id/panel-key', adminOnly, teacherPanel.retrieve);
  app.delete('/api/teachers/:id/panel-key', adminOnly, teacherPanel.revoke);

  app.get('/api/teachers/import/template', adminOnly, (_, res) => {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nauczyciele-wzor.csv"' });
    res.send('\uFEFFimię i nazwisko;email;przedmiot;telefon\r\nAnna Kowalska;anna@example.com;Matematyka;+48 500 600 700\r\nJan Nowak;jan@example.com;Historia;\r\n');
  });
  app.post('/api/teachers/import/preview', adminOnly, async (req, res) => {
    const data = await store.read();
    res.json(previewTeacherCsv(req.body.csv, data.teachers.filter(x => x.schoolId === req.schoolId), teacherData));
  });
  app.post('/api/teachers/import', adminOnly, async (req, res) => {
    const initial = await store.read();
    const initialPreview = previewTeacherCsv(req.body.csv, initial.teachers.filter(x => x.schoolId === req.schoolId), teacherData);
    if (initialPreview.invalid) throw Object.assign(fail('Popraw błędne wiersze. Nie zapisano żadnych nauczycieli.', 422), { preview: initialPreview });
    const accesses = new Map();
    for (const row of initialPreview.rows) if (row.status === 'ready') accesses.set(row.teacher.email, await teacherPanel.prepareKey(req.schoolId));
    const result = await store.mutate(data => {
      const preview = previewTeacherCsv(req.body.csv, data.teachers.filter(x => x.schoolId === req.schoolId), teacherData);
      if (preview.invalid) throw Object.assign(fail('Popraw błędne wiersze i ponownie wybierz plik. Nie zapisano żadnych nauczycieli.', 422), { preview });
      for (const row of preview.rows) if (row.status === 'ready') {
        const access = accesses.get(row.teacher.email);
        if (!access) throw fail('Lista nauczycieli zmieniła się. Ponów import.', 409);
        const teacher = { ...row.teacher, id: id(), schoolId: req.schoolId };
        data.teachers.push(teacher); teacherPanel.attachKey(data, teacher, access);
      }
      return { imported: preview.ready, skipped: preview.skipped, total: preview.total };
    });
    res.json(result);
  });

  for (const collection of ['schools', 'teachers', 'procedures', 'alerts', 'users']) {
    const save = async (req, res) => {
      const body = req.body;
      let passwordHash;
      if (collection === 'users' && (!req.params.id || body.password)) passwordHash = await hashPassword(validatePassword(body.password));
      const access = collection === 'teachers' && !req.params.id ? await teacherPanel.prepareKey(req.schoolId) : null;
      const result = await store.mutate(data => {
        const existing = req.params.id ? ownRecord(data, collection, req.params.id, req.schoolId) : null;
        if (body.schoolId !== undefined && body.schoolId !== req.schoolId) throw fail('Nie możesz przypisać danych do innej szkoły.', 403);
        const record = { id: existing?.id || id(), name: required(body.name, 'nazwa') };
        if (collection === 'schools') { record.city = optionalText(body.city, 'miejscowość'); record.address = optionalText(body.address, 'adres'); }
        else {
          record.schoolId = req.schoolId;
          if (collection === 'users') {
            record.username = loginName(body.username || existing?.username || body.email || existing?.email);
            record.email = body.email ? emailAddress(body.email) : '';
            record.phone = phoneNumber(body.phone ?? existing?.phone);
            if (!['admin', 'teacher'].includes(body.role)) throw fail('Niepoprawna rola.');
            assertUniqueLogin(data.users, record);
            if (existing?.role === 'admin' && body.role !== 'admin' && !data.users.some(x => x.schoolId === req.schoolId && x.id !== existing.id && x.role === 'admin')) throw fail('W szkole musi pozostać co najmniej jeden administrator.');
            record.role = body.role; record.passwordHash = passwordHash || existing.passwordHash;
            record.authVersion = (existing?.authVersion || 0) + (existing && (passwordHash || existing.role !== record.role || existing.email !== record.email || normalizeLogin(existing.username || existing.email) !== record.username) ? 1 : 0);
          } else if (collection === 'teachers') {
            Object.assign(record, teacherData({ ...body, phone: body.phone ?? existing?.phone }));
            if (data.teachers.some(x => x.id !== record.id && x.schoolId === req.schoolId && x.email === record.email)) throw fail('Nauczyciel z tym adresem już istnieje w szkole.');
          } else {
            record.description = required(body.description, 'opis', 2000);
            if (collection === 'procedures') {
              record.category = required(body.category, 'kategoria');
              if (!Array.isArray(body.steps) || !body.steps.length || body.steps.length > 30) throw fail('Dodaj od 1 do 30 kroków procedury.');
              record.steps = body.steps.map(step => required(step, 'krok procedury', 1000));
            } else {
              if (!['critical', 'warning', 'info'].includes(body.severity)) throw fail('Niepoprawny priorytet.');
              record.severity = body.severity; record.procedureId = required(body.procedureId, 'procedura');
              ownRecord(data, 'procedures', record.procedureId, req.schoolId);
            }
          }
        }
        if (existing) data[collection][data[collection].indexOf(existing)] = record; else data[collection].push(record);
        if (access) teacherPanel.attachKey(data, record, access);
        return collection === 'users' ? publicUser(record) : record;
      }); res.status(req.params.id ? 200 : 201).json(result);
    };
    if (collection !== 'schools') app.post(`/api/${collection}`, adminOnly, save);
    app.put(`/api/${collection}/:id`, adminOnly, save);
    app.delete(`/api/${collection}/:id`, adminOnly, async (req, res) => {
      await store.mutate(data => {
        const record = ownRecord(data, collection, req.params.id, req.schoolId);
        if (collection === 'schools') throw fail('Nie można usunąć szkoły posiadającej konta użytkowników.');
        if (collection === 'procedures' && data.alerts.some(x => x.schoolId === req.schoolId && x.procedureId === record.id)) throw fail('Procedura jest używana przez alert.');
        if (collection === 'users' && record.role === 'admin' && !data.users.some(x => x.schoolId === req.schoolId && x.id !== record.id && x.role === 'admin')) throw fail('Nie można usunąć ostatniego administratora szkoły.');
        data[collection] = data[collection].filter(x => x.id !== record.id);
        if (collection === 'teachers') {
          data.teacherKeys = (data.teacherKeys || []).filter(x => x.teacherId !== record.id);
          data.teacherSessions = (data.teacherSessions || []).filter(x => x.teacherId !== record.id);
        }
      }); res.json({ ok: true });
    });
  }
  async function launchIncident(schoolId, actor, body, waitForSms = true) {
    const result = await store.mutate(data => {
      const alert = ownRecord(data, 'alerts', body.alertId, schoolId);
      if (data.incidents.some(x => x.schoolId === schoolId && x.alertId === alert.id && x.status === 'active')) throw fail('Ten alert jest już aktywny.');
      const procedure = ownRecord(data, 'procedures', alert.procedureId, schoolId);
      const incident = { id: id(), alertId: alert.id, schoolId, name: alert.name, severity: alert.severity, location: required(body.location, 'miejsce zdarzenia'), procedure: structuredClone(procedure), status: 'active', createdAt: new Date().toISOString(), createdBy: actor.username, ...(actor.teacherId ? { createdByTeacherId: actor.teacherId } : {}) };
      const gateway = data.smsSettings?.find(x => x.schoolId === schoolId);
      incident.sms = { status: gateway?.enabled && gateway.encryptedToken ? 'pending' : 'disabled' };
      data.incidents.unshift(incident); return incident;
    });
    const notification = sms.notifyIncident(schoolId, result.id);
    if (waitForSms) await notification;
    else notification.catch(() => console.error('Nie udało się zapisać wyniku wysyłki SMS. Sprawdź historię zdarzenia.'));
    return (await store.read()).incidents.find(x => x.id === result.id && x.schoolId === schoolId);
  }
  app.post('/api/incidents', async (req, res) => {
    res.status(201).json(await launchIncident(req.schoolId, req.user, req.body));
  });
  app.post('/api/incidents/:id/resolve', adminOnly, async (req, res) => {
    const result = await store.mutate(data => {
      const incident = ownRecord(data, 'incidents', req.params.id, req.schoolId);
      if (incident.status !== 'active') throw fail('Zdarzenie zostało już zakończone.');
      incident.status = 'resolved'; incident.resolvedAt = new Date().toISOString(); incident.resolvedBy = req.user.username; return incident;
    }); res.json(result);
  });
  app.use('/api', (_, res) => res.status(404).json({ error: 'Nie znaleziono endpointu.' }));
  app.use(express.static('dist'));
  app.get('/{*path}', (_, res) => res.sendFile('index.html', { root: 'dist' }));
  app.use((err, req, res, next) => { if (!err.status) console.error(err); res.status(err.status || 500).json({ error: err.status === 413 ? 'Plik lub żądanie jest zbyt duże.' : err.status ? err.message : 'Błąd serwera. Spróbuj ponownie.', ...(err.preview ? { preview: err.preview } : {}) }); });
  return app;
}
