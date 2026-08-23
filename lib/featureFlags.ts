// lib/featureFlags.ts
// ─────────────────────────────────────────────────────────
// Poder apagar una función sin publicar una versión — de verdad.
//
// La primera versión de este archivo no era un kill switch. Era una sugerencia:
//
//   • los valores compilados dejaban TODO encendido, así que si la tabla no
//     respondía, o faltaba la fila, o el móvil estaba sin red, la función
//     seguía activa. Fallaba abierto — justo al revés de lo que tiene que hacer
//     un interruptor de emergencia;
//   • `cargarFlags()` se lanzaba en segundo plano sin esperarla, así que la
//     primera pantalla se pintaba con los valores compilados;
//   • el guardia leía una variable de módulo, no estado reactivo: si la
//     consulta terminaba después del render, la pantalla no se enteraba;
//   • y ai-proxy no miraba la tabla en absoluto, así que un cliente modificado
//     —o simplemente uno viejo— seguía gastando IA en una función "apagada".
//
// CÓMO FALLA AHORA. Las funciones de riesgo (análisis corporal, análisis de
// técnica) arrancan BLOQUEADAS hasta saber el estado remoto. Es el mismo
// criterio que la compuerta clínica y el modo recuperación: ante la duda, no.
//
// Las que no son de riesgo arrancan disponibles: bloquear el coach de texto por
// un fallo de red sería romper la app sin ganar nada.
//
// CÓMO SE APAGA ALGO EN CALIENTE:
//   update public.feature_flags
//      set activo = false,
//          motivo = 'Lo estamos revisando; vuelve en unos días.'
//    where clave in ('body_scan', 'scan_check');
//
// El servidor lo aplica en la siguiente petición; el cliente, al volver a
// primer plano.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type ClaveFlag = 'body_scan' | 'postura' | 'coach_ia';

export type Flag = { activo: boolean; motivo: string | null };

/**
 * Qué vale mientras NO se sepa el estado remoto.
 *
 * Las de riesgo, bloqueadas. Son las que emiten estimaciones corporales y
 * correcciones de técnica a partir de una foto: si hay que apagarlas es porque
 * están diciendo algo que no deberían, y en ese momento un móvil sin cobertura
 * no puede ser una excepción.
 */
const MIENTRAS_NO_SE_SEPA: Record<ClaveFlag, Flag> = {
  body_scan: { activo: false, motivo: null },
  postura: { activo: false, motivo: null },
  coach_ia: { activo: true, motivo: null },
};

const CACHE_KEY = 'gymup_feature_flags_v2';

let enMemoria: Record<ClaveFlag, Flag> = { ...MIENTRAS_NO_SE_SEPA };
let estado: 'cargando' | 'conocido' = 'cargando';

/** Quien quiera enterarse de un cambio. Lo usa el guardia para re-renderizar. */
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const o of oyentes) {
    try { o(); } catch { /* un oyente roto no rompe a los demás */ }
  }
}

export function suscribirseAFlags(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * Trae los interruptores del servidor.
 *
 * HAY QUE ESPERARLA en el arranque. Lanzarla sin await deja las funciones de
 * riesgo bloqueadas durante el primer render — que es correcto, pero se ve como
 * un fallo — y sobre todo hace que el estado dependa de una carrera.
 *
 * Nunca lanza: si falla, se usa la última respuesta buena (caché) y, si tampoco
 * hay, los valores de arriba.
 */
export async function cargarFlags(): Promise<void> {
  let deCache: Record<string, Flag> | null = null;
  try {
    const cacheado = await AsyncStorage.getItem(CACHE_KEY);
    if (cacheado) deCache = JSON.parse(cacheado);
  } catch { /* la caché es un lujo, no un requisito */ }

  try {
    const { data, error } = await supabase.from('feature_flags').select('clave, activo, motivo');
    if (!error && Array.isArray(data)) {
      const frescos: Record<string, Flag> = {};
      for (const fila of data) {
        const clave = (fila as { clave?: unknown }).clave;
        if (typeof clave !== 'string' || !(clave in MIENTRAS_NO_SE_SEPA)) continue;
        frescos[clave] = {
          activo: (fila as { activo?: unknown }).activo !== false,
          motivo: ((fila as { motivo?: unknown }).motivo as string | null) ?? null,
        };
      }
      enMemoria = { ...MIENTRAS_NO_SE_SEPA, ...frescos };
      estado = 'conocido';
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(frescos)).catch(() => {});
      avisar();
      return;
    }
  } catch { /* se cae a la caché */ }

  // Sin respuesta del servidor: la última que sí hubo. Un apagado se queda
  // apagado aunque después no haya red — que es lo que se quiere.
  if (deCache) {
    enMemoria = { ...MIENTRAS_NO_SE_SEPA, ...deCache };
    estado = 'conocido';
  }
  avisar();
}

/** El estado de un interruptor. Síncrono: las pantallas no pueden esperar. */
export function flag(clave: ClaveFlag): Flag {
  return enMemoria[clave] ?? MIENTRAS_NO_SE_SEPA[clave];
}

export function activa(clave: ClaveFlag): boolean {
  return flag(clave).activo;
}

/** ¿Ya sabemos el estado remoto, o seguimos con los valores de partida? */
export function flagsConocidos(): boolean {
  return estado === 'conocido';
}

/** El texto que se le enseña a la persona cuando está apagada. */
export const MOTIVO_POR_DEFECTO =
  'Esta función está en pausa mientras la revisamos. Volverá pronto, y tus datos siguen guardados.';

/** Solo para tests: reinicia el estado en memoria. */
export function _reiniciarFlags(): void {
  enMemoria = { ...MIENTRAS_NO_SE_SEPA };
  estado = 'cargando';
}
