// __tests__/economiaPremium.test.ts
// ─────────────────────────────────────────────────────────
// Que los cupos que anuncia el paywall quepan en el presupuesto que los corta.
//
// Hoy no caben, y por mucho. Un Premium que use exactamente los seis cupos que
// le vendimos gasta ~$0,25 al día; el presupuesto mensual es de $2,00. Se queda
// sin IA el día ocho de treinta, y los "cupos diarios reales" que promete la
// pantalla de pago dejan de existir durante las tres semanas siguientes.
//
// En la prueba de 7 días es peor: un día al tope cuesta $0,2175 contra $0,25 de
// presupuesto. La prueba entrega IA un día y medio, justo en la ventana donde
// se decide si la persona paga.
//
// Ninguna de las dos cosas está mal por separado. El presupuesto en dólares es
// el único tope que protege el margen de verdad —contar llamadas no distingue
// un chat de un plan— y los cupos hacen la experiencia predecible. Lo que no
// puede ser es que se contradigan EN SILENCIO: el usuario ve un número, el
// servidor aplica otro, y nadie se entera hasta el reembolso.
//
// Este test no elige por nosotros. Solo hace imposible publicar la
// contradicción: o bajan los cupos, o sube el presupuesto, o baja el costo por
// llamada (que es lo que de verdad hay que hacer — casi todo corre en gpt-4o,
// dieciséis veces más caro que mini).
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PREMIUM_LIMITS } from '../lib/subscription';
import { FEATURE_POLICY } from '../supabase/functions/_shared/politica';

const proxy = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', 'ai-proxy', 'index.ts'),
  'utf8',
);

function constante(nombre: string): number {
  const m = proxy.match(new RegExp(`const ${nombre} = ([\\d.]+);`));
  assert.ok(m, `no encontré ${nombre} en el ai-proxy`);
  return Number(m![1]);
}

/**
 * Costo medido por llamada, en dólares.
 *
 * Salen de las mediciones que están documentadas en
 * supabase/functions/_shared/politica.ts. Si cambian los modelos, cambian
 * estos números y este test vuelve a decidir si los cupos siguen cabiendo.
 */
const COSTO_USD: Record<string, number> = {
  coach_chat: 0.0080,
  coach: 0.0080,   // análisis de postura
  food_scan: 0.0079,
  fridge_scan: 0.0105,
  body_scan: 0.0092,
  plan: 0.0338,
  scan_check: 0.0005,
};

/** Lo que cuesta un día en el que alguien agota TODO lo que se le prometió. */
function costoDiaAlTope(topes: Record<string, number>): number {
  return Object.entries(topes).reduce(
    (total, [feature, veces]) => total + veces * (COSTO_USD[feature] ?? 0),
    0,
  );
}

const DIAS_DEL_MES = 30;

// ── Los costos que usa este test son los que dice el código ──

test('cada feature con cupo anunciado tiene un costo medido', () => {
  // Si aparece una feature nueva en el paywall sin costo aquí, el cálculo de
  // más abajo la contaría como gratis y este test dejaría de proteger nada.
  const conCupo = ['coach_chat', 'coach', 'food_scan', 'fridge_scan', 'body_scan', 'plan'];
  for (const f of conCupo) {
    assert.ok(COSTO_USD[f] > 0, `falta el costo de ${f}`);
    assert.ok(FEATURE_POLICY[f], `${f} no existe en la política del servidor`);
  }
});

// ── El caso que importa: un Premium usando lo que compró ──

/** Los seis cupos del paywall, más las validaciones que exige el corporal. */
const DIA_PREMIUM_AL_TOPE = {
  coach_chat: PREMIUM_LIMITS.coachMessagesPerDay,
  coach: PREMIUM_LIMITS.coachPosturePerDay,
  food_scan: PREMIUM_LIMITS.foodScansPerDay,
  fridge_scan: PREMIUM_LIMITS.fridgeScansPerDay,
  body_scan: PREMIUM_LIMITS.bodyScansPerDay,
  // Un análisis corporal son 3 fotos, y cada una se valida antes. No es
  // opcional: app/body-scan.tsx las hace siempre.
  scan_check: 3,
  plan: PREMIUM_LIMITS.planRegensPerDay,
};

test('un mes usando los cupos anunciados cabe en el presupuesto Premium', () => {
  const dia = costoDiaAlTope(DIA_PREMIUM_AL_TOPE);
  const mes = dia * DIAS_DEL_MES;
  const presupuesto = constante('PRESUPUESTO_PREMIUM_USD');
  const diasQueDura = presupuesto / dia;

  assert.ok(
    mes <= presupuesto,
    `Los cupos del paywall cuestan $${mes.toFixed(2)}/mes y el presupuesto es $${presupuesto.toFixed(2)}.\n` +
      `  Un Premium que use lo que le vendimos se queda sin IA el día ${diasQueDura.toFixed(1)} de ${DIAS_DEL_MES}.\n` +
      `  Para que cuadre hay que hacer UNA de estas tres:\n` +
      `    · bajar los cupos de PREMIUM_LIMITS a ≤${(presupuesto / DIAS_DEL_MES / dia * 100).toFixed(0)}% de los actuales;\n` +
      `    · subir PRESUPUESTO_PREMIUM_USD a $${mes.toFixed(2)} (y comprobar que sigue habiendo margen);\n` +
      `    · bajar el costo por llamada — casi todo corre en gpt-4o, 16x más caro que gpt-4o-mini.\n` +
      `  Lo que NO se puede es publicar las dos cifras y que se contradigan en silencio.`,
  );
});

test('la prueba de 7 días dura los 7 días', () => {
  // Durante la prueba los escaneos de imagen comparten un cupo de 3, pero el
  // chat y la postura NO comparten nada.
  const dia = costoDiaAlTope({
    coach_chat: FEATURE_POLICY.coach_chat.trialLimit,
    coach: FEATURE_POLICY.coach.trialLimit,
    scan_check: 3,
    plan: FEATURE_POLICY.plan.trialLimit,
  }) + 3 * COSTO_USD.food_scan; // el cupo compartido de escaneos

  const presupuesto = constante('PRESUPUESTO_PRUEBA_USD');
  const diasQueDura = presupuesto / dia;

  assert.ok(
    dia * 7 <= presupuesto,
    `La prueba al tope cuesta $${dia.toFixed(4)}/día y su presupuesto es $${presupuesto.toFixed(2)}: ` +
      `se agota el día ${diasQueDura.toFixed(1)} de 7.\n` +
      `  Es la peor ventana posible para cortarle la IA a alguien: es justo cuando decide si paga.`,
  );
});

// ── El margen sigue protegido ──

test('el presupuesto Premium no se come el ingreso', () => {
  // 24.900 COP menos ~15% de Play ≈ $5.00 netos. Si la IA se lleva más de la
  // mitad no queda para infraestructura, soporte ni margen.
  const INGRESO_NETO_USD = 5.0;
  assert.ok(
    constante('PRESUPUESTO_PREMIUM_USD') <= INGRESO_NETO_USD * 0.5,
    'el presupuesto de IA supera la mitad del ingreso neto por usuario',
  );
});

test('adquirir a alguien cuesta menos que atenderlo un mes', () => {
  assert.ok(constante('PRESUPUESTO_PRUEBA_USD') < constante('PRESUPUESTO_PREMIUM_USD'));
});

test('el plan gratis no puede dar pérdidas', () => {
  // Una cuenta anónima cuesta lo que cueste su presupuesto, y crear cuentas es
  // gratis. Este es el techo por cuenta.
  const gratis = constante('PRESUPUESTO_GRATIS_USD');
  assert.ok(gratis <= 0.20, `$${gratis} por cuenta anónima es demasiado: crear cuentas no cuesta nada`);
});
