import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
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
import { loadUserStats } from '../../lib/streaks';
import HelpButton from '../../Components/HelpButton';
import OfflineBanner from '../../Components/OfflineBanner';
import { generateFirstPlan } from '../../lib/adaptivePlan';
import { captureError } from '../../lib/monitoring';
import { track } from '../../lib/analytics';
import { getWaterCount, addWater, WATER_GOAL } from '../../lib/water';
import { AVISO_RECUPERACION } from '../../lib/recoveryMode';
import { calcularDiaDeHoy, type EstadoDelDia } from '../../lib/diaDeHoy';
import { mensajeDeRegreso } from '../../lib/motivacion';
import { consejosGratisDeHoy, type ConsejoCoach } from '../../lib/consejosGratis';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../../constants/theme';
import { useRecuperacion } from '../../lib/useRecuperacion';
import AvisoReconsentimiento from '../../Components/AvisoReconsentimiento';

function CalorieRing({ consumed, target }: { consumed: number; target: number }) {
  const size = 120;
  const sw = 9;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(consumed / Math.max(target, 1), 1);
  const offset = circ * (1 - pct);
  return (
    // El anillo es un SVG: se agrupa con una frase para el lector de pantalla.
    <View style={{ width: size, height: size }} accessible
      accessibilityLabel={
        `Calorías de hoy: ${Math.round(consumed).toLocaleString()} de ${target.toLocaleString()}. ` +
        `${Math.round(pct * 100)} por ciento de tu meta.`
      }>
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
    <View style={{ marginBottom: 10 }} accessible
      accessibilityLabel={`${name}: ${Math.round(consumed)} de ${target} gramos, ${Math.round(pct)} por ciento`}>
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
  const recuperacion = useRecuperacion();

  const [aiSuggestion, setAiSuggestion] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [water, setWater] = useState(0);
  // Plan generado ANTES del último cambio de salud → recordatorio persistente.
  const [planStale, setPlanStale] = useState(false);
  // ¿Ya entrenó HOY? Al cerrar un entrenamiento el plan avanza al día
  // siguiente, así que sin este dato la pantalla presenta la sesión de mañana
  // como si fuera la de hoy — que es exactamente lo que confundía al usuario.
  const [entrenoHoy, setEntrenoHoy] = useState(false);
  const [generandoPlan, setGenerandoPlan] = useState(false);

  // Genera el primer plan de quien se quedó sin él porque la IA falló en el
  // onboarding. Es la ruta de recuperación que faltaba.
  async function generarPlan() {
    if (!profile || generandoPlan) return;
    setGenerandoPlan(true);
    try {
      const saved = await generateFirstPlan(profile);
      setTrainingPlan(saved);
      // El plan nuevo arranca en el día 1: el perfil en memoria tiene el
      // current_plan_day viejo y la cabecera mostraría el día equivocado.
      setProfile({ ...profile, current_plan_day: 0 });
      track('plan_generated', { origen: 'recuperacion_home' });
      Alert.alert('¡Listo!', 'Tu plan ya está armado. Puedes empezar cuando quieras.');
    } catch (e: any) {
      captureError(e, { screen: 'home', stage: 'generate_first_plan' });
      Alert.alert(
        'No pudimos generar tu plan',
        (e?.message ?? 'Algo falló.') + '\n\nTus datos siguen guardados. Puedes intentarlo de nuevo.'
      );
    } finally {
      setGenerandoPlan(false);
    }
  }

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

  // Día actual del plan — POR CALENDARIO, no por el contador guardado.
  //
  // Antes esto era `Math.min(profile?.current_plan_day ?? 0, 6)`, y ese
  // contador solo avanzaba al terminar un entrenamiento. Quien paraba diez
  // días volvía al mismo día que dejó, descanso incluido: la app le proponía
  // descansar después de diez días parado.
  //
  // Mientras llega la consulta se usa el contador viejo: es lo que se veía
  // antes, así que en el peor caso la pantalla no empeora.
  const [estadoHoy, setEstadoHoy] = useState<EstadoDelDia | null>(null);
  useEffect(() => {
    if (!profile?.user_id) return;
    let vivo = true;
    calcularDiaDeHoy({
      userId: profile.user_id,
      currentPlanDay: profile.current_plan_day,
      dias: trainingPlan?.plan_data?.days,
    })
      .then((e) => { if (vivo) setEstadoHoy(e); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [profile?.user_id, profile?.current_plan_day, trainingPlan]);

  const todayIndex = estadoHoy?.diaDelPlan ?? Math.min(profile?.current_plan_day ?? 0, 6);
  const todayPlan = trainingPlan?.plan_data?.days?.[todayIndex];

  // El coach del plan GRATIS. Reglas, no IA: sale de progressionEngine,
  // warmupMath y healthMath, que ya deciden lo difícil de forma determinista.
  // No cuesta un token, así que puede correr para quien no paga — que es
  // justamente quien hasta ahora abría la app y no encontraba a nadie
  // diciéndole nada sobre sus propios números.
  const [consejos, setConsejos] = useState<ConsejoCoach[]>([]);
  useEffect(() => {
    if (!profile?.user_id || profile.is_premium || !estadoHoy) return;
    let vivo = true;
    consejosGratisDeHoy({
      userId: profile.user_id,
      goal: profile.goal,
      grupoDeHoy: todayPlan?.muscle_groups ?? [],
      diasSinEntrenar: estadoHoy.diasSinEntrenar,
      // Sin cifras de proteína con el modo activo: el coach de reglas emite
      // "te faltan N g para tu meta de hoy", que es exactamente la frase que
      // esta pantalla acaba de decidir no mostrar tres bloques más arriba.
      proteinaHoyG: recuperacion.ocultarCalorias ? null : totals.protein_g,
      proteinaMetaG: recuperacion.ocultarCalorias ? null : profile.daily_protein_g,
    })
      .then((c) => { if (vivo) setConsejos(c); })
      .catch(() => {}); // sin coach es peor, pero no puede tumbar la portada
    return () => { vivo = false; };
  }, [profile?.user_id, profile?.is_premium, estadoHoy, todayIndex, totals.protein_g]);

  // El saludo de quien vuelve.
  //
  // El pique se apaga en modo recuperación y solo ahí. Los mensajes ya están
  // construidos para hablar de constancia y nunca de cuerpos —hay tests que lo
  // barren—, así que son seguros para quien no completó el tamizaje. Pero para
  // quien SÍ lo completó y salió señal de trastorno de la conducta
  // alimentaria, hasta "tu ex ha sido más constante" sobra.
  //
  // La semilla es el día del mes: el texto no parpadea al repintar la pantalla,
  // pero cambia de un día para otro.
  const regreso = useMemo(() => {
    if (estadoHoy?.diasSinEntrenar == null) return null;
    return mensajeDeRegreso({
      dias: estadoHoy.diasSinEntrenar,
      sinComparaciones: recuperacion.activo,
      semilla: new Date().getDate(),
    });
  }, [estadoHoy?.diasSinEntrenar, recuperacion.activo]);

  // Qué es lo que realmente muestra la tarjeta de abajo. Antes la cabecera
  // decía "DÍA 2 DE 7", un número de índice que no le dice nada a nadie: ni
  // qué toca, ni por qué cambió de 1 a 2 sin que pasara la medianoche.
  const etiquetaPlan =
    todayPlan?.type === 'workout' ? (todayPlan.muscle_groups?.join(' + ') || 'Entrenamiento')
    : todayPlan?.type === 'rest' ? 'Descanso'
    : todayPlan?.type === 'active_recovery' ? 'Recuperación activa'
    : null;
  // Si ya entrenó, el plan avanzó y lo de abajo es lo de MAÑANA.
  const cuandoLbl = entrenoHoy ? 'MAÑANA' : 'HOY';

  // Comparar contra un mes en el que no hubo nada no es comparar. Sin actividad
  // previa la sección entera se oculta: un "↑ 0%" verde sobre cero minutos
  // parece un logro y no lo es.
  const hayComparativa = monthStats.lastMonth > 0 || monthStats.lastDays > 0;

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

    // Se lee ANTES del insight: loadSuggestion mete "ya entrenó hoy" en su
    // clave de caché, así que necesita el dato ya resuelto.
    let yaEntreno = false;
    try {
      const stats = await loadUserStats(profile.user_id);
      yaEntreno = stats.last_workout_date === localDateKey();
      setEntrenoHoy(yaEntreno);
    } catch {
      // Sin stats se asume que no ha entrenado: presentar la sesión como "hoy"
      // es el estado normal, y equivocarse hacia ahí no rompe nada.
    }

    await Promise.all([loadMonthStats(), loadSuggestion(false, yaEntreno)]);
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
  async function loadSuggestion(force: boolean, yaEntreno = entrenoHoy) {
    if (!profile) return;
    // SOLO SI SE VA A VER. La tarjeta del insight solo se pinta para Premium
    // (más abajo, `profile.is_premium ? ...`), pero esta función corría para
    // TODO EL MUNDO: se generaba un insight con gpt-4o —y se cobraba contra el
    // presupuesto de la cuenta gratis— para tirarlo sin enseñarlo.
    //
    // Es dinero quemado dos veces: se gasta, y se gasta del techo de $0.15 que
    // debería alcanzar para el plan de entrenamiento, que es lo único que el
    // plan gratis promete con IA.
    if (!profile.is_premium) return;
    const slot = new Date().getHours() < 15 ? 'am' : 'pm';
    // El día del plan y el "ya entrenó" van en la CLAVE. Sin ellos, el mensaje
    // se cacheaba por fecha+franja y seguía diciéndote que hoy te toca lo que
    // acabas de terminar: al cerrar el entrenamiento el plan avanza, pero el
    // texto cacheado se quedaba en el día anterior. Cambiar de día o terminar
    // la sesión ahora invalida la entrada y el coach vuelve a hablar con la
    // realidad. Cuesta una llamada de IA más por entrenamiento; que el coach
    // mienta sobre lo que acabas de hacer cuesta más.
    const dia = profile.current_plan_day ?? 0;
    const cacheKey =
      `gymup_coach_insight_${profile.user_id}_${localDateKey()}_${slot}_d${dia}_${yaEntreno ? 'post' : 'pre'}`;

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
        {/* Actualización de los documentos legales.
            El registro de consentimientos guarda una fila por documento Y
            VERSIÓN, y lib/legal.ts sabe calcular qué le falta a cada persona.
            Eso se construyó entero y no lo llamaba nadie: quien se registró con
            la política 1.3 seguiría dentro con la 1.9 sin haberla visto, y en el
            registro constaría que aceptó la 1.3 — que es cierto, y por eso mismo
            no vale para la 1.9. El versionado sin reconsentimiento es un campo
            de más en una tabla.
            Se muestra solo si falta algo, y no bloquea: un muro por un cambio de
            redacción se acepta sin leer, que es justo lo que invalida un
            consentimiento. */}
        <AvisoReconsentimiento />

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>{greeting}</Text>
            {/* El apodo primero: la app te llama como TÚ quieres */}
            <Text style={s.userName}>{(profile.nickname || profile.name || '').toUpperCase()} 💪</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <HelpButton
              pantalla="la pantalla de inicio"
              pregunta="Explícame la pantalla de inicio de Rityvo: qué significa cada cosa que veo (el anillo de calorías, las barras de macros, los vasos de agua, el día del plan) y cómo la uso día a día."
            />
            {/* Era un View inerte: tiene toda la pinta de un botón de perfil
                —círculo con tu inicial, arriba a la derecha— y no hacía nada
                al tocarlo. Encima estaba oculto a los lectores de pantalla,
                así que quien navega por voz ni siquiera sabía que existía.
                Ahora lleva al perfil, que es lo que la gente ya esperaba. */}
            <TouchableOpacity
              style={s.avatar}
              onPress={() => router.push('/(tabs)/profile' as any)}
              activeOpacity={0.8}
              hitSlop={A11y.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Tu perfil y ajustes"
            >
              <Text style={s.avatarTxt}>{(profile.nickname || profile.name)?.[0]?.toUpperCase() ?? '?'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sin conexión: informar, no bloquear. Lo de abajo sigue usable. */}
        <OfflineBanner disponible="Puedes entrenar y registrar tus series. El coach IA y la sincronización vuelven con la señal." />

        {/* Quien vuelve tras días parado. Va ARRIBA porque es lo primero que
            hay que reconocer: sin esto la app hacía como si no hubieran pasado
            dos semanas, y esa indiferencia es la que hace desinstalar.
            El pique se apaga solo en modo recuperación (ver `regreso`). */}
        {regreso && (
          <View
            style={s.regresoCard}
            accessible
            accessibilityLabel={`${regreso.titulo}. ${regreso.cuerpo}`}
          >
            <Text style={s.regresoTitulo}>{regreso.titulo}</Text>
            <Text style={s.regresoCuerpo}>{regreso.cuerpo}</Text>
            {estadoHoy?.reincorporacion && (
              <Text style={s.regresoNota}>{estadoHoy.reincorporacion.nota}</Text>
            )}
          </View>
        )}

        {/* Macros del día. En modo recuperación NO se muestran: la app
            promete programar sin metas de peso ni estética y luego enseñaba
            el anillo de calorías en la primera pantalla. */}
        {recuperacion.ocultarCalorias ? (
          <View style={s.recoveryCard} accessible accessibilityLabel={AVISO_RECUPERACION}>
            <Text style={s.recoveryTxt}>{AVISO_RECUPERACION}</Text>
          </View>
        ) : (
        <View style={s.macroCard}>
          <CalorieRing consumed={totals.calories} target={profile.daily_calories} />
          <View style={{ flex: 1 }}>
            <MacroBar name="Proteína" consumed={totals.protein_g} target={profile.daily_protein_g} color={Colors.macroProtein} />
            <MacroBar name="Carbos" consumed={totals.carbs_g} target={profile.daily_carbs_g} color={Colors.macroCarbs} />
            <MacroBar name="Grasa" consumed={totals.fat_g} target={profile.daily_fat_g} color={Colors.macroFat} />
          </View>
        </View>
        )}

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
                accessibilityRole="checkbox"
                accessibilityLabel={`Vaso de agua ${i + 1} de ${WATER_GOAL}`}
                accessibilityState={{ checked: i < water }}
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

        {/* Comparativas del mes.
            Solo se muestran si hay con QUÉ comparar. Antes aparecían siempre:
            en una cuenta nueva la pantalla se llenaba de "↑ 0%" en verde, que
            presenta la ausencia de datos como una mejora, y ocupaba el sitio
            de lo único que importa el primer día — empezar a entrenar. */}
        {hayComparativa && (
        <Text style={s.sectionLbl} accessibilityRole="header">ESTE MES VS MES ANTERIOR</Text>
        )}
        {hayComparativa && (
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
              <View key={item.label} style={s.compareCard} accessible
                accessibilityLabel={
                  `${item.label} este mes: ${item.val} ${item.unit}. ` +
                  (item.prev > 0
                    ? `${good ? 'Subiste' : 'Bajaste'} ${pct} por ciento respecto al mes pasado.`
                    : 'Sin datos del mes pasado para comparar.')
                }>
                <Text style={s.compareIcon}>{item.icon}</Text>
                <Text style={s.compareLabel}>{item.label}</Text>
                <Text style={s.compareVal}>{item.val}<Text style={s.compareUnit}> {item.unit}</Text></Text>
                <View style={[s.compareBadge, { backgroundColor: good ? Colors.accentMuted : 'rgba(255,124,58,0.1)' }]}>
                  <Text style={[s.compareDiff, { color: good ? Colors.accent : Colors.macroFat }]}>
                    {diff >= 0 ? '↑' : '↓'} {pct}%
                  </Text>
                </View>
                <Text style={s.compareVs}>vs mes pasado</Text>
              </View>
            );
          })}
        </ScrollView>
        )}

        {/* Ya entrenaste: el plan avanzó, así que hay que decirlo explícito
            antes de mostrar la sesión siguiente o parece que se saltó un día. */}
        {entrenoHoy && (
          <View style={s.doneBanner} accessible
            accessibilityLabel="Ya entrenaste hoy. Lo que sigue es tu sesión de mañana">
            <Text style={{ fontSize: 18 }}>✅</Text>
            <Text style={s.doneBannerTxt}>
              Ya entrenaste hoy. Esto es lo que viene mañana.
            </Text>
          </View>
        )}

        {/* Indicador de día del plan */}
        <View style={s.planDayRow}>
          <Text style={s.sectionLbl} accessibilityRole="header">
            {etiquetaPlan ? `${cuandoLbl} · ${etiquetaPlan.toUpperCase()}` : 'TU PLAN'}
          </Text>
          {/* Los puntos solo repiten visualmente el día que ya dice el título. */}
          <View style={s.planDots} importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden>
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={i} style={[
                s.planDot,
                i < todayIndex && s.planDotDone,
                i === todayIndex && s.planDotCurrent,
              ]} />
            ))}
          </View>
        </View>
        {/* El número de día queda como dato secundario, no como titular. */}
        <Text style={s.planDaySub}>
          Día {todayIndex + 1} de 7 de tu plan · {new Date().toLocaleDateString('es-CO', { weekday: 'long' })}
        </Text>

        {/* Plan obsoleto respecto a la salud: recordatorio persistente */}
        {planStale && (
          <TouchableOpacity
            style={s.staleCard}
            onPress={() => router.push('/(tabs)/profile' as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Tu plan no incluye tu último cambio de salud"
            accessibilityHint="Abre tu perfil para ajustarlo con la inteligencia artificial"
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
              onPress={() => router.push('/workout-session' as any)} activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={entrenoHoy
                ? `Adelantar la sesión de mañana: ${todayPlan.muscle_groups?.join(' y ')}`
                : `Iniciar entrenamiento de ${todayPlan.muscle_groups?.join(' y ')}`}
              accessibilityHint={`${todayPlan.exercises?.length} ejercicios, unos ${todayPlan.estimated_duration_min} minutos`}>
              {/* Si ya entrenó, este botón arranca la sesión de MAÑANA. Decir
                  "iniciar entrenamiento" a secas haría pensar que se repite la
                  de hoy. */}
              <Text style={s.startBtnTxt}>
                {entrenoHoy ? '▶  ADELANTAR ESTA SESIÓN' : '▶  INICIAR ENTRENAMIENTO'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/exercises' as any)} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="Ver biblioteca de ejercicios">
              <Text style={s.libraryLink}>📚 Ver biblioteca de ejercicios</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Descanso */}
        {todayPlan?.type === 'rest' && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>😴</Text>
            <Text style={s.restTitle}>{cuandoLbl === 'HOY' ? 'Hoy descansas' : 'Mañana descansas'}</Text>
            <Text style={s.restDesc}>
              {todayPlan.notes ??
                'El músculo no crece mientras entrenas: crece mientras te recuperas. ' +
                'El entrenamiento da el estímulo, la adaptación ocurre después. ' +
                'Saltarte el descanso no acelera nada, lo frena.'}
            </Text>
            <TouchableOpacity style={s.restBtn} activeOpacity={0.85}
              onPress={() => router.push({
                pathname: '/coach-chat',
                params: { q: '¿Qué puedo hacer hoy que es día de descanso? ¿Puedo hacer algo ligero o es mejor no hacer nada?' },
              } as any)}
              accessibilityRole="button"
              accessibilityLabel="Preguntarle al coach qué hacer en tu día de descanso">
              <Text style={s.restBtnTxt}>💬  Pregúntale a tu coach</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Recuperación activa. Antes era un View mudo con un texto de relleno
            ("Día de movilidad y flexibilidad") cuando la IA no mandaba notes, y
            no llevaba a ningún lado aunque invitara a tocarlo. */}
        {todayPlan?.type === 'active_recovery' && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🧘</Text>
            <Text style={s.restTitle}>
              {cuandoLbl === 'HOY' ? 'Hoy: recuperación activa' : 'Mañana: recuperación activa'}
            </Text>
            <Text style={s.restDesc}>
              {todayPlan.notes ??
                'Movimiento suave para que llegue sangre al músculo y se recupere más rápido, ' +
                'sin sumarte fatiga. No es un entrenamiento: si terminas cansado, te pasaste.'}
            </Text>
            {todayPlan.activities?.length ? (
              <View style={s.actList}>
                {todayPlan.activities.map((a: string, i: number) => (
                  <View key={i} style={s.actItem} accessible accessibilityLabel={`Opción ${i + 1}: ${a}`}>
                    <Text style={s.actBullet}>›</Text>
                    <Text style={s.actTxt}>{a}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={s.restBtn} activeOpacity={0.85}
              onPress={() => router.push({
                pathname: '/coach-chat',
                params: {
                  q: todayPlan.activities?.length
                    ? `Hoy tengo recuperación activa (${todayPlan.activities.join(', ')}). Explícame cómo hacer cada una y cuánto tiempo.`
                    : 'Hoy tengo un día de recuperación activa. ¿Qué hago exactamente, por cuánto tiempo y con qué intensidad?',
                },
              } as any)}
              accessibilityRole="button"
              accessibilityLabel="Preguntarle al coach cómo hacer tu recuperación activa">
              <Text style={s.restBtnTxt}>💬  ¿Cómo lo hago?</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sin NINGÚN plan: la IA falló durante el onboarding. Antes esto decía
            "Cargando tu plan…" para siempre y no había forma de conseguir uno
            —regenerateAdaptivePlan exige un plan previo que adaptar—, así que
            la única salida real era rehacer el onboarding entero. */}
        {!trainingPlan && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
            <Text style={s.restTitle}>Todavía no tienes plan</Text>
            <Text style={s.restDesc}>
              No pudimos generarlo cuando te registraste. Tus datos y tu tamizaje de salud
              están guardados: esto no te vuelve a preguntar nada.
            </Text>
            <TouchableOpacity style={[s.restBtn, generandoPlan && { opacity: 0.6 }]}
              onPress={generarPlan} disabled={generandoPlan} activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={generandoPlan ? 'Generando tu plan, espera' : 'Generar mi plan con inteligencia artificial'}
              accessibilityState={{ disabled: generandoPlan, busy: generandoPlan }}>
              <Text style={s.restBtnTxt}>
                {generandoPlan ? '⏳  Generando tu plan…' : '✦  Generar mi plan'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hay plan pero el día no resuelve (índice fuera de rango). */}
        {trainingPlan && !todayPlan && (
          <View style={s.restCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
            <Text style={s.restTitle}>Cargando tu plan...</Text>
            <Text style={s.restDesc}>Desliza hacia abajo para refrescar.</Text>
          </View>
        )}

        {/* El coach. Con Premium escribe la IA y se le puede responder; sin
            Premium hablan las reglas (lib/coachReglas.ts), que son
            deterministas y no cuestan un token.

            No es una versión capada: la IA responde lo que le preguntes, y
            esto dice lo que hoy importa de tus números sin que preguntes. Por
            eso la tarjeta gratis no lleva "actualiza para desbloquear" encima
            del consejo — el consejo es de verdad, y el enlace al paywall va
            debajo y en pequeño. */}
        {profile.is_premium ? (
          <TouchableOpacity
            style={s.aiCard}
            onPress={() => router.push('/coach-chat' as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Tu coach: ${aiSuggestion || 'cargando a tu coach'}`}
            accessibilityHint="Abre el chat para responderle o preguntarle lo que quieras"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={s.aiDot} />
              <Text style={s.aiLbl}>TU COACH IA</Text>
              <Text style={[s.aiLbl, { marginLeft: 'auto' }]}>💬</Text>
            </View>
            <Text style={s.aiTxt}>{aiSuggestion || 'Cargando a tu coach...'}</Text>
            <Text style={s.aiCta}>Respóndele o pregúntale lo que quieras →</Text>
          </TouchableOpacity>
        ) : consejos.length > 0 ? (
          <View
            style={s.aiCard}
            accessible
            accessibilityLabel={`Tu coach: ${consejos.map((c) => c.texto).join('. ')}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={s.aiDot} />
              <Text style={s.aiLbl}>TU COACH</Text>
            </View>
            {consejos.map((c) => (
              <Text key={c.clave} style={s.consejoTxt}>• {c.texto}</Text>
            ))}
            <TouchableOpacity
              onPress={() => router.push('/paywall' as any)}
              accessibilityRole="button"
              accessibilityLabel="Ver Premium para poder preguntarle lo que quieras al coach"
            >
              <Text style={s.aiCta}>¿Quieres preguntarle lo que sea? Mira Premium →</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Accesos rápidos.
            Esta misma pantalla pinta el aviso del modo recuperación 330 líneas
            más arriba y seguía enseñando "Escanear cuerpo" aquí abajo. Las
            pantallas ya se defienden solas (Components/GuardiaRecuperacion),
            pero ofrecerle el botón a alguien para que se choque con un muro es
            una crueldad pequeña y evitable. */}
        <View style={s.quickRow}>
          {!recuperacion.ocultarCalorias && (
            <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/food-scan' as any)} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel="Escanear comida con la cámara">
              <Text style={{ fontSize: 24 }}>🍽️</Text>
              <Text style={s.quickLbl}>Escanear comida</Text>
            </TouchableOpacity>
          )}
          {!recuperacion.ocultarCalorias && (
            <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/fridge-scan' as any)} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel="Escanear mi nevera con la cámara">
              <Text style={{ fontSize: 24 }}>🧊</Text>
              <Text style={s.quickLbl}>Escanear nevera</Text>
            </TouchableOpacity>
          )}
          {!recuperacion.ocultarCuerpo && (
            <TouchableOpacity style={s.quickBtn} onPress={() => router.push('/body-scan' as any)} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel="Escanear mi cuerpo con la cámara">
              <Text style={{ fontSize: 24 }}>💪</Text>
              <Text style={s.quickLbl}>Escanear cuerpo</Text>
            </TouchableOpacity>
          )}
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
  ringLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center' },
  macroName: { fontFamily: Fonts.bodyMedium, fontSize: Type.micro, color: Colors.textSecondary },
  macroVal: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textPrimary },
  macroTotal: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  barBg: { height: 5, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 10 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: Spacing.lg, marginBottom: 10, marginTop: 4 },
  recoveryCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
  },
  // Borde de acento: es una tarjeta de bienvenida, no una advertencia. Con el
  // borde de error parecería un regaño, que es justo lo que no queremos.
  regresoCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accent,
    padding: Spacing.md, marginHorizontal: Spacing.lg, marginBottom: Spacing.md, gap: 4,
  },
  regresoTitulo: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.accent },
  regresoCuerpo: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.textPrimary },
  regresoNota: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  // Mismo peso visual que el texto del coach IA: el consejo de reglas no es un
  // sucedáneo y no tiene por qué verse como tal.
  consejoTxt: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.textPrimary, marginBottom: 6 },
  recoveryTxt: {
    fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 20,
  },
  waterCard: { marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.xl, padding: Spacing.md },
  waterTitle: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 0.6 },
  waterCount: { fontFamily: Fonts.headingSemi, fontSize: 14, color: Colors.macroCarbs },
  waterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  waterCup: { padding: 4 },
  waterDone: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.accent, marginTop: 6, textAlign: 'center' },
  planDayRow: { marginHorizontal: Spacing.lg, marginBottom: 4 },
  planDaySub: { marginHorizontal: Spacing.lg, marginBottom: 12, fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted },
  doneBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.lg, padding: Spacing.md },
  doneBannerTxt: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent, lineHeight: 18 },
  restBtn: { marginTop: Spacing.md, backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.lg, paddingVertical: 12, paddingHorizontal: Spacing.lg },
  restBtnTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent },
  actList: { alignSelf: 'stretch', marginTop: Spacing.md, gap: 6 },
  actItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  actBullet: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.accent, lineHeight: 20 },
  actTxt: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  planDots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  planDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  planDotDone: { backgroundColor: Colors.accentDark },
  planDotCurrent: { backgroundColor: Colors.accent, width: 40 },
  compareCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, width: 120, alignItems: 'center', gap: 4 },
  compareIcon: { fontSize: 24 },
  compareLabel: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  compareVal: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary },
  compareUnit: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  compareBadge: { borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3 },
  compareDiff: { fontFamily: Fonts.bodySemi, fontSize: Type.micro },
  compareVs: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  workoutCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 12 },
  workoutTitle: { fontFamily: Fonts.headingBold, fontSize: 20, color: Colors.textPrimary },
  workoutMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  durationBadge: { backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
  durationTxt: { fontFamily: Fonts.headingBold, fontSize: 20, color: Colors.accent },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  exNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  exNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textMuted },
  exName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  exMeta: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  moreEx: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  startBtn: { backgroundColor: Colors.accent, borderRadius: Radii.md, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.md },
  startBtnTxt: { fontFamily: Fonts.heading, fontSize: 17, color: '#0a0a0b', letterSpacing: 0.8 },
  libraryLink: { fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 10, textDecorationLine: 'underline' },
  restCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, padding: Spacing.xl, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  restTitle: { fontFamily: Fonts.headingBold, fontSize: 22, color: Colors.textPrimary, marginBottom: 8 },
  restDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.xl, padding: Spacing.md, marginBottom: 12 },
  aiDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  aiLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, letterSpacing: 0.8 },
  aiTxt: { fontFamily: Fonts.body, fontSize: 13, color: '#ccc', lineHeight: 20 },
  aiCta: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, marginTop: 10 },
  staleCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: 'rgba(255,157,58,0.08)', borderWidth: 1, borderColor: 'rgba(255,157,58,0.35)', borderRadius: Radii.lg, padding: Spacing.md },
  staleTxt: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 12, color: Colors.warning, lineHeight: 18 },
  quickRow: { flexDirection: 'row', gap: 8, marginHorizontal: Spacing.lg, marginBottom: 12 },
  quickBtn: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: 12, alignItems: 'center', gap: 6 },
  quickLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center' },
});