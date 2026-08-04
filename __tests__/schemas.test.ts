// __tests__/schemas.test.ts
// ─────────────────────────────────────────────────────────
// Los esquemas son la última defensa entre lo que devuelve un modelo y lo que
// se le muestra —y se le GUARDA— a una persona. No tenían ni una prueba.
//
// Cada caso de aquí sale de un fallo real o de un hallazgo de auditoría, no de
// imaginar entradas raras.
// ─────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAI, AIShapeError,
  WeeklyPlanSchema, FoodResultSchema, PostureResultSchema, PhotoValidationSchema,
} from '../lib/schemas.ts';

// Plan válido mínimo: 7 días, el primero de entrenamiento.
function planValido() {
  const dia = (n: number, type: 'workout' | 'rest') => ({
    day: n,
    day_name: `Día ${n}`,
    type,
    muscle_groups: type === 'workout' ? ['Pecho'] : [],
    estimated_duration_min: type === 'workout' ? 45 : 0,
    exercises: type === 'workout'
      ? [{ name: 'Press de banca', sets: 4, reps: '8-10', rest_seconds: 90, notes: '', muscle_group: 'Pecho' }]
      : [],
  });
  return {
    overview: 'Plan de prueba',
    days: [dia(1, 'workout'), dia(2, 'rest'), dia(3, 'workout'), dia(4, 'rest'),
           dia(5, 'workout'), dia(6, 'rest'), dia(7, 'rest')],
  };
}

// ── VAL-02: la coerción de booleanos ─────────────────────

test('"false" como texto NO se convierte en true', () => {
  // Con z.coerce.boolean() esto daba true, porque Boolean("false") es true.
  // Significaba analizar la postura de una foto en la que el modelo acababa
  // de decir que no veía el ejercicio.
  const r = PostureResultSchema.parse({
    score: 80, overall: 'ok', is_exercise_visible: 'false',
    corrections: [], encouragement: '', next_cue: '',
    technique_risk: '', technique_risk_level: 'none', stretches: [],
  });
  assert.equal(r.is_exercise_visible, false);
});

test('booleanos en varias formas que devuelven los modelos', () => {
  const base = { reason: '' };
  assert.equal(PhotoValidationSchema.parse({ ...base, valid: true }).valid, true);
  assert.equal(PhotoValidationSchema.parse({ ...base, valid: 'true' }).valid, true);
  assert.equal(PhotoValidationSchema.parse({ ...base, valid: 'no' }).valid, false);
  assert.equal(PhotoValidationSchema.parse({ ...base, valid: 0 }).valid, false);
  assert.equal(PhotoValidationSchema.parse({ ...base, valid: 1 }).valid, true);
});

test('un valor irreconocible cae al respaldo SEGURO (no analizar)', () => {
  assert.equal(PhotoValidationSchema.parse({ valid: {}, reason: '' }).valid, false);
});

// ── VAL-03: el plan debe traer los 7 días ────────────────

test('un plan de 6 días se rechaza', () => {
  // El día del plan avanza con % 7: con 6 días el índice apunta a un día que
  // no existe y la home se queda en "Cargando tu plan…" para siempre.
  const p = planValido();
  p.days = p.days.slice(0, 6);
  assert.equal(WeeklyPlanSchema.safeParse(p).success, false);
});

test('un plan de 7 días se acepta', () => {
  assert.equal(WeeklyPlanSchema.safeParse(planValido()).success, true);
});

// ── VAL-04/06: rangos y coherencia ───────────────────────

test('un ejercicio con 0 series se rechaza', () => {
  const p = planValido();
  p.days[0].exercises[0].sets = 0;
  assert.equal(WeeklyPlanSchema.safeParse(p).success, false);
});

test('un día de entrenamiento sin ejercicios se rechaza', () => {
  const p = planValido();
  p.days[0].exercises = [];
  assert.equal(WeeklyPlanSchema.safeParse(p).success, false);
});

test('un día de descanso con ejercicios queda limpio, no contradictorio', () => {
  const p = planValido();
  p.days[1].exercises = [
    { name: 'Sentadilla', sets: 4, reps: '10', rest_seconds: 90, notes: '', muscle_group: 'Pierna' },
  ];
  const r = WeeklyPlanSchema.parse(p);
  assert.equal(r.days[1].exercises.length, 0);
});

// ── VAL-01: basura que se hacía pasar por dato ───────────

test('una comida sin calorías se rechaza en vez de guardarse como 0 kcal', () => {
  // Con .catch(0) esto se registraba en el historial nutricional como una
  // comida real de cero calorías, y los macros del día mentían.
  const r = FoodResultSchema.safeParse({
    meal_name: 'Pollo', food_description: '', calories: 'no sé',
    protein_g: 30, carbs_g: 0, fat_g: 5, fiber_g: 0,
  });
  assert.equal(r.success, false);
});

test('una comida con valores absurdos se rechaza', () => {
  const r = FoodResultSchema.safeParse({
    meal_name: 'Pollo', food_description: '', calories: 99999,
    protein_g: 30, carbs_g: 0, fat_g: 5, fiber_g: 0,
  });
  assert.equal(r.success, false);
});

test('una comida normal pasa', () => {
  const r = FoodResultSchema.safeParse({
    meal_name: 'Pollo con arroz', food_description: 'pechuga y arroz',
    calories: 620, protein_g: 45, carbs_g: 70, fat_g: 12, fiber_g: 3,
  });
  assert.equal(r.success, true);
});

// ── parseAI: la forma del error ──────────────────────────

test('parseAI adjunta la FORMA de una negativa del modelo', () => {
  // El caso real: el modelo se negó a generar el plan y devolvió prosa en
  // JSON. El único rastro era "11 tokens" en la telemetría.
  try {
    parseAI(WeeklyPlanSchema, '{"error":"No puedo ayudarte con eso"}', 'plan');
    assert.fail('debió lanzar');
  } catch (e) {
    const err = e as AIShapeError;
    assert.equal(err.forma.esJson, true);
    assert.deepEqual(err.forma.clavesRaiz, ['error']);
    assert.ok(err.forma.rutasFallidas.length > 0);
  }
});

test('parseAI distingue una respuesta que ni siquiera es JSON', () => {
  try {
    parseAI(WeeklyPlanSchema, 'Lo siento, no puedo.', 'plan');
    assert.fail('debió lanzar');
  } catch (e) {
    const err = e as AIShapeError;
    assert.equal(err.forma.esJson, false);
    assert.equal(err.forma.clavesRaiz.length, 0);
  }
});
