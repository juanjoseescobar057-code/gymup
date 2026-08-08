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

// La rama que faltaba: riesgo ALTO con autorización médica. Es la única que
// llega al return final con level 'alto', y ahí la puerta entregaba la copia
// pensada para el riesgo BAJO — a una embarazada autorizada le decía
// literalmente lo mismo que a alguien de 25 años sin nada.
test('riesgo alto autorizado recibe su propio aviso, no el de una persona sana', () => {
  const h = { ...EMPTY_HEALTH, conditions: ['embarazo' as const], doctor_cleared: true };
  const alto = evaluateWorkoutAccess(h, 32);
  assert.equal(alto.status, 'allowed');
  assert.equal(alto.level, 'alto');

  const sano = evaluateWorkoutAccess({ ...EMPTY_HEALTH }, 25);
  assert.notEqual(alto.title, sano.title, 'no puede compartir título con una persona sin riesgo');
  assert.notEqual(alto.detail, sano.detail, 'ni el detalle');
  assert.match(alto.detail, /médico|autoriz/i, 'debe mencionar la autorización médica');
});

test('el nivel alto autorizado sigue permitiendo entrenar', () => {
  // Bloquear a quien SÍ trajo la autorización sería castigar el hacer las
  // cosas bien, y dejaría inalcanzables las adaptaciones que la app construyó
  // precisamente para esos perfiles.
  const h = { ...EMPTY_HEALTH, conditions: ['cardiopatia' as const], doctor_cleared: true };
  assert.equal(evaluateWorkoutAccess(h, 40).status, 'allowed');
});

// El fixture de arriba solo tiene UN ejercicio con el mismo nombre en el antes
// y el después, así que el emparejamiento por índice nunca podía fallar. Una
// regeneración con IA sí reordena y elimina. Y este resumen es lo ÚNICO que la
// persona lee antes de sobrescribir su plan.
function dia1(ejercicios: { name: string; sets: number }[]): WeeklyPlan {
  return {
    overview: '',
    days: Array.from({ length: 7 }, (_, i) => ({
      day: i + 1, day_name: `Día ${i + 1}`, type: i === 0 ? 'workout' : 'rest',
      muscle_groups: i === 0 ? ['pecho'] : [], estimated_duration_min: i === 0 ? 30 : 0,
      exercises: i === 0
        ? ejercicios.map((e) => ({
            name: e.name, sets: e.sets, reps: '8-10', rest_seconds: 60, notes: '',
            muscle_group: 'pecho', target_rir: 2, intensity_method: 'none' as const,
          }))
        : [],
    })),
  } as WeeklyPlan;
}

test('eliminar el PRIMER ejercicio no se describe como una sustitución', () => {
  const antes = dia1([{ name: 'Press banca', sets: 4 }, { name: 'Curl bíceps', sets: 3 }]);
  const despues = dia1([{ name: 'Curl bíceps', sets: 3 }]);
  const cambios = summarizePlanChanges(antes, despues);

  // Lo único que pasó: se retiró el press. El curl quedó intacto.
  assert.deepEqual(cambios, [{ day: 'Día 1', exercise: 'Press banca', change: 'Retirado' }]);
  const preview = planChangePreview(antes, despues);
  assert.doesNotMatch(preview, /→/, 'no debe inventar una sustitución');
});

test('reordenar sin cambiar nada no reporta cambios', () => {
  const antes = dia1([{ name: 'Press banca', sets: 4 }, { name: 'Curl bíceps', sets: 3 }]);
  const despues = dia1([{ name: 'Curl bíceps', sets: 3 }, { name: 'Press banca', sets: 4 }]);
  assert.deepEqual(summarizePlanChanges(antes, despues), []);
});

test('un ejercicio nuevo se reporta como añadido, no como sustitución', () => {
  const antes = dia1([{ name: 'Press banca', sets: 4 }]);
  const despues = dia1([{ name: 'Aperturas', sets: 3 }, { name: 'Press banca', sets: 4 }]);
  assert.deepEqual(summarizePlanChanges(antes, despues), [
    { day: 'Día 1', exercise: 'Aperturas', change: 'Añadido' },
  ]);
});

test('cambiar series de un ejercicio reordenado se atribuye al ejercicio correcto', () => {
  const antes = dia1([{ name: 'Press banca', sets: 4 }, { name: 'Curl bíceps', sets: 3 }]);
  const despues = dia1([{ name: 'Curl bíceps', sets: 5 }, { name: 'Press banca', sets: 4 }]);
  assert.deepEqual(summarizePlanChanges(antes, despues), [
    { day: 'Día 1', exercise: 'Curl bíceps', change: 'series 3 → 5' },
  ]);
});
