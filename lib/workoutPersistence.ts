// lib/workoutPersistence.ts
// ─────────────────────────────────────────────────────────
// Guarda un snapshot de la sesión de entreno en curso en AsyncStorage.
// Si la app se cierra / crashea a mitad del entreno, se puede restaurar
// (mismo día del plan y hace menos de MAX_AGE_MS).
// ─────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gymup_active_workout';
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 horas

export type SetLogSnapshot = {
  exercise_name: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
};

export type WorkoutSnapshot = {
  todayIndex: number;
  startedAt: number;        // ms epoch del inicio real
  currentEx: number;
  completedSets: Record<number, number>;
  loggedSets: SetLogSnapshot[];
  savedAt: number;          // ms epoch del último guardado
};

export async function saveSession(snap: Omit<WorkoutSnapshot, 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...snap, savedAt: Date.now() }));
  } catch {}
}

/** Devuelve el snapshot solo si es válido para restaurar (mismo día, reciente). */
export async function loadSession(todayIndex: number, now: number): Promise<WorkoutSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WorkoutSnapshot;
    if (snap.todayIndex !== todayIndex) return null;
    if (now - snap.savedAt > MAX_AGE_MS) return null;
    // Debe haber algún progreso real que valga la pena restaurar.
    const hasProgress = Object.values(snap.completedSets ?? {}).some((n) => n > 0);
    return hasProgress ? snap : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
