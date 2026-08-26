// __tests__/camaraNuncaFallaEnSilencio.test.ts
// ─────────────────────────────────────────────────────────
// Ninguna pantalla abre la cámara por su cuenta, y ninguna falla en silencio.
//
// De las cinco que llamaban a expo-image-picker directamente:
//   • body-scan y progress no capturaban NADA. Al fallar quedaba una promesa
//     rechazada sin dueño: se tocaba el botón y no ocurría nada.
//   • fridge-scan y food-scan hacían Alert.alert('Error', e.message) — o sea,
//     le enseñaban el texto crudo de una excepción de Java a alguien que
//     quería fotografiar su nevera.
//
// El fallo que lo destapó es de producción, en el build 23, sobre un Redmi con
// Android 15: Android destruye la Activity cuando necesita memoria y el
// lanzador de resultados de expo-image-picker se queda sin registrar. La
// siguiente foto revienta con IllegalStateException. No se arregla desde
// JavaScript —el registro es nativo— pero sí se puede explicar y ofrecer la
// galería, que usa otro contrato y suele sobrevivir.
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

const PANTALLAS = [
  ['app', 'body-scan.tsx'],
  ['app', 'food-scan.tsx'],
  ['app', 'fridge-scan.tsx'],
  ['app', '(tabs)', 'coach.tsx'],
  ['app', '(tabs)', 'progress.tsx'],
];

test('ninguna pantalla llama a launchCameraAsync ni a launchImageLibraryAsync', () => {
  const culpables: string[] = [];
  for (const p of PANTALLAS) {
    const codigo = leerCodigo(...p);
    if (/ImagePicker\.launch(Camera|ImageLibrary)Async/.test(codigo)) {
      culpables.push(p.join('/'));
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'abren la cámara por su cuenta y se saltan el manejo de errores compartido:\n  ' + culpables.join('\n  '),
  );
});

test('cada pantalla que pide una foto atiende los tres desenlaces', () => {
  // ok / cancelado / error. Olvidar el tercero es exactamente lo que hacía
  // body-scan: el error existía y no lo miraba nadie.
  for (const p of PANTALLAS) {
    const codigo = leerCodigo(...p);
    const nombre = p.join('/');
    // SIN `continue` si no usa el helper. Lo tenía, y con eso el test pasaba en
    // vacío: ninguna pantalla lo usaba, todas se saltaban, cero comprobaciones,
    // verde. Una pantalla que no lo use es exactamente el fallo a evitar.
    assert.ok(
      /tomarFoto\(|elegirDeGaleria\(/.test(codigo),
      `${nombre} no pasa por lib/camara: puede volver a fallar en silencio`,
    );
    assert.ok(/estado === 'cancelado'/.test(codigo), `${nombre} no distingue cancelar`);
    assert.ok(/estado === 'error'/.test(codigo), `${nombre} no mira el caso de error`);
    assert.ok(/avisarError\(/.test(codigo), `${nombre} detecta el error y no se lo dice a nadie`);
  }
});

test('el helper reconoce el lanzador sin registrar y ofrece la galería', () => {
  const camara = leerCodigo('lib', 'camara.ts');
  assert.ok(
    /unregistered ActivityResultLauncher/i.test(camara),
    'sin reconocer ese caso, el mensaje genérico manda a reintentar algo que va a volver a fallar',
  );
  assert.ok(/ofrecerGaleria/.test(camara), 'no hay salida alternativa');
});

test('el mensaje al usuario no contiene el error crudo', () => {
  // `Alert.alert('Error', e.message)` era el patrón: el texto de la excepción
  // llegaba entero a la pantalla.
  const camara = leerCodigo('lib', 'camara.ts');
  assert.ok(
    !/mensaje:\s*(e|err|error)\.message/.test(camara),
    'el mensaje del usuario sale de la excepción: eso enseña Java en una app de fitness',
  );
});

test('los fallos de cámara llegan a monitorización', () => {
  // Antes llegaban como onunhandledrejection, sin contexto de qué pantalla.
  const camara = leerCodigo('lib', 'camara.ts');
  assert.ok(/captureError\(e, \{ scope: 'camara'/.test(camara), 'el error se traga sin registrarlo');
});
