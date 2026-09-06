// __tests__/loteUx.test.ts
// ─────────────────────────────────────────────────────────
// Quinto lote de la auditoría profunda: los callejones sin salida.
// Todo aquí falla contra el commit anterior.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sinComentarios = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const leerCodigo = (...p: string[]) =>
  sinComentarios(fs.readFileSync(path.join(process.cwd(), ...p), 'utf8'));

test('el arranque tiene tope: a los 15 s enseña el botón de reintentar', () => {
  const src = leerCodigo('app', 'index.tsx');
  assert.match(src, /const ARRANQUE_MAX_MS = 15_000;/);
  const i = src.indexOf('async function checkProfile');
  const cuerpo = src.slice(i, i + 900);
  // Lo que este test protege es que EXISTA el temporizador y que su única
  // acción sea encender el error. Las condiciones que lo acotan —vigente(),
  // terminadoRef, navegadoRef— las fija compuertaBuild25.test.ts una por una;
  // aquí se comprueban por presencia para que añadir otra no rompa el test.
  const iVigilante = cuerpo.indexOf('const vigilante = setTimeout(');
  assert.ok(iVigilante > 0, 'no hay temporizador de arranque');
  const cuerpoVigilante = cuerpo.slice(iVigilante, cuerpo.indexOf('ARRANQUE_MAX_MS)', iVigilante));
  assert.match(cuerpoVigilante, /setConnectionError\(true\)/);
  assert.match(cuerpoVigilante, /vigente\(\)/);
  assert.match(cuerpoVigilante, /!terminadoRef\.current/);
  // Y el vigilante se apaga siempre, salga como salga.
  assert.match(src, /\} finally \{[\s\S]{0,120}clearTimeout\(vigilante\);/);
});

test('el onboarding tiene vuelta atrás, visible y con el botón físico', () => {
  const src = leerCodigo('app', '(auth)', 'onboarding.tsx');
  assert.match(src, /function prevStep\(\)/);
  assert.match(src, /if \(step <= 1 \|\| step >= 4\) return;/, 'del 1 no hay a dónde; del 4 se está generando');
  assert.equal((src.match(/onPress=\{prevStep\}/g) ?? []).length, 2, 'un "Atrás" en el paso 2 y otro en el 3');
  assert.match(src, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(src, /if \(step === 4\) return true;/, 'el botón físico no puede abortar la generación');
  assert.match(src, /return \(\) => sub\.remove\(\);/);
});

test('los vasos de agua se pueden tocar con un dedo normal', () => {
  const src = leerCodigo('app', '(tabs)', 'index.tsx');
  const i = src.indexOf('onPress={() => tapCup(i)}');
  assert.ok(i > 0);
  // Solo vertical: el hitSlop simétrico invadía al vaso vecino, que se dibuja
  // encima (ver compuertaBuild25.test.ts). Lo que este test protege es que
  // SIGA habiendo área táctil ampliada, no cuál.
  assert.match(src.slice(i, i + 260), /hitSlop=\{\{ top: 10, bottom: 10/);
});

test('el permiso de cámara negado para siempre lleva a los ajustes', () => {
  const src = leerCodigo('Components', 'PoseCamera.tsx');
  assert.match(src, /Linking\.openSettings\(\)/);
  // A la SEGUNDA negativa, no a la primera: Android vuelve a preguntar tras un
  // "no" simple (ver compuertaBuild25.test.ts).
  assert.match(src, /const ok = await requestPermission\(\);\s*if \(!ok && intentos\.current >= 2\) setDenegado\(true\);/);
  assert.match(src, /Abrir ajustes del teléfono/);
  assert.ok(!/onPress=\{\(\) => requestPermission\(\)\}/.test(src), 'el botón sigue pidiendo un permiso que Android ya no va a mostrar');
});

test('textDisabled solo colorea placeholders, nunca texto que haya que leer', () => {
  // Da 3.5:1 sobre el fondo y contrast.test.ts lo declara intencional para
  // estados inactivos. La versión de la app y el pie del historial corporal
  // se leen, así que no pueden ir con él.
  const raices = ['app', 'Components'];
  const usos: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(p);
      else if (/\.tsx$/.test(f.name)) {
        const src = sinComentarios(fs.readFileSync(p, 'utf8'));
        for (const m of src.matchAll(/color:\s*Colors\.textDisabled/g)) usos.push(`${p}@${m.index}`);
      }
    }
  };
  for (const r of raices) recorrer(path.join(process.cwd(), r));
  assert.deepEqual(usos, [], `textDisabled como color de texto en: ${usos.join(', ')}`);
});

test('las pantallas con campos al final siguen al teclado en iOS', () => {
  for (const ruta of [['app', 'workout-session.tsx'], ['app', 'health.tsx']]) {
    const src = leerCodigo(...ruta);
    assert.match(src, /automaticallyAdjustKeyboardInsets/, `${ruta.join('/')} deja que el teclado tape el campo`);
  }
});
