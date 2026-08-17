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

// `price` es solo un RESPALDO VISUAL en USD para mientras cargan las ofertas de
// la tienda: el precio que se cobra de verdad es el localizado que devuelve
// RevenueCat (priceString), y es el que pinta el paywall. Ver app/paywall.tsx.
export const PLANS = {
  monthly: { id: 'gymup_premium_monthly', price: '$9.99', period: 'mes' },
  yearly:  { id: 'gymup_premium_yearly',  price: '$79.99', period: 'año', save: '33%' },
};

// Los beneficios se arman con los números reales para que no puedan desviarse
// del texto: si alguien toca PREMIUM_LIMITS, el paywall cambia con él.
export const PREMIUM_BENEFITS = [
  `📷 Análisis corporal con IA: hasta ${PREMIUM_LIMITS.bodyScansPerDay} al día`,
  `🧠 Coach de postura: ${PREMIUM_LIMITS.coachPosturePerDay} análisis diarios`,
  `💬 Chat con tu coach: ${PREMIUM_LIMITS.coachMessagesPerDay} mensajes al día (gratis: ${FREE_LIMITS.coachMessagesPerDay})`,
  `🍽️ Escaneo de comida: hasta ${PREMIUM_LIMITS.foodScansPerDay} al día (gratis: ${FREE_LIMITS.foodScansPerDay})`,
  `🥗 Escaneo de nevera: hasta ${PREMIUM_LIMITS.fridgeScansPerDay} al día (gratis: ${FREE_LIMITS.fridgeScansPerDay})`,
  `🔄 Regenera tu plan hasta ${PREMIUM_LIMITS.planRegensPerDay} veces al día`,
  '📈 Predicción de resultados',
  // NO poner "sin anuncios": la app no tiene anuncios en ninguna versión, así
  // que sería cobrar por quitar algo que no existe. Si algún día se meten
  // anuncios en el plan gratis, vuelve esta línea — no antes.
];

export type GateResult = { allowed: boolean; reason?: string };

/**
 * Decide si el usuario puede usar una feature según su plan y uso de hoy.
 * PURA → testeable. `usedToday` aplica a features con cupo diario.
 */
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
        : { allowed: false, reason: `Llegaste al límite de ${FREE_LIMITS.coachMessagesPerDay} mensajes gratis con tu coach hoy.` };
    case 'regenerate_plan':
      return { allowed: false, reason: 'Regenerar el plan es una función Premium.' };
    case 'food_scan':
      return usedToday < FREE_LIMITS.foodScansPerDay
        ? { allowed: true }
        : { allowed: false, reason: `Llegaste al límite de ${FREE_LIMITS.foodScansPerDay} escaneos de comida por día.` };
    case 'fridge_scan':
      return usedToday < FREE_LIMITS.fridgeScansPerDay
        ? { allowed: true }
        : { allowed: false, reason: `Llegaste al límite de ${FREE_LIMITS.fridgeScansPerDay} escaneo de nevera por día.` };
    default:
      return { allowed: true };
  }
}

// ── Compra real ──────────────────────────────────────────
// La integración con RevenueCat (compra, restauración, entitlement) vive en
// lib/purchases.ts (tiene imports de RN; este módulo se mantiene PURO para
// que los límites/gates sean testeables con node --test). El webhook que
// escribe user_profiles.is_premium es supabase/functions/rc-webhook.
