// lib/history.ts
// ─────────────────────────────────────────────────────────
// Consulta el historial de entrenamientos y los récords por ejercicio
// a partir de workout_sessions + set_logs.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { bestFromSets, type ExerciseBest, type SetLite } from './prs';

export type SessionRow = {
  id: string;
  day_index: number;
  completed_at: string | null;
  duration_min: number | null;
  exercises_completed: number | null;
};

export type ExerciseRecord = { exercise_name: string } & ExerciseBest;

/** Sesiones completadas recientes. */
export async function fetchRecentSessions(userId: string, limit = 20): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, day_index, completed_at, duration_min, exercises_completed')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) { console.log('[history] sesiones:', error.message); return []; }
  return (data ?? []) as SessionRow[];
}

/** Trae todas las series y agrupa el mejor registro por ejercicio. */
export async function fetchExerciseRecords(userId: string): Promise<ExerciseRecord[]> {
  const byExercise = await fetchSetsByExercise(userId);
  return Object.entries(byExercise)
    .map(([exercise_name, sets]) => ({ exercise_name, ...bestFromSets(sets) }))
    .filter((r) => r.best1RM > 0 || r.maxReps > 0)
    .sort((a, b) => b.best1RM - a.best1RM);
}

/** Mejor histórico para un subconjunto de ejercicios (para detectar PRs). */
export async function fetchExerciseBests(
  userId: string,
  names: string[]
): Promise<Record<string, ExerciseBest | null>> {
  const byExercise = await fetchSetsByExercise(userId, names);
  const out: Record<string, ExerciseBest | null> = {};
  for (const n of names) {
    out[n] = byExercise[n] ? bestFromSets(byExercise[n]) : null;
  }
  return out;
}

// Helper interno: descarga las series del usuario agrupadas por ejercicio.
//
// Bajaba TODAS las series de la persona, de cualquier ejercicio, sin orden y
// cortadas a 3000: pasado el primer año, el "mejor histórico" salía de un
// subconjunto arbitrario y un PR de verdad podía no contarse. Ahora se piden
// solo los ejercicios de la sesión y, si hay que cortar, se quedan las series
// más pesadas, que son las que deciden un récord.
// La pantalla de récords (fetchExerciseRecords) sí quiere todos los ejercicios:
// sin `names` no se filtra, pero el corte sigue quedándose con lo más pesado.
async function fetchSetsByExercise(userId: string, names?: string[]): Promise<Record<string, SetLite[]>> {
  if (names && names.length === 0) return {};
  let consulta = supabase
    .from('set_logs')
    .select('exercise_name, weight_kg, reps')
    .eq('user_id', userId);
  if (names) consulta = consulta.in('exercise_name', names);
  const { data, error } = await consulta
    .order('weight_kg', { ascending: false, nullsFirst: false })
    .limit(3000);
  if (error) { console.log('[history] set_logs:', error.message); return {}; }
  const map: Record<string, SetLite[]> = {};
  for (const row of (data ?? []) as any[]) {
    (map[row.exercise_name] ??= []).push({ weight_kg: row.weight_kg, reps: row.reps });
  }
  return map;
}
