// __tests__/economiaPremium.test.ts
// ─────────────────────────────────────────────────────────
// Que lo que vendemos quepa en lo que podemos pagar.
//
// Hay DOS exigencias distintas aquí, y confundirlas fue mi primer error al
// escribir este archivo:
//
//   1. NINGÚN USUARIO PUEDE DAR PÉRDIDAS. Eso ya se cumple, y no por los cupos
//      diarios: lo cumple el presupuesto en dólares, que es un techo duro. Nadie
//      pasa de $2.00 al mes pase lo que pase.
//
//   2. NO PROMETER LO QUE VAMOS A CORTAR. Eso sí estaba roto, y es un problema
//      de honestidad, no de margen. Un Premium que agotara los seis cupos
//      anunciados gastaría $7.40 al mes: se queda sin IA el día 8 de 30 y los
//      "cupos diarios reales" que promete la pantalla de pago dejan de existir
//      durante tres semanas.
//
// Medir el MÁXIMO TEÓRICO contra el presupuesto no era la prueba correcta: con
// el chat en gpt-4o, diez mensajes al día cuestan $2.40 al mes ellos solos, así
// que ningún reparto realista de cupos pasaría nunca esa prueba, y la única
// forma de aprobarla sería recortar el producto hasta dejarlo inservible.
//
// Lo que sí hay que exigir:
//   • que un usuario intensivo REAL quepa en el presupuesto;
//   • que la prueba de 7 días dure 7 días;
//   • y que el tope mensual esté DICHO, porque el máximo teórico sí se corta.
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

// ── El máximo teórico: se corta, y hay que decirlo ──

/** Los seis cupos del paywall, más las validaciones que exige el corporal. */
const DIA_PREMIUM_AL_TOPE = {
  coach_chat: PREMIUM_LIMITS.coachMessagesPerDay,
  coach: PREMIUM_LIMITS.coachPosturePerDay,
  food_scan: PREMIUM_LIMITS.foodScansPerDay,
  fridge_scan: PREMIUM_LIMITS.fridgeScansPerDay,
  body_scan: PREMIUM_LIMITS.bodyScansPerDay,
  // Un análisis corporal son 3 fotos y cada una se valida antes. No es
  // opcional: app/body-scan.tsx las hace siempre.
  scan_check: 3,
  plan: PREMIUM_LIMITS.planRegensPerDay,
};

test('si el máximo teórico no cabe, el paywall tiene que decirlo', () => {
  // No se exige que quepa —con el chat en gpt-4o nunca cabría sin destrozar el
  // producto—, se exige que no se prometa en silencio algo que se corta.
  const mes = costoDiaAlTope(DIA_PREMIUM_AL_TOPE) * DIAS_DEL_MES;
  if (mes <= constante('PRESUPUESTO_PREMIUM_USD')) return; // cabe: nada que declarar

  const paywall = fs.readFileSync(path.join(process.cwd(), 'app', 'paywall.tsx'), 'utf8');
  assert.match(
    paywall,
    /tope mensual/i,
    `Agotar los cupos anunciados cuesta $${mes.toFixed(2)}/mes contra un presupuesto de ` +
      `$${constante('PRESUPUESTO_PREMIUM_USD').toFixed(2)}. Si no cabe, la pantalla de pago ` +
      'tiene que decir que hay un tope mensual. Callarlo es lo que lo convierte en engañoso.',
  );
});

// ── El caso que de verdad hay que sostener: un usuario intensivo REAL ──
//
// No es una estimación optimista: es el percentil alto que recomienda la propia
// auditoría (P95 ≤ $1.25-1.50). Alguien que usa la app en serio todos los días.
const DIA_INTENSIVO_REAL = {
  coach_chat: 4,        // cuatro conversaciones al día ya es mucho
  coach: 1,             // una revisión de técnica
  food_scan: 2,         // dos comidas fotografiadas
  fridge_scan: 1 / 3,   // la nevera, día sí día no y medio
  body_scan: 1 / 7,     // un análisis corporal por semana
  scan_check: 3 / 7,    // sus tres validaciones, prorrateadas
  plan: 1 / 30,         // rehacer el plan una vez al mes
};

test('un usuario intensivo real cabe en el presupuesto', () => {
  const dia = costoDiaAlTope(DIA_INTENSIVO_REAL);
  const mes = dia * DIAS_DEL_MES;
  const presupuesto = constante('PRESUPUESTO_PREMIUM_USD');
  assert.ok(
    mes <= presupuesto,
    `Un usuario intensivo real cuesta $${mes.toFixed(2)}/mes y el presupuesto es ` +
      `$${presupuesto.toFixed(2)}. Este es el caso que HAY que sostener: si no cabe, ` +
      'no es que alguien abuse, es que el producto no se paga solo.',
  );
});

test('la prueba de 7 días dura los 7 días', () => {
  // Es la peor ventana posible para cortarle la IA a alguien: es justo cuando
  // decide si paga. Estuvo agotándose el día 1 porque el presupuesto se fijó
  // con una cuenta equivocada por un factor de siete.
  const dia = costoDiaAlTope(DIA_INTENSIVO_REAL);
  const presupuesto = constante('PRESUPUESTO_PRUEBA_USD');
  const dias = presupuesto / dia;
  assert.ok(
    dia * 7 <= presupuesto,
    `La prueba al ritmo de un usuario intensivo cuesta $${dia.toFixed(4)}/día y su ` +
      `presupuesto es $${presupuesto.toFixed(2)}: se agota el día ${dias.toFixed(1)} de 7.`,
  );
});

test('el presupuesto de la prueba sigue siendo un costo de adquisición razonable', () => {
  // Subirlo para que la prueba dure no puede convertirla en un agujero.
  const prueba = constante('PRESUPUESTO_PRUEBA_USD');
  const INGRESO_NETO_MES = 5.0;
  assert.ok(prueba <= INGRESO_NETO_MES * 0.2, `$${prueba} por prueba es demasiado`);
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

test('el plan gratis no puede dar pérdidas', () => {
  // Una cuenta anónima cuesta lo que cueste su presupuesto, y crear cuentas es
  // gratis. Este es el techo por cuenta.
  const gratis = constante('PRESUPUESTO_GRATIS_USD');
  assert.ok(gratis <= 0.20, `$${gratis} por cuenta anónima es demasiado: crear cuentas no cuesta nada`);
});
