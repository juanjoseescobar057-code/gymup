// lib/water.ts
// ─────────────────────────────────────────────────────────
// Tracker de hidratación: vasos de agua por día, en AsyncStorage
// (local, sin migraciones de BD). Meta por defecto: 8 vasos.
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDateKey } from './foodLogs';

export const WATER_GOAL = 8;

function keyFor(date = localDateKey()): string {
  return `gymup_water_${date}`;
}

export async function getWaterCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(keyFor());
    const n = parseInt(raw ?? '0', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Suma (o resta con delta=-1) un vaso. Devuelve el nuevo total del día. */
export async function addWater(delta = 1): Promise<number> {
  const current = await getWaterCount();
  const next = Math.max(0, Math.min(current + delta, 20)); // tope sano
  try {
    await AsyncStorage.setItem(keyFor(), String(next));
  } catch {}
  return next;
}
