// __tests__/evaluarModelos.test.ts
// El banco de pruebas de modelos (scripts/evaluar-modelos.mjs) extrae los
// prompts del codigo en cada ejecucion, para que no puedan quedarse viejos:
// comparar dos modelos con un prompt que ya no es el que usa la app no compara
// nada.
//
// Eso solo funciona mientras las anclas sigan apuntando al prompt. Al escribir
// el script, dos de las tres coincidian primero con el TIPO de TypeScript que
// esta 60 lineas mas arriba, y se extraia el archivo entero desde el principio.
// Un prompt de 3.860 caracteres que empieza por "import { useState }" no lo
// detecta nadie mirando un informe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const salida = execFileSync(
  process.execPath,
  ['scripts/evaluar-modelos.mjs', '--solo-prompts'],
  { cwd: process.cwd(), encoding: 'utf8' },
);

const FUNCIONES = ['Analisis de tecnica', 'Escaneo de comida', 'Escaneo de nevera'];

test('el banco de pruebas extrae los tres prompts', () => {
  // Se compara sin tildes para no depender de la codificacion de la consola.
  const limpia = salida.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const f of FUNCIONES) {
    assert.ok(limpia.includes(f), `no extrajo el prompt de "${f}"`);
  }
  assert.ok(!/FALLA/.test(salida), salida);
});

test('ninguno extrajo codigo en vez de un prompt', () => {
  // El aviso que imprime el propio script cuando lo extraido empieza por
  // import/const/export.
  assert.ok(!/parece codigo/i.test(salida.normalize('NFD').replace(/[̀-ͯ]/g, '')), salida);
});

test('los prompts tienen un tamano razonable', () => {
  // Un prompt de 20 caracteres seria un ancla que cayo en el sitio equivocado;
  // uno de 10.000, el archivo entero.
  const tamanos = [...salida.matchAll(/(\d+) caracteres/g)].map((m) => Number(m[1]));
  assert.equal(tamanos.length, FUNCIONES.length, 'faltan prompts en la salida');
  for (const n of tamanos) {
    assert.ok(n > 200, `un prompt de ${n} caracteres es demasiado corto: revisa el ancla`);
    assert.ok(n < 10000, `un prompt de ${n} caracteres es el archivo entero: revisa el ancla`);
  }
});
