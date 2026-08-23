// __tests__/permisosApuntanAFunciones.test.ts
// ─────────────────────────────────────────────────────────
// Que cada GRANT y cada REVOKE apunte a una función que este archivo crea.
//
// `revoke on function` sobre una función que no existe lanza 42883 y ABORTA
// setup.sql entero. `drop function if exists` no: por eso el orden entre los
// dos importa y por eso este fallo es fácil de meter.
//
// Pasó: al añadir p_user_id a reservar_ai, la firma pasó de
// (text,numeric,numeric,text,text) a (uuid,text,numeric,numeric,text,text) — y
// el revoke se quedó apuntando a la vieja, que dos líneas más abajo se borraba.
// Contra una base que nunca tuvo esa versión, el archivo se deshacía completo en
// esa línea. Contra una que sí la tenía, los permisos se aplicaban a la función
// equivocada y la nueva se quedaba sin ninguno.
//
// El analizador de sintaxis no lo ve —es SQL perfectamente válido— y el test de
// orden de tablas tampoco. Hacía falta comparar firmas.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'libpg-query';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'setup.sql'), 'utf8');

/** El nombre de un tipo tal como lo escribe el AST de PostgreSQL. */
function nombreDeTipo(typeName: any): string {
  const partes = (typeName?.names ?? []).map((n: any) => n.String?.sval).filter(Boolean);
  // pg_catalog.int4 → int4. Se normaliza a los alias que se usan al escribir.
  const crudo = partes[partes.length - 1] ?? '?';
  const alias: Record<string, string> = {
    int4: 'integer', int8: 'bigint', bool: 'boolean',
    timestamptz: 'timestamptz', varchar: 'text', float8: 'double precision',
  };
  return alias[crudo] ?? crudo;
}

/** `nombre(tipo, tipo, …)`, normalizado, para poder comparar. */
function firma(nombre: string, tipos: string[]): string {
  return `${nombre}(${tipos.join(',')})`;
}

type Analizado = { creadas: Set<string>; referencias: { firma: string; linea: number; verbo: string }[] };

async function analizar(): Promise<Analizado> {
  const arbol = (await parse(sql)) as { stmts: { stmt: Record<string, any>; stmt_location?: number }[] };
  const creadas = new Set<string>();
  const referencias: { firma: string; linea: number; verbo: string }[] = [];

  for (const s of arbol.stmts) {
    const [tipo, nodo] = Object.entries(s.stmt)[0] as [string, any];
    const linea = sql.slice(0, s.stmt_location ?? 0).split('\n').length;

    if (tipo === 'CreateFunctionStmt') {
      const nombre = (nodo.funcname ?? []).map((n: any) => n.String?.sval).filter(Boolean).join('.');
      // Solo los parámetros de ENTRADA cuentan para la firma.
      const tipos = (nodo.parameters ?? [])
        .filter((p: any) => {
          const modo = p.FunctionParameter?.mode;
          return modo === undefined || modo === 'FUNC_PARAM_DEFAULT' || modo === 'FUNC_PARAM_IN';
        })
        .map((p: any) => nombreDeTipo(p.FunctionParameter?.argType));
      creadas.add(firma(nombre, tipos));
    }

    if (tipo === 'GrantStmt' && nodo.objtype === 'OBJECT_FUNCTION') {
      for (const obj of nodo.objects ?? []) {
        const f = obj.ObjectWithArgs;
        if (!f) continue;
        const nombre = (f.objname ?? []).map((n: any) => n.String?.sval).filter(Boolean).join('.');
        const tipos = (f.objargs ?? []).map((a: any) => nombreDeTipo(a.TypeName ?? a));
        referencias.push({
          firma: firma(nombre, tipos),
          linea,
          verbo: nodo.is_grant ? 'grant' : 'revoke',
        });
      }
    }
  }
  return { creadas, referencias };
}

test('cada grant y cada revoke apunta a una función que el archivo crea', async () => {
  const { creadas, referencias } = await analizar();
  assert.ok(creadas.size > 5, `solo encontré ${creadas.size} funciones creadas: la extracción falla`);
  assert.ok(referencias.length > 5, `solo encontré ${referencias.length} permisos: la extracción falla`);

  const huerfanos = referencias
    .filter((r) => !creadas.has(r.firma))
    .map((r) => `línea ~${r.linea}: ${r.verbo} sobre ${r.firma}, que este archivo no crea`);

  assert.deepEqual(
    huerfanos,
    [],
    'permisos que apuntan al vacío:\n  ' + huerfanos.join('\n  ') +
      '\n  `revoke on function` sobre algo inexistente lanza 42883 y aborta setup.sql entero.',
  );
});

test('los permisos van DESPUÉS de crear la función', async () => {
  // Si el grant va antes del create, falla por el mismo 42883 — solo que en la
  // primera pasada contra una base vacía, que es justo cuando menos se mira.
  const { referencias } = await analizar();
  const problemas: string[] = [];

  for (const r of referencias) {
    const nombre = r.firma.slice(0, r.firma.indexOf('('));
    const iCreate = sql.search(new RegExp(`create or replace function ${nombre.replace('.', '\\.')}\\s*\\(`));
    if (iCreate < 0) continue;
    const lineaCreate = sql.slice(0, iCreate).split('\n').length;
    if (r.linea < lineaCreate) {
      problemas.push(`línea ~${r.linea}: ${r.verbo} sobre ${nombre} antes de crearla (línea ~${lineaCreate})`);
    }
  }
  assert.deepEqual(problemas, [], problemas.join('\n  '));
});

test('reservar_ai tiene sus permisos sobre la firma buena', async () => {
  // El caso concreto, con nombre y apellido, para que no se lea como una regla
  // abstracta que alguien pueda relajar.
  const { creadas } = await analizar();
  assert.ok(
    creadas.has('public.reservar_ai(uuid,text,numeric,numeric,text,text)'),
    'la firma de reservar_ai cambió: revisa también su grant y su revoke',
  );
  assert.match(
    sql,
    /revoke all on function public\.reservar_ai\(uuid, text, numeric, numeric, text, text\)/,
  );
  assert.match(
    sql,
    /grant execute on function public\.reservar_ai\(uuid, text, numeric, numeric, text, text\) to service_role/,
  );
});
