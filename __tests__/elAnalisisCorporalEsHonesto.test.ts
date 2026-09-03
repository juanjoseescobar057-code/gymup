// __tests__/elAnalisisCorporalEsHonesto.test.ts
// ─────────────────────────────────────────────────────────
// El análisis corporal se ARREGLA, no se apaga.
//
// La auditoría externa (P0.4) pedía desactivarlo en producción. Decisión del
// dueño del producto: se queda, y se hace honesto. Cuatro cosas concretas que
// sí eran ciertas:
//
//   1. El catch de la validación de foto aceptaba la imagen "sin comprobar"
//      ante CUALQUIER error, no solo sin red. Un 500 del proveedor o un JSON
//      que no encaja en el esquema entraban por ahí — o sea que el único caso
//      que la comprobación existe para evitar pasaba por la puerta de atrás.
//   2. El consentimiento decía "solo los resultados numéricos" y se guardan
//      además las zonas con su descripción y su consejo, las fortalezas, el
//      enfoque y las notas del plan. Texto de una IA sobre el cuerpo de alguien.
//   3. Se piden tres vistas y se puede analizar con una, pero el modelo recibía
//      las fotos sueltas y sin etiquetar: no sabía cuál era el frente ni cuáles
//      faltaban, y aun así puntuaba la espalda.
//   4. Comparaba con el escáner anterior sin tener aquella foto: solo dos
//      números, y el prompt le pedía "describe qué cambió".
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const bodyScan = leerCodigo('app', 'body-scan.tsx');
const safety = leerCodigo('lib', 'safety.ts');

// ── 1. Aceptar sin comprobar, solo sin red ──

test('solo un fallo de RED acepta la foto sin comprobar', () => {
  assert.match(bodyScan, /function esFalloDeRed/);
  assert.match(
    bodyScan,
    /\} else if \(esFalloDeRed\(e\)\) \{/,
    'la rama permisiva sigue siendo el else de todos los errores',
  );
});

test('un error CON respuesta no acepta la foto', () => {
  const i = bodyScan.indexOf('} else if (esFalloDeRed(e)) {');
  assert.ok(i > 0, 'no encontré la rama de red');
  const resto = bodyScan.slice(i, i + 1400);
  assert.match(resto, /No pudimos comprobar la foto/, 'no hay rama para el resto de errores');
  // Y que ese camino NO guarde la foto.
  const iElseFinal = resto.lastIndexOf('} else {');
  const bloqueFinal = resto.slice(iElseFinal);
  assert.ok(
    !/setPhotos\(/.test(bloqueFinal),
    'el error con respuesta sigue guardando la foto sin comprobar',
  );
});

// ── 2. El consentimiento dice lo que se guarda ──

test('el consentimiento enumera lo que de verdad se almacena', () => {
  for (const campo of ['zonas', 'fortalezas', 'notas']) {
    assert.ok(
      new RegExp(campo, 'i').test(safety),
      `el consentimiento no menciona "${campo}", y el insert sí lo guarda`,
    );
  }
  assert.ok(
    !/solo guarda los resultados\s*\n?\s*numéricos/i.test(safety),
    'sigue diciendo que solo guarda números',
  );
});

test('lo que se guarda y lo que se consiente no se han separado', () => {
  // El insert es la verdad. Si mañana escribe un campo más, el consentimiento
  // tiene que decirlo — y este test es lo único que lo va a recordar.
  const i = bodyScan.indexOf("from('body_scans').insert({");
  assert.ok(i > 0, 'no encontré el insert');
  const insert = bodyScan.slice(i, i + 600);
  for (const [columna, palabra] of [
    ['zones', 'zonas'],
    ['strengths', 'fortalezas'],
    ['focus_areas', 'enfocarme'],
    ['notes', 'notas'],
  ] as const) {
    if (insert.includes(columna + ':')) {
      assert.ok(
        new RegExp(palabra, 'i').test(safety),
        `el insert guarda "${columna}" y el consentimiento no lo menciona`,
      );
    }
  }
});

// ── 3. Las fotos van etiquetadas y se dice cuáles faltan ──

test('cada foto le llega al modelo con su vista', () => {
  assert.match(
    bodyScan,
    /Foto siguiente: vista \$\{pose\?\.label/,
    'las imágenes van sueltas: el modelo tiene que adivinar cuál es el frente',
  );
});

test('el modelo sabe qué vistas NO tiene', () => {
  assert.match(bodyScan, /const faltantes = POSES\.filter/);
  assert.match(
    bodyScan,
    /VISTAS QUE NO TIENES/,
    'se puede analizar con una foto y nada le impide puntuar la espalda',
  );
});

test('se sigue pudiendo analizar con fotos parciales', () => {
  // Obligar a las tres perdería a quien solo puede hacerse una. La honestidad
  // no es lo mismo que la exigencia.
  assert.match(bodyScan, /Toma al menos una foto para analizar/);
});

// ── 4. La comparación con el escáner anterior ──

test('el prompt dice que NO tiene la foto anterior', () => {
  assert.match(bodyScan, /NO tienes aquellas fotos y NO puedes verlas/);
  assert.match(
    bodyScan,
    /NO afirmes que algo se ve distinto/,
    'sigue pidiendo describir cambios visuales sin la imagen con la que compararlos',
  );
});

test('y encuadra la diferencia como lo que es', () => {
  assert.match(bodyScan, /iluminación, hora del día o retención de líquidos/);
});
