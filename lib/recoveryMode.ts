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
// Solo el TIPO. `import type` se borra al compilar, así que no crea un ciclo
// con coachContext, que sí importa este módulo en tiempo de ejecución.
import type { CoachSnapshot } from './coachContext';

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

// ─────────────────────────────────────────────────────────
// DE ESCONDER A BLOQUEAR
//
// Todo lo de arriba llevaba meses siendo condicional de RENDERIZADO: tres
// pantallas leían las banderas y escondían bloques. Eso no basta aquí.
//
//   • Las rutas se abren solas. app/_layout.tsx registra body-scan, food-scan,
//     fridge-scan y food-manual como pantallas, y app.json declara el scheme
//     "gymup": gymup://body-scan entra sin pasar por ningún botón.
//   • La MISMA pantalla que mostraba el aviso seguía enseñando "Escanear
//     cuerpo" 260 líneas más abajo.
//   • sinRecompensasCorporales estaba declarada y no la leía NADIE, así que el
//     XP por comida, el bonus de "macro perfecto" y la misión de proteína
//     seguían premiando exactamente lo que el modo intenta despriorizar.
//   • Y el expediente que va al coach de IA llevaba peso, proyección a la meta,
//     macros del día y el "~X% de grasa" del último análisis. El bloque de
//     salud le PEDÍA al modelo no hablar de peso mientras le entregaba el peso.
//     Una instrucción no es un control: el dato ya salió del dispositivo.
//
// Lo de aquí abajo es lo que convierte las banderas en decisiones que se pueden
// tomar antes de renderizar, antes de guardar y antes de mandar nada.
// ─────────────────────────────────────────────────────────

/** Lo que una pantalla o una acción puede pedir que se compruebe. */
export type AreaSensible = 'cuerpo' | 'calorias' | 'peso';

/** ¿Está bloqueada esta área ahora mismo? */
export function bloqueada(modo: ModoRecuperacion, area: AreaSensible): boolean {
  switch (area) {
    case 'cuerpo': return modo.ocultarCuerpo;
    case 'calorias': return modo.ocultarCalorias;
    case 'peso': return modo.ocultarPeso;
  }
}

/**
 * Qué área protege cada ruta.
 *
 * Está aquí y no repartido por las pantallas para que la lista se pueda
 * comprobar en un test: __tests__/recoveryMode.test.ts falla si aparece una
 * ruta sensible nueva que no esté cubierta.
 */
export const RUTAS_PROTEGIDAS: Record<string, AreaSensible> = {
  '/body-scan': 'cuerpo',
  '/food-scan': 'calorias',
  '/fridge-scan': 'calorias',
  '/food-manual': 'calorias',
};

/**
 * Los campos del expediente del coach que NO pueden salir del dispositivo con
 * el modo activo.
 *
 * Se quitan del objeto antes de construir el prompt, no se le pide al modelo
 * que los ignore. Pedirlo es lo que se hacía y no funcionaba: el número ya
 * estaba dentro de la ventana de contexto y ya había viajado al proxy.
 */
//
// El tipo `keyof CoachSnapshot` NO es decoración: es lo que impide que esta
// lista se quede obsoleta en silencio. Escribí la primera versión de memoria
// —'weight', 'nutrition', 'bodyScan'— y NINGUNO de esos campos existe: el
// snapshot los llama currentWeight, macros y lastBodyScan. Con un
// Record<string, unknown> el filtro habría compilado, pasado los tests que yo
// mismo hubiera escrito con los nombres inventados, y no habría borrado nada.
// Es exactamente el fallo que este proyecto lleva repitiendo: código que parece
// correcto y no hace nada.
//
// Ahora, si alguien renombra un campo del snapshot, esto no compila.
const CAMPOS_CORPORALES: readonly (keyof CoachSnapshot)[] = [
  'currentWeight',   // el número de la báscula
  'targetWeight',    // la meta de peso
  'projection',      // cuánto falta, para cuándo, a cuántos kg por semana
  'macros',          // kcal y macros consumidos contra la meta
  'lastBodyScan',    // score y "~X% de grasa" del último análisis
  'todayMeals',      // las comidas del día con sus calorías
] as const;

/**
 * Devuelve el expediente sin los campos corporales cuando el modo está activo.
 *
 * No los pone a null ni a cero: los QUITA. Un campo presente en null sigue
 * diciéndole al modelo que existe una báscula de la que se puede hablar.
 */
export function filtrarExpediente(
  expediente: CoachSnapshot,
  modo: ModoRecuperacion,
): CoachSnapshot {
  if (!modo.activo) return expediente;
  // Sigue siendo un CoachSnapshot válido porque esos campos son opcionales EN
  // EL TIPO. Esa opcionalidad es la que obliga a snapshotToPrompt a decidir qué
  // hacer cuando faltan, en vez de escribir "Peso actual: undefined kg".
  const limpio: CoachSnapshot = { ...expediente };
  for (const campo of CAMPOS_CORPORALES) delete limpio[campo];
  return limpio;
}

/** Los campos que se retiran, para que un test pueda comprobarlos uno a uno. */
export const CAMPOS_CORPORALES_DEL_COACH: readonly (keyof CoachSnapshot)[] = CAMPOS_CORPORALES;
