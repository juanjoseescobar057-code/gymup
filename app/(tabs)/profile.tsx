// app/(tabs)/profile.tsx
import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, Modal, TextInput, Keyboard, TouchableWithoutFeedback,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';
import { calculateDailyMacros } from '../../lib/openai';
import { getAccountEmail, deleteAccountServerSide } from '../../lib/account';
import { regenerateAdaptivePlan, saveAdaptedPlan } from '../../lib/adaptivePlan';
import { canUseFeature } from '../../lib/subscription';
import AuthSheet from '../../Components/AuthSheet';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';
import { MIN_AGE, MAX_AGE } from '../../lib/safety';

const GOAL_LABELS: Record<string, { label: string; emoji: string }> = {
  muscle_gain: { label: 'Ganar músculo', emoji: '💪' },
  fat_loss:    { label: 'Perder grasa',  emoji: '🔥' },
  performance: { label: 'Rendimiento',   emoji: '⚡' },
  endurance:   { label: 'Resistencia',   emoji: '🏃' },
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary:   'Sedentario',
  light:       'Ligero',
  moderate:    'Moderado',
  active:      'Activo',
  very_active: 'Muy activo',
};

const GOALS = [
  { key: 'muscle_gain', emoji: '💪', label: 'Ganar músculo' },
  { key: 'fat_loss',    emoji: '🔥', label: 'Perder grasa' },
  { key: 'performance', emoji: '⚡', label: 'Rendimiento' },
  { key: 'endurance',   emoji: '🏃', label: 'Resistencia' },
] as const;

const ACTIVITY_LEVELS = [
  { key: 'sedentary',   label: 'Sedentario',  desc: 'Sin ejercicio' },
  { key: 'light',       label: 'Ligero',       desc: '1-2 días/semana' },
  { key: 'moderate',    label: 'Moderado',     desc: '3-4 días/semana' },
  { key: 'active',      label: 'Activo',       desc: '5-6 días/semana' },
  { key: 'very_active', label: 'Muy activo',   desc: 'Atleta / trabajo físico' },
] as const;

export default function ProfileScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);

  const [editModal, setEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [authSheet, setAuthSheet] = useState(false);

  useEffect(() => {
    getAccountEmail().then(setAccountEmail).catch(() => {});
  }, []);

  const isAnon = !accountEmail;

  // Campos editables
  const [name, setName] = useState(profile?.name ?? '');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [age, setAge] = useState(String(profile?.age ?? ''));
  const [weight, setWeight] = useState(String(profile?.weight_kg ?? ''));
  const [height, setHeight] = useState(String(profile?.height_cm ?? ''));
  const [goal, setGoal] = useState(profile?.goal ?? 'muscle_gain');
  const [activityLevel, setActivityLevel] = useState(profile?.activity_level ?? 'moderate');

  async function saveChanges() {
    if (!name.trim()) { Alert.alert('Error', 'Ingresa tu nombre.'); return; }
    if (!age || isNaN(+age) || +age < MIN_AGE || +age > MAX_AGE) { Alert.alert('Error', `La edad debe estar entre ${MIN_AGE} y ${MAX_AGE} años.`); return; }
    if (!weight || isNaN(+weight) || +weight < 30 || +weight > 300) { Alert.alert('Error', 'Peso entre 30 y 300 kg.'); return; }
    if (!height || isNaN(+height) || +height < 130 || +height > 230) { Alert.alert('Error', 'Altura entre 130 y 230 cm.'); return; }

    setSaving(true);
    Keyboard.dismiss();

    const newMacros = calculateDailyMacros({
      age: +age,
      weight_kg: +weight,
      height_cm: +height,
      goal,
      activity_level: activityLevel,
    });

    const { data: updated, error } = await supabase
      .from('user_profiles')
      .update({
        name: name.trim(),
        nickname: nickname.trim() || null,
        age: +age,
        weight_kg: +weight,
        height_cm: +height,
        goal,
        activity_level: activityLevel,
        ...newMacros,
      })
      .eq('user_id', profile.user_id)
      .select()
      .single();

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setProfile(updated);
    setEditModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('✅ Guardado', 'Tu perfil y macros han sido actualizados.');
  }

  // Derecho al olvido — borrar solo el historial de análisis corporal.
  async function handleDeleteBodyScans() {
    Alert.alert(
      'Eliminar análisis corporal',
      'Se borrará permanentemente todo tu historial de análisis corporal. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('body_scans')
              .delete()
              .eq('user_id', profile.user_id);
            if (error) { Alert.alert('Error', error.message); return; }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Listo', 'Tu historial de análisis corporal fue eliminado.');
          },
        },
      ]
    );
  }

  // Derecho al olvido — borrar TODOS los datos del usuario y cerrar sesión.
  async function handleDeleteAccount() {
    Alert.alert(
      'Eliminar mi cuenta y datos',
      'Se borrarán permanentemente tu perfil, planes, comidas, pesajes, fotos y análisis. Esta acción NO se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: async () => {
            const uid = profile.user_id;
            // Preferir el borrado server-side (elimina también la identidad de auth).
            const doneServerSide = await deleteAccountServerSide();
            if (!doneServerSide) {
              // Respaldo: borrar por filas desde el cliente.
              const tables = [
                'set_logs', 'body_scans', 'posture_feedback', 'workout_sessions',
                'food_logs', 'weight_entries', 'transform_photos',
                'training_plans', 'user_stats', 'notification_preferences',
                'push_tokens', 'ai_usage', 'coach_memory', 'ai_telemetry',
                'analytics_events', 'health_profile', 'user_profiles',
              ];
              for (const t of tables) {
                const { error } = await supabase.from(t).delete().eq('user_id', uid);
                if (error) console.log(`[DeleteAccount] ${t}:`, error.message);
              }
            }
            await supabase.auth.signOut();
            setProfile(null as any);
            setOnboardingComplete(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace('/(auth)/onboarding' as any);
          },
        },
      ]
    );
  }

  // Re-planificación adaptativa con IA (Premium).
  async function handleAdaptPlan() {
    if (!profile || !trainingPlan?.plan_data) return;
    const gate = canUseFeature('regenerate_plan', !!profile.is_premium);
    if (!gate.allowed) { router.push('/paywall' as any); return; }
    setReplanning(true);
    try {
      const newPlan = await regenerateAdaptivePlan(profile, trainingPlan.plan_data);
      const saved = await saveAdaptedPlan(profile.user_id, newPlan);
      if (saved) setTrainingPlan(saved);
      setProfile({ ...profile, current_plan_day: 0 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('✅ Plan ajustado', 'Tu plan se adaptó a tu desempeño de las últimas semanas.');
    } catch (e: any) {
      Alert.alert('No se pudo ajustar', e?.message ?? 'Intenta de nuevo.');
    } finally {
      setReplanning(false);
    }
  }

  async function handleLogout() {
    const warning = isAnon
      ? 'Tu cuenta es anónima (sin email). Si cierras sesión NO podrás recuperar tus datos: perderás racha, historial y fotos. Te recomendamos "Guardar mi progreso" antes de salir. ¿Continuar?'
      : 'Podrás volver a entrar con tu email y contraseña para recuperar tus datos. ¿Cerrar sesión?';
    Alert.alert(
      'Cerrar sesión',
      warning,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            setProfile(null as any);
            setOnboardingComplete(false);
            router.replace('/(auth)/onboarding' as any);
          },
        },
      ]
    );
  }

  if (!profile) return null;

  const goalInfo = GOAL_LABELS[profile.goal];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>PERFIL</Text>
          <TouchableOpacity style={s.editBtn} onPress={() => {
            setName(profile.name);
            setNickname(profile.nickname ?? '');
            setAge(String(profile.age));
            setWeight(String(profile.weight_kg));
            setHeight(String(profile.height_cm));
            setGoal(profile.goal);
            setActivityLevel(profile.activity_level);
            setEditModal(true);
          }}>
            <Text style={s.editBtnTxt}>✏️ Editar</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{profile.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text style={s.profileName}>{profile.nickname || profile.name}</Text>
          {!!profile.nickname && (
            <Text style={{ fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>
              {profile.name}
            </Text>
          )}
          <View style={s.goalBadge}>
            <Text style={s.goalBadgeTxt}>{goalInfo.emoji} {goalInfo.label}</Text>
          </View>
        </View>

        {/* Stats físicos */}
        <Text style={s.sectionLbl}>TUS DATOS</Text>
        <View style={s.card}>
          {[
            { label: 'Edad', value: `${profile.age} años` },
            { label: 'Peso', value: `${profile.weight_kg} kg` },
            { label: 'Altura', value: `${profile.height_cm} cm` },
            { label: 'Actividad', value: ACTIVITY_LABELS[profile.activity_level] },
            { label: 'Objetivo', value: `${goalInfo.emoji} ${goalInfo.label}` },
            { label: 'Día del plan', value: `Día ${(profile.current_plan_day ?? 0) + 1} de 7` },
          ].map((row, i, arr) => (
            <View key={row.label} style={[s.row, i < arr.length - 1 && s.rowBorder]}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Macros diarios */}
        <Text style={s.sectionLbl}>TUS MACROS DIARIOS</Text>
        <View style={s.macroGrid}>
          {[
            { label: 'Calorías', value: `${profile.daily_calories}`, unit: 'kcal', color: Colors.accent },
            { label: 'Proteína', value: `${profile.daily_protein_g}`, unit: 'g', color: Colors.macroProtein },
            { label: 'Carbos',   value: `${profile.daily_carbs_g}`,   unit: 'g', color: Colors.macroCarbs },
            { label: 'Grasa',    value: `${profile.daily_fat_g}`,     unit: 'g', color: Colors.macroFat },
          ].map((m) => (
            <View key={m.label} style={s.macroTile}>
              <Text style={[s.macroVal, { color: m.color }]}>
                {m.value}<Text style={s.macroUnit}>{m.unit}</Text>
              </Text>
              <Text style={s.macroLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        <Text style={s.macroNote}>
          💡 Los macros se recalculan automáticamente cuando editas tu perfil.
        </Text>

        {/* Plan */}
        <Text style={s.sectionLbl}>PLAN</Text>
        <View style={s.card}>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleAdaptPlan} disabled={replanning}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>🤖 Ajustar mi plan con IA {profile.is_premium ? '' : '✦'}</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Adapta cargas según tu desempeño real</Text>
            </View>
            <Text style={[s.rowValue, { color: Colors.accent }]}>{replanning ? '…' : '›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={async () => {
            Alert.alert(
              'Reiniciar plan',
              '¿Quieres volver al día 1 del plan?',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Reiniciar',
                  onPress: async () => {
                    const { data } = await supabase
                      .from('user_profiles')
                      .update({ current_plan_day: 0 })
                      .eq('user_id', profile.user_id)
                      .select()
                      .single();
                    if (data) setProfile(data);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  },
                },
              ]
            );
          }}>
            <Text style={s.rowLabel}>🔄 Reiniciar al día 1</Text>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => router.push('/health' as any)}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>🩺 Mi salud</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Lesiones y condiciones — tu plan se adapta a esto</Text>
            </View>
            <Text style={[s.rowValue, { color: Colors.accent }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => router.push('/telemetry' as any)}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>🔬 Telemetría IA</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Costo, latencia, score y decisiones del coach</Text>
            </View>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Cuenta */}
        <Text style={s.sectionLbl}>CUENTA</Text>
        <View style={s.card}>
          {isAnon ? (
            <TouchableOpacity style={s.row} onPress={() => setAuthSheet(true)}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>💾 Guardar mi progreso</Text>
                <Text style={[s.actDesc, { marginTop: 2 }]}>Cuenta anónima — crea una cuenta para no perder tus datos</Text>
              </View>
              <Text style={[s.rowValue, { color: Colors.accent }]}>›</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.row}>
              <Text style={s.rowLabel}>✅ Cuenta</Text>
              <Text style={s.rowValue}>{accountEmail}</Text>
            </View>
          )}
        </View>

        {/* Privacidad y datos */}
        <Text style={s.sectionLbl}>PRIVACIDAD Y DATOS</Text>
        <View style={s.card}>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleDeleteBodyScans}>
            <Text style={s.rowLabel}>🗑️ Eliminar historial de análisis corporal</Text>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={handleDeleteAccount}>
            <Text style={[s.rowLabel, { color: Colors.error }]}>⚠️ Eliminar mi cuenta y todos mis datos</Text>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Cerrar sesión */}
        <View style={{ paddingHorizontal: Spacing.lg, marginTop: Spacing.md }}>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={s.logoutTxt}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      <AuthSheet
        visible={authSheet}
        mode="link"
        onClose={() => setAuthSheet(false)}
        onSuccess={() => {
          setAuthSheet(false);
          getAccountEmail().then(setAccountEmail).catch(() => {});
        }}
      />

      {/* Modal editar perfil */}
      <Modal
        visible={editModal}
        animationType="slide"
        transparent
        onRequestClose={() => { Keyboard.dismiss(); setEditModal(false); }}
      >
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setEditModal(false); }}>
          <View style={s.overlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : 'height'}>
                <View style={s.modalBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
                    <Text style={s.modalTitle}>EDITAR PERFIL</Text>
                    <TouchableOpacity onPress={() => { Keyboard.dismiss(); setEditModal(false); }}>
                      <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted }}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                    {/* Nombre */}
                    <Text style={s.fieldLabel}>Nombre</Text>
                    <TextInput
                      style={s.input}
                      value={name}
                      onChangeText={setName}
                      autoCapitalize="words"
                      returnKeyType="next"
                      placeholderTextColor={Colors.textMuted}
                    />

                    {/* Apodo */}
                    <Text style={s.fieldLabel}>Apodo (así te llama tu coach)</Text>
                    <TextInput
                      style={s.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Opcional — ej: Juanes, Campeón..."
                      autoCapitalize="words"
                      maxLength={20}
                      returnKeyType="next"
                      placeholderTextColor={Colors.textMuted}
                    />

                    {/* Datos físicos */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Edad</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={age} onChangeText={setAge}
                            keyboardType="number-pad" maxLength={2} returnKeyType="next" />
                          <Text style={s.fieldUnit}>años</Text>
                        </View>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Peso</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={weight} onChangeText={setWeight}
                            keyboardType="number-pad" maxLength={3} returnKeyType="next" />
                          <Text style={s.fieldUnit}>kg</Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Altura</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={height} onChangeText={setHeight}
                            keyboardType="number-pad" maxLength={3} returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss} />
                          <Text style={s.fieldUnit}>cm</Text>
                        </View>
                      </View>
                      <View style={{ flex: 1 }} />
                    </View>

                    {/* Objetivo */}
                    <Text style={s.fieldLabel}>Objetivo</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md }}>
                      {GOALS.map((g) => (
                        <TouchableOpacity key={g.key}
                          style={[s.optionBtn, goal === g.key && s.optionBtnSel]}
                          onPress={() => { setGoal(g.key); Haptics.selectionAsync(); }}
                          activeOpacity={0.8}>
                          <Text style={[s.optionTxt, goal === g.key && { color: Colors.accent }]}>
                            {g.emoji} {g.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Actividad */}
                    <Text style={s.fieldLabel}>Nivel de actividad</Text>
                    {ACTIVITY_LEVELS.map((a) => (
                      <TouchableOpacity key={a.key}
                        style={[s.actRow, activityLevel === a.key && s.actRowSel]}
                        onPress={() => { setActivityLevel(a.key); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}>
                        <View style={[s.radio, activityLevel === a.key && s.radioSel]}>
                          {activityLevel === a.key && <View style={s.radioDot} />}
                        </View>
                        <View>
                          <Text style={[s.actLbl, activityLevel === a.key && { color: Colors.accent }]}>
                            {a.label}
                          </Text>
                          <Text style={s.actDesc}>{a.desc}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={[s.saveBtn, saving && { opacity: 0.7 }]}
                      onPress={saveChanges}
                      disabled={saving}
                      activeOpacity={0.85}
                    >
                      <Text style={s.saveBtnTxt}>
                        {saving ? 'Guardando...' : 'GUARDAR CAMBIOS'}
                      </Text>
                    </TouchableOpacity>

                    <View style={{ height: 40 }} />
                  </ScrollView>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 12 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.textPrimary },
  editBtn: { backgroundColor: Colors.bgCard, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8 },
  editBtnTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary },
  avatarSection: { alignItems: 'center', paddingVertical: Spacing.xl },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
  avatarTxt: { fontFamily: Fonts.heading, fontSize: 40, color: '#0a0a0b' },
  profileName: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.textPrimary, marginBottom: 8 },
  goalBadge: { backgroundColor: Colors.accentMuted, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.accentBorder, paddingHorizontal: 16, paddingVertical: 6 },
  goalBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: Spacing.lg, marginBottom: 10, marginTop: 4 },
  card: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary },
  rowValue: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: Spacing.lg, marginBottom: 8 },
  macroTile: { width: '47%', backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  macroVal: { fontFamily: Fonts.heading, fontSize: 32 },
  macroUnit: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  macroLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  macroNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginHorizontal: Spacing.lg, marginBottom: 20, lineHeight: 18 },
  logoutBtn: { borderWidth: 1, borderColor: Colors.error, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center' },
  logoutTxt: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.error },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, maxHeight: '92%' },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  fieldLabel: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: Spacing.md },
  input: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 14, fontFamily: Fonts.bodyMedium, fontSize: 16, color: Colors.textPrimary, marginBottom: 4 },
  fieldRow: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 4 },
  fieldInput: { fontFamily: Fonts.headingBold, fontSize: 28, color: Colors.textPrimary, flex: 1, padding: 0 },
  fieldUnit: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, paddingBottom: 2 },
  optionBtn: { borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.bgInput },
  optionBtnSel: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  optionTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, padding: Spacing.md, marginBottom: 8 },
  actRowSel: { borderColor: Colors.accentBorder, backgroundColor: Colors.bgSelected },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: Colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  actLbl: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textPrimary },
  actDesc: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg },
  saveBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
});