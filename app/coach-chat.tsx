// app/coach-chat.tsx
// ─────────────────────────────────────────────────────────
// Chat con el Coach IA que TE CONOCE: recibe tu ficha completa (plan de hoy,
// macros, racha, PRs, tendencia de peso y proyección de meta) y responde
// como un entrenador real. Free: FREE_LIMITS.coachMessagesPerDay mensajes/día
// (el servidor también lo exige vía feature 'coach_chat').
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../store/userStore';
import { fetchCoachSnapshot, snapshotHeadline, snapshotToPrompt, type CoachSnapshot } from '../lib/coachContext';
import { askCoach, quickPrompts, type ChatMessage } from '../lib/coachChat';
import { loadCoachMemory, saveCoachMemory, distillMemory } from '../lib/coachMemory';
import { scoreCoachReply } from '../lib/aiScore';
import { attachScore } from '../lib/aiTelemetry';
import { computeContextPressure } from '../lib/aiMetrics';
import { track } from '../lib/analytics';
import { canUseFeature, FREE_LIMITS } from '../lib/subscription';
import { localDateKey } from '../lib/foodLogs';
import ReportContentButton from '../Components/ReportContentButton';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

// Historial POR USUARIO: una clave global filtraba la conversación (y peor,
// la memoria destilada) de una cuenta a otra en el mismo dispositivo.
const HISTORY_KEY_BASE = 'gymup_coach_chat_v1';
const historyKeyFor = (uid: string) => `${HISTORY_KEY_BASE}_${uid}`;
const MAX_STORED = 40; // mensajes persistidos (el prompt solo usa los últimos 10)

// Id de conversación para la analítica (sin crypto: Hermes no trae randomUUID).
function newConversationId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type IntentLogEntry = { intent: string; turn: number };

export default function CoachChatScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [snapshot, setSnapshot] = useState<CoachSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState(false);
  const [used, setUsed] = useState(0);
  const [memory, setMemory] = useState<string[]>([]);
  const [memoryModal, setMemoryModal] = useState(false);
  const listRef = useRef<FlatList>(null);
  // Nº de mensajes del usuario ya destilados a memoria (evita re-destilar).
  const distilledRef = useRef(0);
  // Espejo de la memoria vigente (los closures de promesas en vuelo NO deben
  // usar estado stale) + versión para descartar destilados obsoletos si el
  // usuario borró un hecho mientras el destilado estaba en vuelo.
  const memoryRef = useRef<string[]>([]);
  const memVersionRef = useRef(0);
  function applyMemory(facts: string[]) {
    memoryRef.current = facts;
    setMemory(facts);
  }
  // ── Analítica conversacional (persistida con el historial) ──
  const conversationIdRef = useRef(newConversationId());
  const intentLogRef = useRef<IntentLogEntry[]>([]);
  const topicChangesRef = useRef(0);

  const isPremium = !!profile?.is_premium;
  const quotaKey = `gymup_coachchat_${localDateKey()}`;
  const remaining = Math.max(0, FREE_LIMITS.coachMessagesPerDay - used);

  // Cargar historial (POR USUARIO — nunca heredar el chat de otra cuenta)
  // y el cupo del día.
  useEffect(() => {
    if (!profile?.user_id) return;
    AsyncStorage.removeItem(HISTORY_KEY_BASE).catch(() => {}); // limpiar clave legacy global
    AsyncStorage.getItem(historyKeyFor(profile.user_id)).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.messages)) {
          setMessages(parsed.messages);
          // Reanudar el destilado donde quedó (cursor persistido): si el
          // último destilado de la sesión anterior falló, se reintenta aquí
          // en vez de dar esos hechos por capturados.
          const userCount = parsed.messages.filter((m: ChatMessage) => m.role === 'user').length;
          distilledRef.current = typeof parsed.distilled === 'number'
            ? Math.min(parsed.distilled, userCount)
            : userCount;
          if (typeof parsed.conversationId === 'string') conversationIdRef.current = parsed.conversationId;
          if (Array.isArray(parsed.intentLog)) intentLogRef.current = parsed.intentLog;
          if (typeof parsed.topicChanges === 'number') topicChangesRef.current = parsed.topicChanges;
        }
      } catch {}
    }).catch(() => {});
    AsyncStorage.getItem(quotaKey)
      .then((raw) => setUsed(parseInt(raw ?? '0', 10) || 0))
      .catch(() => {});
  }, [profile?.user_id]);

  // Ficha + memoria: se recargan al ENFOCAR la pantalla. Si el usuario fue a
  // Perfil → Salud y volvió, el coach ve la lesión nueva YA; y si hubo un gap
  // de contexto, recuperar la conexión lo repara al volver al chat.
  const refreshContext = useCallback(() => {
    if (!profile) return;
    const meals = (useUserStore.getState().todayFoodLogs ?? []).map((l: any) => ({
      name: l.meal_name,
      calories: l.calories,
    }));
    fetchCoachSnapshot({ profile, trainingPlan, todayTotals: getDailyTotals(), todayMeals: meals })
      .then((snap) => { setSnapshot(snap); setSnapshotError(false); })
      .catch((e) => {
        // Fail-closed pero VISIBLE y recuperable (nunca un spinner eterno mudo).
        setSnapshotError(true);
        track('coach_snapshot_failed', { msg: String(e?.message ?? '').slice(0, 80) });
      });
    loadCoachMemory(profile.user_id).then(applyMemory).catch(() => {});
  }, [profile?.user_id, trainingPlan?.id]);

  useFocusEffect(refreshContext);

  // Destilar la charla reciente a memoria de largo plazo (fire-and-forget,
  // cada 2 mensajes del usuario, o YA si la presión de contexto es alta).
  // La memoria NUNCA bloquea el chat. La ventana arranca en el ÚLTIMO mensaje
  // destilado (no es fija): tras fallos repetidos los hechos no caducan.
  function maybeDistill(history: ChatMessage[], force = false) {
    if (!profile) return;
    const userCount = history.filter((m) => m.role === 'user').length;
    if (!force && userCount - distilledRef.current < 2) return;
    if (userCount <= distilledRef.current) return; // nada nuevo que destilar
    const prev = distilledRef.current;
    distilledRef.current = userCount;
    persist(history); // persistir el avance del cursor

    // Índice del primer mensaje NO destilado (con tope de 30 msgs por costo).
    let seenUsers = 0;
    let startIdx = 0;
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'user') {
        seenUsers += 1;
        if (seenUsers === prev + 1) { startIdx = i; break; }
      }
    }
    const windowMsgs = history.slice(Math.max(startIdx, history.length - 30));

    const version = memVersionRef.current;
    distillMemory(memoryRef.current, windowMsgs, conversationIdRef.current)
      .then((facts) => {
        // Si el usuario editó su memoria mientras esto volaba, SU edición
        // manda: descartar el resultado y dejar el cursor para re-destilar.
        if (memVersionRef.current !== version) {
          distilledRef.current = prev;
          persist(history);
          return;
        }
        applyMemory(facts);
        saveCoachMemory(profile.user_id, facts);
      })
      .catch(() => {
        distilledRef.current = prev; // reintenta en el próximo turno
        persist(history);
      });
  }

  function persist(msgs: ChatMessage[]) {
    if (!profile?.user_id) return;
    AsyncStorage.setItem(
      historyKeyFor(profile.user_id),
      JSON.stringify({
        messages: msgs.slice(-MAX_STORED),
        conversationId: conversationIdRef.current,
        intentLog: intentLogRef.current.slice(-30),
        topicChanges: topicChangesRef.current,
        distilled: distilledRef.current, // cursor de destilado (reanudable)
      })
    ).catch(() => {});
  }

  // Envía el historial (que ya termina en un mensaje del usuario) al coach.
  async function deliver(history: ChatMessage[]) {
    if (!snapshot) return;
    setSending(true);
    setFailed(false);
    try {
      // ── Observabilidad propia: turnos, presión de contexto y decisión ──
      const mem = memoryRef.current; // memoria VIGENTE (no closure stale)
      const userTurn = history.filter((m) => m.role === 'user').length; // turno del cliente
      const lastUserMsg = history[history.length - 1]?.content ?? '';
      const prevUserMsg = history.filter((m) => m.role === 'user').slice(-2, -1)[0]?.content;
      const ficha = snapshotToPrompt(snapshot);
      // Intenciones "abiertas" recientes (sin resolver marcadas en el log).
      const activeIntents = new Set(intentLogRef.current.slice(-6).map((e) => e.intent)).size;
      const contextPressure = computeContextPressure({
        userTurns: userTurn,
        memoryFacts: mem.length,
        fichaChars: ficha.length,
        topicChanges: topicChangesRef.current,
        activeIntents,
      });
      // Los INSUMOS que el agente tenía al decidir (auditables, sin PII).
      const decision = {
        memory_facts: mem.length,
        quota_remaining: isPremium ? null : remaining,
        days_since_workout: snapshot.daysSinceLastWorkout,
        workouts_7d: snapshot.workoutsLast7Days,
        today_plan: snapshot.todayPlan?.type ?? 'none',
        protein_pct: Math.round((snapshot.macros.protein[0] / Math.max(1, snapshot.macros.protein[1])) * 100),
        has_goal: !!snapshot.projection?.hasGoal,
        total_workouts: snapshot.totalWorkouts,
        meals_today: snapshot.todayMeals.length,
        context_pressure: contextPressure,
        topic_changes_so_far: topicChangesRef.current,
        active_intents: activeIntents,
        // Integridad de contexto: qué faltaba al decidir (auditable).
        context_gaps: snapshot.contextGaps.length ? snapshot.contextGaps : null,
      };
      // El score necesita la respuesta, que aún no existe cuando se registra
      // la llamada: la difiere con una promesa y corre en segundo plano.
      let resolveReply: (r: string) => void = () => {};
      const replyReady = new Promise<string>((res) => { resolveReply = res; });
      const meta = {
        turnCount: userTurn,
        conversationId: conversationIdRef.current,
        decision,
        onLogged: (id: string | null) => {
          if (!id) return;
          replyReady
            .then((replyText) =>
              scoreCoachReply({
                userMessage: lastUserMsg,
                reply: replyText,
                ficha,
                memory: mem,
                prevUserMessage: prevUserMsg,
                conversationId: conversationIdRef.current,
              }).then((s) => {
                // Señales conversacionales derivadas del juez.
                if (s.topic_change) topicChangesRef.current += 1;
                // Distancia de recuperación de intención: el usuario retoma
                // una intención mencionada varios turnos atrás.
                const prevSame = [...intentLogRef.current].reverse().find((e) => e.intent === s.intent);
                const recovery =
                  prevSame && userTurn - prevSame.turn >= 2 ? userTurn - prevSame.turn : null;
                intentLogRef.current = [...intentLogRef.current, { intent: s.intent, turn: userTurn }].slice(-30);
                return attachScore(id, s, {
                  intent: s.intent,
                  topic_change: s.topic_change,
                  sentiment: s.sentiment,
                  resolved: s.resolved,
                  ...(recovery != null ? { recovery_distance: recovery } : {}),
                });
              })
            )
            .catch(() => {});
        },
      };

      const reply = await askCoach(history, snapshot, mem, meta);
      resolveReply(reply);
      // Presión alta: destilar YA a memoria antes de que el contexto se degrade.
      if (contextPressure >= 70) maybeDistill(history, true);
      const withReply: ChatMessage[] = [...history, { role: 'assistant', content: reply }];
      setMessages(withReply);
      persist(withReply);
      const newUsed = used + 1;
      setUsed(newUsed);
      AsyncStorage.setItem(quotaKey, String(newUsed)).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      maybeDistill(withReply);
    } catch (e: any) {
      setFailed(true);
      persist(history);
      // 402/429 del proxy llegan como mensajes claros; mostrar paywall si aplica.
      if (String(e?.message ?? '').includes('Premium')) router.push('/paywall' as any);
    } finally {
      setSending(false);
    }
  }

  function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending || !snapshot) return;
    const gate = canUseFeature('coach_chat', isPremium, used);
    if (!gate.allowed) {
      track('quota_hit', { feature: 'coach_chat' }); // el momento de conversión
      router.push('/paywall' as any);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track('coach_message_sent', {
      turn: messages.filter((m) => m.role === 'user').length + 1,
      from_chip: text != null,
    });
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    deliver(next);
  }

  function retry() {
    if (sending) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'user') deliver(messages);
  }

  function clearChat() {
    Alert.alert('¿Nueva conversación?', 'Se borra el historial del chat. Lo que tu coach ya aprendió de ti se conserva.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          setMessages([]);
          setFailed(false);
          distilledRef.current = 0;
          // Nueva conversación = nueva unidad de análisis.
          conversationIdRef.current = newConversationId();
          intentLogRef.current = [];
          topicChangesRef.current = 0;
          if (profile?.user_id) {
            AsyncStorage.removeItem(historyKeyFor(profile.user_id)).catch(() => {});
          }
        },
      },
    ]);
  }

  // ── Transparencia: el usuario controla la memoria del coach ──
  function removeFact(index: number) {
    if (!profile) return;
    memVersionRef.current += 1; // la edición del usuario invalida destilados en vuelo
    const next = memory.filter((_, i) => i !== index);
    applyMemory(next);
    saveCoachMemory(profile.user_id, next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function clearMemory() {
    Alert.alert('¿Borrar toda la memoria?', 'Tu coach olvidará todo lo que aprendió de ti en las conversaciones. No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Olvidar todo',
        style: 'destructive',
        onPress: () => {
          if (!profile) return;
          memVersionRef.current += 1;
          applyMemory([]);
          saveCoachMemory(profile.user_id, []);
        },
      },
    ]);
  }

  const callName = profile?.nickname?.trim() || (profile?.name ?? '').split(' ')[0] || 'crack';
  const chips = snapshot ? quickPrompts(snapshot) : ['Dame un consejo para hoy'];

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.nav}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnTxt}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.navTitle}>TU COACH IA</Text>
          <Text style={s.navSub} numberOfLines={1}>
            {snapshot ? snapshotHeadline(snapshot) : 'Cargando tu ficha...'}
          </Text>
        </View>
        <TouchableOpacity style={s.clearBtn} onPress={() => setMemoryModal(true)}>
          <Text style={s.clearBtnTxt}>🧠</Text>
          {memory.length > 0 && (
            <View style={s.memBadge}>
              <Text style={s.memBadgeTxt}>{memory.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={s.clearBtn} onPress={clearChat} disabled={messages.length === 0}>
          <Text style={[s.clearBtnTxt, messages.length === 0 && { opacity: 0.3 }]}>↺</Text>
        </TouchableOpacity>
      </View>

      {/* Integridad de contexto: si falta la salud, el usuario DEBE saberlo */}
      {snapshot && snapshot.contextGaps.includes('salud') && (
        <TouchableOpacity style={s.gapBanner} onPress={refreshContext} activeOpacity={0.8}>
          <Text style={s.gapBannerTxt}>
            ⚠️ No pudimos cargar tu perfil de salud — tu coach responderá en modo conservador.
            Toca aquí para reintentar.
          </Text>
        </TouchableOpacity>
      )}
      {/* Ficha rota: fail-closed VISIBLE y recuperable, nunca un spinner mudo */}
      {snapshotError && !snapshot && (
        <TouchableOpacity style={s.gapBanner} onPress={refreshContext} activeOpacity={0.8}>
          <Text style={s.gapBannerTxt}>
            ⚠️ No pudimos cargar tu ficha. Toca aquí para reintentar.
          </Text>
        </TouchableOpacity>
      )}

      {/* Cupo free */}
      {!isPremium && (
        <View style={s.quotaRow}>
          <View style={[s.quotaChip, remaining === 0 && s.quotaChipWarn]}>
            <Text style={[s.quotaTxt, remaining === 0 && { color: Colors.warning }]}>
              {remaining > 0
                ? `${remaining} mensaje${remaining === 1 ? '' : 's'} gratis hoy`
                : 'Sin mensajes hoy · Hazte Premium'}
            </Text>
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: 12, paddingBottom: 8, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View>
              <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleCoach]}>
                <Text style={item.role === 'user' ? s.bubbleUserTxt : s.bubbleCoachTxt}>
                  {item.content}
                </Text>
              </View>
              {item.role === 'assistant' && (
                <ReportContentButton feature="coach_chat" content={item.content} label="🚩 Reportar respuesta" />
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <View style={s.welcomeCard}>
                <Text style={s.welcomeEmoji}>🧠</Text>
                <Text style={s.welcomeTitle}>¡{callName}! Soy tu coach.</Text>
                <Text style={s.welcomeTxt}>
                  Conozco tu plan, tus macros de hoy, tu racha y tus marcas.
                  {memory.length > 0
                    ? ` Y recuerdo lo que me has contado (${memory.length} cosa${memory.length === 1 ? '' : 's'} — toca el 🧠 para verlas).`
                    : ' Y voy a recordar lo que me cuentes, para conocerte cada vez mejor.'}
                  {' '}Pregúntame lo que quieras: ajustes al entreno, qué comer, si vas bien hacia tu meta...
                </Text>
                <Text style={s.welcomeDisclaimer}>No sustituye consejo médico profesional.</Text>
              </View>
            </View>
          }
          ListFooterComponent={
            <>
              {sending && (
                <View style={[s.bubble, s.bubbleCoach, s.typingRow]}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={s.typingTxt}>Coach está escribiendo…</Text>
                </View>
              )}
              {failed && !sending && (
                <TouchableOpacity style={s.errorRow} onPress={retry} activeOpacity={0.8}>
                  <Text style={s.errorTxt}>⚠️ No pude responder. Toca para reintentar</Text>
                </TouchableOpacity>
              )}
            </>
          }
        />

        {/* Sugerencias rápidas */}
        {messages.length === 0 && !sending && (
          <View style={s.chipsWrap}>
            {chips.map((c) => (
              <TouchableOpacity key={c} style={s.chip} onPress={() => send(c)} activeOpacity={0.8}>
                <Text style={s.chipTxt}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Input */}
        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            placeholder={snapshot ? 'Escríbele a tu coach...' : 'Cargando tu ficha...'}
            placeholderTextColor={Colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            editable={!!snapshot}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || sending || !snapshot) && s.sendBtnOff]}
            onPress={() => send()}
            disabled={!input.trim() || sending || !snapshot}
            activeOpacity={0.85}
          >
            <Text style={s.sendBtnTxt}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Modal: lo que el coach sabe de ti (ver y borrar) */}
      <Modal
        visible={memoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMemoryModal(false)}
      >
        <View style={s.memOverlay}>
          <View style={s.memBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={s.memTitle}>🧠 LO QUE TU COACH SABE DE TI</Text>
              <TouchableOpacity onPress={() => setMemoryModal(false)}>
                <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.memSub}>
              Aprendido de tus conversaciones para darte consejos a tu medida. Es tuyo: borra lo
              que quieras y tu coach lo olvida al instante.
            </Text>

            {memory.length === 0 ? (
              <View style={s.memEmpty}>
                <Text style={{ fontSize: 30, marginBottom: 8 }}>🌱</Text>
                <Text style={s.memEmptyTxt}>
                  Aún nos estamos conociendo. Cuéntame de ti en el chat — tus horarios, molestias,
                  gustos — y lo recordaré.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                {memory.map((fact, i) => (
                  <View key={`${i}-${fact.slice(0, 12)}`} style={s.memRow}>
                    <Text style={s.memFact}>{fact}</Text>
                    <TouchableOpacity
                      onPress={() => removeFact(i)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Olvidar este dato"
                    >
                      <Text style={s.memDelete}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {memory.length > 0 && (
              <TouchableOpacity onPress={clearMemory} style={{ paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.warning }}>
                  Borrar toda la memoria
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, gap: 10 },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.textPrimary },
  navSub: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  clearBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  clearBtnTxt: { fontSize: 18, color: Colors.textMuted },
  memBadge: { position: 'absolute', top: 2, right: 0, backgroundColor: Colors.accent, borderRadius: Radii.full, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  memBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: 9, color: '#0a0a0b' },
  memOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  memBox: { backgroundColor: Colors.bgCard, borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, paddingBottom: Spacing.xl },
  memTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.textPrimary },
  memSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18, marginBottom: 14 },
  memEmpty: { alignItems: 'center', paddingVertical: 24 },
  memEmptyTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },
  memRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  memFact: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  memDelete: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  gapBanner: { marginHorizontal: Spacing.lg, marginBottom: 6, backgroundColor: 'rgba(255,157,58,0.1)', borderWidth: 1, borderColor: 'rgba(255,157,58,0.35)', borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 8 },
  gapBannerTxt: { fontFamily: Fonts.body, fontSize: 11, color: Colors.warning, lineHeight: 16 },
  quotaRow: { alignItems: 'center', marginBottom: 2 },
  quotaChip: { backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  quotaChipWarn: { backgroundColor: 'rgba(255,157,58,0.1)', borderColor: 'rgba(255,157,58,0.3)' },
  quotaTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent },
  bubble: { maxWidth: '84%', borderRadius: Radii.lg, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: Colors.accent, borderBottomRightRadius: 6 },
  bubbleCoach: { alignSelf: 'flex-start', backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 6 },
  bubbleUserTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: '#0a0a0b', lineHeight: 20 },
  bubbleCoachTxt: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 21 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  errorRow: { alignSelf: 'center', backgroundColor: 'rgba(255,157,58,0.1)', borderWidth: 1, borderColor: 'rgba(255,157,58,0.3)', borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8 },
  errorTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.warning },
  welcomeCard: { backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.xl, padding: Spacing.lg, marginBottom: 12 },
  welcomeEmoji: { fontSize: 34, marginBottom: 8 },
  welcomeTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, marginBottom: 6 },
  welcomeTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  welcomeDisclaimer: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 10 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: Spacing.lg, paddingBottom: 8 },
  chip: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 9 },
  chipTxt: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.accent },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: Spacing.lg, paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  input: { flex: 1, backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, paddingHorizontal: 14, paddingVertical: 10, fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, maxHeight: 110 },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.35 },
  sendBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: '#0a0a0b' },
});
