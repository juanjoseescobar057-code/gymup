// lib/subscription.ts
// ─────────────────────────────────────────────────────────
// Capa de suscripción / freemium. La lógica de límites es PURA y
// testeable. La compra real se conecta con RevenueCat (ver más abajo);
// mientras tanto el estado premium se lee de user_profiles.is_premium,
// que un webhook de RevenueCat actualizaría en el servidor.
// ─────────────────────────────────────────────────────────

export type Feature = 'body_scan' | 'coach' | 'coach_chat' | 'food_scan' | 'regenerate_plan' | 'fridge_scan';

// Qué puede hacer el plan GRATIS. Todo tiene tope diario; lo que está en false
// es exclusivo de Premium.
// El plan gratis NO consume IA salvo para generar su plan de entrenamiento, y
// aun así es una app completa: progresión automática, calentamiento filtrado
// por lesiones, registro de series, récords, macros a mano, rachas y el coach
// de reglas de lib/coachReglas.ts. Nada de eso necesita un token.
//
// Antes había 3 escaneos y 5 mensajes de chat gratis al día. Costaban ~$0.72
// al mes por alguien que no paga nada — más que todo el presupuesto del plan
// gratis. La degustación de la IA es la prueba de 7 días, no un goteo perpetuo.
export const FREE_LIMITS = {
  foodScansPerDay: 0,     // premium
  fridgeScansPerDay: 0,   // premium
  coachMessagesPerDay: 0, // premium
  bodyScan: false,        // premium
  coach: false,           // premium (coach de postura)
  regeneratePlan: false,  // premium
};

// Topes DIARIOS del plan Premium. Premium NO es ilimitado: el servidor aplica
// estos topes de verdad (FEATURE_POLICY en supabase/functions/ai-proxy/index.ts)
// y devuelve 429 al pasarse. Prometer "ilimitado" o "sin límites" en el paywall
// era publicidad engañosa: motivo de rechazo en tienda y de reembolsos.
//
// ⚠️ SINCRONIZACIÓN con FEATURE_POLICY.premiumLimit del ai-proxy: si un tope
// cambia allí, HAY QUE cambiarlo aquí (y viceversa). El proxy corre en Deno y
// esto va en el bundle de la app, así que no pueden compartir el módulo — pero
// __tests__/topesIA.test.ts lee LOS DOS ARCHIVOS y falla si dejan de coincidir.
// Antes esto era un comentario pidiendo cuidado, y un comentario no detiene
// nada: prometer en el paywall más de lo que el servidor concede es publicidad
// engañosa, motivo de rechazo en tienda y de reembolsos.
export const PREMIUM_LIMITS = {
  bodyScansPerDay: 1,      // ai-proxy: body_scan.premiumLimit
  coachPosturePerDay: 10,  // ai-proxy: coach.premiumLimit
  coachMessagesPerDay: 10, // ai-proxy: coach_chat.premiumLimit
  foodScansPerDay: 4,      // ai-proxy: food_scan.premiumLimit
  fridgeScansPerDay: 1,    // ai-proxy: fridge_scan.premiumLimit
  planRegensPerDay: 1,     // ai-proxy: plan.premiumLimit (regenerar plan)
};

export const PLANS = {
  // SIN precio escrito a mano, a propósito. Había `price: '$9.99'` como
  // "respaldo visual" y acabó en producción: el paywall enseñaba dólares
  // cuando el precio real son 24.900 COP, con los productos ni creados en Play
  // y el botón de comprar inservible. Un precio inventado en una pantalla de
  // pago no es un respaldo, es una cifra falsa — y en cada país sería falsa de
  // una manera distinta.
  //
  // El único precio que se pinta es el que devuelve la tienda (priceString),
  // ya formateado en la moneda de quien mira. Si no hay tienda, el paywall
  // muestra "—" y desactiva la compra. Ver app/paywall.tsx.
  monthly: { id: 'premium_monthly', period: 'mes' },
  yearly:  { id: 'premium_yearly',  period: 'año', save: '33%' },
};

// Los beneficios se arman con los números reales para que no puedan desviarse
// del texto: si alguien toca PREMIUM_LIMITS, el paywall cambia con él.
// Lo que Premium AÑADE. Ni una línea de aquí puede describir algo que el plan
// gratis ya tenga: eso es publicidad engañosa y además decepciona justo cuando
// la persona acaba de pagar.
//
// Ya pasó dos veces:
//   • "📈 Predicción de resultados" — goalMath.projectGoal es lógica pura y se
//     pinta en app/(tabs)/progress.tsx sin mirar el plan. El plan gratis
//     SIEMPRE la tuvo.
//   • "🧠 Coach de postura" compitiendo con un "coach" que el plan gratis
//     también tiene ahora (lib/coachReglas.ts), solo que de reglas. Dos cosas
//     distintas con el mismo nombre confunden a quien intenta decidir.
//
// Y nada de "(gratis: 0)": comparar contra cero no vende, solo suena a castigo.
//
// NO poner "sin anuncios": la app no tiene anuncios en ninguna versión, así
// que sería cobrar por quitar algo que no existe. Si algún día se meten
// anuncios en el plan gratis, vuelve esa línea — no antes.
//
// Los números salen de PREMIUM_LIMITS y no se escriben a mano: prometer más de
// lo que el servidor concede es motivo de rechazo en tienda y de reembolsos.
// __tests__/topesIA.test.ts comprueba que esos topes son los que aplica el proxy.
export const PREMIUM_BENEFITS = [
  `💬 Pregúntale lo que quieras a tu coach: ${PREMIUM_LIMITS.coachMessagesPerDay} mensajes al día`,
  // NO decía la verdad. Describía el Coach en vivo (app/live-coach.tsx), que es
  // LOCAL, GRATIS y sin ninguna comprobación de Premium: cuenta repeticiones con
  // la cámara del teléfono sin gastar un token. Le estábamos cobrando a la gente
  // por algo que ya tenía.
  //
  // Lo que sí se paga es el análisis de postura por IA: mandas una foto y te
  // dice qué corregir. Es otra función, y ahora se describe como lo que es.
  `🎥 Análisis de tu técnica: manda una foto de tu postura y la IA te dice qué corregir, ${PREMIUM_LIMITS.coachPosturePerDay} al día`,
  `🍽️ Apunta la comida con una foto en vez de escribirla: ${PREMIUM_LIMITS.foodScansPerDay} escaneos al día`,
  `🥗 Fotografía tu nevera y te dice qué cocinar: ${PREMIUM_LIMITS.fridgeScansPerDay} al día`,
  `📷 Análisis corporal con IA: ${PREMIUM_LIMITS.bodyScansPerDay} al día`,
  // Rehacer el plan SE QUITA de aquí: en el servidor plan.premiumOnly es false
  // y freeLimit es 1, o sea que quien no paga tiene exactamente lo mismo. Es una
  // decisión deliberada —sin plan la app está vacía y no hay nada que probar—
  // pero venderlo como beneficio de pago era cobrar por algo que se regala.
  // Está donde le toca, en FREE_HIGHLIGHTS.
];

// Lo que el plan GRATIS ya incluye. No es relleno del paywall: quien está
// decidiendo necesita saber qué conserva si no paga, y todo esto es
// determinista y no cuesta un token, así que se puede prometer sin letra
// pequeña. Enseñarlo también evita la lectura de "la app no sirve sin pagar",
// que es la que hace desinstalar.
export const FREE_HIGHLIGHTS = [
  '🏋️ Tu plan de entrenamiento completo, generado con IA',
  '🔄 Rehazlo cuando cambien tus circunstancias: 1 al día',
  '🎥 Coach en vivo: cuenta tus repeticiones con la cámara, sin límite',
  '📈 Progresión automática: cuándo subir el peso y cuándo bajar, según tus series',
  '🔥 Calentamiento y estiramientos filtrados por tus lesiones y condiciones',
  '📊 Registro de series, récords, historial y proyección hacia tu meta',
  '🍎 Macros y comidas a mano, agua, peso y medidas',
];

export type GateResult = { allowed: boolean; reason?: string };

/**
 * Decide si el usuario puede usar una feature según su plan y uso de hoy.
 * PURA → testeable. `usedToday` aplica a features con cupo diario.
 */
/**
 * El aviso cuando no queda cupo.
 *
 * Con un tope de 0 —que es lo que tienen hoy el chat, el escaneo de comida y
 * el de nevera en el plan gratis— el mensaje salía como "Llegaste al límite de
 * 0 escaneos de comida por día" en el PRIMER uso, sin haber usado nada. Se lee
 * como un fallo de la app, y encima esconde lo único que importa decir: que
 * eso es de pago.
 *
 * Un tope de cero no es un límite alcanzado. Es una función que no está
 * incluida.
 */
function sinCupo(tope: number, queEs: string, comoSeCuenta: string): GateResult {
  return {
    allowed: false,
    reason: tope === 0
      ? `${queEs} es una función Premium.`
      : `Llegaste al límite de ${tope} ${comoSeCuenta} por hoy.`,
  };
}

export function canUseFeature(
  feature: Feature,
  isPremium: boolean,
  usedToday = 0
): GateResult {
  // Premium tampoco es ilimitado (ver PREMIUM_LIMITS), pero sus topes los cuenta
  // y aplica el servidor: acá no hay un contador fiable del uso premium del día,
  // así que el gate local lo deja pasar y el proxy responde 429 si se pasó.
  if (isPremium) return { allowed: true };

  switch (feature) {
    case 'body_scan':
      return { allowed: false, reason: 'El análisis corporal es una función Premium.' };
    case 'coach':
      return { allowed: false, reason: 'El coach de postura es una función Premium.' };
    case 'coach_chat':
      return usedToday < FREE_LIMITS.coachMessagesPerDay
        ? { allowed: true }
        : sinCupo(FREE_LIMITS.coachMessagesPerDay, 'Hablar con tu coach', 'mensajes con tu coach');
    case 'regenerate_plan':
      // NO es Premium, y el servidor nunca lo trató como tal: en la política
      // del proxy `plan` tiene premiumOnly:false y freeLimit:1. Es deliberado
      // —sin plan la app está vacía y no hay nada que probar— pero esta línea
      // mandaba al paywall a quien tenía derecho a hacerlo, y el paywall ya no
      // lo vende. Tres versiones de la verdad para la misma función.
      //
      // El tope de 1 al día lo aplica el servidor; aquí no hace falta contarlo
      // otra vez.
      return { allowed: true };
    case 'food_scan':
      return usedToday < FREE_LIMITS.foodScansPerDay
        ? { allowed: true }
        : sinCupo(FREE_LIMITS.foodScansPerDay, 'Escanear tu comida', 'escaneos de comida');
    case 'fridge_scan':
      return usedToday < FREE_LIMITS.fridgeScansPerDay
        ? { allowed: true }
        : sinCupo(FREE_LIMITS.fridgeScansPerDay, 'Escanear tu nevera', 'escaneos de nevera');
    default:
      return { allowed: true };
  }
}

// ── Compra real ──────────────────────────────────────────
// La integración con RevenueCat (compra, restauración, entitlement) vive en
// lib/purchases.ts (tiene imports de RN; este módulo se mantiene PURO para
// que los límites/gates sean testeables con node --test). El webhook que
// escribe user_profiles.is_premium es supabase/functions/rc-webhook.
