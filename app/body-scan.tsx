// app/body-scan.tsx
// ─────────────────────────────────────────────────────────
// Pantalla de escaneo corporal:
//   1. Instrucciones + botón de cámara
//   2. Preview de foto tomada
//   3. Resultados: score, zonas, enfoque, plan refinado
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { imageToOptimizedBase64 } from '../lib/image';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { recordBodyScan } from '../lib/streaks';
import { parseAI, BodyAnalysisSchema, PhotoValidationSchema } from '../lib/schemas';
import { aiChat } from '../lib/aiClient';
import { canUseFeature } from '../lib/subscription';
import { track } from '../lib/analytics';
import { captureError } from '../lib/monitoring';
import ReportContentButton from '../Components/ReportContentButton';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';
import { AI_SAFETY_RULES, clampFatPct, MEDICAL_DISCLAIMER, BODY_SCAN_CONSENT, MIN_AGE, MIN_FAT_PCT, MAX_FAT_PCT } from '../lib/safety';

const POSES = [
  { id: 'front', label: 'Frente',  emoji: '🧍', instruction: 'Párate derecho mirando la cámara, brazos a los lados, cuerpo completo visible' },
  { id: 'side',  label: 'Lateral', emoji: '🧍', instruction: 'Perfil derecho, brazos a los lados, postura natural, cuerpo completo' },
  { id: 'back',  label: 'Espalda', emoji: '🧍', instruction: 'De espaldas a la cámara, brazos a los lados, cuerpo completo' },
];

type PosePhoto = { poseId: string; uri: string; base64: string };

type BodyAnalysis = {
  overall_score: number;
  estimated_fat_pct: number;
  estimated_muscle_level: string;
  zones: {
    id: string; label: string;
    status: 'strength' | 'focus' | 'priority';
    message: string; tip: string;
  }[];
  strengths: string[];
  focus_areas: string[];
  refined_plan_notes: string;
  motivation: string;
  prediction_30days: string;
  recovery_tips: string[];
  sleep_tips: string[];
};

type PreviousScan = {
  id: string;
  scanned_at: string;
  overall_score: number;
  estimated_fat_pct: number;
};

const STATUS_CONFIG = {
  strength: { color: Colors.accent, bg: Colors.accentMuted,          icon: '✅', label: 'Fortaleza' },
  focus:    { color: Colors.warning,     bg: 'rgba(255,157,58,0.10)',     icon: '⚠️', label: 'Trabajar'  },
  priority: { color: Colors.error,     bg: 'rgba(255,68,68,0.10)',      icon: '🔴', label: 'Prioridad' },
};

// Una foto de celular no está calibrada: no hay escala, ni pliegues, ni
// densitometría. Estimar el % de grasa "al punto" desde ahí es falsa
// precisión, y un número exacto es justo lo que la gente se queda mirando.
// Guardamos el número que devuelve la IA (el esquema y la BD lo exigen)
// pero al usuario SIEMPRE le mostramos la banda de incertidumbre.
const FAT_PCT_UNCERTAINTY = 3; // puntos porcentuales a cada lado del valor

function fatPctRange(pct: number): string {
  const mid = Math.round(pct);
  const low = Math.max(MIN_FAT_PCT, mid - FAT_PCT_UNCERTAINTY);
  const high = Math.min(MAX_FAT_PCT, mid + FAT_PCT_UNCERTAINTY);
  return `${low}-${high}%`;
}

async function validatePhoto(
  base64: string,
  poseLabel: string
): Promise<{ valid: boolean; reason: string }> {
  const data = await aiChat({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' },
          },
          {
            type: 'text',
            text: `Valida si esta foto es adecuada para un análisis corporal fitness.
Se esperaba: foto corporal de "${poseLabel}" — persona de cuerpo completo o casi completo.

SOLO JSON sin texto adicional:
{
  "valid": true,
  "reason": "Si válida: describe brevemente qué se ve bien. Si inválida: explica exactamente qué está mal y cómo corregirlo en 1-2 oraciones."
}

Casos inválidos:
- No hay persona visible en la foto
- Es comida, objeto, paisaje u otra cosa que no es una persona
- Solo se ve la cara (selfie sin cuerpo)
- La foto está muy oscura o borrosa
- Solo se ven manos, pies o una parte muy pequeña del cuerpo
- La persona está tan lejos que no se distingue el cuerpo`,
          },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 150,
  }, 'body_scan');
  return parseAI(PhotoValidationSchema, data.choices[0].message.content, 'validación de foto');
}

async function analyzeBodyPhotos(
  photos: PosePhoto[],
  profile: any,
  previousScan: PreviousScan | null
): Promise<BodyAnalysis> {
  const goalCtx: Record<string, string> = {
    muscle_gain: 'ganar masa muscular',
    fat_loss:    'perder grasa corporal',
    performance: 'mejorar rendimiento',
    endurance:   'mejorar resistencia',
  };

  const content: any[] = photos.map((p) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${p.base64}`, detail: 'high' },
  }));

  const previousContext = previousScan
    ? `Escáner anterior (${new Date(previousScan.scanned_at).toLocaleDateString('es-CO')}): Score ${previousScan.overall_score}/100, ~${previousScan.estimated_fat_pct}% grasa (estimación visual, no una medición). Describe qué cambió y qué no, sin calificarlo.`
    : 'Es el primer escáner del usuario — describe la línea base, sin puntuarla como si fuera una nota.';

  content.push({
    type: 'text',
    text: `Eres un coach de fitness y nutricionista experto con 20 años de experiencia.
${AI_SAFETY_RULES}

Analiza estas ${photos.length} foto(s) corporales disponibles.

Usuario: ${profile.age} años, ${profile.weight_kg}kg, ${profile.height_cm}cm
Objetivo: ${goalCtx[profile.goal]}
${previousContext}

CÓMO REPORTAR — DESCRIBIR, NO JUZGAR:
- Describe lo que se ve en las fotos. No lo califiques moralmente: nada de "retroceso", "empeoró", "te descuidaste", "recaída", "excusas" ni "disciplina".
- Si no hay cambios visibles desde el escáner anterior, dilo con naturalidad: dos semanas rara vez cambian lo que una foto alcanza a mostrar.
- Si hay cambios, nómbralos concretos y en ambos sentidos, como observaciones y no como veredictos.
- Encuadra las variaciones como normales: retención de agua, sodio del día anterior, fase del ciclo menstrual, hora del día e iluminación de la foto cambian lo que se ve sin que el cuerpo haya cambiado.
- Identifica fortalezas musculares reales y zonas a trabajar con especificidad.
- Los consejos deben ser directamente aplicables, no genéricos.

PRECISIÓN HONESTA — UNA FOTO NO CALIBRADA NO ES UNA MEDICIÓN:
- "estimated_fat_pct" es el punto medio de una estimación visual, no un dato medido.
- En TODO texto que lea el usuario expresa la grasa como RANGO (p. ej. "18-22%"), nunca como número exacto.
- Di explícitamente, en una frase, que una foto sin calibrar no permite más precisión que ese rango.
- El score /100 es una referencia para seguir la evolución, no una nota ni una medida de valor personal.

RELACIÓN CON EL CUERPO (obligatorio):
- Prohibido el lenguaje de urgencia ("tienes que", "ya", "antes de que"), de vergüenza, de culpa o de asco.
- Prohibido comparar el cuerpo del usuario con ideales, modelos, atletas o cualquier estándar estético.
- No trates el cuerpo como un problema a corregir: habla de entrenamiento, comida y descanso, no de defectos.
- Nunca sugieras saltarse comidas, "compensar" lo que comió con más ejercicio, ni pesarse a diario.
- Si lo que ves sugiere un peso muy bajo, una pérdida muy rápida frente al escáner anterior u otras señales de una relación problemática con la comida o con la imagen corporal, no des consejos de déficit: recomienda con empatía y sin dramatizar hablar con un profesional de la salud.

SOLO JSON sin texto adicional:
{
  "overall_score": 72,
  "estimated_fat_pct": 18,
  "estimated_muscle_level": "intermedio",
  "zones": [
    {
      "id": "chest",
      "label": "Pecho",
      "status": "strength",
      "message": "Buen desarrollo visible, simetría correcta entre ambos lados.",
      "tip": "Agrega press inclinado 2 veces por semana para trabajar la porción clavicular (superior) del pectoral."
    },
    {
      "id": "abdomen",
      "label": "Abdomen",
      "status": "priority",
      "message": "Acumulación de grasa visible en zona baja y media.",
      "tip": "Déficit calórico de 300kcal diarios + HIIT 2 veces por semana."
    }
  ],
  "strengths": [
    "Espalda bien desarrollada con buena amplitud",
    "Buena simetría en hombros"
  ],
  "focus_areas": [
    "Bajar el porcentaje de grasa general — no se puede elegir de qué zona se pierde primero",
    "Desarrollar pantorrillas"
  ],
  "refined_plan_notes": "Basado en tus fotos, tu plan debe enfocarse más en ejercicios de core y menos volumen en espalda que ya está bien desarrollada.",
  "motivation": "Dos oraciones descriptivas sobre lo que muestran las fotos y el siguiente paso concreto. Sin halagos vacíos, sin urgencia y sin comparar con ningún ideal. Menciona la grasa como rango si la mencionas.",
  "prediction_30days": "Qué puede cambiar de forma realista en 30 días si es consistente, incluyendo que los cambios visibles toman tiempo y que el rango de grasa estimado desde una foto sin calibrar no da para más precisión.",
  "recovery_tips": [
    "Foam rolling 10 min después de cada entreno enfocado en los músculos trabajados",
    "Camina 10-15 min suave el día después de una sesión dura: mueve sangre sin sumar fatiga"
  ],
  "sleep_tips": [
    "Duerme 7-9 horas: es de lo que más impacta la recuperación, la síntesis proteica y tu rendimiento del día siguiente",
    "Evita pantallas 30 minutos antes de dormir para mejorar la calidad del sueño"
  ]
}

status opciones: strength=bien desarrollado, focus=necesita más trabajo, priority=donde hay más margen de mejora (NO implica urgencia ni alarma).
Incluye entre 4 y 7 zonas. Sé específico y descriptivo.`,
  });

  const data = await aiChat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
  }, 'body_scan');

  const parsed = parseAI(BodyAnalysisSchema, data.choices[0].message.content, 'análisis corporal') as BodyAnalysis;
  // Clamp de seguridad: descarta valores fisiológicamente imposibles que la IA pudiera alucinar.
  parsed.estimated_fat_pct = clampFatPct(parsed.estimated_fat_pct);
  return parsed;
}

export default function BodyScanScreen() {
  const profile = useUserStore((s: any) => s.profile);

  const [phase, setPhase] = useState<'consent' | 'capture' | 'analyzing' | 'result'>('consent');
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [photos, setPhotos] = useState<PosePhoto[]>([]);
  const [result, setResult] = useState<BodyAnalysis | null>(null);
  const [previousScan, setPreviousScan] = useState<PreviousScan | null>(null);
  const [privacyModal, setPrivacyModal] = useState(false);
  const [validating, setValidating] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // Devuelve el escaneo anterior ADEMÁS de setearlo en estado: analyze() lo
  // usaba desde el closure y siempre veía null (React no actualiza la
  // variable dentro de la misma ejecución) → la comparación nunca corría.
  async function loadPreviousScan(): Promise<PreviousScan | null> {
    if (!profile) return null;
    const { data } = await supabase
      .from('body_scans')
      .select('id, scanned_at, overall_score, estimated_fat_pct')
      .eq('user_id', profile.user_id)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .single();
    if (data) setPreviousScan(data as PreviousScan);
    return (data as PreviousScan) ?? null;
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso necesario', 'Rityvo necesita acceso a la cámara.');
      return;
    }

    const picked = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      mediaTypes: ['images'],
      allowsEditing: false,
    });

    if (picked.canceled || !picked.assets?.[0]) return;

    const uri = picked.assets[0].uri;
    const base64 = await imageToOptimizedBase64(uri);
    const pose = POSES[currentPoseIndex];

    // Validar la foto antes de guardarla
    setValidating(true);
    try {
      const validation = await validatePhoto(base64, pose.label);

      if (!validation.valid) {
        setValidating(false);
        Alert.alert(
          '📸 Foto no válida',
          validation.reason + '\n\nIntenta de nuevo siguiendo las instrucciones.',
          [{ text: 'Intentar de nuevo' }]
        );
        return;
      }

      // Foto válida — guardar
      const newPhoto: PosePhoto = { poseId: pose.id, uri, base64 };
      setPhotos((prev) => [...prev.filter((p) => p.poseId !== pose.id), newPhoto]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Sugerir pasar a la siguiente pose
      if (currentPoseIndex < POSES.length - 1) {
        Alert.alert(
          '✅ Foto perfecta',
          `Foto de "${pose.label}" guardada correctamente.`,
          [
            { text: 'Quedarme aquí', style: 'cancel' },
            {
              text: `Ir a ${POSES[currentPoseIndex + 1].label} →`,
              onPress: () => setCurrentPoseIndex(currentPoseIndex + 1),
            },
          ]
        );
      }

    } catch (e: any) {
      console.log('[BodyScan] Error validando foto:', e.message);
      // Si falla la validación por error de red, aceptar la foto de todas formas
      const newPhoto: PosePhoto = { poseId: pose.id, uri, base64 };
      setPhotos((prev) => [...prev.filter((p) => p.poseId !== pose.id), newPhoto]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setValidating(false);
    }
  }

  async function analyze() {
    if (photos.length === 0) {
      Alert.alert('Sin fotos', 'Toma al menos una foto para analizar.');
      return;
    }

    setPhase('analyzing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const prev = await loadPreviousScan();
      const analysis = await analyzeBodyPhotos(photos, profile, prev);
      setResult(analysis);

      // Guardar en Supabase — solo datos del análisis, NO las fotos
      if (profile) {
        const { data: savedScan, error } = await supabase.from('body_scans').insert({
          user_id: profile.user_id,
          scanned_at: new Date().toISOString(),
          overall_score: analysis.overall_score,
          estimated_fat_pct: analysis.estimated_fat_pct,
          estimated_muscle_level: analysis.estimated_muscle_level,
          zones: analysis.zones,
          strengths: analysis.strengths,
          focus_areas: analysis.focus_areas,
          notes: analysis.refined_plan_notes,
          photos_count: photos.length,
        }).select('id').single();
        if (error) {
          // Antes esto solo hacía console.log —que en producción se elimina— y
          // seguía mostrando el resultado. El usuario veía su análisis, creía
          // que quedaba en su historial, y al volver no había nada: no puede
          // comparar su progreso ni entender por qué desapareció.
          // El análisis SÍ se muestra (ya se pagó la llamada de IA y es útil
          // ahora mismo), pero se dice la verdad sobre lo que no se guardó.
          captureError(error, { scope: 'body_scan.insert', fotos: photos.length });
          Alert.alert(
            'Tu análisis no se guardó',
            'Puedes verlo ahora, pero no quedará en tu historial y no podrás compararlo más adelante. Revisa tu conexión e inténtalo de nuevo.'
          );
        } else {
          // Gamificación: registrar el escaneo (XP + badges). Silencioso.
          recordBodyScan(profile.user_id, savedScan?.id).catch((e) =>
            console.log('[BodyScan] Error gamificación:', e?.message)
          );
        }
      }

      setPhase('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error en el análisis', e.message);
      setPhase('capture');
    }
  }

  function reset() {
    setPhase('consent');
    setPhotos([]);
    setResult(null);
    setCurrentPoseIndex(0);
    setPreviousScan(null);
  }

  // ── CONSENTIMIENTO ───────────────────────────────────
  if (phase === 'consent') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}
            accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>ANÁLISIS CORPORAL</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <View style={s.consentHero}>
            <Text style={{ fontSize: 64 }}>🔒</Text>
            <Text style={s.consentTitle}>
              Tu privacidad{'\n'}<Text style={{ color: Colors.accent }}>primero</Text>
            </Text>
          </View>

          <View style={s.infoCard}>
            <Text style={s.infoCardTitle}>📸 Cómo usamos tus fotos</Text>
            {[
              `Solo para mayores de ${MIN_AGE} años`,
              'Las fotos se envían a OpenAI solo para generar el análisis; Rityvo no las almacena',
              'Solo guardamos los resultados numéricos del análisis, no las fotos',
              'Nunca vendemos ni compartimos tu información con terceros con fines comerciales',
              'Puedes eliminar tu historial cuando quieras desde Perfil › Privacidad y datos',
            ].map((item, i) => (
              <View key={i} style={s.checkRow}>
                <Text style={s.checkMark}>✓</Text>
                <Text style={s.checkTxt}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={s.infoCard}>
            <Text style={s.infoCardTitle}>📅 Frecuencia recomendada</Text>
            <Text style={s.infoCardDesc}>
              Para poder comparar, recomendamos hacer el análisis cada{' '}
              <Text style={{ color: Colors.accent, fontFamily: Fonts.bodySemi }}>15 días</Text>.
              Si no hay cambios visibles, te lo dirá con claridad — en dos semanas eso es lo normal.
            </Text>
          </View>

          <View style={s.infoCard}>
            <Text style={s.infoCardTitle}>📐 Fotos que vamos a tomar</Text>
            {POSES.map((p, i) => (
              <View key={i} style={[s.poseRow, i > 0 && { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 10, paddingTop: 10 }]}>
                <Text style={{ fontSize: 28 }}>{p.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.poseRowName}>{p.label}</Text>
                  <Text style={s.poseRowInstr}>{p.instruction}</Text>
                </View>
                <View style={s.poseNum}><Text style={s.poseNumTxt}>{i + 1}</Text></View>
              </View>
            ))}
            <View style={s.tipBox}>
              <Text style={s.tipTxt}>
                💡 Viste ropa ajustada o deportiva para que la IA pueda evaluar mejor la composición corporal
              </Text>
            </View>
          </View>

          <View style={s.infoCard}>
            <Text style={s.infoCardTitle}>🤖 Qué vas a leer</Text>
            <Text style={s.infoCardDesc}>
              El análisis describe lo que muestran tus fotos y qué cambió desde la última sesión,
              sin calificarte ni compararte con ningún ideal. El % de grasa se entrega como rango
              estimado: una foto sin calibrar no permite más precisión que eso.
            </Text>
          </View>

          {/* Consentimiento afirmativo obligatorio */}
          <TouchableOpacity
            style={s.consentRow}
            onPress={() => { setConsentChecked((v) => !v); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityLabel={BODY_SCAN_CONSENT}
            accessibilityState={{ checked: consentChecked }}
          >
            <View style={[s.checkbox, consentChecked && s.checkboxOn]}>
              {consentChecked && <Text style={s.checkboxMark}>✓</Text>}
            </View>
            <Text style={s.consentRowTxt}>{BODY_SCAN_CONSENT}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.primaryBtn, !consentChecked && { opacity: 0.4 }]}
            disabled={!consentChecked}
            onPress={() => {
              const gate = canUseFeature('body_scan', !!profile?.is_premium);
              if (!gate.allowed) {
                track('quota_hit', { feature: 'body_scan' });
                router.push('/paywall' as any);
                return;
              }
              setPhase('capture');
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={profile?.is_premium
              ? 'Aceptar y empezar el análisis corporal'
              : 'Aceptar y empezar el análisis corporal. Función premium'}
            accessibilityState={{ disabled: !consentChecked }}>
            <Text style={s.primaryBtnTxt}>{profile?.is_premium ? 'ACEPTAR Y EMPEZAR' : 'ACEPTAR Y EMPEZAR ✦ PREMIUM'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn} onPress={() => router.back()} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="No por ahora, salir del análisis corporal">
            <Text style={s.secondaryBtnTxt}>No por ahora</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setPrivacyModal(true)} style={{ alignItems: 'center', marginTop: 4 }}
            accessibilityRole="button" accessibilityLabel="Ver política de privacidad completa">
            <Text style={{ fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textDecorationLine: 'underline' }}>
              Ver política de privacidad completa
            </Text>
          </TouchableOpacity>

          <Text style={s.disclaimerTxt}>{MEDICAL_DISCLAIMER}</Text>
        </ScrollView>

        {/* Modal privacidad */}
        <Modal visible={privacyModal} transparent animationType="slide"
          onRequestClose={() => setPrivacyModal(false)}>
          <View style={s.overlay}>
            <View style={s.privacyModal}>
              <Text style={s.privacyTitle}>Política de Privacidad</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={s.privacyTxt}>
                  {`Rityvo toma la privacidad de tus datos corporales muy en serio.\n\n`}
                  {`• Las fotos se envían a OpenAI mediante nuestro servidor únicamente para producir el análisis. Rityvo no las guarda; OpenAI puede conservar datos de API temporalmente, normalmente hasta 30 días para prevención de abuso, salvo que se habiliten controles de retención reducida o cero.\n\n`}
                  {`• Rityvo NO almacena tus fotos en ningún servidor. Solo guardamos los datos numéricos del análisis: score, % grasa estimado, zonas identificadas y notas del plan.\n\n`}
                  {`• No vendemos tus datos. Solo los comparten los proveedores necesarios descritos en la política (por ejemplo, Supabase y OpenAI) bajo sus medidas de seguridad.\n\n`}
                  {`• Puedes solicitar la eliminación completa de todos tus datos desde tu perfil en cualquier momento.\n\n`}
                  {`• El análisis es una estimación visual basada en inteligencia artificial. No es un diagnóstico médico y no reemplaza la evaluación de un profesional de la salud.\n\n`}
                  {`• Esta función es completamente opcional. Puedes usar Rityvo sin nunca realizar un análisis corporal.`}
                </Text>
              </ScrollView>
              <TouchableOpacity style={[s.primaryBtn, { marginTop: 16 }]}
                onPress={() => setPrivacyModal(false)}
                accessibilityRole="button" accessibilityLabel="Entendido, cerrar la política de privacidad">
                <Text style={s.primaryBtnTxt}>Entendido</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ── CAPTURA ──────────────────────────────────────────
  if (phase === 'capture') {
    const currentPose = POSES[currentPoseIndex];
    const photoForCurrentPose = photos.find((p) => p.poseId === currentPose.id);

    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={reset}
            accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>FOTO {currentPoseIndex + 1}/{POSES.length}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>

          {/* Tabs de poses */}
          <View style={s.poseTabs}>
            {POSES.map((p, i) => {
              const done = photos.some((ph) => ph.poseId === p.id);
              return (
                <TouchableOpacity key={p.id}
                  style={[s.poseTab, i === currentPoseIndex && s.poseTabActive, done && s.poseTabDone]}
                  onPress={() => setCurrentPoseIndex(i)}
                  activeOpacity={0.8}
                  accessibilityRole="tab"
                  accessibilityLabel={`Foto ${i + 1} de ${POSES.length}: ${p.label}${done ? '. Ya tomada' : '. Pendiente'}`}
                  accessibilityState={{ selected: i === currentPoseIndex }}>
                  <Text style={s.poseTabEmoji}>{done ? '✅' : p.emoji}</Text>
                  <Text style={[s.poseTabLabel, i === currentPoseIndex && { color: Colors.accent }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Preview o guía */}
          {photoForCurrentPose ? (
            <View style={s.photoPreviewWrap}>
              <Image source={{ uri: photoForCurrentPose.uri }} style={s.previewImg} />
              <View style={s.checkBadge}>
                <Text style={{ fontSize: 20 }}>✅</Text>
              </View>
            </View>
          ) : (
            <View style={s.poseGuide}>
              <Text style={{ fontSize: 72 }}>🧍</Text>
              <Text style={s.poseGuideName}>{currentPose.label}</Text>
              <Text style={s.poseGuideInstr}>{currentPose.instruction}</Text>
            </View>
          )}

          {/* Estado de validación */}
          {validating && (
            <View style={s.validatingBanner}>
              <ActivityIndicator color={Colors.accent} size="small" />
              <Text style={s.validatingTxt}>Verificando que la foto sea correcta...</Text>
            </View>
          )}

          {/* Instrucciones */}
          <View style={s.instructCard}>
            <Text style={s.instructTitle}>💡 Para mejores resultados</Text>
            {[
              'Cuerpo completo visible — de cabeza a pies',
              'Buena iluminación, fondo simple si es posible',
              'Ropa ajustada deportiva',
              'Postura natural, sin exagerar ni meter barriga',
            ].map((tip, i) => (
              <Text key={i} style={s.instructItem}>✓  {tip}</Text>
            ))}
          </View>

          {/* Botón principal */}
          <TouchableOpacity
            style={[s.primaryBtn, validating && { opacity: 0.6 }]}
            onPress={takePhoto}
            disabled={validating}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={validating
              ? 'Validando la foto, espera un momento'
              : `${photoForCurrentPose ? 'Repetir' : 'Tomar'} la foto de ${currentPose.label}`}
            accessibilityState={{ disabled: validating, busy: validating }}>
            {validating ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#0a0a0b" size="small" />
                <Text style={s.primaryBtnTxt}>Validando foto...</Text>
              </View>
            ) : (
              <Text style={s.primaryBtnTxt}>
                {photoForCurrentPose ? '📷  REPETIR FOTO' : '📷  TOMAR FOTO'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Navegación entre poses */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {currentPoseIndex > 0 && (
              <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]}
                onPress={() => setCurrentPoseIndex(currentPoseIndex - 1)}
                accessibilityRole="button"
                accessibilityLabel={`Ir a la foto anterior: ${POSES[currentPoseIndex - 1].label}`}>
                <Text style={s.secondaryBtnTxt}>← Anterior</Text>
              </TouchableOpacity>
            )}
            {currentPoseIndex < POSES.length - 1 ? (
              <TouchableOpacity
                style={[s.secondaryBtn, { flex: 1 }, !photoForCurrentPose && { opacity: 0.4 }]}
                onPress={() => { if (photoForCurrentPose) setCurrentPoseIndex(currentPoseIndex + 1); }}
                disabled={!photoForCurrentPose}
                accessibilityRole="button"
                accessibilityLabel={`Ir a la siguiente foto: ${POSES[currentPoseIndex + 1].label}`}
                accessibilityState={{ disabled: !photoForCurrentPose }}>
                <Text style={s.secondaryBtnTxt}>Siguiente →</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.primaryBtn, { flex: 1, marginBottom: 0 }, photos.length === 0 && { opacity: 0.4 }]}
                onPress={analyze}
                disabled={photos.length === 0}
                accessibilityRole="button"
                accessibilityLabel="Analizar mis fotos"
                accessibilityState={{ disabled: photos.length === 0 }}>
                <Text style={s.primaryBtnTxt}>ANALIZAR ✓</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Analizar con fotos parciales */}
          {photos.length > 0 && currentPoseIndex < POSES.length - 1 && (
            <TouchableOpacity style={[s.secondaryBtn, { marginTop: 6 }]} onPress={analyze}
              accessibilityRole="button"
              accessibilityLabel={`Analizar ahora con las ${photos.length} foto${photos.length > 1 ? 's' : ''} que ya tomaste`}>
              <Text style={s.secondaryBtnTxt}>
                Analizar con {photos.length} foto{photos.length > 1 ? 's' : ''} disponible{photos.length > 1 ? 's' : ''} →
              </Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── ANALIZANDO ───────────────────────────────────────
  if (phase === 'analyzing') {
    return (
      <SafeAreaView style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={s.analyzingBox}>
          <ActivityIndicator color={Colors.accent} size="large" />
          <Text style={s.analyzingTitle}>Analizando tu cuerpo</Text>
          <Text style={s.analyzingMsg}>
            GPT-4o evaluando {photos.length} foto{photos.length > 1 ? 's' : ''}{'\n'}
            con expertise de coach profesional...
          </Text>
          {[
            'Detectando composición corporal...',
            'Identificando zonas musculares...',
            'Comparando con escáner anterior...',
            'Generando plan personalizado...',
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
      result.overall_score >= 80 ? Colors.accent :
      result.overall_score >= 60 ? Colors.warning : Colors.error;
    const scoreDelta = previousScan ? result.overall_score - previousScan.overall_score : 0;

    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={reset}
            accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>TU ANÁLISIS</Text>
          <TouchableOpacity onPress={() => { setPhase('capture'); setPhotos([]); setCurrentPoseIndex(0); }}
            accessibilityRole="button" accessibilityLabel="Empezar un nuevo escaneo">
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>Nuevo scan</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.lg }}>

          {/* Score */}
          <View style={s.scoreCard}>
            <View style={s.scoreCircleWrap}>
              <Text style={[s.scoreNum, { color: scoreColor }]}>{result.overall_score}</Text>
              <Text style={s.scoreDen}>/100</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.scoreLevel}>{result.estimated_muscle_level.toUpperCase()}</Text>
              {/* Se muestra la banda, no el número: el valor exacto que devuelve la
                  IA se guarda para poder comparar escaneos, pero enseñarlo como
                  dato cerrado vendería una precisión que la foto no tiene. */}
              <Text style={s.scoreFat}>{fatPctRange(result.estimated_fat_pct)} grasa estimada</Text>
              <Text style={s.scoreFatNote}>
                Es un rango, no un dato exacto: una foto sin calibrar no permite más precisión.
              </Text>
              {previousScan && (
                <View style={{ marginTop: 6, gap: 2 }}>
                  <Text style={{ fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted }}>
                    Anterior: {previousScan.overall_score}/100 · {fatPctRange(previousScan.estimated_fat_pct)} grasa
                  </Text>
                  {/* Diferencia descriptiva. Antes decía "↑ Progresando" / "↓ A trabajar
                      más": un juicio sobre el usuario a partir de dos fotos que pueden
                      diferir solo por la luz. Ahora se reporta el cambio y se explica. */}
                  <Text style={{
                    fontFamily: Fonts.bodySemi, fontSize: 12,
                    color: scoreDelta >= 0 ? Colors.accent : Colors.textSecondary,
                  }}>
                    {scoreDelta === 0
                      ? 'Mismo score que el escáner anterior'
                      : `${scoreDelta > 0 ? '+' : '−'}${Math.abs(scoreDelta)} pts vs. el escáner anterior`}
                  </Text>
                  <Text style={s.scoreFatNote}>
                    Variaciones pequeñas son normales: agua, sodio, ciclo, hora del día e iluminación de la foto.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Mensaje del coach — descriptivo, no evaluativo */}
          <View style={s.motivationCard}>
            <View style={s.aiDotRow}>
              <View style={s.aiDot} />
              <Text style={s.aiDotLbl}>COACH IA · LO QUE MUESTRAN TUS FOTOS</Text>
            </View>
            <Text style={s.motivationTxt}>"{result.motivation}"</Text>
          </View>

          {/* Fortalezas */}
          <Text style={s.sectionLbl}>💪 TUS FORTALEZAS</Text>
          <View style={s.card}>
            {result.strengths.map((str, i) => (
              <View key={i} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Text style={s.listIcon}>✅</Text>
                <Text style={s.listTxt}>{str}</Text>
              </View>
            ))}
          </View>

          {/* Zonas a enfocar */}
          <Text style={s.sectionLbl}>🎯 ZONAS A ENFOCAR EN TU PLAN</Text>
          <View style={s.card}>
            {result.focus_areas.map((area, i) => (
              <View key={i} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Text style={s.listIcon}>→</Text>
                <Text style={s.listTxt}>{area}</Text>
              </View>
            ))}
          </View>

          {/* Análisis por zona */}
          <Text style={s.sectionLbl}>🔍 ANÁLISIS DETALLADO POR ZONA</Text>
          {result.zones.map((z, i) => {
            const cfg = STATUS_CONFIG[z.status];
            return (
              <View key={i} style={[s.zoneCard, { backgroundColor: cfg.bg, borderColor: cfg.color + '44' }]}>
                <View style={s.zoneTop}>
                  <Text style={s.zoneIcon}>{cfg.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text style={[s.zoneLabel, { color: cfg.color }]}>{z.label}</Text>
                      <View style={[s.zoneBadge, { backgroundColor: cfg.color + '22' }]}>
                        <Text style={[s.zoneBadgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                    </View>
                    <Text style={s.zoneMessage}>{z.message}</Text>
                  </View>
                </View>
                {z.status !== 'strength' && (
                  <View style={[s.zoneFix, { borderLeftColor: cfg.color }]}>
                    <Text style={s.zoneFixLabel}>FIX →</Text>
                    <Text style={s.zoneFixTxt}>{z.tip}</Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* Ajustes al plan */}
          <Text style={s.sectionLbl}>📋 AJUSTES A TU PLAN DE ENTRENAMIENTO</Text>
          <View style={s.card}>
            <Text style={[s.listTxt, { padding: Spacing.md, lineHeight: 22 }]}>
              {result.refined_plan_notes}
            </Text>
          </View>

          {/* Predicción */}
          <Text style={s.sectionLbl}>🔮 PREDICCIÓN A 30 DÍAS</Text>
          <View style={s.predictionCard}>
            <Text style={s.predictionTxt}>{result.prediction_30days}</Text>
            <Text style={s.predictionDisclaimer}>
              * Estimación basada en análisis visual. Los resultados dependen de tu consistencia y adherencia al plan. No es un diagnóstico médico.
            </Text>
          </View>

          {/* Recuperación */}
          <Text style={s.sectionLbl}>🧘 RECUPERACIÓN Y ESTIRAMIENTOS</Text>
          <View style={s.card}>
            {result.recovery_tips.map((tip, i) => (
              <View key={i} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Text style={s.listIcon}>•</Text>
                <Text style={s.listTxt}>{tip}</Text>
              </View>
            ))}
          </View>

          {/* Sueño */}
          <Text style={s.sectionLbl}>😴 SUEÑO Y DESCANSO</Text>
          <View style={s.card}>
            {result.sleep_tips.map((tip, i) => (
              <View key={i} style={[s.listRow, i > 0 && s.rowBorder]}>
                <Text style={s.listIcon}>🌙</Text>
                <Text style={s.listTxt}>{tip}</Text>
              </View>
            ))}
          </View>

          {/* Privacidad */}
          <View style={s.privacyNote}>
            <Text style={s.privacyNoteTxt}>
              🔒 Tus fotos no fueron almacenadas en ningún servidor. Solo guardamos los datos numéricos del análisis.
            </Text>
          </View>

          <ReportContentButton feature="body_scan" content={JSON.stringify(result)} />

          <TouchableOpacity style={s.primaryBtn}
            onPress={() => router.replace('/(tabs)' as any)} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Ver mi dashboard">
            <Text style={s.primaryBtnTxt}>VER MI DASHBOARD →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn}
            onPress={() => { setPhase('capture'); setPhotos([]); setCurrentPoseIndex(0); }} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Hacer un nuevo análisis corporal">
            <Text style={s.secondaryBtnTxt}>Hacer nuevo análisis</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  secondaryBtn: { borderRadius: Radii.lg, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary },
  consentHero: { alignItems: 'center', paddingVertical: Spacing.xl },
  consentTitle: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.textPrimary, textAlign: 'center', lineHeight: 42, marginTop: 12 },
  infoCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  infoCardTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textPrimary, marginBottom: 12 },
  infoCardDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  checkRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  checkMark: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.accent, marginTop: 1 },
  checkTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 19 },
  poseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  poseRowName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  poseRowInstr: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  poseNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  poseNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textMuted },
  tipBox: { backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 10, marginTop: 12 },
  tipTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  poseTabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  poseTab: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, padding: 10, alignItems: 'center' },
  poseTabActive: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  poseTabDone: { borderColor: Colors.accentDark },
  poseTabEmoji: { fontSize: 20, marginBottom: 4 },
  poseTabLabel: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  photoPreviewWrap: { alignItems: 'center', marginBottom: 12 },
  previewImg: { width: '100%', height: 320, borderRadius: Radii.xl },
  checkBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: Colors.bg, borderRadius: 20, padding: 4 },
  poseGuide: { height: 280, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 12, gap: 8 },
  poseGuideName: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary },
  poseGuideInstr: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: Spacing.lg },
  validatingBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgSelected, borderRadius: Radii.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.accentBorder },
  validatingTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.accent },
  instructCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  instructTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary, marginBottom: 8 },
  instructItem: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 24 },
  analyzingBox: { alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: Radii.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.border, marginHorizontal: Spacing.lg },
  analyzingTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, marginTop: 16, marginBottom: 6 },
  analyzingMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  analyzingStep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, alignSelf: 'flex-start' },
  analyzingDot: { width: 8, height: 8, borderRadius: 4 },
  analyzingStepTxt: { fontFamily: Fonts.body, fontSize: 12 },
  scoreCard: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  scoreCircleWrap: { alignItems: 'center' },
  scoreNum: { fontFamily: Fonts.heading, fontSize: 56, lineHeight: 56 },
  scoreDen: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  scoreLevel: { fontFamily: Fonts.headingBold, fontSize: 20, color: Colors.textPrimary, marginBottom: 4 },
  scoreFat: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  scoreFatNote: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, lineHeight: 15, marginTop: 2 },
  motivationCard: { backgroundColor: Colors.bgSelected, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: 12 },
  aiDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  aiDotLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, letterSpacing: 0.8 },
  motivationTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary, lineHeight: 22, fontStyle: 'italic' },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 8 },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: 12 },
  listRow: { flexDirection: 'row', gap: 10, padding: Spacing.md, alignItems: 'flex-start' },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  listIcon: { fontSize: 16, marginTop: 1 },
  listTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  zoneCard: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.md, marginBottom: 8 },
  zoneTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  zoneIcon: { fontSize: 18, marginTop: 2 },
  zoneLabel: { fontFamily: Fonts.headingSemi, fontSize: 16 },
  zoneBadge: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 2 },
  zoneBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, letterSpacing: 0.4 },
  zoneMessage: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  zoneFix: { marginTop: 10, borderLeftWidth: 2, paddingLeft: 10 },
  zoneFixLabel: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  zoneFixTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  predictionCard: { backgroundColor: Colors.accentMuted, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: 12 },
  predictionTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary, lineHeight: 22, marginBottom: 8 },
  predictionDisclaimer: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, lineHeight: 17 },
  privacyNote: { backgroundColor: Colors.bgCard, borderRadius: Radii.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  privacyNoteTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  privacyModal: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl, maxHeight: '80%' },
  privacyTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, marginBottom: Spacing.lg },
  privacyTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 22 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: Spacing.md, paddingHorizontal: 2 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkboxMark: { fontFamily: Fonts.headingBold, fontSize: 14, color: '#0a0a0b' },
  consentRowTxt: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  disclaimerTxt: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center', lineHeight: 15, marginTop: Spacing.md, marginBottom: 20 },
});
