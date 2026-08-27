// __tests__/webhookRC.test.ts
// El webhook es la unica via por la que una compra se convierte en acceso. Un
// fallo aqui no se ve en ninguna pantalla: se ve en el correo de alguien que
// pago y no tiene lo que pago.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { veredictoPremium, listaDeEntitlements } from '../supabase/functions/_shared/entitlements';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const webhook = leer('supabase', 'functions', 'rc-webhook', 'index.ts');
const setup = leer('supabase', 'setup.sql');

const AHORA = Date.parse('2026-08-23T12:00:00Z');
const FUTURO = '2026-09-23T12:00:00Z';
const LISTA = listaDeEntitlements(undefined);

// ── El periodo de prueba viaja ──

test('un entitlement en periodo de prueba se reconoce como prueba', () => {
  // sync-premium escribia is_premium y NUNCA is_trial, y es el camino que corre
  // justo despues de comprar. La fila quedaba is_premium=true, is_trial=false:
  // alguien en su primer dia entraba con el presupuesto de quien paga.
  const r = veredictoPremium({
    entitlements: { premium: { expires_date: FUTURO, product_identifier: 'premium_monthly' } },
    subscriptions: { premium_monthly: { expires_date: FUTURO, period_type: 'trial' } },
  }, LISTA, AHORA);
  assert.equal(r.premium, true);
  assert.equal(r.esPrueba, true);
});

test('un precio introductorio NO es prueba: paga menos, pero paga', () => {
  const r = veredictoPremium({
    entitlements: { premium: { expires_date: FUTURO, product_identifier: 'premium_monthly' } },
    subscriptions: { premium_monthly: { expires_date: FUTURO, period_type: 'intro' } },
  }, LISTA, AHORA);
  assert.equal(r.esPrueba, false);
});

test('si RevenueCat no dice el periodo, no se toca is_trial', () => {
  // null y false son cosas distintas: pisar is_trial con false por un campo
  // ausente le daria el presupuesto de premium a quien esta probando.
  const r = veredictoPremium({
    entitlements: { premium: { expires_date: FUTURO, product_identifier: 'premium_monthly' } },
    subscriptions: { premium_monthly: { expires_date: FUTURO } },
  }, LISTA, AHORA);
  assert.equal(r.premium, true);
  assert.equal(r.esPrueba, null);
});

test('sin Premium, la prueba queda en false y no en null', () => {
  // En null, is_trial conservaria un true viejo de una prueba ya expirada.
  assert.equal(veredictoPremium({ entitlements: {} }, LISTA, AHORA).esPrueba, false);
});

test('sync-premium escribe is_trial, no solo is_premium', () => {
  const sp = leer('supabase', 'functions', 'sync-premium', 'index.ts');
  assert.match(sp, /cambios\.is_trial = premium && veredicto\.esPrueba/);
  assert.match(sp, /veredicto\.esPrueba !== null/, 'un periodo desconocido no puede pisar la columna');
});

// ── Una sola lista de eventos ──

test('la lista de eventos que cambian estado no esta duplicada', () => {
  // El SQL llevaba su propia lista escrita a mano y NO coincidia: le faltaban
  // NON_RENEWING_PURCHASE, TEMPORARY_ENTITLEMENT_GRANT y REFUND_REVERSED, y le
  // sobraba SUBSCRIPTION_PAUSED. El control de orden comparaba contra un
  // conjunto distinto del que de verdad cambia el estado.
  assert.ok(!/const STATE_CHANGING = new Set/.test(webhook), 'la lista muerta sigue ahi');
  assert.match(setup, /state_changing boolean/, 'falta la columna que sustituye a la lista');
  assert.match(setup, /coalesce\(\s*e\.state_changing/, 'el guardian de orden tiene que leer la columna');
});

test('el evento guarda si cambio el estado', () => {
  assert.match(setup, /environment, state_changing\)/);
  assert.match(setup, /p_environment, p_state_changing\)/);
});

// ── Reintentos y sandbox ──

test('un fallo de la RPC devuelve 5xx para que RevenueCat reintente', () => {
  assert.match(webhook, /if \(huboError\)/);
  assert.match(webhook, /\}, 500\)/);
});

test('un duplicado o un evento fuera de orden siguen siendo 200', () => {
  // RevenueCat reintenta hasta cinco veces ante un no-2xx. Devolver 500 por algo
  // que se proceso bien lo haria reintentar para siempre.
  assert.match(webhook, /return json\(\{ ok: true, handled, type, environment \}\)/);
});

test('existe el interruptor para rechazar sandbox en produccion', () => {
  assert.match(webhook, /RC_SOLO_PRODUCCION/);
  assert.match(webhook, /esSandbox/);
});

test('apply_rc_event se concede explicitamente a service_role', () => {
  // Funcionaba por el ALTER DEFAULT PRIVILEGES del proyecto, pero "suele
  // funcionar" no es un contrato: si el revoke a public alcanzara tambien a
  // service_role, el webhook dejaria de aplicar compras sin que nada lo diga.
  assert.match(setup, /grant execute on function public\.apply_rc_event[^;]*to service_role/);
});

// ── Tiempos limite ──

test('las llamadas salientes tienen tiempo limite', () => {
  // Un proveedor que acepta la conexion y se calla dejaba la funcion colgada.
  const proxy = leer('supabase', 'functions', 'ai-proxy', 'index.ts');
  const sync = leer('supabase', 'functions', 'sync-premium', 'index.ts');
  assert.match(proxy, /fetchConTiempo\('https:\/\/api\.openai\.com/);
  assert.match(sync, /fetchConTiempo\(/);
  assert.ok(!/await fetch\('https:\/\/api\.openai\.com/.test(proxy), 'queda un fetch sin tiempo limite');
});

test('si OpenAI no responde se devuelven la reserva y el cupo', () => {
  // La reserva de presupuesto se toma ANTES de llamar: un cuelgue sin devolucion
  // le cobra a alguien una llamada que nunca ocurrio.
  const proxy = leer('supabase', 'functions', 'ai-proxy', 'index.ts');
  //
  // Esto miraba los 900 caracteres anteriores buscando 'ajustar_ai'. Ventana
  // fija otra vez: la devolucion de la reserva paso a ser estructural —toda
  // salida del tramo va por salir(), que la cuadra— y el nombre de la funcion
  // dejo de aparecer cerca. Nada se rompio; el ancla si.
  //
  // Son DOS cuentas distintas y hay que comprobar las dos: el DINERO lo
  // devuelve salir(), y el CUPO diario va aparte porque no siempre se devuelve
  // (un 4xx del proveedor es culpa de la peticion, no nuestra).
  const i = proxy.indexOf('proveedor_no_responde');
  assert.ok(i > 0, 'no encontre el manejo del fallo del proveedor');

  const iCatch = proxy.lastIndexOf('} catch (e) {', i);
  assert.ok(iCatch > 0, 'no encontre el catch del proveedor');
  const bloque = proxy.slice(iCatch, i);

  assert.match(bloque, /refund_ai_usage/, 'no devuelve el cupo diario');
  assert.match(
    bloque,
    /return await salir\(/,
    'no sale por salir(): la reserva se queda cobrada por una llamada que nunca ocurrio',
  );
});
