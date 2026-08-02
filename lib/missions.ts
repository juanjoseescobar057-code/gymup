// lib/missions.ts
// ─────────────────────────────────────────────────────────
// Misiones semanales. La progresión se calcula desde datos REALES
// (entrenos, comidas y escaneos de la semana en curso). Reclamar una
// misión otorga XP una sola vez por semana (dedupe por clave de semana),
// y el pago lo hace el SERVIDOR vía la RPC claim_mission: el cliente ya no
// puede escribir user_stats.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';
import { loadUserStats } from './streaks';

export type MissionType = 'workouts' | 'meals' | 'body_scans';

export type Mission = {
  id: string;
  label: string;
  emoji: string;
  type: MissionType;
  target: number;
  xp: number;
};

export const WEEKLY_MISSIONS: Mission[] = [
  { id: 'w_workouts3', label: 'Entrena 3 veces',          emoji: '🏋️', type: 'workouts',   target: 3, xp: 120 },
  { id: 'w_meals10',   label: 'Registra 10 comidas',       emoji: '🍽️', type: 'meals',      target: 10, xp: 90 },
  { id: 'w_scan1',     label: 'Hazte 1 análisis corporal', emoji: '📷', type: 'body_scans', target: 1, xp: 60 },
];

export type MissionProgress = Mission & { current: number; done: boolean; claimed: boolean };

// ── Helpers PUROS (testeables) ───────────────────────────

/** Clave ISO de la semana, p.ej. "2026-W27". */
export function getWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esta semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Combina misiones + progreso + reclamadas en una vista para la UI. */
export function computeMissions(
  counts: Record<MissionType, number>,
  claimedMissions: string[],
  weekKey: string
): MissionProgress[] {
  return WEEKLY_MISSIONS.map((m) => {
    const current = counts[m.type] ?? 0;
    return {
      ...m,
      current,
      done: current >= m.target,
      claimed: claimedMissions.includes(`${weekKey}:${m.id}`),
    };
  });
}

// ── Acceso a datos ───────────────────────────────────────

function startOfWeekISO(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // lunes=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0, 0);
  return monday.toISOString();
}

export async function fetchWeeklyCounts(userId: string): Promise<Record<MissionType, number>> {
  const since = startOfWeekISO();
  const [workouts, meals, scans] = await Promise.all([
    supabase.from('workout_sessions').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('started_at', since).not('completed_at', 'is', null),
    supabase.from('food_logs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('logged_at', since),
    supabase.from('body_scans').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('scanned_at', since),
  ]);
  return {
    workouts: workouts.count ?? 0,
    meals: meals.count ?? 0,
    body_scans: scans.count ?? 0,
  };
}

/** Carga las misiones de la semana con su progreso y estado de reclamo. */
export async function loadWeeklyMissions(userId: string): Promise<MissionProgress[]> {
  const stats = await loadUserStats(userId);
  const counts = await fetchWeeklyCounts(userId);
  return computeMissions(counts, stats.claimed_missions ?? [], getWeekKey());
}

/**
 * Reclama una misión completada: otorga XP una sola vez por semana.
 * Devuelve el XP ganado (0 si no aplica).
 *
 * El pago lo hace la RPC claim_mission (SECURITY DEFINER): user_stats ya no
 * acepta escrituras desde el cliente, así que el read-modify-write anterior
 * fallaría con 42501 y la UI celebraría un XP que nunca se guardó.
 *
 * `userId` se conserva en la firma por compatibilidad con los llamadores
 * (progress.tsx) y porque todavía hace falta para LEER el progreso semanal,
 * pero NO se envía a la RPC: el servidor deriva el usuario de auth.uid(). Que
 * el cliente pudiera nombrar a quién acreditar el XP era justo el agujero.
 */
export async function claimMission(userId: string, missionId: string): Promise<number> {
  const mission = WEEKLY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) return 0;

  // La clave lleva la semana: el dedupe del servidor es por id de misión, así
  // que "w_workouts3" de esta semana tiene que ser un id distinto al de la
  // pasada o la misión solo se podría cobrar una vez en la vida.
  const key = `${getWeekKey()}:${missionId}`;

  try {
    // Puerta local: evita un viaje a la red cuando es obvio que no aplica. Ya
    // NO es la que protege — el servidor cuenta la actividad real y rechaza con
    // reason='goal_not_met' si la meta no se cumplió.
    const counts = await fetchWeeklyCounts(userId);
    if ((counts[mission.type] ?? 0) < mission.target) return 0;

    const { data, error } = await supabase.rpc('claim_mission', {
      p_mission_id: key,
      p_xp: mission.xp, // ignorado por el servidor: el XP sale de mission_catalog
    });
    if (error) throw error;

    // La RPC devuelve `returns table`, o sea una fila dentro de un array.
    const fila = Array.isArray(data) ? data[0] : data;
    if (!fila) throw new Error('claim_mission no devolvió stats');

    // El servidor manda. Si no pagó (ya reclamada, meta sin cumplir, id
    // desconocido) no anunciamos un premio que no existe. `ok` puede venir
    // undefined si por alguna razón respondiera una versión anterior de la RPC:
    // en ese caso caemos al criterio viejo (no reclamada ⇒ pagó).
    const pago = fila.ok ?? !fila.already_claimed;
    if (!pago) {
      // 'goal_not_met' aquí significa que la puerta local y el servidor no
      // coinciden: vale la pena verlo, no silenciarlo.
      if (fila.reason && fila.reason !== 'already_claimed') {
        captureError(new Error(`claim_mission rechazó el cobro: ${fila.reason}`), {
          scope: 'claim_mission.rechazado',
          mission_key: key,
          reason: fila.reason,
        });
      }
      return 0;
    }

    return mission.xp;
  } catch (e) {
    // Perder el XP de una misión es mucho menos grave que mostrar un premio
    // falso: se reporta y se devuelve 0 para que la UI no celebre.
    captureError(e, { scope: 'claim_mission', mission_key: key });
    return 0;
  }
}

// ─── ESTADO ──────────────────────────────────────────────
// La verificación ya vive en el servidor: claim_mission parsea la semana del
// propio id, busca la meta en public.mission_catalog y cuenta
// workout_sessions / food_logs / body_scans de ESA semana con auth.uid(). Si no
// alcanza, devuelve ok=false y reason='goal_not_met' sin pagar nada.
//
// WEEKLY_MISSIONS de arriba es un ESPEJO de public.mission_catalog: los textos
// (label, emoji) son de presentación y viven aquí, pero (id, type, target, xp)
// no pueden divergir. Si agregas una misión, tócala en los dos lados o el
// servidor la rechazará con reason='unknown_mission'.
//
// Nota de husos horarios: aquí la semana se delimita en hora LOCAL y allá en
// UTC, así que el servidor ensancha su ventana un día por lado. Es a propósito:
// sin ese margen, una actividad de domingo por la noche caería fuera y le
// negaríamos al usuario una misión que sí ganó.
