// __tests__/prs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epley1RM, bestFromSets, detectNewPRs } from '../lib/prs.ts';

test('epley1RM: 1 rep devuelve el peso', () => {
  assert.equal(epley1RM(100, 1), 100);
});

test('epley1RM: fórmula de Epley para varias reps', () => {
  // 100 * (1 + 10/30) = 133.3 → 133
  assert.equal(epley1RM(100, 10), 133);
});

test('epley1RM: entradas inválidas devuelven 0', () => {
  assert.equal(epley1RM(0, 5), 0);
  assert.equal(epley1RM(50, 0), 0);
});

test('bestFromSets toma el máximo de cada métrica', () => {
  const best = bestFromSets([
    { weight_kg: 80, reps: 8 },
    { weight_kg: 100, reps: 3 },
    { weight_kg: 60, reps: 15 },
  ]);
  assert.equal(best.maxWeight, 100);
  assert.equal(best.maxReps, 15);
  // mejor e1RM: 100*(1+3/30)=110 vs 80*(1+8/30)=101 vs 60*(1+15/30)=90
  assert.equal(best.best1RM, 110);
});

test('detectNewPRs: sin histórico previo NO es PR (línea base)', () => {
  const r = detectNewPRs([{ weight_kg: 100, reps: 5 }], null);
  assert.equal(r.any, false);
});

test('detectNewPRs: detecta PR de peso y e1RM', () => {
  const prev = { maxWeight: 90, maxReps: 10, best1RM: 110 };
  const r = detectNewPRs([{ weight_kg: 100, reps: 5 }], prev); // e1RM=115, peso 100>90
  assert.equal(r.weight, true);
  assert.equal(r.e1rm, true);
  assert.equal(r.reps, false);
  assert.equal(r.any, true);
});

test('detectNewPRs: sin mejora no marca PR', () => {
  const prev = { maxWeight: 200, maxReps: 20, best1RM: 250 };
  const r = detectNewPRs([{ weight_kg: 100, reps: 5 }], prev);
  assert.equal(r.any, false);
});
