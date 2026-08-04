// supabase/functions/sync-premium/index.ts
// ─────────────────────────────────────────────────────────
// RECONCILIACIÓN DE PREMIUM: le pregunta a RevenueCat cuál es la verdad y la
// escribe en user_profiles.is_premium.
//
// POR QUÉ EXISTE
// purchasePlan() y checkPremium() del cliente solo actualizaban el store LOCAL
// (ver syncLocalPremium en lib/purchases.ts). Pero la compuerta de las
// funciones de IA lee `user_profiles.is_premium` en Supabase, que solo escribe
// el webhook rc-webhook. Si el webhook tardaba, se perdía o RevenueCat lo
// reintentaba minutos después, el resultado era el peor posible: la app decía
// "ya eres Premium" y el proxy respondía 402 "Esta función es Premium".
// Alguien acababa de pagar y no recibía lo que pagó.
//
// El webhook sigue siendo la vía normal —es el que reacciona a renovaciones,
// cancelaciones y reembolsos sin que la app esté abierta—. Esto es el camino
// de RESCATE que el cliente puede invocar cuando sabe que algo cambió: justo
// después de comprar y al restaurar compras.
//
// SEGURIDAD
//   • Requiere el JWT del usuario: el app_user_id que se consulta se deriva de
//     auth.getUser(), NUNCA del cuerpo de la petición. Si viniera del cliente,
//     cualquiera podría reconciliar contra la suscripción de otro.
//   • La escritura usa el service role, porque is_premium está revocada para
//     el cliente por diseño.
//   • La clave de RevenueCat es SECRETA y vive solo aquí.
// ─────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * ¿Tiene alguna suscripción activa según RevenueCat?
 * Se mira `entitlements` y, como respaldo, `subscriptions`: si el proyecto aún
 * no tiene entitlement configurado, una suscripción activa igual debe contar.
 */
function tienePremium(subscriber: Record<string, any> | null): boolean {
  if (!subscriber) return false;
  const ahora = Date.now();

  const vigente = (expira: unknown): boolean => {
    // expires_date null = compra no renovable / vitalicia: sigue vigente.
    if (expira == null) return true;
    const t = Date.parse(String(expira));
    return Number.isFinite(t) && t > ahora;
  };

  const ents = subscriber.entitlements ?? {};
  for (const key of Object.keys(ents)) {
    if (vigente(ents[key]?.expires_date)) return true;
  }
  const subs = subscriber.subscriptions ?? {};
  for (const key of Object.keys(subs)) {
    if (vigente(subs[key]?.expires_date)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const rcKey = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!rcKey) {
    // RevenueCat todavía no está configurado (Paso 9 del DEPLOY). Se responde
    // explícito en vez de fingir que se reconcilió: el cliente NO debe tomar
    // esto como "no eres premium".
    return json({ error: 'RevenueCat no configurado en el servidor', code: 'rc_not_configured' }, 503);
  }

  // El usuario se deriva del JWT, nunca del cuerpo.
  const authHeader = req.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: 'No autorizado' }, 401);

  // Consulta a RevenueCat. El app_user_id es el uid de Supabase: así lo
  // configura ensureConfigured() en lib/purchases.ts.
  let subscriber: Record<string, any> | null = null;
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
      { headers: { Authorization: `Bearer ${rcKey}` } }
    );
    if (res.status === 404) {
      // Nunca compró nada: no es un error, es "no premium".
      subscriber = null;
    } else if (!res.ok) {
      // Fail-CLOSED al revés: ante un fallo de RevenueCat NO se degrada a
      // false. Quitarle Premium a quien pagó porque su API tuvo un mal minuto
      // es peor que dejarlo un rato más de lo debido.
      return json({ error: 'RevenueCat no respondió', code: 'rc_unavailable' }, 503);
    } else {
      const body = await res.json();
      subscriber = body?.subscriber ?? null;
    }
  } catch {
    return json({ error: 'RevenueCat no respondió', code: 'rc_unavailable' }, 503);
  }

  const premium = tienePremium(subscriber);

  // Escritura con service role: is_premium está revocada para el cliente.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { error: upErr } = await admin
    .from('user_profiles')
    .update({ is_premium: premium })
    .eq('user_id', user.id);

  if (upErr) return json({ error: 'No se pudo guardar el estado', detail: upErr.message }, 500);

  return json({ ok: true, is_premium: premium });
});
