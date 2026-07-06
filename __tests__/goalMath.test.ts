// __tests__/goalMath.test.ts
// node --import tsx --test __tests__/goalMath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendPerWeek, projectGoal, etaFromWeeks } from '../lib/goalMath';

test('trendPerWeek: sin datos suficientes es 0', () => {
  assert.equal(trendPerWeek([]), 0);
  assert.equal(trendPerWeek([{ date: '2026-01-01', weight: 80 }]), 0);
});

test('trendPerWeek: baja lineal de 1kg/semana', () => {
  const pts = [
    { date: '2026-01-01', weight: 80 },
    { date: '2026-01-08', weight: 79 },
    { date: '2026-01-15', weight: 78 },
    { date: '2026-01-22', weight: 77 },
  ];
  assert.ok(Math.abs(trendPerWeek(pts) - -1) < 1e-6);
});

test('trendPerWeek: ordena aunque lleguen desordenados', () => {
  const pts = [
    { date: '2026-01-22', weight: 77 },
    { date: '2026-01-01', weight: 80 },
    { date: '2026-01-08', weight: 79 },
  ];
  assert.ok(trendPerWeek(pts) < 0);
});

test('projectGoal: pérdida de grasa en camino da ETA y onTrack', () => {
  const p = projectGoal({
    goal: 'fat_loss',
    currentWeight: 78,
    targetWeight: 74,
    startWeight: 82,
    points: [
      { date: '2026-01-01', weight: 82 },
      { date: '2026-01-08', weight: 81 },
      { date: '2026-01-15', weight: 80 },
      { date: '2026-01-22', weight: 78 },
    ],
  });
  assert.equal(p.hasGoal, true);
  assert.equal(p.direction, 'lose');
  assert.equal(p.onTrack, true);
  assert.ok(p.weeksToGoal && p.weeksToGoal > 0);
  assert.ok(p.remainingKg > 3.9 && p.remainingKg < 4.1);
  // 4 kg perdidos de 8 kg de rango total → 50%
  assert.ok(Math.abs(p.pctComplete - 50) < 5);
});

test('projectGoal: sin meta de peso => hasGoal false', () => {
  const p = projectGoal({ goal: 'performance', currentWeight: 80, targetWeight: null, points: [] });
  assert.equal(p.hasGoal, false);
  assert.equal(p.weeksToGoal, null);
});

test('projectGoal: subir de peso pero bajando => reversing', () => {
  const p = projectGoal({
    goal: 'muscle_gain',
    currentWeight: 70,
    targetWeight: 76,
    startWeight: 70,
    points: [
      { date: '2026-01-01', weight: 72 },
      { date: '2026-01-08', weight: 71 },
      { date: '2026-01-15', weight: 70 },
    ],
  });
  assert.equal(p.direction, 'gain');
  assert.equal(p.reversing, true);
  assert.equal(p.onTrack, false);
});

test('projectGoal: peso estable => stalled', () => {
  const p = projectGoal({
    goal: 'fat_loss',
    currentWeight: 80,
    targetWeight: 75,
    startWeight: 80,
    points: [
      { date: '2026-01-01', weight: 80 },
      { date: '2026-01-08', weight: 80 },
      { date: '2026-01-15', weight: 80 },
    ],
  });
  assert.equal(p.stalled, true);
  assert.equal(p.onTrack, false);
  assert.equal(p.weeksToGoal, null);
});

test('projectGoal: meta ya alcanzada', () => {
  const p = projectGoal({
    goal: 'fat_loss',
    currentWeight: 75,
    targetWeight: 75,
    startWeight: 82,
    points: [{ date: '2026-01-01', weight: 82 }, { date: '2026-02-01', weight: 75 }],
  });
  assert.equal(p.direction, 'maintain');
  assert.equal(p.pctComplete, 100);
  assert.match(p.headline, /alcanzada/i);
});

test('etaFromWeeks: formatos', () => {
  assert.equal(etaFromWeeks(null), '—');
  assert.equal(etaFromWeeks(1), '~1 semana');
  assert.equal(etaFromWeeks(6), '~6 semanas');
  assert.match(etaFromWeeks(20), /meses/);
});
