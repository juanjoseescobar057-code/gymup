// __tests__/esquemaCompila.test.ts
// ─────────────────────────────────────────────────────────
// setup.sql tiene que ser SQL VÁLIDO. Con el analizador de verdad, no con
// expresiones regulares.
//
// Esto existe porque metí la pata exactamente aquí. `reservar_ai` y
// `ajustar_ai` acabaron con `as $` y `end $;` — un solo dólar — porque el
// heredoc del shell se comió el segundo al escribirlas. PostgreSQL exige
// `$$ … $$`, así que el archivo canónico ABORTABA en esa zona: las dos
// funciones de la reserva de presupuesto nunca se instalaban y el proxy
// respondía 503 al intentar reservar.
//
// Y mis dos tests de esquema decían, en su propia cabecera, que no ejecutaban
// SQL. Comprobaban el ORDEN de las sentencias y la ÚNICA fuente, que está bien,
// pero ninguno miraba si el archivo era siquiera analizable. Un test que no
// puede fallar ante un error de sintaxis no protege de errores de sintaxis.
//
// libpg-query es el analizador REAL de PostgreSQL compilado a WASM: la misma
// gramática del servidor. No ejecuta —eso necesita un servidor, y va en CI con
// un Postgres efímero (.github/workflows/esquema.yml)— pero sí rechaza todo lo
// que el servidor rechazaría al leerlo.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'libpg-query';

const RUTA = path.join(process.cwd(), 'supabase', 'setup.sql');
const sql = fs.readFileSync(RUTA, 'utf8');

test('setup.sql es SQL válido de principio a fin', async () => {
  try {
    const arbol = await parse(sql);
    assert.ok(
      (arbol as { stmts?: unknown[] })?.stmts?.length,
      'el analizador no encontró ninguna sentencia',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // El error de libpg-query trae la posición en caracteres: se traduce a
    // línea para que sea accionable sin contar a mano.
    const pos = Number((e as { cursorPosition?: number })?.cursorPosition ?? 0);
    const linea = pos > 0 ? sql.slice(0, pos).split('\n').length : null;
    assert.fail(
      `supabase/setup.sql no es SQL válido: ${msg}` +
        (linea ? `\n  Alrededor de la línea ${linea}:\n    ${sql.split('\n')[linea - 1]?.trim()}` : ''),
    );
  }
});

test('cada cuerpo de función abre y cierra con $$', async () => {
  // El fallo concreto que motivó este archivo. El analizador ya lo cazaría,
  // pero un mensaje que diga "línea 2019: end $;" ahorra la mitad del rato.
  const lineas = sql.split('\n');
  const rotas: string[] = [];
  lineas.forEach((l, i) => {
    const t = l.trimEnd();
    // `as $` o `end $;` con UN solo dólar: el delimitador está a medias.
    if (/\bas \$$/.test(t) || /^end \$;$/.test(t.trim())) {
      rotas.push(`línea ${i + 1}: ${t.trim()}`);
    }
  });
  assert.deepEqual(
    rotas,
    [],
    'delimitadores de dólar a medias (PostgreSQL exige $$ … $$):\n  ' + rotas.join('\n  '),
  );
});

test('el archivo se puede volver a correr: todo es idempotente', async () => {
  // No basta con que analice una vez. setup.sql se pega entero cada vez que se
  // despliega, así que un `create table` sin `if not exists` o un `create
  // policy` sin su `drop policy` previo revientan en la segunda pasada.
  const arbol = (await parse(sql)) as { stmts: { stmt: Record<string, any> }[] };

  const problemas: string[] = [];
  const politicasSoltadas = new Set<string>();

  for (const { stmt } of arbol.stmts) {
    const [tipo, nodo] = Object.entries(stmt)[0] as [string, any];

    if (tipo === 'CreateStmt' && nodo.if_not_exists !== true) {
      problemas.push(`create table ${nodo.relation?.relname} sin "if not exists"`);
    }
    if (tipo === 'DropStmt' && nodo.removeType === 'OBJECT_POLICY') {
      // La lista llega como [esquema, tabla, política] — el nombre de la
      // política es el ÚLTIMO elemento, y la tabla el penúltimo. Tomarla
      // entera y unirla por puntos daba "public.tabla.politica", que no
      // coincidía con nada y hacía fallar el test contra un archivo correcto.
      for (const obj of nodo.objects ?? []) {
        const partes = (obj.List?.items ?? []).map((x: any) => x.String?.sval).filter(Boolean);
        if (partes.length >= 2) {
          politicasSoltadas.add(`${partes[partes.length - 2]}.${partes[partes.length - 1]}`);
        }
      }
    }
    if (tipo === 'CreatePolicyStmt') {
      const clave = `${nodo.table?.relname}.${nodo.policy_name}`;
      if (!politicasSoltadas.has(clave)) {
        // Las políticas del helper _apply_owner_rls se crean por EXECUTE
        // dinámico, así que no aparecen aquí como CreatePolicyStmt.
        problemas.push(`create policy ${clave} sin "drop policy if exists" antes`);
      }
    }
    if (tipo === 'IndexStmt' && nodo.if_not_exists !== true && !nodo.concurrent) {
      problemas.push(`create index ${nodo.idxname} sin "if not exists"`);
    }
  }

  assert.deepEqual(
    problemas,
    [],
    'setup.sql no aguanta una segunda pasada:\n  ' + problemas.join('\n  '),
  );
});

test('las funciones de dinero existen y las crea este archivo', async () => {
  // Si reservar_ai no se instala, el proxy no puede reservar presupuesto y
  // responde 503: la IA deja de funcionar entera. Estuvo así.
  for (const fn of ['reservar_ai', 'ajustar_ai', 'increment_ai_usage', 'ai_budget_restante']) {
    assert.ok(
      sql.includes(`function public.${fn}(`),
      `setup.sql no crea public.${fn}`,
    );
  }
});
