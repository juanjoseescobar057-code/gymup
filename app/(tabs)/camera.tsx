// app/(tabs)/camera.tsx
// Hub central de escaneo con 3 modos

import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserStore } from '../../store/userStore';
import { FREE_LIMITS } from '../../lib/subscription';
import { localDateKey } from '../../lib/foodLogs';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';

const SCAN_OPTIONS = [
  {
    id: 'food',
    emoji: '🍽️',
    title: 'Escanear comida',
    desc: 'Fotografía tu plato y suma los macros al día',
    route: '/food-scan',
    accent: Colors.accent,
    limit: FREE_LIMITS.foodScansPerDay,
    counterKey: 'gymup_foodscan',
  },
  {
    id: 'fridge',
    emoji: '🧊',
    title: 'Escanear nevera',
    desc: 'Analiza tus ingredientes y obtén recetas para tu objetivo',
    route: '/fridge-scan',
    accent: '#3ab8ff',
    limit: FREE_LIMITS.fridgeScansPerDay,
    counterKey: 'gymup_fridge',
  },
  {
    id: 'body',
    emoji: '💪',
    title: 'Análisis corporal',
    desc: 'Fotos de frente, lateral y espalda — seguimiento de progreso',
    route: '/body-scan',
    accent: '#9b6fff',
    limit: 0,             // premium-only
    counterKey: null,
  },
];

export default function CameraScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);
  // Suscripción a los logs del día: sin esto el hub nunca re-renderiza al
  // agregar una comida y "Progreso de hoy" queda congelado.
  const todayFoodLogs = useUserStore((s: any) => s.todayFoodLogs);
  const totals = getDailyTotals();
  const isPremium = !!profile?.is_premium;

  // Cupo usado hoy por escáner (AsyncStorage). Se refresca al volver a la
  // pestaña, porque el usuario regresa del escáner con un uso menos.
  const [used, setUsed] = useState<Record<string, number>>({});
  useFocusEffect(
    useCallback(() => {
      if (isPremium) return;
      const day = localDateKey();
      Promise.all(
        SCAN_OPTIONS.filter((o) => o.counterKey).map(async (o) => {
          const raw = await AsyncStorage.getItem(`${o.counterKey}_${day}`);
          return [o.id, parseInt(raw ?? '0', 10) || 0] as const;
        })
      ).then((pairs) => setUsed(Object.fromEntries(pairs)));
    }, [isPremium])
  );

  const calPct = Math.min(Math.round((totals.calories / Math.max(profile?.daily_calories ?? 1, 1)) * 100), 100);
  const protPct = Math.min(Math.round((totals.protein_g / Math.max(profile?.daily_protein_g ?? 1, 1)) * 100), 100);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>ESCANEAR</Text>
        <Text style={s.headerSub}>Elige qué quieres analizar hoy</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.lg }}>

        {/* Resumen rápido del día */}
        {profile && (
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>PROGRESO DE HOY</Text>
            <View style={s.summaryRow}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryVal, { color: Colors.accent }]}>{Math.round(totals.calories)}</Text>
                <Text style={s.summaryLbl}>/ {profile.daily_calories} kcal</Text>
                <View style={s.summaryBar}>
                  <View style={[s.summaryBarFill, { width: `${calPct}%`, backgroundColor: Colors.accent }]} />
                </View>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryItem}>
                <Text style={[s.summaryVal, { color: Colors.macroProtein }]}>{Math.round(totals.protein_g)}g</Text>
                <Text style={s.summaryLbl}>/ {profile.daily_protein_g}g proteína</Text>
                <View style={s.summaryBar}>
                  <View style={[s.summaryBarFill, { width: `${protPct}%`, backgroundColor: Colors.macroProtein }]} />
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Opciones de escáner */}
        {SCAN_OPTIONS.map((opt) => {
          // Chip de cupo (solo usuarios free).
          let chip: { txt: string; warn: boolean } | null = null;
          if (!isPremium) {
            if (opt.counterKey) {
              const remaining = Math.max(0, opt.limit - (used[opt.id] ?? 0));
              chip = remaining > 0
                ? { txt: `Te queda${remaining === 1 ? '' : 'n'} ${remaining} hoy`, warn: false }
                : { txt: 'Sin usos hoy', warn: true };
            } else {
              chip = { txt: '✦ Premium', warn: false };
            }
          }
          return (
            <TouchableOpacity
              key={opt.id}
              style={s.optionCard}
              onPress={() => router.push(opt.route as any)}
              activeOpacity={0.85}
            >
              <View style={[s.optionIconWrap, { backgroundColor: opt.accent + '18' }]}>
                <Text style={{ fontSize: 36 }}>{opt.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={s.optionTitle}>{opt.title}</Text>
                  {chip && (
                    <View style={[s.chip, chip.warn && s.chipWarn]}>
                      <Text style={[s.chipTxt, chip.warn && { color: '#ff9d3a' }]}>{chip.txt}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.optionDesc}>{opt.desc}</Text>
              </View>
              <View style={[s.optionArrow, { borderColor: opt.accent }]}>
                <Text style={[s.optionArrowTxt, { color: opt.accent }]}>›</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Tip del día */}
        <View style={s.tipCard}>
          <View style={s.aiDotRow}>
            <View style={s.aiDot} />
            <Text style={s.aiDotLbl}>CONSEJO DEL DÍA</Text>
          </View>
          <Text style={s.tipTxt}>
            {protPct >= 100
              ? '🎯 ¡Meta de proteína cumplida hoy! Tus músculos lo agradecerán esta noche mientras duermes.'
              : protPct >= 80
                ? `💪 Llevas el ${protPct}% de proteína. Un shake o pechuga de pollo y cierras la meta.`
                : calPct >= 90
                  ? '⚠️ Estás cerca del límite de calorías. Prioriza proteína magra si vas a comer más.'
                  : `📊 Llevas ${Math.round(totals.calories)} kcal y ${Math.round(totals.protein_g)}g de proteína. Escanea tu próxima comida.`}
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.textPrimary },
  headerSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  summaryCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20 },
  summaryTitle: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, letterSpacing: 0.8, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1 },
  summaryVal: { fontFamily: Fonts.heading, fontSize: 28 },
  summaryLbl: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginBottom: 6 },
  summaryBar: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  summaryBarFill: { height: '100%', borderRadius: 2 },
  summaryDivider: { width: 1, height: 48, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  optionIconWrap: { width: 68, height: 68, borderRadius: Radii.lg, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary, marginBottom: 4 },
  chip: { backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  chipWarn: { backgroundColor: 'rgba(255,157,58,0.1)', borderColor: 'rgba(255,157,58,0.3)' },
  chipTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent },
  optionDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  optionArrow: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionArrowTxt: { fontFamily: Fonts.heading, fontSize: 22 },
  tipCard: { backgroundColor: Colors.bgSelected, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md },
  aiDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  aiDotLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, letterSpacing: 0.8 },
  tipTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
});