import { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, Keyboard,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyzeFoodPhoto } from '../lib/openai';
import { recordMealLogged } from '../lib/streaks';
import { canUseFeature } from '../lib/subscription';
import { localDateKey } from '../lib/foodLogs';
import { useUserStore } from '../store/userStore';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

type FoodResult = {
  meal_name: string;
  food_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export default function FoodScanScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const addFoodLog = useUserStore((s: any) => s.addFoodLog);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);
  const todayFoodLogs = useUserStore((s: any) => s.todayFoodLogs);

  const [phase, setPhase] = useState<'intro' | 'analyzing' | 'result' | 'added'>('intro');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<FoodResult | null>(null);
  const [portion, setPortion] = useState(1); // multiplicador de porción

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

  async function pickPhoto(fromCamera: boolean) {
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
          Alert.alert('Límite alcanzado', gate.reason ?? '', [
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
        Alert.alert('Permiso necesario', 'GymUp necesita acceso a la cámara o galería.');
        return;
      }

      const picked = fromCamera
        ? await ImagePicker.launchCameraAsync({
            quality: 0.8,
            mediaTypes: ['images'],
            allowsEditing: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.8,
            mediaTypes: ['images'],
            allowsEditing: false,
          });

      if (picked.canceled || !picked.assets?.[0]) return;

      const uri = picked.assets[0].uri;
      if (__DEV__) console.log('[FoodScan] URI seleccionada:', uri);
      setPhotoUri(uri);
      await analyze(uri);
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

    const log = {
      id: Date.now().toString(),
      user_id: profile.user_id,
      logged_at: new Date().toISOString(),
      photo_url: photoUri ?? undefined,
      meal_name: portion !== 1 ? `${scaled.meal_name} (×${portion})` : scaled.meal_name,
      food_description: scaled.food_description,
      calories: scaled.calories,
      protein_g: scaled.protein_g,
      carbs_g: scaled.carbs_g,
      fat_g: scaled.fat_g,
      fiber_g: scaled.fiber_g,
    };

    addFoodLog(log as any);
    track('food_added', { calories: scaled.calories, protein_g: scaled.protein_g, portion });

    supabase.from('food_logs').insert({
      user_id: profile.user_id,
      logged_at: log.logged_at,
      meal_name: log.meal_name,
      food_description: log.food_description,
      photo_url: log.photo_url,
      calories: log.calories,
      protein_g: log.protein_g,
      carbs_g: log.carbs_g,
      fat_g: log.fat_g,
      fiber_g: log.fiber_g,
    }).then(({ error }) => {
      if (error) console.log('[FoodScan] DB error:', error.message);
    });

    // Gamificación: registrar la comida (XP + badges). Si con esta comida se
    // alcanzaron TODAS las metas del día → cuenta como "día perfecto de macros".
    const macroPerfect =
      totals.calories + scaled.calories >= profile.daily_calories &&
      totals.protein_g + scaled.protein_g >= profile.daily_protein_g &&
      totals.carbs_g + scaled.carbs_g >= profile.daily_carbs_g &&
      totals.fat_g + scaled.fat_g >= profile.daily_fat_g;

    recordMealLogged(profile.user_id, macroPerfect)
      .then((r) => {
        if (r.macroDayCounted) {
          track('macro_day_perfect'); // adherencia nutricional total: 1 vez/día
          Notifications.scheduleNotificationAsync({
            content: {
              title: '🎯 ¡Día perfecto de macros!',
              body: 'Cumpliste TODAS tus metas de hoy. +50 XP. Así se construye un físico.',
              sound: 'default',
            },
            trigger: null,
          }).catch(() => {});
        }
      })
      .catch((e) => console.log('[FoodScan] Error gamificación:', e?.message));

    // Notificación según progreso de proteína
    const newProtein = totals.protein_g + scaled.protein_g;
    const pct = (newProtein / Math.max(profile.daily_protein_g, 1)) * 100;

    if (pct >= 100) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🎯 ¡Meta de proteína cumplida!',
          body: 'Hoy hiciste todo bien con la nutrición. Así se construye el físico que quieres.',
          sound: 'default',
        },
        trigger: null,
      });
    } else if (pct >= 80) {
      const remaining = Math.round(profile.daily_protein_g - newProtein);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '💪 Casi llegas a tu meta',
          body: `Te faltan solo ${remaining}g de proteína. Un shake o unos huevos y cierras perfecto.`,
          sound: 'default',
        },
        trigger: null,
      });
    }

    setPhase('added');
  }

  function reset() {
    addingRef.current = false;
    setPhase('intro');
    setPhotoUri(null);
    setResult(null);
    setPortion(1);
  }

  // INTRO
  if (phase === 'intro') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.back} onPress={() => router.back()}>
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
          <TouchableOpacity style={s.primaryBtn} onPress={() => pickPhoto(true)} activeOpacity={0.85}>
            <Text style={s.primaryBtnTxt}>📷  TOMAR FOTO</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => pickPhoto(false)} activeOpacity={0.85}>
            <Text style={s.secondaryBtnTxt}>Elegir de galería</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
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
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.back} onPress={reset}>
            <Text style={s.backTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>RESULTADO</Text>
          <TouchableOpacity onPress={() => pickPhoto(true)}>
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
                  {m.val}<Text style={{ fontSize: 11 }}>{m.unit}</Text>
                </Text>
                <Text style={s.pillLbl}>{m.label}</Text>
              </View>
            ))}
          </View>
          <View style={s.impactCard}>
            <Text style={s.impactTitle}>📊 Impacto en tu día</Text>
            <View style={s.impactRow}>
              <Text style={s.impactLbl}>Total calorías:</Text>
              <Text style={[s.impactVal, { color: remainingCal < 0 ? '#ff7c3a' : Colors.accent }]}>
                {Math.round(newCalories)}/{profile?.daily_calories} kcal
              </Text>
            </View>
            <View style={s.impactRow}>
              <Text style={s.impactLbl}>Total proteína:</Text>
              <Text style={[s.impactVal, { color: Colors.accent }]}>
                {Math.round(newProtein)}/{profile?.daily_protein_g}g
              </Text>
            </View>
            <Text style={s.impactNote}>
              {remainingProtein > 30
                ? `🥩 Aún faltan ${Math.round(remainingProtein)}g de proteína.`
                : remainingProtein > 0
                  ? `🥚 ¡Casi! Solo ${Math.round(remainingProtein)}g más.`
                  : remainingCal < -300
                    ? '⚠️ Ya superaste las calorías del día.'
                    : '✅ ¡Vas perfecto con tus macros!'}
            </Text>
          </View>
          <TouchableOpacity style={s.primaryBtn} onPress={addToDay} activeOpacity={0.85}>
            <Text style={s.primaryBtnTxt}>+ AGREGAR A MI DÍA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={reset} activeOpacity={0.85}>
            <Text style={s.secondaryBtnTxt}>Descartar</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
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
          {pct >= 100 ? ' 🎯 ¡Meta cumplida!' : ` Faltan ${100 - pct}%.`}
        </Text>
        <TouchableOpacity
          style={[s.primaryBtn, { width: '100%', marginTop: Spacing.xl }]}
          onPress={() => router.replace('/(tabs)' as any)}
          activeOpacity={0.85}
        >
          <Text style={s.primaryBtnTxt}>VER MI PROGRESO →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.secondaryBtn, { width: '100%' }]}
          onPress={reset}
          activeOpacity={0.85}
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
  daySummaryTitle: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  macroRow: { flexDirection: 'row', gap: 8 },
  portionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  portionLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textSecondary },
  portionChips: { flexDirection: 'row', gap: 6 },
  portionChip: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 6, minWidth: 44, alignItems: 'center' },
  portionChipSel: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  portionChipTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textSecondary },
  macroCell: { flex: 1, alignItems: 'center' },
  macroCellVal: { fontFamily: Fonts.headingBold, fontSize: 18 },
  macroCellLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginBottom: 4 },
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
  pillLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  impactCard: { backgroundColor: Colors.accentMuted, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: Spacing.lg },
  impactTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent, marginBottom: 10 },
  impactRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  impactLbl: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary },
  impactVal: { fontFamily: Fonts.bodyMedium, fontSize: 13 },
  impactNote: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.accentBorder, paddingTop: 8 },
});