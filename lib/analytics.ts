// lib/analytics.ts
// ─────────────────────────────────────────────────────────
// ANALÍTICA CONDUCTUAL PROPIA (Behavioral Intelligence, sin PostHog).
// Ver ANALYTICS.md — el blueprint completo (capas, taxonomía, reglas).
//
// Capa de identidad:
//   • anonymous_id: nace en el primer arranque, NUNCA cambia (también
//     funciona como installation_id: reinstalar la app genera uno nuevo).
//   • session_id: rota tras 30 min de inactividad (estándar industria).
//   • user_id: se adjunta al hacer flush (la cola espera a que exista
//     sesión de Supabase → los eventos pre-registro conservan anonymous_id
//     y quedan unidos al usuario: resolución de identidad).
//
// Garantías:
//   • Nunca bloquea la UI: encolar es síncrono, el envío es por lotes.
//   • Offline-safe: la cola persiste en AsyncStorage y se reintenta.
//   • Nunca rompe la app: todo en try/catch.
//   • Privacidad: eventos y propiedades de PRODUCTO; nada de contenido
//     libre del usuario ni atributos sensibles.
// ─────────────────────────────────────────────────────────

import { AppState, Dimensions, Platform, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import { shouldRotateSession, makeId, pickAcquisitionParams } from './analyticsMath';
import { initPostHog, phCapture, phIdentify } from './posthog';

const ANON_KEY = 'gymup_anonymous_id';
const QUEUE_KEY = 'gymup_analytics_queue_v1';
const ACQ_KEY = 'gymup_acquisition_v1';
const MAX_QUEUE = 500;           // tope duro de cola local
const FLUSH_EVERY_MS = 20_000;   // intento de envío periódico
const FLUSH_BATCH_AT = 12;       // o al acumular N eventos

type QueuedEvent = {
  anonymous_id: string;
  session_id: string;
  seq: number;
  event: string;
  screen: string | null;
  props: Record<string, unknown> | null;
  context: Record<string, unknown>;
  client_ts: string;
  /**
   * Dueño del evento en el momento de encolarlo, si ya había sesión.
   *
   * Antes no existía: al hacer flush se le adjuntaba a TODA la cola el user_id
   * de la sesión vigente en ese instante. Si alguien cerraba sesión con
   * eventos pendientes y entraba otra cuenta en el mismo teléfono, los eventos
   * del primero se guardaban a nombre del segundo — mezcla de actividad entre
   * personas, cohortes contaminadas y un problema de privacidad, no solo de
   * métricas.
   *
   * null = evento anterior al registro. Esos SÍ deben unirse a quien se
   * registre (esa es la resolución de identidad que queremos), pero solo
   * mientras no haya habido un cambio de cuenta: resetAnalyticsIdentity()
   * limpia la cola al cerrar sesión justamente por eso.
   */
  owner_uid?: string | null;
};

let anonymousId: string | null = null;
let sessionId = '';
let sessionStartedAt = 0;
let lastActiveAt: number | null = null;
let seq = 0;
let screensViewed = 0;
let screenEnteredAt = 0;
let queue: QueuedEvent[] = [];
let currentScreen: string | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let flushing = false;
// Último user_id ya identificado en PostHog: identify() en cada flush sería
// una llamada por lote sin ganancia alguna.
let identifiedUid: string | null = null;
let inRotation = false; // evita recursión al emitir session_ended/session_start

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Contexto de dispositivo/app (capa Device): una foto por evento, barata. */
function deviceContext(): Record<string, unknown> {
  const { width, height } = Dimensions.get('window');
  let locale = 'unknown', timezone = 'unknown';
  try {
    const ro = Intl.DateTimeFormat().resolvedOptions();
    locale = ro.locale ?? 'unknown';
    timezone = ro.timeZone ?? 'unknown';
  } catch {}
  // Identidad del hardware: responde "¿desde qué celulares entra la gente?"
  // (segmentar crashes de cámara, rendimiento del modelo de pose, gama del
  // parque instalado). expo-device expone constantes síncronas; try/catch por
  // si el módulo nativo no está en un build viejo.
  let brand: string | null = null, model: string | null = null;
  let device_year: number | null = null, total_memory_gb: number | null = null;
  try {
    brand = Device.brand;                 // ej. "samsung"
    model = Device.modelName;             // ej. "SM-A515F" / "Galaxy A51"
    device_year = Device.deviceYearClass; // gama aproximada del equipo
    total_memory_gb = Device.totalMemory != null
      ? Math.round(Device.totalMemory / (1024 ** 3))
      : null;
  } catch {}
  return {
    platform: Platform.OS,
    os_version: String(Platform.Version),
    app_version: Constants.expoConfig?.version ?? 'dev',
    brand,
    model,
    device_year,
    total_memory_gb,
    screen_w: Math.round(width),
    screen_h: Math.round(height),
    dark_mode: Appearance.getColorScheme() === 'dark',
    locale,
    timezone,
  };
}

async function getAnonymousId(): Promise<string> {
  if (anonymousId) return anonymousId;
  try {
    const existing = await AsyncStorage.getItem(ANON_KEY);
    if (existing) { anonymousId = existing; return existing; }
  } catch {}
  const fresh = makeId('a', Date.now(), rand());
  anonymousId = fresh;
  AsyncStorage.setItem(ANON_KEY, fresh).catch(() => {});
  return fresh;
}

// Persiste cola + estado de sesión (para reanudar tras un kill de la app y
// poder cerrar la sesión anterior con su duración real — cierre "perezoso").
function persistState(): void {
  AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify({
      q: queue.slice(-MAX_QUEUE),
      s: { id: sessionId, startedAt: sessionStartedAt, lastActiveAt, seq, screens: screensViewed },
    })
  ).catch(() => {});
}

/**
 * Garantiza una sesión vigente. Si hubo >30 min de inactividad: emite
 * session_ended para la sesión anterior (con duración REAL = último evento
 * menos inicio, aunque la app haya muerto en el medio) y abre una nueva.
 */
function ensureSession(now = Date.now()): void {
  if (!shouldRotateSession(lastActiveAt, now)) {
    lastActiveAt = now;
    return;
  }
  inRotation = true;
  try {
    // ¿Cuántos días estuvo ausente? (para el evento comeback de reactivación)
    const daysAway = lastActiveAt != null ? Math.floor((now - lastActiveAt) / 86_400_000) : 0;
    if (sessionId && sessionStartedAt > 0) {
      const durationSec = Math.max(0, Math.round(((lastActiveAt ?? sessionStartedAt) - sessionStartedAt) / 1000));
      track('session_ended', { duration_sec: durationSec, screens: screensViewed, events: seq });
    }
    sessionId = makeId('s', now, rand());
    sessionStartedAt = now;
    seq = 0;
    screensViewed = 0;
    lastActiveAt = now;
    track('session_start');
    // Volvió tras 3+ días fuera: medir qué lo trajo de vuelta (push, orgánico)
    // cruzando con push_opened/acquisition en la misma sesión.
    if (daysAway >= 3) track('comeback', { days_away: daysAway });
  } finally {
    inRotation = false;
  }
}

/**
 * Registra un evento de producto. Síncrono y ultra barato (encola).
 * Convención de nombres: dominio_accion en snake_case (ver ANALYTICS.md).
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (!anonymousId) return; // init() aún no corrió: se pierde solo el arranque frío
    if (!inRotation) ensureSession(Date.now()); // rota también si quedó idle en foreground
    lastActiveAt = Date.now();
    seq += 1;
    queue.push({
      anonymous_id: anonymousId,
      session_id: sessionId,
      seq,
      event,
      screen: currentScreen,
      props: props ?? null,
      context: deviceContext(),
      client_ts: new Date().toISOString(),
      // Se sella el dueño AL ENCOLAR, no al enviar. `identifiedUid` lo mantiene
      // el flush y lo limpia resetAnalyticsIdentity().
      owner_uid: identifiedUid,
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persistState();
    if (queue.length >= FLUSH_BATCH_AT) flush();
    // Duplicado hacia PostHog. Va DESPUÉS de encolar y en su propio try: la
    // fuente de verdad es `analytics_events`, y un fallo del tercero no puede
    // costarnos un evento propio. Se le adjunta la pantalla y la sesión para
    // que sus embudos coincidan con los nuestros.
    phCapture(event, {
      ...(props ?? {}),
      screen: currentScreen,
      gymup_session_id: sessionId,
    });
  } catch {}
}

/** Capa de navegación: pantalla vista + CUÁNTO duró la anterior (dwell time). */
export function trackScreen(pathname: string): void {
  if (!pathname || pathname === currentScreen) return;
  const now = Date.now();
  const prev = currentScreen;
  // Duración de la pantalla que se abandona (si es de esta misma sesión).
  const dwell = prev && screenEnteredAt > 0 && now - screenEnteredAt < 30 * 60_000
    ? now - screenEnteredAt
    : null;
  currentScreen = pathname;
  screenEnteredAt = now;
  screensViewed += 1;
  track('screen_viewed', prev ? { from: prev, ...(dwell != null ? { from_duration_ms: dwell } : {}) } : undefined);
}

/** Envía la cola en lote. Requiere sesión de Supabase (adjunta user_id). */
export async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return; // pre-registro: la cola espera (identidad se resuelve luego)

    // Misma resolución de identidad en PostHog: hasta aquí sus eventos iban
    // con el anonymous_id nuestro como distinct_id; al identificar, PostHog
    // une ese historial anónimo al usuario. Sin esto, la misma persona
    // aparecería como dos usuarios y las cohortes saldrían infladas.
    if (uid !== identifiedUid) {
      identifiedUid = uid;
      phIdentify(uid);
    }

    const batch = queue.slice(0, 50);
    // Un evento sellado con OTRO dueño no se envía a nombre de este usuario.
    // No debería ocurrir (la cola se limpia al cerrar sesión), pero si ocurre
    // se descarta: perder un evento es infinitamente preferible a atribuirle a
    // alguien la actividad de otra persona.
    const propios = batch.filter((e) => e.owner_uid == null || e.owner_uid === uid);
    const ajenos = batch.length - propios.length;
    if (ajenos > 0) {
      // require diferido: monitoring.ts importa track() de este módulo, así que
      // un import estático cruzado sería un ciclo.
      try {
        const { captureError } = require('./monitoring');
        captureError(new Error('Cola de analítica con eventos de otra cuenta'), {
          scope: 'analytics.flush.ajenos',
          descartados: ajenos,
        });
      } catch {}
    }
    if (propios.length === 0) {
      queue = queue.slice(batch.length);
      persistState();
      return;
    }
    const { error } = await supabase
      .from('analytics_events')
      .insert(propios.map(({ owner_uid: _o, ...e }) => ({ user_id: uid, ...e })));
    if (!error) {
      queue = queue.slice(batch.length);
      persistState();
      if (queue.length > 0) { flushing = false; return flush(); } // vaciar resto
    }
  } catch {
    // sin red: la cola persiste y se reintenta en el próximo ciclo
  } finally {
    flushing = false;
  }
}

/** Adquisición: deep link inicial (UTM/cid) + primer arranque. Solo una vez. */
async function captureAcquisitionOnce(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(ACQ_KEY);
    if (done) return;
    const url = await Linking.getInitialURL();
    const params = url ? pickAcquisitionParams(Linking.parse(url).queryParams as any) : {};
    const snapshot = {
      first_open_ts: new Date().toISOString(),
      had_deeplink: !!url,
      ...params,
    };
    await AsyncStorage.setItem(ACQ_KEY, JSON.stringify(snapshot));
    track('acquisition_captured', snapshot);
  } catch {}
}

/**
 * Inicializa el sistema (llamar UNA vez desde el root layout).
 * Restaura la cola pendiente, abre sesión, captura adquisición y arranca
 * el ciclo de envío. Devuelve el unsubscribe del AppState.
 */
/**
 * Corta el vínculo entre este dispositivo y la cuenta que se va.
 *
 * Se llama al cerrar sesión y al borrar la cuenta. Intenta enviar lo que haya
 * pendiente MIENTRAS la sesión sigue viva y después vacía la cola: cualquier
 * evento que sobreviva al cambio de cuenta acabaría atribuido a quien entre
 * después. También reinicia la sesión de analítica, para que la actividad de
 * la persona siguiente no continúe la sesión de la anterior.
 */
export async function resetAnalyticsIdentity(): Promise<void> {
  try {
    await flush();
  } catch {
    // Sin red no se pueden enviar: se descartan igual. Es el sesgo correcto.
  }
  queue = [];
  identifiedUid = null;
  seq = 0;
  screensViewed = 0;
  sessionId = makeId('s', Date.now(), rand());
  sessionStartedAt = Date.now();
  lastActiveAt = null;
  persistState();
}

export async function initAnalytics(): Promise<() => void> {
  if (initialized) return () => {};
  initialized = true;

  await getAnonymousId();
  // PostHog arranca con NUESTRO anonymous_id como distinct_id: así sus eventos
  // pre-registro corresponden uno a uno con los de `analytics_events`.
  initPostHog(anonymousId ?? undefined).catch(() => {});
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) {
      const restored = JSON.parse(raw);
      if (Array.isArray(restored)) {
        queue = restored.slice(-MAX_QUEUE); // formato legado (solo cola)
      } else if (restored && typeof restored === 'object') {
        if (Array.isArray(restored.q)) queue = restored.q.slice(-MAX_QUEUE);
        const s = restored.s;
        if (s && typeof s.id === 'string' && typeof s.startedAt === 'number') {
          // Reanudar la sesión previa: si el kill fue hace <30 min se continúa;
          // si no, ensureSession() la cerrará con su duración real (lazy).
          sessionId = s.id;
          sessionStartedAt = s.startedAt;
          lastActiveAt = typeof s.lastActiveAt === 'number' ? s.lastActiveAt : null;
          seq = typeof s.seq === 'number' ? s.seq : 0;
          screensViewed = typeof s.screens === 'number' ? s.screens : 0;
        }
      }
    }
  } catch {}

  ensureSession();
  captureAcquisitionOnce();

  flushTimer = setInterval(() => { flush(); }, FLUSH_EVERY_MS);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') ensureSession();
    else if (state === 'background' || state === 'inactive') flush();
  });

  return () => {
    sub.remove();
    if (flushTimer) clearInterval(flushTimer);
  };
}
