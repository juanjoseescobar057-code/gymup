// scripts/check-syntax.mjs
// ─────────────────────────────────────────────────────────
// `tsc --noEmit` cubre el código de la app, y los tests cubren la lógica. Pero
// los scripts de scripts/ y los config plugins de plugins/ son JavaScript
// suelto que nadie importa desde un test: un error de sintaxis ahí no lo ve
// nadie hasta que alguien lanza un build.
//
// Pasó de verdad: una variable declarada dos veces en build-android.mjs. El
// script murió al arrancar, con los tests en verde.
//
// `node --check` solo analiza, no ejecuta — importante, porque estos archivos
// tienen efectos secundarios en el nivel superior (build-android.mjs compila).
// ─────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const CARPETAS = ['scripts', 'plugins'];
const EXTENSIONES = ['.mjs', '.js', '.cjs'];

// Las Edge Functions corren en Deno, así que ni tsc las mira (no están en el
// tsconfig) ni node --check puede parsear TypeScript. Quedaban fuera de todo,
// y el único momento en que se descubría un error de sintaxis era al
// desplegar — con el despliegue a medias.
//
// Pasó de verdad: una edición dejó `const FEATURE_POLICY` declarado DOS veces
// en ai-proxy. Todo en verde, y el error salió del servidor de Supabase.
const FUNCIONES = 'supabase/functions';

const archivos = CARPETAS.flatMap((carpeta) => {
  const dir = path.join(process.cwd(), carpeta);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => EXTENSIONES.includes(path.extname(n)))
    .map((n) => path.join(carpeta, n));
});

if (archivos.length === 0) {
  console.error('✖ No encontré ningún script que comprobar. ¿Se movieron scripts/ o plugins/?');
  process.exit(1);
}

let fallos = 0;
for (const archivo of archivos) {
  const r = spawnSync(process.execPath, ['--check', archivo], { encoding: 'utf8' });
  if (r.status !== 0) {
    fallos++;
    console.error(`✖ ${archivo}\n${(r.stderr || '').trim()}\n`);
  }
}

// ── Las Edge Functions (TypeScript de Deno) ──
// esbuild transforma un archivo suelto sin resolver imports, así que sirve
// como analizador sintáctico: los `import` de https:// y npm: de Deno no le
// molestan porque no intenta seguirlos.

const requerir = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = requerir('esbuild');
} catch {
  // Fallar, no avisar. Saltárselo en silencio devuelve exactamente el agujero
  // por el que se coló el error que motivó esto.
  console.error('✖ No pude cargar esbuild, así que no puedo revisar supabase/functions.');
  console.error('  Instálalo con: npm i -D esbuild');
  process.exit(1);
}

const dirFunciones = path.join(process.cwd(), FUNCIONES);
const funciones = fs.existsSync(dirFunciones)
  ? fs
      .readdirSync(dirFunciones, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(FUNCIONES, d.name, 'index.ts'))
      .filter((p) => fs.existsSync(path.join(process.cwd(), p)))
  : [];

for (const archivo of funciones) {
  try {
    esbuild.transformSync(fs.readFileSync(archivo, 'utf8'), { loader: 'ts' });
  } catch (e) {
    fallos++;
    const detalle = (e.errors ?? [])
      .map((x) => `  ${x.text}${x.location ? ` (línea ${x.location.line})` : ''}`)
      .join('\n');
    console.error(`✖ ${archivo}\n${detalle || String(e)}\n`);
  }
}

const total = archivos.length + funciones.length;
if (fallos) {
  console.error(`Sintaxis: ${fallos} de ${total} archivos con errores.`);
  process.exit(1);
}

console.log(`Sintaxis OK (${archivos.length} scripts y plugins, ${funciones.length} edge functions)`);
