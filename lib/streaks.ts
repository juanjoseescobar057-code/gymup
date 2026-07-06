// lib/streaks.ts
// ─────────────────────────────────────────────────────────
// Sistema de rachas, XP y badges de GymUp.
// Todo se calcula localmente y se sincroniza con Supabase.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { xpToLevel, calculateNewStreak, localDayKey } from './streaksMath';

// Re-export de la matemática pura (vive en streaksMath para ser testeable).
export { xpToLevel, xpForNextLevel, xpProgress, calculateNewStreak, localDayKey } from './streaksMath';

// ─── BADGES DISPONIBLES ──────────────────────────────────
export const BADGES = [
  // Rachas de entrenamiento
  { id: 'streak_3',     emoji: '🔥',  title: '3 días seguidos',      desc: 'Primera racha real',          xp: 50,   requirement: { type: 'streak', value: 3 } },
  { id: 'streak_7',     emoji: '⚡',  title: 'Semana perfecta',       desc: '7 días sin fallar',           xp: 150,  requirement: { type: 'streak', value: 7 } },
  { id: 'streak_14',    emoji: '💎',  title: '2 semanas imparable',   desc: 'Solo el 5% llega aquí',      xp: 300,  requirement: { type: 'streak', value: 14 } },
  { id: 'streak_30',    emoji: '👑',  title: 'Mes de élite',          desc: 'Eres oficialmente un hábito', xp: 750,  requirement: { type: 'streak', value: 30 } },
  { id: 'streak_100',   emoji: '🦾',  title: '100 días — Leyenda',    desc: 'Menos del 0.1% lo logra',    xp: 3000, requirement: { type: 'streak', value: 100 } },

  // Comidas registradas
  { id: 'meals_1',      emoji: '📸',  title: 'Primera foto de comida', desc: 'El tracking empieza hoy',   xp: 30,   requirement: { type: 'meals', value: 1 } },
  { id: 'meals_10',     emoji: '🍽️', title: '10 comidas registradas', desc: 'El hábito de trackear',     xp: 100,  requirement: { type: 'meals', value: 10 } },
  { id: 'meals_50',     emoji: '📊',  title: '50 comidas analizadas',  desc: 'Eres lo que mides',          xp: 400,  requirement: { type: 'meals', value: 50 } },

  // Macros diarios cumplidos
  { id: 'macro_day_1',  emoji: '✅',  title: 'Día perfecto de macros', desc: 'Todas las metas cumplidas',  xp: 80,   requirement: { type: 'macro_days', value: 1 } },
  { id: 'macro_day_7',  emoji: '🎯',  title: '7 días en macro',        desc: 'La disciplina nutricional',  xp: 300,  requirement: { type: 'macro_days', value: 7 } },

  // Escaneos corporales
  { id: 'body_scan_1',  emoji: '📷',  title: 'Primer análisis corporal', desc: 'La IA ya te conoce',      xp: 60,   requirement: { type: 'body_scans', value: 1 } },
  { id: 'body_scan_4',  emoji: '💪',  title: '4 análisis — Transformación', desc: 'Tu progreso es visible', xp: 200, requirement: { type: 'body_scans', value: 4 } },

  // Sesiones de entrenamiento
  { id: 'sessions_1',   emoji: '🏋️', title: 'Primer entrenamiento',   desc: 'El viaje empieza',           xp: 30,   requirement: { type: 'sessions', value: 1 } },
  { id: 'sessions_10',  emoji: '💥',  title: '10 entrenamientos',      desc: 'Ya es un hábito',             xp: 200,  requirement: { type: 'sessions', value: 10 } },
  { id: 'sessions_50',  emoji: '🏆',  title: '50 sesiones',            desc: 'Atleta en formación',         xp: 800,  requirement: { type: 'sessions', value: 50 } },
] as const;

export type BadgeId = typeof BADGES[number]['id'];

export type UserStats = {
  current_streak: number;
  longest_streak: number;
  total_xp: number;
  level: number;
  total_workouts: number;
  total_meals_logged: number;
  total_macro_perfect_days: number;
  total_body_scans: number;
  earned_badges: BadgeId[];
  last_workout_date: string | null;  // ISO date string YYYY-MM-DD
  streak_freezes: number;            // comodines anti-rotura
  claimed_missions: string[];        // misiones semanales reclamadas
};

// ─── VERIFICAR Y OTORGAR BADGES ──────────────────────────
// Pura y síncrona: devuelve los badges recién ganados según las stats dadas.
// La celebración (modal/notificación) la decide quien la llama — así no
// acoplamos la lógica de badges a la capa de notificaciones.
export function checkAndAwardBadges(stats: UserStats): BadgeId[] {
  const newBadges: BadgeId[] = [];

  for (const badge of BADGES) {
    if (stats.earned_badges.includes(badge.id)) continue;

    const req = badge.requirement;
    let earned = false;

    switch (req.type) {
      case 'streak':
        earned = stats.current_streak >= req.value;
        break;
      case 'meals':
        earned = stats.total_meals_logged >= req.value;
        break;
      case 'macro_days':
        earned = stats.total_macro_perfect_days >= req.value;
        break;
      case 'body_scans':
        earned = stats.total_body_scans >= req.value;
        break;
      case 'sessions':
        earned = stats.total_workouts >= req.value;
        break;
    }

    if (earned) newBadges.push(badge.id);
  }

  return newBadges;
}

/** Detalle de un badge por id, para mostrar la celebración. */
export function getBadge(id: BadgeId) {
  return BADGES.find((b) => b.id === id);
}

// ─── GUARDAR STATS EN SUPABASE ───────────────────────────
export async function saveUserStats(
  userId: string,
  stats: Partial<UserStats>
): Promise<void> {
  await supabase
    .from('user_stats')
    .upsert({ user_id: userId, ...stats, updated_at: new Date().toISOString() })
    .throwOnError();
}

// ─── CARGAR STATS DESDE SUPABASE ─────────────────────────
export async function loadUserStats(userId: string): Promise<UserStats> {
  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .single();

  // IMPORTANTE: solo devolver el estado inicial cuando de verdad NO hay fila
  // (PGRST116). Ante un error de red/RLS hay que FALLAR: si devolviéramos
  // ceros, el siguiente saveUserStats sobreescribiría (y borraría) todo el
  // progreso real del usuario.
  if (error && error.code !== 'PGRST116') {
    throw new Error('No se pudieron cargar tus stats: ' + error.message);
  }

  if (!data) {
    return {
      current_streak: 0,
      longest_streak: 0,
      total_xp: 0,
      level: 1,
      total_workouts: 0,
      total_meals_logged: 0,
      total_macro_perfect_days: 0,
      total_body_scans: 0,
      earned_badges: [],
      last_workout_date: null,
      streak_freezes: 1,       // un comodín de regalo al empezar
      claimed_missions: [],
    };
  }

  // Defaults defensivos por si la columna aún no existe en filas viejas.
  return {
    ...data,
    streak_freezes: (data as any).streak_freezes ?? 1,
    claimed_missions: (data as any).claimed_missions ?? [],
  } as UserStats;
}

// Otorga los badges nuevos sobre updatedStats y ACREDITA su XP prometido
// (la UI muestra "+{xp} XP" por badge; antes ese XP nunca se pagaba).
function applyNewBadges(updatedStats: UserStats): { newBadges: BadgeId[]; badgeXp: number } {
  const newBadges = checkAndAwardBadges(updatedStats);
  const badgeXp = newBadges.reduce((sum, id) => sum + (getBadge(id)?.xp ?? 0), 0);
  updatedStats.total_xp += badgeXp;
  updatedStats.level = xpToLevel(updatedStats.total_xp);
  updatedStats.earned_badges = [...updatedStats.earned_badges, ...newBadges];
  return { newBadges, badgeXp };
}

// ─── REGISTRAR ENTRENAMIENTO COMPLETADO ──────────────────
export async function recordWorkoutCompleted(
  userId: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; streakBroken: boolean; newStreak: number; leveledUp: boolean; freezeUsed: boolean }> {
  const stats = await loadUserStats(userId);
  const { newStreak, streakBroken, freezeUsed } = calculateNewStreak(stats);

  const XP_PER_WORKOUT = 75;
  const streakBonus = newStreak >= 7 ? 50 : newStreak >= 3 ? 25 : 0;
  const baseXp = XP_PER_WORKOUT + streakBonus;
  const prevLevel = xpToLevel(stats.total_xp);

  const updatedStats: UserStats = {
    ...stats,
    current_streak: newStreak,
    longest_streak: Math.max(stats.longest_streak, newStreak),
    total_xp: stats.total_xp + baseXp,
    level: xpToLevel(stats.total_xp + baseXp),
    total_workouts: stats.total_workouts + 1,
    last_workout_date: localDayKey(), // día LOCAL, no UTC
    // Consumir un comodín si se usó para salvar la racha.
    streak_freezes: Math.max(0, stats.streak_freezes - (freezeUsed ? 1 : 0)),
  };

  const { newBadges, badgeXp } = applyNewBadges(updatedStats);

  await saveUserStats(userId, updatedStats);

  return {
    newBadges,
    xpGained: baseXp + badgeXp,
    streakBroken,
    newStreak,
    leveledUp: updatedStats.level > prevLevel,
    freezeUsed,
  };
}

// ─── REGISTRAR COMIDA LOGUEADA ───────────────────────────
export async function recordMealLogged(
  userId: string,
  macroPerfectDay = false
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean; macroDayCounted: boolean }> {
  const stats = await loadUserStats(userId);

  // "Día perfecto de macros": contar UNA sola vez por día LOCAL (dedupe con
  // una clave en claimed_missions, que ya existe en el esquema).
  const dayKey = `macroday:${localDayKey()}`;
  const macroDayCounted = macroPerfectDay && !stats.claimed_missions.includes(dayKey);

  const XP_PER_MEAL = 15;
  const baseXp = XP_PER_MEAL + (macroDayCounted ? 50 : 0);
  const prevLevel = xpToLevel(stats.total_xp);

  const updatedStats: UserStats = {
    ...stats,
    total_xp: stats.total_xp + baseXp,
    level: xpToLevel(stats.total_xp + baseXp),
    total_meals_logged: stats.total_meals_logged + 1,
    total_macro_perfect_days: stats.total_macro_perfect_days + (macroDayCounted ? 1 : 0),
    claimed_missions: macroDayCounted ? [...stats.claimed_missions, dayKey] : stats.claimed_missions,
  };

  const { newBadges, badgeXp } = applyNewBadges(updatedStats);

  await saveUserStats(userId, updatedStats);
  return { newBadges, xpGained: baseXp + badgeXp, leveledUp: updatedStats.level > prevLevel, macroDayCounted };
}

// ─── REGISTRAR ESCANEO CORPORAL ──────────────────────────
export async function recordBodyScan(
  userId: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean }> {
  const stats = await loadUserStats(userId);
  const XP_PER_SCAN = 40;
  const prevLevel = xpToLevel(stats.total_xp);

  const updatedStats: UserStats = {
    ...stats,
    total_xp: stats.total_xp + XP_PER_SCAN,
    level: xpToLevel(stats.total_xp + XP_PER_SCAN),
    total_body_scans: stats.total_body_scans + 1,
  };

  const { newBadges, badgeXp } = applyNewBadges(updatedStats);

  await saveUserStats(userId, updatedStats);
  return { newBadges, xpGained: XP_PER_SCAN + badgeXp, leveledUp: updatedStats.level > prevLevel };
}
