// __tests__/topesIA.test.ts
// Los topes de IA y la tabla de precios viven DUPLICADOS: el proxy corre en
// Deno y la app en React Native, así que no pueden importar el mismo módulo.
// Hasta ahora eso era un comentario pidiendo cuidado, y un comentario no
// detiene nada.
//
// Dos cosas se rompen si las copias divergen, y ninguna avisa sola:
//   • El paywall prometería más de lo que el servidor concede. Eso es
//     publicidad engañosa: rechazo en tienda y reembolsos.
//   • El costo apuntado contra el presupuesto no sería el costo real, así que
//     el techo que protege el margen dejaría de ser un techo.
//
// Este test lee los archivos como TEXTO a propósito: importar el del proxy
// arrastraría Deno, y lo que hay que comparar son los números escritos.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PREMIUM_LIMITS } from '../lib/subscription';
import { MODEL_PRICING } from '../lib/aiMetrics';
import { FEATURE_POLICY } from '../supabase/functions/_shared/politica';

const raiz = process.cwd();
const proxy = fs.readFileSync(
  path.join(raiz, 'supabase', 'functions', 'ai-proxy', 'index.ts'),
  'utf8',
);

/**
 * Los tres topes de una feature.
 *
 * Antes esto los sacaba del ai-proxy con una expresión regular, porque el proxy
 * es Deno y no se podía importar. Ya no hace falta: la política vive en
 * supabase/functions/_shared/politica.ts, que es TypeScript puro sin nada de
 * Deno dentro. Comparar objetos y no texto significa que un cambio de formato
 * ya no puede romper el test — ni un test roto dejar de comparar.
 */
function politica(feature: string): { free: number; trial: number; premium: number } {
  const p = FEATURE_POLICY[feature];
  assert.ok(p, `no existe la política de ${feature}`);
  return { free: p.freeLimit, trial: p.trialLimit, premium: p.premiumLimit };
}

// ── Los topes del paywall son los que aplica el servidor ──

const EQUIVALENCIAS: [keyof typeof PREMIUM_LIMITS, string][] = [
  ['bodyScansPerDay', 'body_scan'],
  ['coachPosturePerDay', 'coach'],
  ['coachMessagesPerDay', 'coach_chat'],
  ['foodScansPerDay', 'food_scan'],
  ['fridgeScansPerDay', 'fridge_scan'],
  ['planRegensPerDay', 'plan'],
];

for (const [clave, feature] of EQUIVALENCIAS) {
  test(`${clave} coincide con ${feature}.premiumLimit del proxy`, () => {
    assert.equal(
      PREMIUM_LIMITS[clave],
      politica(feature).premium,
      `el paywall dice ${PREMIUM_LIMITS[clave]} y el servidor concede ${politica(feature).premium}`,
    );
  });
}

test('el paywall no promete ningún tope que el servidor no reconozca', () => {
  assert.equal(Object.keys(PREMIUM_LIMITS).length, EQUIVALENCIAS.length);
});

// ── La prueba gratis es más restrictiva que premium, nunca al revés ──

test('ningún tope de prueba supera al de premium', () => {
  // Al revés sería regalar más a quien no ha pagado que a quien sí.
  for (const [, feature] of EQUIVALENCIAS) {
    const p = politica(feature);
    assert.ok(p.trial <= p.premium, `${feature}: prueba ${p.trial} > premium ${p.premium}`);
  }
});

test('ningún tope gratis supera al de prueba', () => {
  for (const [, feature] of EQUIVALENCIAS) {
    const p = politica(feature);
    assert.ok(p.free <= p.trial, `${feature}: gratis ${p.free} > prueba ${p.trial}`);
  }
});

// ── Los precios de los modelos son los mismos en los dos lados ──

test('la tabla de precios del proxy coincide con lib/aiMetrics.ts', () => {
  for (const [modelo, precio] of Object.entries(MODEL_PRICING)) {
    const re = new RegExp(`'${modelo.replace(/[.*+?^$\\{}()|[\\]\\\\]/g, '\\\\$&')}'\\s*:\\s*\\{\\s*inPerM:\\s*([\\d.]+),\\s*outPerM:\\s*([\\d.]+)`);
    const m = proxy.match(re);
    assert.ok(m, `el proxy no tarifa ${modelo}`);
    assert.equal(Number(m![1]), precio.inPerM, `${modelo}: precio de entrada distinto`);
    assert.equal(Number(m![2]), precio.outPerM, `${modelo}: precio de salida distinto`);
  }
});

// ── El presupuesto acota de verdad ──

function constante(nombre: string): number {
  const m = proxy.match(new RegExp(`const ${nombre} = ([\\d.]+);`));
  assert.ok(m, `no encontré ${nombre} en el ai-proxy`);
  return Number(m![1]);
}

test('la prueba gratis tiene menos presupuesto que premium', () => {
  // Quien no ha pagado no puede costar más que quien paga.
  assert.ok(constante('PRESUPUESTO_PRUEBA_USD') < constante('PRESUPUESTO_PREMIUM_USD'));
  assert.ok(constante('PRESUPUESTO_GRATIS_USD') < constante('PRESUPUESTO_PREMIUM_USD'));
});

test('el presupuesto premium deja margen sobre el ingreso neto', () => {
  // 24.900 COP menos ~15% de Play ≈ $5.00 USD. Si la IA se come más de la
  // mitad, no queda para infraestructura ni margen.
  const INGRESO_NETO_USD = 5.0;
  assert.ok(
    constante('PRESUPUESTO_PREMIUM_USD') <= INGRESO_NETO_USD * 0.5,
    'el presupuesto de IA supera la mitad del ingreso neto por usuario',
  );
});

test('agotar la prueba entera cuesta menos que un mes de premium', () => {
  // Si adquirir a alguien costara más que atenderlo, el embudo estaría al revés.
  assert.ok(constante('PRESUPUESTO_PRUEBA_USD') < constante('PRESUPUESTO_PREMIUM_USD') / 4);
});
