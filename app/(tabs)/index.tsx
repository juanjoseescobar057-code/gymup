import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';
import { fetchCoachSnapshot } from '../../lib/coachContext';
import { getProactiveInsight } from '../../lib/coachChat';
import { loadCoachMemory } from '../../lib/coachMemory';
import { checkPremium } from '../../lib/purchases';
import { isPlanStaleForHealth } from '../../lib/health';
import { fetchTodayFoodLogs, localDateKey } from '../../lib/foodLogs';
import { getWaterCount, addWater, WATER_GOAL } from '../../lib/water';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';

function CalorieRing({ consumed, target }: { consumed: number; target: number }) {
  const size = 120;
  const sw = 9;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(consumed / Math.max(target, 1), 1);
  const offset = circ * (1 - pct);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke={Colors.border} strokeWidth={sw} fill="none" />
        <Circle cx={size/2} cy={size/2} r={r} stroke={Colors.accent} strokeWidth={sw} fill="none"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={s.ringKcal}>{Math.round(consumed).toLocaleString()}</Text>
          <Text style={s.ringLbl}>de {target.toLocaleString()} kcal</Text>
        </View>
      </View>
    </View>
  );
}

function MacroBar({ name, consumed, target, color }: {
  name: string; consumed: number; target: number; color: string;
}) {
  const pct = Math.min((consumed / Math.max(target, 1)) * 100, 100);
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={s.macroName}>{name}</Text>
        <Text style={s.macroVal}>{Math.round(consumed)}<Text style={s.macroTotal}>/{target}g</Text></Text>
      </View>
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);
  // Suscribirse a todayFoodLogs para que los totales se recalculen al cambiar.
  const todayFoodLogs = useUserStore((s: any) => s.todayFoodLogs);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setProfile = useUserStore((s: any) => s.setProfile);
  const hydrateTodayLogs = useUserStore((s: any) => s.hydrateTodayLogs);
  const loadedDate = useUserStore((s: any) => s.loadedDate);

  const [aiSuggestion, setAiSuggestion] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [water, setWater] = useState(0);
  // Plan generado ANTES del último cambio de salud → recordatorio persistente.
  const [planStale, setPlanStale] = useState(false);

  useEffect(() => {
    getWaterCount().then(setWater).catch(() => {});
  }, []);

  async function tapCup(index: number) {
    // Tocar el vaso N: si ya está lleno hasta ahí, vacía uno; si no, llena hasta N.
    const target = index + 1 === water ? water - 1 : index + 1;
    const next = await addWater(target - water);
    setWater(next);
  }
  const [monthStats, setMonthStats] = useState({
    thisMonth: 0, lastMonth: 0, thisDays: 0, lastDays: 0,
  });

  // Recalcula cuando cambian los logs del día (reactivo).
  const totals = useMemo(() => getDailyTotals(), [todayFoodLogs, getDailyTotals]);

  // Día actual del plan — basado en progreso real del usuario
  const todayIndex = Math.min(profile?.current_plan_day ?? 0, 6);
  const todayPlan = trainingPlan?.plan_data?.days?.[todayIndex];

  useEffect(() => {
    if (profile) loadAll();
    // Re-sincronizar el entitlement Premium con la tienda (no-op sin rebuild).
    checkPremium();
  }, [profile?.user_id]);

  // Recheck del flag de plan obsoleto cada vez que el dashboard gana foco
  // (el usuario pudo editar su salud y elegir "Después").
  useFocusEffect(
    useCallback(() => {
      if (profile) isPlanStaleForHealth(profile.user_id).then(setPlanStale).catch(() => {});
    }, [profile?.user_id])
  );

  async function loadAll() {
    if (!profile) return;

    // Cargar plan desde Supabase
    const { data: plan } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', profile.user_id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (plan) setTrainingPlan(plan);

    // Recargar food_logs de hoy si cambió el día (rollover) o si aún no se cargaron.
    const todayKey = localDateKey();
    if (loadedDate !== todayKey) {
      const todayLogs = await fetchTodayFoodLogs(profile.user_id);
      hydrateTodayLogs(todayLogs, todayKey);
    }

    // Actualizar fecha de último acceso
    const today = new Date().toISOString().split('T')[0];
    if (profile.last_active_date !== today) {
      const { data: updatedProfile } = await supabase
        .from('user_profiles')
        .update({ last_active_date: today })
        .eq('user_id', profile.user_id)
        .select()
        .single();
      if (updatedProfile) setProfile(updatedProfile);
    }

    await Promise.all([loadMonthStats(), loadSuggestion(false)]);
  }

  async function loadMonthStats() {
    if (!profile) return;
    const now = new Date();
    const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    const [thisRes, lastRes] = await Promise.all([
      supabase.from('workout_sessions').select('duration_min')
        .eq('user_id', profile.user_id)
        .gte('started_at', thisStart)
        .not('completed_at', 'is', null),
      // Mes pasado = [inicio mes pasado, inicio de este mes). El límite
      // exclusivo evita el hueco del último día que dejaba .lte(lastEnd).
      supabase.from('workout_sessions').select('duration_min')
        .eq('user_id', profile.user_id)
        .gte('started_at', lastStart)
        .lt('started_at', thisStart)
        .not('completed_at', 'is', null),
    ]);

    const calc = (rows: any[]) => ({
      mins: rows.reduce((acc, r) => acc + (r.duration_min || 0), 0),
      days: rows.length,
    });

    const th = calc(thisRes.data ?? []);
    const la = calc(lastRes.data ?? []);
    setMonthStats({
      thisMonth: th.mins, lastMonth: la.mins,
      thisDays: th.days, lastDays: la.days,
    });
  }

  // Mensaje PROACTIVO del coach: le pasamos la ficha completa (plan de hoy,
  // macros, racha, PRs, proyección de meta) y él te escribe primero. Cacheado
  // por franja (mañana/tarde-noche) para gastar máximo 2 llamadas de IA al día.
  async function loadSuggestion(force: boolean) {
    if (!profile) return;
    const slot = new Date().getHours() < 15 ? 'am' : 'pm';
    const cacheKey = `gymup_coach_insight_${profile.user_id}_${localDateKey()}_${slot}`;

    if (!force) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) { setAiSuggestion(cached); return; }
      } catch {}
    }

    try {
      // Plan FRESCO desde el store (loadAll pudo actualizarlo hace un instante;
      // la variable del closure estaría desactualizada).
      const [snap, memory] = await Promise.all([
        fetchCoachSnapshot({
          profile,
          trainingPlan: useUserStore.getState().trainingPlan,
          todayTotals: getDailyTotals(),
          todayMeals: (useUserStore.getState().todayFoodLogs ?? []).map((l: any) => ({
            name: l.meal_name,
            calories: l.calories,
          })),
        }),
        loadCoachMemory(profile.user_id),
      ]);
      const insight = await getProactiveInsight(snap, memory);
      setAiSuggestion(insight);
      AsyncStorage.setItem(cacheKey, insight).catch(() => {});
    } catch {
      setAiSuggestion('Aquí estoy cuando me necesites. Tócame y pregúntame lo que quieras 💬');
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // loadAll ya incluye loadSuggestion(false); no forzamos una llamada IA
    // extra por cada swipe (gastaba cupo del plan free sin necesidad).
    await loadAll();
    getWaterCount().then(setWater).catch(() => {});
    setRefreshing(false);
  }, [profile?.user_id]);

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días,' : hour < 18 ? 'Buenas tardes,' : 'Buenas noches,';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>{greeting}</Text>
            {/* El apodo primero: la app te llama como TÚ quieres */}
            <Text style={s.userName}>{(profile.nickname || profile.name || '').toUpperCase()} 💪</Text>
          </View>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{(profile.nickname || profile.name)?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        </View>

        {/* Macros del día */}
        <View style={s.macroCard}>
          <CalorieRing consumed={totals.calories} target={profile.daily_calories} />
          <View style={{ flex: 1 }}>
            <MacroBar name="Proteína" consumed={totals.protein_g} target={profile.daily_protein_g} color={Colors.macroProtein} />
            <MacroBar name="Carbos" consumed={totals.carbs_g} target={profile.daily_carbs_g} color={Colors.macroCarbs} />
            <MacroBar name="Grasa" consumed={totals.fat_g} target={profile.daily_fat_g} color={Colors.macroFat} />
          </View>
        </View>

        {/* Hidratación */}
        <View style={s.waterCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={s.waterTitle}>💧 HIDRATACIÓN</Text>
            <Text style={s.waterCount}>{water}/{WATER_GOAL} vasos</Text>
          </View>
          <View style={s.waterRow}>
            {Array.from({ length: WATER_GOAL }).map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => tapCup(i)}
                style={s.waterCup}
                accessibilityLabel={`Vaso de agua ${i + 1}`}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 22, opacity: i < water ? 1 : 0.22 }}>💧</Text>
              </TouchableOpacity>
            ))}
          </View>
          {water >= WATER_GOAL && (
            <Text style={s.waterDone}>✅ Meta de hidratación cumplida</Text>
          )}
        </View>

        {/* Comparativas del mes */}
        <Text style={s.sectionLbl}>ESTE MES VS MES ANTERIOR</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 10, marginBottom: 8 }}>
          {[
            { icon: '⏱️', label: 'Minutos', val: monthStats.thisMonth, prev: monthStats.lastMonth, unit: 'min' },
            { icon: '🏋️', label: 'Sesiones', val: monthStats.thisDays, prev: monthStats.lastDays, unit: 'días' },
            { icon: '🔥', label: 'Horas', val: Math.round(monthStats.thisMonth / 60), prev: Math.round(monthStats.lastMonth / 60), unit: 'hrs' },
          ].map((item) => {
            const diff = item.val - item.prev;
            const pct = item.prev > 0 ? Math.round(Math.abs(diff / item.prev) * 100) : 0;
            const good = diff >= 0;
            return (
              <View key={item.label} style={s.compareCard}>
                <Text style={s.compareIcon}>{item.icon}</Text>
                <Text style={s.compareLabel}>{item.label}</Text>
                <Text style={s.compareVal}>{item.val}<Text style={s.compareUnit}> {item.unit}</Text></Text>
                <View style={[s.compareBadge, { backgroundColor: good ? Colors.accentMuted : 'rgba(255,124,58,0.1)' }]}>
                  <Text style={[s.compareDiff, { color: good ? Colors.accent : '#ff7c3a' }]}>
                    {diff >= 0 ? '↑' : '↓'} {pct}%
                  </Text>
                </View>
                <Text style={s.compareVs}>vs mes pasado</Text>
              </View>
            );
          })}
        </ScrollView>

        {/* Indicador de día del plan */}
        <View style={s.planDayRow}>
          <Text style={s.sectionLbl}>
             DÍA {todayIndex + 1} DE 7 · {new Date().toLocaleDateString('es-CO', { weekday: 'long' }).toUpperCase()}
          </Text>
          <View style={s.planDots}>
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={i} style={[
                s.planDot,
                i < todayIndex && s.planDotDone,
                i === todayIndex && s.planDotCurrent,
              ]} />
            ))}
          </View>
        </View>

        {/* Plan obsoleto respecto a la salud: recordatorio persistente */}
        {planStale && (
          <TouchableOpacity
            style={s.staleCard}
            onPress={() => router.push('/(tabs)/profile' as any)}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 20 }}>🩺</Text>
            <Text style={s.staleTxt}>
              Tu plan no incluye tu último cambio de salud. Toca para ajustarlo con la IA
              (Perfil → Ajustar mi plan).
            </Text>
          </TouchableOpacity>
        )}

        {/* Workout */}
        {todayPlan?.type === 'workout' && (
          <View style={s.workoutCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <View>
                <Text style={s.workoutTitle}>{todayPlan.muscle_groups?.join(' + ')}</Text>
                <Text style={s.workoutMeta}>
                  {todayPlan.exercises?.length} ejercicios · ~{todayPlan.estimated_duration_min} min
                </Text>
              </View>
              <View style={s.durationBadge}>
                <Text style={s.durationTxt}>{todayPlan.estimated_duration_min}'</Text>
              </View>
            </View>
            {todayPlan.exercises?.slice(0, 3).map((ex: any, i: number) => (
              <View key={i} style={s.exRow}>
                <View style={s.exNum}><Text style={s.exNumTxt}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.exName}>{ex.name}</Text>
                  <Text style={s.exMeta}>{ex.sets} × {ex.reps} · {ex.rest_seconds}s descanso</Text>
                </View>
              </View>
            ))}
            {(todayPlan.exercises?.length ?? 0) > 3 && (
              <Text style={s.moreEx}>+ {todayPlan.exercises.length - 3} ejercicios más</Text>
            )}
            <TouchableOpacity style={s.startBtn}
              onPress={() => router.push('/workout-session' as any)} activeOpacity={0.85}>
              <Text style={s.startBtnTxt}>▶  INICIAR ENTRENAMIENTO</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/exercises' as any)} activeOpacity={0.7}>
              <Text style={s.libraryLink}>📚 Ver biblioteca de ejercicios</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Descanso */}
        {todayPlan?.type === 'rest' && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>😴</Text>
            <Text style={s.restTitle}>Día de descanso</Text>
            <Text style={s.restDesc}>Tu cuerpo crece cuando descansa. Hoy es tan importante como entrenar.</Text>
          </View>
        )}

        {/* Recuperación activa */}
        {todayPlan?.type === 'active_recovery' && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🧘</Text>
            <Text style={s.restTitle}>Recuperación activa</Text>
            <Text style={s.restDesc}>
              {todayPlan.notes ?? 'Día de movilidad y flexibilidad.'}
              {todayPlan.activities?.length ? '\n\n' + todayPlan.activities.join(' · ') : ''}
            </Text>
          </View>
        )}

        {/* Sin plan */}
        {!todayPlan && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
            <Text style={s.restTitle}>Cargando tu plan...</Text>
            <Text style={s.restDesc}>Desliza hacia abajo para refrescar.</Text>
          </View>
        )}

        {/* Tu coach IA te escribe primero — tocar abre el chat */}
        <TouchableOpacity
          style={s.aiCard}
          onPress={() => router.push('/coach-chat' as any)}
          activeOpacity={0.85}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={s.aiDot} />
            <Text style={s.aiLbl}>TU COACH IA</Text>
            <Text style={[s.aiLbl, { marginLeft: 'auto' }]}>💬</Text>
          </View>
          <Text style={s.aiTxt}>{aiSuggestion || 'Cargando a tu coach...'}</Text>
          <Text style={s.aiCta}>Respóndele o pregúntale lo que quieras →</Text>
        </TouchableOpacity>

        {/* Accesos rápidos */}
        <View style={s.quickRow}>
          <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/food-scan' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 24 }}>🍽️</Text>
            <Text style={s.quickLbl}>Escanear comida</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/fridge-scan' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 24 }}>🧊</Text>
            <Text style={s.quickLbl}>Escanear nevera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/body-scan' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 24 }}>💪</Text>
            <Text style={s.quickLbl}>Escanear cuerpo</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  greeting: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  userName: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.textPrimary, marginTop: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b' },
  macroCard: { marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.xl, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  ringKcal: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  ringLbl: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textMuted, textAlign: 'center' },
  macroName: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.textSecondary },
  macroVal: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textPrimary },
  macroTotal: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  barBg: { height: 5, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 10 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: Spacing.lg, marginBottom: 10, marginTop: 4 },
  waterCard: { marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.xl, padding: Spacing.md },
  waterTitle: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 0.6 },
  waterCount: { fontFamily: Fonts.headingSemi, fontSize: 14, color: Colors.macroCarbs },
  waterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  waterCup: { padding: 4 },
  waterDone: { fontFamily: Fonts.body, fontSize: 11, color: Colors.accent, marginTop: 6, textAlign: 'center' },
  planDayRow: { marginHorizontal: Spacing.lg, marginBottom: 12 },
  planDots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  planDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  planDotDone: { backgroundColor: Colors.accentDark },
  planDotCurrent: { backgroundColor: Colors.accent, width: 40 },
  compareCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, width: 120, alignItems: 'center', gap: 4 },
  compareIcon: { fontSize: 24 },
  compareLabel: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  compareVal: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary },
  compareUnit: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  compareBadge: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3 },
  compareDiff: { fontFamily: Fonts.bodySemi, fontSize: 11 },
  compareVs: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textMuted },
  workoutCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  workoutTitle: { fontFamily: Fonts.headingBold, fontSize: 20, color: Colors.textPrimary },
  workoutMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  durationBadge: { backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
  durationTxt: { fontFamily: Fonts.headingBold, fontSize: 20, color: Colors.accent },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  exNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  exNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textMuted },
  exName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  exMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  moreEx: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  startBtn: { backgroundColor: Colors.accent, borderRadius: Radii.md, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.md },
  startBtnTxt: { fontFamily: Fonts.heading, fontSize: 17, color: '#0a0a0b', letterSpacing: 0.8 },
  libraryLink: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 10, textDecorationLine: 'underline' },
  restCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, padding: Spacing.xl, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  restTitle: { fontFamily: Fonts.headingBold, fontSize: 22, color: Colors.textPrimary, marginBottom: 8 },
  restDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.xl, padding: Spacing.md, marginBottom: 12 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  aiLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, letterSpacing: 0.8 },
  aiTxt: { fontFamily: Fonts.body, fontSize: 13, color: '#ccc', lineHeight: 20 },
  aiCta: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.accent, marginTop: 10 },
  staleCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: 'rgba(255,157,58,0.08)', borderWidth: 1, borderColor: 'rgba(255,157,58,0.35)', borderRadius: Radii.lg, padding: Spacing.md },
  staleTxt: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.warning, lineHeight: 18 },
  quickRow: { flexDirection: 'row', gap: 8, marginHorizontal: Spacing.lg, marginBottom: 12 },
  quickBtn: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: 12, alignItems: 'center', gap: 6 },
  quickLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center' },
});