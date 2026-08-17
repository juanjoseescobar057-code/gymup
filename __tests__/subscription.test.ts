// __tests__/subscription.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseFeature, FREE_LIMITS } from '../lib/subscription.ts';

test('premium puede todo', () => {
  assert.equal(canUseFeature('body_scan', true).allowed, true);
  assert.equal(canUseFeature('coach', true).allowed, true);
  assert.equal(canUseFeature('food_scan', true, 999).allowed, true);
});

test('free NO tiene ninguna función de IA', () => {
  // El plan gratis dejó de dar un goteo de IA. Costaba ~$0.72/mes por alguien
  // que no paga —más que todo su presupuesto— y la degustación es la prueba de
  // 7 días, no un chorrito perpetuo.
  //
  // Lo que el plan gratis SÍ da no pasa por aquí porque no cuesta nada:
  // progresión automática, calentamiento filtrado por lesiones, registro de
  // series, récords, macros a mano, rachas y el coach de lib/coachReglas.ts.
  assert.equal(canUseFeature('body_scan', false).allowed, false);
  assert.equal(canUseFeature('coach', false).allowed, false);
  assert.equal(canUseFeature('food_scan', false, 0).allowed, false);
});

test('los topes gratis de IA están todos en cero', () => {
  // Si alguien reabre uno sin querer, esto lo dice: cada escaneo gratis sale
  // del presupuesto de $0.15/mes que solo debería cubrir generar el plan.
  assert.equal(FREE_LIMITS.foodScansPerDay, 0);
  assert.equal(FREE_LIMITS.fridgeScansPerDay, 0);
  assert.equal(FREE_LIMITS.coachMessagesPerDay, 0);
});

test('los bloqueos traen una razón legible', () => {
  const r = canUseFeature('body_scan', false);
  assert.ok(r.reason && r.reason.length > 0);
});
