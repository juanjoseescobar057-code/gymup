// lib/erroresAuth.ts
// ─────────────────────────────────────────────────────────
// Módulo PURO: sin supabase ni react-native, para poder probarlo en node.
// account.ts lo reexporta.
// ─────────────────────────────────────────────────────────

/**
 * Los errores de Supabase Auth, en castellano y sin revelar de más.
 *
 * Llegaban crudos y en inglés a todos los botones de cuenta: "Invalid login
 * credentials", "User already registered", "Email rate limit exceeded". Un
 * público colombiano no tiene por qué entender eso, y algunos revelan lo que
 * no se debe (si el correo existe). Lo que no está en la tabla se sustituye
 * por un mensaje genérico: nunca se enseña el texto del proveedor.
 */
export function traducirErrorAuth(mensaje: string | undefined | null): string {
  const m = (mensaje ?? '').toLowerCase();
  if (/invalid login credentials|invalid_credentials/.test(m)) {
    return 'El correo o la contraseña no coinciden. Revísalos e inténtalo otra vez.';
  }
  if (/email not confirmed/.test(m)) {
    return 'Todavía no confirmaste tu correo. Busca el enlace que te enviamos, también en spam.';
  }
  if (/already registered|already been registered|already exists|user_already_exists/.test(m)) {
    return 'Ese correo ya tiene cuenta. Entra con tu contraseña o recupérala.';
  }
  if (/rate limit|too many requests|over_email_send_rate_limit|429/.test(m)) {
    return 'Hiciste varios intentos seguidos. Espera un minuto y vuelve a probar.';
  }
  if (/password should be at least|weak password|password is too/.test(m)) {
    return 'La contraseña necesita al menos 8 caracteres.';
  }
  if (/network|fetch|timeout|abort/.test(m)) {
    return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No pudimos completar la operación. Inténtalo de nuevo en un momento.';
}

