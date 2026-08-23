// __tests__/killSwitch.test.ts
// Un interruptor de emergencia que falla ABIERTO no es un interruptor.
//
// La primera version dejaba todo encendido si la tabla no respondia, se
// lanzaba sin esperar, leia una variable de modulo sin reactividad, y el
// servidor no la miraba en absoluto. O sea: una consulta SQL NO apagaba la
// funcion. Una app vieja, un enlace directo o una peticion hecha a mano seguian
// gastando IA en algo supuestamente apagado.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const leerCodigo = (...p: string[]) =>
  leer(...p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const flags = leerCodigo('lib', 'featureFlags.ts');
const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
const guardia = leerCodigo('Components', 'GuardiaFlag.tsx');

// ── Falla cerrado donde importa ──

test('las funciones de riesgo arrancan BLOQUEADAS', () => {
  // Son las que emiten estimaciones corporales y correcciones de tecnica a
  // partir de una foto. Si hay que apagarlas es porque estan diciendo algo que
  // no deberian, y en ese momento un movil sin cobertura no puede ser excepcion.
  const bloque = flags.slice(flags.indexOf('MIENTRAS_NO_SE_SEPA'), flags.indexOf('CACHE_KEY'));
  assert.match(bloque, /body_scan: \{ activo: false/);
  assert.match(bloque, /postura: \{ activo: false/);
});

test('lo que no es de riesgo arranca disponible', () => {
  // Bloquear el coach de texto por un fallo de red seria romper la app sin
  // ganar nada.
  const bloque = flags.slice(flags.indexOf('MIENTRAS_NO_SE_SEPA'), flags.indexOf('CACHE_KEY'));
  assert.match(bloque, /coach_ia: \{ activo: true/);
});

test('un apagado sobrevive a quedarse sin red', () => {
  // Si el servidor no contesta, se usa la ultima respuesta buena. Volver a los
  // valores de partida reabriria una funcion que se apago a proposito... o
  // dejaria apagada una que estaba bien.
  assert.match(flags, /if \(deCache\)/);
  assert.match(flags, /AsyncStorage\.setItem\(CACHE_KEY/);
});

// ── Se espera, y es reactivo ──

test('el arranque ESPERA a los interruptores', () => {
  // Lanzarlos sin await dejaba la primera pantalla con los valores de partida,
  // asi que el estado dependia de una carrera.
  assert.match(leerCodigo('app', 'index.tsx'), /await cargarFlags\(\)/);
});

test('el guardia se entera si la respuesta llega despues del render', () => {
  // Antes leia la variable de modulo una sola vez. Con las funciones de riesgo
  // bloqueadas por defecto, eso las dejaba bloqueadas para siempre.
  assert.match(guardia, /suscribirseAFlags/);
  assert.match(guardia, /useState<Flag>/);
});

// ── Y el servidor tambien corta ──

test('ai-proxy comprueba el interruptor', () => {
  // Sin esto, apagar algo con una consulta SQL no apagaba nada: el cliente es
  // una sugerencia, el servidor es la puerta.
  assert.match(proxy, /from\('feature_flags'\)/);
  assert.match(proxy, /code: 'feature_apagada'/);
});

test('el servidor corta ANTES de reservar presupuesto', () => {
  // Apagar una funcion no puede costar dinero.
  const iFlag = proxy.indexOf("from('feature_flags')");
  const iReserva = proxy.indexOf("rpc('reservar_ai'");
  assert.ok(iFlag > 0 && iReserva > 0);
  assert.ok(iFlag < iReserva, 'la comprobacion del flag va antes de la reserva');
});

test('si no se puede leer el interruptor, no se ejecuta', () => {
  // Fail-closed, igual que la compuerta clinica.
  const i = proxy.indexOf('feature_flags');
  const bloque = proxy.slice(i, i + 900);
  assert.match(bloque, /if \(flagError\)/);
  assert.match(bloque, /\}, 503\)/);
});

test('la validacion de foto se apaga CON el analisis corporal', () => {
  // Dejarla viva permitiria seguir mandando fotos corporales a la IA con la
  // funcion "apagada".
  assert.match(proxy, /scan_check: 'body_scan'/);
});

test('el analisis de tecnica tiene su propio interruptor', () => {
  assert.match(proxy, /coach: 'postura'/);
});

// ── La tabla existe y solo se lee ──

test('feature_flags es de lectura para el cliente', () => {
  const setup = leer('supabase', 'setup.sql');
  assert.match(setup, /create table if not exists public\.feature_flags/);
  assert.match(setup, /grant select on public\.feature_flags to anon, authenticated/);
  assert.match(setup, /revoke insert, update, delete on public\.feature_flags/);
});

test('reactivar algo apagado es una decision manual', () => {
  // `on conflict do nothing`: volver a correr setup.sql no puede reencender lo
  // que alguien apago a proposito.
  const setup = leer('supabase', 'setup.sql');
  const i = setup.indexOf("insert into public.feature_flags");
  assert.ok(i > 0);
  assert.match(setup.slice(i, i + 400), /on conflict \(clave\) do nothing/);
});
