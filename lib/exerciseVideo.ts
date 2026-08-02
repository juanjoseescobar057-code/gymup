// lib/exerciseVideo.ts
// ─────────────────────────────────────────────────────────
// "Ver cómo se hace" para un ejercicio.
//
// Por qué una búsqueda de YouTube y no imágenes propias: el catálogo tiene 30+
// ejercicios y una ilustración por cada uno significa conseguir 30+ assets con
// licencia clara, mantenerlos y sumarlos al peso del AAB. Una búsqueda no pesa
// nada, funciona para cualquier ejercicio que agreguemos después (incluidos los
// que invente la IA en un plan, que no están en el catálogo) y siempre muestra
// contenido actual. El costo es que saca al usuario de la app.
//
// Se busca en español y con términos de técnica para no caer en rutinas de
// influencer: "técnica" y "cómo hacer" filtran hacia videos explicativos.
// ─────────────────────────────────────────────────────────

import { Linking } from 'react-native';
import { captureError } from './monitoring';

/** URL de búsqueda de YouTube para la técnica de un ejercicio. */
export function exerciseVideoUrl(exerciseName: string): string {
  const query = `como hacer ${exerciseName} tecnica correcta`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/**
 * Abre el video de técnica del ejercicio.
 * No lanza: si no hay navegador o la app no puede abrir el enlace, se reporta
 * y se devuelve false — quedarse sin video no puede tumbar un entrenamiento en
 * curso.
 */
export async function openExerciseVideo(exerciseName: string): Promise<boolean> {
  const url = exerciseVideoUrl(exerciseName);
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    captureError(e, { scope: 'openExerciseVideo', exercise: exerciseName });
    return false;
  }
}
