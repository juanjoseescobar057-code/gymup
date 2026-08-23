// __tests__/sentrySinDatosDeSalud.test.ts
// Sentry es un tercero, y esta app maneja tamizaje PAR-Q+, lesiones,
// condiciones medicas, peso, macros y estimaciones corporales. captureError
// acepta un objeto de contexto LIBRE y los errores de la base citan valores, asi
// que cualquiera de esas cosas podia salir del telefono sin querer.
//
// No habia ningun filtro. Mandar un trastorno de la conducta alimentaria
// declarado a un proveedor de observabilidad es un tratamiento de datos
// sensibles que nadie autorizo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { _sentryScrub } from '../lib/monitoring';

const { limpiar, limpiarTexto, limpiarEvento, esSensible } = _sentryScrub;

test('los campos de salud se reconocen como sensibles', () => {
  for (const k of ['conditions', 'injuries', 'parq_chest_pain', 'risk_level', 'health_profile']) {
    assert.ok(esSensible(k), `"${k}" deberia ser sensible`);
  }
});

test('el peso, los macros y la grasa estimada no salen', () => {
  const limpio = limpiar({
    weight_kg: 78,
    daily_calories: 2400,
    estimated_fat_pct: 21,
    conditions: ['trastorno_alimentario'],
  }) as Record<string, unknown>;
  for (const v of Object.values(limpio)) {
    assert.equal(v, '[oculto]');
  }
});

test('lo que NO es sensible sigue llegando', () => {
  // Un filtro que se lo lleva todo deja los errores sin diagnosticar.
  const limpio = limpiar({ scope: 'logMeal.insert', codigo: 42, ok: false }) as Record<string, unknown>;
  assert.equal(limpio.scope, 'logMeal.insert');
  assert.equal(limpio.codigo, 42);
  assert.equal(limpio.ok, false);
});

test('lo sensible anidado tampoco sale', () => {
  const limpio = limpiar({
    contexto: { perfil: { weight_kg: 78, edad: 30 } },
  }) as any;
  assert.equal(limpio.contexto.perfil.weight_kg, '[oculto]');
  assert.equal(limpio.contexto.perfil.edad, 30);
});

test('un objeto muy anidado no cuelga el envio', () => {
  // Un crash es cuando MAS falta hace que el reporte llegue.
  let profundo: any = 'fondo';
  for (let i = 0; i < 40; i++) profundo = { siguiente: profundo };
  assert.doesNotThrow(() => limpiar(profundo));
});

test('los correos y las imagenes en base64 se recortan del texto', () => {
  assert.match(limpiarTexto('fallo para ana@ejemplo.com al guardar'), /\[correo\]/);
  assert.match(limpiarTexto('data:image/jpeg;base64,AAAABBBBCCCC'), /\[imagen\]/);
});

test('del usuario solo viaja el id', () => {
  const e = limpiarEvento({ user: { id: 'abc', email: 'ana@ejemplo.com', username: 'ana' } })!;
  assert.deepEqual(e.user, { id: 'abc' });
});

test('el mensaje de la excepcion tambien se limpia', () => {
  const e = limpiarEvento({
    exception: { values: [{ value: 'no se pudo guardar ana@ejemplo.com' }] },
  })!;
  assert.match(e.exception.values[0].value, /\[correo\]/);
});

test('si la limpieza falla, el evento NO se manda', () => {
  // Un crash perdido es peor que nada; un dato de salud filtrado es peor que un
  // crash perdido.
  const trampa: any = {};
  Object.defineProperty(trampa, 'extra', {
    get() { throw new Error('boom'); },
    enumerable: true,
  });
  assert.equal(limpiarEvento(trampa), null);
});

test('el muestreo de trazas no es del 20%', () => {
  // A un millon de personas eso son doscientas mil trazas de rendimiento que
  // nadie lee y si se pagan. Los crashes van aparte y siguen al 100%.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'monitoring.ts'), 'utf8');
  assert.ok(!/tracesSampleRate: 0\.2,/.test(src), 'el muestreo sigue en 0.2');
  assert.match(src, /tracesSampleRate: __DEV__ \? 1\.0 : 0\.0\d/);
});
