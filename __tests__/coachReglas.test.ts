// __tests__/coachReglas.test.ts
// Este coach es lo único que le habla a quien no paga. Si se calla, el plan
// gratis se queda en una libreta de anotar series; si miente, es peor que
// callarse. Y si culpabiliza, la persona desinstala en vez de entrenar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { consejosDelDia, MAX_CONSEJOS, type ContextoCoach } from '../lib/coachReglas';

const BASE: ContextoCoach = {
  progresos: [],
  intervencion: null,
  rachaActual: 0,
  mejorRacha: 0,
  diasSinEntrenar: 0,
  grupoDeHoy: ['Pecho'],
  lesiones: [],
  condiciones: [],
  proteinaHoyG: null,
  proteinaMetaG: null,
  prsRecientes: [],
};

const ctx = (p: Partial<ContextoCoach>): ContextoCoach => ({ ...BASE, ...p });
const textos = (c: ContextoCoach) => consejosDelDia(c).map((x) => x.texto).join(' | ');

// ── Nunca se queda mudo ──

test('sin datos de nada, igual dice algo útil', () => {
  const r = consejosDelDia(BASE);
  assert.ok(r.length > 0);
  assert.match(r[0].texto, /[Rr]egistra/);
});

test('un día de descanso no deja la pantalla en blanco', () => {
  const r = consejosDelDia(ctx({ grupoDeHoy: [] }));
  assert.ok(r.length > 0);
  assert.match(textos(ctx({ grupoDeHoy: [] })), /descans/i);
});

test('nunca devuelve más de tres', () => {
  // Con todas las señales encendidas a la vez.
  const r = consejosDelDia(ctx({
    condiciones: ['hernia_discal'],
    lesiones: ['rodilla'],
    intervencion: { kind: 'deload', title: 'Toca bajar', detail: 'Reduce al 90%.' },
    progresos: [
      { exercise: 'Sentadilla', status: 'stable', exposures: 6, observationDays: 20, e1rmChangePct: 0, confidence: 'high' },
      { exercise: 'Press banca', status: 'progressing', exposures: 8, observationDays: 21, e1rmChangePct: 5, confidence: 'high' },
    ],
    rachaActual: 10,
    mejorRacha: 12,
    diasSinEntrenar: 9,
    proteinaHoyG: 20,
    proteinaMetaG: 140,
    prsRecientes: [{ ejercicio: 'Peso muerto', pesoKg: 120 }],
  }));
  assert.equal(r.length, MAX_CONSEJOS);
});

// ── La salud manda ──

test('una condición médica va SIEMPRE de primera', () => {
  const r = consejosDelDia(ctx({
    condiciones: ['hernia_discal'],
    prsRecientes: [{ ejercicio: 'Peso muerto', pesoKg: 120 }],
    rachaActual: 15,
    mejorRacha: 15,
  }));
  assert.equal(r[0].origen, 'salud');
  assert.match(r[0].texto, /hernia/);
});

test('si no se pudo leer el tamizaje, se dice y se va a lo conservador', () => {
  // Callarlo sería dar consejo sin saber qué tiene la persona.
  const r = consejosDelDia(ctx({ saludDesconocida: true }));
  assert.equal(r[0].origen, 'salud');
  assert.match(r[0].texto, /conservador/i);
});

test('la condición se nombra en cristiano, no con la clave interna', () => {
  assert.ok(!textos(ctx({ condiciones: ['hernia_discal'] })).includes('hernia_discal'));
  assert.ok(!textos(ctx({ lesiones: ['espalda_baja'] })).includes('espalda_baja'));
});

// ── Progresión: específica y sobre sus números ──

test('nombra el ejercicio estancado y cuántas sesiones lleva', () => {
  const t = textos(ctx({
    progresos: [{ exercise: 'Sentadilla', status: 'stable', exposures: 5, observationDays: 18, e1rmChangePct: 0, confidence: 'high' }],
  }));
  assert.match(t, /Sentadilla/);
  assert.match(t, /5 sesiones/);
});

test('no avisa de meseta con datos flojos', () => {
  // Un aviso a partir de dos series sueltas enseña a ignorar los avisos.
  const t = textos(ctx({
    progresos: [{ exercise: 'Sentadilla', status: 'stable', exposures: 2, observationDays: 4, e1rmChangePct: 0, confidence: 'low' }],
  }));
  assert.ok(!t.includes('Sentadilla'));
});

test('la decisión del motor de progresión pesa más que un récord', () => {
  const r = consejosDelDia(ctx({
    intervencion: { kind: 'deload', title: 'Semana de descarga', detail: 'Baja al 90%.' },
    prsRecientes: [{ ejercicio: 'Peso muerto', pesoKg: 120 }],
  }));
  assert.equal(r[0].clave, 'intervencion_deload');
});

test('collect_data no se muestra: no es un consejo, es la falta de uno', () => {
  const t = textos(ctx({ intervencion: { kind: 'collect_data', title: 'Faltan datos', detail: 'Registra más series.' } }));
  assert.ok(!t.includes('Faltan datos'));
});

// ── Sin culpa ──

test('volver tras una pausa no lleva reproche', () => {
  const t = textos(ctx({ diasSinEntrenar: 12 }));
  assert.match(t, /Volviste/);
  // Nada de "abandonaste", "perdiste", "otra vez", "deberías".
  assert.ok(!/abandon|perdis|deberías|otra vez|por fin/i.test(t));
});

test('una racha rota no se menciona como fracaso', () => {
  const t = textos(ctx({ rachaActual: 0, mejorRacha: 30, diasSinEntrenar: 8 }));
  assert.ok(!/perdiste|rompiste|arruinaste/i.test(t));
});

// ── Nutrición: solo con datos reales ──

test('sin meta de proteína no se inventa el aviso', () => {
  const t = textos(ctx({ proteinaHoyG: 10, proteinaMetaG: null }));
  assert.ok(!/proteína/i.test(t));
});

test('cerca de la meta no molesta; lejos sí avisa con el número exacto', () => {
  assert.ok(!/proteína/i.test(textos(ctx({ proteinaHoyG: 130, proteinaMetaG: 140 }))));
  assert.match(textos(ctx({ proteinaHoyG: 40, proteinaMetaG: 140 })), /100 g de proteína/);
});

// ── Racha ──

test('una racha corta no se celebra', () => {
  assert.ok(!/seguidos/.test(textos(ctx({ rachaActual: 2, mejorRacha: 9 }))));
});

test('igualar la mejor racha se reconoce como tal', () => {
  assert.match(textos(ctx({ rachaActual: 12, mejorRacha: 12 })), /mejor racha/);
});

// ── Identidad estable ──

test('cada consejo trae una clave que no cambia entre llamadas', () => {
  // Se usa para no repetir el mismo mensaje dos veces el mismo día.
  const c = ctx({ condiciones: ['hernia_discal'], rachaActual: 5, mejorRacha: 9 });
  assert.deepEqual(
    consejosDelDia(c).map((x) => x.clave),
    consejosDelDia(c).map((x) => x.clave),
  );
});
