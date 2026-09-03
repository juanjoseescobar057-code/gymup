// __tests__/recuperarClaveLlegaAAlgunSitio.test.ts
// ─────────────────────────────────────────────────────────
// El enlace del correo de recuperación tiene que llevar a alguna parte.
//
// No llevaba. requestPasswordReset acepta un `redirectTo` y la app lo llamaba
// SIN él; no hay onAuthStateChange en ningún sitio, ni manejo del evento
// PASSWORD_RECOVERY, ni pantalla para escribir la contraseña nueva. Así que el
// correo salía —eso sí funcionaba— y el enlace moría. Alguien que pagara y
// olvidara su clave perdía la cuenta y no había vía de vuelta.
//
// Se resuelve con una página web y no con un deep link, a propósito:
//   • funciona con el build que la gente YA tiene instalado;
//   • funciona si abren el correo en otro dispositivo, sin la app instalada,
//     que es la mitad de los casos reales;
//   • no depende del scheme ni de App Links, que es donde esto se rompe.
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

const pagina = fs.readFileSync(
  path.join(process.cwd(), 'docs', 'legal', 'reset-password.html'),
  'utf8'
);

test('la app pide el reset con un destino, no a ciegas', () => {
  const hoja = leerCodigo('Components', 'AuthSheet.tsx');
  assert.match(
    hoja,
    /requestPasswordReset\(email, URL_CAMBIAR_CLAVE\)/,
    'sigue pidiendo el reset sin decir a dónde debe llevar el enlace',
  );
});

test('el destino es una URL del dominio propio', () => {
  const cuenta = leerCodigo('lib', 'account.ts');
  assert.match(cuenta, /URL_CAMBIAR_CLAVE = 'https:\/\/rityvo\.com\//);
});

test('la página existe y está en la carpeta que se publica', () => {
  // docs/legal/ es lo que se sube al dominio. Si la página vive en otro sitio,
  // el enlace del correo lleva a un 404.
  assert.ok(pagina.length > 1000, 'la página está vacía o truncada');
  assert.match(pagina, /<title>[^<]*contraseña/i);
});

test('la página no lleva ninguna credencial secreta', () => {
  // La anon key es pública por diseño —viaja en el APK— pero la service_role
  // NO puede salir nunca, y una clave de OpenAI menos.
  for (const prohibido of [/service_role/i, /\bsk-[A-Za-z0-9]/, /SUPABASE_SERVICE/i]) {
    assert.ok(!prohibido.test(pagina), `la página contiene algo que no debe: ${prohibido}`);
  }
});

test('la página no deja la sesión guardada en el navegador', () => {
  // El enlace da acceso a la cuenta. Si la sesión persistiera, quedaría abierta
  // en el navegador de un ordenador compartido.
  assert.match(pagina, /persistSession: false/);
  assert.match(pagina, /signOut\(\)/);
});

test('la página exige las mismas reglas que la app', () => {
  assert.match(pagina, /length < 8/, 'no exige 8 caracteres');
  assert.match(pagina, /p1 !== p2/, 'no comprueba que las dos coincidan');
});

test('un enlace caducado o ya usado se explica, no se queda en blanco', () => {
  // Es el caso más frecuente de todos: la gente pulsa el enlace dos veces.
  assert.match(pagina, /ya no sirve/i);
  assert.match(pagina, /error=/);
});

test('sin sesión válida no se enseña el formulario', () => {
  // Llegar a la página por su URL, sin el token del correo, no puede dejar
  // cambiar la contraseña de nadie.
  assert.match(pagina, /form\.hidden = false/);
  const i = pagina.indexOf('if (!haySesion)');
  assert.ok(i > 0, 'no comprueba si hay sesión');
});
