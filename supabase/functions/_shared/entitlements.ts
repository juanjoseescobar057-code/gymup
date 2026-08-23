// supabase/functions/_shared/entitlements.ts
// ─────────────────────────────────────────────────────────
// Quién tiene Premium según RevenueCat.
//
// Vive aquí y no dentro de cada función por dos motivos:
//
//   1. rc-webhook y sync-premium tienen que responder LO MISMO. Son las dos
//      vías por las que se escribe is_premium; si una concede lo que la otra
//      niega, el estado de una persona depende de cuál llegó última.
//   2. Es lo único de estas funciones que se puede probar de verdad. El resto
//      es Deno.serve, fetch y service role. Esto son datos que entran y un
//      booleano que sale, así que se prueba en el runner de Node como
//      cualquier otro módulo — ver __tests__/entitlementsRC.test.ts.
//
// NADA de este archivo toca Deno, fetch ni variables de entorno: todo entra
// por parámetro. Esa es la condición para que sea probable.
// ─────────────────────────────────────────────────────────

/** El entitlement que da Premium. Es el que mira lib/purchases.ts. */
export const ENTITLEMENT_POR_DEFECTO = 'premium';

/**
 * La lista de entitlements que conceden Premium.
 *
 * Se puede sobrescribir con el secreto RC_ENTITLEMENT_IDS por si en el panel
 * de RevenueCat el entitlement se llamó de otra forma. Un valor vacío o solo
 * comas NO deja la lista vacía: cae al valor por defecto. Una lista vacía
 * significaría "nadie tiene Premium", y borrar el acceso de todos los que
 * pagan por una variable de entorno mal escrita no puede ser un resultado
 * posible.
 */
export function listaDeEntitlements(valorDelEntorno: string | null | undefined): string[] {
  const ids = (valorDelEntorno ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : [ENTITLEMENT_POR_DEFECTO];
}

/** Una entrada de entitlement o de suscripción tal como la manda RevenueCat. */
type Entrada = { expires_date?: unknown } | null | undefined;

/**
 * ¿Sigue vigente esta entrada?
 *
 * Recibe la ENTRADA ENTERA a propósito, no la fecha. El código anterior hacía
 * `vigente(ents[key]?.expires_date)` y comprobaba `if (expira == null) return
 * true`: con una entrada nula, el `?.` daba undefined, `undefined == null` era
 * true, y la función concedía Premium por un dato corrupto. Fallaba abierto.
 */
export function entradaVigente(entrada: Entrada, ahoraMs: number): boolean {
  if (entrada == null || typeof entrada !== 'object') return false;
  const expira = (entrada as Record<string, unknown>).expires_date;
  // expires_date null = compra no renovable o vitalicia: sigue vigente.
  if (expira == null) return true;
  const t = Date.parse(String(expira));
  return Number.isFinite(t) && t > ahoraMs;
}

export type VeredictoPremium = {
  premium: boolean;
  /** Qué lo concedió, para el log. null si no se concedió. */
  motivo: string | null;
  /** Entitlements activos que NO reconocemos. Casi siempre un nombre mal puesto. */
  noReconocidos: string[];
  /**
   * ¿Está dentro de la prueba gratis?
   *
   *   true  → sí. Le toca el presupuesto de prueba.
   *   false → paga (o pagó). Presupuesto de premium.
   *   null  → RevenueCat no lo dice en esta respuesta: no se toca is_trial.
   *
   * Sin esto, sync-premium escribía is_premium y NUNCA is_trial. Y sync-premium
   * es el camino de rescate que corre justo después de comprar, así que si el
   * webhook llegaba tarde —que es exactamente el caso para el que existe— la
   * fila quedaba con is_premium=true e is_trial=false: alguien en su primer día
   * de prueba entraba con el presupuesto de OpenAI de quien paga.
   *
   * Solo 'trial' cuenta. 'intro' es un precio introductorio: paga menos, pero
   * paga.
   */
  esPrueba: boolean | null;
};

/**
 * El period_type del producto que concede el entitlement.
 *
 * RevenueCat pone el period_type en la SUSCRIPCIÓN, no en el entitlement: hay
 * que saltar por product_identifier para encontrarlo.
 */
function periodoDe(
  subscriber: Record<string, any>,
  productId: unknown,
): boolean | null {
  if (typeof productId !== 'string') return null;
  const sub = subscriber?.subscriptions?.[productId];
  const periodo = sub?.period_type;
  if (typeof periodo !== 'string') return null;
  return periodo.toLowerCase() === 'trial';
}

/**
 * El veredicto sobre un `subscriber` de la API v1 de RevenueCat.
 *
 * Solo cuenta un entitlement de la lista y vigente. Antes valía CUALQUIER
 * entitlement y, de respaldo, CUALQUIER suscripción: el día que exista un
 * segundo producto —un paquete de escaneos, una promo, un tier más barato—
 * comprarlo daría Premium completo.
 */
export function veredictoPremium(
  subscriber: Record<string, any> | null | undefined,
  permitidos: string[],
  ahoraMs: number,
): VeredictoPremium {
  if (!subscriber) return { premium: false, motivo: null, noReconocidos: [], esPrueba: null };

  const ents: Record<string, Entrada> = subscriber.entitlements ?? {};
  const claves = Object.keys(ents);

  for (const key of claves) {
    if (permitidos.includes(key) && entradaVigente(ents[key], ahoraMs)) {
      return {
        premium: true,
        motivo: `entitlement:${key}`,
        noReconocidos: [],
        esPrueba: periodoDe(subscriber, (ents[key] as Record<string, unknown>)?.product_identifier),
      };
    }
  }

  // Un entitlement activo con un nombre inesperado casi siempre es un error de
  // configuración, no un fraude. Se devuelve para dejarlo dicho en el log con
  // el nombre exacto: así se arregla en un minuto y no en una tarde.
  const noReconocidos = claves.filter(
    (k) => !permitidos.includes(k) && entradaVigente(ents[k], ahoraMs),
  );

  // Respaldo para un proyecto SIN entitlements configurados: ahí una
  // suscripción activa sí tiene que contar, o nadie podría comprar nunca. Solo
  // se usa cuando no hay NINGÚN entitlement. Antes corría siempre, y mientras
  // corriera siempre cualquier lista blanca era decorativa.
  if (claves.length === 0) {
    const subs: Record<string, Entrada> = subscriber.subscriptions ?? {};
    for (const key of Object.keys(subs)) {
      if (entradaVigente(subs[key], ahoraMs)) {
        return {
          premium: true,
          motivo: `suscripcion:${key}`,
          noReconocidos,
          esPrueba: periodoDe(subscriber, key),
        };
      }
    }
  }

  // Sin Premium no hay prueba que marcar: false, no null. Dejarlo en null haría
  // que is_trial conservara un true viejo de una prueba ya expirada, y con él el
  // presupuesto de prueba en vez del de premium cuando volviera a comprar.
  return { premium: false, motivo: null, noReconocidos, esPrueba: false };
}

/**
 * ¿Este evento de webhook afecta a un entitlement nuestro?
 *
 *   true  → sí, aplícalo.
 *   false → es de otro producto: regístralo (idempotencia) sin tocar is_premium.
 *   null  → el evento no menciona entitlements. Aplícalo como siempre.
 *
 * El `null` NO puede tratarse como `false`. RevenueCat omite el campo en
 * algunos tipos de evento, y negarle Premium a quien acaba de pagar por un
 * campo ausente es el peor resultado que puede dar este archivo — peor que
 * conceder de más, que se corrige en la siguiente reconciliación.
 */
export function afectaANuestroEntitlement(
  event: Record<string, any> | null | undefined,
  permitidos: string[],
): boolean | null {
  const ids: string[] = Array.isArray(event?.entitlement_ids)
    ? event!.entitlement_ids.filter((x: unknown): x is string => typeof x === 'string')
    : typeof event?.entitlement_id === 'string'
      ? [event!.entitlement_id]
      : [];
  if (ids.length === 0) return null;
  return ids.some((id) => permitidos.includes(id));
}
