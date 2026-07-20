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

const appVersion: string = Constants.expoConfig?.version ?? 'unknown';

/** ¿Este dispositivo ya demostró que la cámara de pose no le funciona (en esta versión)? */
export async function isPoseCameraMarkedUnsupported(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === appVersion;
  } catch {
    return false; // ante la duda, intentar la cámara (el boundary contiene el fallo)
  }
}

/** Marca este dispositivo como no soportado para la versión actual de la app. */
export function markPoseCameraUnsupported(): void {
  AsyncStorage.setItem(KEY, appVersion).catch(() => {});
}
