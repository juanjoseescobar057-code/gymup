// __tests__/loteCopy.test.ts
// ─────────────────────────────────────────────────────────
// Tercer lote de la auditoría profunda: lo que lee la persona.
//
// Cada test de aquí abajo falla contra el commit anterior. Anclan en el código
// sin comentarios porque los comentarios de este repo citan lo que se quitó.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computeRisk, EMPTY_HEALTH } from '../lib/healthMath';
import { projectGoal } from '../lib/goalMath';
import { mensajeDeFalloDeIA, FALLO_DE_RED, FALLO_GENERICO } from '../lib/mensajeDeFallo';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── Nadie se compara con nadie ──

test('el humor de regreso ya no menciona a la ex de nadie', () => {
  const src = leerCodigo('lib', 'motivacion.ts');
  assert.ok(!/tu ex/i.test(src), 'la comparación con "tu ex" sigue en el código');
  assert.ok(!/te robó/i.test(src));
  // Y no asume género.
  assert.ok(!/estabas ocupado/.test(src));
});

test('el primer texto del onboarding no exige élite ni prohíbe excusas', () => {
  const src = leerCodigo('app', '(auth)', 'onboarding.tsx');
  assert.ok(!/ÉLITE/.test(src), 'sigue "ENTRENA COMO ÉLITE"');
  assert.ok(!/Sin excusas/.test(src), 'sigue "Sin excusas"');
  assert.match(src, /A TU/);
  assert.match(src, /RITMO\./);
});

test('el coach tiene reglas de cómo hablar: sin jerga, sin comparar, sin culpa', () => {
  const persona = leerCodigo('lib', 'coachChat.ts');
  assert.match(persona, /CÓMO HABLAS/);
  assert.match(persona, /Nunca compares a la persona con nadie/);
  assert.match(persona, /sin excusas/i);
  assert.match(persona, /RIR, RPE/);
});

// ── "Error" no es un título ──

const CON_ALERTAS: string[][] = [
  ['app', '(auth)', 'onboarding.tsx'],
  ['app', '(tabs)', 'coach.tsx'],
  ['app', '(tabs)', 'profile.tsx'],
  ['app', '(tabs)', 'progress.tsx'],
  ['app', 'food-scan.tsx'],
  ['app', 'fridge-scan.tsx'],
  ['app', 'body-scan.tsx'],
];

for (const ruta of CON_ALERTAS) {
  test(`${ruta.join('/')} no abre ninguna alerta titulada "Error"`, () => {
    const src = leerCodigo(...ruta);
    assert.ok(!/Alert\.alert\(\s*'Error'/.test(src), 'queda un Alert.alert(\'Error\', …)');
  });
}

test('ningún Alert enseña error.message de Supabase tal cual', () => {
  for (const ruta of CON_ALERTAS) {
    const src = leerCodigo(...ruta);
    assert.ok(
      !/Alert\.alert\([^)]*\berror\.message\b/.test(src),
      `${ruta.join('/')}: un mensaje de Postgres llega a la pantalla`,
    );
    assert.ok(
      !/Alert\.alert\([^)]*\be\.message\b/.test(src),
      `${ruta.join('/')}: un mensaje de excepción llega a la pantalla`,
    );
  }
});

test('un fallo de análisis enseña lo nuestro y traduce lo ajeno', () => {
  // Lo nuestro (ErrorDeIA) ya viene en castellano y con el motivo real.
  const nuestro = Object.assign(new Error('Llegaste al límite de análisis de hoy.'), { name: 'ErrorDeIA' });
  assert.equal(mensajeDeFalloDeIA(nuestro), 'Llegaste al límite de análisis de hoy.');
  // Lo ajeno no se enseña tal cual.
  assert.equal(mensajeDeFalloDeIA(new TypeError('Network request failed')), FALLO_DE_RED);
  const esquema = mensajeDeFalloDeIA(new Error('Expected number, received string at "score"'));
  assert.equal(esquema, FALLO_GENERICO);
  assert.equal(mensajeDeFalloDeIA(undefined), FALLO_GENERICO);
  assert.equal(mensajeDeFalloDeIA('boom'), FALLO_GENERICO);
});

test('las tres pantallas de análisis pasan por el traductor', () => {
  for (const ruta of [['app', '(tabs)', 'coach.tsx'], ['app', 'fridge-scan.tsx'], ['app', 'body-scan.tsx']]) {
    const src = leerCodigo(...ruta);
    assert.match(src, /mensajeDeFalloDeIA\(e\)/, `${ruta.join('/')} no traduce el fallo del análisis`);
  }
});

test('al fallar el registro se dice que las respuestas siguen ahí', () => {
  const src = leerCodigo('app', '(auth)', 'onboarding.tsx');
  assert.match(src, /No pudimos terminar/);
  assert.match(src, /Tus respuestas siguen aquí/);
  assert.ok(!/Error desconocido/.test(src));
});

// ── Nada interno en pantalla ──

test('la pantalla legal no enseña la nota interna de revisión jurídica', () => {
  const src = leerCodigo('app', 'legal.tsx');
  assert.ok(!/revisión jurídica/.test(src));
  assert.ok(!/s\.note\b/.test(src), 'quedó el estilo de la nota huérfano');
});

test('el nivel de riesgo por técnica se lee en castellano', () => {
  const src = leerCodigo('app', '(tabs)', 'coach.tsx');
  assert.ok(!/technique_risk_level\.toUpperCase\(\)/.test(src), 'sigue enseñando HIGH/MEDIUM/LOW');
  assert.match(src, /TECHNIQUE_RISK_LABELS\[result\.technique_risk_level\]/);
  for (const nivel of ['NINGUNO', 'BAJO', 'MEDIO', 'ALTO']) assert.match(src, new RegExp(`'${nivel}'`));
  assert.ok(!/>FIX</.test(src), 'la etiqueta "FIX" sigue en inglés');
  assert.ok(!/Cue: "/.test(src), 'la etiqueta "Cue:" sigue en inglés');
});

test('las zonas de lesión llegan con su etiqueta, no con la clave', () => {
  const r = computeRisk({ ...EMPTY_HEALTH, injuries: ['espalda_baja', 'muneca_codo'] as any }, 30);
  const texto = r.reasons.join(' | ');
  assert.ok(!/espalda_baja|muneca_codo/.test(texto), `clave interna en pantalla: ${texto}`);
  assert.match(texto, /espalda baja/);
  assert.match(texto, /muñeca \/ codo/);
});

test('el panel de telemetría se cierra fuera de desarrollo', () => {
  const src = leerCodigo('app', 'telemetry.tsx');
  assert.match(src, /if \(!__DEV__\) return <Redirect/);
  assert.match(src, /import \{ Redirect, router \} from 'expo-router'/);
});

test('el error genérico de IA no enseña el código HTTP', () => {
  const src = leerCodigo('lib', 'aiClient.ts');
  assert.ok(!/IA no disponible \(\$\{res\.status\}\)/.test(src));
  assert.match(src, /'no_disponible', res\.status\)/, 'el status tiene que seguir viajando para la telemetría');
});

// ── Sin alarma donde no la hay ──

test('ir al revés de la meta se describe, no se grita', () => {
  // Mismo escenario que goalMath.test.ts: quiere ganar y va bajando.
  const p = projectGoal({
    goal: 'muscle_gain',
    currentWeight: 70,
    targetWeight: 76,
    startWeight: 70,
    points: [
      { date: '2026-01-01', weight: 72 },
      { date: '2026-01-08', weight: 71 },
      { date: '2026-01-15', weight: 70 },
    ],
  });
  assert.equal(p.reversing, true, 'el escenario tiene que ser de retroceso real');
  assert.ok(!/contraria/i.test(p.headline), `sigue el titular de alarma: ${p.headline}`);
  assert.match(p.detail, /constancia, sueño, estrés/);
  assert.match(p.detail, /Faltan \d+\.\d kg/);
});

test('el análisis corporal no predice con bola de cristal ni pinta el cuerpo en rojo', () => {
  const src = leerCodigo('app', 'body-scan.tsx');
  assert.ok(!/🔮|PREDICCIÓN A 30 DÍAS/.test(src));
  assert.match(src, /QUÉ ESPERAR EN 30 DÍAS/);
  assert.ok(!/label: 'Prioridad'/.test(src));
  assert.ok(!/priority: \{ color: Colors\.error/.test(src), 'la zona con más margen sigue en rojo');
  assert.ok(!/expertise/.test(src));
});

test('el consejo del día no habla de "límite de calorías"', () => {
  const src = leerCodigo('app', '(tabs)', 'camera.tsx');
  assert.ok(!/límite de calorías/.test(src));
  assert.ok(!/Sin usos hoy/.test(src));
});

test('los avisos de cupo, el plan y la cámara hablan claro', () => {
  assert.ok(!/Sin escaneos por hoy/.test(leerCodigo('app', 'food-scan.tsx')));
  assert.ok(!/semana parado/.test(leerCodigo('lib', 'planCalendario.ts')));
  assert.ok(!/repetición de reserva/.test(leerCodigo('lib', 'planCalendario.ts')));
  assert.ok(!/1–3 RIR/.test(leerCodigo('lib', 'progressionEngine.ts')));
  assert.ok(!/Android cerró la app/.test(leerCodigo('lib', 'camara.ts')));
  // El botón se llama igual en las dos pantallas que lo nombran.
  assert.ok(!/Ajustar mi plan\)/.test(leerCodigo('app', '(tabs)', 'index.tsx')));
  assert.match(leerCodigo('app', '(tabs)', 'index.tsx'), /Actualizar mi rutina\)/);
});
