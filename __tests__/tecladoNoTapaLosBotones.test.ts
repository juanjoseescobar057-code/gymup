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

// SOLO MODALES. La primera versión de este test metía también coach-chat.tsx, y
// con eso «arreglé» una pantalla que no estaba rota: coach-chat es una ruta a
// pantalla completa del Stack, no un <Modal transparent>. En un modal el
// sistema recoloca el contenido solo y el ajuste sobra; en una pantalla
// completa hace falta, y sin él el campo de escribir queda debajo del teclado.
//
// La distinción es el CONTENEDOR, no la plataforma. Una regla que no la mire
// rompe la mitad de los sitios a los que se aplica.
const MODALES = [
  ['app', '(tabs)', 'profile.tsx'],
  ['app', '(tabs)', 'progress.tsx'],
  ['app', '(auth)', 'onboarding.tsx'],
  ['Components', 'AuthSheet.tsx'],
];

const PANTALLAS_COMPLETAS = [['app', 'coach-chat.tsx']];

test('ningún KeyboardAvoidingView usa behavior height en Android', () => {
  const culpables: string[] = [];
  for (const p of MODALES) {
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
  for (const p of MODALES) {
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

test('las pantallas completas SÍ ajustan en Android', () => {
  // El error simétrico, y el que cometí: aplicar la regla de los modales a una
  // pantalla completa deja el campo de escribir debajo del teclado. Este test
  // existe para que no vuelva a pasar en la dirección contraria.
  for (const p of PANTALLAS_COMPLETAS) {
    const codigo = fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
    const usos = codigo.match(/behavior=\{Platform\.OS === 'ios' \? '[a-z]+' : ([^}]+)\}/g) ?? [];
    assert.ok(usos.length > 0, `${p.join('/')} ya no tiene KeyboardAvoidingView`);
    for (const uso of usos) {
      assert.ok(
        !/: undefined\}/.test(uso),
        `${p.join('/')} dejó Android sin ajuste: el teclado tapa el campo de escribir`,
      );
    }
  }
});
