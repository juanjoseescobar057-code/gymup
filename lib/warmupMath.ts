// lib/warmupMath.ts
// ─────────────────────────────────────────────────────────
// Calentamiento y vuelta a la calma. Puro y sin dependencias: son
// recomendaciones que van a leer personas con lesiones y condiciones reales,
// así que tienen que ser probables sin arrancar la app.
//
// Por qué un catálogo local y no la IA:
//   • Funciona sin señal, al instante y sin gastar cupo — el calentamiento es
//     lo PRIMERO de la sesión, y hacerlo esperar a una llamada de red es
//     garantizar que la gente lo salte.
//   • Es determinista. Un modelo puede improvisar un movimiento
//     contraindicado; una lista revisada, no.
//
// Distinción que sí importa y no es decorativa: el calentamiento es DINÁMICO
// (movilidad en movimiento + series de aproximación) y la vuelta a la calma
// es ESTÁTICA (mantener el estiramiento). Estirar estático y a fondo ANTES de
// levantar reduce algo la fuerza disponible; después no.
//
// AVISO: esto no sustituye a un profesional. El filtro de abajo quita lo que
// choca con lesiones y condiciones declaradas, pero no "trata" ninguna: si
// algo duele, no se hace. Ver CLINICAL_REVIEW_STATUS en healthMath.
// ─────────────────────────────────────────────────────────

import type { Condition, HealthProfile, InjuryZone, RiskLevel } from './healthMath';

/**
 * Etiquetas de lo que EXIGE un movimiento. Es lo que permite descartarlo sin
 * repetir aquí la lógica clínica: cada ítem declara qué demanda, y el filtro
 * lo cruza con lo que la persona declaró.
 */
export type DemandaMovimiento =
  | 'flexion_lumbar'      // doblar la columna hacia delante
  | 'rodilla_profunda'    // flexión profunda de rodilla
  | 'hombro_sobre_cabeza'
  | 'cuello_rango'
  | 'muneca_carga'
  | 'cadera_rango'
  | 'tobillo_rango'
  | 'impacto'             // saltos, trote
  | 'supino'              // tumbado boca arriba
  | 'intensidad_alta';

export type ItemMovilidad = {
  nombre: string;
  duracion: string;
  como: string;
  demandas: DemandaMovimiento[];
};

/**
 * Qué demandas se descartan por cada lesión declarada. No es un tratamiento:
 * es "esto lo dejamos fuera hasta que un profesional diga lo contrario".
 */
const VETO_POR_LESION: Record<InjuryZone, DemandaMovimiento[]> = {
  rodilla:      ['rodilla_profunda', 'impacto'],
  hombro:       ['hombro_sobre_cabeza'],
  espalda_baja: ['flexion_lumbar', 'impacto'],
  cuello:       ['cuello_rango', 'hombro_sobre_cabeza'],
  muneca_codo:  ['muneca_carga'],
  cadera:       ['cadera_rango', 'impacto'],
  tobillo_pie:  ['tobillo_rango', 'impacto'],
};

/**
 * Y por condición. Las tres primeras salen de las directivas que ya usa el
 * tamizaje (ver healthMath): embarazo prohíbe supino prolongado tras el primer
 * trimestre, impacto y riesgo de caída; cardiopatía y asma piden progresivo
 * sin picos; hernia discal veta la flexión lumbar cargada o repetida.
 */
const VETO_POR_CONDICION: Partial<Record<Condition, DemandaMovimiento[]>> = {
  embarazo:         ['supino', 'impacto', 'intensidad_alta'],
  cardiopatia:      ['intensidad_alta', 'impacto'],
  asma:             ['intensidad_alta'],
  hernia_discal:    ['flexion_lumbar'],
  cirugia_reciente: ['impacto', 'intensidad_alta'],
  artritis:         ['impacto'],
};

/** Movilidad general: entra siempre, salvo veto. */
const GENERAL: ItemMovilidad[] = [
  {
    nombre: 'Caminar o bici suave',
    duracion: '3-5 min',
    como: 'Ritmo en el que podrías hablar sin quedarte sin aire. Solo se trata de subir la temperatura.',
    demandas: [],
  },
  {
    nombre: 'Círculos de hombros y brazos',
    duracion: '30 s',
    como: 'Hacia atrás y hacia delante, sin forzar el final del recorrido.',
    demandas: ['hombro_sobre_cabeza', 'cuello_rango'],
  },
];

/** Movilidad por grupo muscular del día. Las claves se buscan por substring. */
const POR_GRUPO: { claves: string[]; items: ItemMovilidad[] }[] = [
  {
    claves: ['pierna', 'cuádriceps', 'cuadriceps', 'glúteo', 'gluteo', 'isquio', 'femoral'],
    items: [
      { nombre: 'Sentadilla sin peso', duracion: '10 reps', como: 'Baja solo hasta donde controles, sin rebotar abajo.', demandas: ['rodilla_profunda'] },
      { nombre: 'Balanceo de pierna', duracion: '10 por lado', como: 'Adelante y atrás, apoyándote en una pared. Rango cómodo, sin tirones.', demandas: ['cadera_rango'] },
      { nombre: 'Puente de glúteos', duracion: '12 reps', como: 'Tumbado, sube la cadera apretando el glúteo arriba 1 segundo.', demandas: ['supino'] },
      { nombre: 'Movilidad de tobillo', duracion: '8 por lado', como: 'Rodilla hacia delante sobre el pie sin despegar el talón.', demandas: ['tobillo_rango'] },
    ],
  },
  {
    claves: ['pecho', 'tríceps', 'triceps', 'hombro'],
    items: [
      { nombre: 'Rotación de hombros con banda o toalla', duracion: '10 reps', como: 'Manos anchas, pasa los brazos de delante hacia atrás sin doblar los codos.', demandas: ['hombro_sobre_cabeza'] },
      { nombre: 'Flexiones en pared', duracion: '12 reps', como: 'De pie frente a la pared, controla la bajada. Sirve para despertar el pecho sin carga.', demandas: ['muneca_carga'] },
    ],
  },
  {
    claves: ['espalda', 'bíceps', 'biceps', 'dorsal'],
    items: [
      { nombre: 'Gato-camello', duracion: '8 reps', como: 'A cuatro patas, alterna redondear y arquear la espalda SIN llegar al dolor.', demandas: ['flexion_lumbar'] },
      { nombre: 'Retracción de escápulas', duracion: '12 reps', como: 'Junta los omóplatos como si sostuvieras un lápiz entre ellos, 2 segundos.', demandas: ['cuello_rango'] },
    ],
  },
  {
    claves: ['core', 'abdomen', 'abdominal'],
    items: [
      { nombre: 'Bird-dog', duracion: '8 por lado', como: 'A cuatro patas, extiende brazo y pierna contrarios sin que la cadera se ladee.', demandas: ['muneca_carga', 'hombro_sobre_cabeza', 'cadera_rango'] },
      { nombre: 'Plancha corta', duracion: '20 s', como: 'Costillas abajo y glúteo apretado. Si la espalda se arquea, párate.', demandas: ['muneca_carga'] },
    ],
  },
];

/** Estiramientos estáticos de vuelta a la calma, por grupo. */
const ESTIRAMIENTOS: { claves: string[]; items: ItemMovilidad[] }[] = [
  {
    claves: ['pierna', 'cuádriceps', 'cuadriceps', 'glúteo', 'gluteo', 'isquio', 'femoral'],
    items: [
      { nombre: 'Cuádriceps de pie', duracion: '30 s por lado', como: 'Talón al glúteo, rodillas juntas. Apóyate en algo si hace falta.', demandas: ['rodilla_profunda'] },
      { nombre: 'Isquiotibiales sentado', duracion: '30 s por lado', como: 'Sentado, una pierna estirada, inclínate desde la CADERA sin redondear la espalda.', demandas: ['flexion_lumbar'] },
      { nombre: 'Figura 4 de glúteo', duracion: '30 s por lado', como: 'Tumbado, cruza un tobillo sobre la rodilla contraria y acerca el muslo al pecho.', demandas: ['supino', 'cadera_rango'] },
    ],
  },
  {
    claves: ['pecho', 'tríceps', 'triceps', 'hombro'],
    items: [
      { nombre: 'Pecho en marco de puerta', duracion: '30 s por lado', como: 'Antebrazo en el marco, gira el cuerpo despacio hasta notar tensión, no dolor.', demandas: ['hombro_sobre_cabeza'] },
      { nombre: 'Tríceps sobre la cabeza', duracion: '30 s por lado', como: 'Codo arriba, mano hacia la espalda, ayuda suave con la otra mano.', demandas: ['hombro_sobre_cabeza'] },
    ],
  },
  {
    claves: ['espalda', 'bíceps', 'biceps', 'dorsal'],
    items: [
      { nombre: 'Dorsal colgado o en barra', duracion: '30 s por lado', como: 'Agarra algo fijo, deja caer la cadera hacia atrás y lateral.', demandas: ['hombro_sobre_cabeza'] },
      { nombre: 'Apertura torácica en el suelo', duracion: '30 s por lado', como: 'De lado, abre el brazo de arriba siguiendo la mano con la mirada.', demandas: ['hombro_sobre_cabeza', 'cuello_rango'] },
    ],
  },
  {
    claves: ['core', 'abdomen', 'abdominal'],
    items: [
      { nombre: 'Estiramiento de flexores de cadera', duracion: '30 s por lado', como: 'Rodilla en el suelo, mete la pelvis y avanza la cadera sin arquear la lumbar.', demandas: ['cadera_rango'] },
    ],
  },
];

export type ContextoSalud = {
  injuries: InjuryZone[];
  conditions: Condition[];
  /** true si el tamizaje no se pudo leer: se cae a lo más conservador. */
  desconocido?: boolean;
  /** Datos para extender el calentamiento sin depender de la IA. */
  age?: number;
  riskLevel?: RiskLevel;
  profile?: HealthProfile | null;
};

function vetadas(ctx: ContextoSalud): Set<DemandaMovimiento> {
  const v = new Set<DemandaMovimiento>();
  // Si no sabemos nada del estado de salud, no se adivina: se descartan las
  // demandas que más daño pueden hacer si hay algo sin declarar. Es la misma
  // regla de "fallar cerrado" que usa el resto de la app.
  if (ctx.desconocido) {
    // Sin contexto no se conoce qué articulación o posición está limitada.
    // Se conserva únicamente el cierre/caminar general; todas las demandas
    // articulares quedan fuera hasta restaurar el tamizaje.
    [
      'impacto', 'intensidad_alta', 'flexion_lumbar', 'rodilla_profunda',
      'hombro_sobre_cabeza', 'cuello_rango', 'muneca_carga', 'cadera_rango',
      'tobillo_rango', 'supino',
    ].forEach((d) => v.add(d as DemandaMovimiento));
    return v;
  }
  for (const l of ctx.injuries) (VETO_POR_LESION[l] ?? []).forEach((d) => v.add(d));
  for (const c of ctx.conditions) (VETO_POR_CONDICION[c] ?? []).forEach((d) => v.add(d));
  return v;
}

function coincide(grupos: string[], claves: string[]): boolean {
  const texto = grupos.join(' ').toLowerCase();
  return claves.some((k) => texto.includes(k));
}

function filtrar(items: ItemMovilidad[], veto: Set<DemandaMovimiento>): ItemMovilidad[] {
  return items.filter((i) => !i.demandas.some((d) => veto.has(d)));
}

/**
 * Calentamiento para los grupos musculares del día.
 *
 * Siempre devuelve algo: si los vetos dejaran la lista vacía, queda el paseo
 * suave, que no tiene demandas. Una lista vacía sería peor que inútil —
 * parecería que la app no considera necesario calentar.
 */
export function calentamientoPara(muscleGroups: string[], ctx: ContextoSalud): ItemMovilidad[] {
  const veto = vetadas(ctx);
  const general = GENERAL.map((item) => {
    if (item.nombre !== 'Caminar o bici suave') return item;
    const extendido =
      (ctx.age ?? 0) >= 65 ||
      ctx.conditions.includes('cardiopatia') ||
      ctx.conditions.includes('asma');
    return extendido ? { ...item, duracion: '8-10 min' } : item;
  });
  const items = [...filtrar(general, veto)];
  for (const g of POR_GRUPO) {
    if (coincide(muscleGroups, g.claves)) items.push(...filtrar(g.items, veto));
  }
  return items.length > 0 ? items : [GENERAL[0]];
}

/**
 * Cierre válido para cualquiera: sin demandas, sin rango articular exigente.
 * Existe para que la vuelta a la calma NUNCA quede vacía — un grupo muscular
 * que no reconocemos, o alguien con muchas restricciones, no puede acabar sin
 * ninguna indicación de cierre. El silencio se leería como "hoy no hace falta".
 */
const CIERRE_GENERAL: ItemMovilidad[] = [
  {
    nombre: 'Caminar suave',
    duracion: '2-3 min',
    como: 'Baja el ritmo poco a poco hasta que la respiración vuelva a la normalidad.',
    demandas: [],
  },
];

/** Vuelta a la calma: estiramientos ESTÁTICOS de lo que se acaba de trabajar. */
export function estiramientoPara(muscleGroups: string[], ctx: ContextoSalud): ItemMovilidad[] {
  const veto = vetadas(ctx);
  const items: ItemMovilidad[] = [];
  for (const g of ESTIRAMIENTOS) {
    if (coincide(muscleGroups, g.claves)) items.push(...filtrar(g.items, veto));
  }
  return items.length > 0 ? items : CIERRE_GENERAL;
}

/**
 * Series de aproximación del primer ejercicio. Es la parte del calentamiento
 * que NINGÚN catálogo genérico puede darte, porque depende de lo que vayas a
 * levantar hoy — y es la que de verdad prepara ese movimiento.
 */
export function seriesDeAproximacion(
  primerEjercicio: string | null,
  pesoTrabajoKg?: number | null
): string | null {
  if (!primerEjercicio) return null;
  const esCompuesto = /sentadilla|peso muerto|press|remo|dominada|hip thrust|prensa/i.test(primerEjercicio);
  if (!pesoTrabajoKg || pesoTrabajoKg <= 0) {
    return `Antes de ${primerEjercicio}: haz ${esCompuesto ? '2-3' : '1-2'} series progresivas del mismo movimiento, con pocas repeticiones y sin acercarte al fallo. No cuentan para tu registro.`;
  }
  const redondear = (n: number) => Math.max(1, Math.round(n / 2.5) * 2.5);
  if (!esCompuesto || pesoTrabajoKg < 25) {
    return `Antes de ${primerEjercicio}: 1 serie de 8 repeticiones con ~${redondear(pesoTrabajoKg * 0.5)} kg y otra de 3-5 repeticiones con ~${redondear(pesoTrabajoKg * 0.7)} kg. Sin fatiga; no cuentan para tu registro.`;
  }
  return `Antes de ${primerEjercicio}: 8 repeticiones con ~${redondear(pesoTrabajoKg * 0.4)} kg, 5 con ~${redondear(pesoTrabajoKg * 0.6)} kg y 2-3 con ~${redondear(pesoTrabajoKg * 0.8)} kg. Descansa brevemente y empieza tu carga de trabajo; ninguna serie de aproximación va al fallo.`;
}

/** Estimación honesta para el copy; incluye trabajo por lado. */
export function minutosEstimados(items: ItemMovilidad[]): number {
  let segundos = 0;
  for (const item of items) {
    const rango = item.duracion.match(/(\d+)(?:-(\d+))?\s*min/i);
    if (rango) {
      segundos += Number(rango[2] ?? rango[1]) * 60;
      continue;
    }
    const valor = Number(item.duracion.match(/\d+/)?.[0] ?? 30);
    const porLado = /por lado/i.test(item.duracion);
    segundos += /rep/i.test(item.duracion) ? valor * 3 * (porLado ? 2 : 1) : valor * (porLado ? 2 : 1);
  }
  return Math.max(1, Math.ceil(segundos / 60));
}
