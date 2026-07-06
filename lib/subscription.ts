// lib/subscription.ts
// ─────────────────────────────────────────────────────────
// Capa de suscripción / freemium. La lógica de límites es PURA y
// testeable. La compra real se conecta con RevenueCat (ver más abajo);
// mientras tanto el estado premium se lee de user_profiles.is_premium,
// que un webhook de RevenueCat actualizaría en el servidor.
// ─────────────────────────────────────────────────────────

export type Feature = 'body_scan' | 'coach' | 'coach_chat' | 'food_scan' | 'regenerate_plan' | 'fridge_scan';

// Qué puede hacer el plan GRATIS. Lo no listado como ilimitado tiene tope.
export const FREE_LIMITS = {
  foodScansPerDay: 3,
  fridgeScansPerDay: 1,
  coachMessagesPerDay: 5, // el chat con el coach IA se prueba gratis (5/día)
  bodyScan: false,        // premium
  coach: false,           // premium (coach de postura)
  regeneratePlan: false,  // premium
};

export const PLANS = {
  monthly: { id: 'gymup_premium_monthly', price: '$9.99', period: 'mes' },
  yearly:  { id: 'gymup_premium_yearly',  price: '$79.99', period: 'año', save: '33%' },
};

export const PREMIUM_BENEFITS = [
  '📷 Análisis corporal ilimitado',
  '🧠 Coach de postura con IA',
  '🍽️ Escaneos de comida ilimitados',
  '🔄 Regenera tu plan cuando quieras',
  '📈 Predicción de resultados',
  '🚫 Sin anuncios',
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
