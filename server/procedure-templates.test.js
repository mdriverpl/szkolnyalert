import test from 'node:test';
import assert from 'node:assert/strict';
import { addProcedureTemplates, procedureTemplates } from './procedure-templates.js';

test('sample procedures are isolated school copies and do not replace existing or edited content', () => {
  const own = { id: 'own', schoolId: 'a', name: 'Ewakuacja budynku', steps: ['Własna instrukcja szkoły'] };
  const data = { procedures: [own] };
  assert.equal(addProcedureTemplates(data, 'a'), procedureTemplates.length - 1);
  assert.deepEqual(own.steps, ['Własna instrukcja szkoły']);
  assert.equal(addProcedureTemplates(data, 'b'), procedureTemplates.length);
  const a = data.procedures.find(x => x.schoolId === 'a' && x.name === 'Awaria infrastruktury');
  const b = data.procedures.find(x => x.schoolId === 'b' && x.name === 'Awaria infrastruktury');
  assert.notEqual(a.id, b.id);
  a.name = 'Zmieniona nazwa'; a.steps[0] = 'Zmieniony krok';
  assert.notEqual(a.steps[0], b.steps[0]);
  data.procedures = data.procedures.filter(x => x.id !== own.id);
  const count = data.procedures.length;
  assert.equal(addProcedureTemplates(data, 'a'), 0, 'restart must not restore deleted templates or duplicate renamed ones');
  assert.equal(data.procedures.length, count);
});
