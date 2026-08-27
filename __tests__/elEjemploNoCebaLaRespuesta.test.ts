// __tests__/elEjemploNoCebaLaRespuesta.test.ts
// ─────────────────────────────────────────────────────────
// El ejemplo de respuesta del análisis corporal no puede afirmar nada sobre
// el cuerpo de nadie.
//
// El prompt lleva un JSON de ejemplo para fijar el formato, y sus valores eran
// afirmaciones concretas: "simetría correcta entre ambos lados", "Buena
// simetría en hombros". Un modelo ante la duda copia lo que ve en el ejemplo,
// así que el prompt venía respondiendo por él.
//
// Se detectó probando: una persona con un hombro visiblemente más caído recibió
// "buena simetría". La MISMA foto, subida a ChatGPT sin este prompt, sí señaló
// la diferencia. No era el modelo: era nuestro ejemplo.
//
// Los valores de ejemplo describen ahora la FORMA de la respuesta ("Qué se
// observa en esta zona"), no su contenido.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const bodyScan = fs.readFileSync(path.join(process.cwd(), 'app', 'body-scan.tsx'), 'utf8');

test('el ejemplo no afirma simetría', () => {
  for (const frase of ['simetría correcta entre ambos lados', 'Buena simetría en hombros']) {
    assert.ok(
      !bodyScan.includes(frase),
      `el ejemplo sigue afirmando "${frase}": el modelo lo copia cuando duda`,
    );
  }
});

test('se pide explícitamente comparar los dos lados', () => {
  assert.match(
    bodyScan,
    /COMPARA LOS DOS LADOS/,
    'sin pedirlo, la asimetría se pierde: cada zona se describe por separado y nadie compara',
  );
});

test('la comparación va en las instrucciones, no en el ejemplo', () => {
  // En el ejemplo sería otra vez ceba. Tiene que ser una orden.
  // Dentro de analyzeBodyPhotos. Sin acotar cogía el "SOLO JSON" de
  // validatePhoto, que va antes en el archivo, y el test fallaba por eso y no
  // por lo que dice comprobar.
  const iFuncion = bodyScan.indexOf('async function analyzeBodyPhotos');
  assert.ok(iFuncion > 0, 'no encontré analyzeBodyPhotos');
  const prompt = bodyScan.slice(iFuncion);

  const iEjemplo = prompt.indexOf('SOLO JSON sin texto adicional');
  const iOrden = prompt.indexOf('COMPARA LOS DOS LADOS');
  assert.ok(iEjemplo > 0 && iOrden > 0, 'no encontré el ejemplo o la instrucción');
  assert.ok(iOrden < iEjemplo, 'la instrucción quedó dentro del JSON de ejemplo');
});

test('sigue prohibido tratar el cuerpo como un defecto', () => {
  // Pedir que señale asimetrías no puede abrir la puerta al lenguaje que el
  // resto del prompt lleva meses cerrando.
  assert.match(bodyScan, /nunca como defecto/i);
  assert.match(bodyScan, /Prohibido comparar el cuerpo del usuario con ideales/);
});
