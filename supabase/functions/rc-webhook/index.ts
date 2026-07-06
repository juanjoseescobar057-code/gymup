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
// ─────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2';

// Eventos que dejan Premium ACTIVO / INACTIVO. CANCELLATION solo apaga la
// renovación: el acceso sigue hasta EXPIRATION (comportamiento estándar).
const ACTIVATE = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION',
  'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE',
]);
const DEACTIVATE = new Set(['EXPIRATION']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // Autenticación del webhook: secreto compartido en el header.
  const secret = Deno.env.get('RC_WEBHOOK_SECRET') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
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
  // app_user_id = user_id de Supabase (así configura la app a RevenueCat).
  const userId: string = event.app_user_id ?? '';

  // UUID válido: ignorar ids anónimos de RevenueCat ($RCAnonymousID:...).
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  if (!isUuid) return json({ ok: true, skipped: 'app_user_id no es un user_id' });

  let isPremium: boolean | null = null;
  if (ACTIVATE.has(type)) isPremium = true;
  else if (DEACTIVATE.has(type)) isPremium = false;
  if (isPremium === null) return json({ ok: true, skipped: `evento ${type} sin acción` });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { error } = await admin
    .from('user_profiles')
    .update({ is_premium: isPremium })
    .eq('user_id', userId);

  if (error) {
    console.error('rc-webhook update error:', error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  console.log(`rc-webhook: ${type} → is_premium=${isPremium} para ${userId}`);
  return json({ ok: true, is_premium: isPremium });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
