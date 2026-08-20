// lib/streaks.ts
// ─────────────────────────────────────────────────────────
// Sistema de rachas, XP y badges de Rityvo.
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
// ⚠️ Los `id`, `xp` y `requirement` son ESPEJO de public.badge_catalog y son
// contrato de analítica (viajan en el evento badge_earned). Solo `title`,
// `desc` y `emoji` son presentación y se pueden reescribir sin tocar nada más.
//
// El copy anterior premiaba con marcos que no queremos: "perfecta" y "sin
// fallar" convierten un día de descanso —que el propio plan prescribe— en un
// fracaso, y "solo el 5% llega aquí" / "menos del 0.1%" son estadísticas
// inventadas que además compiten al usuario contra desconocidos.
export const BADGES = [
  // Rachas de entrenamiento
  { id: 'streak_3',     emoji: '🔥',  title: '3 días seguidos',      desc: 'Arrancaste una racha',        xp: 50,   requirement: { type: 'streak', value: 3 } },
  { id: 'streak_7',     emoji: '⚡',  title: 'Semana consistente',    desc: 'Cumpliste lo que te propusiste', xp: 150,  requirement: { type: 'streak', value: 7 } },
  { id: 'streak_14',    emoji: '💎',  title: 'Dos semanas seguidas',  desc: 'La constancia ya es tuya',   xp: 300,  requirement: { type: 'streak', value: 14 } },
  { id: 'streak_30',    emoji: '👑',  title: 'Un mes de constancia',  desc: 'Esto ya es un hábito',        xp: 750,  requirement: { type: 'streak', value: 30 } },
  { id: 'streak_100',   emoji: '🦾',  title: '100 días',              desc: 'Cien días sosteniéndolo',    xp: 3000, requirement: { type: 'streak', value: 100 } },

  // Comidas registradas
  { id: 'meals_1',      emoji: '📸',  title: 'Primera foto de comida', desc: 'El tracking empieza hoy',   xp: 30,   requirement: { type: 'meals', value: 1 } },
  { id: 'meals_10',     emoji: '🍽️', title: '10 comidas registradas', desc: 'El hábito de trackear',     xp: 100,  requirement: { type: 'meals', value: 10 } },
  { id: 'meals_50',     emoji: '📊',  title: '50 comidas analizadas',  desc: 'Registrar te da contexto',   xp: 400,  requirement: { type: 'meals', value: 50 } },

  // Macros diarios cumplidos
  { id: 'macro_day_1',  emoji: '✅',  title: 'Metas del día cubiertas', desc: 'Cubriste tus cuatro metas', xp: 80,   requirement: { type: 'macro_days', value: 1 } },
  { id: 'macro_day_7',  emoji: '🎯',  title: '7 días en tu rango',     desc: 'Adherencia sostenida',       xp: 300,  requirement: { type: 'macro_days', value: 7 } },

  // Escaneos corporales

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

// ─── PREVISUALIZAR BADGES (NO OTORGA NADA) ───────────────
// Pura y síncrona: qué insignias correspondrían a unas stats dadas.
//
// ⚠️ Ya NO decide nada. Quien otorga las insignias y paga su XP es el servidor
// (badge_catalog + _derive_badges en supabase/setup.sql), derivándolas de las
// stats reales tras el update. Esta función queda solo para pintar la UI
// (p.ej. "próximos logros") sin ir a la red. Lo que se le anuncie al usuario
// como GANADO debe salir siempre del earned_badges que devuelve la RPC.
//
// Los umbrales de abajo son un ESPEJO de public.badge_catalog: si cambias uno,
// cambia el otro o la previsualización mentirá.
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
      // 'body_scans' ya no es una métrica de insignia: se retiraron las dos
      // que premiaban escanearse el cuerpo. El contador sigue existiendo
      // porque es dato del usuario y se lo puede llevar en su export; lo que
      // desaparece es la recompensa por mirarse.
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

// ─── REGISTRAR ENTRENAMIENTO COMPLETADO ──────────────────
// UNA sola llamada a apply_workout_stats: el servidor deriva el usuario de
// auth.uid(), acota el XP, es idempotente por día y recalcula racha, nivel y
// total_workouts. El cliente PROPONE (XP y badges), el servidor DISPONE.
export async function recordWorkoutCompleted(
  userId: string,
  /**
   * Id de la fila de workout_sessions que se acaba de cerrar. Es la EVIDENCIA:
   * el servidor comprueba que existe, que es de este usuario, que está
   * completada y que no ha cobrado todavía, y solo entonces acredita. Sin él
   * (builds anteriores) el servidor cae a acreditar una vez por día.
   */
  sessionId?: string | null
): Promise<{ newBadges: BadgeId[]; xpGained: number; streakBroken: boolean; newStreak: number; leveledUp: boolean; freezeUsed: boolean }> {
  const stats = await loadUserStats(userId);
  const hoy = localDayKey(); // día LOCAL, no UTC (ver streaksMath)
  const { newStreak } = calculateNewStreak(stats, hoy);

  const XP_PER_WORKOUT = 75;
  const streakBonus = newStreak >= 7 ? 50 : newStreak >= 3 ? 25 : 0;
  const baseXp = XP_PER_WORKOUT + streakBonus;
  const prevLevel = xpToLevel(stats.total_xp);

  // El MONTO ya no lo decide el cliente: el servidor calcula el XP base y el
  // bono de racha, deriva las insignias de las stats reales y paga su XP.
  // p_xp_delta y p_base_xp siguen viajando solo por compatibilidad de firma y
  // allá se ignoran. Lo que sí importa es p_session_id: es la evidencia de que
  // hubo un entrenamiento y lo que impide que se cobre dos veces.
  const { data, error } = await supabase.rpc('apply_workout_stats', {
    p_xp_delta: baseXp,
    p_base_xp: baseXp,
    p_workout_date: hoy,
    p_badges: [],
    p_session_id: sessionId ?? null,
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
      xp_propuesto: baseXp,
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

  // Manda la fila del servidor: él decidió las insignias, su XP, la racha y el
  // nivel. El cliente ya no proyecta nada que se muestre como ganado.
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
  macroPerfectDay = false,
  evidenceId?: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean; macroDayCounted: boolean }> {
  const stats = await loadUserStats(userId);
  const prevLevel = xpToLevel(stats.total_xp);

  const XP_PER_MEAL = 15;
  const baseXp = XP_PER_MEAL + (macroPerfectDay ? 50 : 0);

  // Las insignias las deriva y paga el servidor (ver recordWorkoutCompleted).
  const { data, error } = await supabase.rpc('apply_activity_stats', {
    p_kind: 'meal',
    p_xp_delta: baseXp,
    p_base_xp: baseXp,
    p_badges: [],
    p_macro_perfect: macroPerfectDay,
    p_evidence_id: evidenceId ?? null,
    p_local_day: localDayKey(),
  });

  // La RPC devuelve `returns table`, o sea una fila dentro de un array.
  const fila = Array.isArray(data) ? data[0] : data;

  if (error || !fila) {
    // La gamificación no puede tumbar el flujo: la comida YA se guardó en
    // food_logs. Se reporta y se devuelve "nada que celebrar" en vez de
    // anunciar XP que el servidor nunca registró.
    captureError(error ?? new Error('apply_activity_stats no devolvió stats'), {
      scope: 'apply_activity_stats.meal',
      xp_propuesto: baseXp,
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
    macroDayCounted: Boolean(fila.macro_day_counted),
  };
}

// ─── REGISTRAR ESCANEO CORPORAL ──────────────────────────
export async function recordBodyScan(
  userId: string,
  evidenceId?: string
): Promise<{ newBadges: BadgeId[]; xpGained: number; leveledUp: boolean }> {
  const stats = await loadUserStats(userId);
  const XP_PER_SCAN = 40;
  const prevLevel = xpToLevel(stats.total_xp);

  const { data, error } = await supabase.rpc('apply_activity_stats', {
    p_kind: 'body_scan',
    p_xp_delta: XP_PER_SCAN,
    p_base_xp: XP_PER_SCAN,
    p_badges: [],
    p_macro_perfect: false,
    p_evidence_id: evidenceId ?? null,
    p_local_day: localDayKey(),
  });

  const fila = Array.isArray(data) ? data[0] : data;

  if (error || !fila) {
    // El escaneo YA se guardó en su tabla; perder el XP no justifica romper.
    captureError(error ?? new Error('apply_activity_stats no devolvió stats'), {
      scope: 'apply_activity_stats.body_scan',
      xp_propuesto: XP_PER_SCAN,
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

// ─── ESTADO DEL BLINDAJE ─────────────────────────────────
// CERRADO — vías de escritura: entrenamiento, comida, escaneo, misión y compra
// de comodín pasan cada una por su RPC, y user_stats no acepta insert/update
// desde el cliente.
//
// CERRADO — falsificación de insignias: las RPC ya no hacen union de p_badges.
// Derivan las insignias de las stats REALES contra public.badge_catalog
// (_derive_badges) y pagan su XP ellas mismas. p_badges sobrevive en la firma
// solo para que los builds ya distribuidos no revienten; allá se ignora.
//
// CERRADO — cobro de misiones sin cumplirlas: claim_mission cuenta
// workout_sessions / food_logs / body_scans de la semana codificada en el
// propio id y devuelve ok=false, reason='goal_not_met' si la meta no se
// alcanzó. El XP sale de public.mission_catalog, no del cliente.
//
// ABIERTO, menor: si apply_activity_stats falla DESPUÉS de que el cerrojo
// claim_mission('macroday:…') ya quedó puesto, el bonus de día perfecto se
// pierde hasta mañana. Se prefiere ese sesgo (perder un bonus una vez) sobre el
// contrario (pagarlo dos veces). Desaparece cuando el conteo del día perfecto
// viva dentro de la misma transacción que el resto de la actividad.
