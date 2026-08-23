// lib/missionsMath.ts
// Conteo de misiones semanales. Puro y sin dependencias, separado de
// missions.ts (que arrastra Supabase) para poder probarlo de verdad: estas
// cuentas pagan XP, y equivocarse hacia cualquiera de los dos lados duele.

export type MissionType = 'planned_workouts' | 'protein_days' | 'rest_day';

export type ActividadSemana = {
  /** `started_at` de las sesiones TERMINADAS de la semana. */
  entrenos: string[];
  comidas: { logged_at: string; protein_g: number | null }[];
  metaProteinaG: number;
  /** Días transcurridos de la semana contando hoy (lunes = 1). */
  diasTranscurridos: number;
};

/** Clave de día LOCAL. La semana del usuario es la suya, no la de UTC. */
function diaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Cuenta el progreso de las tres misiones.
 *
 * Todo se cuenta por DÍAS, no por filas. La versión anterior contaba sesiones:
 * tres entrenos el mismo día completaban "entrena 3 veces" y la app celebraba
 * como constancia lo que fue una sola tarde.
 */
export function contarMisiones(a: ActividadSemana): Record<MissionType, number> {
  const diasEntrenados = new Set(a.entrenos.map(diaLocal));

  const proteinaPorDia = new Map<string, number>();
  for (const c of a.comidas) {
    const k = diaLocal(c.logged_at);
    proteinaPorDia.set(k, (proteinaPorDia.get(k) ?? 0) + (c.protein_g ?? 0));
  }
  // Una meta de 0 (perfil a medio llenar) daría todos los días por cubiertos.
  const diasProteina = a.metaProteinaG > 0
    ? [...proteinaPorDia.values()].filter((p) => p >= a.metaProteinaG).length
    : 0;

  // Descanso: hay que haber entrenado Y haber dejado pasar un día sin
  // entrenar. Sin la primera condición, no hacer nada en toda la semana
  // cobraría la misión — premiar el sofá no es premiar la recuperación.
  const descanso = diasEntrenados.size >= 1 && a.diasTranscurridos > diasEntrenados.size ? 1 : 0;

  return {
    planned_workouts: diasEntrenados.size,
    protein_days: diasProteina,
    rest_day: descanso,
  };
}

// ─────────────────────────────────────────────────────────
// EL CATÁLOGO Y QUÉ MISIONES SE OFRECEN
//
// Vive aquí y no en lib/missions.ts porque aquel importa supabase, y supabase
// arrastra react-native: un test de Node no puede cargarlo. Es la misma razón
// por la que existe este archivo — la lógica que hay que poder probar no puede
// depender del entorno de la app.
// ─────────────────────────────────────────────────────────

export type Mission = {
  id: string;
  label: string;
  emoji: string;
  type: MissionType;
  target: number;
  xp: number;
};

/**
 * El objetivo de `w_planned` es 3 solo como respaldo mientras se carga el
 * plan: el real sale de cuántos días de entreno programa TU plan, y lo decide
 * el servidor. Pedirle 3 a quien entrena 2 días le exigiría más de lo suyo.
 */
export const WEEKLY_MISSIONS: Mission[] = [
  { id: 'w_planned',  label: 'Completa tus sesiones de la semana', emoji: '🏋️', type: 'planned_workouts', target: 3, xp: 120 },
  { id: 'w_protein3', label: 'Cubre tu proteína en 3 días',        emoji: '🥩', type: 'protein_days',     target: 3, xp: 90 },
  { id: 'w_rest',     label: 'Respeta un día de descanso',         emoji: '🌙', type: 'rest_day',         target: 1, xp: 60 },
];

/**
 * Los tipos de misión que premian mirar la comida y no el entrenamiento.
 *
 * 'protein_days' pide cubrir un objetivo de macros tres días. Para casi todo el
 * mundo es una meta sana; para alguien con un trastorno de la conducta
 * alimentaria es una racha que perder, y ese es justo el mecanismo que el modo
 * recuperación existe para apagar.
 */
const MISIONES_NUTRICIONALES = new Set<MissionType>(['protein_days']);

/**
 * Las misiones que se le ofrecen a esta persona.
 *
 * Con `sinRecompensasCorporales` se retiran las nutricionales y quedan las de
 * entrenar y descansar, que es lo que el modo sí quiere reforzar. La lista no
 * se queda vacía nunca: quitarle todas las metas a alguien es otra forma de
 * decirle que aquí ya no hay nada para él.
 */
export function misionesDisponibles(sinRecompensasCorporales: boolean): Mission[] {
  if (!sinRecompensasCorporales) return WEEKLY_MISSIONS;
  return WEEKLY_MISSIONS.filter((x) => !MISIONES_NUTRICIONALES.has(x.type));
}
