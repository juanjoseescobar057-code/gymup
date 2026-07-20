// Components/PoseCamera.tsx
// ─────────────────────────────────────────────────────────
// Cámara en tiempo real con detección de pose (MoveNet vía fast-tflite).
// Corre el modelo en un frame processor (worklet) y entrega cada pose a
// JS mediante movenetToPose(). Si la cámara o el modelo fallan, llama a
// onUnavailable() para que la pantalla caiga al modo simulado.
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
import { Worklets } from 'react-native-worklets-core';
import { movenetToPose } from '../lib/pose/detector';
import type { Pose } from '../lib/pose/types';
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

    const points = [];
    for (let i = 0; i < 17; i++) {
      points.push({ y: kps[i * 3], x: kps[i * 3 + 1], score: kps[i * 3 + 2] });
    }
    // El resize aplasta el frame a un cuadrado: pasamos el aspecto real
    // para des-distorsionar X antes de calcular ángulos articulares.
    deliver(points, frame.width / frame.height);
  }, [model, resize, deliver]);

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
