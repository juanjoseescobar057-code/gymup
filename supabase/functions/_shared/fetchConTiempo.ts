// supabase/functions/_shared/fetchConTiempo.ts
// ─────────────────────────────────────────────────────────
// fetch que se rinde.
//
// Ninguna de las llamadas salientes tenía tiempo límite: ni a OpenAI, ni a la
// API de RevenueCat. Un proveedor que acepta la conexión y se queda callado
// deja la Edge Function colgada hasta que la mata la plataforma — y mientras
// tanto la persona ve un spinner eterno, sin error y sin poder reintentar.
//
// Peor en ai-proxy: la reserva de presupuesto ya está hecha cuando se llama, así
// que un cuelgue le cobra a alguien una llamada que nunca ocurrió.
//
// Rendirse a tiempo es lo que permite decir "no se pudo, reintenta".
// ─────────────────────────────────────────────────────────

/** Lo que tarda de más una llamada normal a OpenAI con visión. */
export const TIEMPO_OPENAI_MS = 60_000;

/** RevenueCat es una consulta de estado: si tarda más, algo va mal. */
export const TIEMPO_REVENUECAT_MS = 10_000;

export class TiempoAgotado extends Error {
  constructor(ms: number) {
    super(`el proveedor no respondió en ${ms} ms`);
    this.name = 'TiempoAgotado';
  }
}

/**
 * fetch con AbortController. Lanza TiempoAgotado si se pasa del tiempo.
 *
 * El timer se limpia SIEMPRE. Dejarlo vivo mantiene la función despierta después
 * de haber respondido, y en un entorno que cobra por invocación eso se paga.
 */
export async function fetchConTiempo(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new TiempoAgotado(ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
