// lib/borradoLocal.ts
// ─────────────────────────────────────────────────────────
// Borrar de VERDAD lo que queda en el teléfono.
//
// La Edge Function delete-account borra las filas y los archivos del servidor,
// y auth.admin.deleteUser dispara el cascade. Pero en AsyncStorage se quedaban:
//
//   • el perfil de salud en caché — lesiones, condiciones, el tamizaje entero;
//   • la conversación con el coach;
//   • la memoria destilada, que incluye lesiones y contexto de vida;
//   • la sesión de entrenamiento a medias;
//   • el agua y las cuotas del día.
//
// Varias van con el uid en la clave, así que no se mezclan entre cuentas — pero
// siguen FÍSICAMENTE en el dispositivo después de cerrar sesión o borrar la
// cuenta. La política de privacidad promete borrarlo todo, y en un teléfono
// compartido o vendido eso importa.
//
// QUÉ SE CONSERVA, y por qué: el identificador anónimo de analítica y la cola de
// eventos pendientes. Borrarlos perdería los eventos que aún no se enviaron
// —incluido el propio evento de borrado de cuenta— y el id anónimo no está
// ligado a la persona. Todo lo demás se va.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Claves que SOBREVIVEN. Lista corta y explícita: cualquier cosa que no esté
 * aquí se borra, así que una clave nueva se limpia sola sin que nadie tenga que
 * acordarse. Es el mismo criterio que la lista blanca del session replay.
 */
const SE_CONSERVAN = [
  'gymup_anonymous_id',      // identificador anónimo, no ligado a la persona
  'gymup_analytics_queue_v1', // eventos aún sin enviar, incluido el del borrado
  'gymup_acquisition_v1',     // de dónde vino la instalación, anónimo
  'gymup_feature_flags_v2',   // interruptores remotos: no son de nadie
  'gymup_pose_camera_unsupported_v1', // capacidad del dispositivo, no de la persona
];

export type ResultadoBorrado = { borradas: number; conservadas: number };

/**
 * Borra del dispositivo todo lo de esta persona.
 *
 * Nunca lanza: si el almacenamiento falla, el cierre de sesión tiene que
 * completarse igual — dejar a alguien atrapado dentro de una cuenta que quiso
 * abandonar sería peor que dejar una caché.
 */
export async function borrarDatosLocales(): Promise<ResultadoBorrado> {
  try {
    const todas = await AsyncStorage.getAllKeys();
    // Se borra por prefijo 'gymup_' y no todo: AsyncStorage lo comparten otras
    // librerías (Supabase guarda ahí la sesión, y de eso se encarga signOut).
    const aBorrar = todas.filter(
      (k) => k.startsWith('gymup_') && !SE_CONSERVAN.includes(k),
    );
    if (aBorrar.length > 0) await AsyncStorage.multiRemove(aBorrar);
    return { borradas: aBorrar.length, conservadas: todas.length - aBorrar.length };
  } catch {
    return { borradas: 0, conservadas: 0 };
  }
}

/** Solo para tests: qué se conservaría de una lista dada. */
export function _clasificar(claves: string[]): { borrar: string[]; conservar: string[] } {
  const borrar = claves.filter((k) => k.startsWith('gymup_') && !SE_CONSERVAN.includes(k));
  return { borrar, conservar: claves.filter((k) => !borrar.includes(k)) };
}

export const _SE_CONSERVAN = SE_CONSERVAN;
