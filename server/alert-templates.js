import { randomUUID } from 'node:crypto';
import { procedureTemplates } from './procedure-templates.js';

export const alertTemplates = [
  { name: 'Alarm pożarowy', severity: 'critical', procedureKey: 'evacuation', description: 'Przykładowy alert zagrożenia pożarowego. Po uruchomieniu otwórz szkolną procedurę ewakuacji.' },
  { name: 'Osoba nieuprawniona na terenie szkoły', severity: 'critical', procedureKey: 'unknown-person', description: 'Przykładowe zgłoszenie wymagające pilnej reakcji koordynatora i zapewnienia opieki uczniom.' },
  { name: 'Brak ucznia podczas zajęć', severity: 'warning', procedureKey: 'missing-student', description: 'Przykładowe zgłoszenie nieustalonego miejsca pobytu ucznia. Przekaż informacje osobie koordynującej.' },
  { name: 'Awaria zasilania', severity: 'warning', procedureKey: 'infrastructure', description: 'Przykładowe zgłoszenie przerwy w dostawie prądu. Sprawdź instrukcję organizacji zajęć.' },
  { name: 'Zgłoszenie przemocy rówieśniczej', severity: 'warning', procedureKey: 'peer-violence', description: 'Przykładowe zgłoszenie sytuacji wymagającej wsparcia ucznia i uruchomienia szkolnej ścieżki postępowania.' },
  { name: 'Zmiana organizacji zajęć', severity: 'info', procedureKey: 'communication', description: 'Przykładowy komunikat dla zespołu o zmianie sal, harmonogramu lub organizacji dnia.' }
];

export function addAlertTemplates(data, schoolId) {
  data.alertTemplatesApplied ??= [];
  if (data.alertTemplatesApplied.includes(schoolId)) return 0;
  let added = 0;
  for (const template of alertTemplates) {
    if (data.alerts.some(a => a.schoolId === schoolId && a.name.trim().toLocaleLowerCase('pl') === template.name.toLocaleLowerCase('pl'))) continue;
    const procedureName = procedureTemplates.find(p => p.key === template.procedureKey).name;
    const procedure = data.procedures.find(p => p.schoolId === schoolId && p.name.trim().toLocaleLowerCase('pl') === procedureName.toLocaleLowerCase('pl'));
    if (!procedure) continue;
    data.alerts.push({ id: randomUUID(), schoolId, name: template.name, severity: template.severity, description: template.description, procedureId: procedure.id });
    added++;
  }
  data.alertTemplatesApplied.push(schoolId);
  return added;
}
