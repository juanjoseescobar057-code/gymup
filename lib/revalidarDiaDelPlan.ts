// lib/revalidarDiaDelPlan.ts
// ─────────────────────────────────────────────────────────
// Revalidar el día que se va a entrenar contra la salud de HOY.
//
// El plan se valida cuando se genera, y ahí se queda. Pero la salud cambia
// después: alguien declara una hernia, un embarazo, hipertensión o una cirugía
// reciente, elige "Después" en el aviso de regenerar el plan, y sigue teniendo
// su rutina de antes. La pantalla de sesión comprobaba el riesgo GENERAL —
// evaluateWorkoutAccess— pero nunca revisaba ejercicio por ejercicio, así que
// el press de banca programado antes del embarazo seguía ahí, con su carga y
// su RIR.
//
// El arreglo no inventa reglas clínicas nuevas: pasa el día por EL MISMO
// validador determinista que ya revisa los planes recién generados. La misma
// tabla de vetos, las mismas sustituciones, la misma normalización de RIR y de
// técnicas de intensidad. Solo que aplicada en un segundo punto: justo antes de
// que la persona empiece a levantar peso.
//
// Que sea el mismo código importa. Una segunda implementación de "qué está
// vetado" se desincroniza de la primera en el siguiente cambio, y este
// repositorio ya ha pagado tres veces esa factura.
// ─────────────────────────────────────────────────────────

import { validarPlan } from './planValidator';

type Ejercicio = Record<string, any>;

export type DiaRevalidado<T = Ejercicio> = {
  ejercicios: T[];
  /** Qué se tocó y por qué. Vacío = el plan sigue siendo apto. */
  correcciones: { ejercicio: string; motivo: string; accion: string; sustituto?: string }[];
  /** true si no queda NINGÚN ejercicio ejecutable: hay que regenerar el plan. */
  vacio: boolean;
};

export type ContextoSalud = {
  injuries: string[];
  conditions: string[];
  equipment: string;
  age: number;
  saludDesconocida: boolean;
};

/**
 * Pasa los ejercicios de un día por el validador clínico.
 *
 * Devuelve la lista corregida, lo que se cambió, y si quedó vacía. NUNCA lanza:
 * un fallo aquí no puede impedir que alguien vea su sesión, pero tampoco puede
 * dejar pasar el plan sin revisar — ante un error inesperado devuelve la lista
 * VACÍA y `vacio: true`, que la pantalla traduce en "regenera tu plan".
 */
export function revalidarDiaDelPlan<T extends Record<string, any>>(
  ejercicios: T[],
  ctx: ContextoSalud
): DiaRevalidado<T> {
  if (!ejercicios.length) return { ejercicios: [], correcciones: [], vacio: false };

  try {
    // El validador espera una semana entera. Se le da el día de verdad y seis
    // de descanso: los días 'rest' los devuelve intactos sin mirarlos.
    const semana = {
      overview: '',
      days: [
        {
          day: 1,
          day_name: 'Hoy',
          type: 'workout' as const,
          muscle_groups: [] as string[],
          estimated_duration_min: 60,
          exercises: ejercicios,
        },
        ...Array.from({ length: 6 }, (_, i) => ({
          day: i + 2,
          day_name: 'Descanso',
          type: 'rest' as const,
          muscle_groups: [] as string[],
          estimated_duration_min: 0,
          exercises: [] as Ejercicio[],
        })),
      ],
    };

    const { plan, correcciones } = validarPlan(semana as any, {
      // Los tipos exactos los define planValidator; aqui llegan del store sin
      // estrechar. Estrecharlos en este archivo duplicaria la lista de lesiones
      // y condiciones en un tercer sitio, que es como se desincronizan.
      injuries: ctx.injuries as any,
      conditions: ctx.conditions as any,
      equipment: ctx.equipment,
      age: ctx.age,
      saludDesconocida: ctx.saludDesconocida,
    });

    const corregidos = (plan as any).days?.[0]?.exercises ?? [];
    return {
      ejercicios: corregidos,
      correcciones: correcciones.map((c: any) => ({
        ejercicio: c.ejercicio,
        motivo: c.motivo,
        accion: c.accion,
        ...(c.sustituto ? { sustituto: c.sustituto } : {}),
      })),
      // Si el validador se llevó TODO por delante, el plan de hoy no es
      // ejecutable con la salud declarada. Eso no se arregla entrenando otra
      // cosa a ojo: hay que regenerarlo.
      vacio: corregidos.length === 0,
    };
  } catch {
    // Fail-closed. Un fallo del validador no puede traducirse en "entrena lo que
    // había": es exactamente el caso en el que no sabemos si es seguro.
    return { ejercicios: [], correcciones: [], vacio: true };
  }
}
