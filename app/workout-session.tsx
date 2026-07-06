import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Vibration, TextInput, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { recordWorkoutCompleted, getBadge } from '../lib/streaks';
import { fetchLastPerformance, saveSetLogs, type SetLogInput, type LastPerf } from '../lib/setLogs';
import { fetchExerciseBests } from '../lib/history';
import { detectNewPRs } from '../lib/prs';
import { platesPerSide, formatPlates } from '../lib/plates';
import { useSafeKeepAwake } from '../lib/useSafeKeepAwake';
import { saveSession, loadSession, clearSession } from '../lib/workoutPersistence';
import { track } from '../lib/analytics';
import { loadHealthSafe } from '../lib/health';
import { exerciseConflicts, INJURY_ZONES, type InjuryZone } from '../lib/healthMath';
import { exercisesForGroup, EXERCISE_LIBRARY, type LibraryExercise } from '../constants/exercises';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function WorkoutSessionScreen() {
  useSafeKeepAwake('workout'); // pantalla siempre encendida durante el entreno
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const todayIndex = Math.min(profile?.current_plan_day ?? 0, 6);
  const todayPlan = trainingPlan?.plan_data?.days?.[todayIndex];
  const exercises = todayPlan?.exercises ?? [];

  const [currentEx, setCurrentEx] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [completedSets, setCompletedSets] = useState<Record<number, number>>({});
  const [resting, setResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  // Inicio real de la sesión en un ref para poder restaurarlo tras un crash.
  const sessionStartRef = useRef(new Date());

  // Registro real de series (peso × reps) + última performance para prefill.
  const [weightInput, setWeightInput] = useState('');
  const [repsInput, setRepsInput] = useState('');
  const [lastPerf, setLastPerf] = useState<Record<string, LastPerf>>({});
  const loggedSetsRef = useRef<SetLogInput[]>([]);
  const [swapModal, setSwapModal] = useState(false);
  // Lesiones activas: para advertir si un swap carga una zona lesionada.
  // FAIL-CLOSED: mientras cargan (o si no se pueden verificar), NO se asume
  // "sin lesiones" — se advierte genéricamente en cada swap.
  const [injuries, setInjuries] = useState<InjuryZone[]>([]);
  const [injuriesStatus, setInjuriesStatus] = useState<'loading' | 'ok' | 'unknown'>('loading');
  useEffect(() => {
    if (!profile) return;
    loadHealthSafe(profile.user_id)
      .then((load) => {
        if (load.status === 'unknown') {
          setInjuriesStatus('unknown');
        } else {
          setInjuries(load.profile?.injuries ?? []);
          setInjuriesStatus('ok');
        }
      })
      .catch(() => setInjuriesStatus('unknown'));
  }, [profile?.user_id]);

  useEffect(() => {
    // Derivar de Date.now(): un setInterval que solo suma +1 se congela
    // cuando la app va a background o se apaga la pantalla.
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartRef.current.getTime()) / 1000));
    }, 1000);
    track('workout_started', { day_index: todayIndex, exercises: exercises.length });
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Fricción: salir sin terminar es tan valioso de medir como terminar.
  useEffect(() => {
    return () => {
      if (finishingRef.current) return; // terminó bien: workout_completed ya salió
      const sets = loggedSetsRef.current.length;
      const durMin = Math.round((Date.now() - sessionStartRef.current.getTime()) / 60_000);
      if (sets > 0 || durMin >= 1) {
        track('workout_abandoned', { sets_logged: sets, duration_min: durMin });
      }
    };
  }, []);

  // Restaurar una sesión interrumpida (crash / cierre) si existe una válida.
  useEffect(() => {
    if (exercises.length === 0) return;
    let cancelled = false;
    loadSession(todayIndex, Date.now()).then((snap) => {
      if (cancelled || !snap) return;
      const setsDone = Object.values(snap.completedSets).reduce((a, b) => a + b, 0);
      Alert.alert(
        '¿Retomar tu entreno?',
        `Tenías un entrenamiento en curso (${setsDone} series). ¿Continuar donde lo dejaste?`,
        [
          { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearSession() },
          {
            text: 'Retomar',
            onPress: () => {
              sessionStartRef.current = new Date(snap.startedAt);
              setCurrentEx(Math.min(snap.currentEx, exercises.length - 1));
              setCompletedSets(snap.completedSets);
              loggedSetsRef.current = snap.loggedSets;
              const doneForEx = snap.completedSets[snap.currentEx] ?? 0;
              setCurrentSet(doneForEx + 1);
            },
          },
        ]
      );
    });
    return () => { cancelled = true; };
  }, [exercises.length]);

  // Guarda un snapshot del progreso (para restaurar tras un crash).
  function persist(nextCompleted: Record<number, number>, nextEx: number) {
    saveSession({
      todayIndex,
      startedAt: sessionStartRef.current.getTime(),
      currentEx: nextEx,
      completedSets: nextCompleted,
      loggedSets: loggedSetsRef.current,
    });
  }

  // Cargar la última vez que el usuario hizo estos ejercicios.
  useEffect(() => {
    if (!profile || exercises.length === 0) return;
    const names = exercises.map((e: any) => e.name);
    fetchLastPerformance(profile.user_id, names).then(setLastPerf).catch(() => {});
  }, [profile?.user_id, trainingPlan?.id]);

  // Prefill de los inputs al cambiar de ejercicio/serie: peso de la última vez.
  // Depende también del NOMBRE del ejercicio: al sustituirlo (swap) el índice
  // no cambia y antes quedaba el peso del ejercicio anterior.
  const currentExName = exercises[currentEx]?.name;
  useEffect(() => {
    if (!currentExName) return;
    const prev = lastPerf[currentExName];
    setWeightInput(prev?.weight_kg != null ? String(prev.weight_kg) : '');
    setRepsInput(prev?.reps != null ? String(prev.reps) : '');
  }, [currentEx, currentSet, lastPerf, currentExName]);

  function formatTime(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startRest(seconds: number) {
    // Limpiar cualquier countdown previo: dos intervalos simultáneos hacían
    // que el descanso bajara al doble de velocidad.
    if (restRef.current) clearInterval(restRef.current);
    setResting(true);
    setRestSeconds(seconds);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    restRef.current = setInterval(() => {
      setRestSeconds((r) => {
        if (r <= 1) {
          clearInterval(restRef.current!);
          setResting(false);
          Vibration.vibrate([0, 300, 100, 300]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  const lastTapRef = useRef(0);

  function completeSet() {
    const ex = exercises[currentEx];
    if (!ex) return;
    // Anti doble-tap: dos toques rápidos duplicaban la serie registrada.
    const now = Date.now();
    if (now - lastTapRef.current < 600) return;
    lastTapRef.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const done = (completedSets[currentEx] ?? 0) + 1;

    // Registrar el peso y reps logrados en esta serie.
    const w = parseFloat(weightInput.replace(',', '.'));
    const r = parseInt(repsInput, 10);
    loggedSetsRef.current.push({
      exercise_name: ex.name,
      set_number: done,
      weight_kg: Number.isFinite(w) ? w : null,
      reps: Number.isFinite(r) ? r : null,
    });

    const nextCompleted = { ...completedSets, [currentEx]: done };
    setCompletedSets(nextCompleted);
    track('set_completed', { exercise: ex.name, set: done, weight_kg: Number.isFinite(w) ? w : null });

    if (done < ex.sets) {
      persist(nextCompleted, currentEx); // snapshot para restaurar tras un crash
      setCurrentSet(done + 1);
      startRest(ex.rest_seconds ?? 60);
    } else {
      if (currentEx < exercises.length - 1) {
        persist(nextCompleted, currentEx + 1);
        Alert.alert(
          '✅ Ejercicio completado',
          `¡Listo! Pasas a: ${exercises[currentEx + 1].name}`,
          [{
            text: 'Siguiente',
            onPress: () => {
              setCurrentEx(currentEx + 1);
              setCurrentSet(1);
              startRest(60);
            },
          }]
        );
      } else {
        finishWorkout();
      }
    }
  }

  const finishingRef = useRef(false);

  async function finishWorkout() {
    // Guard de re-entrada: doble confirmación / carrera con completeSet
    // duplicaba sesión, XP y racha.
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearSession(); // el entreno terminó: ya no hay nada que restaurar
    const plannedSets = exercises.reduce((a: number, e: any) => a + (e.sets ?? 0), 0);
    const doneSets = Object.values(completedSets).reduce((a, b) => a + b, 0);
    track('workout_completed', {
      day_index: todayIndex,
      duration_min: Math.round(elapsed / 60),
      sets_logged: loggedSetsRef.current.length,
      planned_sets: plannedSets,
      completion_pct: plannedSets > 0 ? Math.round((doneSets / plannedSets) * 100) : null,
    });
    if (timerRef.current) clearInterval(timerRef.current);
    if (restRef.current) clearInterval(restRef.current);

    const durationMin = Math.round(elapsed / 60);
    const prNames: string[] = []; // récords detectados en esta sesión

    // 1. Notificación inmediata de logro
    const motivationalMessages = [
      'Eso es lo que te separa de los demás. Sigue así.',
      'El que entrena hoy, gana mañana. Bien hecho.',
      'Tu cuerpo te lo va a agradecer esta noche.',
      'Eso no lo hace cualquiera. Tú sí lo hiciste.',
      'Un entrenamiento más en el banco. Nadie te lo quita.',
    ];
    const msg = motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)];

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🏆 ¡Entrenamiento completado!',
        body: `${formatTime(elapsed)} de puro trabajo. ${msg}`,
        sound: 'default',
      },
      trigger: null,
    });

    // 2. Guardar sesión en Supabase (con id para enlazar las series)
    if (profile && trainingPlan) {
      const { data: session, error } = await supabase.from('workout_sessions').insert({
        user_id: profile.user_id,
        training_plan_id: trainingPlan.id,
        day_index: todayIndex,
        started_at: sessionStartRef.current.toISOString(),
        completed_at: new Date().toISOString(),
        duration_min: durationMin,
        exercises_completed: exercises.length,
      }).select('id').single();
      if (error) console.log('Error guardando sesión:', error.message);

      // 2b. Detectar PRs ANTES de guardar (comparar contra el histórico previo).
      try {
        const byEx: Record<string, { weight_kg: number | null; reps: number | null }[]> = {};
        for (const l of loggedSetsRef.current) (byEx[l.exercise_name] ??= []).push(l);
        const names = Object.keys(byEx);
        if (names.length > 0) {
          const prevBests = await fetchExerciseBests(profile.user_id, names);
          prNames.push(...names.filter((n) => detectNewPRs(byEx[n], prevBests[n]).any));
          if (prNames.length > 0) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch (e: any) {
        console.log('[Workout] PR:', e?.message);
      }

      // 2c. Guardar las series registradas (peso × reps).
      await saveSetLogs(profile.user_id, session?.id ?? null, loggedSetsRef.current);
    }

    // 3. Avanzar al siguiente día del plan (envuelve: tras el día 7 vuelve
    // al día 1 — antes se quedaba atascado repitiendo el día 7 por siempre).
    if (profile) {
      const nextDay = ((profile.current_plan_day ?? 0) + 1) % 7;
      const { data: updatedProfile, error: updateError } = await supabase
        .from('user_profiles')
        .update({ current_plan_day: nextDay })
        .eq('user_id', profile.user_id)
        .select()
        .single();

      if (updateError) {
        console.log('Error actualizando día del plan:', updateError.message);
      } else if (updatedProfile) {
        setProfile(updatedProfile);
      }
    }

    // 4. Actualizar gamificación (XP, racha, badges).
    let xpGained = 0, newStreak = 0, leveledUp = false, freezeUsed = false;
    let badgeNames: string[] = [];
    if (profile) {
      try {
        const r = await recordWorkoutCompleted(profile.user_id);
        xpGained = r.xpGained;
        newStreak = r.newStreak;
        leveledUp = r.leveledUp;
        freezeUsed = r.freezeUsed;
        badgeNames = r.newBadges.map((id) => {
          const b = getBadge(id);
          return b ? `${b.emoji} ${b.title}` : id;
        });
        // Dinámica de racha y logros: los eventos de retención más predictivos.
        track('streak_extended', { streak: r.newStreak, broken_before: r.streakBroken });
        if (r.freezeUsed) track('streak_freeze_used', { streak: r.newStreak });
        if (r.leveledUp) track('level_up');
        for (const id of r.newBadges) track('badge_earned', { badge_id: id });
        if (prNames.length > 0) track('pr_achieved', { count: prNames.length });
      } catch (e: any) {
        console.log('[Workout] Error gamificación:', e?.message);
      }
    }

    // 5. Pantalla de celebración con todo el botín de la sesión.
    router.replace({
      pathname: '/workout-complete' as any,
      params: {
        duration: formatTime(elapsed),
        exercises: String(exercises.length),
        xp: String(xpGained),
        streak: String(newStreak),
        leveledUp: leveledUp ? '1' : '0',
        freezeUsed: freezeUsed ? '1' : '0',
        badges: badgeNames.join('|'),
        prs: prNames.join('|'),
      },
    });
  }

  // Sustituir el ejercicio actual por otro de la biblioteca (edita el plan + persiste).
  // Red de seguridad: si el destino del swap carga una zona lesionada,
  // fricción informada (advertir + confirmar), no bloqueo paternalista.
  function requestSwap(lib: LibraryExercise) {
    // Sin verificación de lesiones (cargando/red caída): advertencia genérica
    // conservadora en TODOS los swaps — nunca asumir "sin lesiones".
    if (injuriesStatus !== 'ok') {
      Alert.alert(
        'No pudimos verificar tus lesiones',
        `Si tienes alguna molestia o lesión, evita que "${lib.name}" la cargue. ¿Continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: () => swapExercise(lib) },
        ]
      );
      return;
    }
    const conflicts = exerciseConflicts(lib.name, injuries);
    if (conflicts.length === 0) {
      swapExercise(lib);
      return;
    }
    const zonas = conflicts
      .map((z) => INJURY_ZONES.find((x) => x.id === z)?.label ?? z)
      .join(', ');
    Alert.alert(
      '⚠️ Cuidado con tu lesión',
      `"${lib.name}" carga una zona que marcaste como lesionada (${zonas}). Tu coach recomienda elegir otra opción.`,
      [
        { text: 'Elegir otro', style: 'cancel' },
        {
          text: 'Usarlo igual',
          style: 'destructive',
          onPress: () => {
            track('swap_risky_confirmed', { exercise: lib.name, zones: conflicts });
            swapExercise(lib);
          },
        },
      ]
    );
  }

  async function swapExercise(lib: LibraryExercise) {
    setSwapModal(false);
    if (!trainingPlan || !ex) return;
    Haptics.selectionAsync();
    // Qué ejercicios rechaza la gente = oro para mejorar los planes de la IA.
    track('exercise_swapped', { from: ex.name, to: lib.name });

    // Clon profundo del plan y reemplazo del ejercicio actual conservando series/reps.
    const newPlan = JSON.parse(JSON.stringify(trainingPlan));
    const dayEx = newPlan?.plan_data?.days?.[todayIndex]?.exercises?.[currentEx];
    if (!dayEx) return;
    dayEx.name = lib.name;
    dayEx.muscle_group = lib.muscle_group;
    dayEx.notes = lib.instructions[0] ?? dayEx.notes;

    setTrainingPlan(newPlan);

    if (profile) {
      const { error } = await supabase
        .from('training_plans')
        .update({ plan_data: newPlan.plan_data })
        .eq('id', trainingPlan.id);
      if (error) console.log('[Swap] Error persistiendo:', error.message);
    }
  }

  function confirmFinish() {
    Alert.alert(
      '¿Terminar sesión?',
      `Llevas ${formatTime(elapsed)} entrenando.`,
      [
        { text: 'Continuar', style: 'cancel' },
        { text: 'Terminar', onPress: finishWorkout },
      ]
    );
  }

  const ex = exercises[currentEx];
  const totalSets = exercises.reduce((acc: number, e: any) => acc + (e.sets ?? 0), 0);
  const doneSets = Object.values(completedSets).reduce((a: number, b: number) => a + b, 0);
  const overallProgress = totalSets > 0 ? doneSets / totalSets : 0;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={confirmFinish}>
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
        <View style={s.timerWrap}>
          <Text style={s.timerLabel}>TIEMPO</Text>
          <Text style={s.timer}>{formatTime(elapsed)}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.progressWrap}>
        <View style={s.progressBg}>
          <View style={[s.progressFill, { width: `${overallProgress * 100}%` }]} />
        </View>
        <Text style={s.progressTxt}>{doneSets}/{totalSets} series</Text>
      </View>

      {exercises.length === 0 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>😴</Text>
          <Text style={{ fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, textAlign: 'center' }}>
            Hoy es día de descanso
          </Text>
          <Text style={{ fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 8 }}>
            No hay ejercicios programados para hoy.
          </Text>
          <TouchableOpacity
            style={[s.closeBtn, { marginTop: 32, width: 'auto', paddingHorizontal: 24 }]}
            onPress={() => router.replace('/(tabs)' as any)}
          >
            <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary }}>
              Volver al inicio
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {resting && exercises.length > 0 && (
        <View style={s.restOverlay}>
          <Text style={s.restTitle}>DESCANSO</Text>
          <Text style={s.restTimer}>{restSeconds}s</Text>
          <View style={s.restRing}>
            <View style={[s.restRingFill, {
              height: `${(restSeconds / (ex?.rest_seconds ?? 60)) * 100}%`,
            }]} />
          </View>
          <Text style={s.restNext}>Siguiente: Serie {currentSet} de {ex?.name}</Text>
          <TouchableOpacity style={s.skipRestBtn} onPress={() => {
            if (restRef.current) clearInterval(restRef.current);
            setResting(false);
          }}>
            <Text style={s.skipRestTxt}>Saltar descanso →</Text>
          </TouchableOpacity>
        </View>
      )}

      {!resting && exercises.length > 0 && (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {ex && (
            <View style={s.currentExCard}>
              <View style={s.exBadge}>
                <Text style={s.exBadgeTxt}>EJERCICIO {currentEx + 1}/{exercises.length}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.exName, { flex: 1 }]}>{ex.name}</Text>
                <TouchableOpacity style={s.swapBtn} onPress={() => setSwapModal(true)} accessibilityLabel="Cambiar ejercicio">
                  <Text style={s.swapTxt}>🔄</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.exGroup}>{ex.muscle_group}</Text>

              <View style={s.setsRow}>
                {Array.from({ length: ex.sets }).map((_: any, i: number) => (
                  <View key={i} style={[
                    s.setDot,
                    (completedSets[currentEx] ?? 0) > i && s.setDotDone,
                    i === (completedSets[currentEx] ?? 0) && s.setDotCurrent,
                  ]}>
                    <Text style={[
                      s.setDotTxt,
                      (completedSets[currentEx] ?? 0) > i && { color: '#0a0a0b' },
                    ]}>
                      {i + 1}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={s.repInfo}>
                <View style={s.repCard}>
                  <Text style={s.repVal}>{ex.reps}</Text>
                  <Text style={s.repLbl}>Reps</Text>
                </View>
                <View style={s.repCard}>
                  <Text style={s.repVal}>{ex.rest_seconds}s</Text>
                  <Text style={s.repLbl}>Descanso</Text>
                </View>
                <View style={s.repCard}>
                  <Text style={s.repVal}>{currentSet}/{ex.sets}</Text>
                  <Text style={s.repLbl}>Serie actual</Text>
                </View>
              </View>

              {/* Registro real de la serie */}
              <View style={s.logRow}>
                <View style={s.logField}>
                  <Text style={s.logLbl}>PESO (kg)</Text>
                  <TextInput
                    style={s.logInput}
                    value={weightInput}
                    onChangeText={setWeightInput}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={Colors.textMuted}
                    accessibilityLabel="Peso levantado en kilogramos"
                  />
                </View>
                <View style={s.logField}>
                  <Text style={s.logLbl}>REPS</Text>
                  <TextInput
                    style={s.logInput}
                    value={repsInput}
                    onChangeText={setRepsInput}
                    keyboardType="number-pad"
                    placeholder={ex.reps}
                    placeholderTextColor={Colors.textMuted}
                    accessibilityLabel="Repeticiones logradas"
                  />
                </View>
              </View>
              {/* Calculadora de discos: qué cargar por lado (barra 20kg) */}
              {(() => {
                const w = parseFloat(weightInput.replace(',', '.'));
                if (!Number.isFinite(w) || w < 20) return null;
                const plates = platesPerSide(w, 20);
                if (!plates) return null;
                return (
                  <Text style={s.platesTxt}>
                    🏋️ {formatPlates(plates)}
                    {plates.leftover > 0 ? ` (llegas a ${plates.achieved}kg)` : ''}
                  </Text>
                );
              })()}
              {lastPerf[ex.name] && (lastPerf[ex.name].weight_kg != null) && (
                <Text style={s.lastPerfTxt}>
                  Última vez: {lastPerf[ex.name].weight_kg} kg × {lastPerf[ex.name].reps ?? '—'} reps
                </Text>
              )}

              {ex.notes && (
                <View style={s.notesBox}>
                  <Text style={s.notesLbl}>💡 FORMA</Text>
                  <Text style={s.notesTxt}>{ex.notes}</Text>
                </View>
              )}

              <TouchableOpacity style={s.doneBtn} onPress={completeSet} activeOpacity={0.85}>
                <Text style={s.doneBtnTxt}>✓  SERIE COMPLETADA</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.queueLbl}>PRÓXIMOS EJERCICIOS</Text>
          {exercises.slice(currentEx + 1).map((e: any, i: number) => (
            <View key={i} style={s.queueItem}>
              <View style={s.queueNum}>
                <Text style={s.queueNumTxt}>{currentEx + i + 2}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.queueName}>{e.name}</Text>
                <Text style={s.queueMeta}>{e.sets} × {e.reps}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity style={s.finishBtn} onPress={confirmFinish} activeOpacity={0.8}>
            <Text style={s.finishBtnTxt}>Terminar sesión</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Modal: sustituir ejercicio */}
      <Modal visible={swapModal} transparent animationType="slide" onRequestClose={() => setSwapModal(false)}>
        <View style={s.swapOverlay}>
          <View style={s.swapSheet}>
            <Text style={s.swapTitle}>Cambiar ejercicio</Text>
            <Text style={s.swapSub}>Mismo grupo muscular ({ex?.muscle_group})</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(exercisesForGroup(ex?.muscle_group ?? '').length > 0
                ? exercisesForGroup(ex?.muscle_group ?? '')
                : EXERCISE_LIBRARY
              ).map((lib) => {
                const risky = exerciseConflicts(lib.name, injuries).length > 0;
                return (
                  <TouchableOpacity key={lib.id} style={s.swapItem} onPress={() => requestSwap(lib)} activeOpacity={0.8}>
                    <Text style={{ fontSize: 22 }}>{lib.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.swapItemName}>{lib.name}{risky ? '  ⚠️' : ''}</Text>
                      <Text style={[s.swapItemMeta, risky && { color: Colors.warning }]}>
                        {risky ? 'Carga una zona que marcaste lesionada' : lib.equipment}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={s.swapCancel} onPress={() => setSwapModal(false)}>
              <Text style={s.swapCancelTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  closeBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontFamily: Fonts.headingBold, fontSize: 16, color: Colors.textMuted },
  timerWrap: { alignItems: 'center' },
  timerLabel: { fontFamily: Fonts.bodySemi, fontSize: 9, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  timer: { fontFamily: Fonts.heading, fontSize: 42, color: Colors.accent, letterSpacing: -1 },
  progressWrap: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  progressBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 2 },
  progressTxt: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'right' },
  restOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  restTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.textMuted, letterSpacing: 2, marginBottom: 12 },
  restTimer: { fontFamily: Fonts.heading, fontSize: 96, color: Colors.accent, lineHeight: 96 },
  restRing: { width: 8, height: 120, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden', marginVertical: 16, justifyContent: 'flex-end' },
  restRingFill: { width: '100%', backgroundColor: Colors.accent, borderRadius: 4 },
  restNext: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  skipRestBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 20, paddingVertical: 10 },
  skipRestTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  currentExCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, marginBottom: 16 },
  exBadge: { backgroundColor: Colors.accentMuted, borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 10 },
  exBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, letterSpacing: 0.8 },
  exName: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.textPrimary, marginBottom: 4 },
  exGroup: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 20 },
  setsRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  setDot: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  setDotDone: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  setDotCurrent: { borderColor: Colors.accent, borderWidth: 2 },
  setDotTxt: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textMuted },
  repInfo: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  repCard: { flex: 1, backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 12, alignItems: 'center' },
  repVal: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  repLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  logRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  logField: { flex: 1, backgroundColor: Colors.bgInput, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  logLbl: { fontFamily: Fonts.bodySemi, fontSize: 9, color: Colors.textMuted, letterSpacing: 0.6, marginBottom: 2 },
  logInput: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, padding: 0 },
  platesTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginBottom: 4 },
  lastPerfTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent, marginBottom: 16 },
  notesBox: { backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 12, marginBottom: 16, borderLeftWidth: 2, borderLeftColor: Colors.accent },
  notesLbl: { fontFamily: Fonts.bodySemi, fontSize: 9, color: Colors.accent, letterSpacing: 0.6, marginBottom: 4 },
  notesTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  doneBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center' },
  doneBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  queueLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgCard, borderRadius: Radii.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: Colors.border },
  queueNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  queueNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textMuted },
  queueName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  queueMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  finishBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  finishBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
  swapBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  swapTxt: { fontSize: 16 },
  swapOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  swapSheet: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl, borderTopWidth: 1, borderTopColor: Colors.border },
  swapTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  swapSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md },
  swapItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  swapItemName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textPrimary },
  swapItemMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  swapCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  swapCancelTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
});