// __tests__/tresPuertasQueFallabanAbiertas.test.ts
// ─────────────────────────────────────────────────────────
// Tres sitios donde "no lo sé" o "falta el secreto" significaban "adelante".
// De la auditoría externa, verificados uno por uno.
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

// ── 1. La autorización médica se conservaba ante un fallo de lectura ──

test('un error leyendo el tamizaje anterior retira la autorización médica', () => {
  // Se leía el perfil previo IGNORANDO el error: `prev` quedaba en null, el
  // bloque de revalidación no entraba, y doctor_cleared se guardaba tal cual
  // llegó. Un fallo de red conservaba una autorización que la condición recién
  // declarada debía anular.
  const health = leerCodigo('lib', 'health.ts');
  assert.match(
    health,
    /const \{ data: prev, error: errPrev \}/,
    'sigue descartando el error de la lectura anterior',
  );
  const i = health.indexOf('if (errPrev)');
  assert.ok(i > 0, 'no hace nada con ese error');
  const bloque = health.slice(i, i + 140);
  assert.match(bloque, /doctorCleared = false/, 'ante el error conserva la autorización');
});

// ── 2. Sandbox de RevenueCat aceptado si falta el secreto ──

test('sin el secreto puesto, las compras de sandbox se rechazan', () => {
  // Estaba en `=== 'true'`: si RC_SOLO_PRODUCCION no existía —despliegue nuevo,
  // proyecto clonado, alguien que lo borra— los eventos de SANDBOX se aplicaban
  // como compras reales. Y una compra sandbox es gratis: cualquiera con el SDK
  // en modo prueba se concede Premium.
  const webhook = leerCodigo('supabase', 'functions', 'rc-webhook', 'index.ts');
  assert.match(
    webhook,
    /RC_SOLO_PRODUCCION'\) !== 'false'/,
    'un secreto ausente sigue significando "acepta compras falsas"',
  );
  assert.ok(
    !/RC_SOLO_PRODUCCION'\) === 'true'/.test(webhook),
    'sigue la comparación que falla abierta',
  );
});

// ── 3. El borrado de cuenta dejaba filas atrás ──

test('el borrado cubre los consentimientos, el gasto y las compras', () => {
  // El cascade de auth.users las habría barrido al final, pero el contrato de
  // esta función es borrar TODOS los datos primero y la identidad después: si
  // el borrado de identidad falla, la interfaz dice "completo" y esas filas
  // siguen ahí.
  const del = leerCodigo('supabase', 'functions', 'delete-account', 'index.ts');
  const i = del.indexOf('const TABLES = [');
  const fin = del.indexOf('];', i);
  const tablas = del.slice(i, fin);
  for (const t of ['legal_consents', 'ai_reservas', 'ai_cost_usage', 'rc_webhook_events']) {
    assert.ok(tablas.includes(`'${t}'`), `el borrado no cubre ${t}`);
  }
});

test('y no ha perdido ninguna de las que ya cubría', () => {
  const del = leerCodigo('supabase', 'functions', 'delete-account', 'index.ts');
  const i = del.indexOf('const TABLES = [');
  const tablas = del.slice(i, del.indexOf('];', i));
  for (const t of [
    'set_logs', 'body_scans', 'workout_sessions', 'food_logs', 'weight_entries',
    'transform_photos', 'training_plans', 'user_stats', 'push_tokens', 'ai_usage',
    'coach_memory', 'workout_readiness', 'health_profile', 'user_profiles',
  ]) {
    assert.ok(tablas.includes(`'${t}'`), `desapareció ${t} de la lista de borrado`);
  }
});

test('user_profiles se borra el ÚLTIMO', () => {
  // Otras tablas y las políticas cuelgan de él: borrarlo primero dejaría el
  // resto sin dueño a media faena.
  const del = leerCodigo('supabase', 'functions', 'delete-account', 'index.ts');
  const i = del.indexOf('const TABLES = [');
  const tablas = del.slice(i, del.indexOf('];', i));
  assert.ok(
    tablas.lastIndexOf("'user_profiles'") > tablas.lastIndexOf("'legal_consents'"),
    'user_profiles ya no va al final',
  );
});
