import { existsSync } from 'node:fs';
import { createStore, id } from '../server/store.js';
import { hashPassword } from '../server/auth.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const [schoolId, email, name] = process.argv.slice(2);
const password = process.env.SCHOOL_ADMIN_PASSWORD;
if (!schoolId || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || !password || password.length < 11 || password.length > 128) {
  console.error('Podaj: node scripts/create-school-admin.js ID_SZKOLY EMAIL "IMIE NAZWISKO". Hasło 11–128 znaków w SCHOOL_ADMIN_PASSWORD.');
  process.exit(1);
}
const store = await createStore({ connectionString: process.env.DATABASE_URL });
try {
  const passwordHash = await hashPassword(password);
  await store.mutate(data => {
    if (!data.schools.some(x => x.id === schoolId)) throw new Error('Nie znaleziono wskazanej szkoły.');
    if (data.users.some(x => x.email === email.toLowerCase())) throw new Error('Ten adres e-mail jest już przypisany do konta.');
    data.users.push({ id: id(), schoolId, name, email: email.toLowerCase(), role: 'admin', passwordHash, authVersion: 0 });
  });
  console.log('Utworzono administratora wskazanej szkoły.');
} finally { await store.close(); }
