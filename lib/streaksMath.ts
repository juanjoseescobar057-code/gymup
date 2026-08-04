// lib/streaksMath.ts
// ─────────────────────────────────────────────────────────
// Matemática pura de XP, niveles y rachas. SIN dependencias de
// React Native ni Supabase → testeable de forma aislada.
// ─────────────────────────────────────────────────────────

export type UserStats = {
  current_streak: number;
  longest_streak: number;
  total_xp: number;
  level: number;
  total_workouts: number;
  total_meals_logged: number;
  total_macro_perfect_days: number;
  total_body_scans: number;
  earned_badges: string[];
  last_workout_date: string | null; // ISO date string YYYY-MM-DD
  streak_freezes: number;            // comodines anti-rotura disponibles
  claimed_missions: string[];        // misiones semanales ya reclamadas (key con semana)
};

// Ventana máxima (días) que un freeze puede cubrir. Más allá, la racha se rompe
// aunque haya comodines (evita "revivir" rachas tras semanas de inactividad).
export const FREEZE_MAX_GAP = 8;

// ─── XP POR NIVEL ────────────────────────────────────────
// Nivel = floor(sqrt(xp / 100)) + 1
export function xpToLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function xpForNextLevel(currentLevel: number): number {
  return Math.pow(currentLevel, 2) * 100;
}

export function xpProgress(xp: number): { level: number; progress: number; xpNeeded: number } {
  const level = xpToLevel(xp);
  const xpForCurrent = Math.pow(level - 1, 2) * 100;
  const xpForNext = Math.pow(level, 2) * 100;
  const progress = (xp - xpForCurrent) / (xpForNext - xpForCurrent);
  return { level, progress: Math.min(progress, 1), xpNeeded: xpForNext - xp };
}

// ─── FECHA LOCAL ─────────────────────────────────────────
// El "día" de la racha es el día LOCAL del usuario, no UTC. En UTC-5
// (Colombia), un entreno a las 8pm quedaría fechado "mañana" con
// toISOString() y rompería/duplicaría rachas en el borde de medianoche.
export function localDayKey(d = new Date()): string {
  const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().split('T')[0];
}

// ─── RACHA ───────────────────────────────────────────────
// Tolera 1 día de descanso de por medio (el plan incluye descansos),
// por eso continúa si el gap es de 1 o 2 días. Con un gap mayor, un
// streak-freeze (si hay) salva la racha y se consume uno.
//
// OJO — esto NO es la racha que se guarda. La autoritativa la calcula
// apply_workout_stats en el servidor, y ALLÁ el margen ya no es fijo: sale
// del plan activo del usuario (public._max_rest_gap), porque un plan de 3
// días/semana tiene huecos programados de 3 días y este 2 los rompería.
// Aquí se deja en 2 a propósito: el valor solo alimenta una estimación
// optimista que la fila devuelta por la RPC sobrescribe de inmediato.
// Si algún día esto pasa a persistirse, hay que traer el margen del plan —
// no al revés.
export function calculateNewStreak(
  stats: Pick<UserStats, 'current_streak' | 'last_workout_date'> & { streak_freezes?: number },
  todayStr: string = localDayKey()
): { newStreak: number; streakBroken: boolean; freezeUsed: boolean } {
  const lastDate = stats.last_workout_date;
  if (!lastDate) return { newStreak: 1, streakBroken: false, freezeUsed: false };

  const last = new Date(lastDate);
  const now = new Date(todayStr);
  const diffDays = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  const freezes = stats.streak_freezes ?? 0;

  if (diffDays === 0) return { newStreak: stats.current_streak, streakBroken: false, freezeUsed: false };
  if (diffDays <= 2) return { newStreak: stats.current_streak + 1, streakBroken: false, freezeUsed: false };

  // Gap grande: ¿tenemos un comodín y estamos dentro de la ventana?
  if (freezes > 0 && diffDays <= FREEZE_MAX_GAP) {
    return { newStreak: stats.current_streak + 1, streakBroken: false, freezeUsed: true };
  }
  return { newStreak: 1, streakBroken: true, freezeUsed: false };
}
