// lib/health.ts
// ─────────────────────────────────────────────────────────
// I/O del perfil de salud (Supabase). La lógica pura (riesgo, directivas)
// vive en healthMath.ts.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { computeRisk, highRiskKeys, EMPTY_HEALTH, type HealthProfile } from './healthMath';

// Caché local de último-contexto-bueno: si la red falla, el coach usa el
// perfil de salud de la última carga exitosa en vez de quedarse ciego.
// Guarda cleared_at (para re-evaluar la vigencia de la autorización con el
// reloj local) y cachedAt (TTL: una caché eterna también es un riesgo).
const HEALTH_CACHE_KEY = (uid: string) => `gymup_health_cache_${uid}`;
const HEALTH_CACHE_TTL_MS = 7 * 86_400_000; // 7 días sin confirmar → 'unknown'

async function cacheHealth(
  userId: string,
  h: HealthProfile | null,
  clearedAt: string | null
): Promise<void> {
  try {
    if (h) {
      await AsyncStorage.setItem(
        HEALTH_CACHE_KEY(userId),
        JSON.stringify({ h, cleared_at: clearedAt, cachedAt: Date.now() })
      );
    } else {
      await AsyncStorage.removeItem(HEALTH_CACHE_KEY(userId));
    }
  } catch {}
}

async function cachedHealth(userId: string): Promise<HealthProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_CACHE_KEY(userId));
    if (!raw) return null;
    const c = JSON.parse(raw);
    const p = c?.h ?? c; // tolera formato viejo (perfil plano)
    if (typeof c?.cachedAt === 'number' && Date.now() - c.cachedAt > HEALTH_CACHE_TTL_MS) {
      return null; // caché vencida: mejor 'unknown' que datos viejos como verdad
    }
    const h: HealthProfile = {
      ...EMPTY_HEALTH,
      ...p,
      conditions: Array.isArray(p?.conditions) ? p.conditions : [],
      injuries: Array.isArray(p?.injuries) ? p.injuries : [],
    };
    // La vigencia de la autorización médica se re-evalúa TAMBIÉN desde caché.
    if (h.doctor_cleared && clearanceExpired(h, c?.cleared_at ?? null)) {
      h.doctor_cleared = false;
    }
    return h;
  } catch {
    return null;
  }
}

/** ¿Hay sesión válida DE ESTE usuario? (una sesión degradada + RLS devuelve
 *  0 filas sin error — indistinguible de "sin tamizaje" si no se verifica). */
async function sessionValidFor(userId: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session && session.user.id === userId;
  } catch {
    return false;
  }
}

/**
 * Carga FAIL-CLOSED del perfil de salud. Distingue tres situaciones:
 *   { status: 'ok', profile }        → cargó de la red (profile null = nunca hizo tamizaje)
 *   { status: 'cached', profile }    → red falló, usando el último contexto bueno local
 *   { status: 'unknown' }            → red falló Y no hay caché: NO asumir que está sano
 * Los consumidores críticos (coach, plan adaptativo, postura) deben tratar
 * 'unknown' con la HEALTH_UNKNOWN_DIRECTIVE o abortar. NUNCA como "sano".
 */
export type HealthLoad =
  | { status: 'ok' | 'cached'; profile: HealthProfile | null }
  | { status: 'unknown' };

export async function loadHealthSafe(userId: string): Promise<HealthLoad> {
  try {
    const { data, error } = await supabase
      .from('health_profile')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      // data:null puede ser "sin tamizaje" REAL... o una sesión degradada
      // (JWT vencido → RLS filtra la fila SIN error). Verificar antes de creer.
      if (!(await sessionValidFor(userId))) throw new Error('sesión no válida');
      // Un perfil de salud no desaparece legítimamente: si la caché local
      // recuerda uno, el null del servidor es sospechoso → usar la caché.
      const cached = await cachedHealth(userId);
      if (cached) return { status: 'cached', profile: cached };
      return { status: 'ok', profile: null };
    }
    const h = rowToProfile(data);
    cacheHealth(userId, h, data.cleared_at ?? null);
    return { status: 'ok', profile: h };
  } catch {
    const cached = await cachedHealth(userId);
    if (cached) return { status: 'cached', profile: cached };
    return { status: 'unknown' };
  }
}

function rowToProfile(data: any): HealthProfile {
  const h: HealthProfile = {
    parq_chest_pain: !!data.parq_chest_pain,
    parq_dizziness: !!data.parq_dizziness,
    parq_doctor_restricted: !!data.parq_doctor_restricted,
    conditions: Array.isArray(data.conditions) ? data.conditions : [],
    injuries: Array.isArray(data.injuries) ? data.injuries : [],
    other_note: data.other_note ?? null,
    doctor_cleared: !!data.doctor_cleared,
  };
  if (h.doctor_cleared && clearanceExpired(h, data.cleared_at ?? null)) {
    h.doctor_cleared = false;
  }
  return h;
}

// Vigencia de la autorización médica: 12 meses en general; 3 meses cuando
// el riesgo alto incluye embarazo o cirugía reciente (situaciones que evolucionan).
const CLEARANCE_MONTHS_DEFAULT = 12;
const CLEARANCE_MONTHS_SHORT = 3;

function clearanceExpired(h: HealthProfile, clearedAt: string | null): boolean {
  if (!clearedAt) return false; // registros previos sin fecha: no invalidar retroactivamente
  const keys = highRiskKeys(h);
  const months = keys.includes('embarazo') || keys.includes('cirugia_reciente')
    ? CLEARANCE_MONTHS_SHORT
    : CLEARANCE_MONTHS_DEFAULT;
  return Date.now() - new Date(clearedAt).getTime() > months * 30 * 86_400_000;
}

/**
 * Carga simple (compatibilidad): null = sin tamizaje O error irrecuperable.
 * ⚠️ Para consumidores CRÍTICOS de seguridad usar loadHealthSafe (distingue
 * "sin tamizaje" de "no se pudo verificar"). Esta versión al menos cae a la
 * caché local antes de rendirse.
 */
export async function loadHealthProfile(userId: string): Promise<HealthProfile | null> {
  const load = await loadHealthSafe(userId);
  return load.status === 'unknown' ? null : load.profile;
}

/**
 * Guarda (upsert) el perfil de salud, calculando y persistiendo el riesgo.
 * SEGURIDAD: si aparecen razones de riesgo alto NUEVAS respecto a lo ya
 * guardado, la autorización médica anterior queda invalidada — el médico
 * autorizó otra situación, no esta.
 */
export async function saveHealthProfile(
  userId: string,
  h: HealthProfile,
  age: number
): Promise<{ ok: boolean; error?: string }> {
  let doctorCleared = h.doctor_cleared;
  let clearedAt: string | null = null;

  try {
    const { data: prev } = await supabase
      .from('health_profile')
      .select('doctor_cleared, cleared_at, parq_chest_pain, parq_dizziness, parq_doctor_restricted, conditions')
      .eq('user_id', userId)
      .maybeSingle();

    if (prev && doctorCleared) {
      const prevProfile: HealthProfile = {
        ...EMPTY_HEALTH,
        parq_chest_pain: !!prev.parq_chest_pain,
        parq_dizziness: !!prev.parq_dizziness,
        parq_doctor_restricted: !!prev.parq_doctor_restricted,
        conditions: Array.isArray(prev.conditions) ? prev.conditions : [],
      };
      const prevKeys = new Set(highRiskKeys(prevProfile));
      const newKeys = highRiskKeys(h);
      const hasNewHighRisk = newKeys.some((k) => !prevKeys.has(k));
      if (prev.doctor_cleared && hasNewHighRisk) {
        doctorCleared = false; // situación nueva: requiere re-autorización
      } else if (prev.doctor_cleared) {
        clearedAt = prev.cleared_at ?? null; // conserva la fecha original
      }
    }
  } catch {}

  if (doctorCleared && !clearedAt) clearedAt = new Date().toISOString();
  if (!doctorCleared) clearedAt = null;

  const { level } = computeRisk({ ...h, doctor_cleared: doctorCleared }, age);
  const { error } = await supabase.from('health_profile').upsert({
    user_id: userId,
    parq_chest_pain: h.parq_chest_pain,
    parq_dizziness: h.parq_dizziness,
    parq_doctor_restricted: h.parq_doctor_restricted,
    conditions: h.conditions,
    injuries: h.injuries,
    other_note: h.other_note?.trim() || null,
    doctor_cleared: doctorCleared,
    cleared_at: clearedAt,
    risk_level: level,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  // Refrescar el último-contexto-bueno local con lo recién guardado.
  cacheHealth(userId, { ...h, doctor_cleared: doctorCleared }, clearedAt);
  return { ok: true };
}

// ─── PLAN OBSOLETO RESPECTO A LA SALUD ───────────────────
// Si el usuario cambia su salud y NO re-adapta el plan, el plan viejo sigue
// guiando entrenamientos. Este flag persiste el recordatorio (un Alert
// efímero no basta) hasta que el plan se re-adapte.
const PLAN_STALE_KEY = (uid: string) => `gymup_plan_stale_health_${uid}`;

export async function markPlanStaleForHealth(userId: string): Promise<void> {
  try { await AsyncStorage.setItem(PLAN_STALE_KEY(userId), '1'); } catch {}
}
export async function clearPlanStaleForHealth(userId: string): Promise<void> {
  try { await AsyncStorage.removeItem(PLAN_STALE_KEY(userId)); } catch {}
}
export async function isPlanStaleForHealth(userId: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PLAN_STALE_KEY(userId))) === '1'; } catch { return false; }
}

export { EMPTY_HEALTH };
export type { HealthProfile };
