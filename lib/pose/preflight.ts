// lib/pose/preflight.ts
// ─────────────────────────────────────────────────────────
// Preflight del coach en vivo: antes de habilitar "Empezar" hay que saber si
// la cámara realmente ve lo que necesita ver.
//
// Antes se arrancaba a contar de una: si el encuadre estaba mal, el motor
// contaba mal (o no contaba) y el usuario no tenía forma de saber si el
// problema era su técnica, su teléfono o la app. Peor: unas reps inventadas
// por un encuadre malo terminan en el historial como si fueran reales.
//
// Todo lo de aquí es PURO y derivado de la pose. Deliberadamente NO hay un
// estado de "poca luz": desde los keypoints no se puede distinguir una sala
// oscura de una persona tapada o de ropa que confunde al modelo, y un
// indicador de iluminación que en realidad mide otra cosa miente. Cuando el
// modelo no ve lo suficiente, eso sale como `no_person` / `partial_body`,
// que es lo que sí sabemos.
// ─────────────────────────────────────────────────────────

import { isVisible, type Joint, type Pose } from './types';

/** Estados derivables del encuadre (lo que ve la cámara). */
export type EstadoEncuadre =
  | 'no_person'
  | 'partial_body'
  | 'too_close'
  | 'too_far'
  | 'ready';

/**
 * Estados del preflight completo. Los tres últimos NO vienen de la pose sino
 * de la capa de cámara/dispositivo, y por eso no los decide `evaluarEncuadre`.
 */
export type EstadoPreflight =
  | EstadoEncuadre
  | 'camera_denied'
  | 'model_unavailable'
  | 'device_not_supported';

/** Torso: si no se ve nada de esto, no hay persona en cuadro. */
const NUCLEO: Joint[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

const CUERPO_COMPLETO: Joint[] = [
  'leftShoulder', 'rightShoulder',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
];

const TREN_SUPERIOR: Joint[] = [
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
];

/**
 * Qué tiene que verse para que ESTE ejercicio se pueda contar. No es lo mismo
 * un curl de bíceps (basta el brazo) que una sentadilla (hacen falta tobillos):
 * exigir cuerpo completo siempre bloquearía sesiones perfectamente válidas.
 */
const REQUERIDAS: Record<string, Joint[]> = {
  squat: CUERPO_COMPLETO,
  lunge: CUERPO_COMPLETO,
  pushup: [...TREN_SUPERIOR, 'leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
  biceps_curl: TREN_SUPERIOR,
  shoulder_press: TREN_SUPERIOR,
};

export function articulacionesRequeridas(exId: string): Joint[] {
  return REQUERIDAS[exId] ?? CUERPO_COMPLETO;
}

/**
 * Umbrales de encuadre sobre coordenadas normalizadas [0..1]. Se mide el lado
 * MAYOR (alto o ancho) porque las flexiones ocupan el cuadro en horizontal:
 * medir solo la altura las habría marcado siempre como "muy lejos".
 */
export const SPAN_MIN = 0.45; // por debajo: la persona es demasiado pequeña
export const SPAN_MAX = 0.97; // por encima: toca los bordes, se va a salir

/** Frames seguidos en `ready` antes de habilitar el botón (evita parpadeos). */
export const FRAMES_ESTABLES = 5;

export function evaluarEncuadre(pose: Pose | null | undefined, exId: string): EstadoEncuadre {
  if (!pose) return 'no_person';

  const hayNucleo = NUCLEO.some((j) => isVisible(pose[j]));
  if (!hayNucleo) return 'no_person';

  const requeridas = articulacionesRequeridas(exId);
  const visibles = requeridas.filter((j) => isVisible(pose[j]));
  if (visibles.length < requeridas.length) return 'partial_body';

  const xs = visibles.map((j) => pose[j]!.x);
  const ys = visibles.map((j) => pose[j]!.y);
  const span = Math.max(
    Math.max(...ys) - Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
  );

  if (span > SPAN_MAX) return 'too_close';
  if (span < SPAN_MIN) return 'too_far';
  return 'ready';
}

export type CopyPreflight = { titulo: string; detalle: string; listo: boolean };

/**
 * Cada estado dice QUÉ hacer, no solo qué falla. "No se detecta a nadie" deja
 * al usuario adivinando; "aléjate hasta que se vean los pies" es accionable.
 */
export function copyPreflight(estado: EstadoPreflight): CopyPreflight {
  switch (estado) {
    case 'ready':
      return { titulo: 'Listo', detalle: 'Te veo completo. Cuando quieras.', listo: true };
    case 'no_person':
      return {
        titulo: 'No te veo',
        detalle: 'Ponte frente a la cámara. Si el sitio está oscuro, enciende una luz.',
        listo: false,
      };
    case 'partial_body':
      return {
        titulo: 'Te veo a medias',
        detalle: 'Falta parte de tu cuerpo en cuadro. Aléjate o inclina el teléfono.',
        listo: false,
      };
    case 'too_close':
      return { titulo: 'Muy cerca', detalle: 'Aléjate un par de pasos del teléfono.', listo: false };
    case 'too_far':
      return { titulo: 'Muy lejos', detalle: 'Acércate hasta ocupar más del cuadro.', listo: false };
    case 'camera_denied':
      return {
        titulo: 'Cámara sin permiso',
        detalle: 'Actívala en los ajustes del teléfono para usar el coach en vivo.',
        listo: false,
      };
    case 'model_unavailable':
      return {
        titulo: 'Modelo no disponible',
        detalle: 'No se pudo cargar el detector de pose. Puedes entrenar sin conteo automático.',
        listo: false,
      };
    case 'device_not_supported':
      return {
        titulo: 'Dispositivo no compatible',
        detalle: 'Este teléfono no puede correr el detector. Puedes entrenar sin conteo automático.',
        listo: false,
      };
  }
}

// ─── RESUMEN DE LA SESIÓN ────────────────────────────────

/** Por debajo de esto, el conteo no es de fiar y hay que decirlo. */
export const CALIDAD_MINIMA = 0.7;

/** Más de tres correcciones no se recuerdan; se queda con las más repetidas. */
export const MAX_CUES_RESUMEN = 3;

export type ResumenSesion = {
  calidad: number;          // 0..1
  deteccionIncompleta: boolean;
  topCues: string[];
};

/**
 * Qué contar al terminar. Separado del componente porque decide dos cosas que
 * el usuario ve y sobre las que actúa: si avisamos de que el conteo puede
 * estar mal, y qué tres correcciones se lleva a casa.
 *
 * Sin frames procesados la calidad es 0 y se avisa: no haber podido medir
 * nada NO es lo mismo que haber medido bien.
 */
export function resumirSesion(
  framesTotal: number,
  framesConPose: number,
  cues: Map<string, number>,
): ResumenSesion {
  const calidad = framesTotal > 0 ? framesConPose / framesTotal : 0;
  const topCues = [...cues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CUES_RESUMEN)
    .map(([texto]) => texto);
  return { calidad, deteccionIncompleta: calidad < CALIDAD_MINIMA, topCues };
}
