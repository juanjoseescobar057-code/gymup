// __tests__/regresionesDelRefactor.test.ts
// ─────────────────────────────────────────────────────────
// Las cinco cosas que rompí arreglando otras, encontradas por una verificación
// adversarial de los 24 hallazgos ya cerrados.
//
// El patrón común de tres de las cinco: había código que decidía comparando el
// TEXTO de un mensaje, y yo cambié los textos. Nada falló ruidosamente; las
// comprobaciones simplemente dejaron de acertar.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── Nadie decide por el texto del error ──

test('ninguna pantalla enruta mirando las palabras del mensaje de error', () => {
  // coach-chat abría el paywall si el mensaje contenía "Premium"; body-scan
  // detectaba el rechazo con /429|402|límite|premium/i. Al reescribir los
  // avisos del proxy, las dos dejaron de acertar en silencio.
  const culpables: string[] = [];
  for (const p of [['app', 'coach-chat.tsx'], ['app', 'body-scan.tsx']]) {
    const codigo = leerCodigo(...p);
    if (/message \?\? ''\)\.includes\(/.test(codigo)) culpables.push(p.join('/') + ' (includes sobre el mensaje)');
    if (/\/429\|402\|/.test(codigo)) culpables.push(p.join('/') + ' (regex sobre el mensaje)');
  }
  assert.deepEqual(culpables, [], 'siguen decidiendo por el texto:\n  ' + culpables.join('\n  '));
});

test('el error de IA lleva el código del servidor', () => {
  const cliente = leerCodigo('lib', 'aiClient.ts');
  assert.match(cliente, /class ErrorDeIA extends Error/);
  assert.match(cliente, /readonly codigo: CodigoDeIA/);
  assert.ok(
    /throw new ErrorDeIA\(/.test(cliente),
    'se define la clase y se sigue lanzando un Error pelado',
  );
});

test('las dos pantallas usan los ayudantes, no su propia heurística', () => {
  assert.match(leerCodigo('app', 'coach-chat.tsx'), /requierePremium\(e\)/);
  assert.match(leerCodigo('app', 'body-scan.tsx'), /esRechazoDeCupo\(e\)/);
});

// ── La rama de la prueba es alcanzable ──

test('el mensaje de tope comprueba la prueba ANTES que Premium', () => {
  // esPrueba se define como `isPremium && is_trial`, así que con isPremium
  // delante la rama de la prueba no se alcanza nunca.
  const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
  const i = proxy.indexOf('const mensajeTope');
  assert.ok(i > 0, 'no encontré el mensaje de tope');
  const ternario = proxy.slice(i, i + 400);
  assert.ok(
    ternario.indexOf('esPrueba') < ternario.indexOf('isPremium\n') ||
      /const mensajeTope = esPrueba/.test(ternario),
    'isPremium se comprueba antes que esPrueba: la rama de la prueba es inalcanzable',
  );
});

test('esPrueba sigue implicando isPremium (si deja de hacerlo, el orden importa al revés)', () => {
  const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
  assert.match(
    proxy,
    /const esPrueba = isPremium && profile\?\.is_trial === true/,
    'cambió la definición de esPrueba: revisa el orden del ternario de mensajeTope',
  );
});

// ── No se ofrece lo que no existe ──

test('la galería solo se menciona si hay galería', () => {
  const camara = leerCodigo('lib', 'camara.ts');
  // Ningún mensaje base la promete...
  const mensajes = [...camara.matchAll(/mensaje:\s*([\s\S]*?),\n\s*ofrecerGaleria/g)].map((m) => m[1]);
  assert.ok(mensajes.length >= 2, `solo encontré ${mensajes.length} mensajes: la extracción falla`);
  for (const m of mensajes) {
    assert.ok(
      !/foto que ya tengas/.test(m),
      'un mensaje base promete la galería, y dos pantallas no la tienen: ' + m.slice(0, 60),
    );
  }
  // ...y la añade quien puede cumplirla.
  assert.match(camara, /const hayGaleria = r\.ofrecerGaleria && !!usarGaleria/);
  assert.match(camara, /También puedes elegir una foto que ya tengas/);
});
