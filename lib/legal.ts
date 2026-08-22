// lib/legal.ts
// ─────────────────────────────────────────────────────────
// Qué documentos legales hay que aceptar, en qué versión, y cómo se prueba.
//
// La casilla del onboarding era un `useState(false)`: bloqueaba el botón y no
// se guardaba en ningún sitio. Al salir de la pantalla no quedaba rastro de
// que nadie hubiera autorizado nada, y justo después la app escribía un
// tamizaje de salud entero.
//
// La Ley 1581 de 2012 y el Decreto 1377 de 2013 piden que el responsable pueda
// PROBAR la autorización, y con datos sensibles —la salud lo es— el estándar
// aprieta más. Un booleano en memoria no dice quién aceptó, ni cuándo, ni qué
// versión del documento estaba leyendo.
//
// Este módulo no toca la red ni React: decide qué falta por aceptar. Lo que
// escribe en la base es lib/consentimientos.ts.
// ─────────────────────────────────────────────────────────

export type DocumentoLegal = 'terms' | 'privacy';

// Las versiones que hay publicadas AHORA. Salen de la cabecera de los
// documentos de docs/legal/, y __tests__/legal.test.ts falla si dejan de
// coincidir: si el texto cambia y este número no, se estaría guardando como
// prueba una versión que la persona no vio.
export const VERSIONES: Record<DocumentoLegal, string> = {
  terms: '1.0',
  privacy: '1.3',
};

export const DOCUMENTOS: DocumentoLegal[] = ['terms', 'privacy'];

/** Un consentimiento tal como está guardado. */
export type ConsentimientoGuardado = {
  document: string;
  version: string;
};

/** Lo que hay que guardar cuando alguien acepta hoy. */
export function consentimientosAGuardar(): { document: DocumentoLegal; version: string }[] {
  return DOCUMENTOS.map((d) => ({ document: d, version: VERSIONES[d] }));
}

/**
 * Qué documentos le faltan a esta persona por aceptar.
 *
 * Devuelve los que no tiene guardados EN LA VERSIÓN ACTUAL. Haber aceptado la
 * política 1.2 no es haber aceptado la 1.3: si lo tratáramos como equivalente,
 * cambiar la política dejaría de requerir nada y el versionado no serviría de
 * nada.
 *
 * Se usa para dos cosas distintas: decidir si el onboarding puede continuar y,
 * más adelante, si hay que volver a preguntar a alguien que ya estaba dentro.
 */
export function documentosPendientes(
  guardados: ConsentimientoGuardado[] | null | undefined,
): DocumentoLegal[] {
  const tiene = new Set((guardados ?? []).map((c) => `${c.document}@${c.version}`));
  return DOCUMENTOS.filter((d) => !tiene.has(`${d}@${VERSIONES[d]}`));
}

/** ¿Está todo aceptado en la versión de hoy? */
export function todoAceptado(guardados: ConsentimientoGuardado[] | null | undefined): boolean {
  return documentosPendientes(guardados).length === 0;
}
