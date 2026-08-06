import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompletedSets } from '../lib/workoutValidation';

test('normaliza nombres y conserva todas las métricas de la serie', () => {
  assert.deepEqual(normalizeCompletedSets([{
    exercise_name: '  Press de banca  ', set_number: 1, weight_kg: 80, reps: 8, rir: 2,
  }]), [{ exercise_name: 'Press de banca', set_number: 1, weight_kg: 80, reps: 8, rir: 2 }]);
});

test('una serie dañada se rechaza; nunca desaparece silenciosamente', () => {
  assert.throws(() => normalizeCompletedSets([
    { exercise_name: 'Press', set_number: 1, weight_kg: 50, reps: 8 },
    { exercise_name: 'Press', set_number: 2, weight_kg: 50, reps: 0 },
  ]), /repeticiones inválidas/);
});

test('rechaza duplicados que colisionarían en la transacción', () => {
  assert.throws(() => normalizeCompletedSets([
    { exercise_name: 'Sentadilla', set_number: 1, weight_kg: 60, reps: 10 },
    { exercise_name: ' sentadilla ', set_number: 1, weight_kg: 60, reps: 10 },
  ]), /duplicada/);
});
