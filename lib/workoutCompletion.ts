import { supabase } from './supabase';
import type { SetLogInput } from './setLogs';
import { normalizeCompletedSets } from './workoutValidation';

export type CompletedWorkout = {
  sessionId: string;
  exercisesCompleted: number;
  setsSaved: number;
  alreadyCompleted: boolean;
};

/**
 * Cierra sesión + series en una sola transacción del servidor.
 * clientSessionKey hace seguro pulsar dos veces o reintentar tras perder red.
 */
export async function completeWorkout(input: {
  clientSessionKey: string;
  trainingPlanId: string;
  dayIndex: number;
  startedAt: string;
  completedAt: string;
  durationMin: number;
  sets: SetLogInput[];
}): Promise<CompletedWorkout> {
  const sets = normalizeCompletedSets(input.sets);

  const { data, error } = await supabase.rpc('complete_workout_session', {
    p_client_session_key: input.clientSessionKey,
    p_training_plan_id: input.trainingPlanId,
    p_day_index: input.dayIndex,
    p_started_at: input.startedAt,
    p_completed_at: input.completedAt,
    p_duration_min: input.durationMin,
    p_sets: sets,
  });
  if (error) throw new Error(`No se pudo guardar la sesión: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.session_id) throw new Error('El servidor no confirmó el entrenamiento.');
  return {
    sessionId: row.session_id,
    exercisesCompleted: Number(row.exercises_completed ?? 0),
    setsSaved: Number(row.sets_saved ?? 0),
    alreadyCompleted: Boolean(row.already_completed),
  };
}
