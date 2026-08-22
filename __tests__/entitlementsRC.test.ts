// __tests__/entitlementsRC.test.ts
// ─────────────────────────────────────────────────────────
// Este módulo decide quién tiene Premium. Se equivoca en dos direcciones y las
// dos duelen, pero no igual:
//
//   • Conceder de más: alguien usa la IA sin pagar. Se corrige solo en la
//     siguiente reconciliación y cuesta unos centavos.
//   • Negar de más: alguien que PAGÓ abre la app y no tiene lo que compró.
//     Eso no se corrige solo, y acaba en reembolso y en reseña de una estrella.
//
// Por eso hay tantos tests de "no niegues" como de "no concedas". El código
// anterior solo fallaba en la primera dirección, pero al arreglarlo es fácil
// pasarse a la segunda, que es peor.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listaDeEntitlements,
  entradaVigente,
  veredictoPremium,
  afectaANuestroEntitlement,
  ENTITLEMENT_POR_DEFECTO,
} from '../supabase/functions/_shared/entitlements';

const AHORA = Date.parse('2026-08-22T12:00:00Z');
const FUTURO = '2026-09-22T12:00:00Z';
const PASADO = '2026-07-22T12:00:00Z';
const LISTA = ['premium'];

// ── La lista ──

test('sin variable de entorno, la lista es el entitlement de la app', () => {
  assert.deepEqual(listaDeEntitlements(undefined), ['premium']);
  assert.equal(ENTITLEMENT_POR_DEFECTO, 'premium');
});

test('una variable vacía NO deja la lista vacía', () => {
  // Una lista vacía significa "nadie tiene Premium". Que un secreto mal escrito
  // le quite el acceso a todos los que pagan no puede ser un resultado posible.
  for (const basura of ['', '   ', ',,,', ' , , ']) {
    assert.deepEqual(listaDeEntitlements(basura), ['premium'], `con ${JSON.stringify(basura)}`);
  }
});

test('se puede renombrar el entitlement sin tocar el código', () => {
  assert.deepEqual(listaDeEntitlements('pro'), ['pro']);
  assert.deepEqual(listaDeEntitlements('premium, pro_anual '), ['premium', 'pro_anual']);
});

// ── Vigencia ──

test('una fecha futura está vigente y una pasada no', () => {
  assert.equal(entradaVigente({ expires_date: FUTURO }, AHORA), true);
  assert.equal(entradaVigente({ expires_date: PASADO }, AHORA), false);
});

test('sin fecha de expiración es vitalicia', () => {
  // Compra no renovable: RevenueCat manda expires_date null y sigue vigente.
  assert.equal(entradaVigente({ expires_date: null }, AHORA), true);
  assert.equal(entradaVigente({}, AHORA), true);
});

test('una entrada nula NO concede nada', () => {
  // EL BUG ORIGINAL. `ents[key]?.expires_date` daba undefined con una entrada
  // nula, `undefined == null` era true, y se concedía Premium por basura.
  assert.equal(entradaVigente(null, AHORA), false);
  assert.equal(entradaVigente(undefined, AHORA), false);
  assert.equal(entradaVigente('premium' as unknown as null, AHORA), false);
});

test('una fecha ilegible no concede', () => {
  assert.equal(entradaVigente({ expires_date: 'ayer por la tarde' }, AHORA), false);
});

// ── El veredicto: no conceder de más ──

const sub = (s: Record<string, unknown>) => veredictoPremium(s, LISTA, AHORA);

test('el entitlement correcto y vigente da Premium', () => {
  const r = sub({ entitlements: { premium: { expires_date: FUTURO } } });
  assert.equal(r.premium, true);
  assert.equal(r.motivo, 'entitlement:premium');
});

test('un entitlement AJENO no da Premium', () => {
  // El caso que abre el agujero: el día que exista un paquete de escaneos o una
  // promo, comprarlo no puede regalar la app entera.
  const r = sub({ entitlements: { paquete_escaneos: { expires_date: FUTURO } } });
  assert.equal(r.premium, false);
  assert.deepEqual(r.noReconocidos, ['paquete_escaneos'], 'y se nombra, para poder arreglarlo');
});

test('el entitlement correcto pero EXPIRADO no da Premium', () => {
  assert.equal(sub({ entitlements: { premium: { expires_date: PASADO } } }).premium, false);
});

test('una suscripción activa NO cuela si hay entitlements configurados', () => {
  // Este era el respaldo que hacía decorativa cualquier lista: corría siempre.
  const r = sub({
    entitlements: { otra_cosa: { expires_date: FUTURO } },
    subscriptions: { 'rityvo_mensual:otro-plan': { expires_date: FUTURO } },
  });
  assert.equal(r.premium, false);
});

test('sin subscriber no hay Premium', () => {
  assert.equal(veredictoPremium(null, LISTA, AHORA).premium, false);
  assert.equal(veredictoPremium(undefined, LISTA, AHORA).premium, false);
});

test('un subscriber sin nada no da Premium', () => {
  assert.equal(sub({}).premium, false);
  assert.equal(sub({ entitlements: {}, subscriptions: {} }).premium, false);
});

// ── El veredicto: no negar de más ──

test('sin entitlements configurados, una suscripción activa SÍ cuenta', () => {
  // Si no, en un proyecto recién creado nadie podría comprar nunca.
  const r = sub({ entitlements: {}, subscriptions: { rityvo_mensual: { expires_date: FUTURO } } });
  assert.equal(r.premium, true);
  assert.equal(r.motivo, 'suscripcion:rityvo_mensual');
});

test('una compra vitalicia sigue contando', () => {
  assert.equal(sub({ entitlements: { premium: { expires_date: null } } }).premium, true);
});

test('con el entitlement renombrado por entorno, quien pagó conserva Premium', () => {
  const r = veredictoPremium(
    { entitlements: { pro: { expires_date: FUTURO } } },
    listaDeEntitlements('pro'),
    AHORA,
  );
  assert.equal(r.premium, true);
});

test('entre varios entitlements, basta con que el nuestro esté vigente', () => {
  const r = sub({
    entitlements: {
      promo_vieja: { expires_date: PASADO },
      premium: { expires_date: FUTURO },
    },
  });
  assert.equal(r.premium, true);
});

// ── El webhook ──

test('un evento del entitlement correcto se aplica', () => {
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: ['premium'] }, LISTA), true);
});

test('un evento de otro entitlement NO cambia el estado', () => {
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: ['paquete_escaneos'] }, LISTA), false);
});

test('sin entitlement_ids se aplica como siempre, NO se niega', () => {
  // null y false son cosas distintas a propósito. RevenueCat omite el campo en
  // algunos tipos de evento; tratar la ausencia como "no es nuestro" le quitaría
  // Premium a quien acaba de pagar.
  assert.equal(afectaANuestroEntitlement({ type: 'RENEWAL' }, LISTA), null);
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: [] }, LISTA), null);
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: null }, LISTA), null);
  assert.equal(afectaANuestroEntitlement(null, LISTA), null);
});

test('se acepta el campo viejo en singular', () => {
  // entitlement_id (deprecado) sigue llegando en integraciones antiguas.
  assert.equal(afectaANuestroEntitlement({ entitlement_id: 'premium' }, LISTA), true);
  assert.equal(afectaANuestroEntitlement({ entitlement_id: 'otro' }, LISTA), false);
});

test('si el evento toca varios entitlements y uno es el nuestro, cuenta', () => {
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: ['otro', 'premium'] }, LISTA), true);
});

test('la basura dentro del array no rompe la decisión', () => {
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: [null, 42, 'premium'] }, LISTA), true);
  assert.equal(afectaANuestroEntitlement({ entitlement_ids: [null, 42] }, LISTA), null);
});
