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
import type { UserProfile, TrainingPlan } from './supabase';
import { loadUserStats } from './streaks';
import { bestFromSets } from './prs';
import { getWaterCount } from './water';
import { loadHealthSafe } from './health';
import { healthToPrompt, HEALTH_UNKNOWN_DIRECTIVE } from './healthMath';
import { projectGoal, type WeightPoint, type GoalProjection } from './goalMath';

export const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'ganar músculo',
  fat_loss: 'perder grasa',
  performance: 'mejorar rendimiento',
  endurance: 'mejorar resistencia',
};

export type TopLift = { exercise: string; bestWeight: number; e1rm: number };

export type TopSet = { exercise: string; weight: number | null; reps: number | null };

export type CoachSnapshot = {
  name: string;
  nickname: string | null;
  age: number;
  goal: string;
  goalLabel: string;
  goalWhy: string | null;
  currentWeight: number;
  targetWeight: number | null;
  projection: GoalProjection | null;
  macros: {
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
  lastBodyScan: { score: number | null; fatPct: number | null; focus: string[] } | null;
  // ── Actividad reciente EN LA APP (el coach ve lo que la persona hace) ──
  daysSinceLastWorkout: number | null;   // null = sin entrenos registrados
  workoutsLast7Days: number;
  lastSessionTopSets: TopSet[];          // mejores series de la última sesión
  todayMeals: { name: string; calories: number }[];
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
      .select('overall_score, estimated_fat_pct, focus_areas')
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
  const healthLoad = healthRes.status === 'fulfilled'
    ? healthRes.value
    : ({ status: 'unknown' } as const);
  let healthBlock = '';
  if (healthLoad.status === 'unknown') {
    healthBlock = HEALTH_UNKNOWN_DIRECTIVE;
    contextGaps.push('salud');
  } else {
    healthBlock = healthLoad.profile ? healthToPrompt(healthLoad.profile, profile.age) : '';
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
        score: (scan as any).overall_score ?? null,
        fatPct: (scan as any).estimated_fat_pct ?? null,
        focus: Array.isArray((scan as any).focus_areas) ? (scan as any).focus_areas.slice(0, 3) : [],
      }
    : null;

  // ── Plan de hoy ──
  const todayIndex = Math.min(profile.current_plan_day ?? 0, 6);
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

  return {
    name: profile.name,
    nickname: profile.nickname ?? null,
    age: profile.age,
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
    daysSinceLastWorkout,
    workoutsLast7Days,
    lastSessionTopSets: lastSessionTopSets.slice(0, 8),
    todayMeals,
    waterCups,
    healthBlock,
    contextGaps,
    dateLabel,
  };
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
  L.push(`- Edad: ${s.age} años · Peso actual: ${s.currentWeight.toFixed(1)} kg`);
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
  L.push(
    `- Nutrición hoy: ${m.calories[0]}/${m.calories[1]} kcal · ` +
      `P ${m.protein[0]}/${m.protein[1]}g · C ${m.carbs[0]}/${m.carbs[1]}g · G ${m.fat[0]}/${m.fat[1]}g`
  );
  L.push(`- Racha: ${s.streak} días · Nivel ${s.level} · ${s.totalWorkouts} entrenos totales · ${s.freezes} comodines`);

  if (s.todayPlan) {
    if (s.todayPlan.type === 'workout') {
      const exs = s.todayPlan.exercises
        .slice(0, 8)
        .map((e) => `${e.name} ${e.sets}×${e.reps}`)
        .join(', ');
      L.push(`- Entreno de hoy (${s.todayPlan.muscleGroups.join(' + ')}): ${exs}`);
    } else if (s.todayPlan.type === 'rest') {
      L.push(`- Hoy es día de DESCANSO en su plan.`);
    } else {
      L.push(`- Hoy es RECUPERACIÓN ACTIVA en su plan.`);
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
    if (b.fatPct != null) parts.push(`~${b.fatPct}% grasa`);
    if (b.focus.length) parts.push(`enfoque: ${b.focus.join(', ')}`);
    if (parts.length) L.push(`- Último análisis corporal: ${parts.join(' · ')}`);
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
  if (s.lastSessionTopSets.length) {
    L.push(
      `- Mejores series de su última sesión: ` +
        s.lastSessionTopSets
          .map((t) => `${t.exercise} ${t.weight != null ? `${t.weight}kg` : 's/peso'}×${t.reps ?? '?'}`)
          .join(', ')
    );
  }
  if (s.todayMeals.length) {
    L.push(
      `- Comidas registradas hoy: ` +
        s.todayMeals.map((m) => `${m.name} (${Math.round(m.calories)} kcal)`).join(', ')
    );
  } else {
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
