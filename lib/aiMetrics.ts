// lib/aiMetrics.ts
// ─────────────────────────────────────────────────────────
// OBSERVABILIDAD PROPIA (sin herramientas de terceros) — parte PURA.
// Precios por modelo, cálculo de costo exacto por llamada y agregación
// de métricas para el dashboard. Sin imports de RN/Supabase → testeable
// con node --test.
// ─────────────────────────────────────────────────────────

// Precio USD por 1M de tokens (actualizar aquí si OpenAI cambia tarifas).
export const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'gpt-4o': { inPerM: 2.5, outPerM: 10 },
  'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.6 },
};

/** Costo exacto en USD de una llamada según tokens reales. null si el modelo no está tarifado. */
export function computeCostUsd(
  model: string | null | undefined,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined
): number | null {
  if (!model) return null;
  // "gpt-4o-2024-08-06" → tarifa de "gpt-4o"; el match más LARGO gana
  // (para que gpt-4o-mini no caiga en la tarifa de gpt-4o).
  const key = Object.keys(MODEL_PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const p = MODEL_PRICING[key];
  const inTok = promptTokens ?? 0;
  const outTok = completionTokens ?? 0;
  const usd = (inTok * p.inPerM + outTok * p.outPerM) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000; // 6 decimales
}

// ── Agregación para el dashboard ─────────────────────────
export type TelemetryRow = {
  ts: string;
  feature: string;
  model: string | null;
  ok: boolean;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  turn_count: number | null;
  conversation_id?: string | null;
  decision?: Record<string, any> | null;
  signals?: Record<string, any> | null;
  score: number | null;
  hallucination: boolean | null;
  score_reason: string | null;
  error: string | null;
};

export type TelemetrySummary = {
  calls: number;
  errors: number;
  errorRate: number;        // 0..1
  costUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgScore: number | null;  // solo mensajes puntuados
  scored: number;
  hallucinations: number;
  tokensIn: number;
  tokensOut: number;
  byFeature: { feature: string; calls: number; costUsd: number; avgLatencyMs: number | null }[];
};

export function summarize(rows: TelemetryRow[]): TelemetrySummary {
  const calls = rows.length;
  const errors = rows.filter((r) => !r.ok).length;
  const costUsd = Math.round(rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0) * 1_000_000) / 1_000_000;
  const lats = rows.map((r) => r.latency_ms).filter((x): x is number => x != null && x >= 0).sort((a, b) => a - b);
  const avgLatencyMs = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  const p95LatencyMs = lats.length ? lats[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))] : null;
  const scoredRows = rows.filter((r) => r.score != null);
  const avgScore = scoredRows.length
    ? Math.round(scoredRows.reduce((a, r) => a + (r.score ?? 0), 0) / scoredRows.length)
    : null;
  const hallucinations = rows.filter((r) => r.hallucination === true).length;
  const tokensIn = rows.reduce((a, r) => a + (r.prompt_tokens ?? 0), 0);
  const tokensOut = rows.reduce((a, r) => a + (r.completion_tokens ?? 0), 0);

  const byMap = new Map<string, { calls: number; costUsd: number; lats: number[] }>();
  for (const r of rows) {
    const b = byMap.get(r.feature) ?? { calls: 0, costUsd: 0, lats: [] };
    b.calls += 1;
    b.costUsd += r.cost_usd ?? 0;
    if (r.latency_ms != null) b.lats.push(r.latency_ms);
    byMap.set(r.feature, b);
  }
  const byFeature = [...byMap.entries()]
    .map(([feature, b]) => ({
      feature,
      calls: b.calls,
      costUsd: Math.round(b.costUsd * 1_000_000) / 1_000_000,
      avgLatencyMs: b.lats.length ? Math.round(b.lats.reduce((x, y) => x + y, 0) / b.lats.length) : null,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    calls, errors, errorRate: calls ? errors / calls : 0, costUsd,
    avgLatencyMs, p95LatencyMs, avgScore, scored: scoredRows.length,
    hallucinations, tokensIn, tokensOut, byFeature,
  };
}

/** Filtra filas dentro de las últimas `hours` horas respecto a `now`. */
export function rowsWithinHours(rows: TelemetryRow[], hours: number, now: number): TelemetryRow[] {
  const cutoff = now - hours * 3_600_000;
  return rows.filter((r) => new Date(r.ts).getTime() >= cutoff);
}

// ── MÉTRICAS CONVERSACIONALES ────────────────────────────
// La conversación es la unidad de análisis: turnos, cambios de tema,
// presión de contexto y degradación por turno.

/**
 * "Context Pressure" 0-100: cuánta carga acumula la conversación.
 * Sube con los turnos, la memoria, el tamaño de la ficha, los cambios de
 * tema y las intenciones abiertas. Por encima de ~70 conviene compactar
 * (destilar memoria / resumir) — el agente empieza a degradarse.
 */
export function computeContextPressure(args: {
  userTurns: number;
  memoryFacts: number;
  fichaChars: number;
  topicChanges: number;
  activeIntents: number;
}): number {
  const turns = Math.min(40, args.userTurns * 3);          // 13+ turnos ≈ tope 40
  const memory = Math.min(15, args.memoryFacts * 1.5);
  const ficha = Math.min(15, args.fichaChars / 200);        // ~3000 chars ≈ 15
  const topics = Math.min(20, args.topicChanges * 6);
  const intents = Math.min(10, args.activeIntents * 5);
  return Math.max(0, Math.min(100, Math.round(turns + memory + ficha + topics + intents)));
}

export type TurnBucket = {
  bucket: string;        // "1-5", "6-10", ...
  calls: number;
  scored: number;
  avgScore: number | null;
  hallucRate: number;    // 0..1 sobre las puntuadas
};

/** Degradación por turno: score y alucinaciones por tramo de conversación. */
export function turnBuckets(rows: TelemetryRow[]): TurnBucket[] {
  const defs = [
    { bucket: '1-5', lo: 1, hi: 5 },
    { bucket: '6-10', lo: 6, hi: 10 },
    { bucket: '11-15', lo: 11, hi: 15 },
    { bucket: '16-20', lo: 16, hi: 20 },
    { bucket: '21+', lo: 21, hi: Infinity },
  ];
  const chat = rows.filter((r) => r.feature === 'coach_chat' && r.turn_count != null);
  return defs
    .map(({ bucket, lo, hi }) => {
      const inB = chat.filter((r) => (r.turn_count as number) >= lo && (r.turn_count as number) <= hi);
      const scored = inB.filter((r) => r.score != null);
      const halluc = scored.filter((r) => r.hallucination === true).length;
      return {
        bucket,
        calls: inB.length,
        scored: scored.length,
        avgScore: scored.length
          ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length)
          : null,
        hallucRate: scored.length ? halluc / scored.length : 0,
      };
    })
    .filter((b) => b.calls > 0);
}

export type ConversationCard = {
  conversationId: string;
  startTs: string;
  endTs: string;
  durationMin: number;
  userTurns: number;       // en el chat alternado, turnos del cliente
  agentTurns: number;      // respuestas exitosas del agente
  auxCalls: number;        // juez de calidad + destilados de memoria
  costUsd: number;         // costo TOTAL (chat + auxiliares)
  avgScore: number | null;
  hallucinations: number;
  topicChanges: number;
  maxPressure: number | null;
  maxRecovery: number | null;  // máxima distancia de recuperación de intención
  lastSentiment: string | null;
  intents: string[];
};

/** Ficha técnica por conversación, agrupando TODAS sus llamadas (chat + auxiliares). */
export function groupConversations(rows: TelemetryRow[]): ConversationCard[] {
  const byConv = new Map<string, TelemetryRow[]>();
  for (const r of rows) {
    if (!r.conversation_id) continue;
    const arr = byConv.get(r.conversation_id) ?? [];
    arr.push(r);
    byConv.set(r.conversation_id, arr);
  }

  const cards: ConversationCard[] = [];
  for (const [conversationId, all] of byConv.entries()) {
    const sorted = all.slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const chat = sorted.filter((r) => r.feature === 'coach_chat');
    if (chat.length === 0) continue;
    const scored = chat.filter((r) => r.score != null);
    const startTs = sorted[0].ts;
    const endTs = sorted[sorted.length - 1].ts;
    const pressures = chat
      .map((r) => r.decision?.context_pressure)
      .filter((x): x is number => typeof x === 'number');
    const recoveries = chat
      .map((r) => r.signals?.recovery_distance)
      .filter((x): x is number => typeof x === 'number');
    const sentiments = chat
      .map((r) => r.signals?.sentiment)
      .filter((x): x is string => typeof x === 'string');
    const intents = [...new Set(
      chat.map((r) => r.signals?.intent).filter((x): x is string => typeof x === 'string' && !!x)
    )];

    cards.push({
      conversationId,
      startTs,
      endTs,
      durationMin: Math.max(0, Math.round((new Date(endTs).getTime() - new Date(startTs).getTime()) / 60_000)),
      userTurns: chat.length,
      agentTurns: chat.filter((r) => r.ok).length,
      auxCalls: sorted.length - chat.length,
      costUsd: Math.round(sorted.reduce((a, r) => a + (r.cost_usd ?? 0), 0) * 1_000_000) / 1_000_000,
      avgScore: scored.length
        ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length)
        : null,
      hallucinations: chat.filter((r) => r.hallucination === true).length,
      topicChanges: chat.filter((r) => r.signals?.topic_change === true).length,
      maxPressure: pressures.length ? Math.max(...pressures) : null,
      maxRecovery: recoveries.length ? Math.max(...recoveries) : null,
      lastSentiment: sentiments.length ? sentiments[sentiments.length - 1] : null,
      intents: intents.slice(0, 5),
    });
  }
  return cards.sort((a, b) => b.endTs.localeCompare(a.endTs));
}
