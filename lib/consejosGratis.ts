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
  type ReadinessSummary,
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

  // La readiness de las últimas sesiones. chooseIntervention YA sabe qué hacer
  // con ella —dormir mal o llegar sin energía baja el volumen— pero hasta ahora
  // se la llamaba sin este dato, así que esa rama nunca se ejecutaba para el
  // plan gratis. Cuatro semanas: menos es una mala noche suelta, no un patrón.
  const desdeReadiness = new Date(Date.now() - 28 * 86_400_000).toISOString();

  const [setsRes, statsRes, healthRes, readinessRes] = await Promise.allSettled([
    supabase
      .from('set_logs')
      .select('exercise_name, weight_kg, reps, rir, logged_at, session_id')
      .eq('user_id', args.userId)
      .gte('logged_at', desde)
      .order('logged_at', { ascending: false })
      .limit(500),
    loadUserStats(args.userId),
    loadHealthSafe(args.userId),
    supabase
      .from('workout_readiness')
      .select('energy, sleep_quality, soreness, stress, pain_new')
      .eq('user_id', args.userId)
      .gte('recorded_at', desdeReadiness)
      .order('recorded_at', { ascending: false })
      .limit(10),
  ]);

  const filas: PerformanceSet[] =
    setsRes.status === 'fulfilled' ? ((setsRes.value.data ?? []) as PerformanceSet[]) : [];

  const nombres = [...new Set(filas.map((f) => f.exercise_name))];
  const progresos: ExerciseProgress[] = nombres.map((n) => analyzeExerciseProgress(n, filas));

  // Una sola intervención, la del ejercicio con más exposiciones: es sobre la
  // que hay más evidencia. Enseñar tres a la vez no es un consejo, es una lista.
  const filasReadiness: FilaReadiness[] =
    readinessRes.status === 'fulfilled' ? ((readinessRes.value.data ?? []) as FilaReadiness[]) : [];
  const readiness = resumirReadiness(filasReadiness);
  const sueno = resumirSueno(filasReadiness);

  const conMasDatos = progresos.slice().sort((a, b) => b.exposures - a.exposures)[0];
  const intervencion: Intervention | null = conMasDatos
    ? chooseIntervention({
        progress: conMasDatos,
        readiness,
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
    sueno,
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

export type FilaReadiness = {
  energy: number | null;
  sleep_quality: number | null;
  soreness: number | null;
  stress: number | null;
  pain_new: boolean | null;
};

/**
 * Promedia la readiness para chooseIntervention.
 *
 * Los nulos se OMITEN en vez de contarse como 3 (el valor neutro). Promediar
 * ausencias con el neutro diluye las señales reales: alguien con dos sesiones
 * de energía 2 y ocho sin dato saldría en 2.8 y no dispararía nada.
 */
export function resumirReadiness(filas: FilaReadiness[]): ReadinessSummary | undefined {
  if (filas.length === 0) return undefined;

  const media = (k: keyof FilaReadiness): number | undefined => {
    const vals = filas.map((f) => f[k]).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return undefined;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  return {
    energy: media('energy'),
    sleepQuality: media('sleep_quality'),
    soreness: media('soreness'),
    stress: media('stress'),
    // Un dolor nuevo en cualquiera de las últimas sesiones basta para señalarlo:
    // promediarlo lo apagaría, y es la única señal aquí que es de salud.
    painNew: filas.some((f) => f.pain_new === true),
  };
}

export type ResumenSueno = {
  /** Media 1-5 de las sesiones CON dato. null = nadie ha respondido nunca. */
  calidadMedia: number | null;
  /** Sesiones registradas durmiendo mal (<= 2). */
  nochesMalas: number;
  /** Sobre cuántas sesiones con dato. */
  sesionesConDato: number;
};

/**
 * El sueño, aparte del resto de la readiness.
 *
 * Va separado porque es lo único de aquí sobre lo que se puede dar un consejo
 * accionable fuera del gimnasio: la energía y las agujetas se constatan, el
 * sueño se cambia.
 *
 * OJO CON LO QUE ES ESTE DATO: es una autoevaluación de 1 a 5 al empezar a
 * entrenar, NO horas dormidas. Así que el consejo puede decir "vienes
 * durmiendo mal" pero nunca "duermes cinco horas": eso sería inventarse una
 * cifra que nadie midió.
 */
export function resumirSueno(filas: FilaReadiness[]): ResumenSueno {
  const vals = filas.map((f) => f.sleep_quality).filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return { calidadMedia: null, nochesMalas: 0, sesionesConDato: 0 };
  return {
    calidadMedia: vals.reduce((a, b) => a + b, 0) / vals.length,
    nochesMalas: vals.filter((v) => v <= 2).length,
    sesionesConDato: vals.length,
  };
}
