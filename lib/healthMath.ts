// lib/healthMath.ts
// ─────────────────────────────────────────────────────────
// TAMIZAJE DE SALUD (estilo PAR-Q+, el estándar de la industria) y
// DIRECTIVAS DE SEGURIDAD INDIVIDUALES para la IA.
//
// Un entrenador certificado NUNCA programa sin esto: lesiones, condiciones
// y edad cambian TODO. Este módulo es PURO (testeable con node --test) y es
// la única fuente de verdad de:
//   • computeRisk(): nivel de riesgo (bajo/moderado/alto) + razones.
//   • healthToPrompt(): el bloque de contraindicaciones que se inyecta en
//     CADA prompt que genera ejercicio o consejo (plan, coach, postura).
//
// Principio rector: ante la duda, la opción conservadora. La app NUNCA
// sustituye al médico; con banderas rojas deriva y limita.
// ─────────────────────────────────────────────────────────

export const INJURY_ZONES = [
  { id: 'rodilla',      label: 'Rodilla' },
  { id: 'hombro',       label: 'Hombro' },
  { id: 'espalda_baja', label: 'Espalda baja' },
  { id: 'cuello',       label: 'Cuello' },
  { id: 'muneca_codo',  label: 'Muñeca / codo' },
  { id: 'cadera',       label: 'Cadera' },
  { id: 'tobillo_pie',  label: 'Tobillo / pie' },
] as const;

export const CONDITIONS = [
  { id: 'hipertension',     label: 'Hipertensión' },
  { id: 'cardiopatia',      label: 'Problema cardiaco' },
  { id: 'diabetes',         label: 'Diabetes' },
  { id: 'asma',             label: 'Asma' },
  { id: 'artritis',         label: 'Artritis / artrosis' },
  { id: 'hernia_discal',    label: 'Hernia discal' },
  { id: 'embarazo',         label: 'Embarazo' },
  { id: 'cirugia_reciente', label: 'Cirugía reciente (<6 meses)' },
] as const;

export type InjuryZone = typeof INJURY_ZONES[number]['id'];
export type Condition = typeof CONDITIONS[number]['id'];
export type RiskLevel = 'bajo' | 'moderado' | 'alto';

export type HealthProfile = {
  // Preguntas filtro (banderas rojas del PAR-Q+):
  parq_chest_pain: boolean;        // dolor/opresión en el pecho (ejercicio o reposo)
  parq_dizziness: boolean;         // mareos, desmayos o pérdida de equilibrio
  parq_doctor_restricted: boolean; // un médico le dijo que solo haga ejercicio supervisado
  conditions: Condition[];
  injuries: InjuryZone[];          // zonas con lesión o molestia ACTUAL
  other_note: string | null;       // "otra condición" en texto libre
  doctor_cleared: boolean;         // su médico lo autorizó a entrenar (para riesgo alto)
};

export const EMPTY_HEALTH: HealthProfile = {
  parq_chest_pain: false,
  parq_dizziness: false,
  parq_doctor_restricted: false,
  conditions: [],
  injuries: [],
  other_note: null,
  doctor_cleared: false,
};

export function hasAnyFlag(h: HealthProfile): boolean {
  return (
    h.parq_chest_pain || h.parq_dizziness || h.parq_doctor_restricted ||
    h.conditions.length > 0 || h.injuries.length > 0 || !!h.other_note?.trim()
  );
}

// ─── NIVEL DE RIESGO ─────────────────────────────────────
export function computeRisk(h: HealthProfile, age: number): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];

  // ALTO: banderas rojas → requieren autorización médica antes de programar.
  if (h.parq_chest_pain) reasons.push('dolor u opresión en el pecho');
  if (h.parq_dizziness) reasons.push('mareos o desmayos');
  if (h.parq_doctor_restricted) reasons.push('restricción médica declarada');
  if (h.conditions.includes('cardiopatia')) reasons.push('problema cardiaco diagnosticado');
  if (h.conditions.includes('cirugia_reciente')) reasons.push('cirugía reciente');
  if (h.conditions.includes('embarazo')) reasons.push('embarazo');
  if (reasons.length > 0) return { level: 'alto', reasons };

  // MODERADO: condiciones controlables, lesiones activas o edad avanzada.
  if (h.conditions.includes('hipertension')) reasons.push('hipertensión');
  if (h.conditions.includes('diabetes')) reasons.push('diabetes');
  if (h.conditions.includes('asma')) reasons.push('asma');
  if (h.conditions.includes('artritis')) reasons.push('artritis/artrosis');
  if (h.conditions.includes('hernia_discal')) reasons.push('hernia discal');
  if (h.injuries.length > 0) reasons.push(`lesión activa (${h.injuries.join(', ')})`);
  if (age >= 60) reasons.push('edad 60+');
  if (h.other_note?.trim()) reasons.push('condición adicional declarada');
  if (reasons.length > 0) return { level: 'moderado', reasons };

  return { level: 'bajo', reasons: [] };
}

/** ¿Necesita visto bueno médico ANTES de un programa de fuerza? */
export function needsDoctorClearance(h: HealthProfile, age: number): boolean {
  return computeRisk(h, age).level === 'alto' && !h.doctor_cleared;
}

/**
 * Llaves de riesgo ALTO activas. Si este set CRECE respecto al perfil
 * guardado, la autorización médica previa queda invalidada (el médico
 * autorizó OTRA situación, no esta).
 */
export function highRiskKeys(h: HealthProfile): string[] {
  const keys: string[] = [];
  if (h.parq_chest_pain) keys.push('chest_pain');
  if (h.parq_dizziness) keys.push('dizziness');
  if (h.parq_doctor_restricted) keys.push('doctor_restricted');
  if (h.conditions.includes('cardiopatia')) keys.push('cardiopatia');
  if (h.conditions.includes('cirugia_reciente')) keys.push('cirugia_reciente');
  if (h.conditions.includes('embarazo')) keys.push('embarazo');
  return keys;
}

// ─── DIRECTIVAS POR CONDICIÓN / LESIÓN / EDAD ────────────
// Escritas con criterio de entrenamiento clínico conservador. La IA las
// recibe como órdenes inquebrantables por ENCIMA del objetivo del usuario.

const CONDITION_DIRECTIVES: Record<Condition, string> = {
  hipertension:
    'HIPERTENSIÓN: prohibido aguantar la respiración bajo carga (maniobra de Valsalva), isométricos máximos y cargas >80% 1RM. Respiración fluida SIEMPRE (exhalar en el esfuerzo). Descansos completos de 2-3 min. Prefiere más repeticiones con menos peso. Evita cambios bruscos de posición (mareo postural). Si toma betabloqueadores u otros fármacos que controlan el pulso, la frecuencia cardiaca NO sirve como indicador de intensidad: guiarse SIEMPRE por esfuerzo percibido (RPE) y prueba del habla. Si está mareado o con dolor de cabeza inusual: no entrena ese día.',
  cardiopatia:
    'PROBLEMA CARDIACO: solo intensidad en la que pueda mantener una conversación (RPE ≤ 5-6). Prohibido HIIT, esfuerzos máximos, series al fallo y competir contra el reloj. Calentamiento y vuelta a la calma extendidos (10 min cada uno). Si toma betabloqueadores, la frecuencia cardiaca NO es indicador válido de intensidad (nunca des zonas de pulso): usar RPE y prueba del habla; estos fármacos además reducen la tolerancia al calor. Ante CUALQUIER molestia en pecho, brazo, mandíbula, falta de aire desproporcionada o palpitaciones: DETENER de inmediato y buscar atención médica.',
  diabetes:
    'DIABETES: recomienda verificar glucosa antes y después de entrenar y tener un carbohidrato rápido a mano (riesgo de hipoglucemia, sobre todo con insulina o sulfonilureas). NO entrenar si la glucosa está muy alta (>250-300 mg/dL) con cetonas o hay malestar de descompensación: posponer y consultar. Si antes de entrenar la glucosa está baja (<100 mg/dL), comer un carbohidrato primero. Vigilar hipoglucemia TARDÍA hasta 12-24 h después del ejercicio (incluida la nocturna). Ante temblor, sudor frío o confusión: parar y comer. Cuidado especial con los pies: calzado adecuado y reportar cualquier herida o molestia.',
  asma:
    'ASMA: calentamiento MUY progresivo (10+ min, el ejercicio brusco dispara broncoespasmo). Inhalador de rescate siempre a mano. Evita bloques largos de cardio intenso sin pausas y ambientes muy fríos/secos. Ante silbido, tos u opresión: parar, inhalador, y si no cede, atención médica.',
  artritis:
    'ARTRITIS/ARTROSIS: trabajar solo en el rango de movimiento SIN dolor. Cargas moderadas con tempo controlado; prohibido el impacto (saltos, carrera en superficie dura). Prefiere máquinas y bandas sobre pesos libres inestables. El dolor articular que empeora al día siguiente = bajar carga, no "aguantar". Articulación CALIENTE, hinchada o enrojecida = brote inflamatorio: esa articulación NO se entrena hasta que baje la inflamación (trabajar otras zonas). Si además hay fiebre o malestar general: médico el mismo día.',
  hernia_discal:
    'HERNIA DISCAL: PROHIBIDO peso muerto desde el suelo, buenos días, sentadilla profunda con carga axial, giros con peso (russian twists) y flexión lumbar cargada O repetida (crunches, sit-ups, tocarse las puntas de los pies como estiramiento). Core solo anti-extensión/anti-rotación (plancha, bird-dog, press Pallof). Bisagra de cadera únicamente con carga ligera y técnica perfecta. Si ofrece prensa como sustituto: solo rango parcial, sin que la pelvis ni la zona lumbar se despeguen del respaldo. Dolor que irradia a pierna con hormigueo = parar y profesional YA. Si aparece pérdida de control para orinar/defecar, adormecimiento en la zona genital o entre las piernas, o debilidad creciente en una pierna (p. ej. el pie se arrastra): URGENCIAS de inmediato, no esperar cita.',
  embarazo:
    'EMBARAZO: nada en posición supina prolongada después del primer trimestre, cero impacto y cero riesgo de caída o golpe abdominal, prohibida la maniobra de Valsalva, evitar calor excesivo y deshidratación. Con visto médico, la guía estándar (ACOG/CSEP) es ~150 min/semana de actividad moderada MÁS fuerza 2 días/semana con cargas moderadas; mujeres previamente activas pueden mantener intensidad moderada si se sienten bien — la programación fina la valida su profesional prenatal. DETENER de inmediato y contactar a su médico ante: sangrado vaginal, contracciones dolorosas regulares, pérdida de líquido, falta de aire ANTES del esfuerzo, mareo o desmayo, dolor de cabeza intenso, dolor en el pecho, debilidad que afecte el equilibrio, o dolor/hinchazón en una pantorrilla.',
  cirugia_reciente:
    'CIRUGÍA RECIENTE: no cargar ni estirar la zona operada más allá de lo que su médico/fisioterapeuta haya aprobado explícitamente. Ante duda sobre un ejercicio y la zona: NO se hace.',
};

const INJURY_DIRECTIVES: Record<InjuryZone, string> = {
  rodilla:
    'RODILLA lesionada: evita sentadilla profunda con carga, zancadas largas, saltos, pivotes y extensión de rodilla con dolor. Alternativas: prensa en rango corto sin dolor, puente de glúteo, trabajo de cadera y femoral. Dolor punzante o inflamación después = bajar carga y consultar.',
  hombro:
    'HOMBRO lesionado: evita press tras nuca, fondos profundos, aperturas pesadas y cualquier trabajo por encima de la cabeza con dolor. Alternativas: agarre neutro, rangos medios, face pulls y manguito rotador con banda suave. Dolor que despierta por la noche, pérdida brusca de fuerza o incapacidad de levantar el brazo (sobre todo tras un tirón o caída) = parar y profesional, NO seguir entrenando alrededor.',
  espalda_baja:
    'ESPALDA BAJA con molestia: evita peso muerto desde el suelo, remo inclinado libre pesado y sentadilla con barra. Alternativas: remo con pecho apoyado, prensa SOLO en rango parcial (sin que la pelvis ni la zona lumbar se despeguen del respaldo), hip thrust con rango controlado y core isométrico. Nunca "estirar fuerte" un lumbago agudo. Dolor que baja por la pierna más allá de la rodilla, hormigueo o pérdida de fuerza en pie/pierna = parar y profesional. Si hay pérdida de control de esfínteres o adormecimiento entre las piernas: URGENCIAS de inmediato.',
  cuello:
    'CUELLO con molestia: evita encogimientos pesados, press militar pesado y cualquier carga axial directa. Si el dolor irradia a los brazos u hormiguea: parar y profesional de inmediato (no es zona de ensayo-error).',
  muneca_codo:
    'MUÑECA/CODO con molestia: prefiere agarre neutro y barras/mancuernas que no fuercen la flexión de muñeca cargada; reduce dominadas y curls pesados si duelen. Muñequeras/codera como apoyo, no como licencia para cargar más.',
  cadera:
    'CADERA con molestia: evita sentadilla profunda, aducción/abducción cargada con dolor y estiramientos agresivos. Movilidad suave y fortalecimiento de glúteo medio primero.',
  tobillo_pie:
    'TOBILLO/PIE lesionado: evita saltos, carrera y ejercicios de inestabilidad (zancadas búlgaras, bosu). Alternativas: trabajo sentado o en máquina que no cargue el apoyo mientras sana.',
};

function ageDirectives(age: number): string | null {
  if (age >= 65) {
    return 'EDAD 65+: calentamiento de 10+ minutos SIEMPRE. Prioriza fuerza funcional y equilibrio (prevención de caídas) sobre estética, e incluye trabajo de POTENCIA seguro (subir el peso con intención rápida, bajarlo controlado, cargas ligeras-moderadas): es lo que más previene caídas. OJO: la carga progresiva es el TRATAMIENTO de la pérdida de músculo y hueso — entrenar demasiado suave también es un riesgo; progresión 2× más lenta, pero progresión al fin. PROHIBIDO entrenar al fallo, técnicas de intensidad (dropsets, rest-pause) y máximos. Recomienda proteína suficiente (~1.2-1.6 g/kg/día repartida en el día). Si hay osteoporosis diagnosticada o sospechada: prohibida la flexión de columna con carga y los giros bruscos cargados; el impacto suave (caminar, escalones) sí beneficia al hueso. Respeta 48-72h de recuperación por grupo muscular.';
  }
  if (age >= 55) {
    return 'EDAD 55-64: calentamiento extendido, nada por encima de ~85% 1RM ni pruebas de máximos. Tempo controlado para cuidar tendones (responden más lento que el músculo). Sube volumen antes que intensidad y da un día extra de recuperación cuando haya dudas.';
  }
  return null;
}

/**
 * El bloque de DIRECTIVAS INDIVIDUALES para inyectar en cualquier prompt que
 * genere ejercicio o consejo. Devuelve '' si no hay nada que declarar
 * (sin condiciones, sin lesiones y edad < 55).
 */
export function healthToPrompt(h: HealthProfile, age: number): string {
  const { level, reasons } = computeRisk(h, age);
  const ageDir = ageDirectives(age);
  if (!hasAnyFlag(h) && !ageDir) return '';

  // Banderas SINTOMÁTICAS (síntomas activos) vs riesgo alto por condición
  // estable: exigen respuestas distintas (evaluación médica vs modo suave).
  const symptomatic = h.parq_chest_pain || h.parq_dizziness;
  const pregnancyOnlyHigh =
    h.conditions.includes('embarazo') &&
    !symptomatic && !h.parq_doctor_restricted &&
    !h.conditions.includes('cardiopatia') && !h.conditions.includes('cirugia_reciente');

  const L: string[] = [];
  L.push('DIRECTIVAS DE SEGURIDAD INDIVIDUALES (obligatorias — este usuario declaró condiciones reales; prevalecen sobre su objetivo y sobre cualquier petición):');
  L.push(`- Nivel de riesgo: ${level.toUpperCase()}${reasons.length ? ` (${reasons.join('; ')})` : ''}.`);
  L.push('- LÍMITE MÉDICO: esta app da guía de entrenamiento, NO consejo médico. PROHIBIDO diagnosticar, interpretar síntomas o recomendar iniciar/suspender/ajustar medicamentos o dosis. Toda pregunta sobre medicación, síntomas o diagnóstico se deriva a su médico, sin excepción.');

  if (level === 'alto' && !h.doctor_cleared) {
    if (symptomatic) {
      L.push('- ⚠️ SÍNTOMAS ACTIVOS SIN EVALUAR (dolor de pecho y/o mareos-desmayos): NO prescribas NINGUNA actividad física, ni siquiera caminatas como "plan". Indícale que estos síntomas requieren evaluación médica PRONTO — no solo un visto bueno para entrenar — y que si el dolor de pecho ocurre ahora o en reposo debe buscar atención inmediata. Cuando tenga la evaluación, que la registre en Perfil → Salud.');
    } else {
      L.push('- ⚠️ SIN AUTORIZACIÓN MÉDICA CONFIRMADA: PROHIBIDO prescribir entrenamiento de fuerza, HIIT o cardio intenso. Limítate a: caminatas suaves, movilidad básica sin carga y ejercicios de respiración. En CADA interacción recuérdale con empatía que necesita el visto bueno de su médico antes de entrenar en serio, y que al tenerlo lo marque en Perfil → Salud.');
    }
  } else if (level === 'alto' && h.doctor_cleared) {
    if (pregnancyOnlyHigh) {
      L.push('- Embarazo con visto médico: aplica la guía específica de EMBARAZO de abajo (actividad moderada + fuerza moderada es lo estándar); no le impongas los topes genéricos de cardiopatía.');
    } else {
      L.push('- Autorizado por su médico, PERO con máxima cautela: intensidad baja (RPE ≤ 5-6), progresión al doble de lenta, nunca al fallo, sin técnicas de intensidad ni máximos, y recordatorio de reportar cualquier síntoma a su médico.');
    }
  }

  // Las banderas PAR-Q generan directivas SIEMPRE (con o sin autorización):
  // el síntoma no desaparece porque un médico haya dado el visto bueno.
  if (h.parq_chest_pain) {
    L.push('- DOLOR DE PECHO declarado: ante CUALQUIER dolor u opresión en el pecho durante el ejercicio, DETENER e ir a urgencias, sin excepción y sin "aguantar la serie".');
  }
  if (h.parq_dizziness) {
    L.push('- MAREOS/DESMAYOS declarados: prohibido el trabajo con riesgo de caída (cargas sobre la cabeza, equilibrio inestable, saltos, pliometría). Cambios de posición LENTOS, entrenar acompañado cuando se pueda, y al primer mareo DETENER y sentarse.');
  }

  for (const c of h.conditions) {
    const d = CONDITION_DIRECTIVES[c];
    if (d) L.push(`- ${d}`);
  }
  for (const z of h.injuries) {
    const d = INJURY_DIRECTIVES[z];
    if (d) L.push(`- ${d}`);
  }
  if (ageDir) L.push(`- ${ageDir}`);
  if (h.other_note?.trim()) {
    L.push(`- CONDICIÓN ADICIONAL declarada por el usuario: "${h.other_note.trim().slice(0, 200)}". Tómala en serio, sé conservador con todo lo que pueda relacionarse y recomienda validarla con un profesional.`);
  }

  L.push('- REGLA FINAL: si el objetivo del usuario o su petición choca con estas directivas, GANAN LAS DIRECTIVAS. Explica el porqué en una frase con empatía y ofrece la alternativa segura equivalente.');
  return L.join('\n');
}

/**
 * FAIL-CLOSED: cuando NO se pudo verificar el perfil de salud (error de red,
 * no "usuario sano"), la IA jamás debe asumir que la persona está sana.
 * Esta directiva la pone en modo conservador hasta restaurar el contexto.
 */
export const HEALTH_UNKNOWN_DIRECTIVE =
  'DIRECTIVA DE CONTEXTO INCOMPLETO (obligatoria): NO se pudo verificar el perfil de salud de este usuario en este momento. Asume que PODRÍA tener lesiones o condiciones no visibles: sé conservador (nada de técnicas de intensidad, fallo, máximos ni recomendaciones de riesgo), pregunta por lesiones o condiciones antes de cualquier recomendación específica, y sugiere reabrir la app con conexión para restaurar su perfil completo.';

// ─── ZONAS DE RIESGO POR EJERCICIO (red de seguridad del swap) ────────────
// Mapa conservador por palabras clave: qué zonas carga principalmente un
// ejercicio. Se usa para ADVERTIR (no bloquear) cuando el usuario va a
// sustituir hacia un ejercicio que carga una zona que declaró lesionada.
const ZONE_KEYWORDS: [InjuryZone, RegExp][] = [
  ['rodilla', /sentadilla|zancada|estocada|salto|pliom|búlgara|bulgara|pistol|extensi[oó]n de (pierna|rodilla)|step|escal[oó]n|burpee/i],
  ['espalda_baja', /peso muerto|buenos d[ií]as|remo (con barra|inclinado)|hiperextensi[oó]n|clean|swing|sentadilla con barra/i],
  ['hombro', /press (militar|de hombro|tras nuca|arnold)|elevaci[oó]n (lateral|frontal)|fondos|apertura|p[aá]jaro|dominada|pull ?over/i],
  ['cuello', /encogimiento|press militar|tras nuca/i],
  ['muneca_codo', /curl|extensi[oó]n de tr[ií]ceps|flexi[oó]n|dominada|press franc[eé]s/i],
  ['cadera', /sentadilla|zancada|estocada|peso muerto|hip thrust|abducci[oó]n|aducci[oó]n/i],
  ['tobillo_pie', /salto|pliom|carrera|sprint|burpee|zancada|gemelo|pantorrilla/i],
];

/** Zonas que un ejercicio carga (por nombre). PURA → testeable. */
export function exerciseRiskZones(exerciseName: string): InjuryZone[] {
  const out: InjuryZone[] = [];
  for (const [zone, rx] of ZONE_KEYWORDS) {
    if (rx.test(exerciseName)) out.push(zone);
  }
  return out;
}

/** ¿Este ejercicio entra en conflicto con las lesiones declaradas? */
export function exerciseConflicts(exerciseName: string, injuries: InjuryZone[]): InjuryZone[] {
  if (injuries.length === 0) return [];
  const zones = exerciseRiskZones(exerciseName);
  return zones.filter((z) => injuries.includes(z));
}

/** Resumen corto para mostrar en UI (chips del perfil). */
export function healthSummary(h: HealthProfile): string {
  if (!hasAnyFlag(h)) return 'Sin condiciones declaradas';
  const parts: string[] = [];
  if (h.conditions.length) {
    parts.push(h.conditions.map((c) => CONDITIONS.find((x) => x.id === c)?.label ?? c).join(', '));
  }
  if (h.injuries.length) {
    parts.push(`Lesión: ${h.injuries.map((z) => INJURY_ZONES.find((x) => x.id === z)?.label ?? z).join(', ')}`);
  }
  if (h.parq_chest_pain || h.parq_dizziness || h.parq_doctor_restricted) parts.push('Banderas de tamizaje');
  return parts.join(' · ');
}
