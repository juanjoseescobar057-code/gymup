// __tests__/sesionParcial.test.ts
// ─────────────────────────────────────────────────────────
// Cualquier conjunto de series no vacío se guardaba como «entrenamiento
// completado». Una serie de calentamiento y salir contaba lo mismo que hora y
// media.
//
// Y de ahí colgaba todo: el plan avanzaba de día, se sumaba una sesión, se daba
// el XP entero, y la racha, la adherencia y la detección de mesetas se
// calculaban sobre un dato que no era cierto. Quien se iba a la tercera serie se
// encontraba al día siguiente con la sesión que no llegó a hacer ya dada por
// hecha, y el plan entero corrido.
//
// No se quita nada: se añade el contexto que faltaba. Una parcial se sigue
// guardando —abandonar a mitad también es información, y borrarla sería castigar
// a quien tuvo un mal día— pero deja de valer lo mismo.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const setup = leer('supabase', 'setup.sql');
const sesion = leer('app', 'workout-session.tsx');
const cierre = leer('lib', 'workoutCompletion.ts');

// ── La sesión guarda cuánto se hizo de cuánto ──

test('la sesión guarda el grado de finalización', () => {
  for (const col of ['planned_sets', 'completed_sets', 'completion_pct', 'completion_status']) {
    assert.ok(
      setup.includes(`add column if not exists ${col}`),
      `falta la columna ${col}`,
    );
  }
});

test('el estado solo admite los tres valores', () => {
  assert.match(setup, /completion_status in \('completa', 'parcial', 'minima'\)/);
});

test('la RPC recibe cuántas series tenía el día', () => {
  assert.match(setup, /p_planned_sets integer default null/);
});

test('la RPC devuelve el grado, no solo el id', () => {
  const i = setup.indexOf('function public.complete_workout_session(');
  const firma = setup.slice(i, setup.indexOf('language plpgsql', i));
  assert.match(firma, /completion_status text/);
  assert.match(firma, /completion_pct integer/);
});

// ── Los cortes ──

test('los umbrales son 80 y 40', () => {
  // 80% deja margen para la serie que uno se salta sin haber abandonado.
  // Por debajo de 40% no es una sesión, es un intento.
  const i = setup.indexOf('function public.complete_workout_session(');
  const cuerpo = setup.slice(i, setup.indexOf('grant execute on function public.complete_workout_session', i));
  assert.match(cuerpo, /v_pct >= 80 then 'completa'/);
  assert.match(cuerpo, /v_pct >= 40 then 'parcial'/);
  assert.match(cuerpo, /else 'minima'/);
});

test('sin saber las series planeadas se comporta como antes', () => {
  // Un build antiguo no manda p_planned_sets. Ponerle un grado inventado sería
  // el mismo error que se está corrigiendo, en la otra dirección.
  const i = setup.indexOf('function public.complete_workout_session(');
  const cuerpo = setup.slice(i, i + 5000);
  assert.match(cuerpo, /if p_planned_sets is null or p_planned_sets <= 0 then/);
  assert.match(cuerpo, /v_status := null;/);
});

test('el porcentaje no pasa de 100', () => {
  // Hacer series de más no es hacer un 140% de la sesión.
  const i = setup.indexOf('function public.complete_workout_session(');
  assert.match(setup.slice(i, i + 5000), /least\(100, round\(/);
});

// ── La firma vieja no sobrevive ──

test('la firma sin grado se elimina', () => {
  // Dejarla viva sería un camino que guarda sesiones SIN grado, con Postgres
  // eligiendo una u otra por resolución de sobrecarga según cómo llame cada build.
  assert.match(
    setup,
    /drop function if exists public\.complete_workout_session\(uuid, uuid, integer, timestamptz, timestamptz, integer, jsonb\)/,
  );
});

// ── El día del plan ──

test('el día solo avanza si la sesión quedó completa', () => {
  const i = sesion.indexOf('current_plan_day ?? 0) + 1');
  assert.ok(i > 0, 'no encontré el avance del día');
  const antes = sesion.slice(Math.max(0, i - 800), i);
  assert.match(antes, /gradoSesion === 'parcial' \|\| gradoSesion === 'minima'/);
});

test('la pantalla manda las series que tenía el día', () => {
  assert.match(sesion, /plannedSets: exercises\.reduce/);
});

test('se manda el plan ADAPTADO, que es el que se enseñó', () => {
  // Comparar contra el plan original sería medir a la persona contra una sesión
  // que nunca vio: adaptSessionExercises pudo recortarlo por tiempo o energía.
  const i = sesion.indexOf('plannedSets: exercises.reduce');
  assert.ok(i > 0);
  // `exercises` es el estado ya adaptado; el plan crudo se llama planExercises.
  assert.ok(!sesion.slice(i, i + 120).includes('planExercises'));
});

// ── Y una parcial NO se borra ──

test('una sesión parcial se guarda igual', () => {
  // Abandonar a mitad también es información. Borrarla sería castigar a quien
  // tuvo un mal día, y encima dejaría la adherencia mintiendo hacia arriba.
  const i = setup.indexOf('function public.complete_workout_session(');
  const cuerpo = setup.slice(i, setup.indexOf('grant execute on function public.complete_workout_session', i));
  const iInsert = cuerpo.indexOf('insert into public.workout_sessions');
  const iEstado = cuerpo.indexOf("v_status :=");
  assert.ok(iEstado > 0 && iInsert > iEstado, 'el grado se calcula y LUEGO se guarda la sesión');
  assert.ok(!/if v_status = 'completa' then\s+insert/.test(cuerpo), 'la parcial no puede quedarse sin guardar');
});

test('el tipo del resultado documenta qué hace cada grado', () => {
  assert.match(cierre, /completionStatus: 'completa' \| 'parcial' \| 'minima' \| null/);
});
