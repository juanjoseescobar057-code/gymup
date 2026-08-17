// __tests__/subscription.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseFeature,
  FREE_LIMITS,
  PREMIUM_LIMITS,
  PREMIUM_BENEFITS,
  FREE_HIGHLIGHTS,
} from '../lib/subscription.ts';

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

// ── Lo que promete el paywall ──
// Cobrar por algo que el plan gratis ya tiene decepciona justo cuando la
// persona acaba de pagar, y en tienda es motivo de rechazo. Ya se coló dos
// veces: la proyección hacia la meta (goalMath es puro y se pinta sin mirar el
// plan) y un "coach de postura" compitiendo con el coach de reglas que el plan
// gratis también tiene.

test('el paywall no vende nada que el plan gratis ya incluya', () => {
  const texto = PREMIUM_BENEFITS.join(' ').toLowerCase();
  for (const yaEsGratis of ['predicción', 'proyección', 'racha', 'récord', 'historial', 'calentamiento']) {
    assert.ok(!texto.includes(yaEsGratis), `el paywall vende "${yaEsGratis}", que el plan gratis ya tiene`);
  }
});

test('el paywall no promete nada ilimitado', () => {
  // Premium tiene topes reales que aplica el servidor. Prometer "ilimitado" es
  // publicidad engañosa y genera reembolsos.
  const texto = PREMIUM_BENEFITS.join(' ').toLowerCase();
  assert.ok(!/ilimitad|sin límite|sin restricc/.test(texto));
});

test('el paywall no compara contra cero', () => {
  // "(gratis: 0)" no vende: suena a castigo por no haber pagado.
  assert.ok(!PREMIUM_BENEFITS.join(' ').includes('gratis: 0'));
});

test('cada tope que promete el paywall sale de PREMIUM_LIMITS', () => {
  // Escribir los números a mano es cómo se prometen topes que el servidor no
  // concede. Todo número que aparezca tiene que ser uno de los reales.
  const permitidos = new Set(Object.values(PREMIUM_LIMITS).map(String));
  for (const b of PREMIUM_BENEFITS) {
    for (const n of b.match(/\d+/g) ?? []) {
      assert.ok(permitidos.has(n), `el paywall promete "${n}" y no es ningún tope de PREMIUM_LIMITS`);
    }
  }
});

test('lo que se anuncia como gratis no requiere pagar', () => {
  const texto = FREE_HIGHLIGHTS.join(' ').toLowerCase();
  for (const esPremium of ['escane', 'chat', 'coach en vivo', 'análisis corporal', 'nevera']) {
    assert.ok(!texto.includes(esPremium), `se anuncia "${esPremium}" como gratis y es de pago`);
  }
});
