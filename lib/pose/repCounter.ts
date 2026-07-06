// lib/pose/repCounter.ts
// Contador de repeticiones como máquina de estados sobre un ángulo guía.
// Pura → testeable alimentándola con una secuencia de ángulos.

export type RepPhase = 'up' | 'down';
export type RepState = { phase: RepPhase; reps: number };

export type RepConfig = {
  downAngle: number; // ángulo (°) por debajo del cual se considera "abajo"
  upAngle: number;   // ángulo (°) por encima del cual vuelve "arriba" (cuenta rep)
};

export function initRepState(): RepState {
  return { phase: 'up', reps: 0 };
}

/**
 * Avanza la máquina con un nuevo ángulo guía.
 * Cuenta una repetición al completar el ciclo abajo→arriba.
 * La histéresis (downAngle < upAngle) evita conteos dobles por vibración.
 */
export function updateReps(
  state: RepState,
  angle: number,
  cfg: RepConfig
): { state: RepState; justCompleted: boolean } {
  if (state.phase === 'up' && angle <= cfg.downAngle) {
    return { state: { ...state, phase: 'down' }, justCompleted: false };
  }
  if (state.phase === 'down' && angle >= cfg.upAngle) {
    return { state: { phase: 'up', reps: state.reps + 1 }, justCompleted: true };
  }
  return { state, justCompleted: false };
}
