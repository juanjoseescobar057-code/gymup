// lib/missions.ts
// ─────────────────────────────────────────────────────────
// Misiones semanales. La progresión se calcula desde datos REALES
// (entrenos, comidas y escaneos de la semana en curso). Reclamar una
// misión otorga XP una sola vez por semana (dedupe por clave de semana).
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { loadUserStats, saveUserStats } from './streaks';

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
 */
export async function claimMission(userId: string, missionId: string): Promise<number> {
  const mission = WEEKLY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) return 0;

  const stats = await loadUserStats(userId);
  const counts = await fetchWeeklyCounts(userId);
  const weekKey = getWeekKey();
  const key = `${weekKey}:${missionId}`;

  const done = (counts[mission.type] ?? 0) >= mission.target;
  if (!done || stats.claimed_missions.includes(key)) return 0;

  await saveUserStats(userId, {
    total_xp: stats.total_xp + mission.xp,
    claimed_missions: [...stats.claimed_missions, key],
  });
  return mission.xp;
}
