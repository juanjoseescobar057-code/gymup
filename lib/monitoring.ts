// lib/monitoring.ts
// ─────────────────────────────────────────────────────────
// Capa de observabilidad. Hoy la app manda los errores a console.log
// y se pierden en producción. Esto centraliza el reporte de errores y
// deja todo listo para enchufar Sentry sin tocar el resto del código.
//
// Para activar Sentry:
//   1. npx expo install @sentry/react-native
//   2. Definir EXPO_PUBLIC_SENTRY_DSN
//   3. Descomentar las líneas marcadas con // SENTRY abajo.
// Mientras tanto, funciona como logger seguro (no rompe si no hay DSN).
// ─────────────────────────────────────────────────────────

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let initialized = false;

export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;
  if (!DSN) {
    if (__DEV__) console.log('[monitoring] Sin DSN — modo logger local.');
    return;
  }
  // SENTRY: import * as Sentry from '@sentry/react-native';
  // SENTRY: Sentry.init({ dsn: DSN, tracesSampleRate: 0.2, enableNativeCrashHandling: true });
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
  if (!DSN) return;
  // SENTRY: import * as Sentry from '@sentry/react-native';
  // SENTRY: Sentry.captureException(err, { extra: context });
}

/** Rastro de navegación/acción para depurar errores posteriores. */
export function breadcrumb(message: string, data?: Record<string, unknown>): void {
  if (__DEV__) console.log('[breadcrumb]', message, data ?? '');
  // SENTRY: Sentry.addBreadcrumb({ message, data });
}
