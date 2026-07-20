// app/live-coach.tsx
// ─────────────────────────────────────────────────────────
// Coach en VIVO: cuenta reps y corrige técnica en tiempo real.
// Usa la cámara + MoveNet (PoseCamera) cuando está disponible; si el
// modelo o la cámara fallan, cae automáticamente al motor con pose
// simulada — la misma lógica en ambos casos.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import PoseCamera from '../Components/PoseCamera';
import { usePoseStream } from '../lib/pose/usePoseStream';
import { getPoseExercise } from '../lib/pose/exercises';
import { initRepState, updateReps, type RepState, type RepPhase } from '../lib/pose/repCounter';
import { isPoseCameraMarkedUnsupported } from '../lib/pose/cameraSupport';
import type { FormCue, Pose } from '../lib/pose/types';
import { speak, setVoiceEnabled } from '../lib/voice';
import { saveSetLogs } from '../lib/setLogs';
import { useSafeKeepAwake } from '../lib/useSafeKeepAwake';
import { useUserStore } from '../store/userStore';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

const OPTIONS = [
  { id: 'squat', emoji: '🦵', label: 'Sentadilla' },
  { id: 'pushup', emoji: '⬇️', label: 'Flexiones' },
  { id: 'lunge', emoji: '🚶', label: 'Zancada' },
  { id: 'biceps_curl', emoji: '💪', label: 'Curl bíceps' },
  { id: 'shoulder_press', emoji: '⬆️', label: 'Press hombro' },
];

const SEV_COLOR: Record<string, string> = { good: Colors.accent, warn: '#ff9d3a', error: '#ff4444' };

export default function LiveCoachScreen() {
  useSafeKeepAwake('live-coach'); // que la pantalla no se apague en plena serie
  const [exId, setExId] = useState('squat');
  const [active, setActive] = useState(false);
  const [reps, setReps] = useState(0);
  const [phase, setPhase] = useState<RepPhase>('up');
  const [cues, setCues] = useState<FormCue[]>([]);
  const [camUnavailable, setCamUnavailable] = useState(false);
  const [camPose, setCamPose] = useState<Pose | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const repRef = useRef<RepState>(initRepState());
  const lastCueRef = useRef<string>('');       // evita repetir el mismo cue de voz
  const minAngleRef = useRef<number>(999);     // ángulo mínimo alcanzado en la rep actual
  const profile = useUserStore((s: any) => s.profile);

  const cfg = getPoseExercise(exId);

  // Simulación SOLO si la cámara real no está disponible.
  const { pose: simPose } = usePoseStream(active && camUnavailable);
  const usingCamera = active && !camUnavailable;
  const pose = camUnavailable ? simPose : camPose;

  // Motor: procesa cada pose (venga de la cámara o del simulador).
  useEffect(() => {
    if (!active || !pose) return;
    const angle = cfg.primaryAngle(pose);
    if (angle == null) return;
    const res = updateReps(repRef.current, angle, cfg.rep);
    repRef.current = res.state;
    setPhase(res.state.phase);
    minAngleRef.current = Math.min(minAngleRef.current, angle);
    if (res.justCompleted) {
      setReps(res.state.reps);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Profundidad por REP: si el punto más bajo no llegó al rango,
      // avisar una vez (no durante toda la subida, como antes).
      const shallow = minAngleRef.current > cfg.rep.downAngle + 15;
      minAngleRef.current = 999;
      if (shallow) {
        speak(`${res.state.reps}... más abajo`, { interrupt: true });
      } else {
        // Voz: cuenta la rep (cada 5, un empujón motivador).
        speak(res.state.reps % 5 === 0 ? `¡${res.state.reps}! Vamos` : String(res.state.reps));
      }
    }

    const newCues = cfg.form(pose, res.state.phase);
    setCues(newCues);

    // Voz: corrige solo cuando aparece un fallo NUEVO (no repite ni narra "bien").
    const bad = newCues.find((c) => c.severity === 'error') ?? newCues.find((c) => c.severity === 'warn');
    if (bad && bad.cue !== lastCueRef.current) {
      lastCueRef.current = bad.cue;
      speak(bad.cue, { interrupt: true });
    } else if (!bad) {
      lastCueRef.current = ''; // resetea para que el próximo fallo se vuelva a decir
    }
  }, [pose, active, exId]);

  async function start() {
    repRef.current = initRepState();
    lastCueRef.current = '';
    minAngleRef.current = 999;
    setReps(0);
    setCues([]);
    // Si este dispositivo ya demostró que su cámara truena (crash nativo en
    // una sesión anterior), ir DIRECTO al modo simulado — sin reintento, sin
    // error. Tras actualizar la app se reintenta una vez (ver cameraSupport).
    setCamUnavailable(await isPoseCameraMarkedUnsupported());
    setActive(true);
    setVoiceEnabled(voiceOn);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    speak('¡Empecemos! Cuando quieras.', { interrupt: true });
  }

  // Termina la sesión y guarda las reps contadas por la IA en el historial.
  // SOLO con cámara real: las reps del modo simulado son de demo y
  // contaminarían el historial y los récords.
  async function stopSession() {
    setActive(false);
    const total = repRef.current.reps;
    if (profile && total > 0 && !camUnavailable) {
      await saveSetLogs(profile.user_id, null, [
        { exercise_name: cfg.label, set_number: 1, weight_kg: null, reps: total },
      ]).catch(() => {});
    }
  }

  function toggleVoice() {
    const v = !voiceOn;
    setVoiceOn(v);
    setVoiceEnabled(v);
  }

  const topCue = cues.find((c) => c.severity === 'error') ?? cues.find((c) => c.severity === 'warn') ?? cues[0];

  // ── VISTA CON CÁMARA ACTIVA ──
  if (usingCamera) {
    return (
      <View style={s.container}>
        <PoseCamera
          active={active}
          onPose={setCamPose}
          onUnavailable={() => setCamUnavailable(true)}
        />
        {/* Overlay */}
        <SafeAreaView style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={s.overlayHeader}>
            <TouchableOpacity style={s.overlayIconBtn} onPress={toggleVoice} accessibilityLabel="Activar o silenciar voz">
              <Text style={{ fontSize: 20 }}>{voiceOn ? '🔊' : '🔇'}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.overlayTop}>
            <Text style={s.overlayReps}>{reps}</Text>
            <Text style={s.overlayRepsLbl}>REPS · {phase === 'down' ? 'BAJANDO' : 'ARRIBA'}</Text>
          </View>
          {topCue && (
            <View style={[s.overlayCue, { borderColor: SEV_COLOR[topCue.severity] }]}>
              <Text style={[s.overlayCueBig, { color: SEV_COLOR[topCue.severity] }]}>{topCue.cue}</Text>
              <Text style={s.overlayCueMsg}>{topCue.message}</Text>
            </View>
          )}
          <TouchableOpacity style={s.overlayStop} onPress={stopSession}>
            <Text style={s.overlayStopTxt}>Terminar</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── VISTA DE SELECCIÓN / SIMULADA ──
  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle}>COACH EN VIVO</Text>
        <TouchableOpacity style={s.back} onPress={toggleVoice} accessibilityLabel="Activar o silenciar voz">
          <Text style={{ fontSize: 18 }}>{voiceOn ? '🔊' : '🔇'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
        {active && camUnavailable && (
          <View style={s.previewBanner}>
            <Text style={s.previewTxt}>
              {__DEV__
                ? '👀 Modo simulado (cámara o modelo no disponibles). Coloca el modelo real en assets/models/ y reconstruye para usar la cámara.'
                : '👀 Modo demostración — la cámara no está disponible en este dispositivo, las reps mostradas son de ejemplo.'}
            </Text>
          </View>
        )}

        <View style={s.exRow}>
          {OPTIONS.map((o) => (
            <TouchableOpacity key={o.id}
              style={[s.exChip, exId === o.id && s.exChipSel]}
              onPress={() => { setExId(o.id); repRef.current = initRepState(); setReps(0); }}
              activeOpacity={0.85}>
              <Text style={{ fontSize: 22 }}>{o.emoji}</Text>
              <Text style={[s.exChipTxt, exId === o.id && { color: Colors.accent }]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.repCard}>
          <Text style={s.repNum}>{reps}</Text>
          <Text style={s.repLbl}>REPETICIONES</Text>
          <View style={[s.phasePill, { borderColor: phase === 'down' ? '#ff9d3a' : Colors.accent }]}>
            <Text style={[s.phaseTxt, { color: phase === 'down' ? '#ff9d3a' : Colors.accent }]}>
              {phase === 'down' ? '⬇ BAJANDO' : '⬆ ARRIBA'}
            </Text>
          </View>
        </View>

        {active && topCue && (
          <View style={[s.cueCard, { borderColor: SEV_COLOR[topCue.severity] + '55' }]}>
            <Text style={[s.cueBig, { color: SEV_COLOR[topCue.severity] }]}>{topCue.cue}</Text>
            <Text style={s.cueMsg}>{topCue.message}</Text>
          </View>
        )}

        {!active ? (
          <TouchableOpacity style={s.startBtn} onPress={start} activeOpacity={0.85}>
            <Text style={s.startTxt}>▶  EMPEZAR</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.stopBtn} onPress={stopSession} activeOpacity={0.85}>
            <Text style={s.stopTxt}>Terminar</Text>
          </TouchableOpacity>
        )}

        <Text style={s.hint}>
          Apoya el teléfono a 2-3 m, de frente o de lado, con tu cuerpo completo en cuadro.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  back: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  previewBanner: { backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.md, padding: 12, marginBottom: 16 },
  previewTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent, lineHeight: 17 },
  exRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  exChip: { flexBasis: '30%', flexGrow: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, padding: 10, alignItems: 'center', gap: 4 },
  exChipSel: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  exChipTxt: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  repCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.xl, padding: Spacing.xl, alignItems: 'center', marginBottom: 16 },
  repNum: { fontFamily: Fonts.heading, fontSize: 96, color: Colors.accent, lineHeight: 100 },
  repLbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 1 },
  phasePill: { borderWidth: 1, borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 6, marginTop: 12 },
  phaseTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, letterSpacing: 0.6 },
  cueCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.lg, alignItems: 'center', marginBottom: 16 },
  cueBig: { fontFamily: Fonts.heading, fontSize: 32 },
  cueMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  startBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center' },
  startTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b', letterSpacing: 1 },
  stopBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center' },
  stopTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 18 },
  // Overlay sobre la cámara
  overlayHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  overlayIconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(14,14,16,0.7)', alignItems: 'center', justifyContent: 'center' },
  overlayTop: { alignItems: 'center', marginTop: Spacing.sm },
  overlayReps: { fontFamily: Fonts.heading, fontSize: 88, color: '#fff', lineHeight: 92, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  overlayRepsLbl: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#fff', letterSpacing: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  overlayCue: { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: 'rgba(14,14,16,0.82)', borderWidth: 1, borderRadius: Radii.xl, paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center', maxWidth: '86%' },
  overlayCueBig: { fontFamily: Fonts.heading, fontSize: 30 },
  overlayCueMsg: { fontFamily: Fonts.body, fontSize: 12, color: '#e8e8e8', textAlign: 'center', marginTop: 4 },
  overlayStop: { position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: 'rgba(14,14,16,0.9)', borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 28, paddingVertical: 12 },
  overlayStopTxt: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
});
