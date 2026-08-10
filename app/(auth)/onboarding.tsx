import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated, KeyboardAvoidingView,
  Platform, Alert, Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { supabase, type WeeklyPlan } from '../../lib/supabase';
import { generateTrainingPlan, calculateDailyMacros } from '../../lib/openai';
import { captureError } from '../../lib/monitoring';
import { useUserStore } from '../../store/userStore';
import AuthSheet from '../../Components/AuthSheet';
import { linkEmailPassword } from '../../lib/account';
import HealthForm from '../../Components/HealthForm';
import { EMPTY_HEALTH, computeRisk, type HealthProfile } from '../../lib/healthMath';
import { type AIShapeError } from '../../lib/schemas';
import { saveHealthProfile } from '../../lib/health';
import { track, flush } from '../../lib/analytics';
import { Colors, Fonts, Radii, Spacing, Type } from '../../constants/theme';
import { MIN_AGE, MAX_AGE, AGE_CONFIRMATION, MEDICAL_DISCLAIMER } from '../../lib/safety';

const { width } = Dimensions.get('window');

const GOALS = [
  { key: 'muscle_gain', emoji: '💪', label: 'Ganar músculo', desc: 'Hipertrofia y fuerza' },
  { key: 'fat_loss',    emoji: '🔥', label: 'Perder grasa',  desc: 'Definición y corte' },
  { key: 'performance', emoji: '⚡', label: 'Rendimiento',   desc: 'Fuerza y potencia' },
  { key: 'endurance',   emoji: '🏃', label: 'Resistencia',   desc: 'Cardio y resistencia' },
] as const;

const ACTIVITY_LEVELS = [
  { key: 'sedentary',   label: 'Sedentario', desc: 'Sin ejercicio' },
  { key: 'light',       label: 'Ligero',      desc: '1-2 días/semana' },
  { key: 'moderate',    label: 'Moderado',    desc: '3-4 días/semana' },
  { key: 'active',      label: 'Activo',      desc: '5-6 días/semana' },
  { key: 'very_active', label: 'Muy activo',  desc: 'Atleta / trabajo físico' },
] as const;

// Sexo biológico: sin él, el BMR de Mifflin-St Jeor usaba SIEMPRE la constante
// masculina (~166 kcal/día de error basal para mujeres, que se propaga a macros,
// déficit y superávit). "Prefiero no decirlo" es una respuesta legítima: usa el
// punto medio y acota el error a ±83 kcal en vez de ±166.
const SEX_OPTIONS = [
  { key: 'male',        label: 'Hombre' },
  { key: 'female',      label: 'Mujer' },
  { key: 'unspecified', label: 'Prefiero no decirlo' },
] as const;

// Experiencia real, no percibida: un principiante progresa con volumen y
// frecuencia que a un avanzado ya no le mueven la aguja (y al revés, lo lesionan).
const EXPERIENCE_LEVELS = [
  { key: 'principiante', label: 'Principiante', desc: 'Menos de 6 meses entrenando con constancia' },
  { key: 'intermedio',   label: 'Intermedio',   desc: 'Entre 6 meses y 2 años entrenando' },
  { key: 'avanzado',     label: 'Avanzado',     desc: '2+ años con progresión estructurada' },
] as const;

// Sin equipamiento declarado, el plan puede pedir barras y máquinas a alguien
// que entrena en la sala de su casa: se abandona en el primer día.
const EQUIPMENT_OPTIONS = [
  { key: 'gym',             label: 'Gimnasio completo',          desc: 'Barras, discos y máquinas' },
  { key: 'casa_basico',     label: 'Casa con mancuernas o bandas', desc: 'Equipo básico en casa' },
  { key: 'casa_sin_equipo', label: 'Casa sin equipo',            desc: 'Solo tu peso corporal' },
] as const;

const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const;

const LOADING_MESSAGES = [
  'Analizando tu perfil...',
  'Calculando tus macros ideales...',
  'Diseñando tu plan de 7 días...',
  'Optimizando para tu objetivo...',
  'Tu coach IA está listo 🚀',
];

type GoalKey = typeof GOALS[number]['key'];
type ActivityKey = typeof ACTIVITY_LEVELS[number]['key'];
type ExperienceKey = typeof EXPERIENCE_LEVELS[number]['key'];
type EquipmentKey = typeof EQUIPMENT_OPTIONS[number]['key'];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [loadingMessage, setLoadingMessage] = useState(0);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  // Sin valor por defecto: elegir "Prefiero no decirlo" es una decisión explícita
  // del usuario, dejarlo en blanco es un dato que nunca preguntamos.
  const [sex, setSex] = useState<'male' | 'female' | 'unspecified' | null>(null);
  const [goal, setGoal] = useState<GoalKey>('muscle_gain');
  const [activityLevel, setActivityLevel] = useState<ActivityKey>('moderate');
  const [experience, setExperience] = useState<ExperienceKey>('principiante');
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [equipment, setEquipment] = useState<EquipmentKey>('gym');
  const [legalConsent, setLegalConsent] = useState(false);
  const [targetWeight, setTargetWeight] = useState('');
  const [goalWhy, setGoalWhy] = useState('');
  const [health, setHealth] = useState<HealthProfile>(EMPTY_HEALTH);
  const [signInSheet, setSignInSheet] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const ageRef = useRef<TextInput>(null);
  const weightRef = useRef<TextInput>(null);
  const heightRef = useRef<TextInput>(null);

  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const slideAnim = useRef(new Animated.Value(0)).current;

  function nextStep() {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -width, duration: 220, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: width, duration: 0, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStep((s) => s + 1), 220);
  }

  function validateStep1(): boolean {
    if (!name.trim()) { Alert.alert('Falta tu nombre', 'Ingresa tu nombre.'); return false; }
    if (!age || isNaN(+age) || +age < MIN_AGE || +age > MAX_AGE) {
      Alert.alert(
        `Debes ser mayor de ${MIN_AGE} años`,
        `GymUp es una aplicación solo para mayores de ${MIN_AGE} años. La edad debe estar entre ${MIN_AGE} y ${MAX_AGE} años.`
      );
      return false;
    }
    if (!weight || isNaN(+weight) || +weight < 30 || +weight > 300) { Alert.alert('Peso inválido', 'Entre 30 y 300 kg.'); return false; }
    if (!height || isNaN(+height) || +height < 130 || +height > 230) { Alert.alert('Altura inválida', 'Entre 130 y 230 cm.'); return false; }
    // Se exige responder, no se exige revelar: "Prefiero no decirlo" pasa.
    if (sex === null) {
      Alert.alert('Falta tu sexo biológico', 'Elige una opción. Si prefieres no decirlo, también es una respuesta válida.');
      return false;
    }
    return true;
  }

  // Valida la meta de peso del paso 2 antes de pasar al tamizaje de salud.
  function validateStep2(): boolean {
    const tw = targetWeight.trim() ? parseFloat(targetWeight.replace(',', '.')) : null;
    if (tw != null && (isNaN(tw) || tw < 30 || tw > 300)) {
      Alert.alert('Meta inválida', 'El peso objetivo debe estar entre 30 y 300 kg.');
      return false;
    }
    return true;
  }

  async function handleFinish() {
    if (!legalConsent) {
      Alert.alert('Necesitamos tu autorización', 'Lee y acepta los Términos y la Política de Privacidad para guardar datos de salud y crear tu plan.');
      return;
    }
    Keyboard.dismiss();
    const tw = targetWeight.trim() ? parseFloat(targetWeight.replace(',', '.')) : null;
    if (tw != null && (isNaN(tw) || tw < 30 || tw > 300)) {
      Alert.alert('Meta inválida', 'El peso objetivo debe estar entre 30 y 300 kg.');
      return;
    }

    setStep(4);
    const msgInterval = setInterval(() => {
      setLoadingMessage((i) => (i >= LOADING_MESSAGES.length - 1 ? i : i + 1));
    }, 1800);

    try {
      // Reusar la sesión anónima si ya existe: crear una NUEVA en cada
      // reintento huérfana al usuario anterior y sus datos parciales.
      let userId: string;
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing?.user) {
        userId = existing.user.id;
      } else {
        const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw new Error('Auth: ' + authError.message);
        if (!authData?.user) throw new Error('Sin usuario de auth');
        userId = authData.user.id;
      }

      // Vincular el correo si lo dio. Va DESPUÉS de tener sesión y ANTES de
      // guardar nada: así el perfil y el plan nacen ya ligados a una cuenta
      // recuperable. Si falla (correo ya en uso, contraseña corta) NO se aborta
      // el onboarding: se avisa y se sigue en anónimo — perder el registro
      // entero por un correo repetido sería peor que quedarse sin correo.
      if (email.trim()) {
        const link = await linkEmailPassword(email, password);
        if (!link.ok) {
          Alert.alert(
            'No pudimos vincular tu correo',
            `${link.error ?? 'Intenta de nuevo.'}\n\nSeguimos con tu registro. Puedes añadirlo más tarde desde Perfil.`
          );
        } else {
          track('account_linked', { origen: 'onboarding' });
          if ('needsEmailConfirm' in link && link.needsEmailConfirm) {
            Alert.alert('Revisa tu correo', 'Te enviamos un email para confirmar tu cuenta. Tu progreso ya está vinculado.');
          }
        }
      }

      // Guardar el tamizaje de salud ANTES de generar: el plan nace ya adaptado
      // a lesiones, condiciones y edad. Si el guardado FALLA, se aborta: un
      // tamizaje declarado pero no persistido dejaría al coach y al plan
      // adaptativo tratando al usuario como sano para siempre.
      const risk = computeRisk(health, +age);
      const hRes = await saveHealthProfile(userId, health, +age);
      if (!hRes.ok) throw new Error('Salud: ' + (hRes.error ?? 'no se pudo guardar tu tamizaje'));
      track('health_screening_completed', {
        risk_level: risk.level,
        conditions: health.conditions.length,
        injuries: health.injuries.length,
        doctor_cleared: health.doctor_cleared,
      });

      const profileData = {
        age: +age,
        // validateStep1 ya exige elegir; el ?? solo satisface al tipo.
        sex: sex ?? 'unspecified',
        weight_kg: +weight,
        height_cm: +height,
        goal,
        activity_level: activityLevel,
        experience,
        days_per_week: daysPerWeek,
        equipment,
      };
      const macros = calculateDailyMacros(profileData);

      // El plan es lo ÚNICO que depende de un tercero (OpenAI). Perder un
      // onboarding entero porque su API se cayó es la peor forma de perder un
      // usuario: el perfil y el tamizaje de salud ya valen por sí solos y el
      // plan se puede generar después.
      let weeklyPlan: WeeklyPlan | null = null;
      try {
        weeklyPlan = await generateTrainingPlan(profileData, health);
      } catch (planErr) {
        // La FORMA de lo que devolvió la IA se adjunta al reporte: sin ella,
        // el único rastro de una negativa del modelo era "11 tokens de salida"
        // en la telemetría, y hubo que deducir la causa desde ahí.
        captureError(planErr, {
          screen: 'onboarding',
          stage: 'generate_training_plan',
          ...((planErr as AIShapeError)?.forma ?? {}),
        });
      }

      // upsert: si un intento anterior alcanzó a crear el perfil, el
      // reintento lo actualiza en vez de fallar por duplicado.
      const { data: savedProfile, error: profileError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: userId,
          name: name.trim(),
          nickname: nickname.trim() || null,
          age: +age,
          sex: profileData.sex,
          weight_kg: +weight,
          height_cm: +height,
          goal,
          activity_level: activityLevel,
          training_experience: experience,
          days_per_week: daysPerWeek,
          equipment,
          daily_calories: macros.daily_calories,
          daily_protein_g: macros.daily_protein_g,
          daily_carbs_g: macros.daily_carbs_g,
          daily_fat_g: macros.daily_fat_g,
          target_weight_kg: tw,
          goal_why: goalWhy.trim() || null,
          // El peso de arranque de la meta = el peso actual al fijarla.
          goal_start_weight_kg: tw != null ? +weight : null,
        }, { onConflict: 'user_id' })
        .select()
        .single();

      if (profileError) throw new Error('Perfil: ' + profileError.message + ' | code: ' + profileError.code);

      // Solo se inserta si de verdad hubo plan. Y si el insert falla con el
      // perfil ya guardado, tampoco se aborta: dejar al usuario en el paso 3
      // con perfil creado es exactamente el estado a medias que queremos evitar.
      let savedPlan: any = null;
      if (weeklyPlan) {
        const { data: planRow, error: planError } = await supabase
          .from('training_plans')
          .insert({ user_id: userId, week_number: 1, plan_data: weeklyPlan })
          .select()
          .single();
        if (planError) {
          captureError(planError, { screen: 'onboarding', stage: 'insert_training_plan' });
        } else {
          savedPlan = planRow;
        }
      }

      setProfile(savedProfile as any);
      if (savedPlan) setTrainingPlan(savedPlan as any);
      setOnboardingComplete(true);
      // Activación: el evento clave del funnel. Ya hay sesión → vaciar la cola
      // (une los eventos anónimos pre-registro con el usuario recién creado).
      track('onboarding_completed', {
        goal,
        activity_level: activityLevel,
        sex: profileData.sex,
        experience,
        days_per_week: daysPerWeek,
        equipment,
        has_target_weight: tw != null,
        has_nickname: !!nickname.trim(),
        // Cuánto pesa la caída de IA en la activación: medible desde el día 1.
        has_plan: !!savedPlan,
      });
      flush();
      clearInterval(msgInterval);
      await new Promise((r) => setTimeout(r, 600));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (!savedPlan) {
        // Honestidad: entra a la app sin plan y tiene que saberlo, además de
        // saber que lo que respondió NO se perdió.
        // "No respondió" era inexacto: el caso real fue que SÍ respondió y la
        // respuesta no cumplía el formato. Y el "puedes generarlo más tarde"
        // era una promesa vacía hasta que existió el botón de la pantalla de
        // inicio: no había ninguna ruta para generar un primer plan.
        Alert.alert(
          'Tu perfil quedó listo',
          'No pudimos armar tu plan en este intento. Tu perfil y tu tamizaje de salud ya ' +
          'están guardados, así que no tendrás que responder nada de nuevo: en la pantalla ' +
          'de inicio te espera el botón "Generar mi plan".',
          [{ text: 'Entendido', onPress: () => router.replace('/(tabs)') }]
        );
        return;
      }
      router.replace('/(tabs)');

    } catch (err: any) {
      clearInterval(msgInterval);
      setStep(3);
      Alert.alert('Error', err.message ?? 'Error desconocido');
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      {/* El padding superior sale del inset REAL del dispositivo, no de un 60
          fijo: ese número quedaba corto en teléfonos con isla dinámica y
          sobraba en pantallas sin muesca, así que el contenido empezaba a una
          altura distinta en cada equipo. */}
      <View style={[s.container, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={s.halo} pointerEvents="none" />

        {step < 4 && (
          <View style={s.steps}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[s.dot, step === n && s.dotActive, step > n && s.dotDone]} />
            ))}
          </View>
        )}

        <Animated.View style={{ flex: 1, transform: [{ translateX: slideAnim }] }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            // En Android NO se usa KeyboardAvoidingView: el sistema ya
            // redimensiona la ventana (adjustResize) y el modo 'height'
            // aplicaba un segundo ajuste encima. El resultado era el salto que
            // se veía — el contenido aparecía a media pantalla o abajo según
            // el momento en que se midiera.
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              // flexGrow para que el contenido corto quede SIEMPRE anclado
              // arriba en vez de repartirse por el alto disponible.
              contentContainerStyle={[s.scroll, { flexGrow: 1, paddingBottom: insets.bottom + 48 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >

              {/* PASO 1 */}
              {step === 1 && (
                <View>
                  <View style={s.badge}>
                    <View style={s.badgeDot} />
                    <Text style={s.badgeText}>IA PERSONALIZADA</Text>
                  </View>
                  <Text style={s.title}>ENTRENA{'\n'}<Text style={s.accent}>COMO</Text>{'\n'}ÉLITE.</Text>
                  <Text style={s.sub}>Tu coach de IA que aprende contigo cada día. Sin excusas.</Text>

                  <Text style={s.lbl}>¿Cómo te llamas?</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Tu nombre"
                    placeholderTextColor={Colors.textMuted}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => ageRef.current?.focus()}
                    blurOnSubmit={false}
                    accessibilityLabel="Tu nombre"
                  />

                  <Text style={s.lbl}>¿Cómo quieres que te llame? (opcional)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Tu apodo — así te hablará tu coach"
                    placeholderTextColor={Colors.textMuted}
                    value={nickname}
                    onChangeText={setNickname}
                    autoCapitalize="words"
                    maxLength={20}
                    returnKeyType="next"
                    onSubmitEditing={() => ageRef.current?.focus()}
                    blurOnSubmit={false}
                    accessibilityLabel="Tu apodo, así te hablará tu coach. Opcional"
                  />

                  <View style={s.grid}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lbl}>Edad</Text>
                      <View style={s.card}>
                        <TextInput
                          ref={ageRef}
                          style={s.cardVal}
                          value={age}
                          onChangeText={setAge}
                          keyboardType="number-pad"
                          placeholder="27"
                          placeholderTextColor={Colors.textMuted}
                          maxLength={2}
                          returnKeyType="next"
                          onSubmitEditing={() => weightRef.current?.focus()}
                          blurOnSubmit={false}
                          accessibilityLabel="Tu edad en años"
                        />
                        <Text style={s.cardUnit}>años</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lbl}>Peso</Text>
                      <View style={s.card}>
                        <TextInput
                          ref={weightRef}
                          style={s.cardVal}
                          value={weight}
                          onChangeText={setWeight}
                          keyboardType="number-pad"
                          placeholder="78"
                          placeholderTextColor={Colors.textMuted}
                          maxLength={3}
                          returnKeyType="next"
                          onSubmitEditing={() => heightRef.current?.focus()}
                          blurOnSubmit={false}
                          accessibilityLabel="Tu peso en kilogramos"
                        />
                        <Text style={s.cardUnit}>kg</Text>
                      </View>
                    </View>
                  </View>

                  <View style={s.grid}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.lbl}>Altura</Text>
                      <View style={s.card}>
                        <TextInput
                          ref={heightRef}
                          style={s.cardVal}
                          value={height}
                          onChangeText={setHeight}
                          keyboardType="number-pad"
                          placeholder="178"
                          placeholderTextColor={Colors.textMuted}
                          maxLength={3}
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                          accessibilityLabel="Tu altura en centímetros"
                        />
                        <Text style={s.cardUnit}>cm</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1 }} />
                  </View>

                  <Text style={s.lbl}>Sexo biológico</Text>
                  <Text style={[s.actDesc, { marginBottom: 10 }]}>
                    Cambia tu metabolismo basal y cómo programamos tu plan. Puedes omitirlo.
                  </Text>
                  {SEX_OPTIONS.map((o) => (
                    <TouchableOpacity
                      key={o.key}
                      style={[s.actRow, sex === o.key && s.actSel]}
                      onPress={() => { setSex(o.key); Haptics.selectionAsync(); }}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: sex === o.key }}
                    >
                      <View style={[s.radio, sex === o.key && s.radioSel]}>
                        {sex === o.key && <View style={s.radioDot} />}
                      </View>
                      <Text style={[s.actLbl, sex === o.key && { color: Colors.accent }]}>
                        {o.label}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity
                    style={s.cta}
                    onPress={() => validateStep1() && nextStep()}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Continuar al siguiente paso"
                  >
                    <Text style={s.ctaTxt}>CONTINUAR →</Text>
                  </TouchableOpacity>

                  <Text style={s.consentTxt}>Al continuar, {AGE_CONFIRMATION}</Text>
                  <Text style={s.disclaimerTxt}>{MEDICAL_DISCLAIMER}</Text>

                  <TouchableOpacity onPress={() => setSignInSheet(true)} style={{ alignItems: 'center', marginTop: Spacing.md }}
                    accessibilityRole="button" accessibilityLabel="¿Ya tienes cuenta? Inicia sesión">
                    <Text style={s.signInLink}>¿Ya tienes cuenta? Inicia sesión</Text>
                  </TouchableOpacity>

                  {__DEV__ && (
                    <TouchableOpacity onPress={() => router.push('/live-coach' as any)} style={{ alignItems: 'center', marginTop: Spacing.md }}
                      accessibilityRole="button" accessibilityLabel="Modo desarrollo: probar el coach en vivo">
                      <Text style={[s.signInLink, { color: Colors.textMuted }]}>🎥 [DEV] Probar Coach en vivo →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* PASO 2 */}
              {step === 2 && (
                <View>
                  <Text style={s.title}>TU{'\n'}<Text style={s.accent}>META.</Text></Text>
                  <Text style={s.sub}>Elige tu objetivo y nivel de actividad actual.</Text>

                  <Text style={s.secLbl}>Objetivo principal</Text>
                  <View style={s.goalGrid}>
                    {GOALS.map((g) => (
                      <TouchableOpacity
                        key={g.key}
                        style={[s.goalCard, goal === g.key && s.goalSel]}
                        onPress={() => { setGoal(g.key); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityLabel={`${g.label}. ${g.desc}`}
                        accessibilityState={{ selected: goal === g.key }}
                      >
                        <Text style={{ fontSize: 26, marginBottom: 6 }}>{g.emoji}</Text>
                        <Text style={[s.goalLbl, goal === g.key && { color: Colors.accent }]}>
                          {g.label}
                        </Text>
                        <Text style={s.goalDesc}>{g.desc}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.secLbl, { marginTop: Spacing.lg }]}>Nivel de actividad</Text>
                  {ACTIVITY_LEVELS.map((a) => (
                    <TouchableOpacity
                      key={a.key}
                      style={[s.actRow, activityLevel === a.key && s.actSel]}
                      onPress={() => { setActivityLevel(a.key); Haptics.selectionAsync(); }}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityLabel={`${a.label}. ${a.desc}`}
                      accessibilityState={{ selected: activityLevel === a.key }}
                    >
                      <View style={[s.radio, activityLevel === a.key && s.radioSel]}>
                        {activityLevel === a.key && <View style={s.radioDot} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.actLbl, activityLevel === a.key && { color: Colors.accent }]}>
                          {a.label}
                        </Text>
                        <Text style={s.actDesc}>{a.desc}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  {/* Experiencia, disponibilidad y equipamiento: sin esto el plan
                      se diseñaba a ciegas (volumen de avanzado para un novato, 5
                      días para quien tiene 3, barras para quien entrena en casa). */}
                  <Text style={[s.secLbl, { marginTop: Spacing.lg }]}>Tu experiencia entrenando</Text>
                  {EXPERIENCE_LEVELS.map((e) => (
                    <TouchableOpacity
                      key={e.key}
                      style={[s.actRow, experience === e.key && s.actSel]}
                      onPress={() => { setExperience(e.key); Haptics.selectionAsync(); }}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityLabel={`${e.label}. ${e.desc}`}
                      accessibilityState={{ selected: experience === e.key }}
                    >
                      <View style={[s.radio, experience === e.key && s.radioSel]}>
                        {experience === e.key && <View style={s.radioDot} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.actLbl, experience === e.key && { color: Colors.accent }]}>
                          {e.label}
                        </Text>
                        <Text style={s.actDesc}>{e.desc}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  <Text style={[s.secLbl, { marginTop: Spacing.lg }]}>¿Cuántos días puedes entrenar?</Text>
                  <Text style={[s.actDesc, { marginBottom: 10 }]}>
                    Dinos los días que de verdad puedes sostener, no los ideales.
                  </Text>
                  <View style={s.dayRow}>
                    {DAYS_OPTIONS.map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[s.dayChip, daysPerWeek === d && s.dayChipSel]}
                        onPress={() => { setDaysPerWeek(d); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityLabel={`${d} días por semana`}
                        accessibilityState={{ selected: daysPerWeek === d }}
                      >
                        <Text style={[s.dayChipTxt, daysPerWeek === d && s.dayChipTxtSel]}>{d}</Text>
                        <Text style={s.dayChipUnit}>días</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.secLbl, { marginTop: Spacing.lg }]}>¿Con qué equipo cuentas?</Text>
                  {EQUIPMENT_OPTIONS.map((q) => (
                    <TouchableOpacity
                      key={q.key}
                      style={[s.actRow, equipment === q.key && s.actSel]}
                      onPress={() => { setEquipment(q.key); Haptics.selectionAsync(); }}
                      activeOpacity={0.8}
                      accessibilityRole="radio"
                      accessibilityLabel={`${q.label}. ${q.desc}`}
                      accessibilityState={{ selected: equipment === q.key }}
                    >
                      <View style={[s.radio, equipment === q.key && s.radioSel]}>
                        {equipment === q.key && <View style={s.radioDot} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.actLbl, equipment === q.key && { color: Colors.accent }]}>
                          {q.label}
                        </Text>
                        <Text style={s.actDesc}>{q.desc}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  {/* Meta concreta: convierte "perder grasa" en "llegar a 74 kg".
                      Con ella la app puede proyectar CUÁNDO llegas (adherencia). */}
                  {(goal === 'muscle_gain' || goal === 'fat_loss') && (
                    <>
                      <Text style={[s.secLbl, { marginTop: Spacing.lg }]}>
                        🎯 Tu meta concreta (opcional)
                      </Text>
                      <View style={s.card}>
                        <TextInput
                          style={s.cardVal}
                          value={targetWeight}
                          onChangeText={setTargetWeight}
                          keyboardType="decimal-pad"
                          placeholder={
                            weight
                              ? String(goal === 'fat_loss' ? Math.max(30, Math.round(+weight) - 5) : Math.min(300, Math.round(+weight) + 5))
                              : '74'
                          }
                          placeholderTextColor={Colors.textMuted}
                          maxLength={5}
                          accessibilityLabel="Tu peso objetivo en kilogramos. Opcional"
                        />
                        <Text style={s.cardUnit}>kg objetivo</Text>
                      </View>
                      <TextInput
                        style={[s.input, { marginTop: 10 }]}
                        value={goalWhy}
                        onChangeText={setGoalWhy}
                        placeholder="¿Por qué lo quieres lograr? (te lo recordaré)"
                        placeholderTextColor={Colors.textMuted}
                        maxLength={120}
                        accessibilityLabel="Por qué quieres lograr tu meta. Opcional"
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={s.cta}
                    onPress={() => validateStep2() && nextStep()}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Continuar al siguiente paso"
                  >
                    <Text style={s.ctaTxt}>CONTINUAR →</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* PASO 3: Tamizaje de salud (estilo PAR-Q+) */}
              {step === 3 && (
                <View>
                  <Text style={s.title}>TU{'\n'}<Text style={s.accent}>SALUD.</Text></Text>
                  <Text style={s.sub}>
                    Un buen coach pregunta esto ANTES de ponerte a entrenar. Tu plan y tu coach
                    se adaptarán a cada respuesta.
                  </Text>

                  <HealthForm value={health} onChange={setHealth} age={+age || 30} />

                  {/* CORREO EN EL ONBOARDING. Antes la cuenta se creaba anónima
                      y el correo se pedía después, desde Perfil — con lo que
                      casi nadie llegaba a ponerlo. Sin correo no hay forma de
                      recuperar la cuenta: si pierdes el teléfono, pierdes el
                      plan, el historial y las fotos. Y la recuperación de
                      contraseña que acabamos de añadir no sirve de nada.
                      Se pide aquí, y se puede omitir: obligarlo en el primer
                      minuto es la forma más rápida de perder a alguien que
                      todavía no sabe si la app le sirve. */}
                  <Text style={s.lbl}>Tu correo (opcional, muy recomendado)</Text>
                  <Text style={[s.actDesc, { marginBottom: 10 }]}>
                    Es lo único que te permite recuperar tu cuenta si cambias de teléfono o
                    pierdes este. Sin correo, tu plan y tu historial viven solo en este dispositivo.
                  </Text>
                  <TextInput
                    style={s.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="tu@correo.com"
                    placeholderTextColor={Colors.textDisabled}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    accessibilityLabel="Tu correo electrónico, opcional"
                  />
                  {email.trim().length > 0 && (
                    <>
                      <Text style={[s.lbl, { marginTop: Spacing.md }]}>Contraseña</Text>
                      <TextInput
                        style={s.input}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Mínimo 8 caracteres"
                        placeholderTextColor={Colors.textDisabled}
                        secureTextEntry
                        autoCapitalize="none"
                        accessibilityLabel="Contraseña para tu cuenta"
                      />
                    </>
                  )}

                  <TouchableOpacity style={[s.actRow, legalConsent && s.actSel]} onPress={() => setLegalConsent((v) => !v)}
                    accessibilityRole="checkbox" accessibilityState={{ checked: legalConsent }}
                    accessibilityLabel="Acepto los términos y autorizo el tratamiento de mis datos según la política de privacidad">
                    <View style={[s.radio, legalConsent && s.radioSel]}>{legalConsent && <View style={s.radioDot} />}</View>
                    <Text style={s.actLbl}>{legalConsent ? 'Aceptado. ' : ''}Acepto los Términos y autorizo el tratamiento de mis datos, incluidos datos sensibles de salud.</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 18, marginBottom: Spacing.md }}>
                    <TouchableOpacity onPress={() => router.push('/legal?doc=terms' as any)} accessibilityRole="link" accessibilityLabel="Leer términos de uso">
                      <Text style={{ color: Colors.accent, fontFamily: Fonts.bodySemi, fontSize: Type.caption, textDecorationLine: 'underline' }}>Leer Términos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => router.push('/legal?doc=privacy' as any)} accessibilityRole="link" accessibilityLabel="Leer política de privacidad">
                      <Text style={{ color: Colors.accent, fontFamily: Fonts.bodySemi, fontSize: Type.caption, textDecorationLine: 'underline' }}>Leer Privacidad</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity style={[s.cta, !legalConsent && { opacity: 0.55 }]} onPress={handleFinish} activeOpacity={0.85}
                    accessibilityRole="button" accessibilityLabel="Generar mi plan con inteligencia artificial">
                    <Text style={s.ctaTxt}>GENERAR MI PLAN IA ✦</Text>
                  </TouchableOpacity>
                  <Text style={s.disclaimerTxt}>
                    Esta información se usa solo para adaptar tu entrenamiento. Puedes editarla
                    cuando quieras en Perfil → Salud. No sustituye una evaluación médica.
                  </Text>
                </View>
              )}

              {/* PASO 4: Generando */}
              {step === 4 && (
                <View style={s.gen}>
                  <View style={s.orb}>
                    <LinearGradient colors={['#7dcc00', '#c8ff3e']} style={StyleSheet.absoluteFill} />
                    <Text style={s.orbTxt}>IA</Text>
                  </View>
                  <Text style={s.genTitle}>
                    Creando tu{'\n'}<Text style={s.accent}>plan perfecto</Text>
                  </Text>
                  <Text style={s.genMsg}>{LOADING_MESSAGES[loadingMessage]}</Text>
                  <View style={s.progBar}>
                    <View style={[s.progFill, {
                      width: `${((loadingMessage + 1) / LOADING_MESSAGES.length) * 100}%`,
                    }]} />
                  </View>
                  <Text style={s.genNote}>
                    GPT-4o está diseñando{'\n'}un plan de 7 días solo para ti.
                  </Text>
                </View>
              )}

            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>

        <AuthSheet
          visible={signInSheet}
          mode="signin"
          onClose={() => setSignInSheet(false)}
          onSuccess={() => { setSignInSheet(false); router.replace('/' as any); }}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  // paddingTop lo pone el componente con el inset real del dispositivo.
  container: { flex: 1, backgroundColor: Colors.bg },
  halo: { position: 'absolute', top: -80, left: '50%', marginLeft: -200, width: 400, height: 300, borderRadius: 200 },
  // El paddingBottom base se suma al inset inferior en el componente: sin eso,
  // en teléfonos con barra de gestos el botón de continuar queda debajo de ella.
  scroll: { paddingHorizontal: Spacing.lg },
  steps: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: Spacing.lg },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.accent, width: 48 },
  dotDone: { backgroundColor: Colors.accentDark },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder,
    borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 6, marginBottom: Spacing.lg,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, letterSpacing: 0.8 },
  title: { fontFamily: Fonts.heading, fontSize: 58, color: Colors.textPrimary, lineHeight: 54, letterSpacing: -0.5, marginBottom: 12 },
  accent: { color: Colors.accent },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, lineHeight: 22, marginBottom: Spacing.xl },
  lbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 16,
    fontFamily: Fonts.bodyMedium, fontSize: 16, color: Colors.textPrimary,
  },
  grid: { flexDirection: 'row', gap: 10, marginTop: Spacing.xs },
  card: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
  },
  cardVal: { fontFamily: Fonts.headingBold, fontSize: 32, color: Colors.textPrimary, padding: 0, minWidth: 50 },
  cardUnit: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, paddingBottom: 4 },
  cta: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginTop: Spacing.xl },
  ctaTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b', letterSpacing: 1 },
  consentTxt: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.md, lineHeight: 16 },
  disclaimerTxt: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 15 },
  signInLink: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },
  secLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  goalCard: {
    width: '47%', backgroundColor: Colors.bgCard, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radii.md, padding: Spacing.md, alignItems: 'center',
  },
  goalSel: { backgroundColor: Colors.bgSelected, borderColor: Colors.accent },
  goalLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary, marginBottom: 3, textAlign: 'center' },
  goalDesc: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center' },
  actRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, padding: Spacing.md, marginBottom: 8,
  },
  actSel: { borderColor: Colors.accentBorder, backgroundColor: Colors.bgSelected },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: Colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  actLbl: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textPrimary },
  actDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  dayRow: { flexDirection: 'row', gap: 8 },
  dayChip: {
    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radii.md, paddingVertical: 12, alignItems: 'center',
  },
  dayChipSel: { backgroundColor: Colors.bgSelected, borderColor: Colors.accent },
  dayChipTxt: { fontFamily: Fonts.headingBold, fontSize: 22, color: Colors.textPrimary },
  dayChipTxtSel: { color: Colors.accent },
  dayChipUnit: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  gen: { flex: 1, alignItems: 'center', paddingTop: Spacing.xl },
  orb: {
    width: 100, height: 100, borderRadius: 50, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xl,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 30, elevation: 20,
  },
  orbTxt: { fontFamily: Fonts.heading, fontSize: 36, color: '#0a0a0b' },
  genTitle: { fontFamily: Fonts.heading, fontSize: 48, color: Colors.textPrimary, textAlign: 'center', lineHeight: 46, marginBottom: Spacing.xl },
  genMsg: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.textSecondary, marginBottom: Spacing.lg, textAlign: 'center' },
  progBar: { width: '80%', height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden', marginBottom: Spacing.xl },
  progFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 2 },
  genNote: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
