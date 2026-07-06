// app/fridge-scan.tsx
// ─────────────────────────────────────────────────────────
// Escaneo de nevera:
//   1. Instrucciones + tomar foto de la nevera
//   2. IA detecta ingredientes y genera recetas
//   3. Resultados: score nevera, ingredientes, 3 recetas
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyzeFridgePhoto } from '../lib/openai-features';
import { canUseFeature } from '../lib/subscription';
import { localDateKey } from '../lib/foodLogs';
import { useUserStore } from '../store/userStore';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';
import type { FridgeAnalysis, Recipe } from '../lib/openai-features';

function QualityBar({ score }: { score: number }) {
  const color = score >= 75 ? Colors.accent : score >= 50 ? '#ff9d3a' : '#ff4444';
  const label = score >= 75 ? '🟢 Nevera sana' : score >= 50 ? '🟡 Puede mejorar' : '🔴 Necesita atención';
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 13, color }}>{label}</Text>
        <Text style={{ fontFamily: Fonts.heading, fontSize: 22, color }}>{score}/100</Text>
      </View>
      <View style={{ height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${score}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

function RecipeCard({ recipe, goal }: { recipe: Recipe; goal: string }) {
  const [expanded, setExpanded] = useState(false);
  const alignColor = recipe.goal_alignment >= 80 ? Colors.accent : '#ff9d3a';

  return (
    <TouchableOpacity style={s.recipeCard} onPress={() => setExpanded(!expanded)} activeOpacity={0.85}>
      <View style={s.recipeHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.recipeName}>{recipe.name}</Text>
          <Text style={s.recipeDesc}>{recipe.description}</Text>
        </View>
        <View style={[s.alignBadge, { backgroundColor: alignColor + '20' }]}>
          <Text style={[s.alignTxt, { color: alignColor }]}>{recipe.goal_alignment}%</Text>
          <Text style={[s.alignLbl, { color: alignColor }]}>fit</Text>
        </View>
      </View>

      <View style={s.recipeMeta}>
        <Text style={s.recipeMetaItem}>⏱ {recipe.prep_time_min + recipe.cook_time_min} min</Text>
        <Text style={s.recipeMetaItem}>👥 {recipe.servings} porciones</Text>
        <Text style={s.recipeMetaItem}>🔥 {recipe.calories_per_serving} kcal</Text>
      </View>

      <View style={s.recipeMacros}>
        {[
          { label: 'Proteína', val: recipe.protein_g, color: Colors.accent },
          { label: 'Carbos',   val: recipe.carbs_g,   color: Colors.macroCarbs },
          { label: 'Grasa',    val: recipe.fat_g,     color: Colors.macroFat },
        ].map((m) => (
          <View key={m.label} style={s.recipeMacroPill}>
            <Text style={[s.recipeMacroVal, { color: m.color }]}>{m.val}g</Text>
            <Text style={s.recipeMacroLbl}>{m.label}</Text>
          </View>
        ))}
      </View>

      {expanded && (
        <View style={s.recipeExpanded}>
          <Text style={s.recipeStepsTitle}>📝 Preparación</Text>
          {recipe.steps.map((step, i) => (
            <View key={i} style={s.recipeStep}>
              <View style={s.stepNum}><Text style={s.stepNumTxt}>{i + 1}</Text></View>
              <Text style={s.stepTxt}>{step}</Text>
            </View>
          ))}
          {recipe.missing_ingredients.length > 0 && (
            <View style={s.missingBox}>
              <Text style={s.missingTitle}>🛒 Comprar</Text>
              <Text style={s.missingTxt}>{recipe.missing_ingredients.join(', ')}</Text>
            </View>
          )}
          <View style={s.tipBox}>
            <Text style={s.tipTitle}>💡 Tip del chef</Text>
            <Text style={s.tipTxt}>{recipe.tip}</Text>
          </View>
        </View>
      )}

      <Text style={s.expandHint}>{expanded ? '▲ Cerrar' : '▼ Ver receta completa'}</Text>
    </TouchableOpacity>
  );
}

export default function FridgeScanScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const [phase, setPhase] = useState<'intro' | 'analyzing' | 'result'>('intro');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<FridgeAnalysis | null>(null);

  async function pickPhoto(fromCamera: boolean) {
    try {
      // Gating freemium (tope diario). Solo VERIFICAMOS aquí; el cupo se
      // consume al completar el análisis con éxito (cancelar la cámara o un
      // fallo de red no deben quemar el único escaneo free del día).
      if (!profile?.is_premium) {
        const key = `gymup_fridge_${localDateKey()}`;
        const used = parseInt((await AsyncStorage.getItem(key)) ?? '0', 10);
        const gate = canUseFeature('fridge_scan', false, used);
        if (!gate.allowed) {
          track('quota_hit', { feature: 'fridge_scan' });
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
        ? await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, mediaTypes: ['images'] });

      if (picked.canceled || !picked.assets?.[0]) return;

      const uri = picked.assets[0].uri;
      setPhotoUri(uri);
      await analyze(uri);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  async function analyze(uri: string) {
    if (!profile) return;
    setPhase('analyzing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await analyzeFridgePhoto(uri, {
        goal: profile.goal,
        daily_calories: profile.daily_calories,
        daily_protein_g: profile.daily_protein_g,
        daily_carbs_g: profile.daily_carbs_g,
        daily_fat_g: profile.daily_fat_g,
      });
      setResult(data);
      setPhase('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Consumir el cupo diario SOLO tras un análisis exitoso.
      if (!profile.is_premium) {
        const key = `gymup_fridge_${localDateKey()}`;
        const used = parseInt((await AsyncStorage.getItem(key)) ?? '0', 10);
        AsyncStorage.setItem(key, String(used + 1)).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Error en el análisis', e.message);
      setPhase('intro');
    }
  }

  // INTRO
  if (phase === 'intro') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>ESCANEAR NEVERA</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <View style={s.hero}>
            <Text style={{ fontSize: 80 }}>🧊</Text>
            <Text style={s.heroTitle}>¿Qué hay en tu{'\n'}<Text style={{ color: Colors.accent }}>nevera?</Text></Text>
            <Text style={s.heroSub}>
              La IA analiza tus ingredientes y genera 3 recetas optimizadas para tu objetivo de{' '}
              <Text style={{ color: Colors.accent, fontFamily: Fonts.bodySemi }}>
                {profile?.goal === 'muscle_gain' ? 'ganar músculo' :
                 profile?.goal === 'fat_loss' ? 'perder grasa' :
                 profile?.goal === 'performance' ? 'rendimiento' : 'resistencia'}
              </Text>.
            </Text>
          </View>

          <View style={s.featureCard}>
            {[
              { icon: '🔍', txt: 'Detecta todos los ingredientes visibles' },
              { icon: '📊', txt: 'Evalúa qué tan saludable está tu nevera' },
              { icon: '👨‍🍳', txt: 'Genera 3 recetas con lo que tienes' },
              { icon: '🛒', txt: 'Te dice qué falta comprar' },
            ].map((f, i) => (
              <View key={i} style={s.featureRow}>
                <Text style={{ fontSize: 20 }}>{f.icon}</Text>
                <Text style={s.featureTxt}>{f.txt}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={s.primaryBtn} onPress={() => pickPhoto(true)} activeOpacity={0.85}>
            <Text style={s.primaryBtnTxt}>📷  FOTOGRAFIAR NEVERA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => pickPhoto(false)} activeOpacity={0.85}>
            <Text style={s.secondaryBtnTxt}>Elegir foto de galería</Text>
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
          <Text style={s.analyzingTitle}>Analizando tu nevera</Text>
          <Text style={s.analyzingMsg}>
            GPT-4o está identificando ingredientes{'\n'}y creando recetas para tu objetivo...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // RESULTADO
  if (phase === 'result' && result) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.nav}>
          <TouchableOpacity style={s.backBtn} onPress={() => { setPhase('intro'); setPhotoUri(null); setResult(null); }}>
            <Text style={s.backBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.navTitle}>RESULTADO</Text>
          <TouchableOpacity onPress={() => pickPhoto(true)}>
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>Nuevo scan</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.lg }}>

          {/* Foto */}
          {photoUri && <Image source={{ uri: photoUri }} style={s.resultPhoto} />}

          {/* Calidad de la nevera */}
          <QualityBar score={result.quality_score} />
          <Text style={s.qualityMsg}>{result.quality_message}</Text>

          {/* Ingredientes detectados */}
          <Text style={s.sectionLbl}>🔍 INGREDIENTES DETECTADOS · {result.detected_ingredients.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
            {result.detected_ingredients.map((ing, i) => (
              <View key={i} style={s.ingredientChip}>
                <Text style={s.ingredientName}>{ing.name}</Text>
                <Text style={s.ingredientQty}>{ing.estimated_quantity}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Recetas */}
          <Text style={s.sectionLbl}>👨‍🍳 RECETAS PARA TU OBJETIVO</Text>
          {result.recipes.map((recipe, i) => (
            <RecipeCard key={i} recipe={recipe} goal={profile?.goal ?? 'muscle_gain'} />
          ))}

          {/* Qué comprar */}
          <Text style={s.sectionLbl}>🛒 QUÉ COMPRAR ESTA SEMANA</Text>
          <View style={s.shoppingCard}>
            <Text style={s.shoppingTxt}>{result.shopping_suggestion}</Text>
          </View>

          <TouchableOpacity style={s.primaryBtn} onPress={() => pickPhoto(true)} activeOpacity={0.85}>
            <Text style={s.primaryBtnTxt}>📷  ESCANEAR DE NUEVO</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => router.replace('/(tabs)' as any)} activeOpacity={0.85}>
            <Text style={s.secondaryBtnTxt}>Volver al inicio</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  secondaryBtn: { borderRadius: Radii.lg, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary },
  hero: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 12 },
  heroTitle: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.textPrimary, textAlign: 'center', lineHeight: 42 },
  heroSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  featureCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20, gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureTxt: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary },
  analyzingBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.12 },
  analyzingBox: { alignItems: 'center', backgroundColor: 'rgba(14,14,16,0.96)', borderRadius: Radii.xl, padding: Spacing.xl, borderWidth: 1, borderColor: Colors.border, marginHorizontal: Spacing.lg },
  analyzingTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, marginTop: 16, marginBottom: 8 },
  analyzingMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  resultPhoto: { width: '100%', height: 200, borderRadius: Radii.xl, marginBottom: 16 },
  qualityMsg: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12, marginTop: 4 },
  ingredientChip: { backgroundColor: Colors.bgCard, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, padding: 10, minWidth: 100 },
  ingredientName: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.textPrimary, marginBottom: 2 },
  ingredientQty: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  recipeCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  recipeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  recipeName: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.textPrimary, marginBottom: 4 },
  recipeDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  alignBadge: { borderRadius: Radii.md, padding: 8, alignItems: 'center', minWidth: 48 },
  alignTxt: { fontFamily: Fonts.heading, fontSize: 22 },
  alignLbl: { fontFamily: Fonts.body, fontSize: 9 },
  recipeMeta: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  recipeMetaItem: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  recipeMacros: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  recipeMacroPill: { flex: 1, backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 8, alignItems: 'center' },
  recipeMacroVal: { fontFamily: Fonts.headingBold, fontSize: 18 },
  recipeMacroLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  recipeExpanded: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12, marginTop: 4 },
  recipeStepsTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textPrimary, marginBottom: 10 },
  recipeStep: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  stepNum: { width: 24, height: 24, borderRadius: 6, backgroundColor: Colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 12, color: Colors.accent },
  stepTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 19 },
  missingBox: { backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 10, marginTop: 8 },
  missingTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textPrimary, marginBottom: 4 },
  missingTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  tipBox: { backgroundColor: Colors.accentMuted, borderRadius: Radii.md, padding: 10, marginTop: 8 },
  tipTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent, marginBottom: 4 },
  tipTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  expandHint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 8 },
  shoppingCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  shoppingTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
});