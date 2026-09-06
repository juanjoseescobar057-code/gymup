// lib/mensajeDeFallo.ts
// ─────────────────────────────────────────────────────────
// Qué se le enseña a la persona cuando una llamada de IA se cae.
//
// Tres pantallas hacían `Alert.alert('Error en el análisis', e.message)`. Si
// `e` era nuestro (ErrorDeIA: cupo, Premium, saturación) el mensaje estaba
// bien; si era un "Network request failed", un fallo de esquema de la
// respuesta o cualquier excepción de librería, la pantalla enseñaba inglés y
// tripas. Este módulo es puro (sin react-native ni supabase) para poder
// probarlo desde node, y por eso reconoce ErrorDeIA por su `name` en vez de
// por `instanceof`.
// ─────────────────────────────────────────────────────────

const RED = /network|fetch|timeout|timed out|abort|socket|ECONN|offline|internet/i;

export const FALLO_DE_RED =
  'Parece un problema de conexión. Revisa tu red e inténtalo de nuevo.';
export const FALLO_GENERICO =
  'No pudimos completar el análisis. Inténtalo de nuevo en un momento.';

/** True si el error salió de nuestro propio cliente de IA (mensaje ya en castellano). */
export function esErrorNuestro(e: unknown): e is Error {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'ErrorDeIA'
    && typeof (e as { message?: unknown }).message === 'string';
}

export function mensajeDeFalloDeIA(e: unknown): string {
  if (esErrorNuestro(e)) return e.message;
  const texto = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return RED.test(texto) ? FALLO_DE_RED : FALLO_GENERICO;
}
