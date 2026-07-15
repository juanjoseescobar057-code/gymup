// lib/schemas.ts
// ─────────────────────────────────────────────────────────
// Validación con Zod de TODAS las respuestas JSON de GPT-4o.
//
// Antes se hacía JSON.parse(...) a ciegas: si el modelo devolvía un
// campo de más/menos o texto fuera de JSON, la pantalla crasheaba o
// mostraba datos basura (calorías, % grasa). Aquí validamos y, si algo
// no cuadra, lanzamos un error claro para degradar con elegancia.
// ─────────────────────────────────────────────────────────

import { z } from 'zod';

// Número tolerante: acepta "12" o 12, y cae a 0 si viene basura.
const num = z.coerce.number().catch(0);
const str = z.string().catch('');
const strArr = z.array(z.string()).catch([]);

// ── Plan de entrenamiento ────────────────────────────────
export const ExerciseSchema = z.object({
  name: str,
  sets: num,
  reps: z.coerce.string().catch(''),
  rest_seconds: num,
  notes: str,
  muscle_group: str,
});

export const TrainingDaySchema = z.object({
  day: num,
  day_name: str,
  type: z.enum(['workout', 'rest', 'active_recovery']).catch('workout'),
  muscle_groups: strArr,
  estimated_duration_min: num,
  exercises: z.array(ExerciseSchema).catch([]),
  notes: str.optional(),
  activities: strArr.optional(),
});

export const WeeklyPlanSchema = z.object({
  overview: str,
  days: z.array(TrainingDaySchema).min(1),
});

// ── Análisis de comida ───────────────────────────────────
export const FoodResultSchema = z.object({
  meal_name: str,
  food_description: str,
  calories: num,
  protein_g: num,
  carbs_g: num,
  fat_g: num,
  fiber_g: num,
});

// ── Análisis corporal (pantalla body-scan) ───────────────
export const BodyZoneSchema = z.object({
  id: str,
  label: str,
  status: z.enum(['strength', 'focus', 'priority']).catch('focus'),
  message: str,
  tip: str,
});

export const BodyAnalysisSchema = z.object({
  overall_score: num,
  estimated_fat_pct: num,
  estimated_muscle_level: str,
  zones: z.array(BodyZoneSchema).catch([]),
  strengths: strArr,
  focus_areas: strArr,
  refined_plan_notes: str,
  motivation: str,
  prediction_30days: str,
  recovery_tips: strArr,
  sleep_tips: strArr,
});

// ── Validación de foto (body-scan) ───────────────────────
export const PhotoValidationSchema = z.object({
  valid: z.coerce.boolean().catch(false),
  reason: str,
});

// ── Coach de postura ─────────────────────────────────────
export const PostureCorrectionSchema = z.object({
  zone: str,
  issue: str,
  fix: str,
  severity: z.enum(['good', 'warn', 'error']).catch('warn'),
  cue: str,
});

export const StretchSchema = z.object({
  name: str,
  duration: str,
  how: str,
});

export const PostureResultSchema = z.object({
  score: num,
  overall: str,
  is_exercise_visible: z.coerce.boolean().catch(true),
  corrections: z.array(PostureCorrectionSchema).catch([]),
  encouragement: str,
  next_cue: str,
  // Riesgo por PATRÓN DE TÉCNICA observado (no diagnóstico médico de lesión existente).
  technique_risk: str,
  technique_risk_level: z.enum(['none', 'low', 'medium', 'high']).catch('none'),
  stretches: z.array(StretchSchema).catch([]),
});

// ── Nevera + recetas ─────────────────────────────────────
export const RecipeSchema = z.object({
  name: str,
  description: str,
  prep_time_min: num,
  cook_time_min: num,
  servings: num,
  goal_alignment: num,
  calories_per_serving: num,
  protein_g: num,
  carbs_g: num,
  fat_g: num,
  ingredients_used: strArr,
  missing_ingredients: strArr,
  steps: strArr,
  tip: str,
});

export const FridgeAnalysisSchema = z.object({
  detected_ingredients: z.array(z.object({
    name: str,
    estimated_quantity: str,
    protein_per_100g: num,
    carbs_per_100g: num,
    fat_per_100g: num,
  })).catch([]),
  quality_score: num,
  quality_message: str,
  recipes: z.array(RecipeSchema).catch([]),
  shopping_suggestion: str,
});

// ── Helper de parseo seguro ──────────────────────────────
/**
 * Parsea y valida una respuesta de IA. Lanza un error legible si el
 * JSON es inválido o no cumple el esquema, en vez de crashear la UI.
 */
export function parseAI<T>(schema: z.ZodType<T>, raw: string, label: string): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`La IA devolvió una respuesta no válida (${label}). Intenta de nuevo.`);
  }
  const res = schema.safeParse(json);
  if (!res.success) {
    console.log(`[parseAI] "${label}" no cumple el esquema:`, JSON.stringify(res.error.issues?.slice(0, 4)));
    throw new Error(`La IA devolvió datos incompletos (${label}). Intenta de nuevo.`);
  }
  return res.data;
}
