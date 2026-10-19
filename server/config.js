import { resolve } from 'node:path';

export function storageConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const driver = env.STORAGE_DRIVER || (env.DATABASE_URL ? 'postgres' : 'json');
  if (!['json', 'postgres'].includes(driver)) throw new Error('STORAGE_DRIVER musi mieć wartość json lub postgres.');
  if (driver === 'postgres' && !env.DATABASE_URL) throw new Error('Ustaw DATABASE_URL dla PostgreSQL.');
  const demoValue = env.DEMO_DATA ?? (production ? 'false' : 'true');
  if (!['true', 'false'].includes(demoValue)) throw new Error('DEMO_DATA musi mieć wartość true albo false.');
  if (production && demoValue === 'true') throw new Error('Dane demonstracyjne są wyłączone w produkcji. Ustaw DEMO_DATA=false.');
  if (production && (!env.SMS_ENCRYPTION_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.SMS_ENCRYPTION_KEY))) throw new Error('Ustaw SMS_ENCRYPTION_KEY: trwały klucz 32-bajtowy base64.');
  const demo = demoValue === 'true';
  const interval = Number(env.JSON_BACKUP_INTERVAL_MINUTES ?? 60);
  const limit = Number(env.JSON_BACKUP_LIMIT ?? 48);
  if (!Number.isSafeInteger(interval) || interval < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Niepoprawny interwał lub limit kopii JSON.');
  return {
    connectionString: driver === 'postgres' ? env.DATABASE_URL : undefined,
    file: resolve(env.DATA_DIR || 'data', env.JSON_FILE || (demo ? 'demo.json' : 'app.json')),
    demo, backups: !demo, lock: !demo,
    backupIntervalMs: interval * 60_000, backupLimit: limit
  };
}
