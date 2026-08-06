import type { SetLogInput } from './setLogs';

export type NormalizedWorkoutSet = {
  exercise_name: string;
  set_number: number;
  weight_kg: number | null;
  reps: number;
  rir: number | null;
};

/**
 * Valida el lote completo antes de enviarlo. Nunca descarta series en silencio:
 * si una está dañada, el snapshot local se conserva y la persona puede corregir
 * o reintentar sin creer que guardó más de lo que realmente quedó registrado.
 */
export function normalizeCompletedSets(input: SetLogInput[]): NormalizedWorkoutSet[] {
  if (input.length === 0) throw new Error('Registra al menos una serie con repeticiones antes de terminar.');
  const seen = new Set<string>();

  return input.map((set, index) => {
    const name = set.exercise_name.trim();
    const weight = set.weight_kg ?? null;
    const rir = set.rir ?? null;
    if (!name || name.length > 200) throw new Error(`La serie ${index + 1} no tiene un ejercicio válido.`);
    if (!Number.isInteger(set.set_number) || set.set_number < 1 || set.set_number > 100) {
      throw new Error(`La serie ${index + 1} tiene un número de serie inválido.`);
    }
    if (!Number.isInteger(set.reps) || (set.reps ?? 0) < 1 || (set.reps ?? 0) > 1000) {
      throw new Error(`La serie ${index + 1} tiene repeticiones inválidas.`);
    }
    if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 1000)) {
      throw new Error(`La serie ${index + 1} tiene un peso inválido.`);
    }
    if (rir !== null && (!Number.isFinite(rir) || rir < 0 || rir > 10)) {
      throw new Error(`La serie ${index + 1} tiene un RIR inválido.`);
    }
    const key = `${name.toLocaleLowerCase('es')}::${set.set_number}`;
    if (seen.has(key)) throw new Error(`La serie ${set.set_number} de ${name} está duplicada.`);
    seen.add(key);
    return {
      exercise_name: name,
      set_number: set.set_number,
      weight_kg: weight,
      reps: set.reps as number,
      rir,
    };
  });
}
