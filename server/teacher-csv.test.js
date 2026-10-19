import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTeacherCsv } from './teacher-csv.js';
const validate = row => ({ ...row, email: row.email.trim().toLowerCase() });

test('CSV supports UTF-8 BOM, Polish headers, quoted delimiters and newlines', () => {
  const text = '\uFEFFImię i nazwisko;Adres e-mail;Przedmiot / rola;Numer telefonu\r\n"Anna; Kowalska";anna@example.com;"Język polski\nwychowawca";+48 500 600 700\r\n';
  const preview = previewTeacherCsv(text, [], validate);
  assert.equal(preview.ready, 1);
  assert.equal(preview.rows[0].teacher.name, 'Anna; Kowalska');
  assert.equal(preview.rows[0].teacher.subject, 'Język polski\nwychowawca');
  assert.equal(preview.rows[0].teacher.phone, '+48 500 600 700');
});
test('CSV supports commas, tabs, split names and duplicate detection', () => {
  for (const delimiter of [',', '\t']) {
    const csv = [['Imię', 'Nazwisko', 'Email', 'Przedmiot'], ['Anna', 'Kowalska', 'anna@example.com', 'Matematyka'], ['Jan', 'Nowak', 'jan@example.com', 'Historia'], ['Jan', 'Nowak', 'JAN@example.com', 'Historia']].map(row => row.join(delimiter)).join('\n');
    const preview = previewTeacherCsv(csv, [{ email: 'anna@example.com' }], validate);
    assert.equal(preview.ready, 1); assert.equal(preview.skipped, 2);
    assert.equal(preview.rows[1].teacher.name, 'Jan Nowak');
  }
});
test('CSV rejects bad headers, malformed records and excessive sizes', () => {
  assert.throws(() => previewTeacherCsv('', [], validate));
  assert.throws(() => previewTeacherCsv('imię,email\nAnna,a@example.com', [], validate));
  assert.throws(() => previewTeacherCsv('name,email,subject,email\nAnna,a@example.com,Test,a@example.com', [], validate));
  assert.throws(() => previewTeacherCsv('name,email,subject\n"unclosed,a@example.com,Test', [], validate));
  const inconsistent = previewTeacherCsv('name,email,subject\nAnna,a@example.com', [], validate);
  assert.equal(inconsistent.invalid, 1);
  assert.throws(() => previewTeacherCsv('name,email,subject\n' + Array.from({ length: 501 }, (_, i) => `Anna,a${i}@example.com,Test`).join('\n'), [], validate));
  assert.throws(() => previewTeacherCsv(' '.repeat(512 * 1024) + 'name,email,subject', [], validate));
});
