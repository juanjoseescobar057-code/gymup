// __tests__/plates.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platesPerSide, formatPlates } from '../lib/plates.ts';

test('100kg con barra de 20 → 40 por lado = 25+15', () => {
  const r = platesPerSide(100, 20)!;
  assert.deepEqual(r.perSide, [25, 15]);
  assert.equal(r.achieved, 100);
  assert.equal(r.leftover, 0);
});

test('solo la barra cuando target == barra', () => {
  const r = platesPerSide(20, 20)!;
  assert.deepEqual(r.perSide, []);
  assert.equal(r.achieved, 20);
  assert.equal(formatPlates(r), 'Solo la barra');
});

test('objetivo menor que la barra → null', () => {
  assert.equal(platesPerSide(15, 20), null);
  assert.equal(platesPerSide(0, 20), null);
});

test('62.5kg con barra de 20 → 21.25 por lado = 20+1.25', () => {
  const r = platesPerSide(62.5, 20)!;
  assert.deepEqual(r.perSide, [20, 1.25]);
  assert.equal(r.leftover, 0);
});

test('peso no representable reporta leftover', () => {
  // 21kg → 0.5 por lado, no existe disco de 0.5 en el set estándar
  const r = platesPerSide(21, 20)!;
  assert.deepEqual(r.perSide, []);
  assert.equal(r.achieved, 20);
  assert.equal(r.leftover, 1);
});

test('cargas pesadas usan múltiples discos de 25', () => {
  const r = platesPerSide(180, 20)!; // 80 por lado = 25+25+25+5
  assert.deepEqual(r.perSide, [25, 25, 25, 5]);
  assert.equal(r.achieved, 180);
});

test('formatPlates arma el texto legible', () => {
  const r = platesPerSide(100, 20)!;
  assert.equal(formatPlates(r), '25 + 15 por lado');
});
