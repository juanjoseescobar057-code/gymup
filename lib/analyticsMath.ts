// lib/analyticsMath.ts
// ─────────────────────────────────────────────────────────
// Lógica PURA del sistema de analítica conductual (testeable sin RN).
// ─────────────────────────────────────────────────────────

/** Gap de inactividad que corta una sesión (estándar de la industria: 30 min). */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** ¿Toca abrir una sesión nueva? */
export function shouldRotateSession(
  lastActiveAt: number | null,
  now: number,
  gapMs: number = SESSION_GAP_MS
): boolean {
  if (lastActiveAt == null) return true;
  return now - lastActiveAt > gapMs;
}

/** Id legible y ordenable en el tiempo (Hermes no trae crypto.randomUUID). */
export function makeId(prefix: string, now: number, rand: string): string {
  return `${prefix}_${now.toString(36)}_${rand}`;
}

/** Extrae los parámetros de adquisición de los query params de un deep link. */
export function pickAcquisitionParams(
  params: Record<string, unknown> | null | undefined
): Record<string, string> {
  const KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'ttclid', 'ref', 'referral', 'campaign',
  ];
  const out: Record<string, string> = {};
  if (!params) return out;
  for (const k of KEYS) {
    const v = params[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) out[k] = v;
  }
  return out;
}
