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
import Constants from 'expo-constants';

// Versión de marketing MÁS versionCode. Los dos, porque varios builds comparten
// el 1.3.0 y el que los distingue es el segundo número — que es justo el que
// hace falta para saber si un teléfono tiene el build de hoy.
const versionApp = `${Constants.expoConfig?.version ?? '?'} (${
  (Constants.expoConfig as any)?.android?.versionCode ?? '?'
})`;
import { supabase, type BiologicalSex } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';
import { borrarDatosLocales } from '../../lib/borradoLocal';
import { calculateDailyMacros } from '../../lib/openai';
import { getAccountEmail, deleteAccountServerSide } from '../../lib/account';
import { restorePreviousPlan } from '../../lib/adaptivePlan';
import { ofrecerAjusteDePlan } from '../../lib/ofrecerAjusteDePlan';
import { planChangePreview } from '../../lib/planDiff';
import { canUseFeature } from '../../lib/subscription';
import { resetPurchasesIdentity } from '../../lib/purchases';
import { phReset } from '../../lib/posthog';
import { cancelDailyNotifications } from '../../lib/dailyNotifications';
import { resetAnalyticsIdentity } from '../../lib/analytics';
import { track } from '../../lib/analytics';
import AuthSheet from '../../Components/AuthSheet';
import { Colors, Fonts, Radii, Spacing, A11y, Type } from '../../constants/theme';
import HelpButton from '../../Components/HelpButton';
import { MIN_AGE, MAX_AGE } from '../../lib/safety';
import { getSessionReplayConsent } from '../../lib/privacyPreferences';
import { setSessionReplayConsent } from '../../lib/posthog';
import { exportarMisDatos } from '../../lib/exportData';
import { captureError } from '../../lib/monitoring';
import * as ExpoFS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useRecuperacion } from '../../lib/useRecuperacion';

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

// Mismas 3 opciones y mismas etiquetas que el onboarding: el sexo biológico
// entra en la constante de Mifflin-St Jeor, así que equivocarse al registrarse
// desplaza las calorías diarias ~166 kcal y ese error se arrastra para siempre
// si no hay forma de corregirlo. Aquí es donde se corrige.
const SEX_OPTIONS = [
  { key: 'male',        label: 'Hombre' },
  { key: 'female',      label: 'Mujer' },
  { key: 'unspecified', label: 'Prefiero no decirlo' },
] as const;

const SEX_LABELS: Record<string, string> = {
  male:        'Hombre',
  female:      'Mujer',
  unspecified: 'Prefiero no decirlo',
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
const EXPERIENCE_OPTIONS = [
  { key: 'principiante', label: 'Principiante' },
  { key: 'intermedio', label: 'Intermedio' },
  { key: 'avanzado', label: 'Avanzado' },
] as const;
const EQUIPMENT_OPTIONS = [
  { key: 'gym', label: 'Gimnasio completo' },
  { key: 'casa_basico', label: 'Casa con mancuernas/bandas' },
  { key: 'casa_sin_equipo', label: 'Casa sin equipo' },
] as const;

export default function ProfileScreen() {
  const profile = useUserStore((s: any) => s.profile);
  // Esta pantalla no sabía nada del modo recuperación: enseñaba el peso, la
  // meta y los cuatro macros en números grandes, y dejaba editar el peso, que
  // además recalcula las calorías al guardar.
  const recuperacion = useRecuperacion();
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);

  const [editModal, setEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [authSheet, setAuthSheet] = useState(false);
  const [replayConsent, setReplayConsentState] = useState(false);

  useEffect(() => {
    getAccountEmail().then(setAccountEmail).catch(() => {});
    getSessionReplayConsent().then(setReplayConsentState).catch(() => {});
  }, []);

  const isAnon = !accountEmail;

  // Campos editables
  const [name, setName] = useState(profile?.name ?? '');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [age, setAge] = useState(String(profile?.age ?? ''));
  const [weight, setWeight] = useState(String(profile?.weight_kg ?? ''));
  const [height, setHeight] = useState(String(profile?.height_cm ?? ''));
  // Respaldo 'unspecified': la columna es NOT NULL en la DB, pero un perfil que
  // quedó en memoria/caché desde antes de la migración llega sin el campo, y
  // calculateDailyMacros ya no acepta un sexo undefined. El punto medio es la
  // única suposición que no le mete un sesgo sistemático a nadie.
  const [sex, setSex] = useState<BiologicalSex>(profile?.sex ?? 'unspecified');
  const [goal, setGoal] = useState(profile?.goal ?? 'muscle_gain');
  const [activityLevel, setActivityLevel] = useState(profile?.activity_level ?? 'moderate');
  const [trainingExperience, setTrainingExperience] = useState(profile?.training_experience ?? 'principiante');
  const [daysPerWeek, setDaysPerWeek] = useState(profile?.days_per_week ?? 3);
  const [equipment, setEquipment] = useState(profile?.equipment ?? 'gym');

  async function saveChanges() {
    if (!name.trim()) { Alert.alert('Error', 'Ingresa tu nombre.'); return; }
    if (!age || isNaN(+age) || +age < MIN_AGE || +age > MAX_AGE) { Alert.alert('Error', `La edad debe estar entre ${MIN_AGE} y ${MAX_AGE} años.`); return; }
    if (!weight || isNaN(+weight) || +weight < 30 || +weight > 300) { Alert.alert('Error', 'Peso entre 30 y 300 kg.'); return; }
    if (!height || isNaN(+height) || +height < 130 || +height > 230) { Alert.alert('Error', 'Altura entre 130 y 230 cm.'); return; }

    setSaving(true);
    Keyboard.dismiss();

    const newMacros = calculateDailyMacros({
      age: +age,
      sex,
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
        sex,
        weight_kg: +weight,
        height_cm: +height,
        goal,
        activity_level: activityLevel,
        training_experience: trainingExperience,
        days_per_week: daysPerWeek,
        equipment,
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
  const [exportando, setExportando] = useState(false);

  /**
   * Llevarte tus datos. El centro de privacidad dejaba ver la política y
   * borrarlo todo, pero no irte SIN perderlo todo — y para una app con meses
   * de entrenamientos, pesos y fotos, "bórralo o quédate" no es una elección.
   */
  async function handleExportarDatos() {
    if (!profile || exportando) return;
    setExportando(true);
    try {
      const res = await exportarMisDatos(profile.user_id);
      if (!res.ok) { Alert.alert('No se pudo exportar', res.mensaje); return; }

      const ruta = ExpoFS.cacheDirectory + 'gymup-mis-datos.json';
      await ExpoFS.writeAsStringAsync(ruta, res.json);
      track('privacy_data_exported', { tablas: res.tablas, filas: res.filas, incompleto: res.incompletas.length > 0 });

      // Se avisa ANTES de compartir si faltó algo: alguien podría exportar y
      // borrar la cuenta a continuación creyendo que ya tiene todo lo suyo.
      if (res.incompletas.length > 0) {
        Alert.alert(
          'Export incompleto',
          `No pudimos leer: ${res.incompletas.join(', ')}. El archivo lo dice también por dentro. Vuelve a intentarlo antes de borrar tu cuenta.`
        );
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(ruta, { mimeType: 'application/json', dialogTitle: 'Tus datos de Rityvo' });
      } else {
        Alert.alert('Datos listos', `Se guardaron ${res.filas} registros en ${ruta}`);
      }
    } catch (e: any) {
      captureError(e, { scope: 'profile.exportar_datos' });
      Alert.alert('No se pudo exportar', e?.message ?? 'Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  }

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
  // El borrado vive entero en el servidor (ver la Edge Function
  // delete-account). Aquí ya NO hay respaldo cliente-side: borrar por filas
  // desde el cliente nunca podía eliminar la identidad de auth ni las fotos de
  // Storage, así que cerraba sesión sobre un borrado a medias — le mostraba al
  // usuario un éxito que no había ocurrido y, al perder la sesión, lo dejaba
  // sin JWT para reintentar. Si falla, se dice y se conserva la sesión.
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
            const res = await deleteAccountServerSide();
            if (!res.ok) {
              Alert.alert(
                'No se pudo eliminar tu cuenta',
                `${res.error ?? 'Error desconocido.'}\n\nTu cuenta y tus datos siguen intactos. Puedes intentarlo de nuevo.`,
                [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Reintentar', onPress: handleDeleteAccount },
                ]
              );
              return;
            }
            await resetPurchasesIdentity(); // desvincula RevenueCat de este uid antes de perder la sesión
            phReset(); // y PostHog: sin esto el próximo usuario hereda la identidad del anterior
            await cancelDailyNotifications(); // el dispositivo seguía recordándole a quien ya se fue
            await resetAnalyticsIdentity(); // la cola pendiente no puede acabar a nombre del siguiente
            // Lo que sabíamos de la salud era de OTRA persona. Sin esto, el modo
            // recuperación (y el tamizaje en caché) sobrevivían al cambio de
            // cuenta en un teléfono compartido.
            useUserStore.getState().olvidarSesion();
            // Y del DISPOSITIVO. El servidor ya borró sus filas y sus archivos,
            // pero en AsyncStorage se quedaban el tamizaje de salud en caché, la
            // conversación con el coach, la memoria destilada —con lesiones
            // dentro—, la sesión a medias y las cuotas del día. La política
            // promete borrarlo todo, y en un teléfono compartido o vendido eso
            // no es un detalle.
            await borrarDatosLocales();
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
  //
  // El flujo entero —generar, enseñar el diff, aplicar solo si se confirma—
  // vive en lib/ofrecerAjusteDePlan.ts. Estaba escrito aquí, y ahora hay un
  // segundo sitio que lo ofrece (el final de un análisis corporal): con dos
  // copias, el próximo cambio se haría en una sola. Ya ha pasado tres veces en
  // este repositorio.
  async function handleAdaptPlan() {
    if (!profile || !trainingPlan?.plan_data) return;
    const gate = canUseFeature('regenerate_plan', !!profile.is_premium);
    if (!gate.allowed) { router.push('/paywall' as any); return; }
    await ofrecerAjusteDePlan({
      profile,
      planActual: trainingPlan.plan_data,
      origen: 'perfil',
      onCargando: setReplanning,
      onAplicado: (guardado) => {
        setTrainingPlan(guardado);
        setProfile({ ...profile, current_plan_day: 0 });
      },
    });
  }

  async function handleRestorePlan() {
    Alert.alert('Restaurar plan anterior', 'Volverás al día 1 del plan anterior. Tu historial y todas tus métricas se conservan.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Restaurar', onPress: async () => {
        setReplanning(true);
        try {
          const restored = await restorePreviousPlan();
          setTrainingPlan(restored);
          setProfile({ ...profile, current_plan_day: 0 });
          track('plan_adaptation_rolled_back');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Plan restaurado', 'Volviste al plan anterior sin perder tu historial.');
        } catch (error: any) {
          Alert.alert('No se pudo restaurar', error?.message ?? 'No hay un plan anterior.');
        } finally {
          setReplanning(false);
        }
      } },
    ]);
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
            await resetPurchasesIdentity(); // sin esto, el próximo usuario en este dispositivo hereda el RevenueCat de este
            phReset();
            await cancelDailyNotifications();
            await resetAnalyticsIdentity();
            // Lo que sabíamos de la salud era de OTRA persona. Sin esto, el modo
            // recuperación (y el tamizaje en caché) sobrevivían al cambio de
            // cuenta en un teléfono compartido.
            useUserStore.getState().olvidarSesion();
            // Y del DISPOSITIVO. El servidor ya borró sus filas y sus archivos,
            // pero en AsyncStorage se quedaban el tamizaje de salud en caché, la
            // conversación con el coach, la memoria destilada —con lesiones
            // dentro—, la sesión a medias y las cuotas del día. La política
            // promete borrarlo todo, y en un teléfono compartido o vendido eso
            // no es un detalle.
            await borrarDatosLocales();
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
          <Text style={s.headerTitle} accessibilityRole="header">PERFIL</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <HelpButton
              pantalla="la pantalla de perfil"
              pregunta="Explícame la pantalla de perfil de Rityvo: de dónde salen mis macros diarios, qué pasa si edito mi peso o mi objetivo, qué hace 'Actualizar mi rutina' y para qué sirve la sección de salud."
            />
            <TouchableOpacity style={s.editBtn}
              accessibilityRole="button" accessibilityLabel="Editar mi perfil"
              onPress={() => {
                setName(profile.name);
                setNickname(profile.nickname ?? '');
                setAge(String(profile.age));
                setWeight(String(profile.weight_kg));
                setHeight(String(profile.height_cm));
                setSex(profile.sex ?? 'unspecified');
                setGoal(profile.goal);
                setActivityLevel(profile.activity_level);
                setTrainingExperience(profile.training_experience ?? 'principiante');
                setDaysPerWeek(profile.days_per_week ?? 3);
                setEquipment(profile.equipment ?? 'gym');
                setEditModal(true);
              }}>
              <Text style={s.editBtnTxt}>✏️ Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Avatar */}
        <View style={s.avatarSection}>
          {/* La inicial del avatar es decorativa: el nombre ya se lee debajo. */}
          <View style={s.avatar} importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden>
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
        <Text style={s.sectionLbl} accessibilityRole="header">TUS DATOS</Text>
        <View style={s.card}>
          {[
            { label: 'Edad', value: `${profile.age} años` },
            // El peso desaparece de la lista con el modo activo. Sigue guardado
            // y sigue usándose para calcular su plan; simplemente no se le pone
            // el número delante.
            ...(recuperacion.ocultarPeso ? [] : [{ label: 'Peso', value: `${profile.weight_kg} kg` }]),
            { label: 'Altura', value: `${profile.height_cm} cm` },
            { label: 'Sexo biológico', value: SEX_LABELS[profile.sex] ?? SEX_LABELS.unspecified },
            { label: 'Actividad', value: ACTIVITY_LABELS[profile.activity_level] },
            { label: 'Experiencia', value: EXPERIENCE_OPTIONS.find((o) => o.key === profile.training_experience)?.label ?? 'Principiante' },
            { label: 'Días disponibles', value: `${profile.days_per_week ?? 3} por semana` },
            { label: 'Equipo', value: EQUIPMENT_OPTIONS.find((o) => o.key === profile.equipment)?.label ?? 'Gimnasio completo' },
            { label: 'Objetivo', value: `${goalInfo.emoji} ${goalInfo.label}` },
            { label: 'Día del plan', value: `Día ${(profile.current_plan_day ?? 0) + 1} de 7` },
          ].map((row, i, arr) => (
            <View key={row.label} style={[s.row, i < arr.length - 1 && s.rowBorder]}
              accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Macros diarios. Se ocultan enteros con el modo activo: cuatro cifras
            de objetivo diario es exactamente el material del que se alimenta un
            trastorno de la conducta alimentaria. El plan los sigue usando. */}
        {!recuperacion.ocultarCalorias && (
        <>
        <Text style={s.sectionLbl} accessibilityRole="header">TUS MACROS DIARIOS</Text>
        <View style={s.macroGrid}>
          {[
            { label: 'Calorías', value: `${profile.daily_calories}`, unit: 'kcal', color: Colors.accent },
            { label: 'Proteína', value: `${profile.daily_protein_g}`, unit: 'g', color: Colors.macroProtein },
            { label: 'Carbos',   value: `${profile.daily_carbs_g}`,   unit: 'g', color: Colors.macroCarbs },
            { label: 'Grasa',    value: `${profile.daily_fat_g}`,     unit: 'g', color: Colors.macroFat },
          ].map((m) => (
            <View key={m.label} style={s.macroTile} accessible
              accessibilityLabel={`${m.label}: ${m.value} ${m.unit === 'g' ? 'gramos' : 'kilocalorías'} al día`}>
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
        </>
        )}

        {/* Plan */}
        <Text style={s.sectionLbl} accessibilityRole="header">PLAN</Text>
        <View style={s.card}>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleAdaptPlan} disabled={replanning}
            accessibilityRole="button"
            accessibilityLabel={replanning
              ? 'Actualizando tu rutina, espera'
              : `Actualizar mi rutina${profile.is_premium ? '' : '. Función premium'}`}
            accessibilityHint="Revisa lo que has levantado y propone cambios. Te enseña qué cambia antes de aplicar nada"
            accessibilityState={{ disabled: replanning, busy: replanning }}>
            {/* "Ajustar mi plan con IA / Adapta cargas según tu desempeño real"
                no le dice a nadie qué va a pasar si lo toca. Se probó y la
                reacción fue literal: "esa opción, ¿para qué funciona? ¿quién
                entiende eso?". El rótulo describía la tecnología, no el efecto.

                Ahora dice QUÉ mira, QUÉ cambia y —lo que más importaba— que no
                aplica nada sin enseñarlo antes. Ese miedo es el que frena: el
                plan es lo que la persona va a hacer las próximas semanas. */}
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>🤖 Actualizar mi rutina {profile.is_premium ? '' : '✦'}</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>
                Mira lo que has levantado estas semanas y sube, baja o cambia los ejercicios
                que lo necesiten. Te enseña qué cambia antes de aplicar nada.
              </Text>
            </View>
            <Text style={[s.rowValue, { color: Colors.accent }]}>{replanning ? '…' : '›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleRestorePlan} disabled={replanning}
            accessibilityRole="button" accessibilityLabel="Restaurar mi plan anterior"
            accessibilityHint="No elimina el historial ni las métricas">
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>↶ Restaurar plan anterior</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Deshace el último ajuste; conserva todo tu progreso</Text>
            </View>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row}
            accessibilityRole="button" accessibilityLabel="Reiniciar mi plan al día 1"
            onPress={async () => {
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
          <TouchableOpacity style={s.row} onPress={() => router.push('/health' as any)}
            accessibilityRole="button" accessibilityLabel="Mi salud"
            accessibilityHint="Lesiones y condiciones. Tu plan se adapta a esto">
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>🩺 Mi salud</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Lesiones y condiciones — tu plan se adapta a esto</Text>
            </View>
            <Text style={[s.rowValue, { color: Colors.accent }]}>›</Text>
          </TouchableOpacity>
          {/* Telemetría es un panel de OBSERVABILIDAD para el desarrollador:
              costo en USD por llamada, latencia, tokens y score de calidad del
              coach. No es una función del producto y no tiene por qué estar en
              el perfil de alguien que solo quiere entrenar — enseñarle a un
              usuario cuánto cuesta cada mensaje de su coach no le aporta nada.
              Se restringe a builds de desarrollo, igual que el atajo al coach
              en vivo del onboarding. La pantalla sigue existiendo y sigue
              siendo accesible por ruta directa cuando se necesite depurar. */}
          {__DEV__ && (
            <TouchableOpacity style={s.row} onPress={() => router.push('/telemetry' as any)}
              accessibilityRole="button" accessibilityLabel="Telemetría de la inteligencia artificial"
              accessibilityHint="Costo, latencia, score y decisiones del coach. Solo en desarrollo">
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>🔬 [DEV] Telemetría IA</Text>
                <Text style={[s.actDesc, { marginTop: 2 }]}>Costo, latencia, score y decisiones del coach</Text>
              </View>
              <Text style={s.rowValue}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* CUERPO. La pantalla de análisis anteriores existía en la base y no en
            la app: se salía de los resultados y desaparecían. La entrada va
            aquí, y ADEMÁS oculta en modo recuperación — la ruta ya lleva su
            propia compuerta, pero enseñar un botón que va a decir "en pausa" es
            recordarle a alguien justo lo que ese modo intenta no recordarle. */}
        {!recuperacion.ocultarCuerpo && (
          <>
            <Text style={s.sectionLbl} accessibilityRole="header">CUERPO</Text>
            <View style={s.card}>
              <TouchableOpacity
                style={s.row}
                onPress={() => router.push('/body-scan-historial' as any)}
                accessibilityRole="button"
                accessibilityLabel="Ver mis análisis corporales anteriores"
                accessibilityHint="Puntaje, zonas y qué cambiar en tu plan, de cada análisis"
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>📊 Mis análisis anteriores</Text>
                  <Text style={[s.actDesc, { marginTop: 2 }]}>
                    Lo que dijo cada análisis y cómo ha cambiado
                  </Text>
                </View>
                <Text style={[s.rowValue, { color: Colors.accent }]}>›</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Cuenta */}
        <Text style={s.sectionLbl} accessibilityRole="header">CUENTA</Text>
        <View style={s.card}>
          {isAnon ? (
            <TouchableOpacity style={s.row} onPress={() => setAuthSheet(true)}
              accessibilityRole="button" accessibilityLabel="Guardar mi progreso creando una cuenta"
              accessibilityHint="Tu cuenta es anónima. Crea una cuenta para no perder tus datos">
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>💾 Guardar mi progreso</Text>
                <Text style={[s.actDesc, { marginTop: 2 }]}>Cuenta anónima — crea una cuenta para no perder tus datos</Text>
              </View>
              <Text style={[s.rowValue, { color: Colors.accent }]}>›</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.row} accessible accessibilityLabel={`Cuenta: ${accountEmail}`}>
              <Text style={s.rowLabel}>✅ Cuenta</Text>
              <Text style={s.rowValue}>{accountEmail}</Text>
            </View>
          )}
        </View>

        {/* Privacidad y datos */}
        <Text style={s.sectionLbl} accessibilityRole="header">PRIVACIDAD Y DATOS</Text>
        <View style={s.card}>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={async () => {
            const next = !replayConsent;
            setReplayConsentState(next);
            await setSessionReplayConsent(next, '/profile');
            track('privacy_replay_preference_changed', { enabled: next });
          }} accessibilityRole="switch" accessibilityState={{ checked: replayConsent }}
            accessibilityLabel="Grabaciones opcionales para mejorar la experiencia">
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Grabación de uso opcional</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Apagada por defecto; texto e imágenes ocultos y nunca en pantallas sensibles</Text>
            </View>
            <Text style={[s.rowValue, { color: replayConsent ? Colors.accent : Colors.textMuted }]}>{replayConsent ? 'Activada' : 'Apagada'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={() => router.push('/legal?doc=privacy' as any)}
            accessibilityRole="button" accessibilityLabel="Abrir política de privacidad">
            <Text style={s.rowLabel}>Política de privacidad</Text><Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={() => router.push('/legal?doc=terms' as any)}
            accessibilityRole="button" accessibilityLabel="Abrir términos de uso">
            <Text style={s.rowLabel}>Términos de uso</Text><Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleExportarDatos} disabled={exportando}
            accessibilityRole="button" accessibilityLabel="Descargar una copia de todos mis datos"
            accessibilityState={{ disabled: exportando, busy: exportando }}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Descargar mis datos</Text>
              <Text style={[s.actDesc, { marginTop: 2 }]}>Un archivo con todo lo tuyo: entrenamientos, comidas, pesos y ajustes</Text>
            </View>
            <Text style={s.rowValue}>{exportando ? '…' : '›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowBorder]} onPress={handleDeleteBodyScans}
            accessibilityRole="button" accessibilityLabel="Eliminar mi historial de análisis corporal">
            <Text style={s.rowLabel}>🗑️ Eliminar historial de análisis corporal</Text>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={handleDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Eliminar mi cuenta y todos mis datos"
            accessibilityHint="Esta acción es irreversible. Te pediremos confirmación">
            <Text style={[s.rowLabel, { color: Colors.error }]}>⚠️ Eliminar mi cuenta y todos mis datos</Text>
            <Text style={s.rowValue}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Cerrar sesión */}
        <View style={{ paddingHorizontal: Spacing.lg, marginTop: Spacing.md }}>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Cerrar sesión">
            <Text style={s.logoutTxt}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>

        {/* QUÉ VERSIÓN ES ESTA. No estaba en ninguna parte, y sin ella no hay
            forma de saber si el teléfono tiene el build de hoy o el de la
            semana pasada — ni probando, ni cuando alguien reporta un fallo.
            El versionCode va al lado del número de marketing a propósito: dos
            builds distintos comparten el 1.3.0, y el que los distingue es el
            de al lado. */}
        <Text style={s.versionTxt} accessibilityLabel={`Versión ${versionApp}`}>
          Rityvo {versionApp}
        </Text>

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
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined}>
                <View style={s.modalBox} accessibilityViewIsModal accessibilityLabel="Editar perfil">
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
                    <Text style={s.modalTitle} accessibilityRole="header">EDITAR PERFIL</Text>
                    <TouchableOpacity onPress={() => { Keyboard.dismiss(); setEditModal(false); }}
                      hitSlop={A11y.hitSlop}
                      accessibilityRole="button" accessibilityLabel="Cancelar y cerrar sin guardar">
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
                      accessibilityLabel="Tu nombre"
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
                      accessibilityLabel="Tu apodo, así te llama el coach. Opcional"
                    />

                    {/* Datos físicos */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Edad</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={age} onChangeText={setAge}
                            keyboardType="number-pad" maxLength={2} returnKeyType="next"
                            accessibilityLabel="Tu edad en años" />
                          <Text style={s.fieldUnit}>años</Text>
                        </View>
                      </View>
                      {/* El campo de peso se retira, no el guardado: la
                          persona tiene que poder seguir editando su nombre, su
                          edad o su equipo. El estado `weight` conserva el valor
                          guardado, así que los macros se siguen calculando con
                          el peso real — solo que sin pedírselo otra vez. */}
                      {!recuperacion.ocultarPeso && (
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Peso</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={weight} onChangeText={setWeight}
                            keyboardType="number-pad" maxLength={3} returnKeyType="next"
                            accessibilityLabel="Tu peso en kilogramos" />
                          <Text style={s.fieldUnit}>kg</Text>
                        </View>
                      </View>
                      )}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldLabel}>Altura</Text>
                        <View style={s.fieldRow}>
                          <TextInput style={s.fieldInput} value={height} onChangeText={setHeight}
                            keyboardType="number-pad" maxLength={3} returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                            accessibilityLabel="Tu altura en centímetros" />
                          <Text style={s.fieldUnit}>cm</Text>
                        </View>
                      </View>
                      <View style={{ flex: 1 }} />
                    </View>

                    {/* Sexo biológico — editable porque cambia el BMR y, con él,
                        las calorías diarias. Al guardar, saveChanges recalcula
                        los macros, así que el cambio se ve de inmediato. */}
                    <Text style={s.fieldLabel}>Sexo biológico</Text>
                    <Text style={[s.actDesc, { marginBottom: 10 }]}>
                      Cambia tu metabolismo basal y cómo programamos tu plan. Puedes omitirlo.
                    </Text>
                    {SEX_OPTIONS.map((o) => (
                      <TouchableOpacity key={o.key}
                        style={[s.actRow, sex === o.key && s.actRowSel]}
                        onPress={() => { setSex(o.key); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityLabel={o.label}
                        accessibilityState={{ selected: sex === o.key }}>
                        <View style={[s.radio, sex === o.key && s.radioSel]}>
                          {sex === o.key && <View style={s.radioDot} />}
                        </View>
                        <Text style={[s.actLbl, sex === o.key && { color: Colors.accent }]}>
                          {o.label}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    {/* Objetivo */}
                    <Text style={s.fieldLabel}>Objetivo</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md }}>
                      {GOALS.map((g) => (
                        <TouchableOpacity key={g.key}
                          style={[s.optionBtn, goal === g.key && s.optionBtnSel]}
                          onPress={() => { setGoal(g.key); Haptics.selectionAsync(); }}
                          activeOpacity={0.8}
                          accessibilityRole="radio"
                          accessibilityLabel={g.label}
                          accessibilityState={{ selected: goal === g.key }}>
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
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityLabel={`${a.label}. ${a.desc}`}
                        accessibilityState={{ selected: activityLevel === a.key }}>
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

                    <Text style={s.fieldLabel}>Experiencia entrenando</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {EXPERIENCE_OPTIONS.map((o) => (
                        <TouchableOpacity key={o.key} style={[s.optionBtn, trainingExperience === o.key && s.optionBtnSel]}
                          onPress={() => setTrainingExperience(o.key)} accessibilityRole="radio"
                          accessibilityState={{ selected: trainingExperience === o.key }} accessibilityLabel={o.label}>
                          <Text style={[s.optionTxt, trainingExperience === o.key && { color: Colors.accent }]}>{o.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={s.fieldLabel}>Días disponibles por semana</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {[2, 3, 4, 5, 6].map((day) => (
                        <TouchableOpacity key={day} style={[s.optionBtn, { flex: 1, alignItems: 'center' }, daysPerWeek === day && s.optionBtnSel]}
                          onPress={() => setDaysPerWeek(day)} accessibilityRole="radio"
                          accessibilityState={{ selected: daysPerWeek === day }} accessibilityLabel={`${day} días por semana`}>
                          <Text style={[s.optionTxt, daysPerWeek === day && { color: Colors.accent }]}>{day}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={s.fieldLabel}>Equipo disponible</Text>
                    {EQUIPMENT_OPTIONS.map((o) => (
                      <TouchableOpacity key={o.key} style={[s.actRow, equipment === o.key && s.actRowSel]}
                        onPress={() => setEquipment(o.key)} accessibilityRole="radio"
                        accessibilityState={{ selected: equipment === o.key }} accessibilityLabel={o.label}>
                        <View style={[s.radio, equipment === o.key && s.radioSel]}>
                          {equipment === o.key && <View style={s.radioDot} />}
                        </View>
                        <Text style={[s.actLbl, equipment === o.key && { color: Colors.accent }]}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={[s.saveBtn, saving && { opacity: 0.7 }]}
                      onPress={saveChanges}
                      disabled={saving}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={saving ? 'Guardando tus cambios' : 'Guardar cambios del perfil'}
                      accessibilityState={{ disabled: saving, busy: saving }}
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
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: Spacing.lg, marginBottom: 10, marginTop: 4 },
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
  versionTxt: {
    fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textDisabled,
    textAlign: 'center', marginTop: Spacing.lg,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, maxHeight: '92%' },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  fieldLabel: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: Spacing.md },
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
  actDesc: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg },
  saveBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
});
