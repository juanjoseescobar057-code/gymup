// store/userStore.ts
// ─────────────────────────────────────────────────────────
// Estado global de la app con Zustand.
// Guarda el perfil, el plan y el log de comidas del día.
// ─────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { UserProfile, TrainingPlan, FoodLog } from '../lib/supabase';
import { modoRecuperacion, type ModoRecuperacion } from '../lib/recoveryMode';
import type { HealthProfile } from '../lib/healthMath';

type DailyTotals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type UserStore = {
  profile: UserProfile | null;
  setProfile: (profile: UserProfile) => void;
  trainingPlan: TrainingPlan | null;
  setTrainingPlan: (plan: TrainingPlan) => void;
  todayFoodLogs: FoodLog[];
  loadedDate: string | null;                       // fecha (YYYY-MM-DD) a la que pertenecen los logs
  addFoodLog: (log: FoodLog) => void;
  clearTodayLogs: () => void;
  hydrateTodayLogs: (logs: FoodLog[], date: string) => void;  // recarga desde Supabase
  getDailyTotals: () => DailyTotals;
  getMacroProgress: () => { calories: number; protein: number; carbs: number; fat: number };
  onboardingComplete: boolean;
  setOnboardingComplete: (v: boolean) => void;
  /**
   * Modo recuperación (trastorno alimentario declarado). Vive en el store
   * para que cualquier pantalla lo consulte sin volver a leer el tamizaje:
   * si cada una lo cargara por su cuenta, alguna se olvidaría y enseñaría el
   * número de la báscula justo donde no debe.
   */
  recuperacion: ModoRecuperacion;
  /**
   * SI YA SABEMOS de la salud de esta persona, o todavía no.
   *
   * Sin esto había una carrera: `recuperacion` arrancaba en NEUTRO —que es lo
   * mismo que devuelve modoRecuperacion(null)— así que "todavía no lo sé" y
   * "sé que no tiene nada" eran EL MISMO VALOR. Las pantallas leían la bandera
   * mientras la consulta seguía en vuelo y enseñaban calorías, peso y el botón
   * de escanear el cuerpo a quien acababa de declarar un trastorno de la
   * conducta alimentaria. El arranque no espera a nadie: se navega y punto.
   *
   *   'cargando'    → aún no se sabe. Se bloquea.
   *   'conocido'    → se leyó el tamizaje (de red o de caché). Manda la bandera.
   *   'desconocido' → no se pudo leer y no hay caché. Se bloquea, igual que la
   *                   compuerta clínica del entreno: ante la duda, no.
   */
  saludEstado: EstadoSalud;
  setHealthProfile: (h: HealthProfile | null) => void;
  /** No se pudo leer el tamizaje y no hay caché. */
  marcarSaludDesconocida: () => void;
  /** Al cerrar sesión: lo que sabíamos era de OTRA persona. */
  olvidarSalud: () => void;
};

export type EstadoSalud = 'cargando' | 'conocido' | 'desconocido';

export const useUserStore = create<UserStore>((set, get) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
  recuperacion: modoRecuperacion(null),
  // Arranca en 'cargando', NO en 'conocido'. Ese era el fallo: el valor inicial
  // era indistinguible de "ya comprobado y está sano".
  saludEstado: 'cargando',
  setHealthProfile: (h) => set({ recuperacion: modoRecuperacion(h), saludEstado: 'conocido' }),
  marcarSaludDesconocida: () => set({ saludEstado: 'desconocido' }),
  olvidarSalud: () => set({ recuperacion: modoRecuperacion(null), saludEstado: 'cargando' }),

  trainingPlan: null,
  setTrainingPlan: (trainingPlan) => set({ trainingPlan }),

  todayFoodLogs: [],
  loadedDate: null,
  addFoodLog: (log) => set((state) => ({ todayFoodLogs: [...state.todayFoodLogs, log] })),
  clearTodayLogs: () => set({ todayFoodLogs: [] }),
  hydrateTodayLogs: (logs, date) => set({ todayFoodLogs: logs, loadedDate: date }),

  getDailyTotals: () => {
    const { todayFoodLogs } = get();
    return todayFoodLogs.reduce(
      (acc, log) => ({
        calories: acc.calories + log.calories,
        protein_g: acc.protein_g + log.protein_g,
        carbs_g: acc.carbs_g + log.carbs_g,
        fat_g: acc.fat_g + log.fat_g,
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );
  },

  getMacroProgress: () => {
    const { profile, getDailyTotals } = get();
    if (!profile) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const totals = getDailyTotals();
    return {
      calories: Math.min((totals.calories / profile.daily_calories) * 100, 100),
      protein:  Math.min((totals.protein_g / profile.daily_protein_g) * 100, 100),
      carbs:    Math.min((totals.carbs_g / profile.daily_carbs_g) * 100, 100),
      fat:      Math.min((totals.fat_g / profile.daily_fat_g) * 100, 100),
    };
  },

  onboardingComplete: false,
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
}));