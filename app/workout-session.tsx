import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Vibration, TextInput, Modal, AccessibilityInfo,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { recordWorkoutCompleted, getBadge } from '../lib/streaks';
import { fetchLastPerformance, type SetLogInput, type LastPerf } from '../lib/setLogs';
import { fetchExerciseBests } from '../lib/history';
import { detectNewPRs } from '../lib/prs';
import { platesPerSide, formatPlates } from '../lib/plates';
import { openExerciseVideo } from '../lib/exerciseVideo';
import { useSafeKeepAwake } from '../lib/useSafeKeepAwake';
import { saveSession, loadSession, clearSession } from '../lib/workoutPersistence';
import { track } from '../lib/analytics';
import { captureError } from '../lib/monitoring';
import { loadHealthSafe } from '../lib/health';
import { computeRisk, evaluateWorkoutAccess, exerciseConflicts, INJURY_ZONES, type InjuryZone, type Condition, type HealthProfile } from '../lib/healthMath';
import { calentamientoPara, minutosEstimados, seriesDeAproximacion } from '../lib/warmupMath';
import { uuidV4 } from '../lib/ids';
import { completeWorkout } from '../lib/workoutCompletion';
import { adaptSessionExercises, sessionAdaptationMessage } from '../lib/sessionAdaptation';
import { calcularDiaDeHoy, olvidarUltimoEntreno, type EstadoDelDia } from '../lib/diaDeHoy';
import { exercisesForGroup, EXERCISE_LIBRARY, type LibraryExercise } from '../constants/exercises';
import { Colors, Fonts, Radii, Spacing, A11y, Type } from '../constants/theme';

export default function WorkoutSessionScreen() {
  useSafeKeepAwake('workout'); // pantalla siempre encendida durante el entreno
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Por calendario. Es la pantalla donde más importa: abrir el entrenamiento
  // del día que se dejó hace dos semanas significa proponer las cargas de
  // entonces. Ver lib/planCalendario.ts.
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
  const planExercises = todayPlan?.exercises ?? [];
  const [sessionConfig, setSessionConfig] = useState<{ minutes: number; energy: number; soreness: number } | null>(null);
  const exercises = sessionConfig
    ? adaptSessionExercises(planExercises, {
        availableMinutes: sessionConfig.minutes,
        energy: sessionConfig.energy,
        soreness: sessionConfig.soreness,
      })
    : planExercises;

  const [currentEx, setCurrentEx] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [completedSets, setCompletedSets] = useState<Record<number, number>>({});
  const [resting, setResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  // Inicio real de la sesión en un ref para poder restaurarlo tras un crash.
  const sessionStartRef = useRef(new Date());
  const clientSessionKeyRef = useRef(uuidV4());
  const workoutStartedRef = useRef(false);

  // Registro real de series (peso × reps) + última performance para prefill.
  const [weightInput, setWeightInput] = useState('');
  const [repsInput, setRepsInput] = useState('');
  const [rirInput, setRirInput] = useState('');
  const [lastPerf, setLastPerf] = useState<Record<string, LastPerf>>({});
  const loggedSetsRef = useRef<SetLogInput[]>([]);
  const [swapModal, setSwapModal] = useState(false);
  // Lesiones activas: para advertir si un swap carga una zona lesionada.
  // FAIL-CLOSED: mientras cargan (o si no se pueden verificar), NO se asume
  // "sin lesiones" — se advierte genéricamente en cada swap.
  const [injuries, setInjuries] = useState<InjuryZone[]>([]);
  const [injuriesStatus, setInjuriesStatus] = useState<'loading' | 'ok' | 'unknown'>('loading');
  // Las condiciones (embarazo, hernia, cardiopatía…) filtran el calentamiento
  // y los estiramientos. Sin ellas, el catálogo propondría movimientos
  // contraindicados a quien menos se lo puede permitir.
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null);
  const [healthReload, setHealthReload] = useState(0);
  useEffect(() => {
    if (!profile) return;
    loadHealthSafe(profile.user_id)
      .then((load) => {
        if (load.status === 'unknown') {
          setInjuriesStatus('unknown');
        } else {
          setInjuries(load.profile?.injuries ?? []);
          setConditions(load.profile?.conditions ?? []);
          setHealthProfile(load.profile);
          setInjuriesStatus('ok');
        }
      })
      .catch(() => setInjuriesStatus('unknown'));
  }, [profile?.user_id, healthReload]);

  // Calentamiento: primera pantalla de la sesión. Se salta al retomar una
  // sesión interrumpida (ya calentó) y es saltable siempre — recomendarlo sí,
  // imponerlo no.
  const [faseCalentamiento, setFaseCalentamiento] = useState(true);
  const [energyToday, setEnergyToday] = useState(3);
  // 3 = "Media", que es uno de los chips reales. Antes arrancaba en 2, un
  // valor que ningún chip representa: los tres salían apagados como si fuera
  // una pregunta sin responder, y ese 2 invisible se guardaba igual en
  // workout_readiness y entraba en el promedio de recuperación.
  const [sorenessToday, setSorenessToday] = useState(3);
  // 1-5, misma escala que energia y molestia. Lo lee chooseIntervention.
  const [sleepToday, setSleepToday] = useState(3);
  // Estres: la otra columna que adaptivePlan leia y nadie escribia.
  const [stressToday, setStressToday] = useState(3);
  const [availableMinutes, setAvailableMinutes] = useState(60);
  const [newPainToday, setNewPainToday] = useState(false);
  const ctxSalud = {
    injuries,
    conditions,
    desconocido: injuriesStatus !== 'ok', // fail-closed, igual que los swaps
    age: profile?.age,
    riskLevel: healthProfile && profile ? computeRisk(healthProfile, profile.age).level : undefined,
    profile: healthProfile,
  };

  function startWorkoutClock(startedAt = Date.now(), resumed = false, exerciseCount = exercises.length) {
    sessionStartRef.current = new Date(startedAt);
    workoutStartedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartRef.current.getTime()) / 1000));
    }, 1000);
    track('workout_started', { day_index: todayIndex, exercises: exerciseCount, resumed });
  }

  useEffect(() => {
    // Derivar de Date.now(): un setInterval que solo suma +1 se congela
    // cuando la app va a background o se apaga la pantalla.
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Fricción: salir sin terminar es tan valioso de medir como terminar.
  useEffect(() => {
    return () => {
      if (finishingRef.current) return; // terminó bien: workout_completed ya salió
      const sets = loggedSetsRef.current.length;
      const durMin = Math.round((Date.now() - sessionStartRef.current.getTime()) / 60_000);
      if (workoutStartedRef.current && (sets > 0 || durMin >= 1)) {
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
              // Tras una pausa larga el cuerpo ya no está preparado: se
              // conserva todo el progreso, pero se vuelve a ofrecer calentamiento.
              const pausaLarga = Date.now() - snap.savedAt > 20 * 60_000;
              setFaseCalentamiento(pausaLarga);
              clientSessionKeyRef.current = snap.clientSessionKey ?? uuidV4();
              const restoredConfig = {
                minutes: snap.sessionMinutes ?? 60,
                energy: snap.readinessEnergy ?? 3,
                soreness: snap.readinessSoreness ?? 2,
              };
              const restoredExercises = adaptSessionExercises(planExercises, {
                availableMinutes: restoredConfig.minutes,
                energy: restoredConfig.energy,
                soreness: restoredConfig.soreness,
              });
              setSessionConfig(restoredConfig);
              setEnergyToday(restoredConfig.energy);
              setSorenessToday(restoredConfig.soreness);
              setAvailableMinutes(restoredConfig.minutes);
              if (pausaLarga) {
                // Pausa larga: se vuelve a mostrar el calentamiento (tiene
                // sentido, el cuerpo se enfrió) pero el reloj NO se reinicia.
                // Se recuerda el arranque real para que `empezar()` lo retome:
                // si no, los 45 minutos ya entrenados se borraban del registro
                // y la sesión quedaba guardada como si hubiera durado 10.
                sessionStartRef.current = new Date(snap.startedAt);
                workoutStartedRef.current = true;
              } else {
                startWorkoutClock(snap.startedAt, true, restoredExercises.length);
              }
              setCurrentEx(Math.min(snap.currentEx, restoredExercises.length - 1));
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
  }, [trainingPlan?.id, todayIndex, planExercises.length]);

  // Guarda un snapshot del progreso (para restaurar tras un crash).
  function persist(nextCompleted: Record<number, number>, nextEx: number) {
    saveSession({
      clientSessionKey: clientSessionKeyRef.current,
      sessionMinutes: sessionConfig?.minutes,
      readinessEnergy: sessionConfig?.energy,
      readinessSoreness: sessionConfig?.soreness,
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
    // El RIR se deja VACÍO a propósito. El campo pide un autoinforme
    // ("repeticiones que sentías que aún podías hacer"), así que rellenarlo con
    // el objetivo del plan hace que quien no lo toca guarde como esfuerzo
    // propio un número que nunca declaró — y ese dato inventado alimenta
    // después las decisiones de progresión. El objetivo del plan se muestra
    // como pista al lado del campo, no dentro de él.
    setRirInput('');
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
          // El fin del descanso solo se comunicaba por vibración y por el
          // cambio visual: sin esto, quien usa lector de pantalla no se entera.
          AccessibilityInfo.announceForAccessibility('Descanso terminado. Empieza la siguiente serie');
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

    // Registrar el peso y reps logrados en esta serie.
    const w = parseFloat(weightInput.replace(',', '.'));
    const r = parseInt(repsInput, 10);
    const rir = rirInput.trim() === '' ? null : parseFloat(rirInput.replace(',', '.'));
    if (!Number.isInteger(r) || r <= 0 || r > 1000) {
      Alert.alert('Faltan las repeticiones', 'Escribe cuántas repeticiones completaste (entre 1 y 1000). Así tu progreso será real y útil.');
      return;
    }
    lastTapRef.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const done = (completedSets[currentEx] ?? 0) + 1;
    if (Number.isFinite(w) && (w < 0 || w > 1000)) {
      Alert.alert('Revisa el peso', 'El peso debe estar entre 0 y 1000 kg. Déjalo vacío si fue con peso corporal.');
      return;
    }
    if (rir !== null && (!Number.isFinite(rir) || rir < 0 || rir > 10)) {
      Alert.alert('Revisa el esfuerzo', 'RIR debe estar entre 0 y 10. 0 significa que no quedaba ninguna repetición; 2, que quedaban unas dos.');
      return;
    }
    loggedSetsRef.current.push({
      exercise_name: ex.name,
      set_number: done,
      weight_kg: Number.isFinite(w) ? w : null,
      reps: r,
      rir,
    });

    const nextCompleted = { ...completedSets, [currentEx]: done };
    setCompletedSets(nextCompleted);
    track('set_completed', { exercise: ex.name, set: done, weight_kg: Number.isFinite(w) ? w : null, rir });

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
        // El snapshot debe incluir la ÚLTIMA serie: si el guardado en el
        // servidor falla, es lo único que queda para reintentar sin perderla.
        persist(nextCompleted, currentEx);
        finishWorkout(nextCompleted);
      }
    }
  }

  const finishingRef = useRef(false);

  async function finishWorkout(completedOverride?: Record<number, number>) {
    // Guard de re-entrada: doble confirmación / carrera con completeSet
    // duplicaba sesión, XP y racha.
    if (finishingRef.current) return;
    finishingRef.current = true;

    const plannedSets = exercises.reduce((a: number, e: any) => a + (e.sets ?? 0), 0);
    const finalCompleted = completedOverride ?? completedSets;
    const doneSets = Object.values(finalCompleted).reduce((a, b) => a + b, 0);
    const durationMin = Math.max(1, Math.round((Date.now() - sessionStartRef.current.getTime()) / 60_000));
    const prNames: string[] = []; // récords detectados en esta sesión
    // Id de la sesión guardada. Viaja hasta recordWorkoutCompleted como
    // EVIDENCIA: el servidor solo acredita XP si existe esa fila, es de este
    // usuario, está completada y no ha cobrado antes. Sin él, un bucle de
    // llamadas a la RPC subía de nivel sin entrenar.
    let sessionId: string | null = null;

    try {
      // 1. Guardar la sesión en Supabase (con id para enlazar las series).
      // Es el ÚNICO paso que convierte el entreno en dato permanente, así que
      // manda: hasta que termine bien, el snapshot local sigue siendo la red
      // de seguridad y NO se toca nada más (día del plan, XP, celebración).
      if (!profile || !trainingPlan) {
        // Sin perfil o plan cargado no hay a dónde guardar. Si el usuario
        // alcanzó a registrar series reales preferimos pedirle reintento
        // antes que darlas por perdidas en silencio.
        if (loggedSetsRef.current.length > 0) {
          throw new Error('Perfil o plan no cargados: no hay dónde guardar la sesión');
        }
      } else {
        // 1b. Detectar PRs ANTES de guardar (comparar contra el histórico previo).
        // Cosmético: no detectar un récord no le cuesta el entreno a nadie.
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

        // 1c. Sesión + series se guardan atómicamente y con clave idempotente.
        const saved = await completeWorkout({
          clientSessionKey: clientSessionKeyRef.current,
          trainingPlanId: trainingPlan.id,
          dayIndex: todayIndex,
          startedAt: sessionStartRef.current.toISOString(),
          completedAt: new Date().toISOString(),
          durationMin,
          sets: loggedSetsRef.current,
        });
        sessionId = saved.sessionId;
        if (saved.alreadyCompleted) track('workout_save_idempotent', { session_id: sessionId });

        // Salida sin ninguna serie: no hubo entrenamiento que guardar, así que
        // no se celebra, no se suma XP, no se avanza el día del plan y no se
        // abre la pantalla de logro. Simplemente se sale, que es lo que la
        // persona pidió. Antes esto era imposible: la validación lanzaba y los
        // dos botones de salida devolvían un error.
        if (sessionId === null) {
          await clearSession();
          track('workout_abandoned', { sets_logged: 0, duration_min: durationMin });
          router.back();
          return;
        }
      }

      // 2. Datos a salvo en el servidor: RECIÉN AHORA se borra el snapshot
      // local. Borrarlo al entrar (como se hacía) significaba que cualquier
      // fallo posterior —hasta el de una notificación— borraba el entreno
      // entero sin haberlo guardado nunca.
      await clearSession();
      track('workout_completed', {
        day_index: todayIndex,
        duration_min: durationMin,
        sets_logged: loggedSetsRef.current.length,
        planned_sets: plannedSets,
        completion_pct: plannedSets > 0 ? Math.round((doneSets / plannedSets) * 100) : null,
      });

      // 3. Notificación de logro. Va DESPUÉS de guardar (no se celebra lo que
      // no está a salvo) y aislada: scheduleNotificationAsync lanza si el
      // permiso está denegado o el módulo nativo no existe en ese equipo, y
      // una notificación jamás puede costar un entrenamiento.
      const motivationalMessages = [
        'Sumaste una sesión útil a tu proceso. Bien hecho.',
        'La consistencia también incluye descansar cuando corresponde.',
        'Registraste evidencia real de tu avance. Sigue a tu ritmo.',
        'Hoy cumpliste la acción que estaba bajo tu control.',
        'Tu progreso queda guardado para ajustar mejor lo que sigue.',
      ];
      const msg = motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)];
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🏆 ¡Entrenamiento completado!',
            body: `${formatTime(elapsed)} de puro trabajo. ${msg}`,
            sound: 'default',
          },
          trigger: null,
        });
      } catch (e) {
        captureError(e, { scope: 'workout_finish_notification' });
      }

      // 4. Avanzar al siguiente día del plan (envuelve: tras el día 7 vuelve
      // al día 1 — antes se quedaba atascado repitiendo el día 7 por siempre).
      // Ya no es crítico: la sesión está guardada, así que un fallo aquí se
      // reporta pero no puede tumbar la celebración ni pedir reintento.
      if (profile) {
        try {
          // La caché de "último entrenamiento" guarda la fecha ANTERIOR a esta
          // sesión. Sin invalidarla, durante los siguientes segundos la app
          // seguiría creyendo que la persona lleva días sin entrenar y le
          // enseñaría el mensaje de bienvenida justo después de entrenar.
          olvidarUltimoEntreno();

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
        } catch (e) {
          captureError(e, { scope: 'workout_finish_next_day' });
        }
      }

      // 5. Actualizar gamificación (XP, racha, badges).
      let xpGained = 0, newStreak = 0, leveledUp = false, freezeUsed = false;
      let badgeNames: string[] = [];
      if (profile) {
        try {
          const r = await recordWorkoutCompleted(profile.user_id, sessionId);
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

      // 6. Pantalla de celebración con todo el botín de la sesión. Los
      // cronómetros se paran aquí y no al entrar: si el guardado falla el
      // usuario se queda EN la sesión y el reloj no puede quedar congelado.
      if (timerRef.current) clearInterval(timerRef.current);
      if (restRef.current) clearInterval(restRef.current);
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
          // Para los estiramientos de vuelta a la calma: la pantalla de
          // cierre no puede deducir qué se entrenó del plan, porque al
          // terminar el día del plan ya avanzó.
          grupos: (todayPlan?.muscle_groups ?? []).join('|'),
        },
      });
    } catch (e: any) {
      // Camino de fallo: el snapshot local sigue intacto, así que se libera el
      // guard para que el usuario pueda reintentar. Antes quedaba en true y
      // "Terminar sesión" no volvía a responder nunca más.
      finishingRef.current = false;
      captureError(e, {
        scope: 'workout_finish',
        sets_logged: loggedSetsRef.current.length,
        day_index: todayIndex,
      });
      const detail = String(e?.message ?? '');
      const validationFailure = /inválid|duplicad|al menos una serie/i.test(detail);
      Alert.alert(
        validationFailure ? 'Revisa las series registradas' : 'No pudimos guardar tu entrenamiento',
        validationFailure
          ? `${detail} Nada se perdió: corrige el dato e intenta de nuevo.`
          : 'Tus series siguen guardadas en el teléfono. Revisa tu conexión e intenta de nuevo.',
        [{ text: 'Entendido' }]
      );
    }
  }

  // Sustituir el ejercicio actual por otro de la biblioteca (edita el plan + persiste).
  // Red de seguridad: un swap no puede saltarse las restricciones que sí
  // protegieron la generación del plan. Sin autorización específica por
  // ejercicio, una zona lesionada se bloquea y se ofrece revisar la salud.
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
    track('swap_blocked_health', { exercise: lib.name, zones: conflicts });
    Alert.alert(
      'Este cambio no es seguro con tu perfil actual',
      `"${lib.name}" carga una zona que marcaste con lesión o molestia (${zonas}). Elige otra opción. Continúa solo si un profesional conoce tu estado actual y autorizó específicamente este movimiento.`,
      [
        { text: 'Elegir otro', style: 'cancel' },
        {
          text: 'Tengo autorización',
          onPress: () => Alert.alert(
            'Confirma la autorización específica',
            'No basta una autorización general para entrenar. Confirma únicamente si te indicaron que este ejercicio concreto es apropiado para tu lesión actual.',
            [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Confirmo autorización',
                style: 'destructive',
                onPress: () => {
                  track('swap_risky_confirmed', { exercise: lib.name, zones: conflicts, explicit_clearance: true });
                  swapExercise(lib);
                },
              },
            ]
          ),
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

  const healthAccess = healthProfile && profile
    ? evaluateWorkoutAccess(healthProfile, profile.age)
    : null;

  // La seguridad no puede depender de que una consulta de red haya salido
  // bien. Si no conocemos el tamizaje no iniciamos una rutina de fuerza.
  if (injuriesStatus !== 'ok' || !healthAccess) {
    const loading = injuriesStatus === 'loading';
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} hitSlop={A11y.hitSlopLg}
            accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={s.closeTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.calTitulo} accessibilityRole="header">SEGURIDAD DE LA SESIÓN</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.safetyCenter}>
          <Text style={s.safetyIcon}>{loading ? '···' : '🩺'}</Text>
          <Text style={s.safetyTitle}>{loading ? 'Revisando tu perfil de salud' : 'No pudimos verificar tu perfil'}</Text>
          <Text style={s.safetyText}>
            {loading
              ? 'Un momento. Adaptaremos la sesión y el calentamiento a lo que declaraste.'
              : 'No vamos a asumir que entrenar es seguro sin tus datos. Reintenta o revisa Mi salud; tu progreso no se pierde.'}
          </Text>
          {!loading && (
            <>
              <TouchableOpacity style={s.calBtn} onPress={() => {
                setInjuriesStatus('loading');
                setHealthReload((n) => n + 1);
              }} accessibilityRole="button" accessibilityLabel="Volver a intentar cargar el perfil de salud">
                <Text style={s.calBtnTxt}>VOLVER A INTENTAR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.safetySecondary} onPress={() => router.push('/health' as any)}
                accessibilityRole="button" accessibilityLabel="Abrir Mi salud">
                <Text style={s.safetySecondaryTxt}>Abrir Mi salud</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (healthAccess.status === 'blocked') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} hitSlop={A11y.hitSlopLg}
            accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={s.closeTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.calTitulo} accessibilityRole="header">PRIMERO TU SALUD</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.safetyCenter}>
          <Text style={s.safetyIcon}>🛑</Text>
          <Text style={s.safetyTitle}>{healthAccess.title}</Text>
          <Text style={s.safetyText}>{healthAccess.detail}</Text>
          {healthAccess.reasons.slice(0, 3).map((reason) => (
            <Text key={reason} style={s.safetyReason}>• {reason}</Text>
          ))}
          <TouchableOpacity style={s.calBtn} onPress={() => router.push('/health' as any)}
            accessibilityRole="button" accessibilityLabel="Revisar Mi salud">
            <Text style={s.calBtnTxt}>REVISAR MI SALUD</Text>
          </TouchableOpacity>
          <Text style={s.safetyFoot}>Si tienes dolor de pecho, dificultad para respirar, mareo intenso o desmayo, busca atención urgente.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ex = exercises[currentEx];
  const totalSets = exercises.reduce((acc: number, e: any) => acc + (e.sets ?? 0), 0);
  const doneSets = Object.values(completedSets).reduce((a: number, b: number) => a + b, 0);
  const overallProgress = totalSets > 0 ? doneSets / totalSets : 0;

  // ── CALENTAMIENTO ──
  if (faseCalentamiento && exercises.length > 0) {
    const items = calentamientoPara(todayPlan?.muscle_groups ?? [], ctxSalud);
    const aproximacion = seriesDeAproximacion(
      exercises[0]?.name ?? null,
      lastPerf[exercises[0]?.name]?.weight_kg
    );
    const warmupMinutes = minutosEstimados(items);

    // El cronómetro arranca AQUÍ, no al montar: el calentamiento no debería
    // inflar la duración de la sesión si alguien deja la pantalla abierta.
    function empezar(saltado: boolean) {
      if (newPainToday) {
        Alert.alert(
          'No entrenes sobre dolor nuevo',
          'Revisa Mi salud y, si el dolor es intenso, repentino o viene con otros síntomas, busca evaluación profesional.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir Mi salud', onPress: () => router.push('/health' as any) },
          ]
        );
        return;
      }
      const config = { minutes: availableMinutes, energy: energyToday, soreness: sorenessToday };
      const adapted = adaptSessionExercises(planExercises, {
        availableMinutes,
        energy: energyToday,
        soreness: sorenessToday,
      });
      setSessionConfig(config);
      // Al retomar tras una pausa larga se vuelve a pasar por aquí. Arrancar el
      // reloj desde cero borraba del registro TODO el tiempo entrenado antes
      // del corte: 55 minutos reales se guardaban como 10. Si ya había un
      // arranque previo, se conserva.
      const inicio = workoutStartedRef.current ? sessionStartRef.current.getTime() : Date.now();
      startWorkoutClock(inicio, workoutStartedRef.current, adapted.length);
      // Y el ejercicio activo se vuelve a acotar: recortar la sesión por tiempo
      // disponible puede dejar `currentEx` apuntando fuera de la lista nueva, y
      // entonces la pantalla se queda sin ejercicio ni botón para registrar.
      setCurrentEx((i) => Math.min(i, Math.max(0, adapted.length - 1)));
      track(saltado ? 'warmup_skipped' : 'warmup_done', { day_index: todayIndex });
      if (profile) {
        supabase.from('workout_readiness').upsert({
          user_id: profile.user_id,
          client_session_key: clientSessionKeyRef.current,
          energy: energyToday,
          sleep_quality: sleepToday,
          stress: stressToday,
          soreness: sorenessToday,
          available_minutes: availableMinutes,
          pain_new: newPainToday,
        }, { onConflict: 'user_id,client_session_key' }).then(({ error }) => {
          if (error) captureError(error, { scope: 'workout_readiness.save' });
        });
        track('workout_readiness_submitted', {
          energy: energyToday,
          sleep_quality: sleepToday,
          stress: stressToday,
          soreness: sorenessToday,
          available_minutes: availableMinutes,
          pain_new: newPainToday,
        });
      }
      setFaseCalentamiento(false);
    }

    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} hitSlop={A11y.hitSlopLg}
            accessibilityRole="button" accessibilityLabel="Salir sin entrenar">
            <Text style={s.closeTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={s.calTitulo} accessibilityRole="header">CALENTAMIENTO</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>
          <Text style={s.calIntro}>
            Preparación sugerida · {warmupMinutes} min. Sube gradualmente la temperatura y practica el movimiento. No elimina el riesgo: si aparece dolor o un síntoma nuevo, detente.
          </Text>

          {/* Antes solo se pintaba en riesgo 'moderado', así que quien tiene
              cardiopatía o embarazo con autorización médica —riesgo ALTO— no
              veía NINGÚN aviso, y sí lo veía quien tiene una molestia de
              rodilla. Ahora avisa a los dos, y con más énfasis al alto. */}
          {(healthAccess.level === 'moderado' || healthAccess.level === 'alto') && (
            <Text style={[s.calAviso, healthAccess.level === 'alto' && s.calAvisoAlto]}>
              {healthAccess.detail}
            </Text>
          )}

          <View style={s.readinessCard}>
            <Text style={s.readinessTitle}>¿CÓMO LLEGAS HOY?</Text>
            <Text style={s.readinessHelp}>Esto no te juzga: evita cambiar tu rutina por un mal día aislado.</Text>
            <Text style={s.readinessLabel}>Energía</Text>
            <View style={s.readinessRow}>
              {[{ v: 2, l: 'Baja' }, { v: 3, l: 'Normal' }, { v: 5, l: 'Alta' }].map((o) => (
                <TouchableOpacity key={o.v} style={[s.readinessChip, energyToday === o.v && s.readinessChipOn]}
                  onPress={() => setEnergyToday(o.v)} accessibilityRole="radio"
                  accessibilityState={{ selected: energyToday === o.v }} accessibilityLabel={`Energía ${o.l}`}>
                  <Text style={[s.readinessChipTxt, energyToday === o.v && s.readinessChipTxtOn]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* El sueño es la palanca de recuperación más grande que existe, y
                progressionEngine YA lo usa: `(readiness.sleepQuality ?? 3) <= 2`
                dispara la bajada de volumen. Pero nadie lo capturaba, así que
                la columna siempre iba en null y esa rama nunca se ejecutaba.
                Se pregunta aquí y no en una pantalla nueva porque esta ya la ve
                todo el mundo antes de entrenar: coste de fricción, una fila. */}
            <Text style={s.readinessLabel}>Cómo dormiste</Text>
            <View style={s.readinessRow}>
              {[{ v: 2, l: 'Mal' }, { v: 3, l: 'Normal' }, { v: 5, l: 'Bien' }].map((o) => (
                <TouchableOpacity key={o.v} style={[s.readinessChip, sleepToday === o.v && s.readinessChipOn]}
                  onPress={() => setSleepToday(o.v)} accessibilityRole="radio"
                  accessibilityState={{ selected: sleepToday === o.v }} accessibilityLabel={`Dormiste ${o.l}`}>
                  <Text style={[s.readinessChipTxt, sleepToday === o.v && s.readinessChipTxtOn]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* El estrés no es relleno: chooseIntervention lo mira igual que el
                sueño —`(readiness.stress ?? 3) >= 5` entra en underRecovered— y
                adaptivePlan lo lee. Era la otra columna que nadie llenaba. */}
            <Text style={s.readinessLabel}>Estrés estos días</Text>
            <View style={s.readinessRow}>
              {[{ v: 1, l: 'Poco' }, { v: 3, l: 'Normal' }, { v: 5, l: 'Mucho' }].map((o) => (
                <TouchableOpacity key={o.v} style={[s.readinessChip, stressToday === o.v && s.readinessChipOn]}
                  onPress={() => setStressToday(o.v)} accessibilityRole="radio"
                  accessibilityState={{ selected: stressToday === o.v }} accessibilityLabel={`Estrés ${o.l}`}>
                  <Text style={[s.readinessChipTxt, stressToday === o.v && s.readinessChipTxtOn]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.readinessLabel}>Molestia muscular normal</Text>
            <View style={s.readinessRow}>
              {[{ v: 1, l: 'Nada' }, { v: 3, l: 'Media' }, { v: 5, l: 'Alta' }].map((o) => (
                <TouchableOpacity key={o.v} style={[s.readinessChip, sorenessToday === o.v && s.readinessChipOn]}
                  onPress={() => setSorenessToday(o.v)} accessibilityRole="radio"
                  accessibilityState={{ selected: sorenessToday === o.v }} accessibilityLabel={`Molestia muscular ${o.l}`}>
                  <Text style={[s.readinessChipTxt, sorenessToday === o.v && s.readinessChipTxtOn]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.readinessLabel}>Tiempo disponible</Text>
            <View style={s.readinessRow}>
              {[20, 40, 60].map((value) => (
                <TouchableOpacity key={value} style={[s.readinessChip, availableMinutes === value && s.readinessChipOn]}
                  onPress={() => setAvailableMinutes(value)} accessibilityRole="radio"
                  accessibilityState={{ selected: availableMinutes === value }} accessibilityLabel={`${value} minutos disponibles`}>
                  <Text style={[s.readinessChipTxt, availableMinutes === value && s.readinessChipTxtOn]}>{value === 60 ? 'Completo' : `${value} min`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[s.painToggle, newPainToday && s.painToggleOn]} onPress={() => setNewPainToday((v) => !v)}
              accessibilityRole="checkbox" accessibilityState={{ checked: newPainToday }} accessibilityLabel="Tengo dolor nuevo o distinto al habitual">
              <Text style={s.painToggleTxt}>{newPainToday ? '✓ ' : ''}Tengo dolor nuevo o distinto al habitual</Text>
            </TouchableOpacity>
          </View>

          {items.map((it, i) => (
            <View key={it.nombre} style={s.calItem} accessible
              accessibilityLabel={`${i + 1}. ${it.nombre}, ${it.duracion}. ${it.como}`}>
              <View style={s.calNum}><Text style={s.calNumTxt}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.calNombre}>{it.nombre}</Text>
                <Text style={s.calDur}>{it.duracion}</Text>
                <Text style={s.calComo}>{it.como}</Text>
              </View>
            </View>
          ))}

          {aproximacion && (
            <View style={s.calAprox}>
              <Text style={s.calAproxTitulo}>Y lo más importante</Text>
              <Text style={s.calAproxTxt}>{aproximacion}</Text>
            </View>
          )}

          <TouchableOpacity style={s.calBtn} onPress={() => empezar(false)} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Ya calenté, empezar el entrenamiento">
            <Text style={s.calBtnTxt}>LISTO · EMPEZAR</Text>
          </TouchableOpacity>

          {/* Saltarlo es decisión suya. Un calentamiento obligatorio se
              convierte en un botón que se pulsa sin leer. */}
          <TouchableOpacity style={s.calSaltar} onPress={() => empezar(true)}
            accessibilityRole="button" accessibilityLabel="Saltar el calentamiento">
            <Text style={s.calSaltarTxt}>Saltar por hoy</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={confirmFinish} hitSlop={A11y.hitSlopLg}
          accessibilityRole="button" accessibilityLabel="Terminar la sesión y salir">
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
        {/* El cronómetro cambia cada segundo: se etiqueta sin live region para
            no bombardear al lector con un anuncio por segundo. */}
        <View style={s.timerWrap} accessible
          accessibilityLabel={`Tiempo de la sesión: ${formatTime(elapsed)}`}>
          <Text style={s.timerLabel}>TIEMPO</Text>
          <Text style={s.timer}>{formatTime(elapsed)}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.progressWrap} accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Llevas ${doneSets} de ${totalSets} series`}
        accessibilityValue={{ min: 0, max: totalSets, now: doneSets }}>
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
            accessibilityRole="button" accessibilityLabel="Volver al inicio"
          >
            <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary }}>
              Volver al inicio
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* El overlay de descanso va SIN `accessible`: agruparlo escondería el
          botón de saltar descanso. Cada hijo lleva su propia etiqueta. */}
      {resting && exercises.length > 0 && (
        <View style={s.restOverlay} accessibilityViewIsModal>
          <Text style={s.restTitle} accessibilityRole="header">DESCANSO</Text>
          <Text style={s.restTimer} accessibilityLabel={`Quedan ${restSeconds} segundos de descanso`}>
            {restSeconds}s
          </Text>
          <View style={s.restRing} importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden>
            <View style={[s.restRingFill, {
              height: `${(restSeconds / (ex?.rest_seconds ?? 60)) * 100}%`,
            }]} />
          </View>
          <Text style={s.restNext}>Siguiente: Serie {currentSet} de {ex?.name}</Text>
          <TouchableOpacity style={s.skipRestBtn}
            accessibilityRole="button" accessibilityLabel="Saltar el descanso y seguir"
            onPress={() => {
            if (restRef.current) clearInterval(restRef.current);
            setResting(false);
          }}>
            <Text style={s.skipRestTxt}>Saltar descanso →</Text>
          </TouchableOpacity>
        </View>
      )}

      {!resting && exercises.length > 0 && (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {sessionConfig && sessionAdaptationMessage({
            availableMinutes: sessionConfig.minutes,
            energy: sessionConfig.energy,
            soreness: sessionConfig.soreness,
          }) && (
            <View style={s.sessionAdapted} accessible accessibilityRole="summary">
              <Text style={s.sessionAdaptedTitle}>PLAN DE HOY, A TU MEDIDA</Text>
              <Text style={s.sessionAdaptedText}>{sessionAdaptationMessage({
                availableMinutes: sessionConfig.minutes,
                energy: sessionConfig.energy,
                soreness: sessionConfig.soreness,
              })}</Text>
            </View>
          )}
          {ex && (
            <View style={s.currentExCard}>
              <View style={s.exBadge}>
                <Text style={s.exBadgeTxt}>EJERCICIO {currentEx + 1}/{exercises.length}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.exName, { flex: 1 }]}>{ex.name}</Text>
                {/* Estás frente a la máquina y no sabes cómo va el movimiento:
                    este es el momento donde el video hace falta de verdad. */}
                <TouchableOpacity style={s.swapBtn} onPress={() => openExerciseVideo(ex.name)}
                  hitSlop={A11y.hitSlop}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver un video de cómo hacer ${ex.name}`}
                  accessibilityHint="Se abre YouTube fuera de la app">
                  <Text style={s.swapTxt}>▶️</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.swapBtn} onPress={() => setSwapModal(true)}
                  hitSlop={A11y.hitSlop}
                  accessibilityRole="button"
                  accessibilityLabel={`Cambiar ${ex.name} por otro ejercicio del mismo grupo`}>
                  <Text style={s.swapTxt}>🔄</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.exGroup}>{ex.muscle_group}</Text>

              {/* Los puntos duplican lo que ya dice "Serie actual" abajo. */}
              <View style={s.setsRow} importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden>
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
                <View style={s.repCard} accessible
                  accessibilityLabel={`Objetivo: ${ex.reps} repeticiones`}>
                  <Text style={s.repVal}>{ex.reps}</Text>
                  <Text style={s.repLbl}>Reps</Text>
                </View>
                <View style={s.repCard} accessible
                  accessibilityLabel={`Descanso entre series: ${ex.rest_seconds} segundos`}>
                  <Text style={s.repVal}>{ex.rest_seconds}s</Text>
                  <Text style={s.repLbl}>Descanso</Text>
                </View>
                <View style={s.repCard} accessible
                  accessibilityLabel={`Vas en la serie ${currentSet} de ${ex.sets}`}>
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
                <View style={s.logField}>
                  <Text style={s.logLbl}>RIR (opc.)</Text>
                  <TextInput
                    style={s.logInput}
                    value={rirInput}
                    onChangeText={setRirInput}
                    keyboardType="decimal-pad"
                    placeholder="2"
                    placeholderTextColor={Colors.textMuted}
                    accessibilityLabel="Repeticiones que sentías que aún podías hacer"
                  />
                </View>
              </View>
              <Text style={s.rirHelp}>RIR: repeticiones que aún sentías posibles. 0 = fallo; 2 = quedaban unas 2.</Text>
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

              <TouchableOpacity style={s.doneBtn} onPress={completeSet} activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Marcar serie ${currentSet} de ${ex.sets} como completada`}
                accessibilityHint="Guarda el peso y las reps que anotaste, y arranca el descanso">
                <Text style={s.doneBtnTxt}>✓  SERIE COMPLETADA</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.queueLbl}>PRÓXIMOS EJERCICIOS</Text>
          {exercises.slice(currentEx + 1).map((e: any, i: number) => (
            <View key={i} style={s.queueItem} accessible
              accessibilityLabel={`Ejercicio ${currentEx + i + 2}: ${e.name}, ${e.sets} series de ${e.reps}`}>
              <View style={s.queueNum}>
                <Text style={s.queueNumTxt}>{currentEx + i + 2}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.queueName}>{e.name}</Text>
                <Text style={s.queueMeta}>{e.sets} × {e.reps}</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity style={s.finishBtn} onPress={confirmFinish} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Terminar la sesión de entrenamiento">
            <Text style={s.finishBtnTxt}>Terminar sesión</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Modal: sustituir ejercicio */}
      <Modal visible={swapModal} transparent animationType="slide" onRequestClose={() => setSwapModal(false)}>
        <View style={s.swapOverlay}>
          <View style={s.swapSheet} accessibilityViewIsModal>
            <Text style={s.swapTitle} accessibilityRole="header">Cambiar ejercicio</Text>
            <Text style={s.swapSub}>Mismo grupo muscular ({ex?.muscle_group})</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(exercisesForGroup(ex?.muscle_group ?? '').length > 0
                ? exercisesForGroup(ex?.muscle_group ?? '')
                : EXERCISE_LIBRARY
              ).map((lib) => {
                const risky = exerciseConflicts(lib.name, injuries).length > 0;
                return (
                  <TouchableOpacity key={lib.id} style={s.swapItem} onPress={() => requestSwap(lib)} activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Cambiar a ${lib.name}`}
                    accessibilityHint={risky
                      ? 'Cuidado: carga una zona que marcaste lesionada'
                      : lib.equipment}>
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
            <TouchableOpacity style={s.swapCancel} onPress={() => setSwapModal(false)}
              accessibilityRole="button" accessibilityLabel="Cancelar y no cambiar el ejercicio">
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

  // ── Calentamiento ──
  calTitulo: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  calIntro: { fontFamily: Fonts.body, fontSize: Type.bodyLg, color: Colors.textSecondary, lineHeight: 22, marginBottom: Spacing.md },
  calAviso: {
    fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.warning, lineHeight: 18,
    backgroundColor: 'rgba(255,180,84,0.10)', borderRadius: Radii.md, padding: Spacing.sm, marginBottom: Spacing.md,
  },
  // Riesgo alto autorizado: mismo aviso, más peso visual y tamaño legible.
  calAvisoAlto: {
    fontSize: Type.body, borderWidth: 1, borderColor: Colors.warning + '66', padding: Spacing.md,
  },
  calItem: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start',
    backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.sm,
  },
  calNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.accentMuted,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  calNumTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.accent },
  calNombre: { fontFamily: Fonts.bodySemi, fontSize: Type.bodyLg, color: Colors.textPrimary },
  calDur: { fontFamily: Fonts.bodyMedium, fontSize: Type.caption, color: Colors.accent, marginTop: 1 },
  calComo: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 19, marginTop: 4 },
  calAprox: {
    backgroundColor: Colors.bgSelected, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md,
    marginTop: Spacing.sm, marginBottom: Spacing.lg,
  },
  calAproxTitulo: { fontFamily: Fonts.heading, fontSize: Type.bodyLg, color: Colors.accent, marginBottom: 4 },
  calAproxTxt: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 20 },
  calBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 17, alignItems: 'center' },
  calBtnTxt: { fontFamily: Fonts.heading, fontSize: 16, color: '#0a0a0b', letterSpacing: 0.8 },
  readinessCard: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  readinessTitle: { fontFamily: Fonts.heading, fontSize: Type.body, color: Colors.textPrimary, letterSpacing: 0.7 },
  readinessHelp: { fontFamily: Fonts.body, fontSize: Type.caption, lineHeight: 18, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.md },
  readinessLabel: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.textSecondary, marginTop: 8, marginBottom: 6 },
  readinessRow: { flexDirection: 'row', gap: 8 },
  readinessChip: { flex: 1, minHeight: 44, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  readinessChipOn: { borderColor: Colors.accent, backgroundColor: Colors.accentMuted },
  readinessChipTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.textSecondary },
  readinessChipTxtOn: { color: Colors.accent },
  sessionAdapted: { backgroundColor: Colors.accentMuted, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.lg, padding: Spacing.md, marginBottom: Spacing.md },
  sessionAdaptedTitle: { fontFamily: Fonts.headingSemi, fontSize: Type.caption, color: Colors.accent, letterSpacing: 0.7, marginBottom: 4 },
  sessionAdaptedText: { fontFamily: Fonts.body, fontSize: Type.caption, lineHeight: 18, color: Colors.textSecondary },
  painToggle: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: 12, marginTop: Spacing.md },
  painToggleOn: { borderColor: Colors.error, backgroundColor: 'rgba(255,98,98,0.08)' },
  painToggleTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.textPrimary },
  safetyCenter: { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  safetyIcon: { fontSize: 42, textAlign: 'center', color: Colors.accent },
  safetyTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, textAlign: 'center' },
  safetyText: { fontFamily: Fonts.body, fontSize: Type.bodyLg, lineHeight: 24, color: Colors.textSecondary, textAlign: 'center' },
  safetyReason: { fontFamily: Fonts.body, fontSize: Type.body, lineHeight: 21, color: Colors.textSecondary },
  safetySecondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg },
  safetySecondaryTxt: { fontFamily: Fonts.heading, fontSize: Type.body, color: Colors.textPrimary },
  safetyFoot: { fontFamily: Fonts.body, fontSize: Type.caption, lineHeight: 18, color: Colors.textMuted, textAlign: 'center' },
  calSaltar: { paddingVertical: 14, alignItems: 'center' },
  calSaltarTxt: { fontFamily: Fonts.bodyMedium, fontSize: Type.body, color: Colors.textMuted },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  closeBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontFamily: Fonts.headingBold, fontSize: 16, color: Colors.textMuted },
  timerWrap: { alignItems: 'center' },
  timerLabel: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  timer: { fontFamily: Fonts.heading, fontSize: 42, color: Colors.accent, letterSpacing: -1 },
  progressWrap: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  progressBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 2 },
  progressTxt: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'right' },
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
  exBadgeTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, letterSpacing: 0.8 },
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
  repLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  logRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  logField: { flex: 1, backgroundColor: Colors.bgInput, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  logLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 0.6, marginBottom: 2 },
  logInput: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, padding: 0 },
  rirHelp: { fontFamily: Fonts.body, fontSize: Type.micro, lineHeight: 15, color: Colors.textMuted, marginTop: 6, marginBottom: Spacing.sm },
  platesTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, marginBottom: 4 },
  lastPerfTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent, marginBottom: 16 },
  notesBox: { backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 12, marginBottom: 16, borderLeftWidth: 2, borderLeftColor: Colors.accent },
  notesLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.accent, letterSpacing: 0.6, marginBottom: 4 },
  notesTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  doneBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center' },
  doneBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  queueLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgCard, borderRadius: Radii.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: Colors.border },
  queueNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  queueNumTxt: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.textMuted },
  queueName: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  queueMeta: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
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
  swapItemMeta: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  swapCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  swapCancelTxt: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
});
