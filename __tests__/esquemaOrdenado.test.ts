// __tests__/esquemaOrdenado.test.ts
// ─────────────────────────────────────────────────────────
// Que setup.sql corra contra una base VACÍA.
//
// No corría. `delete from public.mission_catalog` estaba nueve líneas ANTES del
// `create table` de esa misma tabla, así que contra una base limpia el archivo
// abortaba con 42P01 y hacía rollback de todo. En producción no se notó nunca
// porque la tabla existe desde agosto — el fallo solo aparece justo cuando más
// falta hace: montar un staging, arrancar en local, recuperar tras un desastre.
//
// Y yo había afirmado que setup.sql era «idempotente, se puede correr las veces
// que quieras». Contra una base vacía, no.
//
// Esto no ejecuta SQL: recorre el archivo y comprueba que ninguna sentencia
// toque una tabla antes de crearla. Es una aproximación, pero atrapa la clase
// entera de fallo sin necesitar un Postgres.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'setup.sql'), 'utf8');

/** El archivo sin comentarios ni cadenas: solo sentencias. */
const codigo = sql
  .replace(/--[^\n]*/g, '')
  .replace(/\$\$[\s\S]*?\$\$/g, ' CUERPO_DE_FUNCION ') // los cuerpos plpgsql corren después
  .replace(/'[^']*'/g, "''");

/** Dónde se crea cada tabla. -1 si no se crea aquí. */
function posicionDeCreacion(tabla: string): number {
  const re = new RegExp(`create table (?:if not exists )?public\\.${tabla}\\b`);
  const m = codigo.match(re);
  return m?.index ?? -1;
}

/** Las tablas que este archivo crea. */
const TABLAS = [
  ...new Set(
    [...codigo.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]),
  ),
];

test('setup.sql crea tablas', () => {
  assert.ok(TABLAS.length > 10, `solo encontré ${TABLAS.length} tablas: la extracción falla`);
});

test('ninguna sentencia toca una tabla antes de crearla', () => {
  // Las sentencias que fallan con 42P01 si la tabla no existe todavía. Un
  // `create table if not exists` no cuenta, obviamente; un `alter table if
  // exists` tampoco, porque no falla.
  const VERBOS = [
    'delete from',
    'insert into',
    'truncate',
    'update',
    'alter table(?! if exists)',
    'select public\\._apply_owner_rls\\(\'',
  ];

  const problemas: string[] = [];

  for (const tabla of TABLAS) {
    const creacion = posicionDeCreacion(tabla);
    if (creacion < 0) continue;

    for (const verbo of VERBOS) {
      const re = new RegExp(`${verbo}\\s+(?:public\\.)?${tabla}\\b`, 'g');
      for (const uso of codigo.matchAll(re)) {
        if (uso.index! < creacion) {
          const linea = codigo.slice(0, uso.index!).split('\n').length;
          problemas.push(
            `línea ~${linea}: "${uso[0].trim()}" va antes del create table de ${tabla}`,
          );
        }
      }
    }
  }

  assert.deepEqual(
    problemas,
    [],
    'setup.sql aborta contra una base vacía:\n  ' + problemas.join('\n  ') +
      '\n  Mueve la sentencia DESPUÉS del create table correspondiente.',
  );
});

test('las políticas RLS se aplican después de crear su tabla', () => {
  // _apply_owner_rls hace alter table + grant + create policy: si corre antes
  // del create, revienta igual.
  const helpers = [...codigo.matchAll(/select public\._apply_owner_rls\(''\)/g)];
  // El helper recibe el nombre como cadena, y las cadenas están normalizadas a
  // '' arriba. Se comprueba sobre el archivo original.
  const original = sql.replace(/--[^\n]*/g, '');
  for (const m of original.matchAll(/select public\._apply_owner_rls\('(\w+)'\)/g)) {
    const creacion = posicionDeCreacion(m[1]);
    if (creacion < 0) continue;
    // Las posiciones son de archivos distintos (uno con cadenas, otro sin), así
    // que se compara por número de línea, que sí es estable.
    const lineaHelper = original.slice(0, m.index!).split('\n').length;
    const lineaCreacion = sql
      .slice(0, sql.search(new RegExp(`create table (?:if not exists )?public\\.${m[1]}\\b`)))
      .split('\n').length;
    assert.ok(
      lineaHelper > lineaCreacion,
      `_apply_owner_rls('${m[1]}') en la línea ~${lineaHelper} va antes de crear la tabla (~${lineaCreacion})`,
    );
  }
  void helpers;
});

test('el helper de RLS se define antes de usarse', () => {
  const definicion = codigo.indexOf('create or replace function public._apply_owner_rls');
  const primerUso = codigo.indexOf('select public._apply_owner_rls(');
  assert.ok(definicion >= 0, 'no encontré el helper');
  assert.ok(definicion < primerUso, 'el helper se usa antes de definirse');
});

test('el caso concreto que rompía: mission_catalog', () => {
  // Se deja escrito con nombre y apellido para que quede claro qué se rompió y
  // no se lea como una regla abstracta.
  const creacion = sql.indexOf('create table if not exists public.mission_catalog');
  const borrado = sql.indexOf("delete from public.mission_catalog where id = 'w_scan1'");
  assert.ok(creacion > 0 && borrado > 0);
  assert.ok(
    borrado > creacion,
    'el delete de mission_catalog volvió a quedar antes del create table',
  );
});
