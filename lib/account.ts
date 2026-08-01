// lib/account.ts
// ─────────────────────────────────────────────────────────
// Gestión de cuenta sobre Supabase Auth.
//
// El onboarding usa sesión ANÓNIMA (cero fricción). El problema es que,
// sin vincular un email, el usuario pierde TODO si reinstala o cambia de
// teléfono. Aquí permitimos:
//   • linkEmailPassword: convertir la sesión anónima en cuenta permanente
//     SIN cambiar el user_id (no se pierde nada).
//   • signInExisting: recuperar la cuenta en otro dispositivo.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** ¿La sesión actual es anónima (sin email vinculado)? */
export async function isAnonymousSession(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  // is_anonymous lo expone Supabase; si no hay email, también lo tratamos así.
  return !!user && ((user as any).is_anonymous === true || !user.email);
}

/** Email vinculado a la sesión actual, si lo hay. */
export async function getAccountEmail(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/**
 * Vincula email+contraseña a la sesión anónima actual, conservando el
 * user_id (y por tanto TODOS los datos). Según la config de Supabase puede
 * requerir confirmación por email.
 */
export async function linkEmailPassword(
  email: string,
  password: string
): Promise<{ ok: boolean; needsEmailConfirm: boolean; error?: string }> {
  if (!isValidEmail(email)) return { ok: false, needsEmailConfirm: false, error: 'Email no válido.' };
  if (password.length < 8) return { ok: false, needsEmailConfirm: false, error: 'La contraseña debe tener al menos 8 caracteres.' };

  const { data, error } = await supabase.auth.updateUser({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false, needsEmailConfirm: false, error: error.message };

  // Si el proyecto exige confirmar el email, el cambio queda pendiente.
  const needsEmailConfirm = !!data.user && !data.user.email_confirmed_at;
  return { ok: true, needsEmailConfirm };
}

export type DeleteAccountResult = { ok: boolean; error?: string };

/**
 * El `error` de functions.invoke solo dice "Edge Function returned a non-2xx
 * status code": el motivo real (ya redactado en español por la función) viaja
 * en el CUERPO de la respuesta, que supabase-js deja sin leer en `context`.
 * Sin esto la UI no puede mostrarle al usuario qué falló.
 */
async function readFunctionError(error: any): Promise<string | null> {
  try {
    const res = error?.context;
    if (res && typeof res.json === 'function') {
      const body = await res.json();
      if (body?.error) return String(body.error);
    }
  } catch {
    // El cuerpo no era JSON (p.ej. un 502 del gateway): se usa el mensaje genérico.
  }
  return null;
}

/**
 * Borrado total de la cuenta vía Edge Function (datos + identidad de auth).
 * Si algún dato no se pudo borrar, el servidor NO elimina la identidad y aquí
 * llega ok:false con el motivo — la sesión sigue viva y el reintento es
 * idempotente. Devuelve el error real (no un booleano pelado) porque el caller
 * tiene que MOSTRARLO: fingir éxito sobre un borrado fallido es exactamente lo
 * que rompía la promesa de la política de privacidad.
 */
export async function deleteAccountServerSide(): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      const detail = await readFunctionError(error);
      console.log('[account] delete-account falló:', detail ?? error.message);
      return { ok: false, error: detail ?? 'No pudimos contactar el servidor de borrado.' };
    }
    // Cinturón y tirantes: la función responde 2xx solo en éxito total, pero si
    // alguna vez devolviera ok:false con 200, no queremos leerlo como éxito.
    if (data && (data as any).ok === false) {
      return { ok: false, error: (data as any).error ?? 'El borrado no se completó.' };
    }
    return { ok: true };
  } catch (e: any) {
    console.log('[account] delete-account error:', e?.message);
    return { ok: false, error: e?.message ?? 'Error de red al eliminar la cuenta.' };
  }
}

/** Inicia sesión en una cuenta existente (recuperar datos en otro dispositivo). */
export async function signInExisting(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidEmail(email)) return { ok: false, error: 'Email no válido.' };
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
