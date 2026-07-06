import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { fetchTodayFoodLogs, localDateKey } from '../lib/foodLogs';
import { registerForPushNotifications } from '../lib/push';
import { setupDailyNotifications } from '../lib/dailyNotifications';
import { Colors } from '../constants/theme';

export default function Index() {
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const hydrateTodayLogs = useUserStore((s: any) => s.hydrateTodayLogs);

  useEffect(() => {
    checkProfile();
  }, []);

  async function checkProfile() {
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
      console.log('[Index] Error:', err?.message);
      router.replace('/(auth)/onboarding' as any);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>
  );
}
