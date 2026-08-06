import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeExerciseProgress, chooseIntervention, type PerformanceSet } from '../lib/progressionEngine';

const row = (day: number, weight: number, reps = 8): PerformanceSet => ({
  exercise_name: 'Curl bíceps', weight_kg: weight, reps,
  logged_at: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`, session_id: `s${day}`,
});

test('no diagnostica meseta con evidencia escasa', () => {
  const p = analyzeExerciseProgress('Curl bíceps', [row(1, 10), row(8, 10)]);
  assert.equal(p.status, 'insufficient');
  assert.equal(chooseIntervention({ progress: p }).kind, 'collect_data');
});

test('detecta progreso por rendimiento estimado, no solo peso', () => {
  const p = analyzeExerciseProgress('Curl bíceps', [row(1, 10, 8), row(8, 10, 10), row(15, 10, 12)]);
  assert.equal(p.status, 'progressing');
});

test('dolor nuevo impide recomendar intensidad', () => {
  const p = analyzeExerciseProgress('Curl bíceps', [row(1, 10), row(8, 10), row(15, 10), row(22, 10)]);
  assert.equal(chooseIntervention({ progress: p, readiness: { painNew: true }, isIsolation: true, goal: 'muscle_gain' }).kind, 'health_review');
});

test('dropset queda acotado a aislamiento, hipertrofia y suficiente historial', () => {
  const p = analyzeExerciseProgress('Curl bíceps', [1, 6, 11, 16, 21, 26].map((d) => row(d, 10)));
  assert.equal(chooseIntervention({ progress: p, isIsolation: true, goal: 'muscle_gain' }).kind, 'dropset');
  assert.notEqual(chooseIntervention({ progress: p, isIsolation: false, goal: 'muscle_gain' }).kind, 'dropset');
});
