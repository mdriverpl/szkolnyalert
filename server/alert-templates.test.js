import test from 'node:test';
import assert from 'node:assert/strict';
import { addProcedureTemplates } from './procedure-templates.js';
import { addAlertTemplates } from './alert-templates.js';

test('example alerts link only to own-school procedures without launching incidents or duplicating user content', () => {
  const own = { id: 'own-alert', schoolId: 'a', name: 'Alarm pożarowy', description: 'Własny opis', severity: 'critical', procedureId: 'own-procedure' };
  const data = { procedures: [{ id: 'own-procedure', schoolId: 'a', name: 'Ewakuacja budynku', steps: ['Własna instrukcja'] }], alerts: [own], incidents: [] };
  addProcedureTemplates(data, 'a'); addProcedureTemplates(data, 'b');
  assert.equal(addAlertTemplates(data, 'a'), 5);
  assert.equal(addAlertTemplates(data, 'b'), 6);
  assert.equal(own.description, 'Własny opis');
  assert.equal(data.incidents.length, 0);
  assert.ok(data.alerts.every(a => data.procedures.some(p => p.id === a.procedureId && p.schoolId === a.schoolId)));
  const renamed = data.alerts.find(a => a.schoolId === 'a' && a.id !== own.id);
  renamed.name = 'Zmieniona nazwa'; data.alerts = data.alerts.filter(a => a.id !== own.id);
  const count = data.alerts.length;
  assert.equal(addAlertTemplates(data, 'a'), 0);
  assert.equal(data.alerts.length, count);
});

test('missing local procedures cannot be replaced with another school procedures', () => {
  const data = { procedures: [], alerts: [], incidents: [] };
  addProcedureTemplates(data, 'b');
  assert.equal(addAlertTemplates(data, 'a'), 0);
  assert.equal(data.alerts.length, 0);
});
