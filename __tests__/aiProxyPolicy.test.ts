// __tests__/aiProxyPolicy.test.ts
// El ai-proxy corre en Deno: tsc no lo mira y check:syntax solo lo parsea. Así
// que un campo que falte en un objeto no lo detecta NADA — y eso fue
// exactamente lo que pasó.
//
// strictestPolicy() combinaba dos políticas y devolvía tres de los cuatro
// campos. El trialLimit ausente llegaba a increment_ai_usage como p_limit
// null, y en Postgres `current_count <= NULL` es NULL, no false: la
// comprobación del proxy (`allowed === false`) lo dejaba pasar. El control de
// gasto fallaba ABIERTO.
//
// Estos tests leen el archivo como TEXTO. Es tosco, pero es lo único que puede
// vigilar un módulo de Deno desde el runner de Node, y atrapa justo la clase
// de fallo que se coló.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const proxy = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', 'ai-proxy', 'index.ts'),
  'utf8',
);

// El tipo y la combinación se mudaron a _shared/politica.ts, que sí se puede
// importar y probar de verdad (ver __tests__/politicaIA.test.ts). Lo que se
// sigue vigilando AQUÍ, con texto, es lo que quedó dentro del Deno.serve y
// ningún test puede ejecutar.
const politica = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', '_shared', 'politica.ts'),
  'utf8',
);

/** Los campos declarados en el tipo FeaturePolicy. */
function camposDeFeaturePolicy(): string[] {
  const bloque = politica.match(/type FeaturePolicy = \{([\s\S]*?)\};/);
  assert.ok(bloque, 'no encontré el tipo FeaturePolicy');
  return [...bloque![1].matchAll(/^\s*(\w+)\s*[?:]/gm)].map((m) => m[1]);
}

/** El cuerpo de strictestPolicy. */
function cuerpoStrictest(): string {
  const m = politica.match(/function strictestPolicy\([\s\S]*?\n\}/);
  assert.ok(m, 'no encontré strictestPolicy');
  return m![0];
}

test('strictestPolicy devuelve TODOS los campos de FeaturePolicy', () => {
  // Este es el test que faltaba. Con él, añadir un campo al tipo y olvidarlo
  // en la combinación falla aquí y no en producción.
  const cuerpo = cuerpoStrictest();
  for (const campo of camposDeFeaturePolicy()) {
    assert.ok(
      new RegExp(`\\b${campo}\\s*:`).test(cuerpo),
      `strictestPolicy no devuelve "${campo}": el objeto combinado saldría con undefined`,
    );
  }
});

test('FeaturePolicy tiene los cuatro campos esperados', () => {
  // Si alguien renombra o quita uno, que se entere aquí.
  assert.deepEqual(
    camposDeFeaturePolicy().sort(),
    ['freeLimit', 'premiumLimit', 'premiumOnly', 'trialLimit'],
  );
});

test('los topes combinados toman el MÍNIMO, nunca el máximo', () => {
  // Combinar dos políticas tiene que endurecer. Si tomara el máximo, declarar
  // una feature barata junto a una cara relajaría el control de la cara.
  const cuerpo = cuerpoStrictest();
  for (const campo of ['freeLimit', 'trialLimit', 'premiumLimit']) {
    assert.match(
      cuerpo,
      new RegExp(`${campo}:\\s*Math\\.min\\(`),
      `${campo} debería combinarse con Math.min`,
    );
  }
  // premiumOnly endurece con OR: si cualquiera de las dos es premium, lo es.
  assert.match(cuerpo, /premiumOnly:\s*a\.premiumOnly\s*\|\|\s*b\.premiumOnly/);
});

test('un tope no numérico corta la petición antes de tocar la base', () => {
  assert.match(proxy, /Number\.isFinite\(limit\)/);
});

/**
 * El archivo sin comentarios. Hace falta porque los comentarios de este
 * proyecto CITAN el código defectuoso para explicar por qué se cambió, y un
 * test que busque texto a secas los confunde con código vivo. Pasó al escribir
 * este mismo archivo.
 */
const codigo = proxy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('la autorización se comprueba contra true, no contra false', () => {
  // La RPC devuelve NULL si el tope llega nulo, y NULL no es false. Comparar
  // contra false dejaba pasar ese caso.
  assert.match(codigo, /allowed !== true/);
  assert.ok(
    !/allowed === false/.test(codigo),
    'comparar contra false deja pasar el NULL que devuelve la RPC',
  );
});
