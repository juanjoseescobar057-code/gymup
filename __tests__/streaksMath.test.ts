// __tests__/streaksMath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpToLevel, xpForNextLevel, xpProgress, calculateNewStreak } from '../lib/streaksMath.ts';

test('xpToLevel: 0 XP es nivel 1', () => {
  assert.equal(xpToLevel(0), 1);
});

test('xpToLevel: 100 XP es nivel 2, 400 XP es nivel 3', () => {
  assert.equal(xpToLevel(100), 2);
  assert.equal(xpToLevel(400), 3);
});

test('xpForNextLevel: nivel 2 requiere 400', () => {
  assert.equal(xpForNextLevel(2), 400);
});

test('xpProgress: el progreso está entre 0 y 1', () => {
  const p = xpProgress(250);
  assert.ok(p.progress >= 0 && p.progress <= 1);
  assert.ok(p.xpNeeded > 0);
});

// ── Racha ──
const base = { current_streak: 5, streak_freezes: 0 };

test('primera vez (sin fecha previa) arranca racha en 1', () => {
  const r = calculateNewStreak({ ...base, last_workout_date: null });
  assert.equal(r.newStreak, 1);
  assert.equal(r.streakBroken, false);
});

test('mismo día no cambia la racha', () => {
  const r = calculateNewStreak({ ...base, last_workout_date: '2026-06-29' }, '2026-06-29');
  assert.equal(r.newStreak, 5);
  assert.equal(r.streakBroken, false);
});

test('día siguiente: la racha sube', () => {
  const r = calculateNewStreak({ ...base, last_workout_date: '2026-06-28' }, '2026-06-29');
  assert.equal(r.newStreak, 6);
});

test('un día de descanso de por medio NO rompe la racha', () => {
  const r = calculateNewStreak({ ...base, last_workout_date: '2026-06-27' }, '2026-06-29');
  assert.equal(r.newStreak, 6);
  assert.equal(r.streakBroken, false);
});

test('3+ días sin actividad SÍ rompe la racha (sin comodines)', () => {
  const r = calculateNewStreak({ ...base, last_workout_date: '2026-06-25' }, '2026-06-29');
  assert.equal(r.newStreak, 1);
  assert.equal(r.streakBroken, true);
  assert.equal(r.freezeUsed, false);
});

test('streak-freeze salva la racha en un gap grande y se marca usado', () => {
  const r = calculateNewStreak(
    { current_streak: 5, streak_freezes: 1, last_workout_date: '2026-06-25' },
    '2026-06-29'
  );
  assert.equal(r.streakBroken, false);
  assert.equal(r.freezeUsed, true);
  assert.equal(r.newStreak, 6);
});

test('el freeze NO revive una racha tras una ausencia larguísima', () => {
  const r = calculateNewStreak(
    { current_streak: 5, streak_freezes: 1, last_workout_date: '2026-06-01' },
    '2026-06-29'
  );
  assert.equal(r.streakBroken, true);
  assert.equal(r.freezeUsed, false);
});
