import { id } from './store.js';
import { hashPassword, verifyPassword, normalizeLogin, userLogins } from './auth.js';

export async function ensureSuperadmin(store, env = process.env) {
  const email = normalizeLogin(env.SUPERADMIN_EMAIL || 'biuro@mdriver.pl');
  const password = env.SUPERADMIN_PASSWORD;
  if (!password) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 11 || password.length > 128) throw new Error('Ustaw SUPERADMIN_EMAIL oraz SUPERADMIN_PASSWORD (11–128 znaków).');
  const previous = (await store.read()).users.find(user => userLogins(user).includes(email));
  if (previous?.role === 'superadmin' && await verifyPassword(password, previous.passwordHash)) return;
  const passwordHash = await hashPassword(password);
  await store.mutate(data => {
    const existing = data.users.find(user => userLogins(user).includes(email));
    if (existing) {
      existing.role = 'superadmin'; existing.schoolId = null;
      existing.passwordHash = passwordHash; existing.authVersion = (existing.authVersion || 0) + 1;
      data.sessions = (data.sessions || []).filter(session => session.userId !== existing.id);
      return;
    }
    data.users.push({ id: id(), schoolId: null, name: 'Superadministrator', username: email, email, role: 'superadmin', passwordHash, authVersion: 0 });
  });
}
