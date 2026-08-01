// lib/streaks.ts
// ─────────────────────────────────────────────────────────
// Sistema de rachas, XP y badges de GymUp.
// La FUENTE DE VERDAD de las stats es el SERVIDOR: user_stats ya no acepta
// INSERT/UPDATE desde el cliente (RLS revocada) porque una app modificada
// podía escribirse XP, nivel, racha y badges a voluntad — y los "resultados
// demostrables" no valen nada si el propio usuario los puede falsificar.
// Cada vía tiene su RPC (todas SECURITY DEFINER, todas con auth.uid()):
// entrenamiento → apply_workout_stats, comida y escaneo → apply_activity_stats,
// misión → claim_mission, comodín → buy_streak_freeze. Lo que se calcula aquí
// es proyección OPTIMISTA para la UI: si difiere de lo que devuelve el
// servidor, manda el servidor.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';
import { xpToLevel, calculateNewStreak, localDayKey } from './streaksMath';

// Re-export de la matemática pura (vive en streaksMath para ser testeable).
// OJO: desde que el servidor recalcula racha y nivel dentro de la RPC, estas
// funciones son solo para MOSTRAR (barra de progreso, previsualización de la
// racha). Nada que se persista debe decidirse con ellas.
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

// ─── GUARDAR STATS EN SUPABASE (YA NO SE PUEDE) ──────────
// La escritura directa a user_stats está REVOCADA POR DISEÑO: el cliente solo
// puede leer esa tabla. Cualquier progreso se aplica con la RPC que le
// corresponde, todas SECURITY DEFINER y derivando el usuario de auth.uid():
//   • entrenamiento        → apply_workout_stats
//   • comida / escaneo     → apply_activity_stats
//   • misión semanal       → claim_mission (idempotente por mission_id)
//   • compra de comodín    → buy_streak_freeze (verifica el saldo en servidor)
// Esta función se conserva EXPORTADA solo porque lib/missions.ts y
// app/(tabs)/progress.tsx todavía la importan mientras migran a sus RPC. No
// escribe nada y devuelve false SIEMPRE: es preferible una función honesta que
// dice "no persistí" a una que aparenta guardar y deja al usuario creyendo que
// ganó XP que el servidor nunca vio.
export async function saveUserStats(
  userId: string,
  stats: Partial<UserStats>
): Promise<boolean> {
  captureError(new Error('saveUserStats: escritura directa a user_stats revocada'), {
    scope: 'user_stats.write_revocada',
    campos: Object.keys(stats),
    // El id se registra para poder rastrear qué pantalla sigue sin migrar.
    user_id: userId,
  });
  return false;
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
// UNA sola llamada a apply_workout_stats: el servidor deriva el usuario de
// auth.uid(), acota el XP, es idempotente por día y recalcula racha, nivel y
// total_workouts. El cliente PROPONE (XP y badges), el servidor DISPONE.
export async function recordWorkoutCompleted(
  userId: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; streakBroken: boolean; newStreak: number; leveledUp: boolean; freezeUsed: boolean }> {
  const stats = await loadUserStats(userId);
  const hoy = localDayKey(); // día LOCAL, no UTC (ver streaksMath)
  const { newStreak } = calculateNewStreak(stats, hoy);

  const XP_PER_WORKOUT = 75;
  const streakBonus = newStreak >= 7 ? 50 : newStreak >= 3 ? 25 : 0;
  const baseXp = XP_PER_WORKOUT + streakBonus;
  const prevLevel = xpToLevel(stats.total_xp);

  // Proyección OPTIMISTA, solo para decidir qué badges proponer. Replica la
  // idempotencia del servidor (un segundo entreno el mismo día no suma
  // total_workouts) para no proponer badges de sesiones que allá no contarían.
  const proyeccion: UserStats = {
    ...stats,
    current_streak: newStreak,
    longest_streak: Math.max(stats.longest_streak, newStreak),
    total_xp: stats.total_xp + baseXp,
    level: xpToLevel(stats.total_xp + baseXp),
    total_workouts: stats.total_workouts + (stats.last_workout_date === hoy ? 0 : 1),
    last_workout_date: hoy,
  };

  const { newBadges, badgeXp } = applyNewBadges(proyeccion);

  const { data, error } = await supabase.rpc('apply_workout_stats', {
    p_xp_delta: baseXp + badgeXp,
    p_workout_date: hoy,
    p_badges: newBadges,
  });

  // La RPC devuelve `returns table`, o sea una fila dentro de un array.
  const fila = Array.isArray(data) ? data[0] : data;

  if (error || !fila) {
    // La gamificación NO puede tumbar el cierre del entrenamiento: la sesión y
    // las series ya se guardaron en sus tablas. Perder el XP de una vez es
    // mucho menos grave que perder el entreno, así que se reporta y se
    // devuelven los stats PREVIOS: nada que celebrar, pero nada roto.
    captureError(error ?? new Error('apply_workout_stats no devolvió stats'), {
      scope: 'apply_workout_stats',
      xp_propuesto: baseXp + badgeXp,
    });
    return {
      newBadges: [],
      xpGained: 0,
      streakBroken: false,
      newStreak: stats.current_streak,
      leveledUp: false,
      freezeUsed: false,
    };
  }

  // De aquí en adelante manda la fila del servidor, no la proyección: el XP
  // real puede ser menor si la RPC lo acotó, y la racha puede diferir si el
  // reloj del dispositivo iba desfasado.
  const badgesOtorgados = ((fila.earned_badges ?? []) as BadgeId[])
    .filter((id) => !stats.earned_badges.includes(id));

  return {
    newBadges: badgesOtorgados,
    xpGained: Math.max(0, (fila.total_xp ?? stats.total_xp) - stats.total_xp),
    // El servidor no devuelve "se rompió" ni "usó comodín" como tales: se
    // deducen de su racha autoritativa y del comodín consumido.
    streakBroken: (fila.current_streak ?? 1) <= 1 && stats.current_streak > 1,
    newStreak: fila.current_streak ?? newStreak,
    leveledUp: (fila.level ?? prevLevel) > prevLevel,
    freezeUsed: (fila.streak_freezes ?? stats.streak_freezes) < stats.streak_freezes,
  };
}

// ─── REGISTRAR COMIDA LOGUEADA ───────────────────────────
// Misma forma que el entrenamiento: el cliente PROPONE (XP y badges) y el
// servidor DISPONE, vía apply_activity_stats con p_kind='meal'.
export async function recordMealLogged(
  userId: string,
  macroPerfectDay = false
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean; macroDayCounted: boolean }> {
  const stats = await loadUserStats(userId);
  const prevLevel = xpToLevel(stats.total_xp);

  // "Día perfecto de macros": debe pagarse UNA sola vez por día LOCAL. El
  // dedupe ya no puede vivir en el cliente porque apply_activity_stats NO
  // escribe claimed_missions, así que la clave 'macroday:<fecha>' nunca
  // quedaría persistida y el bonus se cobraría en cada comida.
  // Solución: usar claim_mission como CERROJO DE IDEMPOTENCIA por día. Con
  // p_xp=0 no paga nada — solo intenta poner la clave del día en
  // claimed_missions (operación atómica, con `for update`, en el servidor) y
  // nos dice si ya estaba: already_claimed=true ⇒ el día perfecto ya se contó
  // hoy. Es la misma garantía que da la RPC a las misiones semanales,
  // reutilizada aquí como candado en vez de como pago.
  let macroDayCounted = false;
  if (macroPerfectDay) {
    const dayKey = `macroday:${localDayKey()}`; // día LOCAL, no UTC (ver streaksMath)
    const { data: cerrojo, error: errorCerrojo } = await supabase.rpc('claim_mission', {
      p_mission_id: dayKey,
      p_xp: 0,
    });
    const filaCerrojo = Array.isArray(cerrojo) ? cerrojo[0] : cerrojo;

    if (errorCerrojo || !filaCerrojo) {
      // Sin confirmación del cerrojo NO contamos el día perfecto: dejar de
      // pagar un bonus una vez es mucho menos grave que pagarlo dos veces.
      captureError(errorCerrojo ?? new Error('claim_mission no devolvió fila'), {
        scope: 'claim_mission.macroday',
        mission_id: dayKey,
      });
    } else {
      macroDayCounted = !filaCerrojo.already_claimed;
    }
  }

  const XP_PER_MEAL = 15;
  const baseXp = XP_PER_MEAL + (macroDayCounted ? 50 : 0);

  // Proyección OPTIMISTA: solo sirve para decidir qué badges PROPONER. Lo que
  // se muestra al usuario sale después de la fila que devuelve el servidor.
  const proyeccion: UserStats = {
    ...stats,
    total_xp: stats.total_xp + baseXp,
    level: xpToLevel(stats.total_xp + baseXp),
    total_meals_logged: stats.total_meals_logged + 1,
    total_macro_perfect_days: stats.total_macro_perfect_days + (macroDayCounted ? 1 : 0),
  };

  const { newBadges, badgeXp } = applyNewBadges(proyeccion);

  const { data, error } = await supabase.rpc('apply_activity_stats', {
    p_kind: 'meal',
    p_xp_delta: baseXp + badgeXp,
    p_badges: newBadges,
    p_macro_perfect: macroDayCounted,
  });

  // La RPC devuelve `returns table`, o sea una fila dentro de un array.
  const fila = Array.isArray(data) ? data[0] : data;

  if (error || !fila) {
    // La gamificación no puede tumbar el flujo: la comida YA se guardó en
    // food_logs. Se reporta y se devuelve "nada que celebrar" en vez de
    // anunciar XP que el servidor nunca registró.
    captureError(error ?? new Error('apply_activity_stats no devolvió stats'), {
      scope: 'apply_activity_stats.meal',
      xp_propuesto: baseXp + badgeXp,
    });
    return { newBadges: [], xpGained: 0, leveledUp: false, macroDayCounted: false };
  }

  // De aquí en adelante manda el servidor: el XP real puede ser menor si la
  // RPC lo acotó, y los badges son los que él aceptó.
  const badgesOtorgados = ((fila.earned_badges ?? []) as BadgeId[])
    .filter((id) => !stats.earned_badges.includes(id));

  return {
    newBadges: badgesOtorgados,
    xpGained: Math.max(0, (fila.total_xp ?? stats.total_xp) - stats.total_xp),
    leveledUp: (fila.level ?? prevLevel) > prevLevel,
    macroDayCounted,
  };
}

// ─── REGISTRAR ESCANEO CORPORAL ──────────────────────────
export async function recordBodyScan(
  userId: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean }> {
  const stats = await loadUserStats(userId);
  const XP_PER_SCAN = 40;
  const prevLevel = xpToLevel(stats.total_xp);

  // Proyección optimista solo para proponer badges (ver recordMealLogged).
  const proyeccion: UserStats = {
    ...stats,
    total_xp: stats.total_xp + XP_PER_SCAN,
    level: xpToLevel(stats.total_xp + XP_PER_SCAN),
    total_body_scans: stats.total_body_scans + 1,
  };

  const { newBadges, badgeXp } = applyNewBadges(proyeccion);

  const { data, error } = await supabase.rpc('apply_activity_stats', {
    p_kind: 'body_scan',
    p_xp_delta: XP_PER_SCAN + badgeXp,
    p_badges: newBadges,
    p_macro_perfect: false,
  });

  const fila = Array.isArray(data) ? data[0] : data;

  if (error || !fila) {
    // El escaneo YA se guardó en su tabla; perder el XP no justifica romper.
    captureError(error ?? new Error('apply_activity_stats no devolvió stats'), {
      scope: 'apply_activity_stats.body_scan',
      xp_propuesto: XP_PER_SCAN + badgeXp,
    });
    return { newBadges: [], xpGained: 0, leveledUp: false };
  }

  const badgesOtorgados = ((fila.earned_badges ?? []) as BadgeId[])
    .filter((id) => !stats.earned_badges.includes(id));

  return {
    newBadges: badgesOtorgados,
    xpGained: Math.max(0, (fila.total_xp ?? stats.total_xp) - stats.total_xp),
    leveledUp: (fila.level ?? prevLevel) > prevLevel,
  };
}

// ─── PENDIENTE (siguiente paso del blindaje) ─────────────
// Las VÍAS DE ESCRITURA ya están cerradas: entrenamiento, comida, escaneo,
// misión y compra de comodín pasan cada una por su RPC, y user_stats no acepta
// insert/update desde el cliente. Lo que sigue abierto es OTRA cosa:
//
// El servidor no REVERIFICA los badges. checkAndAwardBadges() corre aquí, en el
// cliente, y las RPC se limitan a hacer union de p_badges con earned_badges sin
// comprobar que la condición ('streak_30', 'meals_50'…) se cumpla de verdad
// contra las stats reales. Una app modificada todavía puede pedir badges que no
// ganó — no el XP asociado, que sí está acotado por RPC ([0,1000] en actividad,
// [0,500] en misión), pero sí la insignia. Falta mover la verificación al
// servidor: que la RPC derive los badges de las stats posteriores al update y
// ignore p_badges (dejándolo, si acaso, como pista para la celebración local).
//
// Menor, del mismo tema: si apply_activity_stats falla DESPUÉS de que el
// cerrojo claim_mission('macroday:…') ya quedó puesto, el bonus de día perfecto
// se pierde hasta mañana. Se prefirió ese sesgo (perder un bonus) sobre el
// contrario (pagarlo dos veces), pero desaparece cuando el conteo del día
// perfecto viva dentro de la misma transacción que el resto de la actividad.
