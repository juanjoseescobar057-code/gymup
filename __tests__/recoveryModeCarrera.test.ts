// __tests__/recoveryModeCarrera.test.ts
// ─────────────────────────────────────────────────────────
// «Todavía no lo sé» no puede parecerse a «está sano».
//
// El modo recuperación ya bloqueaba rutas, cortaba acciones y filtraba lo que
// va al coach. Pero todo eso colgaba de una bandera que arrancaba en NEUTRO — y
// NEUTRO es exactamente lo que devuelve modoRecuperacion(null). O sea que el
// valor inicial del store era indistinguible de «comprobado, no tiene nada».
//
// Y el arranque de la app no espera a nadie: carga el perfil, navega, y la
// consulta de salud va por su cuenta. El onboarding es peor todavía: guarda que
// la persona acaba de declarar un trastorno de la conducta alimentaria y entra
// directo a las pestañas. La primera pantalla que veía era el anillo de
// calorías.
//
// Estos tests vigilan la máquina de estados que cierra esa ventana.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

/** Sin comentarios: los de este repo citan el código que se quitó. */
const leerCodigo = (...p: string[]) =>
  leer(...p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── El estado existe y arranca cerrado ──

test('el store arranca en cargando, no en conocido', () => {
  const store = leerCodigo('store', 'userStore.ts');
  assert.match(store, /saludEstado: 'cargando'/);
});

test('el estado tiene los tres valores, y desconocido es distinto de sano', () => {
  const store = leerCodigo('store', 'userStore.ts');
  assert.match(store, /'cargando' \| 'conocido' \| 'desconocido'/);
});

// ── Nadie lee la bandera cruda ──

const PANTALLAS: string[][] = [
  ['app', '(tabs)', 'index.tsx'],
  ['app', '(tabs)', 'camera.tsx'],
  ['app', '(tabs)', 'progress.tsx'],
  ['app', '(tabs)', 'profile.tsx'],
  ['Components', 'GuardiaRecuperacion.tsx'],
];

for (const ruta of PANTALLAS) {
  test(`${ruta.join('/')} usa el hook, no la bandera cruda`, () => {
    const codigo = leerCodigo(...ruta);
    assert.ok(
      !/useUserStore\(\(s: any\) => s\.recuperacion\)/.test(codigo),
      'lee la bandera cruda del store: usa useRecuperacion()',
    );
    if (/recuperacion\./.test(codigo)) {
      assert.match(codigo, /useRecuperacion\(\)/, 'debería resolver contra el estado de carga');
    }
  });
}

test('mientras no se sepa, el hook devuelve TODO oculto', () => {
  // Falla cerrado, igual que la compuerta clínica del entreno y por el mismo
  // motivo: esconder calorías medio segundo de más se corrige solo; enseñarlas
  // a quien no debe, no.
  const hook = leerCodigo('lib', 'useRecuperacion.ts');
  assert.match(hook, /estado === 'conocido' \? modo : MIENTRAS_NO_SE_SEPA/);
  assert.match(hook, /trastorno_alimentario/, 'el valor de "no se sabe" tiene que ocultar todo');
});

// ── El guardia distingue los tres casos ──

test('el guardia bloquea mientras carga y cuando no se pudo leer', () => {
  const guardia = leerCodigo('Components', 'GuardiaRecuperacion.tsx');
  assert.match(guardia, /const sabemos = saludEstado === 'conocido'/);
  assert.match(guardia, /if \(sabemos && !bloqueada\(recuperacion, area\)\) return/);
});

test('el guardia no confunde "en pausa" con "espera un momento"', () => {
  // Son dos pantallas distintas: una explica una decisión clínica, la otra dice
  // que la app está comprobando algo. Confundirlas se lee como un fallo.
  const guardia = leer('Components', 'GuardiaRecuperacion.tsx');
  assert.match(guardia, /Un momento/);
  assert.match(guardia, /Esto lo tenemos en pausa/);
});

// ── Las dos puntas de la carrera ──

test('guardar el tamizaje publica el modo en el acto', () => {
  const health = leerCodigo('lib', 'health.ts');
  const iUpsert = health.indexOf("from('health_profile').upsert");
  const iPublica = health.indexOf('publicarModoRecuperacion({ ...h, doctor_cleared: doctorCleared })');
  assert.ok(iUpsert > 0, 'no encontré el guardado del tamizaje');
  assert.ok(iPublica > iUpsert, 'saveHealthProfile tiene que publicar el modo tras guardar');
});

test('si no se pudo leer la salud, se marca desconocida', () => {
  // Antes el caso 'unknown' no tocaba el store, así que quedaba en NEUTRO — que
  // las pantallas leían como "comprobado y sano".
  const health = leerCodigo('lib', 'health.ts');
  const i = health.indexOf("return { status: 'unknown' }");
  assert.ok(i > 0);
  assert.match(health.slice(Math.max(0, i - 200), i), /marcarSaludDesconocida\(\)/);
});

test('cerrar sesión olvida la salud', () => {
  // En un teléfono compartido, el modo de una persona sobrevivía al cambio de
  // cuenta.
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  const salidas = [...perfil.matchAll(/supabase\.auth\.signOut\(\)/g)];
  assert.ok(salidas.length > 0, 'no encontré ningún signOut');
  for (const m of salidas) {
    assert.match(
      perfil.slice(Math.max(0, m.index! - 300), m.index!),
      /olvidarSalud\(\)/,
      'cada signOut tiene que olvidar la salud antes',
    );
  }
});

// ── La fuga que quedaba ──

test('el consejo del día de la cámara respeta el modo', () => {
  // Se escondía la tarjeta de PROGRESO DE HOY y se dejaba esta, que dice el
  // porcentaje exacto de proteína, las kcal consumidas y "estás cerca del
  // límite de calorías". El mismo dato con otro envoltorio, y en tono de meta.
  const camera = leerCodigo('app', '(tabs)', 'camera.tsx');
  const i = camera.indexOf('CONSEJO DEL DÍA');
  assert.ok(i > 0, 'no encontré el consejo del día');
  assert.match(camera.slice(Math.max(0, i - 400), i), /!recuperacion\.ocultarCalorias/);
});
