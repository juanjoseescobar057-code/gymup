// lib/pose/cameraSupport.ts
// ─────────────────────────────────────────────────────────
// Memoria por-dispositivo de si la cámara de pose funciona aquí.
//
// Los crashes nativos de vision-camera ("Cannot get hybrid property" etc.)
// dependen del dispositivo/fabricante. Cuando uno ocurre, se marca este
// dispositivo como no soportado: las próximas sesiones van DIRECTO al modo
// simulado, sin reintentar (ni error, ni espera). La marca guarda la versión
// de la app: tras una actualización se reintenta UNA vez, por si un fix
// nativo posterior lo resolvió.
//
// La vista de flota (¿en qué modelos falla?) sale de Sentry: el reporte
// camera_render_crash lleva adjunto modelo/fabricante/OS automáticamente.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const KEY = 'gymup_pose_camera_unsupported_v1';

/**
 * El BUILD, no la versión de marketing.
 *
 * Esto guardaba solo `version` — "1.3.0" — y los builds 22, 23 y 24 comparten
 * ese número. Para este código todas las 1.3.0 eran la misma, así que el
 * "tras una actualización se reintenta UNA vez" que promete el comentario de
 * arriba no ocurría nunca: un teléfono marcado durante el build 22 seguía
 * yendo directo al modo simulado en el 23 y en el 24, aunque el arreglo nativo
 * que necesitaba viniera justo ahí.
 *
 * El versionCode sí cambia en cada subida a Play — es obligatorio, Google no
 * acepta el mismo dos veces— así que es lo único que distingue un build del
 * siguiente.
 */
const buildActual: string = `${Constants.expoConfig?.version ?? 'unknown'}(${
  (Constants.expoConfig as any)?.android?.versionCode ?? '?'
})`;

/** ¿Este dispositivo ya demostró que la cámara de pose no le funciona (en este build)? */
export async function isPoseCameraMarkedUnsupported(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === buildActual;
  } catch {
    return false; // ante la duda, intentar la cámara (el boundary contiene el fallo)
  }
}

/** Marca este dispositivo como no soportado para el build actual. */
export function markPoseCameraUnsupported(): void {
  AsyncStorage.setItem(KEY, buildActual).catch(() => {});
}
