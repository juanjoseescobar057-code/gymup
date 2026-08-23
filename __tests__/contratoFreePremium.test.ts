// __tests__/contratoFreePremium.test.ts
// Lo que el cliente cree que es de pago, lo que el servidor cobra y lo que el
// paywall vende tienen que ser LA MISMA COSA. Habia tres versiones de la verdad
// para la misma funcion:
//
//   • regenerar el plan: el servidor lo da gratis (plan.premiumOnly = false,
//     freeLimit = 1), el paywall dejo de venderlo, y el gate del cliente seguia
//     mandando al paywall a quien tenia derecho a usarlo;
//   • el insight de la portada: se generaba con gpt-4o para TODO EL MUNDO y solo
//     se pintaba para Premium. Se pagaba y se tiraba — y del techo de $0.15 que
//     deberia alcanzar para el plan de entrenamiento.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canUseFeature } from '../lib/subscription';
import { FEATURE_POLICY } from '../supabase/functions/_shared/politica';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const leerCodigo = (...p: string[]) =>
  leer(...p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('el cliente no manda al paywall por algo que el servidor da gratis', () => {
  // La correspondencia entre el nombre del cliente y el del servidor.
  const EQUIVALE: Record<string, string> = {
    regenerate_plan: 'plan',
    coach_chat: 'coach_chat',
    food_scan: 'food_scan',
    fridge_scan: 'fridge_scan',
    body_scan: 'body_scan',
    coach: 'coach',
  };
  for (const [cliente, servidor] of Object.entries(EQUIVALE)) {
    const politica = FEATURE_POLICY[servidor];
    assert.ok(politica, `${servidor} no existe en la politica del servidor`);
    if (politica.premiumOnly) continue; // es de pago: el gate hace bien en cortar

    const veredicto = canUseFeature(cliente as never, false, 0);
    assert.equal(
      veredicto.allowed,
      true,
      `el cliente bloquea "${cliente}" y el servidor lo da gratis (${servidor}.premiumOnly = false)`,
    );
  }
});

test('regenerar el plan no es Premium en ningun lado', () => {
  assert.equal(FEATURE_POLICY.plan.premiumOnly, false);
  assert.equal(canUseFeature('regenerate_plan' as never, false, 0).allowed, true);
});

test('el insight de la portada solo se genera para quien lo va a ver', () => {
  // La tarjeta se pinta con `profile.is_premium ? ...`, pero la llamada corria
  // para todos: se gastaba una llamada de gpt-4o y se tiraba el resultado.
  const inicio = leerCodigo('app', '(tabs)', 'index.tsx');
  const i = inicio.indexOf('async function loadSuggestion');
  assert.ok(i > 0, 'no encontre loadSuggestion');
  const cabecera = inicio.slice(i, i + 400);
  assert.match(
    cabecera,
    /if \(!profile\.is_premium\) return;/,
    'loadSuggestion tiene que cortar antes de gastar IA para quien no vera el resultado',
  );
});

test('lo que se genera para Premium se pinta para Premium', () => {
  // Que la condicion de generar y la de pintar sean la misma.
  const inicio = leerCodigo('app', '(tabs)', 'index.tsx');
  assert.match(inicio, /profile\.is_premium \?/, 'la tarjeta sigue siendo de Premium');
});
