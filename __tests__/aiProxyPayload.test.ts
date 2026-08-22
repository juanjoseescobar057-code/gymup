// __tests__/aiProxyPayload.test.ts
// ─────────────────────────────────────────────────────────
// Lo que se comprueba del cuerpo ANTES de gastar un token.
//
// Aquí no se protege el margen sino la disponibilidad: hasta ahora el proxy
// hacía `await req.json()` sin mirar el tamaño, así que cualquiera con una
// cuenta —anónima, gratis, la que fuera— podía mandar un cuerpo de cientos de
// megas y tumbar la función para todos. No hacía falta pasar ningún control:
// el cuerpo se bufferizaba entero antes del primero.
//
// Y las imágenes: la app manda siempre data:image/...;base64. Una URL remota
// la descargaría OpenAI con nuestra cuenta.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { leerCuerpoAcotado, inspectMessages } from '../supabase/functions/_shared/payload';

/** Una Request con el cuerpo dado, para no depender de la red. */
function pedir(cuerpo: string): Request {
  return new Request('https://x.test/ai-proxy', { method: 'POST', body: cuerpo });
}

const MAX_IMG = 2 * 1024 * 1024;
const dataUri = (bytes: number) => 'data:image/jpeg;base64,' + 'A'.repeat(bytes);
const imagen = (url: string) => ({ role: 'user', content: [{ type: 'image_url', image_url: { url } }] });

// ── El techo del cuerpo ──

test('un cuerpo normal pasa entero', async () => {
  const json = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(await leerCuerpoAcotado(pedir(json), 1_000_000), json);
});

test('un cuerpo por encima del techo se corta y devuelve null', async () => {
  assert.equal(await leerCuerpoAcotado(pedir('x'.repeat(5_000)), 1_000), null);
});

test('justo en el techo pasa; un byte más, no', async () => {
  assert.equal(await leerCuerpoAcotado(pedir('x'.repeat(100)), 100), 'x'.repeat(100));
  assert.equal(await leerCuerpoAcotado(pedir('x'.repeat(101)), 100), null);
});

test('el techo se mide en BYTES, no en caracteres', async () => {
  // Un emoji son 4 bytes y "1 carácter" según length. Medir caracteres dejaría
  // pasar hasta cuatro veces el techo.
  const cuerpo = '🏋'.repeat(50); // 200 bytes, 100 unidades de UTF-16
  assert.equal(await leerCuerpoAcotado(pedir(cuerpo), 150), null);
  assert.equal(await leerCuerpoAcotado(pedir(cuerpo), 250), cuerpo);
});

test('un cuerpo vacío no es un error', async () => {
  const req = new Request('https://x.test/ai-proxy', { method: 'POST' });
  assert.equal(await leerCuerpoAcotado(req, 1_000), '');
});

// ── Conteo de texto e imágenes ──

const msgs = (...m: unknown[]) => inspectMessages(m, MAX_IMG);

test('cuenta los caracteres de un content de texto plano', () => {
  const r = msgs({ role: 'user', content: 'hola' }, { role: 'user', content: 'mundo' });
  assert.equal(r.textChars, 9);
  assert.equal(r.images, 0);
});

test('cuenta el texto dentro de un content por partes', () => {
  const r = msgs({ role: 'user', content: [{ type: 'text', text: '12345' }] });
  assert.equal(r.textChars, 5);
});

test('el base64 de una imagen NO cuenta como texto', () => {
  // Si contara, un body_scan legítimo se rechazaría siempre por largo.
  const r = msgs(imagen(dataUri(300_000)));
  assert.equal(r.images, 1);
  assert.equal(r.textChars, 0);
  assert.equal(r.imagenInvalida, null);
});

test('un content que no es ni texto ni lista se ignora sin romper', () => {
  const r = msgs({ role: 'user', content: 42 }, { role: 'user' }, null, 'basura');
  assert.equal(r.images, 0);
  assert.equal(r.textChars, 0);
});

// ── Las imágenes tienen que ser nuestras ──

test('una URL remota se rechaza', () => {
  // La descargaría OpenAI con nuestra cuenta: el proxy no es un buscador.
  const r = msgs(imagen('https://ejemplo.com/foto.jpg'));
  assert.match(r.imagenInvalida ?? '', /data:image/);
});

test('los esquemas raros también se rechazan', () => {
  for (const url of ['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data/', 'data:text/html,<script>']) {
    assert.ok(msgs(imagen(url)).imagenInvalida, `debería rechazar ${url}`);
  }
});

test('una imagen sin url se rechaza', () => {
  assert.match(msgs({ role: 'user', content: [{ type: 'image_url' }] }).imagenInvalida ?? '', /sin URL/);
  assert.match(msgs({ role: 'user', content: [{ type: 'image_url', image_url: { url: 12 } }] }).imagenInvalida ?? '', /sin URL/);
});

test('una imagen por encima del techo por imagen se rechaza', () => {
  assert.match(msgs(imagen(dataUri(MAX_IMG + 1))).imagenInvalida ?? '', /demasiado grande/);
});

test('la foto real de la app pasa sin problema', () => {
  // lib/image.ts: JPEG de 1024 px al 70%. ~700 KB de base64 en el peor caso.
  const r = msgs(imagen(dataUri(700_000)), imagen(dataUri(700_000)));
  assert.equal(r.imagenInvalida, null);
  assert.equal(r.images, 2);
});

test('una imagen mala entre varias buenas se detecta igual', () => {
  const r = msgs(imagen(dataUri(1000)), imagen('https://ejemplo.com/x.jpg'), imagen(dataUri(1000)));
  assert.ok(r.imagenInvalida);
  assert.equal(r.images, 3, 'y se siguen contando todas, para la política de feature');
});
