// lib/setLogs.ts
// ─────────────────────────────────────────────────────────
// Acceso a set_logs: registrar series y consultar la última
// performance por ejercicio (para sobrecarga progresiva).
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';

export type SetLogInput = {
  exercise_name: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
};

export type LastPerf = { weight_kg: number | null; reps: number | null; logged_at: string };

/**
 * Para cada ejercicio dado, devuelve la última serie registrada (la más
 * pesada de la sesión más reciente sería ideal, pero usamos la más reciente).
 */
export async function fetchLastPerformance(
  userId: string,
  exerciseNames: string[]
): Promise<Record<string, LastPerf>> {
  if (exerciseNames.length === 0) return {};
  const { data, error } = await supabase
    .from('set_logs')
    .select('exercise_name, weight_kg, reps, logged_at')
    .eq('user_id', userId)
    .in('exercise_name', exerciseNames)
    .order('logged_at', { ascending: false })
    .limit(200);

  if (error || !data) {
    if (error) console.log('[setLogs] Error cargando histórico:', error.message);
    return {};
  }

  // Nos quedamos con el registro más reciente por ejercicio.
  const map: Record<string, LastPerf> = {};
  for (const row of data as any[]) {
    if (!map[row.exercise_name]) {
      map[row.exercise_name] = { weight_kg: row.weight_kg, reps: row.reps, logged_at: row.logged_at };
    }
  }
  return map;
}

/** Inserta en lote las series registradas en una sesión. */
export async function saveSetLogs(
  userId: string,
  sessionId: string | null,
  logs: SetLogInput[]
): Promise<void> {
  const rows = logs
    .filter((l) => l.weight_kg !== null || l.reps !== null) // no guardar series vacías
    .map((l) => ({ user_id: userId, session_id: sessionId, ...l }));
  if (rows.length === 0) return;

  const { error } = await supabase.from('set_logs').insert(rows);
  if (error) console.log('[setLogs] Error guardando series:', error.message);
}
