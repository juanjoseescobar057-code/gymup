// __tests__/premiumNoSeDegradaEnElTelefono.test.ts
// ─────────────────────────────────────────────────────────
// El SDK del dispositivo puede CONCEDER Premium, no quitarlo.
//
// checkPremium() corre al abrir la portada, preguntaba a getCustomerInfo() y
// escribía la respuesta en el store tal cual. Si el SDK no encontraba
// entitlement —porque responde de su caché local— el store bajaba a false y con
// él toda la interfaz de pago: alguien que acababa de comprar, o que había
// reinstalado, o cuya renovación aún no se había propagado, veía la app
// escondiéndole lo que ya había pagado. Y el servidor mientras tanto decía que
// sí, porque el webhook ya había escrito la columna.
//
// Quitar Premium es competencia del servidor: el webhook escribe is_premium al
// caducar o cancelar, y el arranque lee esa columna. Por ahí baja con
// fundamento.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const purchases = leerCodigo('lib', 'purchases.ts');

test('syncLocalPremium distingue de dónde viene el veredicto', () => {
  assert.ok(
    /fuente: 'dispositivo' \| 'servidor'/.test(purchases),
    'sin distinguir la fuente, cualquier respuesta del SDK puede quitar Premium',
  );
});

test('una negativa del dispositivo no quita un Premium ya concedido', () => {
  assert.ok(
    /if \(!active && fuente === 'dispositivo' && s\.profile\.is_premium\) return;/.test(purchases),
    'falta el freno: el SDK del teléfono sigue pudiendo degradar',
  );
});

test('el servidor SÍ puede quitarlo', () => {
  // El freno simétrico sería igual de malo: una suscripción caducada tiene que
  // poder cerrar la interfaz de pago.
  assert.ok(
    /syncLocalPremium\(data\.is_premium, 'servidor'\)/.test(purchases),
    'sync-premium no marca su veredicto como del servidor: entonces tampoco puede degradar y Premium sería irrevocable',
  );
});

test('checkPremium y restorePurchases no se marcan como servidor', () => {
  // Las dos preguntan al SDK del dispositivo. Si alguna se marcara 'servidor'
  // el freno se saltaría por esa puerta.
  for (const fn of ['checkPremium', 'restorePurchases']) {
    const i = purchases.indexOf(`export async function ${fn}`);
    assert.ok(i >= 0, `no encontré ${fn}`);
    const cuerpo = purchases.slice(i, i + 900);
    assert.ok(
      !/syncLocalPremium\([^)]*'servidor'\)/.test(cuerpo),
      `${fn} pregunta al dispositivo pero marca su respuesta como del servidor`,
    );
  }
});
