// __tests__/loteSeguridadYDinero.test.ts
// ─────────────────────────────────────────────────────────
// Primer lote de la auditoría profunda: seguridad y dinero.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const leerCodigo = (...p: string[]) =>
  leer(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');

const setup = leerCodigo('supabase', 'setup.sql');
const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
const payload = leerCodigo('supabase', 'functions', '_shared', 'payload.ts');
const cliente = leerCodigo('lib', 'aiClient.ts');

// ── Un id abierto y joven no es un reintento ──

test('un duplicado en vuelo (mismo request_id, reserva joven) se rechaza', () => {
  // Diez peticiones concurrentes con el mismo id entraban todas por la rama de
  // idempotencia: ninguna sumaba al presupuesto ni al freno global, las diez
  // llegaban a OpenAI y solo la primera en terminar apuntaba su costo.
  const i = setup.indexOf('function public.reservar_ai(');
  const cuerpo = setup.slice(i, setup.indexOf('grant execute on function public.reservar_ai', i));
  assert.match(cuerpo, /select reservado_usd, creado_at into v_ya, v_creado/, 'no lee cuándo se creó la reserva');
  assert.match(cuerpo, /v_creado > now\(\) - interval '2 minutes'/, 'no distingue una reserva en vuelo de una huérfana');
  assert.match(cuerpo, /raise exception 'peticion_en_curso'/);
  assert.match(cuerpo, /v_creado timestamptz;/, 'v_creado no está declarada');
});

test('la huérfana de verdad SIGUE aceptándose como reintento', () => {
  // El proxy puede morir entre reservar y cuadrar. Ese caso conserva el
  // sentido original: se devuelve el saldo y no se cobra dos veces.
  const i = setup.indexOf("raise exception 'peticion_en_curso'");
  const despues = setup.slice(i, i + 400);
  assert.match(despues, /return p_budget_usd - coalesce\(v_total, 0\)/);
});

test('el proxy traduce el duplicado a 409 con código propio', () => {
  assert.match(proxy, /code: 'peticion_en_curso' \}, 409\)/);
});

// ── El freno global no se cobra a la persona ──

test('el freno global devuelve -1 y el proxy lo distingue del presupuesto agotado', () => {
  const i = setup.indexOf('techo global por hora alcanzado');
  assert.ok(i > 0);
  assert.match(setup.slice(i, i + 300), /return -1;/, 'el freno global sigue devolviendo null, indistinguible de "tu mes se acabó"');
  assert.match(proxy, /restante === -1/, 'el proxy no mira el -1');
  assert.match(proxy, /code: 'plataforma_saturada'/);
  // Y ANTES de tratar el restante como una reserva válida.
  assert.ok(proxy.indexOf('restante === -1') < proxy.indexOf('let reservaAbierta = true'));
});

test('a la persona no se le dice que es SU máximo cuando es la plataforma', () => {
  const i = proxy.indexOf("code: 'plataforma_saturada'");
  const bloque = proxy.slice(i - 300, i);
  assert.ok(!/máximo de IA de este mes/.test(bloque));
  assert.match(bloque, /mucha gente usando la IA/);
});

// ── Las vistas de operador no son del cliente ──

test('las vistas cross-usuario están revocadas para el cliente', () => {
  assert.match(
    setup,
    /revoke all on public\.v_user_traits, public\.v_daily_activity,\s*public\.v_cohort_retention, public\.v_power_curve\s*from public, anon, authenticated;/,
    'una vista sin RLS heredada y sin revoke la lee cualquier JWT por PostgREST',
  );
});

test('el revoke va DESPUÉS de crear las vistas', () => {
  const iRevoke = setup.indexOf('revoke all on public.v_user_traits');
  for (const v of ['v_user_traits', 'v_daily_activity', 'v_cohort_retention', 'v_power_curve']) {
    const iCreate = setup.indexOf(`create or replace view public.${v}`);
    assert.ok(iCreate > 0 && iCreate < iRevoke, `${v} se revoca antes de existir: 42883 y setup.sql aborta`);
  }
});

// ── Ninguna parte del mensaje pasa sin medirse ──

test('una parte de tipo desconocido se rechaza en vez de pasar gratis', () => {
  assert.match(payload, /p\?\.type === 'text' && typeof p\.text === 'string'/);
  assert.match(payload, /marcar\('Tipo de contenido no admitido\.'\)/, 'un PDF en base64 entra sin contar para nada');
});

// ── Los códigos nuevos llegan al usuario con su texto ──

test('el cliente confía en los dos códigos nuevos y enseña su mensaje', () => {
  assert.match(cliente, /'peticion_en_curso', 'plataforma_saturada'\]/);
  assert.match(cliente, /codigoServidor === 'peticion_en_curso' \|\| codigoServidor === 'plataforma_saturada'/);
});

// ── Costos: lo que corre solo, contado y acotado ──

test('la comprobación de la foto usa el modelo barato', () => {
  const bs = leerCodigo('app', 'body-scan.tsx');
  const i = bs.indexOf('async function validatePhoto(');
  const j = bs.indexOf('async function analyzeBodyPhotos', i);
  assert.match(bs.slice(i, j), /model: 'gpt-4o-mini'/, 'una pregunta binaria en gpt-4o cuesta 6-8× lo documentado');
  // Y el análisis de verdad sigue en el modelo bueno.
  // Hasta la siguiente función: el prompt del análisis es largo y la línea del
  // modelo queda muy por debajo de la cabecera.
  const fin = bs.indexOf('\nasync function', j + 10);
  assert.match(bs.slice(j, fin > 0 ? fin : undefined), /model: 'gpt-4o',/);
});

test('el destilado de memoria corre cada 4 mensajes y no fuerza a la primera', () => {
  const chat = leerCodigo('app', 'coach-chat.tsx');
  assert.match(chat, /userCount - distilledRef\.current < 4\) return;/);
  assert.match(chat, /contextPressure >= 85\) maybeDistill/);
  // Y sigue en el modelo bueno: guarda lesiones y condiciones.
  const mem = leerCodigo('lib', 'coachMemory.ts');
  assert.match(mem, /model: 'gpt-4o'/, 'el destilado se bajó de modelo: perder "hernia L5-S1" es riesgo clínico');
});

test('el test de economía cuenta lo automático', () => {
  const eco = leer('__tests__', 'economiaPremium.test.ts');
  for (const k of ['suggestion', 'scoring', 'memoria']) {
    assert.match(eco, new RegExp('^\\s*' + k + ':\\s*[\\d./]+', 'm'), `DIA_INTENSIVO_REAL no cuenta "${k}"`);
    assert.match(eco, new RegExp('^\\s*' + k + ':\\s*0\\.\\d+', 'm'), `COSTO_USD no tiene precio para "${k}" (el ?? 0 lo contaría gratis)`);
  }
});

test('el techo Premium cubre el día intensivo honesto y no se come el ingreso', () => {
  const m = proxy.match(/const PRESUPUESTO_PREMIUM_USD = ([\d.]+);/);
  assert.ok(m, 'no encontré el techo Premium');
  const techo = Number(m![1]);
  assert.ok(techo >= 2.2, `techo ${techo}: el día intensivo real ($2,20/mes) no cabe, se queda sin IA antes del día 30`);
  assert.ok(techo <= 2.5, `techo ${techo}: se come más del 50% de los $5 netos`);
});
