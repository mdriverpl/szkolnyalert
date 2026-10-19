import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { id } from './store.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const defaults = { provider: 'smsapi', enabled: false, testMode: true, sender: '' };
export const smsSummary = settings => ({ ...defaults, enabled: !!settings?.enabled, testMode: settings?.testMode !== false, sender: settings?.sender || '', hasToken: !!settings?.encryptedToken, updatedAt: settings?.updatedAt || null });
export function smsPhone(value) {
  if (typeof value !== 'string' || !/^\+?[\d ()-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = '48' + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
export function smsRecipients(data, schoolId) {
  const teachers = data.teachers.filter(x => x.schoolId === schoolId);
  const numbers = teachers.map(x => smsPhone(x.phone));
  return { numbers: [...new Set(numbers.filter(Boolean))], omitted: numbers.filter(x => !x).length };
}

export function createSmsGateway(store, { encryptionKey, fetchImpl = (...args) => fetch(...args) } = {}) {
  let keyPromise;
  async function key() {
    if (!keyPromise) keyPromise = (async () => {
      const configured = encryptionKey || process.env.SMS_ENCRYPTION_KEY;
      if (configured) {
        const bytes = Buffer.isBuffer(configured) ? configured : Buffer.from(configured, 'base64');
        if (bytes.length !== 32) throw fail('SMS_ENCRYPTION_KEY musi zawierać 32 bajty zapisane jako base64.', 503);
        return bytes;
      }
      if (!store.demo || process.env.NODE_ENV === 'production') throw fail('Skonfiguruj SMS_ENCRYPTION_KEY na serwerze przed zapisaniem tokenu SMSAPI.', 503);
      await mkdir('data', { recursive: true });
      const path = 'data/sms-encryption.key';
      try { await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const bytes = await readFile(path);
      if (bytes.length !== 32) throw fail('Niepoprawny lokalny klucz szyfrowania SMS.', 503);
      return bytes;
    })().catch(error => { keyPromise = null; throw error; });
    return keyPromise;
  }
  async function encrypt(token, schoolId) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await key(), iv);
    cipher.setAAD(Buffer.from(schoolId));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(x => x.toString('base64')).join('.');
  }
  async function decrypt(value, schoolId) {
    try {
      const [iv, tag, ciphertext] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', await key(), iv); decipher.setAAD(Buffer.from(schoolId)); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { throw fail('Nie można odczytać tokenu SMSAPI. Sprawdź klucz serwera lub zapisz token ponownie.', 503); }
  }
  async function getSettings(schoolId) {
    const data = await store.read();
    const settings = data.smsSettings?.find(x => x.schoolId === schoolId);
    return { ...smsSummary(settings), lastTest: settings?.lastTest || null, recipients: smsRecipients(data, schoolId).numbers.length };
  }
  async function saveSettings(schoolId, body) {
    if (typeof body.enabled !== 'boolean' || typeof body.testMode !== 'boolean') throw fail('Wybierz tryb i stan bramki SMS.');
    if (typeof body.sender !== 'string' || body.sender.length > 11 || /[\r\n\x00-\x1f]/.test(body.sender)) throw fail('Nazwa nadawcy może mieć maksymalnie 11 znaków.');
    let encryptedToken;
    if (body.token) {
      if (typeof body.token !== 'string' || body.token.length < 10 || body.token.length > 4096 || /\s/.test(body.token)) throw fail('Podaj poprawny token OAuth SMSAPI, bez spacji.');
      encryptedToken = await encrypt(body.token, schoolId);
    }
    await store.mutate(data => {
      data.smsSettings ??= [];
      const previous = data.smsSettings.find(x => x.schoolId === schoolId);
      const settings = { schoolId, ...defaults, ...previous, enabled: body.enabled, testMode: body.testMode, sender: body.sender.trim(), updatedAt: new Date().toISOString() };
      if (encryptedToken) settings.encryptedToken = encryptedToken;
      if (settings.enabled && !settings.encryptedToken) throw fail('Zapisz token SMSAPI przed włączeniem automatycznych SMS-ów.');
      data.smsSettings = data.smsSettings.filter(x => x.schoolId !== schoolId); data.smsSettings.push(settings);
    });
    return getSettings(schoolId);
  }
  async function removeToken(schoolId) {
    await store.mutate(data => { data.smsSettings = (data.smsSettings || []).filter(x => x.schoolId !== schoolId); });
    return getSettings(schoolId);
  }
  async function send(settings, schoolId, numbers, message) {
    const token = await decrypt(settings.encryptedToken, schoolId);
    const params = new URLSearchParams({ to: numbers.join(','), message, format: 'json' });
    if (settings.sender) params.set('from', settings.sender);
    if (settings.testMode !== false) params.set('test', '1');
    let response, body;
    try {
      response = await fetchImpl('https://api.smsapi.pl/sms.do', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(15000), redirect: 'error' });
      body = await response.json();
    } catch { return { status: 'unknown', accepted: 0, total: numbers.length, message: 'Brak jednoznacznej odpowiedzi SMSAPI. Sprawdź panel operatora przed ponowną wysyłką.' }; }
    if (!body || typeof body !== 'object') return { status: 'unknown', accepted: 0, total: numbers.length, message: 'Niepoprawna odpowiedź SMSAPI. Sprawdź panel operatora.' };
    const accepted = new Set((Array.isArray(body.list) ? body.list : []).filter(x => x.id && !x.error && !['ERROR', 'FAILED', 'REJECTED', 'UNDELIVERED'].includes(x.status) && numbers.includes(String(x.submitted_number || x.number))).map(x => String(x.submitted_number || x.number))).size;
    if (accepted) return { status: accepted < numbers.length ? 'partial' : settings.testMode !== false ? 'test' : 'accepted', testMode: settings.testMode !== false, accepted, total: numbers.length, message: settings.testMode !== false ? 'Próba API zakończona. Tryb testowy nie dostarcza SMS-ów.' : 'SMSAPI przyjęło wiadomości do wysyłki. Nie jest to potwierdzenie doręczenia.' };
    if (!response.ok || body.error) return { status: 'failed', accepted: 0, total: numbers.length, message: `SMSAPI odrzuciło żądanie${/^\d{1,5}$/.test(String(body.error)) ? ` (kod ${body.error})` : ''}. Sprawdź token, nadawcę, numery i saldo konta.` };
    return { status: 'unknown', accepted: 0, total: numbers.length, message: 'Nierozpoznana odpowiedź SMSAPI. Sprawdź panel operatora przed ponowną wysyłką.' };
  }
  async function test(schoolId, phone) {
    const number = smsPhone(phone);
    if (!number) throw fail('Podaj poprawny numer testowy, np. +48 500 600 700.');
    const data = await store.read(), settings = data.smsSettings?.find(x => x.schoolId === schoolId);
    if (!settings?.encryptedToken) throw fail('Najpierw zapisz token SMSAPI.');
    const result = await send(settings, schoolId, [number], 'Szkolny Alert: test polaczenia z bramka SMSAPI.');
    await store.mutate(data => { const current = data.smsSettings?.find(x => x.schoolId === schoolId); if (current) current.lastTest = { ...result, at: new Date().toISOString() }; });
    return result;
  }
  async function notifyIncident(schoolId, incidentId) {
    const job = await store.mutate(data => {
      const incident = data.incidents.find(x => x.id === incidentId && x.schoolId === schoolId);
      if (!incident || incident.sms?.status !== 'pending') return null;
      const settings = data.smsSettings?.find(x => x.schoolId === schoolId);
      if (!settings?.enabled || !settings.encryptedToken) { incident.sms = { status: 'disabled' }; return null; }
      const recipients = smsRecipients(data, schoolId);
      if (!recipients.numbers.length) { incident.sms = { status: 'no_recipients', message: 'Brak poprawnych numerów nauczycieli.' }; return null; }
      if (recipients.numbers.length > 10000) { incident.sms = { status: 'failed', message: 'Przekroczono limit 10 000 odbiorców.' }; return null; }
      const school = data.schools.find(x => x.id === schoolId);
      incident.sms = { status: 'sending', attemptId: id(), total: recipients.numbers.length, omitted: recipients.omitted, at: new Date().toISOString() };
      const message = `[Szkolny Alert] ${school.name.slice(0, 65)}\n${incident.name.slice(0, 90)}\nMiejsce: ${incident.location.slice(0, 110)}\nProcedura: ${incident.procedure.name.slice(0, 65)}. Sprawdz panel szkoly.`;
      return { settings, recipients, message, attemptId: incident.sms.attemptId };
    });
    if (!job) return;
    let result;
    try { result = await send(job.settings, schoolId, job.recipients.numbers, job.message); }
    catch (error) { result = { status: 'failed', accepted: 0, total: job.recipients.numbers.length, message: error.status ? error.message : 'Błąd konfiguracji bramki SMS.' }; }
    await store.mutate(data => {
      const incident = data.incidents.find(x => x.id === incidentId && x.schoolId === schoolId);
      if (incident?.sms?.attemptId === job.attemptId) incident.sms = { ...incident.sms, ...result };
    });
  }
  const sendLink = (settings, schoolId, number, link) => send(settings, schoolId, [number], `Szkolny Alert: Twoj osobisty panel nauczyciela. Zachowaj link tylko dla siebie: ${link}`);
  return { getSettings, saveSettings, removeToken, test, notifyIncident, sendLink, sealAccessKey: encrypt, openAccessKey: decrypt };
}
