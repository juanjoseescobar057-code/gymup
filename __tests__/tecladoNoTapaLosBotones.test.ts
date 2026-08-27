// __tests__/tecladoNoTapaLosBotones.test.ts
// ─────────────────────────────────────────────────────────
// En Android no se usa KeyboardAvoidingView.
//
// El sistema ya redimensiona la ventana (adjustResize), y el modo 'height'
// aplica un segundo ajuste encima. El resultado es que el contenido se
// descoloca y el botón de la parte baja del modal —guardar— se va detrás del
// teclado. Con autoFocus el teclado se abre solo, así que el botón nunca llega
// a verse: tocas donde crees que está, no pasa nada, y no hay ningún error que
// lo explique.
//
// Se detectó probando el registro de peso: "intento ingresar otro peso, no hace
// ninguna acción". Y el repositorio YA lo había diagnosticado antes — hay un
// comentario en (auth)/onboarding.tsx explicándolo — pero el arreglo se quedó
// en ese archivo y los cinco modales siguieron con 'height'.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ARCHIVOS = [
  ['app', '(tabs)', 'profile.tsx'],
  ['app', '(tabs)', 'progress.tsx'],
  ['app', 'coach-chat.tsx'],
  ['app', '(auth)', 'onboarding.tsx'],
  ['Components', 'AuthSheet.tsx'],
];

test('ningún KeyboardAvoidingView usa behavior height en Android', () => {
  const culpables: string[] = [];
  for (const p of ARCHIVOS) {
    const codigo = fs
      .readFileSync(path.join(process.cwd(), ...p), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/:\s*'height'\s*\}/.test(codigo)) culpables.push(p.join('/'));
  }
  assert.deepEqual(
    culpables,
    [],
    'el teclado va a tapar el botón de guardar en:\n  ' + culpables.join('\n  '),
  );
});

test('en Android el comportamiento es undefined, no otro modo', () => {
  // 'padding' y 'position' en Android tienen el mismo problema que 'height':
  // se suman al adjustResize del sistema. Solo iOS necesita ayuda.
  for (const p of ARCHIVOS) {
    const codigo = fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
    const usos = codigo.match(/behavior=\{Platform\.OS === 'ios' \? '[a-z]+' : ([^}]+)\}/g) ?? [];
    for (const uso of usos) {
      assert.match(
        uso,
        /: undefined\}/,
        `${p.join('/')} le da un comportamiento a Android: ${uso}`,
      );
    }
  }
});
