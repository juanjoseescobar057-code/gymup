import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HEALTH, evaluateWorkoutAccess } from '../lib/healthMath';
import { planChangePreview, summarizePlanChanges } from '../lib/planDiff';
import type { WeeklyPlan } from '../lib/supabase';

test('síntoma de alarma bloquea aunque exista autorización antigua', () => {
  const access = evaluateWorkoutAccess({ ...EMPTY_HEALTH, parq_chest_pain: true, doctor_cleared: true }, 30);
  assert.equal(access.status, 'blocked');
});

test('riesgo alto sin autorización bloquea; riesgo moderado permite con cautela', () => {
  assert.equal(evaluateWorkoutAccess({ ...EMPTY_HEALTH, conditions: ['cardiopatia'] }, 40).status, 'blocked');
  const moderate = evaluateWorkoutAccess({ ...EMPTY_HEALTH, injuries: ['rodilla'] }, 40);
  assert.equal(moderate.status, 'allowed');
  assert.equal(moderate.level, 'moderado');
});

const plan = (sets: number, method: 'none' | 'drop_set' = 'none'): WeeklyPlan => ({
  overview: '',
  days: Array.from({ length: 7 }, (_, i) => ({
    day: i + 1, day_name: `Día ${i + 1}`, type: i === 0 ? 'workout' : 'rest',
    muscle_groups: i === 0 ? ['bíceps'] : [], estimated_duration_min: i === 0 ? 30 : 0,
    exercises: i === 0 ? [{ name: 'Curl bíceps', sets, reps: '8-12', rest_seconds: 60, notes: '', muscle_group: 'bíceps', target_rir: 2, intensity_method: method }] : [],
  })),
});

test('la vista previa explica series y técnica antes de aplicar', () => {
  const changes = summarizePlanChanges(plan(3), plan(4, 'drop_set'));
  assert.equal(changes.length, 1);
  const preview = planChangePreview(plan(3), plan(4, 'drop_set'));
  assert.match(preview, /series 3 → 4/);
  assert.match(preview, /dropset/);
});
