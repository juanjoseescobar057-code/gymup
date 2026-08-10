// lib/planJsonSchema.ts
// ─────────────────────────────────────────────────────────
// Esquema JSON del plan semanal para Structured Outputs de OpenAI.
//
// POR QUÉ EXISTE. Antes el formato se PEDÍA en prosa ("responde ÚNICAMENTE
// con ese JSON, con los 7 días, SIEMPRE") junto a un ejemplo. Eso convierte
// la estructura en una sugerencia: el modelo puede cumplirla o no, y cuando
// el prompt lleva además ~900 tokens de reglas que le dicen "niégate con
// respeto y explica los riesgos", la contradicción se resuelve devolviendo un
// objeto vacío. Lo vimos en la telemetría: 10, 11 y 12 tokens de salida
// contra los ~1.000 de un plan real, sin ningún error.
//
// Con `strict: true` la API GARANTIZA la forma: el modelo no puede devolver
// `{}` ni omitir "days". No es un prompt mejor escrito, es que deja de
// depender de que el modelo obedezca.
//
// Límite conocido: strict NO admite minItems, así que "exactamente 7 días" no
// se puede exigir aquí. Eso lo sigue validando WeeklyPlanSchema con zod, y por
// eso el generador reintenta. Lo que esto elimina es el fallo dominante — el
// objeto vacío—, no toda la clase.
//
// Reglas de strict que hay que respetar o la API rechaza la petición:
//   • additionalProperties: false en TODO objeto
//   • todas las propiedades listadas en `required` (lo opcional se modela
//     como tipo nullable, no omitiéndolo)
// ─────────────────────────────────────────────────────────

const ejercicio = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'Nombre del ejercicio en español.' },
    sets: { type: 'integer', description: 'Series, entre 1 y 12.' },
    reps: { type: 'string', description: 'Rango de repeticiones, por ejemplo "8-10".' },
    rest_seconds: { type: 'integer', description: 'Descanso entre series, en segundos.' },
    notes: { type: 'string', description: 'Indicación breve de técnica. Puede ir vacío.' },
    muscle_group: { type: 'string', description: 'Grupo muscular principal.' },
    // Opcionales del esquema zod: en strict van como nullable, no ausentes.
    target_rir: { type: ['integer', 'null'], description: 'Repeticiones en reserva objetivo (0-10).' },
    intensity_method: { type: ['string', 'null'], enum: ['none', 'drop_set', null] },
  },
  required: ['name', 'sets', 'reps', 'rest_seconds', 'notes', 'muscle_group', 'target_rir', 'intensity_method'],
};

const dia = {
  type: 'object',
  additionalProperties: false,
  properties: {
    day: { type: 'integer', description: 'Número de día, del 1 al 7.' },
    day_name: { type: 'string', description: 'Nombre del día: Lunes, Martes…' },
    type: { type: 'string', enum: ['workout', 'rest', 'active_recovery'] },
    muscle_groups: { type: 'array', items: { type: 'string' } },
    estimated_duration_min: { type: 'integer' },
    exercises: {
      type: 'array',
      items: ejercicio,
      description: 'Vacío SOLO en días de tipo rest o active_recovery.',
    },
    notes: { type: 'string', description: 'Nota del día. Aquí va la recomendación de consultar a un profesional si algo del tamizaje lo amerita.' },
    activities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Actividades ligeras en días de recuperación activa.',
    },
  },
  required: ['day', 'day_name', 'type', 'muscle_groups', 'estimated_duration_min', 'exercises', 'notes', 'activities'],
};

export const PLAN_JSON_SCHEMA = {
  name: 'plan_semanal',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overview: { type: 'string', description: 'Resumen de una o dos frases del enfoque de la semana.' },
      days: {
        type: 'array',
        items: dia,
        description: 'EXACTAMENTE 7 elementos, uno por día de la semana.',
      },
    },
    required: ['overview', 'days'],
  },
} as const;
