// __tests__/macros.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDailyMacros } from '../lib/macros.ts';
import { ABSOLUTE_MIN_CALORIES } from '../lib/safety.ts';

test('persona promedio en fat_loss queda con macros razonables', () => {
  const m = calculateDailyMacros({
    age: 30, weight_kg: 80, height_cm: 178,
    goal: 'fat_loss', activity_level: 'moderate',
  });
  assert.ok(m.daily_calories >= ABSOLUTE_MIN_CALORIES);
  assert.ok(m.daily_protein_g > 0 && m.daily_carbs_g > 0 && m.daily_fat_g > 0);
});

test('persona muy pequeña sedentaria NUNCA baja del piso de seguridad', () => {
  const m = calculateDailyMacros({
    age: 60, weight_kg: 45, height_cm: 150,
    goal: 'fat_loss', activity_level: 'sedentary',
  });
  // Sin el piso, tdee - 400 podría ser peligrosamente bajo.
  assert.ok(m.daily_calories >= ABSOLUTE_MIN_CALORIES, `calorías=${m.daily_calories}`);
});

test('muscle_gain da más calorías que fat_loss para el mismo perfil', () => {
  const base = { age: 25, weight_kg: 75, height_cm: 175, activity_level: 'active' as const };
  const gain = calculateDailyMacros({ ...base, goal: 'muscle_gain' });
  const loss = calculateDailyMacros({ ...base, goal: 'fat_loss' });
  assert.ok(gain.daily_calories > loss.daily_calories);
});
