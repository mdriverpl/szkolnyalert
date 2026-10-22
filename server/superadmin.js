import { id } from './store.js';
import { hashPassword, verifyPassword, normalizeLogin, userLogins } from './auth.js';

export async function ensureSuperadmin(store, env = process.env) {
  const email = normalizeLogin(env.SUPERADMIN_EMAIL || 'biuro@mdriver.pl');
  const password = env.SUPERADMIN_PASSWORD;
  if (!password) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 11 || password.length > 128) throw new Error('Ustaw SUPERADMIN_EMAIL oraz SUPERADMIN_PASSWORD (11–128 znaków).');
  const previous = (await store.read()).users.find(user => userLogins(user).includes(email));
  if (previous?.role === 'superadmin' && await verifyPassword(password, previous.bootstrapPasswordHash || previous.passwordHash)) {
    if (!previous.bootstrapPasswordHash) await store.mutate(data => {
      const current = data.users.find(user => user.id === previous.id);
      if (current && current.passwordHash === previous.passwordHash) current.bootstrapPasswordHash = previous.passwordHash;
    });
    return;
  }
  const passwordHash = await hashPassword(password);
  await store.mutate(data => {
    const existing = data.users.find(user => userLogins(user).includes(email));
    if (existing) {
      existing.role = 'superadmin'; existing.schoolId = null;
      existing.passwordHash = passwordHash; existing.bootstrapPasswordHash = passwordHash; existing.authVersion = (existing.authVersion || 0) + 1;
      delete existing.passwordReset;
      data.sessions = (data.sessions || []).filter(session => session.userId !== existing.id);
      return;
    }
    data.users.push({ id: id(), schoolId: null, name: 'Superadministrator', username: email, email, role: 'superadmin', passwordHash, bootstrapPasswordHash: passwordHash, authVersion: 0 });
  });
}
