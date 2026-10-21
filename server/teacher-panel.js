import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const readCookie = req => req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('teacher_session='))?.slice(16);
const ownTeacher = (data, teacherId, schoolId) => {
  const teacher = data.teachers.find(x => x.id === teacherId && x.schoolId === schoolId);
  if (!teacher) throw fail('Nie znaleziono nauczyciela.', 404);
  return teacher;
};

export function teacherDeliveryStatus(data, teacher, pushConfig, now = Date.now()) {
  const keys = new Set((data.teacherKeys || []).filter(x => x.teacherId === teacher.id && x.schoolId === teacher.schoolId).map(x => x.keyHash));
  const matches = x => x.teacherId === teacher.id && x.schoolId === teacher.schoolId && keys.has(x.keyHash);
  return {
    notificationsEnabled: !!pushConfig.enabled && (data.pushSubscriptions || []).some(x => matches(x) && x.publicKey === pushConfig.publicKey),
    online: (data.teacherSessions || []).some(x => matches(x) && x.expires > now && x.lastSeen > now - 45_000 && x.lastSeen <= now)
  };
}

export function createTeacherPanel(store, { secure, rateLimit, launchIncident, vault, push }) {
  async function prepareKey(schoolId) {
    const key = randomBytes(32).toString('hex');
    return { keyHash: hash(key), encryptedKey: await vault.sealAccessKey(key, `teacher-panel:${schoolId}`), createdAt: new Date().toISOString() };
  }
  function attachKey(data, teacher, access) {
    data.teacherKeys ??= [];
    data.teacherKeys.push({ ...access, teacherId: teacher.id, schoolId: teacher.schoolId });
  }
  async function retrieve(req, res) {
    const data = await store.read();
    ownTeacher(data, req.params.id, req.schoolId);
    const access = data.teacherKeys?.find(x => x.teacherId === req.params.id && x.schoolId === req.schoolId && x.encryptedKey);
    if (!access) return res.json({ key: null, path: null });
    const key = await vault.openAccessKey(access.encryptedKey, `teacher-panel:${req.schoolId}`);
    res.json({ key, path: `/nauczyciel#klucz=${key}` });
  }
  const router = Router();
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/api/teacher-panel', maxAge: 30 * 86400_000 };
  router.post('/access', async (req, res) => {
    rateLimit(req, 'teacher-access', 300);
    if (typeof req.body.key !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.key)) throw fail('Nieprawidłowy klucz. Otwórz osobisty link otrzymany od szkoły.', 401);
    const keyHash = hash(req.body.key), token = randomBytes(32).toString('hex');
    const oldToken = readCookie(req);
    await store.mutate(data => {
      const access = data.teacherKeys?.find(x => x.keyHash === keyHash);
      if (!access || !data.teachers.some(x => x.id === access.teacherId && x.schoolId === access.schoolId) || !data.schools.some(x => x.id === access.schoolId)) throw fail('Link jest nieprawidłowy lub został unieważniony. Poproś szkołę o nowy link.', 401);
      data.teacherSessions = (data.teacherSessions || []).filter(x => x.expires > Date.now() && (!oldToken || x.tokenHash !== hash(oldToken)));
      data.teacherSessions.push({ tokenHash: hash(token), keyHash, teacherId: access.teacherId, schoolId: access.schoolId, expires: Date.now() + cookieOptions.maxAge });
    });
    res.cookie('teacher_session', token, cookieOptions); res.json({ ok: true });
  });
  router.use(async (req, res, next) => {
    const token = readCookie(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw fail('Otwórz osobisty link otrzymany od szkoły.', 401);
    const data = await store.read();
    const session = data.teacherSessions?.find(x => x.tokenHash === hash(token) && x.expires > Date.now());
    const access = session && data.teacherKeys?.find(x => x.keyHash === session.keyHash && x.teacherId === session.teacherId && x.schoolId === session.schoolId);
    if (!access || !data.schools.some(x => x.id === session.schoolId)) throw fail('Dostęp wygasł lub został unieważniony. Otwórz aktualny link od szkoły.', 401);
    const teacher = data.teachers.find(x => x.id === session.teacherId && x.schoolId === session.schoolId);
    if (!teacher) throw fail('Dostęp nauczyciela został unieważniony.', 401);
    req.panelTeacher = teacher; req.panelSchoolId = session.schoolId; req.panelTokenHash = session.tokenHash; req.panelKeyHash = session.keyHash; next();
  });
  router.post('/presence', async (req, res) => {
    if (req.body?.active !== false) throw fail('Nieprawidłowy status aktywności.');
    await store.mutate(data => {
      const session = data.teacherSessions?.find(x => x.tokenHash === req.panelTokenHash);
      if (session) session.lastSeen = 0;
    });
    res.json({ ok: true });
  });
  router.get('/state', async (req, res) => {
    const now = Date.now();
    const current = (await store.read()).teacherSessions?.find(x => x.tokenHash === req.panelTokenHash);
    if (!current?.lastSeen || current.lastSeen < now - 15_000) await store.mutate(data => {
      const session = data.teacherSessions?.find(x => x.tokenHash === req.panelTokenHash);
      if (session) session.lastSeen = now;
    });
    const data = await store.read(), schoolId = req.panelSchoolId;
    const teacher = ownTeacher(data, req.panelTeacher.id, schoolId);
    const school = data.schools.find(x => x.id === schoolId);
    const alerts = data.alerts.filter(x => x.schoolId === schoolId).map(alert => ({ ...alert, procedure: data.procedures.find(p => p.id === alert.procedureId && p.schoolId === schoolId) })).filter(x => x.procedure);
    const gateway = data.smsSettings?.find(x => x.schoolId === schoolId);
    res.json({ teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject }, school: { id: school.id, name: school.name }, alerts, incidents: data.incidents.filter(x => x.schoolId === schoolId && x.status === 'active'), smsGateway: { enabled: !!gateway?.enabled && !!gateway.encryptedToken, testMode: gateway?.testMode !== false }, checkedAt: new Date().toISOString() });
  });
  router.post('/incidents', async (req, res) => {
    const incident = await launchIncident(req.panelSchoolId, { username: req.panelTeacher.name, teacherId: req.panelTeacher.id }, req.body, false);
    res.status(201).json(incident);
  });
  router.get('/push', (req, res) => res.json(push.config()));
  router.post('/push', async (req, res) => {
    rateLimit(req, 'push-subscribe', 120);
    res.json(await push.subscribe(req.panelTeacher, req.panelKeyHash, req.body));
  });
  router.delete('/push', async (req, res) => res.json(await push.unsubscribe(req.panelTeacher, req.body.endpoint)));
  router.post('/push/test', async (req, res) => {
    rateLimit(req, 'push-test');
    res.json(await push.test(req.panelTeacher, req.panelKeyHash, req.body.endpoint));
  });
  router.post('/logout', async (req, res) => {
    if (req.body?.endpoint) await push.unsubscribe(req.panelTeacher, req.body.endpoint);
    await store.mutate(data => { data.teacherSessions = (data.teacherSessions || []).filter(x => x.tokenHash !== req.panelTokenHash); });
    res.clearCookie('teacher_session', { path: cookieOptions.path }); res.json({ ok: true });
  });
  router.use((req, res) => res.status(404).json({ error: 'Nie znaleziono funkcji panelu nauczyciela.' }));

  async function generate(req, res) {
    const access = await prepareKey(req.schoolId);
    const key = await vault.openAccessKey(access.encryptedKey, `teacher-panel:${req.schoolId}`);
    await store.mutate(data => {
      ownTeacher(data, req.params.id, req.schoolId);
      data.teacherKeys = (data.teacherKeys || []).filter(x => x.teacherId !== req.params.id);
      attachKey(data, { id: req.params.id, schoolId: req.schoolId }, access);
      data.teacherSessions = (data.teacherSessions || []).filter(x => x.teacherId !== req.params.id);
      data.pushSubscriptions = (data.pushSubscriptions || []).filter(x => x.teacherId !== req.params.id);
    });
    res.json({ key, path: `/nauczyciel#klucz=${key}` });
  }
  async function revoke(req, res) {
    await store.mutate(data => {
      ownTeacher(data, req.params.id, req.schoolId);
      data.teacherKeys = (data.teacherKeys || []).filter(x => x.teacherId !== req.params.id);
      data.teacherSessions = (data.teacherSessions || []).filter(x => x.teacherId !== req.params.id);
      data.pushSubscriptions = (data.pushSubscriptions || []).filter(x => x.teacherId !== req.params.id);
    });
    res.json({ ok: true });
  }
  return { router, generate, revoke, prepareKey, attachKey, retrieve };
}
