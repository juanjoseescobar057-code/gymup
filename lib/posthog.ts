// lib/posthog.ts
// ─────────────────────────────────────────────────────────
// Adaptador de PostHog.
//
// NO reemplaza la analítica propia de lib/analytics.ts: la duplica hacia
// PostHog. Los eventos, la identidad y el catálogo siguen siendo los nuestros
// (ver ANALYTICS.md) y siguen guardándose en `analytics_events`, que es la
// fuente de verdad. PostHog aporta lo que no tenemos y que no vale la pena
// construir: session replay, embudos y retención sin escribir SQL, y feature
// flags para experimentos.
//
// Identidad: se reusa el `anonymous_id` propio como distinct_id antes del
// registro y se hace `identify()` al `user_id` de Supabase cuando existe. Así
// una misma persona no aparece como dos usuarios distintos en PostHog, y su
// actividad pre-registro queda unida — igual que en nuestra tabla.
//
// PRIVACIDAD — esto es una app de salud, no un e-commerce:
//   • El enmascarado va al máximo: TODO texto e imagen se enmascara en el
//     replay. No se confía en el ajuste del panel de PostHog; se fija aquí.
//   • La grabación se APAGA por completo en las pantallas donde hay datos
//     sensibles (fotos corporales, tamizaje de salud, chat con el coach). El
//     enmascarado de PostHog en React Native es bastante menos maduro que en
//     web, y una foto corporal filtrada no se arregla pidiendo perdón.
//   • `captureLog: false`: los console.log de la app arrastran mensajes de
//     error con datos del usuario, y para errores ya está Sentry.
//   • Nunca se envía contenido libre: props de producto, como en analytics.ts.
// ─────────────────────────────────────────────────────────

import PostHog from 'posthog-react-native';
import { captureError } from './monitoring';
import { getSessionReplayConsent, saveSessionReplayConsent } from './privacyPreferences';
import { esRutaSensible } from './replayRoutes';
export { esRutaSensible, RUTAS_SIN_GRABACION } from './replayRoutes';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

// La lista de rutas que nunca se graban vive en lib/replayRoutes.ts, con sus
// tests: es una promesa escrita en la política de privacidad publicada.

let ph: PostHog | null = null;
let replayPausado = false;
let replayConsent = false;


/** Arranca PostHog. Sin key configurada es un no-op silencioso. */
export async function initPostHog(distinctId?: string): Promise<void> {
  if (ph || !KEY) return;
  try {
    replayConsent = await getSessionReplayConsent();
    ph = new PostHog(KEY, {
      host: HOST,
      // Nuestra capa ya emite screen_viewed con dwell time y `from`. Dejar que
      // PostHog capture navegación y toques por su cuenta duplicaría eventos y
      // rompería la correspondencia con `analytics_events`.
      captureAppLifecycleEvents: false,
      // ARRANCA SIEMPRE DETENIDO, aunque haya consentimiento.
      //
      // Había una carrera: la navegación llama a ajustarReplayPorRuta, que
      // retorna sin hacer nada porque PostHog aún no existe; PostHog termina de
      // arrancar con la grabación activada; y nadie vuelve a comprobar la ruta.
      // Resultado: se grababa la pantalla en la que estuviera la persona en ese
      // instante, que puede ser el tamizaje de salud o el análisis corporal.
      //
      // Con esto, arrancar no puede grabar nada: la grabación solo empieza
      // cuando ajustarReplayPorRuta ve una ruta de la lista blanca.
      enableSessionReplay: false,
      sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureLog: false,
      },
    });
    if (distinctId) ph.identify(distinctId);
    // La grabación arrancó detenida, así que este es el estado real.
    replayPausado = true;
    // Y se evalúa la ruta ACTUAL, que es el paso que faltaba: sin esto, la
    // grabación nunca empezaría (o empezaría donde no debe).
    if (rutaActual !== null) ajustarReplayPorRuta(rutaActual);
  } catch (e) {
    // Que la analítica de terceros no arranque no puede tumbar la app.
    captureError(e, { scope: 'initPostHog' });
    ph = null;
  }
}

/**
 * Propiedades que NUNCA salen del dispositivo hacia PostHog.
 *
 * El fanout hacia PostHog se montó reenviando lo que ya emitía track(), sin
 * auditar qué llevaba cada uno de los 41 eventos. Resultado: eventos como
 * `health_screening_completed` mandaban nivel de riesgo, número de condiciones,
 * número de lesiones y si tenía visto bueno médico. Eso es dato de salud en un
 * procesador externo, contradice el comentario de este módulo Y contradice la
 * política de privacidad, que promete que la salud se usa exclusivamente para
 * seguridad y personalización.
 *
 * Se filtran las PROPS, no los eventos: saber que alguien completó el tamizaje
 * es un paso de embudo legítimo y no revela nada de su salud; saber que su
 * riesgo era "alto" sí. Los eventos siguen llegando completos a nuestra propia
 * tabla `analytics_events`, que es first-party y sí está cubierta por la
 * política.
 *
 * Regla para el futuro: ante la duda, va en esta lista. Un embudo con una
 * dimensión menos se arregla; un dato de salud enviado a un tercero, no.
 */
const PROPS_SENSIBLES = new Set([
  // El tamizaje diario de bienestar. workout_readiness_submitted los emite
  // todos, y la lista no cubría ninguno: energía, sueño, estrés, agujetas y
  // dolor nuevo salían enteros hacia un tercero. Lo delator es que la lista SÍ
  // tenía 'pain' — se pensó en el dolor y se escribió la clave equivocada, que
  // en el evento se llama 'pain_new'.
  'energy', 'sleep_quality', 'sleep', 'stress', 'soreness', 'pain_new',
  'available_minutes', 'risk_level', 'experience', 'training_experience',
  // Salud
  'risk_level', 'conditions', 'injuries', 'doctor_cleared', 'zone', 'zones',
  'condition', 'injury', 'pain', 'medical',
  // Atributos personales
  'sex', 'age', 'weight', 'weight_kg', 'height_cm', 'target_weight_kg',
  // Nutrición (ingesta calórica es dato de salud en la práctica)
  'calories', 'protein_g', 'carbs_g', 'fat_g',
  // Texto libre que pudiera colarse
  'msg', 'note', 'other_note', 'content', 'goal_why',
]);

/**
 * Deja las props en algo que PostHog acepta (JSON plano) y quita lo sensible.
 * Además de satisfacer al tipo, es una red de seguridad: si algún `track()`
 * mandara por error un objeto grande o una instancia rara, aquí se corta en
 * vez de viajar entero a un tercero.
 */
function aJson(props?: Record<string, unknown>): Record<string, string | number | boolean | null> | undefined {
  if (!props) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(props)) {
    if (PROPS_SENSIBLES.has(k)) continue; // no sale del dispositivo
    if (v == null) out[k] = null;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = String(v).slice(0, 200);
  }
  return out;
}

/** Duplica un evento del catálogo propio hacia PostHog. */
export function phCapture(event: string, props?: Record<string, unknown>): void {
  if (!ph) return;
  try {
    ph.capture(event, aJson(props));
  } catch {}
}

/**
 * Une la actividad anónima previa con el usuario ya registrado.
 * PostHog conserva el historial del distinct_id anterior al hacer alias.
 */
export function phIdentify(userId: string, props?: Record<string, unknown>): void {
  if (!ph) return;
  try {
    ph.identify(userId, aJson(props));
  } catch {}
}

/** Cierre de sesión: deja de atribuirle eventos a quien se fue. */
export function phReset(): void {
  if (!ph) return;
  try {
    ph.reset();
  } catch {}
}

/**
 * Apaga o reanuda la grabación según la pantalla.
 * Se llama en cada cambio de ruta, antes de que la pantalla sensible pinte.
 */
/**
 * La última ruta que nos dijeron, exista PostHog o no.
 *
 * Sin esto, las llamadas de antes del arranque se perdían y al inicializar no
 * había forma de saber dónde estaba la persona.
 */
let rutaActual: string | null = null;

export function ajustarReplayPorRuta(pathname: string): void {
  rutaActual = pathname;
  if (!ph) return;
  try {
    const sensible = !replayConsent || esRutaSensible(pathname);
    if (sensible && !replayPausado) {
      replayPausado = true;
      ph.stopSessionRecording();
    } else if (!sensible && replayPausado) {
      replayPausado = false;
      // `false`: no reanudar la grabación anterior, empezar una nueva. Así el
      // tramo sensible no queda pegado al mismo replay.
      ph.startSessionRecording(false);
    }
  } catch {}
}

/**
 * Aplica de inmediato la decisión y la persiste. Nunca reanuda dentro de una
 * ruta sensible.
 *
 * El orden importa y estaba al revés: se persistía ANTES de detener la
 * grabación, así que si AsyncStorage fallaba (disco lleno, por ejemplo) la
 * función abortaba por excepción y la grabación seguía corriendo mientras la
 * pantalla ya decía "Apagada". Un opt-out que no apaga es peor que no
 * ofrecerlo. Ahora se APAGA primero —que es lo irreversible para el usuario—
 * y el fallo al persistir se reporta sin dejar la grabación viva.
 */
export async function setSessionReplayConsent(granted: boolean, pathname = ''): Promise<void> {
  replayConsent = granted;
  aplicarEstadoReplay(granted, pathname);
  try {
    await saveSessionReplayConsent(granted);
  } catch (e) {
    // Se apagó en esta sesión, pero al reabrir la app volvería al valor
    // guardado. getSessionReplayConsent falla cerrado (false), así que el
    // riesgo real solo existe al CONCEDER, no al revocar.
    captureError(e, { scope: 'setSessionReplayConsent.persistencia', granted });
    if (granted) throw new Error('No pudimos guardar tu preferencia. Inténtalo de nuevo.');
  }
}

function aplicarEstadoReplay(granted: boolean, pathname: string): void {
  if (!ph) return;
  try {
    if (!granted || esRutaSensible(pathname)) {
      replayPausado = true;
      ph.stopSessionRecording();
    } else {
      replayPausado = false;
      ph.startSessionRecording(false);
    }
  } catch {}
}
