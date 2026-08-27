// __tests__/losTresQueQuedaban.test.ts
// ─────────────────────────────────────────────────────────
// Los tres últimos hallazgos de la verificación adversarial.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validarPlan } from '../lib/planValidator';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── El veto de intensidad no se esquiva por el RIR ──

function planCon(ej: Record<string, unknown>) {
  return {
    overview: 'x',
    days: [
      {
        day: 1, day_name: 'Lunes', type: 'workout', muscle_groups: ['pecho'],
        estimated_duration_min: 50,
        exercises: [{ sets: 3, reps: '8-10', rest_seconds: 90, muscle_group: 'pecho', ...ej }],
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        day: i + 2, day_name: 'D', type: 'rest', muscle_groups: [],
        estimated_duration_min: 0, exercises: [],
      })),
    ],
  };
}

test('un ejercicio sustituido no conserva el RIR al fallo', () => {
  // Se normalizaba intensity_method y se dejaba target_rir intacto, y el
  // `continue` de la línea siguiente se salta la normalización de más abajo.
  //
  // La primera versión de este test usaba 'Press de banca' con hipertensión, y
  // PASABA contra el código con el fallo: ese ejercicio no dispara el veto por
  // nombre, así que no había sustitución ninguna que mirar. Un test que no
  // ejerce el camino no comprueba nada aunque termine en verde.
  //
  // "Sentadilla con salto" sí: el nombre pide 'impacto', que el embarazo veta,
  // y su grupo ('piernas') tiene sustituto sin impacto.
  const { plan, correcciones } = validarPlan(
    planCon({
      name: 'Sentadilla con salto',
      muscle_group: 'piernas',
      target_rir: 0,
      intensity_method: 'drop_set',
    }) as any,
    { injuries: [], conditions: ['embarazo'], equipment: 'gym', age: 30, saludDesconocida: false }
  );

  // Que el camino se haya EJERCIDO. Sin esto, quitar la sustitución dejaría el
  // test en verde por no tener nada que comprobar.
  const sustitucion = correcciones.find((c) => c.accion === 'sustituido');
  assert.ok(sustitucion, 'no hubo sustitución: el test no está probando el camino que dice');

  const ejercicios = (plan as any).days.flatMap((d) => d.exercises ?? []);
  assert.equal(ejercicios.length, 1, 'el ejercicio desapareció en vez de sustituirse');
  const ej = ejercicios[0];
  assert.notEqual(ej.name, 'Sentadilla con salto', 'no se sustituyó el nombre');
  assert.ok(
    (ej.target_rir ?? 2) >= 2,
    `el sustituto quedó con target_rir ${ej.target_rir}: es intensidad alta por la otra puerta`
  );
  assert.equal(ej.intensity_method, 'none', `conservó ${ej.intensity_method}`);
});

test('sin veto, el RIR del plan se respeta', () => {
  // Normalizar siempre sería el error contrario: quitarle intensidad a quien
  // no tiene ninguna restricción declarada.
  const { plan, correcciones } = validarPlan(
    planCon({ name: 'Sentadilla con salto', muscle_group: 'piernas', target_rir: 0 }) as any,
    { injuries: [], conditions: [], equipment: 'gym', age: 30, saludDesconocida: false }
  );
  assert.equal(correcciones.length, 0, 'se corrigió algo sin restricciones declaradas');
  const ej = (plan as any).days[0].exercises[0];
  assert.equal(ej.target_rir, 0, 'se normalizó el RIR de alguien sin restricciones');
});

// ── El motivo del veto no sale del teléfono ──

test('la telemetría del plan no manda qué le veta el tamizaje', () => {
  // captureError va a Sentry Y a la analítica propia. "exige impacto alto, que
  // está vetado por lo que declaraste" no nombra la condición, pero deja muy
  // poco que adivinar: embarazo, cardiopatía, cirugía reciente.
  const openai = leerCodigo('lib', 'openai.ts');
  const i = openai.indexOf('generateTrainingPlan.postvalidacion');
  assert.ok(i > 0, 'no encontré la captura de la postvalidación');
  const bloque = openai.slice(Math.max(0, i - 400), i + 400);
  assert.ok(
    !/motivos:/.test(bloque),
    'sigue mandando los motivos del veto fuera del dispositivo',
  );
  // Y lo que sí hace falta para saber si el prompt de seguridad basta.
  assert.match(bloque, /correcciones: correcciones\.length/);
});

// ── Un tope de cero no es un límite alcanzado ──

test('con tope cero se dice que es Premium, no "llegaste al límite de 0"', () => {
  const subs = leerCodigo('lib', 'subscription.ts');
  assert.ok(
    !/Llegaste al límite de \$\{FREE_LIMITS/.test(subs),
    'el mensaje sigue interpolando un tope que puede ser 0',
  );
  assert.match(subs, /tope === 0/);
  assert.match(subs, /es una función Premium/);
});

test('con tope mayor que cero sí se dice el número', () => {
  // El arreglo no puede haber borrado el caso útil.
  const subs = leerCodigo('lib', 'subscription.ts');
  assert.match(subs, /Llegaste al límite de \$\{tope\}/);
});
