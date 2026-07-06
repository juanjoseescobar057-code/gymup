// lib/pose/exercises.ts
// Configuración por ejercicio para el coach en vivo: qué ángulo guía la
// cuenta de reps y qué reglas de técnica aplicar.

import type { Pose, FormCue } from './types';
import type { RepConfig, RepPhase } from './repCounter';
import { kneeAngle, elbowAngle, squatForm, pushupForm } from './formChecks';

export type PoseExerciseConfig = {
  id: string;
  label: string;
  primaryAngle: (p: Pose) => number | null; // ángulo que guía las reps
  rep: RepConfig;
  form: (p: Pose, phase: RepPhase) => FormCue[];
};

const NO_FORM = (): FormCue[] => [];

export const POSE_EXERCISES: Record<string, PoseExerciseConfig> = {
  squat: {
    id: 'squat', label: 'Sentadilla',
    primaryAngle: kneeAngle,
    rep: { downAngle: 100, upAngle: 160 },
    form: squatForm,
  },
  pushup: {
    id: 'pushup', label: 'Flexiones',
    primaryAngle: elbowAngle,
    rep: { downAngle: 100, upAngle: 160 },
    form: pushupForm,
  },
  lunge: {
    id: 'lunge', label: 'Zancada',
    primaryAngle: kneeAngle,
    rep: { downAngle: 100, upAngle: 160 },
    form: squatForm, // mismas reglas de rodilla/profundidad
  },
  biceps_curl: {
    id: 'biceps_curl', label: 'Curl de bíceps',
    primaryAngle: elbowAngle,
    // Flexiona (~60°) y extiende (~155°): una rep = subir y bajar el brazo.
    rep: { downAngle: 70, upAngle: 150 },
    form: NO_FORM,
  },
  shoulder_press: {
    id: 'shoulder_press', label: 'Press de hombro',
    primaryAngle: elbowAngle,
    // Codo a ~90° abajo (mancuernas al hombro) y lockout arriba (~165°).
    rep: { downAngle: 100, upAngle: 160 },
    form: NO_FORM,
  },
  // Genérico: cuenta por rodilla si se ve, sin reglas específicas.
  generic: {
    id: 'generic', label: 'Ejercicio',
    primaryAngle: kneeAngle,
    rep: { downAngle: 100, upAngle: 160 },
    form: NO_FORM,
  },
};

export function getPoseExercise(id: string): PoseExerciseConfig {
  return POSE_EXERCISES[id] ?? POSE_EXERCISES.generic;
}
