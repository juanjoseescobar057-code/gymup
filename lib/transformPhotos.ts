// lib/transformPhotos.ts
// ─────────────────────────────────────────────────────────
// Sube las fotos de transformación al bucket PRIVADO de Supabase Storage.
// Antes se guardaba un URI local file:// que se perdía al reinstalar y no
// sincronizaba entre dispositivos.
//
// El bucket `transform-photos` es privado: sus políticas exigen que la
// PRIMERA carpeta del path sea el auth.uid() del dueño → path = `${uid}/...`.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { imageToOptimizedBase64 } from './image';

// Decodificador base64 → bytes PURO en JS. Hermes no garantiza `atob`.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const pad = (b64.match(/=+$/)?.[0].length) ?? 0;
  const len = Math.floor((clean.length * 3) / 4) - pad;
  const bytes = new Uint8Array(Math.max(0, len));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (p < len) bytes[p++] = (n >> 16) & 0xff;
    if (p < len) bytes[p++] = (n >> 8) & 0xff;
    if (p < len) bytes[p++] = n & 0xff;
  }
  return bytes;
}

/** ¿El valor guardado es un path de Storage (no un file:// ni http legado)? */
export function isStoragePath(uri: string): boolean {
  return !uri.startsWith('file://') && !uri.startsWith('http') && !uri.startsWith('content://');
}

/**
 * Comprime y sube la foto. Devuelve el path de Storage o un error.
 */
export async function uploadTransformPhoto(
  userId: string,
  localUri: string
): Promise<{ path: string } | { error: string }> {
  try {
    const b64 = await imageToOptimizedBase64(localUri);
    const bytes = base64ToBytes(b64);
    const path = `${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('transform-photos')
      .upload(path, bytes.buffer as ArrayBuffer, { contentType: 'image/jpeg', upsert: false });
    if (error) return { error: error.message };
    return { path };
  } catch (e: any) {
    return { error: e?.message ?? 'upload failed' };
  }
}

/**
 * Firma en lote los paths de Storage para poder mostrarlos (bucket privado).
 * Los uri legados (file://, http) se devuelven tal cual. Tolerante a fallos.
 */
export async function signPhotoUrls(uris: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const toSign = uris.filter(isStoragePath);
  for (const u of uris) if (!isStoragePath(u)) map[u] = u; // identidad para legados

  if (toSign.length === 0) return map;
  try {
    const { data } = await supabase.storage
      .from('transform-photos')
      .createSignedUrls(toSign, 3600);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
    }
  } catch (e: any) {
    if (__DEV__) console.log('[transformPhotos] sign error:', e?.message);
  }
  return map;
}
