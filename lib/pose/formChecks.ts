// lib/pose/formChecks.ts
// Reglas de técnica (puras). Cada una recibe la pose y la fase y devuelve
// cues. Heurísticas sobre coordenadas normalizadas; pensadas para vista
// frontal/lateral típica de entrenamiento en casa.

import type { Pose, FormCue } from './types';
import { isVisible } from './types';
import type { RepPhase } from './repCounter';
import { angleAt, distance } from './geometry';

/** Ángulo de rodilla usando el lado más visible (cadera-rodilla-tobillo). */
export function kneeAngle(p: Pose): number | null {
  if (isVisible(p.leftHip) && isVisible(p.leftKnee) && isVisible(p.leftAnkle))
    return angleAt(p.leftHip, p.leftKnee, p.leftAnkle);
  if (isVisible(p.rightHip) && isVisible(p.rightKnee) && isVisible(p.rightAnkle))
    return angleAt(p.rightHip, p.rightKnee, p.rightAnkle);
  return null;
}

/** Ángulo de codo usando el lado más visible (hombro-codo-muñeca). */
export function elbowAngle(p: Pose): number | null {
  if (isVisible(p.leftShoulder) && isVisible(p.leftElbow) && isVisible(p.leftWrist))
    return angleAt(p.leftShoulder, p.leftElbow, p.leftWrist);
  if (isVisible(p.rightShoulder) && isVisible(p.rightElbow) && isVisible(p.rightWrist))
    return angleAt(p.rightShoulder, p.rightElbow, p.rightWrist);
  return null;
}

/** Alineación de cadera (hombro-cadera-tobillo); ~180° = cuerpo recto. */
export function hipAlignment(p: Pose): number | null {
  if (isVisible(p.leftShoulder) && isVisible(p.leftHip) && isVisible(p.leftAnkle))
    return angleAt(p.leftShoulder, p.leftHip, p.leftAnkle);
  if (isVisible(p.rightShoulder) && isVisible(p.rightHip) && isVisible(p.rightAnkle))
    return angleAt(p.rightShoulder, p.rightHip, p.rightAnkle);
  return null;
}

// NOTA sobre profundidad: NO se evalúa aquí por fase. La fase queda en
// 'down' durante toda la subida (hasta cruzar upAngle), así que un aviso
// "Más abajo" por fase sonaba en cada ascenso de una rep perfecta. La
// profundidad se evalúa AL COMPLETAR la rep con el ángulo mínimo alcanzado
// (ver live-coach: minAngle por rep).

// ── SENTADILLA ───────────────────────────────────────────
export function squatForm(p: Pose, _phase: RepPhase): FormCue[] {
  const cues: FormCue[] = [];

  // Valgo: rodillas que se cierran más que los tobillos (vista frontal).
  if (isVisible(p.leftKnee) && isVisible(p.rightKnee) && isVisible(p.leftAnkle) && isVisible(p.rightAnkle)) {
    const kneeWidth = distance(p.leftKnee, p.rightKnee);
    const ankleWidth = distance(p.leftAnkle, p.rightAnkle);
    if (ankleWidth > 0 && kneeWidth < ankleWidth * 0.7) {
      cues.push({ zone: 'Rodillas', severity: 'error', message: 'Las rodillas se cierran hacia adentro (valgo).', cue: '¡Rodillas afuera!' });
    }
  }

  if (cues.length === 0) {
    cues.push({ zone: 'Técnica', severity: 'good', message: 'Buena forma, sigue así.', cue: 'Perfecto' });
  }
  return cues;
}

// ── FLEXIONES / PRESS ────────────────────────────────────
export function pushupForm(p: Pose, _phase: RepPhase): FormCue[] {
  const cues: FormCue[] = [];

  // Cadera alineada: si el ángulo hombro-cadera-tobillo es bajo, hay arqueo/hundimiento.
  const hip = hipAlignment(p);
  if (hip !== null && hip < 160) {
    cues.push({ zone: 'Core', severity: 'error', message: 'La cadera se hunde o se eleva — mantén el cuerpo recto.', cue: 'Aprieta el core' });
  }

  if (cues.length === 0) {
    cues.push({ zone: 'Técnica', severity: 'good', message: 'Cuerpo firme y buen rango.', cue: 'Perfecto' });
  }
  return cues;
}
