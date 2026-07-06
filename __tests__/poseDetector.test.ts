// __tests__/poseDetector.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movenetToPose } from '../lib/pose/detector.ts';

test('movenetToPose mapea los 17 keypoints a las articulaciones correctas', () => {
  // 17 puntos; usamos el índice como marca para verificar el mapeo.
  const kp = Array.from({ length: 17 }, (_, i) => ({ x: i / 100, y: i / 100, score: 1 }));
  const pose = movenetToPose(kp);

  // índice 5 = leftShoulder, 13 = leftKnee, 16 = rightAnkle, 0 = nose
  assert.equal(pose.nose?.x, 0);
  assert.equal(pose.leftShoulder?.x, 0.05);
  assert.equal(pose.rightShoulder?.x, 0.06);
  assert.equal(pose.leftKnee?.x, 0.13);
  assert.equal(pose.rightAnkle?.x, 0.16);
});

test('movenetToPose ignora ojos y orejas (no los mapea)', () => {
  const kp = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, score: 1 }));
  const pose = movenetToPose(kp);
  // Solo deben existir las articulaciones útiles (nariz + 12 de cuerpo = 13).
  assert.equal(Object.keys(pose).length, 13);
});
