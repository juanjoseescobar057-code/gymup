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

// ─────────────────────────────────────────────────────────
// Y lo mismo para la CI, que es donde MÁS duele equivocarse.
//
// .github/workflows/esquema.yml comprueba con has_function_privilege que las
// RPC de dinero no sean ejecutables por el cliente. Ese predicado resuelve su
// argumento como regprocedure: contra una función inexistente lanza 42883, y
// con `psql -v ON_ERROR_STOP=1` eso ABORTA el paso completo.
//
// O sea que una firma mal escrita no hace fallar la compuerta: la hace
// DESAPARECER, y el job sigue en verde sin comprobar ninguna de sus reglas.
// Pasó: ajustar_ai es (text, uuid, numeric) y el workflow decía
// (uuid, numeric, numeric).
// ─────────────────────────────────────────────────────────

test('las firmas que comprueba la CI existen en setup.sql', async () => {
  const yml = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'esquema.yml'),
    'utf8',
  );
  const { creadas } = await analizar();

  // 'public.nombre(tipo, tipo)' dentro de has_function_privilege.
  const referencias = [...yml.matchAll(/'(public\.[a-z_]+\([^')]*\))'/g)].map((m) => m[1]);
  assert.ok(
    referencias.length >= 5,
    `solo encontré ${referencias.length} firmas en el workflow: la extracción falla`,
  );

  const huerfanas = referencias.filter((r) => {
    // Normalizar espacios para comparar con lo que devuelve el analizador.
    const sinEspacios = r.replace(/\s+/g, '');
    return !creadas.has(sinEspacios);
  });

  assert.deepEqual(
    huerfanas,
    [],
    'la CI pregunta por firmas que setup.sql no crea:\n  ' + huerfanas.join('\n  ') +
      '\n  has_function_privilege lanza 42883 contra una función inexistente, y con\n' +
      '  ON_ERROR_STOP=1 eso aborta el paso entero: la compuerta desaparece en verde.',
  );
});

test('la prueba de concurrencia ejecuta la función REAL', () => {
  // Había una copia escrita a mano (_reservar_test) porque auth.uid() no tiene
  // JWT detrás en CI. Y había divergido: sin freno global por hora, sin
  // idempotencia y sin escribir en ai_reservas. La compuerta probaba la
  // atomicidad de un código que no se despliega — habría seguido en verde
  // aunque se rompiera la de verdad.
  const yml = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'esquema.yml'),
    'utf8',
  );
  const sinComentarios = yml.replace(/^\s*--.*$/gm, '').replace(/^\s*#.*$/gm, '');
  assert.ok(
    !/create or replace function public\._reservar_test/.test(sinComentarios),
    'sigue existiendo la copia de reservar_ai: la compuerta no prueba la función que se despliega',
  );
  assert.match(
    sinComentarios,
    /select public\.reservar_ai\(/,
    'la prueba de concurrencia no llama a reservar_ai',
  );
});

test('la concurrencia usa un request_id distinto por llamada', () => {
  // Con el mismo id, la idempotencia de reservar_ai trataría las 100 como
  // reintentos de la misma petición: cabría una, el techo no se rozaría, y la
  // compuerta pasaría sin haber probado ninguna concurrencia.
  const yml = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'esquema.yml'),
    'utf8',
  );
  const i = yml.indexOf('select public.reservar_ai(');
  assert.ok(i > 0, 'no encontré la llamada');
  const llamada = yml.slice(i, i + 200);
  assert.match(llamada, /ci-\$\{i\}|ci-\$i/, 'el request_id es constante en las 100 llamadas');
});
