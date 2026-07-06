// __tests__/analyticsMath.test.ts
// node --import tsx --test __tests__/analyticsMath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRotateSession, makeId, pickAcquisitionParams, SESSION_GAP_MS,
} from '../lib/analyticsMath';

test('shouldRotateSession: primera vez siempre rota', () => {
  assert.equal(shouldRotateSession(null, Date.parse('2026-07-04T10:00:00Z')), true);
});

test('shouldRotateSession: dentro del gap NO rota, pasado el gap SÍ', () => {
  const now = 1_000_000_000;
  assert.equal(shouldRotateSession(now - SESSION_GAP_MS + 1000, now), false);
  assert.equal(shouldRotateSession(now - SESSION_GAP_MS - 1000, now), true);
});

test('makeId: prefijo + tiempo ordenable + sufijo', () => {
  const id = makeId('s', 1234567890, 'abc123');
  assert.ok(id.startsWith('s_'));
  assert.ok(id.endsWith('abc123'));
});

test('pickAcquisitionParams: solo llaves conocidas y strings sanas', () => {
  const out = pickAcquisitionParams({
    utm_source: 'instagram',
    utm_campaign: 'reto_enero',
    fbclid: 'x'.repeat(50),
    hacker: 'ignorado',
    utm_medium: 123 as any,         // no-string: fuera
    utm_term: 'y'.repeat(500),      // muy largo: fuera
  });
  assert.deepEqual(out, {
    utm_source: 'instagram',
    utm_campaign: 'reto_enero',
    fbclid: 'x'.repeat(50),
  });
  assert.deepEqual(pickAcquisitionParams(null), {});
});
