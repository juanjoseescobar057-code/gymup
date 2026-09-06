// __tests__/actividadMensual.test.ts
// El calendario y los números del mes, calculados en puro: sin red, sin
// zona horaria fija (las fechas se construyen en hora local, como en la app).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  rejillaDelMes, resumirMes, etiquetaDuracion, etiquetaKg, etiquetaComparacion, diasDelMes,
  type SesionDelMes, type SerieDelMes,
} from '../lib/actividadMensualCalculo';

const local = (anio: number, mes: number, dia: number, hora = 18) => new Date(anio, mes, dia, hora, 0, 0).toISOString();

// ── Rejilla ──

test('septiembre de 2026 empieza en martes: una celda vacía y luego el 1', () => {
  const filas = rejillaDelMes(2026, 8);
  assert.deepEqual(filas[0], [null, 1, 2, 3, 4, 5, 6]);
  assert.equal(filas.flat().filter((d) => d != null).length, 30);
  for (const f of filas) assert.equal(f.length, 7);
});

test('un mes que empieza en domingo rellena seis huecos (lunes primero)', () => {
  // Febrero de 2026: el 1 cae en domingo.
  const filas = rejillaDelMes(2026, 1);
  assert.deepEqual(filas[0], [null, null, null, null, null, null, 1]);
  assert.equal(filas.flat().filter((d) => d != null).length, 28);
  assert.equal(filas.flat().length % 7, 0);
});

test('diasDelMes sabe de bisiestos', () => {
  assert.equal(diasDelMes(2028, 1), 29);
  assert.equal(diasDelMes(2026, 1), 28);
});

// ── Resumen ──

const SESIONES: SesionDelMes[] = [
  { id: 'a', completed_at: local(2026, 8, 2), duration_min: 50, exercises_completed: 5, day_index: 0 },
  { id: 'b', completed_at: local(2026, 8, 4), duration_min: 40, exercises_completed: 4, day_index: 1 },
  { id: 'c', completed_at: local(2026, 8, 4, 21), duration_min: 20, exercises_completed: 2, day_index: 2 }, // dos el mismo día
  { id: 'z', completed_at: local(2026, 7, 30), duration_min: 60, exercises_completed: 6, day_index: 0 },   // agosto: fuera
];

const SERIES: SerieDelMes[] = [
  { exercise_name: 'Sentadilla', weight_kg: 80, reps: 8, logged_at: local(2026, 8, 2), session_id: 'a' },
  { exercise_name: 'Sentadilla', weight_kg: 85, reps: 5, logged_at: local(2026, 8, 2), session_id: 'a' },
  { exercise_name: 'Sentadilla', weight_kg: 85, reps: 6, logged_at: local(2026, 8, 4), session_id: 'b' },
  { exercise_name: 'Press banca', weight_kg: 60, reps: 10, logged_at: local(2026, 8, 4), session_id: 'b' },
  { exercise_name: 'Dominadas', weight_kg: null, reps: 8, logged_at: local(2026, 8, 4), session_id: 'b' },
  { exercise_name: 'Vacía', weight_kg: null, reps: null, logged_at: local(2026, 8, 4), session_id: 'b' },
  { exercise_name: 'Sentadilla', weight_kg: 100, reps: 3, logged_at: local(2026, 7, 30), session_id: 'z' }, // agosto: fuera
];

test('cuenta entrenos, minutos y días del mes, y deja fuera lo de otros meses', () => {
  const r = resumirMes(SESIONES, SERIES, 2026, 8);
  assert.equal(r.entrenos, 3);
  assert.equal(r.minutos, 110);
  assert.deepEqual(r.diasEntrenados, [2, 4]);
  assert.equal(r.porDia[4].entrenos, 2);
  assert.equal(r.porDia[4].minutos, 60);
});

test('las series se cuentan sin las vacías y el volumen solo con peso y reps', () => {
  const r = resumirMes(SESIONES, SERIES, 2026, 8);
  assert.equal(r.series, 5, 'la serie sin peso ni reps no cuenta; la de dominadas (solo reps) sí');
  assert.equal(r.volumenKg, 80 * 8 + 85 * 5 + 85 * 6 + 60 * 10);
});

test('los ejercicios van por series, con días distintos y la mejor serie del mes', () => {
  const r = resumirMes(SESIONES, SERIES, 2026, 8);
  assert.deepEqual(r.ejercicios.map((e) => e.nombre), ['Sentadilla', 'Dominadas', 'Press banca']);
  const sq = r.ejercicios[0];
  assert.equal(sq.series, 3);
  assert.equal(sq.dias, 2);
  // 85 × 6 gana a 85 × 5 por reps, y el 100 × 3 de agosto no entra.
  assert.deepEqual(sq.mejor, { peso: 85, reps: 6 });
  assert.equal(r.ejercicios.find((e) => e.nombre === 'Dominadas')!.mejor, null);
  assert.deepEqual(r.porDia[4].ejercicios, ['Sentadilla', 'Press banca', 'Dominadas']);
});

test('entrenos por semana usa las semanas reales del mes', () => {
  const r = resumirMes(SESIONES, SERIES, 2026, 8);
  assert.equal(r.porSemana, Math.round((3 / (30 / 7)) * 10) / 10);
});

test('un mes sin nada no rompe', () => {
  const r = resumirMes([], [], 2026, 0);
  assert.equal(r.entrenos, 0);
  assert.deepEqual(r.diasEntrenados, []);
  assert.deepEqual(r.ejercicios, []);
  assert.equal(r.porSemana, 0);
});

// ── Etiquetas ──

test('duraciones legibles', () => {
  assert.equal(etiquetaDuracion(0), '0 min');
  assert.equal(etiquetaDuracion(45), '45 min');
  assert.equal(etiquetaDuracion(60), '1 h');
  assert.equal(etiquetaDuracion(520), '8 h 40 min');
});

test('kilos con miles separados por espacio', () => {
  assert.equal(etiquetaKg(950), '950 kg');
  assert.equal(etiquetaKg(12400), '12 400 kg');
  assert.equal(etiquetaKg(1234567), '1 234 567 kg');
});

test('la comparación con el mes anterior no juzga', () => {
  assert.equal(etiquetaComparacion(12, 9, 7), '+3 vs agosto');
  assert.equal(etiquetaComparacion(7, 9, 7), '−2 vs agosto');
  assert.equal(etiquetaComparacion(9, 9, 7), 'igual que agosto');
  // Enero compara con diciembre.
  assert.equal(etiquetaComparacion(1, 0, -1), '+1 vs diciembre');
});

// ── Cableado ──

test('la pantalla existe, está en la pila y se llega desde Progreso', () => {
  const layout = fs.readFileSync(path.join(process.cwd(), 'app', '_layout.tsx'), 'utf8');
  assert.match(layout, /<Stack\.Screen name="actividad"/);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'app', 'actividad.tsx')));
  const progreso = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'progress.tsx'), 'utf8');
  assert.match(progreso, /router\.push\('\/actividad' as any\)/);
});

test('la lectura pagina y solo pide series del mes que se ve', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'actividadMensual.ts'), 'utf8');
  assert.match(src, /\.range\(desde, hasta\)/);
  assert.match(src, /\.gte\('logged_at', inicio\.toISOString\(\)\)/);
  assert.match(src, /\.lt\('logged_at', fin\.toISOString\(\)\)/);
  assert.match(src, /\.not\('completed_at', 'is', null\)/);
});
