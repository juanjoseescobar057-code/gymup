import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../../store/userStore';
import { imageToOptimizedBase64 } from '../../lib/image';
import { AI_SAFETY_RULES } from '../../lib/safety';
import { parseAI, PostureResultSchema } from '../../lib/schemas';
import { aiChat } from '../../lib/aiClient';
import { canUseFeature } from '../../lib/subscription';
import { track } from '../../lib/analytics';
import { loadHealthSafe } from '../../lib/health';
import { healthToPrompt, HEALTH_UNKNOWN_DIRECTIVE } from '../../lib/healthMath';
import { router } from 'expo-router';
import ReportContentButton from '../../Components/ReportContentButton';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';

const EXERCISES = [
  { id: 'squat',    name: 'Sentadilla',      emoji: '🦵', muscles: 'Cuádriceps, Glúteos' },
  { id: 'deadlift', name: 'Peso muerto',      emoji: '🏋️', muscles: 'Espalda, Isquios' },
  { id: 'bench',    name: 'Press de banca',   emoji: '💪', muscles: 'Pecho, Tríceps' },
  { id: 'shoulder', name: 'Press hombro',     emoji: '⬆️', muscles: 'Hombros, Tríceps' },
  { id: 'row',      name: 'Remo con barra',   emoji: '🔙', muscles: 'Espalda, Bíceps' },
  { id: 'lunge',    name: 'Zancada',          emoji: '🚶', muscles: 'Cuádriceps, Glúteos' },
  { id: 'pullup',   name: 'Dominadas',        emoji: '🔝', muscles: 'Espalda, Bíceps' },
  { id: 'plank',    name: 'Plancha',          emoji: '💪', muscles: 'Core, Abdomen' },
  { id: 'pushup',   name: 'Flexiones',        emoji: '⬇️', muscles: 'Pecho, Tríceps' },
  { id: 'hip',      name: 'Hip Thrust',       emoji: '🍑', muscles: 'Glúteos, Isquios' },
];

type PostureResult = {
  score: number;
  overall: string;
  is_exercise_visible: boolean;
  corrections: {
    zone: string;
    issue: string;
    fix: string;
    severity: 'good' | 'warn' | 'error';
    cue: string;
  }[];
  encouragement: string;
  next_cue: string;
  // Riesgo por PATRÓN DE TÉCNICA observado — feedback de coaching, no un
  // diagnóstico médico de lesión. Ver AI_SAFETY_RULES y el prompt abajo.
  technique_risk: string;
  technique_risk_level: 'none' | 'low' | 'medium' | 'high';
  stretches: { name: string; duration: string; how: string }[];
};

const SEVERITY_CONFIG = {
  good:  { color: Colors.accent, bg: Colors.accentMuted,      icon: '✅', label: 'Correcto' },
  warn:  { color: '#ff9d3a',     bg: 'rgba(255,157,58,0.10)', icon: '⚠️', label: 'Mejorar'  },
  error: { color: '#ff4444',     bg: 'rgba(255,68,68,0.10)',  icon: '🔴', label: 'Urgente'  },
};

const TECHNIQUE_RISK_COLORS = {
  none:   Colors.accent,
  low:    '#a8e063',
  medium: '#ff9d3a',
  high:   '#ff4444',
};

async function analyzePosture(imageUri: string, exerciseName: string, healthBlock = ''): Promise<PostureResult> {
  const base64 = await imageToOptimizedBase64(imageUri);

  const data = await aiChat({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          {
            type: 'text',
            text: `Eres un coach de fitness experto en técnica de entrenamiento y biomecánica aplicada, con 20 años de experiencia.
Tu rol es 100% coaching de técnica: comparas la postura observada contra la forma correcta del ejercicio y das correcciones accionables. NUNCA diagnosticas, evalúas ni descartas una lesión — eso solo lo hace un profesional de la salud. Si la foto sugiere una lesión ya existente (no un patrón de técnica arriesgado), dilo con empatía y remite a un profesional; no continúes analizando eso como si fuera parte del entrenamiento.
${AI_SAFETY_RULES}
${healthBlock ? `\n${healthBlock}\n(Las correcciones y estiramientos que recomiendes DEBEN respetar estas directivas.)\n` : ''}
Se esperaba: persona haciendo "${exerciseName}".

PRIMERO verifica si el ejercicio es visible en la foto. Si no se ve claramente a una persona haciendo el ejercicio, indícalo.

Analiza la postura con especificidad técnica. Habla en español colombiano directo.

SOLO JSON sin texto adicional:
{
  "score": 78,
  "overall": "descripción técnica de la postura en 1 oración",
  "is_exercise_visible": true,
  "corrections": [
    {
      "zone": "Rodillas",
      "issue": "Las rodillas colapsan hacia adentro en el punto más bajo",
      "fix": "Empuja activamente las rodillas hacia afuera, alineadas con el segundo dedo del pie",
      "severity": "warn",
      "cue": "¡Rodillas afuera!"
    },
    {
      "zone": "Espalda baja",
      "issue": "Posición neutral correcta, sin hiperextensión",
      "fix": "Mantén esta posición durante toda la repetición",
      "severity": "good",
      "cue": "Espalda perfecta"
    }
  ],
  "encouragement": "Mensaje motivador específico de 1 oración sobre lo que ves.",
  "next_cue": "La UNA corrección más importante para la próxima repetición, muy corta.",
  "technique_risk": "Descripción del riesgo asociado al PATRÓN DE TÉCNICA observado (ej: sobrecarga en la rodilla por valgo si se repite con más peso) en 1-2 oraciones. Es una observación de forma de entrenamiento, NUNCA un diagnóstico médico — no afirmes que existe una lesión.",
  "technique_risk_level": "low",
  "stretches": [
    {
      "name": "Estiramiento de cuádriceps",
      "duration": "30 segundos por lado",
      "how": "De pie, dobla la rodilla y lleva el talón hacia el glúteo sujetándolo con la mano"
    },
    {
      "name": "Apertura de cadera",
      "duration": "45 segundos",
      "how": "Posición de paloma en el suelo, pierna adelante doblada 90°"
    }
  ]
}

Si is_exercise_visible es false, igual llena todos los campos con feedback genérico de postura.
severity: good=correcto, warn=mejorar, error=corregir urgente.
technique_risk_level: none, low, medium, high — qué tan urgente es corregir la técnica antes de subir peso/repeticiones. NO es una escala de gravedad médica.
Incluye 3-6 corrections y 2-3 stretches relevantes para el ejercicio.`,
          },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
  }, 'coach');

  return parseAI(PostureResultSchema, data.choices[0].message.content, 'análisis de postura') as PostureResult;
}

export default function CoachScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);

  // Directivas de salud: se cargan AL MOMENTO del análisis (no al montar el
  // tab, que en expo-router vive para siempre y quedaría obsoleto si el
  // usuario edita su salud). Fail-closed si no se puede verificar.
  async function currentHealthBlock(): Promise<string> {
    if (!profile) return HEALTH_UNKNOWN_DIRECTIVE;
    try {
      const load = await loadHealthSafe(profile.user_id);
      if (load.status === 'unknown') return HEALTH_UNKNOWN_DIRECTIVE;
      return load.profile ? healthToPrompt(load.profile, profile.age) : '';
    } catch {
      return HEALTH_UNKNOWN_DIRECTIVE;
    }
  }

  const [selectedEx, setSelectedEx] = useState(EXERCISES[0]);
  const [phase, setPhase] = useState<'select' | 'analyzing' | 'result'>('select');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<PostureResult | null>(null);
  const [history, setHistory] = useState<{ score: number; exercise: string; time: string }[]>([]);

  const todayIndex = Math.min(profile?.current_plan_day ?? 0, 6);
  const todayPlan = trainingPlan?.plan_data?.days?.[todayIndex];
  const todayExercises: string[] = todayPlan?.exercises?.map((e: any) => e.name) ?? [];

  function premiumGate(): boolean {
    const gate = canUseFeature('coach', !!profile?.is_premium);
    if (!gate.allowed) {
      track('quota_hit', { feature: 'coach' });
      router.push('/paywall' as any);
      return false;
    }
    return true;
  }

  async function takePhoto() {
    if (!premiumGate()) return;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso necesario', 'El coach necesita acceso a la cámara.');
        return;
      }
      const picked = await ImagePicker.launchCameraAsync({
        quality: 0.9,
        mediaTypes: ['images'],
        allowsEditing: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setPhotoUri(picked.assets[0].uri);
      await runAnalysis(picked.assets[0].uri);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  async function pickFromGallery() {
    if (!premiumGate()) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        quality: 0.9,
        mediaTypes: ['images'],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setPhotoUri(picked.assets[0].uri);
      await runAnalysis(picked.assets[0].uri);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  async function runAnalysis(uri: string) {
    setPhase('analyzing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const data = await analyzePosture(uri, selectedEx.name, await currentHealthBlock());

      if (!data.is_exercise_visible) {
        Alert.alert(
          '📸 No se detectó el ejercicio',
          `La foto no muestra claramente a alguien haciendo "${selectedEx.name}".\n\nAsegúrate de que tu cuerpo completo sea visible y la posición del ejercicio sea clara.`,
          [
            { text: 'Reintentar', onPress: () => { setPhase('select'); setPhotoUri(null); } },
            { text: 'Ver análisis de todas formas', onPress: () => { setResult(data); setPhase('result'); } },
          ]
        );
        return;
      }

      setResult(data);
      setHistory((prev) => [
        { score: data.score, exercise: selectedEx.name, time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) },
        ...prev.slice(0, 4),
      ]);
      setPhase('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error en el análisis', e.message);
      setPhase('select');
    }
  }

  function reset() {
    setPhase('select');
    setPhotoUri(null);
    setResult(null);
  }

  // ── SELECT ───────────────────────────────────────────
  if (phase === 'select') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <Text style={s.headerTitle}>COACH DE POSTURA</Text>
          <Text style={s.headerSub}>IA analiza tu técnica y te da correcciones específicas</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* Coach en vivo (tiempo real) */}
          <TouchableOpacity style={s.liveCard} onPress={() => router.push('/live-coach' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 26 }}>🎥</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.liveTitle}>Coach en vivo</Text>
              <Text style={s.liveSub}>Cuenta reps y corrige tu técnica en tiempo real</Text>
            </View>
            <Text style={s.liveArrow}>›</Text>
          </TouchableOpacity>

          {/* Chat con el coach que te conoce */}
          <TouchableOpacity style={[s.liveCard, { marginTop: 8 }]} onPress={() => router.push('/coach-chat' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 26 }}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.liveTitle}>Habla con tu coach</Text>
              <Text style={s.liveSub}>Conoce tu plan, tus macros y tu progreso — pregúntale lo que sea</Text>
            </View>
            <Text style={s.liveArrow}>›</Text>
          </TouchableOpacity>

          {/* Ejercicios de hoy */}
          {todayExercises.length > 0 && (
            <View style={s.todayCard}>
              <View style={s.aiDotRow}>
                <View style={s.aiDot} />
                <Text style={s.aiDotLbl}>EJERCICIOS DE HOY</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {todayExercises.slice(0, 6).map((name: string, i: number) => (
                  <TouchableOpacity key={i} style={s.todayExBtn}
                    onPress={() => {
                      const found = EXERCISES.find((e) =>
                        name.toLowerCase().includes(e.id) ||
                        e.name.toLowerCase().split(' ').some((w) => name.toLowerCase().includes(w))
                      );
                      if (found) setSelectedEx(found);
                      Haptics.selectionAsync();
                    }}>
                    <Text style={s.todayExTxt}>{name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Grid de ejercicios */}
          <Text style={s.sectionLbl}>SELECCIONA EL EJERCICIO</Text>
          <View style={s.exGrid}>
            {EXERCISES.map((ex) => (
              <TouchableOpacity key={ex.id}
                style={[s.exCard, selectedEx.id === ex.id && s.exCardSel]}
                onPress={() => { setSelectedEx(ex); Haptics.selectionAsync(); }}
                activeOpacity={0.8}>
                <Text style={s.exEmoji}>{ex.emoji}</Text>
                <Text style={[s.exName, selectedEx.id === ex.id && { color: Colors.accent }]}>
                  {ex.name}
                </Text>
                <Text style={s.exMuscles}>{ex.muscles}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Ejercicio seleccionado */}
          <View style={s.selectedCard}>
            <Text style={s.selectedLabel}>ANALIZANDO POSTURA DE</Text>
            <Text style={s.selectedName}>{selectedEx.emoji} {selectedEx.name}</Text>
            <Text style={s.selectedMuscles}>{selectedEx.muscles}</Text>
          </View>

          {/* Instrucciones */}
          <View style={s.instructCard}>
            <Text style={s.instructTitle}>📸 Para el mejor análisis</Text>
            {[
              'Pídele a alguien que te tome la foto de lado o de frente',
              'Cuerpo completo visible — de cabeza a pies',
              'Posición en el punto más difícil del movimiento (punto más bajo)',
              'Buena iluminación, fondo simple si es posible',
              'La IA detectará si el ejercicio no es visible en la foto',
            ].map((tip, i) => (
              <Text key={i} style={s.instructItem}>✓  {tip}</Text>
            ))}
          </View>

          {/* Botones */}
          <View style={{ paddingHorizontal: Spacing.lg, marginBottom: 8 }}>
            <TouchableOpacity style={s.primaryBtn} onPress={takePhoto} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>📷  TOMAR FOTO AHORA</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={pickFromGallery} activeOpacity={0.85}>
              <Text style={s.secondaryBtnTxt}>Elegir foto de galería</Text>
            </TouchableOpacity>
          </View>

          {/* Historial */}
          {history.length > 0 && (
            <>
              <Text style={[s.sectionLbl, { marginTop: 8 }]}>ÚLTIMOS ANÁLISIS</Text>
              <View style={{ paddingHorizontal: Spacing.lg, marginBottom: 24 }}>
                {history.map((h, i) => (
                  <View key={i} style={s.historyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.historyEx}>{h.exercise}</Text>
                      <Text style={s.historyTime}>{h.time}</Text>
                    </View>
                    <View style={[s.historyScore, {
                      backgroundColor: h.score >= 80 ? Colors.accentMuted : 'rgba(255,157,58,0.1)',
                    }]}>
                      <Text style={[s.historyScoreTxt, {
                        color: h.score >= 80 ? Colors.accent : '#ff9d3a',
                      }]}>{h.score}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── ANALIZANDO ───────────────────────────────────────
  if (phase === 'analyzing') {
    return (
      <SafeAreaView style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        {photoUri && (
          <Image source={{ uri: photoUri }} style={s.analyzingBg} blurRadius={10} />
        )}
        <View style={s.analyzingBox}>
          <ActivityIndicator color={Colors.accent} size="large" />
          <Text style={s.analyzingTitle}>Analizando postura</Text>
          <Text style={s.analyzingEx}>{selectedEx.emoji} {selectedEx.name}</Text>
          <Text style={s.analyzingMsg}>
            GPT-4o está evaluando{'\n'}técnica, forma y correcciones...
          </Text>
          {[
            'Verificando si el ejercicio es visible...',
            'Evaluando ángulos articulares...',
            'Comparando contra la forma correcta...',
            'Generando correcciones específicas...',
          ].map((msg, i) => (
            <View key={i} style={s.analyzingStep}>
              <View style={[s.analyzingDot, { backgroundColor: i === 0 ? Colors.accent : Colors.border }]} />
              <Text style={[s.analyzingStepTxt, { color: i === 0 ? Colors.textSecondary : Colors.textMuted }]}>
                {msg}
              </Text>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ── RESULTADO ────────────────────────────────────────
  if (phase === 'result' && result) {
    const scoreColor =
      result.score >= 85 ? Colors.accent :
      result.score >= 65 ? '#ff9d3a' : '#ff4444';

    const goodCount = result.corrections.filter((c) => c.severity === 'good').length;
    const issueCount = result.corrections.filter((c) => c.severity !== 'good').length;
    const techRiskColor = TECHNIQUE_RISK_COLORS[result.technique_risk_level];

    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={reset}>
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>TU ANÁLISIS</Text>
          <TouchableOpacity onPress={takePhoto}>
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>
              Nueva foto
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* Hero con foto */}
          {photoUri && (
            <View style={s.heroWrap}>
              <Image source={{ uri: photoUri }} style={s.heroPhoto} />
              <View style={s.heroOverlay}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={s.scoreCircle}>
                    <Text style={[s.scoreNum, { color: scoreColor }]}>{result.score}</Text>
                    <Text style={s.scoreDen}>/100</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.heroExName}>{selectedEx.emoji} {selectedEx.name}</Text>
                    <Text style={s.heroOverall}>{result.overall}</Text>
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.accent }}>
                        ✅ {goodCount} correctos
                      </Text>
                      <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 11, color: '#ff9d3a' }}>
                        ⚠️ {issueCount} a corregir
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )}

          <View style={{ paddingHorizontal: Spacing.lg }}>

            {/* Riesgo por patrón de técnica (no es diagnóstico médico) */}
            <View style={[s.injuryCard, { borderColor: techRiskColor + '44', backgroundColor: techRiskColor + '11' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text style={{ fontSize: 18 }}>
                  {result.technique_risk_level === 'none' ? '🛡️' :
                   result.technique_risk_level === 'low' ? '⚡' :
                   result.technique_risk_level === 'medium' ? '⚠️' : '🚨'}
                </Text>
                <Text style={[s.injuryLabel, { color: techRiskColor }]}>
                  RIESGO POR TÉCNICA: {result.technique_risk_level.toUpperCase()}
                </Text>
              </View>
              <Text style={s.injuryTxt}>{result.technique_risk}</Text>
              <Text style={s.injuryDisclaimer}>
                Esto es feedback de coaching sobre tu forma de entrenamiento, no un diagnóstico médico. Si sientes dolor agudo o algo no se siente bien, para y consulta a un profesional de la salud.
              </Text>
            </View>

            <ReportContentButton feature="posture" content={JSON.stringify(result)} />

            {/* Cue prioritario */}
            <View style={s.cueCard}>
              <View style={s.aiDotRow}>
                <View style={s.aiDot} />
                <Text style={s.aiDotLbl}>CORRECCIÓN PRIORITARIA</Text>
              </View>
              <Text style={s.cueTxt}>"{result.next_cue}"</Text>
            </View>

            {/* Correcciones por zona */}
            <Text style={s.sectionLbl}>ANÁLISIS POR ZONA</Text>
            {result.corrections.map((c, i) => {
              const cfg = SEVERITY_CONFIG[c.severity];
              return (
                <View key={i} style={[s.correctionCard, { backgroundColor: cfg.bg, borderColor: cfg.color + '44' }]}>
                  <View style={s.correctionTop}>
                    <Text style={s.correctionIcon}>{cfg.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={[s.correctionZone, { color: cfg.color }]}>{c.zone}</Text>
                        <View style={[s.correctionBadge, { backgroundColor: cfg.color + '22' }]}>
                          <Text style={[s.correctionBadgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                        </View>
                      </View>
                      <Text style={s.correctionIssue}>{c.issue}</Text>
                    </View>
                  </View>
                  {c.severity !== 'good' && (
                    <>
                      <View style={[s.correctionFix, { borderLeftColor: cfg.color }]}>
                        <Text style={s.correctionFixLabel}>FIX</Text>
                        <Text style={s.correctionFixTxt}>{c.fix}</Text>
                      </View>
                      <View style={[s.cuePill, { backgroundColor: cfg.color + '15' }]}>
                        <Text style={[s.cuePillTxt, { color: cfg.color }]}>Cue: "{c.cue}"</Text>
                      </View>
                    </>
                  )}
                </View>
              );
            })}

            {/* Estiramientos recomendados */}
            <Text style={s.sectionLbl}>🧘 ESTIRAMIENTOS RECOMENDADOS</Text>
            <View style={s.stretchesCard}>
              {result.stretches.map((stretch, i) => (
                <View key={i} style={[s.stretchRow, i > 0 && s.stretchBorder]}>
                  <View style={s.stretchNum}>
                    <Text style={s.stretchNumTxt}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={s.stretchName}>{stretch.name}</Text>
                      <Text style={s.stretchDuration}>{stretch.duration}</Text>
                    </View>
                    <Text style={s.stretchHow}>{stretch.how}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Motivación */}
            <View style={s.motivationCard}>
              <Text style={s.motivationTxt}>💬 "{result.encouragement}"</Text>
            </View>

            {/* Botones */}
            <TouchableOpacity style={s.primaryBtn} onPress={takePhoto} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>📷  ANALIZAR OTRA REP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={reset} activeOpacity={0.85}>
              <Text style={s.secondaryBtnTxt}>Cambiar ejercicio</Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.textPrimary },
  headerSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.textPrimary },
  todayCard: { marginHorizontal: Spacing.lg, marginBottom: 16, backgroundColor: Colors.bgSelected, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: Spacing.lg, marginTop: Spacing.md, marginBottom: 4, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md },
  liveTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textPrimary },
  liveSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  liveArrow: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.accent },
  aiDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  aiDotLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, letterSpacing: 0.8 },
  todayExBtn: { backgroundColor: Colors.accentMuted, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.accentBorder, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  todayExTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12, paddingHorizontal: Spacing.lg, marginTop: 4 },
  exGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: Spacing.lg, marginBottom: 16 },
  exCard: { width: '47%', backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center' },
  exCardSel: { backgroundColor: Colors.bgSelected, borderColor: Colors.accent },
  exEmoji: { fontSize: 28, marginBottom: 6 },
  exName: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary, textAlign: 'center', marginBottom: 3 },
  exMuscles: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center' },
  selectedCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgSelected, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: 12 },
  selectedLabel: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, letterSpacing: 0.8, marginBottom: 4 },
  selectedName: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary },
  selectedMuscles: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  instructCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 16 },
  instructTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textPrimary, marginBottom: 10 },
  instructItem: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 24 },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  secondaryBtn: { borderRadius: Radii.lg, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary },
  historyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: Radii.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: Colors.border },
  historyEx: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary },
  historyTime: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  historyScore: { borderRadius: Radii.full, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  historyScoreTxt: { fontFamily: Fonts.headingBold, fontSize: 16 },
  analyzingBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.12 },
  analyzingBox: { alignItems: 'center', backgroundColor: 'rgba(14,14,16,0.96)', borderRadius: Radii.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.border, marginHorizontal: Spacing.lg },
  analyzingTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, marginTop: 16, marginBottom: 4 },
  analyzingEx: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.accent, marginBottom: 8 },
  analyzingMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  analyzingStep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, alignSelf: 'flex-start' },
  analyzingDot: { width: 8, height: 8, borderRadius: 4 },
  analyzingStepTxt: { fontFamily: Fonts.body, fontSize: 12 },
  heroWrap: { height: 300, position: 'relative', marginBottom: 12 },
  heroPhoto: { width: '100%', height: '100%' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(14,14,16,0.88)', padding: Spacing.md },
  scoreCircle: { alignItems: 'center' },
  scoreNum: { fontFamily: Fonts.heading, fontSize: 52, lineHeight: 52 },
  scoreDen: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  heroExName: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary, marginBottom: 3 },
  heroOverall: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  injuryCard: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.md, marginBottom: 12 },
  injuryLabel: { fontFamily: Fonts.bodySemi, fontSize: 11, letterSpacing: 0.6 },
  injuryTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  injuryDisclaimer: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, lineHeight: 15, marginTop: 8 },
  cueCard: { backgroundColor: Colors.bgSelected, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: 12 },
  cueTxt: { fontFamily: Fonts.bodyMedium, fontSize: 16, color: Colors.textPrimary, lineHeight: 24, marginTop: 8, fontStyle: 'italic' },
  correctionCard: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.md, marginBottom: 8 },
  correctionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  correctionIcon: { fontSize: 18, marginTop: 2 },
  correctionZone: { fontFamily: Fonts.headingSemi, fontSize: 16 },
  correctionBadge: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 2 },
  correctionBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: 9, letterSpacing: 0.4 },
  correctionIssue: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  correctionFix: { marginTop: 10, borderLeftWidth: 2, paddingLeft: 10, marginBottom: 8 },
  correctionFixLabel: { fontFamily: Fonts.bodySemi, fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  correctionFixTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  cuePill: { borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  cuePillTxt: { fontFamily: Fonts.bodySemi, fontSize: 12 },
  stretchesCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: 12 },
  stretchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: Spacing.md },
  stretchBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  stretchNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  stretchNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.accent },
  stretchName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  stretchDuration: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.accent },
  stretchHow: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18, marginTop: 2 },
  motivationCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  motivationTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary, lineHeight: 22, fontStyle: 'italic' },
});