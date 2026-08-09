// lib/aiClient.ts
// ─────────────────────────────────────────────────────────
// Punto ÚNICO desde el que la app habla con la IA.
//
// TODA llamada va por el proxy (Edge Function ai-proxy) con el JWT del usuario.
// NO hay camino directo a OpenAI, tampoco en desarrollo, por dos razones:
//  1. La política de privacidad publicada promete que la app nunca llama a
//     OpenAI directamente y que la key vive solo en el servidor. Un fallback
//     "solo de desarrollo" que puede ejecutarse en producción convierte esa
//     promesa en falsa: basta con que falte una variable de entorno.
//  2. Cualquier EXPO_PUBLIC_* queda incrustada en el bundle JS y se extrae del
//     APK con herramientas triviales, así que una key de OpenAI en el cliente
//     es una key filtrada, no una key "de desarrollo".
//
// Si el proxy no está configurado la IA simplemente no funciona: preferimos un
// error claro a una fuga de datos silenciosa.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';
import { computeCostUsd } from './aiMetrics';
import { logAiCall } from './aiTelemetry';
import { codigoDeError } from './aiErrorCodes';
export { codigoDeError } from './aiErrorCodes';

const PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '';

// Timeout duro: sin esto, en redes móviles inestables una llamada podía
// colgarse minutos con el usuario mirando un spinner.
const AI_TIMEOUT_MS = 60_000;

// La clasificación de errores del proveedor vive en lib/aiErrorCodes.ts,
// pura y con tests: garantiza que a Sentry no llegue contenido del prompt.

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Tag de feature para que el servidor aplique entitlement/topes por función. */
export type AIFeature =
  | 'plan' | 'food_scan' | 'fridge_scan' | 'body_scan'
  | 'coach' | 'coach_chat' | 'suggestion' | 'notification' | 'scoring' | 'general';

/** Metadatos opcionales de observabilidad para una llamada. */
export type AIMeta = {
  turnCount?: number;                        // nº de turno (chat)
  conversationId?: string;                   // agrupa llamadas de una conversación
  decision?: Record<string, unknown>;        // insumos con los que decidió el agente
  onLogged?: (telemetryId: string | null) => void; // para adjuntar score después
};

// La llamada cruda, sin telemetría. Único camino: el proxy.
async function aiChatRaw(body: object, feature: AIFeature): Promise<any> {
  // Se valida en cada llamada y no al importar el módulo: sin proxy la app debe
  // arrancar igual, solo que las funciones de IA fallan con un mensaje entendible.
  if (!PROXY_URL) {
    throw new Error('IA no disponible: falta configurar el proxy de IA (EXPO_PUBLIC_AI_PROXY_URL). La app nunca llama al proveedor de IA directamente.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sesión no válida para usar la IA.');

  const res = await fetchWithTimeout(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-gymup-feature': feature,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    // El cuerpo del proveedor NO se reporta. Truncarlo a 200 caracteres no era
    // sanearlo: los primeros 200 caracteres de un error de OpenAI son justo
    // donde empieza a citarse el prompt, y el prompt lleva las directivas de
    // salud de la persona. Lo que va a Sentry es solo lo que sirve para
    // diagnosticar sin arrastrar contenido: el estado HTTP, un código propio
    // derivado del cuerpo, y su longitud.
    captureError(new Error(`ai-proxy ${res.status}`), {
      status: res.status,
      codigo: codigoDeError(msg),
      largo_respuesta: msg.length,
    });
    if (res.status === 429) throw new Error('Alcanzaste el límite de IA de hoy. Vuelve mañana o pásate a Premium.');
    if (res.status === 402) throw new Error('Esta función es Premium. Suscríbete para usarla.');
    // Tampoco aquí: este mensaje lo ve el usuario Y lo guarda logAiCall en
    // ai_telemetry. Adjuntar `msg` metía el cuerpo del proveedor —con el
    // prompt dentro— en nuestra propia base por la puerta de atrás.
    throw new Error(`IA no disponible (${res.status}). Inténtalo de nuevo en un momento.`);
  }
  return res.json();
}

/**
 * Llama a la IA y devuelve la respuesta cruda (formato OpenAI chat/completions).
 * OBSERVABILIDAD PROPIA: cada llamada (éxito o error) queda registrada con
 * latencia real, tokens, costo exacto en USD, feature, turno y contexto de
 * decisión. El registro corre en segundo plano y jamás bloquea ni rompe.
 */
export async function aiChat(body: object, feature: AIFeature = 'general', meta?: AIMeta): Promise<any> {
  const t0 = Date.now();
  const requestedModel = (body as any)?.model ?? null;
  try {
    const data = await aiChatRaw(body, feature);
    const usage = data?.usage ?? {};
    const model = data?.model ?? requestedModel;
    logAiCall({
      feature,
      model,
      ok: true,
      latencyMs: Date.now() - t0,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      costUsd: computeCostUsd(model, usage.prompt_tokens, usage.completion_tokens),
      turnCount: meta?.turnCount ?? null,
      conversationId: meta?.conversationId ?? null,
      decision: meta?.decision ?? null,
    }).then((id) => meta?.onLogged?.(id)).catch(() => meta?.onLogged?.(null));
    return data;
  } catch (e: any) {
    logAiCall({
      feature,
      model: requestedModel,
      ok: false,
      error: e?.message ?? 'error',
      latencyMs: Date.now() - t0,
      turnCount: meta?.turnCount ?? null,
      conversationId: meta?.conversationId ?? null,
      decision: meta?.decision ?? null,
    }).catch(() => {});
    throw e;
  }
}

/** Atajo que devuelve el texto del primer choice. */
export async function aiChatContent(body: object, feature: AIFeature = 'general', meta?: AIMeta): Promise<string> {
  const data = await aiChat(body, feature, meta);
  return data.choices[0].message.content;
}
