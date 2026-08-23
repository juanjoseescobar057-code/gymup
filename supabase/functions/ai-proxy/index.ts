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
import { leerCuerpoAcotado, inspectMessages } from '../_shared/payload.ts';
import { resolverPolitica } from '../_shared/politica.ts';

// Se admite el SNAPSHOT además del alias. El alias mueve el comportamiento del
// modelo sin avisar, y esta app da recomendaciones de salud: la generación de
// planes usa el snapshot fijo para que un cambio de OpenAI no altere en
// silencio lo que se le programa a alguien con una hernia. El alias se
// conserva para el resto de funciones, menos sensibles.
const ALLOWED_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06']);

// La política (qué feature, qué tope, contra qué contador) vive en
// _shared/politica.ts, para poder simular flujos enteros en un test.

// ─── PRESUPUESTO EN DINERO: el techo de verdad ───────────
// Ingreso neto por premium: 24.900 COP menos ~15% de Play ≈ $5.00 USD/mes.
// El presupuesto de IA es el 40% de eso. Un tope en llamadas siempre se puede
// burlar eligiendo las caras; este no, porque está en la misma unidad que la
// pérdida.
const PRESUPUESTO_PREMIUM_USD = 2.00;

// La prueba de 7 días no paga nada, así que su techo es lo que estamos
// dispuestos a invertir en adquirir a esa persona.
//
// ESTABA EN 0.25 CON UNA CUENTA MAL HECHA. El comentario decía que agotarlo del
// todo costaba "~$0.21 en los siete días"; $0.21 es lo que cuesta UN día al
// tope (10 chats a $0.008 son ya $0.08, más 10 análisis de postura, más los 3
// escaneos compartidos, más el plan). El número estaba mal por un factor de
// siete, así que la prueba de 7 días entregaba IA día y medio y luego respondía
// "Agotaste la IA incluida en la prueba" — justo en la ventana donde la persona
// decide si paga. Difícil imaginar un peor sitio para equivocarse.
//
// 0.60 cubre siete días de uso intensivo real (~$0.062/día, ver
// __tests__/economiaPremium.test.ts) con margen. Sigue siendo un costo de
// adquisición ridículo frente a ~$5.00 netos al mes por quien convierte.
const PRESUPUESTO_PRUEBA_USD = 0.60;

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



// Topes duros del payload. El más pesado que manda la app real es el análisis
// corporal: 3 imágenes y ~4k caracteres de texto; todo lo demás cabe de sobra.
const MAX_MESSAGES = 40;
const MAX_TEXT_CHARS = 120_000;
const MAX_IMAGES = 4;
const MAX_OUTPUT_TOKENS = 4096;

// Techo del CUERPO de la petición, en bytes.
//
// Hacía falta porque MAX_TEXT_CHARS no mide los data-URI de las imágenes a
// propósito (ver inspectMessages), así que hasta ahora no había NADA acotando
// el tamaño real: `await req.json()` se tragaba lo que llegara, y una petición
// de cientos de megas tumbaba la función antes de llegar a ningún control.
//
// La cuenta: lib/image.ts manda JPEG de 1024 px al 70% de calidad. Eso son
// ~150-500 KB por foto, y base64 añade un tercio: ~700 KB en el peor caso
// realista. Cuatro fotos (MAX_IMAGES) son ~2,7 MB. Seis megas deja el doble de
// margen y sigue estando dos órdenes de magnitud por debajo de lo que hace
// daño.
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Techo por imagen. Con el de arriba bastaría, pero una sola foto de 5 MB es
// siempre un error del cliente (o alguien probando), no una foto de gimnasio:
// mejor decirlo con claridad que dejar que se lo coma el techo global.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
  //
  // El tamaño se acota ANTES de parsear. Con `await req.json()` a secas, un
  // cuerpo de 200 MB se bufferizaba entero en memoria y reventaba la función
  // sin que ningún control llegara a ejecutarse: no hacía falta ni tener cuenta
  // premium para tumbar la IA de todos.
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) {
    return json({ error: 'Petición demasiado grande.', code: 'payload_too_large' }, 413);
  }

  const crudo = await leerCuerpoAcotado(req, MAX_BODY_BYTES);
  if (crudo === null) {
    // Se cortó la lectura a mitad: el content-length mentía o no venía.
    return json({ error: 'Petición demasiado grande.', code: 'payload_too_large' }, 413);
  }

  let body: any;
  try { body = JSON.parse(crudo); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!ALLOWED_MODELS.has(body?.model)) return json({ error: 'Modelo no permitido' }, 400);

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return json({ error: `El campo messages debe ser un array de 1 a ${MAX_MESSAGES} elementos.` }, 400);
  }

  // Lista BLANCA de campos. Era una lista negra de cinco (tools, functions,
  // tool_choice, n, stream) y el resto del cuerpo se reenviaba entero a OpenAI.
  // Eso dejaba pasar cualquier parámetro que existiera o llegara a existir:
  // 'max_completion_tokens' (que esquiva el techo de 'max_tokens'), 'top_p',
  // 'seed', 'logprobs', 'stream_options'... Enumerar lo prohibido es una carrera
  // que se pierde sola; enumerar lo permitido no.
  //
  // Estos cinco son TODOS los que manda la app de verdad — comprobado en
  // lib/openai.ts, openai-features.ts, coachChat.ts, coachMemory.ts, aiScore.ts
  // y adaptivePlan.ts. Se RECHAZA lo desconocido en vez de descartarlo en
  // silencio: si algún día hace falta uno nuevo, mejor un 400 con el nombre
  // dentro que una función que deja de comportarse como se espera sin decir por qué.
  const CAMPOS_PERMITIDOS = new Set(['model', 'messages', 'response_format', 'max_tokens', 'temperature']);
  const sobran = Object.keys(body).filter((k) => !CAMPOS_PERMITIDOS.has(k));
  if (sobran.length > 0) {
    return json({ error: `Campos no permitidos: ${sobran.join(', ')}.`, code: 'campo_no_permitido' }, 400);
  }

  const { images, textChars, imagenInvalida } = inspectMessages(messages, MAX_IMAGE_BYTES);
  if (imagenInvalida) {
    // La app SIEMPRE manda data:image/...;base64 (ver lib/openai.ts y
    // lib/openai-features.ts). Una URL remota haría que OpenAI la descargue
    // CON NUESTRA CUENTA: eso convierte el proxy en un buscador de URLs ajeno y
    // no lo necesita ninguna función real.
    return json({ error: imagenInvalida, code: 'imagen_invalida' }, 400);
  }
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
  //
  // SE PONE SIEMPRE, aunque el cliente no lo mande. Antes el `if` de aquí solo
  // corregía lo que llegaba: omitir el campo saltaba el techo entero y dejaba la
  // salida en el máximo del modelo (16.384 tokens en gpt-4o), o sea cuatro veces
  // lo declarado, ~$0,16 más por llamada. Un techo que se desactiva no mandándolo
  // no es un techo.
  const pedido = Number(body.max_tokens);
  body.max_tokens = Number.isFinite(pedido) && pedido > 0
    ? Math.min(Math.trunc(pedido), MAX_OUTPUT_TOKENS)
    : MAX_OUTPUT_TOKENS;

  // temperature se acota al rango que acepta OpenAI. No es cuestión de costo:
  // un valor fuera de rango provoca un 400 del proveedor, y ese 400 entraba
  // antes por la rama de reembolso como si el fallo hubiera sido nuestro.
  if (body.temperature !== undefined) {
    const t = Number(body.temperature);
    body.temperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 2) : 1;
  }

  // 3. Entitlement: ¿es premium? ¿está en la prueba gratis?
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

  // 4. LA POLÍTICA EFECTIVA. El header x-gymup-feature es una DECLARACIÓN
  // del cliente, no una verdad: resolverPolitica deriva un piso mirando el
  // payload real (cuántas imágenes trae) y escala si lo declarado era más
  // barato. Etiquetar un análisis corporal de 2 fotos como 'general' para
  // quedarse con su cupo de texto sigue sin funcionar.
  //
  // Toda la decisión está en _shared/politica.ts para poder simular flujos
  // enteros en un test: el del análisis corporal no cabía en su propio tope y
  // no había manera de que nada lo detectara.
  const { claveContador, limite: limit, exigePremium } = resolverPolitica({
    headerDeclarado: req.headers.get('x-gymup-feature'),
    imagenes: images,
    isPremium,
    esPrueba,
  });

  if (exigePremium) {
    return json({ error: 'Esta función es Premium.', code: 'premium_required' }, 402);
  }

  // 5. PRESUPUESTO DEL MES, en dinero. Va antes del contador de llamadas
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

  // 6. Rate limit por feature EFECTIVA (fail-CLOSED: si la BD falla, no
  // gastamos IA). La RPC ya no recibe p_user_id: lo deriva del JWT (auth.uid()),
  // así el proxy no puede cobrarle el consumo a otro usuario ni por error.
  // Durante la prueba los tres escaneos de imagen comparten un único cupo: si
  // tuvieran uno cada uno, "3 al día" serían 5 imágenes. La clave del contador
  // cambia, y el reembolso de más abajo tiene que usar ESTA MISMA clave o
  // devolvería el cupo a un contador que nadie está mirando.
  // Defensa en profundidad: un tope que no sea un número REAL no puede llegar
  // a la base. Ya pasó una vez —strictestPolicy olvidó trialLimit— y el
  // undefined resultante hacía que el control fallara ABIERTO.
  if (!Number.isFinite(limit)) {
    console.error(`ai-proxy: tope inválido (${String(limit)}) para ${claveContador}; se corta`);
    return json({ error: 'No se pudo verificar el límite. Intenta luego.' }, 503);
  }

  const { data: allowed, error: rlError } = await supabase.rpc('increment_ai_usage', {
    p_feature: claveContador, p_limit: limit,
  });
  if (rlError) {
    console.error('rate-limit error:', rlError.message);
    return json({ error: 'No se pudo verificar el límite. Intenta luego.' }, 503);
  }
  // `!== true` y no `=== false`: la RPC devuelve NULL si el tope llega nulo, y
  // NULL no es false. Comparar contra false dejaba pasar ese caso.
  if (allowed !== true) {
    return json({ error: 'Alcanzaste el límite de hoy. Pásate a Premium para más.', code: 'limit_reached' }, 429);
  }

  // 7. Blindaje server-side: inyectar las reglas de seguridad como PRIMER
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

  // 8. Reenviar a OpenAI con la key del servidor.
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) return json({ error: 'IA no configurada en el servidor' }, 500);

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();

  // ─── DINERO Y CUPO SON DOS DECISIONES DISTINTAS ───────
  //
  // Estaban pegadas al mismo if/else, y ahí estaba el agujero: la rama del
  // reembolso NUNCA llamaba a record_ai_cost, porque esa llamada vivía en el
  // else. Y record_ai_cost es lo único que escribe ai_cost_usage, o sea lo
  // único que hace bajar el presupuesto en dólares.
  //
  // Resultado: pedir max_tokens: 1, recibir una respuesta de menos de 40
  // caracteres que OpenAI SÍ factura, recuperar el cupo diario, y repetir. Ni
  // el contador de llamadas ni el presupuesto se movían. Gasto sin techo, desde
  // una cuenta gratis, sin necesidad de concurrencia ni de nada sofisticado.
  //
  // La regla correcta separa las dos cosas:
  //   • el CUPO DIARIO es de experiencia — se devuelve si no entregamos nada;
  //   • el PRESUPUESTO EN DÓLARES es de margen — se cobra siempre que OpenAI
  //     nos haya cobrado, aunque la respuesta no valiera para nada.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. COBRAR. Si el proveedor respondió, nos facturó: da igual lo que dijera.
  if (upstream.ok) {
    // Con la clave de SERVICIO: si esta RPC fuera ejecutable por un usuario, se
    // le podría inflar el gasto a otra persona hasta dejarla sin IA.
    try {
      const respuesta = JSON.parse(text);
      const uso = respuesta?.usage ?? {};
      const costo = costoUsd(
        respuesta?.model ?? body?.model ?? null,
        uso.prompt_tokens ?? 0,
        uso.completion_tokens ?? 0,
      );
      if (costo > 0) {
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

  // 2. DEVOLVER EL CUPO, y solo cuando el fallo sea NUESTRO.
  //
  // Existe por un caso real: la generación de planes devolvía un JSON vacío, la
  // persona reintentaba, y al tercer intento se quedaba sin plan Y sin cupo
  // hasta el día siguiente. Eso hay que seguir cubriéndolo.
  //
  // Lo que ya no se cubre es la brevedad que pidió el propio cliente ni el 4xx
  // que provocó él. Antes cualquiera de las dos devolvía cupo, así que bastaba
  // con mandar basura para tener llamadas gratis en el contador.
  const MIN_TOKENS_UTILES = 64;
  const clientePidioCorto = body.max_tokens < MIN_TOKENS_UTILES;

  // Un 4xx significa que lo que mandamos no era válido, y lo que mandamos sale
  // del cliente. Un 5xx o un 429 sí son del proveedor.
  const falloDelProveedor = !upstream.ok && (upstream.status >= 500 || upstream.status === 429);
  const vacioSinCulpaDelCliente = upstream.ok && !clientePidioCorto && esRespuestaInservible(text);

  if (falloDelProveedor || vacioSinCulpaDelCliente) {
    const { error: refundError } = await admin.rpc('refund_ai_usage', {
      p_user_id: user.id,
      p_feature: claveContador,
    });
    if (refundError) console.error('refund_ai_usage:', refundError.message);
    else console.log(`ai-proxy: cupo devuelto (${claveContador}) por ${falloDelProveedor ? 'fallo del proveedor' : 'respuesta vacía'}`);
  } else if (!upstream.ok) {
    console.log(`ai-proxy: ${upstream.status} de OpenAI; el cupo NO se devuelve (petición del cliente)`);
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



function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
