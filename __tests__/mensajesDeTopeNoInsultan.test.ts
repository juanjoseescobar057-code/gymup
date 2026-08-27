// __tests__/mensajesDeTopeNoInsultan.test.ts
// ─────────────────────────────────────────────────────────
// A quien ya paga no se le ofrece pagar.
//
// Dos fallos encadenados, encontrados probando:
//
//   1. El proxy respondía 'Alcanzaste el límite de hoy. Pásate a Premium para
//      más.' a TODO el mundo, Premium incluido. Y varias funciones tienen el
//      mismo tope en los tres planes —`plan` es 1 al día siempre— así que la
//      "solución" ofrecida no cambiaba nada aunque se comprara.
//
//   2. El cliente ni siquiera llegaba a enseñar ese mensaje: descartaba el
//      cuerpo entero de la respuesta y ponía uno fijo suyo. O sea que el
//      trabajo del servidor distinguiendo prueba / gratis / Premium no se veía
//      nunca en pantalla.
//
// El cliente solo puede confiar en el cuerpo si trae un `code` NUESTRO: sin esa
// condición, el texto del proveedor —que cita el prompt, y el prompt lleva las
// directivas de salud de la persona— acabaría en la pantalla.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
const cliente = leerCodigo('lib', 'aiClient.ts');

test('el aviso de tope depende del plan de quien lo recibe', () => {
  assert.ok(
    /mensajeTope\s*=\s*isPremium/.test(proxy),
    'el mensaje de tope es el mismo para todos: a un Premium se le dice que se pase a Premium',
  );
});

test('a un Premium no se le ofrece Premium al toparse', () => {
  const i = proxy.indexOf('const mensajeTope');
  assert.ok(i >= 0, 'no encontré el mensaje de tope');
  // La rama de Premium es la primera del ternario, hasta el `: esPrueba`.
  const ramaPremium = proxy.slice(i, proxy.indexOf(': esPrueba', i));
  assert.ok(
    !/Premium/.test(ramaPremium.replace('isPremium', '')),
    'la rama de Premium sigue mencionando Premium como solución',
  );
});

test('el cliente enseña el mensaje del servidor, no uno fijo', () => {
  assert.ok(
    /delServidor \?\?/.test(cliente),
    'el cliente descarta el cuerpo y pone su propio texto: el servidor distingue planes para nada',
  );
});

test('solo se confía en el cuerpo si trae un código nuestro', () => {
  // Sin esto, el texto del proveedor llegaría a la pantalla del usuario.
  assert.ok(/NUESTROS\.includes\(cuerpo\?\.code\)/.test(cliente), 'falta la comprobación del código propio');
  assert.ok(/'limit_reached'/.test(cliente) && /'budget_reached'/.test(cliente), 'faltan códigos en la lista');
});

test('el respaldo del cliente ya no manda a Premium en un 429', () => {
  // El 429 es un tope alcanzado, y eso le pasa igual a quien paga.
  const i = cliente.indexOf('res.status === 429');
  const bloque = cliente.slice(i, i + 260);
  assert.ok(
    !/pásate a Premium/i.test(bloque),
    'el texto de respaldo del 429 sigue ofreciendo Premium a todo el mundo',
  );
});
