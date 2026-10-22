import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { hashPassword, normalizeLogin } from './auth.js';

const message = 'Jeśli konto z tym adresem istnieje, wyślemy na nie nowe hasło tymczasowe. Sprawdź również folder Spam.';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createPasswordRecovery(store, { env = process.env, sendMail, now = Date.now } = {}) {
  let transport;
  const configured = () => !!sendMail || !!(env.SMTP_HOST && env.SMTP_FROM && env.SMTP_USER && env.SMTP_PASSWORD);
  async function deliver(email, password) {
    const mail = {
      from: env.SMTP_FROM,
      to: email,
      subject: 'Szkolny Alert — nowe hasło tymczasowe',
      text: `Otrzymaliśmy prośbę o odzyskanie dostępu do Szkolnego Alertu.\n\nNowe hasło tymczasowe: ${password}\n\nZaloguj się swoim adresem e-mail i tym hasłem w ciągu 30 minut. Po zalogowaniu wybierz „Zmień hasło” i ustaw własne hasło.\n\nDotychczasowe hasło działa do chwili pierwszego użycia hasła tymczasowego. Jeśli nie prosisz o zmianę, zignoruj tę wiadomość. Nie przekazuj hasła innym osobom.`,
      disableFileAccess: true, disableUrlAccess: true
    };
    if (sendMail) return sendMail(mail);
    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('Niepoprawna konfiguracja poczty.', 503);
    transport ??= nodemailer.createTransport({
      host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
    });
    const result = await transport.sendMail(mail);
    if (!result.accepted?.length) throw new Error('Mail not accepted');
  }
  async function request(email) {
    if (typeof email !== 'string' || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw fail('Podaj poprawny adres e-mail.');
    if (!configured()) throw fail('Odzyskiwanie hasła jest chwilowo niedostępne. Skontaktuj się z administratorem szkoły.', 503);
    const address = normalizeLogin(email);
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await hashPassword(password);
    const user = (await store.read()).users.find(x => normalizeLogin(x.email) === address);
    if (!user) return { message };
    const requestedAt = now();
    const reserved = await store.mutate(data => {
      const current = data.users.find(x => x.id === user.id && x.passwordHash === user.passwordHash && x.email === user.email && (x.authVersion || 0) === (user.authVersion || 0));
      if (!current || (current.role !== 'superadmin' && !data.schools.some(x => x.id === current.schoolId))) return false;
      if (current.passwordReset?.requestedAt > requestedAt - 60_000) return false;
      current.passwordReset = { passwordHash, requestedAt, expires: requestedAt + 30 * 60_000, delivered: false };
      return true;
    });
    if (!reserved) return { message };
    try {
      await deliver(user.email, password);
      await store.mutate(data => {
        const current = data.users.find(x => x.id === user.id);
        if (current?.passwordReset?.passwordHash === passwordHash) current.passwordReset.delivered = true;
      });
    } catch {
      await store.mutate(data => {
        const current = data.users.find(x => x.id === user.id);
        if (current?.passwordReset?.passwordHash === passwordHash) delete current.passwordReset;
      });
      console.error('Nie udało się wysłać wiadomości odzyskiwania hasła. Sprawdź konfigurację SMTP.');
    }
    return { message };
  }
  return { request };
}
