// Detección determinista y conservadora de progresión. La IA puede explicar el
// resultado, pero no puede inventar una meseta ni decidir una técnica avanzada.

export type PerformanceSet = {
  exercise_name: string;
  weight_kg: number | null;
  reps: number | null;
  rir?: number | null;
  logged_at: string;
  session_id?: string | null;
};

export type ReadinessSummary = {
  adherencePct?: number;
  energy?: number;
  sleepQuality?: number;
  soreness?: number;
  stress?: number;
  painNew?: boolean;
  availableMinutes?: number;
};

export type ProgressStatus = 'insufficient' | 'progressing' | 'stable' | 'regressing';

export type ExerciseProgress = {
  exercise: string;
  status: ProgressStatus;
  exposures: number;
  observationDays: number;
  e1rmChangePct: number | null;
  confidence: 'low' | 'medium' | 'high';
};

export type Intervention = {
  kind: 'collect_data' | 'keep' | 'health_review' | 'adherence' | 'deload' | 'double_progression' | 'dropset';
  title: string;
  detail: string;
  intensityMethod?: 'drop_set';
};

function e1rm(weight: number, reps: number): number {
  // Epley se usa como indicador interno consistente, no como promesa de 1RM.
  return weight * (1 + Math.min(reps, 15) / 30);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyzeExerciseProgress(exercise: string, rows: PerformanceSet[]): ExerciseProgress {
  const valid = rows
    .filter((r) => r.exercise_name === exercise && (r.weight_kg ?? 0) > 0 && (r.reps ?? 0) > 0)
    .sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at));
  const byExposure = new Map<string, number[]>();
  for (const row of valid) {
    const key = row.session_id || row.logged_at.slice(0, 10);
    const values = byExposure.get(key) ?? [];
    values.push(e1rm(row.weight_kg!, row.reps!));
    byExposure.set(key, values);
  }
  const exposures = [...byExposure.values()].map((values) => Math.max(...values));
  const observationDays = valid.length > 1
    ? Math.max(0, Math.round((Date.parse(valid.at(-1)!.logged_at) - Date.parse(valid[0].logged_at)) / 86_400_000))
    : 0;
  if (exposures.length < 3 || observationDays < 14) {
    return { exercise, status: 'insufficient', exposures: exposures.length, observationDays, e1rmChangePct: null, confidence: 'low' };
  }
  const window = Math.max(1, Math.floor(exposures.length / 3));
  const first = median(exposures.slice(0, window));
  const last = median(exposures.slice(-window));
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const status: ProgressStatus = change >= 2 ? 'progressing' : change <= -3 ? 'regressing' : 'stable';
  return {
    exercise,
    status,
    exposures: exposures.length,
    observationDays,
    e1rmChangePct: Number(change.toFixed(1)),
    confidence: exposures.length >= 6 && observationDays >= 28 ? 'high' : 'medium',
  };
}

export function chooseIntervention(args: {
  progress: ExerciseProgress;
  readiness?: ReadinessSummary;
  isIsolation?: boolean;
  goal?: string;
}): Intervention {
  const { progress, readiness = {}, isIsolation = false, goal = '' } = args;
  if (readiness.painNew) {
    return { kind: 'health_review', title: 'Primero revisa el dolor', detail: 'No añadiremos intensidad ni cambiaremos cargas hasta aclarar ese dolor nuevo.' };
  }
  if (progress.status === 'insufficient') {
    return { kind: 'collect_data', title: 'Aún no hay evidencia de meseta', detail: `Hay ${progress.exposures} exposiciones en ${progress.observationDays} días. Mantén la rutina y registra peso, reps y RIR.` };
  }
  if ((readiness.adherencePct ?? 100) < 70) {
    return { kind: 'adherence', title: 'Hagamos el plan más ejecutable', detail: 'Antes de añadir técnicas, reduciremos fricción o duración para que puedas cumplirlo con constancia.' };
  }
  // "No sé nada de tu recuperación" NO es lo mismo que "tu recuperación es
  // buena". Con los `??` de persona sana, un usuario que nunca llenó el
  // cuestionario (o cuyos registros caducaron) recibía la recomendación de
  // técnicas avanzadas al fallo sin un solo dato que la respaldara. Ahora la
  // ausencia de datos se trata como lo que es: falta de evidencia.
  const sinDatosDeRecuperacion =
    readiness.energy == null && readiness.sleepQuality == null &&
    readiness.soreness == null && readiness.stress == null;

  const underRecovered = (readiness.energy ?? 3) <= 2 || (readiness.sleepQuality ?? 3) <= 2 ||
    (readiness.soreness ?? 3) >= 5 || (readiness.stress ?? 3) >= 5;
  if (underRecovered && progress.status !== 'progressing') {
    return { kind: 'deload', title: 'Recupera antes de exigir más', detail: 'Una semana con menos volumen o carga puede ser más útil que sumar intensidad.' };
  }
  if (progress.status === 'progressing') {
    return { kind: 'keep', title: 'No cambies lo que está funcionando', detail: 'Mantén el ejercicio y progresa dentro del rango previsto.' };
  }
  // Dropset: opción acotada, solo aislamiento/hipertrofia y recuperación
  // COMPROBADA. Sin ningún dato de recuperación no se propone: es la única
  // recomendación de este motor que empuja hacia el fallo muscular, y hacerlo
  // a ciegas es exactamente lo que las reglas de seguridad del repo prohíben.
  if (!sinDatosDeRecuperacion &&
      progress.status === 'stable' && isIsolation && /muscle|músculo|hypertrophy/i.test(goal) && progress.exposures >= 6) {
    return {
      kind: 'dropset', intensityMethod: 'drop_set', title: 'Bloque opcional de dropset',
      detail: 'Durante 3–4 semanas, solo en la última serie: reduce 20–30% la carga y continúa con técnica estable. No lo uses en compuestos ni si empeora tu recuperación.',
    };
  }
  return {
    kind: 'double_progression', title: 'Haz el cambio mínimo',
    detail: 'Conserva el ejercicio: completa primero el extremo alto de reps con 1–3 RIR y luego sube la carga 2.5–5%.',
  };
}
