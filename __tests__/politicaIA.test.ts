// __tests__/politicaIA.test.ts
// ─────────────────────────────────────────────────────────
// Que lo que se vende quepa en su propio cupo.
//
// El análisis corporal hace una llamada de validación POR FOTO más una de
// análisis. Todas iban etiquetadas 'body_scan', cuyo tope es 1 al día: la
// validación de la primera foto agotaba el único uso y el análisis final
// recibía siempre un 429. Con UNA sola foto ya eran dos llamadas contra un tope
// de uno, así que un Premium de pago no podía completar un análisis corporal
// nunca.
//
// Y el efecto era perverso: en la prueba gratis el contador es compartido, así
// que la función SÍ andaba durante los siete días y se rompía justo el día que
// la persona pagaba.
//
// Nada lo detectó porque no había forma de escribir un test que contara las
// llamadas de un flujo: la decisión vivía suelta dentro del Deno.serve. Ahora
// está en _shared/politica.ts y estos tests simulan el flujo entero.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolverPolitica,
  FEATURE_POLICY,
  FEATURE_COST_RANK,
  strictestPolicy,
} from '../supabase/functions/_shared/politica';

type Llamada = { feature: string; imagenes: number };

/**
 * Simula un flujo: gasta llamadas contra los contadores diarios y dice si
 * alguna se quedó sin cupo. Es lo que hace el proxy, sin la base de datos.
 */
function simular(llamadas: Llamada[], quien: { isPremium: boolean; esPrueba: boolean }) {
  const contadores = new Map<string, number>();
  const fallos: string[] = [];

  for (const [i, ll] of llamadas.entries()) {
    const r = resolverPolitica({
      headerDeclarado: ll.feature,
      imagenes: ll.imagenes,
      isPremium: quien.isPremium,
      esPrueba: quien.esPrueba,
    });
    if (r.exigePremium) {
      fallos.push(`llamada ${i + 1} (${ll.feature}): 402 premium_required`);
      continue;
    }
    const usado = (contadores.get(r.claveContador) ?? 0) + 1;
    contadores.set(r.claveContador, usado);
    if (usado > r.limite) {
      fallos.push(`llamada ${i + 1} (${ll.feature} → ${r.claveContador}): 429, ${usado} > ${r.limite}`);
    }
  }
  return { fallos, contadores };
}

/** El flujo real de app/body-scan.tsx: una validación por foto, y el análisis. */
const flujoAnalisisCorporal = (fotos: number): Llamada[] => [
  ...Array.from({ length: fotos }, () => ({ feature: 'scan_check', imagenes: 1 })),
  { feature: 'body_scan', imagenes: fotos },
];

// ── El fallo que motivó todo esto ──

test('un Premium completa el análisis corporal con UNA foto', () => {
  // El caso más barato, y estaba roto: 2 llamadas contra un tope de 1.
  const { fallos } = simular(flujoAnalisisCorporal(1), { isPremium: true, esPrueba: false });
  assert.deepEqual(fallos, []);
});

test('un Premium completa el análisis corporal con las TRES fotos', () => {
  const { fallos } = simular(flujoAnalisisCorporal(3), { isPremium: true, esPrueba: false });
  assert.deepEqual(fallos, []);
});

test('en la prueba gratis también se completa con tres fotos', () => {
  // Antes solo funcionaba aquí, y era el problema: la función andaba durante la
  // prueba y se rompía al pagar. Ahora tiene que ir en los dos sitios.
  const { fallos } = simular(flujoAnalisisCorporal(3), { isPremium: true, esPrueba: true });
  assert.deepEqual(fallos, []);
});

test('las validaciones NO gastan el cupo del análisis', () => {
  // La regla concreta que estaba rota.
  const { contadores } = simular(flujoAnalisisCorporal(3), { isPremium: true, esPrueba: false });
  assert.equal(contadores.get('scan_check'), 3);
  assert.equal(contadores.get('body_scan'), 1);
});

test('las validaciones tampoco gastan el cupo compartido de la prueba', () => {
  // Si scan_check entrara en ESCANEOS_DE_IMAGEN volveríamos justo al mismo sitio.
  const { contadores } = simular(flujoAnalisisCorporal(3), { isPremium: true, esPrueba: true });
  assert.equal(contadores.get('trial_scans'), 1, 'solo el análisis comparte cupo');
  assert.equal(contadores.get('scan_check'), 3);
});

test('el análisis corporal sigue siendo uno al día', () => {
  // Arreglar el flujo no puede haber abierto la barra libre.
  const dos = [...flujoAnalisisCorporal(1), ...flujoAnalisisCorporal(1)];
  const { fallos } = simular(dos, { isPremium: true, esPrueba: false });
  assert.equal(fallos.length, 1);
  assert.match(fallos[0], /body_scan/);
});

test('quien no paga no entra al análisis corporal', () => {
  const { fallos } = simular(flujoAnalisisCorporal(1), { isPremium: false, esPrueba: false });
  assert.equal(fallos.length, 2, 'ni la validación ni el análisis');
  assert.ok(fallos.every((f) => /premium_required/.test(f)));
});

// ── Lo que promete el paywall tiene que caber ──

test('el análisis de postura da los 10 usos que se anuncian, no 4', () => {
  // Lleva UNA imagen, así que se derivaba 'food_scan' y el tope efectivo caía a
  // min(10, 4) = 4. El servidor recortaba en silencio lo que decía la pantalla
  // de pago. La derivación tiene que ESCALAR, no castigar.
  const diez: Llamada[] = Array.from({ length: 10 }, () => ({ feature: 'coach', imagenes: 1 }));
  const { fallos, contadores } = simular(diez, { isPremium: true, esPrueba: false });
  assert.deepEqual(fallos, []);
  assert.equal(contadores.get('coach'), 10);
});

test('la postura no le roba cupo a los escaneos de comida', () => {
  const mezcla: Llamada[] = [
    ...Array.from({ length: 10 }, () => ({ feature: 'coach' as const, imagenes: 1 })),
    ...Array.from({ length: 4 }, () => ({ feature: 'food_scan' as const, imagenes: 1 })),
  ];
  const { fallos } = simular(mezcla, { isPremium: true, esPrueba: false });
  assert.deepEqual(fallos, []);
});

// ── El bypass que la derivación existe para cerrar ──

test('etiquetar imágenes como texto barato NO relaja nada', () => {
  // El ataque original: mandar 2 fotos declarando 'general' (gratis, 5/día)
  // para saltarse el paywall del análisis corporal.
  const r = resolverPolitica({
    headerDeclarado: 'general',
    imagenes: 2,
    isPremium: false,
    esPrueba: false,
  });
  assert.equal(r.feature, 'body_scan');
  assert.equal(r.exigePremium, true, 'tiene que pedir Premium');
});

test('una foto declarada como texto se cobra como escaneo', () => {
  const r = resolverPolitica({
    headerDeclarado: 'notification',
    imagenes: 1,
    isPremium: true,
    esPrueba: false,
  });
  assert.equal(r.feature, 'food_scan');
  assert.equal(r.limite, 4);
});

test('declarar una feature cara con pocas imágenes no la abarata', () => {
  // Declarar 'body_scan' sin imágenes sigue costando el cupo de body_scan.
  const r = resolverPolitica({
    headerDeclarado: 'body_scan',
    imagenes: 0,
    isPremium: true,
    esPrueba: false,
  });
  assert.equal(r.feature, 'body_scan');
  assert.equal(r.limite, 1);
});

test('un header inventado cae en general, no en el más generoso', () => {
  const r = resolverPolitica({
    headerDeclarado: 'barra_libre',
    imagenes: 0,
    isPremium: true,
    esPrueba: false,
  });
  assert.equal(r.feature, 'general');
});

test('sin header tampoco se elige el cupo más grande', () => {
  const r = resolverPolitica({ headerDeclarado: null, imagenes: 0, isPremium: true, esPrueba: false });
  assert.equal(r.feature, 'general');
});

// ── Invariantes que ningún cambio futuro puede romper ──

test('todo tope es un número real', () => {
  // El fallo que ya pasó: un tope undefined llegaba como null a la RPC, y en
  // Postgres `n <= NULL` es NULL, no false. El control fallaba ABIERTO.
  for (const feature of Object.keys(FEATURE_POLICY)) {
    for (const imagenes of [0, 1, 2, 4]) {
      for (const quien of [
        { isPremium: false, esPrueba: false },
        { isPremium: true, esPrueba: false },
        { isPremium: true, esPrueba: true },
      ]) {
        const r = resolverPolitica({ headerDeclarado: feature, imagenes, ...quien });
        assert.ok(
          Number.isFinite(r.limite),
          `${feature} con ${imagenes} imágenes y ${JSON.stringify(quien)} da un tope no numérico`,
        );
        assert.ok(r.limite >= 0, `${feature}: tope negativo`);
      }
    }
  }
});

test('cada feature de la política tiene su rango de costo', () => {
  // Sin rango, rankOf devuelve 0 y la feature nunca escala: una función cara
  // nueva se colaría con el cupo de la barata que se declare.
  for (const feature of Object.keys(FEATURE_POLICY)) {
    assert.ok(
      feature in FEATURE_COST_RANK,
      `${feature} no está en FEATURE_COST_RANK: nunca escalaría`,
    );
  }
});

test('scan_check rankea por encima de food_scan', () => {
  // Si no, validar una foto le robaría el cupo a los escaneos de comida.
  assert.ok(FEATURE_COST_RANK.scan_check > FEATURE_COST_RANK.food_scan);
});

test('combinar dos políticas endurece, nunca relaja', () => {
  const a = FEATURE_POLICY.coach;
  const b = FEATURE_POLICY.food_scan;
  const c = strictestPolicy(a, b);
  assert.equal(c.premiumOnly, a.premiumOnly || b.premiumOnly);
  for (const k of ['freeLimit', 'trialLimit', 'premiumLimit'] as const) {
    assert.equal(c[k], Math.min(a[k], b[k]), `${k} debería ser el mínimo`);
  }
});

test('ninguna feature premium tiene cupo gratis', () => {
  for (const [nombre, p] of Object.entries(FEATURE_POLICY)) {
    if (p.premiumOnly) {
      assert.equal(p.freeLimit, 0, `${nombre} es premium y da ${p.freeLimit} usos gratis`);
    }
  }
});

test('la prueba nunca da más que Premium', () => {
  // Quien no ha pagado nada no puede recibir más que quien paga.
  for (const [nombre, p] of Object.entries(FEATURE_POLICY)) {
    assert.ok(
      p.trialLimit <= p.premiumLimit,
      `${nombre}: la prueba da ${p.trialLimit} y Premium ${p.premiumLimit}`,
    );
  }
});
