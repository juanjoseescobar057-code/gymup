// lib/readinessMath.ts
// ─────────────────────────────────────────────────────────
// CÓMO LLEGA LA PERSONA, y cuánto de eso sabemos de verdad.
//
// EL PROBLEMA QUE RESUELVE
// adaptivePlan promediaba así:
//
//     sleepQuality: Math.round(rows.reduce((a, r) => a + (r.sleep_quality ?? 3), 0) / rows.length)
//
// Ese `?? 3` convierte "no lo sé" en "está normal". Y como 3 es justo el valor
// neutro, las señales reales se diluyen hasta desaparecer: alguien con dos
// sesiones de energía 2 y ocho sin dato promedia 2.8, y ninguna de las reglas
// de progressionEngine —que disparan en <= 2— llega a ejecutarse.
//
// Es el mismo error que la app ya evita en la salud (loadHealthSafe distingue
// 'ok' de 'unknown' y nunca asume "sano"), solo que aquí se había colado.
//
// Aquí los nulos se OMITEN del promedio, y si no queda ningún dato el campo
// va `undefined`: "desconocido" viaja como desconocido hasta quien decide.
// ─────────────────────────────────────────────────────────

import type { ReadinessSummary } from './progressionEngine';

export type FilaReadiness = {
  energy: number | null;
  sleep_quality: number | null;
  soreness: number | null;
  stress: number | null;
  pain_new: boolean | null;
  available_minutes?: number | null;
};

/** Media de los valores presentes. undefined si no hay ninguno. */
function mediaDe(filas: FilaReadiness[], k: keyof FilaReadiness): number | undefined {
  const vals = filas.map((f) => f[k]).filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function resumirReadiness(filas: FilaReadiness[]): ReadinessSummary | undefined {
  if (filas.length === 0) return undefined;
  return {
    energy: mediaDe(filas, 'energy'),
    sleepQuality: mediaDe(filas, 'sleep_quality'),
    soreness: mediaDe(filas, 'soreness'),
    stress: mediaDe(filas, 'stress'),
    availableMinutes: mediaDe(filas, 'available_minutes'),
    // Un dolor nuevo en CUALQUIERA de las últimas sesiones basta: promediarlo
    // lo apagaría, y es la única señal de aquí que es de salud.
    painNew: filas.some((f) => f.pain_new === true),
  };
}

/** Cuántos de los cinco campos subjetivos tienen dato. Para medir confianza. */
export function coberturaReadiness(filas: FilaReadiness[]): number {
  if (filas.length === 0) return 0;
  const campos: (keyof FilaReadiness)[] = ['energy', 'sleep_quality', 'soreness', 'stress'];
  const conDato = campos.filter((k) => mediaDe(filas, k) !== undefined).length;
  return conDato / campos.length;
}

// ─── ADHERENCIA ──────────────────────────────────────────

export type Adherencia = {
  /** 0..100, o null si no hay datos suficientes para afirmarlo. */
  pct: number | null;
  sesionesEsperadas: number;
  sesionesHechas: number;
  semanas: number;
};

/**
 * Qué porcentaje del plan está cumpliendo.
 *
 * progressionEngine tiene una rama que reduce la fricción del plan cuando la
 * adherencia baja del 70%, pero hasta ahora NADIE calculaba el dato y el
 * `?? 100` la dejaba muerta — el motor presumía cumplimiento perfecto de todo
 * el mundo. El propio código lo advertía en un comentario.
 *
 * Devuelve null con menos de dos semanas de plan: una semana mala no es un
 * patrón de adherencia, y recortar el plan de alguien por una gripe sería
 * castigar justo cuando peor lo está pasando.
 */
export function calcularAdherencia(args: {
  /** Días de entreno que tiene el plan por semana. */
  diasDeEntrenoPorSemana: number;
  /** Fechas ISO de las sesiones COMPLETADAS en la ventana. */
  sesionesCompletadas: string[];
  /** Cuántas semanas mira hacia atrás. */
  semanas: number;
  hoyISO: string;
}): Adherencia {
  const { diasDeEntrenoPorSemana, semanas, hoyISO } = args;

  const vacia: Adherencia = { pct: null, sesionesEsperadas: 0, sesionesHechas: 0, semanas };
  if (diasDeEntrenoPorSemana <= 0 || semanas < 2) return vacia;

  const hoy = Date.parse(hoyISO.slice(0, 10));
  if (Number.isNaN(hoy)) return vacia;

  const desde = hoy - semanas * 7 * 86_400_000;
  const hechas = args.sesionesCompletadas.filter((iso) => {
    const t = Date.parse(iso.slice(0, 10));
    return Number.isFinite(t) && t >= desde && t <= hoy;
  }).length;

  const esperadas = diasDeEntrenoPorSemana * semanas;

  return {
    // Se topa en 100: entrenar de más no es adherencia del 130%, y dejarlo
    // pasar haría que un buen mes tapara uno malo en cualquier promedio.
    pct: Math.min(100, Math.round((hechas / esperadas) * 100)),
    sesionesEsperadas: esperadas,
    sesionesHechas: hechas,
    semanas,
  };
}
