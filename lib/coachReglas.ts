// lib/coachReglas.ts
// ─────────────────────────────────────────────────────────
// EL COACH DEL PLAN GRATIS. Sin IA, sin tokens, sin red.
//
// Hasta ahora el coach era IA o no era nada: quien no pagaba abría la app y
// nadie le decía nada sobre sus propios números. Pero lo que de verdad hace
// progresar a alguien —cuándo subir el peso, cuándo bajar, qué evitar con una
// hernia— ya está resuelto de forma determinista en progressionEngine,
// warmupMath y healthMath. Lo único que faltaba era decirlo.
//
// Esto NO es una versión pobre del coach IA. Es otra cosa: el coach IA
// responde lo que le preguntes; este te dice lo que hoy importa de tus datos,
// sin que preguntes y sin equivocarse, porque no inventa nada.
//
// Reglas que se respetan aquí, todas por motivos que ya costaron caro antes:
//   • Nada de culpa. "Llevas 5 días sin entrenar" no lleva reproche: la gente
//     que se siente juzgada por una app la desinstala, no entrena más.
//   • Nada de números inventados. Si no hay datos suficientes, se dice.
//   • La salud manda sobre todo lo demás, y si no se pudo leer, se asume lo
//     más conservador.
// ─────────────────────────────────────────────────────────

import type { ExerciseProgress, Intervention } from './progressionEngine';

export type OrigenConsejo = 'salud' | 'progresion' | 'plan' | 'racha' | 'nutricion' | 'descanso';

export type ConsejoCoach = {
  /** Identidad estable del consejo: evita repetir el mismo texto dos veces. */
  clave: string;
  texto: string;
  /** Mayor gana. La salud siempre por encima del rendimiento. */
  prioridad: number;
  origen: OrigenConsejo;
};

export type ContextoCoach = {
  progresos: ExerciseProgress[];
  /** Lo que decidió progressionEngine.chooseIntervention, si decidió algo. */
  intervencion: Intervention | null;
  rachaActual: number;
  mejorRacha: number;
  diasSinEntrenar: number;
  /** Grupos musculares de hoy. Lista vacía = día de descanso. */
  grupoDeHoy: string[];
  lesiones: string[];
  condiciones: string[];
  /** null si no se pudo leer el tamizaje: se asume lo conservador. */
  saludDesconocida?: boolean;
  proteinaHoyG: number | null;
  proteinaMetaG: number | null;
  /** PRs de los últimos días, ya filtrados por quien llama. */
  prsRecientes: { ejercicio: string; pesoKg: number }[];
};

/** Cuántos consejos se muestran. Más de tres no se leen. */
export const MAX_CONSEJOS = 3;

const PRIORIDAD = {
  salud: 100,
  intervencion: 80,
  estancamiento: 60,
  regreso: 55,
  descanso: 50,
  pr: 40,
  progreso: 35,
  nutricion: 25,
  racha: 20,
  base: 10,
} as const;

/** Nombre legible de una condición, para no soltarle la clave interna al usuario. */
const NOMBRE_CONDICION: Record<string, string> = {
  hernia_discal: 'tu hernia',
  embarazo: 'el embarazo',
  cardiopatia: 'tu condición cardíaca',
  asma: 'el asma',
  artritis: 'la artritis',
  cirugia_reciente: 'tu cirugía reciente',
  hipertension: 'la hipertensión',
};

const NOMBRE_LESION: Record<string, string> = {
  rodilla: 'la rodilla',
  hombro: 'el hombro',
  espalda_baja: 'la espalda baja',
  cuello: 'el cuello',
  muneca_codo: 'la muñeca',
  cadera: 'la cadera',
  tobillo_pie: 'el tobillo',
};

function legible(clave: string, mapa: Record<string, string>): string {
  return mapa[clave] ?? clave.replace(/_/g, ' ');
}

/**
 * Los consejos de hoy, ordenados por lo que más importa y recortados a tres.
 *
 * NUNCA devuelve una lista vacía: una pantalla de coach en blanco se lee como
 * "no tengo nada que decirte", que es justo lo contrario del producto.
 */
export function consejosDelDia(ctx: ContextoCoach): ConsejoCoach[] {
  const consejos: ConsejoCoach[] = [];
  const esDescanso = ctx.grupoDeHoy.length === 0;

  // ── Salud: siempre primero ──
  if (ctx.saludDesconocida) {
    consejos.push({
      clave: 'salud_desconocida',
      origen: 'salud',
      prioridad: PRIORIDAD.salud,
      texto: 'No pude leer tu cuestionario de salud, así que hoy voy por lo conservador. Complétalo y ajusto todo a ti.',
    });
  } else {
    const primeraCondicion = ctx.condiciones[0];
    const primeraLesion = ctx.lesiones[0];
    if (primeraCondicion) {
      consejos.push({
        clave: `salud_cond_${primeraCondicion}`,
        origen: 'salud',
        prioridad: PRIORIDAD.salud,
        texto: `Por ${legible(primeraCondicion, NOMBRE_CONDICION)}, el calentamiento y los ejercicios de hoy ya vienen filtrados. Si algo te molesta, párate.`,
      });
    } else if (primeraLesion) {
      consejos.push({
        clave: `salud_lesion_${primeraLesion}`,
        origen: 'salud',
        prioridad: PRIORIDAD.salud,
        texto: `Con ${legible(primeraLesion, NOMBRE_LESION)}, hoy evitamos lo que la carga de más. Molestia leve se tolera; dolor punzante no.`,
      });
    }
  }

  // ── Lo que decidió el motor de progresión ──
  if (ctx.intervencion && ctx.intervencion.kind !== 'collect_data') {
    consejos.push({
      clave: `intervencion_${ctx.intervencion.kind}`,
      origen: 'progresion',
      prioridad: PRIORIDAD.intervencion,
      texto: `${ctx.intervencion.title}. ${ctx.intervencion.detail}`,
    });
  }

  // ── Un ejercicio estancado, con nombre y apellido ──
  // Se elige el de MAYOR confianza: avisar de una meseta a partir de dos
  // series sueltas es ruido, y enseña a ignorar los avisos.
  const estancado = ctx.progresos
    .filter((p) => (p.status === 'stable' || p.status === 'regressing') && p.confidence !== 'low')
    .sort((a, b) => b.exposures - a.exposures)[0];
  if (estancado) {
    consejos.push({
      clave: `estancado_${estancado.exercise}`,
      origen: 'progresion',
      prioridad: PRIORIDAD.estancamiento,
      texto: `${estancado.exercise} lleva ${estancado.exposures} sesiones sin avanzar. Baja al 90% esta semana y vuelve a subir: casi siempre destraba.`,
    });
  }

  // ── Un ejercicio que sí progresa ──
  const progresando = ctx.progresos
    .filter((p) => p.status === 'progressing' && p.e1rmChangePct !== null && p.e1rmChangePct > 0)
    .sort((a, b) => (b.e1rmChangePct ?? 0) - (a.e1rmChangePct ?? 0))[0];
  if (progresando) {
    consejos.push({
      clave: `progresa_${progresando.exercise}`,
      origen: 'progresion',
      prioridad: PRIORIDAD.progreso,
      texto: `${progresando.exercise} va subiendo (${progresando.e1rmChangePct!.toFixed(0)}% en ${progresando.observationDays} días). Sigue con la misma progresión.`,
    });
  }

  // ── Un récord reciente ──
  const pr = ctx.prsRecientes[0];
  if (pr) {
    consejos.push({
      clave: `pr_${pr.ejercicio}`,
      origen: 'progresion',
      prioridad: PRIORIDAD.pr,
      texto: `Récord en ${pr.ejercicio}: ${pr.pesoKg} kg. Ese número es tuyo.`,
    });
  }

  // ── Volver después de una pausa: sin reproche ──
  if (ctx.diasSinEntrenar >= 7) {
    consejos.push({
      clave: 'regreso',
      origen: 'plan',
      prioridad: PRIORIDAD.regreso,
      texto: 'Volviste. Hoy no busques tus mejores marcas: baja un 10% el peso y recupera el gesto. La semana que viene subes.',
    });
  }

  // ── Día de descanso: explicar, no dejar la pantalla muda ──
  if (esDescanso) {
    consejos.push({
      clave: 'descanso',
      origen: 'descanso',
      prioridad: PRIORIDAD.descanso,
      texto: 'Hoy toca descansar, y es parte del plan: el músculo crece entre sesiones, no durante. Camina, estira, duerme bien.',
    });
  }

  // ── Proteína: solo si hay meta y datos ──
  if (
    ctx.proteinaMetaG !== null && ctx.proteinaMetaG > 0 &&
    ctx.proteinaHoyG !== null && ctx.proteinaHoyG < ctx.proteinaMetaG * 0.7
  ) {
    const faltan = Math.round(ctx.proteinaMetaG - ctx.proteinaHoyG);
    consejos.push({
      clave: 'proteina',
      origen: 'nutricion',
      prioridad: PRIORIDAD.nutricion,
      texto: `Te faltan ${faltan} g de proteína para tu meta de hoy. Sin ella, el entrenamiento rinde menos de lo que podría.`,
    });
  }

  // ── Racha ──
  if (ctx.rachaActual >= 3) {
    const texto = ctx.rachaActual >= ctx.mejorRacha && ctx.mejorRacha > 0
      ? `${ctx.rachaActual} días seguidos: estás en tu mejor racha.`
      : `${ctx.rachaActual} días seguidos. Tu mejor marca son ${ctx.mejorRacha}.`;
    consejos.push({ clave: 'racha', origen: 'racha', prioridad: PRIORIDAD.racha, texto });
  }

  // ── Suelo: nunca devolver nada ──
  if (consejos.length === 0) {
    consejos.push({
      clave: 'base',
      origen: 'plan',
      prioridad: PRIORIDAD.base,
      texto: esDescanso
        ? 'Día de descanso. Aprovecha para estirar y dormir bien.'
        : 'Registra tus series de hoy y en un par de sesiones podré decirte exactamente cuándo subir el peso.',
    });
  }

  return consejos
    .sort((a, b) => b.prioridad - a.prioridad)
    .slice(0, MAX_CONSEJOS);
}
