import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentSms, validateSmsText } from './sms-text.js';
import { sendHostava } from './hostava-sms.js';

test('alert SMS fits 70 UTF-16 units, keeps the test marker and application instruction', () => {
  assert.equal(incidentSms({ name: 'Pozar', location: 'Sala 1' }), 'ALERT: Pozar, Sala 1. Otworz aplikacje.');
  for (const isTest of [false, true]) {
    const text = incidentSms({ isTest, name: 'Długi rodzaj alertu '.repeat(20), location: '🔥 piętro '.repeat(30) });
    assert.ok(text.length <= 70);
    assert.ok(text.startsWith(isTest ? 'TEST ALERT:' : 'ALERT:'));
    assert.ok(text.endsWith('. Otworz aplikacje.'));
    assert.equal(text.isWellFormed(), true);
  }
  assert.equal(incidentSms({ name: 'Alert', location: 'Nie podano miejsca' }).includes('Nie podano'), false);
});

test('overlong SMS is rejected before Hostava is contacted and never silently truncates a link', async () => {
  assert.equal(validateSmsText('x'.repeat(70)).length, 70);
  assert.throws(() => validateSmsText('x'.repeat(71)), { status: 400 });
  assert.throws(() => validateSmsText(''), { status: 400 });
  let calls = 0;
  await assert.rejects(sendHostava({ token: 'fake', numbers: ['48500600700'], text: 'x'.repeat(71), fetchImpl: async () => { calls++; } }), { status: 400 });
  assert.equal(calls, 0);
});
