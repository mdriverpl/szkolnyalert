export const SMS_MAX_LENGTH = 70;
export function validateSmsText(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > SMS_MAX_LENGTH) throw Object.assign(new Error('SMS musi mieć od 1 do 70 znaków.'), { status: 400 });
  return text;
}
const compact = value => String(value || '').replace(/\s+/gu, ' ').trim();
const truncate = (value, limit) => {
  if (value.length <= limit) return value;
  let result = '';
  for (const char of value) { if (result.length + char.length > limit - 1) break; result += char; }
  return result.trimEnd() + '…';
};
export function incidentSms(incident) {
  const prefix = incident.isTest ? 'TEST ALERT: ' : 'ALERT: ';
  const suffix = '. Otworz aplikacje.';
  const name = truncate(compact(incident.name) || 'Zdarzenie', 25);
  const location = compact(incident.location);
  const details = name + (location && location !== 'Nie podano miejsca' ? ', ' + location : '');
  return validateSmsText(prefix + truncate(details, SMS_MAX_LENGTH - prefix.length - suffix.length) + suffix);
}
