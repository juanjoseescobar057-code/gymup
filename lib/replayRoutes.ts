// lib/replayRoutes.ts
// ─────────────────────────────────────────────────────────
// Qué pantallas NUNCA se graban, ni con el consentimiento dado.
//
// Vive aparte de posthog.ts (que arrastra el SDK nativo) porque esta lista es
// una PROMESA ESCRITA en la política de privacidad publicada, y una promesa
// sin test es una promesa hasta que alguien la rompe sin darse cuenta.
//
// Ya pasó: la lista tenía '/coach-chat' pero no '/coach'. El filtro es por
// prefijo y '/coach'.startsWith('/coach-chat') es false, así que la pestaña
// Coach —donde se ve la foto de cuerpo completo que acabas de tomar para el
// análisis de postura— se seguía grabando mientras la política decía que no.
// ─────────────────────────────────────────────────────────

export const RUTAS_SIN_GRABACION = [
  '/body-scan',
  '/food-scan',
  '/fridge-scan',
  '/health',
  '/onboarding',
  '/coach',        // la pestaña Coach: muestra la foto de postura
  '/coach-chat',
  '/progress',     // fotos de transformación
  '/camera',
  '/live-coach',
  '/workout-session',
  '/workout-complete',
  '/food-manual',
  '/history',
  '/legal',
  '/telemetry',
];

export function esRutaSensible(pathname: string): boolean {
  return RUTAS_SIN_GRABACION.some((r) => pathname.startsWith(r));
}
