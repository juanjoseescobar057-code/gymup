// supabase/functions/ai-proxy/index.ts
// ─────────────────────────────────────────────────────────
// Proxy de IA. La API key de OpenAI vive SOLO aquí (servidor).
// Antes de gastar tokens:
//   1. Autentica al usuario por su JWT.
//   2. VALIDA EL PAYLOAD: modelo de la allowlist, nº de mensajes, caracteres de
//      texto, nº de imágenes, techo de max_tokens y campos que la app nunca
//      manda (tools/functions/tool_choice/n/stream).
//   3. Decide la política EFECTIVA. El header x-gymup-feature es una DECLARACIÓN
//      del cliente, no una verdad: el servidor deriva un piso de política mirando
//      el payload real (cuántas imágenes trae) y aplica la MÁS ESTRICTA de las
//      dos. El cliente puede endurecer su propia política, nunca relajarla.
//   4. Verifica ENTITLEMENT: las features premium (body_scan, coach) exigen
//      is_premium.
//   5. Aplica rate limit POR FEATURE EFECTIVA (fail-closed).
//   6. Re-inyecta las reglas de seguridad como primer mensaje system.
//
// LÍMITE CONOCIDO (siguiente paso, NO implementado aquí): los prompts siguen
// viviendo en el cliente, así que un cliente modificado puede pedirle a gpt-4o
// cosas distintas dentro de las reglas de seguridad y del cupo que le toque.
// Cerrarlo del todo exige mover los prompts al servidor y exponer operaciones
// explícitas (POST /body-scan, /food-scan, /coach…), con lo que la feature deja
// de ser un dato del cliente. Lo de aquí cierra el bypass económico (paywall y
// cuota) sin reescribir todos los prompts.
//
// DESPLIEGUE:
//   supabase secrets set OPENAI_API_KEY=sk-...   (¡NUNCA EXPO_PUBLIC_!)
//   supabase functions deploy ai-proxy
// App: EXPO_PUBLIC_AI_PROXY_URL=https://<ref>.functions.supabase.co/ai-proxy
// y BORRAR EXPO_PUBLIC_OPENAI_API_KEY del build de producción.
// ─────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini']);

type FeaturePolicy = { premiumOnly: boolean; freeLimit: number; premiumLimit: number };

// Política por feature. premiumOnly => bloqueada para free.
// freeLimit / premiumLimit => topes diarios. El premium es GENEROSO para un
// humano real pero protege el margen contra abuso/bots (ver PRICING.md:
// con estos topes el costo máximo absoluto por premium ronda ~$1.7 USD/día;
// el uso realista es ~$0.10-0.15/día).
const FEATURE_POLICY: Record<string, FeaturePolicy> = {
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

// Ranking de COSTO por feature (mayor = más cara = más restrictiva). Se usa
// cuando lo que declara el cliente y lo que se deriva del payload no coinciden:
// el consumo se registra bajo la MÁS CARA de las dos. Si no, un body_scan
// disfrazado de 'general' gastaría del cupo equivocado.
const FEATURE_COST_RANK: Record<string, number> = {
  body_scan:   100, // hasta 3 fotos en detail:high
  fridge_scan:  80, // 1 foto high + 2000 tokens de salida
  coach:        70, // 1 foto high (análisis de postura)
  food_scan:    60, // 1 foto high, salida corta
  coach_chat:   40,
  plan:         30,
  suggestion:   20,
  notification: 20,
  scoring:      10,
  general:       0,
};

// Topes duros del payload. El más pesado que manda la app real es el análisis
// corporal: 3 imágenes y ~4k caracteres de texto; todo lo demás cabe de sobra.
const MAX_MESSAGES = 40;
const MAX_TEXT_CHARS = 120_000;
const MAX_IMAGES = 4;
const MAX_OUTPUT_TOKENS = 4096;

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

  // 2. Body + modelo + validación DURA del payload (antes de gastar nada).
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!ALLOWED_MODELS.has(body?.model)) return json({ error: 'Modelo no permitido' }, 400);

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return json({ error: `El campo messages debe ser un array de 1 a ${MAX_MESSAGES} elementos.` }, 400);
  }

  // Campos que la app NUNCA manda y que abren superficie de ataque o de costo
  // impredecible: tools/functions dejarían al modelo invocar cosas, n multiplica
  // el gasto por respuesta. 'stream' se rechaza porque este proxy devuelve el
  // cuerpo completo; si algún día el cliente lo necesita hay que reenviar el
  // stream de verdad, no basta con dejar pasar el flag.
  if (body.tools !== undefined || body.functions !== undefined || body.tool_choice !== undefined) {
    return json({ error: 'Campos no permitidos: tools, functions, tool_choice.' }, 400);
  }
  if (Number(body.n) > 1) return json({ error: 'Solo se permite una respuesta por petición (n = 1).' }, 400);
  if (body.stream === true) return json({ error: 'El proxy no soporta streaming.' }, 400);

  const { images, textChars } = inspectMessages(messages);
  if (textChars > MAX_TEXT_CHARS) {
    return json({
      error: `Petición demasiado larga: ${textChars} caracteres de texto (máximo ${MAX_TEXT_CHARS}). Reduce el contexto.`,
      code: 'payload_too_large',
    }, 413);
  }
  if (images > MAX_IMAGES) {
    return json({ error: `Máximo ${MAX_IMAGES} imágenes por petición.` }, 400);
  }
  // El techo de salida se ACOTA en vez de rechazarse: la app pide entre 100 y
  // 2000, y un valor absurdo (o basura no numérica) solo debe costar el tope.
  if (body.max_tokens !== undefined) {
    const requested = Number(body.max_tokens);
    body.max_tokens = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_OUTPUT_TOKENS)
      : MAX_OUTPUT_TOKENS;
  }

  // 3. Política EFECTIVA = la MÁS ESTRICTA entre la que declara el cliente y la
  // que se deriva del payload real. Antes bastaba con etiquetar un body_scan de
  // 2 imágenes (premium, caro) como 'general' (gratis, 20/día) para saltarse el
  // paywall y el cupo: el servidor le creía al header. Ahora el header sirve
  // para ENDURECER (validar 1 foto declarándola 'body_scan' sigue siendo
  // premium) pero jamás para relajar.
  const declaredHeader = req.headers.get('x-gymup-feature') ?? 'general';
  const declaredFeature = FEATURE_POLICY[declaredHeader] ? declaredHeader : 'general';
  const derivedFeature = deriveMinimumFeature(images);

  const effectiveFeature = derivedFeature && rankOf(derivedFeature) > rankOf(declaredFeature)
    ? derivedFeature
    : declaredFeature;
  const policy = derivedFeature
    ? strictestPolicy(FEATURE_POLICY[declaredFeature], FEATURE_POLICY[derivedFeature])
    : FEATURE_POLICY[declaredFeature];

  // 4. Entitlement: ¿es premium?
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_premium')
    .eq('user_id', user.id)
    .single();
  const isPremium = profile?.is_premium === true;

  if (policy.premiumOnly && !isPremium) {
    return json({ error: 'Esta función es Premium.', code: 'premium_required' }, 402);
  }

  // 5. Rate limit por feature EFECTIVA (fail-CLOSED: si la BD falla, no
  // gastamos IA). La RPC ya no recibe p_user_id: lo deriva del JWT (auth.uid()),
  // así el proxy no puede cobrarle el consumo a otro usuario ni por error.
  const limit = isPremium ? policy.premiumLimit : policy.freeLimit;
  const { data: allowed, error: rlError } = await supabase.rpc('increment_ai_usage', {
    p_feature: effectiveFeature, p_limit: limit,
  });
  if (rlError) {
    console.error('rate-limit error:', rlError.message);
    return json({ error: 'No se pudo verificar el límite. Intenta luego.' }, 503);
  }
  if (allowed === false) {
    return json({ error: 'Alcanzaste el límite de hoy. Pásate a Premium para más.', code: 'limit_reached' }, 429);
  }

  // 6. Blindaje server-side: inyectar las reglas de seguridad como PRIMER
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

  // 7. Reenviar a OpenAI con la key del servidor.
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

// Recorre los mensajes contando imágenes y caracteres de TEXTO.
// Los data-URI de las imágenes NO cuentan como texto a propósito: un body_scan
// legítimo trae cientos de miles de caracteres de base64 y medirlos ahí lo
// rechazaría siempre. El nº de imágenes ya se acota por separado.
function inspectMessages(messages: unknown[]): { images: number; textChars: number } {
  let images = 0;
  let textChars = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown })?.content;
    if (typeof content === 'string') { textChars += content.length; continue; }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: unknown; text?: unknown };
      if (p?.type === 'image_url') images++;
      else if (typeof p?.text === 'string') textChars += p.text.length;
    }
  }
  return { images, textChars };
}

// Piso de política derivado SOLO del payload, sin mirar el header. Las imágenes
// delatan la feature cara: es lo que impide etiquetar un análisis corporal como
// texto barato. Devuelve null cuando no hay imágenes (solo texto: cualquier
// feature de texto es plausible, no hay nada que endurecer).
function deriveMinimumFeature(images: number): string | null {
  if (images >= 2) return 'body_scan';  // patrón real del análisis corporal: premium
  if (images === 1) return 'food_scan'; // visión de una sola foto: con cupo
  return null;
}

function rankOf(feature: string): number {
  return FEATURE_COST_RANK[feature] ?? 0;
}

// "Más estricta" = premiumOnly gana y cada límite se toma al mínimo.
function strictestPolicy(a: FeaturePolicy, b: FeaturePolicy): FeaturePolicy {
  return {
    premiumOnly: a.premiumOnly || b.premiumOnly,
    freeLimit: Math.min(a.freeLimit, b.freeLimit),
    premiumLimit: Math.min(a.premiumLimit, b.premiumLimit),
  };
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
