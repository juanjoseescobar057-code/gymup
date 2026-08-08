// __tests__/replayRoutes.test.ts
// Esta lista es una PROMESA publicada en la política de privacidad. Cada
// entrada que falte es una pantalla que se graba mientras el documento legal
// dice lo contrario — y varias muestran fotos del cuerpo del usuario.
//
// El fallo que motivó estos tests: la lista tenía '/coach-chat' pero no
// '/coach'. Como el filtro es por prefijo y '/coach'.startsWith('/coach-chat')
// es false, la pestaña Coach se grababa con la foto de postura en pantalla.

import test from 'node:test';
import assert from 'node:assert/strict';
import { esRutaSensible } from '../lib/replayRoutes';

test('las pantallas con fotos del cuerpo nunca se graban', () => {
  for (const r of ['/body-scan', '/coach', '/progress', '/camera']) {
    assert.equal(esRutaSensible(r), true, `${r} debería estar excluida`);
  }
});

test('el tamizaje de salud y el chat del coach nunca se graban', () => {
  for (const r of ['/health', '/onboarding', '/coach-chat', '/telemetry']) {
    assert.equal(esRutaSensible(r), true, `${r} debería estar excluida`);
  }
});

test('la pestaña Coach está cubierta por sí misma, no por el chat', () => {
  // El bug exacto: sin '/coach' en la lista, esto daba false.
  assert.equal(esRutaSensible('/coach'), true);
  assert.equal('/coach'.startsWith('/coach-chat'), false, 'el prefijo NO cubre al revés');
});

test('los escáneres y el registro de comida nunca se graban', () => {
  for (const r of ['/food-scan', '/fridge-scan', '/food-manual']) {
    assert.equal(esRutaSensible(r), true, `${r} debería estar excluida`);
  }
});

test('las rutas con parámetros o subrutas también quedan cubiertas', () => {
  assert.equal(esRutaSensible('/coach/detalle'), true);
  assert.equal(esRutaSensible('/health?from=perfil'), true);
});

test('las pantallas sin datos sensibles SÍ se pueden grabar', () => {
  // La grabación existe para encontrar problemas de UX: excluirlo todo la
  // dejaría inútil. Estas no tienen fotos ni datos de salud.
  for (const r of ['/', '/index', '/paywall', '/profile', '/exercises']) {
    assert.equal(esRutaSensible(r), false, `${r} no debería estar excluida`);
  }
});
