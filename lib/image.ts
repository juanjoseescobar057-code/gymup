// lib/image.ts
// ─────────────────────────────────────────────────────────
// Redimensiona y comprime una imagen ANTES de mandarla a la IA.
//
// Las fotos del dispositivo pueden pesar varios MB; enviarlas en
// base64 a GPT-4o Vision es lento (datos móviles) y caro (tokens de
// visión escalan con el tamaño). Bajar a ~1024px de ancho recorta
// el payload ~70% sin perder calidad útil para el análisis.
// ─────────────────────────────────────────────────────────

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ExpoFS from 'expo-file-system/legacy';

const MAX_WIDTH = 1024;
const COMPRESS = 0.7;

/**
 * Devuelve la imagen como base64 JPEG, redimensionada y comprimida.
 * Si el manipulador falla por cualquier razón, cae al método anterior
 * (leer el archivo crudo) para no romper el flujo.
 */
export async function imageToOptimizedBase64(uri: string): Promise<string> {
  try {
    const ctx = ImageManipulator.manipulate(uri).resize({ width: MAX_WIDTH });
    const rendered = await ctx.renderAsync();
    const result = await rendered.saveAsync({
      base64: true,
      compress: COMPRESS,
      format: SaveFormat.JPEG,
    });
    if (result.base64) return result.base64;
    throw new Error('Sin base64 en el resultado');
  } catch (e: any) {
    console.log('[image] Manipulador falló, usando lectura cruda:', e?.message);
    return rawImageToBase64(uri);
  }
}

/** Lectura cruda de respaldo (lo que hacía la app antes). */
async function rawImageToBase64(uri: string): Promise<string> {
  const fs = ExpoFS as any;
  try {
    return await fs.readAsStringAsync(uri, { encoding: 'base64' });
  } catch {
    const dest = (fs.cacheDirectory ?? fs.documentDirectory ?? '') + 'gymup_' + Date.now() + '.jpg';
    await fs.copyAsync({ from: uri, to: dest });
    return await fs.readAsStringAsync(dest, { encoding: 'base64' });
  }
}
