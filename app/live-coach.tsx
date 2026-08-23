// app/live-coach.tsx
// ─────────────────────────────────────────────────────────
// Coach en VIVO: cuenta reps y corrige técnica en tiempo real.
// Usa la cámara + MoveNet (PoseCamera) cuando está disponible; si el
// modelo o la cámara fallan, cae automáticamente al motor con pose
// simulada — la misma lógica en ambos casos.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import PoseCamera from '../Components/PoseCamera';
import { usePoseStream } from '../lib/pose/usePoseStream';
import { getPoseExercise } from '../lib/pose/exercises';
import { initRepState, updateReps, type RepState, type RepPhase } from '../lib/pose/repCounter';
import { isPoseCameraMarkedUnsupported } from '../lib/pose/cameraSupport';
import {
  evaluarEncuadre, copyPreflight, resumirSesion, FRAMES_ESTABLES, type EstadoPreflight,
} from '../lib/pose/preflight';
import type { FormCue, Pose } from '../lib/pose/types';
import { speak, setVoiceEnabled } from '../lib/voice';
import { saveSetLogs } from '../lib/setLogs';
import { track } from '../lib/analytics';
import Icon from '../Components/Icon';
import { useSafeKeepAwake } from '../lib/useSafeKeepAwake';
import { useUserStore } from '../store/userStore';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';
import CameraDisclosureModal from '../Components/CameraDisclosureModal';
import CompuertaDeSalud from '../Components/CompuertaDeSalud';
import { hasSeenCameraDisclosure, markCameraDisclosureSeen } from '../lib/cameraConsent';

const OPTIONS = [
  { id: 'squat', emoji: '🦵', label: 'Sentadilla' },
  { id: 'pushup', emoji: '⬇️', label: 'Flexiones' },
  { id: 'lunge', emoji: '🚶', label: 'Zancada' },
  { id: 'biceps_curl', emoji: '💪', label: 'Curl bíceps' },
  { id: 'shoulder_press', emoji: '⬆️', label: 'Press hombro' },
];

const SEV_COLOR: Record<string, string> = { good: Colors.accent, warn: Colors.warning, error: Colors.error };

/**
 * El coach en vivo, YA con el tamizaje comprobado.
 *
 * Es función aparte para que nada de aquí dentro —ni la cámara, ni el modelo de
 * pose, ni el keep-awake— llegue a montarse antes de saber si esta persona
 * debería estar entrenando. Con un `if` dentro del propio componente, los hooks
 * de arriba ya habrían corrido.
 */
function LiveCoachContenido() {
  useSafeKeepAwake('live-coach'); // que la pantalla no se apague en plena serie
  const [exId, setExId] = useState('squat');
  // 'preflight' es la fase nueva: la cámara ya está encendida pero NO se cuenta
  // nada hasta que el encuadre sea válido. Antes se pasaba de "Empezar" a
  // contar de una, así que un mal encuadre se traducía en reps mal contadas
  // que además terminaban guardadas en el historial como reales.
  const [fase, setFase] = useState<'setup' | 'preflight' | 'live' | 'resumen'>('setup');
  const [reps, setReps] = useState(0);
  const [phase, setPhase] = useState<RepPhase>('up');
  const [cues, setCues] = useState<FormCue[]>([]);
  const [camUnavailable, setCamUnavailable] = useState(false);
  const [camPose, setCamPose] = useState<Pose | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [encuadre, setEncuadre] = useState<EstadoPreflight>('no_person');
  const [framesListos, setFramesListos] = useState(0);
  const disclosureResolver = useRef<((aceptado: boolean) => void) | null>(null);
  const [valoracion, setValoracion] = useState<boolean | null>(null);
  const framesTotalRef = useRef(0);      // frames procesados en la sesión
  const framesConPoseRef = useRef(0);    // …de los cuales había alguien en cuadro
  const cuesVistosRef = useRef<Map<string, number>>(new Map());
  const repRef = useRef<RepState>(initRepState());
  const lastCueRef = useRef<string>('');       // evita repetir el mismo cue de voz
  const minAngleRef = useRef<number>(999);     // ángulo mínimo alcanzado en la rep actual
  const profile = useUserStore((s: any) => s.profile);

  const cfg = getPoseExercise(exId);

  const active = fase === 'live';
  // La cámara se enciende ya en el preflight: sin preview no hay nada que
  // comprobar. Lo que el preflight NO hace es contar.
  const usingCamera = (fase === 'preflight' || fase === 'live') && !camUnavailable;

  // Simulación SOLO si la cámara real no está disponible.
  const { pose: simPose } = usePoseStream(active && camUnavailable);
  const pose = camUnavailable ? simPose : camPose;

  const listoParaEmpezar = encuadre === 'ready' && framesListos >= FRAMES_ESTABLES;
  const copyEncuadre = copyPreflight(encuadre);

  // Motor: procesa cada pose (venga de la cámara o del simulador).
  useEffect(() => {
    if (!active || !pose) return;

    // Calidad de detección: qué fracción de los frames trajo a una persona
    // reconocible. Se mide ANTES de los early-return, o solo contaríamos los
    // frames buenos y la calidad daría siempre 100%.
    framesTotalRef.current += 1;
    if (evaluarEncuadre(pose, exId) !== 'no_person') framesConPoseRef.current += 1;

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
      // Frecuencia por corrección, para el resumen: lo que más se repitió es
      // lo que de verdad hay que trabajar, no lo último que salió.
      cuesVistosRef.current.set(bad.message, (cuesVistosRef.current.get(bad.message) ?? 0) + 1);
      speak(bad.cue, { interrupt: true });
    } else if (!bad) {
      lastCueRef.current = ''; // resetea para que el próximo fallo se vuelva a decir
    }
  }, [pose, active, exId]);

  // Preflight: evalúa cada frame de la cámara y exige varios seguidos en
  // 'ready' antes de habilitar el botón. Un solo frame bueno haría que el
  // botón parpadeara mientras la persona se acomoda.
  useEffect(() => {
    if (fase !== 'preflight') return;
    const e = evaluarEncuadre(camPose, exId);
    setEncuadre(e);
    setFramesListos((n) => (e === 'ready' ? n + 1 : 0));
  }, [camPose, fase, exId]);

  // Si la cámara truena en pleno preflight no tiene sentido dejar al usuario
  // esperando un encuadre que nunca va a llegar: se pasa al modo simulado,
  // que es lo que ya hacía la app cuando la cámara no estaba disponible.
  useEffect(() => {
    if (fase === 'preflight' && camUnavailable) iniciarConteo();
  }, [fase, camUnavailable]);

  // El coach en vivo era el único flujo de cámara sin ningún aviso, y encima
  // es el que MENOS tiene que esconder: todo el análisis corre en el teléfono.
  // Decirlo explícitamente ("no sale nada de aquí") no es solo cumplimiento,
  // es la razón por la que alguien acepta apuntarse la cámara mientras entrena.
  async function asegurarDisclosure(): Promise<boolean> {
    if (await hasSeenCameraDisclosure('live_coach')) return true;
    return new Promise<boolean>((resolve) => {
      disclosureResolver.current = resolve;
      setShowDisclosure(true);
    });
  }

  async function aceptarDisclosure() {
    setShowDisclosure(false);
    await markCameraDisclosureSeen('live_coach');
    disclosureResolver.current?.(true);
    disclosureResolver.current = null;
  }

  function cancelarDisclosure() {
    setShowDisclosure(false);
    disclosureResolver.current?.(false);
    disclosureResolver.current = null;
  }

  // "Empezar" ya no arranca el conteo: enciende la cámara y entra al preflight.
  async function start() {
    if (!(await asegurarDisclosure())) return;
    setEncuadre('no_person');
    setFramesListos(0);
    // Si este dispositivo ya demostró que su cámara truena (crash nativo en
    // una sesión anterior), ir DIRECTO al modo simulado — sin reintento, sin
    // error. Tras actualizar la app se reintenta una vez (ver cameraSupport).
    const sinCamara = await isPoseCameraMarkedUnsupported();
    setCamUnavailable(sinCamara);
    if (sinCamara) { iniciarConteo(); return; } // sin cámara no hay nada que comprobar
    setFase('preflight');
  }

  function iniciarConteo() {
    repRef.current = initRepState();
    lastCueRef.current = '';
    minAngleRef.current = 999;
    framesTotalRef.current = 0;
    framesConPoseRef.current = 0;
    cuesVistosRef.current = new Map();
    setReps(0);
    setCues([]);
    setFase('live');
    setVoiceEnabled(voiceOn);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    speak('¡Empecemos! Cuando quieras.', { interrupt: true });
  }

  function cancelarPreflight() {
    setFase('setup');
    setCamPose(null);
    setFramesListos(0);
  }

  // Termina la sesión y pasa al RESUMEN. Antes guardaba de inmediato: un
  // conteo malo (encuadre flojo, detección intermitente) entraba al historial
  // y a los récords sin que el usuario pudiera decir nada. Ahora se guarda al
  // confirmar — y salir de la pantalla también guarda, para que irse sin
  // tocar nada no le borre las reps a nadie.
  function stopSession() {
    setFase('resumen');
    setValoracion(null);
  }

  const totalReps = repRef.current.reps;

  // Qué fracción de los frames trajo una pose usable y qué correcciones se
  // repitieron. Es lo único honesto que podemos decir sobre la fiabilidad del
  // conteo: si la cámara perdió a la persona la mitad del tiempo, el número
  // de abajo no es de fiar y hay que decirlo ANTES de que lo dé por bueno.
  const { calidad: calidadDeteccion, deteccionIncompleta, topCues } =
    resumirSesion(framesTotalRef.current, framesConPoseRef.current, cuesVistosRef.current);

  async function guardarYSalir() {
    const total = repRef.current.reps;
    // SOLO con cámara real: las reps del modo simulado son de demo y
    // contaminarían el historial y los récords.
    if (profile && total > 0 && !camUnavailable) {
      try {
        await saveSetLogs(profile.user_id, null, [
          { exercise_name: cfg.label, set_number: 1, weight_kg: null, reps: total },
        ]);
      } catch {
        // saveSetLogs ya lo reportó. Aquí solo hace falta no mentirle al
        // usuario: contó sus reps con la cámara y merecen no desaparecer sin
        // aviso. Antes esto era un .catch(() => {}) mudo.
        Alert.alert(
          'No pudimos guardar tus reps',
          `Contamos ${total} repeticiones de ${cfg.label}, pero no se pudieron guardar. Revisa tu conexión.`
        );
      }
    }
    volverAlInicio();
  }

  function descartarConteo() {
    // Que alguien diga "esto contó mal" es la señal más valiosa que puede dar
    // el coach en vivo, y hasta ahora no tenía dónde decirlo.
    track('live_coach_conteo_incorrecto', {
      ejercicio: exId,
      reps_contadas: repRef.current.reps,
      calidad_deteccion: Math.round(calidadDeteccion * 100),
      simulado: camUnavailable,
    });
    Alert.alert('Gracias', 'No lo guardamos en tu historial. Nos ayuda a mejorar el conteo.');
    volverAlInicio();
  }

  function volverAlInicio() {
    repRef.current = initRepState();
    setReps(0);
    setCues([]);
    setCamPose(null);
    framesConPoseRef.current = 0;
    framesTotalRef.current = 0;
    cuesVistosRef.current = new Map();
    setFase('setup');
  }

  function valorar(util: boolean) {
    setValoracion(util);
    track('live_coach_valoracion', {
      util,
      ejercicio: exId,
      reps_contadas: repRef.current.reps,
      calidad_deteccion: Math.round(calidadDeteccion * 100),
    });
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
          active={usingCamera}
          onPose={setCamPose}
          onUnavailable={() => setCamUnavailable(true)}
        />
        {/* Overlay */}
        <SafeAreaView style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={s.overlayHeader}>
            <TouchableOpacity style={s.overlayIconBtn} onPress={toggleVoice}
              accessibilityRole="switch"
              accessibilityLabel={voiceOn ? 'Indicaciones por voz activadas' : 'Silenciar indicaciones'}
              accessibilityState={{ checked: voiceOn }}>
              <Icon name={voiceOn ? 'volumen' : 'volumen-off'} color={voiceOn ? Colors.accent : Colors.textSecondary} size={22} />
            </TouchableOpacity>
          </View>

          {fase === 'preflight' && (
            <View style={s.preflightWrap} pointerEvents="box-none">
              {/* Silueta orientativa: dónde debería quedar el cuerpo. */}
              <View style={[s.silueta, listoParaEmpezar && { borderColor: Colors.accent }]} pointerEvents="none" />

              <View style={s.preflightCard} accessible accessibilityLiveRegion="polite"
                accessibilityLabel={`${copyEncuadre.titulo}. ${copyEncuadre.detalle}`}>
                <Text style={[s.preflightTitle, { color: listoParaEmpezar ? Colors.accent : Colors.warning }]}>
                  {listoParaEmpezar ? '✓ ' : ''}{copyEncuadre.titulo}
                </Text>
                <Text style={s.preflightMsg}>{copyEncuadre.detalle}</Text>
                <Text style={s.preflightNota}>
                  {cfg.label} · Todo se procesa en tu teléfono · Despeja el espacio a tu alrededor
                </Text>

                <TouchableOpacity
                  style={[s.startBtn, !listoParaEmpezar && s.startBtnOff]}
                  onPress={iniciarConteo}
                  disabled={!listoParaEmpezar}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Empezar a contar repeticiones"
                  accessibilityState={{ disabled: !listoParaEmpezar }}>
                  <Text style={[s.startTxt, !listoParaEmpezar && { color: Colors.textMuted }]}>
                    {listoParaEmpezar ? '▶  EMPEZAR' : 'AJUSTA EL ENCUADRE'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.preflightCancel} onPress={cancelarPreflight}
                  accessibilityRole="button" accessibilityLabel="Cancelar y volver">
                  <Text style={s.preflightCancelTxt}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {fase === 'live' && (
          <>
          {/* Live region: el contador solo cambia al completar una rep, así que
              anunciarlo no satura — es la única forma de seguir la cuenta sin ver. */}
          <View style={s.overlayTop} accessible accessibilityLiveRegion="polite"
            accessibilityLabel={`${reps} repeticiones. ${phase === 'down' ? 'Bajando' : 'Arriba'}`}>
            <Text style={s.overlayReps}>{reps}</Text>
            <Text style={s.overlayRepsLbl}>REPS · {phase === 'down' ? 'BAJANDO' : 'ARRIBA'}</Text>
          </View>
          {topCue && (
            <View style={[s.overlayCue, { borderColor: SEV_COLOR[topCue.severity] }]}
              accessible accessibilityLiveRegion="assertive"
              accessibilityLabel={`Corrección: ${topCue.cue}. ${topCue.message}`}>
              <Text style={[s.overlayCueBig, { color: SEV_COLOR[topCue.severity] }]}>{topCue.cue}</Text>
              <Text style={s.overlayCueMsg}>{topCue.message}</Text>
            </View>
          )}
          <TouchableOpacity style={s.overlayStop} onPress={stopSession}
            accessibilityRole="button" accessibilityLabel="Terminar la sesión en vivo">
            <Text style={s.overlayStopTxt}>Terminar</Text>
          </TouchableOpacity>
          </>
          )}
        </SafeAreaView>
      </View>
    );
  }

  // ── RESUMEN ──
  if (fase === 'resumen') {
    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>
          <Text style={s.resTitulo} accessibilityRole="header">SESIÓN TERMINADA</Text>

          <View style={s.resNumWrap} accessible
            accessibilityLabel={`${totalReps} repeticiones observadas de ${cfg.label}`}>
            {/* "Observadas", no "hechas": es lo que la cámara pudo contar, y
                esa distinción es justo lo que el usuario necesita para saber
                si fiarse del número. */}
            <Text style={s.resNum}>{totalReps}</Text>
            <Text style={s.resNumLbl}>repeticiones observadas de {cfg.label}</Text>
          </View>

          {camUnavailable && (
            <Text style={s.resAviso}>
              Fue una demostración sin cámara, así que estas reps no se guardan en tu historial.
            </Text>
          )}

          {!camUnavailable && deteccionIncompleta && (
            <Text style={s.resAviso}>
              La cámara te perdió de vista buena parte del tiempo ({Math.round(calidadDeteccion * 100)}%
              de detección), así que este conteo puede no ser exacto. Si no cuadra, dínoslo abajo.
            </Text>
          )}

          {topCues.length > 0 && (
            <View style={s.resCues}>
              <Text style={s.resCuesTitulo}>Lo que más se repitió</Text>
              {topCues.map((c) => (
                <Text key={c} style={s.resCue}>· {c}</Text>
              ))}
              {/* §15.4: esto es observación de TÉCNICA, no un diagnóstico.
                  Decirlo evita que alguien lea "rodilla" y entienda "lesión". */}
              <Text style={s.resCuesNota}>
                Son observaciones de tu técnica en cámara, no un diagnóstico. Si algo te duele,
                consulta a un profesional.
              </Text>
            </View>
          )}

          <View style={s.resValoracion}>
            <Text style={s.resValTitulo}>¿Te sirvió el coach en vivo?</Text>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                style={[s.resValBtn, valoracion === true && s.resValBtnSel]}
                onPress={() => valorar(true)}
                accessibilityRole="button" accessibilityLabel="Sí, me sirvió"
                accessibilityState={{ selected: valoracion === true }}>
                <Text style={s.resValTxt}>👍  Sí</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.resValBtn, valoracion === false && s.resValBtnSel]}
                onPress={() => valorar(false)}
                accessibilityRole="button" accessibilityLabel="No, no me sirvió"
                accessibilityState={{ selected: valoracion === false }}>
                <Text style={s.resValTxt}>👎  No</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={s.startBtn} onPress={guardarYSalir} activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={camUnavailable ? 'Terminar' : `Guardar ${totalReps} repeticiones en mi historial`}>
            <Text style={s.startTxt}>
              {camUnavailable || totalReps === 0 ? 'TERMINAR' : `GUARDAR ${totalReps} REPS`}
            </Text>
          </TouchableOpacity>

          {/* La salida que faltaba: poder decir que contó mal. Sin esto, un
              conteo erróneo entraba al historial y a los récords en silencio. */}
          {!camUnavailable && totalReps > 0 && (
            <TouchableOpacity style={s.resDescartar} onPress={descartarConteo}
              accessibilityRole="button" accessibilityLabel="El conteo estuvo mal, no guardarlo">
              <Text style={s.resDescartarTxt}>El conteo estuvo mal · no guardar</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── VISTA DE SELECCIÓN / SIMULADA ──
  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}
          accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle} accessibilityRole="header">COACH EN VIVO</Text>
        <TouchableOpacity style={s.back} onPress={toggleVoice}
          accessibilityRole="switch"
          accessibilityLabel={voiceOn ? 'Indicaciones por voz activadas' : 'Silenciar indicaciones'}
          accessibilityState={{ checked: voiceOn }}>
          <Icon name={voiceOn ? 'volumen' : 'volumen-off'} color={voiceOn ? Colors.accent : Colors.textSecondary} size={20} />
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
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: exId === o.id }}>
              <Text style={{ fontSize: 22 }}>{o.emoji}</Text>
              <Text style={[s.exChipTxt, exId === o.id && { color: Colors.accent }]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.repCard} accessible accessibilityLiveRegion="polite"
          accessibilityLabel={`${reps} repeticiones. ${phase === 'down' ? 'Bajando' : 'Arriba'}`}>
          <Text style={s.repNum}>{reps}</Text>
          <Text style={s.repLbl}>REPETICIONES</Text>
          <View style={[s.phasePill, { borderColor: phase === 'down' ? Colors.warning : Colors.accent }]}>
            <Text style={[s.phaseTxt, { color: phase === 'down' ? Colors.warning : Colors.accent }]}>
              {phase === 'down' ? '⬇ BAJANDO' : '⬆ ARRIBA'}
            </Text>
          </View>
        </View>

        {active && topCue && (
          <View style={[s.cueCard, { borderColor: SEV_COLOR[topCue.severity] + '55' }]}
            accessible accessibilityLiveRegion="assertive"
            accessibilityLabel={`Corrección: ${topCue.cue}. ${topCue.message}`}>
            <Text style={[s.cueBig, { color: SEV_COLOR[topCue.severity] }]}>{topCue.cue}</Text>
            <Text style={s.cueMsg}>{topCue.message}</Text>
          </View>
        )}

        {!active ? (
          <TouchableOpacity style={s.startBtn} onPress={start} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Empezar a contar repeticiones"
            accessibilityHint="Apoya el teléfono a 2 o 3 metros con tu cuerpo completo en cuadro">
            <Text style={s.startTxt}>▶  EMPEZAR</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.stopBtn} onPress={stopSession} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Terminar la sesión en vivo">
            <Text style={s.stopTxt}>Terminar</Text>
          </TouchableOpacity>
        )}

        <Text style={s.hint}>
          Apoya el teléfono a 2-3 m, de frente o de lado, con tu cuerpo completo en cuadro.
        </Text>
      </ScrollView>

      <CameraDisclosureModal
        visible={showDisclosure}
        subject="tu técnica en vivo"
        destino="local"
        title="Antes de encender la cámara"
        onAccept={aceptarDisclosure}
        onCancel={cancelarDisclosure}
      />
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
  exChipTxt: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  repCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.xl, padding: Spacing.xl, alignItems: 'center', marginBottom: 16 },
  repNum: { fontFamily: Fonts.heading, fontSize: 96, color: Colors.accent, lineHeight: 100 },
  repLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 1 },
  phasePill: { borderWidth: 1, borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 6, marginTop: 12 },
  phaseTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, letterSpacing: 0.6 },
  cueCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.lg, alignItems: 'center', marginBottom: 16 },
  cueBig: { fontFamily: Fonts.heading, fontSize: 32 },
  cueMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  startBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center' },
  startTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b', letterSpacing: 1 },
  startBtnOff: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.borderStrong },

  // ── Preflight ──
  preflightWrap: { flex: 1, justifyContent: 'flex-end' },
  silueta: {
    position: 'absolute', top: '10%', bottom: '28%', left: '22%', right: '22%',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 140, borderStyle: 'dashed',
  },
  preflightCard: {
    backgroundColor: 'rgba(10,10,11,0.92)',
    margin: Spacing.lg, padding: Spacing.lg, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  preflightTitle: { fontFamily: Fonts.heading, fontSize: 18, marginBottom: 4 },
  preflightMsg: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 20 },
  preflightNota: {
    fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted,
    marginTop: 8, marginBottom: Spacing.md, lineHeight: 17,
  },
  // ── Resumen ──
  resTitulo: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.textMuted, letterSpacing: 1, marginBottom: Spacing.md },
  resNumWrap: { alignItems: 'center', marginBottom: Spacing.lg },
  resNum: { fontFamily: Fonts.heading, fontSize: 72, color: Colors.accent },
  resNumLbl: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, textAlign: 'center', marginTop: -4 },
  resAviso: {
    fontFamily: Fonts.body, fontSize: Type.body, color: Colors.warning, lineHeight: 20,
    backgroundColor: 'rgba(255,180,84,0.10)', borderRadius: Radii.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  resCues: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  resCuesTitulo: { fontFamily: Fonts.bodySemi, fontSize: Type.bodyLg, color: Colors.textPrimary, marginBottom: 6 },
  resCue: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 20 },
  resCuesNota: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted, lineHeight: 17, marginTop: Spacing.sm },
  resValoracion: { marginBottom: Spacing.lg },
  resValTitulo: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textSecondary, marginBottom: Spacing.sm },
  resValBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard,
  },
  resValBtnSel: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  resValTxt: { fontFamily: Fonts.bodyMedium, fontSize: Type.bodyLg, color: Colors.textPrimary },
  resDescartar: { paddingVertical: 14, alignItems: 'center' },
  resDescartarTxt: { fontFamily: Fonts.bodyMedium, fontSize: Type.body, color: Colors.textMuted },

  preflightCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  preflightCancelTxt: { fontFamily: Fonts.bodyMedium, fontSize: Type.body, color: Colors.textMuted },
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

/**
 * COMPUERTA CLÍNICA. Esta pantalla no la tenía y la sesión de fuerza sí.
 *
 * La misma persona a la que app/workout-session.tsx le impedía empezar una
 * rutina —por dolor de pecho, mareos o restricción médica declarados en el
 * tamizaje— entraba aquí y hacía sentadillas contadas por voz, con la app
 * animándola. El bloqueo existía, pero solo en una de las dos puertas.
 *
 * Va fuera del componente y no dentro: así el tamizaje se resuelve ANTES de que
 * se monte la cámara.
 */
export default function LiveCoachScreen() {
  return (
    <CompuertaDeSalud titulo="SEGURIDAD DEL EJERCICIO">
      <LiveCoachContenido />
    </CompuertaDeSalud>
  );
}
