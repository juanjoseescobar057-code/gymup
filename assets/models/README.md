# Modelo de pose — MoveNet

Este archivo `movenet.tflite` es un **PLACEHOLDER**. Antes de reconstruir el
dev build, reemplázalo por el modelo real.

## Cuál descargar
**MoveNet SinglePose Lightning (int8 o fp16), formato `.tflite`.**
- Entrada: 192×192×3 (uint8)
- Salida: 1×1×17×3 → 17 keypoints [y, x, score] normalizados

## Dónde
- Kaggle Models (TensorFlow): busca **"MoveNet SinglePose Lightning"** → pestaña
  **TFLite** → descarga la variante `int8` o `fp16`.
  (https://www.kaggle.com/models/google/movenet)
- O TensorFlow Hub / cualquier mirror confiable del mismo modelo.

## Cómo instalarlo
1. Renombra el archivo descargado a **`movenet.tflite`**.
2. Reemplaza este archivo (`assets/models/movenet.tflite`) por el real.
3. Reconstruye el dev build (`eas build --profile development --platform android`).

Mientras sea el placeholder, el Coach en Vivo detecta que el modelo no es
válido y **cae automáticamente al modo simulado** (no crashea).
