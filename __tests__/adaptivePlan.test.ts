// __tests__/adaptivePlan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepsHigh, progressionAdvice, summarizePerformance } from '../lib/adaptivePlanMath.ts';

test('parseRepsHigh toma el tope de un rango', () => {
  assert.equal(parseRepsHigh('8-10'), 10);
  assert.equal(parseRepsHigh('12'), 12);
  assert.equal(parseRepsHigh('AMRAP'), 0);
});

test('progressionAdvice: superar objetivo → progresar', () => {
  assert.equal(progressionAdvice(12, 10), 'progresar');
});

test('progressionAdvice: cumplir objetivo → mantener', () => {
  assert.equal(progressionAdvice(10, 10), 'mantener');
  assert.equal(progressionAdvice(9, 10), 'mantener'); // dentro de 2 reps
});

test('progressionAdvice: quedarse corto → deload', () => {
  assert.equal(progressionAdvice(6, 10), 'deload');
});

test('summarizePerformance agrupa por ejercicio', () => {
  const txt = summarizePerformance([
    { exercise_name: 'Sentadilla', weight_kg: 100, reps: 5, logged_at: '2026-06-30' },
    { exercise_name: 'Sentadilla', weight_kg: 90, reps: 8, logged_at: '2026-06-28' },
  ]);
  assert.ok(txt.includes('Sentadilla'));
  assert.ok(txt.includes('100kg')); // mejor peso
});
