export type AdaptableExercise = {
  sets: number;
  rest_seconds?: number;
  target_rir?: number;
};

export type SessionContext = {
  availableMinutes: number;
  energy: number;
  soreness: number;
};

/** Autoregula solo la sesión de hoy; nunca modifica el plan base. */
export function adaptSessionExercises<T extends AdaptableExercise>(
  exercises: T[],
  context: SessionContext,
): T[] {
  const short = context.availableMinutes <= 20;
  const medium = context.availableMinutes > 20 && context.availableMinutes <= 40;
  const recoveryDay = context.energy <= 2 || context.soreness >= 4;
  const limit = short ? 2 : medium ? 3 : exercises.length;

  return exercises.slice(0, limit).map((exercise, index) => {
    const timeCap = short ? (index === 0 ? 3 : 2) : medium ? 3 : exercise.sets;
    let sets = Math.min(exercise.sets, timeCap);
    if (recoveryDay) sets = Math.max(1, Math.floor(sets * 0.75));
    return {
      ...exercise,
      sets,
      rest_seconds: short
        ? Math.min(exercise.rest_seconds ?? 90, 90)
        : medium
          ? Math.min(exercise.rest_seconds ?? 120, 120)
          : exercise.rest_seconds,
      target_rir: recoveryDay ? Math.max(exercise.target_rir ?? 2, 3) : exercise.target_rir,
    };
  });
}

export function sessionAdaptationMessage(context: SessionContext): string | null {
  const reasons: string[] = [];
  if (context.availableMinutes <= 40) reasons.push(`priorizamos lo esencial para ${context.availableMinutes} min`);
  if (context.energy <= 2 || context.soreness >= 4) reasons.push('bajamos volumen y dejamos más repeticiones en reserva');
  if (reasons.length === 0) return null;
  return `Sesión ajustada: ${reasons.join('; ')}. Tu plan base no cambia y esto no cuenta como fallar.`;
}
