import type { UserProfile, FoodLog } from './supabase';
import { AI_SAFETY_RULES } from './safety';
import { imageToOptimizedBase64 } from './image';
import { parseAI, WeeklyPlanSchema, FoodResultSchema } from './schemas';
import { aiChatContent as chat } from './aiClient';
import { healthToPrompt, type HealthProfile } from './healthMath';

export type WeeklyPlan = { overview: string; days: TrainingDay[] };

export type TrainingDay = {
  day: number;
  day_name: string;
  type: 'workout' | 'rest' | 'active_recovery';
  muscle_groups: string[];
  estimated_duration_min: number;
  exercises: Exercise[];
};

export type Exercise = {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
  muscle_group: string;
};

export async function generateTrainingPlan(
  profile: Pick<UserProfile, 'age' | 'weight_kg' | 'height_cm' | 'goal' | 'activity_level'>,
  health?: HealthProfile | null
): Promise<WeeklyPlan> {
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
  const healthBlock = health ? healthToPrompt(health, profile.age) : '';

  const content = await chat({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Entrenador personal élite. ${AI_SAFETY_RULES}
${healthBlock ? `\n${healthBlock}\n` : ''}
Crea plan de entrenamiento 7 días para:
- Edad: ${profile.age} años
- Peso: ${profile.weight_kg} kg
- Altura: ${profile.height_cm} cm
- Objetivo: ${g[profile.goal]}
- Actividad: ${a[profile.activity_level]}

SOLO JSON sin texto adicional:
{
  "overview": "descripción motivadora en 2 oraciones",
  "days": [
    {
      "day": 1,
      "day_name": "Lunes",
      "type": "workout",
      "muscle_groups": ["Pecho", "Tríceps"],
      "estimated_duration_min": 55,
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
    }
  ]
}
Incluye los 7 días. type puede ser: workout, rest, active_recovery.`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  }, 'plan');

  return parseAI(WeeklyPlanSchema, content, 'plan de entrenamiento') as WeeklyPlan;
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