// lib/exportData.ts
// ─────────────────────────────────────────────────────────
// Exportar TODOS tus datos en un archivo que puedas leer y llevarte.
//
// El centro de privacidad ya dejaba ver la política, borrar el historial
// corporal y borrar la cuenta entera — pero no llevarte lo tuyo. Faltaba la
// mitad amable del derecho: irse SIN perderlo todo. Y para una app que guarda
// meses de entrenamientos, pesos y fotos, "bórralo todo o quédate" no es una
// elección real.
//
// Se exporta en JSON legible, no en un volcado interno: es el formato que otra
// app puede importar y que una persona puede abrir y entender.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';

/** Tablas que contienen datos DEL USUARIO. Si se añade una, va aquí. */
const TABLAS = [
  // La prueba de qué autorizó y cuándo. Es SUYA, y es justo el dato que alguien
  // pide cuando quiere saber a qué dijo que sí. Se borra con la cuenta, así que
  // tiene que poder llevárselo antes.
  'legal_consents',
  'user_profiles',
  'training_plans',
  'workout_sessions',
  'set_logs',
  'food_logs',
  'body_scans',
  'weight_entries',
  'user_stats',
  // SINGULAR. Lo escribí en plural y la tabla real es `health_profile`, así
  // que el error "no existe" caía en la rama de "tabla opcional", se saltaba
  // en silencio y el export se declaraba COMPLETO sin el perfil de salud.
  // Alguien podía exportar, creer que ya tenía todo lo suyo y borrar la
  // cuenta a continuación.
  'health_profile',
  'workout_readiness',
  'transform_photos',
  'notification_preferences',
  // Faltaban y son contenido del usuario, no telemetría: los análisis de su
  // técnica y lo que el coach recuerda de él.
  'posture_feedback',
  'coach_memory',
] as const;

export type ResultadoExport =
  | { ok: true; json: string; tablas: number; filas: number; incompletas: string[] }
  | { ok: false; mensaje: string };

/**
 * Junta todo lo del usuario en un JSON.
 *
 * Si alguna tabla falla, NO se aborta: se exporta lo que sí se pudo y se
 * DEVUELVE la lista de las que faltan. Un export silenciosamente incompleto
 * es peor que uno que falla, porque la persona cree que ya tiene todo lo suyo
 * y puede borrar la cuenta a continuación.
 */
export async function exportarMisDatos(userId: string): Promise<ResultadoExport> {
  const datos: Record<string, unknown> = {};
  const incompletas: string[] = [];
  let filas = 0;

  for (const tabla of TABLAS) {
    try {
      const { data, error } = await supabase.from(tabla).select('*').eq('user_id', userId);
      if (error) {
        // Una tabla que no existe en este proyecto no es un fallo del export.
        if (/does not exist|schema cache/i.test(error.message)) continue;
        incompletas.push(tabla);
        continue;
      }
      datos[tabla] = data ?? [];
      filas += (data ?? []).length;
    } catch (e) {
      captureError(e, { scope: 'exportarMisDatos', tabla });
      incompletas.push(tabla);
    }
  }

  const tablas = Object.keys(datos).length;
  if (tablas === 0) {
    return { ok: false, mensaje: 'No pudimos leer tus datos. Revisa tu conexión e intenta de nuevo.' };
  }

  const sobre = {
    app: 'Rityvo',
    exportado_el: new Date().toISOString(),
    usuario: userId,
    aviso: incompletas.length
      ? `Este export está INCOMPLETO: no se pudieron leer ${incompletas.join(', ')}. Vuelve a intentarlo antes de borrar tu cuenta.`
      : 'Export completo de los datos asociados a tu cuenta.',
    datos,
  };

  return { ok: true, json: JSON.stringify(sobre, null, 2), tablas, filas, incompletas };
}
