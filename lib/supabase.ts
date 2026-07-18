import 'react-native-get-random-values'; // polyfill de crypto.getRandomValues (lo usa aes-js abajo)
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Carga PEREZOSA de expo-secure-store: su módulo JS llama a
// requireNativeModule() en su propio import de nivel superior, que LANZA
// de inmediato si el nativo no está linkeado (dev client sin rebuildear) —
// un `import * as SecureStore from 'expo-secure-store'` estático arriba de
// este archivo crashearía la app ENTERA al arrancar, antes de que cualquier
// try/catch propio pudiera correr. Con require() dentro de un try/catch,
// el fallo queda contenido aquí y se resuelve con el modo de respaldo.
type SecureStoreModule = typeof import('expo-secure-store');
let SecureStore: SecureStoreModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SecureStore = require('expo-secure-store');
} catch {
  SecureStore = null;
}

// ─────────────────────────────────────────────────────────
// Almacenamiento seguro de sesión (patrón oficial de Supabase para Expo).
// SecureStore (Keychain/Keystore del SO) tiene un límite de ~2KB por valor,
// insuficiente para un objeto de sesión completo. Por eso: la sesión se
// cifra con AES y se guarda en AsyncStorage; solo la CLAVE de cifrado (256
// bits) vive en SecureStore. Antes la sesión (access/refresh token) se
// guardaba en AsyncStorage en texto plano — legible por cualquier app con
// acceso al sandbox en un dispositivo comprometido/rooteado.
// ─────────────────────────────────────────────────────────
// Prefijo para el modo de respaldo (ver setItem). Nunca colisiona con hex real:
// contiene letras (g,y,m,u,p,v) que no son dígitos hexadecimales válidos.
const PLAIN_FALLBACK_PREFIX = 'gymup_plain_v1:';

class LargeSecureStore {
  private warnedOnce = false;
  private warnFallback(e: unknown): void {
    if (this.warnedOnce) return;
    this.warnedOnce = true;
    if (__DEV__) {
      console.warn(
        '[supabase] Cifrado de sesión no disponible en este build (falta el rebuild nativo ' +
        'con expo-secure-store) — usando almacenamiento sin cifrar temporalmente. La app ' +
        'sigue funcionando igual; el cifrado se activa solo tras el próximo build.',
        e
      );
    }
  }

  private async _encrypt(key: string, value: string): Promise<string> {
    if (!SecureStore) throw new Error('expo-secure-store no disponible (falta rebuild nativo)');
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string): Promise<string | null> {
    if (!SecureStore) throw new Error('expo-secure-store no disponible (falta rebuild nativo)');
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    // Se guardó en modo de respaldo (build sin el módulo nativo aún): no
    // intentar desencriptar, es texto plano marcado.
    if (stored.startsWith(PLAIN_FALLBACK_PREFIX)) {
      return stored.slice(PLAIN_FALLBACK_PREFIX.length);
    }
    try {
      return await this._decrypt(key, stored);
    } catch (e) {
      // O el módulo nativo no está (dev client sin rebuildear) o la clave
      // de cifrado se perdió/corrompió (ej. reinstalación que borró el
      // Keychain pero no AsyncStorage). En ambos casos: tratar como sesión
      // inexistente en vez de crashear — el usuario simplemente re-inicia sesión.
      this.warnFallback(e);
      await this.removeItem(key);
      return null;
    }
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    if (!SecureStore) return; // nada que borrar ahí: el módulo nativo no está
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Clave ya inexistente o error del store: no es crítico al borrar.
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const encrypted = await this._encrypt(key, value);
      await AsyncStorage.setItem(key, encrypted);
    } catch (e) {
      // Dev client sin el rebuild nativo todavía (SecureStore o el polyfill
      // de crypto.getRandomValues no están linkeados): degradar con gracia
      // a texto plano marcado en vez de crashear el login. Automáticamente
      // se cifra en cuanto el usuario tenga el build nuevo.
      this.warnFallback(e);
      await AsyncStorage.setItem(key, PLAIN_FALLBACK_PREFIX + value);
    }
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Sin esto, supabase-js resuelve su propio fetch y en algunos builds de
  // React Native termina usando el polyfill whatwg-fetch (pensado para
  // navegador) en vez del fetch nativo del puente RN — provoca "Network
  // request failed" genéricos e intermitentes que no son un problema real
  // de red. Forzar el fetch global nativo lo evita.
  global: {
    fetch: (input, init) => fetch(input, init),
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