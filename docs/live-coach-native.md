# Live Coach — cableado nativo (MediaPipe / MoveNet)

El motor de análisis (`lib/pose/`) ya está completo y testeado. Lo único que
falta para la cámara en tiempo real es el **detector nativo**, que NO funciona
en Expo Go: requiere un **development build**.

## 1. Dependencias (en el dev build)

```bash
npx expo install react-native-vision-camera
npm i react-native-fast-tflite react-native-worklets-core --legacy-peer-deps
```

- `react-native-vision-camera` → acceso a frames de la cámara.
- `react-native-fast-tflite` → corre un modelo MoveNet/BlazePose (.tflite) dentro
  de un frame processor (worklet).
- `react-native-worklets-core` → ya está en el proyecto.

Descarga un modelo MoveNet Lightning `.tflite` y colócalo en `assets/models/`.

## 2. app.json

```jsonc
{
  "expo": {
    "plugins": [
      ["react-native-vision-camera", {
        "cameraPermissionText": "GymUp usa la cámara para corregir tu técnica en tiempo real."
      }]
    ]
  }
}
```

## 3. Frame processor → motor

El frame processor obtiene los keypoints y los adapta con `movenetToPose`,
que ya existe en `lib/pose/detector.ts`:

```tsx
import { useFrameProcessor } from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { movenetToPose } from '../lib/pose/detector';
import { runOnJS } from 'react-native-worklets-core';

const model = useTensorflowModel(require('../assets/models/movenet.tflite'));

const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const outputs = model.model?.runSync([/* tensor del frame */]);
  // outputs → array de 17 {x,y,score}
  const pose = movenetToPose(keypoints);
  runOnJS(onPose)(pose); // entrega la pose al hook usePoseStream
}, [model]);
```

## 4. Conectar al motor

1. En `lib/pose/detector.ts`, haz que `isLiveDetectorAvailable()` devuelva `true`
   cuando el módulo nativo esté presente.
2. En `lib/pose/usePoseStream.ts`, en el modo real (no simulado), suscríbete al
   `onPose` del frame processor y `setPose(pose)` en cada frame.
3. La pantalla `app/live-coach.tsx` ya consume el motor: contará reps y mostrará
   los cues de técnica automáticamente.

## Lo que ya está hecho y testeado (sin dev build)

- Geometría de ángulos articulares (`geometry.ts`).
- Contador de reps con histéresis (`repCounter.ts`).
- Reglas de técnica: valgo de rodilla, profundidad, alineación de cadera (`formChecks.ts`).
- Adaptador MoveNet→Pose (`detector.ts`).
- Pantalla funcional en modo vista previa (movimiento simulado) para validar todo el flujo.
- 12 tests del motor en `__tests__/pose.test.ts` y `__tests__/poseDetector.test.ts`.
