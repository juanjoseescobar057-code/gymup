// lib/demandasEjercicio.ts
// ─────────────────────────────────────────────────────────
// Qué EXIGE cada ejercicio, y qué se veta por lo que la persona declaró.
//
// El vocabulario ya existía en lib/warmupMath.ts para filtrar el calentamiento y
// los estiramientos. Vive aquí para que lo compartan el calentamiento y el
// post-validador del plan: si mañana se añade un veto —o se corrige uno— las dos
// cosas lo respetan a la vez. Tener dos tablas parecidas y ligeramente distintas
// es exactamente cómo aparecen los agujeros.
//
// OJO CON EL ALCANCE. Esto no diagnostica ni trata nada. Dice "esta persona
// declaró la rodilla lesionada, así que hasta que un profesional diga lo
// contrario no le programamos flexión profunda de rodilla". Es conservador a
// propósito: el error de quitar un ejercicio que sí podía hacer se corrige
// hablando con su fisio; el de programarle uno que no, no.
// ─────────────────────────────────────────────────────────

import type { Condition, InjuryZone } from './healthMath';

export type DemandaMovimiento =
  | 'flexion_lumbar'
  | 'rodilla_profunda'
  | 'hombro_sobre_cabeza'
  | 'cuello_rango'
  | 'muneca_carga'
  | 'cadera_rango'
  | 'tobillo_rango'
  | 'impacto'
  | 'supino'
  | 'intensidad_alta';

/** Qué demandas se descartan por cada lesión declarada. */
export const VETO_POR_LESION: Record<InjuryZone, DemandaMovimiento[]> = {
  rodilla: ['rodilla_profunda', 'impacto'],
  hombro: ['hombro_sobre_cabeza'],
  espalda_baja: ['flexion_lumbar', 'impacto'],
  cuello: ['cuello_rango', 'hombro_sobre_cabeza'],
  muneca_codo: ['muneca_carga'],
  cadera: ['cadera_rango', 'impacto'],
  tobillo_pie: ['tobillo_rango', 'impacto'],
};

/** Y por condición declarada. */
export const VETO_POR_CONDICION: Partial<Record<Condition, DemandaMovimiento[]>> = {
  embarazo: ['supino', 'impacto', 'intensidad_alta'],
  cardiopatia: ['intensidad_alta', 'impacto'],
  asma: ['intensidad_alta'],
  hernia_discal: ['flexion_lumbar'],
  cirugia_reciente: ['impacto', 'intensidad_alta'],
  artritis: ['impacto'],
  hipertension: ['intensidad_alta'],
  // Sin controlar es más estricta: la propia directiva del tamizaje prohíbe
  // cargas altas y Valsalva, y evaluateWorkoutAccess ya bloquea el entreno
  // hasta que haya visto bueno. Esto es la segunda capa, por si se levanta.
  hipertension_no_controlada: ['intensidad_alta', 'impacto'],
};

/**
 * El conjunto de demandas vetadas para esta persona.
 *
 * Con el tamizaje ilegible se aplica el criterio MÁS ESTRICTO. No es exagerar:
 * es el mismo fail-closed que la compuerta clínica, y aquí el resultado se
 * guarda en la base y guía semanas de entrenamiento.
 */
export function vetosDe(
  injuries: InjuryZone[],
  conditions: Condition[],
  saludDesconocida = false,
): Set<DemandaMovimiento> {
  const v = new Set<DemandaMovimiento>();
  if (saludDesconocida) {
    // Lo que no se puede comprobar, no se programa: impacto e intensidad alta
    // son las dos que más daño hacen con una condición sin declarar detrás.
    v.add('impacto');
    v.add('intensidad_alta');
    return v;
  }
  for (const l of injuries) (VETO_POR_LESION[l] ?? []).forEach((d) => v.add(d));
  for (const c of conditions) (VETO_POR_CONDICION[c] ?? []).forEach((d) => v.add(d));
  return v;
}

/**
 * Qué exige un ejercicio, a partir de su nombre.
 *
 * Por nombre y no por identificador porque el plan lo genera un modelo y todavía
 * no hay catálogo canónico. Es una aproximación deliberada, y por eso está del
 * lado conservador: cualquier cosa que suene a sentadilla cuenta como flexión
 * profunda de rodilla, aunque alguna variante no lo sea. Falso positivo = un
 * ejercicio sustituido; falso negativo = un movimiento que la persona declaró
 * que no puede hacer.
 */
export function DEMANDAS_POR_EJERCICIO(nombre: string): DemandaMovimiento[] {
  const n = (nombre || '').toLowerCase();
  const d = new Set<DemandaMovimiento>();

  // Rodilla en flexión profunda.
  if (/sentadilla|squat|zancada|lunge|prensa|split|bulgar|pistol|step.?up|subida al caj/i.test(n)) {
    d.add('rodilla_profunda');
  }
  // Columna cargada en flexión.
  if (/peso muerto|deadlift|buenos d[ií]as|good ?morning|remo con barra|hiperextensi|jal[oó]n al suelo/i.test(n)) {
    d.add('flexion_lumbar');
  }
  // Por encima de la cabeza.
  if (/press militar|press de hombro|overhead|sobre cabeza|jal[oó]n|dominada|pull.?up|elevaci[oó]n frontal|arranque|push ?press/i.test(n)) {
    d.add('hombro_sobre_cabeza');
  }
  // Impacto.
  if (/salto|jump|burpee|comba|cuerda|pliom|carrera|sprint|correr|box jump/i.test(n)) {
    d.add('impacto');
  }
  // Tumbado boca arriba.
  if (/press de banca|banca plana|press banca|puente de gl[uú]teo|hip thrust|crunch|abdominal|elevaci[oó]n de piernas|pullover/i.test(n)) {
    d.add('supino');
  }
  // Carga sobre la muñeca.
  if (/flexion|push.?up|fondo|dip|plancha|plank|curl|press de banca|handstand/i.test(n)) {
    d.add('muneca_carga');
  }
  // Cadera en rango amplio.
  if (/zancada|lunge|sentadilla b[uú]lgara|apertura de cadera|peso muerto rumano|rdl/i.test(n)) {
    d.add('cadera_rango');
  }
  // Intensidad alta declarada en el propio nombre.
  if (/hiit|tabata|al fallo|amrap|máxim|maxim|1rm/i.test(n)) {
    d.add('intensidad_alta');
  }

  return [...d];
}
