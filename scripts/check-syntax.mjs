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
import fs from 'node:fs';
import path from 'node:path';

const CARPETAS = ['scripts', 'plugins'];
const EXTENSIONES = ['.mjs', '.js', '.cjs'];

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

if (fallos) {
  console.error(`Sintaxis: ${fallos} de ${archivos.length} archivos con errores.`);
  process.exit(1);
}

console.log(`Sintaxis OK (${archivos.length} scripts y plugins)`);
