// __tests__/loteDatos.test.ts
// ─────────────────────────────────────────────────────────
// Cuarto lote de la auditoría profunda: lo que se rompe con muchos usuarios
// o con muchos meses de uso. Todo aquí falla contra el commit anterior.
// ─────────────────────────────────────────────────────────

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
/** SQL sin comentarios de línea. */
const leerSql = () => leer('supabase', 'setup.sql').replace(/^\s*--.*$/gm, '');

// ── Consultas que no crecen con la persona ──

test('el mejor histórico se pide por ejercicio y se queda con lo más pesado', () => {
  const src = leerCodigo('lib', 'history.ts');
  assert.match(src, /fetchSetsByExercise\(userId, names\)/, 'sigue bajando TODAS las series');
  assert.match(src, /if \(names\) consulta = consulta\.in\('exercise_name', names\)/);
  assert.match(src, /\.order\('weight_kg', \{ ascending: false/);
  assert.match(src, /if \(names && names\.length === 0\) return \{\};/);
  // Y la pantalla de récords sigue pidiendo todos los ejercicios.
  assert.match(src, /fetchExerciseRecords[\s\S]{0,200}fetchSetsByExercise\(userId\)/);
});

test('el export pagina en vez de quedarse en las primeras mil filas', () => {
  const src = leerCodigo('lib', 'exportData.ts');
  assert.ok(
    !/from\(tabla\)\.select\('\*'\)\.eq\('user_id', userId\);/.test(src),
    'sigue la consulta de un solo tiro (PostgREST corta a 1000 y no avisa)',
  );
  assert.match(src, /\.range\(desde, desde \+ PAGINA - 1\)/);
  assert.match(src, /if \(\(data \?\? \[\]\)\.length < PAGINA\) break;/);
});

test('la pantalla de inicio carga el plan ACTIVO, como el arranque', () => {
  const src = leerCodigo('app', '(tabs)', 'index.tsx');
  const i = src.indexOf("from('training_plans')");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 300), /\.eq\('is_active', true\)/);
});

test('la reactivación recorre a todos los inactivos, no a los primeros mil', () => {
  const src = leerCodigo('supabase', 'functions', 'send-reactivation', 'index.ts');
  assert.ok(!/\.limit\(1000\)/.test(src));
  assert.match(src, /\.range\(desde, desde \+ PAGINA - 1\)/);
  assert.match(src, /\.order\('user_id'\)/, 'sin orden fijo las páginas se solapan');
  assert.match(src, /if \(userIds\.length < PAGINA\) break;/);
});

// ── El teléfono deja de avisar a quien ya se fue ──

test('cerrar sesión olvida el token push de este dispositivo, antes de signOut', () => {
  const push = leerCodigo('lib', 'push.ts');
  assert.match(push, /export async function olvidarPushToken/);
  assert.match(push, /from\('push_tokens'\)\.delete\(\)\.eq\('token', token\)/);

  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  const i = perfil.indexOf('async function handleLogout');
  const fin = perfil.indexOf('\n  async function ', i + 10);
  const bloque = perfil.slice(i, fin > 0 ? fin : undefined);
  const iOlvidar = bloque.indexOf('await olvidarPushToken()');
  const iSignOut = bloque.indexOf('supabase.auth.signOut()');
  assert.ok(iOlvidar > 0, 'el logout no olvida el token');
  assert.ok(iOlvidar < iSignOut, 'después de signOut ya no hay sesión para pasar el RLS');
});

// ── El día es el de Bogotá, en un solo sitio ──

test('el esquema define el día local una sola vez', () => {
  const sql = leerSql();
  assert.match(sql, /create or replace function public\._dia_local\(p_ts timestamptz\)/);
  assert.equal((sql.match(/America\/Bogota/g) ?? []).length, 1, 'la zona horaria tiene que vivir en UN sitio');
  assert.ok(!/completed_at::date/.test(sql), 'el XP sigue tomando el día en UTC');
  assert.ok(!/at time zone 'UTC'/.test(sql), 'las misiones siguen contando días en UTC');
  assert.ok((sql.match(/public\._dia_local\(/g) ?? []).length >= 5, 'no se usa en todos los sitios que antes iban en UTC');
});

// ── Índices y retención ──

test('las tablas que crecen con cada sesión tienen índice por persona y fecha', () => {
  const sql = leerSql();
  for (const idx of [
    'set_logs_user_logged on public.set_logs(user_id, logged_at desc)',
    'set_logs_session on public.set_logs(session_id)',
    'posture_feedback_user_date on public.posture_feedback(user_id, recorded_at desc)',
    'posture_feedback_session on public.posture_feedback(session_id)',
    'transform_photos_user_date on public.transform_photos(user_id, date desc)',
  ]) {
    assert.ok(sql.includes(`create index if not exists ${idx}`), `falta el índice ${idx}`);
  }
});

test('la telemetría de IA se puede purgar; la analítica de producto, no', () => {
  const sql = leerSql();
  assert.match(sql, /create or replace function public\.purgar_ai_telemetry\(p_dias integer default 90\)/);
  assert.match(sql, /delete from public\.ai_telemetry where ts < now\(\) - make_interval\(days => p_dias\)/);
  assert.match(sql, /revoke all on function public\.purgar_ai_telemetry\(integer\) from public, anon, authenticated/);
  assert.match(sql, /p_dias < 30/, 'sin suelo, un cron mal escrito vacía la tabla');
  // De analytics_events salen las cohortes y la retención: no se toca.
  assert.ok(!/delete from public\.analytics_events/.test(sql));
});
