import { createHash } from 'node:crypto';
import webpush from 'web-push';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { throw fail('Niepoprawna subskrypcja powiadomień.'); }
  const host = url.hostname;
  const allowed = ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com'].includes(host) || host.endsWith('.push.services.mozilla.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 4096) throw fail('Nieobsługiwany adres usługi push.');
  const keys = value?.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth || '') || Buffer.from(keys.p256dh, 'base64url')[0] !== 4) throw fail('Niepoprawne klucze powiadomień.');
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function createPushGateway(store, { publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT || 'mailto:biuro@mdriver.pl', sendImpl = (...args) => webpush.sendNotification(...args) } = {}) {
  const configured = !!publicKey && !!privateKey;
  const valid = (data, row) => data.teachers.some(x => x.id === row.teacherId && x.schoolId === row.schoolId) && data.teacherKeys?.some(x => x.teacherId === row.teacherId && x.schoolId === row.schoolId && x.keyHash === row.keyHash);
  const config = () => ({ enabled: configured, publicKey: configured ? publicKey : null });
  async function subscribe(teacher, keyHash, value) {
    if (!configured) throw fail('Powiadomienia push nie są skonfigurowane na serwerze.', 503);
    const subscription = validateSubscription(value);
    await store.mutate(data => {
      const row = { schoolId: teacher.schoolId, teacherId: teacher.id, keyHash, subscription, publicKey };
      if (!valid(data, row)) throw fail('Dostęp nauczyciela został unieważniony.', 401);
      data.pushSubscriptions = (data.pushSubscriptions || []).filter(x => x.subscription.endpoint !== subscription.endpoint && valid(data, x));
      if (data.pushSubscriptions.filter(x => x.teacherId === teacher.id).length >= 10) throw fail('Osiągnięto limit 10 urządzeń nauczyciela.');
      data.pushSubscriptions.push(row);
    });
    return { ok: true };
  }
  async function unsubscribe(teacher, endpoint) {
    await store.mutate(data => { data.pushSubscriptions = (data.pushSubscriptions || []).filter(x => !(x.teacherId === teacher.id && x.schoolId === teacher.schoolId && x.subscription.endpoint === endpoint)); });
    return { ok: true };
  }
  async function deliver(row, payload) {
    try {
      await sendImpl(row.subscription, JSON.stringify(payload), { vapidDetails: { subject, publicKey, privateKey }, TTL: 120, urgency: 'high', timeout: 10000, topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32) });
      return 'accepted';
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await store.mutate(data => { data.pushSubscriptions = (data.pushSubscriptions || []).filter(x => x.subscription.endpoint !== row.subscription.endpoint); });
      return 'failed';
    }
  }
  async function test(teacher, keyHash, endpoint) {
    if (!configured) throw fail('Powiadomienia push nie są skonfigurowane.', 503);
    const data = await store.read();
    const row = data.pushSubscriptions?.find(x => x.teacherId === teacher.id && x.schoolId === teacher.schoolId && x.keyHash === keyHash && x.publicKey === publicKey && x.subscription.endpoint === endpoint && valid(data, x));
    if (!row) throw fail('Włącz najpierw powiadomienia na tym urządzeniu.', 404);
    const status = await deliver(row, { title: 'Szkolny Alert — test powiadomień', body: 'Powiadomienia są włączone. Otwórz aplikację, aby zobaczyć panel.', tag: 'szkolnyalert-test' });
    return { status, message: status === 'accepted' ? 'Usługa push przyjęła test. Sprawdź powiadomienia telefonu.' : 'Nie udało się wysłać testu. Włącz powiadomienia ponownie.' };
  }
  async function notifyIncident(schoolId, incidentId) {
    const job = await store.mutate(data => {
      const incident = data.incidents.find(x => x.id === incidentId && x.schoolId === schoolId);
      if (!incident || incident.push?.status) return null;
      const rows = (data.pushSubscriptions || []).filter(x => x.schoolId === schoolId && x.publicKey === publicKey && valid(data, x));
      incident.push = { status: !configured ? 'disabled' : !rows.length ? 'no_recipients' : 'sending', total: rows.length };
      if (!configured || !rows.length) return null;
      // Approved scope: no school names, teacher names, locations or procedures.
      return { rows, payload: { title: incident.isTest ? 'TEST — Szkolny Alert' : 'Szkolny Alert', body: 'Nowy alert w szkole — otwórz aplikację.', tag: createHash('sha256').update(incident.id).digest('hex').slice(0, 32) } };
    });
    if (!job) return;
    let cursor = 0, accepted = 0;
    await Promise.all(Array.from({ length: Math.min(5, job.rows.length) }, async () => {
      while (cursor < job.rows.length) { if (await deliver(job.rows[cursor++], job.payload) === 'accepted') accepted++; }
    }));
    await store.mutate(data => {
      const incident = data.incidents.find(x => x.id === incidentId && x.schoolId === schoolId);
      if (incident) incident.push = { status: accepted === job.rows.length ? 'accepted' : accepted ? 'partial' : 'failed', total: job.rows.length, accepted, failed: job.rows.length - accepted };
    });
  }
  return { config, subscribe, unsubscribe, test, notifyIncident };
}
