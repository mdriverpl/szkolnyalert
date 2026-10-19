import { parse } from 'csv-parse/sync';

const fail = message => Object.assign(new Error(message), { status: 400 });
const normalize = value => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ł', 'l').replace(/[^a-z0-9]/g, '');
const aliases = {
  name: ['imienazwisko', 'imieinazwisko', 'name', 'nauczyciel'],
  firstName: ['imie', 'firstname'], lastName: ['nazwisko', 'lastname'],
  email: ['email', 'adresmail', 'adresemail'],
  subject: ['przedmiot', 'rola', 'przedmiotrola', 'subject'],
  phone: ['telefon', 'numertelefonu', 'phone', 'tel']
};
const field = header => Object.keys(aliases).find(key => aliases[key].includes(normalize(header)));

export function previewTeacherCsv(csv, existingTeachers, validateTeacher) {
  if (typeof csv !== 'string' || !csv.trim()) throw fail('Wybierz niepusty plik CSV.');
  if (Buffer.byteLength(csv, 'utf8') > 512 * 1024) throw fail('Plik po odczytaniu może mieć maksymalnie 512 KB.');
  let delimiter, bestScore = 0;
  for (const candidate of [';', ',', '\t']) {
    try {
      const [header] = parse(csv, { bom: true, delimiter: candidate, to: 1, skip_empty_lines: true, max_record_size: 32768 });
      const score = (header || []).filter(value => field(value)).length;
      if (score > bestScore) { bestScore = score; delimiter = candidate; }
    } catch { /* Try the other supported delimiter. */ }
  }
  if (!delimiter) throw fail('Nie rozpoznano nagłówków CSV. Użyj wzoru: imię i nazwisko;email;przedmiot;telefon.');
  let records;
  try {
    records = parse(csv, { bom: true, delimiter, skip_empty_lines: true, info: true, relax_column_count: true, max_record_size: 32768, to: 502 });
  } catch (error) { throw fail(`Niepoprawny plik CSV${error.lines ? `, okolice wiersza ${error.lines}` : ''}. Sprawdź cudzysłowy i separatory.`); }
  const header = records.shift()?.record || [];
  const columns = header.map(field);
  const known = columns.filter(Boolean);
  if (new Set(known).size !== known.length) throw fail('Nagłówki CSV zawierają powtórzoną kolumnę.');
  if (!(columns.includes('name') || columns.includes('firstName') && columns.includes('lastName')) || !columns.includes('email') || !columns.includes('subject')) throw fail('Wymagane kolumny: imię i nazwisko (lub osobno imię oraz nazwisko), email, przedmiot. Telefon jest opcjonalny.');
  if (!records.length) throw fail('Plik zawiera nagłówki, ale nie zawiera nauczycieli.');
  if (records.length > 500) throw fail('Jeden import może zawierać maksymalnie 500 nauczycieli.');
  const seen = new Set(existingTeachers.map(t => t.email.toLowerCase()));
  const rows = records.map(({ record, info }) => {
    const values = {};
    columns.forEach((key, i) => { if (key) values[key] = record[i] || ''; });
    if (!columns.includes('name')) values.name = `${values.firstName || ''} ${values.lastName || ''}`.trim();
    const row = { line: info.lines, teacher: { name: values.name || '', email: values.email || '', subject: values.subject || '', phone: values.phone || '' }, status: 'ready', message: '' };
    if (record.length !== header.length) return { ...row, status: 'error', message: `Liczba pól (${record.length}) nie pasuje do nagłówka (${header.length}).` };
    try { row.teacher = validateTeacher(row.teacher); }
    catch (error) { return { ...row, status: 'error', message: error.message }; }
    if (seen.has(row.teacher.email)) return { ...row, status: 'duplicate', message: 'Adres e-mail już występuje w szkole lub wcześniej w tym pliku. Rekord zostanie pominięty.' };
    seen.add(row.teacher.email);
    return row;
  });
  return { rows, total: rows.length, ready: rows.filter(r => r.status === 'ready').length, skipped: rows.filter(r => r.status === 'duplicate').length, invalid: rows.filter(r => r.status === 'error').length };
}
