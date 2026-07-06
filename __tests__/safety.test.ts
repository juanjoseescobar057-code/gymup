// __tests__/safety.test.ts
// Tests de los PISOS DE SEGURIDAD nutricional. Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCaloriesToSafe, safeCalorieFloor, clampFatPct,
  ABSOLUTE_MIN_CALORIES, MIN_AGE,
} from '../lib/safety.ts';

test('el piso nunca baja de 1200 kcal absolutas', () => {
  // BMR bajo (persona muy pequeña) → piso = max(1200, bmr)
  assert.equal(safeCalorieFloor(900), ABSOLUTE_MIN_CALORIES);
});

test('el piso usa el BMR si es mayor que el mínimo absoluto', () => {
  assert.equal(safeCalorieFloor(1600), 1600);
});

test('clampCaloriesToSafe SUBE una meta peligrosamente baja', () => {
  // déficit que cae bajo el BMR → se corrige al BMR
  assert.equal(clampCaloriesToSafe(1000, 1500), 1500);
});

test('clampCaloriesToSafe NO toca una meta segura', () => {
  assert.equal(clampCaloriesToSafe(2200, 1500), 2200);
});

test('clampFatPct mantiene rango fisiológico', () => {
  assert.equal(clampFatPct(80), 60);   // tope
  assert.equal(clampFatPct(1), 3);     // mínimo
  assert.equal(clampFatPct(18), 18);   // normal
  assert.equal(clampFatPct(NaN), 0);   // basura
});

test('la edad mínima legal es 18', () => {
  assert.equal(MIN_AGE, 18);
});
