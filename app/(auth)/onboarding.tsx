import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated, KeyboardAvoidingView,
  Platform, Alert, Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { generateTrainingPlan, calculateDailyMacros } from '../../lib/openai';
import { useUserStore } from '../../store/userStore';
import AuthSheet from '../../Components/AuthSheet';
import HealthForm from '../../Components/HealthForm';
import { EMPTY_HEALTH, computeRisk, type HealthProfile } from '../../lib/healthMath';
import { saveHealthProfile } from '../../lib/health';
import { track, flush } from '../../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';
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

const LOADING_MESSAGES = [
  'Analizando tu perfil...',
  'Calculando tus macros ideales...',
  'Diseñando tu plan de 7 días...',
  'Optimizando para tu objetivo...',
  'Tu coach IA está listo 🚀',
];

type GoalKey = typeof GOALS[number]['key'];
type ActivityKey = typeof ACTIVITY_LEVELS[number]['key'];

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [loadingMessage, setLoadingMessage] = useState(0);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState<GoalKey>('muscle_gain');
  const [activityLevel, setActivityLevel] = useState<ActivityKey>('moderate');
  const [targetWeight, setTargetWeight] = useState('');
  const [goalWhy, setGoalWhy] = useState('');
  const [health, setHealth] = useState<HealthProfile>(EMPTY_HEALTH);
  const [signInSheet, setSignInSheet] = useState(false);

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
        weight_kg: +weight,
        height_cm: +height,
        goal,
        activity_level: activityLevel,
      };
      const macros = calculateDailyMacros(profileData);
      const weeklyPlan = await generateTrainingPlan(profileData, health);

      // upsert: si un intento anterior alcanzó a crear el perfil, el
      // reintento lo actualiza en vez de fallar por duplicado.
      const { data: savedProfile, error: profileError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: userId,
          name: name.trim(),
          nickname: nickname.trim() || null,
          age: +age,
          weight_kg: +weight,
          height_cm: +height,
          goal,
          activity_level: activityLevel,
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

      const { data: savedPlan, error: planError } = await supabase
        .from('training_plans')
        .insert({ user_id: userId, week_number: 1, plan_data: weeklyPlan })
        .select()
        .single();

      if (planError) throw new Error('Plan: ' + planError.message);

      setProfile(savedProfile as any);
      setTrainingPlan(savedPlan as any);
      setOnboardingComplete(true);
      // Activación: el evento clave del funnel. Ya hay sesión → vaciar la cola
      // (une los eventos anónimos pre-registro con el usuario recién creado).
      track('onboarding_completed', {
        goal,
        activity_level: activityLevel,
        has_target_weight: tw != null,
        has_nickname: !!nickname.trim(),
      });
      flush();
      clearInterval(msgInterval);
      await new Promise((r) => setTimeout(r, 600));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');

    } catch (err: any) {
      clearInterval(msgInterval);
      setStep(3);
      Alert.alert('Error', err.message ?? 'Error desconocido');
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={s.container}>
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
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              contentContainerStyle={s.scroll}
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
                        />
                        <Text style={s.cardUnit}>cm</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1 }} />
                  </View>

                  <TouchableOpacity
                    style={s.cta}
                    onPress={() => validateStep1() && nextStep()}
                    activeOpacity={0.85}
                  >
                    <Text style={s.ctaTxt}>CONTINUAR →</Text>
                  </TouchableOpacity>

                  <Text style={s.consentTxt}>Al continuar, {AGE_CONFIRMATION}</Text>
                  <Text style={s.disclaimerTxt}>{MEDICAL_DISCLAIMER}</Text>

                  <TouchableOpacity onPress={() => setSignInSheet(true)} style={{ alignItems: 'center', marginTop: Spacing.md }}>
                    <Text style={s.signInLink}>¿Ya tienes cuenta? Inicia sesión</Text>
                  </TouchableOpacity>

                  {__DEV__ && (
                    <TouchableOpacity onPress={() => router.push('/live-coach' as any)} style={{ alignItems: 'center', marginTop: Spacing.md }}>
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
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={s.cta}
                    onPress={() => validateStep2() && nextStep()}
                    activeOpacity={0.85}
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

                  <TouchableOpacity style={s.cta} onPress={handleFinish} activeOpacity={0.85}>
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
  container: { flex: 1, backgroundColor: Colors.bg, paddingTop: 60 },
  halo: { position: 'absolute', top: -80, left: '50%', marginLeft: -200, width: 400, height: 300, borderRadius: 200 },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: 60 },
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
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.accent, letterSpacing: 0.8 },
  title: { fontFamily: Fonts.heading, fontSize: 58, color: Colors.textPrimary, lineHeight: 54, letterSpacing: -0.5, marginBottom: 12 },
  accent: { color: Colors.accent },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, lineHeight: 22, marginBottom: Spacing.xl },
  lbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: Spacing.md },
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
  consentTxt: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.md, lineHeight: 16 },
  disclaimerTxt: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 15 },
  signInLink: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },
  secLbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  goalCard: {
    width: '47%', backgroundColor: Colors.bgCard, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radii.md, padding: Spacing.md, alignItems: 'center',
  },
  goalSel: { backgroundColor: Colors.bgSelected, borderColor: Colors.accent },
  goalLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary, marginBottom: 3, textAlign: 'center' },
  goalDesc: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center' },
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
  gen: { flex: 1, alignItems: 'center', paddingTop: 60 },
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