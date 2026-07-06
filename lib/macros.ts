// lib/macros.ts
// ─────────────────────────────────────────────────────────
// Cálculo de macros (Mifflin-St Jeor) con PISOS DE SEGURIDAD.
// Módulo PURO (sin dependencias de React Native) para que sea
// testeable de forma aislada.
// ─────────────────────────────────────────────────────────

import type { UserProfile } from './supabase';
import { clampCaloriesToSafe } from './safety';

export type MacroProfile = Pick<
  UserProfile,
  'age' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'
>;

export type DailyMacros = {
  daily_calories: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
};

export function calculateDailyMacros(profile: MacroProfile): DailyMacros {
  const bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + 5;
  const am: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  const tdee = bmr * am[profile.activity_level];
  const ca: Record<string, number> = {
    muscle_gain: tdee + 300,
    fat_loss: tdee - 400,
    performance: tdee + 100,
    endurance: tdee + 50,
  };
  // PISO DE SEGURIDAD: nunca por debajo del BMR ni del mínimo absoluto.
  // Evita prescribir déficits peligrosos (sobre todo en personas pequeñas,
  // donde tdee - 400 podría caer por debajo del metabolismo basal).
  const calories = clampCaloriesToSafe(ca[profile.goal], bmr);
  const mr: Record<string, { p: number; c: number; f: number }> = {
    muscle_gain: { p: 0.30, c: 0.45, f: 0.25 },
    fat_loss:    { p: 0.35, c: 0.35, f: 0.30 },
    performance: { p: 0.25, c: 0.50, f: 0.25 },
    endurance:   { p: 0.20, c: 0.55, f: 0.25 },
  };
  const r = mr[profile.goal];
  return {
    daily_calories:  calories,
    daily_protein_g: Math.round(calories * r.p / 4),
    daily_carbs_g:   Math.round(calories * r.c / 4),
    daily_fat_g:     Math.round(calories * r.f / 9),
  };
}
