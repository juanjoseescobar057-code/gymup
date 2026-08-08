import type { SetLogInput } from './setLogs';

export type NormalizedWorkoutSet = {
  exercise_name: string;
  set_number: number;
  weight_kg: number | null;
  reps: number;
  rir: number | null;
};

/**
 * Valida el lote completo antes de enviarlo. Nunca descarta series en silencio:
 * si una está dañada, el snapshot local se conserva y la persona puede corregir
 * o reintentar sin creer que guardó más de lo que realmente quedó registrado.
 */
export function normalizeCompletedSets(input: SetLogInput[]): NormalizedWorkoutSet[] {
  // Un lote VACÍO no es un error: es alguien que abrió la sesión y se va sin
  // registrar nada — un día de descanso, una molestia a la primera serie, o
  // simplemente cambió de idea. Lanzar aquí convertía los dos únicos botones
  // de salida de la pantalla en un callejón sin salida: la app se negaba a
  // dejarle salir exigiéndole registrar una serie que no hizo.
  //
  // Quien decide qué hacer con la sesión vacía es el llamador (no se abre
  // sesión en el servidor); esta función solo valida lo que sí trae datos.
  if (input.length === 0) return [];

  // El número de serie se cuenta por HUECO del día, no por ejercicio. Si la
  // persona sustituye un ejercicio por otro que ya estaba en la sesión (el
  // modal de cambio no excluye los que ya están), los dos huecos generan
  // series 1, 2, 3 con el mismo nombre. Eso NO es un dato corrupto: son seis
  // series reales que la persona hizo.
  //
  // Antes esto lanzaba y el entrenamiento entero quedaba imposible de guardar
  // — para siempre, porque el reintento repetía los mismos datos y la app no
  // ofrece editar ni borrar una serie ya registrada. Se renumera en vez de
  // rechazar: se conserva todo lo que hizo y el orden en que lo hizo.
  const usados = new Map<string, number>();
  function numeroLibre(nombre: string, propuesto: number): number {
    const clave = nombre.toLocaleLowerCase('es');
    const siguiente = Math.max(propuesto, (usados.get(clave) ?? 0) + 1);
    usados.set(clave, siguiente);
    return siguiente;
  }

  return input.map((set, index) => {
    const name = set.exercise_name.trim();
    const weight = set.weight_kg ?? null;
    const rir = set.rir ?? null;
    if (!name || name.length > 200) throw new Error(`La serie ${index + 1} no tiene un ejercicio válido.`);
    if (!Number.isInteger(set.set_number) || set.set_number < 1 || set.set_number > 100) {
      throw new Error(`La serie ${index + 1} tiene un número de serie inválido.`);
    }
    if (!Number.isInteger(set.reps) || (set.reps ?? 0) < 1 || (set.reps ?? 0) > 1000) {
      throw new Error(`La serie ${index + 1} tiene repeticiones inválidas.`);
    }
    if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 1000)) {
      throw new Error(`La serie ${index + 1} tiene un peso inválido.`);
    }
    if (rir !== null && (!Number.isFinite(rir) || rir < 0 || rir > 10)) {
      throw new Error(`La serie ${index + 1} tiene un RIR inválido.`);
    }
    return {
      exercise_name: name,
      set_number: numeroLibre(name, set.set_number),
      weight_kg: weight,
      reps: set.reps as number,
      rir,
    };
  });
}
