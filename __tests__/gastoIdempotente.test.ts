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
  // El usuario va PRIMERO y explícito: la función pasó a service_role, y con
  // service role auth.uid() es null.
  assert.match(setup, /function public\.reservar_ai\(\s*\n?\s*p_user_id uuid,\s*\n?\s*p_request_id text/);
  assert.match(setup, /raise exception 'reservar_ai requiere un request_id'/);
});

test('la idempotencia está atada al dueño y a una reserva viva', () => {
  // Buscar solo por request_id era el agujero: el id lo elige el cliente y viaja
  // en una cabecera, así que fijarlo a una constante hacía que TODAS las
  // llamadas siguientes salieran por la rama de idempotencia — devolviendo saldo
  // y sin sumar nada. El gasto dejaba de apuntarse en ningún sitio.
  assert.match(setup, /where request_id = p_request_id and user_id = v_uid and real_usd is null/);
  assert.match(setup, /raise exception 'request_id ya usado'/);
});

test('reservar_ai no la puede llamar el cliente', () => {
  // Recibe el presupuesto y el estimado como parámetros: con el grant a
  // 'authenticated', una sola llamada con un estimado enorme agotaba el freno
  // global por hora de TODA la plataforma.
  assert.match(setup, /revoke all on function public\.reservar_ai\([^)]*\) from public, anon, authenticated/);
  assert.match(setup, /grant execute on function public\.reservar_ai\([^)]*\) to service_role/);
  assert.ok(
    !/grant execute on function public\.reservar_ai\([^)]*\) to authenticated/.test(setup),
    'reservar_ai no puede concederse a authenticated',
  );
});

test('el proxy reserva con el service role', () => {
  assert.match(proxy, /admin\.rpc\('reservar_ai'/);
  assert.match(proxy, /p_user_id: user\.id/);
});

test('si el contador diario corta, la reserva se devuelve', () => {
  // Era el único retorno posterior a la reserva que no la liberaba: cobraba
  // dinero por una llamada que nunca se hizo, y repitiéndolo, el mes entero.
  //
  // Esto miraba los 600 caracteres anteriores al corte. Frágil: alargar un
  // comentario en medio empujaba la llamada fuera de la ventana y el test caía
  // sin que nada se hubiera roto. Peor aún, lo contrario también colaba —una
  // llamada a ajustar_ai que quedara detrás de OTRO return contaría igual,
  // aunque en este camino no se ejecutara nunca.
  //
  // Lo que hay que comprobar no es la distancia sino el CAMINO: que entre
  // devolver la reserva y cortar no haya ningún return que se la salte.
  const i = proxy.indexOf("code: 'limit_reached'");
  assert.ok(i > 0, 'no encontré el corte por tope diario');

  // El TRAMO de código que lleva a este corte: desde el return anterior —donde
  // acaba el camino de antes— hasta este. Buscar hacia atrás sin acotar no
  // servía: encontraba el ajustar_ai de otro camino (el de la caída del
  // proveedor) y daba el test por bueno con esta rama vacía. Comprobado
  // borrando la llamada: así sí falla.
  const iReturn = proxy.lastIndexOf('return json(', i);
  assert.ok(iReturn > 0, 'no encontré el return del corte');

  const anterior = proxy.slice(0, iReturn);
  const iTramo = Math.max(anterior.lastIndexOf('return json('), anterior.lastIndexOf('return;'));
  assert.ok(iTramo > 0, 'no encontré dónde empieza este camino');

  // La LLAMADA, no el nombre. Buscar "ajustar_ai" a secas lo encontraba dentro
  // del console.error de la línea siguiente —'ajustar_ai tras tope diario:'—
  // así que borrar la llamada entera dejaba el test en verde.
  assert.match(
    proxy.slice(iTramo, iReturn),
    /rpc\('ajustar_ai'/,
    'el corte por tope diario no devuelve la reserva: cobra por una llamada que nunca se hizo',
  );
});

test('el estimado es conservador, no la media', () => {
  // 4 caracteres por token es la MEDIA para prosa. Una reserva se hace con el
  // peor caso razonable: lo que se reserva de menos se gasta igual y nadie lo
  // apunta. Y el prompt de seguridad lo añade el servidor DESPUÉS de medir.
  assert.match(proxy, /CARACTERES_POR_TOKEN = 2/);
  assert.match(proxy, /TOKENS_PROMPT_SEGURIDAD/);
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
