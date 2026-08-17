// lib/motivacion.ts
// ─────────────────────────────────────────────────────────
// QUÉ DECIRLE A QUIEN VUELVE. Puro y determinista.
//
// Volver después de días parado es el momento en que más gente abandona: la
// app te recibe con el mismo día que dejaste, sin acusar recibo de que
// pasaron dos semanas. Aquí se acusa recibo, y con humor.
//
// EL HUMOR VA SOBRE HÁBITOS, NUNCA SOBRE CUERPOS.
// "Tu ex lleva tres semanas yendo al gimnasio" habla de constancia y hace
// gracia. "Tu ex está más en forma que tú" habla del cuerpo de alguien y
// duele. La diferencia parece pequeña y no lo es: la segunda es la que
// convierte una broma en el motivo por el que alguien desinstala.
//
// Y HAY GENTE PARA LA QUE NO HAY BROMA QUE VALGA.
// Si el tamizaje de salud activó el modo recuperación (lib/recoveryMode.ts),
// aquí no entra ni humor comparativo ni pique: para quien está saliendo de un
// trastorno de la conducta alimentaria, "tu ex ha sido más constante" no es un
// chiste, es un disparador. En ese modo los mensajes son cálidos, en primera
// persona y sin nadie con quien compararse. Fallar cerrado: si no se pudo leer
// la salud, tampoco hay bromas.
// ─────────────────────────────────────────────────────────

export type MensajeRegreso = {
  /** Identidad estable del mensaje, para no repetirlo dos días seguidos. */
  clave: string;
  titulo: string;
  cuerpo: string;
  /** true si lleva pique. Falso en modo recuperación y en tramos suaves. */
  conHumor: boolean;
};

type Tramo = { min: number; max: number; nombre: string };

const TRAMOS: Tramo[] = [
  { min: 1, max: 2, nombre: 'corto' },
  { min: 3, max: 6, nombre: 'medio' },
  { min: 7, max: 13, nombre: 'semana' },
  { min: 14, max: 29, nombre: 'largo' },
  { min: 30, max: Infinity, nombre: 'muy_largo' },
];

// El pique. Todos hablan de CONSTANCIA —quién apareció y quién no— y ninguno
// del cuerpo, el peso ni el aspecto de nadie.
const CON_HUMOR: Record<string, string[]> = {
  medio: [
    'Tu ex lleva tres días seguidos entrenando. Tres. Seguidos.',
    'El gimnasio preguntó por ti. Le dije que estabas ocupado.',
    'Tus mancuernas están bien, gracias por no preguntar.',
  ],
  semana: [
    'Tu ex lleva una semana sin fallar un solo día. ¿Y tú?',
    'Una semana. Tu plan de entrenamiento empezó a ver otras personas.',
    'Ese que te robó a tu ex lleva siete días entrenando. Solo lo menciono.',
  ],
  largo: [
    'Dos semanas. Tu ex ya tiene rutina, playlist y botella de esas caras.',
    'Tu ex no falló ni un día en dos semanas. Y encima lo cuenta.',
    'Dos semanas fuera. La buena noticia: se vuelve más rápido de lo que se pierde.',
  ],
  muy_largo: [
    'Un mes. Tu ex ya se sabe el nombre del de la recepción.',
    'Un mes fuera. Empezamos otra vez, y esta vez sin prisa.',
    'Volviste. Eso ya te pone por delante de quien no volvió.',
  ],
};

// Sin pique: para el tramo corto, y para todo el mundo en modo recuperación.
// Hablan de la persona y de lo que sigue, nunca de nadie más.
const SIN_HUMOR: Record<string, string[]> = {
  corto: [
    'Un par de días de pausa no borran nada. Seguimos donde lo dejaste.',
    'Aquí estás. Eso es lo que cuenta.',
  ],
  medio: [
    'Unos días fuera. Retomamos con calma.',
    'Volviste, y eso es lo difícil. Lo de hoy sale solo.',
  ],
  semana: [
    'Una semana de pausa. Hoy vamos suave para reencontrar el gesto.',
    'Retomar después de una semana es normal. Bajamos un poco la carga y listo.',
  ],
  largo: [
    'Un par de semanas fuera. Empezamos más ligero: en dos sesiones vuelves a tu ritmo.',
    'Volver es la parte difícil y ya la hiciste. Hoy toca poco y bien.',
  ],
  muy_largo: [
    'Ha pasado un tiempo, y no pasa nada. Empezamos otra vez desde donde estás hoy.',
    'Volviste. Vamos despacio, sin comparar con lo de antes.',
  ],
};

function tramoDe(dias: number): Tramo | null {
  return TRAMOS.find((t) => dias >= t.min && dias <= t.max) ?? null;
}

/**
 * Elige de forma estable dentro de la lista. La semilla la pone quien llama
 * (normalmente la fecha), así el mensaje NO cambia cada vez que se repinta la
 * pantalla pero sí de un día para otro.
 */
function elegir(opciones: string[], semilla: number): string {
  if (opciones.length === 0) return '';
  const i = Math.abs(Math.trunc(semilla)) % opciones.length;
  return opciones[i];
}

/**
 * El mensaje para quien vuelve tras `dias` sin entrenar.
 *
 * Devuelve null por debajo de un día: no hay nada que celebrar ni que
 * reprochar en alguien que entrenó ayer.
 */
export function mensajeDeRegreso(args: {
  dias: number;
  /** true = modo recuperación activo, o la salud no se pudo leer. */
  sinComparaciones: boolean;
  /** Normalmente el día del mes. Mantiene el mensaje fijo dentro del día. */
  semilla: number;
}): MensajeRegreso | null {
  if (!Number.isFinite(args.dias) || args.dias < 1) return null;

  const tramo = tramoDe(args.dias);
  if (!tramo) return null;

  // El tramo corto nunca lleva pique: bromear con quien se saltó UN día es
  // castigar una pausa normal, y enseña que la app juzga.
  const conHumor = !args.sinComparaciones && tramo.nombre !== 'corto';
  const fuente = conHumor ? CON_HUMOR[tramo.nombre] : SIN_HUMOR[tramo.nombre];
  const cuerpo = elegir(fuente ?? SIN_HUMOR.medio, args.semilla);

  const titulo =
    args.dias === 1
      ? 'Un día sin entrenar'
      : `${args.dias} días sin entrenar`;

  return {
    clave: `regreso_${tramo.nombre}_${conHumor ? 'humor' : 'neutro'}`,
    titulo,
    cuerpo,
    conHumor,
  };
}
