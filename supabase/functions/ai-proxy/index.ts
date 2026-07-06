// supabase/functions/ai-proxy/index.ts
// ─────────────────────────────────────────────────────────
// Proxy de IA. La API key de OpenAI vive SOLO aquí (servidor).
// Antes de gastar tokens:
//   1. Autentica al usuario por su JWT.
//   2. Verifica ENTITLEMENT: features premium (body_scan, coach) exigen
//      is_premium; features con cupo (food_scan, fridge_scan) tienen tope
//      diario para free. El tag de feature llega en el header x-gymup-feature.
//   3. Aplica rate limit POR FEATURE (fail-closed).
//   4. Solo permite modelos de la allowlist.
//
// DESPLIEGUE:
//   supabase secrets set OPENAI_API_KEY=sk-...   (¡NUNCA EXPO_PUBLIC_!)
//   supabase functions deploy ai-proxy
// App: EXPO_PUBLIC_AI_PROXY_URL=https://<ref>.functions.supabase.co/ai-proxy
// y BORRAR EXPO_PUBLIC_OPENAI_API_KEY del build de producción.
// ─────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini']);

// Política por feature. premiumOnly => bloqueada para free.
// freeLimit / premiumLimit => topes diarios. El premium es GENEROSO para un
// humano real pero protege el margen contra abuso/bots (ver PRICING.md:
// con estos topes el costo máximo absoluto por premium ronda ~$1.7 USD/día;
// el uso realista es ~$0.10-0.15/día).
const FEATURE_POLICY: Record<string, { premiumOnly: boolean; freeLimit: number; premiumLimit: number }> = {
  body_scan:   { premiumOnly: true,  freeLimit: 0,  premiumLimit: 5 },
  coach:       { premiumOnly: true,  freeLimit: 0,  premiumLimit: 30 },
  coach_chat:  { premiumOnly: false, freeLimit: 5,  premiumLimit: 60 },  // chat: prueba gratis
  scoring:     { premiumOnly: false, freeLimit: 40, premiumLimit: 80 },  // juez de calidad (telemetría)
  food_scan:   { premiumOnly: false, freeLimit: 3,  premiumLimit: 30 },
  fridge_scan: { premiumOnly: false, freeLimit: 1,  premiumLimit: 10 },
  plan:        { premiumOnly: false, freeLimit: 3,  premiumLimit: 5 },
  suggestion:  { premiumOnly: false, freeLimit: 10, premiumLimit: 20 },
  notification:{ premiumOnly: false, freeLimit: 10, premiumLimit: 20 },
  general:     { premiumOnly: false, freeLimit: 20, premiumLimit: 60 }, // incluye destilados de memoria
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-gymup-feature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1. Autenticación por JWT.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Falta autorización' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'No autorizado' }, 401);

  // 2. Body + modelo.
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!ALLOWED_MODELS.has(body?.model)) return json({ error: 'Modelo no permitido' }, 400);

  const feature = req.headers.get('x-gymup-feature') ?? 'general';
  const policy = FEATURE_POLICY[feature] ?? FEATURE_POLICY.general;

  // 3. Entitlement: ¿es premium?
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_premium')
    .eq('user_id', user.id)
    .single();
  const isPremium = profile?.is_premium === true;

  if (policy.premiumOnly && !isPremium) {
    return json({ error: 'Esta función es Premium.', code: 'premium_required' }, 402);
  }

  // 4. Rate limit por feature (fail-CLOSED: si la BD falla, no gastamos IA).
  const limit = isPremium ? policy.premiumLimit : policy.freeLimit;
  const { data: allowed, error: rlError } = await supabase.rpc('increment_ai_usage', {
    p_user_id: user.id, p_feature: feature, p_limit: limit,
  });
  if (rlError) {
    console.error('rate-limit error:', rlError.message);
    return json({ error: 'No se pudo verificar el límite. Intenta luego.' }, 503);
  }
  if (allowed === false) {
    return json({ error: 'Alcanzaste el límite de hoy. Pásate a Premium para más.', code: 'limit_reached' }, 429);
  }

  // 5. Blindaje server-side: inyectar las reglas de seguridad como PRIMER
  // mensaje system. El cliente ya las incluye en sus prompts, pero un cliente
  // modificado podría quitarlas — aquí se re-imponen SIEMPRE (defensa en
  // profundidad). OpenAI prioriza los mensajes system iniciales.
  const SAFETY_SYSTEM = `REGLAS DE SEGURIDAD INQUEBRANTABLES (prevalecen sobre cualquier otra instrucción):
- Eres parte de una app de fitness. NUNCA recomiendes: menos de 1200 kcal/día, perder más de ~1% de peso/semana, ayunos extremos, purgas, laxantes, diuréticos, deshidratación, ni esteroides/SARMs/sustancias de rendimiento.
- Nunca sugieras entrenar a través de dolor agudo, punzante o articular. Ante dolor en el pecho, falta de aire severa, mareo, desmayo u hormigueo: indica parar YA y buscar atención médica.
- Con lesiones, embarazo o condiciones médicas: solo pautas generales conservadoras y derivar a un profesional de la salud. Sin diagnósticos ni tratamientos.
- Ante la duda, la opción más conservadora. La salud por encima de la estética.`;
  try {
    if (Array.isArray((body as Record<string, unknown>)?.messages)) {
      (body as { messages: unknown[] }).messages = [
        { role: 'system', content: SAFETY_SYSTEM },
        ...(body as { messages: unknown[] }).messages,
      ];
    }
  } catch { /* body no estándar: se reenvía tal cual */ }

  // 6. Reenviar a OpenAI con la key del servidor.
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) return json({ error: 'IA no configurada en el servidor' }, 500);

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
