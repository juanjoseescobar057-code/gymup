// __tests__/aiMetrics.test.ts
// node --import tsx --test __tests__/aiMetrics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCostUsd, summarize, rowsWithinHours,
  computeContextPressure, turnBuckets, groupConversations,
  type TelemetryRow,
} from '../lib/aiMetrics';

test('computeCostUsd: gpt-4o exacto', () => {
  // 1000 in × $2.5/M + 500 out × $10/M = 0.0025 + 0.005 = 0.0075
  assert.equal(computeCostUsd('gpt-4o', 1000, 500), 0.0075);
});

test('computeCostUsd: versión con fecha usa el prefijo', () => {
  assert.equal(computeCostUsd('gpt-4o-2024-08-06', 1000, 500), 0.0075);
});

test('computeCostUsd: mini NO cae en tarifa de gpt-4o (match más largo)', () => {
  // 1M in × 0.15 + 1M out × 0.6 = 0.75
  assert.equal(computeCostUsd('gpt-4o-mini', 1_000_000, 1_000_000), 0.75);
});

test('computeCostUsd: modelo desconocido o nulo → null', () => {
  assert.equal(computeCostUsd('claude-3', 100, 100), null);
  assert.equal(computeCostUsd(null, 100, 100), null);
});

test('computeCostUsd: tokens nulos cuentan como 0', () => {
  assert.equal(computeCostUsd('gpt-4o', null, null), 0);
});

function row(over: Partial<TelemetryRow>): TelemetryRow {
  return {
    ts: '2026-07-04T10:00:00Z', feature: 'coach_chat', model: 'gpt-4o', ok: true,
    latency_ms: 1000, prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.001,
    turn_count: 1, score: null, hallucination: null, score_reason: null, error: null,
    ...over,
  };
}

test('summarize: totales, errores y costo', () => {
  const s = summarize([
    row({ cost_usd: 0.002, latency_ms: 500 }),
    row({ ok: false, error: 'timeout', cost_usd: null, latency_ms: 3000 }),
    row({ feature: 'food_scan', cost_usd: 0.004, latency_ms: 1000 }),
  ]);
  assert.equal(s.calls, 3);
  assert.equal(s.errors, 1);
  assert.ok(Math.abs(s.errorRate - 1 / 3) < 1e-9);
  assert.equal(s.costUsd, 0.006);
  assert.equal(s.avgLatencyMs, 1500);
  assert.equal(s.byFeature[0].feature, 'food_scan'); // mayor costo primero
});

test('summarize: score promedio solo de filas puntuadas + alucinaciones', () => {
  const s = summarize([
    row({ score: 90, hallucination: false }),
    row({ score: 70, hallucination: true }),
    row({}), // sin score
  ]);
  assert.equal(s.avgScore, 80);
  assert.equal(s.scored, 2);
  assert.equal(s.hallucinations, 1);
});

test('summarize: vacío no divide por cero', () => {
  const s = summarize([]);
  assert.equal(s.calls, 0);
  assert.equal(s.errorRate, 0);
  assert.equal(s.avgLatencyMs, null);
  assert.equal(s.avgScore, null);
});

test('rowsWithinHours: filtra por ventana', () => {
  const now = new Date('2026-07-04T12:00:00Z').getTime();
  const rows = [
    row({ ts: '2026-07-04T11:30:00Z' }), // hace 30 min
    row({ ts: '2026-07-03T11:00:00Z' }), // hace 25 h
  ];
  assert.equal(rowsWithinHours(rows, 24, now).length, 1);
  assert.equal(rowsWithinHours(rows, 48, now).length, 2);
});

test('computeContextPressure: conversación fresca es baja, larga y dispersa es alta', () => {
  const fresh = computeContextPressure({ userTurns: 1, memoryFacts: 2, fichaChars: 1200, topicChanges: 0, activeIntents: 1 });
  assert.ok(fresh < 25, `fresh=${fresh}`);
  const heavy = computeContextPressure({ userTurns: 15, memoryFacts: 20, fichaChars: 4000, topicChanges: 4, activeIntents: 3 });
  assert.ok(heavy >= 70, `heavy=${heavy}`);
  // Siempre clampeada a 0-100
  const max = computeContextPressure({ userTurns: 99, memoryFacts: 99, fichaChars: 99999, topicChanges: 99, activeIntents: 99 });
  assert.ok(max <= 100);
});

test('turnBuckets: degradación por tramo de turnos', () => {
  const rows = [
    row({ turn_count: 2, score: 90, hallucination: false }),
    row({ turn_count: 4, score: 80, hallucination: false }),
    row({ turn_count: 12, score: 60, hallucination: true }),
    row({ turn_count: 13, score: 50, hallucination: true }),
    row({ feature: 'food_scan', turn_count: 3, score: 95 }), // no es chat: fuera
  ];
  const buckets = turnBuckets(rows);
  const b1 = buckets.find((b) => b.bucket === '1-5')!;
  const b3 = buckets.find((b) => b.bucket === '11-15')!;
  assert.equal(b1.calls, 2);
  assert.equal(b1.avgScore, 85);
  assert.equal(b1.hallucRate, 0);
  assert.equal(b3.hallucRate, 1);
  assert.equal(buckets.find((b) => b.bucket === '21+'), undefined); // vacío no aparece
});

test('groupConversations: ficha técnica con costo total y señales', () => {
  const rows = [
    row({ conversation_id: 'c1', ts: '2026-07-04T10:00:00Z', turn_count: 1, score: 90, cost_usd: 0.002, decision: { context_pressure: 20 }, signals: { intent: 'nutricion', topic_change: false, sentiment: 'neutral' } }),
    row({ conversation_id: 'c1', ts: '2026-07-04T10:08:00Z', turn_count: 2, score: 70, cost_usd: 0.003, hallucination: true, decision: { context_pressure: 45 }, signals: { intent: 'ajustar_plan', topic_change: true, sentiment: 'frustrado', recovery_distance: 5 } }),
    // Llamada auxiliar (juez) de la misma conversación: suma al costo, no a turnos
    row({ conversation_id: 'c1', ts: '2026-07-04T10:08:30Z', feature: 'scoring', cost_usd: 0.0002, score: null }),
    row({ conversation_id: null as any, ts: '2026-07-04T09:00:00Z' }), // sin conversación: fuera
  ];
  const cards = groupConversations(rows);
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c.userTurns, 2);
  assert.equal(c.auxCalls, 1);
  assert.equal(c.costUsd, 0.0052);
  assert.equal(c.durationMin, 9); // 10:00 → 10:08:30 ≈ 9 min redondeado
  assert.equal(c.avgScore, 80);
  assert.equal(c.hallucinations, 1);
  assert.equal(c.topicChanges, 1);
  assert.equal(c.maxPressure, 45);
  assert.equal(c.maxRecovery, 5);
  assert.equal(c.lastSentiment, 'frustrado');
  assert.deepEqual(c.intents, ['nutricion', 'ajustar_plan']);
});
