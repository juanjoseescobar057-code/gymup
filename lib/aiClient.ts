// lib/aiClient.ts
// ─────────────────────────────────────────────────────────
// Punto ÚNICO desde el que la app habla con la IA.
//
// En producción debe ir por el proxy (Edge Function ai-proxy), para que
// la API key de OpenAI NO viaje en el cliente. Si EXPO_PUBLIC_AI_PROXY_URL
// está configurada, se usa el proxy con el JWT del usuario.
//
// Solo como fallback de DESARROLLO (sin proxy configurado) se llama a OpenAI
// directo con EXPO_PUBLIC_OPENAI_API_KEY. Esa key NO debe incluirse en
// builds de producción.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { captureError } from './monitoring';
import { computeCostUsd } from './aiMetrics';
import { logAiCall } from './aiTelemetry';

const PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '';
const DIRECT_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

// Timeout duro: sin esto, en redes móviles inestables una llamada podía
// colgarse minutos con el usuario mirando un spinner.
const AI_TIMEOUT_MS = 60_000;

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

// La llamada cruda, sin telemetría (proxy o directo).
async function aiChatRaw(body: object, feature: AIFeature): Promise<any> {
  // ── Camino seguro: proxy backend ──
  if (PROXY_URL) {
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
      captureError(new Error(`ai-proxy ${res.status}`), { status: res.status, msg });
      if (res.status === 429) throw new Error('Alcanzaste el límite de IA de hoy. Vuelve mañana o pásate a Premium.');
      if (res.status === 402) throw new Error('Esta función es Premium. Suscríbete para usarla.');
      throw new Error(`IA no disponible (${res.status}): ${msg}`);
    }
    return res.json();
  }

  // ── Fallback de desarrollo: directo a OpenAI ──
  if (!DIRECT_KEY) {
    throw new Error('IA no configurada. Define EXPO_PUBLIC_AI_PROXY_URL (producción) o EXPO_PUBLIC_OPENAI_API_KEY (desarrollo).');
  }
  if (!__DEV__) {
    // Aviso en runtime si por error se publica sin proxy.
    console.warn('[aiClient] ⚠️ Usando OpenAI directo en producción. Configura el proxy ai-proxy.');
  }
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DIRECT_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
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
