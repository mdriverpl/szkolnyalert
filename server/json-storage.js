import { mkdir, open, readFile, rename, rm, readdir } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, path);
    // Persist the directory entry on systems that support directory fsync.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
}

export async function createJsonStorage(file, { backups = false, backupIntervalMs = 3600_000, backupLimit = 48, lock = false } = {}) {
  const path = resolve(file), directory = dirname(path), backupDirectory = join(directory, 'backups');
  if (!Number.isSafeInteger(backupIntervalMs) || backupIntervalMs < 0 || !Number.isSafeInteger(backupLimit) || backupLimit < 1) throw new Error('Niepoprawna konfiguracja kopii zapasowych JSON.');
  for (const publicDirectory of ['public', 'dist']) {
    const root = resolve(publicDirectory);
    if (path === root || path.startsWith(root + '/') || path.startsWith(root + '\\')) throw new Error('Plik danych JSON musi znajdować się poza public i dist.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path + '.lock'; let lockHandle;
  if (lock) {
    try { lockHandle = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Magazyn JSON jest zablokowany: ${lockPath}. Uruchom tylko jedną instancję. Po awarii sprawdź PID w pliku blokady i usuń blokadę wyłącznie po zatrzymaniu poprzedniego procesu.`);
      throw error;
    }
    try { await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
    catch (error) { await lockHandle.close(); await rm(lockPath, { force: true }); throw error; }
  }
  let lastBackup = 0, lastBackupStamp = 0, closed = false;
  const prefix = basename(path) + '.';
  async function backup(previous) {
    if (!backups || !previous || Date.now() - lastBackup < backupIntervalMs) return;
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    lastBackupStamp = Math.max(Date.now(), lastBackupStamp + 1);
    const name = `${prefix}${new Date(lastBackupStamp).toISOString().replaceAll(':', '-')}.${randomUUID()}.bak`;
    await atomicWrite(join(backupDirectory, name), previous);
    lastBackup = Date.now();
    const entries = (await readdir(backupDirectory)).filter(x => x.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}T[\d.-]+Z\.[a-f0-9-]{36}\.bak$/.test(x.slice(prefix.length))).sort();
    for (const expired of entries.slice(0, Math.max(0, entries.length - backupLimit))) await rm(join(backupDirectory, expired));
  }
  return {
    async read() {
      try { return await readFile(path, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async write(next, previous) {
      if (closed) throw new Error('Magazyn JSON został zamknięty.');
      await backup(previous);
      await atomicWrite(path, JSON.stringify(next, null, 2));
    },
    async close() {
      if (closed) return; closed = true;
      if (lockHandle) { await lockHandle.close(); await rm(lockPath); }
    }
  };
}
