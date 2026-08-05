// __tests__/warmup.test.ts
// El calentamiento se lo lee gente con hernias, embarazos y rodillas rotas.
// Un movimiento contraindicado aquí no es un bug de UI: es un consejo que
// puede lesionar a alguien. Estos tests existen para que el filtro no se
// afloje en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calentamientoPara,
  estiramientoPara,
  seriesDeAproximacion,
  type ContextoSalud,
} from '../lib/warmupMath';

const SANO: ContextoSalud = { injuries: [], conditions: [] };
const PIERNA = ['Cuádriceps', 'Glúteos'];
const TORSO = ['Espalda', 'Bíceps'];

function nombres(items: { nombre: string }[]): string[] {
  return items.map((i) => i.nombre);
}

test('un día de pierna calienta la pierna, no cualquier cosa', () => {
  const n = nombres(calentamientoPara(PIERNA, SANO));
  assert.ok(n.some((x) => /sentadilla/i.test(x)));
  assert.ok(n.some((x) => /tobillo/i.test(x)));
});

test('el calentamiento es dinámico y la vuelta a la calma estática', () => {
  // No es decoración: estirar estático a fondo ANTES de levantar resta fuerza.
  const cal = nombres(calentamientoPara(PIERNA, SANO));
  const est = nombres(estiramientoPara(PIERNA, SANO));
  assert.ok(!cal.some((x) => /estiramiento/i.test(x)), 'no debe haber estático al calentar');
  assert.ok(est.length > 0, 'debe haber estiramientos al terminar');
});

test('hernia discal: fuera toda flexión lumbar, al calentar y al estirar', () => {
  const ctx: ContextoSalud = { injuries: [], conditions: ['hernia_discal'] };
  const cal = nombres(calentamientoPara(TORSO, ctx));
  const est = nombres(estiramientoPara(PIERNA, ctx));
  assert.ok(!cal.some((x) => /gato-camello/i.test(x)));
  assert.ok(!est.some((x) => /isquiotibiales sentado/i.test(x)));
});

test('embarazo: nada boca arriba, nada de impacto', () => {
  const ctx: ContextoSalud = { injuries: [], conditions: ['embarazo'] };
  const cal = nombres(calentamientoPara(PIERNA, ctx));
  const est = nombres(estiramientoPara(PIERNA, ctx));
  assert.ok(!cal.some((x) => /puente de glúteos/i.test(x)), 'el puente es supino');
  assert.ok(!est.some((x) => /figura 4/i.test(x)), 'la figura 4 es supina');
});

test('rodilla lesionada: fuera la flexión profunda', () => {
  const ctx: ContextoSalud = { injuries: ['rodilla'], conditions: [] };
  const cal = nombres(calentamientoPara(PIERNA, ctx));
  assert.ok(!cal.some((x) => /sentadilla/i.test(x)));
  // Pero sigue habiendo calentamiento: no se le deja sin nada.
  assert.ok(cal.length > 0);
});

test('hombro lesionado: fuera lo que pasa por encima de la cabeza', () => {
  const ctx: ContextoSalud = { injuries: ['hombro'], conditions: [] };
  const est = nombres(estiramientoPara(['Pecho', 'Tríceps'], ctx));
  assert.ok(!est.some((x) => /sobre la cabeza/i.test(x)));
});

test('varias lesiones a la vez acumulan vetos, no se pisan', () => {
  const ctx: ContextoSalud = { injuries: ['rodilla', 'espalda_baja'], conditions: [] };
  const cal = nombres(calentamientoPara([...PIERNA, 'Espalda'], ctx));
  assert.ok(!cal.some((x) => /sentadilla/i.test(x)));
  assert.ok(!cal.some((x) => /gato-camello/i.test(x)));
});

test('si no se pudo leer la salud, se cae a lo más conservador', () => {
  // Fallar cerrado: sin saber qué tiene la persona, no se arriesga.
  const ctx: ContextoSalud = { injuries: [], conditions: [], desconocido: true };
  const cal = nombres(calentamientoPara(PIERNA, ctx));
  assert.ok(!cal.some((x) => /sentadilla/i.test(x)));
  assert.ok(cal.length > 0, 'aun así tiene que proponer algo');
});

test('NUNCA devuelve una lista vacía de calentamiento', () => {
  // Una lista vacía se leería como "hoy no hace falta calentar", que es justo
  // lo contrario de lo que queremos decirle a quien más cuidado necesita.
  const ctx: ContextoSalud = {
    injuries: ['rodilla', 'hombro', 'espalda_baja', 'cuello', 'muneca_codo', 'cadera', 'tobillo_pie'],
    conditions: ['embarazo', 'cardiopatia', 'asma', 'hernia_discal', 'cirugia_reciente', 'artritis'],
  };
  assert.ok(calentamientoPara(PIERNA, ctx).length > 0);
});

test('las series de aproximación nombran el ejercicio real del día', () => {
  const txt = seriesDeAproximacion('Peso muerto');
  assert.ok(txt);
  assert.match(txt!, /Peso muerto/);
  assert.match(txt!, /no cuentan/i);
});

test('sin ejercicio no se inventa una serie de aproximación', () => {
  assert.equal(seriesDeAproximacion(null), null);
});

test('un grupo muscular desconocido no rompe: queda el calentamiento general', () => {
  const cal = calentamientoPara(['Antebrazo de marciano'], SANO);
  assert.ok(cal.length > 0);
  assert.ok(nombres(cal).some((x) => /caminar/i.test(x)));
});

test('la vuelta a la calma tampoco queda nunca vacía', () => {
  // Un grupo que no reconocemos, o alguien con muchas restricciones, no puede
  // acabar sin ninguna indicación de cierre: el silencio se leería como
  // "hoy no hace falta estirar".
  const desconocido = estiramientoPara(['Antebrazo de marciano'], SANO);
  assert.ok(desconocido.length > 0);

  const restringido: ContextoSalud = {
    injuries: ['rodilla', 'hombro', 'espalda_baja', 'cadera'],
    conditions: ['embarazo', 'hernia_discal'],
  };
  assert.ok(estiramientoPara(PIERNA, restringido).length > 0);
});
