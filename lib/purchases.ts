// lib/purchases.ts
// ─────────────────────────────────────────────────────────
// PAGOS REALES (RevenueCat sobre la facturación de las tiendas).
//
// Por política de Apple/Google, las suscripciones digitales DEBEN cobrarse
// por In-App Purchase de la tienda — no Stripe/PayU dentro de la app.
// RevenueCat es la capa estándar sobre ambas tiendas: maneja recibos,
// renovaciones y entitlements, y manda webhooks al backend.
//
// Flujo completo:
//   1. App: Purchases.configure(apiKey, appUserID = user_id de Supabase).
//   2. Usuario compra → la tienda cobra → RevenueCat activa el entitlement
//      "premium" → webhook a la Edge Function rc-webhook.
//   3. rc-webhook (service role) actualiza user_profiles.is_premium — la
//      ÚNICA vía de escritura de esa columna (el cliente tiene el UPDATE
//      revocado a nivel de columna en SQL). El proxy de IA ya la lee.
//
// react-native-purchases es un MÓDULO NATIVO: requiere rebuild del dev
// client. Hasta entonces, este módulo degrada con gracia (require lazy)
// y devuelve un error amable en vez de crashear.
// ─────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { track } from './analytics';

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_RC_API_KEY_IOS ?? '',
  android: process.env.EXPO_PUBLIC_RC_API_KEY_ANDROID ?? '',
}) ?? '';

export const PREMIUM_ENTITLEMENT = 'premium';

const NOT_READY =
  'Pagos aún no disponibles en esta build. (Requiere el rebuild con RevenueCat y las keys configuradas.)';

let configured = false;
// uid con el que el SDK está configurado actualmente. Si cambia (nueva
// sesión tras logout, sin matar el proceso), hay que re-identificar al SDK
// — de lo contrario queda atado al usuario ANTERIOR y le atribuye compras
// o entitlements de otra cuenta.
let configuredForUid: string | null = null;

// Carga perezosa: si el módulo nativo no está en esta build, no crashea.
function rc(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-purchases').default;
  } catch {
    return null;
  }
}

/** Configura RevenueCat con la identidad del usuario (idempotente por uid). */
async function ensureConfigured(): Promise<any | null> {
  const P = rc();
  if (!P || !API_KEY) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return null;
  if (configured && configuredForUid === uid) return P;
  if (configured && configuredForUid !== uid) {
    // Cambio de usuario en el mismo proceso: re-identificar el SDK.
    try { await P.logIn(uid); } catch { await P.configure({ apiKey: API_KEY, appUserID: uid }); }
  } else {
    await P.configure({ apiKey: API_KEY, appUserID: uid });
  }
  configured = true;
  configuredForUid = uid;
  return P;
}

/**
 * Desvincula el SDK del usuario actual. Llamar SIEMPRE en logout/borrado de
 * cuenta — sin esto, si un segundo usuario inicia sesión en el mismo
 * proceso (flujo normal: signOut → onboarding → login), el SDK sigue
 * atado al appUserID anterior y le atribuye entitlements/compras ajenas.
 */
export async function resetPurchasesIdentity(): Promise<void> {
  const P = rc();
  configured = false;
  configuredForUid = null;
  if (!P) return;
  try {
    await P.logOut();
  } catch {
    // Sin sesión previa de RevenueCat que cerrar, o SDK no inicializado: no es un error.
  }
}

function hasPremium(customerInfo: any): boolean {
  return !!customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT];
}

/** Refleja el entitlement en el store local (optimista; el webhook es la verdad). */
async function syncLocalPremium(active: boolean): Promise<void> {
  try {
    const { useUserStore } = require('../store/userStore');
    const s = useUserStore.getState();
    if (s.profile && s.profile.is_premium !== active) {
      s.setProfile({ ...s.profile, is_premium: active });
    }
  } catch {}
}

/** Compra el plan (product id de la tienda, ej. gymup_premium_monthly). */
export async function purchasePlan(planId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const P = await ensureConfigured();
    if (!P) return { ok: false, error: NOT_READY };

    // Buscar el paquete cuyo producto coincide con el plan pedido. Coincidencia
    // exacta o con el separador ':' de Play Billing (base plan id) — un
    // startsWith desnudo matchearía de más si algún día existe un plan cuyo
    // id es prefijo de otro (ej. "..._monthly" vs "..._monthly_promo").
    const offerings = await P.getOfferings();
    const packages = offerings?.current?.availablePackages ?? [];
    const pkg = packages.find((p: any) => {
      const id = p?.product?.identifier ?? '';
      return id === planId || id.startsWith(`${planId}:`);
    });
    if (!pkg) return { ok: false, error: 'Plan no disponible en la tienda todavía.' };

    const { customerInfo } = await P.purchasePackage(pkg);
    if (!hasPremium(customerInfo)) {
      return { ok: false, error: 'La compra no activó Premium. Intenta restaurar.' };
    }
    await syncLocalPremium(true);
    return { ok: true };
  } catch (e: any) {
    if (e?.userCancelled) {
      track('purchase_cancelled', { plan: planId });
      return { ok: false, error: 'Compra cancelada.' };
    }
    return { ok: false, error: e?.message ?? 'Error de la tienda.' };
  }
}

/** Restaura compras previas (reinstalación / cambio de dispositivo). */
export async function restorePurchases(): Promise<{ ok: boolean; error?: string }> {
  try {
    const P = await ensureConfigured();
    if (!P) return { ok: false, error: NOT_READY };
    const customerInfo = await P.restorePurchases();
    const active = hasPremium(customerInfo);
    await syncLocalPremium(active);
    return active
      ? { ok: true }
      : { ok: false, error: 'No encontramos compras activas para restaurar.' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error restaurando.' };
  }
}

/** Consulta el entitlement actual (para re-sincronizar al abrir la app). */
export async function checkPremium(): Promise<boolean | null> {
  try {
    const P = await ensureConfigured();
    if (!P) return null;
    const customerInfo = await P.getCustomerInfo();
    const active = hasPremium(customerInfo);
    await syncLocalPremium(active);
    return active;
  } catch {
    return null;
  }
}
