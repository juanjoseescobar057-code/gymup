// lib/logMeal.ts
// ─────────────────────────────────────────────────────────
// Registrar una comida: insert → estado local → analítica → gamificación →
// avisos. Estaba todo dentro de food-scan.tsx, así que cualquier otra forma
// de registrar comida (a mano, sin foto) habría tenido que copiar la secuencia
// entera — y copiarla mal significa XP que no cuadra o macros que aparecen en
// pantalla pero no en el servidor.
//
// El orden NO es negociable: PRIMERO se guarda, DESPUÉS se celebra. Si el
// insert falla, no se toca el estado local, no se emite analítica y no se
// otorga XP; se devuelve el error para que la pantalla lo diga.
// ─────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { track } from './analytics';
import { captureError } from './monitoring';
import { recordMealLogged } from './streaks';

import { completaMacrosDelDia, avisoProteina, type MacrosComida, type TotalesDia, type MetasDia } from './mealMath';

export type { TotalesDia, MetasDia } from './mealMath';
export { completaMacrosDelDia, avisoProteina } from './mealMath';

export type ComidaNueva = MacrosComida & {
  meal_name: string;
  food_description: string;
  fiber_g: number;
};

export type ResultadoRegistro =
  | { ok: true; log: ComidaNueva & { id: string; user_id: string; logged_at: string } }
  | { ok: false; mensaje: string };

export async function registrarComida(opts: {
  userId: string;
  comida: ComidaNueva;
  totalesPrevios: TotalesDia;
  metas: MetasDia;
  /** De dónde vino: 'escaneo' | 'manual'. Solo para analítica. */
  origen: string;
  /** Props extra de analítica propias de la pantalla (ej. la porción). */
  propsExtra?: Record<string, string | number | boolean>;
}): Promise<ResultadoRegistro> {
  const { userId, comida, totalesPrevios, metas, origen, propsExtra } = opts;

  const loggedAt = new Date().toISOString();
  const { data: saved, error } = await supabase.from('food_logs').insert({
    user_id: userId,
    logged_at: loggedAt,
    meal_name: comida.meal_name,
    food_description: comida.food_description,
    calories: comida.calories,
    protein_g: comida.protein_g,
    carbs_g: comida.carbs_g,
    fat_g: comida.fat_g,
    fiber_g: comida.fiber_g,
  }).select('*').single();

  if (error) {
    captureError(error, { scope: 'logMeal.insert', origen, calories: comida.calories });
    return {
      ok: false,
      mensaje: 'Revisa tu conexión e intenta de nuevo. No se registró nada, así que tus macros de hoy siguen correctos.',
    };
  }

  if (!saved?.id) {
    captureError(new Error('Insert de comida sin fila devuelta'), { scope: 'logMeal.insert_result', origen });
    return { ok: false, mensaje: 'La base de datos no confirmó la comida. Intenta de nuevo para mantener tus macros correctos.' };
  }

  const log = { ...(saved as any), ...comida } as ComidaNueva & { id: string; user_id: string; logged_at: string };

  track('food_added', { calories: comida.calories, protein_g: comida.protein_g, origen, ...(propsExtra ?? {}) });

  // SIN RECOMPENSAS CORPORALES.
  //
  // `sinRecompensasCorporales` estaba declarada en lib/recoveryMode.ts desde el
  // principio y NO LA LEÍA NADIE. Así que a alguien con un trastorno de la
  // conducta alimentaria la app le seguía dando 15 XP por cada comida
  // registrada, +50 XP por "cubrir las cuatro metas del día", insignias por
  // número de comidas y una notificación felicitándolo por ello. Es decir:
  // gamificaba exactamente la conducta que el modo existe para despriorizar.
  //
  // La comida SE SIGUE GUARDANDO. Lo que se retira es el premio, el marcador y
  // el aviso de proteína. Dejar de registrar sería quitarle a la persona el
  // control de sus propios datos; dejar de premiarlo es todo lo que hace falta.
  const sinPremios = sinRecompensasCorporales();

  if (!sinPremios) {
    const macroPerfect = completaMacrosDelDia(totalesPrevios, comida, metas);
    recordMealLogged(userId, macroPerfect, saved.id)
      .then((r) => {
        if (r.macroDayCounted) {
          track('macro_day_perfect'); // contrato de analítica: no renombrar
          Notifications.scheduleNotificationAsync({
            content: {
              title: '🎯 Metas de macros del día cubiertas',
              body: 'Alcanzaste tus cuatro metas de hoy: calorías, proteína, carbos y grasa. +50 XP.',
              sound: 'default',
            },
            trigger: null,
          }).catch(() => {});
        }
      })
      .catch((e) => captureError(e, { scope: 'logMeal.gamificacion', origen }));

    const aviso = avisoProteina(totalesPrevios.protein_g + comida.protein_g, metas.daily_protein_g);
    if (aviso) {
      Notifications.scheduleNotificationAsync({
        content: { ...aviso, sound: 'default' },
        trigger: null,
      }).catch(() => {});
    }
  }

  return { ok: true, log };
}

/**
 * ¿Está esta persona en modo recuperación?
 *
 * Lee el store con `require` diferido, igual que publicarModoRecuperacion en
 * lib/health.ts, para no crear el ciclo lib → store → lib.
 *
 * Ante cualquier duda devuelve false, que es lo mismo que hace
 * modoRecuperacion(null): esconderle sus datos a alguien por un fallo de
 * lectura sería tan malo como el problema que se quiere evitar.
 */
function sinRecompensasCorporales(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useUserStore } = require('../store/userStore');
    return useUserStore.getState().recuperacion?.sinRecompensasCorporales === true;
  } catch {
    return false;
  }
}
