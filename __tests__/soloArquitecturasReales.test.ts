// __tests__/soloArquitecturasReales.test.ts
// ─────────────────────────────────────────────────────────
// El C++ de React Native se compila una vez por arquitectura, y esa es la
// parte más lenta del build: en una compilación medida de 1h 28m, la mitad del
// tiempo se fue ahí — y la mitad de esa mitad en x86 y x86_64, que ningún
// teléfono Android usa.
//
// El plugin sustituye la propiedad en vez de añadir otra: dos entradas con la
// misma clave dejan ganar a la última, y eso depende del orden en que se
// apliquen los plugins.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

test('el plugin está registrado en app.json', () => {
  const app = JSON.parse(leer('app.json'));
  assert.ok(
    app.expo.plugins.includes('./plugins/withArquitecturas'),
    'el plugin existe pero no lo aplica nadie: prebuild lo ignora y el build vuelve a las cuatro',
  );
});

test('solo se compilan las dos ABIs de teléfonos reales', () => {
  const plugin = leer('plugins', 'withArquitecturas.js');
  assert.match(plugin, /armeabi-v7a,arm64-v8a/);
  assert.ok(
    !/x86/.test(plugin.replace(/\/\/.*$/gm, '')),
    'x86 sigue en la lista: se compilan arquitecturas de emulador',
  );
});

test('la propiedad se sustituye, no se duplica', () => {
  const plugin = leer('plugins', 'withArquitecturas.js');
  assert.match(
    plugin,
    /filter\(/,
    'sin quitar la que genera la plantilla, cuál gana depende del orden de los plugins',
  );
});

test('sigue habiendo un plugin de firma y otro de memoria', () => {
  // Añadir uno no puede haber desplazado a los que ya estaban: sin el de
  // firma, Play rechaza el AAB por certificado de depuración.
  const app = JSON.parse(leer('app.json'));
  for (const p of ['./plugins/withFirmaRelease', './plugins/withGradleMemoria']) {
    assert.ok(app.expo.plugins.includes(p), `desapareció ${p} de app.json`);
  }
});
