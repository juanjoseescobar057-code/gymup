// lib/recoveryMode.ts
// ─────────────────────────────────────────────────────────
// Modo recuperación: qué DEJA de mostrar la app cuando alguien declara un
// trastorno de la conducta alimentaria.
//
// La puerta clínica ya bloqueaba la sesión y ya prohibía a la IA hablar de
// peso, déficit o estética. Pero eso era una sola capa: la interfaz seguía
// enseñando el anillo de calorías, la meta de peso, la gráfica de báscula, el
// análisis corporal y las fotos de transformación. La app prometía "programamos
// sin metas de peso ni de estética" y a continuación las mostraba todas.
//
// Esto NO borra nada. Los datos siguen en la base y se los puede llevar en su
// export cuando quiera: se dejan de MOSTRAR y se dejan de usar como refuerzo.
// La diferencia importa — borrarle su historial sería otra decisión tomada
// por encima de la persona.
//
// Y la autorización médica NO reabre esto sola. Que su equipo diga que puede
// entrenar no significa que le convenga volver a ver el número de la báscula:
// son dos permisos distintos. Se necesita además que lo pida explícitamente.
// ─────────────────────────────────────────────────────────

import type { HealthProfile } from './healthMath';

export type ModoRecuperacion = {
  activo: boolean;
  /** Anillo de calorías, barras de macros y metas nutricionales numéricas. */
  ocultarCalorias: boolean;
  /** Peso actual, meta de peso, proyección y gráfica de báscula. */
  ocultarPeso: boolean;
  /** Análisis corporal por IA y fotos de transformación. */
  ocultarCuerpo: boolean;
  /** XP, insignias y misiones ligadas a comida, macros o escaneo corporal. */
  sinRecompensasCorporales: boolean;
};

const NEUTRO: ModoRecuperacion = {
  activo: false,
  ocultarCalorias: false,
  ocultarPeso: false,
  ocultarCuerpo: false,
  sinRecompensasCorporales: false,
};

const ACTIVO: ModoRecuperacion = {
  activo: true,
  ocultarCalorias: true,
  ocultarPeso: true,
  ocultarCuerpo: true,
  sinRecompensasCorporales: true,
};

/**
 * `null` = el tamizaje no se pudo leer. NO activa el modo: esconderle sus
 * datos a alguien por un fallo de red sería tan malo como el problema que
 * intenta evitar, y además le haría pensar que perdió su historial.
 */
export function modoRecuperacion(health: HealthProfile | null | undefined): ModoRecuperacion {
  if (!health) return NEUTRO;
  return health.conditions.includes('trastorno_alimentario') ? ACTIVO : NEUTRO;
}

/**
 * Texto que sustituye a lo que se oculta. Un hueco vacío se lee como un fallo
 * de la app; esto dice qué pasó y que sus datos siguen ahí.
 */
export const AVISO_RECUPERACION =
  'Ocultamos calorías, peso y análisis corporal porque marcaste un trastorno de la conducta alimentaria. ' +
  'Tus datos siguen guardados y puedes descargarlos cuando quieras desde Privacidad. ' +
  'Aquí seguimos contigo en lo que sí suma: entrenar, moverte y descansar.';
