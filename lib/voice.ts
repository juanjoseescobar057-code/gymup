// lib/voice.ts
// ─────────────────────────────────────────────────────────
// Cues de voz (TTS) para el Coach en Vivo. Envuelto en try/catch:
// si el módulo nativo no está en el build (dev viejo), hace no-op en
// vez de crashear. Funciona plenamente tras un rebuild con expo-speech.
// ─────────────────────────────────────────────────────────

import * as Speech from 'expo-speech';

let enabled = true;

export function setVoiceEnabled(v: boolean): void {
  enabled = v;
  if (!v) {
    try { Speech.stop(); } catch { /* no-op */ }
  }
}

export function isVoiceEnabled(): boolean {
  return enabled;
}

/** Dice una frase corta. Silencioso si la voz está apagada o el módulo falta. */
export function speak(text: string, { interrupt = false }: { interrupt?: boolean } = {}): void {
  if (!enabled || !text) return;
  try {
    if (interrupt) Speech.stop();
    Speech.speak(text, { language: 'es-MX', rate: 1.05, pitch: 1.0 });
  } catch {
    // Módulo nativo ausente → no-op hasta el próximo rebuild.
  }
}
