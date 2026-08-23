// __tests__/readinessSinInventar.test.ts
// La pantalla de readiness arrancaba con los cuatro chips en 3 ("Media"), que es
// un valor real y salia MARCADO. Asi que parecia contestada antes de que nadie
// la contestara, y ese 3 se guardaba en workout_readiness y entraba en el
// promedio de recuperacion como si fuera una respuesta.
//
// Es el mismo fallo que ya se corrigio aguas abajo en lib/readinessMath.ts,
// donde promediar con `?? 3` convertia "no lo se" en "esta normal" y dejaba
// muertas las reglas que bajan el volumen. Corregirlo alli no servia de nada
// mientras la ENTRADA siguiera inventando el 3.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resumirReadiness, type FilaReadiness } from '../lib/readinessMath';

const sesion = leerCodigo('app', 'workout-session.tsx');

function leerCodigo(...p: string[]) {
  return fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('los cuatro campos arrancan sin respuesta', () => {
  // Comparación literal y no expresión regular: el tipo lleva un `|` y unos
  // corchetes, y escaparlos dentro de un RegExp construido con plantilla es
  // justo la clase de detalle que hace pasar un test sin comprobar nada.
  const CAMPOS = ['energyToday', 'sorenessToday', 'sleepToday', 'stressToday'];
  for (const campo of CAMPOS) {
    const setter = 'set' + campo[0].toUpperCase() + campo.slice(1);
    assert.ok(
      sesion.includes(`const [${campo}, ${setter}] = useState<number | null>(null)`),
      `${campo} debería arrancar en null: nadie ha contestado todavía`,
    );
  }
});

test('no se escribe fila si no contesto nada', () => {
  // Una fila de nulls no aporta y ensucia el conteo de sesiones con dato.
  assert.match(sesion, /const respondioAlgo =/);
  assert.match(sesion, /if \(respondioAlgo\) \{[\s\S]{0,200}workout_readiness/);
});

test('el neutro para adaptar la sesion NO se persiste', () => {
  // Usar 3 para decidir el volumen de HOY es una decision de comportamiento y
  // esta bien. Guardarlo es inventar un dato. Son dos cosas distintas y el
  // codigo tiene que distinguirlas.
  assert.match(sesion, /const energiaParaAdaptar = energyToday \?\? NEUTRO/);
  const iUpsert = sesion.indexOf("from('workout_readiness')");
  const trozo = sesion.slice(iUpsert, iUpsert + 400);
  assert.ok(
    !/ParaAdaptar/.test(trozo),
    'el valor neutro de adaptacion no puede llegar al guardado',
  );
  assert.match(trozo, /energy: energyToday/, 'se guarda la respuesta cruda, null incluido');
});

// ── Y que aguas abajo siga tratando el null como null ──

const fila = (p: Partial<FilaReadiness> = {}): FilaReadiness => ({
  energy: null, sleep_quality: null, soreness: null, stress: null, pain_new: null, ...p,
});

test('los nulls no diluyen la senal de quien si contesto', () => {
  // Dos sesiones de energia 2 y ocho sin dato: con `?? 3` salia 2.8 y no
  // disparaba la regla de <= 2. Omitiendolos sale 2.
  const filas = [fila({ energy: 2 }), fila({ energy: 2 }), ...Array(8).fill(fila())];
  assert.equal(resumirReadiness(filas)!.energy, 2);
});

test('un campo sin ningun dato queda undefined, no en 3', () => {
  const r = resumirReadiness([fila({ energy: 2 }), fila({ energy: 2 })])!;
  assert.equal(r.sleepQuality, undefined);
  assert.equal(r.stress, undefined);
});
