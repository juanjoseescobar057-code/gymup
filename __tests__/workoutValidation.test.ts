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

// Este test EXIGÍA que un número de serie repetido tumbara el lote entero.
// Consagraba un defecto: el número de serie se cuenta por hueco del día, así
// que sustituir un ejercicio por otro que ya está en la sesión produce
// repetidos LEGÍTIMOS — y con el rechazo, el entrenamiento completo quedaba
// imposible de guardar para siempre, porque el reintento manda lo mismo y la
// app no deja editar ni borrar una serie ya registrada.
test('un ejercicio repetido en el día se renumera; no se pierde ninguna serie', () => {
  const r = normalizeCompletedSets([
    { exercise_name: 'Sentadilla', set_number: 1, weight_kg: 60, reps: 10 },
    { exercise_name: 'Sentadilla', set_number: 2, weight_kg: 60, reps: 10 },
    // Segundo hueco del día con el MISMO ejercicio: vuelve a empezar en 1.
    { exercise_name: ' sentadilla ', set_number: 1, weight_kg: 70, reps: 8 },
    { exercise_name: ' sentadilla ', set_number: 2, weight_kg: 70, reps: 8 },
  ]);
  assert.equal(r.length, 4, 'no se descarta ninguna serie');
  assert.deepEqual(r.map((s) => s.set_number), [1, 2, 3, 4]);
  // Los pesos reales se conservan en el orden en que se hicieron.
  assert.deepEqual(r.map((s) => s.weight_kg), [60, 60, 70, 70]);
});

test('la renumeración no colisiona con ejercicios distintos', () => {
  const r = normalizeCompletedSets([
    { exercise_name: 'Sentadilla', set_number: 1, weight_kg: 60, reps: 10 },
    { exercise_name: 'Peso muerto', set_number: 1, weight_kg: 90, reps: 5 },
    { exercise_name: 'Sentadilla', set_number: 1, weight_kg: 65, reps: 8 },
  ]);
  assert.deepEqual(
    r.map((s) => `${s.exercise_name}#${s.set_number}`),
    ['Sentadilla#1', 'Peso muerto#1', 'Sentadilla#2'],
  );
});
