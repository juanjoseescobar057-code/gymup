// constants/exercises.ts
// ─────────────────────────────────────────────────────────
// Catálogo de ejercicios. Base para explorar y para SUSTITUIR un
// ejercicio del plan por otro del mismo grupo muscular.
// ─────────────────────────────────────────────────────────

export type LibraryExercise = {
  id: string;
  name: string;
  muscle_group: string;     // grupo principal (coincide con los del plan IA)
  equipment: string;
  emoji: string;
  instructions: string[];
};

export const MUSCLE_GROUPS = [
  'Pecho', 'Espalda', 'Pierna', 'Hombro', 'Brazo', 'Core', 'Glúteo', 'Cardio',
] as const;

export const EXERCISE_LIBRARY: LibraryExercise[] = [
  // ── Pecho ──
  { id: 'bench_press', name: 'Press de banca', muscle_group: 'Pecho', equipment: 'Barra', emoji: '🏋️',
    instructions: ['Acuéstate con los omóplatos retraídos.', 'Baja la barra al pecho controlando.', 'Empuja sin bloquear codos de golpe.'] },
  { id: 'incline_db_press', name: 'Press inclinado con mancuernas', muscle_group: 'Pecho', equipment: 'Mancuernas', emoji: '💪',
    instructions: ['Banco a 30-45°.', 'Baja las mancuernas a la altura del pecho.', 'Junta arriba sin chocar.'] },
  { id: 'pushup', name: 'Flexiones', muscle_group: 'Pecho', equipment: 'Peso corporal', emoji: '⬇️',
    instructions: ['Cuerpo en línea recta.', 'Baja hasta casi tocar el suelo.', 'Empuja manteniendo el core firme.'] },
  { id: 'cable_crossover', name: 'Cruce de poleas', muscle_group: 'Pecho', equipment: 'Polea', emoji: '🔀',
    instructions: ['Pie adelantado, ligera inclinación.', 'Junta las manos al frente.', 'Controla la vuelta.'] },

  // ── Espalda ──
  { id: 'deadlift', name: 'Peso muerto', muscle_group: 'Espalda', equipment: 'Barra', emoji: '🏋️',
    instructions: ['Espalda neutra, barra pegada.', 'Empuja con piernas y cadera.', 'Bloquea arriba sin hiperextender.'] },
  { id: 'pullup', name: 'Dominadas', muscle_group: 'Espalda', equipment: 'Barra fija', emoji: '🔝',
    instructions: ['Agarre algo más ancho que hombros.', 'Sube llevando el pecho a la barra.', 'Baja con control total.'] },
  { id: 'barbell_row', name: 'Remo con barra', muscle_group: 'Espalda', equipment: 'Barra', emoji: '🔙',
    instructions: ['Tronco inclinado ~45°.', 'Lleva la barra al abdomen.', 'Aprieta escápulas arriba.'] },
  { id: 'lat_pulldown', name: 'Jalón al pecho', muscle_group: 'Espalda', equipment: 'Polea', emoji: '⬇️',
    instructions: ['Pecho arriba, leve arqueo.', 'Jala la barra al pecho.', 'Controla la subida.'] },

  // ── Pierna ──
  { id: 'squat', name: 'Sentadilla', muscle_group: 'Pierna', equipment: 'Barra', emoji: '🦵',
    instructions: ['Pies al ancho de hombros.', 'Baja por debajo de paralelo.', 'Empuja rodillas afuera al subir.'] },
  { id: 'leg_press', name: 'Prensa de pierna', muscle_group: 'Pierna', equipment: 'Máquina', emoji: '🦿',
    instructions: ['Pies a media plataforma.', 'Baja hasta 90°.', 'No bloquees rodillas arriba.'] },
  { id: 'lunge', name: 'Zancada', muscle_group: 'Pierna', equipment: 'Mancuernas', emoji: '🚶',
    instructions: ['Paso largo al frente.', 'Baja la rodilla trasera.', 'Empuja con el talón delantero.'] },
  { id: 'leg_curl', name: 'Curl femoral', muscle_group: 'Pierna', equipment: 'Máquina', emoji: '🦵',
    instructions: ['Ajusta el rodillo sobre el tobillo.', 'Lleva el talón al glúteo.', 'Baja lento.'] },

  // ── Hombro ──
  { id: 'ohp', name: 'Press militar', muscle_group: 'Hombro', equipment: 'Barra', emoji: '⬆️',
    instructions: ['Core firme, glúteos apretados.', 'Empuja la barra sobre la cabeza.', 'No arquees la lumbar.'] },
  { id: 'lateral_raise', name: 'Elevaciones laterales', muscle_group: 'Hombro', equipment: 'Mancuernas', emoji: '🔺',
    instructions: ['Codos ligeramente flexionados.', 'Sube hasta la altura de hombros.', 'Baja con control.'] },
  { id: 'face_pull', name: 'Face pull', muscle_group: 'Hombro', equipment: 'Polea', emoji: '🎯',
    instructions: ['Polea a la altura de la cara.', 'Jala hacia la frente abriendo codos.', 'Aprieta atrás.'] },

  // ── Brazo ──
  { id: 'biceps_curl', name: 'Curl de bíceps', muscle_group: 'Brazo', equipment: 'Mancuernas', emoji: '💪',
    instructions: ['Codos pegados al torso.', 'Sube sin balanceo.', 'Baja completamente.'] },
  { id: 'triceps_pushdown', name: 'Extensión de tríceps en polea', muscle_group: 'Brazo', equipment: 'Polea', emoji: '🔻',
    instructions: ['Codos fijos a los costados.', 'Extiende hasta abajo.', 'Controla la subida.'] },
  { id: 'dips', name: 'Fondos', muscle_group: 'Brazo', equipment: 'Paralelas', emoji: '⬇️',
    instructions: ['Hombros abajo y atrás.', 'Baja hasta 90° de codo.', 'Empuja hasta arriba.'] },

  // ── Core ──
  { id: 'plank', name: 'Plancha', muscle_group: 'Core', equipment: 'Peso corporal', emoji: '🧘',
    instructions: ['Antebrazos bajo los hombros.', 'Cuerpo en línea recta.', 'Aprieta abdomen y glúteos.'] },
  { id: 'hanging_leg_raise', name: 'Elevación de piernas colgado', muscle_group: 'Core', equipment: 'Barra fija', emoji: '🔝',
    instructions: ['Cuelga sin balancear.', 'Sube las piernas rectas.', 'Baja con control.'] },
  { id: 'cable_crunch', name: 'Crunch en polea', muscle_group: 'Core', equipment: 'Polea', emoji: '🙇',
    instructions: ['De rodillas, cuerda en la nuca.', 'Flexiona el tronco hacia abajo.', 'Vuelve lento.'] },

  // ── Glúteo ──
  { id: 'hip_thrust', name: 'Hip thrust', muscle_group: 'Glúteo', equipment: 'Barra', emoji: '🍑',
    instructions: ['Espalda alta apoyada en banco.', 'Empuja la cadera arriba.', 'Aprieta glúteos arriba.'] },
  { id: 'glute_bridge', name: 'Puente de glúteo', muscle_group: 'Glúteo', equipment: 'Peso corporal', emoji: '🌉',
    instructions: ['Acostado, pies cerca del glúteo.', 'Eleva la cadera.', 'Pausa arriba 1s.'] },
  { id: 'kickback', name: 'Patada de glúteo en polea', muscle_group: 'Glúteo', equipment: 'Polea', emoji: '🦵',
    instructions: ['Tobillera en la polea baja.', 'Lleva la pierna atrás.', 'Controla la vuelta.'] },

  // ── Cardio ──
  { id: 'run', name: 'Carrera', muscle_group: 'Cardio', equipment: 'Ninguno', emoji: '🏃',
    instructions: ['Ritmo constante o intervalos.', 'Pisada bajo el centro de masa.', 'Respira de forma rítmica.'] },
  { id: 'rowing', name: 'Remo (máquina)', muscle_group: 'Cardio', equipment: 'Remo', emoji: '🚣',
    instructions: ['Empuja con piernas primero.', 'Tira con espalda y brazos.', 'Vuelve en orden inverso.'] },
  { id: 'burpees', name: 'Burpees', muscle_group: 'Cardio', equipment: 'Peso corporal', emoji: '🔥',
    instructions: ['Baja a flexión.', 'Salta a posición de pie.', 'Salto vertical arriba.'] },
];

/** Busca un grupo muscular aproximado a partir del texto del plan (que puede variar). */
export function exercisesForGroup(group: string): LibraryExercise[] {
  const g = group.toLowerCase();
  return EXERCISE_LIBRARY.filter((e) =>
    e.muscle_group.toLowerCase() === g ||
    g.includes(e.muscle_group.toLowerCase()) ||
    e.muscle_group.toLowerCase().includes(g)
  );
}
