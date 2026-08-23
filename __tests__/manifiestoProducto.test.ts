// __tests__/manifiestoProducto.test.ts
// ─────────────────────────────────────────────────────────
// Un solo sitio dice qué se vende, y la documentación tiene que decir lo mismo.
//
// No lo decía. El código usa `premium_monthly` y `premium_yearly`; DEPLOY.md y
// PRICING.md mandaban crear en Play Console `gymup_premium_monthly` y
// `gymup_premium_yearly`. Quien siguiera la guía habría creado dos productos
// que el paywall nunca encuentra: precio "—", botón activo, y un error genérico
// al tocarlo. No se vende nada y no hay forma de saber por qué.
//
// El id de un producto de tienda es PERMANENTE: no se puede renombrar después
// de crearlo. Un error aquí no se arregla, se hereda.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLANS, PREMIUM_BENEFITS, FREE_HIGHLIGHTS, PREMIUM_LIMITS } from '../lib/subscription';
import { FEATURE_POLICY } from '../supabase/functions/_shared/politica';
import { ENTITLEMENT_POR_DEFECTO } from '../supabase/functions/_shared/entitlements';

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const GUIAS = ['DEPLOY.md', 'PRICING.md'];

test('los ids de producto del codigo aparecen en las guias de despliegue', () => {
  for (const guia of GUIAS) {
    const texto = leer(guia);
    for (const plan of Object.values(PLANS)) {
      assert.ok(
        texto.includes(plan.id),
        `${guia} no menciona "${plan.id}". Si manda crear otro id, no se vendera nada.`,
      );
    }
  }
});

test('ninguna guia manda crear un id que el codigo no busca', () => {
  const validos = new Set(Object.values(PLANS).map((p) => p.id));
  for (const guia of GUIAS) {
    const encontrados = [...leer(guia).matchAll(/\b([a-z0-9_]*premium_(?:monthly|yearly))\b/g)]
      .map((m) => m[1]);
    for (const id of new Set(encontrados)) {
      assert.ok(
        validos.has(id),
        `${guia} manda crear "${id}" y el codigo busca ${[...validos].join(' / ')}. ` +
          'Los ids de tienda son permanentes: no se renombran despues.',
      );
    }
  }
});

test('el entitlement es el mismo en cliente, servidor y guias', () => {
  const cliente = leer('lib/purchases.ts');
  assert.match(cliente, /PREMIUM_ENTITLEMENT = 'premium'/);
  assert.equal(ENTITLEMENT_POR_DEFECTO, 'premium');
  for (const guia of GUIAS) {
    assert.match(leer(guia), /premium/, `${guia} deberia nombrar el entitlement`);
  }
});

// ── Lo que se promete existe y se cobra ──

test('el paywall no vende nada que el servidor de gratis', () => {
  // 'Rehaz tu plan' se vendia como beneficio Premium mientras el servidor lo
  // daba igual a todo el mundo (plan.premiumOnly = false, freeLimit = 1). Y el
  // 'Coach en vivo' es local y gratis: no gasta un token.
  const gratis = Object.entries(FEATURE_POLICY)
    .filter(([, p]) => !p.premiumOnly)
    .map(([nombre]) => nombre);

  // Ninguna de las features gratuitas puede estar detras del paywall.
  const prohibidas: Record<string, RegExp> = {
    plan: /rehaz tu plan|regenera tu plan/i,
  };
  for (const feature of gratis) {
    const re = prohibidas[feature];
    if (!re) continue;
    for (const beneficio of PREMIUM_BENEFITS) {
      assert.ok(
        !re.test(beneficio),
        `"${beneficio}" se vende como Premium pero ${feature} es gratis en el servidor`,
      );
    }
  }
});

test('el coach en vivo se cuenta como gratis, que es lo que es', () => {
  // app/live-coach.tsx no tiene ninguna comprobacion de premium y no llama al
  // proxy: cuenta repeticiones con la camara del telefono.
  const liveCoach = leer('app/live-coach.tsx');
  assert.ok(!/canUseFeature|isPremium|premium_required/.test(liveCoach), 'live-coach no comprueba Premium');
  assert.ok(
    FREE_HIGHLIGHTS.some((f) => /coach en vivo/i.test(f)),
    'si es gratis, hay que contarlo entre lo gratis',
  );
});

test('cada tope prometido existe en la politica del servidor', () => {
  const equivalencias: Record<keyof typeof PREMIUM_LIMITS, string> = {
    bodyScansPerDay: 'body_scan',
    coachPosturePerDay: 'coach',
    coachMessagesPerDay: 'coach_chat',
    foodScansPerDay: 'food_scan',
    fridgeScansPerDay: 'fridge_scan',
    planRegensPerDay: 'plan',
  };
  for (const [clave, feature] of Object.entries(equivalencias)) {
    assert.ok(FEATURE_POLICY[feature], `${feature} no existe en la politica`);
    assert.equal(
      PREMIUM_LIMITS[clave as keyof typeof PREMIUM_LIMITS],
      FEATURE_POLICY[feature].premiumLimit,
      `${clave}: el paywall dice una cosa y el servidor otra`,
    );
  }
});

// ── La pantalla no puede quedar a medias ──

test('la tienda solo se da por buena con los DOS paquetes', () => {
  // Con uno presente y otro ausente, el estado quedaba en 'ok': precio "—",
  // ahorro "33%" afirmado igual, tarjeta seleccionable y boton activo. Y la
  // pantalla abre con el anual elegido, asi que si faltaba ese, era lo primero
  // que se veia.
  const paywall = leer('app/paywall.tsx');
  assert.match(paywall, /every\(\(k\) => encontrados\[k\]\)/);
});

test('el respaldo del ahorro anual no se afirma sin precios', () => {
  // El 33% sale de PRICING.md, no esta inventado — pero afirmarlo junto a un
  // precio "—" es afirmar un descuento sobre una cifra que no existe.
  const paywall = leer('app/paywall.tsx');
  const i = paywall.indexOf('ahorroAnual');
  assert.ok(i > 0);
  assert.match(paywall, /estadoTienda === 'ok'|sinTienda/);
});

test('la letra legal no promete el «≈» que ya no existe', () => {
  const paywall = leer('app/paywall.tsx');
  assert.ok(!paywall.includes('«≈»'), 'copia legal huerfana de una version anterior');
});

test('la letra legal menciona el tope mensual', () => {
  // Los "cupos diarios reales" no son el unico limite: el presupuesto mensual
  // corta antes. Callarlo es la parte enganosa.
  assert.match(leer('app/paywall.tsx'), /tope mensual/i);
});
