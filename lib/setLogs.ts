// lib/setLogs.ts
// ─────────────────────────────────────────────────────────
// Acceso a set_logs: registrar series y consultar la última
// performance por ejercicio (para sobrecarga progresiva).
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';

export type SetLogInput = {
  exercise_name: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  /** Repeticiones en reserva declaradas por la persona (0 = fallo). */
  rir?: number | null;
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
  if (error) {
    // ANTES ESTO SOLO HACÍA console.log Y SEGUÍA.
    // Las series son el dato con más valor de toda la app: es el trabajo real
    // de la persona, lo que alimenta los récords, la progresión de cargas y la
    // re-planificación adaptativa. Tragarse el error dejaba la sesión marcada
    // como completada con el peso y las reps perdidos para siempre, sin que
    // nadie —ni el usuario ni nosotros— se enterara. Y en producción los
    // console.log se eliminan, así que el rastro tampoco existía.
    // Ahora se lanza: quien llama decide si reintenta o avisa, pero no puede
    // fingir que se guardó.
    captureError(error, {
      scope: 'saveSetLogs',
      series: rows.length,
      con_sesion: sessionId != null,
    });
    throw new Error('No se pudieron guardar tus series: ' + error.message);
  }
}
