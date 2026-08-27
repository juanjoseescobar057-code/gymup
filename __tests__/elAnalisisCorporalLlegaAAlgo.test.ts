// __tests__/elAnalisisCorporalLlegaAAlgo.test.ts
// ─────────────────────────────────────────────────────────
// Lo que la IA ve en las fotos tiene que llegar a algún sitio.
//
// Dos huecos, los dos de la misma familia — algo que se calcula, se guarda, y
// no lo consume nadie:
//
//   1. EL COACH veía tres números del último análisis: score, % de grasa y
//      "focus_areas". No la fecha, no las zonas, no las fortalezas, y no
//      `notes` — que es refined_plan_notes, lo que la IA escribió sobre qué
//      cambiar en el plan. A "¿qué viste en mi foto?" respondía con verdad que
//      no tenía ese contexto.
//
//   2. EL PLAN nunca se enteraba. refined_plan_notes se pintaba en la pantalla
//      de resultados y ahí moría: se leía "tu plan debería enfocarse más en
//      core", y el plan seguía idéntico. El texto describía un cambio que no
//      ocurría en ninguna parte.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── El coach recibe el análisis entero ──

test('la ficha del coach pide las columnas que necesita', () => {
  const ctx = leerCodigo('lib', 'coachContext.ts');
  const i = ctx.indexOf("from('body_scans')");
  assert.ok(i > 0, 'el coach ya no lee body_scans');
  const consulta = ctx.slice(i, i + 300);
  for (const col of ['scanned_at', 'strengths', 'zones', 'notes']) {
    assert.ok(consulta.includes(col), `la consulta no trae "${col}"`);
  }
});

test('y todo eso llega al prompt, no solo se consulta', () => {
  // Traer columnas que no se escriben en el prompt sería el mismo fallo con
  // más pasos.
  const ctx = leerCodigo('lib', 'coachContext.ts');
  const i = ctx.indexOf('export function snapshotToPrompt');
  assert.ok(i > 0, 'no encontré snapshotToPrompt');
  const prompt = ctx.slice(i);
  for (const campo of ['fortalezas', 'zonas', 'notasPlan', 'fecha']) {
    assert.ok(prompt.includes(campo), `"${campo}" se calcula y no llega al prompt`);
  }
});

test('la fecha del análisis se le dice al coach', () => {
  // Sin ella no distingue unas fotos de ayer de unas de hace dos meses, y
  // hablar de "tu último análisis" sobre fotos viejas es peor que callarse.
  const ctx = leerCodigo('lib', 'coachContext.ts');
  assert.match(ctx, /Último análisis corporal\$\{cuando/);
});

test('el modo recuperación sigue retirando el análisis corporal', () => {
  // Enriquecerlo no puede haber abierto una vía para que el score y el "~X% de
  // grasa" lleguen a quien declaró un trastorno alimentario.
  const rec = leerCodigo('lib', 'recoveryMode.ts');
  assert.match(rec, /'lastBodyScan'/);
});

// ── El plan puede cambiar a partir de él ──

test('regenerateAdaptivePlan acepta las notas del análisis', () => {
  const ap = leerCodigo('lib', 'adaptivePlan.ts');
  assert.match(ap, /notasCorporales\?: string \| null/);
  assert.ok(
    /\$\{notasCorporales \?/.test(ap),
    'el parámetro se acepta y no entra en el prompt',
  );
});

test('las notas no pueden pisar el desempeño real', () => {
  // Una foto sin calibrar es una impresión; los registros son datos. Si chocan,
  // mandan los datos, y eso tiene que estar dicho en el prompt.
  const ap = leerCodigo('lib', 'adaptivePlan.ts');
  assert.match(ap, /NO puede contradecir el desempeño registrado/);
});

test('hay UNA sola implementación del ajuste con vista previa', () => {
  // Estaba escrita dentro de profile.tsx. Al añadir el segundo sitio que la
  // ofrece, copiarla habría repetido el fallo que este repositorio ya cometió
  // tres veces: cablear en dos archivos y olvidar el tercero.
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  const bodyScan = leerCodigo('app', 'body-scan.tsx');
  for (const [nombre, codigo] of [['profile.tsx', perfil], ['body-scan.tsx', bodyScan]] as const) {
    assert.ok(
      codigo.includes('ofrecerAjusteDePlan('),
      `${nombre} no usa el flujo compartido`,
    );
    assert.ok(
      !codigo.includes('saveAdaptedPlan('),
      `${nombre} aplica el plan por su cuenta: hay dos implementaciones otra vez`,
    );
  }
});

test('el ajuste desde el análisis respeta el mismo cupo', () => {
  // Es la misma llamada de IA y el mismo costo: entrar por otra pantalla no
  // puede saltarse el tope diario.
  const bodyScan = leerCodigo('app', 'body-scan.tsx');
  const i = bodyScan.indexOf('async function aplicarAlPlan');
  assert.ok(i > 0, 'no encontré el handler');
  const cuerpo = bodyScan.slice(i, i + 700);
  assert.ok(cuerpo.includes("canUseFeature('regenerate_plan'"), 'no comprueba el cupo');
  assert.ok(
    cuerpo.indexOf("canUseFeature('regenerate_plan'") < cuerpo.indexOf('ofrecerAjusteDePlan('),
    'comprueba el cupo DESPUÉS de gastar la llamada',
  );
});

test('nada se aplica sin enseñar antes qué cambia', () => {
  const flujo = leerCodigo('lib', 'ofrecerAjusteDePlan.ts');
  const iPreview = flujo.indexOf('planChangePreview(');
  const iGuardar = flujo.indexOf('saveAdaptedPlan(');
  assert.ok(iPreview > 0 && iGuardar > 0, 'falta la vista previa o el guardado');
  assert.ok(iPreview < iGuardar, 'se guarda antes de enseñar el diff');
});
