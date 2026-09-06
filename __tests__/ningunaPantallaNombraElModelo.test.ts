// __tests__/ningunaPantallaNombraElModelo.test.ts
// ─────────────────────────────────────────────────────────
// Ninguna pantalla le dice al cliente qué modelo de IA está corriendo.
//
// Cinco pantallas de carga decían "GPT-4o está diseñando tu plan", "GPT-4o
// calculando macros", etc. Decisión de producto: eso no aporta nada a quien usa
// la app —no sabe qué es GPT-4o ni le importa—, ata la marca a un proveedor que
// puede cambiar mañana, y en Colombia no hay obligación legal de mostrarlo. Lo
// que la persona quiere saber es QUÉ está pasando ("estamos diseñando tu plan"),
// no CON QUÉ.
//
// Las menciones a OpenAI en la política de privacidad y en el consentimiento del
// análisis corporal SE QUEDAN a propósito: ahí sí hay que decir quién procesa
// los datos. Este test solo mira pantallas, no documentos legales.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PANTALLAS_DIRS = ['app', 'Components'];

function archivosTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivosTsx(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Solo el JSX que se pinta: se quitan comentarios y las props `model:` de las llamadas a la IA. */
const soloLoVisible = (codigo: string) =>
  codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/model:\s*'[^']*'/g, '');

test('ninguna pantalla nombra el modelo de IA', () => {
  const culpables: string[] = [];
  for (const dir of PANTALLAS_DIRS) {
    for (const f of archivosTsx(path.join(process.cwd(), dir))) {
      // legal.tsx es la política de privacidad dentro de la app: ahí SÍ se nombra
      // al proveedor, y debe seguir así.
      if (f.endsWith('legal.tsx')) continue;
      const visible = soloLoVisible(fs.readFileSync(f, 'utf8'));
      const m = visible.match(/GPT-?4o?|gpt-4o|ChatGPT/i);
      if (m) culpables.push(`${path.relative(process.cwd(), f)}: "${m[0]}"`);
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'estas pantallas le dicen al cliente qué modelo corre:\n  ' + culpables.join('\n  '),
  );
});

test('las pantallas de carga dicen QUÉ pasa, no CON QUÉ', () => {
  // Las cinco que se corrigieron, con su texto nuevo.
  const esperado: [string, RegExp][] = [
    ['app/(auth)/onboarding.tsx', /Tu coach está diseñando/],
    ['app/(tabs)/coach.tsx', /Tu coach está revisando/],
    ['app/body-scan.tsx', /Analizando \{photos\.length\} foto/],
    ['app/food-scan.tsx', /Calculando tus macros/],
    ['app/fridge-scan.tsx', /Identificando ingredientes/],
  ];
  for (const [f, re] of esperado) {
    const s = fs.readFileSync(path.join(process.cwd(), ...f.split('/')), 'utf8');
    assert.match(s, re, `${f} perdió su mensaje de carga`);
  }
});

test('la política de privacidad SÍ sigue nombrando al proveedor', () => {
  // Quitar el nombre de las pantallas de carga no puede haberse llevado la
  // transparencia de donde sí es obligatoria.
  const legal = fs.readFileSync(path.join(process.cwd(), 'app', 'legal.tsx'), 'utf8');
  assert.match(legal, /OpenAI/, 'la política de privacidad dejó de decir quién procesa las fotos');
});
