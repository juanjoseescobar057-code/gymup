// lib/pose/types.ts
// ─────────────────────────────────────────────────────────
// Tipos del motor de pose. Detector-AGNÓSTICO: definimos nuestras
// propias articulaciones para no acoplarnos a MediaPipe ni MoveNet.
// Un adaptador mapea los índices del detector a estas claves.
// ─────────────────────────────────────────────────────────

/** Punto detectado. x/y normalizados [0..1]; score = confianza [0..1]. */
export type Landmark = { x: number; y: number; score: number };

export type Joint =
  | 'nose'
  | 'leftShoulder' | 'rightShoulder'
  | 'leftElbow'    | 'rightElbow'
  | 'leftWrist'    | 'rightWrist'
  | 'leftHip'      | 'rightHip'
  | 'leftKnee'     | 'rightKnee'
  | 'leftAnkle'    | 'rightAnkle';

/** Una pose = subconjunto de articulaciones detectadas en un frame. */
export type Pose = Partial<Record<Joint, Landmark>>;

export type Severity = 'good' | 'warn' | 'error';

/** Retroalimentación de técnica para un frame. */
export type FormCue = {
  zone: string;
  severity: Severity;
  message: string;
  cue: string; // frase corta para decir en voz alta
};

/** Confianza mínima para fiarnos de una articulación. */
export const MIN_SCORE = 0.3;

/** ¿La articulación existe y es confiable? */
export function isVisible(lm?: Landmark): lm is Landmark {
  return !!lm && lm.score >= MIN_SCORE;
}
