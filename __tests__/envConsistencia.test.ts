// __tests__/envConsistencia.test.ts
// Este guardia decide si el AAB que va a una tienda sale con las credenciales
// del repositorio o con las de un archivo que nadie ve. Si se equivoca hacia
// el lado permisivo no avisa de nada, y el fallo aparece en producción.
//
// La primera versión hacía exactamente eso: partía por '\n' sin quitar el '\r'
// de los CRLF, no reconocía ninguna clave, y anunciaba "0 claves que
// comparten" como si fuera un aprobado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, revisarEnv } from '../scripts/envConsistencia.mjs';

// ── El lector ──

test('lee archivos con finales de línea de Windows (CRLF)', () => {
  // El bug original. Los archivos de este repo son CRLF.
  assert.deepEqual(parseEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('lee archivos con finales de línea de Unix (LF)', () => {
  assert.deepEqual(parseEnv('A=1\nB=2\n'), { A: '1', B: '2' });
});

test('ignora comentarios y líneas en blanco', () => {
  assert.deepEqual(parseEnv('# un comentario\n\nA=1\n   \n# otro\nB=2'), { A: '1', B: '2' });
});

test('quita comillas y espacios alrededor del valor', () => {
  assert.deepEqual(parseEnv('A="uno"\nB= dos \nC=\'tres\''), { A: 'uno', B: 'dos', C: 'tres' });
});

test('un valor con signos igual dentro se conserva entero', () => {
  // Los JWT de Supabase acaban en '=' de relleno, y las URLs llevan query.
  const env = parseEnv('T=eyJhbGciOi.eyJyZWYi.abc==\nU=https://x.co/f?a=1&b=2');
  assert.equal(env.T, 'eyJhbGciOi.eyJyZWYi.abc==');
  assert.equal(env.U, 'https://x.co/f?a=1&b=2');
});

test('un valor vacío es una clave válida, no una línea ignorada', () => {
  assert.deepEqual(parseEnv('A=\nB=1'), { A: '', B: '1' });
});

// ── El veredicto ──

test('sin archivos .local, adelante', () => {
  const r = revisarEnv([]);
  assert.equal(r.ok, true);
  assert.match(r.mensaje, /versionado/);
});

test('un .env.local aborta el build AUNQUE sus valores coincidan con .env', () => {
  // Esta es la decisión que define el módulo. Comparar valores y dejar pasar
  // si coinciden protege del descuido, pero no del caso que hace daño: apuntar
  // .env.local a un Supabase de pruebas y mandar ese AAB a la tienda. Ahí los
  // valores SÍ difieren... y el .env que nadie miró también decía otra cosa.
  const r = revisarEnv([{ nombre: '.env.local', contenido: 'A=1\r\n' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.archivos, ['.env.local']);
});

test('también atrapa .env.production.local, que tiene aún más prioridad', () => {
  const r = revisarEnv([{ nombre: '.env.production.local', contenido: 'A=1' }]);
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /\.env\.production\.local/);
});

test('con varios archivos los nombra todos, no solo el primero', () => {
  // Mover uno y volver a lanzar para que falle por el siguiente es la forma
  // más rápida de que alguien se rinda y desactive la comprobación.
  const r = revisarEnv([
    { nombre: '.env.local', contenido: 'A=1' },
    { nombre: '.env.production.local', contenido: 'B=2' },
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.archivos, ['.env.local', '.env.production.local']);
});

test('el mensaje dice cuántas claves trae cada archivo', () => {
  const r = revisarEnv([{ nombre: '.env.local', contenido: 'A=1\nB=2\nC=3' }]);
  assert.match(r.mensaje, /3 claves/);
});

test('un archivo vacío o ilegible también aborta', () => {
  // No se puede concluir "no pasa nada" de un archivo que no se entiende, y
  // Expo lo va a cargar igual.
  assert.equal(revisarEnv([{ nombre: '.env.local', contenido: '' }]).ok, false);
  assert.equal(revisarEnv([{ nombre: '.env.local', contenido: '{"json":1}' }]).ok, false);
});
