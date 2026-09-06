// lib/actividadMensual.ts
// ─────────────────────────────────────────────────────────
// "¿Cuántas veces fui este mes?" — la lectura del mes.
//
// Todo sale de lo que ya existe: workout_sessions (cuándo, cuánto duró) y
// set_logs (qué ejercicios, con qué peso). No hay tabla nueva ni RPC nueva.
// El cálculo vive en lib/actividadMensualCalculo.ts (puro, probado desde
// node); aquí solo se lee, y se lee por páginas porque PostgREST corta a
// 1000 filas sin avisar y un mes cargado de series puede pasar de ahí.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { esDelMes, resumirMes, type ResumenMes, type SesionDelMes, type SerieDelMes } from './actividadMensualCalculo';

export * from './actividadMensualCalculo';

const PAGINA = 1000;

async function paginar<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    todas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  return todas;
}

export type ActividadMensual = {
  resumen: ResumenMes;
  entrenosMesAnterior: number;
};

/**
 * Trae el mes pedido (sesiones + series) y, de paso, cuántos entrenos hubo el
 * mes anterior para la comparación. Un solo rango de sesiones cubre los dos
 * meses; las series solo se piden para el mes que se ve.
 */
export async function fetchActividadMensual(
  userId: string,
  anio: number,
  mes: number,
  /** El "hoy" del teléfono, para que el mes en curso divida entre los días que van. */
  hoy?: Date,
): Promise<ActividadMensual> {
  const inicioAnterior = new Date(anio, mes - 1, 1);
  const inicio = new Date(anio, mes, 1);
  const fin = new Date(anio, mes + 1, 1);

  const [sesiones, series] = await Promise.all([
    paginar<SesionDelMes>((desde, hasta) =>
      supabase
        .from('workout_sessions')
        .select('id, completed_at, duration_min, exercises_completed, day_index')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .gte('completed_at', inicioAnterior.toISOString())
        .lt('completed_at', fin.toISOString())
        .order('completed_at', { ascending: true })
        .range(desde, hasta),
    ),
    paginar<SerieDelMes>((desde, hasta) =>
      supabase
        .from('set_logs')
        .select('exercise_name, weight_kg, reps, logged_at, session_id')
        .eq('user_id', userId)
        .gte('logged_at', inicio.toISOString())
        .lt('logged_at', fin.toISOString())
        .order('logged_at', { ascending: true })
        .range(desde, hasta),
    ),
  ]);

  const anioAnterior = inicioAnterior.getFullYear();
  const mesAnterior = inicioAnterior.getMonth();
  const entrenosMesAnterior = sesiones.filter((s) => esDelMes(s.completed_at, anioAnterior, mesAnterior)).length;

  const enCurso = !!hoy && hoy.getFullYear() === anio && hoy.getMonth() === mes;
  const diasContados = enCurso ? hoy.getDate() : undefined;

  return { resumen: resumirMes(sesiones, series, anio, mes, diasContados), entrenosMesAnterior };
}
