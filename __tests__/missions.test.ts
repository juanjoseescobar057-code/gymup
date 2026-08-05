// __tests__/missions.test.ts
// Las misiones pagan XP, así que un conteo flojo es XP regalado — y uno
// estricto de más le quita a alguien algo que sí se ganó. Ambos lados duelen.
//
// El caso que motivó estos tests: la versión anterior contaba SESIONES, así
// que tres entrenos del mismo día completaban "entrena 3 veces" y la app
// celebraba como constancia lo que fue una sola tarde.

import test from 'node:test';
import assert from 'node:assert/strict';
import { contarMisiones, type ActividadSemana } from '../lib/missionsMath';

/** Timestamp local del día D de julio de 2026 a la hora dada. */
function t(dia: number, hora = 10): string {
  return new Date(2026, 6, dia, hora, 0, 0).toISOString();
}

const BASE: ActividadSemana = {
  entrenos: [],
  comidas: [],
  metaProteinaG: 150,
  diasTranscurridos: 5,
};

test('tres entrenos el MISMO día son un día, no tres', () => {
  const r = contarMisiones({ ...BASE, entrenos: [t(6, 7), t(6, 13), t(6, 20)] });
  assert.equal(r.planned_workouts, 1);
});

test('tres entrenos en días distintos son tres', () => {
  const r = contarMisiones({ ...BASE, entrenos: [t(6), t(8), t(10)] });
  assert.equal(r.planned_workouts, 3);
});

test('la proteína se cuenta por día cubierto, no por comidas registradas', () => {
  // Diez comidas el mismo día que suman la meta: es UN día, no diez.
  const comidas = Array.from({ length: 10 }, () => ({ logged_at: t(6), protein_g: 20 }));
  const r = contarMisiones({ ...BASE, comidas });
  assert.equal(r.protein_days, 1);
});

test('un día que no llega a la meta no cuenta', () => {
  const r = contarMisiones({
    ...BASE,
    comidas: [
      { logged_at: t(6), protein_g: 149 },   // se queda a 1g
      { logged_at: t(7), protein_g: 150 },   // justo
      { logged_at: t(8), protein_g: 200 },   // de sobra
    ],
  });
  assert.equal(r.protein_days, 2);
});

test('una meta de proteína en cero no da todos los días por cubiertos', () => {
  // Perfil a medio llenar: sin este guard, cualquier registro >= 0 pasaría.
  const r = contarMisiones({
    ...BASE, metaProteinaG: 0,
    comidas: [{ logged_at: t(6), protein_g: 10 }, { logged_at: t(7), protein_g: 5 }],
  });
  assert.equal(r.protein_days, 0);
});

test('proteína nula en un registro no rompe la suma', () => {
  const r = contarMisiones({
    ...BASE,
    comidas: [{ logged_at: t(6), protein_g: null }, { logged_at: t(6), protein_g: 160 }],
  });
  assert.equal(r.protein_days, 1);
});

test('no hacer NADA en toda la semana no cobra la misión de descanso', () => {
  // Premiar el sofá no es premiar la recuperación.
  const r = contarMisiones({ ...BASE, entrenos: [] });
  assert.equal(r.rest_day, 0);
});

test('entrenar y dejar un día libre sí cobra el descanso', () => {
  const r = contarMisiones({ ...BASE, entrenos: [t(6), t(8)], diasTranscurridos: 5 });
  assert.equal(r.rest_day, 1);
});

test('entrenar TODOS los días transcurridos no es descansar', () => {
  const r = contarMisiones({ ...BASE, entrenos: [t(6), t(7), t(8)], diasTranscurridos: 3 });
  assert.equal(r.rest_day, 0);
});

test('el lunes recién entrenado todavía no cuenta como descanso', () => {
  const r = contarMisiones({ ...BASE, entrenos: [t(6)], diasTranscurridos: 1 });
  assert.equal(r.rest_day, 0);
});

test('una semana vacía no regala ninguna misión', () => {
  const r = contarMisiones(BASE);
  assert.deepEqual(r, { planned_workouts: 0, protein_days: 0, rest_day: 0 });
});
