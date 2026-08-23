// supabase/functions/rc-webhook/index.ts
// ─────────────────────────────────────────────────────────
// Webhook de RevenueCat → única vía de escritura de user_profiles.is_premium.
//
// La tienda cobra → RevenueCat procesa el recibo → dispara este webhook →
// aquí se activa/desactiva Premium con service role (el cliente tiene el
// UPDATE de esa columna revocado a nivel SQL).
//
// Configurar:
//   1. supabase secrets set RC_WEBHOOK_SECRET=<valor-largo-aleatorio>
//   2. supabase functions deploy rc-webhook --no-verify-jwt
//   3. En RevenueCat → Project → Integrations → Webhooks:
//      URL:    https://<proyecto>.supabase.co/functions/v1/rc-webhook
//      Header: Authorization: Bearer <RC_WEBHOOK_SECRET>
//   (El app_user_id de RevenueCat ES el user_id de Supabase — la app llama
//    Purchases.configure con appUserID = session.user.id.)
//
// Robustez (auditoría 2026-07, 2 pasadas):
//   • Idempotencia: RevenueCat entrega "at-least-once" con reintentos —
//     un event.id repetido se ignora (tabla rc_webhook_events).
//   • Orden: un evento más viejo que el ÚLTIMO EVENTO QUE CAMBIÓ is_premium
//     para ese usuario se descarta (evita "flapping"). Comparar contra
//     eventos de CUALQUIER tipo sería un bug: un CANCELLATION o
//     BILLING_ISSUE más reciente (que no tocan is_premium) haría descartar
//     por error una RENEWAL/EXPIRATION legítima entregada fuera de orden.
//   • TRANSFER: mueve el entitlement de transferred_from → transferred_to
//     explícitamente (no encaja en el modelo genérico activar/desactivar).
//   • Comparación del secreto en tiempo constante (evita canal lateral de timing).
// ─────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2';
import { listaDeEntitlements, afectaANuestroEntitlement } from '../_shared/entitlements.ts';

// Eventos que dejan Premium ACTIVO / INACTIVO. CANCELLATION solo apaga la
// renovación: el acceso sigue hasta EXPIRATION (comportamiento estándar).
// BILLING_ISSUE tampoco desactiva de inmediato (RevenueCat reintenta el cobro).
// TEMPORARY_ENTITLEMENT_GRANT: RevenueCat lo concede (≤24h) durante una
// interrupción de la tienda; como is_premium se lee server-side (no desde
// el SDK), sin esto el usuario perdería Premium injustamente en esa ventana.
// REFUND_REVERSED: una devolución disputada y revertida reactiva el acceso.
const ACTIVATE = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION',
  'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED',
]);
const DEACTIVATE = new Set(['EXPIRATION']);
// Únicamente estos tipos deben participar en el guardián de "orden": son los
// que cambian is_premium. Comparar contra el último evento de CUALQUIER tipo
// (incluidos los no manejados) descartaría por error una activación/
// desactivación legítima entregada fuera de orden.
// STATE_CHANGING se eliminó: estaba definida y NO LA USABA NADIE, mientras
// apply_rc_event llevaba su propia lista escrita a mano que además no coincidía
// (al SQL le faltaban NON_RENEWING_PURCHASE, TEMPORARY_ENTITLEMENT_GRANT y
// REFUND_REVERSED, y le sobraba SUBSCRIPTION_PAUSED). Ahora el dato viaja: este
// archivo decide si el evento cambia el estado y lo manda en p_state_changing,
// que apply_rc_event guarda en la columna del mismo nombre y usa para el control
// de orden. Una lista, en un sitio.

// La lista y la decisión viven en _shared/entitlements.ts, compartidas con
// sync-premium: son las dos vías que escriben is_premium y tienen que
// responder lo mismo. Antes CUALQUIER compra del proyecto activaba Premium;
// con un solo producto daba igual, en cuanto exista un segundo —un paquete de
// escaneos, una promo, un tier más barato— comprarlo daría Premium completo.
const ENTITLEMENTS_PREMIUM = listaDeEntitlements(Deno.env.get('RC_ENTITLEMENT_IDS'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comparación en tiempo constante (evita filtrar el secreto por timing). */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // Autenticación del webhook: secreto compartido en el header.
  const secret = Deno.env.get('RC_WEBHOOK_SECRET') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const event = payload?.event ?? {};
  const type: string = event.type ?? '';
  const eventId: string = event.id ?? '';
  const eventTsMs: number = Number(event.event_timestamp_ms) || Date.now();
  const environment: string = event.environment ?? 'UNKNOWN';

  // EVENTOS DE SANDBOX. Hoy se aceptan, porque la app está en pruebas y el
  // sandbox de RevenueCat es exactamente lo que hay que ejercitar antes de
  // cobrar de verdad.
  //
  // ANTES DE ABRIR AL PÚBLICO hay que poner el secreto RC_SOLO_PRODUCCION=true:
  // a partir de ahí un evento de sandbox se registra y NO concede Premium. Sin
  // eso, una compra de sandbox —que solo necesita una cuenta de tester— vale lo
  // mismo que una real. Está en docs/RELEASE_GATES.md como paso de lanzamiento.
  //
  // Se responde 200 igual: el evento se procesó correctamente y la decisión fue
  // no aplicarlo. Un 5xx haría que RevenueCat lo reintentara para siempre.
  const soloProduccion = Deno.env.get('RC_SOLO_PRODUCCION') === 'true';
  const esSandbox = environment.toUpperCase() === 'SANDBOX';
  if (soloProduccion && esSandbox) {
    console.log(`rc-webhook: ${type} de SANDBOX ignorado (RC_SOLO_PRODUCCION=true)`);
    return json({ ok: true, handled: false, type, environment, motivo: 'sandbox' });
  }
  if (esSandbox) {
    console.log(`rc-webhook: ${type} de SANDBOX aplicado. Pon RC_SOLO_PRODUCCION=true antes de abrir al público.`);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  /**
   * Aplica el evento en UNA transacción del servidor (apply_rc_event).
   *
   * Antes esto eran cuatro operaciones sueltas desde aquí: comprobar si el
   * evento ya se procesó, leer el último evento de estado, actualizar
   * is_premium y registrar el evento. Entre cualquiera de esas cabe otra
   * entrega concurrente —RevenueCat reintenta las fallidas— y el estado
   * premium podía acabar escrito por el evento equivocado.
   *
   * El TRANSFER recibe su propia clave por usuario afectado (event_id#uid):
   * un solo event_id para varias personas dejaba a todas menos a una fuera
   * del control de orden, porque el cerrojo de idempotencia es por event_id.
   */
  // ¿Está esta persona dentro de los 7 días gratis?
  //
  // Sin esto, quien prueba es indistinguible de quien paga: RevenueCat concede
  // el entitlement desde el primer día de la prueba, así que is_premium ya es
  // true. El proxy usaría con él los topes y el presupuesto de un cliente que
  // paga ~$5 al mes, cuando puede cancelar el día 7 sin pagar nada — y abrir
  // otra prueba solo cuesta otra cuenta de Google.
  //
  // Solo TRIAL cuenta como prueba. INTRO es un precio introductorio: paga
  // menos, pero paga, así que va con presupuesto de premium.
  const esPeriodoDePrueba: boolean | null =
    typeof event.period_type === 'string' ? event.period_type === 'TRIAL' : null;

  // Si CUALQUIER llamada a la RPC falla, hay que devolver 5xx para que
  // RevenueCat reintente. Se acumula en vez de devolverse porque el TRANSFER
  // hace varias llamadas y un `||` sobre el resultado enmascararía la que falló.
  let huboError = false;

  async function aplicar(
    lockKey: string,
    userId: string | null,
    isPremium: boolean | null,
    stateChanging: boolean,
  ): Promise<boolean> {
    const uid = userId && UUID_RE.test(userId) ? userId : null; // ids anónimos de RevenueCat
    const { data, error } = await admin.rpc('apply_rc_event', {
      p_event_id: lockKey,
      p_user_id: uid,
      p_event_type: type,
      p_event_ts_ms: eventTsMs,
      p_environment: environment,
      p_is_premium: isPremium,
      p_state_changing: stateChanging,
      p_is_trial: esPeriodoDePrueba,
    });
    if (error) {
      // Marca de fallo REAL, distinta de "no cambió el estado". Antes las dos
      // devolvían false y el webhook contestaba 200 igual: RevenueCat daba el
      // evento por entregado y no lo reintentaba nunca. Una compra o una
      // renovación podían perderse porque la base tuvo un mal segundo.
      console.error('rc-webhook apply_rc_event:', error.message);
      huboError = true;
      return false;
    }
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila?.duplicado) console.log(`rc-webhook: ${lockKey} duplicado, se ignora`);
    else if (fila?.motivo) console.log(`rc-webhook: ${lockKey} -> ${fila.motivo}`);
    else if (fila?.aplicado) console.log(`rc-webhook: ${type} [${environment}] -> is_premium=${isPremium} para ${uid}`);
    return fila?.aplicado === true;
  }

  // ¿Es un entitlement nuestro? Se calcula una vez y vale para las dos ramas.
  const nuestro = afectaANuestroEntitlement(event, ENTITLEMENTS_PREMIUM);
  if (nuestro === false) {
    console.log(
      `rc-webhook: ${type} de entitlements ajenos (${JSON.stringify(event.entitlement_ids ?? event.entitlement_id)}); ` +
      `se registra sin tocar is_premium. Esperados: [${ENTITLEMENTS_PREMIUM.join(', ')}]`,
    );
  } else if (nuestro === null) {
    console.log(`rc-webhook: ${type} sin entitlement_ids; se aplica por tipo de evento.`);
  }
  // Solo un entitlement RECONOCIDO cambia el estado. Con null se sigue como
  // siempre: el campo falta, no contradice.
  const puedeCambiarEstado = nuestro !== false;

  let handled = false;

  if (type === 'TRANSFER') {
    // Mueve el entitlement de un app_user_id a otro (típico al vincular una
    // cuenta anónima a una cuenta real bajo un id distinto al de la compra).
    const from: string[] = Array.isArray(event.transferred_from) ? event.transferred_from : [];
    const to: string[] = Array.isArray(event.transferred_to) ? event.transferred_to : [];
    // Clave por usuario afectado. Con un solo event_id para varias personas,
    // el cerrojo de idempotencia dejaba a todas menos a una fuera del control
    // de orden — y a su fila sin quedar asociada a nadie en concreto.
    for (const uid of to) handled = (await aplicar(`${eventId}#${uid}`, uid, puedeCambiarEstado ? true : null, puedeCambiarEstado)) || handled;
    for (const uid of from) handled = (await aplicar(`${eventId}#${uid}`, uid, puedeCambiarEstado ? false : null, puedeCambiarEstado)) || handled;
  } else {
    const userId: string = event.app_user_id ?? '';
    let isPremium: boolean | null = null;
    if (puedeCambiarEstado) {
      if (ACTIVATE.has(type)) isPremium = true;
      else if (DEACTIVATE.has(type)) isPremium = false;
    }
    // Se llama SIEMPRE, aunque el evento no cambie el estado: así queda
    // registrado y un reintento futuro se detecta como duplicado.
    handled = await aplicar(eventId, userId, isPremium, isPremium !== null);
  }

  // El registro del evento ya NO se hace aquí: lo hace apply_rc_event dentro
  // de la misma transacción que la escritura. Insertarlo aparte, después, era
  // justo la ventana por la que dos entregas concurrentes se pisaban.

  // 500 SOLO si la RPC falló. Un evento no aplicado por duplicado, por llegar
  // fuera de orden o por ser de otro entitlement es un 200 legítimo: se procesó
  // correctamente y la decisión fue no cambiar nada. Devolver 500 ahí haría que
  // RevenueCat reintentara para siempre algo que ya está bien.
  if (huboError) {
    return json({ ok: false, handled, type, environment, retry: true }, 500);
  }
  return json({ ok: true, handled, type, environment });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
