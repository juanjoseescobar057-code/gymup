// lib/goalMath.ts
// ─────────────────────────────────────────────────────────
// Proyección hacia la meta a partir de la tendencia real de peso.
// Lógica PURA → testeable con node --test (sin imports de React Native).
//
// Idea: con el peso de arranque, el peso actual, el peso meta y la
// tendencia (kg/semana) estimamos cuántas semanas faltan y si el ritmo
// es saludable. Nunca prometemos ritmos peligrosos.
// ─────────────────────────────────────────────────────────

export type WeightPoint = { date: string; weight: number };

export type GoalDirection = 'lose' | 'gain' | 'maintain';

export type GoalProjection = {
  hasGoal: boolean;
  direction: GoalDirection;
  currentWeight: number;
  targetWeight: number | null;
  startWeight: number;
  remainingKg: number;         // kg que faltan (siempre >= 0)
  ratePerWeek: number;         // tendencia con signo (+ = subiendo)
  towardGoalPerWeek: number;   // + = avanzando hacia la meta
  onTrack: boolean;            // avanzando a buen ritmo hacia la meta
  stalled: boolean;            // sin cambio de peso apreciable
  reversing: boolean;          // alejándose de la meta
  weeksToGoal: number | null;  // null si no se está avanzando
  etaLabel: string;            // "~6 semanas", "≈ 4 meses", "—"
  pctComplete: number;         // 0..100 entre arranque y meta
  headline: string;
  detail: string;
  observationCount: number;
  observationDays: number;
  enoughData: boolean;
};

// Ritmos saludables (alineados con lib/safety.ts): perder ~1% del peso por
// semana como máximo; ganar músculo ~0.5 kg/semana. Se usan solo para el
// texto de "ritmo saludable", no para bloquear.
const MOVING_THRESHOLD = 0.05; // kg/semana por debajo de esto = estancado

/** Tendencia de peso en kg/semana por regresión lineal simple. */
export function trendPerWeek(points: WeightPoint[]): number {
  const pts = points
    .filter((p) => p && Number.isFinite(p.weight) && !!p.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (pts.length < 2) return 0;

  const t0 = new Date(pts[0].date).getTime();
  const xs = pts.map((p) => (new Date(p.date).getTime() - t0) / (1000 * 60 * 60 * 24)); // días
  const ys = pts.map((p) => p.weight);
  const n = pts.length;

  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  let sxy = 0;
  for (let i = 0; i < n; i++) sxy += xs[i] * ys[i];

  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  const slopePerDay = (n * sxy - sx * sy) / denom;
  return slopePerDay * 7;
}

/** Etiqueta legible de tiempo estimado a partir de semanas. */
export function etaFromWeeks(weeks: number | null): string {
  if (weeks == null || !Number.isFinite(weeks) || weeks <= 0) return '—';
  if (weeks < 1.5) return '~1 semana';
  if (weeks <= 10) return `~${Math.round(weeks)} semanas`;
  const months = weeks / 4.345;
  if (months < 12) return `≈ ${Math.round(months)} meses`;
  const years = months / 12;
  return years < 2 ? '≈ 1 año+' : `≈ ${Math.round(years)} años`;
}

export function projectGoal(args: {
  goal: string;
  currentWeight: number;
  targetWeight: number | null | undefined;
  startWeight?: number | null;
  points: WeightPoint[];
}): GoalProjection {
  const { goal, currentWeight, points } = args;
  const targetWeight =
    args.targetWeight != null && Number.isFinite(args.targetWeight) ? args.targetWeight : null;
  const startWeight =
    args.startWeight != null && Number.isFinite(args.startWeight) ? args.startWeight : currentWeight;

  const ratePerWeek = trendPerWeek(points);
  const validPoints = points
    .filter((p) => p && Number.isFinite(p.weight) && Number.isFinite(Date.parse(p.date)))
    .slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const observationCount = validPoints.length;
  const observationDays = observationCount >= 2
    ? Math.max(0, Math.round((Date.parse(validPoints[observationCount - 1].date) - Date.parse(validPoints[0].date)) / 86_400_000))
    : 0;
  // El peso diario tiene ruido. Nunca etiquetar una meseta por dos pesajes o
  // por pocos días: se requieren al menos 3 puntos y dos semanas observadas.
  const enoughData = observationCount >= 3 && observationDays >= 14;

  // Sin meta de peso (rendimiento/resistencia o target no definido).
  if (targetWeight == null) {
    return {
      hasGoal: false,
      direction: 'maintain',
      currentWeight,
      targetWeight: null,
      startWeight,
      remainingKg: 0,
      ratePerWeek,
      towardGoalPerWeek: 0,
      onTrack: false,
      stalled: enoughData && Math.abs(ratePerWeek) < MOVING_THRESHOLD,
      reversing: false,
      weeksToGoal: null,
      etaLabel: '—',
      pctComplete: 0,
      headline: 'Define tu meta de peso',
      detail: 'Agrega un peso objetivo para ver tu proyección hacia la meta.',
      observationCount, observationDays, enoughData,
    };
  }

  const diff = targetWeight - currentWeight; // + = falta subir
  const direction: GoalDirection =
    Math.abs(diff) < 0.2 ? 'maintain' : diff < 0 ? 'lose' : 'gain';
  const remainingKg = Math.abs(diff);

  // Avance hacia la meta con signo positivo cuando se mueve en la dirección correcta.
  const towardGoalPerWeek =
    direction === 'lose' ? -ratePerWeek : direction === 'gain' ? ratePerWeek : 0;

  const stalled = enoughData && Math.abs(ratePerWeek) < MOVING_THRESHOLD;
  const onTrack = enoughData && direction !== 'maintain' && towardGoalPerWeek >= MOVING_THRESHOLD;
  const reversing = enoughData && direction !== 'maintain' && towardGoalPerWeek <= -MOVING_THRESHOLD;

  const weeksToGoal =
    onTrack && remainingKg > 0 ? Math.ceil(remainingKg / towardGoalPerWeek) : null;
  const cappedWeeks = weeksToGoal != null && weeksToGoal <= 520 ? weeksToGoal : null;
  const etaLabel = etaFromWeeks(cappedWeeks);

  // % completado entre arranque y meta.
  const span = targetWeight - startWeight;
  let pctComplete: number;
  if (Math.abs(span) < 0.01) {
    pctComplete = Math.abs(currentWeight - targetWeight) < 0.2 ? 100 : 0;
  } else {
    pctComplete = Math.max(0, Math.min(100, ((currentWeight - startWeight) / span) * 100));
  }

  // Meta ya alcanzada.
  if (direction === 'maintain') {
    return {
      hasGoal: true, direction, currentWeight, targetWeight, startWeight,
      remainingKg, ratePerWeek, towardGoalPerWeek, onTrack: false, stalled,
      reversing: false, weeksToGoal: null, etaLabel: '—',
      pctComplete: 100,
      headline: '🎯 ¡Meta alcanzada!',
      detail: `Estás en ${currentWeight.toFixed(1)} kg. Ahora toca mantener y consolidar.`,
      observationCount, observationDays, enoughData,
    };
  }

  const verb = direction === 'lose' ? 'perder' : 'ganar';
  let headline: string;
  let detail: string;

  if (onTrack && cappedWeeks != null) {
    headline = `Vas en camino: ${etaLabel}`;
    detail = `Al ritmo actual (${Math.abs(ratePerWeek).toFixed(2)} kg/sem) alcanzas ${targetWeight.toFixed(
      1
    )} kg en ${etaLabel.replace('~', 'unas ').replace('≈', 'unos ')}. Te faltan ${remainingKg.toFixed(1)} kg.`;
  } else if (reversing) {
    headline = 'Vas en dirección contraria';
    detail = `Tu peso se mueve al lado opuesto de tu meta de ${verb}. Revisemos tu plan y nutrición para reencaminarte.`;
  } else if (stalled) {
    headline = 'Posible meseta: revisemos el contexto';
    detail = `En ${observationDays} días la tendencia no muestra un cambio claro. Antes de ajustar calorías o rutina revisaremos adherencia, sueño, estrés, recuperación y variaciones normales. Faltan ${remainingKg.toFixed(1)} kg para tu meta.`;
  } else {
    headline = 'Sigue registrando tu peso';
    detail = `Hay ${observationCount} pesaje${observationCount === 1 ? '' : 's'} en ${observationDays} días. Necesitamos al menos 3 pesajes repartidos en 14 días para interpretar la tendencia sin confundir ruido con estancamiento.`;
  }

  return {
    hasGoal: true, direction, currentWeight, targetWeight, startWeight,
    remainingKg, ratePerWeek, towardGoalPerWeek, onTrack, stalled, reversing,
    weeksToGoal: cappedWeeks, etaLabel, pctComplete, headline, detail,
    observationCount, observationDays, enoughData,
  };
}
