// __tests__/compuertaSalud.test.ts
// ─────────────────────────────────────────────────────────
// Que ninguna pantalla donde la persona se mueve se salte el tamizaje.
//
// app/workout-session.tsx siempre tuvo la compuerta. app/live-coach.tsx no
// tenía nada: ni cargaba el perfil de salud, ni había guard en la ruta. La
// misma persona a la que la app le impedía empezar una rutina —por dolor de
// pecho, mareos o restricción médica declarados— entraba al coach en vivo y
// hacía sentadillas contadas por voz, con la app animándola.
//
// El fallo no fue olvidarse: fue que la compuerta era un bloque copiado dentro
// de una pantalla, así que no existía para las demás. Este test convierte
// "acordarse" en algo que falla solo.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * Las rutas donde la persona EJECUTA ejercicio físico.
 *
 * El criterio para entrar aquí es ese y solo ese: si la pantalla hace que
 * alguien levante peso, se agache o se esfuerce, necesita saber si puede. Ver
 * un plan, mirar el historial o hablar con el coach por texto no cuentan.
 */
const RUTAS_DE_ENTRENO = [
  'app/workout-session.tsx',
  'app/live-coach.tsx',
  // El análisis de postura también: da correcciones de técnica y estiramientos
  // a partir de una foto. Cargaba la salud, sí — pero solo para METERLA EN EL
  // PROMPT. Eso es una instrucción al modelo, no una compuerta.
  'app/(tabs)/coach.tsx',
];

/** Las dos formas válidas de tener compuerta: el componente, o el bloque propio. */
function tieneCompuerta(codigo: string): boolean {
  const usaComponente = /<CompuertaDeSalud/.test(codigo);
  const bloquePropio =
    /evaluateWorkoutAccess/.test(codigo) && /loadHealthSafe/.test(codigo);
  return usaComponente || bloquePropio;
}

for (const ruta of RUTAS_DE_ENTRENO) {
  test(`${ruta} no deja entrenar sin tamizaje`, () => {
    assert.ok(
      tieneCompuerta(leer(ruta)),
      `${ruta} hace ejercicio físico y no comprueba la salud.\n` +
        'Envuélvela en <CompuertaDeSalud> (Components/CompuertaDeSalud.tsx).',
    );
  });
}

test('el coach en vivo usa el componente, no una copia', () => {
  // Se pide el componente en concreto —y no solo "alguna compuerta"— porque el
  // bloque copiado es exactamente lo que hizo que esta pantalla se quedara sin
  // él durante meses.
  const codigo = leer('app/live-coach.tsx');
  assert.match(codigo, /<CompuertaDeSalud/);
  assert.match(codigo, /from '\.\.\/Components\/CompuertaDeSalud'/);
});

test('la compuerta envuelve al componente, no vive dentro', () => {
  // Si el guard fuera un `if` dentro de LiveCoachContenido, los hooks de arriba
  // —cámara, modelo de pose, keep-awake— ya se habrían montado antes de saber
  // si esta persona debería estar entrenando.
  const codigo = leer('app/live-coach.tsx');
  const idxContenido = codigo.indexOf('function LiveCoachContenido');
  const idxCompuerta = codigo.indexOf('<CompuertaDeSalud');
  assert.ok(idxContenido > 0, 'el contenido debería estar en su propia función');
  assert.ok(
    idxCompuerta > idxContenido,
    'la compuerta tiene que envolver desde fuera, después de la función de contenido',
  );
});

// ── Lo que la compuerta tiene que garantizar ──

const compuerta = leer('Components/CompuertaDeSalud.tsx');

test('falla CERRADO: si no se puede leer el tamizaje, no se entrena', () => {
  // Es el punto entero. Dejar pasar cuando la red falla convierte cualquier
  // momento sin cobertura en una puerta abierta — y es justo cuando menos se
  // puede comprobar nada.
  assert.match(compuerta, /estado !== 'ok'/);
  // Un fallo de la consulta tiene que acabar en 'unknown', que es lo que corta.
  assert.match(compuerta, /catch\([\s\S]{0,60}setEstado\('unknown'\)/);
  assert.match(compuerta, /status === 'unknown'[\s\S]{0,80}setEstado\('unknown'\)/);
});

test('sin perfil tampoco se entrena', () => {
  // Sin perfil no hay edad, y sin edad evaluateWorkoutAccess no puede decidir.
  assert.match(compuerta, /salud && profile \? evaluateWorkoutAccess/);
  assert.match(compuerta, /\|\| !acceso/);
});

test("un tamizaje 'blocked' corta y manda a Mi salud", () => {
  assert.match(compuerta, /acceso\.status === 'blocked'/);
  assert.match(compuerta, /REVISAR MI SALUD/);
});

test('el bloqueo dice qué hacer ante una señal de alarma real', () => {
  // El texto no es adorno: alguien puede estar leyéndolo con dolor de pecho.
  assert.match(compuerta, /dolor de pecho/i);
  assert.match(compuerta, /atención urgente/i);
});

test('los motivos del bloqueo se muestran, no solo el título', () => {
  assert.match(compuerta, /acceso\.reasons/);
});

test('se puede reintentar sin salir de la pantalla', () => {
  // Un fallo de red no puede dejar a alguien encerrado fuera de su entrenamiento.
  assert.match(compuerta, /VOLVER A INTENTAR/);
});
