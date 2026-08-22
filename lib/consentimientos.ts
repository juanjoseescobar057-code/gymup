// lib/consentimientos.ts
// ─────────────────────────────────────────────────────────
// Guarda y lee la autorización de tratamiento de datos.
//
// Toda la decisión está en lib/legal.ts, que es puro y se prueba. Aquí solo se
// habla con Supabase.
// ─────────────────────────────────────────────────────────

import Constants from 'expo-constants';
import { supabase } from './supabase';
import {
  consentimientosAGuardar,
  documentosPendientes,
  type ConsentimientoGuardado,
  type DocumentoLegal,
} from './legal';

export type ResultadoConsentimiento = { ok: true } | { ok: false; error: string };

/**
 * Deja constancia de que esta persona aceptó los documentos vigentes.
 *
 * Devuelve un resultado en vez de lanzar porque quien llama TIENE que decidir
 * qué hacer si falla, y la respuesta correcta es abortar: guardar un tamizaje
 * de salud sin haber podido registrar la autorización es exactamente lo que la
 * ley prohíbe. Es el mismo criterio que ya se aplica al propio tamizaje en el
 * onboarding.
 *
 * Es idempotente: la clave primaria es (user_id, document, version), así que
 * reintentar no duplica ni pisa la fecha original — y la fecha original es la
 * que vale como prueba.
 */
export async function registrarConsentimiento(userId: string): Promise<ResultadoConsentimiento> {
  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ??
    (Constants.easConfig as { version?: string } | undefined)?.version ??
    null;

  const filas = consentimientosAGuardar().map((c) => ({
    user_id: userId,
    document: c.document,
    version: c.version,
    app_version: appVersion,
    locale: (Intl.DateTimeFormat().resolvedOptions().locale as string | undefined) ?? null,
  }));

  // ignoreDuplicates: reintentar tras un fallo de red no puede convertirse en
  // un error, y tampoco puede mover accepted_at a hoy.
  const { error } = await supabase
    .from('legal_consents')
    .upsert(filas, { onConflict: 'user_id,document,version', ignoreDuplicates: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Los consentimientos guardados. null si no se pudieron leer (≠ "no hay"). */
export async function leerConsentimientos(
  userId: string,
): Promise<ConsentimientoGuardado[] | null> {
  const { data, error } = await supabase
    .from('legal_consents')
    .select('document, version')
    .eq('user_id', userId);
  if (error) return null;
  return (data ?? []) as ConsentimientoGuardado[];
}

/**
 * Qué le falta por aceptar a alguien que YA está dentro.
 *
 * Devuelve [] cuando no se pudo leer, no la lista entera: no se puede sacar un
 * muro legal delante de alguien porque su móvil no tenía cobertura. Se
 * preguntará la próxima vez.
 */
export async function pendientesDeAceptar(userId: string): Promise<DocumentoLegal[]> {
  const guardados = await leerConsentimientos(userId);
  if (guardados === null) return [];
  return documentosPendientes(guardados);
}
