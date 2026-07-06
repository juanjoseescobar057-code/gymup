// lib/adaptivePlanMath.ts
// Lógica pura de la re-planificación adaptativa (sin dependencias de RN).

export type Advice = 'progresar' | 'mantener' | 'deload';

/** Extrae el tope de reps de un texto tipo "8-10" o "12". */
export function parseRepsHigh(reps: string): number {
  const nums = String(reps).match(/\d+/g);
  if (!nums || nums.length === 0) return 0;
  return Math.max(...nums.map(Number));
}

/** Sugerencia de progresión según reps logradas vs objetivo. */
export function progressionAdvice(loggedReps: number, targetRepsHigh: number): Advice {
  if (targetRepsHigh <= 0) return 'mantener';
  if (loggedReps > targetRepsHigh) return 'progresar';
  if (loggedReps >= targetRepsHigh - 2) return 'mantener';
  return 'deload';
}

export type PerfRow = { exercise_name: string; weight_kg: number | null; reps: number | null; logged_at: string };

/** Resumen de desempeño reciente por ejercicio (texto para el prompt). */
export function summarizePerformance(rows: PerfRow[]): string {
  const byEx: Record<string, PerfRow[]> = {};
  for (const r of rows) (byEx[r.exercise_name] ??= []).push(r);
  const lines = Object.entries(byEx).map(([name, sets]) => {
    const last = sets[0];
    const maxW = Math.max(...sets.map((s) => s.weight_kg ?? 0));
    const maxR = Math.max(...sets.map((s) => s.reps ?? 0));
    return `- ${name}: última ${last.weight_kg ?? '?'}kg×${last.reps ?? '?'}, mejor ${maxW}kg / ${maxR} reps`;
  });
  return lines.join('\n') || 'Sin series registradas aún.';
}
