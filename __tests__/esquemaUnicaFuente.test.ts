// __tests__/esquemaUnicaFuente.test.ts
// ─────────────────────────────────────────────────────────
// El esquema de este proyecto se despliega pegando supabase/setup.sql en el
// editor SQL. No hay `supabase db push`. Eso funciona mientras setup.sql sea
// LO ÚNICO ejecutable — y dejó de serlo sin que nadie se diera cuenta:
//
//   • supabase/migraciones/ (en español) tenía el presupuesto de IA. La CLI
//     solo lee supabase/migrations. Nunca se aplicó desde ahí.
//   • supabase/migrations/0006 instalaba increment_ai_usage(uuid,text,integer)
//     —con el user_id y el TOPE puestos por quien llama— y se la concedía a
//     'authenticated'. Pegar ese archivo "por si acaso" reabría el agujero que
//     setup.sql cierra.
//
// Estos tests no comprueban SQL: comprueban que no haya dos verdades.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const SETUP = path.join(RAIZ, 'supabase', 'setup.sql');
const setup = fs.readFileSync(SETUP, 'utf8');

/** Todos los .sql de supabase/, con su ruta relativa en formato POSIX. */
function sqlsDeSupabase(dir = path.join(RAIZ, 'supabase'), acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sqlsDeSupabase(p, acc);
    else if (e.name.endsWith('.sql')) acc.push(path.relative(RAIZ, p).split(path.sep).join('/'));
  }
  return acc;
}

test('setup.sql es el ÚNICO .sql ejecutable; el resto vive en historico/', () => {
  const fuera = sqlsDeSupabase().filter(
    (p) => p !== 'supabase/setup.sql' && !p.startsWith('supabase/historico/'),
  );
  assert.deepEqual(
    fuera,
    [],
    `SQL ejecutable fuera de setup.sql:\n  ${fuera.join('\n  ')}\n` +
      'Si es histórico va en supabase/historico/. Si hace falta, va DENTRO de setup.sql.',
  );
});

test('no queda ninguna carpeta que parezca de migraciones', () => {
  // "migraciones" (español) no la lee la CLI, y "migrations" no la corre nadie
  // en este proyecto: las dos son una invitación a aplicar SQL que ya no manda.
  for (const nombre of ['migraciones', 'migrations']) {
    assert.ok(
      !fs.existsSync(path.join(RAIZ, 'supabase', nombre)),
      `supabase/${nombre}/ volvió a aparecer. El despliegue de este proyecto es setup.sql.`,
    );
  }
});

// ── Lo que el código llama tiene que existir en el esquema ──

function leerFuentes(dirs: string[]): { archivo: string; texto: string }[] {
  const out: { archivo: string; texto: string }[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push({ archivo: p, texto: fs.readFileSync(p, 'utf8') });
    }
  };
  dirs.forEach((d) => walk(path.join(RAIZ, d)));
  return out;
}

const fuentes = leerFuentes(['lib', 'supabase/functions']);

test('cada .rpc() que llama el código está creada en setup.sql', () => {
  // El fallo que esto atrapa es mudo: la función se despliega, llama a una RPC
  // que nadie creó, y el usuario ve "no se pudo verificar el límite" sin que
  // nada en el repo delate por qué.
  const faltan: string[] = [];
  for (const { archivo, texto } of fuentes) {
    for (const m of texto.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)) {
      const fn = m[1];
      if (!setup.includes(`function public.${fn}(`)) {
        faltan.push(`${fn} (llamada en ${path.relative(RAIZ, archivo)})`);
      }
    }
  }
  assert.deepEqual(faltan, [], `RPC que el código llama y setup.sql no crea:\n  ${faltan.join('\n  ')}`);
});

// ── El agujero concreto que motivó todo esto ──

test('increment_ai_usage NO recibe el user_id de quien llama', () => {
  // Con la firma (uuid, text, integer) concedida a 'authenticated', cualquier
  // cliente podía pedir p_limit => 999999, o inflarle el contador a otro.
  assert.ok(
    !/function public\.increment_ai_usage\s*\(\s*\n?\s*p_user_id/.test(setup),
    'la firma con p_user_id deja que el cliente elija a quién se le cobra',
  );
  assert.match(
    setup,
    /function public\.increment_ai_usage\(p_feature text, p_limit integer\)/,
    'la firma buena deriva el usuario de auth.uid()',
  );
});

test('increment_ai_usage rechaza un tope nulo', () => {
  // `current_count <= NULL` es NULL en Postgres, no false: sin este raise, un
  // tope que llegue nulo devuelve NULL y el control falla ABIERTO.
  const cuerpo = setup.match(/function public\.increment_ai_usage[\s\S]*?\$\$;/)?.[0] ?? '';
  assert.match(cuerpo, /p_limit is null/, 'un tope nulo tiene que cortar, no pasar');
});

test('las RPC de servicio no son ejecutables por el cliente', () => {
  // record_ai_cost y refund_ai_usage reciben el user_id explícito porque el
  // proxy actúa como servidor cuando las llama. Concedérselas a 'authenticated'
  // sería regalar IA (refund) o dejar sin ella a un tercero (record).
  for (const fn of ['record_ai_cost', 'refund_ai_usage']) {
    assert.ok(
      setup.includes(`revoke all on function public.${fn}`),
      `${fn} tiene que estar revocada explícitamente`,
    );
    const grants = setup
      .split('\n')
      .filter((l) => l.includes(`grant execute on function public.${fn}`));
    assert.ok(
      !grants.some((l) => /\bauthenticated\b/.test(l)),
      `${fn} NO puede concederse a authenticated:\n  ${grants.join('\n  ')}`,
    );
  }
});
