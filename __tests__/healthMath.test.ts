// __tests__/healthMath.test.ts
// node --import tsx --test __tests__/healthMath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRisk, needsDoctorClearance, healthToPrompt, hasAnyFlag,
  healthSummary, highRiskKeys, exerciseRiskZones, exerciseConflicts,
  HEALTH_UNKNOWN_DIRECTIVE, EMPTY_HEALTH, type HealthProfile,
} from '../lib/healthMath';

function h(over: Partial<HealthProfile>): HealthProfile {
  return { ...EMPTY_HEALTH, ...over };
}

test('riesgo: joven sano = bajo, sin directivas', () => {
  const r = computeRisk(EMPTY_HEALTH, 25);
  assert.equal(r.level, 'bajo');
  assert.equal(healthToPrompt(EMPTY_HEALTH, 25), '');
  assert.equal(hasAnyFlag(EMPTY_HEALTH), false);
});

test('riesgo: dolor de pecho = ALTO y requiere médico', () => {
  const p = h({ parq_chest_pain: true });
  assert.equal(computeRisk(p, 30).level, 'alto');
  assert.equal(needsDoctorClearance(p, 30), true);
});

test('riesgo: cardiopatía = ALTO; con autorización ya no exige clearance pero sigue alto', () => {
  const p = h({ conditions: ['cardiopatia'] });
  assert.equal(computeRisk(p, 45).level, 'alto');
  assert.equal(needsDoctorClearance(p, 45), true);
  const cleared = h({ conditions: ['cardiopatia'], doctor_cleared: true });
  assert.equal(needsDoctorClearance(cleared, 45), false);
  assert.equal(computeRisk(cleared, 45).level, 'alto'); // el riesgo no desaparece
});

test('riesgo: hipertensión o lesión = moderado; embarazo = alto', () => {
  assert.equal(computeRisk(h({ conditions: ['hipertension'] }), 35).level, 'moderado');
  assert.equal(computeRisk(h({ injuries: ['rodilla'] }), 28).level, 'moderado');
  assert.equal(computeRisk(h({ conditions: ['embarazo'] }), 30).level, 'alto');
});

test('riesgo: 60+ años sube a moderado aunque esté sano', () => {
  assert.equal(computeRisk(EMPTY_HEALTH, 62).level, 'moderado');
  assert.equal(computeRisk(EMPTY_HEALTH, 59).level, 'bajo');
});

test('directivas: SÍNTOMAS ACTIVOS sin evaluar = NO prescribir nada (ni caminatas)', () => {
  const p = healthToPrompt(h({ parq_chest_pain: true }), 40);
  assert.match(p, /SÍNTOMAS ACTIVOS SIN EVALUAR/);
  assert.match(p, /NO prescribas NINGUNA actividad/);
  assert.match(p, /atención inmediata/);
  assert.doesNotMatch(p, /Limítate a: caminatas suaves/);
});

test('directivas: alto por CONDICIÓN estable sin autorización = modo suave (caminatas)', () => {
  const p = healthToPrompt(h({ conditions: ['cardiopatia'] }), 40);
  assert.match(p, /SIN AUTORIZACIÓN MÉDICA/);
  assert.match(p, /PROHIBIDO prescribir entrenamiento de fuerza/);
  assert.match(p, /caminatas suaves/);
});

test('directivas: alto CON autorización = cautela máxima, no modo seguro', () => {
  const p = healthToPrompt(h({ conditions: ['cardiopatia'], doctor_cleared: true }), 50);
  assert.match(p, /Autorizado por su médico/);
  assert.match(p, /RPE ≤ 5-6/);
  assert.doesNotMatch(p, /SIN AUTORIZACIÓN MÉDICA/);
});

test('directivas: las banderas PAR-Q persisten AUNQUE haya autorización', () => {
  const p = healthToPrompt(h({ parq_dizziness: true, doctor_cleared: true }), 40);
  assert.match(p, /MAREOS\/DESMAYOS declarados/);
  assert.match(p, /riesgo de caída/);
  assert.match(p, /cargas sobre la cabeza/);
});

test('directivas: embarazo con visto médico usa guía ACOG, no topes de cardiopatía', () => {
  const p = healthToPrompt(h({ conditions: ['embarazo'], doctor_cleared: true }), 32);
  assert.match(p, /guía específica de EMBARAZO/);
  assert.match(p, /150 min\/semana/);
  assert.doesNotMatch(p, /RPE ≤ 5-6, progresión al doble de lenta/);
  // Señales de alarma prenatales presentes (ACOG):
  assert.match(p, /sangrado vaginal/);
});

test('directivas: LÍMITE MÉDICO siempre presente cuando hay directivas', () => {
  const p = healthToPrompt(h({ conditions: ['asma'] }), 30);
  assert.match(p, /LÍMITE MÉDICO/);
  assert.match(p, /PROHIBIDO diagnosticar/);
});

test('directivas clínicas del panel: cauda equina, brote artrítico, betabloqueadores, hiperglucemia', () => {
  assert.match(healthToPrompt(h({ conditions: ['hernia_discal'] }), 35), /URGENCIAS de inmediato/);
  assert.match(healthToPrompt(h({ conditions: ['hernia_discal'] }), 35), /crunches/);
  assert.match(healthToPrompt(h({ conditions: ['artritis'] }), 35), /CALIENTE, hinchada/);
  assert.match(healthToPrompt(h({ conditions: ['cardiopatia'], doctor_cleared: true }), 35), /betabloqueadores/);
  assert.match(healthToPrompt(h({ conditions: ['diabetes'] }), 35), /cetonas/);
  assert.match(healthToPrompt(h({ injuries: ['espalda_baja'] }), 35), /esfínteres/);
  assert.match(healthToPrompt(h({ injuries: ['hombro'] }), 35), /despierta por la noche/);
  assert.match(healthToPrompt(EMPTY_HEALTH, 70), /POTENCIA/);
  assert.match(healthToPrompt(EMPTY_HEALTH, 70), /1.2-1.6 g\/kg/);
});

test('directivas por condición: hipertensión → Valsalva; hernia → prohibir peso muerto', () => {
  const p1 = healthToPrompt(h({ conditions: ['hipertension'] }), 35);
  assert.match(p1, /Valsalva/);
  const p2 = healthToPrompt(h({ conditions: ['hernia_discal'] }), 35);
  assert.match(p2, /PROHIBIDO peso muerto desde el suelo/);
});

test('directivas por lesión: rodilla evita sentadilla profunda y saltos', () => {
  const p = healthToPrompt(h({ injuries: ['rodilla'] }), 30);
  assert.match(p, /sentadilla profunda/);
  assert.match(p, /saltos/);
});

test('directivas por edad: 65+ prohíbe fallo y técnicas de intensidad; 55-64 sin máximos', () => {
  const p65 = healthToPrompt(EMPTY_HEALTH, 68);
  assert.match(p65, /EDAD 65\+/);
  assert.match(p65, /PROHIBIDO entrenar al fallo/);
  assert.match(p65, /dropsets/);
  const p55 = healthToPrompt(EMPTY_HEALTH, 58);
  assert.match(p55, /EDAD 55-64/);
  assert.match(p55, /85% 1RM/);
});

test('directivas: other_note se incluye truncada y con cautela', () => {
  const p = healthToPrompt(h({ other_note: 'me operaron del corazón hace poco' }), 30);
  assert.match(p, /CONDICIÓN ADICIONAL/);
  assert.match(p, /operaron del corazón/);
});

test('la REGLA FINAL siempre cierra el bloque cuando hay directivas', () => {
  const p = healthToPrompt(h({ conditions: ['asma'] }), 30);
  assert.match(p, /GANAN LAS DIRECTIVAS/);
});

test('healthSummary legible', () => {
  assert.equal(healthSummary(EMPTY_HEALTH), 'Sin condiciones declaradas');
  const s = healthSummary(h({ conditions: ['diabetes'], injuries: ['hombro'] }));
  assert.match(s, /Diabetes/);
  assert.match(s, /Hombro/);
});

test('highRiskKeys: detecta el set de razones alto (para invalidar autorizaciones viejas)', () => {
  assert.deepEqual(highRiskKeys(EMPTY_HEALTH), []);
  const keys = highRiskKeys(h({ parq_chest_pain: true, conditions: ['embarazo', 'diabetes'] }));
  assert.deepEqual(keys.sort(), ['chest_pain', 'embarazo']);
});

test('exerciseRiskZones: mapea ejercicios a zonas que cargan', () => {
  assert.ok(exerciseRiskZones('Sentadilla con barra').includes('rodilla'));
  assert.ok(exerciseRiskZones('Sentadilla con barra').includes('espalda_baja'));
  assert.ok(exerciseRiskZones('Peso muerto rumano').includes('espalda_baja'));
  assert.ok(exerciseRiskZones('Press militar').includes('hombro'));
  assert.ok(exerciseRiskZones('Zancada búlgara').includes('rodilla'));
  assert.ok(exerciseRiskZones('Salto al cajón').includes('tobillo_pie'));
  assert.deepEqual(exerciseRiskZones('Face pull'), []); // seguro: no dispara falsas alarmas
});

test('exerciseConflicts: cruza ejercicio con lesiones declaradas', () => {
  assert.deepEqual(exerciseConflicts('Sentadilla profunda', ['rodilla']), ['rodilla']);
  assert.deepEqual(exerciseConflicts('Sentadilla profunda', []), []);
  assert.deepEqual(exerciseConflicts('Curl de bíceps', ['rodilla']), []);
  assert.ok(exerciseConflicts('Peso muerto', ['espalda_baja', 'rodilla']).includes('espalda_baja'));
});

test('HEALTH_UNKNOWN_DIRECTIVE existe y es conservadora (fail-closed)', () => {
  assert.match(HEALTH_UNKNOWN_DIRECTIVE, /NO se pudo verificar/);
  assert.match(HEALTH_UNKNOWN_DIRECTIVE, /conservador/);
  assert.match(HEALTH_UNKNOWN_DIRECTIVE, /pregunta por lesiones/);
});
