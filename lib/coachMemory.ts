// lib/coachMemory.ts
// ─────────────────────────────────────────────────────────
// MEMORIA A LARGO PLAZO del Coach IA.
//
// Después de conversar, un paso de "destilado" extrae los hechos DURADEROS
// del usuario (lesiones, gustos, horarios, contexto de vida, su porqué) y
// los fusiona con la memoria existente en Supabase. En cada nueva charla,
// esos hechos se inyectan al prompt: el coach de verdad te conoce.
//
// Transparencia: el usuario puede VER y BORRAR lo que el coach recuerda
// (pantalla de memoria en el chat). La memoria viaja con la cuenta.
// ─────────────────────────────────────────────────────────

import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { aiChatContent } from './aiClient';
import { parseAI } from './schemas';
import type { ChatMessage } from './coachChat';

export const MAX_FACTS = 24;

// Caché local de la memoria: si la red falla al cargar, el coach usa los
// hechos de la última sincronización exitosa en vez de "olvidar" al usuario.
const MEMORY_CACHE_KEY = (uid: string) => `gymup_memory_cache_${uid}`;
// Ediciones locales pendientes de sincronizar (la BD NO manda hasta que el
// push confirme — evita que un hecho borrado offline "resucite" desde la BD).
const MEMORY_DIRTY_KEY = (uid: string) => `gymup_memory_dirty_${uid}`;

async function getDirty(uid: string): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_DIRTY_KEY(uid));
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function pushToServer(uid: string, facts: string[]): Promise<boolean> {
  try {
    // supabase-js NO lanza en errores: hay que LEER {error} (si se ignora,
    // el fallo de escritura es invisible y la memoria diverge en silencio).
    const { error } = await supabase.from('coach_memory').upsert({
      user_id: uid,
      facts,
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

const FactsSchema = z.object({
  facts: z.array(z.string().min(3).max(200)).max(MAX_FACTS * 2),
});

/**
 * Carga los hechos guardados. RESILIENTE y con orden de verdad claro:
 *   1. Ediciones locales pendientes (dirty) MANDAN: se re-empujan a la BD
 *      antes de aceptar nada de ella (push-before-pull).
 *   2. Fila real de la BD → autoritativa, refresca la caché.
 *   3. BD dice "no hay fila" pero la caché local recuerda hechos → caché
 *      (una memoria no desaparece legítimamente por una sesión degradada).
 *   4. Red caída → caché local. [] solo si de verdad nunca hubo nada.
 */
export async function loadCoachMemory(userId: string): Promise<string[]> {
  // 1. Lo editado offline es la verdad hasta que sincronice.
  const dirty = await getDirty(userId);
  if (dirty) {
    if (await pushToServer(userId, dirty)) {
      AsyncStorage.removeItem(MEMORY_DIRTY_KEY(userId)).catch(() => {});
      AsyncStorage.setItem(MEMORY_CACHE_KEY(userId), JSON.stringify(dirty)).catch(() => {});
    }
    return dirty;
  }

  try {
    const { data, error } = await supabase
      .from('coach_memory')
      .select('facts')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!data) {
      // 3. "Sin fila" con caché no vacía = sospechoso (RLS/sesión degradada):
      // conservar la caché en vez de dejar al coach amnésico.
      try {
        const raw = await AsyncStorage.getItem(MEMORY_CACHE_KEY(userId));
        const cached = raw ? JSON.parse(raw) : null;
        if (Array.isArray(cached) && cached.length > 0) return cached.slice(0, MAX_FACTS);
      } catch {}
      return [];
    }

    const facts = Array.isArray((data as any).facts)
      ? (data as any).facts.filter((f: unknown): f is string => typeof f === 'string').slice(0, MAX_FACTS)
      : [];
    AsyncStorage.setItem(MEMORY_CACHE_KEY(userId), JSON.stringify(facts)).catch(() => {});
    return facts;
  } catch {
    // 4. Red caída: último-contexto-bueno local.
    try {
      const raw = await AsyncStorage.getItem(MEMORY_CACHE_KEY(userId));
      const cached = raw ? JSON.parse(raw) : null;
      if (Array.isArray(cached)) return cached.slice(0, MAX_FACTS);
    } catch {}
    return [];
  }
}

/**
 * Guarda la memoria completa. Si la escritura remota falla, queda marcada
 * como pendiente (dirty) y se re-empuja en la próxima carga — una edición
 * (borrar un hecho, aprender una lesión) nunca se pierde ni se revierte.
 */
export async function saveCoachMemory(userId: string, facts: string[]): Promise<void> {
  const capped = facts.slice(0, MAX_FACTS);
  AsyncStorage.setItem(MEMORY_CACHE_KEY(userId), JSON.stringify(capped)).catch(() => {});
  const ok = await pushToServer(userId, capped);
  if (ok) {
    AsyncStorage.removeItem(MEMORY_DIRTY_KEY(userId)).catch(() => {});
  } else {
    AsyncStorage.setItem(MEMORY_DIRTY_KEY(userId), JSON.stringify(capped)).catch(() => {});
  }
}

/**
 * Destila la conversación reciente en hechos duraderos, fusionados con la
 * memoria existente. Devuelve la lista actualizada (o lanza si la IA falla —
 * el caller decide ignorarlo en silencio: la memoria nunca bloquea el chat).
 */
export async function distillMemory(
  existing: string[],
  recent: ChatMessage[],
  conversationId?: string
): Promise<string[]> {
  const convo = recent
    .map((m) => `${m.role === 'user' ? 'USUARIO' : 'COACH'}: ${m.content}`)
    .join('\n');

  const content = await aiChatContent(
    {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `Eres el módulo de MEMORIA a largo plazo del coach de fitness de GymUp.

MEMORIA ACTUAL (lo que ya sabes del usuario):
${existing.length ? existing.map((f) => `- ${f}`).join('\n') : '(vacía)'}

CONVERSACIÓN RECIENTE:
${convo}

Actualiza la memoria fusionando lo nuevo. REGLAS:
- Guarda SOLO hechos DURADEROS y útiles para entrenarlo mejor: lesiones o molestias, preferencias y aversiones (ejercicios, comidas), horarios y equipamiento disponible, contexto de vida (trabajo, familia, viajes, eventos importantes), su motivación profunda, cómo le gusta que le hablen.
- PRIORIDAD MÁXIMA: lesiones, dolores, cirugías y condiciones de salud. Consérvalos SIEMPRE (con la zona exacta) hasta que el usuario diga explícitamente que ya sanó — el coach los necesita para no recomendar ejercicios que lo lesionen.
- TAMBIÉN guarda los compromisos y recomendaciones importantes DEL COACH, con prefijo "El coach le recomendó..." (ej. "El coach le recomendó intentar 62.5kg en banca la próxima sesión", "Quedaron en cambiar zancadas por hip thrust", "Le propuso dropsets en el último ejercicio de bíceps"). Así el coach da seguimiento y cumple su palabra. Elimínalos cuando ya se cumplieron o quedaron obsoletos.
- NO guardes datos que cambian a diario (macros de hoy, peso actual, racha) ni el contenido del plan: eso ya lo ve el coach por otro lado.
- Fusiona duplicados, corrige lo que quedó contradicho y elimina lo que ya no aplique.
- Si el usuario pidió olvidar algo, elimínalo.
- Máximo ${MAX_FACTS} hechos. Cada uno UNA frase corta y concreta en español.
- Si la conversación no aporta nada nuevo, devuelve la memoria tal cual.

SOLO JSON sin texto adicional: {"facts": ["hecho 1", "hecho 2"]}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.2,
    },
    'general',
    conversationId
      ? { conversationId, decision: { op: 'memory_distill' } }
      : { decision: { op: 'memory_distill' } }
  );

  const parsed = parseAI(FactsSchema, content, 'memoria del coach');
  // Normalizar: sin vacíos, sin duplicados exactos, tope duro.
  return [...new Set(parsed.facts.map((f) => f.trim()).filter(Boolean))].slice(0, MAX_FACTS);
}

/** Bloque de memoria para el system prompt. PURA. */
export function memoryToPrompt(facts: string[]): string {
  if (!facts.length) return '';
  return `\nMEMORIA DE CONVERSACIONES PASADAS (úsala con naturalidad para personalizar — no la recites completa):\n${facts
    .map((f) => `- ${f}`)
    .join('\n')}`;
}
