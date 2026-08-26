import { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, Keyboard,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tomarFoto, elegirDeGaleria, avisarError } from '../lib/camara';
// El permiso se pide AQUÍ y no en lib/camara porque estas dos pantallas
// ofrecen registrar a mano cuando se niega, que es mejor salida que la genérica.
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyzeFoodPhoto } from '../lib/openai';
import { registrarComida } from '../lib/logMeal';
import { canUseFeature } from '../lib/subscription';
import { localDateKey } from '../lib/foodLogs';
import { useUserStore } from '../store/userStore';
import { track } from '../lib/analytics';
import { captureError } from '../lib/monitoring';
import { hasSeenCameraDisclosure, markCameraDisclosureSeen } from '../lib/cameraConsent';
import CameraDisclosureModal from '../Components/CameraDisclosureModal';
import ReportContentButton from '../Components/ReportContentButton';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';
import GuardiaRecuperacion from '../Components/GuardiaRecuperacion';

type FoodResult = {
  meal_name: string;
  food_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

function FoodScanScreenContenido() {
  const profile = useUserStore((s: any) => s.profile);
  const addFoodLog = useUserStore((s: any) => s.addFoodLog);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);
  const todayFoodLogs = useUserStore((s: any) => s.todayFoodLogs);

  const [phase, setPhase] = useState<'intro' | 'analyzing' | 'result' | 'added'>('intro');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<FoodResult | null>(null);
  const [portion, setPortion] = useState(1); // multiplicador de porción
  const [showCameraDisclosure, setShowCameraDisclosure] = useState(false);
  // El modal resuelve esta promesa: así asegurarDisclosure() se puede esperar
  // como cualquier otro await al inicio de los handlers, sin duplicar el flujo.
  const disclosureResolver = useRef<((aceptado: boolean) => void) | null>(null);

  // Macros escalados por la porción elegida (lo que realmente se suma al día).
  const scaled = result ? {
    meal_name: result.meal_name,
    food_description: result.food_description,
    calories: Math.round(result.calories * portion),
    protein_g: Math.round(result.protein_g * portion),
    carbs_g: Math.round(result.carbs_g * portion),
    fat_g: Math.round(result.fat_g * portion),
    fiber_g: Math.round(result.fiber_g * portion),
  } : null;

  const totals = getDailyTotals();

  // Disclosure de IA (una sola vez): lo que hay que divulgar no es el permiso
  // de cámara sino que la foto SALE del teléfono hacia un tercero (OpenAI), y
  // eso pasa igual si la imagen viene de la galería. Antes solo se gateaba la
  // captura en vivo, así que quien elegía de galería enviaba su foto sin haber
  // visto nunca el aviso. Devuelve false si el usuario cancela.
  async function asegurarDisclosure(): Promise<boolean> {
    if (await hasSeenCameraDisclosure('food_scan')) return true;
    return new Promise<boolean>((resolve) => {
      disclosureResolver.current = resolve;
      setShowCameraDisclosure(true);
    });
  }

  async function pickPhoto(fromCamera: boolean) {
    if (!(await asegurarDisclosure())) return;
    await doPickPhoto(fromCamera);
  }

  async function acceptCameraDisclosure() {
    setShowCameraDisclosure(false);
    await markCameraDisclosureSeen('food_scan');
    disclosureResolver.current?.(true);
    disclosureResolver.current = null;
  }

  function cancelCameraDisclosure() {
    setShowCameraDisclosure(false);
    disclosureResolver.current?.(false);
    disclosureResolver.current = null;
  }

  async function doPickPhoto(fromCamera: boolean) {
    try {
      Keyboard.dismiss();

      // Gating freemium: contar ESCANEOS (la acción cara de IA), no comidas
      // guardadas — antes, escanear y descartar daba análisis ilimitados.
      // El cupo se consume al completar el análisis (ver analyze()).
      if (!profile?.is_premium) {
        const key = `gymup_foodscan_${localDateKey()}`;
        const used = parseInt((await AsyncStorage.getItem(key)) ?? '0', 10);
        const gate = canUseFeature('food_scan', false, used);
        if (!gate.allowed) {
          track('quota_hit', { feature: 'food_scan' });
          // Quedarse sin escaneos no puede significar quedarse sin registrar
          // el día: la salida manual va PRIMERO, antes que el paywall.
          Alert.alert('Sin escaneos por hoy', gate.reason ?? '', [
            { text: 'Registrar a mano', onPress: () => router.replace('/food-manual' as any) },
            { text: 'Ver Premium', onPress: () => router.push('/paywall' as any) },
            { text: 'Cerrar', style: 'cancel' },
          ]);
          return;
        }
      }

      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        // Negar el permiso no puede ser un callejón sin salida (§18.5): se
        // explica para qué era y se ofrece la alternativa que no lo necesita.
        Alert.alert(
          'Sin acceso a la cámara',
          'La usamos solo para analizar la foto de tu plato. Puedes activarla en los ajustes del teléfono, o registrar la comida a mano.',
          [
            { text: 'Registrar a mano', onPress: () => router.replace('/food-manual' as any) },
            { text: 'Cerrar', style: 'cancel' },
          ],
        );
        return;
      }

      const opciones = { quality: 0.8, allowsEditing: false };
      const r = fromCamera ? await tomarFoto(opciones) : await elegirDeGaleria(opciones);
      if (r.estado === 'cancelado') return;
      if (r.estado === 'error') {
        // Con salida a la galería: quedarse sin poder registrar la comida
        // porque Android mató la Activity no puede ser el final del camino.
        avisarError(r, () => doPickPhoto(false));
        return;
      }

      if (__DEV__) console.log('[FoodScan] URI seleccionada:', r.uri);
      setPhotoUri(r.uri);
      await analyze(r.uri);
    } catch (e: any) {
      Alert.alert('Error', 'Error al abrir cámara: ' + (e?.message ?? 'desconocido'));
    }
  }

  async function analyze(uri: string) {
    setPhase('analyzing');
    track('scan_started', { type: 'food' });
    try {
      const data = await analyzeFoodPhoto(uri);
      if (__DEV__) console.log('[FoodScan] Éxito:', JSON.stringify(data));
      setResult(data);
      setPhase('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Consumir el cupo diario SOLO tras un análisis exitoso.
      if (!profile?.is_premium) {
        const key = `gymup_foodscan_${localDateKey()}`;
        const used = parseInt((await AsyncStorage.getItem(key)) ?? '0', 10);
        AsyncStorage.setItem(key, String(used + 1)).catch(() => {});
      }
    } catch (e: any) {
      console.log('[FoodScan] ERROR:', e?.message);
      track('scan_failed', { type: 'food' });
      Alert.alert('Error en el análisis', e?.message ?? 'Error desconocido');
      setPhase('intro');
      setPhotoUri(null);
    }
  }

  const addingRef = useRef(false);

  async function addToDay() {
    if (!scaled || !profile) return;
    // Anti doble-tap: dos toques insertaban la comida dos veces.
    if (addingRef.current) return;
    addingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // La secuencia completa (guardar → analítica → XP → avisos) vive en
    // lib/logMeal.ts para que el registro manual siga exactamente el mismo
    // camino. Aquí solo queda lo propio del escaneo: la porción y la foto.
    const res = await registrarComida({
      userId: profile.user_id,
      comida: {
        meal_name: portion !== 1 ? `${scaled.meal_name} (×${portion})` : scaled.meal_name,
        food_description: scaled.food_description,
        calories: scaled.calories,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        fiber_g: scaled.fiber_g,
      },
      totalesPrevios: totals,
      metas: profile,
      origen: 'escaneo',
      propsExtra: { portion },
    });

    if (!res.ok) {
      addingRef.current = false; // liberar el guard: tiene que poder reintentar
      Alert.alert('No pudimos guardar tu comida', res.mensaje);
      return;
    }

    addFoodLog(res.log as any);
    setPhase('added');
  }

  function reset() {
    addingRef.current = false;
    setPhase('intro');
    setPhotoUri(null);
    setResult(null);
    setPortion(1);
  }

  // El modal se monta en TODAS las fases que pueden pedir una foto (intro y el
  // botón "Nuevo" del resultado); si no, la promesa de asegurarDisclosure()
  // esperaría a un modal que no está en pantalla y el botón no haría nada.
  const modalDisclosure = (
    <CameraDisclosureModal
      visible={showCameraDisclosure}
      // El sujeto deja explícito que el aviso cubre los dos orígenes de la
      // imagen, no solo la cámara: lo que se divulga es el envío al tercero.
      subject="tu plato — la que tomes con la cámara o elijas de tu galería —"
      onAccept={acceptCameraDisclosure}
      onCancel={cancelCameraDisclosure}
    />
  );

  // INTRO
  if (phase === 'intro') {
    return (
      <>
      {modalDisclosure}
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity
            style={s.back}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Text style={s.backTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>ANALIZAR COMIDA</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {profile && (
            <View style={s.daySummary}>
              <Text style={s.daySummaryTitle}>Progreso de hoy</Text>
              <View style={s.macroRow}>
                {[
                  { label: 'Cal',  val: Math.round(totals.calories),   target: profile.daily_calories,   color: Colors.accent },
                  { label: 'Prot', val: Math.round(totals.protein_g),  target: profile.daily_protein_g,  color: Colors.macroProtein },
                  { label: 'Carb', val: Math.round(totals.carbs_g),    target: profile.daily_carbs_g,    color: Colors.macroCarbs },
                  { label: 'Gras', val: Math.round(totals.fat_g),      target: profile.daily_fat_g,      color: Colors.macroFat },
                ].map((m) => (
                  <View key={m.label} style={s.macroCell}>
                    <Text style={[s.macroCellVal, { color: m.color }]}>{m.val}</Text>
                    <Text style={s.macroCellLbl}>{m.label}</Text>
                    <View style={s.macroCellBar}>
                      <View style={[s.macroCellFill, {
                        width: `${Math.min((m.val / Math.max(m.target, 1)) * 100, 100)}%`,
                        backgroundColor: m.color,
                      }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={s.illustration}>
            <Text style={{ fontSize: 72 }}>🍽️</Text>
          </View>
          <Text style={s.introTitle}>Fotografía{'\n'}<Text style={{ color: Colors.accent }}>tu plato</Text></Text>
          <Text style={s.introSub}>La IA detecta los ingredientes y suma los macros a tu meta del día.</Text>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => pickPhoto(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Tomar foto del plato con la cámara"
          >
            <Text style={s.primaryBtnTxt}>📷  TOMAR FOTO</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => pickPhoto(false)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Elegir una foto del plato desde la galería"
          >
            <Text style={s.secondaryBtnTxt}>Elegir de galería</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </>
    );
  }

  // ANALIZANDO
  if (phase === 'analyzing') {
    return (
      <SafeAreaView style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}>
        {photoUri && <Image source={{ uri: photoUri }} style={s.analyzingBg} blurRadius={8} />}
        <View style={s.analyzingBox}>
          <ActivityIndicator color={Colors.accent} size="large" />
          <Text style={s.analyzingTitle}>Analizando tu plato</Text>
          <Text style={s.analyzingMsg}>GPT-4o calculando macros...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // RESULTADO
  if (phase === 'result' && result && scaled) {
    const newProtein = totals.protein_g + scaled.protein_g;
    const newCalories = totals.calories + scaled.calories;
    const remainingProtein = (profile?.daily_protein_g ?? 0) - newProtein;
    const remainingCal = (profile?.daily_calories ?? 0) - newCalories;

    return (
      <>
      {modalDisclosure}
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity
            style={s.back}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Volver y descartar este análisis"
          >
            <Text style={s.backTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>RESULTADO</Text>
          <TouchableOpacity
            onPress={() => pickPhoto(true)}
            accessibilityRole="button"
            accessibilityLabel="Analizar una foto nueva"
          >
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>Nuevo</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {photoUri && <Image source={{ uri: photoUri }} style={s.resultPhoto} />}
          <Text style={s.mealName}>{result.meal_name}</Text>
          <Text style={s.mealDesc}>{result.food_description}</Text>

          {/* Ajustador de porción */}
          <View style={s.portionRow}>
            <Text style={s.portionLbl}>Porción</Text>
            <View style={s.portionChips}>
              {[0.5, 1, 1.5, 2].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[s.portionChip, portion === p && s.portionChipSel]}
                  onPress={() => { setPortion(p); Haptics.selectionAsync(); }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Porción por ${p}`}
                  accessibilityState={{ selected: portion === p }}
                >
                  <Text style={[s.portionChipTxt, portion === p && { color: '#0a0a0b' }]}>×{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.pillsGrid}>
            {[
              { label: 'Proteína', val: scaled.protein_g, unit: 'g',    color: Colors.accent },
              { label: 'Carbos',   val: scaled.carbs_g,   unit: 'g',    color: Colors.macroCarbs },
              { label: 'Grasa',    val: scaled.fat_g,     unit: 'g',    color: Colors.macroFat },
              { label: 'Fibra',    val: scaled.fiber_g,   unit: 'g',    color: '#9b6fff' },
              { label: 'Calorías', val: scaled.calories,  unit: 'kcal', color: Colors.textPrimary },
            ].map((m) => (
              <View key={m.label} style={s.pill}>
                <Text style={[s.pillVal, { color: m.color }]}>
                  {m.val}<Text style={{ fontSize: Type.micro }}>{m.unit}</Text>
                </Text>
                <Text style={s.pillLbl}>{m.label}</Text>
              </View>
            ))}
          </View>
          <View style={s.impactCard}>
            <Text style={s.impactTitle}>📊 Impacto en tu día</Text>
            <View style={s.impactRow}>
              <Text style={s.impactLbl}>Total calorías:</Text>
              <Text style={[s.impactVal, { color: remainingCal < 0 ? Colors.macroFat : Colors.accent }]}>
                {Math.round(newCalories)}/{profile?.daily_calories} kcal
              </Text>
            </View>
            <View style={s.impactRow}>
              <Text style={s.impactLbl}>Total proteína:</Text>
              <Text style={[s.impactVal, { color: Colors.accent }]}>
                {Math.round(newProtein)}/{profile?.daily_protein_g}g
              </Text>
            </View>
            {/* El copy describe el dato y nunca califica al usuario: comer más
                o menos de la meta no lo vuelve "perfecto" ni un fracaso, y ese
                tono moralizante es justo el que dispara conductas de riesgo
                alimentario en una app que se mira varias veces al día. */}
            <Text style={s.impactNote}>
              {remainingProtein > 30
                ? `🥩 Aún faltan ${Math.round(remainingProtein)}g de proteína.`
                : remainingProtein > 0
                  ? `🥚 Faltan ${Math.round(remainingProtein)}g de proteína para tu meta.`
                  : remainingCal < -300
                    ? `📊 Vas ${Math.round(-remainingCal)} kcal por encima de tu meta de hoy.`
                    : '✅ Ya cubriste tu meta de proteína de hoy.'}
            </Text>
          </View>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={addToDay}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Agregar esta comida a mi día"
          >
            <Text style={s.primaryBtnTxt}>+ AGREGAR A MI DÍA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={reset}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Descartar este análisis"
          >
            <Text style={s.secondaryBtnTxt}>Descartar</Text>
          </TouchableOpacity>
          <ReportContentButton feature="food_scan" content={JSON.stringify(result)} />
        </ScrollView>
      </SafeAreaView>
      </>
    );
  }

  // AGREGADO
  if (phase === 'added') {
    // Los totales del store YA incluyen la comida recién agregada (addFoodLog
    // corrió antes de llegar aquí); sumar result de nuevo la contaba doble.
    const pct = Math.round((totals.protein_g / Math.max(profile?.daily_protein_g ?? 1, 1)) * 100);
    return (
      <SafeAreaView style={[s.container, { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }]}>
        <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
        <Text style={[s.introTitle, { textAlign: 'center' }]}>
          <Text style={{ color: Colors.accent }}>¡Agregado!</Text>
        </Text>
        <Text style={[s.introSub, { textAlign: 'center' }]}>
          Llevas el {pct}% de proteína hoy.
          {pct >= 100 ? ' Meta del día cubierta.' : ` Faltan ${100 - pct}%.`}
        </Text>
        <TouchableOpacity
          style={[s.primaryBtn, { width: '100%', marginTop: Spacing.xl }]}
          onPress={() => router.replace('/(tabs)' as any)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Ver mi progreso del día"
        >
          <Text style={s.primaryBtnTxt}>VER MI PROGRESO →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.secondaryBtn, { width: '100%' }]}
          onPress={reset}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Analizar y agregar otra comida"
        >
          <Text style={s.secondaryBtnTxt}>Agregar otra comida</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  back: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  daySummary: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20 },
  daySummaryTitle: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  macroRow: { flexDirection: 'row', gap: 8 },
  portionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  portionLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textSecondary },
  portionChips: { flexDirection: 'row', gap: 6 },
  portionChip: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center' },
  portionChipSel: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  portionChipTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textSecondary },
  macroCell: { flex: 1, alignItems: 'center' },
  macroCellVal: { fontFamily: Fonts.headingBold, fontSize: 18 },
  macroCellLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginBottom: 4 },
  macroCellBar: { width: '100%', height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  macroCellFill: { height: '100%', borderRadius: 2 },
  illustration: { height: 130, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  introTitle: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.textPrimary, lineHeight: 42, marginBottom: 12 },
  introSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, lineHeight: 22, marginBottom: Spacing.xl },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  secondaryBtn: { borderRadius: Radii.lg, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary },
  analyzingBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.15 },
  analyzingBox: { alignItems: 'center', backgroundColor: 'rgba(14,14,16,0.95)', borderRadius: Radii.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.border },
  analyzingTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, marginTop: 16 },
  analyzingMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 6 },
  resultPhoto: { width: '100%', height: 220, borderRadius: Radii.xl, marginBottom: 16 },
  mealName: { fontFamily: Fonts.headingBold, fontSize: 26, color: Colors.textPrimary, marginBottom: 4 },
  mealDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 16, lineHeight: 19 },
  pillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pill: { flex: 1, minWidth: '28%', backgroundColor: Colors.bgCard, borderRadius: Radii.md, padding: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  pillVal: { fontFamily: Fonts.heading, fontSize: 26, lineHeight: 28 },
  pillLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  impactCard: { backgroundColor: Colors.accentMuted, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: Spacing.lg },
  impactTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent, marginBottom: 10 },
  impactRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  impactLbl: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary },
  impactVal: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  impactNote: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.accentBorder, paddingTop: 8 },
});

/**
 * GUARDIA DEL MODO RECUPERACIÓN.
 *
 * Va aquí, en la ruta, y no en quien navega hasta ella. Esta pantalla se abre
 * también por enlace directo (app.json declara el scheme "gymup") y desde
 * cualquier router.push que exista hoy o mañana: esconder el botón de origen
 * dejaba la puerta abierta.
 */
export default function FoodScanScreen() {
  return (
    <GuardiaRecuperacion area="calorias" titulo="ESCANEAR COMIDA">
      <FoodScanScreenContenido />
    </GuardiaRecuperacion>
  );
}
