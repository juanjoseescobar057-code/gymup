// supabase/functions/_shared/payload.ts
// ─────────────────────────────────────────────────────────
// Lo que se comprueba del cuerpo de la petición ANTES de gastar un token.
//
// Está aquí y no dentro de ai-proxy por la misma razón que entitlements.ts: es
// la parte que se puede probar. Dentro del Deno.serve no la mira nadie —tsc
// excluye supabase/ porque es Deno— y los fallos de este archivo son caros:
// dejan pasar peticiones que cuestan dinero o que tumban la función.
//
// Nada de aquí toca Deno ni variables de entorno. Los techos entran por
// parámetro para poder probarlos con números pequeños.
// ─────────────────────────────────────────────────────────

/**
 * Lee el cuerpo sin pasar de `maxBytes`. Devuelve null si se pasa.
 *
 * Se lee por trozos y se CANCELA en cuanto se cruza el techo. `req.text()` y
 * `req.json()` no sirven para esto: bufferizan todo primero, así que para
 * cuando podrías medirlo ya te lo comiste. El content-length se mira aparte,
 * pero es un dato del cliente y puede faltar o mentir; esto es lo que de
 * verdad acota.
 *
 * Antes no había nada: `await req.json()` se tragaba lo que llegara. Una
 * petición de cientos de megas tumbaba la función antes de que se ejecutara
 * ningún control — sin necesidad de ser premium ni de gastar un token.
 */
export async function leerCuerpoAcotado(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      trozos.push(value);
    }
  } catch {
    return null; // conexión cortada a mitad: no hay petición que atender
  }
  const todo = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) {
    todo.set(t, off);
    off += t.byteLength;
  }
  return new TextDecoder().decode(todo);
}

export type InspeccionPayload = {
  images: number;
  textChars: number;
  /** Mensaje para el usuario si alguna imagen no es aceptable. null si todas lo son. */
  imagenInvalida: string | null;
};

/**
 * Recorre los mensajes contando imágenes y caracteres de TEXTO, y comprobando
 * que las imágenes sean lo que la app manda de verdad.
 *
 * Los data-URI NO cuentan como texto a propósito: un body_scan legítimo trae
 * cientos de miles de caracteres de base64, y medirlos ahí lo rechazaría
 * siempre. El número de imágenes se acota aparte, y el tamaño total lo acota
 * el techo del cuerpo antes de llegar hasta aquí.
 */
export function inspectMessages(messages: unknown[], maxImageBytes: number): InspeccionPayload {
  let images = 0;
  let textChars = 0;
  let imagenInvalida: string | null = null;
  const marcar = (m: string) => { if (imagenInvalida === null) imagenInvalida = m; };

  for (const msg of messages) {
    const content = (msg as { content?: unknown })?.content;
    if (typeof content === 'string') { textChars += content.length; continue; }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: unknown; text?: unknown; image_url?: unknown };
      if (p?.type === 'image_url') {
        images++;
        const url = (p.image_url as { url?: unknown } | undefined)?.url;
        if (typeof url !== 'string') {
          marcar('Imagen sin URL.');
        } else if (!url.startsWith('data:image/')) {
          // La app manda SIEMPRE data:image/jpeg;base64 (lib/openai.ts y
          // lib/openai-features.ts). Aceptar una URL remota haría que OpenAI la
          // descargue CON NUESTRA CUENTA: eso convierte el proxy en un
          // descargador de URLs ajenas y no lo necesita ninguna función real.
          marcar('Solo se aceptan imágenes en el propio mensaje (data:image/...).');
        } else if (url.length > maxImageBytes) {
          marcar('Una de las imágenes es demasiado grande.');
        }
      } else if (typeof p?.text === 'string') {
        textChars += p.text.length;
      }
    }
  }
  return { images, textChars, imagenInvalida };
}
