import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { smsPhone } from './smsapi.js';
import { SMS_MAX_LENGTH } from './sms-text.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function snapshot(data, schoolId, origin, teacherId = null) {
  const settings = data.smsSettings?.find(x => x.schoolId === schoolId);
  const teachers = data.teachers.filter(x => x.schoolId === schoolId);
  if (teacherId !== null && (typeof teacherId !== 'string' || !teachers.some(x => x.id === teacherId))) throw fail('Nie znaleziono nauczyciela.', 404);
  const phones = teachers.map(x => smsPhone(x.phone));
  const recipients = [], skipped = [];
  teachers.forEach((teacher, index) => {
    if (teacherId !== null && teacher.id !== teacherId) return;
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
  if (!settings?.encryptedToken) issues.push('Najpierw zapisz klucz API SMS w Ustawieniach.');
  if (!recipients.length) issues.push('Brak nauczycieli z poprawnym, unikalnym numerem telefonu.');
  if (recipients.length > 500) issues.push('Jedna wysyłka może obejmować maksymalnie 500 osób.');
  if (!baseUrl || (!testMode && !publicUrl)) issues.push('Ustaw PUBLIC_APP_URL na publiczny adres HTTPS aplikacji przed rzeczywistą wysyłką.');
  if (baseUrl && (baseUrl + '/n#' + 'x'.repeat(43)).length > SMS_MAX_LENGTH) issues.push('Adres aplikacji jest za długi na SMS do 70 znaków. Ustaw krótszy PUBLIC_APP_URL.');
  const fingerprint = hash(JSON.stringify({ teacherId, recipients, skipped, baseUrl, settings }));
  return { teacherId, recipients, skipped, count: recipients.length, baseUrl, testMode, issues, canSend: !issues.length, fingerprint, settings };
}
const publicPreview = ({ settings, fingerprint, ...value }) => value;

export function createTeacherLinkSms(store, sms) {
  async function preview(schoolId, userId, origin, teacherId = null) {
    return store.mutate(data => {
      const current = snapshot(data, schoolId, origin, teacherId);
      const batchId = randomUUID(), expires = Date.now() + 10 * 60_000;
      data.teacherLinkBatches = (data.teacherLinkBatches || []).filter(x => x.status !== 'preview' || x.expires > Date.now());
      data.teacherLinkBatches.push({ batchId, schoolId, userId, teacherId, expires, fingerprint: current.fingerprint, status: 'preview' });
      return { ...publicPreview(current), batchId };
    });
  }
  async function send(schoolId, userId, origin, body) {
    const job = await store.mutate(data => {
      const batch = data.teacherLinkBatches?.find(x => x.batchId === body.batchId && x.schoolId === schoolId && x.userId === userId);
      if (!batch) throw fail('Otwórz ponownie potwierdzenie wysyłki.', 404);
      if (body.confirmed !== true) throw fail('Potwierdź wysyłkę SMS.');
      if (batch.status !== 'preview') return { existing: batch.result || { status: 'sending', message: 'Wysyłka została już rozpoczęta. Sprawdź panel operatora; nie ponawiaj jej automatycznie.' } };
      const current = snapshot(data, schoolId, origin, batch.teacherId ?? null);
      if (batch.expires < Date.now() || batch.fingerprint !== current.fingerprint || body.expectedCount !== current.count) throw fail('Lista odbiorców lub ustawienia zmieniły się. Zamknij okno i sprawdź nowe potwierdzenie.', 409);
      if (!current.canSend) throw fail(current.issues.join(' '));
      batch.status = 'sending';
      const messages = current.recipients.map(person => {
        const key = randomBytes(32).toString('base64url');
        const keyHash = hash(key);
        if (!current.testMode) {
          data.teacherKeys ??= [];
          data.teacherKeys.push({ teacherId: person.id, schoolId, keyHash, createdAt: new Date().toISOString(), batchId: batch.batchId });
        }
        return { ...person, keyHash, link: `${current.baseUrl}/n#${key}` };
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
      message: unknown ? 'Część wyników jest nieznana. Sprawdź panel operatora przed kolejną wysyłką.' : job.testMode ? 'Tryb testowy zakończony. SMS-y nie zostały dostarczone; linki testowe nie dają dostępu.' : 'Wysyłka zakończona. Liczba przyjętych przez operatora nie oznacza potwierdzenia doręczenia.'
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
