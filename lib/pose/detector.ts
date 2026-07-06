// lib/pose/detector.ts
// ─────────────────────────────────────────────────────────
// Abstracción del detector de pose. La detección real corre en un frame
// processor nativo (vision-camera + MoveNet/MediaPipe), que SOLO existe
// en un development build. Aquí va el adaptador de salida (puro) y el
// guard de disponibilidad para degradar con elegancia.
// ─────────────────────────────────────────────────────────

import type { Pose, Joint, Landmark } from './types';

/** Orden de keypoints de MoveNet (17 puntos). */
const MOVENET_ORDER: (Joint | null)[] = [
  'nose', null, null, null, null,        // nose, ojos, orejas (ignoramos ojos/orejas)
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
];

/**
 * Adapta la salida de MoveNet a nuestra Pose detector-agnóstica.
 * MoveNet emite cada keypoint como [y, x, score]; el llamador (PoseCamera)
 * ya arma objetos {x, y, score}, así que esta función es agnóstica al orden
 * y solo usa los campos nombrados. PURO → testeable.
 *
 * `aspect` = ancho/alto del frame original. El resize a cuadrado aplasta la
 * imagen; multiplicar X por el aspecto devuelve las coordenadas a un espacio
 * métricamente uniforme para que los ÁNGULOS articulares salgan correctos.
 */
export function movenetToPose(
  keypoints: { x: number; y: number; score: number }[],
  aspect = 1
): Pose {
  const pose: Pose = {};
  for (let i = 0; i < MOVENET_ORDER.length && i < keypoints.length; i++) {
    const joint = MOVENET_ORDER[i];
    if (!joint) continue;
    const kp = keypoints[i];
    if (kp) pose[joint] = { x: kp.x * aspect, y: kp.y, score: kp.score } as Landmark;
  }
  return pose;
}

/**
 * ¿Hay un detector nativo disponible? En Expo Go / sin development build, NO.
 * En el dev build, el frame processor inyecta poses y esto devolvería true.
 * (Se mantiene en false hasta cablear el módulo nativo — ver docs.)
 */
export function isLiveDetectorAvailable(): boolean {
  return false;
}
