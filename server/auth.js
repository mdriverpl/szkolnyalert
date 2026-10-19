import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await derive(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [salt, encoded] = String(hash || '').split(':');
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = Buffer.from(await derive(password, salt, 64));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const publicUser = ({ id, name, username, email, phone = '', role, schoolId }) => ({ id, name, username: username || email, email, phone, role, schoolId });
export const normalizeLogin = value => String(value || '').trim().normalize('NFKC').toLowerCase();
export const userLogins = user => [user.username, user.email].filter(Boolean).map(normalizeLogin);
