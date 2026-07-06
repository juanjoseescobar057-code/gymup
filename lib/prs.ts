// lib/prs.ts
// ─────────────────────────────────────────────────────────
// Récords personales (PRs) y 1RM estimado. Lógica PURA → testeable.
// e1RM por fórmula de Epley: 1RM ≈ peso × (1 + reps/30).
// ─────────────────────────────────────────────────────────

export type SetLite = { weight_kg: number | null; reps: number | null };

export type ExerciseBest = {
  maxWeight: number;  // mayor peso levantado
  maxReps: number;    // más reps en una serie
  best1RM: number;    // mejor 1RM estimado
};

/** 1RM estimado (Epley). reps<=1 devuelve el peso tal cual. */
export function epley1RM(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0;
  if (reps === 1) return Math.round(weightKg);
  return Math.round(weightKg * (1 + reps / 30));
}

/** Mejor marca a partir de una lista de series. */
export function bestFromSets(sets: SetLite[]): ExerciseBest {
  let maxWeight = 0, maxReps = 0, best1RM = 0;
  for (const s of sets) {
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    if (w > maxWeight) maxWeight = w;
    if (r > maxReps) maxReps = r;
    const e = epley1RM(w, r);
    if (e > best1RM) best1RM = e;
  }
  return { maxWeight, maxReps, best1RM };
}

export type PRResult = {
  weight: boolean;
  reps: boolean;
  e1rm: boolean;
  any: boolean;
  best: ExerciseBest;
};

/**
 * Compara las series de esta sesión contra el mejor histórico PREVIO.
 * Si no hay histórico previo, NO se considera PR (es la línea base).
 */
export function detectNewPRs(sessionSets: SetLite[], prev: ExerciseBest | null): PRResult {
  const best = bestFromSets(sessionSets);
  if (!prev) {
    return { weight: false, reps: false, e1rm: false, any: false, best };
  }
  const weight = best.maxWeight > prev.maxWeight;
  const reps = best.maxReps > prev.maxReps;
  const e1rm = best.best1RM > prev.best1RM;
  return { weight, reps, e1rm, any: weight || reps || e1rm, best };
}
