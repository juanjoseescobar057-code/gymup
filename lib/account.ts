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

/**
 * Borrado total de la cuenta vía Edge Function (datos + identidad de auth).
 * Devuelve true si la función lo hizo; false si no está disponible (para que
 * el caller use el borrado por filas como respaldo).
 */
export async function deleteAccountServerSide(): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      console.log('[account] delete-account no disponible:', error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.log('[account] delete-account error:', e?.message);
    return false;
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
