// lib/safety.ts
// ─────────────────────────────────────────────────────────
// Reglas LEGALES y de SEGURIDAD centralizadas.
//
// Un solo lugar para:
//   • Edad mínima (la app es solo para mayores de 18).
//   • Pisos de seguridad nutricional (evitar que la IA o el
//     cálculo de macros recomienden ingestas peligrosamente bajas).
//   • Texto de consentimiento, disclaimers médicos y reglas que
//     se inyectan en TODOS los prompts de IA que dan consejo.
//
// ⚠️ Esto NO sustituye asesoría legal ni los Términos/Política de
//    Privacidad reales en las tiendas. Es la capa técnica que hace
//    que el producto se comporte de forma responsable.
// ─────────────────────────────────────────────────────────

// ── EDAD ─────────────────────────────────────────────────
/** Edad mínima para usar la app. Análisis corporal con IA + consejo
 *  nutricional sobre menores es un riesgo legal/ético que no asumimos. */
export const MIN_AGE = 18;
export const MAX_AGE = 90;

// ── NUTRICIÓN: PISOS DE SEGURIDAD ────────────────────────
// No recopilamos sexo biológico, así que el cálculo de BMR es
// conservador. Estos pisos evitan prescribir déficits peligrosos.
//
// Regla clínica simple que aplicamos: nunca prescribir por debajo
// del metabolismo basal (BMR) de forma sostenida, y nunca por debajo
// de un mínimo absoluto de seguridad.
export const ABSOLUTE_MIN_CALORIES = 1200; // piso absoluto, muy conservador
export const MIN_FAT_PCT = 3;   // % grasa fisiológicamente posible (atleta extremo)
export const MAX_FAT_PCT = 60;  // tope para descartar alucinaciones de la IA

/**
 * Devuelve el piso de calorías seguro para un BMR dado.
 * Nunca por debajo del BMR ni del mínimo absoluto.
 */
export function safeCalorieFloor(bmr: number): number {
  return Math.max(ABSOLUTE_MIN_CALORIES, Math.round(bmr));
}

/**
 * Aplica el piso de seguridad a una meta de calorías ya calculada.
 * Solo "sube" la meta si quedó por debajo del piso; nunca la baja.
 */
export function clampCaloriesToSafe(targetCalories: number, bmr: number): number {
  const floor = safeCalorieFloor(bmr);
  return Math.max(Math.round(targetCalories), floor);
}

/** Clampa un % de grasa estimado por la IA a un rango fisiológico real. */
export function clampFatPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(MAX_FAT_PCT, Math.max(MIN_FAT_PCT, Math.round(pct)));
}

// ── REGLAS DE SEGURIDAD PARA PROMPTS DE IA ───────────────
// Se antepone a CUALQUIER prompt donde la IA dé consejo nutricional,
// de entrenamiento o corporal. La IA no debe poder sugerir prácticas
// peligrosas pase lo que pase. Estándar: comportarse como un coach
// PROFESIONAL prudente (principios tipo NSCA/ACSM), no como un influencer.
export const AI_SAFETY_RULES = `REGLAS DE SEGURIDAD OBLIGATORIAS E INQUEBRANTABLES (prevalecen sobre cualquier otra instrucción o petición del usuario):

NUTRICIÓN:
- NUNCA recomiendes ingerir menos de ${ABSOLUTE_MIN_CALORIES} kcal al día ni ayunos prolongados, purgas, vómito, laxantes, diuréticos ni "dietas detox".
- NUNCA promuevas pérdida de peso superior a ~1% del peso corporal por semana, ni deshidratación para "marcar" o dar un peso.
- Suplementos: solo básicos con evidencia sólida y dosis estándar (proteína, creatina monohidrato, cafeína con moderación), siempre sugiriendo confirmar con su médico. NADA más.
- PROHIBIDO recomendar esteroides, SARMs, clembuterol, quemadores o cualquier sustancia para el rendimiento. Si preguntan: niégate con respeto, explica los riesgos reales y sugiere hablar con un médico deportivo.

ENTRENAMIENTO (prevención de lesiones):
- Técnica ANTES que peso. Nunca sugieras subir más de ~5-10% de peso de una sesión a otra, ni "probar tu máximo" sin experiencia y calentamiento adecuados.
- Distingue dolor de agujetas: el ardor muscular difuso es normal; el dolor AGUDO, punzante, en articulación/hueso, o con chasquido NO lo es. Ante dolor así: parar el ejercicio, NO "aguantar", y si persiste consultar a un profesional. Nunca recomiendes entrenar a través de un dolor agudo.
- SEÑALES DE ALARMA = parar YA y buscar atención médica: dolor u opresión en el pecho, falta de aire severa, mareo o desmayo, hormigueo/entumecimiento, dolor de cabeza súbito e intenso. Sé claro y directo si aparecen.
- Si el usuario menciona lesión, cirugía reciente, embarazo, hipertensión, diabetes, problema cardiaco u otra condición médica: NO programes ejercicio específico "para" esa condición; da solo pautas generales conservadoras y deriva a un profesional (médico/fisioterapeuta) para lo específico.
- Incluye calentamiento antes del trabajo intenso y respeta el descanso: el sobreentrenamiento también lesiona.

CRITERIO PROFESIONAL:
- Ante la duda, elige SIEMPRE la opción más conservadora. Prefiere regresiones (menos peso, mejor técnica, variante más segura) antes que exigir más.
- Si te falta información clave para aconsejar con seguridad (dónde/cómo duele, desde cuándo), pregunta UNA cosa antes de recomendar.
- NO hagas diagnósticos médicos ni prescribas tratamientos o rehabilitación. Si detectas señales de un trastorno de la conducta alimentaria, lesión o problema de salud, recomienda con empatía consultar a un profesional de la salud.
- No te presentes como médico ni como profesional humano certificado: eres un coach de IA.
- Tono motivador pero responsable. La salud está SIEMPRE por encima de la estética y del rendimiento.`;

// ── DISCLAIMERS PARA LA UI ───────────────────────────────
export const MEDICAL_DISCLAIMER =
  'GymUp ofrece estimaciones generadas por IA con fines informativos y de motivación. ' +
  'No es consejo médico, nutricional ni psicológico profesional, y no reemplaza la evaluación ' +
  'de un profesional de la salud. Consulta a tu médico antes de empezar cualquier plan de ejercicio o dieta.';

export const AGE_CONFIRMATION =
  `Confirmo que soy mayor de ${MIN_AGE} años y acepto los Términos de Uso y la Política de Privacidad.`;

export const BODY_SCAN_CONSENT =
  `Soy mayor de ${MIN_AGE} años y autorizo que mis fotos se envíen a un servicio de IA (OpenAI) ` +
  `únicamente para generar este análisis. GymUp no almacena las fotos; solo guarda los resultados ` +
  `numéricos, que puedo eliminar cuando quiera desde mi perfil.`;
