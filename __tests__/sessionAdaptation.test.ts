import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptSessionExercises, sessionAdaptationMessage } from '../lib/sessionAdaptation';

const plan = [
  { name: 'Compuesto', sets: 4, rest_seconds: 180, target_rir: 2 },
  { name: 'Secundario', sets: 4, rest_seconds: 120, target_rir: 2 },
  { name: 'Accesorio', sets: 3, rest_seconds: 60, target_rir: 2 },
  { name: 'Final', sets: 3, rest_seconds: 60, target_rir: 2 },
];

test('20 minutos conserva prioridades sin mutar el plan original', () => {
  const adapted = adaptSessionExercises(plan, { availableMinutes: 20, energy: 4, soreness: 1 });
  assert.equal(adapted.length, 2);
  assert.deepEqual(adapted.map((x) => x.sets), [3, 2]);
  assert.equal(adapted[0].rest_seconds, 90);
  assert.equal(plan[0].sets, 4);
});

test('baja energía autoregula solo hoy con menos volumen y RIR conservador', () => {
  const adapted = adaptSessionExercises(plan, { availableMinutes: 60, energy: 2, soreness: 2 });
  assert.deepEqual(adapted.map((x) => x.sets), [3, 3, 2, 2]);
  assert.ok(adapted.every((x) => x.target_rir === 3));
  assert.match(sessionAdaptationMessage({ availableMinutes: 60, energy: 2, soreness: 2 })!, /plan base no cambia/);
});

test('un día normal conserva toda la sesión', () => {
  assert.deepEqual(adaptSessionExercises(plan, { availableMinutes: 60, energy: 4, soreness: 2 }), plan);
});
