import 'react-native-get-random-values'; // polyfill de crypto.getRandomValues (lo usa aes-js abajo)
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// ─────────────────────────────────────────────────────────
// Almacenamiento seguro de sesión (patrón oficial de Supabase para Expo).
// SecureStore (Keychain/Keystore del SO) tiene un límite de ~2KB por valor,
// insuficiente para un objeto de sesión completo. Por eso: la sesión se
// cifra con AES y se guarda en AsyncStorage; solo la CLAVE de cifrado (256
// bits) vive en SecureStore. Antes la sesión (access/refresh token) se
// guardaba en AsyncStorage en texto plano — legible por cualquier app con
// acceso al sandbox en un dispositivo comprometido/rooteado.
// ─────────────────────────────────────────────────────────
class LargeSecureStore {
  private async _encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    try {
      return await this._decrypt(key, encrypted);
    } catch {
      // Clave de cifrado perdida/corrupta (ej. reinstalación que borró el
      // Keychain pero no AsyncStorage): tratar como sesión inexistente en
      // vez de crashear: el usuario simplemente inicia sesión de nuevo.
      await this.removeItem(key);
      return null;
    }
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type UserProfile = {
  id: string;
  user_id: string;
  name: string;
  age: number;
  weight_kg: number;
  height_cm: number;
  goal: 'muscle_gain' | 'fat_loss' | 'performance' | 'endurance';
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  daily_calories: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
  current_plan_day: number;
  last_active_date: string | null;
  is_premium: boolean;
  target_weight_kg: number | null;      // meta de peso (opcional)
  goal_why: string | null;              // motivación personal ("el porqué")
  goal_start_weight_kg: number | null;  // peso al fijar la meta
  nickname: string | null;              // cómo quiere que lo llame el coach
  created_at: string;
  updated_at: string;
};

export type TrainingPlan = {
  id: string;
  user_id: string;
  week_number: number;
  plan_data: WeeklyPlan;
  is_active: boolean;
  generated_at: string;
};

export type WeeklyPlan = {
  overview: string;
  days: TrainingDay[];
};

export type TrainingDay = {
  day: number;
  day_name: string;
  type: 'workout' | 'rest' | 'active_recovery';
  muscle_groups: string[];
  estimated_duration_min: number;
  exercises: Exercise[];
  notes?: string;
  activities?: string[];
};

export type Exercise = {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
  muscle_group: string;
};

export type FoodLog = {
  id: string;
  user_id: string;
  logged_at: string;
  meal_name: string;
  food_description: string;
  photo_url?: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export type WorkoutSession = {
  id: string;
  user_id: string;
  training_plan_id: string;
  day_index: number;
  started_at: string;
  completed_at?: string;
  duration_min?: number;
  exercises_completed: number;
};