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
import type { UserProfile, WeeklyPlan } from './supabase';

// Re-export de la lógica pura (vive en adaptivePlanMath para ser testeable).
export { parseRepsHigh, progressionAdvice, summarizePerformance } from './adaptivePlanMath';
export type { Advice } from './adaptivePlanMath';

/**
 * Regenera el plan adaptado al desempeño real. Devuelve el nuevo WeeklyPlan
 * (validado). Lanza si no hay IA o el JSON es inválido.
 */
export async function regenerateAdaptivePlan(
  profile: Pick<UserProfile, 'user_id' | 'age' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'>,
  currentPlan: WeeklyPlan
): Promise<WeeklyPlan> {
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
    ? healthToPrompt(healthLoad.profile, profile.age)
    : 'NOTA DE SEGURIDAD: este usuario no tiene tamizaje de salud registrado. Genera un plan CONSERVADOR: sin técnicas de intensidad, sin trabajo al fallo ni máximos, progresión gradual, y recuérdale en el overview completar su perfil de salud en Perfil → Salud.';

  const content = await aiChatContent({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Entrenador personal élite. ${AI_SAFETY_RULES}
${healthBlock ? `\n${healthBlock}\n` : ''}
Ajusta el plan semanal de este usuario según su DESEMPEÑO REAL de las últimas 2 semanas.

Usuario: ${profile.age} años, ${profile.weight_kg}kg, ${profile.height_cm}cm, objetivo ${profile.goal}, actividad ${profile.activity_level}.

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
