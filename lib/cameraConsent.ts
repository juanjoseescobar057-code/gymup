// lib/cameraConsent.ts
// ─────────────────────────────────────────────────────────
// Disclosure explícito de cámara (una vez por feature, persistido) antes
// del diálogo nativo de permiso — exigido por Google Play cuando la foto
// se envía a un tercero (OpenAI) para análisis. body-scan.tsx ya tenía su
// propia pantalla de consentimiento completa; esto da el mismo disclosure
// mínimo a food-scan y fridge-scan sin interrumpir cada escaneo.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'gymup_camera_disclosure_v1_';

export async function hasSeenCameraDisclosure(feature: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_PREFIX + feature)) === '1';
  } catch {
    return false; // si falla la lectura, mostrar el disclosure de todas formas
  }
}

export async function markCameraDisclosureSeen(feature: string): Promise<void> {
  await AsyncStorage.setItem(KEY_PREFIX + feature, '1').catch(() => {});
}
