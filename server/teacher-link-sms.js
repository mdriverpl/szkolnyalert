import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { smsPhone } from './smsapi.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function snapshot(data, schoolId, origin) {
  const settings = data.smsSettings?.find(x => x.schoolId === schoolId);
  const teachers = data.teachers.filter(x => x.schoolId === schoolId);
  const phones = teachers.map(x => smsPhone(x.phone));
  const recipients = [], skipped = [];
  teachers.forEach((teacher, index) => {
    const phone = phones[index];
    const entry = { id: teacher.id, name: teacher.name, phone: phone || teacher.phone || '' };
    if (!phone) skipped.push({ ...entry, reason: 'Brak poprawnego numeru telefonu' });
    else if (phones.filter(x => x === phone).length > 1) skipped.push({ ...entry, reason: 'Numer przypisany do kilku nauczycieli — popraw dane' });
    else recipients.push(entry);
  });
  let baseUrl = '', publicUrl = false;
  try {
    const url = new URL(process.env.PUBLIC_APP_URL || origin);
    if (!url.username && !url.password && !url.search && !url.hash && url.pathname === '/') {
      baseUrl = url.origin;
      publicUrl = url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    }
  } catch { /* Configuration is reported in the preview. */ }
  const testMode = settings?.testMode !== false;
  const issues = [];
  if (!settings?.encryptedToken) issues.push('Najpierw zapisz token SMSAPI w Ustawieniach.');
  if (!recipients.length) issues.push('Brak nauczycieli z poprawnym, unikalnym numerem telefonu.');
  if (recipients.length > 500) issues.push('Jedna wysyłka może obejmować maksymalnie 500 osób.');
  if (!baseUrl || (!testMode && !publicUrl)) issues.push('Ustaw PUBLIC_APP_URL na publiczny adres HTTPS aplikacji przed rzeczywistą wysyłką.');
  const fingerprint = hash(JSON.stringify({ recipients, skipped, baseUrl, settings }));
  return { recipients, skipped, count: recipients.length, baseUrl, testMode, issues, canSend: !issues.length, fingerprint, settings };
}
const publicPreview = ({ settings, fingerprint, ...value }) => value;

export function createTeacherLinkSms(store, sms) {
  async function preview(schoolId, userId, origin) {
    return store.mutate(data => {
      const current = snapshot(data, schoolId, origin);
      const batchId = randomUUID(), expires = Date.now() + 10 * 60_000;
      data.teacherLinkBatches = (data.teacherLinkBatches || []).filter(x => x.status !== 'preview' || x.expires > Date.now());
      data.teacherLinkBatches.push({ batchId, schoolId, userId, expires, fingerprint: current.fingerprint, status: 'preview' });
      return { ...publicPreview(current), batchId };
    });
  }
  async function send(schoolId, userId, origin, body) {
    const job = await store.mutate(data => {
      const batch = data.teacherLinkBatches?.find(x => x.batchId === body.batchId && x.schoolId === schoolId && x.userId === userId);
      if (!batch) throw fail('Otwórz ponownie potwierdzenie wysyłki.', 404);
      if (body.confirmed !== true) throw fail('Potwierdź wysyłkę SMS.');
      if (batch.status !== 'preview') return { existing: batch.result || { status: 'sending', message: 'Wysyłka została już rozpoczęta. Sprawdź SMSAPI; nie ponawiaj jej automatycznie.' } };
      const current = snapshot(data, schoolId, origin);
      if (batch.expires < Date.now() || batch.fingerprint !== current.fingerprint || body.expectedCount !== current.count) throw fail('Lista odbiorców lub ustawienia zmieniły się. Zamknij okno i sprawdź nowe potwierdzenie.', 409);
      if (!current.canSend) throw fail(current.issues.join(' '));
      batch.status = 'sending';
      const messages = current.recipients.map(person => {
        const key = randomBytes(32).toString('hex');
        const keyHash = hash(key);
        if (!current.testMode) {
          data.teacherKeys ??= [];
          data.teacherKeys.push({ teacherId: person.id, schoolId, keyHash, createdAt: new Date().toISOString(), batchId: batch.batchId });
        }
        return { ...person, keyHash, link: `${current.baseUrl}/nauczyciel#klucz=${key}` };
      });
      return { messages, settings: current.settings, testMode: current.testMode, batchId: batch.batchId, skipped: current.skipped.length };
    });
    if (job.existing) return job.existing;
    const results = [];
    // Bounded concurrency; each phone gets only its own personal link.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(5, job.messages.length) }, async () => {
      while (cursor < job.messages.length) {
        const message = job.messages[cursor++];
        let result;
        try { result = await sms.sendLink(job.settings, schoolId, message.phone, message.link); }
        catch { result = { status: 'failed', accepted: 0 }; }
        results.push({ keyHash: message.keyHash, status: result.status, accepted: result.accepted || 0 });
      }
    }));
    const accepted = results.reduce((sum, x) => sum + x.accepted, 0);
    const unknown = results.filter(x => x.status === 'unknown').length;
    const result = {
      status: unknown ? 'unknown' : accepted === results.length ? (job.testMode ? 'test' : 'accepted') : accepted ? 'partial' : 'failed',
      total: results.length, accepted, unknown, failed: results.length - accepted - unknown, skipped: job.skipped, testMode: job.testMode,
      message: unknown ? 'Część wyników jest nieznana. Sprawdź SMSAPI przed kolejną wysyłką.' : job.testMode ? 'Próba API zakończona. SMS-y nie zostały dostarczone; linki testowe nie dają dostępu.' : 'Wysyłka zakończona. Liczba przyjętych przez SMSAPI nie oznacza potwierdzenia doręczenia.'
    };
    await store.mutate(data => {
      const batch = data.teacherLinkBatches.find(x => x.batchId === job.batchId && x.schoolId === schoolId);
      batch.status = 'complete'; batch.result = result;
      const failed = new Set(results.filter(x => x.status === 'failed').map(x => x.keyHash));
      data.teacherKeys = (data.teacherKeys || []).filter(x => x.batchId !== job.batchId || !failed.has(x.keyHash));
    });
    return result;
  }
  return { preview, send };
}
