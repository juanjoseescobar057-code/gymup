import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { fetchTodayFoodLogs, localDateKey } from '../lib/foodLogs';
import { registerForPushNotifications } from '../lib/push';
import { setupDailyNotifications } from '../lib/dailyNotifications';
import { captureError } from '../lib/monitoring';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

// Errores de RED/servidor (fetch falló, timeout, DNS, 5xx) se distinguen de
// "no hay sesión" (usuario nunca inició sesión, o cerró sesión): lo primero
// NO debe mandar a un usuario YA registrado de vuelta a onboarding como si
// nunca hubiera tenido cuenta — eso invita a crear una cuenta duplicada por
// un problema de red pasajero. Se muestra un reintento en su lugar.
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|timeout|abort/i.test(msg);
}

export default function Index() {
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const hydrateTodayLogs = useUserStore((s: any) => s.hydrateTodayLogs);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    checkProfile();
  }, []);

  async function checkProfile() {
    setConnectionError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.replace('/(auth)/onboarding' as any);
        return;
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (!profile) {
        router.replace('/(auth)/onboarding' as any);
        return;
      }

      const { data: plan } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      setProfile(profile);
      if (plan) setTrainingPlan(plan);

      // Recargar los registros de comida de HOY (antes arrancaban en 0).
      const todayLogs = await fetchTodayFoodLogs(session.user.id);
      hydrateTodayLogs(todayLogs, localDateKey());

      // Registrar push token para reactivación (no bloquea el arranque).
      registerForPushNotifications(session.user.id).catch(() => {});

      // Programar las notificaciones diarias AHORA que el usuario ya tiene
      // perfil (pedir permiso en el primer arranque en frío dispara rechazos).
      setupDailyNotifications().catch(() => {});

      setOnboardingComplete(true);
      router.replace('/(tabs)' as any);

    } catch (err: any) {
      captureError(err, { screen: 'index', step: 'checkProfile' });
      if (isNetworkError(err)) {
        // No hay forma de saber si el usuario tiene cuenta o no sin llegar al
        // servidor — mandarlo a onboarding aquí crearía una cuenta duplicada
        // por un problema de red pasajero. Se queda aquí con reintento.
        setConnectionError(true);
        return;
      }
      router.replace('/(auth)/onboarding' as any);
    }
  }

  if (connectionError) {
    return (
      <View style={s.container}>
        <Text style={s.errorTitle}>No pudimos conectar</Text>
        <Text style={s.errorSub}>
          Revisa tu conexión a internet e intenta de nuevo. Si el problema sigue, es probable
          que el servidor esté temporalmente fuera de servicio.
        </Text>
        <TouchableOpacity style={s.retryBtn} onPress={checkProfile} activeOpacity={0.85}>
          <Text style={s.retryBtnTxt}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  errorTitle: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.textPrimary, marginBottom: 10, textAlign: 'center' },
  errorSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },
  retryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, paddingHorizontal: Spacing.xl },
  retryBtnTxt: { fontFamily: Fonts.heading, fontSize: 15, color: '#0a0a0b', letterSpacing: 0.6 },
});
