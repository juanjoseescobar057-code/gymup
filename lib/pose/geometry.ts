// lib/pose/geometry.ts
// Geometría pura sobre landmarks. Sin dependencias → 100% testeable.

import type { Landmark } from './types';

/**
 * Ángulo (en grados) en el vértice B formado por los segmentos B→A y B→C.
 * Ej: ángulo de rodilla = angleAt(cadera, rodilla, tobillo).
 */
export function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return 0;
  let cos = dot / (magAB * magCB);
  cos = Math.min(1, Math.max(-1, cos)); // clamp por errores de redondeo
  return (Math.acos(cos) * 180) / Math.PI;
}

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, score: Math.min(a.score, b.score) };
}

/** Distancia euclidiana en el plano normalizado. */
export function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Inclinación respecto a la vertical (0 = perfectamente vertical), en grados. */
export function tiltFromVertical(top: Landmark, bottom: Landmark): number {
  const dx = Math.abs(top.x - bottom.x);
  const dy = Math.abs(top.y - bottom.y);
  if (dy === 0) return 90;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}
