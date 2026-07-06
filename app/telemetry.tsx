// app/telemetry.tsx
// ─────────────────────────────────────────────────────────
// DASHBOARD DE OBSERVABILIDAD PROPIA (sin herramientas de terceros).
// Muestra, por periodo: costo exacto en USD, llamadas, latencia media y
// p95, tasa de error, tokens, score medio de calidad, alucinaciones,
// costo por feature y el detalle de los últimos mensajes evaluados con
// los insumos de decisión del agente.
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { fetchTelemetry, fetchUserTraits, type UserTraits } from '../lib/aiTelemetry';
import {
  summarize, rowsWithinHours, turnBuckets, groupConversations, type TelemetryRow,
} from '../lib/aiMetrics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

const SENTIMENT_EMOJI: Record<string, string> = {
  positivo: '😊', neutral: '😐', frustrado: '😤',
};

const DOW_LABELS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CHURN_STYLE: Record<string, { label: string; color: string }> = {
  nuevo: { label: 'Nuevo', color: Colors.textMuted },
  bajo: { label: 'Bajo', color: Colors.accent },
  medio: { label: 'Medio', color: Colors.warning },
  alto: { label: 'Alto', color: Colors.error },
};

const FEATURE_LABELS: Record<string, string> = {
  coach_chat: '💬 Chat coach',
  scoring: '🔬 Juez de calidad',
  suggestion: '💡 Mensaje proactivo',
  plan: '📋 Plan IA',
  food_scan: '🍽️ Escáner comida',
  fridge_scan: '🧊 Escáner nevera',
  body_scan: '💪 Análisis corporal',
  coach: '📸 Coach postura',
  notification: '🔔 Notificaciones',
  general: '⚙️ General',
};

function fmtUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function scoreColor(score: number): string {
  return score >= 80 ? Colors.accent : score >= 60 ? Colors.warning : Colors.error;
}

export default function TelemetryScreen() {
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [traits, setTraits] = useState<UserTraits | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<'24h' | '7d'>('24h');

  async function load() {
    try {
      const [t, tr] = await Promise.all([fetchTelemetry(300), fetchUserTraits()]);
      setRows(t as TelemetryRow[]);
      setTraits(tr);
    } catch {
      // sin datos aún (tabla vacía o sin red): el vacío se muestra abajo
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, []);

  const windowRows = rowsWithinHours(rows, period === '24h' ? 24 : 168, Date.now());
  const s7 = summarize(windowRows);
  const scoredChats = windowRows.filter((r) => r.feature === 'coach_chat' && r.score != null);
  const buckets = turnBuckets(windowRows);
  const conversations = groupConversations(windowRows).slice(0, 6);
  // Unit economics en vivo: costo de los últimos 7 días proyectado a 30.
  const projectedMonthlyUsd =
    (summarize(rowsWithinHours(rows, 168, Date.now())).costUsd / 7) * 30;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const maxFeatureCost = Math.max(...s7.byFeature.map((f) => f.costUsd), 0.000001);

  return (
    <SafeAreaView style={st.container}>
      <View style={st.nav}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()}>
          <Text style={st.backBtnTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={st.navTitle}>🔬 TELEMETRÍA IA</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Selector de periodo */}
      <View style={st.periodRow}>
        {(['24h', '7d'] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[st.periodBtn, period === p && st.periodBtnSel]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[st.periodTxt, period === p && { color: '#0a0a0b' }]}>
              {p === '24h' ? 'Últimas 24 h' : 'Últimos 7 días'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: Spacing.lg, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {/* Feature store: cómo te ve el sistema (segmentación en vivo) */}
        {traits && (
          <>
            <Text style={st.sectionLbl}>🧬 PERFIL CONDUCTUAL (RASGOS CALCULADOS)</Text>
            <View style={st.grid}>
              {[
                { lbl: 'Engagement', val: `${traits.engagement_score}/100`, color: scoreColor(traits.engagement_score) },
                { lbl: 'Riesgo de churn', val: CHURN_STYLE[traits.churn_risk]?.label ?? traits.churn_risk, color: CHURN_STYLE[traits.churn_risk]?.color },
                {
                  lbl: 'Hábito de entreno',
                  val: traits.habit_hour != null
                    ? `${DOW_LABELS[traits.habit_dow ?? 0] || '—'} ${traits.habit_hour}h`
                    : '—',
                },
                { lbl: 'Entrenos 7d / 30d', val: `${traits.workouts_7d} / ${traits.workouts_30d}` },
                { lbl: 'Sesión media', val: traits.avg_session_min_30d != null ? `${traits.avg_session_min_30d} min` : '—' },
                {
                  lbl: 'Días sin entrenar',
                  val: traits.days_since_last_workout != null ? String(traits.days_since_last_workout) : '—',
                  warn: (traits.days_since_last_workout ?? 0) >= 4,
                },
                { lbl: 'Días con comida (7d)', val: `${traits.food_days_7d}/7` },
                { lbl: 'Abandonos entreno 30d', val: String(traits.workouts_abandoned_30d), warn: traits.workouts_abandoned_30d > 0 },
              ].map((m) => (
                <View key={m.lbl} style={st.cell}>
                  <Text style={[st.cellVal, m.warn && { color: Colors.warning }, (m as any).color ? { color: (m as any).color } : null]}>
                    {m.val}
                  </Text>
                  <Text style={st.cellLbl}>{m.lbl}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {rows.length === 0 ? (
          <View style={st.empty}>
            <Text style={{ fontSize: 34, marginBottom: 10 }}>📡</Text>
            <Text style={st.emptyTitle}>Aún no hay datos</Text>
            <Text style={st.emptySub}>
              Usa el coach, los escáneres o el plan IA y aquí verás el costo exacto, la latencia y
              la calidad de cada llamada. (Si acabas de actualizar, corre el SQL pendiente en Supabase.)
            </Text>
          </View>
        ) : (
          <>
            {/* Métricas principales */}
            <Text style={st.sectionLbl}>🤖 IA · MÉTRICAS DEL PERIODO</Text>
            <View style={st.grid}>
              {[
                { lbl: 'Costo', val: fmtUsd(s7.costUsd), accent: true },
                { lbl: 'Llamadas', val: String(s7.calls) },
                { lbl: 'Latencia media', val: s7.avgLatencyMs != null ? `${(s7.avgLatencyMs / 1000).toFixed(1)}s` : '—' },
                { lbl: 'Latencia p95', val: s7.p95LatencyMs != null ? `${(s7.p95LatencyMs / 1000).toFixed(1)}s` : '—' },
                { lbl: 'Errores', val: `${Math.round(s7.errorRate * 100)}%`, warn: s7.errorRate > 0.1 },
                { lbl: 'Tokens (in/out)', val: `${(s7.tokensIn / 1000).toFixed(1)}k/${(s7.tokensOut / 1000).toFixed(1)}k` },
                {
                  lbl: 'Score medio',
                  val: s7.avgScore != null ? `${s7.avgScore}/100` : '—',
                  color: s7.avgScore != null ? scoreColor(s7.avgScore) : undefined,
                },
                { lbl: 'Alucinaciones', val: String(s7.hallucinations), warn: s7.hallucinations > 0 },
                // Unit economics: lo que costaría este usuario en un mes al ritmo actual.
                { lbl: 'Proyección 30 días', val: fmtUsd(projectedMonthlyUsd), accent: true },
              ].map((m) => (
                <View key={m.lbl} style={st.cell}>
                  <Text
                    style={[
                      st.cellVal,
                      m.accent && { color: Colors.accent },
                      m.warn && { color: Colors.warning },
                      m.color ? { color: m.color } : null,
                    ]}
                  >
                    {m.val}
                  </Text>
                  <Text style={st.cellLbl}>{m.lbl}</Text>
                </View>
              ))}
            </View>

            {/* Costo por feature */}
            <Text style={st.sectionLbl}>COSTO POR FUNCIÓN</Text>
            <View style={st.card}>
              {s7.byFeature.map((f) => (
                <View key={f.feature} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={st.featName}>{FEATURE_LABELS[f.feature] ?? f.feature}</Text>
                    <Text style={st.featMeta}>
                      {f.calls}× · {f.avgLatencyMs != null ? `${(f.avgLatencyMs / 1000).toFixed(1)}s` : '—'} · {fmtUsd(f.costUsd)}
                    </Text>
                  </View>
                  <View style={st.barBg}>
                    <View style={[st.barFill, { width: `${Math.max(3, (f.costUsd / maxFeatureCost) * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </View>

            {/* Degradación por turno: ¿el agente se degrada en conversaciones largas? */}
            {buckets.length > 0 && (
              <>
                <Text style={st.sectionLbl}>DEGRADACIÓN POR TURNO</Text>
                <View style={st.card}>
                  <View style={st.tableHead}>
                    <Text style={[st.tableCell, st.tableHeadTxt, { flex: 1.2 }]}>Turnos</Text>
                    <Text style={[st.tableCell, st.tableHeadTxt]}>Msgs</Text>
                    <Text style={[st.tableCell, st.tableHeadTxt]}>Score</Text>
                    <Text style={[st.tableCell, st.tableHeadTxt]}>Alucin.</Text>
                  </View>
                  {buckets.map((b) => (
                    <View key={b.bucket} style={st.tableRow}>
                      <Text style={[st.tableCell, { flex: 1.2, color: Colors.textPrimary }]}>{b.bucket}</Text>
                      <Text style={st.tableCell}>{b.calls}</Text>
                      <Text style={[st.tableCell, b.avgScore != null ? { color: scoreColor(b.avgScore) } : null]}>
                        {b.avgScore ?? '—'}
                      </Text>
                      <Text style={[st.tableCell, b.hallucRate > 0 ? { color: Colors.warning } : null]}>
                        {b.scored ? `${Math.round(b.hallucRate * 100)}%` : '—'}
                      </Text>
                    </View>
                  ))}
                  <Text style={st.tableNote}>
                    Si el score cae o las alucinaciones suben con los turnos, el agente se degrada
                    en conversaciones largas — dato, no percepción.
                  </Text>
                </View>
              </>
            )}

            {/* Ficha técnica por conversación */}
            {conversations.length > 0 && (
              <>
                <Text style={st.sectionLbl}>CONVERSACIONES · FICHA TÉCNICA</Text>
                {conversations.map((c) => (
                  <View key={c.conversationId} style={st.card}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={st.convTitle}>
                        {new Date(c.startTs).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}{' '}
                        {new Date(c.startTs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                        {'  '}{c.lastSentiment ? SENTIMENT_EMOJI[c.lastSentiment] ?? '' : ''}
                      </Text>
                      {c.avgScore != null && (
                        <View style={[st.scorePill, { width: 38, height: 30, backgroundColor: scoreColor(c.avgScore) + '22' }]}>
                          <Text style={[st.scorePillTxt, { fontSize: 14, color: scoreColor(c.avgScore) }]}>{c.avgScore}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={st.convMeta}>
                      {c.userTurns} turno{c.userTurns === 1 ? '' : 's'} cliente · {c.agentTurns} agente · {c.auxCalls} aux ·{' '}
                      {c.durationMin} min · {fmtUsd(c.costUsd)}
                    </Text>
                    <Text style={st.convMeta}>
                      Cambios de tema: {c.topicChanges} · Presión máx: {c.maxPressure ?? '—'}/100
                      {c.maxRecovery != null ? ` · Recuperó intención a ${c.maxRecovery} turnos` : ''}
                      {c.hallucinations > 0 ? `  🚨 ${c.hallucinations} alucinación(es)` : ''}
                    </Text>
                    {c.intents.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {c.intents.map((it) => (
                          <View key={it} style={st.intentChip}>
                            <Text style={st.intentChipTxt}>{it.replace(/_/g, ' ')}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}

            {/* Mensajes evaluados */}
            <Text style={st.sectionLbl}>CALIDAD DEL COACH · ÚLTIMOS MENSAJES</Text>
            {scoredChats.length === 0 ? (
              <View style={st.card}>
                <Text style={st.emptySub}>
                  Chatea con tu coach y cada respuesta será evaluada por el juez de calidad
                  (score, fidelidad a tus datos y seguridad).
                </Text>
              </View>
            ) : (
              scoredChats.slice(0, 12).map((r, i) => (
                <View key={i} style={st.msgRow}>
                  <View style={[st.scorePill, { backgroundColor: scoreColor(r.score!) + '22' }]}>
                    <Text style={[st.scorePillTxt, { color: scoreColor(r.score!) }]}>{r.score}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.msgReason}>{r.score_reason || 'Sin detalle'}</Text>
                    <Text style={st.msgMeta}>
                      Turno {r.turn_count ?? '?'} · {(r.latency_ms != null ? (r.latency_ms / 1000).toFixed(1) : '?')}s ·{' '}
                      {new Date(r.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      {r.hallucination ? '  🚨 alucinación' : ''}
                    </Text>
                  </View>
                </View>
              ))
            )}

            <Text style={st.privacyNote}>
              🔒 Observabilidad construida en casa: se registran métricas, señales derivadas
              (intención, sentimiento, presión de contexto) y el porqué de cada decisión —
              nunca el texto de tus mensajes.
            </Text>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.lg, marginBottom: 4 },
  periodBtn: { flex: 1, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard, paddingVertical: 8, alignItems: 'center' },
  periodBtnSel: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  periodTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  cell: { width: '48.5%', backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, alignItems: 'center' },
  cellVal: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.textPrimary },
  cellLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 16 },
  featName: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary },
  featMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  barBg: { height: 5, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 10 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 8 },
  scorePill: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scorePillTxt: { fontFamily: Fonts.headingBold, fontSize: 18 },
  msgReason: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  msgMeta: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 6, marginBottom: 4 },
  tableHeadTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 5 },
  tableCell: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textSecondary },
  tableNote: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 8, lineHeight: 15 },
  convTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.textPrimary },
  convMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 3, lineHeight: 16 },
  intentChip: { backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3 },
  intentChipTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: Spacing.lg },
  emptyTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary, marginBottom: 6 },
  emptySub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
  privacyNote: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 15 },
});
