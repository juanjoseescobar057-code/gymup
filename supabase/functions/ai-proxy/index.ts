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

// Se admite el SNAPSHOT además del alias. El alias mueve el comportamiento del
// modelo sin avisar, y esta app da recomendaciones de salud: la generación de
// planes usa el snapshot fijo para que un cambio de OpenAI no altere en
// silencio lo que se le programa a alguien con una hernia. El alias se
// conserva para el resto de funciones, menos sensibles.
const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06']);

type FeaturePolicy = {
  premiumOnly: boolean;
  freeLimit: number;
  trialLimit: number;
  premiumLimit: number;
};

// Política por feature. premiumOnly => bloqueada para free.
// Los tres números son topes DIARIOS de llamadas.
//
// Los topes anteriores (60 chats, 30 escaneos de comida) daban un peor caso de
// ~$24 USD/mes por usuario contra ~$5 de ingreso neto. Se recortaron a partir
// del costo real medido por llamada:
//
//   escaneo de comida  $0.0079    chat con el coach  $0.0080
//   escaneo de nevera  $0.0105    coach de postura   $0.0080
//   escaneo corporal   $0.0092    generar plan       $0.0338
//
// Aun así, estos topes NO son el techo del gasto: contar llamadas no distingue
// un chat de un plan, que cuesta cuatro veces más. El techo de verdad es el
// presupuesto en dólares de más abajo. Estos números están para que nadie
// queme el mes en dos días y para que la experiencia sea predecible.
const FEATURE_POLICY: Record<string, FeaturePolicy> = {
// El plan GRATIS no consume IA salvo para generar su plan de entrenamiento.
// No es tacañería: es que el valor del plan gratis no está en la IA. La
// progresión (progressionEngine), el calentamiento filtrado por lesiones
// (warmupMath), los récords, las rachas y el coach de reglas
// (lib/coachReglas.ts) son deterministas y no cuestan un token. La IA es la
// capa de más, y esa se paga.
//
// premiumOnly en vez de freeLimit: 0 a propósito. Un tope de cero devuelve 429
// "alcanzaste el límite de hoy", que es mentira y encima sugiere que mañana
// podrá. premiumOnly devuelve 402 y el cliente abre el paywall, que es lo
// honesto y además lo que convierte.
const FEATURE_POLICY: Record<string, FeaturePolicy> = {
  body_scan:   { premiumOnly: true,  freeLimit: 0,  trialLimit: 1,  premiumLimit: 1 },
  coach:       { premiumOnly: true,  freeLimit: 0,  trialLimit: 10, premiumLimit: 10 },
  coach_chat:  { premiumOnly: true,  freeLimit: 0,  trialLimit: 10, premiumLimit: 10 },
  food_scan:   { premiumOnly: true,  freeLimit: 0,  trialLimit: 3,  premiumLimit: 4 },
  fridge_scan: { premiumOnly: true,  freeLimit: 0,  trialLimit: 1,  premiumLimit: 1 },
  scoring:     { premiumOnly: false, freeLimit: 40, trialLimit: 80, premiumLimit: 80 }, // juez de calidad (telemetría)
  // El plan SÍ es gratis: sin él la app está vacía y no hay nada que probar.
  // Es costo de adquisición (~$0.034 por generación), no pérdida.
  plan:        { premiumOnly: false, freeLimit: 1,  trialLimit: 1,  premiumLimit: 1 },
  suggestion:  { premiumOnly: false, freeLimit: 3,  trialLimit: 20, premiumLimit: 20 },
  notification:{ premiumOnly: false, freeLimit: 3,  trialLimit: 20, premiumLimit: 20 },
  general:     { premiumOnly: false, freeLimit: 5,  trialLimit: 40, premiumLimit: 40 }, // incluye destilados de memoria
};

// Durante la prueba gratis, los tres escaneos de imagen COMPARTEN un solo cupo
// diario. Con un tope por función, "3 al día" se convertían en 3 de comida + 1
// de nevera + 1 corporal = 5 imágenes, que es justo lo caro. Comparten
// contador, así que da igual cómo los reparta.
const ESCANEOS_DE_IMAGEN = new Set(['body_scan', 'food_scan', 'fridge_scan']);
const PRUEBA_ESCANEOS_DIA = 3;
const CLAVE_ESCANEOS_PRUEBA = 'trial_scans';

// ─── PRESUPUESTO EN DINERO: el techo de verdad ───────────
// Ingreso neto por premium: 24.900 COP menos ~15% de Play ≈ $5.00 USD/mes.
// El presupuesto de IA es el 40% de eso. Un tope en llamadas siempre se puede
// burlar eligiendo las caras; este no, porque está en la misma unidad que la
// pérdida.
const PRESUPUESTO_PREMIUM_USD = 2.00;

// La prueba de 7 días no paga nada, así que su techo es lo que estamos
// dispuestos a invertir en adquirir a esa persona. Con 3 escaneos y 10 chats
// diarios, agotarlo del todo cuesta ~$0.21 en los siete días.
const PRESUPUESTO_PRUEBA_USD = 0.25;

// El plan gratis casi no toca la IA (solo genera su plan de entrenamiento),
// así que su techo es pequeño. Sigue haciendo falta: sin él, crear cuentas
// sería una fuente infinita de generaciones de plan a $0.034 cada una.
const PRESUPUESTO_GRATIS_USD = 0.15;

// Precio USD por 1M de tokens. DUPLICADO A PROPÓSITO de lib/aiMetrics.ts: esto
// es Deno y aquello es React Native, y no comparten módulos. __tests__/
// aiPreciosSincronizados.test.ts falla si las dos tablas dejan de coincidir.
const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'gpt-4o': { inPerM: 2.5, outPerM: 10 },
  'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.6 },
};

/** Costo real de una llamada. Mismo criterio que lib/aiMetrics.ts: gana el prefijo MÁS LARGO. */
function costoUsd(model: string | null, inTok: number, outTok: number): number {
  if (!model) return 0;
  const key = Object.keys(MODEL_PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return 0;
  const p = MODEL_PRICING[key];
  return (inTok * p.inPerM + outTok * p.outPerM) / 1_000_000;
}

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

  // 4. Entitlement: ¿es premium? ¿está en la prueba gratis?
  // is_trial lo escribe rc-webhook desde period_type. Durante la prueba
  // is_premium TAMBIÉN es true —RevenueCat concede el entitlement desde el
  // primer día— así que sin esta segunda columna quien no ha pagado nada entra
  // con los topes y el presupuesto de quien sí paga.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_premium, is_trial')
    .eq('user_id', user.id)
    .single();
  const isPremium = profile?.is_premium === true;
  const esPrueba = isPremium && profile?.is_trial === true;

  if (policy.premiumOnly && !isPremium) {
    return json({ error: 'Esta función es Premium.', code: 'premium_required' }, 402);
  }

  // 4-bis. PRESUPUESTO DEL MES, en dinero. Va antes del contador de llamadas
  // porque es el límite que de verdad protege el margen: los topes diarios
  // cuentan llamadas y no distinguen un chat de un plan, que cuesta cuatro
  // veces más.
  //
  // Fail-CLOSED igual que el rate limit: si la BD no responde, no se gasta IA.
  const presupuesto = esPrueba
    ? PRESUPUESTO_PRUEBA_USD
    : isPremium
      ? PRESUPUESTO_PREMIUM_USD
      : PRESUPUESTO_GRATIS_USD;

  const { data: restante, error: budgetError } = await supabase.rpc('ai_budget_restante', {
    p_budget_usd: presupuesto,
  });
  if (budgetError) {
    console.error('ai_budget_restante:', budgetError.message);
    return json({ error: 'No se pudo verificar el presupuesto. Intenta luego.' }, 503);
  }
  if (typeof restante === 'number' && restante <= 0) {
    console.log(`ai-proxy: presupuesto agotado (${user.id}, ${esPrueba ? 'prueba' : isPremium ? 'premium' : 'gratis'})`);
    return json({
      error: esPrueba
        ? 'Agotaste la IA incluida en la prueba. Al activar Premium se renueva.'
        : 'Alcanzaste el máximo de IA de este mes. Se renueva el día 1.',
      code: 'budget_reached',
    }, 429);
  }

  // 5. Rate limit por feature EFECTIVA (fail-CLOSED: si la BD falla, no
  // gastamos IA). La RPC ya no recibe p_user_id: lo deriva del JWT (auth.uid()),
  // así el proxy no puede cobrarle el consumo a otro usuario ni por error.
  // Durante la prueba los tres escaneos de imagen comparten un único cupo: si
  // tuvieran uno cada uno, "3 al día" serían 5 imágenes. La clave del contador
  // cambia, y el reembolso de más abajo tiene que usar ESTA MISMA clave o
  // devolvería el cupo a un contador que nadie está mirando.
  const esEscaneoDePrueba = esPrueba && ESCANEOS_DE_IMAGEN.has(effectiveFeature);
  const claveContador = esEscaneoDePrueba ? CLAVE_ESCANEOS_PRUEBA : effectiveFeature;

  const limit = esEscaneoDePrueba
    ? PRUEBA_ESCANEOS_DIA
    : esPrueba
      ? policy.trialLimit
      : isPremium
        ? policy.premiumLimit
        : policy.freeLimit;

  const { data: allowed, error: rlError } = await supabase.rpc('increment_ai_usage', {
    p_feature: claveContador, p_limit: limit,
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
- Ante la duda, la opción más conservadora. La salud por encima de la estética.
- Si existen señales de alarma actuales, NO programes ejercicio, movilidad ni caminata como sustituto: indica detener actividad y buscar evaluación. Para otros casos sin señales de alarma, conserva el formato solicitado y entrega el contenido prudente que permita el tamizaje. Nunca ocultes una advertencia clínica para satisfacer un esquema.`;

  // Cuando la petición exige una FORMA (json_object o json_schema), la regla de
  // arriba se vuelve contradictoria: le pide al modelo "indica detener
  // actividad" mientras el formato le prohíbe la prosa. El modelo resuelve esa
  // contradicción devolviendo un JSON vacío — y eso es exactamente lo que
  // llevaba días pasando con la generación de planes: 10-12 tokens de salida,
  // sin error, sin refusal explícito. El servidor le estaba diciendo que se
  // negara y el formato le impedía hacerlo con palabras.
  //
  // Este bloque NO relaja ninguna regla clínica: cambia DÓNDE va la advertencia.
  const pideFormato = !!(body as Record<string, unknown>)?.response_format;
  const FORMATO_SYSTEM = `
CÓMO ADVERTIR CUANDO LA RESPUESTA DEBE SER JSON:
- Esta petición exige un objeto JSON con una forma concreta. NUNCA devuelvas un objeto vacío, ni sin sus campos, ni un texto de negativa: eso deja a la persona SIN contenido Y SIN tu advertencia, que es el peor resultado posible.
- Si algo del tamizaje te preocupa, rellena el JSON con la alternativa MÁS conservadora que se te ocurra y escribe la advertencia y la recomendación de consultar a un profesional en los campos de texto del propio JSON (por ejemplo "notes" u "overview").
- Devolver la advertencia DENTRO del JSON no es ocultarla: es la única forma de que llegue.`;
  try {
    if (Array.isArray((body as Record<string, unknown>)?.messages)) {
      (body as { messages: unknown[] }).messages = [
        { role: 'system', content: SAFETY_SYSTEM + (pideFormato ? FORMATO_SYSTEM : '') },
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

  // DEVOLVER EL CUPO SI NO ENTREGAMOS NADA. El contador se incrementa ANTES de
  // llamar a OpenAI (para no gastar IA si la BD falla), pero eso hacía que una
  // respuesta inservible costara igual que una buena. Pasó de verdad: la
  // generación de planes devolvía un JSON vacío, la persona reintentaba, y al
  // tercer intento se quedaba sin plan Y sin cupo hasta el día siguiente.
  //
  // Solo se devuelve cuando el fallo es NUESTRO —error del proveedor o una
  // respuesta vacía— nunca por criterios del cliente, que no son de fiar.
  if (!upstream.ok || esRespuestaInservible(text)) {
    // Con la clave de SERVICIO, no con el JWT de la persona. Si esta RPC fuera
    // ejecutable por un usuario, un cliente modificado se devolvería cupo
    // indefinidamente y tendría IA gratis ilimitada. El id va explícito y sale
    // del JWT ya verificado más arriba, nunca del cuerpo de la petición.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error: refundError } = await admin.rpc('refund_ai_usage', {
      p_user_id: user.id,
      p_feature: claveContador,
    });
    if (refundError) console.error('refund_ai_usage:', refundError.message);
    else console.log(`ai-proxy: cupo devuelto (${claveContador}) por respuesta inservible`);
  } else {
    // COBRAR EL COSTO REAL AL PRESUPUESTO. Solo se puede hacer aquí, después
    // de responder el proveedor, porque hasta ahora no se sabía cuántos tokens
    // costaba: por eso el presupuesto se comprueba antes y se apunta después.
    //
    // El desbordamiento máximo es una llamada: alguien con $0.001 de saldo
    // pasa el control y gasta $0.034 generando un plan. Acotado y aceptable —
    // la alternativa sería estimar el costo antes, y una estimación que se
    // quede corta deja de ser un techo.
    //
    // Con la clave de SERVICIO: si esta RPC fuera ejecutable por un usuario,
    // se le podría inflar el gasto a otra persona hasta dejarla sin IA.
    try {
      const uso = JSON.parse(text)?.usage ?? {};
      const costo = costoUsd(
        JSON.parse(text)?.model ?? body?.model ?? null,
        uso.prompt_tokens ?? 0,
        uso.completion_tokens ?? 0,
      );
      if (costo > 0) {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const { error: costError } = await admin.rpc('record_ai_cost', {
          p_user_id: user.id,
          p_cost_usd: costo,
        });
        if (costError) console.error('record_ai_cost:', costError.message);
      }
    } catch (e) {
      // Nunca romper la respuesta del usuario por no haber podido contabilizar.
      // Se pierde el apunte de UNA llamada, no el techo: el resto del mes sigue
      // contando.
      console.error('ai-proxy: no se pudo registrar el costo:', e instanceof Error ? e.message : String(e));
    }
  }

  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

/**
 * ¿La respuesta de OpenAI llegó vacía de contenido útil?
 *
 * Se mide el TAMAÑO del contenido, no su forma: el proxy es agnóstico a lo que
 * pide cada feature y no debe conocer el esquema del plan. Un objeto vacío
 * ("{}", '{"days":[]}') no llega a 40 caracteres; cualquier respuesta real los
 * supera con mucho. El umbral es deliberadamente bajo para no devolver cupo
 * por respuestas legítimamente cortas.
 */
function esRespuestaInservible(raw: string): boolean {
  try {
    const data = JSON.parse(raw);
    const contenido = data?.choices?.[0]?.message?.content;
    if (typeof contenido !== 'string') return true;
    return contenido.trim().length < 40;
  } catch {
    return true; // ni siquiera es JSON: no hay nada que entregar
  }
}

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
