// lib/aiTelemetry.ts
// ─────────────────────────────────────────────────────────
// OBSERVABILIDAD PROPIA — parte de I/O. Registra cada llamada de IA en
// la tabla ai_telemetry (Supabase): costo exacto, latencia, tokens,
// feature, turnos, contexto de decisión y (para el chat) score de
// calidad + bandera de alucinación.
//
// PRIVACIDAD POR DISEÑO: aquí NO se guarda el contenido de los mensajes
// del usuario — solo métricas, números y banderas. El `decision` jsonb
// contiene únicamente los INSUMOS que el agente tenía al decidir
// (contadores/booleans), para poder auditar "por qué respondió así".
// Nunca debe romper la app: todo va en try/catch y en segundo plano.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';

export type AiCallLog = {
  feature: string;
  model: string | null;
  ok: boolean;
  error?: string | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  turnCount?: number | null;
  conversationId?: string | null;
  decision?: Record<string, unknown> | null;
};

/** Inserta el registro y devuelve su id (para adjuntar el score después). */
export async function logAiCall(log: AiCallLog): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return null;

    const { data, error } = await supabase
      .from('ai_telemetry')
      .insert({
        user_id: uid,
        feature: log.feature,
        model: log.model,
        ok: log.ok,
        error: log.error ? String(log.error).slice(0, 300) : null,
        latency_ms: Math.round(log.latencyMs),
        prompt_tokens: log.promptTokens ?? null,
        completion_tokens: log.completionTokens ?? null,
        cost_usd: log.costUsd ?? null,
        turn_count: log.turnCount ?? null,
        conversation_id: log.conversationId ?? null,
        decision: log.decision ?? null,
      })
      .select('id')
      .single();
    if (error) return null;
    return (data as any)?.id ?? null;
  } catch {
    return null;
  }
}

/** Adjunta el score de calidad y las señales conversacionales a un registro. */
export async function attachScore(
  id: string,
  s: { score: number; hallucination: boolean; reason: string },
  signals?: Record<string, unknown> | null
): Promise<void> {
  try {
    await supabase
      .from('ai_telemetry')
      .update({
        score: Math.max(0, Math.min(100, Math.round(s.score))),
        hallucination: s.hallucination,
        score_reason: s.reason.slice(0, 300),
        ...(signals ? { signals } : {}),
      })
      .eq('id', id);
  } catch {}
}

export type UserTraits = {
  user_id: string;
  first_seen: string;
  sessions_7d: number;
  avg_session_min_30d: number | null;
  workouts_7d: number;
  workouts_30d: number;
  habit_hour: number | null;
  habit_dow: number | null;
  food_days_7d: number;
  coach_msgs_7d: number;
  paywall_views_30d: number;
  workouts_abandoned_30d: number;
  last_workout_at: string | null;
  days_since_last_workout: number | null;
  churn_risk: 'nuevo' | 'bajo' | 'medio' | 'alto';
  engagement_score: number;
};

/** Rasgos calculados del usuario (feature store v_user_traits). */
export async function fetchUserTraits(): Promise<UserTraits | null> {
  try {
    const { data, error } = await supabase.from('v_user_traits').select('*').maybeSingle();
    if (error) return null;
    return (data as UserTraits) ?? null;
  } catch {
    return null;
  }
}

/** Últimas filas del usuario para el dashboard (más recientes primero). */
export async function fetchTelemetry(limit = 300) {
  const { data, error } = await supabase
    .from('ai_telemetry')
    .select('ts, feature, model, ok, latency_ms, prompt_tokens, completion_tokens, cost_usd, turn_count, conversation_id, decision, signals, score, hallucination, score_reason, error')
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
