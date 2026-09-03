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

/**
 * Lo que el tamizaje puede decir sobre un objetivo calórico.
 *
 * Los macros se calculaban con peso, altura, edad, sexo y objetivo. Nada más.
 * Alguien declaraba un trastorno de la conducta alimentaria, un embarazo o una
 * diabetes, y seguía recibiendo el mismo déficit de 400 kcal que cualquier
 * otro — con el objetivo "perder grasa" que había elegido antes.
 *
 * Esto NO calcula nutrición clínica: eso no se hace desde una app. Lo que hace
 * es impedir que la app prescriba un déficit a quien no debe recibirlo, y
 * decirlo.
 */
export type AjusteClinico = {
  /** El objetivo calórico se lleva a mantenimiento. */
  sinDeficit: boolean;
  /** Por qué, en una frase para la persona. Null = no se ajustó nada. */
  motivo: string | null;
  /** Recomendar hablar con un profesional. */
  derivar: boolean;
};

const SIN_DEFICIT: Record<string, { motivo: string; derivar: boolean }> = {
  // El déficit calórico es el mecanismo de la enfermedad, no una herramienta.
  trastorno_alimentario: {
    motivo:
      'Marcaste un trastorno de la conducta alimentaria, así que no te proponemos comer por ' +
      'debajo de tu gasto. Tus calorías están en mantenimiento.',
    derivar: true,
  },
  embarazo: {
    motivo:
      'Durante el embarazo y la lactancia no se recomienda un déficit calórico. Tus calorías ' +
      'están en mantenimiento; los ajustes los decide tu profesional de salud.',
    derivar: true,
  },
  // La restricción cambia el manejo de la glucemia y de la medicación.
  diabetes: {
    motivo:
      'Con diabetes declarada no ajustamos tus calorías a la baja por nuestra cuenta: un cambio ' +
      'de ingesta afecta a tu glucemia y a tu medicación.',
    derivar: true,
  },
  enfermedad_renal: {
    motivo:
      'Con enfermedad renal declarada, la proteína y las calorías las decide tu profesional de ' +
      'salud, no una app.',
    derivar: true,
  },
};

/**
 * Qué hacer con el objetivo calórico según el tamizaje.
 * PURA: entra la lista de condiciones y la edad, sale la decisión.
 */
export function ajusteClinicoDeMacros(
  conditions: string[] | null | undefined,
  age?: number
): AjusteClinico {
  const cs = conditions ?? [];
  for (const [clave, info] of Object.entries(SIN_DEFICIT)) {
    if (cs.includes(clave)) {
      return { sinDeficit: true, motivo: info.motivo, derivar: info.derivar };
    }
  }
  // Menores de edad: la app ya exige 18 en el registro, pero el objetivo puede
  // venir de un perfil viejo. Un déficit prescrito a alguien en crecimiento no
  // es un caso que se deje al azar de una validación de formulario.
  if (typeof age === 'number' && age < 18) {
    return {
      sinDeficit: true,
      motivo: 'Tus calorías están en mantenimiento: no proponemos déficits antes de los 18 años.',
      derivar: true,
    };
  }
  return { sinDeficit: false, motivo: null, derivar: false };
}

export function calculateDailyMacros(
  profile: MacroProfile,
  /**
   * Condiciones declaradas en el tamizaje. Opcional para no romper a quien ya
   * llama a esta función, pero SIN ella el cálculo es el de antes: quien la
   * omite está decidiendo no mirar la salud.
   */
  conditions?: string[] | null
): DailyMacros {
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
  // EL TAMIZAJE MANDA SOBRE EL OBJETIVO. Si hay una condición que desaconseja
  // el déficit, el objetivo calórico se lleva a mantenimiento — aunque la
  // persona tenga "perder grasa" elegido de antes. Es la misma lógica que el
  // veto de ejercicios: lo que se declaró pesa más que lo que se pidió.
  const clinico = ajusteClinicoDeMacros(conditions, profile.age);
  const objetivo = clinico.sinDeficit ? tdee : ca[profile.goal];
  const calories = clampCaloriesToSafe(objetivo, bmr);
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
