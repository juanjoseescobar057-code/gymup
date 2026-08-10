import type {
  UserProfile, FoodLog, BiologicalSex, WeeklyPlan, TrainingDay, Exercise,
} from './supabase';
import { AI_SAFETY_RULES, SLEEP_RECOVERY_GUIDANCE } from './safety';
import { imageToOptimizedBase64 } from './image';
import { parseAI, WeeklyPlanSchema, FoodResultSchema, AIShapeError } from './schemas';
import { captureError } from './monitoring';
import { PLAN_JSON_SCHEMA } from './planJsonSchema';
import { aiChatContent as chat } from './aiClient';
import { evaluateWorkoutAccess, healthToPrompt, type HealthProfile } from './healthMath';

// Los tipos del plan viven en lib/supabase.ts (fuente única) y aquí solo se
// re-exportan. Antes había una copia local que se quedó atrás cuando el esquema
// ganó notes/activities: el prompt podía pedir campos que el tipo de este
// módulo juraba que no existían.
export type { WeeklyPlan, TrainingDay, Exercise };

/** Experiencia real declarada en el onboarding. Determina complejidad y progresión. */
export type TrainingExperience = 'principiante' | 'intermedio' | 'avanzado';

/** Equipo disponible. Restringe QUÉ ejercicios puede pedir el plan. */
export type EquipmentAccess = 'gym' | 'casa_basico' | 'casa_sin_equipo';

/**
 * Insumos del generador de plan. Los tres últimos campos son opcionales porque
 * las preguntas se añadieron después del lanzamiento y todavía no tienen columna
 * en user_profiles: los perfiles viejos llegan sin ellos y el plan igual se genera.
 */
export type PlanProfile =
  Pick<UserProfile, 'age' | 'sex' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'> & {
    experience?: TrainingExperience;
    days_per_week?: number;
    equipment?: EquipmentAccess;
  };

// Programación por sexo biológico: son TENDENCIAS poblacionales de la fuerza
// aplicada, no reglas sobre la persona que tenemos delante. Por eso el prompt
// cierra siempre recordando que objetivo, experiencia y lesiones mandan encima.
// El motivo de recogerlo era el BMR (la constante masculina metía ~166 kcal/día
// de error a las mujeres), pero una vez que se sabe también cambia cómo se
// reparte el volumen, y no usarlo sería desperdiciar el dato.
const SEX_GUIDANCE: Record<BiologicalSex, string> = {
  female: `PROGRAMACIÓN SEGÚN SEXO BIOLÓGICO (mujer):
- Suele tolerar más volumen y más frecuencia por grupo muscular, con recuperación más rápida entre series: puedes acortar algo los descansos y repetir un grupo dentro de la semana si los días lo permiten.
- Responde muy bien al trabajo de tren inferior y cadena posterior (sentadilla, bisagra de cadera, empuje de cadera, femoral) con rangos de repetición moderados-altos.
- NO bajes la carga, las series ni la exigencia "por ser mujer", y NO asumas que el objetivo es "tonificar": el objetivo declarado manda y se programa con la misma seriedad.`,
  male: `PROGRAMACIÓN SEGÚN SEXO BIOLÓGICO (hombre):
- Tiende a sobre-priorizar tren superior y patrones de empuje. Equilibra: al menos tanto volumen de tirón como de empuje, y tren inferior con peso real en la semana, no un día simbólico al final.`,
  unspecified: `PROGRAMACIÓN SEGÚN SEXO BIOLÓGICO (no declarado):
- Programa de forma neutra. No deduzcas el sexo a partir del objetivo, el peso o la altura, ni ajustes nada por esa suposición. Equilibra empuje/tirón y tren superior/inferior por defecto.`,
};

const SEX_LABEL: Record<BiologicalSex, string> = {
  male: 'hombre',
  female: 'mujer',
  unspecified: 'no declarado',
};

// Experiencia: un principiante progresa con volumen y frecuencia que a un
// avanzado ya no le mueven la aguja, y el volumen del avanzado al novato lo lesiona.
const EXPERIENCE_GUIDANCE: Record<TrainingExperience, string> = {
  principiante: 'principiante (menos de 6 meses entrenando). Patrones básicos (sentadilla, bisagra de cadera, empuje, tirón, zancada, core), 1-2 ejercicios por grupo, sin técnicas de intensidad ni trabajo al fallo. La progresión se gana primero por TÉCNICA y repeticiones, y solo después por carga.',
  intermedio: 'intermedio (6 meses a 2 años). Admite variantes y algo más de volumen; progresión alternando carga y repeticiones, con series cerca del fallo pero sin llegar a él de forma sistemática.',
  avanzado: 'avanzado (2+ años con progresión estructurada). Admite más volumen, variantes específicas y técnicas de intensidad puntuales (series descendentes, rest-pause) solo en las últimas series de ejercicios seguros.',
};

// Equipo: pedir barras y máquinas a quien entrena en la sala de su casa es
// garantía de abandono en el primer día.
const EQUIPMENT_GUIDANCE: Record<EquipmentAccess, string> = {
  gym: 'gimnasio completo (barras, discos, mancuernas, máquinas y poleas).',
  casa_basico: 'casa con equipo básico: mancuernas y/o bandas elásticas más peso corporal. PROHIBIDO usar barras, discos, máquinas, poleas o rack; si el ejercicio ideal los necesita, sustitúyelo por la variante con mancuerna, banda o peso corporal.',
  casa_sin_equipo: 'casa SIN equipo: solo peso corporal y objetos domésticos. PROHIBIDO usar barras, discos, mancuernas, máquinas, poleas o bandas. La intensidad se ajusta con la variante (apoyo, recorrido, tempo, unilateral), nunca con carga externa.',
};

// Perfiles anteriores a la pregunta: en vez de inventar un número fijo se deriva
// del nivel de actividad, que sí tenemos desde siempre.
const DIAS_POR_ACTIVIDAD: Record<string, number> = {
  sedentary: 3,
  light: 3,
  moderate: 4,
  active: 5,
  very_active: 5,
};

export async function generateTrainingPlan(
  profile: PlanProfile,
  health?: HealthProfile | null
): Promise<WeeklyPlan> {
  if (!health) {
    throw new Error('Completa y guarda Mi salud antes de generar una rutina. No vamos a asumir que entrenar es seguro.');
  }
  const access = evaluateWorkoutAccess(health, profile.age);
  if (access.status === 'blocked') throw new Error(access.detail);
  const g: Record<string, string> = {
    muscle_gain: 'ganar masa muscular',
    fat_loss: 'perder grasa',
    performance: 'mejorar rendimiento',
    endurance: 'mejorar resistencia',
  };
  const a: Record<string, string> = {
    sedentary: 'sedentario',
    light: 'ligero 1-2 días',
    moderate: 'moderado 3-4 días',
    active: 'activo 5-6 días',
    very_active: 'muy activo',
  };
  // Directivas individuales: lesiones/condiciones/edad mandan sobre el objetivo.
  const healthBlock = healthToPrompt(health, profile.age);

  // Los perfiles creados antes de que existiera la columna llegan sin sexo: se
  // tratan como 'unspecified' en vez de reintroducir el sesgo masculino por defecto.
  const sex: BiologicalSex = SEX_GUIDANCE[profile.sex] ? profile.sex : 'unspecified';
  const experience: TrainingExperience =
    EXPERIENCE_GUIDANCE[profile.experience!] ? profile.experience! : 'principiante';
  // Los días son un compromiso del usuario, no una preferencia: se acota al rango
  // que ofrece el onboarding para que un dato corrupto no pida 9 días de entreno.
  const dias = Math.min(6, Math.max(2, Math.round(
    profile.days_per_week ?? DIAS_POR_ACTIVIDAD[profile.activity_level] ?? 3
  )));
  const descanso = 7 - dias;
  // Sin equipo declarado NO se elige uno por nosotros: adivinar "gimnasio" deja
  // el plan inservible en casa, y adivinar "casa" deja fuerza sin usar. Se le
  // dice al modelo que no lo sabe y que programe por el mínimo común.
  const equipoLinea = profile.equipment
    ? EQUIPMENT_GUIDANCE[profile.equipment]
    : 'no declarado. Usa solo ejercicios posibles con peso corporal o mancuernas, y en las notas del ejercicio indica la variante de gimnasio como alternativa.';

  // SLEEP_RECOVERY_GUIDANCE ya viaja dentro de AI_SAFETY_RULES. Se comprueba en
  // vez de asumirlo: así el plan lo recibe siempre (incluso si algún día deja de
  // estar allí) sin repetir el mismo bloque dos veces en el prompt.
  const recoveryBlock = AI_SAFETY_RULES.includes(SLEEP_RECOVERY_GUIDANCE)
    ? ''
    : `\n${SLEEP_RECOVERY_GUIDANCE}\n`;

  // La ORDEN va primero y el muro de reglas después. El prompt son ~2.600
  // tokens de prohibiciones, y con la instrucción sepultada al final el modelo
  // devolvía un JSON vacío —10-12 tokens de salida contra los ~1.000 de un
  // plan real—: cumplía el formato sin hacer la tarea. Ponerlo delante no es
  // cosmética, es lo que el modelo lee como su trabajo.
  const prompt = `TAREA: crea un plan de entrenamiento de 7 días y devuélvelo como JSON.
Es OBLIGATORIO que el JSON traiga los 7 días CON CONTENIDO. Un objeto vacío, sin "days",
o con "days" vacío NO sirve: deja a la persona sin plan.

Entrenador personal élite. ${AI_SAFETY_RULES}
${recoveryBlock}${healthBlock ? `\n${healthBlock}\n` : ''}
Crea plan de entrenamiento 7 días para:
- Edad: ${profile.age} años
- Sexo biológico: ${SEX_LABEL[sex]}
- Peso: ${profile.weight_kg} kg
- Altura: ${profile.height_cm} cm
- Objetivo: ${g[profile.goal]}
- Actividad: ${a[profile.activity_level]}
- Experiencia: ${EXPERIENCE_GUIDANCE[experience]}
- Equipo disponible: ${equipoLinea}
- Días que puede entrenar por semana: ${dias}

${SEX_GUIDANCE[sex]}

JERARQUÍA NO NEGOCIABLE: el objetivo declarado, la experiencia y las lesiones o condiciones del tamizaje de salud MANDAN por encima de cualquier generalidad por sexo. Si algo choca, gana siempre lo individual.

RESTRICCIONES DEL PLAN (no son sugerencias):
- Exactamente ${dias} días de type "workout". Los otros ${descanso} son "rest" o "active_recovery" DE VERDAD: nada de sesiones disfrazadas de recuperación para rellenar la semana.
- Si el nivel de actividad y los días disponibles no cuadran, mandan los DÍAS: son los que esta persona puede sostener de verdad.
- Usa SOLO ejercicios posibles con el equipo declarado. Si el ejercicio ideal no cabe, sustitúyelo por la mejor variante disponible; nunca ignores la restricción.
- La complejidad de los ejercicios y la forma de progresar se ajustan a la experiencia declarada.

CÓMO DEBE APARECER EL DESCANSO EN LA SALIDA:
- El "overview" incluye una recomendación concreta de dormir 7-9 h por noche y deja claro que descansar es parte del plan, no un premio.
- Cada día "rest" o "active_recovery" lleva su "notes" explicando POR QUÉ existe (es cuando el músculo se construye: el entrenamiento da el estímulo, la adaptación ocurre después). Nunca lo dejes vacío ni con una nota genérica de relleno.
- En los días "active_recovery", "activities" lleva 2-3 opciones ligeras y concretas (caminar 25 min, movilidad de cadera, estiramientos).

SOLO JSON sin texto adicional:
{
  "overview": "descripción motivadora en 2 oraciones, con la pauta de sueño",
  "days": [
    {
      "day": 1,
      "day_name": "Lunes",
      "type": "workout",
      "muscle_groups": ["Pecho", "Tríceps"],
      "estimated_duration_min": 55,
      "notes": "Calienta 5 min antes de la primera serie pesada",
      "exercises": [
        {
          "name": "Press de banca",
          "sets": 4,
          "reps": "8-10",
          "rest_seconds": 90,
          "notes": "Mantén omóplatos retraídos",
          "muscle_group": "Pecho"
        }
      ]
    },
    {
      "day": 3,
      "day_name": "Miércoles",
      "type": "active_recovery",
      "muscle_groups": [],
      "estimated_duration_min": 25,
      "notes": "Hoy entrenas descansando: el músculo se construye ahora, no dentro de la serie",
      "activities": ["Caminata suave 25 min", "Movilidad de cadera y hombro"],
      "exercises": []
    }
  ]
}
Incluye los 7 días. type puede ser: workout, rest, active_recovery.

OBLIGATORIO: responde ÚNICAMENTE con ese JSON, con los 7 días, SIEMPRE.
Si algo del tamizaje de salud te preocupa (una molestia descrita, una condición, una
lesión), NO te niegues ni respondas con texto: eso deja a la persona sin plan y sin tu
advertencia. Devuelve el JSON con el plan MÁS conservador que se te ocurra —movilidad,
caminata suave, nada que cargue la zona afectada— y escribe la recomendación de
consultar a un profesional en el campo "notes" de los días correspondientes.`;

  // REINTENTO AUTOMÁTICO. El modelo devuelve un JSON vacío de vez en cuando —lo
  // vimos en la telemetría: cuatro intentos de 10-12 tokens de salida contra
  // uno bueno de 1.027— y hasta ahora eso dejaba a la persona sin plan justo al
  // terminar el onboarding, con un botón para reintentar A MANO. Reintentarlo
  // nosotros es lo mismo que ella iba a hacer, sin el mal trago.
  //
  // La temperatura baja en cada intento: si a 0.7 salió vacío, insistir con la
  // misma aleatoriedad es esperar suerte. Y el recordatorio se hace más
  // explícito, porque lo que falla no es el formato sino hacer la tarea.
  const INTENTOS = 3;
  let ultimoError: unknown = null;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    const refuerzo = intento === 1 ? '' :
      `\n\nAVISO: en el intento anterior devolviste un JSON sin los 7 días. ` +
      `Devuelve AHORA el objeto completo con "overview" y "days" de 7 elementos.`;
    try {
      const content = await chat({
        // Snapshot FIJO, no el alias. El alias mueve el comportamiento del
        // modelo sin avisar y esta llamada decide lo que se le programa a
        // alguien con una hernia o un problema cardiaco.
        model: 'gpt-4o-2024-08-06',
        messages: [{ role: 'user', content: prompt + refuerzo }],
        // Salida ESTRUCTURADA: la forma la impone la API, no una frase del
        // prompt. Antes se pedía en prosa y el modelo podía devolver `{}` —y
        // lo hacía—, porque el mismo prompt le ordenaba negarse en texto ante
        // cualquier duda de salud y el formato JSON le prohibía el texto.
        response_format: { type: 'json_schema', json_schema: PLAN_JSON_SCHEMA },
        temperature: intento === 1 ? 0.7 : 0.2,
      }, 'plan');
      return parseAI(WeeklyPlanSchema, content, 'plan de entrenamiento') as WeeklyPlan;
    } catch (e) {
      ultimoError = e;
      // Solo se reintenta si el fallo es de FORMA. Un 402, un 429 o un corte de
      // red no mejoran repitiendo: se propagan tal cual y con su mensaje.
      if (!(e instanceof AIShapeError)) throw e;
      // La forma del fallo se registra SIEMPRE: hasta ahora ese diagnóstico se
      // construía y se tiraba, y por eso llevábamos días adivinando.
      captureError(e, {
        scope: 'generateTrainingPlan.forma',
        intento,
        es_json: e.forma.esJson,
        largo: e.forma.largo,
        claves_raiz: e.forma.clavesRaiz.join(','),
        rutas_fallidas: e.forma.rutasFallidas.slice(0, 5).join(' | '),
      });
    }
  }
  throw ultimoError;
}

// calculateDailyMacros vive en lib/macros.ts (módulo puro, testeable).
// Se re-exporta aquí para no romper imports existentes.
export { calculateDailyMacros } from './macros';

export async function analyzeFoodPhoto(
  imageUri: string
): Promise<Omit<FoodLog, 'id' | 'user_id' | 'logged_at' | 'photo_url'>> {
  if (__DEV__) console.log('[analyzeFoodPhoto] Iniciando, uri:', imageUri);
  const base64 = await imageToOptimizedBase64(imageUri);

  const content = await chat({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64}`,
            detail: 'high',
          },
        },
        {
          type: 'text',
          text: `Nutricionista experto. Analiza esta foto de comida y estima los macronutrientes.
SOLO JSON sin texto adicional:
{
  "meal_name": "nombre descriptivo del plato",
  "food_description": "descripción de ingredientes y porciones estimadas",
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "fiber_g": 0
}`,
        },
      ],
    }],
    response_format: { type: 'json_object' },
    max_tokens: 500,
  }, 'food_scan');

  return parseAI(FoodResultSchema, content, 'análisis de comida');
}

// La sugerencia nocturna fue reemplazada por el mensaje proactivo del Coach IA
// (lib/coachChat.getProactiveInsight), que conoce TODO el contexto del usuario.
