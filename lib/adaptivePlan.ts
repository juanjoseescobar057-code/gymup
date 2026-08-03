// lib/adaptivePlan.ts
// ─────────────────────────────────────────────────────────
// Re-planificación adaptativa: lee el desempeño real (set_logs) y pide a
// GPT-4o ajustar el plan (progresar / mantener / deload / sustituir).
// Cierra el bucle "el coach aprende de ti".
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { aiChatContent } from './aiClient';
import { parseAI, WeeklyPlanSchema } from './schemas';
import { AI_SAFETY_RULES } from './safety';
import { summarizePerformance, type PerfRow } from './adaptivePlanMath';
import { loadHealthSafe, clearPlanStaleForHealth } from './health';
import { healthToPrompt } from './healthMath';
import type { UserProfile, WeeklyPlan, BiologicalSex } from './supabase';

// Re-export de la lógica pura (vive en adaptivePlanMath para ser testeable).
export { parseRepsHigh, progressionAdvice, summarizePerformance } from './adaptivePlanMath';
export type { Advice } from './adaptivePlanMath';

// El plan inicial ya se genera con el sexo biológico; la re-planificación
// REEMPLAZA ese plan, así que si aquí no viaja el dato el usuario pierde en la
// semana 2 lo que se programó bien en la semana 1.
const SEX_LABELS: Record<BiologicalSex, string> = {
  male: 'hombre',
  female: 'mujer',
  unspecified: 'no declarado',
};

/**
 * Regenera el plan adaptado al desempeño real. Devuelve el nuevo WeeklyPlan
 * (validado). Lanza si no hay IA o el JSON es inválido.
 */
export async function regenerateAdaptivePlan(
  profile: Pick<UserProfile, 'user_id' | 'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'>,
  currentPlan: WeeklyPlan
): Promise<WeeklyPlan> {
  // Perfiles anteriores a la columna `sex` llegan sin ella: 'unspecified' (neutro)
  // en vez del sesgo masculino por defecto.
  const sex: BiologicalSex = SEX_LABELS[profile.sex] ? profile.sex : 'unspecified';
  // Desempeño de las últimas ~2 semanas.
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data } = await supabase
    .from('set_logs')
    .select('exercise_name, weight_kg, reps, logged_at')
    .eq('user_id', profile.user_id)
    .gte('logged_at', since)
    .order('logged_at', { ascending: false })
    .limit(500);

  const perf = summarizePerformance((data ?? []) as PerfRow[]);

  // Directivas de salud: el plan adaptado respeta lesiones/condiciones/edad.
  // ESTRICTO: un plan generado "a ciegas" persiste en la BD y guía semanas de
  // entrenamiento — si no se puede verificar la salud, NO se genera.
  const healthLoad = await loadHealthSafe(profile.user_id);
  if (healthLoad.status === 'unknown') {
    throw new Error(
      'Por tu seguridad no ajustamos el plan sin verificar tu perfil de salud. Revisa tu conexión e intenta de nuevo.'
    );
  }
  // Defensa en profundidad: "ok sin tamizaje" a esta altura casi siempre es
  // síntoma de un perfil perdido (todo usuario pasa por el tamizaje en el
  // onboarding) → plan conservador, nunca asumir "sano verificado".
  const healthBlock = healthLoad.profile
    ? healthToPrompt(healthLoad.profile, profile.age, sex)
    : 'NOTA DE SEGURIDAD: este usuario no tiene tamizaje de salud registrado. Genera un plan CONSERVADOR: sin técnicas de intensidad, sin trabajo al fallo ni máximos, progresión gradual, y recuérdale en el overview completar su perfil de salud en Perfil → Salud.';

  const content = await aiChatContent({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Entrenador personal élite. ${AI_SAFETY_RULES}
${healthBlock ? `\n${healthBlock}\n` : ''}
Ajusta el plan semanal de este usuario según su DESEMPEÑO REAL de las últimas 2 semanas.

Usuario: ${profile.age} años, sexo biológico ${SEX_LABELS[sex]}, ${profile.weight_kg}kg, ${profile.height_cm}cm, objetivo ${profile.goal}, actividad ${profile.activity_level}.
${sex === 'unspecified'
  ? 'Sexo no declarado: ajusta el plan de forma neutra. No lo deduzcas del objetivo, del peso ni de los ejercicios que registró, ni cambies nada por esa suposición.'
  : 'Usa el sexo solo como dato fisiológico (tolerancia al volumen, frecuencia y recuperación). PROHIBIDO bajar cargas, series o exigencia por él: si algo choca, MANDAN el objetivo declarado, el desempeño real y las directivas de salud.'}

Desempeño registrado (peso × reps):
${perf}

Reglas de ajuste:
- Si superó las reps objetivo con holgura → sube el peso ~2.5-5% (progresión).
- Si cumplió el objetivo → mantén y sube reps.
- Si se estancó o falló reps → baja el peso ~10% (deload) esa semana.
- Si un ejercicio no tiene registros (lo saltó siempre) → puedes sustituirlo por una alternativa del mismo grupo.
- Mantén la estructura de 7 días con sus descansos y el objetivo del usuario.

Plan actual (para referencia):
${JSON.stringify(currentPlan).slice(0, 4000)}

Devuelve SOLO el JSON del nuevo plan con la MISMA estructura:
{ "overview": "...", "days": [ { "day":1, "day_name":"Lunes", "type":"workout", "muscle_groups":[], "estimated_duration_min":55, "exercises":[ { "name":"", "sets":4, "reps":"8-10", "rest_seconds":90, "notes":"", "muscle_group":"" } ] } ] }
Incluye los 7 días.`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.6,
  }, 'plan');

  return parseAI(WeeklyPlanSchema, content, 'plan adaptado') as WeeklyPlan;
}

/**
 * Genera el PRIMER plan de alguien que no tiene ninguno y lo guarda.
 *
 * Existe porque faltaba: si la IA fallaba durante el onboarding, el usuario
 * entraba a la app sin plan y sin ninguna forma de conseguir uno.
 * regenerateAdaptivePlan no servía —exige un plan previo que adaptar— así que
 * el mensaje que le prometía "puedes generar tu plan más tarde" era falso: la
 * única salida real era rehacer el onboarding entero.
 *
 * LIMITACIÓN CONOCIDA: experiencia, días por semana y equipamiento se preguntan
 * en el onboarding pero todavía no tienen columna en user_profiles, así que
 * aquí no están disponibles y el generador cae a sus valores por defecto. El
 * plan sale bien, pero menos afinado que el del onboarding. Se arregla cuando
 * esos tres campos tengan columna propia.
 */
export async function generateFirstPlan(
  profile: Pick<UserProfile, 'user_id' | 'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'>
): Promise<any> {
  const { generateTrainingPlan } = await import('./openai');
  // Import diferido: openai.ts y adaptivePlan.ts comparten schemas y safety, y
  // un import estático cruzado entre ambos crea un ciclo en Metro.
  const salud = await loadHealthSafe(profile.user_id);
  // status 'unknown' = no se pudo LEER el tamizaje (no que no exista). Generar
  // ahí trataría como sano a alguien que pudo declarar una lesión, así que se
  // aborta y se le pide reintentar. 'ok' y 'cached' sí traen el perfil real.
  if (salud.status === 'unknown') {
    throw new Error('No pudimos leer tu perfil de salud. Revisa tu conexión e intenta de nuevo.');
  }
  const plan = await generateTrainingPlan(
    {
      age: profile.age,
      sex: profile.sex,
      weight_kg: profile.weight_kg,
      height_cm: profile.height_cm,
      goal: profile.goal,
      activity_level: profile.activity_level,
    },
    salud.profile
  );
  return saveAdaptedPlan(profile.user_id, plan);
}

/** Guarda el nuevo plan como activo y reinicia el día del plan. */
export async function saveAdaptedPlan(userId: string, plan: WeeklyPlan): Promise<any> {
  // Orden seguro: primero INSERTAR el plan nuevo; solo si eso funciona,
  // desactivar los anteriores. (Al revés, un insert fallido dejaba al
  // usuario sin NINGÚN plan activo y la UI igual mostraba éxito.)
  const { data: saved, error: insertError } = await supabase
    .from('training_plans')
    .insert({ user_id: userId, week_number: 1, plan_data: plan, is_active: true })
    .select()
    .single();
  if (insertError || !saved) {
    throw new Error('No se pudo guardar el plan: ' + (insertError?.message ?? 'sin datos'));
  }

  await supabase
    .from('training_plans')
    .update({ is_active: false })
    .eq('user_id', userId)
    .neq('id', saved.id);
  await supabase.from('user_profiles').update({ current_plan_day: 0 }).eq('user_id', userId);
  // El plan nuevo YA incorpora la salud actual: limpiar el recordatorio.
  clearPlanStaleForHealth(userId);
  return saved;
}
