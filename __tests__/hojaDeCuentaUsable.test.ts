// __tests__/hojaDeCuentaUsable.test.ts
// ─────────────────────────────────────────────────────────
// La hoja de cuenta, probada en vivo y reescrita.
//
// Tres cosas que fallaban, todas encontradas usándola:
//
//   1. "¿Olvidaste tu contraseña?" usaba el correo escrito en el MISMO
//      formulario de entrar. Vacío -> una alerta te regañaba. Escrito -> el
//      enlace salía sin que quedara claro qué había pasado. Recuperar la
//      contraseña no es un botón al pie de otro formulario.
//
//   2. Todo se contaba con Alert del sistema. Un error de validación no puede
//      secuestrar la pantalla y obligar a cerrarlo para volver a ver el campo
//      que hay que corregir.
//
//   3. Sin forma de ver la contraseña que se escribe. Ocho caracteres a ciegas
//      en un teclado de móvil es el motivo más tonto de abandonar un registro.
//
// Y lo que NO puede cambiar: el aviso al recuperar es el mismo exista o no la
// cuenta. Decir "ese correo no está registrado" dejaría averiguar quién usa una
// app de salud probando direcciones.
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

const hoja = leerCodigo('Components', 'AuthSheet.tsx');

test('recuperar la contraseña tiene su propio paso', () => {
  assert.match(hoja, /'formulario' \| 'recuperar' \| 'enviado'/);
  assert.match(hoja, /setVista\('recuperar'\)/, 'nada lleva al paso de recuperar');
  assert.match(hoja, /setVista\('enviado'\)/, 'no hay confirmación de que se envió');
});

test('desde el paso de recuperar se puede volver', () => {
  // Un paso sin salida es una trampa: hay que cerrar la hoja entera y empezar.
  assert.match(hoja, /Volver a entrar/);
});

test('los errores se enseñan en la hoja, no en un cuadro del sistema', () => {
  assert.ok(
    !/Alert\.alert\(/.test(hoja),
    'sigue usando Alert del sistema para contar cosas de esta pantalla',
  );
  assert.match(hoja, /errorCaja/, 'no hay sitio donde enseñar el error');
  assert.match(hoja, /accessibilityLiveRegion="polite"/, 'un lector de pantalla no anunciaría el error');
});

test('el error se limpia al corregir el campo', () => {
  // Un error que se queda puesto mientras escribes la corrección es ruido.
  assert.match(hoja, /onChangeText=\{\(t\) => \{ setEmail\(t\); setError\(null\); \}\}/);
  assert.match(hoja, /onChangeText=\{\(t\) => \{ setPassword\(t\); setError\(null\); \}\}/);
});

test('se puede ver la contraseña que se escribe', () => {
  assert.match(hoja, /secureTextEntry=\{!verClave\}/);
  assert.match(hoja, /setVerClave/);
});

test('la validación no gasta un viaje de red', () => {
  // Ir al servidor para decir "al correo le falta la arroba" es tiempo de
  // espera por nada.
  const i = hoja.indexOf('async function submit');
  const cuerpo = hoja.slice(i, hoja.indexOf('setBusy(true)', i));
  assert.match(cuerpo, /isValidEmail\(email\)/);
  assert.match(cuerpo, /password\.length < 8/);
});

test('el aviso al recuperar no revela si la cuenta existe', () => {
  // Lo contrario dejaría averiguar quién usa una app de salud probando
  // direcciones.
  assert.match(hoja, /Si hay una cuenta con/);
  assert.ok(
    !/no (está|esta) registrad/i.test(hoja),
    'algún mensaje delata si el correo existe',
  );
});

test('la hoja se reinicia al cerrarse', () => {
  // Quien cerró en el paso de recuperar lo encontraba ahí al volver a abrir,
  // sin saber por qué.
  assert.match(hoja, /if \(!visible\) \{/);
  const i = hoja.indexOf('if (!visible) {');
  const cuerpo = hoja.slice(i, i + 260);
  assert.match(cuerpo, /setVista\('formulario'\)/);
  assert.match(cuerpo, /setError\(null\)/);
});

test('sigue avisando de que un correo sin confirmar no sirve para entrar', () => {
  // El arreglo de la sesión anterior no puede haberse perdido en el rediseño.
  assert.match(hoja, /vive solo en este teléfono/);
});

test('el botón principal tiene altura de dedo', () => {
  // 54 de alto y 44 en los enlaces: por debajo de 44 la gente falla el toque.
  assert.match(hoja, /minHeight: 54/);
  assert.match(hoja, /enlaceFila: \{ minHeight: 44/);
});
