// __tests__/pose.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleAt, distance } from '../lib/pose/geometry.ts';
import { initRepState, updateReps } from '../lib/pose/repCounter.ts';
import { kneeAngle, squatForm } from '../lib/pose/formChecks.ts';
import { getPoseExercise } from '../lib/pose/exercises.ts';
import type { Pose } from '../lib/pose/types.ts';

const L = (x: number, y: number) => ({ x, y, score: 1 });

// ── Geometría ──
test('angleAt detecta un ángulo recto (90°)', () => {
  const a = L(0, 1), b = L(0, 0), c = L(1, 0);
  assert.ok(Math.abs(angleAt(a, b, c) - 90) < 0.001);
});

test('angleAt detecta una línea recta (180°)', () => {
  assert.ok(Math.abs(angleAt(L(0, 1), L(0, 0), L(0, -1)) - 180) < 0.001);
});

test('distance es euclidiana', () => {
  assert.ok(Math.abs(distance(L(0, 0), L(3, 4)) - 5) < 0.001);
});

// ── Contador de reps ──
test('cuenta una repetición en el ciclo abajo→arriba', () => {
  const cfg = { downAngle: 100, upAngle: 160 };
  let s = initRepState();
  for (const ang of [170, 150, 90, 95, 165]) {
    s = updateReps(s, ang, cfg).state;
  }
  assert.equal(s.reps, 1);
  assert.equal(s.phase, 'up');
});

test('la histéresis evita conteos dobles por vibración', () => {
  const cfg = { downAngle: 100, upAngle: 160 };
  let s = initRepState();
  // baja, sube, y oscila cerca del umbral superior sin volver a bajar
  for (const ang of [170, 90, 165, 158, 162, 159, 161]) {
    s = updateReps(s, ang, cfg).state;
  }
  assert.equal(s.reps, 1);
});

test('cuenta 3 repeticiones seguidas', () => {
  const cfg = { downAngle: 100, upAngle: 160 };
  let s = initRepState();
  const oneRep = [170, 90, 170];
  for (let i = 0; i < 3; i++) for (const a of oneRep) s = updateReps(s, a, cfg).state;
  assert.equal(s.reps, 3);
});

// ── Técnica ──
test('kneeAngle calcula desde el lado visible', () => {
  const p: Pose = { leftHip: L(0, 0), leftKnee: L(0, 1), leftAnkle: L(0, 2) };
  assert.ok(Math.abs(kneeAngle(p)! - 180) < 0.001);
});

test('squatForm detecta valgo de rodilla', () => {
  // rodillas juntas (0.45/0.55), tobillos anchos (0.3/0.7)
  const p: Pose = {
    leftKnee: L(0.45, 1), rightKnee: L(0.55, 1),
    leftAnkle: L(0.3, 1.5), rightAnkle: L(0.7, 1.5),
    leftHip: L(0.4, 0.5), rightHip: L(0.6, 0.5),
  };
  const cues = squatForm(p, 'down');
  assert.ok(cues.some((c) => c.zone === 'Rodillas' && c.severity === 'error'));
});

test('squatForm marca buena forma cuando todo está alineado', () => {
  const p: Pose = {
    leftKnee: L(0.3, 1), rightKnee: L(0.7, 1),
    leftAnkle: L(0.3, 1.5), rightAnkle: L(0.7, 1.5),
    leftHip: L(0.32, 0.5), rightHip: L(0.68, 0.5),
    leftAnkle2: undefined as any,
  };
  // de pie: rodilla ~recta → sin aviso de profundidad en fase 'up'
  const cues = squatForm(p, 'up');
  assert.ok(cues.some((c) => c.severity === 'good'));
});

// ── Config ──
test('getPoseExercise cae a genérico para id desconocido', () => {
  assert.equal(getPoseExercise('no_existe').id, 'generic');
  assert.equal(getPoseExercise('squat').id, 'squat');
});
