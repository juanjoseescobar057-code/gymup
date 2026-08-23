// lib/badgesCatalogo.ts
// ─────────────────────────────────────────────────────────
// El catálogo de insignias y qué se le ofrece a cada persona.
//
// Vive aquí y no en lib/streaks.ts porque aquel importa supabase, y supabase
// arrastra react-native: un test de Node no puede cargarlo. Es la misma razón
// por la que existe lib/missionsMath.ts — la lógica que hay que poder probar no
// puede depender del entorno de la app.
//
// ⚠️ Los `id`, `xp` y `requirement` son ESPEJO de public.badge_catalog.
// ─────────────────────────────────────────────────────────

/**
 * Los tipos de insignia que premian mirar la comida y el cuerpo.
 *
 * Vive aquí, al lado del catálogo, para que añadir una insignia nueva obligue a
 * decidir de qué lado cae. La lista de misiones tiene su equivalente en
 * lib/missionsMath.ts.
 */
const METRICAS_CORPORALES = new Set(['meals', 'macro_days', 'body_scans']);

/**
 * Las insignias que se le enseñan a esta persona.
 *
 * Con `sinRecompensasCorporales` se retiran las de comida, macros y escaneo
 * corporal. NO se le quitan las que ya ganó de la base —eso sería borrarle algo
 * suyo— simplemente dejan de pintarse y de proponerse como siguiente meta.
 */
export function insigniasDisponibles(sinRecompensasCorporales: boolean) {
  if (!sinRecompensasCorporales) return BADGES;
  return BADGES.filter((b) => !METRICAS_CORPORALES.has(b.requirement.type));
}

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
