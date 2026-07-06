// lib/pose/usePoseStream.ts
// ─────────────────────────────────────────────────────────
// Fuente de poses para el Live Coach.
//   • Con detector nativo (dev build): se alimentaría desde el frame
//     processor (ver docs/live-coach-native.md).
//   • Sin él (Expo Go): MODO VISTA PREVIA — genera una sentadilla
//     simulada que ejercita el MISMO motor (ángulo → reps → técnica),
//     para validar toda la lógica sin cámara.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import type { Pose } from './types';
import { isLiveDetectorAvailable } from './detector';

/** Construye una pose de sentadilla con un ángulo de rodilla objetivo (°). */
function squatPoseForAngle(kneeDeg: number): Pose {
  const theta = ((180 - kneeDeg) * Math.PI) / 180; // bend desde la vertical
  const r = 0.2;
  const mk = (cx: number) => ({
    hip:   { x: cx, y: 0.40, score: 1 },
    knee:  { x: cx, y: 0.60, score: 1 },
    ankle: { x: cx + Math.sin(theta) * r, y: 0.60 + Math.cos(theta) * r, score: 1 },
  });
  const left = mk(0.40);
  const right = mk(0.60);
  return {
    leftHip: left.hip, leftKnee: left.knee, leftAnkle: left.ankle,
    rightHip: right.hip, rightKnee: right.knee, rightAnkle: right.ankle,
    leftShoulder: { x: 0.40, y: 0.22, score: 1 },
    rightShoulder: { x: 0.60, y: 0.22, score: 1 },
  };
}

export function usePoseStream(active: boolean): { pose: Pose | null; simulated: boolean } {
  const [pose, setPose] = useState<Pose | null>(null);
  const tRef = useRef(0);
  const simulated = !isLiveDetectorAvailable();

  useEffect(() => {
    if (!active) return;
    // MODO REAL: aquí se suscribiría al frame processor nativo.
    // MODO VISTA PREVIA: oscila el ángulo de rodilla 80°↔170° (~3s/rep).
    if (!simulated) return;
    const id = setInterval(() => {
      tRef.current += 0.18;
      const knee = 125 + 45 * Math.cos(tRef.current); // 80..170
      setPose(squatPoseForAngle(knee));
    }, 90);
    return () => clearInterval(id);
  }, [active, simulated]);

  return { pose, simulated };
}
