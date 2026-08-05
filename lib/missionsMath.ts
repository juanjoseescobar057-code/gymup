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
