// __tests__/elPlanViejoSeRevalida.test.ts
// ─────────────────────────────────────────────────────────
// Cambiar la salud invalida el plan que ya tenías.
//
// No lo hacía. El plan se valida al generarse y ahí se queda; la pantalla de
// sesión comprobaba el riesgo GENERAL (evaluateWorkoutAccess) pero nunca
// revisaba ejercicio por ejercicio. Camino real y reproducible:
//
//   1. Se genera la rutina sin ninguna condición declarada.
//   2. Después la persona declara embarazo, hernia, hipertensión o cirugía.
//   3. En el aviso de regenerar elige "Después".
//   4. Abre su rutina de siempre y entrena.
//   5. El press de banca programado antes del embarazo sigue ahí, con su carga
//      y su RIR.
//
// El arreglo NO inventa reglas clínicas: pasa el día por el MISMO validador
// determinista que revisa los planes recién generados. Una segunda
// implementación de "qué está vetado" se desincroniza de la primera en el
// siguiente cambio, y este repositorio ya ha pagado tres veces esa factura.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { revalidarDiaDelPlan } from '../lib/revalidarDiaDelPlan';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const SANO = { injuries: [], conditions: [], equipment: 'gym', age: 30, saludDesconocida: false };

test('un ejercicio vetado por una condición NUEVA no sobrevive', () => {
  const dia = [
    { name: 'Sentadilla con salto', muscle_group: 'piernas', sets: 3, reps: '10', target_rir: 1 },
    { name: 'Curl con mancuerna', muscle_group: 'biceps', sets: 3, reps: '12', target_rir: 2 },
  ];
  const antes = revalidarDiaDelPlan(dia, SANO);
  assert.equal(antes.correcciones.length, 0, 'se corrigió algo sin condiciones declaradas');
  assert.equal(antes.ejercicios.length, 2);

  // Y ahora la misma rutina con embarazo declarado DESPUÉS.
  const despues = revalidarDiaDelPlan(dia, { ...SANO, conditions: ['embarazo'] });
  assert.ok(despues.correcciones.length > 0, 'el plan viejo pasó intacto con una condición nueva');
  const nombres = despues.ejercicios.map((e: any) => e.name);
  assert.ok(
    !nombres.includes('Sentadilla con salto'),
    'el ejercicio de impacto sigue en la sesión de alguien con embarazo declarado',
  );
});

test('sin condiciones nuevas el plan no se toca', () => {
  // El error simétrico sería peor: recortarle la rutina a quien no declaró nada.
  const dia = [{ name: 'Press de banca', muscle_group: 'pecho', sets: 4, reps: '8', target_rir: 2 }];
  const r = revalidarDiaDelPlan(dia, SANO);
  assert.equal(r.correcciones.length, 0);
  assert.deepEqual(r.ejercicios, dia);
  assert.equal(r.vacio, false);
});

test('si no queda ningún ejercicio se marca, no se entrena una lista vacía', () => {
  const dia = [{ name: 'Burpees', muscle_group: 'cuerpo completo', sets: 3, reps: '10' }];
  const r = revalidarDiaDelPlan(dia, { ...SANO, conditions: ['embarazo'] });
  if (r.ejercicios.length === 0) {
    assert.equal(r.vacio, true, 'se quedó sin ejercicios y no lo marcó');
  }
});

test('un día vacío de origen NO es "vacío" en el sentido peligroso', () => {
  // Un día de descanso no es un plan que la salud invalidó.
  const r = revalidarDiaDelPlan([], SANO);
  assert.equal(r.vacio, false);
});

test('un fallo del validador falla CERRADO', () => {
  // Un error inesperado no puede traducirse en "entrena lo que había": es
  // justo el caso en que no sabemos si es seguro.
  const codigo = leerCodigo('lib', 'revalidarDiaDelPlan.ts');
  const i = codigo.indexOf('} catch {');
  assert.ok(i > 0, 'no hay captura de errores');
  const bloque = codigo.slice(i, i + 200);
  assert.match(bloque, /vacio: true/, 'ante un error deja pasar el plan sin revisar');
});

// ── Que esté cableado en la pantalla, no solo escrito ──

test('la sesión revalida antes de enseñar nada', () => {
  const sesion = leerCodigo('app', 'workout-session.tsx');
  assert.match(sesion, /revalidarDiaDelPlan\(/, 'la sesión no revalida el día');
  assert.match(sesion, /const planExercises: any\[\] = revalidado\.ejercicios/);
});

test('la revalidación va ANTES de adaptar por tiempo y energía', () => {
  // adaptSessionExercises reparte y recorta lo que hay. Si corriera antes,
  // estaría repartiendo ejercicios que la salud de hoy ya no permite.
  const sesion = leerCodigo('app', 'workout-session.tsx');
  const iRevalida = sesion.indexOf('revalidarDiaDelPlan(');
  const iAdapta = sesion.indexOf('adaptSessionExercises(planExercises');
  assert.ok(iRevalida > 0 && iAdapta > 0, 'no encontré los dos pasos');
  assert.ok(iRevalida < iAdapta, 'se adapta por tiempo antes de revisar la salud');
});

test('la sesión usa la salud ACTUAL, no la del plan', () => {
  const sesion = leerCodigo('app', 'workout-session.tsx');
  const i = sesion.indexOf('revalidarDiaDelPlan(');
  const llamada = sesion.slice(i, i + 320);
  assert.match(llamada, /injuries,/);
  assert.match(llamada, /conditions,/);
  assert.match(llamada, /saludDesconocida: injuriesStatus !== 'ok'/);
});

test('si la salud se lleva el día entero, hay pantalla que lo explica', () => {
  const sesion = leerCodigo('app', 'workout-session.tsx');
  assert.match(sesion, /revalidado\.vacio && planExercisesCrudos\.length > 0/);
  assert.match(sesion, /ACTUALIZAR MI RUTINA/);
});
