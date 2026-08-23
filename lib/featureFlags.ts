// lib/featureFlags.ts
// ─────────────────────────────────────────────────────────
// Poder apagar una función sin publicar una versión.
//
// Hoy, si el análisis corporal o el de postura dieran un consejo que no debían,
// la única salida sería un build nuevo: compilar, firmar, subir a Play, esperar
// la revisión y esperar a que la gente actualice. Días. Para funciones que
// emiten estimaciones corporales y correcciones de técnica a partir de una
// foto, eso no es un plan de contingencia.
//
// CÓMO FALLA. Al valor COMPILADO, siempre. Si la tabla no se puede leer —red,
// sesión, lo que sea— manda lo que dice DEFECTOS de aquí abajo. Ni se apaga la
// app por un problema de red, ni se abre algo que estaba apagado a propósito.
//
// CÓMO SE APAGA ALGO EN CALIENTE:
//   update public.feature_flags
//      set activo = false,
//          motivo = 'Lo estamos revisando; vuelve en unos días.'
//    where clave = 'body_scan';
//
// El cambio llega en el siguiente arranque de cada persona.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type ClaveFlag = 'body_scan' | 'postura' | 'coach_ia';

export type Flag = { activo: boolean; motivo: string | null };

/**
 * Lo que vale si no se puede leer la tabla.
 *
 * Todo encendido: apagar una función por un fallo de red sería romperle la app
 * a quien no tiene cobertura. La protección de verdad la dan las compuertas
 * clínicas y los topes, que no dependen de esto.
 */
const DEFECTOS: Record<ClaveFlag, Flag> = {
  body_scan: { activo: true, motivo: null },
  postura: { activo: true, motivo: null },
  coach_ia: { activo: true, motivo: null },
};

const CACHE_KEY = 'gymup_feature_flags_v1';

let enMemoria: Record<ClaveFlag, Flag> = { ...DEFECTOS };

/**
 * Trae los interruptores del servidor y los deja en memoria y en caché.
 *
 * Se llama UNA vez en el arranque. Nunca lanza: si falla, se queda lo último
 * que se supo (caché) y, si tampoco hay, los valores compilados.
 */
export async function cargarFlags(): Promise<void> {
  try {
    const cacheado = await AsyncStorage.getItem(CACHE_KEY);
    if (cacheado) enMemoria = { ...DEFECTOS, ...JSON.parse(cacheado) };
  } catch { /* la caché es un lujo, no un requisito */ }

  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('clave, activo, motivo');
    if (error || !Array.isArray(data)) return;

    const frescos: Record<string, Flag> = {};
    for (const fila of data) {
      const clave = (fila as { clave?: unknown }).clave;
      if (typeof clave !== 'string' || !(clave in DEFECTOS)) continue;
      frescos[clave] = {
        activo: (fila as { activo?: unknown }).activo !== false,
        motivo: (fila as { motivo?: unknown }).motivo as string | null ?? null,
      };
    }
    enMemoria = { ...DEFECTOS, ...frescos };
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(frescos)).catch(() => {});
  } catch { /* se queda lo que había */ }
}

/** El estado de un interruptor. Síncrono: las pantallas no pueden esperar. */
export function flag(clave: ClaveFlag): Flag {
  return enMemoria[clave] ?? DEFECTOS[clave];
}

/** Atajo para el caso normal. */
export function activa(clave: ClaveFlag): boolean {
  return flag(clave).activo;
}

/** El texto que se le enseña a la persona cuando está apagada. */
export const MOTIVO_POR_DEFECTO =
  'Esta función está en pausa mientras la revisamos. Volverá pronto, y tus datos siguen guardados.';

/** Solo para tests: reinicia el estado en memoria. */
export function _reiniciarFlags(): void {
  enMemoria = { ...DEFECTOS };
}
