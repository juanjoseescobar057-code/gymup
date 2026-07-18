// lib/monitoring.ts
// ─────────────────────────────────────────────────────────
// Capa de observabilidad. Reporta errores a Sentry (si hay DSN) y siempre
// a console.log + analítica propia, para que un error nunca se pierda en
// silencio — ver EXPO_PUBLIC_SENTRY_DSN en .env.local.
//
// ⚠️ @sentry/react-native resuelve su módulo nativo (RNSentry) con
// TurboModuleRegistry.getEnforcing() en el import de nivel superior del
// paquete — eso LANZA de inmediato si el nativo no está linkeado (dev
// client sin rebuildear), igual que expo-secure-store en lib/supabase.ts.
// Un `import * as Sentry from '@sentry/react-native'` estático arriba de
// este archivo crashearía la app ENTERA al arrancar. Con require() dentro
// de un try/catch, el fallo queda contenido y se degrada con gracia a
// logger local hasta el próximo build nativo.
// ─────────────────────────────────────────────────────────

type SentryModule = typeof import('@sentry/react-native');
let Sentry: SentryModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Sentry = require('@sentry/react-native');
} catch {
  Sentry = null;
}

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let initialized = false;

export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;
  if (!DSN || !Sentry) {
    if (__DEV__) {
      console.log(
        !DSN
          ? '[monitoring] Sin DSN — modo logger local.'
          : '[monitoring] Sentry no disponible en este build (falta rebuild nativo) — modo logger local.'
      );
    }
    return;
  }
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.2,
    enableNativeCrashHandling: true,
    debug: __DEV__,
  });
  if (__DEV__) console.log('[monitoring] Sentry inicializado.');
}

/** Reporta un error con contexto. Úsalo en los catch importantes. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.log('[error]', err.message, context ?? '');
  // Analítica propia: TODO error capturado es un evento medible (¿qué
  // pantalla/feature falla más? ¿los errores predicen churn?). Import lazy
  // para no crear ciclos ni costo si analytics aún no inicializa.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { track } = require('./analytics');
    track('error_shown', { message: err.message.slice(0, 120), ...(context ?? {}) });
  } catch {}
  if (!DSN || !Sentry) return;
  Sentry.captureException(err, { extra: context });
}

/** Rastro de navegación/acción para depurar errores posteriores. */
export function breadcrumb(message: string, data?: Record<string, unknown>): void {
  if (__DEV__) console.log('[breadcrumb]', message, data ?? '');
  if (!DSN || !Sentry) return;
  Sentry.addBreadcrumb({ message, data });
}
