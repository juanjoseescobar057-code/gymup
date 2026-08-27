// lib/coachContext.ts
// ─────────────────────────────────────────────────────────
// Arma el "expediente" del usuario que se le entrega al Coach IA para que
// hable como un entrenador que DE VERDAD te conoce: plan de hoy, macros,
// racha, PRs, tendencia de peso y proyección hacia la meta.
//
// fetchCoachSnapshot() hace las consultas (IO). snapshotToPrompt() es PURA
// (transforma el snapshot en texto) → fácil de testear y de auditar.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import type { UserProfile, TrainingPlan, BiologicalSex } from './supabase';
import { loadUserStats } from './streaks';
import { bestFromSets } from './prs';
import { getWaterCount } from './water';
import { loadHealthSafe } from './health';
import { modoRecuperacion, filtrarExpediente, MODO_MIENTRAS_NO_SE_SEPA } from './recoveryMode';
import { healthToPrompt, HEALTH_UNKNOWN_DIRECTIVE } from './healthMath';
import { projectGoal, type WeightPoint, type GoalProjection } from './goalMath';
import { estadoDelDia, type Reincorporacion } from './planCalendario';
import { tiposDeDia } from './diaDeHoy';

export const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'ganar músculo',
  fat_loss: 'perder grasa',
  performance: 'mejorar rendimiento',
  endurance: 'mejorar resistencia',
};

// El sexo biológico entra a la ficha del coach como un dato más del perfil: sin
// él el coach recomendaba entrenamiento y nutrición "por defecto" (que en la
// práctica es por defecto masculino). 'unspecified' se DECLARA en vez de
// omitirse: callarlo invita al modelo a deducirlo del nombre o del objetivo.
export const SEX_LABELS: Record<BiologicalSex, string> = {
  male: 'hombre',
  female: 'mujer',
  unspecified: 'no declarado',
};

export type TopLift = { exercise: string; bestWeight: number; e1rm: number };

export type TopSet = { exercise: string; weight: number | null; reps: number | null };

export type CoachSnapshot = {
  name: string;
  nickname: string | null;
  age: number;
  sex: BiologicalSex;
  goal: string;
  goalLabel: string;
  goalWhy: string | null;
  // OPCIONALES A PROPÓSITO. Con el modo recuperación activo, filtrarExpediente
  // los QUITA del objeto antes de que salga del dispositivo. Marcarlos
  // opcionales no es cosmética: es lo que obliga al compilador a que cada sitio
  // que los use se plantee qué hacer cuando no están. Con el tipo mintiendo,
  // snapshotToPrompt habría escrito "Peso actual: undefined kg" en el prompt.
  currentWeight?: number;
  targetWeight?: number | null;
  projection?: GoalProjection | null;
  macros?: {
    calories: [number, number];  // [consumido, meta]
    protein: [number, number];
    carbs: [number, number];
    fat: [number, number];
  };
  streak: number;
  level: number;
  totalWorkouts: number;
  freezes: number;
  todayPlan: {
    type: string;
    muscleGroups: string[];
    exercises: { name: string; sets: number; reps: string }[];
  } | null;
  topLifts: TopLift[];
  lastBodyScan?: {
    fecha: string | null;
    score: number | null;
    fatPct: number | null;
    focus: string[];
    fortalezas: string[];
    zonas: { zona: string; que: string }[];
    notasPlan: string | null;
  } | null;
  /**
   * Qué hacer con las cargas si vuelve de una pausa. null = no viene de una.
   * Es la diferencia entre un coach que le propone a alguien las mismas series
   * de hace tres semanas y uno que sabe que el cuerpo se desentrena.
   */
  reincorporacion: Reincorporacion | null;
  /** El día de hoy era descanso y se saltó porque venía de una pausa. */
  saltoDescanso: boolean;
  // ── Actividad reciente EN LA APP (el coach ve lo que la persona hace) ──
  daysSinceLastWorkout: number | null;   // null = sin entrenos registrados
  workoutsLast7Days: number;
  lastSessionTopSets: TopSet[];          // mejores series de la última sesión
  todayMeals?: { name: string; calories: number }[];
  waterCups: number | null;
  healthBlock: string;                   // directivas de salud individuales ('' si sano)
  contextGaps: string[];                 // qué NO se pudo cargar ('salud' = crítico)
  dateLabel: string;
};

export type DailyTotals = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

/** Consulta Supabase y arma el snapshot. Tolerante a fallos: si algo falla,
 *  ese bloque queda vacío pero el coach igual funciona con lo que haya. */
export async function fetchCoachSnapshot(args: {
  profile: UserProfile;
  trainingPlan: TrainingPlan | null;
  todayTotals: DailyTotals;
  todayMeals?: { name: string; calories: number }[];
}): Promise<CoachSnapshot> {
  const { profile, trainingPlan, todayTotals } = args;
  const uid = profile.user_id;

  const [statsRes, setsRes, weightRes, scanRes, sessionsRes, waterRes, healthRes] = await Promise.allSettled([
    loadUserStats(uid),
    supabase
      .from('set_logs')
      .select('exercise_name, weight_kg, reps, session_id')
      .eq('user_id', uid)
      .order('logged_at', { ascending: false })
      .limit(200),
    supabase
      .from('weight_entries')
      .select('date, weight')
      .eq('user_id', uid)
      .order('date', { ascending: false })
      .limit(30),
    supabase
      .from('body_scans')
      // La ficha llevaba SOLO score, grasa y enfoque: tres números. Con eso, a
      // "¿qué viste en mi foto?" el coach respondía con verdad que no tenía ese
      // contexto — no lo tenía. Lo que la IA de verdad escribió sobre el cuerpo
      // (las zonas, las fortalezas) y sobre el plan (notes = refined_plan_notes)
      // se guardaba en la base y no salía de ahí.
      .select('scanned_at, overall_score, estimated_fat_pct, focus_areas, strengths, zones, notes')
      .eq('user_id', uid)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('workout_sessions')
      .select('id, started_at, duration_min')
      .eq('user_id', uid)
      .not('completed_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(10),
    getWaterCount(),
    loadHealthSafe(uid),
  ]);

  // ── INTEGRIDAD DE CONTEXTO ──
  // El coach NUNCA asume "sano" por un fallo de red. loadHealthSafe distingue
  // ok / caché local / desconocido; en 'unknown' se inyecta la directiva
  // fail-closed y la brecha queda medible en telemetría (contextGaps).
  const contextGaps: string[] = [];
  // Los perfiles creados antes de que existiera la columna `sex` llegan sin ella
  // (o con basura): se tratan como 'unspecified' en vez de reintroducir el sesgo
  // masculino por defecto.
  const sex: BiologicalSex = SEX_LABELS[profile.sex] ? profile.sex : 'unspecified';
  const healthLoad = healthRes.status === 'fulfilled'
    ? healthRes.value
    : ({ status: 'unknown' } as const);
  let healthBlock = '';
  if (healthLoad.status === 'unknown') {
    healthBlock = HEALTH_UNKNOWN_DIRECTIVE;
    contextGaps.push('salud');
  } else {
    // El sexo va al tamizaje: sin él nunca se emite la directiva de RED-S/hierro
    // para mujeres, que es justo el perfil donde ese riesgo pasa desapercibido.
    healthBlock = healthLoad.profile ? healthToPrompt(healthLoad.profile, profile.age, sex) : '';
    // Operando sobre caché local: registrado en telemetría/prompt (informativo,
    // no dispara el banner fuerte — la caché ES el último contexto bueno).
    if (healthLoad.status === 'cached') contextGaps.push('salud-en-cache-local');
  }
  // Brechas informativas (degradan personalización, no seguridad).
  const qFailed = (r: PromiseSettledResult<any>) =>
    r.status === 'rejected' || (r.status === 'fulfilled' && !!(r.value as any)?.error);
  if (statsRes.status === 'rejected') contextGaps.push('stats');
  if (qFailed(setsRes)) contextGaps.push('series');
  if (qFailed(weightRes)) contextGaps.push('peso');
  if (qFailed(sessionsRes)) contextGaps.push('sesiones');

  // ── Stats ──
  const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;

  // ── PRs / top lifts ──
  const setRows: { exercise_name: string; weight_kg: number | null; reps: number | null; session_id: string | null }[] =
    setsRes.status === 'fulfilled' ? (setsRes.value.data ?? []) : [];
  const byExercise = new Map<string, { weight_kg: number | null; reps: number | null }[]>();
  for (const r of setRows) {
    const arr = byExercise.get(r.exercise_name) ?? [];
    arr.push({ weight_kg: r.weight_kg, reps: r.reps });
    byExercise.set(r.exercise_name, arr);
  }
  const topLifts: TopLift[] = [...byExercise.entries()]
    .map(([exercise, sets]) => {
      const best = bestFromSets(sets);
      return { exercise, bestWeight: best.maxWeight, e1rm: best.best1RM };
    })
    .filter((l) => l.e1rm > 0)
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, 4);

  // ── Actividad reciente: sesiones, última sesión y comidas de hoy ──
  const sessions: { id: string; started_at: string; duration_min: number | null }[] =
    sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data ?? []) : [];
  const now = Date.now();
  const daysSinceLastWorkout = sessions.length
    ? Math.max(0, Math.floor((now - new Date(sessions[0].started_at).getTime()) / 86_400_000))
    : null;
  const workoutsLast7Days = sessions.filter(
    (x) => now - new Date(x.started_at).getTime() <= 7 * 86_400_000
  ).length;

  // Mejor serie por ejercicio de la ÚLTIMA sesión (para dar seguimiento real).
  const lastSessionTopSets: TopSet[] = [];
  if (sessions.length) {
    const lastId = sessions[0].id;
    const bestByEx = new Map<string, TopSet>();
    for (const r of setRows) {
      if (r.session_id !== lastId) continue;
      const prev = bestByEx.get(r.exercise_name);
      const better =
        !prev ||
        (r.weight_kg ?? 0) > (prev.weight ?? 0) ||
        ((r.weight_kg ?? 0) === (prev.weight ?? 0) && (r.reps ?? 0) > (prev.reps ?? 0));
      if (better) bestByEx.set(r.exercise_name, { exercise: r.exercise_name, weight: r.weight_kg, reps: r.reps });
    }
    lastSessionTopSets.push(...bestByEx.values());
  }

  const waterCups = waterRes.status === 'fulfilled' ? waterRes.value : null;
  const todayMeals = (args.todayMeals ?? []).slice(0, 8);

  // ── Peso + proyección ──
  const weightRows: { date: string; weight: number }[] =
    weightRes.status === 'fulfilled' ? (weightRes.value.data ?? []) : [];
  const points: WeightPoint[] = weightRows
    .map((w) => ({ date: w.date, weight: Number(w.weight) }))
    .reverse(); // a ascendente por fecha
  const currentWeight = points.length ? points[points.length - 1].weight : Number(profile.weight_kg);
  const startWeight =
    profile.goal_start_weight_kg != null
      ? Number(profile.goal_start_weight_kg)
      : points.length
        ? points[0].weight
        : Number(profile.weight_kg);

  const projection =
    profile.target_weight_kg != null
      ? projectGoal({
          goal: profile.goal,
          currentWeight,
          targetWeight: Number(profile.target_weight_kg),
          startWeight,
          points,
        })
      : null;

  // ── Último escaneo corporal ──
  const scan = scanRes.status === 'fulfilled' ? scanRes.value.data : null;
  const lastBodyScan = scan
    ? {
        fecha: (scan as any).scanned_at ?? null,
        score: (scan as any).overall_score ?? null,
        fatPct: (scan as any).estimated_fat_pct ?? null,
        focus: Array.isArray((scan as any).focus_areas) ? (scan as any).focus_areas.slice(0, 3) : [],
        fortalezas: Array.isArray((scan as any).strengths) ? (scan as any).strengths.slice(0, 3) : [],
        // Solo las zonas que la IA marcó para trabajar. Las que salieron bien ya
        // van en `fortalezas`, y repetirlas aquí gastaría contexto sin añadir
        // nada — el prompt de la ficha entra en CADA mensaje del chat.
        zonas: Array.isArray((scan as any).zones)
          ? (scan as any).zones
              .filter((z: any) => z?.status === 'priority' || z?.status === 'focus')
              .slice(0, 4)
              .map((z: any) => ({ zona: String(z?.label ?? ''), que: String(z?.message ?? '') }))
          : [],
        // refined_plan_notes: qué debería cambiar en su plan según las fotos.
        notasPlan: typeof (scan as any).notes === 'string' ? (scan as any).notes.slice(0, 400) : null,
      }
    : null;

  // ── Plan de hoy ──
  // El día NO sale de current_plan_day directamente: ese contador solo avanza
  // al completar un entrenamiento, así que a quien vuelve tras diez días le
  // proponía el mismo día que dejó, descanso incluido. estadoDelDia lo deriva
  // del calendario y, si vuelve de una pausa, se salta el descanso.
  const estadoHoy = estadoDelDia({
    hoyISO: new Date().toISOString().slice(0, 10),
    ultimoEntrenoISO: sessions[0]?.started_at ?? null,
    diaGuardado: profile.current_plan_day ?? 0,
    // tiposDeDia y no un ternario aquí: esta misma línea estaba copiada y
    // clasificaba 'active_recovery' como día de entrenamiento. Una sola
    // función para los tres tipos, y no puede volver a divergir.
    dias: tiposDeDia(trainingPlan?.plan_data?.days),
  });
  const todayIndex = estadoHoy.diaDelPlan;
  const day = trainingPlan?.plan_data?.days?.[todayIndex];
  const todayPlan = day
    ? {
        type: day.type,
        muscleGroups: day.muscle_groups ?? [],
        exercises: (day.exercises ?? []).map((e: any) => ({
          name: e.name,
          sets: e.sets,
          reps: e.reps,
        })),
      }
    : null;

  const dateLabel = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // EL FILTRO DEL MODO RECUPERACIÓN VA AQUÍ, en el único sitio donde se arma el
  // expediente. Ponerlo en cada consumidor sería volver a depender de que
  // alguien se acuerde, y ya sabemos cómo acaba eso.
  //
  // Hasta ahora al coach le llegaban el peso, la meta, la proyección a la meta,
  // los macros del día y el "~X% de grasa" del último análisis corporal. Lo
  // único que había era `healthBlock`, que le PIDE al modelo no hablar de peso
  // — mientras le entrega el peso en el mismo prompt. Eso no es un control: el
  // número ya salió del teléfono y ya está en la ventana de contexto.
  //
  // Los campos no se ponen a null: se QUITAN. Un campo presente valiendo null
  // sigue diciéndole al modelo que existe una báscula de la que se puede hablar.
  // FALLA CERRADO, como el resto de la app. modoRecuperacion(null) devuelve
  // NEUTRO —correcto para "no tiene tamizaje"— y eso convertía "no pude leerlo"
  // en "no tiene nada": con la salud ilegible, el peso, la meta, los macros y el
  // "~X% de grasa" salían del teléfono hacia OpenAI aunque la persona estuviera
  // en modo recuperación. Es justo el caso en el que menos se puede comprobar.
  const modo = healthLoad.status === 'unknown'
    ? MODO_MIENTRAS_NO_SE_SEPA
    : modoRecuperacion(healthLoad.profile);

  const expediente: CoachSnapshot = {
    name: profile.name,
    nickname: profile.nickname ?? null,
    age: profile.age,
    sex,
    goal: profile.goal,
    goalLabel: GOAL_LABELS[profile.goal] ?? profile.goal,
    goalWhy: profile.goal_why ?? null,
    currentWeight,
    targetWeight: profile.target_weight_kg != null ? Number(profile.target_weight_kg) : null,
    projection,
    macros: {
      calories: [Math.round(todayTotals.calories), profile.daily_calories],
      protein: [Math.round(todayTotals.protein_g), profile.daily_protein_g],
      carbs: [Math.round(todayTotals.carbs_g), profile.daily_carbs_g],
      fat: [Math.round(todayTotals.fat_g), profile.daily_fat_g],
    },
    streak: stats?.current_streak ?? 0,
    level: stats?.level ?? 1,
    totalWorkouts: stats?.total_workouts ?? 0,
    freezes: stats?.streak_freezes ?? 0,
    todayPlan,
    topLifts,
    lastBodyScan,
    reincorporacion: estadoHoy.reincorporacion,
    saltoDescanso: estadoHoy.saltoDescanso,
    daysSinceLastWorkout,
    workoutsLast7Days,
    lastSessionTopSets: lastSessionTopSets.slice(0, 8),
    todayMeals,
    waterCups,
    healthBlock,
    contextGaps,
    dateLabel,
  };

  return filtrarExpediente(expediente, modo);
}

/** Convierte el snapshot en un bloque de texto compacto para el prompt. PURA. */
export function snapshotToPrompt(s: CoachSnapshot): string {
  const L: string[] = [];
  L.push(`FICHA DE ${s.name.toUpperCase()} (hoy es ${s.dateLabel}):`);
  if (s.contextGaps.length > 0) {
    L.push(
      `- ⚠️ CONTEXTO PARCIAL: no se pudieron cargar: ${s.contextGaps.join(', ')}. NO afirmes datos de esas áreas; si son relevantes para la pregunta, dilo con honestidad y sugiere reintentar con conexión.`
    );
  }
  if (s.nickname) L.push(`- Quiere que lo llames "${s.nickname}" — úsalo siempre.`);
  // El peso puede NO ESTAR: con el modo recuperación activo se retira del
  // expediente antes de llegar aquí. La línea se arma sin él en vez de escribir
  // "undefined kg", y se le dice al modelo por qué falta, para que no lo pida.
  L.push(
    `- Edad: ${s.age} años · Sexo biológico: ${SEX_LABELS[s.sex]}` +
      (s.currentWeight != null ? ` · Peso actual: ${s.currentWeight.toFixed(1)} kg` : ''),
  );
  if (s.currentWeight == null) {
    L.push('- NO tienes su peso, su meta de peso ni sus calorías, y es deliberado: declaró un trastorno de la conducta alimentaria. No los pidas, no los estimes y no hables de cifras corporales. Habla de entrenar, moverse, descansar y cómo se siente.');
  }
  // El dato viaja SIEMPRE con su regla de uso: es fisiología (gasto energético,
  // reparto de volumen y frecuencia), nunca licencia para estereotipar ni para
  // bajarle la exigencia a nadie. Mismo criterio que el generador de plan.
  L.push(
    s.sex === 'unspecified'
      ? '- Sexo no declarado: aconseja de forma neutra. NO lo deduzcas del nombre, del objetivo ni del peso, ni ajustes nada por esa suposición.'
      : '- Cómo usar el sexo: solo como dato fisiológico al programar entrenamiento y nutrición. PROHIBIDO cambiarle el tono, la exigencia o el objetivo por él (nada de "tonificar" ni de cargas simbólicas): manda su objetivo declarado, y por encima de todo sus directivas de salud.'
  );
  L.push(`- Objetivo: ${s.goalLabel}${s.targetWeight != null ? ` (meta: ${s.targetWeight.toFixed(1)} kg)` : ''}`);
  if (s.goalWhy) L.push(`- Su motivación ("el porqué"): "${s.goalWhy}"`);

  if (s.projection?.hasGoal) {
    const p = s.projection;
    L.push(
      `- Proyección: le faltan ${p.remainingKg.toFixed(1)} kg. ` +
        (p.onTrack
          ? `Va en camino a buen ritmo (${p.etaLabel}, ${Math.abs(p.ratePerWeek).toFixed(2)} kg/sem).`
          : p.reversing
            ? `Va en dirección CONTRARIA a su meta.`
            : p.stalled
              ? `Está estancado (peso sin cambio).`
              : `Aún faltan datos de peso para proyectar.`)
    );
  }

  const m = s.macros;
  if (m) {
    L.push(
      `- Nutrición hoy: ${m.calories[0]}/${m.calories[1]} kcal · ` +
        `P ${m.protein[0]}/${m.protein[1]}g · C ${m.carbs[0]}/${m.carbs[1]}g · G ${m.fat[0]}/${m.fat[1]}g`
    );
  }
  L.push(`- Racha: ${s.streak} días · Nivel ${s.level} · ${s.totalWorkouts} entrenos totales · ${s.freezes} comodines`);

  if (s.todayPlan) {
    // Al cerrar un entrenamiento el plan avanza al día siguiente, así que si
    // hoy ya entrenó, este bloque describe lo que TOCA MAÑANA, no hoy.
    // Rotularlo como "de hoy" le hacía decir al coach "hoy te toca pierna"
    // justo después de que la persona terminó pierna.
    const yaEntrenoHoy = s.daysSinceLastWorkout === 0;
    const cuando = yaEntrenoHoy ? 'Mañana' : 'Hoy';
    if (s.todayPlan.type === 'workout') {
      const exs = s.todayPlan.exercises
        .slice(0, 8)
        .map((e) => `${e.name} ${e.sets}×${e.reps}`)
        .join(', ');
      L.push(`- ${cuando === 'Hoy' ? 'Entreno de hoy' : 'Entreno de mañana'} (${s.todayPlan.muscleGroups.join(' + ')}): ${exs}`);
    } else if (s.todayPlan.type === 'rest') {
      L.push(`- ${cuando} es día de DESCANSO en su plan.`);
    } else {
      L.push(`- ${cuando} es RECUPERACIÓN ACTIVA en su plan.`);
    }
    if (yaEntrenoHoy) {
      L.push(`- OJO: ya cerró su sesión de hoy. No le digas que "hoy le toca" lo de arriba; eso es lo que viene después.`);
    }
  }

  if (s.topLifts.length) {
    L.push(
      `- Sus mejores levantamientos (1RM estimado): ` +
        s.topLifts.map((l) => `${l.exercise} ${l.bestWeight}kg (~${l.e1rm}kg 1RM)`).join(', ')
    );
  }

  if (s.lastBodyScan) {
    const b = s.lastBodyScan;
    const parts: string[] = [];
    if (b.score != null) parts.push(`score ${b.score}/100`);
    if (b.fatPct != null) parts.push(`~${b.fatPct}% grasa (estimación visual, no medición)`);
    if (b.focus.length) parts.push(`enfoque: ${b.focus.join(', ')}`);

    const cuando = b.fecha
      ? new Date(b.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
      : null;
    // La FECHA importa tanto como los números: sin ella el coach no sabe si
    // habla de algo de ayer o de hace dos meses, y "tu último análisis" sobre
    // fotos viejas es peor que no mencionarlo.
    if (parts.length) {
      L.push(`- Último análisis corporal${cuando ? ` (${cuando})` : ''}: ${parts.join(' · ')}`);
    }
    if (b.fortalezas.length) L.push(`  · Lo que salió bien: ${b.fortalezas.join('; ')}`);
    for (const z of b.zonas) {
      if (z.zona && z.que) L.push(`  · ${z.zona}: ${z.que}`);
    }
    if (b.notasPlan) L.push(`  · Qué debería cambiar en su plan según esas fotos: ${b.notasPlan}`);
  }

  // ── Lo que la persona HACE en la app (para dar seguimiento real) ──
  L.push(`ACTIVIDAD RECIENTE EN LA APP:`);
  if (s.daysSinceLastWorkout == null) {
    L.push(`- Aún no registra ningún entreno en la app.`);
  } else if (s.daysSinceLastWorkout === 0) {
    L.push(`- Hoy ya entrenó${s.workoutsLast7Days > 1 ? ` (${s.workoutsLast7Days} entrenos en los últimos 7 días)` : ''}.`);
  } else {
    L.push(`- Último entreno: hace ${s.daysSinceLastWorkout} día${s.daysSinceLastWorkout === 1 ? '' : 's'} · ${s.workoutsLast7Days} entreno${s.workoutsLast7Days === 1 ? '' : 's'} en los últimos 7 días.`);
  }

  // Volver de una pausa cambia lo que hay que recomendar. Sin esto, el coach
  // le proponía a alguien que estuvo tres semanas fuera las mismas cargas que
  // movía antes de parar, que es como se lesiona la gente al reincorporarse.
  if (s.reincorporacion) {
    L.push(
      `- VUELVE DE UNA PAUSA de ${s.reincorporacion.diasFuera} días. Ajusta las cargas al ` +
        `${Math.round(s.reincorporacion.factorCarga * 100)}% de lo que movía y prioriza la técnica ` +
        `sobre el peso. No le propongas sus marcas anteriores.` +
        (s.reincorporacion.sugerirReplanificar
          ? ' Tras tanto tiempo, sugiérele rehacer el plan si te lo pregunta.'
          : ''),
    );
    L.push(
      `- Al hablar de la pausa: sin reproche y sin dramatizar. Volvió, que es lo difícil.`,
    );
  }
  if (s.saltoDescanso) {
    L.push(
      `- Hoy tocaba descanso por calendario, pero se le propone entrenar porque venía de días parado. ` +
        `Si pregunta por qué, explícaselo así.`,
    );
  }
  if (s.lastSessionTopSets.length) {
    L.push(
      `- Mejores series de su última sesión: ` +
        s.lastSessionTopSets
          .map((t) => `${t.exercise} ${t.weight != null ? `${t.weight}kg` : 's/peso'}×${t.reps ?? '?'}`)
          .join(', ')
    );
  }
  // Con el modo recuperación no se listan las comidas NI se dice que no hay:
  // "hoy no has registrado comidas" es justo el recordatorio que sobra.
  if (s.todayMeals?.length) {
    L.push(
      `- Comidas registradas hoy: ` +
        s.todayMeals.map((m) => `${m.name} (${Math.round(m.calories)} kcal)`).join(', ')
    );
  } else if (s.todayMeals) {
    L.push(`- Hoy no ha registrado comidas todavía.`);
  }
  if (s.waterCups != null) L.push(`- Agua de hoy: ${s.waterCups}/8 vasos.`);

  // Salud: las directivas individuales van al final, con máxima prominencia.
  if (s.healthBlock) L.push(`\n${s.healthBlock}`);

  return L.join('\n');
}

/** Subtítulo corto para la cabecera del chat ("Racha 5 · Meta -4 kg"). */
export function snapshotHeadline(s: CoachSnapshot): string {
  const bits: string[] = [];
  if (s.streak > 0) bits.push(`🔥 ${s.streak}d`);
  if (s.projection?.hasGoal && s.projection.direction !== 'maintain') {
    const sign = s.projection.direction === 'lose' ? '−' : '+';
    bits.push(`meta ${sign}${s.projection.remainingKg.toFixed(1)}kg`);
  } else {
    bits.push(s.goalLabel);
  }
  bits.push(`nivel ${s.level}`);
  return bits.join(' · ');
}
