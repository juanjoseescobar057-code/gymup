// __tests__/losMacrosMiranLaSalud.test.ts
// ─────────────────────────────────────────────────────────
// Las calorías no se calculan a espaldas del tamizaje.
//
// Auditoría externa P0.5, confirmado: calculateDailyMacros recibía peso,
// altura, edad, sexo y objetivo. Nada más. Así que alguien que declaraba un
// trastorno de la conducta alimentaria, un embarazo, diabetes o enfermedad
// renal seguía recibiendo el mismo déficit de 400 kcal que cualquier otro,
// con el objetivo "perder grasa" que había elegido tres pantallas antes.
//
// Esto NO calcula nutrición clínica: eso no se hace desde una app. Impide que
// la app PRESCRIBA un déficit a quien no debe recibirlo, y lo dice.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateDailyMacros, ajusteClinicoDeMacros } from '../lib/macros';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const PERSONA = {
  age: 30,
  sex: 'female' as const,
  weight_kg: 60,
  height_cm: 165,
  goal: 'fat_loss' as const,
  activity_level: 'moderate' as const,
};

test('sin condiciones, el déficit se aplica como siempre', () => {
  // El error simétrico —quitarle el déficit a quien no declaró nada— sería
  // igual de malo y menos visible.
  const sin = calculateDailyMacros(PERSONA);
  const conVacio = calculateDailyMacros(PERSONA, []);
  assert.deepEqual(sin, conVacio, 'pasar una lista vacía cambió el resultado');
});

test('un trastorno alimentario declarado quita el déficit', () => {
  const normal = calculateDailyMacros(PERSONA, []);
  const conTCA = calculateDailyMacros(PERSONA, ['trastorno_alimentario']);
  assert.ok(
    conTCA.daily_calories > normal.daily_calories,
    'sigue prescribiendo el mismo déficit a quien declaró un TCA',
  );
});

test('embarazo, diabetes y enfermedad renal, igual', () => {
  const normal = calculateDailyMacros(PERSONA, []).daily_calories;
  for (const c of ['embarazo', 'diabetes', 'enfermedad_renal']) {
    assert.ok(
      calculateDailyMacros(PERSONA, [c]).daily_calories > normal,
      `"${c}" no cambia nada: se sigue prescribiendo el déficit`,
    );
  }
});

test('cada caso explica por qué, y deriva a un profesional', () => {
  for (const c of ['trastorno_alimentario', 'embarazo', 'diabetes', 'enfermedad_renal']) {
    const r = ajusteClinicoDeMacros([c]);
    assert.equal(r.sinDeficit, true, `${c} no bloquea el déficit`);
    assert.ok(r.motivo && r.motivo.length > 40, `${c} no explica el porqué`);
    assert.equal(r.derivar, true, `${c} no deriva a un profesional`);
  }
});

test('menor de edad tampoco recibe déficit', () => {
  // El registro exige 18, pero el objetivo puede venir de un perfil viejo. Un
  // déficit a alguien en crecimiento no se deja a una validación de formulario.
  const r = ajusteClinicoDeMacros([], 16);
  assert.equal(r.sinDeficit, true);
});

test('ganar músculo no se toca: el ajuste es sobre el DÉFICIT', () => {
  // Llevar a mantenimiento a quien busca superávit sería inventarse otro
  // problema. Aquí lo que se impide es comer por debajo del gasto.
  const sup = { ...PERSONA, goal: 'muscle_gain' as const };
  const normal = calculateDailyMacros(sup, []).daily_calories;
  const conTCA = calculateDailyMacros(sup, ['trastorno_alimentario']).daily_calories;
  assert.ok(conTCA <= normal, 'a quien busca ganar músculo se le subieron las calorías por una condición');
});

// ── Que esté cableado, no solo escrito ──

test('el registro pasa el tamizaje', () => {
  const onb = leerCodigo('app', '(auth)', 'onboarding.tsx');
  assert.match(
    onb,
    /calculateDailyMacros\(profileData, health\.conditions\)/,
    'el onboarding calcula macros sin mirar lo que acaba de declarar',
  );
});

test('editar el perfil también, y falla CERRADO', () => {
  // Este camino es peor que el del registro: aquí la condición ya estaba
  // declarada desde antes.
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  assert.match(perfil, /loadHealthSafe\(profile\.user_id\)/);
  assert.match(perfil, /cargaSalud\.profile\?\.conditions \?\? \[\]/);
  assert.match(
    perfil,
    /cargaSalud\.status === 'unknown'/,
    'si no se puede leer el tamizaje, recalcula igual',
  );
});
