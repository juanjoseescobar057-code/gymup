// __tests__/gastoIdempotente.test.ts
// La reserva atomica cerro la concurrencia. No cerraba el reintento: un timeout
// del proveedor seguido del reintento del cliente reservaba DOS VECES la misma
// peticion, asi que un mal minuto de red le comia el presupuesto a alguien que
// no hizo nada raro.
//
// Y no habia forma de responder "cuanto cuesta un usuario premium" con un numero
// medido: ai_cost_usage solo guarda el acumulado del mes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const setup = leer('supabase', 'setup.sql');
const proxy = leer('supabase', 'functions', 'ai-proxy', 'index.ts');
const cliente = leer('lib', 'aiClient.ts');

// ── Idempotencia ──

test('la reserva exige un request_id', () => {
  assert.match(setup, /function public\.reservar_ai\(\s*\n?\s*p_request_id text/);
  assert.match(setup, /raise exception 'reservar_ai requiere un request_id'/);
});

test('el mismo request_id no reserva dos veces', () => {
  const i = setup.indexOf('function public.reservar_ai(');
  const cuerpo = setup.slice(i, setup.indexOf('grant execute on function public.reservar_ai', i));
  // Busca la reserva previa ANTES de tocar el acumulado.
  const iBusca = cuerpo.indexOf('from public.ai_reservas where request_id = p_request_id');
  const iInserta = cuerpo.indexOf('insert into public.ai_cost_usage');
  assert.ok(iBusca > 0, 'no comprueba si ya reservo');
  assert.ok(iBusca < iInserta, 'la comprobacion de idempotencia va ANTES de cobrar');
});

test('la firma vieja se elimina', () => {
  // Dejarla viva seria un camino que reserva SIN idempotencia, y Postgres
  // elegiria una u otra por resolucion de sobrecarga.
  assert.match(setup, /drop function if exists public\.reservar_ai\(numeric, numeric\)/);
  assert.match(setup, /drop function if exists public\.ajustar_ai\(uuid, numeric, numeric\)/);
});

test('cuadrar dos veces no resta dos veces', () => {
  const i = setup.indexOf('function public.ajustar_ai(');
  const cuerpo = setup.slice(i, i + 1400);
  assert.match(cuerpo, /real_usd is null/, 'solo cuadra reservas abiertas');
  assert.match(cuerpo, /if not found then return; end if/);
});

// ── El libro mayor ──

test('cada peticion deja una fila con lo reservado y lo real', () => {
  assert.match(setup, /create table if not exists public\.ai_reservas/);
  // Se busca dentro del bloque de la tabla, con includes. Un RegExp construido
  // con '\b' en comillas simples da un BACKSPACE, no un límite de palabra: el
  // test pasaría a verde sin comprobar nada. Ya pasó escribiendo este archivo.
  const i = setup.indexOf('create table if not exists public.ai_reservas');
  const bloque = setup.slice(i, setup.indexOf(');', i));
  for (const col of ['request_id', 'reservado_usd', 'real_usd', 'feature', 'modelo']) {
    assert.ok(bloque.includes(col), `falta la columna ${col}`);
  }
});

test('el libro mayor no lo escribe el cliente', () => {
  const i = setup.indexOf('create table if not exists public.ai_reservas');
  assert.match(setup.slice(i, i + 900), /enable row level security/);
  assert.ok(
    !/grant [^;]*on public\.ai_reservas to (anon|authenticated)/.test(setup),
    'ai_reservas no puede ser escribible por el cliente',
  );
});

// ── El freno global ──

test('existe un techo para toda la plataforma, no solo por usuario', () => {
  // Los presupuestos por usuario acotan lo que cuesta UNA persona. No acotan una
  // manana rara: mil cuentas anonimas, un bucle, un reintento nuestro.
  assert.match(setup, /function public\.techo_global_hora\(\)/);
  assert.match(setup, /creado_at > now\(\) - interval '1 hour'/);
});

test('el freno global se comprueba ANTES que el del usuario', () => {
  const i = setup.indexOf('function public.reservar_ai(');
  const cuerpo = setup.slice(i, setup.indexOf('grant execute on function public.reservar_ai', i));
  const iGlobal = cuerpo.indexOf('techo_global_hora()');
  const iUsuario = cuerpo.indexOf('insert into public.ai_cost_usage');
  assert.ok(iGlobal > 0 && iGlobal < iUsuario, 'si la plataforma esta en llamas, da igual de quien sea la peticion');
});

// ── El camino completo ──

test('el proxy manda el request_id', () => {
  assert.match(proxy, /x-gymup-request-id/);
  assert.match(proxy, /p_request_id: requestId/);
});

test('el cliente genera un id estable por llamada', () => {
  assert.match(cliente, /function nuevoRequestId\(\)/);
  assert.match(cliente, /const requestId = meta\?\.requestId \?\? nuevoRequestId\(\)/);
  assert.match(cliente, /'x-gymup-request-id'/);
});

test('la cabecera nueva pasa el CORS', () => {
  // Sin esto el navegador la bloquea y el id nunca llega: idempotencia silenciosamente muerta.
  assert.match(proxy, /Access-Control-Allow-Headers[^\n]*x-gymup-request-id/);
});
