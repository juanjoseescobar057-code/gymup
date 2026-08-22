// __tests__/readinessMath.test.ts
// Este módulo decide si el motor de progresión cree saber cómo llega la
// persona. Si convierte "no lo sé" en "está normal", las reglas que bajan el
// volumen por mala recuperación no se ejecutan nunca — y eso es exactamente lo
// que pasaba: adaptivePlan promediaba con `?? 3`, el valor neutro.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resumirReadiness,
  coberturaReadiness,
  calcularAdherencia,
  type FilaReadiness,
} from '../lib/readinessMath';

const fila = (p: Partial<FilaReadiness> = {}): FilaReadiness => ({
  energy: null, sleep_quality: null, soreness: null, stress: null, pain_new: null, ...p,
});

// ── Lo desconocido viaja como desconocido ──

test('sin ninguna sesión no se inventa una readiness', () => {
  assert.equal(resumirReadiness([]), undefined);
});

test('un campo sin ningún dato queda undefined, no en 3', () => {
  // El bug original: `?? 3` lo dejaba en el valor neutro y el motor creía saber.
  const r = resumirReadiness([fila({ energy: 2 }), fila({ energy: 2 })])!;
  assert.equal(r.energy, 2);
  assert.equal(r.sleepQuality, undefined);
  assert.equal(r.stress, undefined);
});

test('los nulos NO diluyen la señal de los que sí tienen dato', () => {
  // EL CASO EXACTO DEL BUG: dos sesiones de energía 2 y ocho sin dato.
  // Con `?? 3` salía 2.8 y no disparaba la regla de <= 2. Omitiéndolos, sale 2.
  const filas = [fila({ energy: 2 }), fila({ energy: 2 }), ...Array(8).fill(fila())];
  assert.equal(resumirReadiness(filas)!.energy, 2);
});

test('un dolor nuevo en cualquier sesión basta para señalarlo', () => {
  // Promediarlo lo apagaría, y es la única señal de aquí que es de salud.
  const r = resumirReadiness([fila(), fila({ pain_new: true }), fila(), fila()])!;
  assert.equal(r.painNew, true);
});

test('sin ningún dolor declarado no se señala', () => {
  assert.equal(resumirReadiness([fila(), fila({ pain_new: false })])!.painNew, false);
});

test('la cobertura dice cuánto sabemos de verdad', () => {
  assert.equal(coberturaReadiness([]), 0);
  assert.equal(coberturaReadiness([fila()]), 0);
  assert.equal(coberturaReadiness([fila({ energy: 3, sleep_quality: 4 })]), 0.5);
  assert.equal(
    coberturaReadiness([fila({ energy: 3, sleep_quality: 4, soreness: 2, stress: 1 })]),
    1,
  );
});

// ── Adherencia ──

const hoy = '2026-08-20T10:00:00.000Z';
const haceDias = (n: number) =>
  new Date(Date.parse('2026-08-20') - n * 86_400_000).toISOString();

test('con menos de dos semanas no se afirma nada', () => {
  // Una semana mala no es un patrón de adherencia, y recortarle el plan a
  // alguien por una gripe es castigarlo justo cuando peor lo está pasando.
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 4, sesionesCompletadas: [], semanas: 1, hoyISO: hoy,
  });
  assert.equal(r.pct, null);
});

test('sin plan de entreno tampoco: no hay contra qué medir', () => {
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 0, sesionesCompletadas: [haceDias(1)], semanas: 4, hoyISO: hoy,
  });
  assert.equal(r.pct, null);
});

test('cumplir todo da 100', () => {
  const sesiones = Array.from({ length: 16 }, (_, i) => haceDias(i + 1));
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 4, sesionesCompletadas: sesiones, semanas: 4, hoyISO: hoy,
  });
  assert.equal(r.sesionesEsperadas, 16);
  assert.equal(r.pct, 100);
});

test('la mitad da 50, que es lo que dispara la rama del motor', () => {
  const sesiones = Array.from({ length: 8 }, (_, i) => haceDias(i + 1));
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 4, sesionesCompletadas: sesiones, semanas: 4, hoyISO: hoy,
  });
  assert.equal(r.pct, 50);
  assert.ok(r.pct! < 70, 'por debajo de 70 el motor hace el plan más ejecutable');
});

test('entrenar de más no da más de 100', () => {
  // Dejarlo pasar haría que un mes bueno tapara uno malo en cualquier promedio.
  const sesiones = Array.from({ length: 30 }, (_, i) => haceDias(i + 1));
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 4, sesionesCompletadas: sesiones, semanas: 4, hoyISO: hoy,
  });
  assert.equal(r.pct, 100);
});

test('las sesiones fuera de la ventana no cuentan', () => {
  const viejas = [haceDias(40), haceDias(60), haceDias(90)];
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 3, sesionesCompletadas: viejas, semanas: 4, hoyISO: hoy,
  });
  assert.equal(r.sesionesHechas, 0);
  assert.equal(r.pct, 0);
});

test('una fecha corrupta no rompe el cálculo', () => {
  const r = calcularAdherencia({
    diasDeEntrenoPorSemana: 3,
    sesionesCompletadas: ['no-es-fecha', haceDias(2)],
    semanas: 4,
    hoyISO: hoy,
  });
  assert.equal(r.sesionesHechas, 1);
});
