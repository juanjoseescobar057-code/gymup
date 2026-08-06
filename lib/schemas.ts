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
// Se usa solo donde un 0 es un valor ACEPTABLE (contadores, campos de adorno).
// Para lo que el usuario ve como un hecho —calorías, series, score— está
// `exigido()` más abajo: ahí un 0 inventado es peor que un error honesto.
const num = z.coerce.number().catch(0);
const str = z.string().catch('');
const strArr = z.array(z.string()).catch([]);

/**
 * Número que NO admite respaldo: si no viene o viene fuera de rango, el
 * esquema falla y parseAI lanza.
 *
 * El porqué: con `.catch(0)`, una respuesta mala se convertía en una comida de
 * 0 kcal registrada en el historial del usuario, o un ejercicio de 0 series
 * dentro de su plan. Datos falsos que parecen buenos son peores que un fallo:
 * el fallo se reintenta, el dato falso se arrastra y contamina macros,
 * progresión y las decisiones que la persona toma con eso.
 */
const exigido = (min: number, max: number) =>
  z.coerce.number().refine((n) => Number.isFinite(n) && n >= min && n <= max, {
    message: `debe estar entre ${min} y ${max}`,
  });

/**
 * Booleano de verdad.
 *
 * `z.coerce.boolean()` aplica la coerción de JavaScript: `Boolean("false")` es
 * TRUE porque la cadena no está vacía. Los modelos devuelven `"false"` como
 * texto con frecuencia, así que un "no" explícito del modelo se leía como "sí".
 * En `is_exercise_visible` eso significaba dar consejo de técnica sobre una
 * foto en la que el modelo acababa de decir que no veía el ejercicio.
 */
const bool = (respaldo: boolean) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'si', 'sí'].includes(s)) return true;
      if (['false', '0', 'no'].includes(s)) return false;
    }
    return undefined; // irreconocible → cae al respaldo
  }, z.boolean()).catch(respaldo);

// ── Plan de entrenamiento ────────────────────────────────
export const ExerciseSchema = z.object({
  // El nombre no puede venir vacío: un ejercicio sin nombre es una fila que el
  // usuario no puede ejecutar ni buscar en video.
  name: z.string().min(1),
  // Rangos fisiológicos. 12 series de un ejercicio ya es absurdo; 0 series
  // significa que el ejercicio no existe. Antes ambos pasaban como válidos.
  sets: exigido(1, 12),
  reps: z.coerce.string().refine((s) => s.trim().length > 0, { message: 'reps vacío' }),
  rest_seconds: exigido(0, 600),
  notes: str,
  muscle_group: str,
  target_rir: exigido(0, 10).optional(),
  intensity_method: z.enum(['none', 'drop_set']).optional().default('none'),
  exercise_id: z.string().min(1).optional(),
});

export const TrainingDaySchema = z.object({
  day: num,
  day_name: str,
  type: z.enum(['workout', 'rest', 'active_recovery']).catch('workout'),
  muscle_groups: strArr,
  estimated_duration_min: exigido(0, 240),
  exercises: z.array(ExerciseSchema).catch([]),
  notes: str.optional(),
  activities: strArr.optional(),
})
  // Coherencia entre el TIPO del día y su contenido. Un día de descanso con
  // ejercicios dentro es una contradicción que la app mostraba tal cual: la
  // tarjeta decía "hoy descansas" y el plan traía sentadillas.
  .transform((d) => (d.type === 'rest' ? { ...d, exercises: [] } : d))
  .refine((d) => d.type !== 'workout' || d.exercises.length > 0, {
    message: 'un día de entrenamiento no puede venir sin ejercicios',
  });

export const WeeklyPlanSchema = z.object({
  overview: str,
  // EXACTAMENTE 7. El día del plan avanza con `% 7`, así que un plan de 6 días
  // deja un índice apuntando a un día que no existe: la home se queda en
  // "Cargando tu plan…" para siempre sin decir por qué. Antes bastaba `.min(1)`.
  days: z.array(TrainingDaySchema).length(7),
});

// ── Análisis de comida ───────────────────────────────────
export const FoodResultSchema = z.object({
  meal_name: z.string().min(1),
  food_description: str,
  // Estos cuatro se ESCRIBEN en el historial nutricional y alimentan los
  // macros del día. Con `.catch(0)` una respuesta mala se registraba como una
  // comida de 0 kcal: el usuario creía haber logueado y sus macros mentían.
  // Mejor fallar y que reintente. Los topes son por COMIDA, no por día.
  calories: exigido(0, 5000),
  protein_g: exigido(0, 500),
  carbs_g: exigido(0, 800),
  fat_g: exigido(0, 400),
  fiber_g: exigido(0, 200),
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
  // Se muestran como números duros y se comparan en el tiempo: un 0 de
  // respaldo se leería como "tu score bajó a cero".
  overall_score: exigido(0, 100),
  estimated_fat_pct: exigido(3, 70),
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
  // Respaldo `false`: si no se entiende la respuesta, NO se analiza la foto.
  valid: bool(false),
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
  score: exigido(0, 100),
  overall: str,
  // Respaldo `true` a propósito: un campo AUSENTE no es lo mismo que un "no"
  // del modelo. Con `bool()`, un "false" explícito ya se respeta — que era el
  // fallo real; asumir "no visible" cuando el modelo simplemente omitió el
  // campo bloquearía análisis legítimos.
  is_exercise_visible: bool(true),
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
/**
 * Error de validación con la FORMA de lo que llegó adjunta.
 *
 * Nace de un caso real: un plan falló y el único rastro fue "11 tokens de
 * salida" en la telemetría. Hubo que deducir desde ahí que el modelo se había
 * NEGADO (una negativa mide ~11 tokens; un plan mide ~1.500). Con estos campos
 * se lee en el reporte en vez de deducirse.
 *
 * Lo que se adjunta es DELIBERADAMENTE estructural: claves, tipos y rutas del
 * esquema — nunca el contenido. La respuesta puede citar lo que el usuario
 * escribió en su tamizaje de salud, y Sentry no es sitio para datos de salud.
 * Las claves de nivel superior bastan para distinguir los dos casos que
 * importan: {"days":[...]} truncado vs {"error":"..."} de negativa.
 */
export class AIShapeError extends Error {
  readonly forma: {
    label: string;
    esJson: boolean;
    largo: number;
    clavesRaiz: string[];
    rutasFallidas: string[];
  };

  constructor(mensaje: string, forma: AIShapeError['forma']) {
    super(mensaje);
    this.name = 'AIShapeError';
    this.forma = forma;
  }
}

/** Claves de nivel superior, sin valores. Vacío si no es un objeto. */
function clavesDe(json: unknown): string[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  return Object.keys(json as Record<string, unknown>).slice(0, 12);
}

export function parseAI<T>(schema: z.ZodType<T>, raw: string, label: string): T {
  const largo = raw?.length ?? 0;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AIShapeError(
      `La IA devolvió una respuesta no válida (${label}). Intenta de nuevo.`,
      { label, esJson: false, largo, clavesRaiz: [], rutasFallidas: [] }
    );
  }
  const res = schema.safeParse(json);
  if (!res.success) {
    const rutasFallidas = (res.error.issues ?? [])
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.code}`);
    console.log(`[parseAI] "${label}" no cumple el esquema:`, JSON.stringify(rutasFallidas));
    throw new AIShapeError(
      `La IA devolvió datos incompletos (${label}). Intenta de nuevo.`,
      { label, esJson: true, largo, clavesRaiz: clavesDe(json), rutasFallidas }
    );
  }
  return res.data;
}
