// __tests__/subscription.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseFeature, FREE_LIMITS } from '../lib/subscription.ts';

test('premium puede todo', () => {
  assert.equal(canUseFeature('body_scan', true).allowed, true);
  assert.equal(canUseFeature('coach', true).allowed, true);
  assert.equal(canUseFeature('food_scan', true, 999).allowed, true);
});

test('free NO puede análisis corporal ni coach', () => {
  assert.equal(canUseFeature('body_scan', false).allowed, false);
  assert.equal(canUseFeature('coach', false).allowed, false);
});

test('free puede escanear comida hasta el límite diario', () => {
  assert.equal(canUseFeature('food_scan', false, 0).allowed, true);
  assert.equal(canUseFeature('food_scan', false, FREE_LIMITS.foodScansPerDay - 1).allowed, true);
  assert.equal(canUseFeature('food_scan', false, FREE_LIMITS.foodScansPerDay).allowed, false);
});

test('los bloqueos traen una razón legible', () => {
  const r = canUseFeature('body_scan', false);
  assert.ok(r.reason && r.reason.length > 0);
});
