// lib/adaptivePlan.ts
// ─────────────────────────────────────────────────────────
// Re-planificación adaptativa: lee el desempeño real (set_logs) y pide a
// GPT-4o ajustar el plan (progresar / mantener / deload / sustituir).
// Cierra el bucle "el coach aprende de ti".
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { validarPlan } from './planValidator';
import { aiChatContent } from './aiClient';
import { parseAI, WeeklyPlanSchema } from './schemas';
import { AI_SAFETY_RULES } from './safety';
import { summarizePerformance, type PerfRow } from './adaptivePlanMath';
import { loadHealthSafe, clearPlanStaleForHealth, markPlanStaleForHealth } from './health';
import { healthToPrompt, evaluateWorkoutAccess } from './healthMath';
import type { UserProfile, WeeklyPlan, BiologicalSex } from './supabase';
import { analyzeExerciseProgress, chooseIntervention, type PerformanceSet } from './progressionEngine';
import { resumirReadiness, calcularAdherencia, type FilaReadiness } from './readinessMath';

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
  profile: Pick<UserProfile, 'user_id' | 'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level' | 'training_experience' | 'days_per_week' | 'equipment'>,
  currentPlan: WeeklyPlan,
  /**
   * Lo que el análisis corporal dijo que debería cambiar (refined_plan_notes).
   *
   * La IA lo escribía en cada análisis, se guardaba en body_scans.notes, y no
   * lo leía nadie: alguien se fotografiaba, recibía "tu plan debería enfocarse
   * más en core y menos volumen en espalda", y su plan seguía igual.
   *
   * Es una OBSERVACIÓN sobre una foto sin calibrar, no una medición: entra
   * como contexto y no puede pasar por encima del desempeño registrado, que
   * son datos reales. El prompt lo dice explícitamente.
   */
  notasCorporales?: string | null
): Promise<WeeklyPlan> {
  // Perfiles anteriores a la columna `sex` llegan sin ella: 'unspecified' (neutro)
  // en vez del sesgo masculino por defecto.
  const sex: BiologicalSex = SEX_LABELS[profile.sex] ? profile.sex : 'unspecified';
  // Seis semanas: dos semanas no bastan para distinguir una meseta de ruido,
  // enfermedad, una semana pesada o pocas exposiciones por ejercicio.
  const since = new Date(Date.now() - 42 * 86400000).toISOString();
  const { data } = await supabase
    .from('set_logs')
    .select('exercise_name, weight_kg, reps, rir, logged_at, session_id')
    .eq('user_id', profile.user_id)
    .gte('logged_at', since)
    .order('logged_at', { ascending: false })
    .limit(500);

  const perf = summarizePerformance((data ?? []) as PerfRow[]);
  const rows = (data ?? []) as PerformanceSet[];
  const exerciseNames = [...new Set(rows.map((r) => r.exercise_name))];
  const { data: readinessRows } = await supabase
    .from('workout_readiness')
    .select('energy, sleep_quality, soreness, stress, available_minutes, pain_new')
    .eq('user_id', profile.user_id)
    .gte('recorded_at', new Date(Date.now() - 28 * 86400000).toISOString())
    .order('recorded_at', { ascending: false })
    .limit(20);
  // resumirReadiness y no un promedio a mano: el de aquí usaba `?? 3` en cada
  // campo, o sea que convertía "no lo sé" en "está normal". Como 3 es el valor
  // neutro, eso diluía las señales reales hasta apagarlas — dos sesiones de
  // energía 2 entre ocho sin dato salían en 2.8 y no disparaban nada.
  // Ahora los nulos se omiten y lo desconocido llega como undefined.
  const readinessBase = resumirReadiness((readinessRows ?? []) as FilaReadiness[]);

  // LA ADHERENCIA, que hasta ahora no llegaba. chooseIntervention tiene una
  // rama que hace el plan más ejecutable por debajo del 70% de cumplimiento, y
  // el `?? 100` de progressionEngine la dejaba MUERTA: el motor presumía que
  // todo el mundo cumplía perfectamente y proponía técnicas avanzadas a quien
  // llevaba tres semanas sin aparecer. El propio código lo advertía en un
  // comentario y nadie lo había cableado.
  //
  // Se calcula igual que en el coach gratis (lib/consejosGratis.ts) y solo se
  // pasa cuando hay un número real: mandar un valor inventado sería volver
  // justo al problema que se está corrigiendo.
  const { data: sesiones } = await supabase
    .from('workout_sessions')
    .select('started_at')
    .eq('user_id', profile.user_id)
    .not('completed_at', 'is', null)
    .gte('started_at', new Date(Date.now() - 28 * 86400000).toISOString());

  const adherencia = calcularAdherencia({
    diasDeEntrenoPorSemana: profile.days_per_week ?? 0,
    sesionesCompletadas: (sesiones ?? []).map((r: { started_at: string }) => r.started_at),
    semanas: 4,
    hoyISO: new Date().toISOString(),
  });

  const readiness =
    readinessBase || adherencia.pct !== null
      ? {
          ...(readinessBase ?? {}),
          ...(adherencia.pct !== null ? { adherencePct: adherencia.pct } : {}),
        }
      : undefined;

  const diagnostics = exerciseNames.map((name) => {
    const progress = analyzeExerciseProgress(name, rows);
    const libraryName = name.toLowerCase();
    const isIsolation = /curl|extensi[oó]n|elevaci[oó]n|apertura|gemelo|tr[ií]ceps/i.test(libraryName);
    return { progress, intervention: chooseIntervention({ progress, readiness, isIsolation, goal: profile.goal }) };
  });

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
  if (!healthLoad.profile) {
    throw new Error('Completa Mi salud antes de ajustar una rutina. No vamos a inferir que entrenar es seguro.');
  }

  // La MISMA puerta que bloquea la pantalla de entrenamiento. Faltaba aquí, y
  // este es justo el camino que app/health.tsx ofrece con un Alert ("¿Quieres
  // que la IA ajuste tu plan AHORA?") NADA MÁS guardar el tamizaje: alguien
  // podía marcar "dolor u opresión en el pecho", tocar "Ajustar mi plan" y
  // recibir un plan de fuerza generado y guardado, mientras la pantalla de
  // entrenar se lo bloqueaba. La comprobación de arriba solo miraba si el
  // tamizaje EXISTE, no lo que dice.
  //
  // Delegar esto al prompt no vale: el modelo puede obedecer o no, y el plan
  // se persiste en la base de datos y guía semanas de entrenamiento.
  const acceso = evaluateWorkoutAccess(healthLoad.profile, profile.age);
  if (acceso.status === 'blocked') {
    throw new Error(`${acceso.title}. ${acceso.detail}`);
  }

  const healthBlock = healthToPrompt(healthLoad.profile, profile.age, sex);

  const content = await aiChatContent({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Entrenador personal élite. ${AI_SAFETY_RULES}
${healthBlock ? `\n${healthBlock}\n` : ''}
Ajusta el plan semanal de este usuario según su DESEMPEÑO REAL de las últimas 6 semanas.

Usuario: ${profile.age} años, sexo biológico ${SEX_LABELS[sex]}, ${profile.weight_kg}kg, ${profile.height_cm}cm, objetivo ${profile.goal}, actividad ${profile.activity_level}, experiencia ${profile.training_experience ?? 'principiante'}, disponibilidad ${profile.days_per_week ?? 3} días/semana, equipo ${profile.equipment ?? 'gym'}.
${sex === 'unspecified'
  ? 'Sexo no declarado: ajusta el plan de forma neutra. No lo deduzcas del objetivo, del peso ni de los ejercicios que registró, ni cambies nada por esa suposición.'
  : 'Usa el sexo solo como dato fisiológico (tolerancia al volumen, frecuencia y recuperación). PROHIBIDO bajar cargas, series o exigencia por él: si algo choca, MANDAN el objetivo declarado, el desempeño real y las directivas de salud.'}

Desempeño registrado (peso × reps):
${perf}

Diagnóstico determinista (NO lo contradigas ni inventes mesetas):
${JSON.stringify(diagnostics).slice(0, 6000)}

Recuperación reciente declarada (puede faltar; no inventes valores):
${JSON.stringify(readiness ?? null)}
${notasCorporales ? `
Observación del último análisis corporal (fotos SIN calibrar — es una impresión visual, no una medición):
${notasCorporales.slice(0, 600)}
Úsala solo para decidir DÓNDE poner el énfasis (qué grupo merece algo más de volumen y cuál algo menos). NO puede contradecir el desempeño registrado ni el diagnóstico determinista, que son datos reales: si chocan, mandan ellos. Y no cambies el objetivo del usuario por lo que se vea en una foto.` : ''}

Reglas de ajuste:
- Si falta evidencia → NO diagnostiques estancamiento: conserva y pide registrar peso, reps y RIR.
- Si progresa → conserva el ejercicio; prioriza progresión doble (reps y después 2.5-5% de carga).
- Si el diagnóstico pide recuperación → deload temporal de volumen/carga, no castigo ni fracaso.
- Una sesión fallida NO justifica deload ni reemplazar toda la rutina.
- Cambia el mínimo número de variables y explica cada cambio en overview.
- Dropset solo si la intervención determinista dice drop_set: únicamente última serie de un aislamiento, reducción 20-30%, bloque 3-4 semanas, nunca en compuestos ni con dolor/fatiga alta.
- En las series normales programa 1-3 RIR; fallo muscular no es la opción por defecto.
- Si un ejercicio no tiene registros (lo saltó siempre) → puedes sustituirlo por una alternativa del mismo grupo.
- Mantén la estructura de 7 días con sus descansos y el objetivo del usuario.

Plan actual (para referencia):
${JSON.stringify(currentPlan).slice(0, 4000)}

Devuelve SOLO el JSON del nuevo plan con la MISMA estructura:
{ "overview": "...", "days": [ { "day":1, "day_name":"Lunes", "type":"workout", "muscle_groups":[], "estimated_duration_min":55, "exercises":[ { "name":"", "sets":4, "reps":"8-10", "rest_seconds":90, "target_rir":2, "intensity_method":"none", "notes":"", "muscle_group":"" } ] } ] }
Incluye los 7 días.`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.6,
  }, 'plan');

  const bruto = parseAI(WeeklyPlanSchema, content, 'plan adaptado') as WeeklyPlan;
  // La misma postvalidación que el plan inicial. Un plan adaptado se guarda
  // igual y guía igual: no puede tener menos controles por venir de otro camino.
  const { plan: corregido, correcciones } = validarPlan(bruto as any, {
    injuries: healthLoad.profile?.injuries ?? [],
    conditions: healthLoad.profile?.conditions ?? [],
    equipment: (profile as any).equipment ?? 'gym',
    age: profile.age,
    // Aquí healthLoad ya no puede ser 'unknown': más arriba se aborta si no se
    // pudo leer la salud, porque un plan generado a ciegas persiste en la base y
    // guía semanas. Se deja explícito para que se vea que no es un olvido.
    saludDesconocida: false,
  });
  if (correcciones.length > 0) {
    // Se registra: si el modelo incumple el prompt de seguridad a menudo, eso
    // hay que saberlo — es la señal de que el prompt no basta, que es
    // exactamente por lo que existe esta capa.
    console.warn('regenerateAdaptivePlan: el plan incumplía el tamizaje,', correcciones.length, 'correcciones');
  }
  return corregido as WeeklyPlan;
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
 * Experiencia, días disponibles y equipamiento persisten en el perfil; nunca
 * se vuelven a inferir ni se pierden al regenerar.
 */
export async function generateFirstPlan(
  profile: Pick<UserProfile, 'user_id' | 'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level' | 'training_experience' | 'days_per_week' | 'equipment'>
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
      experience: profile.training_experience,
      days_per_week: profile.days_per_week,
      equipment: profile.equipment,
    },
    salud.profile
  );
  return saveAdaptedPlan(profile.user_id, plan);
}

/** Guarda el nuevo plan como activo y reinicia el día del plan. */
export async function saveAdaptedPlan(userId: string, plan: WeeklyPlan): Promise<any> {
  // userId se conserva en la firma para no romper llamadas existentes; la RPC
  // usa auth.uid(), versiona y activa en una única transacción.
  const { data, error } = await supabase.rpc('activate_training_plan', {
    p_plan_data: plan,
    p_change_reason: { source: 'adaptive_review', requested_for: userId },
  });
  const saved = Array.isArray(data) ? data[0] : data;
  if (error || !saved) throw new Error('No se pudo guardar el plan: ' + (error?.message ?? 'sin confirmación'));
  // El plan nuevo YA incorpora la salud actual: limpiar el recordatorio.
  clearPlanStaleForHealth(userId);
  return saved;
}

export async function restorePreviousPlan(): Promise<any> {
  const { data, error } = await supabase.rpc('restore_previous_training_plan');
  const restored = Array.isArray(data) ? data[0] : data;
  if (error || !restored) throw new Error(error?.message ?? 'No hay un plan anterior disponible.');

  // El plan que se restaura es el ANTERIOR a la adaptación — es decir, el que
  // se generó con el perfil de salud VIEJO. Si la adaptación se disparó
  // justamente por declarar una lesión o una condición nueva, volver atrás te
  // devuelve al plan que la ignoraba: el que traía el peso muerto desde el
  // suelo que tu hernia prohíbe.
  //
  // saveAdaptedPlan había limpiado la marca de "plan obsoleto por salud", así
  // que la app presentaba esto como estado normal, sin ningún aviso. Se
  // vuelve a marcar: la tarjeta de Inicio reaparece y ofrece regenerar.
  if (restored.user_id) {
    await markPlanStaleForHealth(restored.user_id).catch(() => {});
  }
  return restored;
}
