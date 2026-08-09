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
const STATE_CHANGING = new Set([...ACTIVATE, ...DEACTIVATE, 'TRANSFER']);

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
  // Visible en logs, no bloquea: útil para distinguir compras de prueba de reales.
  const environment: string = event.environment ?? 'UNKNOWN';

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
    });
    if (error) {
      console.error('rc-webhook apply_rc_event:', error.message);
      return false;
    }
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila?.duplicado) console.log(`rc-webhook: ${lockKey} duplicado, se ignora`);
    else if (fila?.motivo) console.log(`rc-webhook: ${lockKey} -> ${fila.motivo}`);
    else if (fila?.aplicado) console.log(`rc-webhook: ${type} [${environment}] -> is_premium=${isPremium} para ${uid}`);
    return fila?.aplicado === true;
  }

  let handled = false;

  if (type === 'TRANSFER') {
    // Mueve el entitlement de un app_user_id a otro (típico al vincular una
    // cuenta anónima a una cuenta real bajo un id distinto al de la compra).
    const from: string[] = Array.isArray(event.transferred_from) ? event.transferred_from : [];
    const to: string[] = Array.isArray(event.transferred_to) ? event.transferred_to : [];
    // Clave por usuario afectado. Con un solo event_id para varias personas,
    // el cerrojo de idempotencia dejaba a todas menos a una fuera del control
    // de orden — y a su fila sin quedar asociada a nadie en concreto.
    for (const uid of to) handled = (await aplicar(`${eventId}#${uid}`, uid, true, true)) || handled;
    for (const uid of from) handled = (await aplicar(`${eventId}#${uid}`, uid, false, true)) || handled;
  } else {
    const userId: string = event.app_user_id ?? '';
    let isPremium: boolean | null = null;
    if (ACTIVATE.has(type)) isPremium = true;
    else if (DEACTIVATE.has(type)) isPremium = false;
    // Se llama SIEMPRE, aunque el evento no cambie el estado: así queda
    // registrado y un reintento futuro se detecta como duplicado.
    handled = await aplicar(eventId, userId, isPremium, isPremium !== null);
  }

  // El registro del evento ya NO se hace aquí: lo hace apply_rc_event dentro
  // de la misma transacción que la escritura. Insertarlo aparte, después, era
  // justo la ventana por la que dos entregas concurrentes se pisaban.

  return json({ ok: true, handled, type, environment });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
