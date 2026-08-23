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
    // 0.2 era demasiado para escalar: a un millón de personas son doscientas mil
    // trazas de rendimiento, que no se leen y sí se pagan. Los CRASHES van
    // aparte y siguen al 100%: esto solo muestrea trazas de rendimiento.
    tracesSampleRate: __DEV__ ? 1.0 : 0.02,
    enableNativeCrashHandling: true,
    debug: __DEV__,
    sendDefaultPii: false,
    // `as any` porque el tipo de Sentry exige devolver su ErrorEvent completo y
    // aquí se trabaja con el objeto genérico: las funciones DEVUELVEN el mismo
    // evento que reciben, solo con los valores sensibles sustituidos, así que la
    // forma no cambia. Tiparlo del todo obligaría a importar los tipos del SDK
    // en un módulo que tiene que poder cargarse sin él.
    beforeSend: limpiarEvento as any,
    beforeBreadcrumb: limpiarMiga as any,
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
    // El MISMO filtro que Sentry. El contexto de un captureError es libre y
    // acaba en la analítica propia igual que en el tercero: filtrar solo en
    // Sentry dejaba el peso, las condiciones médicas y los prompts saliendo por
    // la otra puerta.
    //
    // No cambia qué se mide: el evento se llama igual y lleva los mismos
    // campos. Lo que cambia es que un valor sensible viaja como '[oculto]'.
    track('error_shown', {
      message: limpiarTexto(err.message).slice(0, 120),
      ...(limpiar(context ?? {}) as Record<string, unknown>),
    });
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

// ─────────────────────────────────────────────────────────
// LO QUE NO SALE DEL TELÉFONO
//
// Sentry es un tercero, y esta app maneja datos de salud: tamizaje PAR-Q+,
// lesiones, condiciones médicas, peso, macros y estimaciones corporales. Un
// mensaje de error puede arrastrar cualquiera de esas cosas sin querer —
// captureError acepta un objeto de contexto libre, y los mensajes de la base de
// datos citan valores.
//
// No había ningún filtro. Esto no es paranoia: mandar un trastorno de la
// conducta alimentaria declarado a un proveedor de observabilidad es un
// tratamiento de datos sensibles que nadie autorizó.
// ─────────────────────────────────────────────────────────

/** Claves cuyo VALOR nunca viaja, mire donde mire. */
const CLAVES_SENSIBLES = [
  'weight', 'peso', 'weight_kg', 'target_weight_kg', 'goal_start_weight_kg',
  'calories', 'daily_calories', 'protein', 'carbs', 'fat', 'macros',
  'conditions', 'injuries', 'health', 'salud', 'parq', 'risk_level',
  'estimated_fat_pct', 'fat_pct', 'overall_score', 'body',
  'email', 'correo', 'name', 'nombre', 'nickname',
  'content', 'prompt', 'messages', 'respuesta', 'note', 'other_note',
  'base64', 'photo', 'foto', 'uri',
];

const SUSTITUTO = '[oculto]';

function esSensible(clave: string): boolean {
  const k = clave.toLowerCase();
  return CLAVES_SENSIBLES.some((s) => k.includes(s));
}

/**
 * Recorre un objeto y sustituye los valores sensibles.
 *
 * Con tope de profundidad: un objeto cíclico o muy anidado no puede colgar el
 * envío de un crash — que es justo cuando más falta hace que llegue.
 */
function limpiar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 6) return SUSTITUTO;
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => limpiar(v, profundidad + 1));
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      out[k] = esSensible(k) ? SUSTITUTO : limpiar(v, profundidad + 1);
    }
    return out;
  }
  // Cadenas largas: casi siempre son contenido, no un identificador.
  if (typeof valor === 'string' && valor.length > 500) return valor.slice(0, 200) + '…[recortado]';
  return valor;
}

/** Correos y data-URI que se cuelan dentro de un texto libre. */
function limpiarTexto(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '[imagen]');
}

function limpiarEvento(evento: Record<string, any>): Record<string, any> | null {
  try {
    if (evento.extra) evento.extra = limpiar(evento.extra) as Record<string, unknown>;
    if (evento.contexts) evento.contexts = limpiar(evento.contexts) as Record<string, unknown>;
    if (evento.request?.data) evento.request.data = SUSTITUTO;
    // El usuario: solo el id, que es lo que hace falta para agrupar.
    if (evento.user) evento.user = { id: evento.user.id };
    if (typeof evento.message === 'string') evento.message = limpiarTexto(evento.message);
    for (const v of evento.exception?.values ?? []) {
      if (typeof v.value === 'string') v.value = limpiarTexto(v.value);
    }
    return evento;
  } catch {
    // Si la limpieza falla, NO se manda. Un crash perdido es peor que nada;
    // un dato de salud filtrado es peor que un crash perdido.
    return null;
  }
}

function limpiarMiga(miga: Record<string, any>): Record<string, any> | null {
  try {
    if (miga.data) miga.data = limpiar(miga.data) as Record<string, unknown>;
    if (typeof miga.message === 'string') miga.message = limpiarTexto(miga.message);
    return miga;
  } catch {
    return null;
  }
}

/** Solo para tests. */
export const _sentryScrub = { limpiar, limpiarTexto, limpiarEvento, esSensible };
