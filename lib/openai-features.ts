import type { UserProfile } from './supabase';
import { AI_SAFETY_RULES } from './safety';
import { imageToOptimizedBase64 } from './image';
import { parseAI, FridgeAnalysisSchema } from './schemas';
import { aiChatContent as chat } from './aiClient';

// ─── TIPOS ───────────────────────────────────────────────

export type FridgeIngredient = {
  name: string;
  estimated_quantity: string;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

export type Recipe = {
  name: string;
  description: string;
  prep_time_min: number;
  cook_time_min: number;
  servings: number;
  goal_alignment: number;
  calories_per_serving: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ingredients_used: string[];
  missing_ingredients: string[];
  steps: string[];
  tip: string;
};

export type FridgeAnalysis = {
  detected_ingredients: FridgeIngredient[];
  quality_score: number;
  quality_message: string;
  recipes: Recipe[];
  shopping_suggestion: string;
};

// ─── 2. ANÁLISIS DE NEVERA + RECETAS ─────────────────────

export async function analyzeFridgePhoto(
  imageUri: string,
  profile: Pick<UserProfile, 'goal' | 'daily_calories' | 'daily_protein_g' | 'daily_carbs_g' | 'daily_fat_g'>
): Promise<FridgeAnalysis> {
  if (__DEV__) console.log('[analyzeFridgePhoto] Iniciando, uri:', imageUri);
  const base64 = await imageToOptimizedBase64(imageUri);

  const goalLabels: Record<string, string> = {
    muscle_gain: 'ganar masa muscular (proteína alta, carbos suficientes)',
    fat_loss:    'perder grasa (déficit calórico, proteína alta)',
    performance: 'mejorar rendimiento (balance de macros)',
    endurance:   'mejorar resistencia (carbos como energía principal)',
  };

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
          text: `Eres un chef nutricionista experto. ${AI_SAFETY_RULES}
Analiza esta nevera.

El usuario quiere: ${goalLabels[profile.goal]}
Metas diarias: ${profile.daily_calories}kcal | ${profile.daily_protein_g}g proteína | ${profile.daily_carbs_g}g carbos | ${profile.daily_fat_g}g grasa

SOLO JSON sin texto adicional:
{
  "detected_ingredients": [
    {
      "name": "Pechuga de pollo",
      "estimated_quantity": "~500g (2 pechugas)",
      "protein_per_100g": 31,
      "carbs_per_100g": 0,
      "fat_per_100g": 3.6
    }
  ],
  "quality_score": 75,
  "quality_message": "Comentario sobre la nevera en 1-2 oraciones.",
  "recipes": [
    {
      "name": "Nombre atractivo",
      "description": "Descripción apetitosa en 1 oración",
      "prep_time_min": 10,
      "cook_time_min": 20,
      "servings": 2,
      "goal_alignment": 92,
      "calories_per_serving": 480,
      "protein_g": 45,
      "carbs_g": 35,
      "fat_g": 12,
      "ingredients_used": ["Pollo", "Arroz"],
      "missing_ingredients": ["Sal"],
      "steps": ["Paso 1", "Paso 2", "Paso 3"],
      "tip": "Consejo del chef"
    }
  ],
  "shopping_suggestion": "Lista corta de lo que debería comprar."
}

Genera exactamente 3 recetas variadas (desayuno, almuerzo/cena, snack).
Habla en español colombiano, tono amigable y práctico.`,
        },
      ],
    }],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
  }, 'fridge_scan');

  return parseAI(FridgeAnalysisSchema, content, 'análisis de nevera') as FridgeAnalysis;
}