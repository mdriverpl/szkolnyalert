import { createHash } from 'node:crypto';

// Stable for the same canonical recipient, exact text and Warsaw calendar day.
export function hostavaIdempotencyKey(phone, text, date = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return createHash('sha256').update(JSON.stringify([phone, text, day])).digest('hex');
}

export async function sendHostava({ token, numbers, text, date = new Date(), fetchImpl = fetch }) {
  const results = new Array(numbers.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(5, numbers.length) }, async () => {
    while (cursor < numbers.length) {
      const index = cursor++, to = '+' + numbers[index];
      try {
        const response = await fetchImpl('https://cloud.hostava.pl/v1/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': hostavaIdempotencyKey(to, text, date), 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, text }), signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        // A gateway failure may occur after the upstream accepted the message.
        if (!response.ok) { results[index] = response.status >= 500 ? 'unknown' : 'failed'; continue; }
        const body = await response.json();
        results[index] = response.status === 202 && typeof body?.id === 'string' && body.id && body.status === 'QUEUED' ? 'accepted' : 'unknown';
      } catch { results[index] = 'unknown'; }
    }
  }));
  const accepted = results.filter(x => x === 'accepted').length;
  const unknown = results.filter(x => x === 'unknown').length;
  return {
    status: accepted === numbers.length ? 'accepted' : accepted ? 'partial' : unknown ? 'unknown' : 'failed',
    testMode: false, accepted, total: numbers.length, unknown, failed: numbers.length - accepted - unknown,
    message: unknown ? 'Nieznany wynik części wiadomości Hostava. Sprawdź panel operatora.' : accepted ? 'Hostava przyjęła wiadomości do kolejki. Nie jest to potwierdzenie doręczenia.' : 'Hostava odrzuciła wysyłkę. Sprawdź klucz API, numery i dostępny budżet.'
  };
}
