// lib/planValidator.ts
// ─────────────────────────────────────────────────────────
// El plan que genera la IA se comprueba ANTES de guardarse.
//
// Hasta ahora se validaba la FORMA (que el JSON tuviera siete días y los campos
// esperados) y nada más. El contenido dependía por completo de que el modelo
// obedeciera el prompt — y un prompt es una petición, no un control. Si el
// modelo colaba una sentadilla profunda para alguien con la rodilla lesionada,
// o press militar con el hombro tocado, o cualquier cosa con barra para quien
// entrena en casa sin equipo, el plan se activaba igual y guiaba semanas.
//
// Esto no vuelve a razonar de clínica: reutiliza el vocabulario que ya existe en
// lib/warmupMath.ts —qué EXIGE cada movimiento y qué se veta por cada lesión y
// condición— y lo aplica a los ejercicios del plan. Una sola fuente para las dos
// cosas: si mañana se añade un veto, el calentamiento y el plan lo respetan a la
// vez.
//
// QUÉ HACE CON LO QUE ENCUENTRA. Sustituye si sabe por qué cambiarlo, y si no,
// lo quita. Nunca deja pasar. Un día que se queda sin ejercicios pasa a ser
// descanso, que es un resultado honesto: mejor un día menos que un movimiento
// que la persona declaró que no puede hacer.
// ─────────────────────────────────────────────────────────

import type { Condition, InjuryZone } from './healthMath';
import { DEMANDAS_POR_EJERCICIO, vetosDe, type DemandaMovimiento } from './demandasEjercicio';

export type EjercicioPlan = {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
  muscle_group: string;
  target_rir?: number;
  intensity_method?: 'none' | 'drop_set';
  exercise_id?: string;
};

export type DiaPlan = {
  day: number;
  day_name: string;
  type: 'workout' | 'rest' | 'active_recovery';
  muscle_groups: string[];
  estimated_duration_min: number;
  exercises: EjercicioPlan[];
  notes?: string;
  activities?: string[];
};

export type PlanSemanal = { overview: string; days: DiaPlan[] };

export type ContextoValidacion = {
  injuries: InjuryZone[];
  conditions: Condition[];
  /** 'gym' | 'casa_basico' | 'casa_sin_equipo' */
  equipment: string;
  age: number;
  /** true = no se pudo leer el tamizaje. Se valida con el criterio más estricto. */
  saludDesconocida?: boolean;
};

export type Correccion = {
  dia: number;
  ejercicio: string;
  motivo: string;
  accion: 'sustituido' | 'retirado' | 'ajustado';
  sustituto?: string;
};

export type ResultadoValidacion = {
  plan: PlanSemanal;
  correcciones: Correccion[];
};

// ─── EQUIPO ──────────────────────────────────────────────
// Qué NO se puede hacer sin material. Se mira por palabras del nombre porque el
// plan viene de un modelo y no de un catálogo cerrado; el catálogo canónico es
// otra tarea y esto tiene que funcionar mientras tanto.

const PIDE_BARRA_O_MAQUINA = /barra|máquina|maquina|polea|jalón|jalon|prensa|smith|cable|banco declinado|peck|hack/i;
const PIDE_MANCUERNAS = /mancuerna|kettlebell|pesa rusa/i;

/** Sustitutos sin equipo, por grupo muscular. Movimientos básicos y seguros. */
const SIN_EQUIPO: Record<string, string> = {
  pecho: 'Flexiones',
  espalda: 'Remo invertido con toalla en puerta',
  pierna: 'Sentadilla con peso corporal',
  piernas: 'Sentadilla con peso corporal',
  gluteo: 'Puente de glúteo',
  glúteo: 'Puente de glúteo',
  hombro: 'Elevaciones laterales con botellas',
  hombros: 'Elevaciones laterales con botellas',
  biceps: 'Curl con mochila',
  bíceps: 'Curl con mochila',
  triceps: 'Fondos en silla',
  tríceps: 'Fondos en silla',
  core: 'Plancha',
  abdomen: 'Plancha',
};

function sustitutoSinEquipo(grupo: string): string | null {
  const g = (grupo || '').toLowerCase();
  for (const [clave, ejercicio] of Object.entries(SIN_EQUIPO)) {
    if (g.includes(clave)) return ejercicio;
  }
  return null;
}

/**
 * Valida y CORRIGE un plan contra lo que la persona declaró.
 *
 * Pura: entra un plan y un contexto, sale un plan corregido y la lista de lo que
 * se tocó. Sin red, sin store, sin fechas — por eso se puede probar entera.
 */
export function validarPlan(plan: PlanSemanal, ctx: ContextoValidacion): ResultadoValidacion {
  const correcciones: Correccion[] = [];
  const vetadas = vetosDe(ctx.injuries, ctx.conditions, ctx.saludDesconocida === true);

  // 65+, tamizaje ilegible, y CUALQUIER condición que vete la intensidad alta.
  //
  // Este último faltaba y era el importante: 'intensidad_alta' está vetada para
  // embarazo, cardiopatía, asma, hipertensión —controlada o no— y cirugía
  // reciente, pero el veto solo se consumía comparándolo con el NOMBRE del
  // ejercicio. Un plan con `intensity_method: 'drop_set'` o `target_rir: 0`
  // pasaba entero, porque "Curl con mancuerna" no suena a intensidad alta.
  //
  // El veto es sobre la INTENSIDAD, no sobre cómo se llame el movimiento.
  const sinTecnicasAvanzadas =
    ctx.age >= 65 || ctx.saludDesconocida === true || vetadas.has('intensidad_alta');

  const dias = plan.days.map((dia) => {
    if (dia.type !== 'workout') return dia;

    const ejercicios: EjercicioPlan[] = [];

    for (const ej of dia.exercises) {
      const demandas = DEMANDAS_POR_EJERCICIO(ej.name);
      const choque = demandas.find((d) => vetadas.has(d));

      if (choque) {
        const sustituto = sustitutoSinEquipo(ej.muscle_group);
        // Solo se sustituye si el sustituto NO choca también.
        const demandasSustituto = sustituto ? DEMANDAS_POR_EJERCICIO(sustituto) : [];
        const sustitutoVale = sustituto && !demandasSustituto.some((d) => vetadas.has(d));

        correcciones.push({
          dia: dia.day,
          ejercicio: ej.name,
          motivo: `exige ${etiqueta(choque)}, que está vetado por lo que declaraste`,
          accion: sustitutoVale ? 'sustituido' : 'retirado',
          ...(sustitutoVale ? { sustituto: sustituto! } : {}),
        });
        if (sustitutoVale) {
          ejercicios.push({ ...ej, name: sustituto!, intensity_method: 'none', exercise_id: undefined });
        }
        continue;
      }

      // Equipo. No es clínico, pero un plan que no se puede ejecutar tampoco
      // sirve: quien entrena en casa sin material abandona en el día uno.
      const necesitaMaterial =
        (ctx.equipment === 'casa_sin_equipo' && (PIDE_BARRA_O_MAQUINA.test(ej.name) || PIDE_MANCUERNAS.test(ej.name))) ||
        (ctx.equipment === 'casa_basico' && PIDE_BARRA_O_MAQUINA.test(ej.name));

      if (necesitaMaterial) {
        const sustituto = sustitutoSinEquipo(ej.muscle_group);
        const sustitutoVale =
          sustituto && !DEMANDAS_POR_EJERCICIO(sustituto).some((d) => vetadas.has(d));
        correcciones.push({
          dia: dia.day,
          ejercicio: ej.name,
          motivo: `necesita material que no tienes (${ctx.equipment})`,
          accion: sustitutoVale ? 'sustituido' : 'retirado',
          ...(sustitutoVale ? { sustituto: sustituto! } : {}),
        });
        if (sustitutoVale) {
          ejercicios.push({ ...ej, name: sustituto!, intensity_method: 'none', exercise_id: undefined });
        }
        continue;
      }

      // Técnicas de intensidad, y RIR al fallo, donde no tocan.
      //
      // target_rir 0 o 1 es "hasta el fallo o casi", que es intensidad alta
      // escrita en otro campo. Normalizar solo intensity_method dejaba la mitad
      // del problema en pie.
      const alFallo = (ej.target_rir ?? 2) < 2;
      const conTecnica = !!ej.intensity_method && ej.intensity_method !== 'none';
      if (sinTecnicasAvanzadas && (conTecnica || alFallo)) {
        correcciones.push({
          dia: dia.day,
          ejercicio: ej.name,
          motivo: ctx.age >= 65
            ? 'las técnicas de intensidad no se programan a partir de los 65'
            : ctx.saludDesconocida
              ? 'no se pudo leer tu tamizaje, así que nada de técnicas de intensidad'
              : 'lo que declaraste desaconseja llegar a intensidades altas',
          accion: 'ajustado',
        });
        ejercicios.push({
          ...ej,
          intensity_method: 'none',
          target_rir: Math.max(ej.target_rir ?? 2, 2),
        });
        continue;
      }

      ejercicios.push(ej);
    }

    // Un día que se queda sin nada pasa a descanso. Es honesto: mejor un día
    // menos que uno vacío que se lee como un fallo de la app.
    if (ejercicios.length === 0) {
      return {
        ...dia,
        type: 'rest' as const,
        exercises: [],
        muscle_groups: [],
        notes: 'Quitamos los ejercicios de este día porque chocaban con lo que declaraste. Habla con tu profesional para adaptarlo.',
      };
    }

    return { ...dia, exercises: ejercicios };
  });

  return { plan: { ...plan, days: dias }, correcciones };
}

function etiqueta(d: DemandaMovimiento): string {
  const textos: Record<DemandaMovimiento, string> = {
    flexion_lumbar: 'doblar la columna con carga',
    rodilla_profunda: 'flexión profunda de rodilla',
    hombro_sobre_cabeza: 'llevar los brazos por encima de la cabeza',
    cuello_rango: 'rango de cuello',
    muneca_carga: 'carga sobre la muñeca',
    cadera_rango: 'rango amplio de cadera',
    tobillo_rango: 'rango de tobillo',
    impacto: 'impacto',
    supino: 'estar tumbado boca arriba',
    intensidad_alta: 'intensidad alta',
  };
  return textos[d] ?? d;
}
