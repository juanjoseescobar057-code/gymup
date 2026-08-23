// __tests__/planValidator.test.ts
// ─────────────────────────────────────────────────────────
// El plan que genera la IA se guarda en la base y guía semanas de
// entrenamiento. Hasta ahora se validaba la FORMA —siete días, los campos
// esperados— y nada más: el contenido dependía por completo de que el modelo
// obedeciera el prompt.
//
// Un prompt es una petición, no un control. Una sentadilla profunda para quien
// declaró la rodilla, un press militar con el hombro tocado, o barra para quien
// entrena en casa sin material pasaban intactos y guiaban semanas.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validarPlan, type PlanSemanal, type ContextoValidacion } from '../lib/planValidator';
import { DEMANDAS_POR_EJERCICIO, vetosDe } from '../lib/demandasEjercicio';

const ej = (name: string, extra: Record<string, unknown> = {}) => ({
  name, sets: 3, reps: '8-10', rest_seconds: 90, notes: '', muscle_group: 'Pierna', ...extra,
});

const plan = (...nombres: string[]): PlanSemanal => ({
  overview: 'plan',
  days: [
    {
      day: 1, day_name: 'Lunes', type: 'workout', muscle_groups: ['Pierna'],
      estimated_duration_min: 60, exercises: nombres.map((n) => ej(n)),
    },
  ],
});

const ctx = (p: Partial<ContextoValidacion> = {}): ContextoValidacion => ({
  injuries: [], conditions: [], equipment: 'gym', age: 30, ...p,
});

// ── Lesiones y condiciones ──

test('con la rodilla lesionada no se programa sentadilla', () => {
  const r = validarPlan(plan('Sentadilla con barra'), ctx({ injuries: ['rodilla'] }));
  assert.equal(r.correcciones.length, 1);
  assert.match(r.correcciones[0].motivo, /rodilla/);
  assert.ok(!r.plan.days[0].exercises.some((e) => /sentadilla con barra/i.test(e.name)));
});

test('con el hombro lesionado no se programa press militar', () => {
  const r = validarPlan(plan('Press militar con barra'), ctx({ injuries: ['hombro'] }));
  assert.equal(r.correcciones.length, 1);
});

test('con hernia discal no se programa peso muerto', () => {
  const r = validarPlan(plan('Peso muerto convencional'), ctx({ conditions: ['hernia_discal'] }));
  assert.equal(r.correcciones.length, 1);
  assert.match(r.correcciones[0].motivo, /columna/);
});

test('en embarazo no se programa nada boca arriba ni de impacto', () => {
  const r = validarPlan(plan('Press de banca', 'Saltos al cajón'), ctx({ conditions: ['embarazo'] }));
  assert.equal(r.correcciones.length, 2);
});

test('lo que NO choca se queda tal cual', () => {
  // Un validador que se lo lleva todo deja a la persona sin plan.
  const r = validarPlan(plan('Elevaciones laterales'), ctx({ injuries: ['rodilla'] }));
  assert.deepEqual(r.correcciones, []);
  assert.equal(r.plan.days[0].exercises.length, 1);
});

// ── El sustituto tampoco puede chocar ──

test('no se sustituye por algo que también está vetado', () => {
  // Cambiar una prensa por "sentadilla con peso corporal" en alguien con la
  // rodilla lesionada sería mover el problema de sitio, no resolverlo.
  const r = validarPlan(plan('Prensa de piernas'), ctx({ injuries: ['rodilla'] }));
  assert.equal(r.correcciones[0].accion, 'retirado');
  assert.equal(r.correcciones[0].sustituto, undefined);
});

// ── Equipo ──

test('sin material no se programa barra ni máquina', () => {
  const r = validarPlan(plan('Jalón al pecho en polea'), ctx({ equipment: 'casa_sin_equipo' }));
  assert.ok(r.correcciones.length >= 1);
});

test('en casa con material básico las mancuernas sí valen', () => {
  const r = validarPlan(plan('Elevaciones laterales con mancuerna'), ctx({ equipment: 'casa_basico' }));
  assert.deepEqual(r.correcciones, []);
});

// ── Técnicas de intensidad ──

const conTecnica = (grupo: string, nombre: string): PlanSemanal => ({
  overview: '',
  days: [{
    day: 1, day_name: 'L', type: 'workout', muscle_groups: [grupo],
    estimated_duration_min: 40,
    exercises: [ej(nombre, { muscle_group: grupo, intensity_method: 'drop_set' })],
  }],
});

test('a partir de los 65 no se programan técnicas de intensidad', () => {
  const r = validarPlan(conTecnica('Hombro', 'Elevaciones laterales'), ctx({ age: 70 }));
  assert.equal(r.correcciones[0].accion, 'ajustado');
  assert.equal(r.plan.days[0].exercises[0].intensity_method, 'none');
});

test('sin tamizaje legible tampoco hay técnicas de intensidad', () => {
  const r = validarPlan(conTecnica('Hombro', 'Elevaciones laterales'), ctx({ saludDesconocida: true }));
  assert.equal(r.plan.days[0].exercises[0].intensity_method, 'none');
});

// ── Fail-closed ──

test('sin tamizaje legible se aplica el criterio más estricto', () => {
  // El mismo fail-closed que la compuerta clínica. Aquí el resultado se guarda
  // en la base y guía semanas, así que el listón no puede ser más bajo.
  const vetos = vetosDe([], [], true);
  assert.ok(vetos.has('impacto'));
  assert.ok(vetos.has('intensidad_alta'));
});

// ── Un día vacío es descanso, no un día roto ──

test('un día que se queda sin ejercicios pasa a descanso', () => {
  // Mejor un día menos que uno vacío, que se lee como un fallo de la app.
  const r = validarPlan(plan('Prensa de piernas', 'Sentadilla búlgara'), ctx({ injuries: ['rodilla'] }));
  assert.equal(r.plan.days[0].type, 'rest');
  assert.equal(r.plan.days[0].exercises.length, 0);
  assert.match(r.plan.days[0].notes ?? '', /declaraste/);
});

test('los días de descanso no se tocan', () => {
  const p: PlanSemanal = {
    overview: '',
    days: [{
      day: 2, day_name: 'M', type: 'rest', muscle_groups: [],
      estimated_duration_min: 0, exercises: [],
    }],
  };
  const r = validarPlan(p, ctx({ injuries: ['rodilla'] }));
  assert.deepEqual(r.correcciones, []);
  assert.equal(r.plan.days[0].type, 'rest');
});

// ── El reconocimiento por nombre ──

test('el reconocimiento por nombre es conservador', () => {
  // Falso positivo = un ejercicio sustituido. Falso negativo = un movimiento que
  // la persona declaró que no puede hacer. Se prefiere el primero, siempre.
  assert.ok(DEMANDAS_POR_EJERCICIO('Sentadilla frontal').includes('rodilla_profunda'));
  assert.ok(DEMANDAS_POR_EJERCICIO('Zancadas caminando').includes('rodilla_profunda'));
  assert.ok(DEMANDAS_POR_EJERCICIO('Burpees').includes('impacto'));
  assert.ok(DEMANDAS_POR_EJERCICIO('Press militar').includes('hombro_sobre_cabeza'));
  assert.ok(DEMANDAS_POR_EJERCICIO('Peso muerto rumano').includes('flexion_lumbar'));
});

test('un ejercicio inocuo no exige nada', () => {
  assert.deepEqual(DEMANDAS_POR_EJERCICIO('Elevaciones laterales'), []);
});

test('un nombre vacío no rompe', () => {
  assert.deepEqual(DEMANDAS_POR_EJERCICIO(''), []);
  assert.deepEqual(DEMANDAS_POR_EJERCICIO(undefined as never), []);
});

// ── Y que esté conectado donde el plan se guarda ──

test('los dos caminos del plan pasan por el validador', () => {
  // Uno solo no sirve: un plan adaptado se guarda igual y guía igual, así que no
  // puede tener menos controles por venir de otro camino.
  const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8');
  assert.match(leer('openai.ts'), /postValidar\(bruto, profile, health\)/);
  assert.match(leer('adaptivePlan.ts'), /validarPlan\(bruto as any/);
});

test('las tablas de veto viven en un solo sitio', () => {
  // El calentamiento y el plan tienen que respetar los mismos vetos. Dos tablas
  // parecidas y ligeramente distintas es exactamente cómo aparecen los agujeros.
  const demandas = fs.readFileSync(path.join(process.cwd(), 'lib', 'demandasEjercicio.ts'), 'utf8');
  assert.match(demandas, /export const VETO_POR_LESION/);
  assert.match(demandas, /export const VETO_POR_CONDICION/);
});
