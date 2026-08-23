// lib/replayRoutes.ts
// ─────────────────────────────────────────────────────────
// Qué pantallas se pueden grabar. LISTA BLANCA.
//
// Era una lista NEGRA, y una lista negra en una app de salud está mal por
// construcción: hay que acordarse de añadir cada pantalla nueva, y la que se
// olvide se graba. Ya pasó una vez —la lista tenía '/coach-chat' pero no
// '/coach', y el filtro es por prefijo— y el auditor encontró dos más:
// '/profile' y la portada, que muestran peso, macros y datos personales, no
// estaban excluidas.
//
// Con lista blanca, olvidarse tiene el efecto contrario: la pantalla nueva NO
// se graba hasta que alguien decida explícitamente que puede. El coste de
// equivocarse pasa de "grabamos datos de salud" a "tenemos menos grabaciones".
//
// Esta lista es una PROMESA ESCRITA en la política de privacidad publicada, y
// una promesa sin test es una promesa hasta que alguien la rompe sin darse
// cuenta. __tests__/replayRoutes.test.ts la vigila.
// ─────────────────────────────────────────────────────────

/**
 * Las ÚNICAS rutas donde se puede grabar la sesión.
 *
 * El criterio para entrar aquí: la pantalla no muestra peso, calorías, macros,
 * fotos del cuerpo, tamizaje de salud, conversaciones con el coach, ni datos
 * personales. En la práctica quedan las de navegación y las de pago.
 *
 * Si dudas si una pantalla puede entrar, la respuesta es que no.
 */
export const RUTAS_GRABABLES = [
  '/paywall',   // pantalla de pago: precios de la tienda, nada personal
  '/exercises', // catálogo de ejercicios
  '/index',     // pantalla de arranque (splash), antes de cargar nada
];

/**
 * Compatibilidad: algún sitio sigue importando el nombre viejo. Ahora es
 * derivado, no una fuente: lo que manda es la lista blanca.
 */
export const RUTAS_SIN_GRABACION: string[] = [];


/**
 * ¿Esta ruta NO se puede grabar?
 *
 * Todo lo que no esté en la lista blanca. Antes era al revés y por eso se
 * colaban las pantallas que nadie se acordó de añadir.
 */
export function esRutaSensible(pathname: string): boolean {
  return !RUTAS_GRABABLES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}
