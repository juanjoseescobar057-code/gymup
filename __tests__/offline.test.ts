// __tests__/offline.test.ts
// El banner de "sin conexión" solo sirve si no miente. Dos formas de mentir:
// gritar "sin conexión" en el primer frame de cada arranque (antes de que
// NetInfo conteste), o callarse cuando hay wifi pero sin internet — que es
// exactamente lo que pasa en el wifi cautivo de un gimnasio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { esUsable } from '../lib/netStatus';

test('conectado y con internet es usable', () => {
  assert.equal(esUsable({ isConnected: true, isInternetReachable: true }), true);
});

test('sin conexión no es usable', () => {
  assert.equal(esUsable({ isConnected: false, isInternetReachable: false }), false);
  assert.equal(esUsable({ isConnected: false, isInternetReachable: null }), false);
});

test('wifi sin salida a internet NO cuenta como conexión', () => {
  assert.equal(esUsable({ isConnected: true, isInternetReachable: false }), false);
});

test('mientras se comprueba el alcance no se asume lo peor', () => {
  // isInternetReachable == null es el estado "comprobando". Tratarlo como
  // caída pintaría el banner en cada arranque.
  assert.equal(esUsable({ isConnected: true, isInternetReachable: null }), true);
});
