// __tests__/logMeal.test.ts
// Dos reglas del registro de comida que se pagan caro si se aflojan:
// el día de macros "perfecto" (vale +50 XP) y el aviso de proteína.

import test from 'node:test';
import assert from 'node:assert/strict';
import { completaMacrosDelDia, avisoProteina, validarComidaManual } from '../lib/mealMath';

const METAS = { daily_calories: 2000, daily_protein_g: 150, daily_carbs_g: 200, daily_fat_g: 60 };
const CERO = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function comida(c: Partial<Record<'calories' | 'protein_g' | 'carbs_g' | 'fat_g', number>>) {
  return {
    meal_name: 'x', food_description: 'x', fiber_g: 0,
    calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, ...c,
  };
}

test('cubrir las cuatro metas cuenta como día completo', () => {
  const previos = { calories: 1800, protein_g: 140, carbs_g: 190, fat_g: 55 };
  assert.equal(
    completaMacrosDelDia(previos, comida({ calories: 300, protein_g: 20, carbs_g: 20, fat_g: 10 }), METAS),
    true,
  );
});

test('quedarse corto en UNA meta no es un día completo', () => {
  // Calorías, carbos y grasa cubiertos; proteína a 149 de 150.
  const previos = { calories: 2000, protein_g: 149, carbs_g: 200, fat_g: 60 };
  assert.equal(completaMacrosDelDia(previos, comida({}), METAS), false);
});

test('un día sin comer nada no se cuela como perfecto', () => {
  assert.equal(completaMacrosDelDia(CERO, comida({}), METAS), false);
});

test('el aviso de proteína no aparece por debajo del 80%', () => {
  assert.equal(avisoProteina(100, 150), null); // 66%
  assert.equal(avisoProteina(0, 150), null);
});

test('entre 80% y 100% dice cuánto falta', () => {
  const a = avisoProteina(120, 150); // 80%
  assert.ok(a);
  assert.match(a!.body, /30g/);
});

test('al 100% o más confirma sin regañar ni felicitar la comida', () => {
  const a = avisoProteina(150, 150);
  assert.ok(a);
  assert.match(a!.title, /cubierta/i);
  const b = avisoProteina(300, 150); // pasarse no genera un mensaje distinto
  assert.equal(b!.title, a!.title);
});

test('una meta de proteína en cero no divide entre cero', () => {
  const a = avisoProteina(10, 0);
  assert.ok(a); // 10/1 → >=100%, pero sobre todo: no NaN ni Infinity
  assert.doesNotMatch(a!.body, /NaN|Infinity/);
});

// ── Entrada manual ──
// El registro manual no puede ser una puerta trasera más permisiva que el
// escaneo: lo que se guarda aquí alimenta los mismos totales y el mismo XP.

const BASE = { nombre: 'Arroz con pollo', calories: 500, protein_g: 40, carbs_g: 50, fat_g: 12 };

test('una comida bien puesta se guarda sin avisos', () => {
  const r = validarComidaManual(BASE);
  assert.equal(r.ok, true);
  assert.equal(r.aviso, null);
});

test('sin nombre no se guarda', () => {
  assert.equal(validarComidaManual({ ...BASE, nombre: '   ' }).ok, false);
});

test('cero calorías no se registra', () => {
  const r = validarComidaManual({ ...BASE, calories: 0 });
  assert.equal(r.ok, false);
  assert.match(r.errores.calories, /0 calor/i);
});

test('macros negativos se rechazan uno por uno', () => {
  for (const k of ['calories', 'protein_g', 'carbs_g', 'fat_g'] as const) {
    const r = validarComidaManual({ ...BASE, [k]: -1 });
    assert.equal(r.ok, false, `${k} negativo debería fallar`);
    assert.ok(r.errores[k], `${k} sin mensaje`);
  }
});

test('campos vacíos o basura (NaN) no pasan como cero', () => {
  const r = validarComidaManual({ ...BASE, protein_g: NaN });
  assert.equal(r.ok, false);
  assert.match(r.errores.protein_g, /número/i);
});

test('el desajuste calorías/macros avisa pero NO bloquea', () => {
  // 40p + 50c + 12g ≈ 468 kcal. Si el usuario escribe 900, algo no cuadra.
  const r = validarComidaManual({ ...BASE, calories: 900 });
  assert.equal(r.ok, true, 'debe poder guardarse igual');
  assert.ok(r.aviso);
  assert.match(r.aviso!, /468|kcal/);
});

test('un registro a ojo (macros en cero) no dispara el aviso de desajuste', () => {
  const r = validarComidaManual({ nombre: 'Almuerzo', calories: 600, protein_g: 0, carbs_g: 0, fat_g: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.aviso, null);
});
