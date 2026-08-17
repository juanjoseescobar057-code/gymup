// lib/consejosGratis.ts
// ─────────────────────────────────────────────────────────
// Reúne lo que el coach de reglas necesita y se lo entrega.
//
// lib/coachReglas.ts es puro a propósito —toda la decisión está ahí y se
// prueba sin red— así que alguien tiene que ir a buscar los datos. Es este
// módulo, y solo hace eso: consultar, mapear y llamar. Ninguna decisión de
// producto vive aquí.
//
// Cuesta UNA consulta a set_logs. Ni un token de IA: por eso puede correr para
// todo el mundo, pague o no.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import {
  analyzeExerciseProgress,
  chooseIntervention,
  type ExerciseProgress,
  type Intervention,
  type PerformanceSet,
} from './progressionEngine';
import { consejosDelDia, type ConsejoCoach, type ContextoCoach } from './coachReglas';
import { loadUserStats } from './streaks';
import { loadHealthSafe } from './health';

export type { ConsejoCoach } from './coachReglas';

/** Seis semanas: menos no distingue una meseta de una semana mala. */
const VENTANA_DIAS = 42;

/** Los ejercicios de aislamiento progresan distinto; chooseIntervention lo usa. */
function esAislamiento(nombre: string): boolean {
  return /curl|extensi[oó]n|elevaci[oó]n|apertura|gemelo|tr[ií]ceps/i.test(nombre);
}

/**
 * Los consejos de hoy para esta persona.
 *
 * Nunca lanza: si una consulta falla se sigue con menos datos. El coach de
 * reglas siempre devuelve algo, así que la pantalla nunca queda muda — y una
 * caída de red no puede dejar sin coach a quien no paga.
 */
export async function consejosGratisDeHoy(args: {
  userId: string;
  goal: string | null | undefined;
  /** Grupos musculares de hoy. Vacío = día de descanso. */
  grupoDeHoy: string[];
  diasSinEntrenar: number | null;
  proteinaHoyG: number | null;
  proteinaMetaG: number | null;
}): Promise<ConsejoCoach[]> {
  const desde = new Date(Date.now() - VENTANA_DIAS * 86_400_000).toISOString();

  const [setsRes, statsRes, healthRes] = await Promise.allSettled([
    supabase
      .from('set_logs')
      .select('exercise_name, weight_kg, reps, rir, logged_at, session_id')
      .eq('user_id', args.userId)
      .gte('logged_at', desde)
      .order('logged_at', { ascending: false })
      .limit(500),
    loadUserStats(args.userId),
    loadHealthSafe(args.userId),
  ]);

  const filas: PerformanceSet[] =
    setsRes.status === 'fulfilled' ? ((setsRes.value.data ?? []) as PerformanceSet[]) : [];

  const nombres = [...new Set(filas.map((f) => f.exercise_name))];
  const progresos: ExerciseProgress[] = nombres.map((n) => analyzeExerciseProgress(n, filas));

  // Una sola intervención, la del ejercicio con más exposiciones: es sobre la
  // que hay más evidencia. Enseñar tres a la vez no es un consejo, es una lista.
  const conMasDatos = progresos.slice().sort((a, b) => b.exposures - a.exposures)[0];
  const intervencion: Intervention | null = conMasDatos
    ? chooseIntervention({
        progress: conMasDatos,
        isIsolation: esAislamiento(conMasDatos.exercise),
        goal: args.goal ?? undefined,
      })
    : null;

  const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;

  // La salud tiene tres estados y los tres importan (ver HealthLoad en
  // lib/health.ts): 'ok'/'cached' con perfil es saber; 'unknown' es que la red
  // falló y no hay caché — NUNCA se puede tratar como "está sana"; y perfil
  // null es que nunca completó el tamizaje, que a efectos de dar consejo es
  // igual de desconocido. Los dos últimos van al mismo sitio: decirlo y ser
  // conservador.
  const salud = healthRes.status === 'fulfilled' ? healthRes.value : { status: 'unknown' as const };
  const perfilSalud = salud.status === 'unknown' ? null : salud.profile;
  const saludDesconocida = salud.status === 'unknown' || perfilSalud == null;

  // Récords de los últimos siete días: un récord de hace un mes ya no es
  // noticia, y celebrarlo hoy suena a que la app no se ha enterado de nada.
  const haceUnaSemana = Date.now() - 7 * 86_400_000;
  const prsRecientes = mejoresDeLaSemana(filas, haceUnaSemana);

  const ctx: ContextoCoach = {
    progresos,
    intervencion,
    rachaActual: stats?.current_streak ?? 0,
    mejorRacha: stats?.longest_streak ?? 0,
    diasSinEntrenar: args.diasSinEntrenar ?? 0,
    grupoDeHoy: args.grupoDeHoy,
    lesiones: perfilSalud?.injuries ?? [],
    condiciones: perfilSalud?.conditions ?? [],
    saludDesconocida,
    proteinaHoyG: args.proteinaHoyG,
    proteinaMetaG: args.proteinaMetaG,
    prsRecientes,
  };

  return consejosDelDia(ctx);
}

/** El mejor peso por ejercicio dentro de la ventana, ordenado por carga. */
function mejoresDeLaSemana(
  filas: PerformanceSet[],
  desdeMs: number,
): { ejercicio: string; pesoKg: number }[] {
  const mejor = new Map<string, number>();
  for (const f of filas) {
    const t = Date.parse(f.logged_at);
    if (!Number.isFinite(t) || t < desdeMs) continue;
    const peso = f.weight_kg ?? 0;
    if (peso <= 0) continue;
    if (peso > (mejor.get(f.exercise_name) ?? 0)) mejor.set(f.exercise_name, peso);
  }
  return [...mejor.entries()]
    .map(([ejercicio, pesoKg]) => ({ ejercicio, pesoKg }))
    .sort((a, b) => b.pesoKg - a.pesoKg)
    .slice(0, 3);
}
