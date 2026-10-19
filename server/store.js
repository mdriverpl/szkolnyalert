import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import pg from 'pg';
import { hashPasswordSync } from './auth.js';
import { addProcedureTemplates } from './procedure-templates.js';
import { addAlertTemplates } from './alert-templates.js';

export function seed() {
  const data = {
    schools: [
      { id: 'school-demo', name: 'Szkoła Podstawowa nr 12', city: 'Warszawa', address: 'ul. Szkolna 12' },
      { id: 'school-demo-2', name: 'Liceum Ogólnokształcące nr 3', city: 'Kraków', address: 'ul. Ogrodowa 8' }
    ],
    teachers: [
      { id: 'teacher-1', schoolId: 'school-demo', name: 'Anna Kowalska', email: 'anna@example.com', subject: 'Język polski' },
      { id: 'teacher-2', schoolId: 'school-demo', name: 'Michał Nowak', email: 'michal@example.com', subject: 'Matematyka' },
      { id: 'teacher-3', schoolId: 'school-demo', name: 'Katarzyna Wiśniewska', email: 'kasia@example.com', subject: 'Biologia' },
      { id: 'teacher-4', schoolId: 'school-demo', name: 'Piotr Zieliński', email: 'piotr@example.com', subject: 'Wychowanie fizyczne' },
      { id: 'teacher-5', schoolId: 'school-demo', name: 'Magdalena Wójcik', email: 'magdalena@example.com', subject: 'Język angielski' },
      { id: 'teacher-6', schoolId: 'school-demo', name: 'Tomasz Kamiński', email: 'tomasz@example.com', subject: 'Informatyka' },
      { id: 'teacher-7', schoolId: 'school-demo', name: 'Joanna Lewandowska', email: 'joanna@example.com', subject: 'Pedagog szkolny' },
      { id: 'teacher-8', schoolId: 'school-demo', name: 'Paweł Dąbrowski', email: 'pawel@example.com', subject: 'Historia' },
      { id: 'teacher-9', schoolId: 'school-demo-2', name: 'Aleksandra Mazur', email: 'aleksandra@example.com', subject: 'Dyrektor szkoły' },
      { id: 'teacher-10', schoolId: 'school-demo-2', name: 'Marcin Krawczyk', email: 'marcin@example.com', subject: 'Fizyka' },
      { id: 'teacher-11', schoolId: 'school-demo-2', name: 'Ewa Piotrowska', email: 'ewa@example.com', subject: 'Chemia' },
      { id: 'teacher-12', schoolId: 'school-demo-2', name: 'Adam Grabowski', email: 'adam@example.com', subject: 'Geografia' }
    ],
    procedures: [
      { id: 'procedure-1', schoolId: 'school-demo', name: 'Ewakuacja budynku', category: 'Ewakuacja', description: 'Przykładowy szablon do zatwierdzenia przez dyrekcję szkoły.', steps: ['Zachowaj spokój i przekaż uczniom komunikat o ewakuacji.', 'Postępuj zgodnie z zatwierdzonym planem ewakuacji szkoły.', 'W wyznaczonym miejscu zbiórki sprawdź obecność i zgłoś stan koordynatorowi.'] },
      { id: 'procedure-2', schoolId: 'school-demo', name: 'Pomoc medyczna', category: 'Zdrowie', description: 'Przykładowy szablon do zatwierdzenia przez dyrekcję szkoły.', steps: ['Oceń bezpieczeństwo miejsca zdarzenia.', 'Wezwij odpowiednią pomoc zgodnie z procedurą szkoły.', 'Zapewnij opiekę pozostałym uczniom i przekaż informacje osobie koordynującej.'] },
      { id: 'procedure-3', schoolId: 'school-demo', name: 'Niebezpieczne zdarzenie', category: 'Bezpieczeństwo', description: 'Przykładowy szablon do zatwierdzenia przez dyrekcję szkoły.', steps: ['Zadbaj o bezpieczeństwo uczniów zgodnie z lokalną procedurą.', 'Poinformuj dyrekcję szkoły.', 'Wykonuj polecenia koordynatora i odpowiednich służb.'] },
      { id: 'procedure-4', schoolId: 'school-demo', name: 'Awaria infrastruktury', category: 'Organizacja', description: 'Przykładowy plan na wypadek awarii prądu lub instalacji. Wymaga zatwierdzenia przez szkołę.', steps: ['Zgłoś miejsce i rodzaj awarii osobie odpowiedzialnej.', 'Zabezpiecz dostęp do miejsca awarii zgodnie z instrukcją szkoły.', 'Poczekaj na decyzję dyrekcji dotyczącą dalszych zajęć.'] },
      { id: 'procedure-5', schoolId: 'school-demo', name: 'Komunikat organizacyjny', category: 'Informacja', description: 'Przykładowa instrukcja przekazywania informacji zespołowi.', steps: ['Zapoznaj się z treścią komunikatu.', 'Przekaż informację osobom, których dotyczy.', 'W razie pytań skontaktuj się z sekretariatem.'] },
      { id: 'procedure-6', schoolId: 'school-demo-2', name: 'Ewakuacja liceum', category: 'Ewakuacja', description: 'Przykładowy szablon do zatwierdzenia przez dyrekcję liceum.', steps: ['Przekaż uczniom komunikat.', 'Postępuj według zatwierdzonego planu ewakuacji placówki.', 'Sprawdź obecność w miejscu zbiórki i zgłoś stan koordynatorowi.'] }
    ],
    alerts: [
      { id: 'alert-1', schoolId: 'school-demo', name: 'Alarm pożarowy', severity: 'critical', procedureId: 'procedure-1', description: 'Zagrożenie wymagające ewakuacji budynku.' },
      { id: 'alert-2', schoolId: 'school-demo', name: 'Zdarzenie medyczne', severity: 'warning', procedureId: 'procedure-2', description: 'Potrzebna pomoc na terenie szkoły.' },
      { id: 'alert-3', schoolId: 'school-demo', name: 'Zagrożenie bezpieczeństwa', severity: 'critical', procedureId: 'procedure-3', description: 'Zdarzenie wymagające natychmiastowej reakcji koordynatora.' },
      { id: 'alert-4', schoolId: 'school-demo', name: 'Awaria zasilania', severity: 'warning', procedureId: 'procedure-4', description: 'Przerwa w dostawie prądu. Sprawdź instrukcję organizacji zajęć.' },
      { id: 'alert-5', schoolId: 'school-demo', name: 'Zmiana organizacji zajęć', severity: 'info', procedureId: 'procedure-5', description: 'Komunikat dla zespołu dotyczący zmian w planie dnia.' },
      { id: 'alert-6', schoolId: 'school-demo-2', name: 'Alarm pożarowy', severity: 'critical', procedureId: 'procedure-6', description: 'Zagrożenie wymagające ewakuacji budynku liceum.' }
    ], incidents: [], users: [
      { id: 'user-demo-1', schoolId: 'school-demo', name: 'Anna Kowalska', email: 'admin@szkolnyalert.pl', role: 'admin', passwordHash: hashPasswordSync('demo12345'), authVersion: 0 },
      { id: 'user-demo-2', schoolId: 'school-demo-2', name: 'Aleksandra Mazur', email: 'admin2@szkolnyalert.pl', role: 'admin', passwordHash: hashPasswordSync('demo12345'), authVersion: 0 },
      { id: 'user-demo-3', schoolId: 'school-demo', name: 'Michał Nowak', email: 'nauczyciel@szkolnyalert.pl', role: 'teacher', passwordHash: hashPasswordSync('demo12345'), authVersion: 0 }
    ]
  };
  const now = Date.now();
  data.incidents = [
    { id: 'incident-demo-1', alertId: 'alert-1', schoolId: 'school-demo', name: 'Alarm pożarowy — ćwiczenie', severity: 'critical', location: 'Budynek A · parter, skrzydło wschodnie', procedure: structuredClone(data.procedures[0]), status: 'active', createdAt: new Date(now - 7 * 60_000).toISOString(), createdBy: 'admin@szkolnyalert.pl', isDemo: true },
    { id: 'incident-demo-2', alertId: 'alert-2', schoolId: 'school-demo', name: 'Zdarzenie medyczne — przykład', severity: 'warning', location: 'Sala gimnastyczna', procedure: structuredClone(data.procedures[1]), status: 'resolved', createdAt: new Date(now - 86400_000).toISOString(), resolvedAt: new Date(now - 86400_000 + 25 * 60_000).toISOString(), createdBy: 'admin@szkolnyalert.pl', resolvedBy: 'admin@szkolnyalert.pl', isDemo: true },
    { id: 'incident-demo-3', alertId: 'alert-4', schoolId: 'school-demo', name: 'Awaria zasilania — przykład', severity: 'warning', location: 'Budynek B · sale 201–205', procedure: structuredClone(data.procedures[3]), status: 'resolved', createdAt: new Date(now - 3 * 86400_000).toISOString(), resolvedAt: new Date(now - 3 * 86400_000 + 45 * 60_000).toISOString(), createdBy: 'admin@szkolnyalert.pl', resolvedBy: 'admin@szkolnyalert.pl', isDemo: true }
  ];
  return data;
}

export async function createStore({ connectionString, file = 'data/demo.json', memory = false } = {}) {
  let state;
  let pool;
  if (connectionString) {
    pool = new pg.Pool({ connectionString });
    // Jeden wiersz dokumentu JSONB, blokowany transakcyjnie przy zapisie.
    await pool.query('CREATE TABLE IF NOT EXISTS school_app_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)');
    await pool.query('INSERT INTO school_app_state (id, data) VALUES (1, $1) ON CONFLICT DO NOTHING', [JSON.stringify({ schools: [], teachers: [], procedures: [], alerts: [], incidents: [], users: [] })]);
  } else {
    try { state = memory ? seed() : JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = seed(); }
  }
  let queue = Promise.resolve();
  const store = {
    demo: !connectionString,
    async read() { return pool ? (await pool.query('SELECT data FROM school_app_state WHERE id = 1')).rows[0].data : structuredClone(state); },
    async mutate(fn) {
      const run = async () => {
        if (pool) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const data = (await client.query('SELECT data FROM school_app_state WHERE id = 1 FOR UPDATE')).rows[0].data;
            const result = fn(data);
            await client.query('UPDATE school_app_state SET data = $1 WHERE id = 1', [JSON.stringify(data)]);
            await client.query('COMMIT'); return result;
          } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
        }
        const next = structuredClone(state); const result = fn(next);
        if (!memory) { await mkdir('data', { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(next, null, 2)); await rename(file + '.tmp', file); }
        state = next; return result;
      };
      const result = queue.then(run); queue = result.catch(() => {}); return result;
    },
    async close() { await pool?.end(); }
  };
  const existing = await store.read();
  if (!Array.isArray(existing.users) || existing.schools.some(school => !existing.procedureTemplatesApplied?.includes(school.id) || !existing.alertTemplatesApplied?.includes(school.id))) {
    const demoUsers = !Array.isArray(existing.users) && !connectionString ? seed().users : [];
    await store.mutate(data => {
      if (!Array.isArray(data.users)) data.users = demoUsers.filter(user => data.schools.some(school => school.id === user.schoolId));
      for (const school of data.schools) {
        addProcedureTemplates(data, school.id);
        addAlertTemplates(data, school.id);
      }
    });
  }
  return store;
}
export const id = () => randomUUID();
