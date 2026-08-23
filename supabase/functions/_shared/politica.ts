// supabase/functions/_shared/politica.ts
// ─────────────────────────────────────────────────────────
// QUIÉN PUEDE PEDIR QUÉ, CUÁNTAS VECES, Y CONTRA QUÉ CONTADOR.
//
// Vive fuera de ai-proxy porque es la parte que decide dinero y acceso, y era
// la única que no se podía probar: tsc no mira supabase/ (es Deno) y un test de
// expresiones regulares sobre el archivo no puede simular un flujo entero.
//
// Y hacía falta poder simularlo. El análisis corporal hace una llamada de
// validación POR FOTO más una de análisis, todas etiquetadas 'body_scan', cuyo
// tope era 1 al día: la validación de la primera foto agotaba el único uso y el
// análisis recibía siempre un 429. Un Premium de pago no podía completar un
// análisis corporal NUNCA — y nada lo detectaba, porque no había forma de
// escribir un test que contara las llamadas de un flujo.
// __tests__/politicaIA.test.ts ahora lo hace.
//
// Nada de aquí toca Deno, la red ni variables de entorno.
// ─────────────────────────────────────────────────────────

export type FeaturePolicy = {
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
export const FEATURE_POLICY: Record<string, FeaturePolicy> = {
  body_scan:   { premiumOnly: true,  freeLimit: 0,  trialLimit: 1,  premiumLimit: 1 },
  coach:       { premiumOnly: true,  freeLimit: 0,  trialLimit: 10, premiumLimit: 10 },
  coach_chat:  { premiumOnly: true,  freeLimit: 0,  trialLimit: 10, premiumLimit: 10 },
  food_scan:   { premiumOnly: true,  freeLimit: 0,  trialLimit: 3,  premiumLimit: 4 },
  // Comprobar que una foto sirve ANTES de analizarla. Es una llamada aparte y
  // barata (detail:low, 150 tokens de salida: ~$0,0005) y necesita cupo propio.
  //
  // Iba etiquetada como 'body_scan', que tiene tope 1 al día. O sea: validar la
  // PRIMERA foto agotaba el único uso y el análisis final recibía siempre un 429.
  // Con una sola foto ya eran dos llamadas contra un tope de uno, así que un
  // Premium de pago NO podía completar un análisis corporal nunca. Y el efecto
  // era perverso: en la prueba gratis el contador es compartido, así que la
  // función SÍ andaba durante los 7 días y se rompía justo al pagar.
  //
  // No entra en ESCANEOS_DE_IMAGEN a propósito: si compartiera el cupo de 3 de
  // la prueba volveríamos al mismo sitio. Lo que la acota es el presupuesto en
  // dólares, igual que todo lo demás.
  scan_check:  { premiumOnly: true,  freeLimit: 0,  trialLimit: 4,  premiumLimit: 4 },
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
export const ESCANEOS_DE_IMAGEN = new Set(['body_scan', 'food_scan', 'fridge_scan']);
export const PRUEBA_ESCANEOS_DIA = 3;
export const CLAVE_ESCANEOS_PRUEBA = 'trial_scans';

// Ranking de COSTO por feature (mayor = más cara = más restrictiva). Se usa
// cuando lo que declara el cliente y lo que se deriva del payload no coinciden:
// el consumo se registra bajo la MÁS CARA de las dos. Si no, un body_scan
// disfrazado de 'general' gastaría del cupo equivocado.
export const FEATURE_COST_RANK: Record<string, number> = {
  body_scan:   100, // hasta 3 fotos en detail:high
  fridge_scan:  80, // 1 foto high + 2000 tokens de salida
  coach:        70, // 1 foto high (análisis de postura)
  scan_check:   65, // 1 foto LOW + 150 tokens: la más barata de las de imagen,
                    // pero por encima de food_scan para que no le robe su cupo
  food_scan:    60, // 1 foto high, salida corta
  coach_chat:   40,
  plan:         30,
  suggestion:   20,
  notification: 20,
  scoring:      10,
  general:       0,
};

// Piso de política derivado SOLO del payload, sin mirar el header. Las imágenes
// delatan la feature cara: es lo que impide etiquetar un análisis corporal como
// texto barato. Devuelve null cuando no hay imágenes (solo texto: cualquier
// feature de texto es plausible, no hay nada que endurecer).
export function deriveMinimumFeature(images: number): string | null {
  if (images >= 2) return 'body_scan';  // patrón real del análisis corporal: premium
  if (images === 1) return 'food_scan'; // visión de una sola foto: con cupo
  return null;
}

export function rankOf(feature: string): number {
  return FEATURE_COST_RANK[feature] ?? 0;
}

// "Más estricta" = premiumOnly gana y cada límite se toma al mínimo.
export function strictestPolicy(a: FeaturePolicy, b: FeaturePolicy): FeaturePolicy {
  // TODOS los campos de FeaturePolicy, sin excepción. Al añadir trialLimit se
  // olvidó aquí, y el objeto combinado salía con trialLimit: undefined. Eso
  // llegaba a increment_ai_usage como p_limit null, y en Postgres
  // `current_count <= NULL` es NULL, no false — así que la comprobación del
  // proxy (`allowed === false`) lo dejaba pasar. No fallaba el trial: fallaba
  // ABIERTO, con IA sin tope por ese camino.
  //
  // __tests__/aiProxyPolicy.test.ts comprueba que esta función cubra todos los
  // campos del tipo, para que el próximo campo nuevo no repita la historia.
  return {
    premiumOnly: a.premiumOnly || b.premiumOnly,
    freeLimit: Math.min(a.freeLimit, b.freeLimit),
    trialLimit: Math.min(a.trialLimit, b.trialLimit),
    premiumLimit: Math.min(a.premiumLimit, b.premiumLimit),
  };
}

export type Resolucion = {
  /** La feature bajo la que se cobra el consumo. */
  feature: string;
  /** La clave del contador diario. Difiere de `feature` en la prueba compartida. */
  claveContador: string;
  /** La política ya combinada. */
  policy: FeaturePolicy;
  /** El tope que se le aplica a ESTA petición. */
  limite: number;
  /** true = hay que responder 402 y abrir el paywall. */
  exigePremium: boolean;
};

/**
 * La decisión completa, en una función.
 *
 * Estaba repartida en seis expresiones sueltas dentro del Deno.serve, y por eso
 * nadie podía comprobar que un flujo real cupiera en sus propios topes.
 *
 * @param headerDeclarado  lo que dice el cliente (x-gymup-feature). Es una
 *                         DECLARACIÓN, no una verdad.
 * @param imagenes         cuántas imágenes trae el payload de verdad.
 */
export function resolverPolitica(args: {
  headerDeclarado: string | null;
  imagenes: number;
  isPremium: boolean;
  esPrueba: boolean;
}): Resolucion {
  const declaredFeature = args.headerDeclarado && FEATURE_POLICY[args.headerDeclarado]
    ? args.headerDeclarado
    : 'general';
  const derivedFeature = deriveMinimumFeature(args.imagenes);

  // La derivación ESCALA, no castiga. Solo entra cuando lo declarado es MÁS
  // BARATO que lo que el payload delata: ahí estaba el bypass (etiquetar un
  // análisis corporal de 2 fotos como 'general' y quedarse con su cupo de texto).
  //
  // Combinarlas SIEMPRE no protegía nada extra y sí rompía cosas, porque
  // strictestPolicy toma el mínimo de dos topes pensados para funciones
  // distintas: 'coach' (postura, 1 foto) declara 10 al día —lo que anuncia el
  // paywall— y al derivarse 'food_scan' caía a min(10, 4) = 4. El servidor
  // recortaba en silencio lo que la pantalla de pago prometía.
  const escalar = !!derivedFeature && rankOf(derivedFeature) > rankOf(declaredFeature);

  const feature = escalar ? derivedFeature! : declaredFeature;
  const policy = escalar
    ? strictestPolicy(FEATURE_POLICY[declaredFeature], FEATURE_POLICY[derivedFeature!])
    : FEATURE_POLICY[declaredFeature];

  // Durante la prueba los escaneos de imagen comparten un solo cupo: con uno
  // por función, "3 al día" se convertían en 5 imágenes.
  const esEscaneoDePrueba = args.esPrueba && ESCANEOS_DE_IMAGEN.has(feature);
  const claveContador = esEscaneoDePrueba ? CLAVE_ESCANEOS_PRUEBA : feature;

  const limite = esEscaneoDePrueba
    ? PRUEBA_ESCANEOS_DIA
    : args.esPrueba
      ? policy.trialLimit
      : args.isPremium
        ? policy.premiumLimit
        : policy.freeLimit;

  return {
    feature,
    claveContador,
    policy,
    limite,
    exigePremium: policy.premiumOnly && !args.isPremium,
  };
}
