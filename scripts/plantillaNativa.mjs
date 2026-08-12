// scripts/plantillaNativa.mjs
// ─────────────────────────────────────────────────────────
// Versión EXACTA de la plantilla que `expo prebuild` usa para generar
// android/. Vive en su propio módulo porque la comparten dos sitios que tienen
// que estar de acuerdo:
//
//   - scripts/build-android.mjs, que se la pasa a prebuild con --template
//   - __tests__/firmaRelease.test.ts, cuyo snapshot de build.gradle salió de
//     esta versión concreta
//
// Sin fijarla, Expo descarga `expo-template-bare-minimum@sdk-54`, y `sdk-54`
// es un dist-tag MUTABLE: apunta hoy a una versión y mañana a otra. El mismo
// commit generaría proyectos nativos distintos según el día, y las expresiones
// regulares de plugins/withFirmaRelease.js podrían dejar de encontrar su ancla
// sin que nadie hubiera tocado el repositorio.
//
// Para subirla: cambia el número aquí, corre `npm run build:android`, y
// actualiza el snapshot del test con el build.gradle que salga.
// ─────────────────────────────────────────────────────────

export const PLANTILLA_NATIVA = '54.0.52';
