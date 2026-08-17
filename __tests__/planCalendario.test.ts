// __tests__/planCalendario.test.ts
// El caso que motivó todo esto: alguien para diez días, vuelve, y la app le
// propone descansar. Si esta lógica se afloja, el plan vuelve a avanzar con la
// voluntad en vez de con el calendario y nadie se entera hasta que un usuario
// lo cuenta.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoDelDia,
  reincorporacionPor,
  diasEntre,
  DIAS_PARA_SALTAR_DESCANSO,
  type TipoDeDia,
} from '../lib/planCalendario';

// Plan típico: entrena lunes, martes, jueves, viernes, sábado. Descansa
// miércoles y domingo.
const PLAN: TipoDeDia[] = ['workout', 'workout', 'rest', 'workout', 'workout', 'workout', 'rest'];

const dia = (n: number) => `2026-08-${String(n).padStart(2, '0')}T10:00:00.000Z`;

// ── Aritmética de fechas ──

test('cuenta días por fecha, no por horas', () => {
  // Entrenar a las 23:00 y abrir a las 07:00 del día siguiente es UN día, no
  // cero: contar por horas haría que el plan avanzara a deshora.
  assert.equal(diasEntre('2026-08-01T23:00:00Z', '2026-08-02T07:00:00Z'), 1);
  assert.equal(diasEntre('2026-08-01T01:00:00Z', '2026-08-01T23:00:00Z'), 0);
});

test('una fecha corrupta no rompe el cálculo', () => {
  assert.equal(diasEntre('no-es-fecha', dia(5)), 0);
});

// ── El plan corre con el calendario ──

test('el mismo día del entreno se respeta el día ya guardado', () => {
  // current_plan_day ya apunta a mañana en cuanto se cierra la sesión.
  const r = estadoDelDia({ hoyISO: dia(10), ultimoEntrenoISO: dia(10), diaGuardado: 3, dias: PLAN });
  assert.equal(r.diaDelPlan, 3);
  assert.equal(r.diasSinEntrenar, 0);
});

test('al día siguiente avanza uno', () => {
  const r = estadoDelDia({ hoyISO: dia(11), ultimoEntrenoISO: dia(10), diaGuardado: 3, dias: PLAN });
  assert.equal(r.diaDelPlan, 3);
  assert.equal(r.diasSinEntrenar, 1);
});

test('tres días después, el plan avanzó dos desde el guardado', () => {
  // El día del propio entreno ya venía contado en current_plan_day, así que
  // tres días sin entrenar son dos avances de calendario.
  // Se parte del día 3 a propósito: (3+2)=5 es día de entreno, así que este
  // test mide el avance y no el salto de descanso, que tiene el suyo.
  const r = estadoDelDia({ hoyISO: dia(13), ultimoEntrenoISO: dia(10), diaGuardado: 3, dias: PLAN });
  assert.equal(r.diaDelPlan, 5);
  assert.equal(r.diasAvanzados, 2);
  assert.equal(r.diasSinEntrenar, 3);
});

test('el ciclo da la vuelta sin salirse del plan', () => {
  const r = estadoDelDia({ hoyISO: dia(20), ultimoEntrenoISO: dia(10), diaGuardado: 5, dias: PLAN });
  assert.ok(r.diaDelPlan >= 0 && r.diaDelPlan < PLAN.length);
});

// ── EL CASO QUE MOTIVÓ ESTO ──

test('volver tras diez días NUNCA cae en día de descanso', () => {
  // Se prueban todos los puntos de partida: ninguno puede acabar en descanso.
  for (let guardado = 0; guardado < PLAN.length; guardado++) {
    const r = estadoDelDia({ hoyISO: dia(21), ultimoEntrenoISO: dia(11), diaGuardado: guardado, dias: PLAN });
    assert.equal(r.esDescanso, false, `saliendo del día ${guardado} acabó en descanso`);
  }
});

test('cuando salta un descanso lo dice', () => {
  // La pantalla necesita saberlo para explicar por qué no toca lo que tocaba.
  // Diez días fuera desde el día 0 caen en (0+9)%7 = 2, que es descanso.
  const r = estadoDelDia({ hoyISO: dia(21), ultimoEntrenoISO: dia(11), diaGuardado: 0, dias: PLAN });
  assert.equal(r.saltoDescanso, true);
  assert.equal(r.esDescanso, false);
  assert.equal(r.diaDelPlan, 3); // el siguiente día de entreno tras el 2
});

test('una pausa corta SÍ respeta el descanso', () => {
  // Saltarse el descanso por faltar un día sería empujar a entrenar cansado.
  const r = estadoDelDia({ hoyISO: dia(12), ultimoEntrenoISO: dia(11), diaGuardado: 2, dias: PLAN });
  assert.equal(r.esDescanso, true);
  assert.equal(r.saltoDescanso, false);
});

test('el umbral de salto es el declarado, sin sorpresas', () => {
  const justoAntes = estadoDelDia({
    hoyISO: dia(10 + DIAS_PARA_SALTAR_DESCANSO - 1), ultimoEntrenoISO: dia(10), diaGuardado: 2, dias: PLAN,
  });
  const justoDespues = estadoDelDia({
    hoyISO: dia(10 + DIAS_PARA_SALTAR_DESCANSO), ultimoEntrenoISO: dia(10), diaGuardado: 0, dias: PLAN,
  });
  assert.equal(justoAntes.saltoDescanso, false);
  assert.equal(justoDespues.esDescanso, false);
});

// ── Casos degenerados: nada puede colgar la app ──

test('un plan entero de descanso no cuelga el bucle', () => {
  const todoDescanso: TipoDeDia[] = Array(7).fill('rest');
  const r = estadoDelDia({ hoyISO: dia(25), ultimoEntrenoISO: dia(10), diaGuardado: 0, dias: todoDescanso });
  assert.equal(r.esDescanso, true); // no había a dónde saltar, y lo admite
});

test('sin plan devuelve algo válido en vez de reventar', () => {
  const r = estadoDelDia({ hoyISO: dia(10), ultimoEntrenoISO: dia(5), diaGuardado: 3, dias: [] });
  assert.equal(r.diaDelPlan, 0);
});

test('un contador corrupto se normaliza al rango del plan', () => {
  for (const guardado of [99, -4]) {
    const r = estadoDelDia({ hoyISO: dia(10), ultimoEntrenoISO: dia(10), diaGuardado: guardado, dias: PLAN });
    assert.ok(r.diaDelPlan >= 0 && r.diaDelPlan < PLAN.length, `${guardado} salió del rango`);
  }
});

test('quien nunca entrenó se queda en el día 1, no en el 11', () => {
  // Mostrarle el día 11 a quien no ha hecho el primero no ayuda a nadie.
  const r = estadoDelDia({ hoyISO: dia(21), ultimoEntrenoISO: null, diaGuardado: 0, dias: PLAN });
  assert.equal(r.diaDelPlan, 0);
  assert.equal(r.diasSinEntrenar, null);
  assert.equal(r.reincorporacion, null);
});

// ── Reincorporación: volver no es seguir donde lo dejaste ──

test('menos de una semana no cambia las cargas', () => {
  assert.equal(reincorporacionPor(6), null);
});

test('a más tiempo fuera, menos carga', () => {
  const semana = reincorporacionPor(10)!;
  const dosSemanas = reincorporacionPor(20)!;
  const mes = reincorporacionPor(40)!;
  assert.ok(semana.factorCarga > dosSemanas.factorCarga);
  assert.ok(dosSemanas.factorCarga > mes.factorCarga);
  assert.ok(mes.factorCarga >= 0.5, 'bajar más de la mitad convierte la sesión en nada');
});

test('solo tras un mes se sugiere rehacer el plan', () => {
  assert.equal(reincorporacionPor(20)!.sugerirReplanificar, false);
  assert.equal(reincorporacionPor(40)!.sugerirReplanificar, true);
});

test('la nota dice qué hacer, no solo que llevas tiempo fuera', () => {
  for (const d of [10, 20, 40]) {
    const r = reincorporacionPor(d)!;
    assert.match(r.nota, /\d+%/, `${d} días: la nota no dice cuánto bajar`);
  }
});

test('el estado del día trae la reincorporación ya calculada', () => {
  const r = estadoDelDia({ hoyISO: dia(25), ultimoEntrenoISO: dia(10), diaGuardado: 0, dias: PLAN });
  assert.equal(r.reincorporacion?.diasFuera, 15);
  assert.equal(r.reincorporacion?.factorCarga, 0.8);
});
