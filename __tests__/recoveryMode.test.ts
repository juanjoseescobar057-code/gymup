// __tests__/recoveryMode.test.ts
// La app promete "programamos sin metas de peso ni de estética" en cuanto
// alguien declara un trastorno alimentario, y hasta ahora esa promesa vivía
// solo en el prompt de la IA: la interfaz seguía enseñando el anillo de
// calorías, la báscula, el análisis corporal y las fotos de transformación.
// Estos tests fijan que la promesa se cumpla en la pantalla, no solo en el
// texto que lee el modelo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { modoRecuperacion, AVISO_RECUPERACION } from '../lib/recoveryMode';
import { EMPTY_HEALTH } from '../lib/healthMath';

test('sin trastorno declarado la app no oculta nada', () => {
  const m = modoRecuperacion({ ...EMPTY_HEALTH });
  assert.equal(m.activo, false);
  assert.equal(m.ocultarCalorias, false);
  assert.equal(m.ocultarPeso, false);
  assert.equal(m.ocultarCuerpo, false);
});

test('con trastorno declarado se ocultan calorías, peso y cuerpo', () => {
  const m = modoRecuperacion({ ...EMPTY_HEALTH, conditions: ['trastorno_alimentario'] });
  assert.equal(m.activo, true);
  assert.equal(m.ocultarCalorias, true);
  assert.equal(m.ocultarPeso, true);
  assert.equal(m.ocultarCuerpo, true);
  assert.equal(m.sinRecompensasCorporales, true);
});

test('la autorización médica NO reabre las métricas corporales por sí sola', () => {
  // Que su equipo diga que puede entrenar no significa que le convenga volver
  // a ver el número de la báscula: son dos permisos distintos.
  const m = modoRecuperacion({
    ...EMPTY_HEALTH,
    conditions: ['trastorno_alimentario'],
    doctor_cleared: true,
  });
  assert.equal(m.activo, true, 'seguir entrenando no es lo mismo que volver a pesarse');
  assert.equal(m.ocultarPeso, true);
});

test('un tamizaje ilegible NO activa el modo', () => {
  // Esconderle sus datos a alguien por un fallo de red le haría pensar que
  // perdió su historial: sería tan malo como el problema que evita.
  assert.equal(modoRecuperacion(null).activo, false);
  assert.equal(modoRecuperacion(undefined).activo, false);
});

test('otras condiciones de riesgo alto no activan el modo', () => {
  // Es específico del trastorno alimentario: alguien con cardiopatía necesita
  // ver sus calorías igual que cualquiera.
  for (const c of ['cardiopatia', 'embarazo', 'epilepsia', 'cancer_tratamiento'] as const) {
    assert.equal(modoRecuperacion({ ...EMPTY_HEALTH, conditions: [c] }).activo, false, c);
  }
});

test('el aviso dice que los datos siguen ahí, no que se borraron', () => {
  // Un hueco vacío se lee como un fallo de la app, y "lo quitamos" se lee
  // como "lo perdiste".
  assert.match(AVISO_RECUPERACION, /siguen guardados|descargarlos/i);
  assert.doesNotMatch(AVISO_RECUPERACION, /borra|elimina/i);
});
