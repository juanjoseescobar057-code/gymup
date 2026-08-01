// Components/PoseCamera.tsx
// ─────────────────────────────────────────────────────────
// Cámara en tiempo real con detección de pose (MoveNet vía fast-tflite).
// Corre el modelo en un frame processor (worklet) con dos frenos: analiza a
// ~10 Hz (no en cada frame) y entrega la pose a JS solo cuando cambió lo
// suficiente como para mover el conteo o los cues. Si la cámara o el modelo
// fallan, llama a onUnavailable() para que la pantalla caiga al modo simulado.
//
// ⚠️ Solo funciona en un DEVELOPMENT/PRODUCTION build (no en Expo Go).
// ⚠️ Requiere el modelo en assets/models/movenet.tflite.
// ─────────────────────────────────────────────────────────

import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import {
  Camera, useCameraDevice, useCameraPermission, useFrameProcessor,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { movenetToPose } from '../lib/pose/detector';
import { MIN_SCORE, type Pose } from '../lib/pose/types';
import { markPoseCameraUnsupported } from '../lib/pose/cameraSupport';
import { captureError } from '../lib/monitoring';
import { Colors, Fonts, Radii } from '../constants/theme';

type Props = {
  active: boolean;
  onPose: (pose: Pose) => void;
  onUnavailable: (reason: string) => void;
};

// MoveNet SinglePose Lightning: entrada 192×192×3 uint8, salida 17×[y,x,score].
const INPUT = 192;

// Presupuesto de inferencia: ~10 análisis por segundo. Una repetición humana
// dura entre 0.5 y 2 s, así que a 10 Hz caen entre 5 y 20 muestras por rep —
// de sobra para ver el punto bajo y el alto. Correr el modelo en los 30-60
// frames que entrega la cámara no cuenta ni una rep más y sí quema batería,
// calienta el equipo (y al calentarse el sistema baja los fps igual) y satura
// el puente worklet→JS.
// 90 ms y no 100: solo se pueden saltar frames ENTEROS, y con la cámara a
// 30 fps (33 ms) un umbral de 100 ms dejaría pasar 1 de cada 4 (7.5 Hz),
// mientras que con 90 pasa 1 de cada 3 (~10 Hz reales).
const MIN_INTERVAL_MS = 90;

// Rejilla con la que se decide si la pose cambió DE VERDAD: 1/64 del encuadre
// (~1.5%). Por debajo de eso es temblor del modelo entre frames, no movimiento
// del usuario; un movimiento real recorre decenas de celdas.
const POSE_GRID = 64;

// Los fallos NATIVOS de vision-camera (ej. "Cannot get hybrid property", que
// varía por dispositivo/fabricante) explotan DURANTE el render — un try/catch
// o el useEffect de abajo no los alcanza; solo un Error Boundary los atrapa.
// Al atraparlo: se reporta y se dispara onUnavailable para que live-coach
// caiga al modo simulado en vez de tumbar la pantalla completa.
class CameraErrorBoundary extends Component<
  { onCrash: (reason: string) => void; children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    captureError(error, { component: 'PoseCamera', kind: 'camera_render_crash' });
    // Este dispositivo ya demostró que su cámara truena: no reintentar en
    // próximas sesiones (hasta la siguiente versión de la app).
    markPoseCameraUnsupported();
    this.props.onCrash('La cámara falló en este dispositivo.');
  }

  render() {
    if (this.state.crashed) return null; // live-coach ya cambió a modo simulado
    return this.props.children;
  }
}

export default function PoseCamera(props: Props) {
  return (
    <CameraErrorBoundary onCrash={props.onUnavailable}>
      <PoseCameraInner {...props} />
    </CameraErrorBoundary>
  );
}

function PoseCameraInner({ active, onPose, onUnavailable }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const model = useTensorflowModel(require('../assets/models/movenet.tflite'), []);
  const { resize } = useResizePlugin();
  const requestedRef = useRef(false);

  // Estado que sobrevive ENTRE frames. Tiene que ser shared value: el frame
  // processor corre en otro runtime y un useRef normal no cruza hasta allá.
  const lastAnalysisAt = useSharedValue(0);
  // Huella de la última pose ENTREGADA a JS. NaN = todavía no se entregó
  // ninguna (NaN !== NaN, así que la primera siempre pasa).
  const lastPoseKey = useSharedValue(NaN);

  // Pide permiso al montar (una sola vez).
  useEffect(() => {
    if (!hasPermission && !requestedRef.current) {
      requestedRef.current = true;
      requestPermission();
    }
  }, [hasPermission]);

  // Solo caemos a simulado por fallos REALES (modelo/cámara). El permiso
  // NO dispara onUnavailable: en el primer arranque hasPermission es false
  // mientras el diálogo está abierto, y antes eso mataba el modo cámara
  // permanentemente. Ahora mostramos la vista de permiso y esperamos.
  useEffect(() => {
    if (model.state === 'error') onUnavailable('No se pudo cargar el modelo de pose.');
    else if (device === undefined && hasPermission === true) {
      // dispositivo resuelto como inexistente con permiso ya concedido
      onUnavailable('No se encontró cámara.');
    }
  }, [model.state, device, hasPermission]);

  // Puente worklet→JS memoizado: recrearlo en cada render reconstruía el
  // frame processor continuamente (fugas + jank).
  const deliver = useMemo(
    () =>
      Worklets.createRunOnJS(
        (points: { x: number; y: number; score: number }[], aspect: number) => {
          onPose(movenetToPose(points, aspect));
        }
      ),
    [onPose]
  );

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (model.state !== 'loaded' || model.model == null) return;

    // Freno 1 — no analizar cada frame (ver MIN_INTERVAL_MS).
    // performance.now() es el reloj monótono en ms que el runtime de worklets
    // ya inyecta en este contexto. frame.timestamp NO sirve aquí: en Android
    // llega en nanosegundos y en iOS en milisegundos, así que un mismo umbral
    // significaría cosas distintas por plataforma.
    const now = performance.now();
    if (now - lastAnalysisAt.value < MIN_INTERVAL_MS) return;
    lastAnalysisAt.value = now;

    // Redimensiona el frame a la entrada del modelo (RGB uint8).
    const input = resize(frame, {
      scale: { width: INPUT, height: INPUT },
      pixelFormat: 'rgb',
      dataType: 'uint8',
    });

    // Los tipos de nitro declaran ArrayBuffer[]; en runtime acepta el
    // typed array del resize plugin. Casteamos para satisfacer TS.
    const outputs = model.model.runSync([input as unknown as ArrayBuffer]);
    const kps = new Float32Array(outputs[0]); // 17 × [y, x, score] = 51 valores

    // Huella de la pose sobre una rejilla fija: dos poses que caen en las
    // mismas celdas son, para el contador de reps y las reglas de técnica, la
    // MISMA pose. Se resume en un entero para no tener que guardar 39 flotantes
    // de estado compartido entre el worklet y JS.
    const points = [];
    let key = 0;
    for (let i = 0; i < 17; i++) {
      const y = kps[i * 3];
      const x = kps[i * 3 + 1];
      const score = kps[i * 3 + 2];
      points.push({ y, x, score });
      // Los keypoints 1..4 son ojos y orejas: movenetToPose los descarta, así
      // que su temblor no debe contar como cambio.
      if (i >= 1 && i <= 4) continue;
      key = (key * 31 + ((x * POSE_GRID) | 0)) | 0;
      key = (key * 31 + ((y * POSE_GRID) | 0)) | 0;
      // La visibilidad decide si la articulación entra en los ángulos: que
      // aparezca o desaparezca SÍ cambia el resultado, aunque no se mueva.
      key = (key * 31 + (score >= MIN_SCORE ? 1 : 0)) | 0;
    }

    // Freno 2 — misma huella ⇒ misma fase, mismas reps y mismos cues río
    // abajo. Entregarla sería cruzar el puente y forzar un re-render para
    // recalcular exactamente lo mismo. La rejilla es ABSOLUTA (no relativa a
    // la última entrega), así que un movimiento lento no se queda atascado:
    // en cuanto cruza una celda, se entrega.
    if (key === lastPoseKey.value) return;
    lastPoseKey.value = key;

    // El resize aplasta el frame a un cuadrado: pasamos el aspecto real
    // para des-distorsionar X antes de calcular ángulos articulares.
    deliver(points, frame.width / frame.height);
  }, [model, resize, deliver, lastAnalysisAt, lastPoseKey]);

  if (hasPermission !== true) {
    return (
      <View style={[StyleSheet.absoluteFill, s.center]}>
        <Text style={{ fontSize: 44, marginBottom: 12 }}>📷</Text>
        <Text style={s.msg}>
          GymUp necesita la cámara para contar tus reps y corregir tu técnica.
        </Text>
        <TouchableOpacity style={s.permBtn} onPress={() => requestPermission()} activeOpacity={0.85}>
          <Text style={s.permBtnTxt}>Conceder permiso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, s.center]}>
        <Text style={s.msg}>Buscando cámara…</Text>
      </View>
    );
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      frameProcessor={frameProcessor}
    />
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: Colors.bg },
  msg: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  permBtn: { marginTop: 16, backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingHorizontal: 24, paddingVertical: 12 },
  permBtnTxt: { fontFamily: Fonts.headingSemi, fontSize: 15, color: '#0a0a0b' },
});
