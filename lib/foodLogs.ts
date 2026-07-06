// lib/foodLogs.ts
// ─────────────────────────────────────────────────────────
// Carga los registros de comida del DÍA ACTUAL desde Supabase.
// Resuelve dos bugs: (1) los totales arrancaban en 0 en cada apertura
// porque nunca se recargaban, y (2) no había "rollover" de día.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import type { FoodLog } from './supabase';

/** Fecha local en formato YYYY-MM-DD. */
export function localDateKey(d = new Date()): string {
  // Usa la fecha local del dispositivo (no UTC) para que el "día" coincida
  // con lo que ve el usuario.
  const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().split('T')[0];
}

/** Inicio del día local en ISO, para filtrar en la consulta. */
function startOfTodayISO(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Trae los food_logs registrados hoy. Devuelve [] si no hay o si falla
 * (no rompe la UI).
 */
export async function fetchTodayFoodLogs(userId: string): Promise<FoodLog[]> {
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', startOfTodayISO())
    .order('logged_at', { ascending: true });

  if (error) {
    console.log('[foodLogs] Error cargando:', error.message);
    return [];
  }
  return (data ?? []) as FoodLog[];
}
