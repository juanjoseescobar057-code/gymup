// lib/diaDeHoy.ts
// ─────────────────────────────────────────────────────────
// El puente entre lib/planCalendario.ts (puro) y las pantallas.
//
// Existe para que la respuesta a "¿qué día del plan toca hoy?" se calcule en
// UN solo sitio. Antes cada pantalla hacía por su cuenta:
//
//     const todayIndex = Math.min(profile?.current_plan_day ?? 0, 6);
//
// repetido en app/(tabs)/index.tsx, app/(tabs)/coach.tsx,
// app/workout-session.tsx y lib/coachContext.ts. Cuatro copias de la misma
// decisión es cómo se acaba con la portada diciendo una cosa y el coach otra.
//
// La consulta del último entrenamiento se cachea unos segundos porque las
// cuatro pantallas la piden casi a la vez al abrir la app, y es la misma
// respuesta.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { estadoDelDia, type EstadoDelDia, type TipoDeDia } from './planCalendario';

export type { EstadoDelDia } from './planCalendario';

type PlanDia = { type?: string | null };

/** Fecha local en formato ISO corto, para no depender de la zona del servidor. */
export function hoyISO(ahora: Date = new Date()): string {
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let cache: { userId: string; valor: string | null; expira: number } | null = null;
const CACHE_MS = 15_000;

/** Fecha del último entrenamiento COMPLETADO. null si nunca entrenó. */
export async function ultimoEntreno(userId: string): Promise<string | null> {
  if (cache && cache.userId === userId && Date.now() < cache.expira) return cache.valor;

  const { data, error } = await supabase
    .from('workout_sessions')
    .select('completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);

  if (error) {
    // Sin este dato el plan no puede avanzar por calendario. Se devuelve null,
    // que hace caer en el comportamiento anterior (respetar current_plan_day):
    // peor, pero nunca inventa un día que no toca.
    console.log('[diaDeHoy] último entreno:', error.message);
    return null;
  }

  const valor = data?.[0]?.completed_at ?? null;
  cache = { userId, valor, expira: Date.now() + CACHE_MS };
  return valor;
}

/** Invalida la caché. Hay que llamarlo al terminar un entrenamiento. */
export function olvidarUltimoEntreno(): void {
  cache = null;
}

/** Normaliza los días del plan a 'workout' | 'rest'. */
export function tiposDeDia(dias: PlanDia[] | null | undefined): TipoDeDia[] {
  return (dias ?? []).map((d) => (d?.type === 'rest' ? 'rest' : 'workout'));
}

/**
 * Qué toca hoy, resuelto. Es lo único que deberían llamar las pantallas.
 */
export async function calcularDiaDeHoy(args: {
  userId: string;
  currentPlanDay: number | null | undefined;
  dias: PlanDia[] | null | undefined;
  ahora?: Date;
}): Promise<EstadoDelDia> {
  const ultimo = await ultimoEntreno(args.userId);
  return estadoDelDia({
    hoyISO: hoyISO(args.ahora),
    ultimoEntrenoISO: ultimo,
    diaGuardado: args.currentPlanDay ?? 0,
    dias: tiposDeDia(args.dias),
  });
}
