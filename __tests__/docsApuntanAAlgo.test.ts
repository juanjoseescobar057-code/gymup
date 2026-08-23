// __tests__/docsApuntanAAlgo.test.ts
// Las guias de despliegue son instrucciones que alguien va a seguir a las dos
// de la manana con la tienda esperando. Si mandan correr un archivo que no
// existe, el despliegue se para y no hay forma de saber si falta el archivo o
// falta un paso.
//
// Paso de verdad: DEPLOY.md mandaba aplicar
// `supabase/migrations/0007_world_class_safety_integrity.sql`, que se movio a
// historico/ y ya no esta donde dice. Nadie lo detecto porque una guia no
// compila.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const GUIAS = ['DEPLOY.md', 'PRICING.md', 'docs/DEPLOY_PRESUPUESTO.md', 'docs/RELEASE_GATES.md'];

/** Rutas del repo que una guia menciona en `backticks`. */
function rutasCitadas(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    // Solo lo que parece una ruta de este repo, con extension conocida.
    if (!/^(supabase|scripts|lib|app|docs|__tests__|Components|plugins)\//.test(t)) continue;
    if (!/\.(sql|ts|tsx|mjs|js|json|md)$/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

for (const guia of GUIAS) {
  test(`${guia} solo cita archivos que existen`, () => {
    if (!fs.existsSync(path.join(RAIZ, guia))) return; // guia opcional
    const faltan = rutasCitadas(fs.readFileSync(path.join(RAIZ, guia), 'utf8'))
      .filter((r) => !fs.existsSync(path.join(RAIZ, r)));
    assert.deepEqual(
      faltan,
      [],
      `${guia} manda usar archivos que no existen:\n  ${faltan.join('\n  ')}\n` +
        'Una guia de despliegue que apunta al vacio para el despliegue en seco.',
    );
  });
}

test('ninguna guia manda aplicar migraciones sueltas', () => {
  // El despliegue de este proyecto es pegar setup.sql. supabase/migrations se
  // retiro a proposito: 0006 instalaba una funcion que dejaba al cliente elegir
  // su propio tope de IA (ver supabase/historico/README.md).
  for (const guia of GUIAS) {
    const p = path.join(RAIZ, guia);
    if (!fs.existsSync(p)) continue;
    const texto = fs.readFileSync(p, 'utf8');
    assert.ok(
      !/supabase\/migrations\//.test(texto),
      `${guia} manda aplicar algo de supabase/migrations, que ya no existe`,
    );
  }
});

test('DEPLOY.md manda correr setup.sql', () => {
  assert.match(fs.readFileSync(path.join(RAIZ, 'DEPLOY.md'), 'utf8'), /supabase\/setup\.sql/);
});
