// lib/macros.ts
// ─────────────────────────────────────────────────────────
// Cálculo de macros (Mifflin-St Jeor) con PISOS DE SEGURIDAD.
// Módulo PURO (sin dependencias de React Native) para que sea
// testeable de forma aislada.
// ─────────────────────────────────────────────────────────

import type { UserProfile, BiologicalSex } from './supabase';
import { clampCaloriesToSafe } from './safety';

export type MacroProfile = Pick<
  UserProfile,
  'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'
>;

export type DailyMacros = {
  daily_calories: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
};

// Constante de sexo de Mifflin-St Jeor. 'unspecified' usa el punto medio entre
// +5 y -161: así el error máximo de quien prefiere no decirlo queda en ±83 kcal
// en vez de los ±166 que costaba asumir la constante masculina para todo el
// mundo. Es una estimación, no una medición: el piso de seguridad de safety.ts
// se sigue aplicando después sobre la meta final.
const SEX_CONSTANT: Record<BiologicalSex, number> = {
  male: 5,
  female: -161,
  unspecified: -78,
};

/** BMR de Mifflin-St Jeor. Puro y exportado para poder testearlo aislado. */
export function mifflinStJeorBMR(p: {
  sex: BiologicalSex;
  weight_kg: number;
  height_cm: number;
  age: number;
}): number {
  // Los perfiles creados antes de que existiera la columna llegan sin sexo:
  // se tratan como 'unspecified' en vez de reintroducir el sesgo masculino.
  const c = SEX_CONSTANT[p.sex] ?? SEX_CONSTANT.unspecified;
  return 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + c;
}

export function calculateDailyMacros(profile: MacroProfile): DailyMacros {
  const bmr = mifflinStJeorBMR(profile);
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
  // PISO DE PROTEÍNA por kg de peso: el reparto por porcentaje se queda corto
  // en personas pesadas con pocas calorías. El rango 1.6-2.2 g/kg es el consenso
  // para preservar masa magra, y pesa más en déficit y en ganancia que en los
  // objetivos de rendimiento, donde el carbohidrato manda.
  const pf: Record<string, number> = {
    muscle_gain: 1.6,
    fat_loss:    1.6,
    performance: 1.4,
    endurance:   1.4,
  };
  const proteinByPct = Math.round(calories * r.p / 4);
  const protein = Math.max(proteinByPct, Math.round(profile.weight_kg * pf[profile.goal]));
  // Las kcal que suma el piso se descuentan de los carbos (mismo 4 kcal/g, así
  // que el intercambio es 1:1 en gramos) para no inflar el total ya acotado.
  const carbs = Math.max(0, Math.round(calories * r.c / 4) - (protein - proteinByPct));
  return {
    daily_calories:  calories,
    daily_protein_g: protein,
    daily_carbs_g:   carbs,
    daily_fat_g:     Math.round(calories * r.f / 9),
  };
}
